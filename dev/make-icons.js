/* アイコン生成：案47「せーの / マゼンタ・ポップ」 */
const { chromium } = require('playwright');
const path = require('path');

const BG = '#ff1f7a', MARK = '#f4ff2b';

const svg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <g transform="rotate(-8 256 256)" fill="${MARK}">
      <rect x="140" y="96" width="72" height="212" rx="36"/>
      <circle cx="176" cy="392" r="44"/>
      <rect x="300" y="96" width="72" height="212" rx="36"/>
      <circle cx="336" cy="392" r="44"/>
    </g>
  </g>
</svg>`;

const page = (scale) => `<!DOCTYPE html><html><head><style>
html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:${BG}}
svg{display:block}</style></head><body>${svg(scale)}</body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = path.join(__dirname, '..', 'icons');
  const shots = [
    { file: 'icon-512-v2.png',          size: 512, scale: 1 },
    { file: 'icon-192-v2.png',          size: 192, scale: 1 },
    { file: 'apple-touch-icon-v2.png',  size: 180, scale: 1 },
    { file: 'icon-maskable-512-v2.png', size: 512, scale: 0.64 },
    { file: 'favicon-v2.png',           size: 64,  scale: 1 },
  ];
  for (const s of shots) {
    const ctx = await b.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: s.size / 512 });
    const p = await ctx.newPage();
    await p.setContent(page(s.scale));
    await p.screenshot({ path: path.join(out, s.file) });
    await ctx.close();
    console.log('  ' + s.file);
  }
  await b.close(); process.exit(0);
})();
