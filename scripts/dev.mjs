// Local preview without Netlify: serves public/ and the API with an on-disk store in .data/.
// Usage: ADMIN_PASSWORD=secret npm run dev  →  http://localhost:8888
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { createApi } from "../lib/api.mjs";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.join(root, ".data");
const port = Number(process.env.PORT || 8888);

function fileStore(name) {
  const dir = path.join(dataDir, name);
  const file = (key) => path.join(dir, encodeURIComponent(key));
  const read = async (key) => {
    try {
      return JSON.parse(await fs.readFile(file(key), "utf8"));
    } catch {
      return null;
    }
  };
  const write = async (key, entry) => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file(key), JSON.stringify(entry));
  };
  const decode = (entry, type) => {
    const buf = Buffer.from(entry.data, "base64");
    if (type === "json") return JSON.parse(buf.toString());
    if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return buf.toString();
  };
  const set = async (key, data, opts = {}) => {
    const cur = await read(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && cur?.etag !== opts.onlyIfMatch) return { modified: false };
    const etag = crypto.randomUUID();
    await write(key, { data: Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString("base64"), metadata: opts.metadata || {}, etag });
    return { modified: true, etag };
  };
  return {
    async get(key, { type } = {}) {
      const e = await read(key);
      return e ? decode(e, type) : null;
    },
    async getWithMetadata(key, { type } = {}) {
      const e = await read(key);
      return e ? { data: decode(e, type), metadata: e.metadata, etag: e.etag } : null;
    },
    set,
    setJSON: (key, value, opts) => set(key, JSON.stringify(value), opts),
    async list({ prefix = "" } = {}) {
      const names = await fs.readdir(dir).catch(() => []);
      return { blobs: names.map(decodeURIComponent).filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
    delete: (key) => fs.rm(file(key), { force: true }),
  };
}

const api = createApi({ getStore: fileStore, password: process.env.ADMIN_PASSWORD || "admin" });
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const response = await api(
        new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) })
      );
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let p = url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname;
    try {
      const body = await fs.readFile(path.join(root, "public", path.normalize(p)));
      res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(port, () => console.log(`Kokoro: http://localhost:${port}  (admin: /admin)`));
