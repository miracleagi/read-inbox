import { loadStore, saveStore } from "./storage.js";

const ARXIV_API = "https://export.arxiv.org/api/query";
const KNOWN_TOPIC_TAGS = [
  ["llm", ["large language model", "language model", "llm", "gpt", "transformer"]],
  ["agents", ["agent", "multi-agent", "tool use", "planning"]],
  ["vision", ["computer vision", "image", "video", "diffusion", "segmentation"]],
  ["robotics", ["robot", "robotics", "manipulation", "embodied"]],
  ["systems", ["distributed", "system", "latency", "throughput", "compiler"]],
  ["ml", ["learning", "neural", "training", "optimization", "benchmark"]],
  ["security", ["security", "privacy", "attack", "defense", "adversarial"]],
  ["bio", ["protein", "biology", "genomics", "molecule", "medical"]]
];

export const STATUS = {
  inbox: "Inbox",
  read_later: "Queue",
  done: "Completed",
  archived: "Archive"
};

export const STATUS_LABELS = {
  inbox: "收件箱",
  read_later: "阅读队列",
  done: "已完成",
  archived: "归档"
};

export const PRIORITY_LABELS = {
  high: "High",
  medium: "Medium",
  low: "Low"
};

function now() {
  return new Date().toISOString();
}

function uuid() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `paper-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLength) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "ref",
      "source"
    ];
    trackingParams.forEach((param) => url.searchParams.delete(param));
    return url.toString();
  } catch {
    return normalizeWhitespace(value);
  }
}

function normalizeDiscoveredUrl(value) {
  let nextValue = normalizeWhitespace(value)
    .replace(/^["'(<\[]+/, "")
    .replace(/[>"')\].,;]+$/, "");

  if (/^(?:www\.)?arxiv\.org\//i.test(nextValue)) {
    nextValue = `https://${nextValue.replace(/^www\./i, "")}`;
  }

  if (/^(?:www\.)?doi\.org\//i.test(nextValue)) {
    nextValue = `https://${nextValue.replace(/^www\./i, "")}`;
  }

  if (/^10\.\d{4,9}\//i.test(nextValue)) {
    nextValue = `https://doi.org/${nextValue}`;
  }

  return normalizeUrl(nextValue);
}

function stripArxivVersion(arxivId) {
  return arxivId.replace(/v\d+$/i, "");
}

function arxivAbsUrl(arxivId) {
  return arxivId ? `https://arxiv.org/abs/${arxivId}` : "";
}

function arxivPdfUrl(arxivId) {
  return arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : "";
}

export function extractArxivId(input) {
  const text = String(input || "");
  const decoded = safeDecodeURIComponent(text);
  const modern = decoded.match(
    /(?:(?:arxiv\.org|alphaxiv\.org)\/(?:abs|pdf|html)\/|arXiv\s*:?\s*)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/i
  );
  if (modern) return stripArxivVersion(modern[1]);

  const oldStyle = decoded.match(
    /(?:(?:arxiv\.org|alphaxiv\.org)\/(?:abs|pdf|html)\/|arXiv\s*:?\s*)([a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?(?:\.pdf)?/i
  );
  if (oldStyle) return stripArxivVersion(oldStyle[1]);

  return "";
}

export function extractDoi(input) {
  const text = String(input || "");
  const match = text.match(/\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i);
  return match ? match[1].replace(/[.,;)\]]+$/, "") : "";
}

export function isPaperUrl(url) {
  return Boolean(extractArxivId(url) || extractDoi(url));
}

export function inferSourceType(url) {
  const text = String(url || "");
  if (/arxiv\.org/i.test(text)) return "arxiv";
  if (/alphaxiv\.org/i.test(text)) return "alphaxiv";
  if (/huggingface\.co/i.test(text)) return "huggingface";
  if (/github\.com/i.test(text)) return "github";
  if (/github\.io/i.test(text)) return "project";
  if (/twitter\.com|x\.com/i.test(text)) return "x";
  if (/doi\.org/i.test(text)) return "doi";
  return "web";
}

export function isXUrl(url) {
  return /^https?:\/\/(?:mobile\.|www\.)?(?:x\.com|twitter\.com)\//i.test(String(url || ""));
}

function stripXTitleChrome(title) {
  return normalizeWhitespace(title)
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*(?:\/|-)\s*(?:X|Twitter)\s*$/i, "");
}

