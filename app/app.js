let books = [];
let speakers = [];
const ALL_SPEAKER = { id: "all", name: "全部" };
const DEFAULT_SPEAKER = { id: "fandeng", name: "樊登" };
let currentSpeaker = ALL_SPEAKER;
let editingSpeaker = null;
let recognizedTitles = [];
let currentResults = [];
let activeResultFilter = "all";
let editingBook = null;
let selectedBookId = "";
let returnToMissingTitle = "";
let formDirty = false;
const uploadState = {};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const versionLabels = {
  custom: "自制版",
  original: "原版",
  noCover: "缺封面",
};

function emptyCovers() {
  return {
    custom: { flat: "", threeD: "" },
    original: { flat: "", threeD: "" },
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

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function dataUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path) || path.startsWith("data:")) return path;
  return `/data/${path}`;
}

function imageSrc(path) {
  return escapeAttr(dataUrl(path));
}

function imageAttrs(path, alt = "", options = {}) {
  const loading = options.eager ? "" : ' loading="lazy"';
  const fetchPriority = options.eager ? ' fetchpriority="high"' : "";
  return `src="${imageSrc(path)}" alt="${escapeAttr(alt)}"${loading}${fetchPriority}`;
}

let statusTimer = null;

function showStatus(message, type = "info") {
  const status = $("#appStatus");
  if (!status) return;
  clearTimeout(statusTimer);
  status.textContent = message || "";
  status.className = `app-status visible ${type}`.trim();
  if (message && type !== "error") {
    statusTimer = setTimeout(() => {
      status.className = "app-status";
      status.textContent = "";
    }, 2400);
  }
}

function errorMessage(error, fallback = "操作失败") {
  return error?.message || fallback;
}

function markDirty() {
  formDirty = true;
}

function clearDirty() {
  formDirty = false;
}

function confirmLeaveDirty() {
  return !formDirty || confirm("当前编辑尚未保存，确定离开吗？");
}

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ALLOWED_UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function normalizeSpeaker(speaker) {
  return {
    id: String(speaker?.id || DEFAULT_SPEAKER.id).trim() || DEFAULT_SPEAKER.id,
    name: String(speaker?.name || DEFAULT_SPEAKER.name).trim() || DEFAULT_SPEAKER.name,
  };
}

function bookSpeakerId(book) {
  return String(book?.speakerId || DEFAULT_SPEAKER.id).trim() || DEFAULT_SPEAKER.id;
}

function bookSpeakerName(book) {
  return String(book?.speakerName || DEFAULT_SPEAKER.name).trim() || DEFAULT_SPEAKER.name;
}

function isAllSpeaker() {
  return currentSpeaker.id === ALL_SPEAKER.id;
}

function resultSpeakerLine(book) {
  return isAllSpeaker() && book ? `<div class="meta">讲书人：${escapeHtml(bookSpeakerName(book))}</div>` : "";
}

function currentSpeakerBooks() {
  if (isAllSpeaker()) return books;
  return books.filter(book => bookSpeakerId(book) === currentSpeaker.id);
}

function renderSpeakerSelect() {
  const select = $("#speakerSelect");
  if (!select) return;
  select.innerHTML = "";
  const allOption = document.createElement("option");
  allOption.value = ALL_SPEAKER.id;
  allOption.textContent = ALL_SPEAKER.name;
  select.append(allOption);
  speakers.forEach(speaker => {
    const option = document.createElement("option");
    option.value = speaker.id;
    option.textContent = speaker.name;
    select.append(option);
  });
  select.value = currentSpeaker.id;
}

function renderBookSpeakerSelect(selectedSpeaker = editingSpeaker) {
  const select = $("#bookSpeaker");
  if (!select) return;
  select.innerHTML = "";
  const selected = selectedSpeaker ? normalizeSpeaker(selectedSpeaker) : null;
  const options = [...speakers];
  if (selected && !options.some(speaker => speaker.id === selected.id)) {
    options.push(selected);
  }
  if (!selected) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择讲书人";
    select.append(placeholder);
  }
  options.forEach(speaker => {
    const option = document.createElement("option");
    option.value = speaker.id;
    option.textContent = speaker.name;
    select.append(option);
  });
  select.value = selected?.id || "";
  select.disabled = options.length === 0;
}

