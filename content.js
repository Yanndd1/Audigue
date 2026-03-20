(() => {
  // Prevent multiple injections
  if (window.__audigue_injected) return;
  window.__audigue_injected = true;

  let currentUtterances = [];
  let currentIndex = 0;
  let state = "stopped"; // stopped | playing | paused
  let detectedLang = "en";
  let currentSpeed = 1.0;

  /**
   * Extract readable text from the page, split into chunks.
   * Skips scripts, styles, nav, footer, and hidden elements.
   */
  function extractText() {
    const skipTags = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IMG", "VIDEO", "AUDIO",
      "IFRAME", "CANVAS", "NAV", "FOOTER", "HEADER",
    ]);
    const skipRoles = new Set(["navigation", "banner", "contentinfo"]);

    // Try to find main content area first
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
        // Skip hidden elements
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
      // Split into ~500 char chunks at sentence boundaries
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
   * Detect language of text. Uses the <html lang> attribute first,
   * then falls back to simple heuristic.
   */
  function detectLanguage(text) {
    // Check html lang attribute
    const htmlLang = document.documentElement.lang?.toLowerCase() || "";
    if (htmlLang.startsWith("fr")) return "fr";
    if (htmlLang.startsWith("en")) return "en";

    // Check meta content-language
    const meta = document.querySelector('meta[http-equiv="content-language"]');
    if (meta) {
      const lang = meta.content?.toLowerCase() || "";
      if (lang.startsWith("fr")) return "fr";
      if (lang.startsWith("en")) return "en";
    }

    // Heuristic: count common French words
    const frenchWords = /\b(le|la|les|de|des|du|un|une|et|est|en|que|qui|dans|pour|pas|sur|ce|avec|sont|cette|aux|ses|par|nous|vous|ils|mais|ont|être|fait|tout|comme|aussi|leur|bien|même|après|autre|avant|entre|notre|sans|sous|très|chez|donc|elle|tous|peut|plus)\b/gi;
    const frCount = (text.match(frenchWords) || []).length;
    const wordCount = text.split(/\s+/).length;
    const frRatio = frCount / wordCount;

    return frRatio > 0.08 ? "fr" : "en";
  }

  /**
   * Find the best voice for a given language.
   */
  function findVoice(lang) {
    const voices = speechSynthesis.getVoices();
    const langPrefix = lang === "fr" ? "fr" : "en";

    // Prefer natural/high-quality voices
    const natural = voices.find(
      (v) => v.lang.startsWith(langPrefix) && v.name.toLowerCase().includes("natural")
    );
    if (natural) return natural;

    // Then prefer local voices
    const local = voices.find(
      (v) => v.lang.startsWith(langPrefix) && v.localService
    );
    if (local) return local;

    // Any voice matching the language
    return voices.find((v) => v.lang.startsWith(langPrefix)) || null;
  }

  function notifyState() {
    chrome.runtime.sendMessage({ type: "tts-state", state, lang: detectedLang });
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

    const voice = findVoice(detectedLang);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
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

  function play(speed) {
    speechSynthesis.cancel();
    currentSpeed = speed || currentSpeed;
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

    // Ensure voices are loaded
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      speechSynthesis.addEventListener("voiceschanged", () => {
        speakChunk(0);
      }, { once: true });
    } else {
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
    speechSynthesis.cancel();
    state = "stopped";
    currentUtterances = [];
    currentIndex = 0;
    notifyState();
  }

  function setSpeed(speed) {
    currentSpeed = speed;
    // If currently speaking, restart current chunk with new speed
    if (state === "playing") {
      speechSynthesis.cancel();
      speakChunk(currentIndex);
    }
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case "play":
        play(msg.speed);
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
      case "getState":
        notifyState();
        break;
    }
    sendResponse({ ok: true });
  });
})();
