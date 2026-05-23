#!/bin/bash
# Agent Browser Bridge Host Installer for macOS and Linux

HOST_NAME="com.bridge.relay.host"
SCRIPT_DIR=$(cd "$(dirname "$0")"; pwd)
HOST_PATH="$SCRIPT_DIR/run-host.sh"

# 1. 确保启动脚本有执行权限
chmod +x "$HOST_PATH"

# 2. 根据 OS 确定安装目录和模板
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    TARGET_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    TEMPLATE_JSON="$SCRIPT_DIR/macos/com.bridge.relay.host.json"
else
    # Linux
    TARGET_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    TEMPLATE_JSON="$SCRIPT_DIR/linux/com.bridge.relay.host.json"
fi

# 3. 创建目录
mkdir -p "$TARGET_DIR"

# 4. 生成最终的 JSON 配置文件 (将相对路径 ../run-host.sh 替换为绝对路径)
sed "s|\"path\": \"../run-host.sh\"|\"path\": \"$HOST_PATH\"|g" "$TEMPLATE_JSON" > "$TARGET_DIR/$HOST_NAME.json"

echo "-----------------------------------------------"
echo "Native Messaging Host $HOST_NAME 已安装"
echo "操作系统: $OSTYPE"
echo "配置文件路径: $TARGET_DIR/$HOST_NAME.json"
echo "程序指向: $HOST_PATH"
echo "-----------------------------------------------"
echo "注意：请确保 JSON 中的 allowed_origins 包含你真实的插件 ID。"
