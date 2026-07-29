/* =========================================================
   シンクロ・タップ  /  SYNC TAP
   3人同室・各自スマホ・リアルタイム同期タップゲーム
   ========================================================= */

/* ---------- 定数 ---------- */
const VERSION = 'v1.0';
const BUILD   = '2026-07-29 20:20';   // 更新したらここも変える（画面下に出る）
const BROKERS = [
  { label: 'A',  url: 'wss://broker.emqx.io:8084/mqtt' },
  { label: 'B',  url: 'wss://broker.hivemq.com:8884/mqtt' },
  { label: 'C',  url: 'wss://test.mosquitto.org:8081/mqtt' },
];
const COLORS = [
  { key: 'R', name: 'レッド',  hex: '#ff4d6d' },
  { key: 'B', name: 'ブルー',  hex: '#4dabff' },
  { key: 'Y', name: 'イエロー', hex: '#ffd23f' },
];
const MAX_PLAYERS = 3;
const LIVES = 5;

const WIN_BASE    = 200;  // 成功と認める最大ズレ(ms)：ラウンドが進むほど狭くなる
const WIN_OF      = (i) => Math.max(85, Math.round(WIN_BASE - 2.2 * i));
const GUARD_PRE   = 700;  // 「触るな」系の禁止区間 開始(ms前)
const GUARD_POST  = 300;  // 同 終了(ms後)
const JUDGE_DELAY = 380;  // ラウンド判定を確定させるまでの猶予(ms)

const LEAD_IN     = 2600; // スタート合図から第1ラウンドまで
const MAX_ROUNDS  = 400;

/* ---------- 汎用 ---------- */
const now = () => performance.timeOrigin + performance.now();
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rngFor(seed, i) {
  return mulberry32((seed ^ Math.imul(i + 1, 2654435761)) >>> 0);
}
function uid(n = 8) {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = ''; for (let i = 0; i < n; i++) s += c[(Math.random() * c.length) | 0];
  return s;
}
function roomCode() {
  let s = ''; for (let i = 0; i < 4; i++) s += ((Math.random() * 10) | 0);
  return s;
}

/* ---------- ラウンド設計 ---------- */
// ラウンド間隔：だんだん短くなる
function intervalOf(i) { return Math.max(520, 2000 - 35 * i); }

// 各ラウンドの目標時刻（ホスト時計・startAt からの相対ms）を事前計算
const ROUND_AT = (() => {
  const a = new Array(MAX_ROUNDS);
  let t = LEAD_IN;
  for (let i = 0; i < MAX_ROUNDS; i++) { a[i] = t; t += intervalOf(i); }
  return a;
})();

const SPEED_OF = (i) => Math.round(60000 / intervalOf(i));

// 指示の中身（seed とラウンド番号だけで決まる ＝ 通信不要で全端末一致）
const DIRS = [
  { key: 'up',    label: '↑', jp: '上' },
  { key: 'down',  label: '↓', jp: '下' },
  { key: 'left',  label: '←', jp: '左' },
  { key: 'right', label: '→', jp: '右' },
];
function instructionOf(seed, i, nPlayers) {
  const r = rngFor(seed, i);
  if (i < 3) return { type: 'ALL_TAP' };            // 最初の3回は練習
  const roll = r();
  if (roll < 0.40) return { type: 'ALL_TAP' };
  if (roll < 0.65) return { type: 'SOLO_TAP', who: Math.floor(r() * nPlayers) };
  if (roll < 0.85) return { type: 'SWIPE', dir: DIRS[Math.floor(r() * 4)].key };
  return { type: 'NO_TAP' };
}
function needsSwipe(ins) { return ins.type === 'SWIPE'; }

/* ---------- 状態 ---------- */
const S = {
  screen: 'title',
  brokerIdx: 0,
  client: null,
  connected: false,
  code: null,
  isHost: false,
  me: { id: 'st_' + uid(), name: '', idx: -1 },
  roster: [],            // [{id,name,idx}]
  presence: new Map(),   // id -> {t, name, synced, rtt}
  // 時計同期
  offset: 0,             // hostClock = localClock + offset
  bestRtt: Infinity,
  syncCount: 0,
  synced: false,
  // ゲーム
  game: null,
  lastResult: null,
  audio: null,
  audioEpoch: 0,
  wakeLock: null,
  hostSeenAt: 0,
};

