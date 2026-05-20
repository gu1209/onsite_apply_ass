# Onsite Apply Assistant · 网申助手

A Chrome extension that auto-syncs resume data from your personal page and fills online job application forms with one click. v2.0 adds AI-powered resume parsing and intelligent form filling.

## Features

- **Auto sync** — Fetches structured data from any personal homepage; caches locally for 1 hour
- **One-click fill** — Left-click a button to fill the focused input; right-click to copy to clipboard
- **AI form filler** — Scans page form fields, sends structure to LLM for semantic matching, fills text inputs and clicks dropdowns/selects automatically
- **AI resume import** — Upload PDF/Word resume, AI parses it through Socratic dialogue and generates structured data
- **Smart click fill** — Detects custom dropdown/select widgets that don't accept text input and fills via click simulation
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

## AI Setup

The AI features work with any OpenAI-compatible API, including:

| Provider | Endpoint | Model example | Cost |
|----------|----------|---------------|------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | ~$0.003/use |
| Groq (free tier) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Free |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | ~¥0.001/use |
| MiMo | `https://api.xiaomimimo.com/v1` | `mimo-v2.5-pro` | — |
| Ollama (local) | `http://localhost:11434/v1` | `llama3:8b` | Free |

1. Open the sidebar → ⚙ Settings
2. Fill in **API Endpoint**, **API Key**, and **Model**
3. Click **测试连接** to verify
4. Use 🤖 **AI 智能填表** on any application page, or upload a resume in **AI 简历导入**

## First-time setup

On first launch, choose one of two modes:

| Mode | Description |
|------|-------------|
| **Auto fetch** | Enter the URL of your personal page — data is parsed and loaded automatically |
| **Manual entry** | Skip the URL and enter all data by hand in the sidebar editor |

## Data format (JSON export)

```json
[
  { "title": "基本信息", "buttonText": "姓名",  "fillContent": "YOUR_NAME" },
  { "title": "基本信息", "buttonText": "邮箱",  "fillContent": "YOUR_EMAIL" },
  { "title": "Momenta",  "buttonText": "工作内容", "fillContent": "1. 搭建AI询价系统..." }
]
```

## Tech

- Manifest V3 · Chrome Extension
- Vanilla JS (no framework, no build step)
- `chrome.storage.local` for persistence
- Native input value setter for React/Vue compatibility
- OpenAI-compatible API for AI features