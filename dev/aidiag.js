/* 練習モードの中身を1試合ぶん解析する：ラウンドごとの誤差を人間とAIで比べる */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8080/?nohowto=1';
const wait = ms => new Promise(r => setTimeout(r, ms));

const AUTOPLAY = ({ bias, jitter }) => {
  const A = window.__SYNCTAP;
  const pad = document.querySelector('#play-root');
  window.__plan = [];
  let doneFor = -1, plan = null;
  const rnd = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
  const dispatch = (type, x, y) => pad.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', clientX: x, clientY: y }));
  const tick = () => {
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
          window.__plan.push({ r: cur, ins: plan.ins, act: plan.act,
            want: Math.round(plan.at - A.toLocal(g.startAtHost + g.at[cur])),
            real: Math.round(A.now() - A.toLocal(g.startAtHost + g.at[cur])) });
          if (plan.act === 'tap') dispatch('pointerdown', 200, 400);
          else if (plan.act === 'swipe') {
            dispatch('pointerdown', 200, 400);
            const d = { up: [0, -60], down: [0, 60], left: [-60, 0], right: [60, 0] }[plan.dir];
            dispatch('pointermove', 200 + d[0], 400 + d[1]);
            dispatch('pointerup', 200 + d[0], 400 + d[1]);
          }
          doneFor = cur; plan = null;
        }
        if (plan && plan.round !== cur) { doneFor = plan.round; plan = null; }
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('  [JS ERROR] ' + e.message));
  await pg.goto(BASE); await wait(600);

  const LV = process.env.LV || 'mid';
  const J = +(process.env.J || 45);
  await pg.click('#btn-practice'); await wait(200);
  await pg.click(`#ai-levels .prcard[data-lv="${LV}"]`);
  await pg.click('#btn-practice-start'); await wait(400);
  await pg.evaluate(AUTOPLAY, { bias: +(process.env.B || 10), jitter: J });

  // ゲーム中の inbox を保存しておく（終了時に消えないよう毎秒コピー）
  await pg.evaluate(() => {
    window.__snap = null;
    setInterval(() => { const g = window.__SYNCTAP.S.game; if (g) window.__snap = g; }, 300);
  });

  for (let t = 0; t < 200; t++) {
    if (await pg.evaluate(() => window.__SYNCTAP.S.screen === 'result')) break;
    await wait(700);
  }

  const out = await pg.evaluate(() => {
    const A = window.__SYNCTAP, g = window.__snap, S = A.S;
    const me = S.roster[0].id, ai = S.roster[1].id;
    const rows = [];
    for (let r = 0; r <= (S.lastResult.round || 0); r++) {
      const ins = A.insOf(g, r);
      const target = g.startAtHost + g.at[r];
      const pick = (id) => {
        let b = null;
        (g.inbox[r] || []).forEach(it => {
          if (it.id !== id) return;
          const d = it.t - target;
          if (!b || Math.abs(d) < Math.abs(b.d)) b = { d, act: it.act, dir: it.dir };
        });
        return b;
      };
      const f = (b) => b ? Math.round(b.d) : null;
      rows.push({ r, ins: ins.type, dir: ins.dir || '', me: f(pick(me)), ai: f(pick(ai)),
                  meAct: (pick(me) || {}).act, aiAct: (pick(ai) || {}).act,
                  meDir: (pick(me) || {}).dir, aiDir: (pick(ai) || {}).dir });
    }
    return { rows, res: S.lastResult, plan: window.__plan };
  });

  console.log('AIレベル:', LV, '/ 人間のばらつき: ±' + J + 'ms');
  console.log('R  指示        人間      AI');
  out.rows.forEach(x => {
    const s = (v, a, d) => v == null ? '  なし' : (String(v).padStart(5) + (a === 'swipe' ? ':' + d : ''));
    console.log(String(x.r).padStart(2), (x.ins + (x.dir ? '/' + x.dir : '')).padEnd(12),
      s(x.me, x.meAct, x.meDir).padEnd(10), s(x.ai, x.aiAct, x.aiDir));
  });
  const abs = a => a.filter(v => v != null).map(Math.abs);
  const avg = a => a.length ? Math.round(a.reduce((s, v) => s + v, 0) / a.length) : '-';
  console.log('\n人間: 平均|誤差|', avg(abs(out.rows.map(x => x.me))), 'ms  なし', out.rows.filter(x => x.me == null && x.ins !== 'NO_TAP').length, '回');
  console.log('AI  : 平均|誤差|', avg(abs(out.rows.map(x => x.ai))), 'ms  なし', out.rows.filter(x => x.ai == null && x.ins !== 'NO_TAP').length, '回');
  console.log('結果 winner team', out.res.winner, 'hp', JSON.stringify(out.res.hp), 'rounds', out.res.round);
  const late = out.plan.filter(p => p.real - p.want > 25);
  console.log('人間の入力が予定より25ms以上ずれた回数:', late.length, '/', out.plan.length,
    late.length ? ' 例: ' + JSON.stringify(late.slice(0, 5)) : '');
  await browser.close(); process.exit(0);
})();