function setEditingSpeaker(speaker) {
  editingSpeaker = speaker ? normalizeSpeaker(speaker) : null;
  renderBookSpeakerSelect(editingSpeaker);
  const speakerText = editingSpeaker ? `讲书人：${editingSpeaker.name}` : "请在表单中选择讲书人。";
  $("#editorHint").textContent = editingBook
    ? `维护三个封面位和展示规则。${speakerText}`
    : `新增一条素材库记录，先填写书名和讲书人，再逐步补齐封面。`;
}

function setCurrentSpeaker(speaker) {
  currentSpeaker = speaker?.id === ALL_SPEAKER.id ? ALL_SPEAKER : normalizeSpeaker(speaker);
  renderSpeakerSelect();
  resetEditor();
  renderManageList();
  currentResults = [];
  renderResults();
  showStatus(`已切换到讲书人：${currentSpeaker.name}`, "success");
}

async function startNewMaterial() {
  if (!confirmLeaveDirty()) return;
  const speaker = await chooseTargetSpeaker("新增素材");
  if (!speaker) return;
  openBookEditor(null, "", speaker);
}

async function loadSpeakers() {
  try {
    const response = await fetch("/api/speakers");
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "讲书人列表加载失败");
    }
    speakers = (await response.json()).map(normalizeSpeaker);
    if (!speakers.length) speakers = [DEFAULT_SPEAKER];
    if (!isAllSpeaker()) {
      currentSpeaker = speakers.find(speaker => speaker.id === currentSpeaker.id) || ALL_SPEAKER;
    }
    renderSpeakerSelect();
    renderBookSpeakerSelect();
  } catch (error) {
    speakers = [DEFAULT_SPEAKER];
    currentSpeaker = ALL_SPEAKER;
    renderSpeakerSelect();
    renderBookSpeakerSelect();
    showStatus(errorMessage(error, "讲书人列表加载失败"), "error");
  }
}

async function createSpeaker() {
  try {
    const speaker = await openSpeakerDialog({
      title: "新增讲书人",
      hint: "新增后可以在顶部筛选，也可以给书籍或批量草稿指定归属。",
      createOnly: true,
    });
    if (speaker) setCurrentSpeaker(speaker);
  } catch (error) {
    showStatus(errorMessage(error, "新增讲书人失败"), "error");
  }
}

async function resolveSpeakerByName(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return null;
  const existing = speakers.find(speaker => speaker.name === cleanName || speaker.id === cleanName);
  if (existing) return existing;
  const response = await fetch("/api/speakers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: cleanName }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "新增讲书人失败");
  }
  const speaker = normalizeSpeaker(await response.json());
  await loadSpeakers();
  return speaker;
}

async function chooseTargetSpeaker(actionText = "新增书籍") {
  if (!isAllSpeaker()) return currentSpeaker;
  return openSpeakerDialog({
    title: "选择讲书人",
    hint: `${actionText}需要先选择归属讲书人。`,
    createOnly: false,
  });
}

function fillSpeakerDialogOptions() {
  const select = $("#speakerDialogSelect");
  if (!select) return;
  select.innerHTML = "";
  if (!speakers.length) {
    select.innerHTML = `<option value="">暂无讲书人，请新增</option>`;
    return;
  }
  speakers.forEach(speaker => {
    const option = document.createElement("option");
    option.value = speaker.id;
    option.textContent = speaker.name;
    select.append(option);
  });
}

function openSpeakerDialog(options = {}) {
  const dialog = $("#speakerDialog");
  const form = $("#speakerForm");
  const input = $("#speakerDialogName");
  const select = $("#speakerDialogSelect");
  const existingField = $("#speakerExistingField");
  const newField = $("#speakerNewField");
  const newToggle = $("#speakerNewToggle");
  if (!dialog || !form || !input || !select) return Promise.resolve(null);

  $("#speakerDialogTitle").textContent = options.title || "选择讲书人";
  $("#speakerDialogHint").textContent = options.hint || "请选择或新增一个具体讲书人。";
  existingField.hidden = Boolean(options.createOnly);
  newField.hidden = !options.createOnly;
  newToggle.hidden = Boolean(options.createOnly);
  fillSpeakerDialogOptions();
  select.value = !options.createOnly && speakers.length ? speakers[0].id : "";
  input.value = "";
  if (options.createOnly) {
    input.setAttribute("required", "");
  } else {
    input.removeAttribute("required");
  }

  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      form.onsubmit = null;
      newToggle.onclick = null;
      dialog.removeEventListener("close", handleClose);
      resolve(value);
    };
    const handleClose = () => finish(null);

    form.onsubmit = async event => {
      event.preventDefault();
      const name = input.value.trim();
      const selected = speakers.find(speaker => speaker.id === select.value);
      try {
        if (!options.createOnly && selected && !name) {
          finish(selected);
          dialog.close();
          return;
        }
        if (!name) {
          showStatus(options.createOnly ? "请输入讲书人名称" : "请选择已有讲书人，或输入新讲书人名称", "error");
          return;
        }
        const speaker = await resolveSpeakerByName(name);
        finish(speaker);
        dialog.close();
      } catch (error) {
        showStatus(errorMessage(error, "讲书人保存失败"), "error");
      }
    };

    newToggle.onclick = () => {
      newField.hidden = false;
      newToggle.hidden = true;
      input.focus();
    };

    dialog.addEventListener("close", handleClose);
    dialog.showModal();
    const shouldFocusSelect = !options.createOnly && speakers.length > 0;
    if (shouldFocusSelect) select.focus();
    else input.focus();
  });
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
  };
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

