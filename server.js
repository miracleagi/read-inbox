const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8137);
const HOST = process.env.HOST || "127.0.0.1";
const ARXIV_API = "https://export.arxiv.org/api/query";
const STORE_FILE = path.join(ROOT, ".paper-inbox-data.json");
const PUBLIC_FILES = new Set(["/dashboard.html"]);
const PUBLIC_DIRS = new Set(["/src/"]);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function isAllowedCorsOrigin(origin) {
  if (!origin) return false;
  if (origin.startsWith("chrome-extension://")) return true;
  return origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!isAllowedCorsOrigin(origin)) return {};

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin"
  };
}

function send(req, res, status, body, headers = {}) {
  res.writeHead(status, {
    ...corsHeaders(req),
    ...headers
  });
  res.end(body);
}

function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }

  const requested = decoded === "/" ? "/dashboard.html" : decoded;
  const normalizedRequest = path.posix.normalize(requested);
  const ext = path.extname(normalizedRequest);
  const publicFile = PUBLIC_FILES.has(normalizedRequest);
  const publicDir = [...PUBLIC_DIRS].some((dir) => normalizedRequest.startsWith(dir));
  if (!publicFile && !(publicDir && [".js", ".css"].includes(ext))) return null;

  const filePath = path.resolve(ROOT, `.${normalizedRequest}`);
  const relativePath = path.relative(ROOT, filePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return null;
  return filePath;
}

async function handleArxiv(req, res, arxivId) {
  const url = `${ARXIV_API}?id_list=${encodeURIComponent(arxivId)}`;
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "PaperInbox/0.1 (local metadata proxy)"
      }
    });
    const text = await response.text();
    send(req, res, response.status, text, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "public, max-age=3600"
    });
  } catch (error) {
    send(req, res, 502, JSON.stringify({ error: error.message }), {
      "content-type": "application/json; charset=utf-8"
    });
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readStore() {
  try {
    return JSON.parse(await fs.readFile(STORE_FILE, "utf8"));
  } catch {
    return {
      papers: [],
      settings: {
        createdAt: new Date().toISOString()
      }
    };
  }
}

async function handleStore(req, res) {
  if (req.method === "OPTIONS") {
    send(req, res, 204, "");
    return;
  }

  if (req.method === "GET") {
    send(req, res, 200, JSON.stringify(await readStore()), {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    return;
  }

  if (req.method === "PUT") {
    try {
      const body = await readBody(req);
      const store = JSON.parse(body || "{}");
      if (!Array.isArray(store.papers)) {
        send(req, res, 400, JSON.stringify({ error: "Invalid store payload" }), {
          "content-type": "application/json; charset=utf-8"
        });
        return;
      }

      await fs.writeFile(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`);
      send(req, res, 200, JSON.stringify(store), {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
    } catch (error) {
      send(req, res, 400, JSON.stringify({ error: error.message }), {
        "content-type": "application/json; charset=utf-8"
      });
    }
    return;
  }

  if (req.method === "DELETE") {
    await fs.writeFile(
      STORE_FILE,
      `${JSON.stringify({ papers: [], settings: { createdAt: new Date().toISOString() } }, null, 2)}\n`
    );
    send(req, res, 204, "");
    return;
  }

  send(req, res, 405, "Method not allowed", { "content-type": "text/plain; charset=utf-8" });
}

async function handleStatic(req, res) {
  const filePath = safePath(req.url || "/");
  if (!filePath) {
    send(req, res, 403, "Forbidden", { "content-type": "text/plain; charset=utf-8" });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    send(req, res, 200, data, {
      "content-type": types[ext] || "application/octet-stream"
    });
  } catch {
    send(req, res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  }
}

const server = http.createServer(async (req, res) => {
  if ((req.url || "").startsWith("/api/store")) {
    await handleStore(req, res);
    return;
  }

  const match = (req.url || "").match(/^\/api\/arxiv\/([^/?#]+)/);
  if (match) {
    await handleArxiv(req, res, match[1]);
    return;
  }

  await handleStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Paper Inbox running at http://${HOST}:${PORT}/dashboard.html`);
});
