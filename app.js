/* =========================================================
   せーの!!  /  SE-NO
   1〜10人・各自スマホ・リアルタイム同期タップゲーム
   ========================================================= */

/* ---------- 定数 ---------- */
const VERSION = 'v1.0';
const BUILD   = '2026-07-31 05:00';   // 更新したらここも変える（タイトル画面下に出る）
const BROKERS = [
  { label: 'A',  url: 'wss://broker.emqx.io:8084/mqtt' },
  { label: 'B',  url: 'wss://broker.hivemq.com:8884/mqtt' },
  { label: 'C',  url: 'wss://test.mosquitto.org:8081/mqtt' },
];
const COLORS = [
  { name: 'レッド',    hex: '#ff3d6b' },
  { name: 'ブルー',    hex: '#4dabff' },
  { name: 'イエロー',  hex: '#ffd23f' },
  { name: 'グリーン',  hex: '#39d98a' },
  { name: 'パープル',  hex: '#b04dff' },
  { name: 'オレンジ',  hex: '#ff8a3d' },
  { name: 'シアン',    hex: '#2ee6d6' },
  { name: 'マゼンタ',  hex: '#ff5edb' },
  { name: 'ライム',    hex: '#a3e635' },
  { name: 'ラベンダー', hex: '#8b9dff' },
];
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 1;   // 動作確認用に1人でも開始できる

/* あそびかた */
const PLAYS = {
  coop:   { key: 'coop',   name: '協力', label: 'CO-OP'  },
  versus: { key: 'versus', name: '対戦', label: 'VERSUS' },
};
/* スピード：lv0 が大きいほど最初から速く・判定も厳しい */
const SPEEDS = {
  normal: { key: 'normal', name: 'ふつう', label: 'NORMAL', lv0: 0,  tutorial: 3, lives: 5 },
  oni:    { key: 'oni',    name: '鬼',     label: 'ONI',    lv0: 22, tutorial: 0, lives: 3 },
};
/* 対戦のパラメータ（ここをいじれば手ざわりが変わる） */
const VS = {
  HP: 1500,          // 全員このHPから始まる
  DMG_MAX: 300,      // 1回のダメージ上限
  DMG_PER_MS: 2.5,   // 誤差1msの差につき何ダメージか（120msの差で上限に届く）
  RAMP: 50,          // このラウンド数で威力が2倍になる（試合が延びすぎないように）
  DEAD: 12,          // この差以下は互角（ダメージなし）
  FAIL_ERR: 420,     // ミスした人の誤差はこの値として扱う
};

/* 練習モード（AIと1対1）のAIの腕前
   bias  : 平均してどれだけ遅れて押すか(ms)
   jitter: 押すタイミングのばらつき(ms・標準偏差)
   miss  : 押し忘れる確率
   wrong : 方向を間違える／「さわるな」で触ってしまう確率 */
const AI_ID = 'ai_practice';
const AI_LEVELS = {
  // 平均|誤差| … よわい≈158ms / ふつう≈90ms / つよい≈30ms（dev/aibalance.js で調整）
  easy: { key: 'easy', name: 'よわい', label: 'LV.1', bias: 40, jitter: 128, miss: 0.15,  wrong: 0.18 },
  mid:  { key: 'mid',  name: 'ふつう', label: 'LV.2', bias: 18, jitter: 85,  miss: 0.06,  wrong: 0.08 },
  hard: { key: 'hard', name: 'つよい', label: 'LV.3', bias: 4,  jitter: 32,  miss: 0.012, wrong: 0.02 },
};

const WIN_BASE    = 200;  // 成功と認める最大ズレ(ms)：テンポが速くなるほど狭くなる
// 判定の広さは「そのときの間隔」で決める（速さと難しさが必ず釣り合うように）
// 人数が増えるほど「全員そろう」難易度が跳ね上がるので、その分だけ判定を広げる
const WIN_OF      = (lv, n) => Math.round(
  clamp(74 + 0.063 * intervalOf(lv), 85, WIN_BASE) * (1 + 0.045 * Math.max(0, (n || 3) - 3))
);
const GUARD_PRE   = 700;  // 「さわるな」系の禁止区間 開始(ms前)
const GUARD_POST  = 300;  // 同 終了(ms後)
const JUDGE_DELAY = 380;  // ラウンド判定を確定させるまでの猶予(ms)
const LEAD_IN     = 2600; // スタート合図から第1ラウンドまで
const MAX_ROUNDS  = 400;

