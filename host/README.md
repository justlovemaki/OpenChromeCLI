# Open Chrome CLI - Native Host

这是 Open Chrome CLI 的**原生主机 (Native Host)** 组件。它作为一个持久化的 Node.js 服务运行，连接浏览器扩展与外部 AI Agent。

## 核心功能

- **协议转换**: 将外部 TCP 的 JSON-RPC 指令转换为 Chrome Native Messaging 消息。
- **安全网关**: 对外部连接进行 Token 认证，防止浏览器被恶意控制。
- **状态监控**: 自动管理中继服务的生命周期，并在 `host.log` 中记录详细的通信日志。

## 目录结构

- `index.js`: 原生主机核心逻辑 (基于 Node.js stdio)。
- `install.bat` / `install.sh`: 自动注册 Native Messaging 清单文件的安装脚本。
- `run-host.bat` / `run-host.sh`: 独立启动主机的脚本（主要用于本地开发与调试）。
- `config.json`: (需手动创建) 配置文件，用于定义 Token 和 TCP 端口。
- `host.log`: 运行时日志。
- `win/`, `linux/`, `macos/`: 包含各平台对应的 `com.bridge.relay.host.json` 模板。

## 安装步骤

### Windows
1. 确保已安装 [Node.js](https://nodejs.org/)。
2. 以管理员权限运行 `install.bat`。该脚本会将清单路径写入注册表 `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\com.bridge.relay.host`。

### Linux / macOS
1. 在终端执行：`chmod +x install.sh && ./install.sh`。
2. 脚本会将清单文件拷贝至 Chrome 默认的 Native Messaging 目录（如 `~/.config/google-chrome/NativeMessagingHosts/`）。

## 配置说明

默认情况下，主机监听 `9333` 端口，认证 Token 为 `bridge-relay-secure-token-2026`。

你可以通过在 `host/` 目录下创建 `config.json` 来修改这些设置：
```json
{
  "port": 9333,
  "token": "你的自定义TOKEN"
}
```

## 测试与验证

安装完成后，你可以通过 `skills` 目录下的 CLI 工具进行测试：

```bash
# 进入测试工具目录
cd ../skills/browser-remote-control/scripts

# 测试连通性
node cli.js ping

# 获取当前浏览器所有标签页
node cli.js getTabs
```

## 故障排除

如果连接失败，请按以下顺序检查：
1. **日志文件**: 查看 `host/host.log` 是否有报错信息。
2. **注册状态**: 确保 `install` 脚本运行成功且没有路径冲突。
3. **编译状态**: 确保根目录的扩展程序已编译（存在 `background.js`），因为主机是由扩展程序唤起的。
