let books = [];
let recognizedTitles = [];
let currentResults = [];
let activeResultFilter = "all";
let editingBook = null;
let selectedBookId = "";
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

const bookStatusLabels = {
  active: "正常可用",
  offline: "平台已下架",
};

const versionReasons = {
  custom: "当前使用自制平封",
  original: "当前使用原版平封，可搭配原版立封",
  fallback: "当前使用普通平封",
  noCover: "尚未设置可展示的平面封面",
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  return `/data/${path}`;
}

function absoluteAssetUrl(path) {
  if (!path) return "";
  const url = dataUrl(path);
  if (/^data:/i.test(url)) return url;
  return new URL(url, window.location.origin).href;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

async function copyCover(path, label, trigger) {
  if (!path) return;
  const url = absoluteAssetUrl(path);
  try {
    if (navigator.clipboard?.write && window.ClipboardItem && !url.startsWith("data:")) {
      const response = await fetch(url);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
      flashCopyButton(trigger, `已复制${label}`);
      return;
    }
    await copyText(url);
    flashCopyButton(trigger, "已复制链接");
  } catch (error) {
    await copyText(url);
    flashCopyButton(trigger, "已复制链接");
  }
}

async function copyCoverFromResult(result, path, label, trigger) {
  if (result?.status === "offline" && !confirm("这本书已在平台下架，确定仍要复制封面吗？")) {
    return;
  }
  await copyCover(path, label, trigger);
}

function flashCopyButton(button, text) {
  if (!button) return;
  const original = button.textContent;
  button.textContent = text;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1300);
}

function slotMap() {
  return {
    custom_flat: ["custom", "flat"],
    original_flat: ["original", "flat"],
    original_3d: ["original", "threeD"],
    fallback_flat: ["fallback", "flat"],
  };
}

function cloneBook(book) {
  return JSON.parse(JSON.stringify(book || { covers: emptyCovers(), preferredVersion: "auto" }));
}

function bookStatus(book) {
  return book?.status === "offline" ? "offline" : "active";
}

function isOffline(book) {
  return bookStatus(book) === "offline";
}

function bookNote(book) {
  return String(book?.note || "").trim();
}

function prefersOriginalFromNote(book) {
  return bookNote(book).replace(/\s+/g, "").includes("优先使用原版书封");
}

function noteBadgeText(book) {
  if (!bookNote(book)) return "";
  return prefersOriginalFromNote(book) ? "备注：用原版" : "有备注";
}

function hasFlat(book, version) {
  return Boolean(book?.covers?.[version]?.flat);
}

function preferredVersionMissingFlat(book) {
  const preferred = book?.preferredVersion || "auto";
  return preferred !== "auto" && ["custom", "original", "fallback"].includes(preferred) && !hasFlat(book, preferred);
}

function actualVersion(book) {
  const preferred = book?.preferredVersion || "auto";
  const covers = { ...emptyCovers(), ...(book?.covers || {}) };
  if (["custom", "original", "fallback"].includes(preferred)) {
    return covers[preferred]?.flat ? preferred : "noCover";
  }
  if (covers.custom?.flat) return "custom";
  if (covers.original?.flat) return "original";
  if (covers.fallback?.flat) return "fallback";
  return "noCover";
}

function displayCovers(book) {
  const version = actualVersion(book);
  const covers = { ...emptyCovers(), ...(book?.covers || {}) };
  if (version === "custom") return { version, flat: covers.custom.flat, threeD: "" };
  if (version === "original") return { version, flat: covers.original.flat, threeD: covers.original.threeD || "" };
  if (version === "fallback") return { version, flat: covers.fallback.flat, threeD: "" };
  return { version, flat: "", threeD: "" };
}

function displayReason(book) {
  const preferred = book?.preferredVersion || "auto";
  const version = actualVersion(book);
  if (preferred !== "auto" && version === "noCover") {
    return `手动选择了 ${versionLabels[preferred]}，但该版本没有平面封面`;
  }
  if (preferred !== "auto") return `手动选择 ${versionLabels[preferred]}`;
  if (version === "custom") return "auto 规则命中：自制平封优先";
  if (version === "original") return "auto 规则命中：无自制平封，使用原版平封";
  if (version === "fallback") return "auto 规则命中：无自制/原版平封，使用普通平封";
  return versionReasons.noCover;
}

