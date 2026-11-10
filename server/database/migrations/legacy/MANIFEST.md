# Legacy migrations manifest

以下 SQL 从 `server/database/migrations/` 原样移动到本目录。校验值为移动后的 SHA-256，用于证明归档内容未被改写；这些文件不是可连续执行的迁移链。

| 原路径文件 | 用途 | SHA-256 |
| --- | --- | --- |
| `001_add_asin_type.sql` | ASIN 类型字段 | `c14c4567742af38859bb9672fbe5d40fa0e1040f4eefbd0836d2a5db0f4688af` |
| `002_add_monitor_fields.sql` | ASIN 监控字段 | `f7c162d4495ab065f6f411feabf6399705fd39b72a2d5e90d89aed24030628c0` |
| `003_add_site_and_brand.sql` | 站点与品牌字段 | `b120f61f713d488906b9b6073e9a53c2d9ff7f5ba708c86fb40711de5f11f31a` |
| `004_add_user_auth_tables.sql` | 用户认证表 | `2b58eebfa50f56ec942b5bd8a4659cfd1d6f9386495dafcf04c0336e5272b377` |
| `005_remove_batch_tables.sql` | 删除旧批次表 | `116584b17f3acc008fe28355f69a03473ab2b872b2a57f65de294783e64fd5a8` |
| `006_add_audit_log_table.sql` | 审计日志表 | `2ea3ae1356bf899fb037d0bfe7e50e22a3d41ea5847f05e5d3132b17b156b745` |
| `008_add_monitor_history_index.sql` | 历史索引 | `38cbfdeaaae9a82193c0519dc04a20368bf4d69fb09b048124014ecb3ed639e4` |
| `009_remove_user_email_and_reset_table.sql` | 用户字段清理 | `a86115cc459c1f0c643ee5abecf05c0edf7df5a6c058bc42cb487e1f933e8cba` |
| `010_add_sessions_table.sql` | 会话表 | `e8c5a3037172f9388826192423813dd3237f366d6693d248cd04b90def34703e` |
| `011_add_variant_group_fields.sql` | 变体组监控字段 | `899ca60e8c6098177da48c7f4b493ee067545e62256497603ce7b7cc3c1ce8b8` |
| `012_add_composite_indexes.sql` | 复合索引 | `11e7e4f58f64056243be1f511760ab649280bdfa512ed61db0e366334ca3c925` |
| `013_add_competitor_variant_group_fields.sql` | 竞品变体组字段 | `3de731515fc4b08ffa262b8ec973235bb1f1b0f25b1930326f7f3a9676442064` |
| `013_add_password_security_tables.sql` | 密码安全表 | `36de5900713999df271cbe99c9a47435ad27ea84d5f347fd5b8d230b695d49de` |
| `014_add_granular_permissions.sql` | 细粒度权限 | `c000b32ce15eb8073b118867822702208e3b8bdde9a74397a953353fb7b54497` |
| `015_change_asin_unique_to_composite.sql` | 主营复合唯一键 | `a9ea8f0822d7cae6c51bbf04371d5ac765b4e0d1f41c7b47ab3b024fa3126460` |
| `016_add_snapshot_fields_to_monitor_history.sql` | 主营历史快照 | `01e8c7553dd0ed4cd49209a235f82ad92ebe4a90ceb13b4061ef6d9cc919e996` |
| `017_optimize_monitor_history_indexes.sql` | 历史查询索引 | `7e9f0f4f1724c75f6f58700c497e74b4951aad44abed9890430acf26dc2b6499` |
| `018_add_analytics_query_index.sql` | 分析索引 | `e3ca2c3251d2cf7ecd462981a2247959dbea6cfb423dd46d4ddca712ad6c79fd` |
| `019_add_backup_config_table.sql` | 备份配置表 | `791e0598b38d9da9fee59acee254ffc7d323a64655ac0071c1c8ca2d504683b5` |
| `020_add_status_change_indexes.sql` | 状态变化索引 | `71ae0e369184b526669a73e5d8f263e9c951e539165ff575c251a69ad2714c6c` |
| `021_add_monitor_history_agg_table.sql` | 历史聚合表 | `8fef43acb544d244e20cc96dfeb6a6c30d5c68bbd4d1185029966f2793d5ad5e` |
| `021_optimize_variant_group_indexes.sql` | 变体组索引 | `95b477ba225d3c337924c7878f9c14d9e90d8b4181c301f2cb29c600db013a21` |
| `022_add_monitor_history_agg_peak.sql` | 聚合峰值字段 | `ff3c14325ec9c81941a0fbc831f6782fb9b8c99317b031d2ac977bd7da5a885c` |
| `023_add_analytics_fastpath.sql` | 分析快路径 | `2b82e6ef9fd025035ecdbaded033f5e2fe1a72777e70008f64ce845e66364725` |
| `024_fix_missing_password_security_schema.sql` | 密码结构修复 | `9b505cd5936741ae444c01508467dfbe96a0dc4d1bfc083529a4b6ba94999418` |
| `025_add_manual_variant_flags.sql` | 人工异常字段 | `971492f94c479492b341945f20dcf70016f9ba85696b2cfb9e9dec0b141a6545` |
| `026_normalize_user_status_and_audit_permissions.sql` | 用户状态和权限 | `f5866c2efdc5ec0e4ea58d5316b7be3d2f4706ad881c5d8e2624b16cf02c0002` |
| `027_normalize_competitor_schema.sql` | 竞品结构规范 | `13bc1f5eac570520ad6178fec4a31234a3306a200ab3a16d9b9b1e72c344b32c` |
| `028_add_variant_group_agg_table.sql` | 变体组聚合表 | `83a557ca59027a08a7bf263bce52ba794e3a717ef61b4a2c8ab518375b7cd6cd` |
| `029_add_asin_group_manual_exclusion.sql` | 人工父体排除字段 | `1bd839bee748f414f91055484ae2a4f39ae2fb58db53916656c50b457f2faef8` |
| `030_add_analytics_rollup_and_status_interval.sql` | 月聚合和状态区间 | `e3804e7b46c0e525a0a68ebddb2e03aef3013d887c32de7ba50c9f914426639e` |
| `030_optimize_batch_delete_history_fks.sql` | 历史外键清理 | `f3d3da34048796967f6cc2f98d37a3c98c0e926f03d4ff7496a56a21a65cc3b1` |
| `031_optimize_analytics_refresh_indexes.sql` | 分析刷新索引 | `dcf2225e58901026f83bc8e46f651cf56482f53c0f9dc06c66ad84f507ae9914` |
