/* アイコン生成：Chromiumで描画してPNGに書き出す */
const { chromium } = require('playwright');
const path = require('path');

const svg = (scale) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="78%">
      <stop offset="0%" stop-color="#1b2350"/>
      <stop offset="58%" stop-color="#0a0d1f"/>
      <stop offset="100%" stop-color="#05060f"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#7cc4ff"/>
    </linearGradient>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="16" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
  </defs>

  <rect width="512" height="512" fill="url(#bg)"/>

  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <!-- 光のにじみ -->
    <g filter="url(#soft)" opacity=".55">
      <circle cx="256" cy="150" r="42" fill="#ff3d6b"/>
      <circle cx="164" cy="309" r="42" fill="#4dabff"/>
      <circle cx="348" cy="309" r="42" fill="#ffd23f"/>
    </g>

    <circle cx="256" cy="256" r="158" fill="none" stroke="#26305e" stroke-width="18"/>
    <path d="M256 98 a158 158 0 0 1 136.8 79" fill="none" stroke="url(#arc)"
          stroke-width="20" stroke-linecap="round" filter="url(#glow)"/>

    <circle cx="256" cy="150" r="45" fill="#ff3d6b"/>
    <circle cx="164" cy="309" r="45" fill="#4dabff"/>
    <circle cx="348" cy="309" r="45" fill="#ffd23f"/>

    <circle cx="243" cy="138" r="14" fill="#ffffff" opacity=".38"/>
    <circle cx="151" cy="297" r="14" fill="#ffffff" opacity=".38"/>
    <circle cx="335" cy="297" r="14" fill="#ffffff" opacity=".38"/>
  </g>
</svg>`;

const page = (scale) => `<!DOCTYPE html><html><head><style>
html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:#05060f}
svg{display:block}</style></head><body>${svg(scale)}</body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const out = path.join(__dirname, '..', 'icons');
  const shots = [
    { file: 'icon-512.png',          size: 512, scale: 1 },
    { file: 'icon-192.png',          size: 192, scale: 1 },
    { file: 'apple-touch-icon.png',  size: 180, scale: 1 },
    { file: 'icon-maskable-512.png', size: 512, scale: 0.62 },
    { file: 'favicon.png',           size: 64,  scale: 1 },
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