async function loadBooks() {
  const response = await fetch("/api/books");
  books = await response.json();
  renderManageList();
  if (selectedBookId) {
    const fresh = books.find(book => book.id === selectedBookId);
    if (fresh) openBookEditor(fresh);
  }
}

function extractTitles(text) {
  const found = [];
  const seen = new Set();
  const add = title => {
    let cleaned = title.replace(/^《|》$/g, "").trim();
    cleaned = cleaned.replace(/^(还有|以及|另有|和|及)\s*/, "").trim();
    cleaned = cleaned.replace(/^(一本|这本|那本)\s*/, "").trim();
    cleaned = cleaned.replace(/^(请|帮我|麻烦)?(找|查找|查询|需要|要找)\s*/, "").trim();
    cleaned = cleaned.replace(/^(本周|这周|今天|明天|昨天).*(找|查|要)\s*/, "").trim();
    cleaned = cleaned.replace(/(这几本|这些书|封面|书封|资料)$/g, "").trim();
    if (!cleaned || cleaned.length > 40) return;
    if (/^(本周|这周|今天|明天|昨天|还有|以及|另有)$/.test(cleaned)) return;
    const key = normalize(cleaned);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(cleaned);
  };

  (text.match(/《[^》]+》/g) || []).forEach(match => add(match));
  text
    .replace(/《[^》]+》/g, "\n")
    .replace(/\s*(?:以及|还有|另有)\s*/g, "\n")
    .replace(/([^\s,，、;；\n\r]{2,})和([^\s,，、;；\n\r]{2,})/g, "$1\n$2")
    .split(/[\n\r,，、;；]+/g)
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(add);

  return found;
}

function syncRecognizedFromPaste() {
  recognizedTitles = extractTitles($("#pasteInput").value);
  renderTitlePreview();
}

function renderTitlePreview() {
  $("#runMatch").disabled = recognizedTitles.length === 0;
  $("#runMatch").textContent = recognizedTitles.length ? `匹配 ${recognizedTitles.length} 本` : "开始匹配";
  $("#previewCount").textContent = `识别到 ${recognizedTitles.length} 本`;
  const chips = $("#titleChips");
  chips.innerHTML = "";
  chips.classList.toggle("empty", recognizedTitles.length === 0);
  if (!recognizedTitles.length) {
    chips.innerHTML = `<span class="empty-tip">粘贴文本后会自动出现可编辑书名标签</span>`;
    return;
  }

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
    remove.setAttribute("aria-label", "删除");
    remove.addEventListener("click", () => {
      recognizedTitles.splice(index, 1);
      renderTitlePreview();
    });
    chip.append(input, remove);
    chips.append(chip);
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
  const inputKey = normalize(inputTitle);
  const candidates = books
    .map(book => ({ book, score: similarity(inputTitle, book.title) }))
    .filter(item => item.score >= 0.38)
    .sort((a, b) => {
      const aExact = normalize(a.book.title) === inputKey;
      const bExact = normalize(b.book.title) === inputKey;
      if (aExact && bExact && isOffline(a.book) !== isOffline(b.book)) return isOffline(a.book) ? 1 : -1;
      if (Math.abs(b.score - a.score) < 0.001 && isOffline(a.book) !== isOffline(b.book)) return isOffline(a.book) ? 1 : -1;
      return b.score - a.score;
    })
    .slice(0, 5);
  const best = candidates[0];
  if (best && best.score >= 0.55 && isOffline(best.book)) return { inputTitle, status: "offline", book: best.book, candidates };
  if (best && best.score >= 0.88) return { inputTitle, status: "matched", book: best.book, candidates };
  if (best && best.score >= 0.55) return { inputTitle, status: "possible", book: best.book, candidates };
  return { inputTitle, status: "missing", book: null, candidates };
}

function runMatching() {
  currentResults = recognizedTitles.filter(Boolean).map(matchTitle);
  activeResultFilter = "all";
  $$(".filter").forEach(button => button.classList.toggle("active", button.dataset.filter === "all"));
  renderResults();
}

function resultStats() {
  const stats = currentResults.reduce((acc, result) => {
    acc[result.status] += 1;
    return acc;
  }, { matched: 0, possible: 0, missing: 0, offline: 0 });
  stats.total = currentResults.length;
  return stats;
}

