# 用户认证与权限管理系统使用指南

## 📋 功能概述

系统已实现完整的用户认证和权限管理功能，包括：

- ✅ 用户登录/登出
- ✅ JWT Token 认证
- ✅ 角色管理（只读、编辑、管理员）
- ✅ 权限控制（基于资源+操作）
- ✅ 基于角色的页面访问控制

## 🚀 快速开始

### 第一步：执行数据库迁移

```bash
# 执行用户认证相关表的迁移脚本
mysql -u root -p amazon_asin_monitor < server/database/migrations/004_add_user_auth_tables.sql
```

或者使用 MySQL 客户端工具执行 `server/database/migrations/004_add_user_auth_tables.sql` 文件。

这将创建：

- `users` 表 - 用户信息
- `roles` 表 - 角色定义
- `permissions` 表 - 权限定义
- `user_roles` 表 - 用户角色关联
- `role_permissions` 表 - 角色权限关联
- 默认角色（READONLY、EDITOR、ADMIN）
- 默认权限（asin:read、asin:write、monitor:read 等）

### 第二步：创建默认管理员账户

```bash
cd server
node init-admin-user.js
```

默认管理员账户：

- **用户名**: `admin`
- **密码**: `admin123`

⚠️ **重要提示**: 首次登录后请立即修改密码！

### 第三步：配置环境变量（可选）

如果需要自定义 JWT 密钥，在 `server/.env` 文件中添加：

```env
# JWT配置
JWT_SECRET=your-super-secret-key-change-in-production
JWT_EXPIRES_IN=7d
```

### 第四步：启动服务

```bash
# 启动后端服务
cd server
npm run dev

# 启动前端服务（新终端）
cd ..
npm run dev
```

### 第五步：访问系统

1. 打开浏览器访问 `http://localhost:8000`
2. 自动跳转到登录页面
3. 使用默认管理员账户登录：
   - 用户名: `admin`
   - 密码: `admin123`

## 👥 角色和权限说明

### 角色定义

| 角色代码 | 角色名称 | 说明                                         |
| -------- | -------- | -------------------------------------------- |
| READONLY | 只读用户 | 只能查看数据，不能修改                       |
| EDITOR   | 编辑用户 | 可以查看和修改 ASIN 数据，但不能管理系统设置 |
| ADMIN    | 管理员   | 拥有所有权限，包括系统设置和用户管理         |

### 权限定义

| 权限代码       | 资源      | 操作  | 说明                  |
| -------------- | --------- | ----- | --------------------- |
| asin:read      | asin      | read  | 查看 ASIN 列表和详情  |
| asin:write     | asin      | write | 创建、修改、删除 ASIN |
| monitor:read   | monitor   | read  | 查看监控历史记录      |
| analytics:read | analytics | read  | 查看数据分析报表      |
| settings:read  | settings  | read  | 查看系统配置          |
| settings:write | settings  | write | 修改系统配置          |
| user:read      | user      | read  | 查看用户列表          |
| user:write     | user      | write | 创建、修改、删除用户  |

### 角色权限分配

#### 只读用户 (READONLY)

- ✅ asin:read - 查看 ASIN
- ✅ monitor:read - 查看监控历史
- ✅ analytics:read - 查看数据分析
- ❌ 不能修改任何数据

#### 编辑用户 (EDITOR)

- ✅ asin:read - 查看 ASIN
- ✅ asin:write - 编辑 ASIN
- ✅ monitor:read - 查看监控历史
- ✅ analytics:read - 查看数据分析
- ❌ 不能管理系统设置

#### 管理员 (ADMIN)

- ✅ 所有权限（包含用户管理和系统设置）

## 🔐 API 接口

### 认证接口

#### 1. 用户登录

```bash
POST /api/v1/auth/login

Body:
{
  "username": "admin",
  "password": "admin123"
}

Response:
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user-001",
      "username": "admin",
      "email": "admin@example.com",
      "real_name": "系统管理员",
      "status": 1
    },
    "permissions": ["asin:read", "asin:write", ...],
    "roles": ["ADMIN"]
  }
}
```

#### 2. 获取当前用户信息

```bash
GET /api/v1/auth/current-user
Headers: Authorization: Bearer {token}

Response:
{
  "success": true,
  "data": {
    "user": { ... },
    "permissions": [ ... ],
    "roles": [ ... ]
  }
}
```

#### 3. 用户登出

