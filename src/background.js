import {
  extractArxivId,
  isCollectableResearchUrl,
  isXUrl,
  paperFromDiscoveredUrl,
  paperFromTab,
  paperUrlsFromText,
  upsertMany,
  upsertPaper
} from "./paper.js";
import { loadStore } from "./storage.js";

function isArxivTab(tab) {
  return isCollectableResearchUrl(tab?.url || tab?.pendingUrl || "") || Boolean(extractArxivId(tab?.title || ""));
}

function collectPageCandidates() {
  const values = new Set();
  const add = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text) values.add(text);
  };

  add(document.title);
  add(location.href);

  for (const anchor of document.querySelectorAll("a")) {
    add(anchor.href);
    add(anchor.textContent);
    add(anchor.title);
    add(anchor.getAttribute("aria-label"));
    for (const [name, value] of Object.entries(anchor.dataset || {})) {
      if (/url|href|expanded/i.test(name)) add(value);
    }
  }

  const articleTexts = [...document.querySelectorAll("article")]
    .map((article) => article.innerText)
    .filter(Boolean);
  add(articleTexts.join("\n\n"));

  if (articleTexts.length === 0) {
    add((document.body?.innerText || "").slice(0, 30000));
  }

  return {
    title: document.title,
    url: location.href,
    text: (articleTexts[0] || document.body?.innerText || "").slice(0, 1200),
    candidates: [...values].slice(0, 800)
  };
}

function tcoUrlsFromCandidates(candidates) {
  const urls = new Set();
  for (const candidate of candidates) {
    for (const match of String(candidate || "").matchAll(/https:\/\/t\.co\/[A-Za-z0-9]+/g)) {
      urls.add(match[0]);
    }
  }
  return [...urls].slice(0, 12);
}

async function resolveTcoUrl(url) {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    return response.url || "";
  } catch {
    try {
      const response = await fetch(url, { method: "GET", redirect: "follow" });
      return response.url || "";
    } catch {
      return "";
    }
  }
}

async function extractPapersFromXTab(tab) {
  if (!tab?.id) return [];

  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPageCandidates
  });

  const payload = result?.result || {};
  const urls = new Set();
  for (const candidate of payload.candidates || []) {
    for (const url of paperUrlsFromText(candidate)) {
      urls.add(url);
    }
  }

  const resolved = await Promise.all(tcoUrlsFromCandidates(payload.candidates || []).map(resolveTcoUrl));
  for (const url of resolved) {
    for (const paperUrl of paperUrlsFromText(url)) {
      urls.add(paperUrl);
    }
  }

  return [...urls].map((url) =>
    paperFromDiscoveredUrl(url, {
      url: tab.url || payload.url,
      title: tab.title || payload.title,
      text: payload.text,
      sourceType: "x"
    })
  );
}

function summarizeResults(results) {
  const created = results.filter((result) => result.created).length;
  return {
    created,
    updated: results.length - created,
    total: results.length
  };
}

async function savePaperTabs(closeTabs) {
  await loadStore();

  const tabs = await chrome.tabs.query({});
  const paperTabs = tabs.filter(isArxivTab);
  if (paperTabs.length === 0) {
    return { total: 0, created: 0, updated: 0, message: "No paper-like tabs found" };
  }

  const papers = paperTabs.map(paperFromTab).filter((paper) => paper.sourceUrl);
  const initial = await upsertMany(papers, { enrich: false, preferIncoming: false });

  if (closeTabs) {
    const ids = paperTabs.map((tab) => tab.id).filter(Boolean);
    if (ids.length) await chrome.tabs.remove(ids);
  }

  await upsertMany(papers, { enrich: true, preferIncoming: true });

  return {
    ...summarizeResults(initial),
    message: `Saved ${initial.filter((result) => result.created).length}, updated ${
      initial.filter((result) => !result.created).length
    }`
  };
}

async function saveCurrentTab(tab, closeTab) {
  await loadStore();

  let results;
  if (isXUrl(tab?.url || "")) {
    let papers = [paperFromTab(tab)];
    try {
      papers = [...papers, ...(await extractPapersFromXTab(tab))];
    } catch {
      // Keep the original X URL even if link extraction fails.
    }
    results = await upsertMany(papers, { enrich: true, preferIncoming: true });
  } else {
    results = [await upsertPaper(paperFromTab(tab), { enrich: true, preferIncoming: true })];
  }

  if (closeTab && tab?.id) {
    await chrome.tabs.remove(tab.id);
  }

  const summary = summarizeResults(results);
  return {
    ...summary,
    message: summary.total === 1 && summary.created ? "Saved" : `Saved ${summary.created}, updated ${summary.updated}`
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "paper-inbox:save-arxiv-tabs") {
    savePaperTabs(Boolean(message.closeTabs))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message || "Save failed" }));
    return true;
  }

  if (message?.type === "paper-inbox:save-current-tab") {
    saveCurrentTab(message.tab, Boolean(message.closeTab))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message || "Save failed" }));
    return true;
  }

  return false;
});
