/** Dependency-free local server for the browser examples. Node.js 24+. */
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, relative, extname, sep, join, isAbsolute } from 'node:path';

const root = await realpath(resolve(process.argv[2] || 'examples'));
const port = Number(process.argv[3] || 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Use a port between 1 and 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const inside = (path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname.includes('\0') || pathname.split('/').some((part) => part.startsWith('.'))) throw new Error('Hidden paths are not served.');
    let file = resolve(root, '.' + pathname);
    if (!inside(file)) throw new Error('Outside root.');
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    file = await realpath(file);
    if (!inside(file) || relative(root, file).split(sep).some((part) => part.startsWith('.')) || !(await stat(file)).isFile()) throw new Error('Not a public file.');
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }
});
server.on('error', (error) => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is busy. Choose a different port and allow that origin on your browser key.` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`Open http://localhost:${port} — paste your browser key in the page. Ctrl+C stops the server.`));
