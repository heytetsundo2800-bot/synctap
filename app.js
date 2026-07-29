/* =========================================================
   シンクロ・タップ  /  SYNC TAP
   3〜10人が同室・各自スマホ・リアルタイム同期タップゲーム
   ========================================================= */

/* ---------- 定数 ---------- */
const VERSION = 'v1.0';
const BUILD   = '2026-07-29 22:10';   // 更新したらここも変える（タイトル画面下に出る）
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

/* モード：lv0 が大きいほど最初から速く・判定も厳しい */
const MODES = {
  normal: { key: 'normal', name: 'ふつう',   label: 'NORMAL', lv0: 0,  lives: 5, tutorial: 3 },
  oni:    { key: 'oni',    name: '鬼モード', label: 'ONI',    lv0: 30, lives: 3, tutorial: 0 },
};

const WIN_BASE    = 200;  // 成功と認める最大ズレ(ms)：レベルが上がるほど狭くなる
// 人数が増えるほど「全員そろう」難易度が跳ね上がるので、その分だけ判定を広げる
const WIN_OF      = (lv, n) => Math.round(
  Math.max(85, WIN_BASE - 2.2 * lv) * (1 + 0.045 * Math.max(0, (n || 3) - 3))
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
const intervalOf = (lv) => Math.max(520, 2000 - 35 * lv);
const SPEED_OF   = (lv) => Math.round(60000 / intervalOf(lv));

const DIRS = [
  { key: 'up',    label: '↑', jp: '上' },
  { key: 'down',  label: '↓', jp: '下' },
  { key: 'left',  label: '←', jp: '左' },
  { key: 'right', label: '→', jp: '右' },
];

// 指示は seed とラウンド番号だけで決まる ＝ 通信なしで全端末が一致する
function instructionOf(seed, i, nPlayers, tutorial) {
  if (i < (tutorial || 0)) return { type: 'ALL_TAP' };
  const r = rngFor(seed, i);
  const roll = r();
  if (roll < 0.40) return { type: 'ALL_TAP' };
  if (roll < 0.65) return { type: 'SOLO_TAP', who: Math.floor(r() * nPlayers) };
  if (roll < 0.85) return { type: 'SWIPE', dir: DIRS[Math.floor(r() * 4)].key };
  return { type: 'NO_TAP' };
}
const needsSwipe = (ins) => ins.type === 'SWIPE';

/* ---------- 状態 ---------- */
const S = {
  screen: 'title',
  brokerIdx: 0,
  client: null,
  connected: false,
  code: null,
  isHost: false,
  mode: 'normal',
  me: { id: 'st_' + uid(), name: '', idx: -1 },
  roster: [],
  presence: new Map(),
  offset: 0,             // hostClock = localClock + offset
  bestRtt: Infinity,
  syncCount: 0,
  synced: false,
  game: null,
  lastResult: null,
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

const PAL = {
  perfect: ['#ffd23f', '#ffae00', '#fff3b0', '#ff8a3d', '#ffffff'],
  good:    ['#39d98a', '#7cffc4', '#ffffff', '#2ee6a8'],
  ok:      ['#4dabff', '#9fd2ff', '#ffffff'],
  bad:     ['#ff3d6b', '#ff7a8f', '#8c1030'],
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

function pub(suffix, obj) {
  if (!S.client || !S.connected || !S.code) return;
  S.client.publish(topicBase() + '/' + suffix, JSON.stringify(obj), { qos: 0 });
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
      playing: inGame(),
    });
  }, 900);
}

function onPresence(m) {
  if (m.id === S.me.id) return;
  S.presence.set(m.id, { t: now(), name: m.name, synced: m.synced, rtt: m.rtt, host: m.host });
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
  if (!S.isHost || inGame()) return;
  const before = S.roster.length;
  S.roster = S.roster.filter(p => {
    if (p.id === S.me.id) return true;
    const pr = S.presence.get(p.id);
    return pr && (now() - pr.t) < 5000;
  });
  S.roster.forEach((p, i) => p.idx = i);
  if (S.roster.length !== before) { broadcastRoster(); renderLobby(); }
}

