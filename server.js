const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const APP_DIR = path.join(ROOT, "app");
const DATA_DIR = path.join(ROOT, "data");
const COVERS_DIR = path.join(DATA_DIR, "covers");
const BACKUPS_DIR = path.join(DATA_DIR, "backups");
const BOOKS_PATH = path.join(DATA_DIR, "books.json");
const PORT = Number(process.env.PORT || 4173);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

function ensureData() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  if (!fs.existsSync(BOOKS_PATH)) {
    fs.writeFileSync(BOOKS_PATH, "[]\n", "utf8");
  }
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req, res) {
  try {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    send(res, 400, JSON.stringify({ error: "请求 JSON 格式不正确" }));
    return null;
  }
}

function readBooks() {
  ensureData();
  return JSON.parse(fs.readFileSync(BOOKS_PATH, "utf8") || "[]");
}

function writeBooks(books) {
  ensureData();
  backupBooks();
  fs.writeFileSync(BOOKS_PATH, JSON.stringify(books, null, 2), "utf8");
}

function backupBooks() {
  if (!fs.existsSync(BOOKS_PATH)) return;
  const now = new Date();
  const stamp = now.toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace("Z", "")
    .replace(".", "-");
  const backupPath = path.join(BACKUPS_DIR, `books-${stamp}.json`);
  fs.copyFileSync(BOOKS_PATH, backupPath);
}

function sanitizePathPart(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
}

