export {};
function iconFallback(img: HTMLImageElement) {
  if (!img.hasAttribute('data-tool-icon-image')) return;
  img.hidden = true;
  img.parentElement?.classList.remove('has-image');
  img.parentElement?.querySelector('[data-tool-icon-fallback]')?.removeAttribute('hidden');
}
document.addEventListener(
  'error',
  (event) => {
    if (event.target instanceof HTMLImageElement) iconFallback(event.target);
  },
  true,
);
document.querySelectorAll<HTMLImageElement>('[data-tool-icon-image]').forEach((img) => {
  if (img.complete && img.naturalWidth === 0) iconFallback(img);
});
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const el = $('#toast')!;
  el.textContent = message;
  el.removeAttribute('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.setAttribute('hidden', ''), 3500);
}
const csrf = () => $('meta[name="csrf-token"]')?.getAttribute('content') || '';
async function api(path: string, body: any) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf() },
    body: JSON.stringify(body),
  });
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error('응답을 받지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!response.ok) {
    if (response.status === 401) {
      location.href = '/login?returnTo=' + encodeURIComponent(location.pathname + location.search);
    }
    throw new Error(result.error || '요청을 처리하지 못했어요.');
  }
  return result;
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement('textarea');
    field.value = text;
    field.style.position = 'fixed';
    field.style.left = '-9999px';
    document.body.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    if (!ok) throw new Error('자동 복사가 지원되지 않아요. 프롬프트를 선택해 직접 복사해 주세요.');
  }
}
function roll(value: number) {
  document.querySelectorAll<HTMLElement>('[data-odometer]').forEach((el) => {
    el.dataset.odometer = String(value);
    el.style.setProperty('--digits', String(('₩' + value.toLocaleString('ko-KR')).length * 0.8));
    el.setAttribute('aria-label', '₩' + value.toLocaleString('ko-KR'));
    el.replaceChildren();
    for (const char of '₩' + value.toLocaleString('ko-KR')) {
      const span = document.createElement('span');
      span.setAttribute('aria-hidden', 'true');
      if (/\d/.test(char)) {
        span.className = 'odigit';
        const reel = document.createElement('span');
        reel.className = 'oreel';
        for (let n = 0; n < 10; n++) {
          const digit = document.createElement('span');
          digit.textContent = String(n);
          reel.append(digit);
        }
        span.append(reel);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => (reel.style.transform = `translateY(-${Number(char) * 1.2}em)`)),
        );
      } else span.textContent = char;
      el.append(span);
    }
  });
}
let controller: AbortController | undefined;
async function updateDirectory(url: URL, push = true) {
  if (!$('#directory')) return;
  controller?.abort();
  controller = new AbortController();
  $('#directory')?.classList.add('loading');
  try {
    const r = await fetch(url.pathname + url.search, { signal: controller.signal });
    if (!r.ok) throw new Error();
    const html = new DOMParser().parseFromString(await r.text(), 'text/html');
    const next = html.querySelector('#directory');
    if (!next) throw new Error();
    $('#directory')?.replaceWith(next);
    if (push) history.pushState(null, '', url.pathname + url.search + url.hash);
    const input = $<HTMLInputElement>('#search');
    if (input) input.value = url.searchParams.get('q') || '';
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      toast('검색 결과를 불러오지 못했어요. 다시 시도해 주세요.');
      $('#directory')?.classList.remove('loading');
    }
  }
}
let searchTimer: ReturnType<typeof setTimeout>;
document.addEventListener('input', (e) => {
  if ((e.target as HTMLElement).id !== 'search') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const url = new URL(location.href);
    const value = (e.target as HTMLInputElement).value;
    value ? url.searchParams.set('q', value) : url.searchParams.delete('q');
    url.searchParams.delete('page');
    url.hash = '';
    updateDirectory(url);
    api('/api/analytics', { event: 'search' }).catch(() => {});
  }, 160);
});
document.addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement;
  if (!select.closest('#filters')) return;
  const url = new URL(location.href);
  select.value ? url.searchParams.set(select.name, select.value) : url.searchParams.delete(select.name);
  url.searchParams.delete('page');
  updateDirectory(url);
});
window.addEventListener('popstate', () => updateDirectory(new URL(location.href), false));
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
    const input = $<HTMLInputElement>('#search');
    if (input) {
      e.preventDefault();
      input.focus();
    }
  }
});
document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  if (!form.matches('form[data-api]')) return;
  e.preventDefault();
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
  const status = form.querySelector<HTMLElement>('.form-status');
  const button = form.querySelector<HTMLButtonElement>('button[type=submit],button:not([type])');
  if (button) button.disabled = true;
  if (status) {
    status.textContent = '처리 중이에요…';
    status.classList.remove('error');
  }
  try {
    const body = Object.fromEntries(new FormData(form));
    const data = await api(form.getAttribute('action')!, body);
    if (data.redirect) {
      const destination = new URL(data.redirect, location.href);
      const samePage =
        destination.origin === location.origin &&
        destination.pathname === location.pathname &&
        destination.search === location.search;
      location.href = data.redirect;
      if (samePage) location.reload();
      return;
    }
    if (status) {
      status.textContent = data.message || '저장했어요.';
      if (data.withdrawUrl) {
        const link = document.createElement('a');
        link.href = data.withdrawUrl;
        link.textContent = ' 수신 거부 링크';
        link.style.textDecoration = 'underline';
        status.append(link);
      }
    } else toast(data.message || '저장했어요.');
  } catch (err) {
    const text = (err as Error).message;
    if (status) {
      status.textContent = text;
      status.classList.add('error');
    } else toast(text);
  } finally {
    if (button) button.disabled = false;
  }
});
document.addEventListener('click', async (e) => {
  const link = (e.target as Element).closest<HTMLAnchorElement>('a[data-filter-link]');
  if (link && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
    e.preventDefault();
    await updateDirectory(new URL(link.href));
    return;
  }
  const b = (e.target as Element).closest<HTMLButtonElement>('button');
  if (!b) return;
  try {
    if (b.hasAttribute('data-theme-toggle')) {
      const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem('theme', theme);
      } catch {}
      return;
    }
    if (b.dataset.copy) {
      const target = document.getElementById(b.dataset.copy);
      const prefix = b.dataset.agent
        ? (
            {
              claude:
                'Claude Code에서 프로젝트 폴더를 열고 아래 요구사항을 전달하세요. 변경 사항을 검토하고 실행·검증까지 진행하세요.\n\n',
              codex:
                'Codex에서 작업할 프로젝트를 선택한 뒤 아래 요구사항을 전달하세요. 구현 후 실제 서버와 테스트로 동작을 검증하세요.\n\n',
              cursor:
                'Cursor의 프로젝트에서 Agent 대화를 열고 아래 요구사항을 전달하세요. 파일 변경을 검토하고 터미널에서 실행 결과를 확인하세요.\n\n',
            } as Record<string, string>
          )[b.dataset.agent]
        : '';
      await copy((prefix || '') + (target?.textContent || ''));
      const before = b.textContent;
      b.textContent = '복사했어요 ✓';
      setTimeout(() => (b.textContent = before), 1800);
      api('/api/analytics', { event: 'copy', slug: b.dataset.slug }).catch(() => {});
      return;
    }
    if (b.hasAttribute('data-copy-url')) {
      await copy($('link[rel=canonical]')?.getAttribute('href') || location.href);
      toast('링크를 복사했어요.');
      return;
    }
    if (b.hasAttribute('data-native-share')) {
      const url = $('link[rel=canonical]')?.getAttribute('href') || location.href;
      if (navigator.share) await navigator.share({ title: document.title, url });
      else {
        await copy(url);
        toast('공유 링크를 복사했어요.');
      }
      return;
    }
    if (b.dataset.kakaoKey) {
      b.disabled = true;
      const w = window as any;
      if (!w.Kakao)
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js';
          script.crossOrigin = 'anonymous';
          script.onload = () => resolve();
          script.onerror = () => {
            script.remove();
            reject(new Error('카카오톡 공유를 불러오지 못했어요. 링크 복사를 이용해 주세요.'));
          };
          document.head.append(script);
        });
      if (!w.Kakao.isInitialized()) w.Kakao.init(b.dataset.kakaoKey);
      const url = $('link[rel=canonical]')!.getAttribute('href')!;
      w.Kakao.Share.sendDefault({
        objectType: 'feed',
        content: {
          title: document.title,
          description: $('meta[name=description]')?.getAttribute('content') || '',
          imageUrl: $('meta[property="og:image"]')?.getAttribute('content'),
          link: { webUrl: url, mobileWebUrl: url },
        },
        buttons: [{ title: '대체 가능성 살펴보기', link: { webUrl: url, mobileWebUrl: url } }],
      });
      return;
    }
    if (b.hasAttribute('data-vote')) {
      b.disabled = true;
      const remove = b.getAttribute('aria-pressed') === 'true';
      const data = await api('/api/vote', { slug: b.dataset.slug, remove });
      b.setAttribute('aria-pressed', String(data.voted));
      b.textContent = (data.voted ? '대체 기록 남김 ✓' : '직접 대체했어요 ↑') + ' ' + data.count;
      roll(data.monthly);
      document.querySelectorAll('[data-total-votes]').forEach((el) => (el.textContent = String(data.votes)));
      toast(data.voted ? '직접 대체한 기록을 남겼어요.' : '대체 기록을 취소했어요.');
      return;
    }
    if (b.hasAttribute('data-bookmark')) {
      b.disabled = true;
      const data = await api('/api/tool/bookmark', { slug: b.dataset.slug });
      b.setAttribute('aria-pressed', String(data.active));
      b.textContent = data.active ? '저장했어요 ✓' : '도구 저장 ☆';
      return;
    }
    if (b.hasAttribute('data-react')) {
      b.disabled = true;
      const data = await api('/api/posts/react', { post: b.dataset.post, kind: b.dataset.react });
      b.setAttribute('aria-pressed', String(data.active));
      b.textContent =
        b.dataset.react === 'like'
          ? '좋아요 ' + data.count + (data.active ? ' ✓' : '')
          : data.active
            ? '저장했어요 ✓'
            : '글 저장 ☆';
      return;
    }
    if (b.hasAttribute('data-preview')) {
      const area = $<HTMLTextAreaElement>('textarea[name=body]');
      const preview = $('#markdown-preview');
      if (area && preview) {
        preview.textContent = area.value;
        preview.hidden = !preview.hidden;
      }
      return;
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') toast((err as Error).message);
  } finally {
    b.disabled = false;
  }
});
document.querySelectorAll<HTMLElement>('[data-odometer]').forEach((e) => roll(Number(e.dataset.odometer)));
document.addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  if (!input.hasAttribute('data-upload') || !input.files?.[0]) return;
  const file = input.files[0];
  if (file.size > 5 * 1024 * 1024) {
    toast('5MB 이하 이미지를 선택해 주세요.');
    return;
  }
  try {
    const form = new FormData();
    form.set('file', file);
    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'x-csrf-token': csrf() },
      body: form,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const body = $<HTMLTextAreaElement>('textarea[name=body]');
    if (body) body.value += '\n\n![제작 화면](' + data.url + ')\n';
    toast('이미지를 첨부했어요. 글을 게시하면 함께 공개됩니다.');
  } catch (e) {
    toast((e as Error).message);
  } finally {
    input.value = '';
  }
});
