/* 練習モード（AIと1対1）の検証：3レベル × 人間の腕前を変えて勝率と試合の長さを見る */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8080/?nohowto=1';

const AUTOPLAY = ({ bias, jitter }) => {
  const A = window.__SYNCTAP;
  const pad = document.querySelector('#play-root');
  window.__log = [];
  // 前の試合の自動プレイを必ず止める（重なると1ラウンドに何度も押してしまう）
  window.__gen = (window.__gen || 0) + 1;
  const myGen = window.__gen;
  let doneFor = -1, plan = null;
  const rnd = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  const dispatch = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y }));

  const tick = () => {
    if (window.__gen !== myGen) return;
    const S = A.S, g = S.game;
    if (g && !g.over) {
      const rel = A.toHost(A.now()) - g.startAtHost;
      let cur = -1;
      for (let i = 0; i < 400; i++) { if (rel < g.at[i] + 380) { cur = i; break; } }
      if (cur >= 0) {
        if (cur !== doneFor && !plan) {
          const ins = A.insOf(g, cur);
          let act = null, dir = null;
          if (ins.type === 'ALL_TAP') act = 'tap';
          else if (ins.type === 'SWIPE') { act = 'swipe'; dir = ins.dir; }
          const at = A.toLocal(g.startAtHost + g.at[cur]) + bias + rnd() * jitter;
          plan = { round: cur, act, dir, at, ins: ins.type };
        }
        if (plan && plan.round === cur && A.now() >= plan.at) {
          if (plan.act === 'tap') dispatch('pointerdown', 200, 400);
          else if (plan.act === 'swipe') {
            dispatch('pointerdown', 200, 400);
            const d = { up: [0, -60], down: [0, 60], left: [-60, 0], right: [60, 0] }[plan.dir];
            dispatch('pointermove', 200 + d[0], 400 + d[1]);
            dispatch('pointerup', 200 + d[0], 400 + d[1]);
          }
          window.__log.push({ r: cur, ins: plan.ins });
          doneFor = cur; plan = null;
        }
        if (plan && plan.round !== cur) { doneFor = plan.round; plan = null; }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('  [JS ERROR] ' + e.message));
  pg.on('console', m => { if (m.type() === 'error') console.log('  [console] ' + m.text()); });
  await pg.goto(BASE);
  await wait(700);

  const HUMANS = [
    { tag: "へたな人 (±90ms)", bias: 25, jitter: 90 },
    { tag: 'ふつうの人(±45ms)', bias: 10, jitter: 45 },
    { tag: 'うまい人 (±22ms)', bias: 2,  jitter: 22 },
  ];
  const LEVELS = ['easy', 'mid', 'hard'];
  const RUNS = +(process.env.RUNS || 2);
  const SPEED = process.env.MODE === 'oni' ? 'oni' : 'normal';

  console.log('スピード:', SPEED, '/ 各組み合わせ', RUNS, '回\n');

  for (const h of HUMANS) {
    const line = [];
    for (const lv of LEVELS) {
      let wins = 0, rounds = [], hps = [];
      for (let k = 0; k < RUNS; k++) {
        await pg.click('#btn-practice'); await wait(200);
        await pg.click(`#ai-levels .prcard[data-lv="${lv}"]`);
        await pg.click(SPEED === 'oni' ? '#pr-speed-oni' : '#pr-speed-normal');
        await wait(120);
        await pg.click('#btn-practice-start');
        await wait(500);
        const started = await pg.evaluate(() => !!(window.__SYNCTAP.S.game));
        if (!started) { console.log('  !! ゲームが始まらない'); break; }
        await pg.evaluate(AUTOPLAY, h);

        let ok = false;
        for (let t = 0; t < 200; t++) {
          if (await pg.evaluate(() => window.__SYNCTAP.S.screen === 'result')) { ok = true; break; }
          await wait(700);
        }
        if (!ok) { console.log('  !! 終わらなかった'); break; }
        const r = await pg.evaluate(() => window.__SYNCTAP.S.lastResult);
        const meWon = r.winner === r.team[0];
        if (meWon) wins++;
        rounds.push(r.round); hps.push(r.hp[0] + '/' + r.hp[1]);
        if (k === 0 && lv === 'mid' && h.jitter === 45) {
          await pg.screenshot({ path: 'shot-practice-result.png' });
        }
        // 結果画面 →「もう一度」で練習画面へ
        await pg.click('#btn-again'); await wait(300);
        const sc = await pg.evaluate(() => window.__SYNCTAP.S.screen);
        if (sc !== 'practice') console.log('  !! もう一度 の行き先が', sc);
        await pg.click('#btn-practice-back'); await wait(200);
      }
      line.push(`${lv}: 勝${wins}/${RUNS} R=${rounds.join(',')} HP=${hps.join(' ')}`);
    }
    console.log(h.tag, '\n   ', line.join('\n    '));
  }

  // 画面まわりの確認
  await pg.click('#btn-practice'); await wait(250);
  await pg.screenshot({ path: 'shot-practice.png' });
  console.log('\n選択中のレベル:', await pg.evaluate(() => window.__SYNCTAP.S.aiLevel));
  await pg.click('#btn-practice-back'); await wait(200);
  console.log('もどる →', await pg.evaluate(() => window.__SYNCTAP.S.screen));

  await browser.close();
  process.exit(0);
})();
