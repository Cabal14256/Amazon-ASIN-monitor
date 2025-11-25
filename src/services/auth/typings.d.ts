declare namespace API {
  /** 登录参数 */
  type LoginParams = {
    username: string;
    password: string;
  };

  /** 当前用户信息 */
  type CurrentUser = {
    id?: string;
    username?: string;
    email?: string;
    real_name?: string;
    status?: number;
    last_login_time?: string;
    last_login_ip?: string;
    create_time?: string;
    update_time?: string;
    permissions?: string[];
    roles?: string[];
  };

  /** 登录响应 */
  interface Result_Login_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    data?: {
      token?: string;
      user?: CurrentUser;
      permissions?: string[];
      roles?: string[];
    };
  }

  /** 当前用户响应 */
  interface Result_CurrentUser_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    data?: {
      user?: CurrentUser;
      permissions?: string[];
      roles?: string[];
    };
  }

  /** 空响应 */
  interface Result_void_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    message?: string;
  }

  /** 角色信息 */
  type Role = {
    id?: string;
    code?: string;
    name?: string;
    description?: string;
    permissions?: Permission[];
  };

  /** 权限信息 */
  type Permission = {
    id?: string;
    code?: string;
    name?: string;
    resource?: string;
    action?: string;
    description?: string;
  };

  /** 用户信息（管理页面） */
  type UserInfo = {
    id?: string;
    username?: string;
    email?: string;
    real_name?: string;
    status?: number;
    last_login_time?: string;
    last_login_ip?: string;
    create_time?: string;
    update_time?: string;
    roles?: Role[];
    permissions?: string[];
  };

  /** 用户列表查询参数 */
  type UserListParams = {
    username?: string;
    email?: string;
    status?: string;
    current?: number;
    pageSize?: number;
  };

  /** 创建用户参数 */
  type CreateUserParams = {
    username: string;
    email?: string;
    password: string;
    real_name?: string;
    roleIds?: string[];
  };

  /** 更新用户参数 */
  type UpdateUserParams = {
    email?: string;
    real_name?: string;
    status?: number;
    roleIds?: string[];
  };

  /** 修改密码参数 */
  type UpdatePasswordParams = {
    newPassword: string;
  };

  /** 用户列表响应 */
  interface Result_UserList_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    data?: {
      list?: UserInfo[];
      total?: number;
    };
  }

  /** 用户详情响应 */
  interface Result_UserDetail_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    data?: UserInfo;
  }

  /** 角色列表响应 */
  interface Result_RoleList_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    data?: Role[];
  }

  /** 权限列表响应 */
  interface Result_PermissionList_ {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    data?: {
      list?: Permission[];
      grouped?: Record<string, Permission[]>;
    };
  }
}