function renderResults() {
  $("#resultsPanel").classList.toggle("hidden", currentResults.length === 0);
  const stats = resultStats();
  $("#matchSummary").textContent = `识别 ${stats.total} 本、已匹配 ${stats.matched} 本、已下架 ${stats.offline} 本、待确认 ${stats.possible} 本、未找到 ${stats.missing} 本`;
  const visible = currentResults.filter(result => activeResultFilter === "all" || result.status === activeResultFilter);
  $("#results").innerHTML = "";
  visible.forEach(result => {
    const index = currentResults.indexOf(result);
    $("#results").append(renderResultCard(result, index));
  });
}

function statusLabel(status) {
  if (status === "matched") return "已匹配";
  if (status === "possible") return "待确认";
  if (status === "offline") return "已下架";
  return "未找到";
}

function renderCoverStage(result) {
  const { book, status } = result;
  const covers = book ? displayCovers(book) : { version: "noCover", flat: "", threeD: "" };
  const statusText = status === "offline" ? statusLabel(status) : result.confirmedManually ? "已手动确认" : statusLabel(status);
  const versionText = book && preferredVersionMissingFlat(book) ? "手选缺平封" : versionLabels[covers.version];
  const flat = covers.flat
    ? `<img class="flat-cover" src="${dataUrl(covers.flat)}" alt="平面封面">`
    : `<div class="no-image">空封面</div>`;
  const three = covers.threeD ? `<img class="three-cover" src="${dataUrl(covers.threeD)}" alt="立体封面">` : "";
  return `
    <div class="cover-stage">
      ${flat}
      ${three}
      <span class="badge status-badge ${status}">${statusText}</span>
      <span class="badge version-badge ${covers.version}">${versionText}</span>
    </div>
  `;
}

function renderResultCard(result, index) {
  const card = document.createElement("article");
  card.className = `result-card ${result.status}`;
  const book = result.book;
  const version = book ? actualVersion(book) : "noCover";
  const manualMissing = book && preferredVersionMissingFlat(book);
  const offline = book && isOffline(book);
  const noteBadge = book ? noteBadgeText(book) : "";
  card.innerHTML = `
    ${renderCoverStage(result)}
    <div class="card-body">
      <h3>${escapeHtml(result.inputTitle)}</h3>
      <div class="meta">${book ? `匹配到：${escapeHtml(book.title)}` : "资料库暂无匹配"}</div>
      ${offline ? `<div class="meta offline-text">平台已下架</div>` : ""}
      <div class="meta">${manualMissing ? "手动选择的版本缺少平面封面" : `当前版本：${versionLabels[version]}`}</div>
      ${noteBadge ? `<div class="note-chip">${escapeHtml(noteBadge)}</div>` : ""}
      ${result.confirmedManually ? `<div class="manual-mark">人工确认</div>` : ""}
      <div class="card-actions"></div>
      <div class="candidate-list"></div>
    </div>
  `;
  card.querySelector(".cover-stage").addEventListener("click", () => openDetail(result));
  card.querySelector("h3").addEventListener("click", () => openDetail(result));
  const actions = card.querySelector(".card-actions");
  const list = card.querySelector(".candidate-list");

  if (result.status === "matched" || result.status === "offline") {
    const covers = displayCovers(book);
    if (covers.flat) {
      const copyFlat = document.createElement("button");
      copyFlat.type = "button";
      copyFlat.className = result.status === "offline" ? "ghost" : "copy-btn";
      copyFlat.textContent = "复制平封";
      copyFlat.addEventListener("click", event => {
        event.stopPropagation();
        copyCoverFromResult(result, covers.flat, "平封", copyFlat);
      });
      actions.append(copyFlat);
    }
    if (covers.threeD) {
      const copyThree = document.createElement("button");
      copyThree.type = "button";
      copyThree.className = result.status === "offline" ? "ghost" : "copy-btn";
      copyThree.textContent = "复制立封";
      copyThree.addEventListener("click", event => {
        event.stopPropagation();
        copyCoverFromResult(result, covers.threeD, "立封", copyThree);
      });
      actions.append(copyThree);
    }
    const detail = document.createElement("button");
    detail.type = "button";
    detail.className = "ghost";
    detail.textContent = "查看详情";
    detail.addEventListener("click", () => openDetail(result));
    actions.append(detail);
  }

  if (result.status === "possible") {
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary";
    confirm.textContent = "确认此匹配";
    confirm.addEventListener("click", () => {
      currentResults[index] = { ...result, status: isOffline(result.book) ? "offline" : "matched", confirmedManually: true };
      renderResults();
    });
    actions.append(confirm);
    result.candidates.forEach(candidate => list.append(renderCandidate(candidate, index, result)));
  }

  if (result.status === "missing") {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary missing-add";
    add.textContent = "新增这本书";
    add.addEventListener("click", () => openBookEditor(null, result.inputTitle));
    actions.append(add);
  }

  return card;
}

