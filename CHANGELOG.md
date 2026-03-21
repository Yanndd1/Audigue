# Changelog

All notable changes to Audigue will be documented in this file.

## [1.1.0] - 2026-03-21

### Added
- Voice selector: choose among all system voices (male, female, natural)
- Voice preference saved across sessions
- Real-time voice switching during playback
- Local/network voice indicator
- Reading progress display (e.g. 3/12)
- Chrome keepalive workaround for long articles (pause/resume every 10s)
- Article title is read first before body content
- Contributing guide in README
- Privacy and security section in README

### Fixed
- Speed control now works during playback (generation counter replaces fragile boolean flag)
- Extension reads full articles instead of stopping after first chunk
- Text extraction no longer picks up UI elements (buttons, keyboard shortcuts, menus)
- Ad/junk filtering uses tight selectors that don't accidentally match article content
- "Receiving end does not exist" errors silenced with proper `.catch()`

### Changed
- Text extraction rewritten: queries semantic elements (p, h1-h6, blockquote) instead of walking all text nodes
- Article root detection validates candidates have >= 2 paragraphs
- Input validation on speed (clamped to 0.5–3, must be finite) and voice URI (must be string)
- Removed unused background service worker (smaller attack surface)
- Version bumped to 1.1.0

## [1.0.0] - 2025-03-20

### Added
- Initial release
- Text-to-speech reading of web pages using local Web Speech API
- Automatic language detection (French / English)
- Playback speed control (0.5x to 3x)
- Play, Pause, and Stop controls
- Smart text extraction targeting main content areas
- Dark themed popup interface
- Speed preference persistence via Chrome storage