function stripOuterQuotes(value) {
  return normalizeWhitespace(value)
    .replace(/^["'“”‘’]+/, "")
    .replace(/["'“”‘’]+$/, "")
    .trim();
}

function parseXTitle(title) {
  const value = stripXTitleChrome(title);
  if (!value) return { title: "", text: "" };

  const patterns = [/^(.{1,80}?)\s+on\s+(?:X|Twitter):\s*(.+)$/i, /^([^:]{1,80}):\s*(.+)$/];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;

    const author = truncateText(match[1], 48);
    const text = stripOuterQuotes(match[2]);
    if (author && text) {
      return {
        title: `${author} on X`,
        text
      };
    }
  }

  return {
    title: truncateText(value, 96),
    text: value.length > 96 ? value : ""
  };
}

export function cleanXTitle(title, fallback = "X post") {
  return parseXTitle(title).title || fallback;
}

export function xTitleText(title) {
  return parseXTitle(title).text;
}

export function isResearchProjectUrl(input) {
  try {
    const url = new URL(String(input || ""));
    const host = url.hostname.toLowerCase();
    return (
      host === "arxiv.org" ||
      host === "github.com" ||
      host === "gist.github.com" ||
      host.endsWith(".github.io") ||
      host === "alphaxiv.org" ||
      host.endsWith(".alphaxiv.org") ||
      host === "huggingface.co" ||
      host.endsWith(".huggingface.co") ||
      host === "x.com" ||
      host === "twitter.com"
    );
  } catch {
    return false;
  }
}

export function isCollectableResearchUrl(input) {
  return Boolean(extractArxivId(input) || extractDoi(input) || isXUrl(input) || isResearchProjectUrl(input));
}

export function paperUrlsFromText(input) {
  const text = String(input || "");
  const urls = new Set();
  const urlPattern =
    /(?:https?:\/\/)?(?:www\.)?(?:arxiv\.org\/(?:abs|pdf|html)\/[^\s<>"']+|doi\.org\/10\.\d{4,9}\/[^\s<>"']+)/gi;
  const arxivPattern = /arXiv\s*:?\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?/gi;
  const doiPattern = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/gi;

  for (const match of text.matchAll(urlPattern)) {
    const url = normalizeDiscoveredUrl(match[0]);
    if (isPaperUrl(url)) urls.add(url);
  }

  for (const match of text.matchAll(arxivPattern)) {
    const arxivId = stripArxivVersion(match[1]);
    urls.add(`https://arxiv.org/abs/${arxivId}`);
  }

  for (const match of text.matchAll(doiPattern)) {
    const doi = extractDoi(match[1]);
    if (doi) urls.add(`https://doi.org/${doi}`);
  }

  return [...urls];
}

export function cleanTitle(title, url = "") {
  if (isXUrl(url)) {
    return cleanXTitle(title);
  }

  const value = normalizeWhitespace(title)
    .replace(/\s*-\s*arXiv\.org\s*$/i, "")
    .replace(/\s*\|\s*arXiv.*$/i, "")
    .replace(/\s*-\s*alphaXiv\s*$/i, "")
    .replace(/\s*-\s*Google Scholar\s*$/i, "")
    .replace(/\s*-\s*Semantic Scholar\s*$/i, "");

  if (value && value !== url) return value;

  const arxivId = extractArxivId(url);
  if (arxivId) return `arXiv:${arxivId}`;

  return normalizeWhitespace(url) || "Untitled paper";
}

export function paperKey(input) {
  const url = normalizeUrl(input.sourceUrl || input.url || "");
  const sourceType = input.sourceType || inferSourceType(url);
  if (url && (isXUrl(url) || ["github", "project", "huggingface"].includes(sourceType))) {
    return `url:${url.toLowerCase()}`;
  }
  if (input.arxivId) return `arxiv:${input.arxivId.toLowerCase()}`;
  if (input.doi) return `doi:${input.doi.toLowerCase()}`;
  return `url:${url.toLowerCase()}`;
}

export function guessTags(text) {
  const lower = String(text || "").toLowerCase();
  const tags = [];

  for (const [tag, needles] of KNOWN_TOPIC_TAGS) {
    if (needles.some((needle) => lower.includes(needle))) {
      tags.push(tag);
    }
  }

  return tags.slice(0, 4);
}

export function repairPaperLinks(paper) {
  const repaired = { ...paper };
  const arxivId = repaired.arxivId || extractArxivId([repaired.sourceUrl, repaired.title, repaired.originText].join(" "));
  const doi = repaired.doi || extractDoi([repaired.sourceUrl, repaired.title, repaired.originText].join(" "));
  const sourceType = inferSourceType(repaired.sourceUrl);

  if (arxivId) {
    repaired.arxivId = arxivId;
    if (!repaired.sourceUrl || sourceType === "arxiv") {
      repaired.sourceUrl = arxivAbsUrl(arxivId);
    }
    repaired.pdfUrl = repaired.pdfUrl || arxivPdfUrl(arxivId);
  } else if (!repaired.sourceUrl && doi) {
    repaired.doi = doi;
    repaired.sourceUrl = `https://doi.org/${doi}`;
  }

  if (repaired.status === "reading") {
    repaired.status = "read_later";
  }
  if (!STATUS_LABELS[repaired.status]) {
    repaired.status = "inbox";
  }

  repaired.key = paperKey(repaired);
  return repaired;
}

export function paperFromUrl(url, title = "", options = {}) {
  const rawSourceUrl = normalizeUrl(url || options.sourceUrl || "");
  const discoveryText = [rawSourceUrl, title, options.originTitle, options.originText].join(" ");
  const arxivId = extractArxivId(discoveryText);
  const doi = extractDoi(discoveryText);
  let sourceUrl = rawSourceUrl;
  const rawSourceType = inferSourceType(rawSourceUrl);

  if (arxivId && (!sourceUrl || rawSourceType === "arxiv")) {
    sourceUrl = arxivAbsUrl(arxivId);
  } else if (!sourceUrl && doi) {
    sourceUrl = `https://doi.org/${doi}`;
  }

  const normalizedTitle = cleanTitle(title, sourceUrl || rawSourceUrl);
  const xPostText = rawSourceType === "x" ? xTitleText(title) : "";
  const originUrl = options.originUrl ? normalizeUrl(options.originUrl) : "";
  const sourceType = options.sourceType || inferSourceType(originUrl || sourceUrl);
  const paper = {
    id: uuid(),
    key: "",
    title: normalizedTitle,
    authors: [],
    abstract: "",
    arxivId,
    doi,
    pdfUrl: arxivPdfUrl(arxivId),
    sourceUrl,
    sourceType,
    originUrl,
    originTitle: normalizeWhitespace(options.originTitle || ""),
    originText: normalizeWhitespace(options.originText || xPostText).slice(0, 800),
    status: "inbox",
    priority: "medium",
    tags: [
      ...new Set([
        ...(options.tags || []),
        ...guessTags(`${normalizedTitle} ${sourceUrl} ${options.originText || ""} ${xPostText}`)
      ])
    ],
    planned: false,
    notes: "",
    savedReason: normalizeWhitespace(options.savedReason || ""),
    publishedAt: "",
    addedAt: now(),
    updatedAt: now()
  };
  return repairPaperLinks(paper);
}

export function paperFromTab(tab) {
  return paperFromUrl(tab?.url || tab?.pendingUrl || "", tab?.title || "");
}

export function paperFromDiscoveredUrl(url, origin = {}) {
  const originUrl = normalizeUrl(origin.url || "");
  const sourceType = origin.sourceType || inferSourceType(originUrl);
  return paperFromUrl(url, "", {
    sourceType,
    originUrl,
    originTitle: origin.title || "",
    originText: origin.text || "",
    tags: sourceType === "x" ? ["from-x"] : []
  });
}

function textContent(node, selector) {
  return normalizeWhitespace(node.querySelector(selector)?.textContent || "");
}

function decodeXml(value) {
  return normalizeWhitespace(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function xmlTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function xmlAttr(node, attr) {
  const match = String(node || "").match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function parseArxivEntry(entry, fallbackUrl) {
  const idUrl = textContent(entry, "id");
  const arxivId = extractArxivId(idUrl || fallbackUrl);
  const title = textContent(entry, "title");
  const abstract = textContent(entry, "summary");
  const authors = [...entry.querySelectorAll("author > name")]
    .map((node) => normalizeWhitespace(node.textContent))
    .filter(Boolean);
  const pdfLink = [...entry.querySelectorAll("link")].find((node) => node.getAttribute("title") === "pdf");
  const tags = [
    ...guessTags(`${title} ${abstract}`),
    ...[...entry.querySelectorAll("category")]
      .map((node) => node.getAttribute("term"))
      .filter(Boolean)
      .slice(0, 3)
  ];

  return {
    title,
    authors,
    abstract,
    arxivId,
    pdfUrl: pdfLink?.getAttribute("href") || (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : ""),
    sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl || fallbackUrl,
    sourceType: "arxiv",
    publishedAt: textContent(entry, "published"),
    tags: [...new Set(tags)]
  };
}

function parseArxivXmlWithRegex(xml, fallbackUrl) {
  const entry = String(xml || "").match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];
  if (!entry) return null;

  const idUrl = xmlTag(entry, "id");
  const arxivId = extractArxivId(idUrl || fallbackUrl);
  const title = xmlTag(entry, "title");
  const abstract = xmlTag(entry, "summary");
  const authors = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/gi)]
    .map((match) => xmlTag(match[1], "name"))
    .filter(Boolean);
  const pdfLink = [...entry.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((link) => xmlAttr(link, "title") === "pdf");
  const categoryTags = [...entry.matchAll(/<category\b[^>]*>/gi)]
    .map((match) => xmlAttr(match[0], "term"))
    .filter(Boolean)
    .slice(0, 3);
  const tags = [...guessTags(`${title} ${abstract}`), ...categoryTags];

  return {
    title,
    authors,
    abstract,
    arxivId,
    pdfUrl: xmlAttr(pdfLink, "href") || (arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : ""),
    sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl || fallbackUrl,
    sourceType: "arxiv",
    publishedAt: xmlTag(entry, "published"),
    tags: [...new Set(tags)]
  };
}

function parseArxivXml(xml, fallbackUrl) {
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const entry = doc.querySelector("entry");
    return entry ? parseArxivEntry(entry, fallbackUrl) : null;
  }

  return parseArxivXmlWithRegex(xml, fallbackUrl);
}

export async function fetchArxivMetadata(arxivId) {
  if (!arxivId) return null;

  const urls = [];
  if (globalThis.location?.protocol?.startsWith("http")) {
    urls.push(`/api/arxiv/${encodeURIComponent(arxivId)}`);
  }
  urls.push(`${ARXIV_API}?id_list=${encodeURIComponent(arxivId)}`);

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;

      const xml = await response.text();
      const metadata = parseArxivXml(xml, `https://arxiv.org/abs/${arxivId}`);
      if (metadata) return metadata;
    } catch {
      continue;
    }
  }

  return null;
}

export async function enrichPaper(paper) {
  const arxivId = paper.arxivId || extractArxivId(paper.sourceUrl);
  if (!arxivId) return paper;

  try {
    const metadata = await fetchArxivMetadata(arxivId);
    if (!metadata) return paper;
    return mergePaper(paper, metadata, { preferIncoming: true });
  } catch {
    return paper;
  }
}

export function mergePaper(existing, incoming, options = {}) {
  const preferIncoming = Boolean(options.preferIncoming);
  let merged = { ...existing };
  const fields = [
    "title",
    "abstract",
    "arxivId",
    "doi",
    "pdfUrl",
    "sourceUrl",
    "sourceType",
    "originUrl",
    "originTitle",
    "originText",
    "publishedAt",
    "savedReason"
  ];

  for (const field of fields) {
    const incomingValue = incoming[field];
    if (field === "sourceType" && merged.sourceType === "x" && incomingValue === "arxiv") {
      continue;
    }
    if (incomingValue && (preferIncoming || !merged[field] || /^arXiv:\d/.test(merged[field]))) {
      merged[field] = incomingValue;
    }
  }

  if (Array.isArray(incoming.authors) && incoming.authors.length && (!merged.authors?.length || preferIncoming)) {
    merged.authors = incoming.authors;
  }

  merged.tags = [...new Set([...(merged.tags || []), ...(incoming.tags || [])])].filter(Boolean);
  merged.updatedAt = now();
  merged = repairPaperLinks(merged);
  return merged;
}

export async function upsertPaper(input, options = {}) {
  const store = await loadStore();
  const incoming = options.enrich ? await enrichPaper(input) : input;
  incoming.key = paperKey(incoming);
  const index = store.papers.findIndex((paper) => paper.key === incoming.key);
  const created = index === -1;

  if (created) {
    store.papers.unshift(incoming);
  } else {
    store.papers[index] = mergePaper(store.papers[index], incoming, options);
  }

  await saveStore(store);
  return {
    paper: created ? incoming : store.papers[index],
    created
  };
}

export async function upsertMany(papers, options = {}) {
  const results = [];
  for (const paper of papers) {
    results.push(await upsertPaper(paper, options));
  }
  return results;
}

export async function updatePaper(id, patch) {
  const store = await loadStore();
  const next = store.papers.map((paper) => {
    if (paper.id !== id) return paper;
    return repairPaperLinks({
      ...paper,
      ...patch,
      updatedAt: now()
    });
  });
  store.papers = next;
  await saveStore(store);
  return next.find((paper) => paper.id === id);
}

export async function deletePaper(id) {
  const store = await loadStore();
  store.papers = store.papers.filter((paper) => paper.id !== id);
  await saveStore(store);
}

export async function importPapersFromUrls(rawText, options = {}) {
  const urls = String(rawText || "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter((value) => /^https?:\/\//i.test(value));

  const papers = urls.map((url) => paperFromUrl(url));
  return upsertMany(papers, options);
}
