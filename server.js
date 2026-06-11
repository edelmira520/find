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
const SPEAKERS_PATH = path.join(DATA_DIR, "speakers.json");
const DEFAULT_SPEAKER = { id: "fandeng", name: "樊登" };
const PORT = Number(process.env.PORT || 4173);
const REMOVED_STATUSES = new Set(["下架", "已下架", "停售", "不上架", "停用", "removed", "discontinued", "inactive", "offline"]);

const MAX_JSON_BODY_BYTES = 50 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_UPLOAD_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

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
  if (!fs.existsSync(SPEAKERS_PATH)) {
    fs.writeFileSync(SPEAKERS_PATH, `${JSON.stringify([DEFAULT_SPEAKER], null, 2)}\n`, "utf8");
  }
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_JSON_BODY_BYTES) {
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
  try {
    const parsed = JSON.parse(fs.readFileSync(BOOKS_PATH, "utf8") || "[]");
    if (!Array.isArray(parsed)) throw new Error("books.json must contain an array");
    return parsed
      .map(book => normalizeSpeakerFields(book))
      .filter(shouldKeepBook);
  } catch (error) {
    const wrapped = new Error(`资料库文件 data/books.json 格式不正确：${error.message}`);
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

function normalizeSpeakerFields(book) {
  return {
    ...book,
    speakerId: String(book.speakerId || DEFAULT_SPEAKER.id).trim() || DEFAULT_SPEAKER.id,
    speakerName: String(book.speakerName || DEFAULT_SPEAKER.name).trim() || DEFAULT_SPEAKER.name,
  };
}

function readSpeakers() {
  ensureData();
  try {
    const parsed = JSON.parse(fs.readFileSync(SPEAKERS_PATH, "utf8") || "[]");
    if (!Array.isArray(parsed)) throw new Error("speakers.json must contain an array");
    const speakers = parsed
      .map(speaker => ({
        id: String(speaker.id || "").trim(),
        name: String(speaker.name || "").trim(),
      }))
      .filter(speaker => speaker.id && speaker.name);
    if (!speakers.some(speaker => speaker.id === DEFAULT_SPEAKER.id)) speakers.unshift(DEFAULT_SPEAKER);
    return speakers;
  } catch (error) {
    const wrapped = new Error(`讲书人文件 data/speakers.json 格式不正确：${error.message}`);
    wrapped.statusCode = 500;
    throw wrapped;
  }
}

function writeSpeakers(speakers) {
  ensureData();
  const tempPath = `${SPEAKERS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(speakers, null, 2), "utf8");
  fs.renameSync(tempPath, SPEAKERS_PATH);
}

function slugSpeakerId(name, existingSpeakers) {
  const cleaned = sanitizePathPart(name).toLowerCase().replace(/^_+|_+$/g, "");
  const base = cleaned || `speaker_${crypto.randomBytes(3).toString("hex")}`;
  const used = new Set(existingSpeakers.map(speaker => speaker.id));
  let id = base;
  let index = 2;
  while (used.has(id)) {
    id = `${base}_${index}`;
    index += 1;
  }
  return id;
}

function isReservedSpeaker(speaker) {
  return speaker.id === "all" || speaker.name === "全部";
}

function hasConcreteSpeaker(book) {
  return Boolean(book.speakerId && book.speakerName && !isReservedSpeaker({ id: book.speakerId, name: book.speakerName }));
}

function writeBooks(books) {
  ensureData();
  backupBooks();
  const activeBooks = books.filter(shouldKeepBook);
  const tempPath = `${BOOKS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(activeBooks, null, 2), "utf8");
  fs.renameSync(tempPath, BOOKS_PATH);
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
    cover: "",
    standing: "",
  };
}

function normalizeBookStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function shouldKeepBook(book) {
  return !REMOVED_STATUSES.has(normalizeBookStatus(book && book.status));
}

function normalizeNoteText(value) {
  return String(value || "")
    .replace(/优先使用\s*原版书封/g, "")
    .replace(/优先使用\s*书封/g, "")
    .replace(/原版|自制|平封/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCovers(inputCovers = {}) {
  return {
    cover: String(inputCovers.cover || inputCovers.original?.flat || "").trim(),
    standing: String(inputCovers.standing || inputCovers.original?.threeD || "").trim(),
  };
}

function normalizeBook(input, existing, books) {
  const now = new Date().toISOString().slice(0, 10);
  const book = existing ? { ...existing } : {
    id: nextBookId(books),
    createdAt: now,
  };
  book.title = String(input.title || "").trim();
  book.note = Object.prototype.hasOwnProperty.call(input, "note")
    ? normalizeNoteText(input.note)
    : normalizeNoteText(book.note);
  book.status = Object.prototype.hasOwnProperty.call(input, "status")
    ? String(input.status || "").trim()
    : (book.status || "active");
  book.speakerId = String(input.speakerId || book.speakerId || DEFAULT_SPEAKER.id).trim() || DEFAULT_SPEAKER.id;
  book.speakerName = String(input.speakerName || book.speakerName || DEFAULT_SPEAKER.name).trim() || DEFAULT_SPEAKER.name;
  const inputCovers = input.covers || {};
  book.covers = normalizeCovers(inputCovers);
  delete book.preferredVersion;
  book.updatedAt = now;
  return book;
}

function localCoverPaths(book) {
  const covers = book && book.covers ? book.covers : {};
  return [
    covers.custom && covers.custom.flat,
    covers.custom && covers.custom.threeD,
    covers.fallback && covers.fallback.flat,
    covers.fallback && covers.fallback.threeD,
    covers.original && covers.original.flat,
    covers.original && covers.original.threeD,
    covers.cover,
    covers.standing,
  ].filter(value => value && !/^https?:\/\//i.test(value) && !String(value).startsWith("data:"));
}

function isInsideCoversDir(absolute) {
  return isInsideDir(COVERS_DIR, absolute);
}

function isInsideDir(baseDir, absolutePath) {
  const relative = path.relative(baseDir, absolutePath);
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

function migrateBooksOnStartup() {
  ensureData();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(BOOKS_PATH, "utf8") || "[]");
  } catch (error) {
    console.warn(`启动清理跳过：books.json 无法解析：${error.message}`);
    return;
  }
  if (!Array.isArray(parsed)) return;
  const oldPaths = parsed.flatMap(localCoverPaths);
  const normalized = parsed
    .map(book => normalizeSpeakerFields(book))
    .filter(shouldKeepBook)
    .map(book => normalizeBook(book, book, parsed));
  if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
    writeBooks(normalized);
  }
  cleanupUnreferencedCoverPaths(oldPaths, normalized);
}

function saveDataUrl(dataUrl, bookId, slotKey) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return "";
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return "";
  const mime = match[1].toLowerCase();
  if (!ALLOWED_UPLOAD_MIMES.has(mime)) {
    throw new Error("只支持 JPG、PNG、WebP 或 GIF 图片");
  }

  let buffer;
  try {
    buffer = Buffer.from(match[2], "base64");
  } catch (error) {
    throw new Error("图片数据格式不正确");
  }
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`单张图片不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }

  const ext = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : mime.includes("gif") ? ".gif" : ".jpg";
  const filename = `${sanitizePathPart(bookId)}_${sanitizePathPart(slotKey)}_${crypto.randomBytes(4).toString("hex")}${ext}`;
  const absolute = path.join(COVERS_DIR, filename);
  fs.writeFileSync(absolute, buffer);
  return `covers/${filename}`;
}

function processUploads(book, uploads) {
  const slots = [
    "cover",
    "standing",
  ];
  for (const key of slots) {
    const payload = uploads && uploads[key];
    if (payload && payload.dataUrl) {
      book.covers[key] = saveDataUrl(payload.dataUrl, book.id, key);
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
  if (!isInsideDir(base, resolved) || !fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    send(res, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  send(res, 200, fs.readFileSync(resolved), MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream");
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === "/api/speakers" && req.method === "GET") {
    send(res, 200, JSON.stringify(readSpeakers()));
    return;
  }
  if (url.pathname === "/api/speakers" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const speakers = readSpeakers();
    const name = String(payload.name || "").trim();
    const requestedId = String(payload.id || "").trim();
    if (!name) {
      send(res, 400, JSON.stringify({ error: "讲书人名称不能为空" }));
      return;
    }
    if (requestedId === "all" || name === "全部") {
      send(res, 400, JSON.stringify({ error: "“全部”只是筛选项，不能保存为讲书人" }));
      return;
    }
    const existing = speakers.find(speaker => speaker.name === name || (requestedId && speaker.id === requestedId));
    if (existing) {
      send(res, 200, JSON.stringify(existing));
      return;
    }
    const speaker = { id: requestedId || slugSpeakerId(name, speakers), name };
    speakers.push(speaker);
    writeSpeakers(speakers);
    send(res, 200, JSON.stringify(speaker));
    return;
  }
  if (url.pathname === "/api/books" && req.method === "GET") {
    send(res, 200, JSON.stringify(readBooks()));
    return;
  }
  if (url.pathname === "/api/books/batch" && req.method === "POST") {
    const payload = await readJson(req, res);
    if (!payload) return;
    const titles = Array.isArray(payload.titles) ? payload.titles : [];
    const speakerId = String(payload.speakerId || DEFAULT_SPEAKER.id).trim() || DEFAULT_SPEAKER.id;
    const speakerName = String(payload.speakerName || DEFAULT_SPEAKER.name).trim() || DEFAULT_SPEAKER.name;
    if (isReservedSpeaker({ id: speakerId, name: speakerName })) {
      send(res, 400, JSON.stringify({ error: "批量草稿必须选择具体讲书人" }));
      return;
    }
    const books = readBooks();
    const created = [];
    for (const title of titles) {
      const book = normalizeBook({ title, speakerId, speakerName, status: "active", covers: defaultCovers() }, null, books);
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
    if (!hasConcreteSpeaker(book)) {
      send(res, 400, JSON.stringify({ error: "书籍必须归属到具体讲书人" }));
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
    if (!hasConcreteSpeaker(book)) {
      send(res, 400, JSON.stringify({ error: "书籍必须归属到具体讲书人" }));
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
migrateBooksOnStartup();
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => send(res, error.statusCode || 500, JSON.stringify({ error: error.message })));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`书封资料库工具已启动：http://localhost:${PORT}`);
});