const toHost  = (localT) => localT + S.offset;
const toLocal = (hostT)  => hostT - S.offset;
const inGame  = () => !!S.game && !S.game.over;

/* ---------- 通信 ---------- */
function topicBase() { return 'synctap/' + VERSION + '/' + S.code; }

function connectBroker(idx, onReady, onFail) {
  if (S.client) { try { S.client.end(true); } catch (e) {} S.client = null; }
  S.brokerIdx = idx;
  S.connected = false;
  setNetStatus('接続中… (' + BROKERS[idx].label + ')', 'wait');

  const c = mqtt.connect(BROKERS[idx].url, {
    clientId: S.me.id + '_' + uid(4),
    clean: true,
    connectTimeout: 8000,
    reconnectPeriod: 3000,
    keepalive: 30,
  });
  S.client = c;

  let settled = false;
  const timer = setTimeout(() => {
    if (!settled) { settled = true; onFail && onFail(); }
  }, 9000);

  c.on('connect', () => {
    S.connected = true;
    setNetStatus('接続OK (' + BROKERS[idx].label + ')', 'ok');
    if (!settled) { settled = true; clearTimeout(timer); onReady && onReady(); }
  });
  c.on('close',   () => { S.connected = false; setNetStatus('切断 (' + BROKERS[idx].label + ')', 'ng'); });
  c.on('error',   () => { S.connected = false; setNetStatus('エラー (' + BROKERS[idx].label + ')', 'ng'); });
  c.on('message', (topic, payload) => {
    let msg; try { msg = JSON.parse(payload.toString()); } catch (e) { return; }
    handleMessage(topic.slice(topicBase().length + 1), msg);
  });
}