/* ---------- 時計同期 ---------- */
function startSyncLoop() {
  setInterval(() => {
    if (!S.connected || !S.code || S.isHost) return;
    if (document.hidden || inGame()) return;   // 裏に回っている間の計測は当てにならない
    if (S.syncCount > 3000) return;
    S.syncCount++;
    pub('sync/req', { id: S.me.id, t0: now() });
  }, 140);
}
function resetSync() {
  if (S.isHost || inGame()) return;
  S.bestRtt = Infinity; S.offset = 0; S.synced = false; S.syncCount = 0;
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
  if (rtt < S.bestRtt) {
    S.bestRtt = rtt;
    S.offset  = m.t1 - (m.t0 + t2) / 2;
    S.synced  = S.bestRtt < 400;
  }
  if (S.screen === 'lobby') renderLobby();
}
function syncQuality() {
  if (S.isHost) return { label: '基準端末', cls: 'ok' };
  if (!isFinite(S.bestRtt)) return { label: '計測中…', cls: 'wait' };
  const ms = Math.round(S.bestRtt / 2);
  if (ms <= 30)  return { label: '±' + ms + 'ms／優秀', cls: 'ok' };
  if (ms <= 60)  return { label: '±' + ms + 'ms／問題なし', cls: 'ok' };
  if (ms <= 120) return { label: '±' + ms + 'ms／やや不安', cls: 'warn' };
  return { label: '±' + ms + 'ms／要改善', cls: 'ng' };
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
   画面
   ========================================================= */
function show(screen) {
  S.screen = screen;
  $$('.screen').forEach(el => el.classList.toggle('on', el.id === 'sc-' + screen));
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
      const okSync = p.id === S.me.id ? (S.isHost || S.synced) : !!(S.presence.get(p.id) || {}).synced;
      div.innerHTML =
        '<div class="pdot"></div>' +
        '<div class="pname">' + escapeHtml(p.name) + (p.id === S.me.id ? '<span class="youtag">あなた</span>' : '') + '</div>' +
        '<div class="pmeta">' + c.name + ' / ' + (okSync ? '同期OK' : '同期中…') + '</div>';
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
    btn.disabled = !(n >= MIN_PLAYERS && allSynced);
    btn.textContent = n + '人で開始する';
    btn.className = S.mode === 'oni' ? 'hot' : '';
    $('#host-note').textContent = !allSynced ? '同期が終わるまで待ってください'
      : (n < 3 ? '※ ' + n + '人でも開始できます（動作確認用）'
               : 'あと' + (MAX_PLAYERS - n) + '人まで参加できます');
  } else {
    btn.style.display = 'none';
    $('#host-note').textContent = 'ホストの開始を待っています…';
  }
}

function setMode(k) {
  S.mode = k;
  $('#mode-normal').classList.toggle('on', k === 'normal');
  $('#mode-oni').classList.toggle('on', k === 'oni');
  if (S.screen === 'lobby') renderLobby();
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
    startGame(m.seed, m.startAt, m.roster, m.mode);
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
  const startAt = now() + 1200;
  const payload = { type: 'start', seed, startAt, roster: S.roster, mode: S.mode };
  pub('ctrl', payload);
  startGame(seed, startAt, S.roster, S.mode);
}