/* ---------- 汎用 ---------- */
const now = () => performance.timeOrigin + performance.now();
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/* localStorage はプライベートブラウズや設定によっては触るだけで例外になる。
   そこで落ちると起動そのものが止まるので、必ずこの2つ経由で読み書きする。 */
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const rand = (a, b) => a + Math.random() * (b - a);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFor = (seed, i) => mulberry32((seed ^ Math.imul(i + 1, 2654435761)) >>> 0);
function uid(n = 8) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = ''; for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0];
  return s;
}
function roomCode() {
  let s = ''; for (let i = 0; i < 4; i++) s += ((Math.random() * 10) | 0);
  return s;
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------- ラウンド設計 ---------- */
/* だんだん速くなるカーブ。
   等差（毎回 -35ms）だと、序盤はテンポがほとんど変わらないのに
   終盤で一気に速く感じる（体感の速さは間隔の逆数なので）。
   そこで等比＝毎ラウンド一定の「割合」で縮める。
   これだと最初のラウンドからじわじわ速くなり、加速の体感が最後まで一定になる。 */
const IV_START = 2000;   // 1ラウンド目の間隔(ms)
const IV_MIN   = 520;    // これ以上は速くならない（約42ラウンド目で到達）
const IV_DECAY = 0.968;  // 毎ラウンド 3.2% ずつ短くなる
const intervalOf = (lv) => Math.max(IV_MIN, Math.round(IV_START * Math.pow(IV_DECAY, lv)));
const SPEED_OF   = (lv) => Math.round(60000 / intervalOf(lv));

const DIRS = [
  { key: 'up',    label: '↑', jp: '上' },
  { key: 'down',  label: '↓', jp: '下' },
  { key: 'left',  label: '←', jp: '左' },
  { key: 'right', label: '→', jp: '右' },
];

// 指示は seed とラウンド番号だけで決まる ＝ 通信なしで全端末が一致する
function instructionOf(seed, i, nPlayers, tutorial, noSolo) {
  if (i < (tutorial || 0)) return { type: 'ALL_TAP' };
  const r = rngFor(seed, i);
  const roll = r();
  if (noSolo) {
    // 対戦では全員が同じ動きをして初めて比べられるので「あなただけ」は出さない
    if (roll < 0.58) return { type: 'ALL_TAP' };
    if (roll < 0.86) return { type: 'SWIPE', dir: DIRS[Math.floor(r() * 4)].key };
    return { type: 'NO_TAP' };
  }
  if (roll < 0.40) return { type: 'ALL_TAP' };
  if (roll < 0.65) return { type: 'SOLO_TAP', who: Math.floor(r() * nPlayers) };
  if (roll < 0.85) return { type: 'SWIPE', dir: DIRS[Math.floor(r() * 4)].key };
  return { type: 'NO_TAP' };
}
const insOf = (g, i) => instructionOf(g.seed, i, g.n, g.SP.tutorial, g.play === 'versus');
const needsSwipe = (ins) => ins.type === 'SWIPE';

/* ---------- 状態 ---------- */
const S = {
  screen: 'title',
  brokerIdx: 0,
  client: null,
  connected: false,
  code: null,
  isHost: false,
  play: 'coop',
  speed: 'normal',
  me: { id: 'st_' + uid(), name: '', idx: -1 },
  roster: [],
  presence: new Map(),
  offset: 0,             // hostClock = localClock + offset
  bestRtt: Infinity,
  samples: [],
  syncErr: null,
  syncCount: 0,
  synced: false,
  game: null,
  lastResult: null,
  practice: false,       // AIと1対1の練習中か
  aiLevel: 'mid',
  prSpeed: 'normal',
  audio: null,
  audioEpoch: 0,
  wakeLock: null,
  touch: { x: 0, y: 0 },
};

const toHost  = (localT) => localT + S.offset;
const toLocal = (hostT)  => hostT - S.offset;
const inGame  = () => !!S.game && !S.game.over;

/* =========================================================
   エフェクト（パーティクル）
   ========================================================= */
const FX = { cv: null, ctx: null, p: [], r: [], raf: 0, last: 0, w: 0, h: 0 };

function fxInit() {
  FX.cv = $('#fx');
  if (!FX.cv) return;
  FX.ctx = FX.cv.getContext('2d');
  fxResize();
  window.addEventListener('resize', fxResize);
}
function fxResize() {
  if (!FX.cv) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  FX.w = window.innerWidth; FX.h = window.innerHeight;
  FX.cv.width = FX.w * dpr; FX.cv.height = FX.h * dpr;
  FX.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function fxRun() {
  if (FX.raf) return;
  FX.last = now();
  const step = () => {
    const t = now();
    const dt = Math.min(0.05, (t - FX.last) / 1000);
    FX.last = t;
    fxTick(dt);
    if (FX.p.length || FX.r.length) FX.raf = requestAnimationFrame(step);
    else { FX.raf = 0; FX.ctx.clearRect(0, 0, FX.w, FX.h); }
  };
  FX.raf = requestAnimationFrame(step);
}
function fxTick(dt) {
  const c = FX.ctx;
  c.clearRect(0, 0, FX.w, FX.h);

  // リング（衝撃波）
  for (let i = FX.r.length - 1; i >= 0; i--) {
    const o = FX.r[i];
    o.t += dt;
    if (o.t < o.delay) continue;
    const k = (o.t - o.delay) / o.dur;
    if (k >= 1) { FX.r.splice(i, 1); continue; }
    const e = 1 - Math.pow(1 - k, 3);
    c.globalAlpha = (1 - k) * o.a;
    c.strokeStyle = o.color;
    c.lineWidth = o.w * (1 - k) + 0.6;
    c.beginPath();
    c.arc(o.x, o.y, 10 + o.max * e, 0, Math.PI * 2);
    c.stroke();
  }

  // 粒
  for (let i = FX.p.length - 1; i >= 0; i--) {
    const o = FX.p[i];
    o.life -= dt;
    if (o.life <= 0) { FX.p.splice(i, 1); continue; }
    o.vy += o.g * dt;
    o.vx *= o.drag; o.vy *= o.drag;
    o.x += o.vx * dt; o.y += o.vy * dt;
    o.rot += o.vr * dt;

    const a = clamp(o.life / o.max, 0, 1);
    c.globalAlpha = a;
    c.fillStyle = o.color; c.strokeStyle = o.color;

    if (o.shape === 'spark') {
      c.lineWidth = o.size;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(o.x, o.y);
      c.lineTo(o.x - o.vx * 0.022, o.y - o.vy * 0.022);
      c.stroke();
    } else if (o.shape === 'conf') {
      c.save(); c.translate(o.x, o.y); c.rotate(o.rot);
      c.fillRect(-o.size, -o.size * 0.55, o.size * 2, o.size * 1.1);
      c.restore();
    } else if (o.shape === 'star') {
      c.save(); c.translate(o.x, o.y); c.rotate(o.rot);
      c.lineWidth = o.size * 0.5; c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-o.size * 2.4, 0); c.lineTo(o.size * 2.4, 0);
      c.moveTo(0, -o.size * 2.4); c.lineTo(0, o.size * 2.4);
      c.stroke();
      c.restore();
    } else {
      c.beginPath(); c.arc(o.x, o.y, o.size, 0, Math.PI * 2); c.fill();
    }
  }
  c.globalAlpha = 1;
}

function fxBurst(x, y, o) {
  if (!FX.ctx) return;
  const n = Math.min(o.n || 24, 400 - FX.p.length);
  for (let i = 0; i < n; i++) {
    const ang = o.ang != null ? o.ang + rand(-o.spread, o.spread) : rand(0, Math.PI * 2);
    const sp = rand(o.speed[0], o.speed[1]);
    const life = rand(o.life[0], o.life[1]);
    FX.p.push({
      x, y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      g: o.g == null ? 700 : o.g,
      drag: o.drag == null ? 0.985 : o.drag,
      life, max: life,
      size: rand(o.size[0], o.size[1]),
      color: o.colors[(Math.random() * o.colors.length) | 0],
      shape: o.shapes[(Math.random() * o.shapes.length) | 0],
      rot: rand(0, 6.28), vr: rand(-9, 9),
    });
  }
  fxRun();
}
function fxRing(x, y, color, max, w, dur, delay, a) {
  if (!FX.ctx) return;
  FX.r.push({ x, y, color, max, w: w || 8, dur: dur || 0.6, delay: delay || 0, t: 0, a: a == null ? 1 : a });
  fxRun();
}

/* アイコン（マゼンタ×蛍光イエロー）に合わせた粒の色 */
const PAL = {
  perfect: ['#f4ff2b', '#ffe14d', '#fff9b0', '#ff1f7a', '#ffffff'],
  good:    ['#2bff9e', '#7cffc4', '#ffffff'],
  ok:      ['#ffffff', '#ffd7e7', '#ff8fb4'],
  bad:     ['#ff2d55', '#ff7a99', '#7a0f26'],
};

/* =========================================================
   通信
   ========================================================= */
function topicBase() { return 'synctap/' + VERSION + '/' + S.code; }

function connectBroker(idx, onReady, onFail) {
  if (S.client) { try { S.client.end(true); } catch (e) {} S.client = null; }
  S.brokerIdx = idx;
  S.connected = false;
  setNetStatus('接続中… (' + BROKERS[idx].label + ')', 'wait');

  const c = mqtt.connect(BROKERS[idx].url, {
    clientId: S.me.id + '_' + uid(4),
    clean: true, connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30,
  });
  S.client = c;

  let settled = false;
  const timer = setTimeout(() => { if (!settled) { settled = true; onFail && onFail(); } }, 9000);

  c.on('connect', () => {
    S.connected = true;
    setNetStatus('接続OK (' + BROKERS[idx].label + ')', 'ok');
    if (S.code) { try { subRoom(); } catch (e) {} }
    if (!settled) { settled = true; clearTimeout(timer); onReady && onReady(); }
  });
  c.on('close', () => { S.connected = false; setNetStatus('切断 (' + BROKERS[idx].label + ')', 'ng'); });
  c.on('error', () => { S.connected = false; setNetStatus('エラー (' + BROKERS[idx].label + ')', 'ng'); });
  c.on('message', (topic, payload) => {
    let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
    handleMessage(topic.slice(topicBase().length + 1), msg);
  });
}

let LAG = 0;   // 検証用の人工遅延(ms)。?lag=300 のように指定する
function pub(suffix, obj) {
  if (!S.client || !S.connected || !S.code) return;
  const send = () => { try { S.client.publish(topicBase() + '/' + suffix, JSON.stringify(obj), { qos: 0 }); } catch (e) {} };
  if (LAG > 0) setTimeout(send, LAG / 2 + Math.random() * LAG * 0.15);
  else send();
}
function subRoom() { S.client.subscribe(topicBase() + '/#', { qos: 0 }); }

function handleMessage(suffix, m) {
  switch (suffix) {
    case 'presence': onPresence(m); break;
    case 'sync/req': onSyncReq(m);  break;
    case 'sync/res': onSyncRes(m);  break;
    case 'ctrl':     onCtrl(m);     break;
    case 'input':    onInput(m);    break;
  }
}

/* ---------- presence / roster ---------- */
function startHeartbeat() {
  setInterval(() => {
    if (!S.connected || !S.code) return;
    pub('presence', {
      id: S.me.id, name: S.me.name, host: S.isHost,
      synced: S.synced, rtt: isFinite(S.bestRtt) ? Math.round(S.bestRtt) : null,
      err: S.syncErr == null ? null : Math.round(S.syncErr), ns: S.samples.length,
      playing: inGame(),
    });
  }, 900);
}

function onPresence(m) {
  if (m.id === S.me.id) return;
  S.presence.set(m.id, { t: now(), name: m.name, synced: m.synced, rtt: m.rtt,
                         err: m.err, ns: m.ns, host: m.host });
  if (S.isHost && !inGame()) {
    if (!S.roster.find(p => p.id === m.id) && S.roster.length < MAX_PLAYERS) {
      S.roster.push({ id: m.id, name: m.name || 'プレイヤー', idx: S.roster.length });
      broadcastRoster();
    }
  }
  if (S.screen === 'lobby') renderLobby();
}

function broadcastRoster() { pub('ctrl', { type: 'roster', roster: S.roster }); }

function pruneRoster() {
  if (!S.isHost || inGame() || !S.code) return;   // 練習中(code なし)は誰も外さない
  const before = S.roster.length;
  S.roster = S.roster.filter(p => {
    if (p.id === S.me.id) return true;
    const pr = S.presence.get(p.id);
    return pr && (now() - pr.t) < 5000;
  });
  S.roster.forEach((p, i) => p.idx = i);
  if (S.roster.length !== before) { broadcastRoster(); renderLobby(); }
}

/* =========================================================
   時計同期

   公開ブローカーを経由するぶん、往復（RTT）は数百msになることがある。
   ただし「往復が遅い＝ズレが大きい」ではない。行きと帰りが同じくらいなら、
   往復が400msでもズレの推定は十分に正確になる。
   なので RTT では判断せず、良いサンプルを何本も取って
   「推定値どうしのばらつき」を精度の指標にする。
   ========================================================= */
const SYNC_MIN_SAMPLES = 10;   // これだけ集まれば開始できる
const SYNC_KEEP        = 40;   // 保持するサンプル数
const SYNC_USE         = 7;    // 推定に使う「速かった順」の本数

function startSyncLoop() {
  setInterval(() => {
    if (!S.connected || !S.code || S.isHost) return;
    if (document.hidden || inGame()) return;   // 裏に回っている間の計測は当てにならない
    if (S.syncCount > 5000) return;
    S.syncCount++;
    pub('sync/req', { id: S.me.id, t0: now() });
  }, 140);
}

function resetSync() {
  if (S.isHost || inGame()) return;
  S.samples = []; S.bestRtt = Infinity; S.offset = 0;
  S.syncErr = null; S.synced = false; S.syncCount = 0;
  if (S.screen === 'lobby') renderLobby();
}

function onSyncReq(m) {
  if (!S.isHost) return;
  pub('sync/res', { id: m.id, t0: m.t0, t1: now() });
}

function onSyncRes(m) {
  if (m.id !== S.me.id) return;
  const t2 = now();
  const rtt = t2 - m.t0;
  if (!(rtt >= 0) || rtt > 5000) return;
  const offset = m.t1 - (m.t0 + t2) / 2;

  S.samples.push({ rtt, offset });
  // 速かった順に並べ、上位だけ残す（遅いサンプルは行き帰りが偏りやすい）
  S.samples.sort((a, b) => a.rtt - b.rtt);
  if (S.samples.length > SYNC_KEEP) S.samples.length = SYNC_KEEP;

  const use = S.samples.slice(0, Math.min(SYNC_USE, S.samples.length));
  const offs = use.map(o => o.offset).sort((a, b) => a - b);
  S.offset  = offs[(offs.length / 2) | 0];               // 中央値：外れ値に強い
  S.bestRtt = use[0].rtt;
  // ばらつき（推定のブレ幅）を精度の目安にする
  S.syncErr = offs.length >= 3 ? (offs[offs.length - 1] - offs[0]) / 2 : null;
  S.synced  = S.samples.length >= SYNC_MIN_SAMPLES;

  if (S.screen === 'lobby') renderLobby();
}

function syncQuality() {
  if (S.isHost) return { label: '基準端末', cls: 'ok', ready: true };
  const n = S.samples.length;
  if (n < 3) return { label: '計測中… (' + n + '/' + SYNC_MIN_SAMPLES + ')', cls: 'wait', ready: false };
  const e = S.syncErr == null ? null : Math.round(S.syncErr);
  const ready = n >= SYNC_MIN_SAMPLES;
  const tail = ready ? '' : '（計測中 ' + n + '/' + SYNC_MIN_SAMPLES + '）';
  if (e == null)  return { label: '計測中…' + tail, cls: 'wait', ready };
  if (e <= 15) return { label: '±' + e + 'ms／とても正確' + tail, cls: 'ok', ready };
  if (e <= 40) return { label: '±' + e + 'ms／問題なし' + tail, cls: 'ok', ready };
  if (e <= 90) return { label: '±' + e + 'ms／遊べます' + tail, cls: 'warn', ready };
  return { label: '±' + e + 'ms／ブレ大きめ' + tail, cls: 'ng', ready };
}

/* =========================================================
   音・振動
   ========================================================= */
function initAudio() {
  if (S.audio) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  S.audio = new Ctx();
  if (S.audio.state === 'suspended') S.audio.resume();
  calibrateAudio();
}
function calibrateAudio() { if (S.audio) S.audioEpoch = now() - S.audio.currentTime * 1000; }

function tone(atLocal, freq, dur, type, vol) {
  if (!S.audio) return;
  const when = (atLocal - S.audioEpoch) / 1000;
  if (when < S.audio.currentTime - 0.05) return;
  const o = S.audio.createOscillator(), g = S.audio.createGain();
  o.type = type || 'square';
  o.frequency.setValueAtTime(freq, when);
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(vol || 0.2, when + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, when + (dur || 0.1));
  o.connect(g); g.connect(S.audio.destination);
  o.start(when); o.stop(when + (dur || 0.1) + 0.05);
}
const beat   = (t, accent) => tone(t, accent ? 1320 : 660, 0.08, 'square', 0.16);
function chord(base, steps, gap, type, vol) {
  const t = now();
  steps.forEach((s, i) => tone(t + i * gap, base * Math.pow(2, s / 12), 0.22, type || 'triangle', vol || 0.2));
}
const sndPerfect = () => chord(660, [0, 4, 7, 12, 16], 42, 'triangle', 0.24);
const sndGood    = () => chord(587, [0, 7], 50, 'triangle', 0.2);
const sndOk      = () => chord(494, [0], 0, 'sine', 0.18);
const sndBad     = () => { const t = now(); tone(t, 190, 0.22, 'sawtooth', 0.22); tone(t + 70, 120, 0.3, 'sawtooth', 0.2); };
const sndFever   = () => chord(523, [0, 4, 7, 12, 19, 24], 38, 'square', 0.18);

function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) {}
}

/* =========================================================
   BGM

   ・画面に応じて自動で切り替える（タイトル／プレイ／鬼／勝ち／負け）
   ・合図のクリック音とぶつからないよう、プレイ中だけ音量を下げる
   ・スマホは操作しないと音を鳴らせないので、最初のタップで解除する
   ・入切は端末に記憶する
   ========================================================= */
const BGM_KEY = 'st_bgm';
const BGM = {
  tracks: {
    title: { src: './bgm/title.mp3', vol: 0.50 },   // タイトル・ロビー・練習の設定
    play:  { src: './bgm/play.mp3',  vol: 0.34 },   // プレイ中（ふつう）
    oni:   { src: './bgm/oni.mp3',   vol: 0.34 },   // プレイ中（鬼）
    win:   { src: './bgm/win.mp3',   vol: 0.46 },   // 結果・勝ち
    lose:  { src: './bgm/lose.mp3',  vol: 0.46 },   // 結果・負け
  },
  el: {}, want: null, playing: null, on: true, unlocked: false, timers: {},
};

