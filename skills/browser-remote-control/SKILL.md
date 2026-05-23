---
name: browser-remote-control
description: 当 AI 代理或外部脚本需要通过 Agent Browser Bridge CLI 远程控制浏览器实例，或实现跨主机浏览器自动化时使用。
---

# 通过 Agent Browser Bridge 实现浏览器远程控制

## 概览
本 Skill 提供了如何使用 CLI 工具远程控制浏览器实例的指令。它利用基于 Node.js 的原生消息主机 (Native Messaging Host) 将 TCP 请求桥接到 Chrome 扩展程序。

## 何时使用
- 当 AI 代理需要在真实浏览器中执行操作（点击、输入、导航）时。
- 在不同机器之间实现自动化的 SEO 任务时。
- 当你需要从终端或外部脚本检索浏览器状态（标签页、历史记录）时。

## 核心模式
所有命令遵循以下模式：`node <cli_path> <方法名> [参数_JSON] [目标主机_IP] [端口] [Token]`
*   `<cli_path>`: 指向 `cli.js` 的实际路径。
*   `[Token]`: 可选。显式传递用于身份验证的 Token，优先级高于环境变量 `SEO_TOKEN`。

### 连接流程
1. **认证**: CLI 连接到端口 9333（默认）并发送身份验证 Token。
    - **Host 端**: 默认从 `scripts/config.json` 读取 `token` 字段，若不存在则使用默认值。
    - **CLI 端**: 优先使用第 5 个命令行参数，其次是环境变量 `SEO_TOKEN`，最后尝试读取本地配置。
2. **请求**: CLI 发送 JSON-RPC 2.0 请求（默认 60 秒超时）。
3. **中继**: 原生主机 (`index.js`) 通过标准输入输出 (Stdio) 将请求转发给扩展程序。
4. **执行**: 扩展程序执行相应操作（CDP、脚本注入等）。
5. **响应**: 结果通过 Stdio -> TCP -> CLI 流回。

## 可用方法
请使用 `help` 方法获取当前扩展程序支持的所有方法列表：
```bash
node <cli_path> help
```

## 实现示例

### 1. 基础标签页检索
```bash
# 假设已定位 cli.js 路径为 ./scripts/cli.js
node ./scripts/cli.js getTabs
```

### 2. 在特定标签页上移动鼠标
```bash
node <cli_path> moveMouse '{"tabId": 1024, "x": 500, "y": 300}'
```

### 3. 远程控制（跨主机与自定义 Token）
```bash
# 连接到局域网中的特定 IP，端口 9333，指定自定义 Token
node <cli_path> ping "{}" 192.168.1.15 9333 "my-custom-token"

# 或者使用环境变量
export SEO_TOKEN="my-custom-token"
node <cli_path> getTabs
```

## 常见错误
- **端口被封锁**: 确保防火墙允许 9333 端口的入站连接以进行跨主机通信。
- **Token 错误**: `cli.js` 使用的 Token 必须与服务端一致。
- **请求超时**: 默认请求超时为 60 秒。如果任务执行时间过长（如大型脚本注入），请检查链路稳定性。
- **扩展程序未激活**: 只有当扩展程序处于活动状态时，Chrome 才会启动原生主机。如果连接被拒绝，请尝试点击扩展程序图标。
- **无效的 JSON**: 在终端传递 JSON 时，请在 JSON 对象周围使用单引号，以避免 Shell 解析问题。

## 安全与防护
- **基于 Token**: 提供针对未经授权 TCP 连接的基础防护。
- **局域网使用**: 建议在受信任的网络内使用。
- **允许的来源**: 主机仅接受来自清单文件中定义的特定扩展 ID 的连接。