function noteBadgeText(book) {
  return bookNote(book) ? "有备注" : "";
}

function hasFlat(book, version) {
  return Boolean(book?.covers?.[version]?.flat);
}

function preferredVersionMissingFlat(book) {
  const preferred = book?.preferredVersion || "auto";
  return preferred !== "auto" && ["custom", "original"].includes(preferred) && !hasFlat(book, preferred);
}

function normalizePreferredVersion(value) {
  return ["auto", "custom", "original"].includes(value) ? value : "auto";
}

function actualVersion(book) {
  const preferred = normalizePreferredVersion(book?.preferredVersion || "auto");
  const covers = { ...emptyCovers(), ...(book?.covers || {}) };
  if (["custom", "original"].includes(preferred)) {
    return covers[preferred]?.flat ? preferred : "noCover";
  }
  if (covers.custom?.flat) return "custom";
  if (covers.original?.flat) return "original";
  return "noCover";
}

function displayCovers(book) {
  const version = actualVersion(book);
  const covers = { ...emptyCovers(), ...(book?.covers || {}) };
  if (version === "custom") return { version, flat: covers.custom.flat, threeD: "" };
  if (version === "original") return { version, flat: covers.original.flat, threeD: covers.original.threeD || "" };
  return { version, flat: "", threeD: "" };
}