function nextBookId(books) {
  let max = 0;
  for (const book of books) {
    const match = /^book_(\d+)$/.exec(book.id || "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `book_${String(max + 1).padStart(3, "0")}`;
}

function defaultCovers() {
  return {
    custom: { flat: "", threeD: "" },
    original: { flat: "", threeD: "" },
    fallback: { flat: "", threeD: "" },
  };
}

function normalizeBook(input, existing, books) {
  const now = new Date().toISOString().slice(0, 10);
  const book = existing ? { ...existing } : {
    id: input.id || nextBookId(books),
    createdAt: now,
  };
  book.title = String(input.title || "").trim();
  book.status = ["active", "offline"].includes(input.status) ? input.status : (book.status || "active");
  book.preferredVersion = ["auto", "custom", "original", "fallback"].includes(input.preferredVersion)
    ? input.preferredVersion
    : "auto";
  book.covers = {
    ...defaultCovers(),
    ...(input.covers || {}),
  };
  book.covers.custom = { ...defaultCovers().custom, ...(book.covers.custom || {}) };
  book.covers.original = { ...defaultCovers().original, ...(book.covers.original || {}) };
  book.covers.fallback = { ...defaultCovers().fallback, ...(book.covers.fallback || {}) };
  book.updatedAt = now;
  return book;
}

function localCoverPaths(book) {
  const covers = book && book.covers ? book.covers : {};
  return [
    covers.custom && covers.custom.flat,
    covers.custom && covers.custom.threeD,
    covers.original && covers.original.flat,
    covers.original && covers.original.threeD,
    covers.fallback && covers.fallback.flat,
    covers.fallback && covers.fallback.threeD,
  ].filter(value => value && !/^https?:\/\//i.test(value) && !String(value).startsWith("data:"));
}

function isInsideCoversDir(absolute) {
  const relative = path.relative(COVERS_DIR, absolute);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function cleanupUnreferencedCoverPaths(candidatePaths, remainingBooks) {
  const stillUsed = new Set(remainingBooks.flatMap(localCoverPaths));
  for (const relPath of candidatePaths) {
    if (stillUsed.has(relPath)) continue;
    const absolute = path.resolve(DATA_DIR, relPath);
    if (!isInsideCoversDir(absolute) || !fs.existsSync(absolute)) continue;
    try {
      fs.unlinkSync(absolute);
    } catch (error) {
      console.warn(`清理封面失败：${absolute}`, error.message);
    }
  }
}

function cleanupUnreferencedCovers(deletedBook, remainingBooks) {
  cleanupUnreferencedCoverPaths(localCoverPaths(deletedBook), remainingBooks);
}

function saveDataUrl(dataUrl, bookId, slotKey) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return "";
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return "";
  const mime = match[1].toLowerCase();
  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : mime.includes("gif") ? ".gif" : ".jpg";
  const filename = `${sanitizePathPart(bookId)}_${sanitizePathPart(slotKey)}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  const absolute = path.join(COVERS_DIR, filename);
  fs.writeFileSync(absolute, Buffer.from(match[2], "base64"));
  return `covers/${filename}`;
}

function processUploads(book, uploads) {
  const slots = [
    ["custom", "flat", "custom_flat"],
    ["original", "flat", "original_flat"],
    ["original", "threeD", "original_3d"],
    ["fallback", "flat", "fallback_flat"],
  ];
  for (const [version, slot, key] of slots) {
    const payload = uploads && uploads[key];
    if (payload && payload.dataUrl) {
      book.covers[version][slot] = saveDataUrl(payload.dataUrl, book.id, key);
    }
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let filePath;
  if (url.pathname === "/" || url.pathname === "/app") {
    filePath = path.join(APP_DIR, "index.html");
  } else if (url.pathname.startsWith("/app/")) {
    filePath = path.join(APP_DIR, decodeURIComponent(url.pathname.slice(5)));
  } else if (url.pathname.startsWith("/data/")) {
    filePath = path.join(DATA_DIR, decodeURIComponent(url.pathname.slice(6)));
  } else {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }

  const base = url.pathname.startsWith("/data/") ? DATA_DIR : APP_DIR;
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(base) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  send(res, 200, fs.readFileSync(resolved), MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream");
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/books" && req.method === "GET") {
    send(res, 200, JSON.stringify(readBooks()));
    return;
  }
  if (url.pathname === "/api/books/batch" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const titles = Array.isArray(payload.titles) ? payload.titles : [];
    const books = readBooks();
    const created = [];
    for (const title of titles) {
      const book = normalizeBook({ title, status: "active", preferredVersion: "auto", covers: defaultCovers() }, null, books);
      if (!book.title) continue;
      books.push(book);
      created.push(book);
    }
    if (!created.length) {
      send(res, 400, JSON.stringify({ error: "没有可新增的书名" }));
      return;
    }
    writeBooks(books);
    send(res, 200, JSON.stringify({ created }));
    return;
  }
  if (url.pathname === "/api/books" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const books = readBooks();
    const book = normalizeBook(payload.book || payload, null, books);
    if (!book.title) {
      send(res, 400, JSON.stringify({ error: "书名不能为空" }));
      return;
    }
    processUploads(book, payload.uploads);
    books.push(book);
    writeBooks(books);
    send(res, 200, JSON.stringify(book));
    return;
  }
  const bookMatch = /^\/api\/books\/([^/]+)$/.exec(url.pathname);
  if (bookMatch && req.method === "PUT") {
    const id = decodeURIComponent(bookMatch[1]);
    const payload = await readJson(req, res);
    if (!payload) return;
    const books = readBooks();
    const index = books.findIndex(book => book.id === id);
    if (index === -1) {
      send(res, 404, JSON.stringify({ error: "未找到书籍" }));
      return;
    }
    const oldBook = JSON.parse(JSON.stringify(books[index]));
    const book = normalizeBook({ ...payload.book, id }, books[index], books);
    if (!book.title) {
      send(res, 400, JSON.stringify({ error: "书名不能为空" }));
      return;
    }
    processUploads(book, payload.uploads);
    books[index] = book;
    writeBooks(books);
    cleanupUnreferencedCoverPaths(localCoverPaths(oldBook), books);
    send(res, 200, JSON.stringify(book));
    return;
  }
  if (bookMatch && req.method === "DELETE") {
    const id = decodeURIComponent(bookMatch[1]);
    const books = readBooks();
    const deleted = books.find(book => book.id === id);
    if (!deleted) {
      send(res, 404, JSON.stringify({ error: "未找到书籍" }));
      return;
    }
    const remaining = books.filter(book => book.id !== id);
    cleanupUnreferencedCovers(deleted, remaining);
    writeBooks(remaining);
    send(res, 200, JSON.stringify({ ok: true }));
    return;
  }
  send(res, 404, JSON.stringify({ error: "Not found" }));
}

ensureData();
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => send(res, 500, JSON.stringify({ error: error.message })));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`书封资料库工具已启动：http://localhost:${PORT}`);
});
