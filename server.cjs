const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'dist');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.png':'image/png', '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.txt':'text/plain; charset=utf-8' };
http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname+'index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file,(err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type':types[path.extname(file)] || 'application/octet-stream', 'Content-Length':stat.size, 'Cache-Control':'no-cache' });
    if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
  });
}).listen(port,'127.0.0.1',() => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`排啥队呢已启动： ${url}`);
  if (process.env.OPEN_BROWSER === '1' && process.platform === 'darwin') require('node:child_process').spawn('open',[url],{stdio:'ignore'});
}).on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${port} 已在使用。如果游戏已经打开，请继续使用现有页面。也可以运行 PORT=4174 npm start。`);
    if (process.env.OPEN_BROWSER === '1' && process.platform === 'darwin') require('node:child_process').spawn('open',[`http://127.0.0.1:${port}`],{stdio:'ignore'});
  } else console.error(error.message);
  process.exitCode = 1;
});