function startGame(seed, startAtHost, roster, modeKey) {
  const M = MODES[modeKey] || MODES.normal;
  S.roster = roster || S.roster;
  const me = S.roster.find(p => p.id === S.me.id);
  S.me.idx = me ? me.idx : -1;

  // このモードでのラウンド目標時刻を作る
  const at = new Array(MAX_ROUNDS);
  let t = LEAD_IN;
  for (let i = 0; i < MAX_ROUNDS; i++) { at[i] = t; t += intervalOf(M.lv0 + i); }

  S.game = {
    seed, startAtHost, M, at,
    lv: (i) => M.lv0 + i,
    n: S.roster.length,
    lives: M.lives, combo: 0, maxCombo: 0, score: 0,
    round: 0, over: false, armed: -1,
    localVerdict: {}, inbox: {}, judged: -1, stats: {},
  };
  // ひとりずつの PERFECT / GOOD / ミス の回数
  S.roster.forEach(p => { S.game.stats[p.id] = { p: 0, g: 0, m: 0 }; });

  lastRenderRound = -1; tickedFor = -1;
  initAudio(); calibrateAudio();
  requestWakeLock();

  $('#play-root').style.setProperty('--me', COLORS[Math.max(0, S.me.idx) % COLORS.length].hex);
  $('#play-root').classList.remove('fever');
  $('#hud-mode').textContent = M.label;
  $('#combo').classList.add('hidden');
  $('#verdict').className = '';
  $('#gain').className = '';
  show('play');
  loop();
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

    const ins = instructionOf(g.seed, cur, g.n, g.M.tutorial);
    if (g.armed !== cur) { g.armed = cur; armInput(ins); scheduleTick(cur, target); }

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
  const ins = instructionOf(g.seed, round, g.n, g.M.tutorial);

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
    if (rel < g.at[r] + JUDGE_DELAY) break;
    g.judged = r;
    judgeRound(r);
    if (g.over) break;
  }
}

