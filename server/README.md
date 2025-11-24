# Amazon ASIN Monitor Backend Server

后端服务，提供 ASIN 监控系统的 API 接口。

## 环境要求

- Node.js >= 14.0.0
- MySQL >= 5.7

## 安装步骤

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置数据库

复制 `.env.example` 为 `.env` 并修改配置：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的数据库信息：

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=amazon_asin_monitor
PORT=3001
CORS_ORIGIN=http://localhost:8000
```

### 3. 初始化数据库

在 MySQL 中执行 `database/init.sql` 文件：

```bash
mysql -u root -p < database/init.sql
```

或者使用 MySQL 客户端工具执行 SQL 文件。

### 4. 启动服务

开发模式（自动重启）：

```bash
npm run dev
```

生产模式：

```bash
npm start
```

服务默认运行在 `http://localhost:3001`

## API 接口

### 变体组接口

- `GET /api/v1/variant-groups` - 查询变体组列表
- `GET /api/v1/variant-groups/:groupId` - 获取变体组详情
- `POST /api/v1/variant-groups` - 创建变体组
- `PUT /api/v1/variant-groups/:groupId` - 更新变体组
- `DELETE /api/v1/variant-groups/:groupId` - 删除变体组

### ASIN 接口

- `POST /api/v1/asins` - 创建 ASIN
- `PUT /api/v1/asins/:asinId` - 更新 ASIN
- `DELETE /api/v1/asins/:asinId` - 删除 ASIN

## 项目结构

```
server/
├── src/
│   ├── config/          # 配置文件
│   │   └── database.js  # 数据库配置
│   ├── models/          # 数据模型
│   │   ├── VariantGroup.js
│   │   └── ASIN.js
│   ├── controllers/     # 控制器
│   │   └── asinController.js
│   ├── routes/          # 路由
│   │   └── asinRoutes.js
│   └── index.js        # 入口文件
├── database/           # 数据库脚本
│   └── init.sql        # 初始化SQL
├── .env.example        # 环境变量示例
└── package.json
```