function bgmEl(key) {
  if (BGM.el[key]) return BGM.el[key];
  const a = new Audio(BGM.tracks[key].src);
  a.loop = true; a.preload = 'none'; a.volume = 0;
  a.addEventListener('error', () => {});
  BGM.el[key] = a;
  return a;
}
function bgmPrefetch(keys) {
  keys.forEach(k => {
    const a = bgmEl(k);
    if (a.dataset.fetched) return;              // 同じ曲を何度も落とさない
    a.dataset.fetched = '1';
    a.preload = 'auto';
    try { a.load(); } catch (e) {}
  });
}
function bgmFade(key, to, ms, stopAtEnd) {
  const a = BGM.el[key];
  if (!a) return;
  clearInterval(BGM.timers[key]);
  const from = a.volume, t0 = now();
  BGM.timers[key] = setInterval(() => {
    const k = clamp((now() - t0) / ms, 0, 1);
    a.volume = clamp(from + (to - from) * k, 0, 1);
    if (k >= 1) {
      clearInterval(BGM.timers[key]);
      if (stopAtEnd) { try { a.pause(); a.currentTime = 0; } catch (e) {} }
    }
  }, 40);
}
function bgmSync() {
  const want = (BGM.on && BGM.unlocked) ? BGM.want : null;
  if (BGM.playing === want) return;
  const old = BGM.playing;
  BGM.playing = want;
  if (old) bgmFade(old, 0, 320, true);
  if (want) {
    const a = bgmEl(want);
    a.preload = 'auto';
    try { a.currentTime = 0; } catch (e) {}
    a.volume = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { BGM.playing = null; });   // 自動再生が弾かれたら次の操作で再挑戦
    bgmFade(want, BGM.tracks[want].vol, 600);
  }
}
function bgmSet(key) { BGM.want = key; bgmSync(); }
function bgmToggle() {
  BGM.on = !BGM.on;
  lsSet(BGM_KEY, BGM.on ? '1' : '0');
  renderBgmBtn();
  bgmSync();
}
function renderBgmBtn() {
  const b = $('#btn-bgm');
  if (!b) return;
  b.classList.toggle('off', !BGM.on);
  // プレイ中は画面全体がタップ判定なので、押し間違い防止のため隠す
  b.classList.toggle('show', S.screen !== 'play');
}
/* 画面ごとの曲を決める */
function bgmForScreen() {
  if (S.screen === 'play') return (S.speed === 'oni') ? 'oni' : 'play';
  if (S.screen === 'result') {
    const m = S.lastResult || {};
    if (m.vs) {
      const me = Math.max(0, S.me.idx);
      return (m.winner >= 0 && m.team && m.winner === m.team[me]) ? 'win' : 'lose';
    }
    return ['S+', 'S', 'A', 'B'].includes(rankOf(m.round || 0, m.speed_key || 'normal')) ? 'win' : 'lose';
  }
  return 'title';   // タイトル・ロビー・練習の設定画面
}
function bgmUnlock() {
  if (BGM.unlocked) return;
  BGM.unlocked = true;
  bgmSync();
}
function bgmInit() {
  BGM.on = lsGet(BGM_KEY) !== '0';
  $('#btn-bgm').addEventListener('click', (e) => { e.stopPropagation(); bgmToggle(); });
  // 最初のタップ／クリックで解除（iOS・Android の自動再生制限の対策）
  ['pointerdown', 'keydown'].forEach(ev =>
    document.addEventListener(ev, bgmUnlock, { capture: true }));
  bgmPrefetch(['title']);
  bgmSet('title');
  renderBgmBtn();
  document.addEventListener('visibilitychange', () => {
    if (!BGM.playing) return;
    const a = BGM.el[BGM.playing];
    if (!a) return;
    if (document.hidden) { try { a.pause(); } catch (e) {} }
    else { const p = a.play(); if (p && p.catch) p.catch(() => {}); }
  });
}

/* =========================================================
   画面
   ========================================================= */
function show(screen) {
  S.screen = screen;
  $$('.screen').forEach(el => el.classList.toggle('on', el.id === 'sc-' + screen));
  bgmSet(bgmForScreen());
  renderBgmBtn();
}
function setNetStatus(text, cls) {
  $$('.netstat').forEach(el => { el.textContent = text; el.className = 'netstat ' + cls; });
}
function toast(msg) {
  const d = document.createElement('div');
  d.textContent = msg;
  d.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 28px);' +
    'transform:translateX(-50%);background:#141834;border:1px solid #232a52;color:#f4f6ff;' +
    'padding:12px 20px;border-radius:999px;font-size:13px;z-index:200;box-shadow:0 10px 30px #0008';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2600);
}

/* ---------- ロビー ---------- */
function renderLobby() {
  $('#lobby-code').textContent = S.code || '----';
  const q = syncQuality();
  const sq = $('#sync-q');
  sq.textContent = q.label;
  sq.className = 'syncq ' + q.cls;

  const n = S.roster.length;
  $('#player-count').textContent = n + ' / ' + MAX_PLAYERS + '人';

  const list = $('#player-list');
  list.innerHTML = '';
  // 参加済み全員 ＋ 空きが残っていれば1行だけ
  const rows = n < MAX_PLAYERS ? n + 1 : n;
  for (let i = 0; i < rows; i++) {
    const p = S.roster[i];
    const c = COLORS[i % COLORS.length];
    const div = document.createElement('div');
    div.className = 'pcard' + (p ? '' : ' empty') + (p && p.id === S.me.id ? ' me' : '');
    div.style.setProperty('--c', c.hex);
    if (p) {
      const pr = p.id === S.me.id
        ? { synced: S.isHost || S.synced, err: S.isHost ? 0 : S.syncErr, ns: S.samples.length }
        : (S.presence.get(p.id) || {});
      const okSync = !!pr.synced;
      const errTxt = p.id === S.me.id && S.isHost ? '基準'
        : (pr.err == null ? '' : '±' + Math.round(pr.err) + 'ms');
      div.innerHTML =
        '<div class="pdot"></div>' +
        '<div class="pname">' + escapeHtml(p.name) + (p.id === S.me.id ? '<span class="youtag">あなた</span>' : '') + '</div>' +
        '<div class="pmeta">' + (okSync ? (errTxt || '同期OK') : '同期中…') + '</div>';
    } else {
      div.innerHTML = '<div class="pdot"></div><div class="pname">空き</div><div class="pmeta">参加待ち</div>';
    }
    list.appendChild(div);
  }

  $('#mode-block').style.display = S.isHost ? '' : 'none';
  const btn = $('#btn-start');
  if (S.isHost) {
    btn.style.display = '';
    const allSynced = S.roster.every(p => p.id === S.me.id || (S.presence.get(p.id) || {}).synced);
    const worstErr = S.roster.reduce((mx, p) => {
      if (p.id === S.me.id) return mx;
      const e = (S.presence.get(p.id) || {}).err;
      return e == null ? mx : Math.max(mx, e);
    }, 0);
    const vs = S.play === 'versus';
    let ok = allSynced, note = '';
    if (!allSynced) note = '全員の計測が終わるまで数秒待ってください';
    else if (vs && n < 2) { ok = false; note = '対戦は2人から。あと1人呼んでください'; }
    else if (vs && n % 2 !== 0) { ok = false; note = '対戦は偶数人数で（いま' + n + '人）'; }
    else if (vs) note = (n / 2) + '対' + (n / 2) + '。相手はランダムで決まります';
    else note = n === 1 ? '1人でも遊べます。あと' + (MAX_PLAYERS - n) + '人まで参加できます'
                        : 'あと' + (MAX_PLAYERS - n) + '人まで参加できます';
    if (ok && worstErr > 90) note = 'ズレ大きめ（±' + Math.round(worstErr) + 'ms）。遊べますが判定が甘くなります';
    btn.disabled = !ok;
    btn.textContent = vs ? (n >= 2 && n % 2 === 0 ? (n / 2) + '対' + (n / 2) + 'で開始' : '対戦で開始')
                         : n + '人で開始する';
    btn.className = (S.speed === 'oni' || vs) ? 'hot' : '';
    $('#host-note').textContent = note;
  } else {
    btn.style.display = 'none';
    $('#host-note').textContent = 'ホストの開始を待っています…';
  }
}

function setPlay(k) {
  S.play = k;
  $('#play-coop').classList.toggle('on', k === 'coop');
  $('#play-versus').classList.toggle('on', k === 'versus');
  if (S.screen === 'lobby') renderLobby();
}
function setSpeed(k) {
  S.speed = k;
  $('#speed-normal').classList.toggle('on', k === 'normal');
  $('#speed-oni').classList.toggle('on', k === 'oni');
  if (S.screen === 'lobby') renderLobby();
}

/* 対戦：チーム分けと「誰と誰が戦うか」を決める */
function buildVersus(n) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
  const h = n / 2;
  const team = new Array(n), rival = new Array(n);
  for (let k = 0; k < h; k++) {
    const a = idx[k], b = idx[k + h];
    team[a] = 0; team[b] = 1;
    rival[a] = b; rival[b] = a;
  }
  return { team, rival };
}

/* =========================================================
   ゲーム
   ========================================================= */
function onCtrl(m) {
  if (m.type === 'roster') {
    if (S.isHost) return;
    S.roster = m.roster || [];
    const me = S.roster.find(p => p.id === S.me.id);
    S.me.idx = me ? me.idx : -1;
    renderLobby();
  } else if (m.type === 'start') {
    startGame(m.seed, m.startAt, m.roster, m.play, m.speed, m.vs, m.judgeWait);
  } else if (m.type === 'result') {
    applyResult(m);
  } else if (m.type === 'gameover') {
    endGame(m);
  } else if (m.type === 'closed') {
    if (!S.isHost) { leaveRoom(true); toast('ホストがルームを閉じました'); }
  }
}

function hostStart() {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const n = S.roster.length;
  // いちばん遅い端末の往復時間を見て、開始の余裕と判定の締め切りを決める
  let maxRtt = 0;
  S.roster.forEach(p => {
    if (p.id === S.me.id) return;
    const r = (S.presence.get(p.id) || {}).rtt;
    if (r && r > maxRtt) maxRtt = r;
  });
  const judgeWait = clamp(JUDGE_DELAY + maxRtt, JUDGE_DELAY, 2200);
  const startAt = now() + 1200 + Math.min(maxRtt, 1500);
  const vs = S.play === 'versus' ? buildVersus(n) : null;
  const payload = { type: 'start', seed, startAt, roster: S.roster,
                    play: S.play, speed: S.speed, vs, judgeWait };
  pub('ctrl', payload);
  startGame(seed, startAt, S.roster, S.play, S.speed, vs, judgeWait);
}

/* =========================================================
   練習モード：AIと1対1（対戦ルール・通信なし）

   自分の端末だけで完結する。AIの入力は「押した時刻」を直接作って
   ホスト判定に流し込むので、対戦の計算式は本番とまったく同じ。
   ========================================================= */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;  // ざっくり正規分布

function setAiLevel(k) {
  S.aiLevel = AI_LEVELS[k] ? k : 'mid';
  $$('#ai-levels .prcard').forEach(el => el.classList.toggle('on', el.dataset.lv === S.aiLevel));
}
function setPrSpeed(k) {
  S.prSpeed = SPEEDS[k] ? k : 'normal';
  $('#pr-speed-normal').classList.toggle('on', S.prSpeed === 'normal');
  $('#pr-speed-oni').classList.toggle('on', S.prSpeed === 'oni');
}
function openPractice() {
  setAiLevel(S.aiLevel);
  setPrSpeed(S.prSpeed);
  bgmPrefetch(['play', 'oni']);
  show('practice');
  const w = $('#sc-practice .wrap');
  if (w) w.scrollTop = 0;   // 前回の続きの位置から開かないように
}

