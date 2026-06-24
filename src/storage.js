const LOCAL_SERVER = "http://127.0.0.1:8137";

const defaultStore = {
  papers: [],
  deletedPapers: [],
  settings: {
    createdAt: new Date().toISOString()
  }
};

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

function storeUrl() {
  const origin = serverOrigin();
  if (origin === null) {
    throw new Error("请通过本地服务或 Chrome 插件使用 Paper Inbox");
  }
  return `${origin}/api/store`;
}

function localServerError(action) {
  return new Error(`本地服务不可用，无法${action}。请先启动 node server.js 或安装 LaunchAgent。`);
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

export function deletionIdentities(deletion) {
  const directIdentities = [
    deletion?.identity,
    ...(Array.isArray(deletion?.identities) ? deletion.identities : [])
  ].map(normalizeIdentity);
  return [...directIdentities, ...paperIdentities(deletion)]
    .filter(Boolean)
    .filter((identity, index, identities) => identities.indexOf(identity) === index);
}

export async function loadStore() {
  try {
    const response = await fetch(storeUrl(), {
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return cloneStore(await response.json());
  } catch (error) {
    if (error.message?.startsWith("请通过")) throw error;
    throw localServerError("读取数据");
  }
}

export async function saveStore(store) {
  const nextStore = cloneStore(store);

  try {
    const response = await fetch(storeUrl(), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(nextStore)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return nextStore;
  } catch (error) {
    if (error.message?.startsWith("请通过")) throw error;
    throw localServerError("保存数据");
  }
}

export async function replacePapers(papers) {
  const store = await loadStore();
  store.papers = papers;
  return saveStore(store);
}

export async function clearStore() {
  try {
    const response = await fetch(storeUrl(), {
      method: "DELETE"
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    if (error.message?.startsWith("请通过")) throw error;
    throw localServerError("清空数据");
  }
}
