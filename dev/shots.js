/* 画面の見た目を確認するためのスクリーンショット */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8080/?b=ws://localhost:9001';
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const c = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, deviceScaleFactor: 2 });
  const p = await c.newPage();
  p.on('pageerror', e => console.log('[JS ERROR]', e.message));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  await p.goto(BASE); await wait(2500);
  await p.screenshot({ path: 'shot-title.png' });

  await p.fill('#in-name', 'てつじん');
  await p.click('#btn-create'); await wait(800);
  await p.click('#mode-oni'); await wait(400);
  await p.screenshot({ path: 'shot-lobby.png' });
  await p.click('#mode-normal'); await wait(200);

  await p.click('#btn-start'); await wait(4200);
  // 演出を出した瞬間を撮る
  await p.evaluate(() => {
    const A = window.__SYNCTAP;
    const g = A.S.game;
    g.combo = 12; g.score = 24800;
    document.querySelector('#combo').classList.remove('hidden');
    document.querySelector('#combo-n').textContent = '12';
    document.querySelector('#play-root').classList.add('fever');
  });
  await p.evaluate(() => { window.dispatchEvent(new Event('resize')); });
  await p.evaluate(() => {
    const el = document.querySelector('#play-root');
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 195, clientY: 620, pointerId: 1 }));
  });
  await wait(120);
  await p.screenshot({ path: 'shot-play-hit.png' });
  await wait(700);
  await p.screenshot({ path: 'shot-play.png' });

  // 結果画面
  await p.evaluate(() => {
    const A = window.__SYNCTAP, S = A.S;
    const roster = S.roster.length ? S.roster : [{id:'a',name:'てつじん',idx:0}];
    window.__forceEnd = true;
    const ev = { type:'gameover', round: 47, score: 51850, maxCombo: 23, speed: 115, mode:'oni',
      acc: { [roster[0].id]: 31 }, roster };
    // endGame は内部関数なので ctrl 経由で叩く
    S.game.lives = 0;
    (function(){ const fn = Object.getOwnPropertyNames(window); })();
    window.__ev = ev;
  });
  await p.evaluate(() => {
    // gameover をハンドラ経由で流し込む
    const S = window.__SYNCTAP.S;
    const t = 'synctap/v1/' + S.code + '/ctrl';
    S.client.publish(t, JSON.stringify(window.__ev), { qos: 0 });
  });
  await wait(1400);
  await p.screenshot({ path: 'shot-result.png' });

  await b.close(); process.exit(0);
})();