function judgeRound(r) {
  const g = S.game;
  const ins = instructionOf(g.seed, r, g.n, g.M.tutorial);
  const items = g.inbox[r] || [];
  const target = g.startAtHost + g.at[r];
  const W = WIN_OF(g.lv(r), g.n);

  const byPlayer = {};
  S.roster.forEach(p => { byPlayer[p.id] = null; });
  items.forEach(it => {
    const d = it.t - target;
    if (d < -GUARD_PRE || d > GUARD_POST + W) return;
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
    if (g.M.key === 'oni') gain = Math.round(gain * 1.5);
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
                   speed: SPEED_OF(g.lv(r)), stats: g.stats, roster: S.roster, mode: g.M.key };
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
    fxRing(cx, cy, '#ffd23f', Math.max(FX.w, FX.h) * 0.62, 12, 0.72);
    fxRing(cx, cy, '#ffffff', Math.max(FX.w, FX.h) * 0.5, 7, 0.66, 0.08);
    fxRing(cx, cy, '#ff8a3d', Math.max(FX.w, FX.h) * 0.44, 5, 0.6, 0.16);
    fxBurst(cx, cy, { n: 64, speed: [320, 1050], life: [0.5, 1.15], size: [2, 5],
                      colors: PAL.perfect, shapes: ['spark', 'star', 'dot'], g: 820 });
    fxBurst(cx, FX.h + 20, { n: 46, ang: -Math.PI / 2, spread: 0.62, speed: [700, 1350],
                      life: [0.9, 1.6], size: [3, 7], colors: PAL.perfect, shapes: ['conf'], g: 900, drag: 0.995 });
    sndPerfect(); buzz([0, 16, 36, 26]);
  } else if (tier === 'good') {
    flash('good');
    fxRing(cx, cy, '#39d98a', Math.max(FX.w, FX.h) * 0.42, 8, 0.55);
    fxBurst(cx, cy, { n: 30, speed: [240, 720], life: [0.36, 0.8], size: [2, 4],
                      colors: PAL.good, shapes: ['spark', 'dot'], g: 760 });
    sndGood(); buzz(18);
  } else {
    flash('ok');
    fxRing(cx, cy, '#4dabff', Math.max(FX.w, FX.h) * 0.3, 6, 0.45);
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
    fxRing(cx, FX.h * 0.5, '#ffd23f', Math.max(FX.w, FX.h) * 0.8, 14, 0.9);
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

/* ---------- プレイ画面の描画 ---------- */
let lastRenderRound = -1;
function renderPlay(round, ins, prog, remain) {
  const g = S.game;
  const myIdx = Math.max(0, S.me.idx);

  if (round !== lastRenderRound) {
    lastRenderRound = round;
    const box = $('#instr');
    let main = '', sub = '', cls = '';
    const all = g.n + '人いっせいに';
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

  let hearts = '';
  for (let i = 0; i < g.M.lives; i++) hearts += '<span class="' + (i < g.lives ? 'on' : 'off') + '">♥</span>';
  $('#hud-lives').innerHTML = hearts;
  $('#hud-score').textContent = g.score.toLocaleString();
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

  const rank = rankOf(m.round, m.mode);
  $('#r-rank').textContent = rank;
  $('#r-mode').textContent = (MODES[m.mode] || MODES.normal).label;
  $('#r-round').textContent = m.round;
  $('#r-combo').textContent = m.maxCombo;
  $('#r-speed').textContent = m.speed;

  // スコアはカウントアップ
  const el = $('#r-score');
  const target = m.score, t0 = now();
  const dur = 900;
  const tickUp = () => {
    const k = clamp((now() - t0) / dur, 0, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) requestAnimationFrame(tickUp);
  };
  tickUp();

  renderScoreboard(m);

  // ランクが高いほど派手に祝う
  const big = rank === 'S+' || rank === 'S' || rank === 'A';
  setTimeout(() => {
    if (big) {
      fxBurst(FX.w / 2, FX.h + 20, { n: 90, ang: -Math.PI / 2, spread: 1.0, speed: [750, 1600],
        life: [1.1, 2], size: [3, 8], colors: PAL.perfect.concat(PAL.good), shapes: ['conf', 'star'], g: 900, drag: 0.996 });
      fxRing(FX.w / 2, FX.h * 0.3, '#ffd23f', Math.max(FX.w, FX.h) * 0.7, 12, 0.9);
      sndPerfect();
    } else {
      fxBurst(FX.w / 2, FX.h * 0.3, { n: 24, speed: [200, 600], life: [0.5, 1], size: [2, 5],
        colors: PAL.ok, shapes: ['spark', 'dot'], g: 800 });
    }
  }, 220);
}

/* ---------- ルーム退出 ---------- */
function leaveRoom(silent) {
  if (S.isHost && !silent) pub('ctrl', { type: 'closed' });
  try { if (S.client && S.code) S.client.unsubscribe(topicBase() + '/#'); } catch (e) {}
  cancelAnimationFrame(rafId);
  releaseWakeLock();
  S.code = null; S.isHost = false; S.roster = []; S.presence.clear();
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
   起動
   ========================================================= */
function boot() {
  const params = new URLSearchParams(location.search);
  if (params.get('b')) BROKERS.unshift({ label: 'LOCAL', url: params.get('b') });

  const savedName = localStorage.getItem('st_name') || '';
  $('#in-name').value = params.get('name') || savedName || '';
  if (params.get('code')) $('#in-code').value = params.get('code');

  $('#build-stamp').textContent = 'ver ' + BUILD;
  if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    $('#a2hs').style.display = 'none';
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
  $('#btn-home').addEventListener('click', () => leaveRoom());
  $('#btn-again').addEventListener('click', () => {
    S.game = null; lastRenderRound = -1; tickedFor = -1;
    show('lobby'); renderLobby();
  });
  $('#mode-normal').addEventListener('click', () => setMode('normal'));
  $('#mode-oni').addEventListener('click', () => setMode('oni'));
  $('#btn-copy').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?code=' + S.code;
    try { await navigator.clipboard.writeText(url); toast('参加URLをコピーしました'); }
    catch (e) { prompt('このURLを2人に送ってください', url); }
  });

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
  localStorage.setItem('st_name', name);
  S.code = code;
  S.isHost = asHost;
  initAudio();

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

window.addEventListener('DOMContentLoaded', boot);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  calibrateAudio();
  resetSync();
});

window.__SYNCTAP = { S, instructionOf, toHost, toLocal, now, COLORS, MODES,
                     celebrate, showVerdict, failEffect };
