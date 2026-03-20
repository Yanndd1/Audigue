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
  let cancelledByUser = false;
  let keepAliveTimer = null;

  // ---- Ad / junk selectors to skip ----
  const AD_SELECTORS = [
    "[class*='ad-']", "[class*='ad_']", "[class*='ads-']", "[class*='ads_']",
    "[class*='advert']", "[class*='sponsor']", "[class*='promo']",
    "[class*='outbrain']", "[class*='taboola']", "[class*='related']",
    "[class*='recommended']", "[class*='sidebar']", "[class*='widget']",
    "[class*='newsletter']", "[class*='share']", "[class*='social']",
    "[class*='comment']", "[class*='cookie']", "[class*='popup']",
    "[class*='modal']", "[class*='banner']",
    "[id*='ad-']", "[id*='ad_']", "[id*='ads-']", "[id*='ads_']",
    "[id*='advert']", "[id*='sponsor']", "[id*='sidebar']",
    "[id*='related']", "[id*='recommended']", "[id*='comment']",
    "[id*='newsletter']", "[id*='cookie']",
    "[data-ad]", "[data-ads]", "[data-ad-slot]", "[data-testid*='ad']",
    "aside", "ins.adsbygoogle", ".ad", ".ads", "#ad", "#ads",
    "[role='complementary']", "[role='banner']", "[aria-label*='publicité']",
    "[aria-label*='advertisement']", "[aria-label*='sponsored']",
  ];

  /**
   * Check if an element is inside an ad or junk container.
   */
  function isAdOrJunk(el) {
    const combined = AD_SELECTORS.join(", ");
    return !!el.closest(combined);
  }

  /**
   * Extract the page/article title.
   */
  function extractTitle() {
    // Try article-specific headings first
    const articleH1 = document.querySelector(
      "article h1, main h1, [role='main'] h1, .article-title, .post-title, .entry-title"
    );
    if (articleH1) return articleH1.textContent.trim();

    // Try the first h1 on the page
    const h1 = document.querySelector("h1");
    if (h1) return h1.textContent.trim();

    // Try og:title meta
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content.trim();

    // Fallback to document title
    return document.title.trim();
  }

  /**
   * Extract readable article text from the page, split into chunks.
   * Reads title first, then body. Skips ads, sidebars, related content.
   */
  function extractText() {
    const skipTags = new Set([
      "SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IMG", "VIDEO", "AUDIO",
      "IFRAME", "CANVAS", "NAV", "FOOTER", "HEADER", "BUTTON", "INPUT",
      "SELECT", "TEXTAREA", "FORM",
    ]);
    const skipRoles = new Set(["navigation", "banner", "contentinfo", "complementary", "search"]);

    // Find main content area
    const main = document.querySelector(
      "article, [role='article'], main, [role='main'], .article-body, .post-content, .entry-content, .story-body, .article-content"
    );
    const root = main || document.body;

    const chunks = [];

    // Start with the title
    const title = extractTitle();
    if (title) {
      chunks.push(title);
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (skipTags.has(el.tagName)) return NodeFilter.FILTER_REJECT;

        const role = el.getAttribute("role");
        if (role && skipRoles.has(role)) return NodeFilter.FILTER_REJECT;

        // Skip nav, footer, header, etc.
        if (el.closest("nav, footer, header, [role='navigation'], [role='banner'], [role='contentinfo']")) {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip ads and junk
        if (isAdOrJunk(el)) return NodeFilter.FILTER_REJECT;

        // Skip hidden elements
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") {
          return NodeFilter.FILTER_REJECT;
        }

        // Skip tiny text likely to be labels/buttons
        if (style.fontSize && parseFloat(style.fontSize) < 8) {
          return NodeFilter.FILTER_REJECT;
        }

        const text = node.textContent.trim();
        if (!text) return NodeFilter.FILTER_REJECT;

        // Skip text that looks like link lists (very short with many siblings that are links)
        const parent = el.parentElement;
        if (parent) {
          const links = parent.querySelectorAll("a");
          const allText = parent.textContent.trim();
          // If parent is mostly links and short items, skip
          if (links.length > 3 && allText.length < links.length * 80) {
            return NodeFilter.FILTER_REJECT;
          }
        }

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
        const aNatural = a.name.toLowerCase().includes("natural") ? 0 : 1;
        const bNatural = b.name.toLowerCase().includes("natural") ? 0 : 1;
        if (aNatural !== bNatural) return aNatural - bNatural;
        if (a.localService !== b.localService) return a.localService ? -1 : 1;
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
    const langVoices = getVoicesForLang(detectedLang);
    return langVoices[0] || null;
  }

  function notifyState(extra = {}) {
    chrome.runtime.sendMessage({
      type: "tts-state",
      state,
      lang: detectedLang,
      chunkInfo: {
        current: currentIndex + 1,
        total: currentUtterances.length,
      },
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

  /**
   * Chrome bug workaround: Chrome stops speech synthesis after ~15 seconds.
   * Periodically pause/resume to keep it alive.
   */
  function startKeepAlive() {
    stopKeepAlive();
    keepAliveTimer = setInterval(() => {
      if (state === "playing" && speechSynthesis.speaking && !speechSynthesis.paused) {
        speechSynthesis.pause();
        speechSynthesis.resume();
      }
    }, 10000);
  }

  function stopKeepAlive() {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  function speakChunk(index) {
    if (index >= currentUtterances.length) {
      state = "stopped";
      stopKeepAlive();
      notifyState();
      return;
    }
    currentIndex = index;
    notifyState();

    const utterance = new SpeechSynthesisUtterance(currentUtterances[index]);
    utterance.lang = detectedLang === "fr" ? "fr-FR" : "en-US";
    utterance.rate = currentSpeed;

    const voice = getActiveVoice();
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
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
      stopKeepAlive();
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
        // Reset flag right before starting playback
        cancelledByUser = false;
        startKeepAlive();
        speakChunk(0);
      }, { once: true });
    } else {
      sendVoiceList();
      // Reset flag right before starting playback
      cancelledByUser = false;
      startKeepAlive();
      speakChunk(0);
    }
  }

  function pause() {
    if (state === "playing") {
      speechSynthesis.pause();
      state = "paused";
      stopKeepAlive();
      notifyState();
    } else if (state === "paused") {
      speechSynthesis.resume();
      state = "playing";
      startKeepAlive();
      notifyState();
    }
  }

  function stop() {
    cancelledByUser = true;
    speechSynthesis.cancel();
    state = "stopped";
    currentUtterances = [];
    currentIndex = 0;
    stopKeepAlive();
    notifyState();
  }

  function setSpeed(speed) {
    currentSpeed = speed;
    if (state === "playing") {
      cancelledByUser = true;
      speechSynthesis.cancel();
      cancelledByUser = false;
      speakChunk(currentIndex);
    }
  }

  function setVoice(voiceURI) {
    selectedVoiceURI = voiceURI;
    if (state === "playing") {
      cancelledByUser = true;
      speechSynthesis.cancel();
      cancelledByUser = false;
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
