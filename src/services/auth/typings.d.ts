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
}
