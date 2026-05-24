# Open Chrome CLI (Agent Browser Bridge)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-orange.svg)](#)

A powerful bridge connecting AI Agents (**Claude Code**、**Codex**、**Openclaw/Hermes**.) with your live Chrome browser. Unlike Puppeteer-based solutions, this project runs directly in your **real browser profile**, allowing AI to assist you with genuine sessions, logins, and extensions.

## 📺 Demo Video

[Watch the Demo on Bilibili](https://www.bilibili.com/video/BV1kPGJ6sEjb/)

## 🚀 Key Features

- **Full Automation Toolkit**: Over 25+ professional-grade tools for interaction, navigation, and debugging.
- **Genuine Context**: Operates within your existing browser session (retains logins, cookies, and history).
- **Dual-Engine DOM Analysis**: Uses both Accessibility Tree (AXTree) and DOM injection to provide AI with a perfect "semantic map" of any webpage.
- **Expert Debugging**: Access to Network requests, Console logs, and deep Memory Heap analysis.
- **SEO & Performance**: Built-in device emulation (Mobile, Googlebot) and full-page auditing.

## ⚖️ Tool Comparison

| Dimension | Playwright | Browser-Use | Chrome DevTools MCP | OpenCLI (jackwener) | OpenChromeCLI (justlovemaki) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Developer Background** | Microsoft Official Team. | Independent community open-source team. | Google Chrome DevTools Official Team. | Senior database expert, Apache Software Foundation Top-Level Project PMC member. | Independent Developer (`justlovemaki` / He Xi). |
| **Core Architecture** | Node.js/TS driver relay based on CDP protocol. | Python Agent framework (supports Playwright or native CDP). | Native CDP mapped to standard MCP (Model Context Protocol) service. | Lightweight browser bridge extension + local micro-daemon + YAML/TS declarative adapters. | **Browser-level extension (`chrome.debugger`) + Local Native Messaging Host + TCP/CLI bridge.** |
| **Control Object & Isolation**| **Strongly Isolated Sandbox**<br>Fresh, isolated virtual browser processes. | **Independent Environment**<br>Standalone sandboxed Chrome or remote cloud browser containers. | **Debugging Environment**<br>Starts or attaches to a Chrome browser in a Debug Session. | **Real/Local Browser**<br>Attaches to the user's local, logged-in Chrome instance and some Electron desktop apps. | **Real/Local Browser**<br>Directly attaches to your active real browser window, inheriting all logins, cookies, and extensions. |
| **Multi-instance & Parallelism** | **Strong Native Support**<br>High-concurrency management via `browser_context`. | **Moderate**<br>Concurrency usually relies on controlling multiple sandboxed browsers, resulting in higher overhead. | **Weak**<br>Each MCP Server usually maps to one browser process; requires manual planning of CDP ports. | **Weak**<br>Focused on unified global CLI pipelines and site adapters, not multi-instance concurrency. | **Extremely Strong (Multi-port parallelism)**<br>**Explicitly allocates and returns dynamic port numbers** upon startup, supporting multiple independent relay instances via different ports to solve scheduling conflicts. |
| **Remote Agent Debugging** | **Supported**<br>Via `connect_over_cdp` to remote WebSockets, but requires exposed CDP ports or proxies. | **Supported**<br>Via `cdp_url` to cloud VMs. | **Supported**<br>Via specified remote CDP addresses/ports, typically for cloud build/test environments. | **Weak**<br>Focused on local CLI/Agent execution, lacking secure remote reverse debugging proxies. | **Native Support (Remote Agent Debugging)**<br>Uses encrypted tunnels to **securely bridge the local logged-in Chrome debug channel to Agents on remote servers** (e.g., Claude Code on GPU cloud) without exposing CDP ports. |
| **Unique Features** | 1. Cross-browser engine support (WebKit/Firefox/Chromium);<br>2. Mature auto-waiting mechanisms and recorder. | 1. Deep integration with LLM Vision for semantic judgment;<br>2. Built-in LLM-based autonomous planning and error correction. | 1. Official Lighthouse support;<br>2. Native network and CPU throttling simulation;<br>3. Native Trace performance analysis. | 1. **80+ built-in site adapters**, out-of-the-box;<br>2. **AI-powered webpage-to-CLI command conversion**;<br>3. Supports controlling desktop Electron apps. | 1. **Dynamic port allocation** for script scheduling;<br>2. **Multi-instance parallelism via different ports**;<br>3. **AXTree + DOM injection dual-semantic extraction**;<br>4. **Heap Snapshot export** for deep debugging. |
| **Focus** | **Software Quality & Regression Testing**.<br>Ensuring 100% reliability of code and webpage features. | **Automated Business Process Replacement**.<br>Enabling AI to navigate unknown websites like a human using vision and reasoning. | **Frontend Dev Optimization & Diagnosis**.<br>Giving AI assistants the power to detect performance bottlenecks and analyze request errors. | **Global Web CLI & Deterministic Operation**.<br>Eliminating LLM randomness by reducing complex tasks to stable CLI commands. | **Real-device Remote Control & Deep Analysis**.<br>Bridging the gap between local and cloud, allowing remote AI Agents to operate and diagnose local Chrome with high precision. |
| **Usage Cost** | Near zero (local execution, no API costs). | Extremely high (requires frequent screenshot transfers to LLM). | Low (included with IDE AI quotas or official MCP licensing). | Low (mainly consumes lightweight structured text tokens). | Low (mainly consumes text tokens; screenshots are triggered only when needed). |

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

**CLI Usage Examples:**

1. **List all open tabs:**
```bash
node skills/browser-remote-control/scripts/cli.js getTabs
```

2. **Open a new website:**
```bash
node skills/browser-remote-control/scripts/cli.js createTab '{"url": "https://github.com"}'
```

3. **Read page content (Accessibility Tree):**
```bash
# tabId can be obtained from getTabs
node skills/browser-remote-control/scripts/cli.js readPage '{"tabId": 12345, "filter": "interactive"}'
```

4. **Click an element (using UID from readPage):**
```bash
node skills/browser-remote-control/scripts/cli.js click '{"tabId": 12345, "uid": "node-12"}'
```

5. **Type text into focused element:**
```bash
node skills/browser-remote-control/scripts/cli.js typeText '{"tabId": 12345, "text": "Open Chrome CLI"}'
```

6. **Take a full-page screenshot:**
```bash
node skills/browser-remote-control/scripts/cli.js takeFullPageScreenshot '{"tabId": 12345}'
```

**Configuration Note:**
Developers can integrate the CLI tool into their Agent's toolbox, enabling the Agent to perform specific browser tasks.

## 🛡️ Security & Privacy
This extension operates via `chrome.debugger`. It can inspect and modify browser data. We recommend using an isolated profile for highly sensitive tasks, although the project is designed to help you with your daily workflows.

---
Part of the **SEO Master Extension** suite.
