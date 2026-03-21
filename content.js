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
  let generation = 0;
  let keepAliveTimer = null;

  /**
   * Check if an element is clearly an ad or non-article junk.
   * Uses tight selectors that won't match legitimate article content.
   */
  function isAdElement(el) {
    // Walk up from the element to check ancestors (but not beyond the article root)
    let node = el;
    while (node && node !== document.body) {
      const tag = node.tagName;
      // Skip nav, footer, aside, header tags
      if (tag === "NAV" || tag === "FOOTER" || tag === "ASIDE") return true;

      const cls = (node.className || "").toString().toLowerCase();
      const id = (node.id || "").toLowerCase();

      // Ad networks
      if (cls.includes("adsbygoogle") || cls.includes("outbrain") || cls.includes("taboola")) return true;
      if (tag === "INS" && cls.includes("ads")) return true;

      // Exact class/id patterns for ads (word-boundary-ish checks)
      if (/\bad\b|\bads\b|\badvert/.test(cls) || /\bad\b|\bads\b|\badvert/.test(id)) return true;
      if (/\bsponsor/.test(cls) || /\bsponsor/.test(id)) return true;

      // Sidebar, newsletter, comments — only if they're container divs, not inline elements
      if (node !== el && (tag === "DIV" || tag === "SECTION")) {
        if (/\bsidebar\b|\bnewsletter\b|\bcomment/.test(cls)) return true;
        if (/\bsidebar\b|\bnewsletter\b|\bcomment/.test(id)) return true;
        if (/\brecirc\b|\btrending\b|\bmore-stories\b|\bread-more\b/.test(cls)) return true;
      }

      // ARIA roles
      const role = node.getAttribute("role");
      if (role === "complementary" || role === "navigation" || role === "search") return true;

      node = node.parentElement;
    }
    return false;
  }

  /**
   * Check if element is visible.
   */
  function isVisible(el) {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  /**
   * Extract the page/article title.
   */
  function extractTitle() {
    const articleH1 = document.querySelector(
      "article h1, main h1, [role='main'] h1, .article-title, .post-title, .entry-title"
    );
    if (articleH1) return articleH1.textContent.trim();

    const h1 = document.querySelector("h1");
    if (h1) return h1.textContent.trim();

    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) return ogTitle.content.trim();

    return document.title.trim();
  }

  /**
   * Find the best article root element.
   */
  function findArticleRoot() {
    // Try specific article selectors
    const selectors = [
      "article .body__inner-container",
      "article .article-body",
      "article .article__body",
      "article .post-content",
      "article .entry-content",
      ".article-body",
      ".article__body",
      ".post-content",
      ".entry-content",
      ".story-body",
      ".article-content",
      ".body__inner-container",
      "article",
      "[role='article']",
      "main",
      "[role='main']",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        // Verify it has some paragraph content
        const pCount = el.querySelectorAll("p").length;
        if (pCount >= 2) return el;
      }
    }
    return document.body;
  }

  /**
   * Extract readable article text.
   * Strategy: find the article root, collect all <p> and heading elements,
   * filter out only clearly-ad elements with tight checks.
   */
  function extractText() {
    const root = findArticleRoot();

    // Collect semantic content elements
    const contentElements = root.querySelectorAll(
      "p, h2, h3, h4, h5, h6, blockquote, figcaption"
    );

    const chunks = [];
    const title = extractTitle();
    if (title) {
      chunks.push(title);
    }

    let current = "";
    const seenTexts = new Set();
    if (title) seenTexts.add(title);

    for (const el of contentElements) {
      if (!isVisible(el)) continue;
      if (isAdElement(el)) continue;

      const text = el.textContent.trim();
      if (!text) continue;

      // Deduplicate (title, repeated elements)
      if (seenTexts.has(text)) continue;
      seenTexts.add(text);

      const isHeading = /^H[1-6]$/.test(el.tagName);

      // Skip very short non-heading text (likely UI cruft)
      if (!isHeading && text.length < 20) continue;

      // Skip text that's mostly non-alphabetic
      const alphaCount = (text.match(/[a-zA-ZÀ-ÿ]/g) || []).length;
      if (alphaCount / text.length < 0.5) continue;

      // Headings become their own chunk
      if (isHeading) {
        if (current.trim()) {
          chunks.push(current.trim());
          current = "";
        }
        chunks.push(text);
        continue;
      }

      current += " " + text;

      // Split into ~800 char chunks at sentence boundaries
      if (current.length > 800) {
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
    }).catch(() => {}); // popup may be closed
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
    }).catch(() => {}); // popup may be closed
  }

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

  function speakChunk(index, gen) {
    if (gen !== generation) return;
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
      if (gen !== generation) return;
      if (state === "playing") {
        speakChunk(index + 1, gen);
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

  /**
   * Sanitize speed value to a safe finite number within allowed range.
   */
  function sanitizeSpeed(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return currentSpeed;
    return Math.max(0.5, Math.min(3, n));
  }

  function play(speed, voiceURI) {
    generation++;
    speechSynthesis.cancel();
    currentSpeed = sanitizeSpeed(speed);
    if (typeof voiceURI === "string" && voiceURI) selectedVoiceURI = voiceURI;

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

    const gen = generation;
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      speechSynthesis.addEventListener("voiceschanged", () => {
        sendVoiceList();
        startKeepAlive();
        speakChunk(0, gen);
      }, { once: true });
    } else {
      sendVoiceList();
      startKeepAlive();
      speakChunk(0, gen);
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
    generation++;
    speechSynthesis.cancel();
    state = "stopped";
    currentUtterances = [];
    currentIndex = 0;
    stopKeepAlive();
    notifyState();
  }

  function setSpeed(speed) {
    currentSpeed = sanitizeSpeed(speed);
    if (state === "playing") {
      generation++;
      speechSynthesis.cancel();
      const gen = generation;
      speakChunk(currentIndex, gen);
    }
  }

  function setVoice(voiceURI) {
    if (typeof voiceURI !== "string") return;
    selectedVoiceURI = voiceURI;
    if (state === "playing") {
      generation++;
      speechSynthesis.cancel();
      const gen = generation;
      speakChunk(currentIndex, gen);
    }
  }

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