function startPractice() {
  const lv = AI_LEVELS[S.aiLevel] || AI_LEVELS.mid;
  const name = ($('#in-name').value || '').trim() || 'あなた';
  S.me.name = name;
  lsSet('st_name', name);

  // 通信は一切使わない：code が null なら pub() は何もしない
  S.code = null;
  S.isHost = true;
  S.practice = true;
  S.offset = 0; S.synced = true;
  S.presence.clear();
  S.play = 'versus';
  S.speed = S.prSpeed;
  S.me.idx = 0;
  S.roster = [
    { id: S.me.id, name, idx: 0 },
    { id: AI_ID, name: 'AI・' + lv.name, idx: 1 },
  ];

  initAudio();
  const seed = (Math.random() * 0xffffffff) >>> 0;
  startGame(seed, now() + 1400, S.roster, 'versus', S.prSpeed, { team: [0, 1], rival: [1, 0] }, JUDGE_DELAY);
  S.game.ai = { lv, done: -1 };
}

/* そのラウンドでAIが「いつ・何を」押したことにするかを決める */
function aiTurn(round) {
  const g = S.game, ai = g && g.ai;
  if (!ai || ai.done >= round) return;
  ai.done = round;

  const L = ai.lv;
  const ins = insOf(g, round);
  const target = g.startAtHost + g.at[round];
  const feed = (t, act, dir) => onInput({ id: AI_ID, round, t, act, dir: dir || null });
  const when = () => target + clamp(L.bias + gauss() * L.jitter, -430, 430);

  if (ins.type === 'NO_TAP') {
    // 「さわるな」：たまに我慢できずに触ってしまう
    if (Math.random() < L.wrong) feed(target + gauss() * 150, 'tap', null);
    return;
  }
  if (Math.random() < L.miss) return;                    // 押し忘れ

  if (ins.type === 'SWIPE') {
    let dir = ins.dir;
    if (Math.random() < L.wrong) {                       // 方向を間違える
      const other = DIRS.filter(d => d.key !== ins.dir);
      dir = other[(Math.random() * other.length) | 0].key;
    }
    feed(when(), 'swipe', dir);
  } else {
    feed(when(), 'tap', null);
  }
}

function startGame(seed, startAtHost, roster, playKey, speedKey, vsSetup, judgeWait) {
  const PL = PLAYS[playKey] || PLAYS.coop;
  const SP = SPEEDS[speedKey] || SPEEDS.normal;
  S.play = PL.key; S.speed = SP.key;   // 参加側にもホストの設定を反映（BGMの選択にも使う）
  S.roster = roster || S.roster;
  bgmPrefetch(['win', 'lose']);
  const me = S.roster.find(p => p.id === S.me.id);
  S.me.idx = me ? me.idx : -1;
  const n = S.roster.length;

  // このスピードでのラウンド目標時刻を作る
  const at = new Array(MAX_ROUNDS);
  let t = LEAD_IN;
  for (let i = 0; i < MAX_ROUNDS; i++) { at[i] = t; t += intervalOf(SP.lv0 + i); }

  const versus = PL.key === 'versus' && vsSetup;

  S.game = {
    seed, startAtHost, at, PL, SP, play: PL.key,
    judgeWait: clamp(judgeWait || JUDGE_DELAY, JUDGE_DELAY, 2200),
    lv: (i) => SP.lv0 + i,
    n,
    lives: SP.lives, combo: 0, maxCombo: 0, score: 0,
    round: 0, over: false, armed: -1,
    localVerdict: {}, inbox: {}, judged: -1, stats: {},
    // 対戦用
    team: versus ? vsSetup.team.slice() : null,
    rival: versus ? vsSetup.rival.slice() : null,
    hp: versus ? new Array(n).fill(VS.HP) : null,
    out: versus ? new Array(n).fill(false) : null,
    dealt: versus ? new Array(n).fill(0) : null,
    taken: versus ? new Array(n).fill(0) : null,
  };
  S.roster.forEach(p => { S.game.stats[p.id] = { p: 0, g: 0, m: 0 }; });

  lastRenderRound = -1; tickedFor = -1;
  initAudio(); calibrateAudio();
  requestWakeLock();

  const myColor = COLORS[Math.max(0, S.me.idx) % COLORS.length].hex;
  $('#play-root').style.setProperty('--me', myColor);
  $('#play-root').classList.remove('fever');
  $('#hud-mode').textContent = versus
    ? (S.practice ? '練習 ' + (AI_LEVELS[S.aiLevel] || {}).label : PL.label) +
      (SP.key === 'oni' ? ' · 鬼' : '')
    : SP.label;
  $('#combo').classList.add('hidden');
  $('#verdict').className = '';
  $('#gain').className = '';

  // 画面の出し分け
  const isVs = !!versus;
  $('#vs-hud').style.display = isVs ? '' : 'none';
  $('#hud-lives').style.display = isVs ? 'none' : '';
  $('#hud-score-label').textContent = isVs ? 'HP' : 'SCORE';
  if (isVs) renderVsHud();

  show('play');
  loop();
}

/* 対戦：自分と相手のHPバー */
function renderVsHud() {
  const g = S.game;
  if (!g || !g.hp) return;
  const me = Math.max(0, S.me.idx);
  const op = g.rival[me];
  const set = (sel, idx) => {
    const el = $(sel);
    if (idx == null || idx < 0) { el.style.display = 'none'; return; }
    el.style.display = '';
    const c = COLORS[idx % COLORS.length];
    const p = S.roster[idx] || {};
    el.style.setProperty('--c', c.hex);
    el.querySelector('.vsn').textContent = (idx === me ? 'あなた' : (p.name || '?'));
    el.querySelector('.vshp').textContent = Math.max(0, g.hp[idx]);
    el.querySelector('.vsbar i').style.width = clamp(g.hp[idx] / VS.HP * 100, 0, 100) + '%';
    el.classList.toggle('ko', g.out[idx]);
  };
  set('#vs-me', me);
  set('#vs-op', op);
  $('#vs-mid').textContent = op == null ? '—' : 'VS';
}

function pendingRound(tHost) {
  const g = S.game, rel = tHost - g.startAtHost;
  for (let i = g.round; i < MAX_ROUNDS; i++) if (rel < g.at[i] + JUDGE_DELAY) return i;
  return MAX_ROUNDS - 1;
}

