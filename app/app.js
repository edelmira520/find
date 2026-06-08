let books = [];
let recognizedTitles = [];
let currentResults = [];
let editingBook = null;
let returnToMissingTitle = "";
const uploadState = {};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const versionLabels = {
  custom: "自制版",
  original: "原版",
  fallback: "普通版",
  noCover: "缺封面",
};

function emptyCovers() {
  return {
    custom: { flat: "", threeD: "" },
    original: { flat: "", threeD: "" },
    fallback: { flat: "", threeD: "" },
  };
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[《》<>〈〉【】\[\]（）()“”"'‘’]/g, "")
    .replace(/[：:，,。.!！?？、·\-—_\s]/g, "")
    .trim();
}

function dataUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  return `/data/${path}`;
}

function actualVersion(book) {
  const covers = book.covers || emptyCovers();
  if (covers.custom && covers.custom.flat) return "custom";
  if (covers.original && covers.original.flat) return "original";
  if (covers.fallback && covers.fallback.flat) return "fallback";
  return "noCover";
}

function displayCovers(book) {
  const version = actualVersion(book);
  const covers = book.covers || emptyCovers();
  if (version === "custom") return { version, flat: covers.custom.flat, threeD: "" };
  if (version === "original") return { version, flat: covers.original.flat, threeD: covers.original.threeD || "" };
  if (version === "fallback") return { version, flat: covers.fallback.flat, threeD: "" };
  return { version, flat: "", threeD: "" };
}

async function loadBooks() {
  const response = await fetch("/api/books");
  books = await response.json();
  renderManageList();
}

function extractTitles(text) {
  const found = [];
  const seen = new Set();
  const add = title => {
    let cleaned = title.replace(/^《|》$/g, "").trim();
    cleaned = cleaned.replace(/^(还有|以及|另有|和|与|及)\s*/, "").trim();
    cleaned = cleaned.replace(/^(本周|这周|今天|明天|昨天).*(找|查|要)\s*$/, "").trim();
    cleaned = cleaned.replace(/^(请|帮我|麻烦)?(找|查找|查询|需要|要找)\s*/, "").trim();
    if (!cleaned) return;
    if (/^(本周|这周|今天|明天|昨天|还有|以及|另有)$/.test(cleaned)) return;
    const key = normalize(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(cleaned);
  };

  const bracketMatches = text.match(/《[^》]+》/g) || [];
  bracketMatches.forEach(match => add(match));

  let remainder = text.replace(/《[^》]+》/g, "\n");
  remainder
    .split(/[\n\r,，、;；]+/g)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      if (part.length <= 30) add(part);
    });

  return found;
}

function renderTitlePreview() {
  $("#previewPanel").classList.toggle("hidden", recognizedTitles.length === 0);
  $("#runMatch").disabled = recognizedTitles.length === 0;
  $("#previewCount").textContent = `识别到 ${recognizedTitles.length} 本`;
  $("#titleChips").innerHTML = "";

  recognizedTitles.forEach((title, index) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    const input = document.createElement("input");
    input.value = title;
    input.addEventListener("change", () => {
      recognizedTitles[index] = input.value.trim();
      recognizedTitles = recognizedTitles.filter(Boolean);
      renderTitlePreview();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      recognizedTitles.splice(index, 1);
      renderTitlePreview();
    });
    chip.append(input, remove);
    $("#titleChips").append(chip);
  });
}

function similarity(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length) / Math.max(left.length, right.length) * 0.92;
  }
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i++) dp[i][0] = i;
  for (let j = 0; j <= right.length; j++) dp[0][j] = j;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return 1 - dp[left.length][right.length] / Math.max(left.length, right.length);
}

function matchTitle(inputTitle) {
  const candidates = books
    .map(book => ({ book, score: similarity(inputTitle, book.title) }))
    .filter(item => item.score >= 0.38)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const best = candidates[0];
  if (best && best.score >= 0.88) return { inputTitle, status: "matched", book: best.book, candidates };
  if (best && best.score >= 0.55) return { inputTitle, status: "possible", book: best.book, candidates };
  return { inputTitle, status: "missing", book: null, candidates };
}

function runMatching() {
  currentResults = recognizedTitles.filter(Boolean).map(matchTitle);
  renderResults();
}