function renderCandidate(candidate, index, result) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "candidate";
  const covers = displayCovers(candidate.book);
  button.innerHTML = `
    ${covers.flat ? `<img src="${dataUrl(covers.flat)}" alt="">` : `<span class="candidate-empty">无图</span>`}
    <span>
      <strong>${escapeHtml(candidate.book.title)}</strong>
      <small>${isOffline(candidate.book) ? "已下架 · " : ""}${versionLabels[covers.version]} · ${Math.round(candidate.score * 100)}%</small>
    </span>
  `;
  button.addEventListener("click", () => {
    currentResults[index] = { ...result, status: isOffline(candidate.book) ? "offline" : "matched", book: candidate.book, confirmedManually: true };
    renderResults();
  });
  return button;
}

function openDetail(result) {
  const book = result.book;
  $("#detailTitle").textContent = book ? book.title : result.inputTitle;
  if (!book) {
    $("#detailContent").innerHTML = `
      <div class="detail-empty">
        <div class="no-image large">空封面</div>
        <button class="primary" id="detailAddMissing">新增这本书</button>
      </div>
    `;
    $("#detailAddMissing").addEventListener("click", () => {
      $("#detailDialog").close();
      openBookEditor(null, result.inputTitle);
    });
    $("#detailDialog").showModal();
    return;
  }
  const covers = displayCovers(book);
  const original3d = book.covers?.original?.threeD || "";
  const manualMissing = preferredVersionMissingFlat(book);
  const offline = isOffline(book);
  const mismatchNote = covers.version === "custom" && original3d
    ? `<div class="note">当前规则展示自制平封，因此不搭配原版立封，避免错配。</div>`
    : "";
  const manualMissingNote = manualMissing
    ? `<div class="note danger-note">手动选择的版本缺少平面封面。</div>`
    : "";
  const offlineNote = offline ? `<div class="note offline-note">这本书已在平台下架。</div>` : "";
  const fullNote = bookNote(book);
  $("#detailContent").innerHTML = `
    <div class="detail-grid">
      <div class="detail-cover">${covers.flat ? `<img src="${dataUrl(covers.flat)}" alt="平面封面">` : `<div class="no-image large">缺平面封面</div>`}</div>
      <div class="detail-side">
        <div class="detail-3d">${covers.threeD ? `<img src="${dataUrl(covers.threeD)}" alt="立体封面">` : `<div class="no-image">无当前立体封</div>`}</div>
        <div class="detail-copy-actions">
          ${covers.flat ? `<button class="${offline ? "ghost" : "copy-btn"}" id="copyDetailFlat" type="button">复制平封</button>` : ""}
          ${covers.threeD ? `<button class="${offline ? "ghost" : "copy-btn"}" id="copyDetailThree" type="button">复制立封</button>` : ""}
          ${covers.flat ? `<button class="ghost" id="copyDetailLink" type="button">复制图片链接</button>` : ""}
        </div>
        <div class="actual-version">当前实际展示版本：${versionLabels[covers.version]}。原因：${escapeHtml(displayReason(book))}</div>
        ${fullNote ? `<div class="note full-note"><strong>备注</strong><p>${escapeHtml(fullNote)}</p></div>` : ""}
        ${offlineNote}
        ${manualMissingNote}
        ${mismatchNote}
      </div>
    </div>
  `;
  $("#copyDetailFlat")?.addEventListener("click", event => copyCoverFromResult(result, covers.flat, "平封", event.currentTarget));
  $("#copyDetailThree")?.addEventListener("click", event => copyCoverFromResult(result, covers.threeD, "立封", event.currentTarget));
  $("#copyDetailLink")?.addEventListener("click", async event => {
    if (result.status === "offline" && !confirm("这本书已在平台下架，确定仍要复制封面吗？")) return;
    await copyText(absoluteAssetUrl(covers.flat));
    flashCopyButton(event.currentTarget, "已复制链接");
  });
  $("#detailDialog").showModal();
}

