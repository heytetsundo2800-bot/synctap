/* 3端末を同時に立ち上げて実際にプレイさせる検証 */
const { chromium } = require('playwright');

const BASE = (process.env.DIST ? 'http://localhost:8080/dist/index.html' : 'http://localhost:8080/') + '?b=ws://localhost:9001' + (process.env.LAG ? '&lag=' + process.env.LAG : '');
const N = Math.max(1, Math.min(10, +(process.env.PLAYERS || 3)));
const NAMES = Array.from({length: N}, (_, i) => i === 0 ? 'てつじん' : 'なかま' + i);

// 端末ごとの「腕前」：目標時刻からのズレ(ms) の平均と ばらつき
const J = +(process.env.J || 1);   // 1=上手い3人 / 2=ふつうの3人
const SKILL = Array.from({ length: N }, (_, i) => ({
  bias: [5, -20, 30, -8, 18, -30, 42, 0, -14, 26][i % 10],
  jitter: [35, 45, 60, 40, 52, 38, 70, 48, 55, 44][i % 10] * J,
}));

const AUTOPLAY = ({ bias, jitter }) => {
  const A = window.__SYNCTAP;
  const pad = document.querySelector('#play-root');
  window.__log = [];
  let doneFor = -1;

  const rnd = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2; // ざっくり正規分布
  let plan = null;

  const dispatch = (type, x, y) => {
    pad.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      clientX: x, clientY: y,
    }));
  };

  const tick = () => {
    const S = A.S, g = S.game;
    if (g && !g.over) {
      const rel = A.toHost(A.now()) - g.startAtHost;
      let cur = -1;
      for (let i = 0; i < 400; i++) { if (rel < g.at[i] + 380) { cur = i; break; } }
      if (cur >= 0) {
        if (cur !== doneFor && !plan) {
          const ins = A.insOf(g, cur);
          const myIdx = Math.max(0, S.me.idx);
          let act = null, dir = null;
          if (ins.type === 'ALL_TAP') act = 'tap';
          else if (ins.type === 'SWIPE') { act = 'swipe'; dir = ins.dir; }
          else if (ins.type === 'SOLO_TAP' && ins.who === myIdx) act = 'tap';
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
          window.__log.push({ r: cur, ins: plan.ins, act: plan.act });
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
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const pages = [];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => console.log('  [JS ERROR p' + i + '] ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') console.log('  [console p' + i + '] ' + m.text()); });
    await pg.goto(BASE);
    pages.push(pg);
  }

  const wait = ms => new Promise(r => setTimeout(r, ms));

  // ホストがルーム作成
  await pages[0].fill('#in-name', NAMES[0]);
  await wait(1200);
  await pages[0].click('#btn-create');
  await wait(600);
  const code = await pages[0].textContent('#lobby-code');
  console.log('players =', N, '/ room code =', code);

  // 残り2人が参加
  for (let i = 1; i < N; i++) {
    await pages[i].fill('#in-name', NAMES[i]);
    await pages[i].fill('#in-code', code);
    await pages[i].click('#btn-join');
    await wait(400);
  }

  // 同期が安定するまで待つ
  await wait(4000);
  for (let i = 0; i < N; i++) {
    const q = await pages[i].textContent('#sync-q');
    const st = await pages[i].evaluate(() => {
      const S = window.__SYNCTAP.S;
      return { rtt: S.bestRtt, offset: Math.round(S.offset * 100) / 100, synced: S.synced, host: S.isHost, idx: S.me.idx };
    });
    console.log(`p${i} sync: ${q}  | rtt=${isFinite(st.rtt) ? st.rtt.toFixed(1) : '-'}ms offset=${st.offset}ms idx=${st.idx}`);
  }

  await pages[0].screenshot({ path: 'shot-lobby.png' });

  // モード選択（PLAY=versus で対戦、MODE=oni で鬼スピード）
  if (process.env.PLAY === 'versus') await pages[0].click('#play-versus');
  if (process.env.MODE === 'oni') await pages[0].click('#speed-oni');
  await wait(300);
  console.log('mode =', await pages[0].evaluate(() => {
    const S = window.__SYNCTAP.S; return S.play + ' / ' + S.speed;
  }));

  // 自動プレイを仕込む
  for (let i = 0; i < N; i++) await pages[i].evaluate(AUTOPLAY, SKILL[i]);

  // 開始
  const startBtn = await pages[0].isEnabled('#btn-start');
  console.log('start button enabled =', startBtn);
  await pages[0].click('#btn-start');

  // プレイ中の様子
  await wait(5000);
  await pages[0].screenshot({ path: 'shot-play.png' });
  if (pages[1]) await pages[1].screenshot({ path: 'shot-play2.png' });

  // 終了まで待つ
  for (let t = 0; t < 170; t++) {
    const over = await pages[0].evaluate(() => window.__SYNCTAP.S.screen === 'result');
    if (over) break;
    await wait(1000);
  }

  const res = await pages[0].evaluate(() => {
    const S = window.__SYNCTAP.S;
    return { screen: S.screen, r: S.lastResult };
  });
  console.log('\n--- RESULT ---');
  console.log('screen:', res.screen);
  if (res.r && res.r.vs) {
    console.log('VERSUS  winner team:', res.r.winner, 'rounds:', res.r.round, 'speed:', res.r.speed);
    console.log('team :', JSON.stringify(res.r.team));
    console.log('hp   :', JSON.stringify(res.r.hp));
    console.log('dealt:', JSON.stringify(res.r.dealt));
    console.log('taken:', JSON.stringify(res.r.taken));
  } else if (res.r) {
    console.log('rounds:', res.r.round, 'score:', res.r.score, 'maxCombo:', res.r.maxCombo, 'speed:', res.r.speed);
    console.log('stats  :', JSON.stringify(res.r.stats));
  }
  for (let i = 0; i < N; i++) {
    const log = await pages[i].evaluate(() => window.__log.length);
    console.log(`p${i} actions fired: ${log}`);
  }
  // 成績表・MVP・辛口コメントが出ているか
  const board = await pages[0].evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#r-acc .sbrow')).map(r => ({
      name: r.querySelector('.sbname').textContent.trim(),
      p: r.querySelector('.np').textContent,
      g: r.querySelector('.ng').textContent,
      m: r.querySelector('.nm').textContent,
      mvp: r.classList.contains('is-mvp'), worst: r.classList.contains('is-worst'),
    })),
    mvp: document.querySelector('#r-mvp').textContent,
    roast: document.querySelector('#r-roast').textContent,
  }));
  console.log('\n--- 成績表 ---');
  board.rows.forEach(r => console.log(`  ${r.mvp ? 'MVP ' : r.worst ? 'WST ' : '    '}${r.name}  P:${r.p} G:${r.g} M:${r.m}`));
  console.log('MVP  :', board.mvp);
  console.log('ROAST:', board.roast);
  await pages[0].screenshot({ path: 'shot-result.png' });

  // --- 2回戦が成立するか ---
  console.log('\n--- 2回戦 ---');
  await pages[0].click('#btn-again');
  await wait(1500);
  console.log('host screen after 再戦:', await pages[0].evaluate(() => window.__SYNCTAP.S.screen));
  console.log('start enabled:', await pages[0].isEnabled('#btn-start'));
  await pages[0].click('#btn-start');
  await wait(6000);
  for (let i = 0; i < N; i++) {
    const st = await pages[i].evaluate(() => {
      const S = window.__SYNCTAP.S;
      return { screen: S.screen, round: S.game ? S.game.round : null, lives: S.game ? S.game.lives : null };
    });
    console.log(`p${i}: screen=${st.screen} round=${st.round} lives=${st.lives}`);
  }

  await browser.close();
  process.exit(0);
})();
