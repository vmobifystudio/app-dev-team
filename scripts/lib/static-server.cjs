// Serves a built web app for journey-gate: `node static-server.cjs <dir> <port>`. Stays inside <dir>,
// serves index.html for a directory, and sends a Content-Type per extension — a module script
// without a JavaScript MIME type never executes (Codex PR #49).
const h = require('http'), f = require('fs'), p = require('path');
const d = p.resolve(process.argv[2]);
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain' };
h.createServer((q, r) => {
  let x = p.resolve(d, '.' + decodeURIComponent(new URL(q.url, 'http://h').pathname));
  if (x !== d && !x.startsWith(d + p.sep)) return r.writeHead(403).end();
  if (f.existsSync(x) && f.statSync(x).isDirectory()) x = p.join(x, 'index.html');
  if (!f.existsSync(x)) return r.writeHead(404).end();
  r.writeHead(200, { 'content-type': T[p.extname(x).toLowerCase()] || 'application/octet-stream' }).end(f.readFileSync(x));
}).listen(+process.argv[3], '127.0.0.1');
