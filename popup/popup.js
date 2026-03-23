const btnPlay = document.getElementById("btn-play");
const btnPause = document.getElementById("btn-pause");
const btnStop = document.getElementById("btn-stop");
const speedSlider = document.getElementById("speed");
const speedValue = document.getElementById("speed-value");
const statusEl = document.getElementById("status");
const detectedLangEl = document.getElementById("detected-lang");
const voiceSelect = document.getElementById("voice-select");
const voiceHint = document.getElementById("voice-hint");

// VoiceBox elements
const vbToggle = document.getElementById("voicebox-toggle");
const vbEngineLabel = document.getElementById("engine-label");
const vbStatus = document.getElementById("voicebox-status");
const vbProfileSelect = document.getElementById("vb-profile-select");
const browserVoiceControl = document.getElementById("browser-voice-control");
const voiceboxVoiceControl = document.getElementById("voicebox-voice-control");

let currentTabId = null;
let useVoiceBox = false;

// Load saved preferences
chrome.storage.local.get(["speed", "voiceURI", "useVoiceBox", "vbProfileId"], (data) => {
  if (data.speed) {
    speedSlider.value = data.speed;
    speedValue.textContent = parseFloat(data.speed).toFixed(1);
  }
  if (data.useVoiceBox) {
    useVoiceBox = true;
    vbToggle.checked = true;
    updateEngineUI();
    loadVoiceBoxProfiles(data.vbProfileId);
  }
});

// Engine toggle
vbToggle.addEventListener("change", () => {
  useVoiceBox = vbToggle.checked;
  chrome.storage.local.set({ useVoiceBox });
  updateEngineUI();
  if (useVoiceBox) {
    loadVoiceBoxProfiles();
  }
});

function updateEngineUI() {
  if (useVoiceBox) {
    vbEngineLabel.textContent = "VoiceBox";
    browserVoiceControl.style.display = "none";
    voiceboxVoiceControl.style.display = "block";
  } else {
    vbEngineLabel.textContent = "Navigateur";
    browserVoiceControl.style.display = "block";
    voiceboxVoiceControl.style.display = "none";
    vbStatus.textContent = "";
    vbStatus.className = "voicebox-status";
  }
}

async function loadVoiceBoxProfiles(savedProfileId) {
  vbStatus.textContent = "Connexion…";
  vbStatus.className = "voicebox-status";
  try {
    const resp = await fetch("http://localhost:17493/profiles");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const profiles = await resp.json();

    vbStatus.textContent = "Connecté";
    vbStatus.className = "voicebox-status connected";

    vbProfileSelect.innerHTML = "";
    if (!profiles.length) {
      vbProfileSelect.innerHTML = '<option value="">Aucun profil disponible</option>';
      return;
    }

    // Load saved preference
    chrome.storage.local.get("vbProfileId", (data) => {
      const preferredId = savedProfileId || data.vbProfileId;

      profiles.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name + (p.language ? ` [${p.language}]` : "");
        if (p.id === preferredId) opt.selected = true;
        vbProfileSelect.appendChild(opt);
      });

      // If nothing was selected, save the first one
      if (!preferredId && profiles.length) {
        chrome.storage.local.set({ vbProfileId: profiles[0].id });
      }
    });
  } catch (e) {
    vbStatus.textContent = "VoiceBox non disponible — vérifiez que l'application est lancée";
    vbStatus.className = "voicebox-status error";
    vbProfileSelect.innerHTML = '<option value="">Indisponible</option>';
  }
}

vbProfileSelect.addEventListener("change", () => {
  chrome.storage.local.set({ vbProfileId: vbProfileSelect.value });
});

speedSlider.addEventListener("input", () => {
  const val = parseFloat(speedSlider.value).toFixed(1);
  speedValue.textContent = val;
  chrome.storage.local.set({ speed: val });
  sendToContent("setSpeed", { speed: parseFloat(val) });
});