function renderResults() {
  const panel = $("#resultsPanel");
  panel.classList.toggle("hidden", currentResults.length === 0);
  const summary = currentResults.reduce((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { matched: 0, possible: 0, missing: 0 });
  $("#matchSummary").textContent = `已匹配 ${summary.matched} / 可能匹配 ${summary.possible} / 未找到 ${summary.missing}`;
  $("#results").innerHTML = "";
  currentResults.forEach((result, index) => $("#results").append(renderResultCard(result, index)));
}

function statusLabel(status) {
  return status === "matched" ? "已匹配" : status === "possible" ? "可能匹配" : "未找到";
}

function renderCoverStage(book) {
  if (!book) return `<div class="cover-stage"><div class="no-image">未找到封面</div></div>`;
  const covers = displayCovers(book);
  const flat = covers.flat ? `<img class="flat-cover" src="${dataUrl(covers.flat)}" alt="平面封面">` : `<div class="no-image">缺平面封面</div>`;
  const three = covers.threeD ? `<img class="three-cover" src="${dataUrl(covers.threeD)}" alt="立体封面">` : "";
  return `<div class="cover-stage">${flat}${three}</div>`;
}

function renderResultCard(result, index) {
  const card = document.createElement("article");
  card.className = `result-card ${result.status}`;
  const book = result.book;
  const version = book ? actualVersion(book) : "noCover";
  card.innerHTML = `
    ${renderCoverStage(book)}
    <div class="card-body">
      <span class="status">${statusLabel(result.status)}</span>
      <h3>${escapeHtml(result.inputTitle)}</h3>
      <div class="meta">匹配到：${book ? escapeHtml(book.title) : "无"}</div>
      <div class="meta">当前版本：${versionLabels[version]}</div>
      <div class="candidate-list"></div>
    </div>
  `;
  const list = card.querySelector(".candidate-list");
  if (result.status === "possible") {
    result.candidates.forEach(candidate => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${candidate.book.title}（${Math.round(candidate.score * 100)}%）`;
      button.addEventListener("click", () => {
        currentResults[index] = { ...result, status: "matched", book: candidate.book };
        renderResults();
      });
      list.append(button);
    });
  }
  if (result.status === "missing") {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = "新增这本书";
    add.addEventListener("click", () => openBookDialog(null, result.inputTitle));
    list.append(add);
  }
  return card;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderManageList() {
  const query = normalize($("#manageSearch").value);
  const list = $("#bookList");
  list.innerHTML = "";
  books
    .filter(book => !query || normalize(book.title).includes(query))
    .forEach(book => {
      const row = document.createElement("div");
      row.className = "book-row";
      const covers = displayCovers(book);
      const thumb = covers.flat ? `<img src="${dataUrl(covers.flat)}" alt="">` : `<div class="thumb-placeholder">无图</div>`;
      row.innerHTML = `
        ${thumb}
        <div>
          <strong>${escapeHtml(book.title)}</strong>
          <div class="meta">当前实际展示版本：${versionLabels[covers.version]}</div>
        </div>
        <div class="meta">${covers.threeD ? "有立体封" : "无立体封"}</div>
        <button class="ghost">编辑</button>
      `;
      row.querySelector("button").addEventListener("click", () => openBookDialog(book));
      list.append(row);
    });
}

function openBookDialog(book, presetTitle = "") {
  editingBook = book;
  returnToMissingTitle = presetTitle;
  Object.keys(uploadState).forEach(key => delete uploadState[key]);
  $("#dialogTitle").textContent = book ? "编辑书籍" : "新增书籍";
  $("#bookId").value = book ? book.id : "";
  $("#bookTitle").value = book ? book.title : presetTitle;
  $("#deleteBook").style.display = book ? "" : "none";
  fillUploadSlots(book || { covers: emptyCovers() });
  updateActualVersionPreview();
  $("#bookDialog").showModal();
}

function fillUploadSlots(book) {
  const covers = { ...emptyCovers(), ...(book.covers || {}) };
  const values = {
    custom_flat: covers.custom?.flat || "",
    original_flat: covers.original?.flat || "",
    original_3d: covers.original?.threeD || "",
    fallback_flat: covers.fallback?.flat || "",
  };
  $$(".upload-slot").forEach(slot => {
    const key = slot.dataset.slot;
    const urlInput = slot.querySelector(".cover-path");
    const fileInput = slot.querySelector('input[type="file"]');
    const img = slot.querySelector("img");
    urlInput.value = values[key] || "";
    fileInput.value = "";
    if (values[key]) {
      img.src = dataUrl(values[key]);
      slot.classList.add("has-image");
    } else {
      img.removeAttribute("src");
      slot.classList.remove("has-image");
    }
  });
}

function collectBookFromForm() {
  const covers = emptyCovers();
  covers.custom.flat = getSlotValue("custom_flat");
  covers.original.flat = getSlotValue("original_flat");
  covers.original.threeD = getSlotValue("original_3d");
  covers.fallback.flat = getSlotValue("fallback_flat");
  return {
    id: $("#bookId").value,
    title: $("#bookTitle").value.trim(),
    preferredVersion: "auto",
    covers,
  };
}

function getSlotValue(key) {
  return $(`.upload-slot[data-slot="${key}"] .cover-path`).value.trim();
}

function updateActualVersionPreview() {
  const book = collectBookFromForm();
  if (uploadState.custom_flat) book.covers.custom.flat = "__pending_upload__";
  if (uploadState.original_flat) book.covers.original.flat = "__pending_upload__";
  if (uploadState.original_3d) book.covers.original.threeD = "__pending_upload__";
  if (uploadState.fallback_flat) book.covers.fallback.flat = "__pending_upload__";
  const version = actualVersion(book);
  const reason = version === "custom"
    ? "存在自制平封"
    : version === "original"
      ? "没有自制平封，存在原版平封"
      : version === "fallback"
        ? "没有自制平封和原版平封，存在普通平封"
        : "尚未设置可展示的平面封面";
  $("#actualVersion").textContent = `当前实际展示版本：${versionLabels[version]}。原因：${reason}`;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveBook(event) {
  event.preventDefault();
  const book = collectBookFromForm();
  const uploads = {};
  for (const [key, value] of Object.entries(uploadState)) {
    uploads[key] = value;
  }
  const isEdit = Boolean(book.id);
  const response = await fetch(isEdit ? `/api/books/${encodeURIComponent(book.id)}` : "/api/books", {
    method: isEdit ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ book, uploads }),
  });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || "保存失败");
    return;
  }
  const saved = await response.json();
  $("#bookDialog").close();
  await loadBooks();
  if (returnToMissingTitle) {
    const index = currentResults.findIndex(result => normalize(result.inputTitle) === normalize(returnToMissingTitle));
    if (index >= 0) {
      currentResults[index] = { inputTitle: returnToMissingTitle, status: "matched", book: saved, candidates: [{ book: saved, score: 1 }] };
      renderResults();
    }
  }
}

async function deleteCurrentBook() {
  if (!editingBook) return;
  if (!confirm(`确定删除《${editingBook.title}》吗？`)) return;
  await fetch(`/api/books/${encodeURIComponent(editingBook.id)}`, { method: "DELETE" });
  $("#bookDialog").close();
  await loadBooks();
}

function bindEvents() {
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach(item => item.classList.remove("active"));
      tab.classList.add("active");
      $$(".view").forEach(view => view.classList.remove("active"));
      $(`#${tab.dataset.view}View`).classList.add("active");
    });
  });

  $("#extractTitles").addEventListener("click", () => {
    recognizedTitles = extractTitles($("#pasteInput").value);
    renderTitlePreview();
  });
  $("#addManualTitle").addEventListener("click", () => {
    const title = $("#manualTitle").value.trim();
    if (title) recognizedTitles.push(title);
    $("#manualTitle").value = "";
    renderTitlePreview();
  });
  $("#runMatch").addEventListener("click", runMatching);
  $("#clearSearch").addEventListener("click", () => {
    $("#pasteInput").value = "";
    recognizedTitles = [];
    currentResults = [];
    renderTitlePreview();
    renderResults();
  });
  $("#gridMode").addEventListener("click", () => {
    $("#results").classList.remove("list");
    $("#gridMode").classList.add("active");
    $("#listMode").classList.remove("active");
  });
  $("#listMode").addEventListener("click", () => {
    $("#results").classList.add("list");
    $("#listMode").classList.add("active");
    $("#gridMode").classList.remove("active");
  });

  $("#manageSearch").addEventListener("input", renderManageList);
  $("#newBook").addEventListener("click", () => openBookDialog());
  $("#bookForm").addEventListener("submit", saveBook);
  $("#deleteBook").addEventListener("click", deleteCurrentBook);

  $$(".upload-slot").forEach(slot => {
    const key = slot.dataset.slot;
    const zone = slot.querySelector(".drop-zone");
    const fileInput = slot.querySelector('input[type="file"]');
    const urlInput = slot.querySelector(".cover-path");
    const img = slot.querySelector("img");
    const setFile = async file => {
      if (!file) return;
      const dataUrlValue = await fileToDataUrl(file);
      uploadState[key] = { dataUrl: dataUrlValue };
      urlInput.value = "";
      img.src = dataUrlValue;
      slot.classList.add("has-image");
      updateActualVersionPreview();
    };
    zone.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
    urlInput.addEventListener("input", () => {
      delete uploadState[key];
      if (urlInput.value.trim()) {
        img.src = dataUrl(urlInput.value.trim());
        slot.classList.add("has-image");
      }
      updateActualVersionPreview();
    });
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
    zone.addEventListener("drop", event => {
      event.preventDefault();
      setFile(event.dataTransfer.files[0]);
    });
  });
}

bindEvents();
loadBooks();
