#!/bin/bash
# 自动寻找 node 路径并执行同目录下的 index.js
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
  # 如果 PATH 中没找到，尝试常见路径
  NODE_PATH="/usr/local/bin/node"
fi

"$NODE_PATH" "$(dirname "$0")/index.js" "$@"