voiceSelect.addEventListener("change", () => {
  const voiceURI = voiceSelect.value;
  chrome.storage.local.set({ voiceURI });
  sendToContent("setVoice", { voiceURI });
  updateVoiceHint();
});

btnPlay.addEventListener("click", async () => {
  statusEl.textContent = "Extraction du texte…";
  const tab = await getCurrentTab();
  if (!tab) {
    statusEl.textContent = "Impossible d'accéder à l'onglet.";
    return;
  }
  currentTabId = tab.id;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch (e) {
    // Script may already be injected
  }

  const speed = parseFloat(speedSlider.value);
  const playMsg = { speed };

  if (useVoiceBox) {
    playMsg.voicebox = true;
    playMsg.profileId = vbProfileSelect.value;
  } else {
    playMsg.voiceURI = voiceSelect.value || undefined;
    playMsg.voicebox = false;
  }

  sendToContent("play", playMsg);
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
  chrome.tabs.sendMessage(currentTabId, { action, ...data }).catch(() => {});
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function updateVoiceHint() {
  const selected = voiceSelect.selectedOptions[0];
  if (!selected || !selected.dataset.local) {
    voiceHint.textContent = "";
    return;
  }
  const isLocal = selected.dataset.local === "true";
  voiceHint.textContent = isLocal ? "Voix locale" : "Voix réseau (peut nécessiter une connexion)";
  voiceHint.className = isLocal ? "voice-hint local" : "voice-hint remote";
}

function populateVoices(voices, selectedURI) {
  voiceSelect.innerHTML = "";
  if (!voices.length) {
    voiceSelect.innerHTML = '<option value="">Aucune voix disponible</option>';
    return;
  }

  // Load saved preference
  chrome.storage.local.get("voiceURI", (data) => {
    const savedURI = data.voiceURI;
    const preferredURI = savedURI || selectedURI;

    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.voiceURI;
      // Build descriptive label
      let label = v.name;
      if (v.local) label += " [local]";
      if (v.name.toLowerCase().includes("natural")) label += " *";
      opt.textContent = label;
      opt.dataset.local = v.local;
      if (v.voiceURI === preferredURI) opt.selected = true;
      voiceSelect.appendChild(opt);
    });

    updateVoiceHint();
  });
}

function updateUI(state, lang, chunkInfo, extra = {}) {
  let progress = chunkInfo ? ` (${chunkInfo.current}/${chunkInfo.total})` : "";
  switch (state) {
    case "playing":
      btnPlay.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
      btnPause.querySelector("span").textContent = "Pause";
      if (extra.loading) {
        statusEl.textContent = "Génération audio…" + progress;
      } else {
        statusEl.textContent = "Lecture en cours…" + progress;
      }
      break;
    case "paused":
      btnPlay.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
      btnPause.querySelector("span").textContent = "Reprendre";
      statusEl.textContent = "En pause" + progress;
      break;
    case "stopped":
      btnPlay.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      btnPause.querySelector("span").textContent = "Pause";
      statusEl.textContent = extra.error || "";
      break;
    case "error":
      btnPlay.disabled = false;
      btnPause.disabled = true;
      btnStop.disabled = true;
      statusEl.textContent = extra.error || "Erreur de lecture.";
      break;
  }
  if (lang) {
    detectedLangEl.textContent = lang === "fr" ? "Français" : "English";
  }
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "tts-state") {
    updateUI(msg.state, msg.lang, msg.chunkInfo, msg);
  }
  if (msg.type === "tts-voices") {
    populateVoices(msg.voices, msg.selectedVoiceURI);
  }
});

// On popup open, query current state and voices
(async () => {
  const tab = await getCurrentTab();
  if (tab) {
    currentTabId = tab.id;
    chrome.tabs.sendMessage(tab.id, { action: "getState" }).catch(() => {
      // Content script not yet injected
    });
  }
})();