function pub(suffix, obj) {
  if (!S.client || !S.connected) return;
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
  if (m.host) S.hostSeenAt = now();
  S.presence.set(m.id, { t: now(), name: m.name, synced: m.synced, rtt: m.rtt, host: m.host });

  if (S.isHost && !inGame()) {
    // 名簿に追加
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
// 画面がバックグラウンドだとブラウザが処理を間引くため、計測値が実態より
// 大きく出る。ロビーにいる間は計測を続け、復帰時には測り直す。
function startSyncLoop() {
  setInterval(() => {
    if (!S.connected || !S.code || S.isHost) return;
    if (document.hidden) return;            // 裏に回っている間は測らない
    if (inGame()) return;                   // プレイ中は通信を増やさない
    if (S.syncCount > 3000) return;
    S.syncCount++;
    pub('sync/req', { id: S.me.id, t0: now() });
  }, 140);
}

// アプリに戻ってきたら、古い計測値を捨てて測り直す
function resetSync() {
  if (S.isHost || inGame()) return;
  S.bestRtt = Infinity;
  S.offset = 0;
  S.synced = false;
  S.syncCount = 0;
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
  if (S.isHost) return { ms: 0, label: '基準端末', cls: 'ok' };
  if (!isFinite(S.bestRtt)) return { ms: null, label: '計測中…', cls: 'wait' };
  const ms = Math.round(S.bestRtt / 2);
  if (ms <= 30) return { ms, label: '±' + ms + 'ms／優秀', cls: 'ok' };
  if (ms <= 60) return { ms, label: '±' + ms + 'ms／問題なし', cls: 'ok' };
  if (ms <= 120) return { ms, label: '±' + ms + 'ms／やや不安', cls: 'warn' };
  return { ms, label: '±' + ms + 'ms／要改善', cls: 'ng' };
}

/* ---------- 音 ---------- */
function initAudio() {
  if (S.audio) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  S.audio = new Ctx();
  if (S.audio.state === 'suspended') S.audio.resume();
  calibrateAudio();
}
function calibrateAudio() { if (S.audio) S.audioEpoch = now() - S.audio.currentTime * 1000; }

function click(atLocalMs, kind) {
  if (!S.audio) return;
  const when = (atLocalMs - S.audioEpoch) / 1000;
  if (when < S.audio.currentTime - 0.05) return;
  const o = S.audio.createOscillator();
  const g = S.audio.createGain();
  const freq = kind === 'accent' ? 1320 : kind === 'ok' ? 880 : kind === 'ng' ? 160 : 660;
  o.frequency.value = freq;
  o.type = kind === 'ng' ? 'sawtooth' : 'square';
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(kind === 'accent' ? 0.35 : 0.22, when + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, when + (kind === 'ng' ? 0.22 : 0.09));
  o.connect(g); g.connect(S.audio.destination);
  o.start(when); o.stop(when + 0.3);
}

/* ---------- 画面遷移 ---------- */
function show(screen) {
  S.screen = screen;
  $$('.screen').forEach(el => el.classList.toggle('on', el.id === 'sc-' + screen));
}

function setNetStatus(text, cls) {
  $$('.netstat').forEach(el => { el.textContent = text; el.className = 'netstat ' + cls; });
}

/* ---------- ロビー ---------- */
function renderLobby() {
  $('#lobby-code').textContent = S.code;
  const q = syncQuality();
  const sq = $('#sync-q');
  sq.textContent = q.label;
  sq.className = 'syncq ' + q.cls;

  const list = $('#player-list');
  list.innerHTML = '';
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const p = S.roster[i];
    const c = COLORS[i];
    const div = document.createElement('div');
    div.className = 'pcard' + (p ? '' : ' empty') + (p && p.id === S.me.id ? ' me' : '');
    div.style.setProperty('--c', c.hex);
    if (p) {
      const pr = p.id === S.me.id
        ? { synced: S.isHost || S.synced, rtt: S.isHost ? 0 : (isFinite(S.bestRtt) ? Math.round(S.bestRtt) : null) }
        : (S.presence.get(p.id) || {});
      const okSync = p.id === S.me.id ? (S.isHost || S.synced) : !!pr.synced;
      div.innerHTML =
        '<div class="pdot"></div>' +
        '<div class="pname">' + escapeHtml(p.name) + (p.id === S.me.id ? '<span class="youtag">あなた</span>' : '') + '</div>' +
        '<div class="pmeta">' + c.name + ' / ' + (okSync ? '同期OK' : '同期中…') + '</div>';
    } else {
      div.innerHTML = '<div class="pdot"></div><div class="pname">空き</div><div class="pmeta">参加待ち</div>';
    }
    list.appendChild(div);
  }

  const btn = $('#btn-start');
  if (S.isHost) {
    btn.style.display = '';
    const n = S.roster.length;
    const allSynced = S.roster.every(p => p.id === S.me.id || (S.presence.get(p.id) || {}).synced);
    btn.disabled = !(n >= 1 && allSynced);
    btn.textContent = n >= MAX_PLAYERS ? 'ゲーム開始' : (n + '人で開始する');
    $('#host-note').textContent = n < MAX_PLAYERS
      ? '※ ' + n + '人でも開始できます（動作確認用）'
      : '全員そろいました';
  } else {
    btn.style.display = 'none';
    $('#host-note').textContent = 'ホストの開始を待っています…';
  }
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------- ゲーム制御 ---------- */
function onCtrl(m) {
  if (m.type === 'roster') {
    if (S.isHost) return;
    S.roster = m.roster || [];
    const me = S.roster.find(p => p.id === S.me.id);
    S.me.idx = me ? me.idx : -1;
    renderLobby();
  } else if (m.type === 'start') {
    startGame(m.seed, m.startAt, m.roster);
  } else if (m.type === 'result') {
    applyResult(m);
  } else if (m.type === 'gameover') {
    endGame(m);
  }
}

function hostStart() {
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const startAt = now() + 1200;   // ホスト時計
  const payload = { type: 'start', seed, startAt, roster: S.roster };
  pub('ctrl', payload);
  startGame(seed, startAt, S.roster);
}

function startGame(seed, startAtHost, roster) {
  S.roster = roster || S.roster;
  const me = S.roster.find(p => p.id === S.me.id);
  S.me.idx = me ? me.idx : -1;

  S.game = {
    seed,
    startAtHost,
    startLocal: toLocal(startAtHost),
    n: S.roster.length,
    lives: LIVES,
    combo: 0,
    maxCombo: 0,
    score: 0,
    round: 0,
    over: false,
    armed: -1,          // 入力受付済みラウンド
    localVerdict: {},   // round -> {label, cls}
    teamVerdict: {},    // round -> {ok, detail}
    // ホスト用
    inbox: {},          // round -> [{id, t, act, dir}]
    judged: -1,
    acc: {},            // id -> {sum, n}
  };
  S.roster.forEach(p => { S.game.acc[p.id] = { sum: 0, n: 0 }; });

  lastRenderRound = -1; tickedFor = -1;
  initAudio(); calibrateAudio();
  requestWakeLock();
  show('play');
  $('#play-root').style.setProperty('--me', COLORS[Math.max(0, S.me.idx)].hex);
  loop();
}

/* 現在フレームで「次に判定されるラウンド」を返す */
function pendingRound(tHost) {
  const rel = tHost - S.game.startAtHost;
  for (let i = S.game.round; i < MAX_ROUNDS; i++) {
    if (rel < ROUND_AT[i] + JUDGE_DELAY) return i;
  }
  return MAX_ROUNDS - 1;
}

let rafId = null;
function loop() {
  cancelAnimationFrame(rafId);
  const step = () => {
    if (!S.game || S.game.over) return;
    const g = S.game;
    const tHost = toHost(now());
    const rel = tHost - g.startAtHost;

    const cur = pendingRound(tHost);
    if (cur !== g.round) { g.round = cur; }

    const target = ROUND_AT[cur];
    const prev = cur === 0 ? 0 : ROUND_AT[cur - 1];
    const span = target - prev;
    const remain = target - rel;
    const prog = clamp(1 - remain / span, 0, 1);

    const ins = instructionOf(g.seed, cur, g.n);

    // 入力を武装
    if (g.armed !== cur) { g.armed = cur; armInput(ins); scheduleTick(cur, target); }

    renderPlay(cur, ins, prog, remain);

    // ホスト：判定
    if (S.isHost) hostJudgeTick(rel);

    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

let tickedFor = -1;
function scheduleTick(round, targetRel) {
  if (tickedFor === round) return;
  tickedFor = round;
  const localT = toLocal(S.game.startAtHost + targetRel);
  click(localT, round % 4 === 0 ? 'accent' : 'beat');
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
  const g = S.game;
  const round = input.round;
  const tH = toHost(tLocal);
  const delta = tH - (g.startAtHost + ROUND_AT[round]);

  const ins = instructionOf(g.seed, round, g.n);
  // 自分ぶんの手応えを即座に表示（チームの正否は後からホストが返す）
  let label = '', cls = '';
  const forbidden = ins.type === 'NO_TAP' || (ins.type === 'SOLO_TAP' && ins.who !== S.me.idx);
  if (forbidden) { label = 'さわった！'; cls = 'bad'; }
  else if (ins.type === 'SWIPE' && act !== 'swipe') { label = 'スワイプ！'; cls = 'bad'; }
  else if (ins.type === 'SWIPE' && dir !== ins.dir) { label = '方向ちがう'; cls = 'bad'; }
  else {
    const a = Math.abs(delta), W = WIN_OF(round);
    if (a <= W * 0.33) { label = 'PERFECT'; cls = 'perfect'; }
    else if (a <= W * 0.65) { label = 'GOOD'; cls = 'good'; }
    else if (a <= W) { label = 'OK'; cls = 'ok'; }
    else { label = (delta < 0 ? 'はやい' : 'おそい'); cls = 'bad'; }
  }
  S.game.localVerdict[round] = { label, cls, delta: Math.round(delta) };
  flashSelf(cls);

  pub('input', { id: S.me.id, round, t: tH, act, dir: dir || null });
  if (S.isHost) onInput({ id: S.me.id, round, t: tH, act, dir: dir || null });
}

function bindInput() {
  const pad = $('#play-root');
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!input.armed) return;
    input.downT = now(); input.downX = e.clientX; input.downY = e.clientY;
    if (!input.wantSwipe) fireAction('tap', null, input.downT);
  }, { passive: false });

  pad.addEventListener('pointermove', (e) => {
    if (!input.armed || !input.wantSwipe || input.fired || !input.downT) return;
    const dx = e.clientX - input.downX, dy = e.clientY - input.downY;
    if (Math.hypot(dx, dy) < 34) return;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    fireAction('swipe', dir, now());
  }, { passive: false });

  pad.addEventListener('pointerup', (e) => {
    if (!input.armed || input.fired) { input.downT = 0; return; }
    if (input.wantSwipe && input.downT) fireAction('tap', null, input.downT); // スワイプ要求にタップで応えた＝失敗
    input.downT = 0;
  });

  pad.addEventListener('contextmenu', e => e.preventDefault());
}

/* ---------- ホスト側の判定 ---------- */
function onInput(m) {
  if (!S.isHost || !S.game) return;
  const g = S.game;
  (g.inbox[m.round] = g.inbox[m.round] || []).push(m);
  // 禁止区間の「うっかりタップ」も拾えるよう、前後ラウンドにも記録
  const rel = m.t - g.startAtHost;
  for (let r = Math.max(0, m.round - 1); r <= m.round + 1; r++) {
    if (r === m.round) continue;
    if (Math.abs(rel - ROUND_AT[r]) < GUARD_PRE) {
      (g.inbox[r] = g.inbox[r] || []).push(Object.assign({}, m, { stray: true }));
    }
  }
}

function hostJudgeTick(rel) {
  const g = S.game;
  for (let r = g.judged + 1; r < MAX_ROUNDS; r++) {
    if (rel < ROUND_AT[r] + JUDGE_DELAY) break;
    g.judged = r;
    judgeRound(r);
    if (g.over) break;
  }
}

function judgeRound(r) {
  const g = S.game;
  const ins = instructionOf(g.seed, r, g.n);
  const items = (g.inbox[r] || []);
  const target = g.startAtHost + ROUND_AT[r];

  const W = WIN_OF(r);
  const byPlayer = {};
  S.roster.forEach(p => { byPlayer[p.id] = null; });
  items.forEach(it => {
    const d = it.t - target;
    if (d < -GUARD_PRE || d > GUARD_POST + W) return;
    const cur = byPlayer[it.id];
    if (!cur || Math.abs(d) < Math.abs(cur.d)) byPlayer[it.id] = { d, act: it.act, dir: it.dir };
  });

  let ok = true;
  const detail = {};
  S.roster.forEach(p => {
    const a = byPlayer[p.id];
    const mustAct =
      ins.type === 'ALL_TAP' ? 'tap' :
      ins.type === 'SWIPE'   ? 'swipe' :
      ins.type === 'SOLO_TAP' ? (ins.who === p.idx ? 'tap' : 'none') : 'none';

    let good;
    if (mustAct === 'none') {
      good = !a;                       // 触っていなければ成功
      detail[p.id] = good ? 'held' : 'touched';
    } else if (!a) {
      good = false; detail[p.id] = 'missed';
    } else {
      const timing = Math.abs(a.d) <= W;
      const right  = a.act === mustAct && (mustAct !== 'swipe' || a.dir === ins.dir);
      good = timing && right;
      detail[p.id] = !right ? 'wrong' : (timing ? 'hit' : (a.d < 0 ? 'early' : 'late'));
      if (right && timing) { g.acc[p.id].sum += Math.abs(a.d); g.acc[p.id].n++; }
    }
    if (!good) ok = false;
  });

  if (ok) {
    g.combo++; g.maxCombo = Math.max(g.maxCombo, g.combo);
    g.score += 100 + 50 * Math.min(g.combo, 20);
  } else {
    g.combo = 0; g.lives--;
  }

  const payload = {
    type: 'result', round: r, ok, detail,
    lives: g.lives, combo: g.combo, score: g.score,
  };
  pub('ctrl', payload);
  applyResult(payload);

  if (g.lives <= 0 && !g.over) {
    const acc = {};
    S.roster.forEach(p => {
      const a = g.acc[p.id];
      acc[p.id] = a.n ? Math.round(a.sum / a.n) : null;
    });
    const over = {
      type: 'gameover', round: r + 1, score: g.score, maxCombo: g.maxCombo,
      speed: SPEED_OF(r), acc, roster: S.roster,
    };
    pub('ctrl', over);
    endGame(over);
  }
}

function applyResult(m) {
  if (!S.game) return;
  const g = S.game;
  g.teamVerdict[m.round] = m;
  g.lives = m.lives; g.combo = m.combo; g.score = m.score;
  flashTeam(m.ok);
  click(now() + 10, m.ok ? 'ok' : 'ng');
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
    if (ins.type === 'ALL_TAP')  { main = 'タップ';   sub = '3人いっせいに'; cls = 'i-all'; }
    else if (ins.type === 'NO_TAP') { main = 'さわるな'; sub = '手を離して待つ'; cls = 'i-no'; }
    else if (ins.type === 'SWIPE')  {
      const d = DIRS.find(x => x.key === ins.dir);
      main = d.label; sub = '3人いっせいに' + d.jp + 'へスワイプ'; cls = 'i-swipe';
    } else if (ins.type === 'SOLO_TAP') {
      if (ins.who === myIdx) { main = 'あなただけ'; sub = 'あなたがタップ／他は触るな'; cls = 'i-solo-me'; }
      else { main = 'さわるな'; sub = COLORS[ins.who].name + 'の番です'; cls = 'i-solo-other'; }
    }
    box.className = 'instr ' + cls;
    $('#instr-main').textContent = main;
    $('#instr-sub').textContent  = sub;
    $('#verdict').textContent = '';
    $('#verdict').className = 'verdict';
  }

  // リング
  const ring = $('#ring-fg');
  const C = 2 * Math.PI * 46;
  ring.style.strokeDasharray = C;
  ring.style.strokeDashoffset = C * (1 - prog);
  $('#ring-wrap').classList.toggle('near', remain < 260 && remain > -260);

  // カウントダウン（第1ラウンド前だけ）
  const cd = $('#countdown');
  if (round === 0 && remain > 0) {
    cd.style.display = '';
    cd.textContent = String(Math.ceil(remain / 800));
  } else cd.style.display = 'none';

  // HUD
  $('#hud-lives').textContent = '♥'.repeat(Math.max(0, g.lives)) + '·'.repeat(Math.max(0, LIVES - g.lives));
  $('#hud-combo').textContent = g.combo > 0 ? g.combo + ' COMBO' : '';
  $('#hud-score').textContent = g.score;
  $('#hud-round').textContent = 'R' + (round + 1);
  $('#hud-speed').textContent = 'SPEED ' + SPEED_OF(round);

  const v = g.localVerdict[round];
  if (v) { $('#verdict').textContent = v.label + (v.cls !== 'bad' ? ' ' + (v.delta > 0 ? '+' : '') + v.delta + 'ms' : ''); $('#verdict').className = 'verdict ' + v.cls; }
}