let rafId = null;
function loop() {
  cancelAnimationFrame(rafId);
  const step = () => {
    if (!S.game || S.game.over) return;
    const g = S.game;
    const rel = toHost(now()) - g.startAtHost;
    const cur = pendingRound(toHost(now()));
    if (cur !== g.round) g.round = cur;

    const target = g.at[cur];
    const prev = cur === 0 ? 0 : g.at[cur - 1];
    const remain = target - rel;
    const prog = clamp(1 - remain / (target - prev), 0, 1);

    const ins = insOf(g, cur);
    if (g.armed !== cur) { g.armed = cur; armInput(ins); scheduleTick(cur, target); }
    if (g.ai) aiTurn(cur);

    renderPlay(cur, ins, prog, remain);
    if (S.isHost) hostJudgeTick(rel);

    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

let tickedFor = -1;
function scheduleTick(round, targetRel) {
  if (tickedFor === round) return;
  tickedFor = round;
  beat(toLocal(S.game.startAtHost + targetRel), round % 4 === 0);
}

/* ---------- 入力 ---------- */
const input = { armed: false, wantSwipe: false, round: -1, downT: 0, downX: 0, downY: 0, fired: false };

function armInput(ins) {
  input.armed = true;
  input.wantSwipe = needsSwipe(ins);
  input.round = S.game.round;
  input.fired = false;
}

function fireAction(act, dir, tLocal) {
  if (!S.game || input.fired) return;
  input.fired = true;
  const g = S.game, round = input.round;
  const tH = toHost(tLocal);
  const delta = tH - (g.startAtHost + g.at[round]);
  const W = WIN_OF(g.lv(round), g.n);
  const ins = insOf(g, round);

  let label = '', cls = '';
  const forbidden = ins.type === 'NO_TAP' || (ins.type === 'SOLO_TAP' && ins.who !== S.me.idx);
  if (forbidden)                                   { label = 'さわった！'; cls = 'bad'; }
  else if (ins.type === 'SWIPE' && act !== 'swipe'){ label = 'スワイプ！'; cls = 'bad'; }
  else if (ins.type === 'SWIPE' && dir !== ins.dir){ label = '方向ちがう'; cls = 'bad'; }
  else {
    const a = Math.abs(delta);
    if      (a <= W * 0.33) { label = 'PERFECT'; cls = 'perfect'; }
    else if (a <= W * 0.65) { label = 'GOOD';    cls = 'good'; }
    else if (a <= W)        { label = 'OK';      cls = 'ok'; }
    else                    { label = delta < 0 ? 'はやい' : 'おそい'; cls = 'bad'; }
  }
  g.localVerdict[round] = { label, cls, delta: Math.round(delta) };
  showVerdict(label, cls);
  fxTouch(cls);

  pub('input', { id: S.me.id, round, t: tH, act, dir: dir || null });
  if (S.isHost) onInput({ id: S.me.id, round, t: tH, act, dir: dir || null });
}

function bindInput() {
  const pad = $('#play-root');
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    S.touch.x = e.clientX; S.touch.y = e.clientY;
    if (!input.armed) return;
    input.downT = now(); input.downX = e.clientX; input.downY = e.clientY;
    if (!input.wantSwipe) fireAction('tap', null, input.downT);
  }, { passive: false });

  pad.addEventListener('pointermove', (e) => {
    if (!input.armed || !input.wantSwipe || input.fired || !input.downT) return;
    const dx = e.clientX - input.downX, dy = e.clientY - input.downY;
    if (Math.hypot(dx, dy) < 34) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    S.touch.x = e.clientX; S.touch.y = e.clientY;
    fireAction('swipe', dir, now());
  }, { passive: false });

  pad.addEventListener('pointerup', () => {
    if (!input.armed || input.fired) { input.downT = 0; return; }
    if (input.wantSwipe && input.downT) fireAction('tap', null, input.downT);
    input.downT = 0;
  });
  pad.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- ホスト側の判定 ---------- */
function onInput(m) {
  if (!S.isHost || !S.game) return;
  const g = S.game;
  (g.inbox[m.round] = g.inbox[m.round] || []).push(m);
  const rel = m.t - g.startAtHost;
  for (let r = Math.max(0, m.round - 1); r <= m.round + 1; r++) {
    if (r === m.round) continue;
    if (Math.abs(rel - g.at[r]) < GUARD_PRE) {
      (g.inbox[r] = g.inbox[r] || []).push(Object.assign({}, m, { stray: true }));
    }
  }
}

function hostJudgeTick(rel) {
  const g = S.game;
  for (let r = g.judged + 1; r < MAX_ROUNDS; r++) {
    if (rel < g.at[r] + g.judgeWait) break;
    g.judged = r;
    judgeRound(r);
    if (g.over) break;
  }
}

function judgeRound(r) {
  if (S.game.play === 'versus') return judgeVersus(r);
  const g = S.game;
  const ins = insOf(g, r);
  const items = g.inbox[r] || [];
  const target = g.startAtHost + g.at[r];
  const W = WIN_OF(g.lv(r), g.n);

  const byPlayer = {};
  S.roster.forEach(p => { byPlayer[p.id] = null; });
  items.forEach(it => {
    const d = it.t - target;
    if (d < -GUARD_PRE || d > GUARD_POST + W) return;   // 押した時刻で判定（届いた時刻ではない）
    const cur = byPlayer[it.id];
    if (!cur || Math.abs(d) < Math.abs(cur.d)) byPlayer[it.id] = { d, act: it.act, dir: it.dir };
  });

  let ok = true, worst = 0, acted = 0;
  const detail = {};
  S.roster.forEach(p => {
    const a = byPlayer[p.id];
    const mustAct =
      ins.type === 'ALL_TAP'  ? 'tap' :
      ins.type === 'SWIPE'    ? 'swipe' :
      ins.type === 'SOLO_TAP' ? (ins.who === p.idx ? 'tap' : 'none') : 'none';

    let good, bucket;
    if (mustAct === 'none') {
      good = !a;
      detail[p.id] = good ? 'held' : 'touched';
      bucket = good ? 'g' : 'm';          // 触らずに耐えたら GOOD 扱い
    } else if (!a) {
      good = false; detail[p.id] = 'missed'; bucket = 'm';
    } else {
      const timing = Math.abs(a.d) <= W;
      const right  = a.act === mustAct && (mustAct !== 'swipe' || a.dir === ins.dir);
      good = timing && right;
      detail[p.id] = !right ? 'wrong' : (timing ? 'hit' : (a.d < 0 ? 'early' : 'late'));
      if (good) {
        worst = Math.max(worst, Math.abs(a.d)); acted++;
        bucket = Math.abs(a.d) <= W * 0.33 ? 'p' : 'g';
      } else bucket = 'm';
    }
    if (g.stats[p.id]) g.stats[p.id][bucket]++;
    if (!good) ok = false;
  });

  // チームとしての揃い具合
  let tier = 'ok';
  if (ok) {
    if (!acted) tier = 'good';
    else if (worst <= W * 0.33) tier = 'perfect';
    else if (worst <= W * 0.65) tier = 'good';
  }

  let gain = 0;
  if (ok) {
    g.combo++; g.maxCombo = Math.max(g.maxCombo, g.combo);
    const mul = tier === 'perfect' ? 3 : tier === 'good' ? 2 : 1;
    gain = (100 + 50 * Math.min(g.combo, 20)) * mul;
    if (g.SP.key === 'oni') gain = Math.round(gain * 1.5);
    g.score += gain;
  } else {
    g.combo = 0; g.lives--;
  }

  const payload = { type: 'result', round: r, ok, tier, gain, detail,
                    lives: g.lives, combo: g.combo, score: g.score };
  pub('ctrl', payload);
  applyResult(payload);

  if (g.lives <= 0 && !g.over) {
    const over = { type: 'gameover', round: r + 1, score: g.score, maxCombo: g.maxCombo,
                   speed: SPEED_OF(g.lv(r)), stats: g.stats, roster: S.roster,
                   play: 'coop', speed_key: g.SP.key };
    pub('ctrl', over);
    endGame(over);
  }
}

/* =========================================================
   対戦：ペアごとに誤差を比べて、負けたほうがダメージを受ける
   ========================================================= */
function errorOf(a, ins, myIdx) {
  // 返り値：{ err(ms), failed }  失敗は FAIL_ERR 扱い
  const mustAct = ins.type === 'ALL_TAP' ? 'tap' : ins.type === 'SWIPE' ? 'swipe' : 'none';
  if (mustAct === 'none') {
    // 「さわるな」：触らなければ完璧、触ったら失敗
    return a ? { err: VS.FAIL_ERR, failed: true } : { err: 0, failed: false };
  }
  if (!a) return { err: VS.FAIL_ERR, failed: true };
  const right = a.act === mustAct && (mustAct !== 'swipe' || a.dir === ins.dir);
  if (!right) return { err: VS.FAIL_ERR, failed: true };
  const e = Math.abs(a.d);
  if (e >= VS.FAIL_ERR) return { err: VS.FAIL_ERR, failed: true };
  return { err: e, failed: false };
}

function reassignRivals(g) {
  for (let i = 0; i < g.n; i++) {
    if (g.out[i]) { g.rival[i] = null; continue; }
    if (g.rival[i] == null || g.out[g.rival[i]]) {
      const foes = [];
      for (let j = 0; j < g.n; j++) if (!g.out[j] && g.team[j] !== g.team[i]) foes.push(j);
      g.rival[i] = foes.length ? foes[i % foes.length] : null;
    }
  }
}

function judgeVersus(r) {
  const g = S.game;
  const ins = insOf(g, r);
  const items = g.inbox[r] || [];
  const target = g.startAtHost + g.at[r];
  const W = WIN_OF(g.lv(r), g.n);

  // 各プレイヤーの「もっとも目標に近い操作」を拾う
  const best = {};
  items.forEach(it => {
    const d = it.t - target;
    if (d < -GUARD_PRE || d > VS.FAIL_ERR) return;
    const cur = best[it.id];
    if (!cur || Math.abs(d) < Math.abs(cur.d)) best[it.id] = { d, act: it.act, dir: it.dir };
  });

  const err = new Array(g.n).fill(VS.FAIL_ERR);
  const failed = new Array(g.n).fill(true);
  S.roster.forEach(p => {
    const e = errorOf(best[p.id] || null, ins, p.idx);
    err[p.idx] = Math.round(e.err);
    failed[p.idx] = e.failed;
    // 成績表用のバケツも一応ためておく
    const bucket = e.failed ? 'm' : (e.err <= W * 0.33 ? 'p' : 'g');
    if (g.stats[p.id]) g.stats[p.id][bucket]++;
  });

  // ペアごとに勝負
  const hits = [];
  for (let i = 0; i < g.n; i++) {
    const j = g.rival[i];
    if (j == null || j < i) continue;      // 1組を1回だけ処理
    if (g.out[i] || g.out[j]) continue;
    if (failed[i] && failed[j]) continue;  // 二人とも失敗なら痛み分け
    const diff = Math.abs(err[i] - err[j]);
    if (diff <= VS.DEAD) continue;         // ほぼ互角
    const win = err[i] < err[j] ? i : j;
    const lose = win === i ? j : i;
    const mul = 1 + Math.min(1, r / VS.RAMP);   // 終盤ほど1発が重くなる
    const dmg = clamp(Math.round(diff * VS.DMG_PER_MS * mul), 0, VS.DMG_MAX);
    if (dmg <= 0) continue;
    g.hp[lose] = Math.max(0, g.hp[lose] - dmg);
    g.dealt[win] += dmg;
    g.taken[lose] += dmg;
    hits.push({ from: win, to: lose, dmg });
  }

  // ノックアウト判定と相手の組み替え
  for (let i = 0; i < g.n; i++) if (!g.out[i] && g.hp[i] <= 0) g.out[i] = true;
  reassignRivals(g);

  const alive = [0, 0];
  for (let i = 0; i < g.n; i++) if (!g.out[i]) alive[g.team[i]]++;

  const payload = {
    type: 'result', vs: true, round: r, ins: ins.type,
    err, failed, hits, hp: g.hp.slice(), out: g.out.slice(), rival: g.rival.slice(),
  };
  pub('ctrl', payload);
  applyResult(payload);

  if ((alive[0] === 0 || alive[1] === 0) && !g.over) {
    const winner = alive[0] === 0 && alive[1] === 0 ? -1 : (alive[0] > 0 ? 0 : 1);
    const over = {
      type: 'gameover', vs: true, round: r + 1, speed: SPEED_OF(g.lv(r)),
      winner, team: g.team.slice(), hp: g.hp.slice(),
      dealt: g.dealt.slice(), taken: g.taken.slice(),
      roster: S.roster, play: 'versus', speed_key: g.SP.key,
      ai: g.ai ? g.ai.lv : null,
    };
    pub('ctrl', over);
    endGame(over);
  }
}

/* ---------- 演出 ---------- */
function showVerdict(label, cls) {
  const v = $('#verdict');
  v.textContent = label;
  v.className = '';
  void v.offsetWidth;
  v.className = 'show v-' + cls;
}
function showGain(n) {
  const g = $('#gain');
  g.textContent = '+' + n.toLocaleString();
  g.className = '';
  void g.offsetWidth;
  g.className = 'show';
}
function flash(kind) {
  const f = $('#flash');
  f.className = 'f-' + kind;
  void f.offsetWidth;
  f.classList.add('go');
}
function shake() {
  const el = $('#play-root');
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
}

// 自分が押した瞬間の小さな手応え
function fxTouch(cls) {
  const pal = PAL[cls] || PAL.ok;
  fxBurst(S.touch.x, S.touch.y, {
    n: cls === 'perfect' ? 22 : cls === 'bad' ? 8 : 14,
    speed: [120, 420], life: [0.25, 0.5], size: [1.5, 3.5],
    colors: pal, shapes: ['spark', 'dot'], g: 500,
  });
  fxRing(S.touch.x, S.touch.y, pal[0], 70, 4, 0.4);
}

// チームの判定が出たときの大きい演出
function celebrate(tier, gain, combo) {
  const cx = FX.w / 2, cy = FX.h * 0.42;
  if (tier === 'perfect') {
    flash('perfect');
    fxRing(cx, cy, '#f4ff2b', Math.max(FX.w, FX.h) * 0.62, 12, 0.72);
    fxRing(cx, cy, '#ffffff', Math.max(FX.w, FX.h) * 0.5, 7, 0.66, 0.08);
    fxRing(cx, cy, '#ff1f7a', Math.max(FX.w, FX.h) * 0.44, 6, 0.6, 0.16);
    fxBurst(cx, cy, { n: 64, speed: [320, 1050], life: [0.5, 1.15], size: [2, 5],
                      colors: PAL.perfect, shapes: ['spark', 'star', 'dot'], g: 820 });
    fxBurst(cx, FX.h + 20, { n: 46, ang: -Math.PI / 2, spread: 0.62, speed: [700, 1350],
                      life: [0.9, 1.6], size: [3, 7], colors: PAL.perfect, shapes: ['conf'], g: 900, drag: 0.995 });
    sndPerfect(); buzz([0, 16, 36, 26]);
  } else if (tier === 'good') {
    flash('good');
    fxRing(cx, cy, '#2bff9e', Math.max(FX.w, FX.h) * 0.42, 8, 0.55);
    fxBurst(cx, cy, { n: 30, speed: [240, 720], life: [0.36, 0.8], size: [2, 4],
                      colors: PAL.good, shapes: ['spark', 'dot'], g: 760 });
    sndGood(); buzz(18);
  } else {
    flash('ok');
    fxRing(cx, cy, '#ffffff', Math.max(FX.w, FX.h) * 0.3, 6, 0.45);
    fxBurst(cx, cy, { n: 18, speed: [180, 520], life: [0.3, 0.6], size: [1.6, 3.2],
                      colors: PAL.ok, shapes: ['spark'], g: 700 });
    sndOk(); buzz(12);
  }
  if (gain) showGain(gain);

  // コンボの節目はさらに派手に
  if (combo > 0 && combo % 5 === 0) {
    sndFever();
    fxBurst(cx, FX.h + 20, { n: 60, ang: -Math.PI / 2, spread: 0.9, speed: [800, 1500],
      life: [1, 1.8], size: [3, 8], colors: PAL.perfect.concat(PAL.good), shapes: ['conf', 'star'], g: 950, drag: 0.996 });
    fxRing(cx, FX.h * 0.5, '#f4ff2b', Math.max(FX.w, FX.h) * 0.8, 14, 0.9);
    buzz([0, 20, 50, 20, 50, 34]);
  }
}

function failEffect() {
  flash('bad'); shake();
  sndBad(); buzz([0, 40, 60, 90]);
  fxBurst(FX.w / 2, FX.h * 0.42, { n: 16, speed: [120, 380], life: [0.4, 0.8], size: [2, 4.5],
    colors: PAL.bad, shapes: ['dot', 'spark'], g: 1400 });
}

function applyResult(m) {
  if (!S.game) return;
  if (m.vs) return applyVersusResult(m);
  const g = S.game;
  const prevScore = g.score;
  g.lives = m.lives; g.combo = m.combo; g.score = m.score;

  if (m.ok) celebrate(m.tier || 'ok', m.gain || (g.score - prevScore), m.combo);
  else failEffect();

  // コンボ表示
  const cb = $('#combo');
  $('#combo-n').textContent = g.combo;
  cb.classList.toggle('hidden', g.combo < 2);
  if (m.ok && g.combo >= 2) { cb.classList.remove('beat'); void cb.offsetWidth; cb.classList.add('beat'); }
  $('#play-root').classList.toggle('fever', g.combo >= 10);

  const sc = $('#hud-score');
  sc.classList.remove('bump'); void sc.offsetWidth; sc.classList.add('bump');
}

/* 対戦：1ラウンドぶんの結果を自分視点で見せる */
function applyVersusResult(m) {
  const g = S.game;
  g.hp = m.hp.slice(); g.out = m.out.slice(); g.rival = m.rival.slice();

  const me = Math.max(0, S.me.idx);
  const hit = m.hits.find(h => h.from === me || h.to === me);
  const gainEl = $('#gain');
  gainEl.className = '';
  void gainEl.offsetWidth;

  if (hit && hit.from === me) {
    gainEl.textContent = hit.dmg + ' ダメージ';
    gainEl.className = 'show dealt';
    celebrate(hit.dmg >= VS.DMG_MAX * 0.66 ? 'perfect' : 'good', 0, 0);
    fxBurst(FX.w * 0.78, FX.h * 0.16, { n: 26, speed: [200, 700], life: [0.35, 0.8], size: [2, 5],
      colors: PAL.perfect, shapes: ['spark', 'star'], g: 700 });
  } else if (hit && hit.to === me) {
    gainEl.textContent = '− ' + hit.dmg;
    gainEl.className = 'show taken';
    failEffect();
  } else {
    gainEl.textContent = '互角';
    gainEl.className = 'show even';
    flash('ok'); sndOk(); buzz(10);
  }

  // 1対1では倒れた時点で試合が終わるので、案内は3人以上のときだけ
  if (g.out[me] && !g.koShown && g.n > 2) {
    g.koShown = true; toast('あなたは倒れました。仲間を見守りましょう');
  }
  renderVsHud();
}

/* ---------- プレイ画面の描画 ---------- */
let lastRenderRound = -1;
function renderPlay(round, ins, prog, remain) {
  const g = S.game;
  const myIdx = Math.max(0, S.me.idx);

  if (round !== lastRenderRound) {
    lastRenderRound = round;
    const box = $('#instr');
    let main = '', sub = '', cls = '';
    const all = g.play === 'versus' ? 'いっせいに（相手より正確に）' : g.n + '人いっせいに';
    if (ins.type === 'ALL_TAP')      { main = 'タップ';   sub = all; cls = 'i-all'; }
    else if (ins.type === 'NO_TAP')  { main = 'さわるな'; sub = '手を離して待つ'; cls = 'i-no'; }
    else if (ins.type === 'SWIPE')   {
      const d = DIRS.find(x => x.key === ins.dir);
      main = d.label; sub = all + d.jp + 'へスワイプ'; cls = 'i-swipe';
    } else if (ins.type === 'SOLO_TAP') {
      if (ins.who === myIdx) { main = 'あなただけ'; sub = 'あなたがタップ／他は触るな'; cls = 'i-solo-me'; }
      else {
        const who = (S.roster[ins.who] || {}).name || (COLORS[ins.who % COLORS.length] || {}).name || '誰か';
        main = 'さわるな'; sub = escapeHtml(who) + 'の番です'; cls = 'i-solo-other';
      }
    }
    box.className = 'instr ' + cls;
    void box.offsetWidth;
    box.classList.add('pop');
    $('#instr-main').textContent = main;
    $('#instr-sub').textContent  = sub;
  }

  const ring = $('#ring-fg');
  const C = 2 * Math.PI * 46;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - prog);
  $('#ring-wrap').classList.toggle('near', remain < 240 && remain > -240);

  const cd = $('#countdown');
  if (round === 0 && remain > 0) { cd.style.display = ''; cd.textContent = String(Math.ceil(remain / 800)); }
  else cd.style.display = 'none';

  if (g.play === 'versus') {
    const me = Math.max(0, S.me.idx);
    $('#hud-score').textContent = Math.max(0, g.hp[me]);
  } else {
    let hearts = '';
    for (let i = 0; i < g.SP.lives; i++) hearts += '<span class="' + (i < g.lives ? 'on' : 'off') + '">♥</span>';
    $('#hud-lives').innerHTML = hearts;
    $('#hud-score').textContent = g.score.toLocaleString();
  }
  $('#hud-round').textContent = 'R' + (round + 1);
  $('#hud-speed').textContent = 'SPEED ' + SPEED_OF(g.lv(round));
}

