#!/bin/bash
# 启动脚本：确保 Node.js 使用 UTF-8 编码环境

# 设置环境变量
export LC_ALL=en_US.UTF-8
export LANG=en_US.UTF-8
export NODE_OPTIONS=--icu-data-dir=/usr/share/icu/69.1

# 可选：指定 Node.js 路径（如果需要）
# NODE_BIN=/usr/bin/node

# 启动应用
echo "启动亚马逊变体监控系统..."
echo "环境编码设置: $LANG"
echo "Node.js 选项: $NODE_OPTIONS"

# 使用 pm2 启动（如果已安装）
if command -v pm2 &> /dev/null; then
    pm2 start index.js --name "amazon-monitor"
else
    # 直接使用 node 启动
    node index.js
fi
