/* アイコン生成：Chromiumで描画してPNGに書き出す */
const { chromium } = require('playwright');
const path = require('path');

const svg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0b0d17"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <circle cx="256" cy="256" r="158" fill="none" stroke="#232f5c" stroke-width="20"/>
    <path d="M256 98 a158 158 0 0 1 136.8 79" fill="none" stroke="#ffffff"
          stroke-width="20" stroke-linecap="round"/>
    <circle cx="256" cy="150" r="46" fill="#ff4d6d"/>
    <circle cx="164" cy="309" r="46" fill="#4dabff"/>
    <circle cx="348" cy="309" r="46" fill="#ffd23f"/>
  </g>
</svg>`;

const page = (scale) => `<!DOCTYPE html><html><head><style>
html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:#0b0d17}
svg{display:block}</style></head><body>${svg(scale)}</body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = path.join(__dirname, 'site', 'icons');

  const shots = [
    { file: 'icon-512.png',          size: 512, scale: 1 },
    { file: 'icon-192.png',          size: 192, scale: 1 },
    { file: 'apple-touch-icon.png',  size: 180, scale: 1 },
    { file: 'icon-maskable-512.png', size: 512, scale: 0.62 },  // 端が切られても平気なよう内側に寄せる
    { file: 'favicon.png',           size: 64,  scale: 1 },
  ];

  for (const s of shots) {
    const ctx = await b.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: s.size / 512 });
    const p = await ctx.newPage();
    await p.setContent(page(s.scale));
    await p.screenshot({ path: path.join(out, s.file), omitBackground: false });
    await ctx.close();
    console.log('  ' + s.file + '  ' + s.size + 'x' + s.size);
  }
  await b.close();
  process.exit(0);
})();
