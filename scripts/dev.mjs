import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
process.env.NODE_ENV = "development";
// Node's built-in env parser; local credentials are never served by this server.
try {
  process.loadEnvFile(".env.local");
} catch {}
const { default: handler } = await import("../lib/api.js");
const root = resolve("public"),
  mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost:4173");
      if (url.pathname === "/api/account") {
        req.query = Object.fromEntries(url.searchParams);
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 300000) {
            res.writeHead(413);
            return res.end();
          }
        }
        req.body = raw;
        return handler(req, res);
      }
      let path = url.pathname;
      if (/^\/1(\/|$)/.test(path)) {
        res.writeHead(308, { Location: (path.slice(2) || "/") + url.search });
        return res.end();
      }
      if (path === "/") path = "/index.html";
      if (path === "/cabinet") path = "/cabinet.html";
      if (path.startsWith("/therapist/")) path = "/therapist.html";
      const file = resolve(root, "." + decodeURIComponent(path));
      if (!file.startsWith(root + sep)) throw new Error("Forbidden");
      await stat(file);
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Страница не найдена");
    }
  })
  .listen(4173, "127.0.0.1", () => console.log("Local: http://127.0.0.1:4173"));
