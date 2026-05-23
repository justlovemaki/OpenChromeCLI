# Open Chrome CLI

这是连接 AI Agent 与浏览器的核心桥梁。通过 **Chrome 扩展程序**、**原生主机 (Native Host)** 与 **预置技能 (Skills)** 的协作，使外部 Agent 能够通过标准的 JSON-RPC 2.0 协议和 Chrome DevTools Protocol (CDP) 深度控制浏览器。

## Agent 生态适配 (Skill)

本项目不仅是物理层面的中继，还为各种主流 AI Agent 提供了开箱即用的“浏览器操控技能”。通过本项目，你可以让你的 Agent 具备真正的执行力：

- **广泛的 Agent 支持**: 原生支持 **Claude Code**、**Codex**、**Openclaw/Hermes** 等主流 AI Agent 框架，提供拟人化交互、TCP 指令集集成及实时网络/控制台监控能力。

> **提示**: 在 `skills/browser-remote-control` 中包含了针对 LLM 优化的提示词模板 (Prompt Templates) 和工具定义，帮助 Agent 更好地理解页面上下文。

## 核心能力

- **全量浏览器控制**: 封装了大部分常用的 CDP 指令，支持截图、网络监控、Cookie 管理及复杂的 DOM 操作。
- **语义化页面理解 (Semantic Reader)**: 
    - 支持原生 CDP `getFullAXTree` 指令，直接获取完整的辅助功能树 (Accessibility Tree) 。
    - 为 LLM 提供去除冗余后的页面结构，大幅降低 Token 消耗。
- **拟人化交互模拟**: 
    - **模拟输入**: 模拟真实人类的打字节奏，包括随机延迟、按错键后的退格纠正。
    - **视觉反馈**: 在操作点产生波纹效果（Ripple Effect），便于观察 Agent 的行为。
- **自动化防御消除**: 自动处理并消除“离开此网站？”等阻塞性 JS 对话框。
- **跨平台中继**: 适配 Windows、macOS 和 Linux，通过 Native Messaging 机制建立持久连接。
- **安全认证**: 内置基于 Token 的 TCP 认证机制，保护浏览器控制权不被非法占用。

## 系统架构

```text
[ AI Agent / CLI ] <--- TCP (9333+) ---> [ Native Host (Node.js) ] <--- Native Messaging ---> [ Browser Extension (MV3) ]
```

1.  **AI Agent / CLI**: 外部客户端，发送 JSON-RPC 指令。
2.  **Native Host**: Node.js 进程，充当安全中继与协议转换器。
3.  **Browser Extension**: 运行在 Chrome 环境，负责执行具体的 CDP 指令与脚本注入。

## 目录结构 (源码)

- `manifest.json`: 扩展程序清单，定义了核心权限。
- `agent.ts`: 核心控制逻辑，封装了页面读取与拟人化交互算法。
- `background.ts`: 扩展程序 Service Worker，负责管理中继连接。
- `native_rpc.ts`: 统一的 JSON-RPC 2.0 传输层实现。
- `host/`: **原生主机组件**，包含各平台的安装脚本及 Node.js 中继服务。
- `skills/`: 预置的工具集，包含用于快速测试的 `cli.js`。

## 快速开始

### 1. 编译项目
扩展程序运行需要编译后的 JavaScript。**必须在项目根目录**（`bridge` 的父目录）执行构建：
```bash
# 在项目根目录执行
npm install
npm run build
```
编译后，所有的产物将生成在根目录的 `dist/` 文件夹中。

### 2. 安装原生主机
进入 `bridge/host` 目录并根据操作系统运行安装脚本：
- **Windows**: 运行 `install.bat`
- **macOS/Linux**: 运行 `chmod +x install.sh && ./install.sh`

> **注意**: 默认认证 Token 为 `bridge-relay-secure-token-2026`。如需自定义，请参考 [host/README.md](./host/README.md)。

### 3. 加载扩展程序
1. 打开 Chrome，访问 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择项目根目录下的 **`dist/`** 目录。
4. 确认扩展图标已显示。

### 4. 连通性测试
使用内置的 CLI 工具验证链路是否畅通：
```bash
cd skills/browser-remote-control/scripts
node cli.js ping
```

## 调试与日志

- **扩展日志**: 在 `chrome://extensions/` 中点击背景页的“服务工作线程”查看控制台。
- **主机日志**: 查看 `bridge/host/host.log`，记录了所有的 TCP 通信与 Native Messaging 交互详情。
- **配置文件**: `bridge/host/config.json` 可用于配置端口与安全 Token。
