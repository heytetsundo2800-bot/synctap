/* ローカル検証用：自前MQTTブローカー + 静的ファイル配信 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { attach } = require('./broker');

const mqttServer = http.createServer();
attach(mqttServer, console.log);
mqttServer.listen(9001, () => console.log('broker  ws://localhost:9001'));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = p.startsWith('/site-dist/') ? path.join(__dirname, p) : path.join(__dirname, 'site', p);
  fs.readFile(f, (e, buf) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(8080, () => console.log('static  http://localhost:8080'));
