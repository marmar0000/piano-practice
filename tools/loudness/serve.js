// 開発用：リポジトリのファイルをHTTPで配る小さなサーバー
// 録音のピアノ（sounds/）は fetch で読み込むので、file:// で開くと読み込めない。道具からはこのサーバー経由で開く
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mp3': 'audio/mpeg', '.json': 'application/json' };

// 戻り値：{ url（index.html のアドレス）, close() }
module.exports = function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/index.html`,
    close: () => server.close(),
  })));
};
