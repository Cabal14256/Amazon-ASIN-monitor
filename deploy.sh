#!/bin/bash

# 1Panel部署脚本
# 用于自动化部署Amazon ASIN Monitor项目

set -e

echo "=========================================="
echo "Amazon ASIN Monitor - 1Panel部署脚本"
echo "=========================================="

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 项目目录
PROJECT_DIR="/opt/amazon-asin-monitor"
SERVER_DIR="$PROJECT_DIR/server"

# 检查是否以root用户运行
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}请使用root用户运行此脚本${NC}"
    exit 1
fi

# 检查项目目录是否存在
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}项目目录不存在: $PROJECT_DIR${NC}"
    echo "请先上传项目代码到此目录"
    exit 1
fi

echo -e "${GREEN}✓ 项目目录检查通过${NC}"

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js未安装，请先在1Panel中安装Node.js运行环境${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js版本: $NODE_VERSION${NC}"

# 检查MySQL
if ! command -v mysql &> /dev/null; then
    echo -e "${YELLOW}⚠ MySQL命令行工具未找到，请确保MySQL已安装${NC}"
else
    echo -e "${GREEN}✓ MySQL已安装${NC}"
fi

# 检查Redis
if command -v redis-cli &> /dev/null; then
    if redis-cli ping &> /dev/null; then
        echo -e "${GREEN}✓ Redis服务运行中${NC}"
    else
        echo -e "${YELLOW}⚠ Redis服务未运行，请检查${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Redis命令行工具未找到，请确保Redis已安装${NC}"
fi

# 安装后端依赖
echo ""
echo "正在安装后端依赖..."
cd "$SERVER_DIR"
if [ ! -f "package.json" ]; then
    echo -e "${RED}错误: 找不到server/package.json${NC}"
    exit 1
fi

npm install --production
echo -e "${GREEN}✓ 后端依赖安装完成${NC}"

# 检查.env文件
if [ ! -f "$SERVER_DIR/.env" ]; then
    echo ""
    echo -e "${YELLOW}⚠ 未找到.env文件，正在从env.template创建...${NC}"
    if [ -f "$SERVER_DIR/env.template" ]; then
        cp "$SERVER_DIR/env.template" "$SERVER_DIR/.env"
        echo -e "${GREEN}✓ 已创建.env文件，请编辑配置：${NC}"
        echo "  $SERVER_DIR/.env"
        echo ""
        echo -e "${YELLOW}请编辑.env文件，配置数据库、Redis等信息后重新运行此脚本${NC}"
        exit 0
    else
        echo -e "${RED}错误: 找不到env.template文件${NC}"
        echo -e "${YELLOW}请手动创建.env文件，参考DEPLOY-1PANEL.md中的配置说明${NC}"
        exit 1
    fi
fi

echo -e "${GREEN}✓ .env文件存在${NC}"

# 测试数据库连接
echo ""
echo "正在测试数据库连接..."
cd "$SERVER_DIR"
if node test-db-connection.js; then
    echo -e "${GREEN}✓ 数据库连接成功${NC}"
else
    echo -e "${RED}✗ 数据库连接失败，请检查.env文件中的数据库配置${NC}"
    exit 1
fi

# 安装前端依赖
echo ""
echo "正在安装前端依赖..."
cd "$PROJECT_DIR"
if [ ! -f "package.json" ]; then
    echo -e "${RED}错误: 找不到package.json${NC}"
    exit 1
fi

npm install
echo -e "${GREEN}✓ 前端依赖安装完成${NC}"

# 构建前端
echo ""
echo "正在构建前端应用..."
npm run build

if [ -d "$PROJECT_DIR/dist" ]; then
    echo -e "${GREEN}✓ 前端构建完成${NC}"
    echo "  构建目录: $PROJECT_DIR/dist"
else
    echo -e "${RED}✗ 前端构建失败，dist目录不存在${NC}"
    exit 1
fi

# 创建日志目录
mkdir -p "$PROJECT_DIR/logs"
echo -e "${GREEN}✓ 日志目录已创建${NC}"

# 设置目录权限
chmod -R 755 "$PROJECT_DIR/dist"
echo -e "${GREEN}✓ 目录权限已设置${NC}"

echo ""
echo "=========================================="
echo -e "${GREEN}部署脚本执行完成！${NC}"
echo "=========================================="
echo ""
echo "下一步操作："
echo "1. 检查并编辑后端配置文件: $SERVER_DIR/.env"
echo "2. 在1Panel中配置进程守护（PM2）运行后端服务"
echo "3. 在1Panel中创建网站，指向: $PROJECT_DIR/dist"
echo "4. 配置Nginx反向代理到后端API"
echo "5. 配置防火墙开放80端口"
echo ""
echo "详细步骤请参考: DEPLOY-1PANEL.md"

