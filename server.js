const http = require("http");
const https = require("https");
const url = require("url");
const path = require("path");
const fs = require("fs");

const PORT = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── CORS headers on everything ──
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── /proxy?url=... endpoint ──
  if (pathname === "/proxy") {
    let target = parsed.query.url;
    if (!target) { res.writeHead(400); res.end("Missing url param"); return; }
    if (!/^https?:\/\//i.test(target)) target = "https://" + target;

    const targetUrl = url.parse(target);
    const lib = targetUrl.protocol === "https:" ? https : http;

    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
      path: targetUrl.path || "/",
      method: req.method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Accept": req.headers["accept"] || "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Referer": target,
        "Origin": targetUrl.protocol + "//" + targetUrl.hostname,
      },
    };

    const proxyReq = lib.request(options, (proxyRes) => {
      // Strip headers that block embedding
      const blocked = [
        "x-frame-options","content-security-policy","content-security-policy-report-only",
        "strict-transport-security","x-content-type-options","cross-origin-opener-policy",
        "cross-origin-embedder-policy","cross-origin-resource-policy",
      ];

      const headers = {};
      for (const [k, v] of Object.entries(proxyRes.headers)) {
        if (!blocked.includes(k.toLowerCase())) headers[k] = v;
      }
      headers["access-control-allow-origin"] = "*";

      // Rewrite Location headers on redirects
      if (headers["location"]) {
        headers["location"] = "/proxy?url=" + encodeURIComponent(headers["location"]);
      }

      res.writeHead(proxyRes.statusCode, headers);

      const ct = (headers["content-type"] || "").toLowerCase();
      if (ct.includes("text/html") || ct.includes("text/css") || ct.includes("javascript")) {
        let body = "";
        proxyRes.setEncoding("utf8");
        proxyRes.on("data", chunk => body += chunk);
        proxyRes.on("end", () => {
          const base = targetUrl.protocol + "//" + targetUrl.hostname;
          // Rewrite absolute URLs in HTML/CSS/JS to go through proxy
          body = body
            .replace(/(href|src|action)=["'](https?:\/\/[^"']+)["']/gi,
              (m, attr, u) => `${attr}="/proxy?url=${encodeURIComponent(u)}"`)
            .replace(/(href|src|action)=["'](\/[^"']+)["']/gi,
              (m, attr, u) => `${attr}="/proxy?url=${encodeURIComponent(base + u)}"`)
            .replace(/url\(["']?(https?:\/\/[^"')]+)["']?\)/gi,
              (m, u) => `url("/proxy?url=${encodeURIComponent(u)}")`);
          res.end(body);
        });
      } else {
        proxyRes.pipe(res);
      }
    });

    proxyReq.on("error", (e) => {
      res.writeHead(502);
      res.end(`Proxy error: ${e.message}`);
    });

    if (req.method === "POST") {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
    return;
  }

  // ── Serve static files from /public ──
  let filePath = path.join(__dirname, "public", pathname === "/" ? "index.html" : pathname);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // fallback to index.html for SPA routing
      fs.readFile(path.join(__dirname, "public", "index.html"), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end("Not found"); return; }
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`NovaProxy running on port ${PORT}`));