function renderManageList() {
  const query = normalize($("#manageSearch").value);
  const list = $("#bookList");
  list.innerHTML = "";
  books
    .filter(book => !query || normalize(book.title).includes(query))
    .forEach(book => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `book-row ${book.id === selectedBookId ? "active" : ""}`;
      const covers = displayCovers(book);
      const offline = isOffline(book);
      const noteBadge = noteBadgeText(book);
      const thumb = covers.flat ? `<img src="${dataUrl(covers.flat)}" alt="">` : `<div class="thumb-placeholder">无图</div>`;
      row.innerHTML = `
        ${thumb}
        <span>
          <strong>${escapeHtml(book.title)}${offline ? `<em class="status-pill offline">已下架</em>` : `<em class="status-pill active">正常</em>`}</strong>
          <small>${versionLabels[covers.version]} · ${covers.threeD ? "有立体封" : "无立体封"}${noteBadge ? ` · ${escapeHtml(noteBadge)}` : ""}</small>
        </span>
      `;
      row.addEventListener("click", () => openBookEditor(book));
      list.append(row);
    });
}

function openBookEditor(book, presetTitle = "") {
  editingBook = book;
  selectedBookId = book?.id || "";
  returnToMissingTitle = presetTitle;
  Object.keys(uploadState).forEach(key => delete uploadState[key]);
  $("#dialogTitle").textContent = book ? "编辑书籍" : "新增书籍";
  $("#editorHint").textContent = book ? "维护四个封面位和展示规则。" : "先保存草稿，再逐步补齐封面。";
  $("#bookId").value = book ? book.id : "";
  $("#bookTitle").value = book ? book.title : presetTitle;
  $("#bookStatus").value = bookStatus(book);
  $("#bookNote").value = bookNote(book);
  $("#preferredVersion").value = book?.preferredVersion || "auto";
  $("#deleteBook").style.visibility = book ? "visible" : "hidden";
  fillUploadSlots(book || { covers: emptyCovers() });
  updateActualVersionPreview();
  renderManageList();
}

function resetEditor() {
  editingBook = null;
  selectedBookId = "";
  returnToMissingTitle = "";
  Object.keys(uploadState).forEach(key => delete uploadState[key]);
  $("#dialogTitle").textContent = "选择一本书开始维护";
  $("#editorHint").textContent = "左侧选择书籍，或新增一本待补封面的资料。";
  $("#bookForm").reset();
  $("#bookId").value = "";
  $("#bookStatus").value = "active";
  $("#bookNote").value = "";
  $("#preferredVersion").value = "auto";
  $("#deleteBook").style.visibility = "hidden";
  fillUploadSlots({ covers: emptyCovers() });
  updateActualVersionPreview();
  renderManageList();
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
  for (const [key, [version, slot]] of Object.entries(slotMap())) {
    covers[version][slot] = getSlotValue(key);
  }
  return {
    id: $("#bookId").value,
    title: $("#bookTitle").value.trim(),
    note: $("#bookNote").value.trim(),
    status: $("#bookStatus").value,
    preferredVersion: $("#preferredVersion").value,
    covers,
  };
}

function getSlotValue(key) {
  return $(`.upload-slot[data-slot="${key}"] .cover-path`).value.trim();
}

function updateActualVersionPreview() {
  const book = collectBookFromForm();
  for (const [key, [version, slot]] of Object.entries(slotMap())) {
    if (uploadState[key]) book.covers[version][slot] = "__pending_upload__";
  }
  const version = actualVersion(book);
  const statusText = book.status === "offline" ? "平台已下架" : "正常可用";
  $("#actualVersion").textContent = `书籍状态：${statusText}。当前实际展示版本：${versionLabels[version]}。原因：${displayReason(book)}`;
  const preferred = book.preferredVersion;
  const showWarning = preferred !== "auto" && !hasFlat(book, preferred);
  $("#versionWarning").classList.toggle("hidden", !showWarning);
  $("#versionWarning").textContent = showWarning ? `警告：手动选择了 ${versionLabels[preferred]}，但该版本没有平面封面，保存后会显示缺封面。` : "";
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
  const uploads = { ...uploadState };
  const isEdit = Boolean(book.id);
  const pendingReturnTitle = returnToMissingTitle;
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
  await loadBooks();
  openBookEditor(saved);
  if (pendingReturnTitle) {
    const index = currentResults.findIndex(result => normalize(result.inputTitle) === normalize(pendingReturnTitle));
    if (index >= 0) {
      currentResults[index] = { inputTitle: pendingReturnTitle, status: isOffline(saved) ? "offline" : "matched", book: saved, candidates: [{ book: saved, score: 1 }] };
      renderResults();
      $$(".tab").find(tab => tab.dataset.view === "search").click();
    }
    returnToMissingTitle = "";
  }
}