async function loadBooks() {
  try {
    const response = await fetch("/api/books");
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "资料库加载失败");
    }
    books = (await response.json()).map(book => ({
      ...book,
      speakerId: book.speakerId || "fandeng",
      speakerName: book.speakerName || "樊登",
    }));
    showStatus(`资料库已加载：${currentSpeaker.name}`, "success");
    renderManageList();
    if (selectedBookId) {
      const fresh = books.find(book => book.id === selectedBookId);
      if (fresh) openBookEditor(fresh);
    }
  } catch (error) {
    books = [];
    renderManageList();
    showStatus(`${errorMessage(error, "资料库加载失败")}。请检查 data/books.json 或重启本地服务。`, "error");
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
  const candidates = currentSpeakerBooks()
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
    ? `<img class="flat-cover" ${imageAttrs(covers.flat, "平面封面", { eager: true })}>`
    : `<div class="no-image">空封面</div>`;
  const three = covers.threeD ? `<img class="three-cover" ${imageAttrs(covers.threeD, "立体封面")}>` : "";
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
      ${resultSpeakerLine(book)}
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
    add.addEventListener("click", () => {
      if (!confirmLeaveDirty()) return;
      const speaker = isAllSpeaker() ? null : currentSpeaker;
      openBookEditor(null, result.inputTitle, speaker);
    });
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
    ${covers.flat ? `<img ${imageAttrs(covers.flat, "")}>` : `<span class="candidate-empty">无图</span>`}
    <span>
      <strong>${escapeHtml(candidate.book.title)}</strong>
      <small>${isAllSpeaker() ? `${escapeHtml(bookSpeakerName(candidate.book))} · ` : ""}${isOffline(candidate.book) ? "已下架 · " : ""}${versionLabels[covers.version]} · ${Math.round(candidate.score * 100)}%</small>
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
      if (!confirmLeaveDirty()) return;
      $("#detailDialog").close();
      const speaker = isAllSpeaker() ? null : currentSpeaker;
      openBookEditor(null, result.inputTitle, speaker);
    });
    $("#detailDialog").showModal();
    return;
  }
  const covers = displayCovers(book);
  const original3d = book.covers?.original?.threeD || "";
  const manualMissing = preferredVersionMissingFlat(book);
  const offline = isOffline(book);
  const speakerNote = isAllSpeaker() ? `<div class="note"><strong>讲书人</strong><p>${escapeHtml(bookSpeakerName(book))}</p></div>` : "";
  const mismatchNote = covers.version === "custom" && original3d
    ? `<div class="note">自制平封展示中，原版立封不跟随。</div>`
    : "";
  const manualMissingNote = manualMissing
    ? `<div class="note danger-note">手动选择的版本缺少平面封面。</div>`
    : "";
  const offlineNote = offline ? `<div class="note offline-note">这本书已在平台下架。</div>` : "";
  const fullNote = bookNote(book);
  $("#detailContent").innerHTML = `
    <div class="detail-grid">
      <div class="detail-cover">${covers.flat ? `<img ${imageAttrs(covers.flat, "平面封面")}>` : `<div class="no-image large">缺平面封面</div>`}</div>
      <div class="detail-side">
        <div class="detail-3d">${covers.threeD ? `<img ${imageAttrs(covers.threeD, "立体封面")}>` : `<div class="no-image">无当前立体封</div>`}</div>
        <div class="detail-copy-actions">
          ${covers.flat ? `<button class="${offline ? "ghost" : "copy-btn"}" id="copyDetailFlat" type="button">复制平封</button>` : ""}
          ${covers.threeD ? `<button class="${offline ? "ghost" : "copy-btn"}" id="copyDetailThree" type="button">复制立封</button>` : ""}
          ${covers.flat ? `<button class="ghost" id="copyDetailLink" type="button">复制图片链接</button>` : ""}
        </div>
        ${speakerNote}
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
  currentSpeakerBooks()
    .filter(book => !query || normalize(book.title).includes(query))
    .forEach(book => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `book-row ${book.id === selectedBookId ? "active" : ""}`;
      const covers = displayCovers(book);
      const offline = isOffline(book);
      const noteBadge = noteBadgeText(book);
      const speakerMeta = isAllSpeaker() ? `${bookSpeakerName(book)} · ` : "";
      const thumb = covers.flat ? `<img ${imageAttrs(covers.flat, "")}>` : `<div class="thumb-placeholder">无图</div>`;
      row.innerHTML = `
        ${thumb}
        <span>
          <strong>${escapeHtml(book.title)}${offline ? `<em class="status-pill offline">已下架</em>` : `<em class="status-pill active">正常</em>`}</strong>
          <small>${escapeHtml(speakerMeta)}${versionLabels[covers.version]} · ${covers.threeD ? "有立体封" : "无立体封"}${noteBadge ? ` · ${escapeHtml(noteBadge)}` : ""}</small>
        </span>
      `;
      row.addEventListener("click", () => {
        if (book.id === selectedBookId) return;
        if (!confirmLeaveDirty()) return;
        openBookEditor(book);
      });
      list.append(row);
    });
}

function openBookEditor(book, presetTitle = "", speakerOverride = null) {
  editingBook = book;
  const speaker = book
    ? { id: bookSpeakerId(book), name: bookSpeakerName(book) }
    : speakerOverride
      ? normalizeSpeaker(speakerOverride)
      : (!isAllSpeaker() ? currentSpeaker : null);
  selectedBookId = book?.id || "";
  returnToMissingTitle = presetTitle;
  Object.keys(uploadState).forEach(key => delete uploadState[key]);
  $("#dialogTitle").textContent = book ? "编辑书籍" : "新增素材";
  $("#bookId").value = book ? book.id : "";
  $("#bookTitle").value = book ? book.title : presetTitle;
  setEditingSpeaker(speaker);
  $("#bookStatus").value = bookStatus(book);
  $("#bookNote").value = bookNote(book);
  $("#preferredVersion").value = normalizePreferredVersion(book?.preferredVersion || "auto");
  $("#deleteBook").style.visibility = book ? "visible" : "hidden";
  fillUploadSlots(book || { covers: emptyCovers() });
  updateActualVersionPreview();
  renderManageList();
  clearDirty();
}

function resetEditor() {
  editingBook = null;
  selectedBookId = "";
  returnToMissingTitle = "";
  Object.keys(uploadState).forEach(key => delete uploadState[key]);
  $("#dialogTitle").textContent = "选择一本书开始维护";
  $("#bookForm").reset();
  setEditingSpeaker(null);
  $("#bookId").value = "";
  $("#bookStatus").value = "active";
  $("#bookNote").value = "";
  $("#preferredVersion").value = "auto";
  $("#deleteBook").style.visibility = "hidden";
  fillUploadSlots({ covers: emptyCovers() });
  updateActualVersionPreview();
  renderManageList();
  clearDirty();
}

function fillUploadSlots(book) {
  const covers = { ...emptyCovers(), ...(book.covers || {}) };
  const values = {
    custom_flat: covers.custom?.flat || "",
    original_flat: covers.original?.flat || "",
    original_3d: covers.original?.threeD || "",
  };
  $$(".upload-slot").forEach(slot => {
    const key = slot.dataset.slot;
    const urlInput = slot.querySelector(".cover-path");
    const fileInput = slot.querySelector('input[type="file"]');
    const img = slot.querySelector("img");
    clearSlotImageError(slot);
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
  const selectedSpeakerId = $("#bookSpeaker").value;
  const speaker = speakers.find(item => item.id === selectedSpeakerId) || editingSpeaker;
  return {
    id: $("#bookId").value,
    speakerId: speaker?.id || "",
    speakerName: speaker?.name || "",
    title: $("#bookTitle").value.trim(),
    note: $("#bookNote").value.trim(),
    status: $("#bookStatus").value,
    preferredVersion: normalizePreferredVersion($("#preferredVersion").value),
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
  updateUploadSlotStates(book, version);
}

function setSlotState(key, text, options = {}) {
  const slot = $(`.upload-slot[data-slot="${key}"]`);
  if (!slot) return;
  const status = slot.querySelector(".slot-status");
  const button = slot.querySelector(".set-display");
  slot.classList.toggle("is-current", Boolean(options.current));
  slot.classList.toggle("is-missing", Boolean(options.missing));
  slot.classList.toggle("is-standby", Boolean(options.standby));
  if (status) status.textContent = text;
  if (button) {
    button.hidden = !options.canSet;
    button.disabled = !options.canSet;
  }
}

function setSlotImageError(slot) {
  if (!slot || !slot.classList.contains("has-image")) return;
  const status = slot.querySelector(".slot-status");
  slot.classList.add("is-error");
  if (status) status.textContent = "图片无法加载";
}

function clearSlotImageError(slot) {
  if (!slot) return;
  slot.classList.remove("is-error");
}

function updateUploadSlotStates(book, version) {
  const preferred = normalizePreferredVersion(book.preferredVersion || "auto");
  const covers = book.covers || emptyCovers();
  const hasCustom = Boolean(covers.custom?.flat);
  const hasOriginal = Boolean(covers.original?.flat);
  const hasOriginal3d = Boolean(covers.original?.threeD);

  if (!hasCustom) {
    setSlotState("custom_flat", "缺失", { missing: true });
  } else if (version === "custom") {
    setSlotState("custom_flat", "✓ 展示中", { current: true });
  } else {
    setSlotState("custom_flat", "备用", { standby: true, canSet: true });
  }

  if (!hasOriginal) {
    setSlotState("original_flat", "缺失", { missing: true });
  } else if (version === "original") {
    setSlotState("original_flat", "✓ 展示中", { current: true });
  } else {
    setSlotState("original_flat", "备用", { standby: true, canSet: true });
  }

  if (!hasOriginal3d) {
    setSlotState("original_3d", "缺失", { missing: true });
  } else if (version === "original") {
    setSlotState("original_3d", "跟随展示", { current: true });
  } else {
    setSlotState("original_3d", "备用", { standby: true });
  }
}

async function fileToDataUrl(file) {
  if (!ALLOWED_UPLOAD_TYPES.has(file.type)) {
    throw new Error("只支持 JPG、PNG、WebP 或 GIF 图片");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`单张图片不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function saveBook(event) {
  event.preventDefault();
  const saveButton = $("#saveBook");
  const originalText = saveButton.textContent;
  saveButton.disabled = true;
  saveButton.textContent = "保存中…";
  const book = collectBookFromForm();
  const uploads = { ...uploadState };
  const isEdit = Boolean(book.id);
  const pendingReturnTitle = returnToMissingTitle;
  try {
    if (!book.speakerId || book.speakerId === ALL_SPEAKER.id || book.speakerName === ALL_SPEAKER.name) {
      throw new Error("请选择讲书人后再保存");
    }
    const response = await fetch(isEdit ? `/api/books/${encodeURIComponent(book.id)}` : "/api/books", {
      method: isEdit ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book, uploads }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "保存失败");
    }
    const saved = await response.json();
    await loadBooks();
    openBookEditor(saved);
    showStatus(`已保存《${saved.title}》`, "success");
    if (pendingReturnTitle) {
      const index = currentResults.findIndex(result => normalize(result.inputTitle) === normalize(pendingReturnTitle));
      if (index >= 0) {
        currentResults[index] = { inputTitle: pendingReturnTitle, status: isOffline(saved) ? "offline" : "matched", book: saved, candidates: [{ book: saved, score: 1 }] };
        renderResults();
        $$(".tab").find(tab => tab.dataset.view === "search").click();
      }
      returnToMissingTitle = "";
    }
  } catch (error) {
    showStatus(errorMessage(error, "保存失败"), "error");
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = originalText;
  }
}

