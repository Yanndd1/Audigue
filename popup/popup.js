const btnPlay = document.getElementById("btn-play");
const btnPause = document.getElementById("btn-pause");
const btnStop = document.getElementById("btn-stop");
const speedSlider = document.getElementById("speed");
const speedValue = document.getElementById("speed-value");
const statusEl = document.getElementById("status");
const detectedLangEl = document.getElementById("detected-lang");

let currentTabId = null;

// Load saved speed
chrome.storage.local.get("speed", (data) => {
  if (data.speed) {
    speedSlider.value = data.speed;
    speedValue.textContent = parseFloat(data.speed).toFixed(1);
  }
});

speedSlider.addEventListener("input", () => {
  const val = parseFloat(speedSlider.value).toFixed(1);
  speedValue.textContent = val;
  chrome.storage.local.set({ speed: val });
  // Update speed in real-time if speaking
  sendToContent("setSpeed", { speed: parseFloat(val) });
});

btnPlay.addEventListener("click", async () => {
  statusEl.textContent = "Extraction du texte…";
  const tab = await getCurrentTab();
  if (!tab) {
    statusEl.textContent = "Impossible d'accéder à l'onglet.";
    return;
  }
  currentTabId = tab.id;

  // Inject content script if needed
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (e) {
    // Script may already be injected, ignore
  }

  const speed = parseFloat(speedSlider.value);
  sendToContent("play", { speed });
});

btnPause.addEventListener("click", () => {
  sendToContent("pause");
});

btnStop.addEventListener("click", () => {
  sendToContent("stop");
  updateUI("stopped");
});

function sendToContent(action, data = {}) {
  if (!currentTabId) return;
  chrome.tabs.sendMessage(currentTabId, { action, ...data });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function updateUI(state, lang) {
  switch (state) {
    case "playing":
      btnPlay.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
      btnPause.querySelector("span").textContent = "Pause";
      statusEl.textContent = "Lecture en cours…";
      break;
    case "paused":
      btnPlay.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
      btnPause.querySelector("span").textContent = "Reprendre";
      statusEl.textContent = "En pause";
      break;
    case "stopped":
      btnPlay.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      btnPause.querySelector("span").textContent = "Pause";
      statusEl.textContent = "";
      break;
    case "error":
      btnPlay.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      statusEl.textContent = "Erreur de lecture.";
      break;
  }
  if (lang) {
    detectedLangEl.textContent = lang === "fr" ? "Français" : "English";
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "tts-state") {
    updateUI(msg.state, msg.lang);
  }
});

// On popup open, query current state
(async () => {
  const tab = await getCurrentTab();
  if (tab) {
    currentTabId = tab.id;
    try {
      chrome.tabs.sendMessage(tab.id, { action: "getState" });
    } catch {
      // Content script not yet injected
    }
  }
})();