/* ---------- 結果 ---------- */
function rankOf(rounds, modeKey) {
  const r = modeKey === 'oni' ? rounds * 1.9 : rounds;
  if (r >= 60) return 'S+';
  if (r >= 46) return 'S';
  if (r >= 34) return 'A';
  if (r >= 24) return 'B';
  if (r >= 14) return 'C';
  return 'D';
}

/* 最下位に贈る辛口コメント。全端末で同じ文が出るよう、結果から決定論的に選ぶ */
const ROASTS = [
  (n, s) => n + '、今日は見学でよかったんじゃない？',
  (n, s) => n + 'のせいで負けた、とまでは言わない。数字がもう言ってる。',
  (n, s) => n + '、指と脳が別々の県に住んでる。',
  (n, s) => n + 'がひとりで' + s.m + '回止めた。これチーム戦なんだけど。',
  (n, s) => n + '、次からは心の中でタップして。',
  (n, s) => n + '、リズム感、家に忘れてきてない？',
  (n, s) => n + '、そのタイミングでいけると思った理由を聞きたい。',
  (n, s) => n + 'がいなければ、あと何ラウンド進めたんだろうね。',
  (n, s) => n + '、練習より先に反省だと思う。',
  (n, s) => n + '、参加してくれてありがとう。本当にそれだけ。',
  (n, s) => n + 'のミス' + s.m + '回。もう妨害の域。',
  (n, s) => n + '、全員の足を' + s.m + '回引っ張った記録、残しておくね。',
];
function roastFor(name, s, round) {
  if (s.p === 0 && s.m > 0) return name + '、PERFECTが1回も出ていません。0回です。';
  if (s.m === 0) return name + '、悪くはない。ただ全員の中では最下位。';
  const i = (round * 7 + s.m * 13 + s.p * 3 + s.g) % ROASTS.length;
  return ROASTS[i](name, s);
}

/* ひとりずつの成績表：PERFECT / GOOD / ミス の回数と、MVP・最下位 */
function renderScoreboard(m) {
  const roster = m.roster || S.roster;
  const stats  = m.stats || {};
  const rows = roster.map(p => {
    const s = stats[p.id] || { p: 0, g: 0, m: 0 };
    return { p, s, pt: s.p * 3 + s.g - s.m * 2 };
  });
  const ranked = rows.slice().sort((a, b) => b.pt - a.pt || b.s.p - a.s.p || a.s.m - b.s.m);
  const mvp   = ranked.length >= 2 ? ranked[0] : null;
  const worst = ranked.length >= 2 ? ranked[ranked.length - 1] : null;

  const wrap = $('#r-acc');
  wrap.innerHTML = '';
  ranked.forEach((row) => {
    const c = COLORS[row.p.idx % COLORS.length] || COLORS[0];
    const el = document.createElement('div');
    el.className = 'sbrow' + (mvp && row === mvp ? ' is-mvp' : '') + (worst && row === worst ? ' is-worst' : '');
    el.style.setProperty('--c', c.hex);
    el.innerHTML =
      '<div class="sbname"><i></i>' + escapeHtml(row.p.name) +
        (mvp && row === mvp ? '<span class="badge mvp">MVP</span>' : '') + '</div>' +
      '<div class="sbn np">' + row.s.p + '</div>' +
      '<div class="sbn ng">' + row.s.g + '</div>' +
      '<div class="sbn nm">' + row.s.m + '</div>';
    wrap.appendChild(el);
  });

  $('#r-mvp').textContent = mvp
    ? 'MVP は ' + mvp.p.name + '。PERFECT ' + mvp.s.p + '回で、いちばんチームを引っ張った。'
    : '';
  const roastEl = $('#r-roast');
  if (worst && worst !== mvp) {
    roastEl.style.display = '';
    roastEl.textContent = '「' + roastFor(worst.p.name, worst.s, m.round) + '」';
  } else {
    roastEl.style.display = 'none';
  }
}

function endGame(m) {
  if (!S.game) return;
  S.game.over = true;
  cancelAnimationFrame(rafId);
  releaseWakeLock();
  S.lastResult = m;
  show('result');
  $('#vs-hud').style.display = 'none';

  if (m.vs) return endVersus(m);

  const rank = rankOf(m.round, m.speed_key || 'normal');
  $('#r-rank').textContent = rank;
  $('#r-rank').className = '';
  $('#r-mode').textContent = 'CO-OP · ' + (SPEEDS[m.speed_key] || SPEEDS.normal).label;
  $('#r-round').textContent = m.round;
  $('#r-combo').textContent = m.maxCombo;
  $('#r-speed').textContent = m.speed;
  $('#rl-1').textContent = 'SCORE';
  $('#rl-2').textContent = 'ROUNDS';
  $('#rl-3').textContent = 'MAX COMBO';
  $('#rl-4').textContent = 'FINAL SPEED';
  $('#sb-h1').textContent = 'PERFECT';
  $('#sb-h2').textContent = 'GOOD';
  $('#sb-h3').textContent = 'MISS';

  countUp($('#r-score'), m.score);
  renderScoreboard(m);

  const big = rank === 'S+' || rank === 'S' || rank === 'A';
  setTimeout(() => finale(big), 220);
}

function countUp(el, target) {
  const t0 = now(), dur = 900;
  const tick = () => {
    const k = clamp((now() - t0) / dur, 0, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) requestAnimationFrame(tick);
  };
  tick();
}

function finale(big) {
  if (big) {
    fxBurst(FX.w / 2, FX.h + 20, { n: 90, ang: -Math.PI / 2, spread: 1.0, speed: [750, 1600],
      life: [1.1, 2], size: [3, 8], colors: PAL.perfect.concat(PAL.good), shapes: ['conf', 'star'], g: 900, drag: 0.996 });
    fxRing(FX.w / 2, FX.h * 0.3, '#f4ff2b', Math.max(FX.w, FX.h) * 0.7, 12, 0.9);
    sndPerfect();
  } else {
    fxBurst(FX.w / 2, FX.h * 0.3, { n: 24, speed: [200, 600], life: [0.5, 1], size: [2, 5],
      colors: PAL.ok, shapes: ['spark', 'dot'], g: 800 });
  }
}

/* 対戦の結果画面 */
const VS_ROASTS = [
  (n, d) => n + '、' + d + 'ダメージも殴られて何してたの？',
  (n, d) => n + '、サンドバッグとしては優秀だった。',
  (n, d) => n + '、次は見学席から声援だけ送って。',
  (n, d) => n + 'の指、完全に他人のものだったね。',
  (n, d) => n + '、' + d + 'ダメージ。もはや献血。',
  (n, d) => n + '、相手が上手いんじゃない。あなたが遅い。',
  (n, d) => n + '、心の準備をしてる間に試合が終わってる。',
  (n, d) => n + '、今日はタイミングと和解できなかったね。',
];

