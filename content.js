(() => {
  // Prevent multiple injections
  if (window.__audigue_injected) return;
  window.__audigue_injected = true;

  let currentUtterances = [];
  let currentIndex = 0;
  let state = "stopped"; // stopped | playing | paused
  let detectedLang = "en";
  let currentSpeed = 1.0;
  let selectedVoiceURI = null;
  let cancelledByUser = false; // guards against cancel() triggering onend

  /**
   * Extract readable text from the page, split into chunks.
   */
  function extractText() {
    const skipTags = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IMG", "VIDEO", "AUDIO",
      "IFRAME", "CANVAS", "NAV", "FOOTER", "HEADER",
    ]);
    const skipRoles = new Set(["navigation", "banner", "contentinfo"]);

    const main = document.querySelector("main, article, [role='main']");
    const root = main || document.body;

    const chunks = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;
        if (skipRoles.has(el.getAttribute("role"))) return NodeFilter.FILTER_REJECT;
        if (el.closest("nav, footer, header, [role='navigation'], [role='banner'], [role='contentinfo']")) {
          return NodeFilter.FILTER_REJECT;
        }
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }
        const text = node.textContent.trim();
        if (!text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let current = "";
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      current += " " + text;
      if (current.length > 500) {
        const sentenceEnd = current.search(/[.!?]\s/);
        if (sentenceEnd > 100) {
          chunks.push(current.substring(0, sentenceEnd + 1).trim());
          current = current.substring(sentenceEnd + 1);
        } else {
          chunks.push(current.trim());
          current = "";
        }
      }
    }
    if (current.trim()) {
      chunks.push(current.trim());
    }
    return chunks;
  }

  /**
   * Detect language of text.
   */
  function detectLanguage(text) {
    const htmlLang = document.documentElement.lang?.toLowerCase() || "";
    if (htmlLang.startsWith("fr")) return "fr";
    if (htmlLang.startsWith("en")) return "en";

    const meta = document.querySelector('meta[http-equiv="content-language"]');
    if (meta) {
      const lang = meta.content?.toLowerCase() || "";
      if (lang.startsWith("fr")) return "fr";
      if (lang.startsWith("en")) return "en";
    }

    const frenchWords = /\b(le|la|les|de|des|du|un|une|et|est|en|que|qui|dans|pour|pas|sur|ce|avec|sont|cette|aux|ses|par|nous|vous|ils|mais|ont|être|fait|tout|comme|aussi|leur|bien|même|après|autre|avant|entre|notre|sans|sous|très|chez|donc|elle|tous|peut|plus)\b/gi;
    const frCount = (text.match(frenchWords) || []).length;
    const wordCount = text.split(/\s+/).length;
    return (frCount / wordCount) > 0.08 ? "fr" : "en";
  }

  /**
   * Get all available voices for a language, sorted by quality.
   */
  function getVoicesForLang(lang) {
    const voices = speechSynthesis.getVoices();
    const langPrefix = lang === "fr" ? "fr" : "en";
    return voices
      .filter((v) => v.lang.startsWith(langPrefix))
      .sort((a, b) => {
        // Natural voices first
        const aNatural = a.name.toLowerCase().includes("natural") ? 0 : 1;
        const bNatural = b.name.toLowerCase().includes("natural") ? 0 : 1;
        if (aNatural !== bNatural) return aNatural - bNatural;
        // Then local voices
        if (a.localService !== b.localService) return a.localService ? -1 : 1;
        // Then alphabetical
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Find the voice to use: selected by user, or best default.
   */
  function getActiveVoice() {
    const voices = speechSynthesis.getVoices();
    if (selectedVoiceURI) {
      const match = voices.find((v) => v.voiceURI === selectedVoiceURI);
      if (match) return match;
    }
    // Fallback to best available
    const langVoices = getVoicesForLang(detectedLang);
    return langVoices[0] || null;
  }

  function notifyState(extra = {}) {
    chrome.runtime.sendMessage({
      type: "tts-state",
      state,
      lang: detectedLang,
      ...extra,
    });
  }

  function sendVoiceList() {
    const voices = getVoicesForLang(detectedLang);
    const voiceList = voices.map((v) => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      local: v.localService,
    }));
    const active = getActiveVoice();
    chrome.runtime.sendMessage({
      type: "tts-voices",
      voices: voiceList,
      selectedVoiceURI: active ? active.voiceURI : null,
    });
  }

  function speakChunk(index) {
    if (index >= currentUtterances.length) {
      state = "stopped";
      notifyState();
      return;
    }
    currentIndex = index;
    const utterance = new SpeechSynthesisUtterance(currentUtterances[index]);
    utterance.lang = detectedLang === "fr" ? "fr-FR" : "en-US";
    utterance.rate = currentSpeed;

    const voice = getActiveVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      // Only chain to next chunk if this wasn't a user-initiated cancel
      if (cancelledByUser) {
        cancelledByUser = false;
        return;
      }
      if (state === "playing") {
        speakChunk(index + 1);
      }
    };

    utterance.onerror = (e) => {
      if (e.error === "canceled" || e.error === "interrupted") return;
      console.error("Audigue TTS error:", e.error);
      state = "stopped";
      notifyState();
    };

    speechSynthesis.speak(utterance);
  }

  function play(speed, voiceURI) {
    cancelledByUser = true;
    speechSynthesis.cancel();
    currentSpeed = speed || currentSpeed;
    if (voiceURI !== undefined) selectedVoiceURI = voiceURI;

    const chunks = extractText();
    if (!chunks.length) {
      state = "error";
      notifyState();
      return;
    }

    const fullText = chunks.join(" ");
    detectedLang = detectLanguage(fullText);
    currentUtterances = chunks;
    currentIndex = 0;
    state = "playing";
    notifyState();

    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      speechSynthesis.addEventListener("voiceschanged", () => {
        sendVoiceList();
        speakChunk(0);
      }, { once: true });
    } else {
      sendVoiceList();
      speakChunk(0);
    }
  }

  function pause() {
    if (state === "playing") {
      speechSynthesis.pause();
      state = "paused";
      notifyState();
    } else if (state === "paused") {
      speechSynthesis.resume();
      state = "playing";
      notifyState();
    }
  }

  function stop() {
    cancelledByUser = true;
    speechSynthesis.cancel();
    state = "stopped";
    currentUtterances = [];
    currentIndex = 0;
    notifyState();
  }

  function setSpeed(speed) {
    currentSpeed = speed;
    if (state === "playing") {
      // Cancel current utterance and restart chunk with new speed
      cancelledByUser = true;
      speechSynthesis.cancel();
      speakChunk(currentIndex);
    }
  }

  function setVoice(voiceURI) {
    selectedVoiceURI = voiceURI;
    if (state === "playing") {
      cancelledByUser = true;
      speechSynthesis.cancel();
      speakChunk(currentIndex);
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case "play":
        play(msg.speed, msg.voiceURI);
        break;
      case "pause":
        pause();
        break;
      case "stop":
        stop();
        break;
      case "setSpeed":
        setSpeed(msg.speed);
        break;
      case "setVoice":
        setVoice(msg.voiceURI);
        break;
      case "getState":
        notifyState();
        sendVoiceList();
        break;
      case "getVoices":
        sendVoiceList();
        break;
    }
    sendResponse({ ok: true });
  });
})();