function flashSelf(cls) {
  const el = $('#play-root');
  el.classList.remove('fx-good', 'fx-bad');
  void el.offsetWidth;
  el.classList.add(cls === 'bad' ? 'fx-bad' : 'fx-good');
}
function flashTeam(ok) {
  const el = $('#teamflash');
  el.className = 'teamflash ' + (ok ? 'ok' : 'ng');
  void el.offsetWidth;
  el.classList.add('go');
  setTimeout(() => el.classList.remove('go'), 320);
}

/* ---------- 結果 ---------- */
function endGame(m) {
  if (!S.game) return;
  S.game.over = true;
  cancelAnimationFrame(rafId);
  releaseWakeLock();
  S.lastResult = m;
  show('result');

  $('#r-score').textContent  = m.score;
  $('#r-round').textContent  = m.round;
  $('#r-combo').textContent  = m.maxCombo;
  $('#r-speed').textContent  = m.speed;

  const wrap = $('#r-acc');
  wrap.innerHTML = '';
  (m.roster || S.roster).forEach(p => {
    const ms = (m.acc || {})[p.id];
    const c = COLORS[p.idx];
    const row = document.createElement('div');
    row.className = 'accrow';
    row.style.setProperty('--c', c.hex);
    const w = ms == null ? 0 : clamp(100 - (ms / WIN_BASE) * 100, 4, 100);
    row.innerHTML =
      '<div class="accname">' + escapeHtml(p.name) + '</div>' +
      '<div class="accbar"><i style="width:' + w + '%"></i></div>' +
      '<div class="accms">' + (ms == null ? '—' : '±' + ms + 'ms') + '</div>';
    wrap.appendChild(row);
  });

  const best = (m.roster || S.roster)
    .map(p => ({ p, ms: (m.acc || {})[p.id] }))
    .filter(x => x.ms != null)
    .sort((a, b) => a.ms - b.ms)[0];
  $('#r-mvp').textContent = best ? '今日いちばん正確だったのは ' + best.p.name + '（±' + best.ms + 'ms）' : '';
}

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

  // 新しい版が有効になったら、プレイ中でなければ静かに読み込み直す
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded || inGame()) return;
    reloaded = true;
    location.reload();
  });

  // アプリに戻ってきた時にも更新を確認する
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    navigator.serviceWorker.getRegistration()
      .then(r => r && r.update().catch(() => {})).catch(() => {});
  });
}

