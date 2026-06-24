import { loadStore, saveStore, clearStore } from "./storage.js";
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  cleanXTitle,
  deletePaper,
  enrichPaper,
  importPapersFromUrls,
  paperFromUrl,
  repairPaperLinks,
  updatePaper,
  upsertPaper,
  xTitleText
} from "./paper.js";

const app = document.querySelector("#app");

const state = {
  papers: [],
  filter: "inbox",
  source: "all",
  tag: "",
  query: "",
  selectedId: "",
  busy: false,
  notice: "",
  importOpen: false,
  listScrollTop: 0,
  pageScrollY: 0
};

const SOURCE_LABELS = {
  arxiv: "arXiv",
  alphaxiv: "alphaXiv",
  github: "GitHub",
  project: "Project",
  huggingface: "Hugging Face",
  x: "X",
  doi: "DOI",
  web: "Web"
};

const FIELD_SAVE_DELAY = 350;
const fieldSaveTimers = new Map();
let fieldSaveQueue = Promise.resolve();

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
  } catch {
    return "";
  }
}

function sourceLabel(sourceType) {
  return SOURCE_LABELS[sourceType] || sourceType || "Web";
}

function hostFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function displayTitle(paper) {
  if (paper.sourceType === "x") {
    return cleanXTitle(paper.title);
  }

  return String(paper.title || "Untitled")
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*\/\s*X\s*$/i, "")
    .replace(/\s+on X:\s*/i, ": ")
    .trim();
}

function rowSummary(paper) {
  if (paper.abstract) return paper.abstract;
  if (paper.originText) return paper.originText;
  if (paper.sourceType === "x") {
    const postText = xTitleText(paper.title);
    if (postText) return postText;
  }

  const host = hostFromUrl(paper.sourceUrl);
  const arxiv = paper.arxivId ? `arXiv:${paper.arxivId}` : "";
  const tags = (paper.tags || []).slice(0, 3).join(", ");
  return [sourceLabel(paper.sourceType), host, arxiv, tags].filter(Boolean).join(" · ");
}

function metadataState(paper) {
  const sourceType = paper.sourceType || "web";
  const hasSource = Boolean(paper.sourceUrl);
  const hasTitle = Boolean(paper.title && !/^Untitled/i.test(paper.title));
  const hasSummary = Boolean(paper.abstract || paper.originText);
  const hasTags = Boolean(paper.tags?.length);

  if (["arxiv", "alphaxiv", "doi"].includes(sourceType) || paper.arxivId || paper.doi) {
    const checks = [hasSource, hasTitle, paper.authors?.length, paper.abstract, hasTags];
    const score = checks.filter(Boolean).length;
    if (score >= 4) return { label: "信息完整", className: "good", score };
    if (score >= 3) return { label: "可阅读", className: "ok", score };
    return { label: "需补全", className: "weak", score };
  }

  if (["github", "project", "huggingface", "x"].includes(sourceType)) {
    const score = [hasSource, hasTitle, hasSummary, hasTags].filter(Boolean).length;
    if (hasSource && hasTitle && (hasSummary || hasTags)) {
      return { label: "信息完整", className: "good", score };
    }
    if (hasSource && hasTitle) {
      return { label: "可阅读", className: "ok", score };
    }
    return { label: "需补全", className: "weak", score };
  }

  const score = [hasSource, hasTitle, hasSummary, hasTags].filter(Boolean).length;
  if (score >= 3) return { label: "信息完整", className: "good", score };
  if (score >= 2) return { label: "可阅读", className: "ok", score };
  return { label: "需补全", className: "weak", score };
}

function sortedPapers(papers) {
  const weight = { high: 0, medium: 1, low: 2 };
  return [...papers].sort((a, b) => {
    const plannedDelta = Number(Boolean(b.planned)) - Number(Boolean(a.planned));
    if (plannedDelta) return plannedDelta;
    const priorityDelta = (weight[a.priority] ?? 1) - (weight[b.priority] ?? 1);
    if (priorityDelta) return priorityDelta;
    return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
  });
}

