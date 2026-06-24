import { loadStore } from "./storage.js";

const statusEl = document.querySelector("#status");
const saveCurrentButton = document.querySelector("#save-current");
const saveArxivTabsButton = document.querySelector("#save-arxiv-tabs");
const openDashboardButton = document.querySelector("#open-dashboard");
const closeTabsInput = document.querySelector("#close-tabs");

function setStatus(message) {
  statusEl.textContent = message;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response;
}

saveCurrentButton.addEventListener("click", async () => {
  saveCurrentButton.disabled = true;
  setStatus("Saving in background");

  try {
    const tab = await currentTab();
    const response = await sendMessage({
      type: "paper-inbox:save-current-tab",
      tab,
      closeTab: closeTabsInput.checked
    });
    setStatus(response.message || "Saved");
  } catch (error) {
    setStatus(error.message || "Save failed");
  } finally {
    saveCurrentButton.disabled = false;
  }
});

saveArxivTabsButton.addEventListener("click", async () => {
  saveArxivTabsButton.disabled = true;
  setStatus("Saving paper-like tabs in background");

  try {
    const result = await sendMessage({
      type: "paper-inbox:save-arxiv-tabs",
      closeTabs: closeTabsInput.checked
    });
    setStatus(result.message || `Saved ${result.created}, updated ${result.updated}`);
  } catch (error) {
    setStatus(error.message || "Save failed");
  } finally {
    saveArxivTabsButton.disabled = false;
  }
});

openDashboardButton.addEventListener("click", async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

loadStore()
  .then(() => setStatus("Ready"))
  .catch((error) => setStatus(error.message || "Local service unavailable"));
