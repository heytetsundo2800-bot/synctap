/* 練習モードの当たり判定と同じ計算を Node 上で大量に回して、AIの強さを見積もる。
   ブラウザを立ち上げずに勝率・試合の長さを詰められる。 */
const VS = { HP: 1500, DMG_MAX: 300, DMG_PER_MS: 2.5, RAMP: 50, DEAD: 12, FAIL_ERR: 420 };
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 指示の割合は instructionOf(noSolo) と同じ：TAP 58% / SWIPE 28% / NO_TAP 14%
function insRoll() {
  const r = Math.random();
  return r < 0.58 ? 'tap' : r < 0.86 ? 'swipe' : 'none';
}

// 1ラウンドぶんの「誤差」を返す（失敗は FAIL_ERR）
function errOf(p, ins) {
  if (ins === 'none') return Math.random() < p.wrong ? VS.FAIL_ERR : 0;
  if (Math.random() < p.miss) return VS.FAIL_ERR;
  if (ins === 'swipe' && Math.random() < p.wrong) return VS.FAIL_ERR;
  const e = Math.abs(p.bias + gauss() * p.jitter);
  return Math.min(e, VS.FAIL_ERR);
}

function match(a, b) {
  let ha = VS.HP, hb = VS.HP;
  for (let r = 0; r < 400; r++) {
    const ins = insRoll();
    const ea = errOf(a, ins), eb = errOf(b, ins);
    if (!(ea >= VS.FAIL_ERR && eb >= VS.FAIL_ERR)) {
      const diff = Math.abs(ea - eb);
      if (diff > VS.DEAD) {
        const mul = 1 + Math.min(1, r / VS.RAMP);
        const dmg = clamp(Math.round(diff * VS.DMG_PER_MS * mul), 0, VS.DMG_MAX);
        if (ea < eb) hb -= dmg; else ha -= dmg;
      }
    }
    if (ha <= 0 || hb <= 0) return { win: ha > 0, rounds: r + 1, hp: [Math.max(0, ha), Math.max(0, hb)] };
  }
  return { win: ha > hb, rounds: 400, hp: [ha, hb] };
}

/* app.js の AI_LEVELS と同じ値にしておくこと */
const AI = {
  easy: { bias: 40, jitter: 128, miss: 0.15,  wrong: 0.18 },
  mid:  { bias: 18, jitter: 85,  miss: 0.06,  wrong: 0.08 },
  hard: { bias: 4,  jitter: 32,  miss: 0.012, wrong: 0.02 },
};
const HUMANS = {
  'はじめて ±110ms': { bias: 40, jitter: 110, miss: 0.10, wrong: 0.12 },
  'へたな人 ±90ms ': { bias: 25, jitter: 90,  miss: 0.05, wrong: 0.07 },
  'ふつう   ±45ms ': { bias: 10, jitter: 45,  miss: 0.02, wrong: 0.03 },
  'うまい   ±22ms ': { bias: 2,  jitter: 22,  miss: 0.005, wrong: 0.01 },
};
const N = +(process.env.N || 4000);

// 平均|誤差|の目安
console.log('AIの平均|誤差|（失敗込み）');
for (const [k, p] of Object.entries(AI)) {
  let s = 0; for (let i = 0; i < 20000; i++) s += errOf(p, insRoll());
  console.log('  ' + k.padEnd(5), Math.round(s / 20000) + 'ms');
}
console.log('\n人間 \\ AI          easy        mid         hard');
for (const [hn, hp] of Object.entries(HUMANS)) {
  const cells = Object.keys(AI).map(k => {
    let w = 0, rs = 0;
    for (let i = 0; i < N; i++) { const m = match(hp, AI[k]); if (m.win) w++; rs += m.rounds; }
    return (Math.round(w / N * 100) + '%').padStart(4) + ' (' + Math.round(rs / N) + 'R)';
  });
  console.log(hn, cells.map(c => c.padEnd(11)).join(' '));
}
