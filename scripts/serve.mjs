// Просмотр сайта на своём компьютере: node scripts/serve.mjs → http://localhost:5180
// Отдаёт папку site/ так же, как Cloudflare Pages: /admin → admin.html, /courier → courier.html и т. д.
// Сайт работает с НАСТОЯЩЕЙ базой (site/assets/js/config.js) — тестовые заказы попадут в панель.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../site/', import.meta.url));
const PORT = Number(process.env.PORT) || 5180;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
};

async function resolve(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidates = clean.endsWith('/') ? [join(clean, 'index.html')] : [clean, `${clean}.html`];
  for (const rel of candidates) {
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) continue;
    try { if ((await stat(file)).isFile()) return file; } catch { /* next */ }
  }
  return null;
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname.endsWith('.html') && pathname !== '/index.html') {
    res.writeHead(307, { Location: pathname.slice(0, -5) }); // как Cloudflare: /admin.html → /admin
    return res.end();
  }
  const file = await resolve(pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    return res.end(await readFile(join(ROOT, '404.html')));
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(await readFile(file));
}).listen(PORT, () => console.log(`KOKORO: http://localhost:${PORT}  (панель /admin, курьер /courier, кухня /cook, продукты /kitchen)`));
