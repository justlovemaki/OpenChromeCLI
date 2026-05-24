# Open Chrome CLI (Agent Browser Bridge)

中文版 | [English](./README.md)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-orange.svg)](#)

这是一个连接 AI Agent（如 **Claude Code**、**Codex**、**Openclaw/Hermes** 等）与你正在使用的 Chrome 浏览器的强大桥梁。与传统的 Puppeteer 方案不同，本项目运行在你**真实且活跃的浏览器配置**中，允许 AI 在保留你的登录状态、Cookie 和扩展程序的环境下辅助你工作。

## 📺 演示视频

[在 Bilibili 观看演示视频](https://www.bilibili.com/video/BV1kPGJ6sEjb/)

## 🚀 核心特性

- **全功能自动化工具箱**: 提供超过 25 个专业级工具，涵盖交互、导航和调试。
- **真实的上下文环境**: 在你现有的浏览器会话中运行，AI 可以直接操作已登录的网站。
- **双引擎 DOM 分析**: 结合无障碍树 (AXTree) 和 DOM 注入，为 AI 提供完美的网页“语义地图”。
- **专家级调试能力**: 深度访问网络请求 (Network)、控制台日志 (Console) 和堆内存快照 (Heap Analysis)。
- **SEO 与性能优化**: 内置设备模拟（手机、Googlebot）、全屏长截图和性能诊断接口。

## ⚖️ 工具对比

| 对比维度 | Playwright | Browser-Use | Chrome DevTools MCP | OpenCLI (jackwener) | OpenChromeCLI (justlovemaki) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **开发者背景** | 微软官方团队。 | 独立社区开源团队。 | Google Chrome DevTools 官方团队。 | 数据库领域资深专家、Apache 基金会顶级项目 PMC 成员。 | 独立开发者（`justlovemaki` / 何夕）。 |
| **底层核心架构** | CDP 协议的 Node.js/TS 驱动中转。 | Python Agent 框架（可调 Playwright 或原生 CDP）。 | 原生 CDP 映射为标准 MCP（模型上下文协议）服务。 | 浏览器轻量桥接插件 + 本地微型后台进程（micro-daemon） + YAML/TS 声明式适配器。 | **浏览器底层扩展 (`chrome.debugger`) + 本地原生消息宿主 (Native Messaging Host) + TCP/CLI 桥接。** |
| **控制对象与隔离性**| **强隔离沙盒**<br>全新、隔离的虚拟浏览器进程。 | **独立环境**<br>独立启动的沙盒 Chrome 或远程云浏览器容器。 | **调试环境**<br>启动或接管处于调试会话（Debug Session）中的 Chrome 浏览器。 | **真实/本地浏览器**<br>接管用户本地运行、已登录的 Chrome 实例，以及部分 Electron 桌面端软件。 | **真实/本地浏览器**<br>直接附着在您当前使用的真实浏览器窗口上，完全继承已登录 Cookie 及原生扩展。 |
| **多实例与并行能力** | **原生支持极强**<br>通过 `browser_context` 在代码内高并发地创建并管理多实例。 | **中等**<br>多并发通常依赖底层 Playwright 控制多个沙盒浏览器，系统开销相对较大。 | **较弱**<br>每个 MCP Server 通常只映射一个浏览器进程，多实例并行需要手动规划多个 CDP 调试端口。 | **较弱**<br>设计上侧重于统一的全局命令行管道与网站适配，不以多实例隔离并发为核心卖点。 | **极强（多端口多实例并行）**<br>系统启动时**显式动态分配并返回具体连接的端口号**，支持通过不同端口号同时并行运行多个独立的浏览器中转实例，彻底解决多 Agent 调度时的端口占用冲突。 |
| **远程 Agent 调试支持** | **支持**<br>可以通过 `connect_over_cdp` 接入远程 WebSocket，但需要远程端暴露裸 CDP 端口或配置代理。 | **支持**<br>可以通过配置 `cdp_url` 连接到云端虚拟机里的浏览器。 | **支持**<br>支持通过指定的远程 CDP 地址 and 端口进行调试，通常用于远程云编译/测试环境。 | **较弱**<br>主要围绕本地命令行交互和本地 AI Agent 运行，缺少开箱即用的安全远程反向调试代理。 | **原生支持（远程 Agent 调试）**<br>通过扩展与 Native Host 的加密通道，可将**本地已登录的真实 Chrome 调试通道安全地桥接给远程服务器上的 Agent**（例如部署在 GPU 云服务器上的 Claude Code 等），无需在公网暴露高风险的 CDP 端口。 |
| **特有功能 (Unique)** | 1. 跨多浏览器内核支持（WebKit/Firefox/Chromium）；<br>2. 极度成熟的自动等待（Auto-waiting）机制与录制器。 | 1. 深度集成大模型视觉（Vision）进行页面语义判断；<br>2. 内置基于 LLM 的自主规划与纠错引擎。 | 1. 官方支持 Lighthouse 性能跑分；<br>2. 原生支持网络状况与 CPU 性能限速模拟；<br>3. 原生 Trace 性能分析。 | 1. **内置 80+ 网站适配器**，开箱即用；<br>2. **AI 自动将任意网页转换为 CLI 命令**（Agent 可通过统一的 YAML 模式直接调用）；<br>3. 支持控制桌面 Electron 软件。 | 1. **显式动态返回通信端口号**，便于脚本化调度；<br>2. **支持不同端口的多实例并发**；<br>3. **无障碍树(AXTree)+DOM 注入双重语义提取**；<br>4. 支持 **Heap Snapshot 内存堆快照导出**进行深度调试。 |
| **侧重点 (Focus)** | **软件质量与回归测试**。<br>确保代码与网页功能的 100% 可靠性。 | **全自动的业务流程替代**。<br>通过 AI 视觉与推理，让 AI 学会像人一样在陌生网页上做出选择。 | **网页前端开发调优与诊断**。<br>让 AI 编程助手拥有检测性能瓶颈、分析请求报错的能力。 | **全网 CLI 化与确定性操作**。<br>消除大模型操作网页的随机性，将复杂的网页操作退化为一行稳定的命令行指令。 | **真机远程操控与深度底层分析**。<br>打破本地与云端物理隔绝，让远程 AI Agent 无痛、高精细度地操作并诊断本地真实的 Chrome。 |
| **使用成本** | 几乎为零（本地运行，无 API 费用）。 | 极高（每次决策需要高频传输截图给 LLM）。 | 较低（随 IDE 的大模型额度或官方 MCP 授权使用）。 | 低（主要消耗轻量的结构化数据文本 Token）。 | 较低（主要消耗文本 Token，在需要时才触发局部或整页截图）。 |

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

1. **列出所有打开的标签页:**
```bash
node skills/browser-remote-control/scripts/cli.js getTabs
```

2. **打开新网站:**
```bash
node skills/browser-remote-control/scripts/cli.js createTab '{"url": "https://github.com"}'
```

3. **读取页面内容 (无障碍树):**
```bash
# tabId 可以通过 getTabs 获取
node skills/browser-remote-control/scripts/cli.js readPage '{"tabId": 12345, "filter": "interactive"}'
```

4. **点击元素 (使用 readPage 返回的 UID):**
```bash
node skills/browser-remote-control/scripts/cli.js click '{"tabId": 12345, "uid": "node-12"}'
```

5. **在聚焦元素中输入文字:**
```bash
node skills/browser-remote-control/scripts/cli.js typeText '{"tabId": 12345, "text": "Open Chrome CLI"}'
```

6. **截取全屏长图:**
```bash
node skills/browser-remote-control/scripts/cli.js takeFullPageScreenshot '{"tabId": 12345}'
```

**配置说明:**
开发者可以将上述 CLI 工具集成到 Agent 的工具集（Toolbox）中，使 Agent 能够执行特定的浏览器任务。

## 🛡️ 安全与隐私
本扩展通过 `chrome.debugger` 运行。它可以检查并修改浏览器数据。对于处理高度敏感的任务，建议使用隔离的浏览器配置文件。

---
**SEO Master Extension** 系列工具之一。
