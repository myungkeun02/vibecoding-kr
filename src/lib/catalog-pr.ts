import { AppSchema } from './schema';
type Fetcher = typeof fetch;
export async function createCatalogPR(
  input: unknown,
  proposal: { id: number; title: string },
  fetcher: Fetcher = fetch,
) {
  const app = AppSchema.parse(input),
    target = process.env.GITHUB_REPOSITORY || '',
    fork = process.env.GITHUB_BOT_FORK || '',
    token = process.env.GITHUB_BOT_TOKEN;
  if (!token || !/^[-\w.]+\/[-\w.]+$/.test(target) || !/^[-\w.]+\/[-\w.]+$/.test(fork) || fork === target)
    throw new Error('GITHUB_PR_NOT_CONFIGURED');
  if (!app.published || !app.sources.some((s) => s.status === 'verified'))
    throw new Error('Review official sources before opening a proposal PR');
  async function call(path: string, method = 'GET', body?: unknown, optional = false) {
    const r = await fetcher('https://api.github.com' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (optional && r.status === 404) return null;
    if (!r.ok) throw new Error('GITHUB_PR_REQUEST_FAILED_' + r.status);
    return r.json();
  }
  const base = await call('/repos/' + target),
    baseBranch = base.default_branch;
  const ref = await call('/repos/' + target + '/git/ref/heads/' + encodeURIComponent(baseBranch));
  const branch = 'catalog/proposal-' + proposal.id + '-' + Date.now();
  await call('/repos/' + fork + '/git/refs', 'POST', { ref: 'refs/heads/' + branch, sha: ref.object.sha });
  const path = 'data/apps/' + app.slug + '.json',
    existing = await call(
      '/repos/' + fork + '/contents/' + path + '?ref=' + encodeURIComponent(branch),
      'GET',
      undefined,
      true,
    );
  await call('/repos/' + fork + '/contents/' + path, 'PUT', {
    message: 'Review catalog proposal #' + proposal.id + ': ' + app.name,
    branch,
    content: Buffer.from(JSON.stringify(app, null, 2) + '\n').toString('base64'),
    ...(existing ? { sha: existing.sha } : {}),
  });
  const pr = await call('/repos/' + target + '/pulls', 'POST', {
    title: proposal.title.slice(0, 120),
    head: fork.split('/')[0] + ':' + branch,
    base: baseBranch,
    draft: true,
    body:
      '도구 제안 #' +
      proposal.id +
      '의 공식 출처와 JSON을 검토한 변경입니다.\n\n검증·가격·라이선스를 다시 확인하고 CI 통과 후 병합하세요. 병합과 실제 배포 전에는 게시 완료로 처리하지 않습니다.',
  });
  return pr.html_url as string;
}
