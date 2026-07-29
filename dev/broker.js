/* ローカル検証用の最小 MQTT 3.1.1 ブローカー（QoS0のみ / WebSocket接続）
   本番では公開ブローカーを使うので、これは動作確認専用。 */
const WebSocket = require('ws');

function decodeVarint(buf, i) {
  let mult = 1, val = 0, b;
  do {
    if (i >= buf.length) return null;
    b = buf[i++];
    val += (b & 127) * mult;
    mult *= 128;
    if (mult > 128 * 128 * 128) return null;
  } while (b & 128);
  return { val, i };
}
function encodeVarint(n) {
  const out = [];
  do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; out.push(d); } while (n > 0);
  return Buffer.from(out);
}
function readStr(buf, i) {
  const len = buf.readUInt16BE(i);
  return { s: buf.slice(i + 2, i + 2 + len).toString('utf8'), i: i + 2 + len };
}
function filterToRe(f) {
  const segs = f.split('/');
  let re = '^';
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s === '#') {                      // 以降すべてにマッチ
      re = (i === 0) ? '^.*' : re.replace(/\/$/, '') + '(/.*)?';
      return new RegExp(re + '$');
    }
    re += (s === '+') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (i < segs.length - 1) re += '/';
  }
  return new RegExp(re + '$');
}

function attach(server, log) {
  const wss = new WebSocket.Server({
    server,
    handleProtocols: (protocols) => {
      const list = protocols instanceof Set ? Array.from(protocols) : (protocols || []);
      return list.includes('mqtt') ? 'mqtt' : (list[0] || false);
    },
  });

  const clients = new Set();

  wss.on('connection', (ws) => {
    const c = { ws, subs: [], id: null, buf: Buffer.alloc(0) };
    clients.add(c);
    ws.on('error', () => {});
    ws.on('close', () => clients.delete(c));

    ws.on('message', (data) => {
      c.buf = Buffer.concat([c.buf, Buffer.isBuffer(data) ? data : Buffer.from(data)]);
      for (;;) {
        if (c.buf.length < 2) return;
        const head = c.buf[0];
        const vi = decodeVarint(c.buf, 1);
        if (!vi) return;
        const total = vi.i + vi.val;
        if (c.buf.length < total) return;
        const pkt = c.buf.slice(vi.i, total);
        c.buf = c.buf.slice(total);
        handle(c, head >> 4, head & 0x0f, pkt);
      }
    });
  });

  function send(c, buf) { if (c.ws.readyState === 1) c.ws.send(buf); }

  function handle(c, type, flags, p) {
    switch (type) {
      case 1: { // CONNECT
        let i = 0;
        const pn = readStr(p, i); i = pn.i;
        i += 1;                       // protocol level
        const cflags = p[i]; i += 1;
        i += 2;                       // keepalive
        const cid = readStr(p, i);
        c.id = cid.s;
        log && log('  + connect ' + c.id);
        send(c, Buffer.from([0x20, 0x02, 0x00, 0x00]));   // CONNACK ok
        break;
      }
      case 3: { // PUBLISH (QoS0 のみ扱う)
        const qos = (flags >> 1) & 3;
        let i = 0;
        const t = readStr(p, i); i = t.i;
        if (qos > 0) i += 2;
        const payload = p.slice(i);
        route(t.s, payload);
        break;
      }
      case 8: { // SUBSCRIBE
        const pid = p.readUInt16BE(0);
        let i = 2; const codes = [];
        while (i < p.length) {
          const t = readStr(p, i); i = t.i;
          const qos = p[i]; i += 1;
          c.subs.push({ filter: t.s, re: filterToRe(t.s) });
          codes.push(0);
        }
        const body = Buffer.concat([Buffer.from([pid >> 8, pid & 255]), Buffer.from(codes)]);
        send(c, Buffer.concat([Buffer.from([0x90]), encodeVarint(body.length), body]));
        break;
      }
      case 10: { // UNSUBSCRIBE
        const pid = p.readUInt16BE(0);
        send(c, Buffer.from([0xb0, 0x02, pid >> 8, pid & 255]));
        break;
      }
      case 12: // PINGREQ
        send(c, Buffer.from([0xd0, 0x00]));
        break;
      case 14: // DISCONNECT
        c.ws.close();
        break;
    }
  }

  function route(topic, payload) {
    const tb = Buffer.from(topic, 'utf8');
    const head = Buffer.concat([
      Buffer.from([tb.length >> 8, tb.length & 255]), tb, payload,
    ]);
    const frame = Buffer.concat([Buffer.from([0x30]), encodeVarint(head.length), head]);
    for (const c of clients) {
      if (c.subs.some(s => s.re.test(topic))) send(c, frame);
    }
  }

  return wss;
}

module.exports = { attach };
