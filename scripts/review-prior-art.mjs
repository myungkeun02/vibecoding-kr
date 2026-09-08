import fs from 'node:fs';
const repos = {
  collab: 'mattermost/mattermost',
  notes: 'laurent22/joplin',
  office: 'ONLYOFFICE/DocumentServer',
  projects: 'kanboard/kanboard',
  data: 'metabase/metabase',
  whiteboard: 'excalidraw/excalidraw',
  design: 'photopea/photopea',
  media: 'obsproject/obs-studio',
  forms: 'heyform/heyform',
  automation: 'activepieces/activepieces',
  crm: 'chatwoot/chatwoot',
  scheduling: 'calcom/cal.com',
  files: 'nextcloud/server',
  dev: 'usebruno/bruno',
  web: 'WordPress/WordPress',
};
const rows = await Promise.all(
  Object.entries(repos).map(async ([category, repo]) => {
    try {
      const r = await fetch('https://api.github.com/repos/' + repo + '/license', {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      return {
        category,
        repo,
        status: r.status,
        license: j.license?.spdx_id || 'NOASSERTION',
        licenseUrl: j.html_url || null,
        name: repo.split('/')[1],
        checkedOn: '2026-09-08',
      };
    } catch {
      return {
        category,
        repo,
        status: 0,
        license: 'NOASSERTION',
        licenseUrl: null,
        name: repo.split('/')[1],
        checkedOn: '2026-09-08',
      };
    }
  }),
);
fs.writeFileSync('docs/prior-art-evidence.json', JSON.stringify(rows, null, 2));
console.log(rows);
for (const f of fs.readdirSync('data/apps')) {
  const p = 'data/apps/' + f,
    a = JSON.parse(fs.readFileSync(p));
  const r = rows.find((x) => x.category === a.category);
  if (r && r.category !== 'design')
    a.priorArt = [
      {
        name: r.name,
        url: 'https://github.com/' + r.repo,
        license: r.license === 'NOASSERTION' ? '라이선스별 적용 범위 확인 필요' : r.license,
        licenseUrl: r.licenseUrl,
        verified: r.status === 200 && r.license !== 'NOASSERTION',
      },
    ];
  if (r?.category === 'design')
    a.priorArt = [
      {
        name: 'GIMP',
        url: 'https://www.gimp.org/',
        license: '라이선스 확인 필요',
        licenseUrl: null,
        verified: false,
      },
    ];
  fs.writeFileSync(p, JSON.stringify(a, null, 2) + '\n');
}