async function deleteCurrentBook() {
  if (!editingBook) return;
  if (!confirm(`确定删除《${editingBook.title}》吗？本地且不再被任何记录引用的封面文件也会清理。`)) return;
  const response = await fetch(`/api/books/${encodeURIComponent(editingBook.id)}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || "删除失败");
    return;
  }
  resetEditor();
  await loadBooks();
}

async function createBatchDrafts(event) {
  event.preventDefault();
  const titles = extractTitles($("#batchTitles").value);
  if (!titles.length) return;
  const pastedCounts = titles.reduce((acc, title) => {
    const key = normalize(title);
    acc[key] = acc[key] || { title, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {});
  const repeatedInPaste = Object.values(pastedCounts).filter(item => item.count > 1).map(item => `${item.title}（本次 ${item.count} 次）`);
  const existingKeys = new Map(books.map(book => [normalize(book.title), book.title]));
  const alreadyExists = [...new Set(titles.filter(title => existingKeys.has(normalize(title))).map(title => existingKeys.get(normalize(title))))];
  const warnings = [];
  if (repeatedInPaste.length) warnings.push(`本次粘贴重复：\n${repeatedInPaste.join("\n")}`);
  if (alreadyExists.length) warnings.push(`资料库已存在：\n${alreadyExists.join("\n")}`);
  if (warnings.length && !confirm(`${warnings.join("\n\n")}\n\n仍然创建这些草稿吗？`)) {
    return;
  }
  const response = await fetch("/api/books/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titles }),
  });
  if (!response.ok) {
    const error = await response.json();
    alert(error.error || "批量新增失败");
    return;
  }
  $("#batchDialog").close();
  $("#batchTitles").value = "";
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

  let pasteTimer = null;
  $("#pasteInput").addEventListener("input", () => {
    clearTimeout(pasteTimer);
    pasteTimer = setTimeout(syncRecognizedFromPaste, 120);
  });
  $("#addManualTitle").addEventListener("click", () => {
    const title = $("#manualTitle").value.trim();
    if (title) recognizedTitles.push(title);
    $("#manualTitle").value = "";
    renderTitlePreview();
  });
  $("#manualTitle").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      $("#addManualTitle").click();
    }
  });
  $("#runMatch").addEventListener("click", runMatching);
  $("#clearSearch").addEventListener("click", () => {
    $("#pasteInput").value = "";
    recognizedTitles = [];
    currentResults = [];
    renderTitlePreview();
    renderResults();
  });
  $$(".filter").forEach(button => {
    button.addEventListener("click", () => {
      activeResultFilter = button.dataset.filter;
      $$(".filter").forEach(item => item.classList.toggle("active", item === button));
      renderResults();
    });
  });

  $("#manageSearch").addEventListener("input", renderManageList);
  $("#newBook").addEventListener("click", () => openBookEditor());
  $("#resetEditor").addEventListener("click", resetEditor);
  $("#bookForm").addEventListener("submit", saveBook);
  $("#deleteBook").addEventListener("click", deleteCurrentBook);
  $("#preferredVersion").addEventListener("change", updateActualVersionPreview);
  $("#bookStatus").addEventListener("change", updateActualVersionPreview);
  $("#bookNote").addEventListener("input", updateActualVersionPreview);
  $("#bookTitle").addEventListener("input", updateActualVersionPreview);
  $("#batchDrafts").addEventListener("click", () => $("#batchDialog").showModal());
  $("#batchForm").addEventListener("submit", createBatchDrafts);
  $("#closeDetail").addEventListener("click", () => $("#detailDialog").close());

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
      } else {
        img.removeAttribute("src");
        slot.classList.remove("has-image");
      }
      updateActualVersionPreview();
    });
    slot.querySelector(".clear-slot").addEventListener("click", () => {
      delete uploadState[key];
      urlInput.value = "";
      fileInput.value = "";
      img.removeAttribute("src");
      slot.classList.remove("has-image");
      updateActualVersionPreview();
    });
    zone.addEventListener("dragover", event => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragging"));
    zone.addEventListener("drop", event => {
      event.preventDefault();
      zone.classList.remove("dragging");
      setFile(event.dataTransfer.files[0]);
    });
  });
}

bindEvents();
renderTitlePreview();
resetEditor();
loadBooks();
