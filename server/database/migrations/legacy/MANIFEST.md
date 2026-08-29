# Legacy migrations manifest

以下 SQL 从 `server/database/migrations/` 原样移动到本目录。校验值为移动后的 SHA-256，用于证明归档内容未被改写；这些文件不是可连续执行的迁移链。

| 原路径文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `001_add_asin_type.sql` | ASIN 类型字段 | `4bd7ca8f42688dc3478dd261c061071879b2028e3235c65199cee92be576809e` |
| `002_add_monitor_fields.sql` | ASIN 监控字段 | `ea1a9889ee8dd07024673547a722514c658dad4e3c879999a0911503741e9a38` |
| `003_add_site_and_brand.sql` | 站点与品牌字段 | `9ba43df470c0dbbe3ccc2d2e1b0450ca155e3585c875ecb5513375e86f28cf44` |
| `004_add_user_auth_tables.sql` | 用户认证表 | `c70c69e50ac8f58743e0dd46eb926ae5a49d6258a1c2337085eac373f1aab5ab` |
| `005_remove_batch_tables.sql` | 删除旧批次表 | `c1d6099c632ce4e225b74a89d2171f2a5f1954c7271bbaf3b57bf0a602d588d8` |
| `006_add_audit_log_table.sql` | 审计日志表 | `ea91db6620d4c53eeac36b0905f0f9f88fc69eda9e3715b178b547853cee66d3` |
| `008_add_monitor_history_index.sql` | 历史索引 | `d4bb99028f9251e491f0583707501cc879bfbb4057ce015df7bd2144b546ec41` |
| `009_remove_user_email_and_reset_table.sql` | 用户字段清理 | `6586bec9a1ed0babbe98cc9abf4d02d7454719ef2d7b8c14f05bbe5849b792fa` |
| `010_add_sessions_table.sql` | 会话表 | `1940f50076291cd4e8916d4234cb8a524ed3324157ea7d5c881d6676199e23c4` |
| `011_add_variant_group_fields.sql` | 变体组监控字段 | `cc92c0294c7ae3bdec983807312446bd6bbcf051ad7f69e0b29cec006ec4c45b` |
| `012_add_composite_indexes.sql` | 复合索引 | `2bf5db1c729de47ca07798c7a8cf1dc14e03900187ca7a6e3ed8c7eaf17a91a7` |
| `013_add_competitor_variant_group_fields.sql` | 竞品变体组字段 | `3de731515fc4b08ffa262b8ec973235bb1f1b0f25b1930326f7f3a9676442064` |
| `013_add_password_security_tables.sql` | 密码安全表 | `5c2799c46268e33cd4a71789c6f0b5fbefed4467a3dc3b3adaab65d69b03e5e5` |
| `014_add_granular_permissions.sql` | 细粒度权限 | `4f803cb706d6322551903254eb69c61cb595b60e65949dac6a1634ea2db9d22c` |
| `015_change_asin_unique_to_composite.sql` | 主营复合唯一键 | `b987fdd79aa88d4df0388fffbbd466ac932886535ab2fac80006d9e309c805bb` |
| `016_add_snapshot_fields_to_monitor_history.sql` | 主营历史快照 | `565a29788338a0882aa49097b1a105be70f63948690f7c925f4c3169df8bf511` |
| `017_optimize_monitor_history_indexes.sql` | 历史查询索引 | `76c2c89425856248fa14297040a160f1e77ee8c3644ac8ccd711b87f47cf7156` |
| `018_add_analytics_query_index.sql` | 分析索引 | `2322a8e55841e55c0735cb3ce67121c0d0aca2846fd73c4993ebd8b4ba4700c6` |
| `019_add_backup_config_table.sql` | 备份配置表 | `d55dab4d8466dea7f97b918d5ebcc33d86adc7c08ef31efc2527ba4a6fbf9398` |
| `020_add_status_change_indexes.sql` | 状态变化索引 | `df84fdb30346d1d7b4aaef3c5ad46d9507f00e03970f27ab1167b9416b94e909` |
| `021_add_monitor_history_agg_table.sql` | 历史聚合表 | `8fef43acb544d244e20cc96dfeb6a6c30d5c68bbd4d1185029966f2793d5ad5e` |
| `021_optimize_variant_group_indexes.sql` | 变体组索引 | `d0c16c4f4b18baf29306c4404c1625f1bc586031ec5c1632f5ab1762451dd188` |
| `022_add_monitor_history_agg_peak.sql` | 聚合峰值字段 | `ff3c14325ec9c81941a0fbc831f6782fb9b8c99317b031d2ac977bd7da5a885c` |
| `023_add_analytics_fastpath.sql` | 分析快路径 | `f4a69e955ff2fe7a80042e247828ce325544c3838879904375744aa876b5f5b0` |
| `024_fix_missing_password_security_schema.sql` | 密码结构修复 | `291bea2196f718736cbed3b5bed3d136ca01ec7812d63a74354dec8077c1c62b` |
| `025_add_manual_variant_flags.sql` | 人工异常字段 | `83364d7afddd15a377c1be88f6aedb17b73bf3a9fa7f336f2d91cbb4f3f61044` |
| `026_normalize_user_status_and_audit_permissions.sql` | 用户状态和权限 | `39230cb1dc82ab15530126085c06e22086c919806c4bb49705a0deefe0351c52` |
| `027_normalize_competitor_schema.sql` | 竞品结构规范 | `3418c285198aa7c80da1f09b3b3fefcdf92702e2947ab2cb37a012420a8c2ccc` |
| `028_add_variant_group_agg_table.sql` | 变体组聚合表 | `c9cb0a048ebf9dddde7ab72d1f5e7e3a2309e65086834935510638f269023127` |
| `029_add_asin_group_manual_exclusion.sql` | 人工父体排除字段 | `011c30100cbc4ebb3c2d09aec0b6a4182873d8cd6cf8079a69d16d97d8f4424d` |
| `030_add_analytics_rollup_and_status_interval.sql` | 月聚合和状态区间 | `9bddf331cdbd5d8a11b8d6f6d7640dea9166763b4906415d1d2175a1db82d322` |
| `030_optimize_batch_delete_history_fks.sql` | 历史外键清理 | `831376459b248460ed6f5f6ba0b9609edc1e88a4170d023527c7017b63dc1b1b` |
| `031_optimize_analytics_refresh_indexes.sql` | 分析刷新索引 | `88c56543bc60660626add614930f2d6c473bc9eb054456c97530fd9c713b904f` |
