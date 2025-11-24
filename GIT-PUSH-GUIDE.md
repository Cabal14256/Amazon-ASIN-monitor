# Git 推送指南

本指南将帮助你将项目推送到 GitHub 仓库。

## 📋 前置条件

1. **安装 Git**（如果还没有安装）
   - 下载地址：https://git-scm.com/download/win
   - 或使用 Chocolatey: `choco install git`
   - 安装完成后重启终端

2. **创建 GitHub 仓库**（如果还没有）
   - 登录 GitHub
   - 点击右上角的 "+" → "New repository"
   - 输入仓库名称（如：`Amazon-ASIN-monitor`）
   - 选择 Public 或 Private
   - **不要**初始化 README、.gitignore 或 license（因为我们已经有这些文件）
   - 点击 "Create repository"

## 🚀 推送步骤

### 步骤 1: 检查 Git 是否已初始化

打开 PowerShell 或 Git Bash，在项目根目录执行：

```bash
cd D:\Amazon-ASIN-monitor
git status
```

### 步骤 2: 初始化 Git 仓库（如果还没有初始化）

如果提示 "not a git repository"，执行：

```bash
git init
```

### 步骤 3: 添加所有文件

```bash
git add .
```

### 步骤 4: 提交更改

```bash
git commit -m "feat: 完整的 Amazon ASIN 监控系统

- 实现用户认证和权限管理（RBAC）
- 实现 ASIN 管理功能
- 实现监控历史记录
- 实现数据分析和统计
- 实现定时任务监控
- 实现飞书通知功能
- 优化登录页面 UI
- 修复权限检查问题
- 使用 App.useApp() hook 消除 message 警告"
```

### 步骤 5: 添加远程仓库

将 `YOUR_USERNAME` 和 `YOUR_REPO_NAME` 替换为你的 GitHub 用户名和仓库名：

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git
```

或者使用 SSH（如果你配置了 SSH 密钥）：

```bash
git remote add origin git@github.com:YOUR_USERNAME/YOUR_REPO_NAME.git
```

### 步骤 6: 推送到 GitHub

```bash
# 首次推送
git branch -M main
git push -u origin main
```

如果仓库已经有内容，可能需要先拉取：

```bash
git pull origin main --allow-unrelated-histories
git push -u origin main
```

## 🔍 检查推送状态

推送完成后，检查远程仓库：

```bash
git remote -v
git status
```

## ⚠️ 重要提示

### 确保敏感文件不会被提交

检查 `.gitignore` 文件是否包含以下内容：

- `.env`
- `server/.env`
- `node_modules/`
- 其他敏感配置

### 如果已经提交了敏感文件

如果之前已经提交了 `.env` 等敏感文件，需要从 Git 历史中删除：

```bash
# 从 Git 中删除但保留本地文件
git rm --cached .env
git rm --cached server/.env

# 重新提交
git commit -m "chore: 移除敏感配置文件"

# 推送到远程
git push origin main
```

⚠️ **注意**：如果敏感文件已经被推送到 GitHub，即使从仓库中删除，仍然存在于 Git 历史中。建议：
1. 立即更换所有在 `.env` 中的密钥和密码
2. 考虑使用 GitHub 的 Secret Scanning 功能
3. 或者创建新的仓库

## 📝 后续更新

推送代码后，后续的更新流程：

```bash
# 1. 检查更改
git status

# 2. 添加更改
git add .

# 3. 提交更改
git commit -m "feat: 功能描述"

# 4. 推送到 GitHub
git push origin main
```

## 🔧 常见问题

### 问题 1: 推送被拒绝（rejected）

**原因**：远程仓库有本地没有的提交

**解决**：
```bash
git pull origin main --rebase
git push origin main
```

### 问题 2: 认证失败

**原因**：GitHub 不再支持密码认证

**解决**：使用 Personal Access Token (PAT)
1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. 生成新 token，选择 `repo` 权限
3. 推送时使用 token 作为密码

### 问题 3: 文件太大

**原因**：某些文件超过了 GitHub 的 100MB 限制

**解决**：
- 检查是否有大文件（如数据库备份）
- 添加到 `.gitignore`
- 如果已经提交，使用 `git rm --cached` 删除

## 📚 有用的 Git 命令

```bash
# 查看提交历史
git log --oneline

# 查看更改
git diff

# 撤销未提交的更改
git checkout -- <file>

# 查看远程仓库
git remote -v

# 修改远程仓库地址
git remote set-url origin <new-url>
```

