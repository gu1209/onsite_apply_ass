# Onsite Apply Assistant · 网申助手

A Chrome extension that auto-syncs resume data from your personal page and fills online job application forms with one click.

## Features

- **Auto sync** — Fetches structured data from any personal homepage at runtime; caches locally for 1 hour
- **One-click fill** — Left-click a button to fill the focused input; right-click to copy to clipboard
- **Manual edit** — Add / edit / delete entries and groups directly in the sidebar; all changes persist
- **Search** — Filter buttons in real time by name or content
- **Import / Export** — Backup data as JSON; restore or migrate across devices
- **Keyboard shortcut** — `Alt+Q` to toggle the sidebar (customisable in `chrome://extensions/shortcuts`)
- **React / Vue compatible** — Uses native value setter to trigger framework reactivity

## Installation

1. Download or clone this repository
2. Open `chrome://extensions/` and enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Click the extension icon (or press `Alt+Q`) to open the sidebar

## First-time setup

On first launch, choose one of two modes:

| Mode | Description |
|------|-------------|
| **Auto fetch** | Enter the URL of your personal page — data is parsed and loaded automatically |
| **Manual entry** | Skip the URL and enter all data by hand in the sidebar editor |

## Data format (JSON export)

```json
[
  { "title": "基本信息", "buttonText": "姓名",  "fillContent": "顾杰" },
  { "title": "基本信息", "buttonText": "邮箱",  "fillContent": "gujie_kris@163.com" },
  { "title": "Momenta",  "buttonText": "工作内容", "fillContent": "1. 搭建AI询价系统..." }
]
```

## Tech

- Manifest V3 · Chrome Extension
- Vanilla JS (no framework)
- `chrome.storage.local` for persistence
- Native input value setter for React/Vue compatibility
