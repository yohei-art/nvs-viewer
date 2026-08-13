const http = require('http');
const fs = require('fs');
const path = require('path');
const port = process.env.PORT || 3000;
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
http.createServer((req, res) => {
  let f = decodeURIComponent((req.url || '/').split('?')[0]);
  if (f === '/' || f === '') f = '/index.html';
  const safe = path.normalize(f).replace(/^(\.\.[\/\\])+/, '');
  const p = path.join(__dirname, safe);
  fs.readFile(p, (e, data) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
    res.writeHead(200, {'Content-Type': types[path.extname(p).toLowerCase()] || 'application/octet-stream'});
    res.end(data);
  });
}).listen(port, () => console.log('NVS viewer listening on ' + port));
