import { readLimited } from '../../lib/request';
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { transaction, run, one, rate, event, vote, totals, getPost, audit } from '../../lib/db';
import {
  id,
  email,
  passwordHash,
  passwordCheck,
  login,
  hash,
  safeReturn,
  safeUrl,
  cookieOpts,
  verified,
} from '../../lib/security';
import { getApp } from '../../lib/apps';
import { absolute, secret } from '../../lib/config';
import { sendMail, mailAvailable } from '../../lib/mail';
import { createHmac } from 'node:crypto';
function bad(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const postSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, '제목은 3자 이상 입력해 주세요.')
    .max(140, '제목은 140자 이내로 입력해 주세요.'),
  body: z
    .string()
    .trim()
    .min(10, '본문은 10자 이상 입력해 주세요.')
    .max(30000, '본문은 30,000자 이내로 입력해 주세요.'),
  board: z.enum(['builds', 'questions', 'prompts', 'general', 'notice']),
  tags: z.string().max(150).default(''),
  tool: z.string().max(80).default(''),
  agent: z.string().max(80).default(''),
  prompt: z.string().max(5000).default(''),
  features: z.string().max(2000).default(''),
  difficulties: z.string().max(2000).default(''),
  scope: z.string().max(2000).default(''),
  url: z.string().max(1000).default(''),
  repo: z.string().max(1000).default(''),
});
export const POST: APIRoute = async (ctx) => {
  const action = ctx.params.action || '';
  const isJson = ctx.request.headers.get('Content-Type')?.includes('application/json');
  try {
    const origin = ctx.request.headers.get('Origin');
    if (!origin || ![ctx.url.origin, new URL(absolute('/')).origin].includes(origin))
      bad('요청 출처를 확인할 수 없어요. 페이지를 새로고침해 주세요.', 403);
    if (Number(ctx.request.headers.get('content-length') || 0) > 65536) bad('입력 내용이 너무 커요.', 413);
    const text = new TextDecoder().decode(await readLimited(ctx.request, 65536));
    if (Buffer.byteLength(text) > 65536) bad('입력 내용이 너무 커요.', 413);
    let b: any;
    try {
      b = isJson ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
    } catch {
      bad('입력 형식을 확인해 주세요.');
    }
    if ((ctx.request.headers.get('x-csrf-token') || b.csrf) !== ctx.locals.csrf)
      bad('페이지를 새로고침한 뒤 다시 시도해 주세요.', 403);
    const remote =
      process.env.TRUST_PROXY === '1'
        ? (ctx.request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
        : ctx.clientAddress;
    const ip = createHmac('sha256', secret)
      .update(new Date().toISOString().slice(0, 10) + remote)
      .digest('hex');
    const keyGroup = action.split('/')[0];
    const limit = keyGroup === 'auth' ? 20 : keyGroup === 'waitlist' ? 8 : keyGroup === 'vote' ? 30 : 80;
    if (!(await rate(ip + ':' + keyGroup, limit, 3600)))
      bad('요청이 많아요. 잠시 후 다시 시도해 주세요.', 429);
    const user = ctx.locals.user;
    const requireUser = () => {
      if (!user) bad('로그인 후 이용해 주세요.', 401);
      return user;
    };
    const admin = () => {
      requireUser();
      if (user.role !== 'admin') bad('관리자만 이용할 수 있어요.', 403);
    };
    const ownPost = async (pid: string) => {
      requireUser();
      const p = await getPost(pid);
      if (!p) bad('게시글을 찾을 수 없어요.', 404);
      if (p.user_id !== user.id) bad('작성자만 변경할 수 있어요.', 403);
      return p;
    };
    let result: any = { ok: true };
    await transaction(async () => {
      switch (action) {
        case 'auth/register': {
          const e = email(b.email);
          if (!e) bad('이메일 형식을 확인해 주세요.');
          const nick = String(b.nickname || '').trim();
          if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(nick)) bad('닉네임은 한글·영문·숫자 2~24자로 입력해 주세요.');
          if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128)
            bad('비밀번호는 10~128자로 입력해 주세요.');
          if (!b.terms) bad('약관과 개인정보 처리 안내에 동의해 주세요.');
          if (
            await one('SELECT id FROM users WHERE lower(email)=lower(?) OR lower(nickname)=lower(?)', e, nick)
          )
            bad('이미 사용 중인 이메일 또는 닉네임이에요.', 409);
          const uid = id();
          const pw = await passwordHash(b.password);
          await run('INSERT INTO users(id,email,nickname,password) VALUES(?,?,?,?)', uid, e, nick, pw);
          await run('INSERT INTO consents(user_id,policy) VALUES(?,?)', uid, 'terms-privacy-2026-09-08');
          await login(ctx, uid);
          if (b.news)
            await run(
              'INSERT INTO waitlist(email,token,consent) VALUES(?,?,?) ON CONFLICT DO NOTHING',
              e,
              id(),
              'updates-v1 / signup',
            );
          await event('signup');
          result = { ok: true, redirect: safeReturn(b.returnTo) };
          break;
        }
        case 'auth/oauth-register': {
          const payload = verified(ctx.cookies.get('oauth_pending')?.value);
          if (!payload) bad('가입 절차를 진행할 수 있는 시간이 지났어요. 소셜 로그인을 다시 시도해 주세요.');
          const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
          if (p.expires < Date.now() || !b.terms) bad('약관과 개인정보 처리 안내에 동의해 주세요.');
          const nick = String(b.nickname || '').trim();
          if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(nick)) bad('닉네임을 2~24자로 입력해 주세요.');
          if (
            await one(
              'SELECT id FROM users WHERE lower(email)=lower(?) OR lower(nickname)=lower(?)',
              p.email,
              nick,
            )
          )
            bad('이미 사용 중인 이메일 또는 닉네임이에요.', 409);
          const uid = id();
          await transaction(async () => {
            await run(
              'INSERT INTO users(id,email,nickname,email_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP)',
              uid,
              p.email,
              nick,
            );
            await run(
              'INSERT INTO identities(provider,subject,user_id) VALUES(?,?,?)',
              p.provider,
              p.subject,
              uid,
            );
            await run('INSERT INTO consents(user_id,policy) VALUES(?,?)', uid, 'terms-privacy-2026-09-08');
          });
          ctx.cookies.delete('oauth_pending', cookieOpts);
          await login(ctx, uid);
          await event('signup');
          result = { ok: true, redirect: safeReturn(p.returnTo) };
          break;
        }
        case 'auth/login': {
          const e = email(b.email),
            p = String(b.password || '');
          if (p.length > 128) bad('이메일 또는 비밀번호를 확인해 주세요.', 401);
          const u = await one("SELECT * FROM users WHERE lower(email)=lower(?) AND status='active'", e || '');
          if (!(await passwordCheck(p, u?.password)) || !u) bad('이메일 또는 비밀번호를 확인해 주세요.', 401);
          await login(ctx, u.id);
          result = { ok: true, redirect: safeReturn(b.returnTo) };
          break;
        }
        case 'auth/logout': {
          await run('DELETE FROM sessions WHERE token=?', hash(ctx.cookies.get('session')?.value || ''));
          ctx.cookies.delete('session', cookieOpts);
          result.redirect = '/';
          break;
        }
        case 'auth/forgot': {
          if (!mailAvailable()) bad('현재 이메일 발송 설정을 준비하고 있어요.', 503);
          const e = email(b.email);
          if (!e) bad('이메일 형식을 확인해 주세요.');
          const u = await one("SELECT id FROM users WHERE lower(email)=lower(?) AND status='active'", e);
          if (u) {
            const token = id() + id();
            await run(
              'INSERT INTO auth_tokens(token,user_id,kind,expires) VALUES(?,?,?,?)',
              hash(token),
              u.id,
              'reset',
              Date.now() + 30 * 60000,
            );
            await sendMail(
              e,
              '비밀번호를 다시 설정해 주세요',
              `30분 안에 다음 링크에서 비밀번호를 변경해 주세요.\n${absolute('/reset?token=' + token)}\n요청하지 않았다면 이 메일을 무시해 주세요.`,
            );
          }
          result.message = '가입한 이메일이라면 비밀번호 재설정 안내를 보내드려요.';
          break;
        }
        case 'auth/send-verification': {
          requireUser();
          if (user.email_verified_at) {
            result.message = '이미 확인된 이메일이에요.';
            break;
          }
          if (!mailAvailable()) bad('현재 이메일 발송 설정을 준비하고 있어요.', 503);
          const token = id() + id();
          await run("DELETE FROM auth_tokens WHERE user_id=? AND kind='verify'", user.id);
          await run(
            'INSERT INTO auth_tokens(token,user_id,kind,expires) VALUES(?,?,?,?)',
            hash(token),
            user.id,
            'verify',
            Date.now() + 30 * 60000,
          );
          await sendMail(
            user.email,
            '이메일 주소를 확인해 주세요',
            `30분 안에 링크를 열고 확인 버튼을 눌러 주세요.\n${absolute('/verify-email?token=' + token)}\n요청하지 않았다면 무시해 주세요.`,
          );
          result.message = '이메일 확인 안내를 준비했어요. 받은 메일의 링크를 열어 주소 확인을 마쳐 주세요.';
          break;
        }
        case 'auth/verify-email': {
          const t = await one(
            "SELECT * FROM auth_tokens WHERE token=? AND kind='verify' AND expires>? FOR UPDATE",
            hash(String(b.token || '')),
            Date.now(),
          );
          if (!t) bad('만료되었거나 이미 사용한 링크예요. 내 활동에서 다시 요청해 주세요.');
          await transaction(async () => {
            await run('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP WHERE id=?', t.user_id);
            await run("DELETE FROM auth_tokens WHERE user_id=? AND kind='verify'", t.user_id);
          });
          result.message = '이메일 주소를 확인했어요. 이제 이 창을 닫아도 됩니다.';
          break;
        }
        case 'auth/reset': {
          if (typeof b.password !== 'string' || b.password.length < 10 || b.password.length > 128)
            bad('비밀번호는 10~128자로 입력해 주세요.');
          const t = await one(
            "SELECT * FROM auth_tokens WHERE token=? AND kind='reset' AND expires>? FOR UPDATE",
            hash(String(b.token)),
            Date.now(),
          );
          if (!t) bad('만료되었거나 이미 사용한 링크예요.');
          const pw = await passwordHash(b.password);
          await transaction(async () => {
            await run('UPDATE users SET password=? WHERE id=?', pw, t.user_id);
            await run('DELETE FROM sessions WHERE user_id=?', t.user_id);
            await run('DELETE FROM auth_tokens WHERE user_id=?', t.user_id);
          });
          result = { ok: true, redirect: '/login?updated=1' };
          break;
        }
        case 'profile/update': {
          requireUser();
          const n = String(b.nickname || '').trim(),
            bio = String(b.bio || '').trim();
          if (!/^[\p{L}\p{N}_ -]{2,24}$/u.test(n) || bio.length > 500)
            bad('닉네임은 2~24자, 소개는 500자 이내로 입력해 주세요.');
          if (await one('SELECT id FROM users WHERE lower(nickname)=lower(?) AND id<>?', n, user.id))
            bad('이미 사용 중인 닉네임이에요.', 409);
          await run('UPDATE users SET nickname=?,bio=? WHERE id=?', n, bio, user.id);
          result.message = '프로필을 저장했어요.';
          break;
        }
        case 'profile/delete': {
          requireUser();
          if (b.confirm !== '탈퇴합니다') bad('확인란에 “탈퇴합니다”를 입력해 주세요.');
          if (user.password && !(await passwordCheck(String(b.password || ''), user.password)))
            bad('비밀번호를 확인해 주세요.', 403);
          await transaction(async () => {
            await run(
              "UPDATE posts SET status='deleted',body='',title='삭제된 글',build='{}' WHERE user_id=?",
              user.id,
            );
            await run("UPDATE comments SET status='deleted',body='' WHERE user_id=?", user.id);
            await run(
              'DELETE FROM notifications WHERE post_id IN (SELECT id FROM posts WHERE user_id=?) OR comment_id IN (SELECT id FROM comments WHERE user_id=?)',
              user.id,
              user.id,
            );
            await run(
              'DELETE FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)',
              user.id,
            );
            await run('DELETE FROM waitlist WHERE lower(email)=lower(?)', user.email);
            await run('DELETE FROM users WHERE id=?', user.id);
          });
          ctx.cookies.delete('session', cookieOpts);
          result.redirect = '/';
          break;
        }
        case 'vote': {
          const a = getApp(String(b.slug));
          if (!a) bad('도구를 찾을 수 없어요.', 404);
          result = {
            ok: true,
            ...(await vote(
              a.slug,
              user?.id || null,
              ctx.locals.anon,
              b.remove === true || b.remove === 'true',
            )),
            voted: !(b.remove === true || b.remove === 'true'),
          };
          await event('vote', '/' + a.slug);
          break;
        }
        case 'tool/bookmark': {
          requireUser();
          if (!getApp(String(b.slug))) bad('도구를 찾을 수 없어요.', 404);
          if (await one('SELECT 1 FROM bookmarks WHERE user_id=? AND slug=?', user.id, b.slug)) {
            await run('DELETE FROM bookmarks WHERE user_id=? AND slug=?', user.id, b.slug);
            result.active = false;
          } else {
            await run('INSERT INTO bookmarks(user_id,slug) VALUES(?,?)', user.id, b.slug);
            result.active = true;
          }
          break;
        }
        case 'posts/create':
        case 'posts/update': {
          requireUser();
          const p = postSchema.parse(b);
          if (p.board === 'notice') admin();
          if (p.tool && !getApp(p.tool)) bad('관련 도구를 확인해 주세요.');
          for (const x of [p.url, p.repo])
            if (x && !safeUrl(x)) bad('링크는 http 또는 https 주소로 입력해 주세요.');
          const build = JSON.stringify({
            agent: p.agent,
            prompt: p.prompt,
            features: p.features,
            difficulties: p.difficulties,
            scope: p.scope,
            url: safeUrl(p.url),
            repo: safeUrl(p.repo),
          });
          const pid = String(b.id || id());
          if (action === 'posts/update') {
            await ownPost(pid);
            await run(
              'UPDATE posts SET title=?,body=?,board=?,tags=?,tool_slug=?,build=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',
              p.title,
              p.body,
              p.board,
              p.tags,
              p.tool || null,
              build,
              pid,
            );
          } else {
            await run(
              'INSERT INTO posts(id,user_id,title,body,board,tags,tool_slug,build) VALUES(?,?,?,?,?,?,?,?)',
              pid,
              user.id,
              p.title,
              p.body,
              p.board,
              p.tags,
              p.tool || null,
              build,
            );
            await event('post');
          }
          result = { ok: true, redirect: '/community/' + pid, id: pid };
          break;
        }
        case 'posts/delete': {
          const pid = String(b.id);
          await ownPost(pid);
          await transaction(async () => {
            await run(
              "UPDATE posts SET status='deleted',title='삭제된 글',body='',build='{}' WHERE id=?",
              pid,
            );
            await run('DELETE FROM reactions WHERE post_id=?', pid);
            await run('DELETE FROM notifications WHERE post_id=?', pid);
            await run("UPDATE comments SET status='deleted',body='' WHERE post_id=?", pid);
          });
          result.redirect = '/community';
          break;
        }
        case 'comments/create': {
          requireUser();
          const pid = String(b.post),
            p = await getPost(pid);
          if (!p) bad('게시글을 찾을 수 없어요.', 404);
          const body = String(b.body || '').trim();
          if (body.length < 1 || body.length > 3000) bad('댓글은 1~3,000자로 입력해 주세요.');
          const parent = b.parent
            ? await one("SELECT * FROM comments WHERE id=? AND post_id=? AND status='active'", b.parent, pid)
            : null;
          if (b.parent && (!parent || parent.parent_id))
            bad('답글에는 다시 답글을 달 수 없어요. 원래 댓글에 답글을 남겨주세요.');
          const cid = id();
          await transaction(async () => {
            await run(
              'INSERT INTO comments(id,post_id,user_id,parent_id,body) VALUES(?,?,?,?,?)',
              cid,
              pid,
              user.id,
              parent?.id || null,
              body,
            );
            for (const uid of new Set([p.user_id, parent?.user_id].filter((x) => x && x !== user.id)))
              await run(
                'INSERT INTO notifications(user_id,post_id,comment_id,label) VALUES(?,?,?,?)',
                uid,
                pid,
                cid,
                `${user.nickname}님이 ${parent ? '답글' : '댓글'}을 남겼어요.`,
              );
          });
          result = { ok: true, redirect: '/community/' + pid + '#comment-' + cid, id: cid };
          break;
        }
        case 'comments/update':
        case 'comments/delete': {
          requireUser();
          const c = await one(
            "SELECT c.* FROM comments c JOIN posts p ON c.post_id=p.id WHERE c.id=? AND c.status='active' AND p.status='active'",
            String(b.id),
          );
          if (!c) bad('댓글을 찾을 수 없어요.', 404);
          if (c.user_id !== user.id) bad('작성자만 변경할 수 있어요.', 403);
          if (action.endsWith('update')) {
            const body = String(b.body || '').trim();
            if (!body || body.length > 3000) bad('댓글은 1~3,000자로 입력해 주세요.');
            await run('UPDATE comments SET body=? WHERE id=?', body, c.id);
          } else {
            await run("UPDATE comments SET body='',status='deleted' WHERE id=?", c.id);
            await run('DELETE FROM notifications WHERE comment_id=?', c.id);
          }
          result.redirect = '/community/' + c.post_id;
          break;
        }
        case 'posts/react': {
          requireUser();
          const pid = String(b.post);
          if (!(await getPost(pid))) bad('게시글을 찾을 수 없어요.', 404);
          const kind = b.kind;
          if (!['like', 'bookmark'].includes(kind)) bad('좋아요 또는 저장 버튼을 다시 눌러주세요.');
          if (
            await one('SELECT 1 FROM reactions WHERE user_id=? AND post_id=? AND kind=?', user.id, pid, kind)
          ) {
            await run('DELETE FROM reactions WHERE user_id=? AND post_id=? AND kind=?', user.id, pid, kind);
            result.active = false;
          } else {
            await run('INSERT INTO reactions(user_id,post_id,kind) VALUES(?,?,?)', user.id, pid, kind);
            result.active = true;
          }
          result.count = (await one(
            'SELECT COUNT(*) AS n FROM reactions WHERE post_id=? AND kind=?',
            pid,
            kind,
          ))!.n;
          break;
        }
        case 'report': {
          requireUser();
          const type = b.type,
            target = String(b.target),
            reason = String(b.reason || '').trim();
          if (!['post', 'comment'].includes(type) || reason.length < 5 || reason.length > 1000)
            bad('신고 사유를 5~1,000자로 입력해 주세요.');
          if (
            type === 'post'
              ? !(await getPost(target))
              : !(await one(
                  "SELECT c.id FROM comments c JOIN posts p ON c.post_id=p.id WHERE c.id=? AND c.status='active' AND p.status='active'",
                  target,
                ))
          )
            bad('신고할 내용을 찾을 수 없어요.', 404);
          await run(
            'INSERT INTO reports(user_id,target_type,target_id,reason) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',
            user.id,
            type,
            target,
            reason,
          );
          result.message = '신고를 접수했어요. 운영자가 확인하겠습니다.';
          break;
        }
        case 'suggest': {
          requireUser();
          const title = String(b.title || '').trim(),
            body = String(b.body || '').trim();
          if (title.length < 3 || title.length > 140 || body.length < 10 || body.length > 10000)
            bad('제목은 3~140자, 설명은 10~10,000자로 입력해 주세요.');
          await run(
            'INSERT INTO suggestions(user_id,slug,title,body) VALUES(?,?,?,?)',
            user.id,
            b.slug || null,
            title,
            body,
          );
          result.message = '제안을 접수했어요. 내 활동에서 검토 상태를 확인할 수 있어요.';
          break;
        }
        case 'notifications/read': {
          requireUser();
          await run(
            'UPDATE notifications SET is_read=1 WHERE user_id=?' + (b.id ? ' AND id=?' : ''),
            user.id,
            ...(b.id ? [b.id] : []),
          );
          result.redirect = '/notifications';
          break;
        }
        case 'waitlist': {
          if (b.website) {
            result.message = '신청을 접수했어요.';
            break;
          }
          const e = email(b.email);
          if (!e) bad('이메일 형식을 확인해 주세요.');
          if (!b.consent) bad('업데이트 소식 수신에 동의해 주세요.');
          const w = await one('SELECT * FROM waitlist WHERE lower(email)=lower(?)', e);
          const token = w?.token || id() + id();
          if (w?.status === 'withdrawn')
            await run(
              "UPDATE waitlist SET status='active',consent=?,withdrawn_at=NULL WHERE lower(email)=lower(?)",
              'updates-v1 / resubscribe',
              e,
            );
          else
            await run(
              'INSERT INTO waitlist(email,token,consent) VALUES(?,?,?) ON CONFLICT DO NOTHING',
              e,
              token,
              'updates-v1 / public',
            );
          result.message = '신청을 접수했어요. 이미 등록된 주소는 중복 등록하지 않아요.';
          if (!w) result.withdrawUrl = '/unsubscribe?token=' + token;
          break;
        }
        case 'waitlist/withdraw': {
          if (!b.token) bad('수신 거부 링크를 확인해 주세요.');
          await run(
            "UPDATE waitlist SET status='withdrawn',withdrawn_at=CURRENT_TIMESTAMP WHERE token=?",
            String(b.token),
          );
          result.message = '업데이트 소식 수신을 중단했어요.';
          break;
        }
        case 'analytics': {
          if (!['search', 'copy', 'share'].includes(b.event)) bad('알 수 없는 이벤트예요.');
          await event(b.event, b.slug && getApp(b.slug) ? '/' + b.slug : '/');
          break;
        }
        case 'admin/action': {
          admin();
          const target = String(b.target),
            op = b.operation;
          await transaction(async () => {
            switch (op) {
              case 'user-suspend':
              case 'user-restore': {
                if (target === user.id) bad('자신의 계정은 제한할 수 없어요.');
                await run(
                  'UPDATE users SET status=? WHERE id=?',
                  op === 'user-suspend' ? 'suspended' : 'active',
                  target,
                );
                await run('DELETE FROM sessions WHERE user_id=?', target);
                break;
              }
              case 'post-hide':
              case 'post-restore':
                await run(
                  "UPDATE posts SET status=? WHERE id=? AND status<>'deleted'",
                  op === 'post-hide' ? 'hidden' : 'active',
                  target,
                );
                break;
              case 'comment-hide':
              case 'comment-restore':
                await run(
                  "UPDATE comments SET status=? WHERE id=? AND status<>'deleted'",
                  op === 'comment-hide' ? 'hidden' : 'active',
                  target,
                );
                break;
              case 'post-pin':
              case 'post-unpin':
                await run('UPDATE posts SET pinned=? WHERE id=?', op === 'post-pin' ? 1 : 0, target);
                break;
              case 'report-resolve':
              case 'report-dismiss':
                await run(
                  'UPDATE reports SET status=? WHERE id=?',
                  op === 'report-resolve' ? 'resolved' : 'dismissed',
                  target,
                );
                break;
              case 'suggest-accept':
              case 'suggest-reject':
                await run(
                  'UPDATE suggestions SET status=? WHERE id=?',
                  op === 'suggest-accept' ? 'accepted_pending_release' : 'rejected',
                  target,
                );
                break;
              default:
                bad('알 수 없는 운영 작업이에요.');
            }
            await audit(user.id, op, target);
          });
          result = { ok: true, redirect: '/admin' };
          break;
        }
        default:
          bad('요청한 기능을 찾을 수 없어요.', 404);
      }
    });
    if (!isJson && ctx.request.headers.get('accept')?.includes('text/html'))
      return ctx.redirect(result.redirect || safeReturn(b.returnTo), 303);
    return Response.json(result);
  } catch (e: any) {
    const status = e.status || (e.code === '23505' ? 409 : 0) || (e instanceof z.ZodError ? 400 : 500);
    const message =
      e instanceof z.ZodError
        ? /[가-힣]/.test(e.issues[0]?.message || '')
          ? e.issues[0].message
          : '입력 항목과 글자 수를 확인해 주세요. 게시판도 선택해야 해요.'
        : e.code === '23505'
          ? '이미 등록된 정보예요. 입력 내용을 확인해 주세요.'
          : status < 500
            ? e.message
            : '처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.';
    if (status >= 500) console.error('api_failed', action, e.code || e.name);
    return Response.json({ ok: false, error: message }, { status });
  }
};
export const GET: APIRoute = async (ctx) =>
  ctx.params.action === 'health'
    ? Response.json({ ok: (await one('SELECT 1 AS ready'))?.ready === 1 })
    : ctx.params.action === 'totals'
      ? Response.json(await totals())
      : Response.json({ error: '요청한 기능을 찾을 수 없어요.' }, { status: 404 });
