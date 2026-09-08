import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { apps } from '../src/lib/apps';
import { verdicts } from '../src/lib/config';
const fontPath = 'scripts/fonts/Pretendard-Bold.otf';
mkdirSync('scripts/fonts', { recursive: true });
if (!existsSync(fontPath)) {
  const r = await fetch(
    'https://raw.githubusercontent.com/orioncactus/pretendard/main/packages/pretendard/dist/public/static/Pretendard-Bold.otf',
  );
  if (!r.ok) throw new Error('OG font download failed');
  writeFileSync(fontPath, Buffer.from(await r.arrayBuffer()));
  const license = await fetch('https://raw.githubusercontent.com/orioncactus/pretendard/main/LICENSE');
  writeFileSync('scripts/fonts/OFL.txt', await license.text());
}
const font = readFileSync(fontPath);
mkdirSync('public/og', { recursive: true });
for (const a of [null, ...apps]) {
  const color = a?.verdict === 'kinda' ? '#ffd17b' : a?.verdict === 'no' ? '#ff9792' : '#b4ff5d';
  const tree: any = {
    type: 'div',
    props: {
      style: {
        width: 1200,
        height: 630,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#090c0b',
        padding: '60px 70px',
        fontFamily: 'Pretendard',
        color: '#eaf1e9',
      },
      children: [
        {
          type: 'div',
          props: {
            style: { display: 'flex', color: '#b4ff5d', fontSize: 30 },
            children: '>_ 바이브코딩가능?',
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', marginTop: 80, fontSize: 64, lineHeight: 1.2, letterSpacing: '-3px' },
            children: a ? a.nameKo + ', 직접 만들 수 있을까?' : '이 도구, 직접 만들 수 있을까?',
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', fontSize: 34, color, marginTop: 32 },
            children: a ? verdicts[a.verdict].label : '필요한 기능부터, 직접 만들어보세요',
          },
        },
        {
          type: 'div',
          props: {
            style: { display: 'flex', fontSize: 22, color: '#9aa99e', marginTop: 'auto' },
            children: a ? a.scope : '대체 가능성 살펴보기 · AI 제작 요청문 · 제작 경험 나누기',
          },
        },
      ],
    },
  };
  const svg = await satori(tree, {
    width: 1200,
    height: 630,
    fonts: [{ name: 'Pretendard', data: font, weight: 700 }],
  });
  writeFileSync('public/og/' + (a?.slug || 'default') + '.png', new Resvg(svg).render().asPng());
}
console.log(`OG ${apps.length + 1} images generated with Korean font.`);
