# Open Chrome CLI (Agent Browser Bridge)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-orange.svg)](#)

这是一个连接 AI Agent（如 **Claude Code**、**Codex**、**Openclaw/Hermes** 等）与你正在使用的 Chrome 浏览器的强大桥梁。与传统的 Puppeteer 方案不同，本项目运行在你**真实且活跃的浏览器配置**中，允许 AI 在保留你的登录状态、Cookie 和扩展程序的环境下辅助你工作。

## 🚀 核心特性

- **全功能自动化工具箱**: 提供超过 25 个专业级工具，涵盖交互、导航和调试。
- **真实的上下文环境**: 在你现有的浏览器会话中运行，AI 可以直接操作已登录的网站。
- **双引擎 DOM 分析**: 结合无障碍树 (AXTree) 和 DOM 注入，为 AI 提供完美的网页“语义地图”。
- **专家级调试能力**: 深度访问网络请求 (Network)、控制台日志 (Console) 和堆内存快照 (Heap Analysis)。
- **SEO 与性能优化**: 内置设备模拟（手机、Googlebot）、全屏长截图和性能诊断接口。

## 🛠️ 工具参考

AI Agent 可以自主调用以下功能：

| 类别 | 工具名称 |
| :--- | :--- |
| **交互控制** | `click` (UID点击), `fillForm` (批量填充), `hover`, `drag`, `uploadFile`, `typeText` (真人打字), `pressKey`, `clickAt` |
| **导航管理** | `navigatePage` (前后退/刷新), `waitFor` (智能等待), `selectPage`, `closePage`, `createTab` |
| **调试分析** | `listConsoleMessages`, `evaluateScript` (万能脚本), `listNetworkRequests`, `getNetworkResponseBody` |
| **SEO 审计** | `emulateDevice` (模拟手机/Googlebot), `resizePage`, `takeFullPageScreenshot` (全屏长图), `getCookies` |
| **内存分析** | `takeHeapSnapshot` (抓取快照), `getHeapSnapshotSummary`, `getHeapSnapshotDetails`, `getHeapSnapshotRetainers` |

## 📦 安装指南

### 1. 扩展程序设置
1. 打开浏览器进入 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择项目中的 `dist` 文件夹。

### 2. Native Host 安装
Native Host 是实现 Agent 与 Chrome 安全通信的关键组件。
- **Windows**: 运行 `host/install.bat`
- **macOS/Linux**: 运行 `host/install.sh`

## 🤖 在 AI Agent 中使用

本项目不仅是物理层面的中继，还为各种主流 AI Agent 提供了开箱即用的“浏览器操控技能”。通过本项目，你可以让你的 Agent 具备真正的执行力：

- **广泛的 Agent 支持**: 原生支持 **Claude Code**、**Codex**、**Openclaw/Hermes** 等主流 AI Agent 框架，提供拟人化交互、TCP 指令集集成及实时网络/控制台监控能力。

> **提示**: 在 `skills/browser-remote-control` 中包含了针对 LLM 优化的提示词模板 (Prompt Templates) 和工具定义，帮助 Agent 更好地理解页面上下文。

AI Agent 可以通过调用本地命令行工具（CLI）或直接连接 TCP 端口来与浏览器通信。

**命令行调用示例:**
```bash
node skills/browser-remote-control/scripts/cli.js getTabs
```

**配置说明:**
开发者可以将上述 CLI 工具集成到 Agent 的工具集（Toolbox）中，使 Agent 能够执行特定的浏览器任务。

## 🛡️ 安全与隐私
本扩展通过 `chrome.debugger` 运行。它可以检查并修改浏览器数据。对于处理高度敏感的任务，建议使用隔离的浏览器配置文件。

---
**SEO Master Extension** 系列工具之一。