function endVersus(m) {
  const me = Math.max(0, S.me.idx);
  const myTeam = m.team[me];
  const win = m.winner === myTeam;
  const draw = m.winner < 0;

  const rankEl = $('#r-rank');
  rankEl.textContent = draw ? 'DRAW' : (win ? 'WIN' : 'LOSE');
  rankEl.className = draw ? 'r-draw' : (win ? 'r-win' : 'r-lose');
  $('#r-mode').textContent = (m.ai ? '練習 · AI ' + m.ai.label : 'VERSUS') +
    ' · ' + (SPEEDS[m.speed_key] || SPEEDS.normal).label;

  $('#rl-1').textContent = '与えたダメージ';
  $('#rl-2').textContent = '受けたダメージ';
  $('#rl-3').textContent = 'ROUNDS';
  $('#rl-4').textContent = 'FINAL SPEED';
  $('#r-round').textContent = m.taken[me];
  $('#r-combo').textContent = m.round;
  $('#r-speed').textContent = m.speed;
  countUp($('#r-score'), m.dealt[me]);

  $('#sb-h1').textContent = '与ダメ';
  $('#sb-h2').textContent = '残りHP';
  $('#sb-h3').textContent = '被ダメ';

  const roster = m.roster || S.roster;
  const rows = roster.map(p => ({
    p, team: m.team[p.idx], dealt: m.dealt[p.idx], taken: m.taken[p.idx], hp: Math.max(0, m.hp[p.idx]),
  }));
  const ranked = rows.slice().sort((a, b) => b.dealt - a.dealt || a.taken - b.taken);
  const mvp = ranked.length >= 2 ? ranked[0] : null;
  const worst = ranked.length >= 2 ? ranked.slice().sort((a, b) => b.taken - a.taken)[0] : null;

  const wrap = $('#r-acc');
  wrap.innerHTML = '';
  ranked.forEach(row => {
    const c = COLORS[row.p.idx % COLORS.length] || COLORS[0];
    const el = document.createElement('div');
    el.className = 'sbrow' + (mvp && row === mvp ? ' is-mvp' : '') +
                   (worst && row === worst ? ' is-worst' : '') + (row.hp <= 0 ? ' is-ko' : '');
    el.style.setProperty('--c', c.hex);
    el.innerHTML =
      '<div class="sbname"><i></i>' + escapeHtml(row.p.name) +
        '<span class="teamtag t' + row.team + '">' + (row.team === 0 ? 'A' : 'B') + '</span>' +
        (mvp && row === mvp ? '<span class="badge mvp">MVP</span>' : '') + '</div>' +
      '<div class="sbn np">' + row.dealt + '</div>' +
      '<div class="sbn ng">' + row.hp + '</div>' +
      '<div class="sbn nm">' + row.taken + '</div>';
    wrap.appendChild(el);
  });

  $('#r-mvp').textContent = mvp
    ? 'MVP は ' + mvp.p.name + '。' + mvp.dealt + 'ダメージを叩き込んだ。'
    : '';
  const roastEl = $('#r-roast');
  if (worst && worst !== mvp && worst.taken > 0) {
    roastEl.style.display = '';
    const i = (m.round * 5 + worst.taken) % VS_ROASTS.length;
    roastEl.textContent = '「' + VS_ROASTS[i](worst.p.name, worst.taken) + '」';
  } else roastEl.style.display = 'none';

  setTimeout(() => finale(win), 220);
}

/* ---------- ルーム退出 ---------- */
function leaveRoom(silent) {
  if (S.isHost && !silent) pub('ctrl', { type: 'closed' });
  try { if (S.client && S.code) S.client.unsubscribe(topicBase() + '/#'); } catch (e) {}
  cancelAnimationFrame(rafId);
  releaseWakeLock();
  S.code = null; S.isHost = false; S.practice = false; S.roster = []; S.presence.clear();
  S.game = null; S.me.idx = -1;
  S.bestRtt = Infinity; S.offset = 0; S.synced = false; S.syncCount = 0;
  lastRenderRound = -1; tickedFor = -1;
  show('title');
}

/* ---------- 画面ロック ---------- */
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function releaseWakeLock() { try { S.wakeLock && S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }

/* ---------- Service Worker（更新を自動で全端末に配る） ---------- */
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    reg.update().catch(() => {});
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch(() => {});

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || inGame()) return;
    reloaded = true;
    location.reload();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    navigator.serviceWorker.getRegistration()
      .then(r => r && r.update().catch(() => {})).catch(() => {});
  });
}

/* =========================================================
   あそびかた（起動時にかぶせる説明）
   ========================================================= */
const HOWTO_KEY = 'st_howto_off';   // '1' なら次回から出さない
let htPage = 0;

function htPages() { return $$('#howto .ht-page'); }

function htRender() {
  const pages = htPages();
  const last = htPage >= pages.length - 1;
  pages.forEach((p, i) => p.classList.toggle('on', i === htPage));
  $$('#ht-dots i').forEach((d, i) => d.classList.toggle('on', i === htPage));
  $('#ht-step').textContent = 'あそびかた ' + (htPage + 1) + ' / ' + pages.length;
  $('#ht-next').textContent = last ? 'はじめる' : '次へ';
  $('#ht-skip').style.display = last ? 'none' : '';   // 最後は「はじめる」を全幅で
  $('.ht-body').scrollTop = 0;
}

function openHowto(page) {
  htPage = page || 0;
  $('#ht-never').checked = lsGet(HOWTO_KEY) === '1';
  htRender();
  $('#howto').classList.add('on');
}

function closeHowto() {
  lsSet(HOWTO_KEY, $('#ht-never').checked ? '1' : '0');
  $('#howto').classList.remove('on');
  // 続けて「ホーム画面に追加」の案内（必要な人にだけ出る）
  setTimeout(() => { if (S.screen === 'title') maybeShowAddHome(); }, 260);
}

function bindHowto() {
  $('#ht-close').addEventListener('click', closeHowto);
  $('#ht-skip').addEventListener('click', closeHowto);
  $('#ht-next').addEventListener('click', () => {
    if (htPage >= htPages().length - 1) { closeHowto(); return; }
    htPage++; htRender();
  });
  // カードの外側をタップしても閉じる
  $('#howto').addEventListener('click', (e) => { if (e.target.id === 'howto') closeHowto(); });
  document.addEventListener('keydown', (e) => {
    if (!$('#howto').classList.contains('on')) return;
    if (e.key === 'Escape') closeHowto();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') $('#ht-next').click();
    else if (e.key === 'ArrowLeft' && htPage > 0) { htPage--; htRender(); }
  });
  $('#btn-howto').addEventListener('click', () => openHowto(0));
}

/* =========================================================
   ホーム画面に追加のおすすめ

   共有リンクから初めて来た人に、まず「アプリにする方法」を見せる。
   端末とブラウザによって手順が違うので、その場に合った案内だけを出す。
   ========================================================= */
const A2HS_KEY   = 'st_a2hs';                 // 'done'=もう出さない / 数値=「あとで」を押した時刻
const A2HS_AGAIN = 7 * 24 * 60 * 60 * 1000;   // 「あとで」なら1週間後にもう一度
let installPrompt = null;                     // Android/PC の「インストール」イベント
let a2hsWelcome  = false;                     // 共有リンクからブラウザに来た直後かどうか
let pendingHowto = false;                     // 案内を閉じたあとに「あそびかた」を出すか

const SHARE_ICON =
  '<svg width="14" height="16" viewBox="0 0 15 17" fill="none" stroke="#f4ff2b" ' +
  'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M7.5 1.4v9"/><path d="M4.4 4.3 7.5 1.2 10.6 4.3"/>' +
  '<path d="M3.6 7.4H2.4v8.2h10.2V7.4h-1.2"/></svg>';
const DOTS_ICON =
  '<svg width="5" height="16" viewBox="0 0 5 17" fill="#f4ff2b">' +
  '<circle cx="2.5" cy="3" r="1.7"/><circle cx="2.5" cy="8.5" r="1.7"/>' +
  '<circle cx="2.5" cy="14" r="1.7"/></svg>';

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
/* LINEなどアプリ内ブラウザで開かれているか。
   この状態ではホーム画面に追加できないので、先に外のブラウザへ出てもらう必要がある。 */
