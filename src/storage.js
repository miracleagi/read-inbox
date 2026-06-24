const STORE_KEY = "paperInbox.v1";
const LOCAL_SERVER = "http://127.0.0.1:8137";

const defaultStore = {
  papers: [],
  deletedPapers: [],
  settings: {
    createdAt: new Date().toISOString()
  }
};
const DELETED_PAPERS_LIMIT = 2000;

function canUseChromeStorage() {
  return Boolean(globalThis.chrome?.storage?.local);
}

function serverOrigin() {
  const protocol = globalThis.location?.protocol || "";
  if (protocol === "http:" || protocol === "https:") {
    return "";
  }
  if (protocol === "chrome-extension:") {
    return LOCAL_SERVER;
  }
  return null;
}

function cloneStore(store) {
  return {
    ...defaultStore,
    ...store,
    papers: Array.isArray(store?.papers) ? store.papers : [],
    deletedPapers: Array.isArray(store?.deletedPapers) ? store.deletedPapers : []
  };
}

function normalizeIdentity(identity) {
  return String(identity || "").trim().toLowerCase();
}

export function paperIdentities(paper) {
  return [
    paper?.key,
    paper?.arxivId ? `arxiv:${paper.arxivId}` : "",
    paper?.doi ? `doi:${paper.doi}` : "",
    paper?.sourceUrl ? `url:${paper.sourceUrl}` : "",
    paper?.id ? `id:${paper.id}` : ""
  ]
    .map(normalizeIdentity)
    .filter(Boolean)
    .filter((identity, index, identities) => identities.indexOf(identity) === index);
}

function paperIdentity(paper) {
  return paperIdentities(paper)[0];
}

export function deletionIdentities(deletion) {
  const directIdentities = [
    deletion?.identity,
    ...(Array.isArray(deletion?.identities) ? deletion.identities : [])
  ].map(normalizeIdentity);
  return [...directIdentities, ...paperIdentities(deletion)]
    .filter(Boolean)
    .filter((identity, index, identities) => identities.indexOf(identity) === index);
}

function mergeDeletedPapers(stores) {
  const deleted = new Map();

  for (const store of stores) {
    for (const deletion of store.deletedPapers || []) {
      for (const identity of deletionIdentities(deletion)) {
        const deletedAt = deletion?.deletedAt || new Date().toISOString();
        deleted.set(identity, { identity, deletedAt });
      }
    }
  }

  return [...deleted.values()]
    .sort((a, b) => new Date(b.deletedAt || 0) - new Date(a.deletedAt || 0))
    .slice(0, DELETED_PAPERS_LIMIT);
}

function mergePaperRecord(existing, incoming) {
  if (!existing) return incoming;

  return {
    ...existing,
    ...incoming,
    tags: [...new Set([...(existing.tags || []), ...(incoming.tags || [])])],
    notes: incoming.notes || existing.notes || "",
    savedReason: incoming.savedReason || existing.savedReason || ""
  };
}

function mergeStores(...stores) {
  const merged = cloneStore(null);
  const papers = new Map();
  const normalizedStores = stores.filter(Boolean).map(cloneStore);
  const deletedPapers = mergeDeletedPapers(normalizedStores);
  const deletedIdentities = new Set(deletedPapers.flatMap(deletionIdentities));

  for (const store of normalizedStores) {
    merged.settings = { ...merged.settings, ...(store.settings || {}) };
    for (const paper of store.papers || []) {
      const identities = paperIdentities(paper);
      if (identities.some((identity) => deletedIdentities.has(identity))) continue;
      const identity = identities[0];
      if (!identity) continue;
      papers.set(identity, mergePaperRecord(papers.get(identity), paper));
    }
  }

  merged.papers = [...papers.values()].sort((a, b) => new Date(b.addedAt || 0) - new Date(a.addedAt || 0));
  merged.deletedPapers = deletedPapers;
  return merged;
}

async function loadServerStore() {
  const origin = serverOrigin();
  if (origin === null) return null;

  const response = await fetch(`${origin}/api/store`, {
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Local store request failed: ${response.status}`);
  return cloneStore(await response.json());
}

async function saveServerStore(store) {
  const origin = serverOrigin();
  if (origin === null) return false;

  const response = await fetch(`${origin}/api/store`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cloneStore(store))
  });
  if (!response.ok) throw new Error(`Local store save failed: ${response.status}`);
  return true;
}

async function clearServerStore() {
  const origin = serverOrigin();
  if (origin === null) return false;

  const response = await fetch(`${origin}/api/store`, {
    method: "DELETE"
  });
  if (!response.ok) throw new Error(`Local store clear failed: ${response.status}`);
  return true;
}

async function loadChromeStore() {
  if (canUseChromeStorage()) {
    const result = await chrome.storage.local.get(STORE_KEY);
    return cloneStore(result[STORE_KEY]);
  }
  return null;
}

async function saveChromeStore(store) {
  if (!canUseChromeStorage()) return false;
  await chrome.storage.local.set({ [STORE_KEY]: cloneStore(store) });
  return true;
}

async function clearChromeStore() {
  if (!canUseChromeStorage()) return false;
  await chrome.storage.local.remove(STORE_KEY);
  return true;
}

export async function loadStore() {
  const stores = [];

  try {
    const serverStore = await loadServerStore();
    if (serverStore) stores.push(serverStore);
  } catch {
    // The local server is optional for extension-only usage.
  }

  try {
    const chromeStore = await loadChromeStore();
    if (chromeStore) stores.push(chromeStore);
  } catch {
    // Fall through to localStorage.
  }

  if (stores.length) {
    const merged = mergeStores(...stores);
    await Promise.allSettled([saveServerStore(merged), saveChromeStore(merged)]);
    return merged;
  }

  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    return cloneStore(raw ? JSON.parse(raw) : null);
  } catch {
    return cloneStore(null);
  }
}

export async function saveStore(store) {
  const nextStore = cloneStore(store);
  const results = await Promise.allSettled([saveServerStore(nextStore), saveChromeStore(nextStore)]);
  if (results.some((result) => result.status === "fulfilled" && result.value)) {
    return nextStore;
  }

  try {
    globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(nextStore));
  } catch {
    // Ignore unavailable localStorage contexts.
  }
  return nextStore;
}

export async function replacePapers(papers) {
  const store = await loadStore();
  store.papers = papers;
  return saveStore(store);
}

export async function clearStore() {
  await Promise.allSettled([clearServerStore(), clearChromeStore()]);

  globalThis.localStorage?.removeItem(STORE_KEY);
}
