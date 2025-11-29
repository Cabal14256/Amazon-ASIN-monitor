# 1Panel 部署检查清单

使用此清单确保所有部署步骤都已完成。

## 前置准备

- [ ] 已安装 1Panel 面板
- [ ] 已获取服务器公网 IP
- [ ] 已通过 SSH 访问服务器

## 第一步：安装依赖服务

- [ ] 在 1Panel 应用商店安装 MySQL（版本 8.0+）
- [ ] 记录 MySQL root 密码
- [ ] 在 1Panel 应用商店安装 Redis
- [ ] 在 1Panel 运行环境中安装 Node.js（版本 18+）
- [ ] 验证 Node.js 安装：`node -v`

## 第二步：上传项目代码

- [ ] 创建项目目录：`/opt/amazon-asin-monitor`
- [ ] 上传项目代码到服务器
- [ ] 验证项目文件完整性

## 第三步：初始化数据库

- [ ] 在 1Panel 中创建数据库 `amazon_asin_monitor`
- [ ] 记录数据库用户名和密码
- [ ] 执行 `server/database/init.sql` 初始化脚本
- [ ] 验证数据库表已创建

## 第四步：配置后端服务

- [ ] 安装后端依赖：`cd server && npm install --production`
- [ ] 创建 `.env` 文件：`cp env.template .env`
- [ ] 配置数据库连接信息
- [ ] 配置 CORS_ORIGIN 为公网 IP
- [ ] 配置 Redis 连接
- [ ] 配置 JWT_SECRET（强密码）
- [ ] 测试数据库连接：`node test-db-connection.js`
- [ ] 测试后端启动：`npm start`（然后 Ctrl+C 停止）

## 第五步：配置 PM2 进程守护

- [ ] 在 1Panel 中创建进程守护
- [ ] 配置进程名称：`amazon-asin-monitor-api`
- [ ] 配置运行目录：`/opt/amazon-asin-monitor/server`
- [ ] 配置启动命令：`node src/index.js`
- [ ] 配置环境变量（从.env 文件加载）
- [ ] 启动进程守护
- [ ] 检查进程状态为"运行中"
- [ ] 查看日志确认服务正常启动
- [ ] 测试 API：`curl http://localhost:3001/health`

## 第六步：构建前端应用

- [ ] 安装前端依赖：`npm install`
- [ ] 检查 `.umirc.ts` 配置（生产环境使用 `/api`）
- [ ] 构建前端：`npm run build`
- [ ] 验证 `dist` 目录已生成

## 第七步：配置 Nginx 网站

- [ ] 在 1Panel 中创建网站
- [ ] 配置网站类型：静态网站
- [ ] 配置网站域名：公网 IP
- [ ] 配置网站目录：`/opt/amazon-asin-monitor/dist`
- [ ] 配置反向代理：`/api` → `http://127.0.0.1:3001/api/v1`
- [ ] 配置路径重写：`/api` → `/api/v1`
- [ ] 验证网站可以访问

## 第八步：配置防火墙

- [ ] 在 1Panel 防火墙中开放 80 端口
- [ ] （可选）在 1Panel 防火墙中开放 443 端口（HTTPS）
- [ ] 在阿里云安全组中添加入站规则：80/80 TCP
- [ ] （可选）在阿里云安全组中添加入站规则：443/443 TCP
- [ ] 验证防火墙规则已生效

## 第九步：验证部署

- [ ] 测试后端 API：`curl http://公网IP:3001/health`
- [ ] 测试前端访问：浏览器打开 `http://公网IP`
- [ ] 测试 API 代理：浏览器访问 `http://公网IP/api/health`
- [ ] 初始化管理员账户：`cd server && node init-admin-user.js`
- [ ] 测试登录功能
- [ ] 测试 ASIN 管理功能
- [ ] 检查数据库连接正常

## 生产环境优化（可选）

- [ ] 配置 HTTPS 证书（1Panel 证书功能）
- [ ] 修改默认密码为强密码
- [ ] 配置自动备份（数据库和代码）
- [ ] 配置日志轮转
- [ ] 配置监控告警
- [ ] 优化 Nginx 配置（Gzip 压缩等）

## 故障排查

如果遇到问题，请检查：

- [ ] PM2 进程是否运行：1Panel → 进程守护
- [ ] 后端日志是否有错误：1Panel → 进程守护 → 查看日志
- [ ] Nginx 配置是否正确：1Panel → 网站 → 配置文件
- [ ] 数据库连接是否正常：`node server/test-db-connection.js`
- [ ] 防火墙规则是否正确：1Panel → 防火墙
- [ ] 文件权限是否正确：`ls -la /opt/amazon-asin-monitor/dist`

## 完成部署

所有步骤完成后，系统应该可以正常访问：

- 前端地址：`http://你的公网IP`
- 后端 API：`http://你的公网IP/api`（通过 Nginx 代理）

恭喜！部署完成！🎉
