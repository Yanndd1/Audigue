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

  // VoiceBox state
  let useVoiceBox = false;
  let vbProfileId = null;
  let vbAudio = null; // current Audio element for VoiceBox playback
  let vbAbortController = null; // to cancel in-flight fetches

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
   * Split a long text into ~800 char chunks at sentence boundaries.
   */
  function chunkText(text) {
    const chunks = [];
    let current = "";
    const sentences = text.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      if (!sentence.trim()) continue;
      current += (current ? " " : "") + sentence;
      if (current.length > 800) {
        chunks.push(current.trim());
        current = "";
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  /**
   * Detect if current page is a known document editor and extract text.
   * Returns null if not a recognized editor.
   */
  function extractFromEditor() {
    const url = location.href;

    // --- Google Docs ---
    if (url.includes("docs.google.com/document/")) {
      return extractFromGoogleDocs();
    }

    // --- Notion ---
    if (url.includes("notion.so/") || url.includes("notion.site/")) {
      return extractFromNotion();
    }

    // --- Generic contenteditable / rich text editor fallback ---
    const editables = document.querySelectorAll(
      '[contenteditable="true"][role="textbox"], [contenteditable="true"].ProseMirror, [contenteditable="true"].ql-editor'
    );
    if (editables.length) {
      const texts = [];
      for (const el of editables) {
        const t = el.innerText.trim();
        if (t.length > 50) texts.push(t);
      }
      if (texts.length) return chunkText(texts.join("\n\n"));
    }

    return null;
  }

  /**
   * Extract text from Google Docs.
   * Handles both the older HTML-based renderer (.kix-paragraphrenderer)
   * and the newer canvas-based renderer (falls back to innerText).
   */
  function extractFromGoogleDocs() {
    const paragraphs = [];

    // Try .kix-paragraphrenderer elements (HTML renderer)
    const kixParagraphs = document.querySelectorAll(".kix-paragraphrenderer");
    if (kixParagraphs.length > 0) {
      for (const p of kixParagraphs) {
        const text = p.textContent.trim();
        if (text) paragraphs.push(text);
      }
    }

    // If kix didn't yield much, try the editor's innerText (canvas renderer)
    if (paragraphs.join("").length < 100) {
      const editor = document.querySelector(".kix-appview-editor")
        || document.querySelector('[role="textbox"]')
        || document.querySelector(".docs-editor-container");
      if (editor) {
        const text = editor.innerText.trim();
        if (text.length > 50) return chunkText(text);
      }
    }

    if (!paragraphs.length) return null;
    return chunkText(paragraphs.join("\n"));
  }

  /**
   * Extract text from Notion pages.
   */
  function extractFromNotion() {
    const blocks = document.querySelectorAll(
      '.notion-page-content [data-block-id], .notion-page-content [placeholder]'
    );
    const paragraphs = [];
    for (const b of blocks) {
      const text = b.innerText.trim();
      if (text.length > 10) paragraphs.push(text);
    }

    // Fallback: get all text from the page content area
    if (!paragraphs.length) {
      const content = document.querySelector('.notion-page-content')
        || document.querySelector('.layout-content');
      if (content) {
        const text = content.innerText.trim();
        if (text.length > 50) return chunkText(text);
      }
    }

    if (!paragraphs.length) return null;
    return chunkText(paragraphs.join("\n"));
  }

  /**
   * Extract readable article text.
   * Strategy: first try editor-specific extraction (Google Docs, Notion, etc.),
   * then fall back to article/semantic extraction for regular web pages.
   */
  function extractText() {
    // Try document editor extraction first
    const editorChunks = extractFromEditor();
    if (editorChunks && editorChunks.length > 0) return editorChunks;

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

  // --- VoiceBox TTS engine ---

  function vbStopAudio() {
    if (vbAbortController) {
      vbAbortController.abort();
      vbAbortController = null;
    }
    if (vbAudio) {
      vbAudio.pause();
      if (vbAudio.src) URL.revokeObjectURL(vbAudio.src);
      vbAudio = null;
    }
  }

  async function vbSpeakChunk(index, gen) {
    if (gen !== generation) return;
    if (index >= currentUtterances.length) {
      state = "stopped";
      notifyState();
      return;
    }
    currentIndex = index;
    notifyState({ loading: true });

    vbAbortController = new AbortController();
    try {
      const resp = await fetch("http://localhost:17493/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: vbProfileId,
          text: currentUtterances[index],
          language: detectedLang,
        }),
        signal: vbAbortController.signal,
      });

      if (gen !== generation) return;
      if (!resp.ok) throw new Error(`VoiceBox HTTP ${resp.status}`);

      const blob = await resp.blob();
      if (gen !== generation) return;

      const url = URL.createObjectURL(blob);
      vbAudio = new Audio(url);
      vbAudio.playbackRate = currentSpeed;

      vbAudio.onended = () => {
        URL.revokeObjectURL(url);
        vbAudio = null;
        if (gen !== generation) return;
        if (state === "playing") {
          vbSpeakChunk(index + 1, gen);
        }
      };

      vbAudio.onerror = () => {
        URL.revokeObjectURL(url);
        console.error("Audigue VoiceBox audio playback error");
        state = "stopped";
        notifyState();
      };

      notifyState({ loading: false });
      vbAudio.play();
    } catch (e) {
      if (e.name === "AbortError") return;
      console.error("Audigue VoiceBox error:", e);
      state = "stopped";
      notifyState({ error: "VoiceBox indisponible" });
    }
  }

  /**
   * Sanitize speed value to a safe finite number within allowed range.
   */
  function sanitizeSpeed(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return currentSpeed;
    return Math.max(0.5, Math.min(3, n));
  }

  function play(speed, voiceURI, voicebox, profileId) {
    generation++;
    speechSynthesis.cancel();
    vbStopAudio();
    currentSpeed = sanitizeSpeed(speed);
    if (typeof voiceURI === "string" && voiceURI) selectedVoiceURI = voiceURI;
    if (voicebox !== undefined) useVoiceBox = !!voicebox;
    if (profileId) vbProfileId = profileId;

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

    if (useVoiceBox && vbProfileId) {
      vbSpeakChunk(0, gen);
    } else {
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
  }

  function pause() {
    if (state === "playing") {
      if (useVoiceBox && vbAudio) {
        vbAudio.pause();
      } else {
        speechSynthesis.pause();
      }
      state = "paused";
      stopKeepAlive();
      notifyState();
    } else if (state === "paused") {
      if (useVoiceBox && vbAudio) {
        vbAudio.play();
      } else {
        speechSynthesis.resume();
      }
      state = "playing";
      if (!useVoiceBox) startKeepAlive();
      notifyState();
    }
  }

  function stop() {
    generation++;
    speechSynthesis.cancel();
    vbStopAudio();
    state = "stopped";
    currentUtterances = [];
    currentIndex = 0;
    stopKeepAlive();
    notifyState();
  }

  function setSpeed(speed) {
    currentSpeed = sanitizeSpeed(speed);
    if (useVoiceBox && vbAudio) {
      vbAudio.playbackRate = currentSpeed;
    } else if (state === "playing") {
      generation++;
      speechSynthesis.cancel();
      const gen = generation;
      speakChunk(currentIndex, gen);
    }
  }

  function setVoice(voiceURI) {
    if (typeof voiceURI !== "string") return;
    selectedVoiceURI = voiceURI;
    if (state === "playing" && !useVoiceBox) {
      generation++;
      speechSynthesis.cancel();
      const gen = generation;
      speakChunk(currentIndex, gen);
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {
      case "play":
        play(msg.speed, msg.voiceURI, msg.voicebox, msg.profileId);
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