function inAppBrowser() {
  const ua = navigator.userAgent;
  if (/\bLine\//i.test(ua))          return 'LINE';
  if (/Instagram/i.test(ua))         return 'Instagram';
  if (/FBAN|FBAV|FB_IAB/i.test(ua))  return 'Facebook';
  if (/Twitter/i.test(ua))           return 'X';
  if (/MicroMessenger/i.test(ua))    return 'WeChat';
  if (/KAKAOTALK/i.test(ua))         return 'カカオトーク';
  return null;
}
/* 共有用のURL。LINEはこの印を付けておくと、アプリ内ではなく外のブラウザで開いてくれる。
   ただし効くのは「トークに貼られたリンクを直接タップした時」だけで、
   転送されたリンクや長押しから開いた場合は無視される。だから下の脱出手段も用意する。 */
function shareUrl(code) {
  const base = location.origin + location.pathname;
  return base + '?' + (code ? 'code=' + code + '&' : '') + 'openExternalBrowser=1';
}

/* アプリ内ブラウザから外のブラウザへ抜け出す。
   Android は intent:// で標準ブラウザを直接起動できる（ほぼ確実）。
   iOS は x-safari-https:// が通ることがある（通らない端末もあるので手順も併記する）。 */
function escapeToBrowser() {
  const p = platformOf();
  const plain = location.origin + location.pathname;
  try {
    if (p === 'android') {
      location.href = 'intent://' + location.host + location.pathname +
        '#Intent;scheme=https;S.browser_fallback_url=' + encodeURIComponent(plain) + ';end';
    } else {
      location.href = 'x-safari-' + plain;      // x-safari-https://...
    }
  } catch (e) {}
  setTimeout(() => {
    if (!document.hidden) toast('開かないときは、下の手順で開いてください');
  }, 1800);
}

function platformOf() {
  const ua = navigator.userAgent;
  const iOS = /iphone|ipad|ipod/i.test(ua) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) {
    if (/CriOS/i.test(ua)) return 'ios-chrome';
    if (/FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  return /android/i.test(ua) ? 'android' : 'pc';
}

function a2hsSteps() {
  const p = platformOf();
  const app = inAppBrowser();

  // LINEなどの中で開いている場合は、まず外のブラウザへ出てもらう
  if (app) {
    const menu = p === 'android'
      ? '画面<b>右下のメニュー</b> ' + DOTS_ICON + ' をタップ'
      : '画面<b>右下の三本線</b>（機種により「…」）をタップ';
    const label = p === 'android'
      ? '<b>「ブラウザで開く」</b>または<b>「他のアプリで開く」</b>'
      : '<b>「Safariで開く」</b>または<b>「ブラウザで開く」</b>';
    return {
      title: 'まず、' + app + 'の外で開いてください',
      sub: app + 'の中で開いたままだと、ホーム画面に追加できません。<br>' +
           'ブラウザで開き直せば、あとは数秒で終わります。',
      main: 'ブラウザで開く', escape: true, sub2: 'URLをコピーする',
      steps: [
        '下の<b>「ブラウザで開く」</b>を押す（これで開けば完了）',
        menu,
        'メニューの中の' + label + 'を選ぶ',
        'ブラウザで開いたら、画面いちばん下の<b>「ホーム画面に追加する方法」</b>をタップ。続きの手順が出ます',
      ],
      note: '1でうまくいかないときは 2〜3 の手動の手順で。' +
            'それも無理なら「URLをコピーする」でコピーして、ブラウザのアドレス欄に貼り付けてください。',
    };
  }

  if (installPrompt) {
    return { main: 'ホーム画面に追加', steps: [
      'このまま下の<b>「ホーム画面に追加」</b>を押すだけで終わります。',
      '確認が出たら<b>「インストール」</b>を選んでください。',
    ], note: 'あとから消したくなったら、普通のアプリと同じ手順で削除できます。' };
  }
  if (p === 'ios-safari') {
    return { main: 'やり方はわかった', steps: [
      '画面の下（機種によっては上）にある共有ボタン ' + SHARE_ICON + ' をタップ',
      'メニューを下にスクロールして<b>「ホーム画面に追加」</b>をタップ',
      '右上の<b>「追加」</b>をタップ。これで完了です',
    ], note: 'ホーム画面に「せーの!!」のアイコンが増えます。' };
  }
  if (p === 'ios-chrome') {
    return { main: 'やり方はわかった', steps: [
      '画面右上の共有ボタン ' + SHARE_ICON + ' をタップ',
      '<b>「ホーム画面に追加」</b>をタップ',
      '<b>「追加」</b>をタップして完了',
    ], note: 'うまくいかないときは Safari で開き直すと確実です。' };
  }
  if (p === 'ios-other') {
    return { main: 'URLをコピーする', copy: true, steps: [
      'このブラウザではホーム画面に追加できません',
      '下のボタンでURLをコピーして、<b>Safari</b>で開き直してください',
      'Safariの共有ボタン ' + SHARE_ICON + ' →<b>「ホーム画面に追加」</b>',
    ], note: 'iPhoneはSafariからだけアプリ化できる仕組みになっています。' };
  }
  if (p === 'android') {
    return { main: 'やり方はわかった', steps: [
      '画面右上のメニュー ' + DOTS_ICON + ' をタップ',
      '<b>「アプリをインストール」</b>または<b>「ホーム画面に追加」</b>をタップ',
      '確認画面で<b>「インストール」</b>をタップ',
    ], note: 'メニューに出てこないときは、少し遊んでからもう一度開いてみてください。' };
  }
  return { main: 'やり方はわかった', steps: [
    'アドレスバーの右端にある<b>インストールのアイコン</b>をクリック',
    '出てきた確認で<b>「インストール」</b>をクリック',
    'デスクトップのアプリとして開けるようになります',
  ], note: 'Chrome または Edge で使えます。' };
}

function renderAddHome() {
  const s = a2hsSteps();
  $('#ah-title').innerHTML = s.title || (a2hsWelcome
    ? 'ブラウザで開けました。ホーム画面に追加しますか？'
    : 'ホーム画面に追加すると、アプリになります');
  $('#ah-sub').innerHTML = s.sub || (a2hsWelcome
    ? '追加しておくと、次からLINEを開かなくても1タップで始められます。<br>' +
      'インストール不要・数秒で終わります。'
    : '毎回リンクを探さなくてよくなり、全画面で遊べます。<br>インストール不要・数秒で終わります。');
  $('#ah-steps').innerHTML = s.steps.map((t, i) =>
    '<div class="ah-step"><div class="ah-num">' + (i + 1) + '</div><div>' + t + '</div></div>').join('') +
    '<p class="ah-note">' + s.note + '</p>';
  $('#ah-main').textContent = s.main;
  $('#ah-main').dataset.act = s.escape ? 'escape' : (s.copy ? 'copy' : '');
  const s2 = $('#ah-sub2');
  s2.style.display = s.sub2 ? '' : 'none';
  if (s.sub2) s2.textContent = s.sub2;
  // iPhoneのSafariは共有ボタンが画面の下にあるので、矢印で場所を示す
  $('#ah-arrow').style.display = (!inAppBrowser() && platformOf() === 'ios-safari') ? '' : 'none';
}

async function copyShareUrl() {
  const url = shareUrl(null);
  try {
    await navigator.clipboard.writeText(url);
    toast('URLをコピーしました');
  } catch (e) {
    prompt('このURLをコピーして、ブラウザで開いてください', url);
  }
}
function openAddHome(welcome) {
  a2hsWelcome = !!welcome;
  renderAddHome();
  $('#addhome').classList.add('on');
}
function closeAddHome(done) {
  lsSet(A2HS_KEY, done ? 'done' : String(Date.now()));
  $('#addhome').classList.remove('on');
  a2hsWelcome = false;
  if (pendingHowto) { pendingHowto = false; setTimeout(() => openHowto(0), 260); }
}
/* 案内を出してよい状態か（アプリとして開いている・すでに済ませた人には出さない） */
function a2hsWanted() {
  if (isStandalone()) return false;
  const v = lsGet(A2HS_KEY);
  if (v === 'done') return false;
  if (v && Date.now() - (+v) < A2HS_AGAIN) return false;
  return true;
}
function maybeShowAddHome(welcome) {
  if (a2hsWanted()) openAddHome(welcome);
}
function bindAddHome() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    if ($('#addhome').classList.contains('on')) renderAddHome();   // 案内を差し替える
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    closeAddHome(true);
    toast('ホーム画面に追加しました');
  });
  $('#ah-sub2').addEventListener('click', copyShareUrl);
  $('#inapp-note').addEventListener('click', () => openAddHome(false));
  $('#ah-main').addEventListener('click', async () => {
    const act = $('#ah-main').dataset.act;
    if (act === 'escape') { escapeToBrowser(); return; }
    if (act === 'copy')   { await copyShareUrl(); return; }   // 閉じずにコピーだけ
    if (installPrompt) {
      const p = installPrompt; installPrompt = null;
      try { p.prompt(); await p.userChoice; } catch (e) {}
    }
    closeAddHome(true);
  });
  $('#ah-later').addEventListener('click', () => closeAddHome(false));
  $('#ah-close').addEventListener('click', () => closeAddHome(false));
  $('#addhome').addEventListener('click', (e) => { if (e.target.id === 'addhome') closeAddHome(false); });
  $('#a2hs-link').addEventListener('click', () => openAddHome(false));
}

/* =========================================================
   起動
   ========================================================= */
function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('b')) BROKERS.unshift({ label: 'LOCAL', url: params.get('b') });
  LAG = Math.max(0, Math.min(2000, +(params.get('lag') || 0)));

  const savedName = lsGet('st_name') || '';
  $('#in-name').value = params.get('name') || savedName || '';
  if (params.get('code')) $('#in-code').value = params.get('code');

  $('#build-stamp').textContent = 'ver ' + BUILD;
  if (isStandalone()) $('#a2hs').style.display = 'none';
  const app = inAppBrowser();
  if (app && !isStandalone()) {
    $('#a2hs-link').textContent = app + 'の中で開いています → ブラウザで開く方法';
    $('#a2hs').classList.add('warn');
    $('#inapp-title').textContent = app + ' の中で開いています';
    $('#inapp-note').style.display = '';        // ロゴのすぐ下にも出す
  }

  const bs = $('#broker-select');
  BROKERS.forEach((b, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = '通信経路 ' + b.label;
    bs.appendChild(o);
  });
  bs.addEventListener('change', () => connectBroker(+bs.value, null, () => tryNextBroker(+bs.value)));

  $('#btn-create').addEventListener('click', () => enterRoom(roomCode(), true));
  $('#btn-join').addEventListener('click', () => {
    const c = ($('#in-code').value || '').trim();
    if (!/^\d{4}$/.test(c)) { toast('4桁の数字を入れてください'); return; }
    enterRoom(c, false);
  });
  $('#btn-start').addEventListener('click', hostStart);
  $('#btn-leave').addEventListener('click', () => leaveRoom());
  $('#btn-resync').addEventListener('click', () => { resetSync(); toast('もう一度、時計を測り直します'); });
  $('#btn-home').addEventListener('click', () => leaveRoom());
  $('#btn-again').addEventListener('click', () => {
    S.game = null; lastRenderRound = -1; tickedFor = -1;
    if (S.practice) { openPractice(); return; }   // 練習は強さを選び直せるように
    show('lobby'); renderLobby();
  });

  $('#btn-practice').addEventListener('click', openPractice);
  $('#btn-practice-back').addEventListener('click', () => { S.practice = false; show('title'); });
  $('#btn-practice-start').addEventListener('click', startPractice);
  $$('#ai-levels .prcard').forEach(el =>
    el.addEventListener('click', () => setAiLevel(el.dataset.lv)));
  $('#pr-speed-normal').addEventListener('click', () => setPrSpeed('normal'));
  $('#pr-speed-oni').addEventListener('click', () => setPrSpeed('oni'));
  $('#play-coop').addEventListener('click', () => setPlay('coop'));
  $('#play-versus').addEventListener('click', () => setPlay('versus'));
  $('#speed-normal').addEventListener('click', () => setSpeed('normal'));
  $('#speed-oni').addEventListener('click', () => setSpeed('oni'));
  $('#btn-copy').addEventListener('click', async () => {
    const url = shareUrl(S.code);   // LINEで送っても外のブラウザで開くようにしておく
    try { await navigator.clipboard.writeText(url); toast('参加URLをコピーしました'); }
    catch (e) { prompt('このURLを友だちに送ってください', url); }
  });

  bindHowto();
  bindAddHome();
  // 「次回からは表示しない」にチェックが入っていなければ、起動のたびに出す
  const seen = lsGet(HOWTO_KEY) === '1';
  const skipIntro = !!params.get('nohowto');           // 検証用：かぶせる画面を全部出さない
  // LINEなどから外のブラウザに飛んできた直後は、その場で追加してもらうのがいちばん通じる
  const fromShare = params.has('openExternalBrowser');
  if (skipIntro) { /* 何も出さない */ }
  else if (fromShare && a2hsWanted()) { pendingHowto = !seen; openAddHome(true); }
  else if (!seen) openHowto(0);
  else maybeShowAddHome();                             // 2回目以降はこちらだけ

  bgmInit();
  fxInit();
  bindInput();
  setInterval(calibrateAudio, 5000);
  startHeartbeat();
  startSyncLoop();
  setInterval(pruneRoster, 1500);
  registerSW();
  connectBroker(0, null, () => tryNextBroker(0));
}

function tryNextBroker(failedIdx) {
  const next = failedIdx + 1;
  if (next < BROKERS.length) {
    $('#broker-select').value = next;
    connectBroker(next, null, () => tryNextBroker(next));
  } else setNetStatus('全経路に接続できません', 'ng');
}

function enterRoom(code, asHost) {
  const name = ($('#in-name').value || '').trim() || ('プレイヤー' + ((Math.random() * 90 + 10) | 0));
  S.me.name = name;
  lsSet('st_name', name);
  S.code = code;
  S.isHost = asHost;
  initAudio();

  bgmPrefetch(['play', 'oni']);

  const go = () => {
    subRoom();
    if (asHost) {
      S.roster = [{ id: S.me.id, name: S.me.name, idx: 0 }];
      S.me.idx = 0;
      S.synced = true;
    }
    show('lobby');
    renderLobby();
    if (asHost) broadcastRoster();
    pub('presence', { id: S.me.id, name: S.me.name, host: S.isHost, synced: S.synced, rtt: null });
  };

  if (S.connected) go();
  else connectBroker(S.brokerIdx, go, () => tryNextBroker(S.brokerIdx));
}

/* 起動中に何かで落ちても、真っ暗な画面のまま放置しないための保険。
   何が起きたかを画面に出して、リロードだけはできるようにする。 */
function bootSafe() {
  try { boot(); }
  catch (err) {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:999;background:#0b0610;color:#fff3fa;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;' +
      'padding:28px;text-align:center;font-size:14px;line-height:1.9';
    d.innerHTML = '<b style="font-size:18px">うまく起動できませんでした</b>' +
      '<div style="color:#a487ad;font-size:12px">' + escapeHtml(String(err && err.message || err)) + '</div>' +
      '<button style="width:auto;padding:14px 28px;border-radius:999px;border:0;background:#f4ff2b;' +
      'color:#1a1004;font-weight:900;font-size:15px" onclick="location.reload()">読み込み直す</button>';
    document.body.appendChild(d);
  }
}
window.addEventListener('DOMContentLoaded', bootSafe);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  calibrateAudio();
  resetSync();
});

window.__SYNCTAP = { S, instructionOf, insOf, toHost, toLocal, now, COLORS, PLAYS, SPEEDS, VS,
                     celebrate, showVerdict, failEffect, BGM };