```bash
POST /api/v1/auth/logout
Headers: Authorization: Bearer {token}

Response:
{
  "success": true,
  "message": "登出成功"
}
```

## 🎯 页面访问控制

系统已为以下页面配置了权限控制：

| 页面      | 路由             | 所需权限          |
| --------- | ---------------- | ----------------- |
| 首页      | /home            | canAccessReadOnly |
| ASIN 管理 | /asin            | canReadASIN       |
| 监控历史  | /monitor-history | canReadMonitor    |
| 数据分析  | /analytics       | canReadAnalytics  |
| 系统设置  | /settings        | canReadSettings   |

## 🧾 用户信息说明

系统只保留用户名、真实姓名等基础字段，不再强制收集或校验邮箱；管理员新增用户只需设定用户名、密码即可，权限调整仍由管理员完成。

## 💡 在代码中使用权限控制

### 在页面组件中使用 Access 组件

```typescript
import { Access } from '@umijs/max';
import { Button } from 'antd';
import { useModel } from '@umijs/max';

const MyPage = () => {
  const { initialState } = useModel('@@initialState');
  const { access } = useAccess();

  return (
    <div>
      {/* 只有有 asin:write 权限的用户才能看到这个按钮 */}
      <Access accessible={access.canWriteASIN}>
        <Button type="primary" onClick={handleAdd}>
          新建变体组
        </Button>
      </Access>

      {/* 只有管理员才能看到这个按钮 */}
      <Access accessible={access.canAccessAdmin}>
        <Button danger onClick={handleDelete}>
          删除
        </Button>
      </Access>
    </div>
  );
};
```

### 在后端 API 中使用权限验证

```javascript
const { authenticateToken, checkPermission } = require('../middleware/auth');

// 需要认证
router.get('/api/v1/protected', authenticateToken, (req, res) => {
  res.json({ message: '这是受保护的接口' });
});

// 需要特定权限
router.post(
  '/api/v1/asins',
  authenticateToken,
  checkPermission('asin:write'),
  (req, res) => {
    // 创建ASIN的逻辑
  },
);
```

## 🔧 创建新用户（通过数据库）

如果需要通过 SQL 直接创建用户：

```sql
USE amazon_asin_monitor;

-- 1. 创建用户（密码需要先用 bcrypt 加密）
-- 密码: user123, 加密后（示例）: $2b$10$...
INSERT INTO users (id, username, email, password, real_name, status)
VALUES ('user-002', 'testuser', 'test@example.com', '$2b$10$...', '测试用户', 1);

-- 2. 分配角色（例如：编辑用户）
INSERT INTO user_roles (user_id, role_id)
VALUES ('user-002', 'role-002'); -- role-002 是 EDITOR
```

⚠️ **注意**: 密码必须使用 bcrypt 加密，不能直接存储明文密码。

## 🔄 Token 刷新

当前系统 Token 有效期为 7 天。如需刷新 Token：

1. 前端检测到 Token 即将过期
2. 调用 `/api/v1/auth/current-user` 接口（如果 Token 仍然有效）
3. 如果 Token 已过期，前端清除 Token 并跳转到登录页

## ⚠️ 注意事项

1. **生产环境安全**:

   - 必须修改 `JWT_SECRET` 环境变量
   - 使用强密码
   - 启用 HTTPS

2. **默认密码**:

   - 默认管理员密码是 `admin123`，首次登录后必须修改

3. **Token 存储**:

   - 当前使用 localStorage 存储 Token
   - 生产环境建议考虑使用 httpOnly cookie

4. **权限检查**:
   - 前端权限控制用于 UI 展示
   - 后端必须进行权限验证，确保数据安全

## 🐛 故障排查

### 问题：登录后仍然跳转到登录页

**解决方案**:

1. 检查后端服务是否运行
2. 检查数据库连接是否正常
3. 检查 Token 是否已正确保存到 localStorage
4. 检查浏览器控制台是否有错误信息

### 问题：提示"没有权限执行此操作"

**解决方案**:

1. 检查用户是否分配了正确的角色
2. 检查角色是否分配了相应的权限
3. 检查后端 API 是否正确使用了权限中间件

### 问题：Token 过期后无法自动跳转

**解决方案**:

1. 检查前端响应拦截器是否正确处理 401 错误
2. 检查 localStorage 是否正确清除 Token

## 📝 后续功能扩展

系统已为以下功能预留接口，可后续实现：

- 用户管理页面（CRUD）
- 角色管理页面
- 权限管理页面
- 用户个人资料管理