async function deleteCurrentBook() {
  if (!editingBook) return;
  if (!confirm(`确定删除《${editingBook.title}》吗？本地且不再被任何记录引用的封面文件也会清理。`)) return;
  const response = await fetch(`/api/books/${encodeURIComponent(editingBook.id)}`, { method: "DELETE" });
  if (!response.ok) {
    const error = await response.json();
    showStatus(error.error || "删除失败", "error");
    return;
  }
  const deletedTitle = editingBook.title;
  resetEditor();
  await loadBooks();
  showStatus(`已删除《${deletedTitle}》`, "success");
}

async function createBatchDrafts(event) {
  event.preventDefault();
  const submitButton = event.submitter || $("#batchForm button[type='submit']");
  const originalText = submitButton.textContent;
  const titles = extractTitles($("#batchTitles").value);
  if (!titles.length) return;
  submitButton.disabled = true;
  submitButton.textContent = "生成中…";
  let targetSpeaker;
  try {
    targetSpeaker = await chooseTargetSpeaker("批量草稿");
  } catch (error) {
    showStatus(errorMessage(error, "讲书人选择失败"), "error");
    submitButton.disabled = false;
    submitButton.textContent = originalText;
    return;
  }
  if (!targetSpeaker || targetSpeaker.id === ALL_SPEAKER.id) {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
    return;
  }
  const pastedCounts = titles.reduce((acc, title) => {
    const key = normalize(title);
    acc[key] = acc[key] || { title, count: 0 };
    acc[key].count += 1;
    return acc;
  }, {});
  const repeatedInPaste = Object.values(pastedCounts).filter(item => item.count > 1).map(item => `${item.title}（本次 ${item.count} 次）`);
  const existingKeys = new Map(books
    .filter(book => bookSpeakerId(book) === targetSpeaker.id)
    .map(book => [normalize(book.title), book.title]));
  const alreadyExists = [...new Set(titles.filter(title => existingKeys.has(normalize(title))).map(title => existingKeys.get(normalize(title))))];
  const warnings = [];
  if (repeatedInPaste.length) warnings.push(`本次粘贴重复：\n${repeatedInPaste.join("\n")}`);
  if (alreadyExists.length) warnings.push(`资料库已存在：\n${alreadyExists.join("\n")}`);
  if (warnings.length && !confirm(`${warnings.join("\n\n")}\n\n仍然创建这些草稿吗？`)) {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
    return;
  }
  try {
    const response = await fetch("/api/books/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titles, speakerId: targetSpeaker.id, speakerName: targetSpeaker.name }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "批量新增失败");
    }
    $("#batchDialog").close();
    $("#batchTitles").value = "";
    await loadBooks();
    showStatus(`已为${targetSpeaker.name}生成 ${titles.length} 本草稿`, "success");
  } catch (error) {
    showStatus(errorMessage(error, "批量新增失败"), "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = originalText;
  }
}

function openBatchDialog() {
  const hint = $("#batchSpeakerHint");
  if (hint) {
    hint.textContent = isAllSpeaker()
      ? "提交时需要选择本次草稿归属的讲书人。"
      : `本次草稿将归属到：${currentSpeaker.name}`;
  }
  $("#batchDialog").showModal();
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
    if (title) {
      const key = normalize(title);
      const exists = recognizedTitles.some(item => normalize(item) === key);
      if (exists) {
        showStatus(`《${title}》已在识别列表中`, "error");
      } else {
        recognizedTitles.push(title);
      }
    }
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

  $("#speakerSelect").addEventListener("change", event => {
    if (!confirmLeaveDirty()) {
      event.target.value = currentSpeaker.id;
      return;
    }
    if (event.target.value === ALL_SPEAKER.id) {
      setCurrentSpeaker(ALL_SPEAKER);
      return;
    }
    const speaker = speakers.find(item => item.id === event.target.value);
    if (speaker) setCurrentSpeaker(speaker);
  });
  $("#addSpeaker").addEventListener("click", createSpeaker);
  $$("[data-close-speaker]").forEach(button => {
    button.addEventListener("click", () => $("#speakerDialog").close());
  });
  $("#manageSearch").addEventListener("input", renderManageList);
  $("#newBook").addEventListener("click", startNewMaterial);
  $("#resetEditor").addEventListener("click", () => {
    if (!confirmLeaveDirty()) return;
    resetEditor();
  });
  $("#bookForm").addEventListener("submit", saveBook);
  $("#deleteBook").addEventListener("click", deleteCurrentBook);
  $("#bookStatus").addEventListener("change", () => {
    markDirty();
    updateActualVersionPreview();
  });
  $("#bookSpeaker").addEventListener("change", event => {
    const speaker = speakers.find(item => item.id === event.target.value);
    setEditingSpeaker(speaker || null);
    markDirty();
  });
  $("#bookNote").addEventListener("input", () => {
    markDirty();
    updateActualVersionPreview();
  });
  $("#bookTitle").addEventListener("input", () => {
    markDirty();
    updateActualVersionPreview();
  });
  $("#batchDrafts").addEventListener("click", openBatchDialog);
  $$("[data-close-batch]").forEach(button => {
    button.addEventListener("click", () => $("#batchDialog").close());
  });
  $("#batchForm").addEventListener("submit", createBatchDrafts);
  $("#closeDetail").addEventListener("click", () => $("#detailDialog").close());

  $$(".upload-slot").forEach(slot => {
    const key = slot.dataset.slot;
    const zone = slot.querySelector(".drop-zone");
    const fileInput = slot.querySelector('input[type="file"]');
    const urlInput = slot.querySelector(".cover-path");
    const img = slot.querySelector("img");
    const setDisplayButton = slot.querySelector(".set-display");
    const setFile = async file => {
      if (!file) return;
      let dataUrlValue;
      try {
        dataUrlValue = await fileToDataUrl(file);
      } catch (error) {
        showStatus(error.message || "图片读取失败", "error");
        fileInput.value = "";
        return;
      }
      uploadState[key] = { dataUrl: dataUrlValue };
      clearSlotImageError(slot);
      urlInput.value = "";
      img.src = dataUrlValue;
      slot.classList.add("has-image");
      markDirty();
      updateActualVersionPreview();
    };
    img.addEventListener("load", () => clearSlotImageError(slot));
    img.addEventListener("error", () => setSlotImageError(slot));
    zone.setAttribute("role", "button");
    zone.setAttribute("tabindex", "0");
    zone.setAttribute("aria-label", `${slot.querySelector("h3")?.textContent || "封面"}：选择或拖拽图片`);
    zone.addEventListener("click", () => fileInput.click());
    zone.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
    urlInput.addEventListener("input", () => {
      delete uploadState[key];
      clearSlotImageError(slot);
      if (urlInput.value.trim()) {
        img.src = dataUrl(urlInput.value.trim());
        slot.classList.add("has-image");
      } else {
        img.removeAttribute("src");
        slot.classList.remove("has-image");
      }
      markDirty();
      updateActualVersionPreview();
    });
    slot.querySelector(".clear-slot").addEventListener("click", () => {
      delete uploadState[key];
      clearSlotImageError(slot);
      urlInput.value = "";
      fileInput.value = "";
      img.removeAttribute("src");
      slot.classList.remove("has-image");
      markDirty();
      updateActualVersionPreview();
    });
    if (setDisplayButton) {
      setDisplayButton.addEventListener("click", () => {
        const [version] = slotMap()[key] || [];
        if (!version) return;
        $("#preferredVersion").value = version;
        markDirty();
        updateActualVersionPreview();
      });
    }
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
loadSpeakers().then(loadBooks);