function matchesPaper(paper) {
  if (state.filter === "planned" && !paper.planned) return false;
  if (state.filter !== "all" && state.filter !== "planned" && paper.status !== state.filter) return false;
  if (state.source !== "all" && paper.sourceType !== state.source) return false;
  if (state.tag && !paper.tags?.includes(state.tag)) return false;

  const query = state.query.trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    paper.title,
    paper.abstract,
    paper.arxivId,
    paper.doi,
    paper.sourceUrl,
    paper.originUrl,
    paper.originTitle,
    paper.originText,
    ...(paper.authors || []),
    ...(paper.tags || [])
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function filteredPapers() {
  return sortedPapers(state.papers.filter(matchesPaper));
}

function countForFilter(filter) {
  if (filter === "all") return state.papers.length;
  return state.papers.filter((paper) => paper.status === filter).length;
}

function allTags() {
  const tags = new Map();
  for (const paper of state.papers) {
    for (const tag of paper.tags || []) {
      tags.set(tag, (tags.get(tag) || 0) + 1);
    }
  }
  return [...tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function allSources() {
  const sources = new Map();
  for (const paper of state.papers) {
    const source = paper.sourceType || "web";
    sources.set(source, (sources.get(source) || 0) + 1);
  }
  return [...sources.entries()].sort((a, b) => b[1] - a[1] || sourceLabel(a[0]).localeCompare(sourceLabel(b[0])));
}

function selectedPaper() {
  const visible = filteredPapers();
  if (!state.selectedId && visible[0]) state.selectedId = visible[0].id;
  return state.papers.find((paper) => paper.id === state.selectedId) || visible[0] || null;
}

function navItem(filter, label) {
  const active = state.filter === filter && !state.tag ? "active" : "";
  return `
    <button class="nav-item ${active}" data-filter="${filter}">
      <span>${label}</span>
      <strong>${countForFilter(filter)}</strong>
    </button>
  `;
}

function sourceItem(source, count) {
  const active = state.source === source && !state.tag ? "active" : "";
  return `
    <button class="source-link ${active}" data-source="${escapeHtml(source)}">
      <span>${escapeHtml(source === "all" ? "全部来源" : sourceLabel(source))}</span>
      <strong>${count}</strong>
    </button>
  `;
}

function paperRow(paper) {
  const active = paper.id === state.selectedId ? "active" : "";
  const authors = (paper.authors || []).slice(0, 3).join(", ");
  const tags = (paper.tags || []).slice(0, 4).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const summary = escapeHtml(rowSummary(paper)).slice(0, 220);
  const host = hostFromUrl(paper.sourceUrl);
  const quality = metadataState(paper);

  return `
    <button class="paper-row ${active}" data-select="${paper.id}">
      <div class="row-main">
        <div class="row-title">
          ${paper.planned ? '<span class="planned-dot"></span>' : ""}
          <span class="source-badge ${escapeHtml(paper.sourceType || "web")}">${escapeHtml(sourceLabel(paper.sourceType))}</span>
          <strong>${escapeHtml(displayTitle(paper))}</strong>
        </div>
        <p>${summary}</p>
        <div class="row-meta">
          <span>${escapeHtml(authors || paper.arxivId || paper.sourceType || "paper")}</span>
          ${host ? `<span>${escapeHtml(host)}</span>` : ""}
          <span>${STATUS_LABELS[paper.status] || paper.status}</span>
          <span class="quality ${quality.className}">${quality.label}</span>
          <span>${formatDate(paper.publishedAt || paper.addedAt)}</span>
        </div>
      </div>
      <div class="row-side">
        <span class="priority ${paper.priority}">${PRIORITY_LABELS[paper.priority] || paper.priority}</span>
        <div class="tags">${tags}</div>
      </div>
    </button>
  `;
}

function detailPanel(paper) {
  if (!paper) {
    return `
      <section class="detail empty">
        <h2>没有论文</h2>
      </section>
    `;
  }

  const authors = (paper.authors || []).join(", ");
  const tags = (paper.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const sourceUrl = paper.sourceUrl || "";
  const pdfUrl = paper.pdfUrl || "";
  const originUrl = paper.originUrl || "";
  const originLabel = paper.sourceType === "x" ? "X 来源" : "发现来源";
  const eyebrow = [paper.sourceType === "x" ? "X" : "", paper.arxivId || paper.doi || paper.sourceType || "paper"]
    .filter(Boolean)
    .join(" · ");

  return `
    <section class="detail" data-detail="${paper.id}">
      <div class="detail-header">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(displayTitle(paper))}</h2>
        </div>
        <button class="icon-button danger" data-delete="${paper.id}" title="删除">×</button>
      </div>

      <div class="button-row">
        ${sourceUrl ? `<a class="button" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">论文链接</a>` : ""}
        ${
          originUrl && originUrl !== sourceUrl
            ? `<a class="button" href="${escapeHtml(originUrl)}" target="_blank" rel="noreferrer">${originLabel}</a>`
            : ""
        }
        ${pdfUrl ? `<a class="button" href="${escapeHtml(pdfUrl)}" target="_blank" rel="noreferrer">PDF</a>` : ""}
        <button class="button" data-enrich="${paper.id}">补全</button>
        <button class="button ${paper.planned ? "selected" : ""}" data-plan="${paper.id}">
          ${paper.planned ? "已加入本周" : "加入本周"}
        </button>
      </div>

      ${
        sourceUrl
          ? `<div class="full-field url-field">
              <span>论文 URL</span>
              <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceUrl)}</a>
            </div>`
          : `<div class="missing-url">没有保存到论文 URL。可以重新保存该 arXiv 标签页，或手动在标题/来源里补 arXiv ID 后点补全。</div>`
      }

      ${
        originUrl && originUrl !== sourceUrl
          ? `<div class="full-field url-field">
              <span>${escapeHtml(originLabel)} URL</span>
              <a href="${escapeHtml(originUrl)}" target="_blank" rel="noreferrer">${escapeHtml(originUrl)}</a>
            </div>`
          : ""
      }

      <div class="field-grid">
        <label>
          <span>状态</span>
          <select data-field="status">
            ${Object.entries(STATUS_LABELS)
              .map(([value, label]) => `<option value="${value}" ${paper.status === value ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          <span>优先级</span>
          <select data-field="priority">
            ${Object.entries(PRIORITY_LABELS)
              .map(([value, label]) => `<option value="${value}" ${paper.priority === value ? "selected" : ""}>${label}</option>`)
              .join("")}
          </select>
        </label>
      </div>

      <label class="full-field">
        <span>标题</span>
        <input data-field="title" value="${escapeHtml(paper.title)}" />
      </label>

      <label class="full-field">
        <span>作者</span>
        <input data-field="authors" value="${escapeHtml(authors)}" />
      </label>

      <label class="full-field">
        <span>标签</span>
        <input data-field="tags" value="${escapeHtml((paper.tags || []).join(", "))}" />
      </label>

      <label class="full-field">
        <span>为什么保存</span>
        <input data-field="savedReason" value="${escapeHtml(paper.savedReason || "")}" />
      </label>

      ${
        paper.originText
          ? `<div class="source-note">
              <span>${escapeHtml(originLabel)}</span>
              <p>${escapeHtml(paper.originText)}</p>
            </div>`
          : ""
      }

      <label class="full-field">
        <span>摘要</span>
        <textarea data-field="abstract" rows="7">${escapeHtml(paper.abstract || "")}</textarea>
      </label>

      <label class="full-field notes">
        <span>阅读笔记</span>
        <textarea data-field="notes" rows="10">${escapeHtml(paper.notes || "")}</textarea>
      </label>

      <div class="detail-tags">${tags}</div>
    </section>
  `;
}

function render() {
  const visible = filteredPapers();
  const paper = selectedPaper();

  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h1>Paper Inbox</h1>
          <p>${state.papers.length} papers</p>
        </div>

        <nav>
          ${navItem("inbox", "收件箱")}
          ${navItem("read_later", "阅读队列")}
          ${navItem("done", "已完成")}
          ${navItem("archived", "归档")}
          ${navItem("all", "全部")}
        </nav>

        <div class="source-nav">
          <h2>来源</h2>
          ${sourceItem("all", state.papers.length)}
          ${allSources().map(([source, count]) => sourceItem(source, count)).join("")}
        </div>

        <div class="tag-nav">
          <h2>标签</h2>
          ${allTags()
            .map(([tag, count]) => `
              <button class="tag-link ${state.tag === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">
                <span>${escapeHtml(tag)}</span>
                <strong>${count}</strong>
              </button>
            `)
            .join("")}
        </div>
      </aside>

      <main class="main">
        <header class="topbar">
          <form class="add-form" id="add-form">
            <input id="url-input" placeholder="https://arxiv.org/abs/... 或 /html/..." autocomplete="off" />
            <button type="submit">添加</button>
          </form>
          <input id="search-input" class="search" value="${escapeHtml(state.query)}" placeholder="搜索" />
          <button id="import-toggle" class="button">批量</button>
          <button id="export-json" class="button">导出</button>
        </header>

        <section class="import-panel" ${state.importOpen ? "" : "hidden"}>
          <textarea id="bulk-input" rows="4" placeholder="每行一个链接"></textarea>
          <div>
            <button id="bulk-add">导入链接</button>
            <button id="clear-data" class="danger-text">清空本地数据</button>
          </div>
        </section>

        ${state.notice ? `<div class="notice">${escapeHtml(state.notice)}</div>` : ""}

        <div class="content">
          <section class="list">
            <div class="list-head">
              <strong>${visible.length} items</strong>
              ${state.busy ? "<span>Syncing</span>" : ""}
            </div>
            <div class="rows">
              ${visible.map(paperRow).join("") || '<div class="empty-list">暂无条目</div>'}
            </div>
          </section>
          ${detailPanel(paper)}
        </div>
      </main>
    </div>
  `;

  const rows = app.querySelector(".rows");
  if (rows) {
    rows.scrollTop = state.listScrollTop;
  }
  if (state.pageScrollY) {
    window.scrollTo(0, state.pageScrollY);
  }
}

async function refresh(options = {}) {
  const store = await loadStore();
  const repairedPapers = (store.papers || []).map(repairPaperLinks);
  if (JSON.stringify(repairedPapers) !== JSON.stringify(store.papers || [])) {
    await saveStore({ ...store, papers: repairedPapers });
  }
  state.papers = repairedPapers;
  if (options.keepSelection !== true && !state.papers.some((paper) => paper.id === state.selectedId)) {
    state.selectedId = "";
  }
  render();
}

async function patchSelected(patch) {
  const paper = selectedPaper();
  if (!paper) return;
  await updatePaper(paper.id, patch);
  await refresh({ keepSelection: true });
}

async function handleAddUrl(url) {
  if (!url.trim()) return;
  state.busy = true;
  state.notice = "";
  render();

  const paper = paperFromUrl(url);
  const result = await upsertPaper(paper, { enrich: true, preferIncoming: true });
  state.selectedId = result.paper.id;
  state.notice = result.created ? "已添加" : "已更新已有条目";
  state.busy = false;
  await refresh({ keepSelection: true });
}

function downloadJson() {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), papers: state.papers }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `paper-inbox-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function fieldValue(field, rawValue) {
  if (field === "authors" || field === "tags") {
    return rawValue.split(",").map((item) => item.trim()).filter(Boolean);
  }

  return rawValue;
}

function patchLocalPaper(paperId, patch) {
  state.papers = state.papers.map((paper) => {
    if (paper.id !== paperId) return paper;
    return repairPaperLinks({ ...paper, ...patch });
  });
}

function queueFieldSave(paperId, field, value, delay = FIELD_SAVE_DELAY) {
  const key = `${paperId}:${field}`;
  clearTimeout(fieldSaveTimers.get(key));
  fieldSaveTimers.set(
    key,
    setTimeout(() => {
      fieldSaveTimers.delete(key);
      fieldSaveQueue = fieldSaveQueue
        .catch(() => {})
        .then(() => updatePaper(paperId, { [field]: value }))
        .catch((error) => {
          console.error("Paper field save failed", error);
        });
    }, delay)
  );
}

app.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;

  const filter = target.dataset.filter;
  if (filter) {
    state.filter = filter;
    state.tag = "";
    state.selectedId = "";
    state.listScrollTop = 0;
    state.pageScrollY = 0;
    render();
    return;
  }

  const tag = target.dataset.tag;
  if (tag) {
    state.tag = tag;
    state.filter = "all";
    state.source = "all";
    state.selectedId = "";
    state.listScrollTop = 0;
    state.pageScrollY = 0;
    render();
    return;
  }

  const source = target.dataset.source;
  if (source) {
    state.source = source;
    state.tag = "";
    state.selectedId = "";
    state.listScrollTop = 0;
    state.pageScrollY = 0;
    render();
    return;
  }

  const selectId = target.dataset.select;
  if (selectId) {
    state.listScrollTop = app.querySelector(".rows")?.scrollTop || 0;
    state.pageScrollY = window.scrollY || 0;
    state.selectedId = selectId;
    render();
    return;
  }

  if (target.id === "import-toggle") {
    state.importOpen = !state.importOpen;
    render();
    return;
  }

  if (target.id === "export-json") {
    downloadJson();
    return;
  }

  if (target.id === "bulk-add") {
    const textarea = app.querySelector("#bulk-input");
    state.busy = true;
    render();
    const results = await importPapersFromUrls(textarea.value, { enrich: true, preferIncoming: true });
    state.notice = `导入 ${results.filter((result) => result.created).length} 篇，更新 ${results.filter((result) => !result.created).length} 篇`;
    state.busy = false;
    await refresh();
    return;
  }

  if (target.id === "clear-data") {
    if (!confirm("清空 Paper Inbox 的本地数据？")) return;
    await clearStore();
    state.selectedId = "";
    await refresh();
    return;
  }

  const planId = target.dataset.plan;
  if (planId) {
    const paper = state.papers.find((item) => item.id === planId);
    await updatePaper(planId, { planned: !paper?.planned });
    await refresh({ keepSelection: true });
    return;
  }

  const enrichId = target.dataset.enrich;
  if (enrichId) {
    const paper = state.papers.find((item) => item.id === enrichId);
    if (!paper) return;
    state.busy = true;
    render();
    const enriched = await enrichPaper(paper);
    await updatePaper(enrichId, enriched);
    state.busy = false;
    state.notice = "已补全元数据";
    await refresh({ keepSelection: true });
    return;
  }

  const deleteId = target.dataset.delete;
  if (deleteId) {
    await deletePaper(deleteId);
    state.selectedId = "";
    await refresh();
  }
});

app.addEventListener("submit", async (event) => {
  if (event.target.id !== "add-form") return;
  event.preventDefault();
  const input = app.querySelector("#url-input");
  await handleAddUrl(input.value);
});

app.addEventListener("input", (event) => {
  if (event.target.id === "search-input") {
    const cursor = event.target.selectionStart;
    state.query = event.target.value;
    state.selectedId = "";
    state.listScrollTop = 0;
    state.pageScrollY = 0;
    render();
    const input = app.querySelector("#search-input");
    input.focus();
    input.setSelectionRange(cursor, cursor);
    return;
  }

  persistField(event.target);
});

app.addEventListener("change", (event) => {
  persistField(event.target, { immediate: true });
});

app.addEventListener(
  "scroll",
  (event) => {
    if (event.target.classList?.contains("rows")) {
      state.listScrollTop = event.target.scrollTop;
    }
  },
  true
);

window.addEventListener("scroll", () => {
  state.pageScrollY = window.scrollY || 0;
});

function persistField(target, options = {}) {
  const field = target.dataset.field;
  if (!field) return;

  const paperId = target.closest("[data-detail]")?.dataset.detail || selectedPaper()?.id;
  if (!paperId) return;

  const value = fieldValue(field, target.value);
  patchLocalPaper(paperId, { [field]: value });
  queueFieldSave(paperId, field, value, options.immediate ? 0 : FIELD_SAVE_DELAY);
}

await refresh();
