# Open Chrome CLI (Agent Browser Bridge)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-orange.svg)](#)

A powerful bridge connecting AI Agents (**Claude Code**、**Codex**、**Openclaw/Hermes**.) with your live Chrome browser. Unlike Puppeteer-based solutions, this project runs directly in your **real browser profile**, allowing AI to assist you with genuine sessions, logins, and extensions.

## 🚀 Key Features

- **Full Automation Toolkit**: Over 25+ professional-grade tools for interaction, navigation, and debugging.
- **Genuine Context**: Operates within your existing browser session (retains logins, cookies, and history).
- **Dual-Engine DOM Analysis**: Uses both Accessibility Tree (AXTree) and DOM injection to provide AI with a perfect "semantic map" of any webpage.
- **Expert Debugging**: Access to Network requests, Console logs, and deep Memory Heap analysis.
- **SEO & Performance**: Built-in device emulation (Mobile, Googlebot) and full-page auditing.

## 🛠️ Tool Reference

The AI Agent can autonomously invoke the following capabilities:

| Category | Tools |
| :--- | :--- |
| **Interaction** | `click`, `fillForm`, `hover`, `drag`, `uploadFile`, `typeText`, `pressKey`, `clickAt` |
| **Navigation** | `navigatePage`, `waitFor`, `selectPage`, `closePage`, `createTab` |
| **Debugging** | `listConsoleMessages`, `evaluateScript`, `listNetworkRequests`, `getNetworkResponseBody` |
| **Audit & SEO** | `emulateDevice`, `resizePage`, `takeFullPageScreenshot`, `getCookies` |
| **Memory** | `takeHeapSnapshot`, `getHeapSnapshotSummary`, `getHeapSnapshotDetails`, `getHeapSnapshotRetainers` |

## 📦 Installation

### 1. Extension Setup
1. Open `chrome://extensions/`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select the `dist` folder.

### 2. Native Host Setup
The Native Host is required for secure communication between the Agent and Chrome.
- **Windows**: Run `host/install.bat`
- **macOS/Linux**: Run `host/install.sh`

## 🤖 Usage with AI Agents

More than just a physical relay, this project provides out-of-the-box "browser manipulation skills" for mainstream AI Agents. Empower your Agent with real execution capabilities:

- **Broad Agent Support**: Native support for **Claude Code**, **Codex**, **Openclaw/Hermes**, and other mainstream AI frameworks. Provides human-like interaction, TCP instruction set integration, and real-time network/console monitoring.

> **Tip**: The `skills/browser-remote-control` directory contains LLM-optimized Prompt Templates and tool definitions to help Agents better understand webpage context.

AI Agents can communicate with the browser by calling the local Command Line Interface (CLI) or connecting directly to the TCP port.

**CLI Usage Example:**
```bash
node skills/browser-remote-control/scripts/cli.js getTabs
```

**Configuration Note:**
Developers can integrate the CLI tool into their Agent's toolbox, enabling the Agent to perform specific browser tasks.

## 🛡️ Security & Privacy
This extension operates via `chrome.debugger`. It can inspect and modify browser data. We recommend using an isolated profile for highly sensitive tasks, although the project is designed to help you with your daily workflows.

---
Part of the **SEO Master Extension** suite.