/* ---------- 画面ロック ---------- */
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) S.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
}
function releaseWakeLock() { try { S.wakeLock && S.wakeLock.release(); } catch (e) {} S.wakeLock = null; }

/* ---------- 起動 ---------- */
function boot() {
  const params = new URLSearchParams(location.search);
  // ローカル検証用：?b=ws://host:port で通信経路を差し替え
  if (params.get('b')) BROKERS.unshift({ label: 'LOCAL', url: params.get('b') });
  const savedName = localStorage.getItem('st_name') || '';
  $('#in-name').value = params.get('name') || savedName || '';
  if (params.get('code')) $('#in-code').value = params.get('code');

  $('#build-stamp').textContent = 'ver ' + BUILD;
  const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (installed) $('#a2hs').style.display = 'none';
  registerSW();

  // ブローカー切替UI
  const bs = $('#broker-select');
  BROKERS.forEach((b, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = '通信経路 ' + b.label;
    bs.appendChild(o);
  });
  bs.addEventListener('change', () => {
    connectBroker(+bs.value, null, () => tryNextBroker(+bs.value));
  });

  $('#btn-create').addEventListener('click', () => enterRoom(roomCode(), true));
  $('#btn-join').addEventListener('click', () => {
    const c = ($('#in-code').value || '').trim();
    if (!/^\d{4}$/.test(c)) { alert('4桁の数字を入れてください'); return; }
    enterRoom(c, false);
  });
  $('#btn-start').addEventListener('click', hostStart);
  $('#btn-again').addEventListener('click', () => {
    S.game = null; lastRenderRound = -1; tickedFor = -1;
    show('lobby'); renderLobby();
  });
  $('#btn-copy').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?code=' + S.code;
    try { await navigator.clipboard.writeText(url); $('#btn-copy').textContent = 'コピーしました'; }
    catch (e) { prompt('このURLを2人に送ってください', url); }
    setTimeout(() => { $('#btn-copy').textContent = '参加URLをコピー'; }, 1600);
  });

  bindInput();
  setInterval(calibrateAudio, 5000);
  startHeartbeat();
  startSyncLoop();
  setInterval(pruneRoster, 1500);

  // 起動時に接続チェック
  connectBroker(0, null, () => tryNextBroker(0));
}

function tryNextBroker(failedIdx) {
  const next = failedIdx + 1;
  if (next < BROKERS.length) {
    $('#broker-select').value = next;
    connectBroker(next, null, () => tryNextBroker(next));
  } else {
    setNetStatus('全経路に接続できません', 'ng');
  }
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
      broadcastRoster();
    }
    show('lobby');
    renderLobby();
    pub('presence', { id: S.me.id, name: S.me.name, host: S.isHost, synced: S.synced, rtt: null });
  };

  if (S.connected) go();
  else connectBroker(S.brokerIdx, go, () => tryNextBroker(S.brokerIdx));
}

window.addEventListener('DOMContentLoaded', boot);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  calibrateAudio();
  resetSync();          // 裏に回っている間の不正確な計測値を捨てる
});
window.__SYNCTAP = { S, instructionOf, ROUND_AT, toHost, toLocal, now, COLORS };
