const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";

try {
  const envFile = path.join(ROOT, ".env");
  if (fs.existsSync(envFile)) {
    fs.readFileSync(envFile, "utf8").split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !Object.prototype.hasOwnProperty.call(process.env, m[1])) {
        process.env[m[1]] = m[2];
      }
    });
    console.log("Loaded .env");
  }
} catch (e) {}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".otf": "font/otf",
  ".ttf": "font/ttf"
};

const HF_MODEL = "nateraw/food";
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);

  if (req.method === "POST" && urlPath === "/api/scan") {
    try {
      const body = await readBody(req, 10 * 1024 * 1024);
      const token = process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN;
      if (!token) {
        res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "SCAN_NOT_CONFIGURED" }));
        return;
      }
      const hfRes = await fetch(HF_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": req.headers["content-type"] || "application/octet-stream"
        },
        body
      });
      const text = await hfRes.text();
      res.writeHead(hfRes.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(text);
    } catch (error) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: String((error && error.message) || error) }));
    }
    return;
  }

  if (urlPath === "/") urlPath = "/index.html";

  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("403 Forbidden");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream"
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log(`ANH REVAMPED6.8 server running at http://${shown}:${PORT}`);
  if (!process.env.HF_TOKEN && !process.env.HUGGINGFACEHUB_API_TOKEN) {
    console.log("Food scanner: no API key set. To enable scanning, create a file named .env in this folder with:");
    console.log("HF_TOKEN=hf_xxxxxxxxxxxxxxxx (your key from https://huggingface.co/settings/tokens)");
    console.log("Then restart this server.");
  }
});