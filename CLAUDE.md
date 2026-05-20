# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Chrome Extension (Manifest V3) — "Onsite Apply Assistant" (网申助手). Auto-fills online job application forms by syncing resume data from a personal homepage, with manual edit, search, import/export, and smart field matching.

## Tech stack

- Vanilla JS (no framework, no build tools, no package.json)
- `chrome.storage.local` for persistence
- Injected via content script on `<all_urls>`

## Architecture

```
background.js     → Service worker: handles toolbar click + Alt+Q shortcut,
                    injects content.js + styles.css into tabs that don't have it yet
content.js        → Main app (~900 lines): `FormFillAssistant` class injected into every page.
                    Builds sidebar UI, parses remote HTML profile, manages data CRUD,
                    tracks focused inputs, fuzzy-matches field labels to fill buttons
profile.js        → Static fallback data file (hardcoded personal info, loaded via <script> tag)
styles.css        → All sidebar/UI styles with `!important` to avoid host-page conflicts
manifest.json     → Permissions: storage, activeTab, scripting; host_permissions: <all_urls>
```

## Key design decisions

- **No build step** — Everything is raw JS/CSS loaded directly by the browser. Edit files, reload extension.
- **Content script injection** — The extension injects `content.js` and `styles.css` into every page. `background.js` handles the case where the tab hasn't loaded the content script yet by calling `chrome.scripting.executeScript`.
- **Singleton guard** — `window.__oaa__` prevents double-initialization on pages where the content script runs twice.
- **Native value setter** — Uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` to trigger React/Vue change detection when filling inputs.
- **Field matching** — Two-tier: exact match (normalized label === buttonText or alias) triggers auto-fill on focus; fuzzy match (character overlap ≥ 50%) shows a suggestion popup. Aliases are user-defined per entry (e.g., `名字,全名` for the name field).
- **Data flow** — Remote HTML → `parseProfile()` extracts structured data → stored to `chrome.storage.local` under `oaa_data` key → rendered as grouped buttons → click fills focused input.
- **Cache TTL** — 1 hour (conceptual, checked via `fetchedAt` timestamp). Manual refresh overrides it. Modified data prompts a double-click confirmation before overwrite.
- **Editing** — Toggle edit mode in sidebar: rename groups (contentEditable title), inline edit entries, add/delete entries and groups. All changes persist to storage immediately with `modified: true` flag.
- **SPA support** — `MutationObserver` watches for dynamically inserted form fields and auto-fills them.

## Loading the extension

1. Open `chrome://extensions/`, enable **Developer mode**
2. Click **Load unpacked** and select this folder
3. No build step needed