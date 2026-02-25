declare namespace API {
  interface Result<T = any> {
    success?: boolean;
    errorMessage?: string;
    errorCode?: number;
    message?: string;
    data?: T;
  }

  interface PageInfo<T = any> {
    list?: T[];
    total?: number;
    current?: number;
    pageSize?: number;
  }

  type Result_string_ = Result<string>;

  type Result_any_ = Result<any>;

  type Result_FeishuConfig_ = Result<FeishuConfig>;

  type Result_FeishuConfig_List_ = Result<FeishuConfig[]>;

  type Result_SPAPIConfig_ = Result<SPAPIConfig>;

  type Result_SPAPIConfig_List_ = Result<SPAPIConfig[]>;
}
