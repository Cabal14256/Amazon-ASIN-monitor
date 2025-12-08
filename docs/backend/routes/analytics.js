// backend/routes/analytics.js
const express = require('express');
const router = express.Router();

const ExcelJS = require('exceljs');
const db2 = require('../utils/db2');

// === 你的库里 event_time 已是北京时间（+08:00），不再额外换算 ===
const DB_TIME_IS_UTC = false;
function bj(expr = 'event_time') {
  return DB_TIME_IS_UTC ? `CONVERT_TZ(${expr}, '+00:00', '+08:00')` : expr;
}

/* ----------------------------------------
   高峰时段判定（北京时间）
   US: 02–05, 09–11
   UK: 22–01, 03–05
   DE/FR/ES/IT: 20–23, 02–04
----------------------------------------- */
// 聚合查询用（无别名）
// const IS_PEAK_EXPR() = (() => {
//   const H = `HOUR(${bj('event_time')})`;
//   return `
//     CASE
//       WHEN country='US' AND (
//         (${H} BETWEEN 2 AND 5) OR (${H} BETWEEN 9 AND 11)
//       ) THEN 1
//       WHEN country='UK' AND (
//         (${H} BETWEEN 22 AND 23) OR (${H} BETWEEN 0 AND 1) OR (${H} BETWEEN 3 AND 5)
//       ) THEN 1
//       WHEN country IN ('DE','FR','ES','IT') AND (
//         (${H} BETWEEN 20 AND 23) OR (${H} BETWEEN 2 AND 4)
//       ) THEN 1
//       ELSE 0
//     END
//   `;
// })();

// 新的判峰表达式生成器（接受 alias，可为空）
// 将原来的 IS_PEAK_EXPR() 常量与 PEAK_EXPR 函数替换为下面两者
function IS_PEAK_EXPR(alias = '') {
  const a = alias ? `${alias}.` : '';
  // 使用 bj() 保持 DB_TIME_IS_UTC 行为不变
  const H = `HOUR(${bj(`${a}event_time`)})`;
  return `
    CASE
      WHEN ${a}country='US' AND (
        (${H} BETWEEN 2 AND 5) OR (${H} BETWEEN 9 AND 11)
      ) THEN 1
      WHEN ${a}country='UK' AND (
        (${H} BETWEEN 22 AND 23) OR (${H} BETWEEN 0 AND 1) OR (${H} BETWEEN 3 AND 5)
      ) THEN 1
      WHEN ${a}country IN ('DE','FR','ES','IT') AND (
        (${H} BETWEEN 20 AND 23) OR (${H} BETWEEN 2 AND 4)
      ) THEN 1
      ELSE 0
    END
  `;
}

// 明细查询用（带别名）
// function PEAK_EXPR(alias = 's') {
//   const H = `HOUR(${bj(`${alias}.event_time`)})`;
//   return `
//     CASE
//       WHEN ${alias}.country='US' AND (
//         (${H} BETWEEN 2 AND 5) OR (${H} BETWEEN 9 AND 11)
//       ) THEN 1
//       WHEN ${alias}.country='UK' AND (
//         (${H} BETWEEN 22 AND 23) OR (${H} BETWEEN 0 AND 1) OR (${H} BETWEEN 3 AND 5)
//       ) THEN 1
//       WHEN ${alias}.country IN ('DE','FR','ES','IT') AND (
//         (${H} BETWEEN 20 AND 23) OR (${H} BETWEEN 2 AND 4)
//       ) THEN 1
//       ELSE 0
//     END
//   `;
// }

function PEAK_EXPR(alias = 's') {
  return IS_PEAK_EXPR(alias);
}

/* ---------------------------
   工具
--------------------------- */
function parseList(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

// 支持：countries 多值；site/brand 多值或模糊（* 或 %）；'ALL' 视为不过滤
function buildWhere({ from, to, countries, site, brand, status }) {
  if (!from || !to) throw new Error('from/to 必填');

  const where = ['event_time BETWEEN ? AND ?'];
  const params = [from, to];

  const listCountries = parseList(countries);
  if (listCountries.length && !(listCountries.length === 1 && listCountries[0] === 'ALL')) {
    where.push(`country IN (${listCountries.map(() => '?').join(',')})`);
    params.push(...listCountries);
  }

  if (site) {
    const list = parseList(site);
    if (list.length > 1) {
      where.push(`site IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    } else if (site.includes('%') || site.includes('*')) {
      where.push('site LIKE ?');
      params.push(site.replace(/\*/g, '%'));
    } else {
      where.push('site = ?');
      params.push(site);
    }
  }

  if (brand) {
    const list = parseList(brand);
    if (list.length > 1) {
      where.push(`amazon_brand IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    } else if (brand.includes('%') || brand.includes('*')) {
      where.push('amazon_brand LIKE ?');
      params.push(brand.replace(/\*/g, '%'));
    } else {
      where.push('amazon_brand = ?');
      params.push(brand);
    }
  }

  if (status) { where.push('status = ?'); params.push(status); }
  return { where, params };
}

function slotExpr(interval) {
  return interval === 'day'
    ? `DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d 00:00:00')`
    : `DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:00:00')`;
}

// 小时槽字符串（用于去重用的 key）
function slotKey(interval) {
  return interval === 'day'
    ? `DATE_FORMAT(${bj('event_time')}, '%Y%m%d')`
    : `DATE_FORMAT(${bj('event_time')}, '%Y%m%d%H')`;
}

/* =========================================================
   1) 折线图 /analytics/ratio
   - ratio_all_asin：快照口径（原公式）
   - ratio_all_time：去重口径（按 国家+ASIN+时间槽 去重）
========================================================= */
// ====== 高性能版 /api/analytics/ratio ======
// 要点：
// 1) 使用生成列 hour_ts/day_ts 做时间分桶；
// 2) “ASIN 去重”用 GROUP BY (slot,country,asin) + MAX(is_broken)；
// 3) 明确 FORCE INDEX 命中新建的复合索引，避免走单列索引；
// 4) 返回结构与原版一致（前端无需改）。

router.get('/ratio', async (req, res) => {
  try {
    // 仅支持 'hour' 或 'day'，默认为 'hour'
    const interval  = (req.query.interval || 'hour') === 'day' ? 'day' : 'hour';

    const countries = req.query.countries ?? req.query.country ?? '';
    const sites     = req.query.sites ?? req.query.site ?? '';
    const brands    = req.query.brands ?? req.query.brand ?? '';
    const { from, to } = req.query;

    // 仍然用 event_time 做原始过滤（保证部分天/小时的区间是精确的）
    const { where, params } = buildWhere({
      from, to,
      countries, site: sites, brand: brands, status: ''
    });

    // 分桶列（不再用 DATE_FORMAT）
    const slotCol  = interval === 'day' ? 'day_ts'  : 'hour_ts';

    // 过滤用的复合索引（按时间范围 + 可选国家），比单列 event_time 更稳
    const idxFilter = 'idx_ms_country_time';

    // 去重用的复合索引（country, asin, <slot>）
    const idxDedup  = interval === 'day' ? 'idx_ms_ctry_asin_day' : 'idx_ms_ctry_asin_hour';

    const sql = `
      WITH
      /* A) 原始分桶（快照口径） */
      base AS (
        SELECT ${slotCol} AS time_slot,
               SUM(is_broken) AS broken_snap,
               COUNT(*)       AS total_snap
        FROM monitor_snapshots FORCE INDEX (${idxFilter})
        WHERE ${where.join(' AND ')}
        GROUP BY ${slotCol}
      ),

      /* B) ASIN 去重：同一 (country, asin, slot) 只算一次，是否异常看 MAX(is_broken) */
      dedup AS (
        SELECT ${slotCol} AS slot,
               country, asin,
               MAX(is_broken) AS any_broken
        FROM monitor_snapshots FORCE INDEX (${idxDedup})
        WHERE ${where.join(' AND ')}
        GROUP BY ${slotCol}, country, asin
      )

      /* C) （仅按天时需要）“时长去重”——先按小时去重，再聚到天 */
      ${interval === 'day' ? `
      , dedup_hour_in_day AS (
        SELECT d.day_ts AS day_slot,
               COUNT(*) AS total_hour_dedup,
               SUM(any_broken) AS broken_hour_dedup
        FROM (
          SELECT day_ts, hour_ts, country, asin, MAX(is_broken) AS any_broken
          FROM monitor_snapshots FORCE INDEX (idx_ms_ctry_asin_hour)
          WHERE ${where.join(' AND ')}
          GROUP BY day_ts, hour_ts, country, asin
        ) d
        GROUP BY d.day_ts
      )` : ``}

      /* D) 汇总输出：结构与老接口一致 */
      SELECT
        b.time_slot,
        b.broken_snap,
        b.total_snap,
        ROUND(b.broken_snap / NULLIF(b.total_snap,0) * 100, 2) AS ratio_all_asin,

        COUNT(d.asin) AS total_asin_dedup,
        SUM(CASE WHEN d.any_broken=1 THEN 1 ELSE 0 END) AS broken_asin_dedup,
        ROUND(
          SUM(CASE WHEN d.any_broken=1 THEN 1 ELSE 0 END) / NULLIF(COUNT(d.asin),0) * 100, 2
        ) AS ratio_all_time

        ${interval === 'day' ? `,
        /* 修正点：聚合 dh.* 以兼容 ONLY_FULL_GROUP_BY（每天最多一行，SUM 等于该值） */
        COALESCE(
          ROUND(
            SUM(dh.broken_hour_dedup) / NULLIF(SUM(dh.total_hour_dedup), 0) * 100, 2
          ),
          0
        ) AS ratio_duration_day
        ` : `,
        /* 小时粒度不计算该指标 */
        0 AS ratio_duration_day
        `}
      FROM base b
      LEFT JOIN dedup d ON d.slot = b.time_slot
      ${interval === 'day' ? `LEFT JOIN dedup_hour_in_day dh ON dh.day_slot = b.time_slot` : ``}
      GROUP BY b.time_slot, b.broken_snap, b.total_snap
      ORDER BY b.time_slot;
    `;

    // 绑定参数：base 用 1 份，dedup 用 1 份；若是按天，还有日内小时去重再用 1 份
    const bind = [...params, ...params, ...(interval === 'day' ? params : [])];

    const [rows] = await db2.query(sql, bind);

    const data = rows.map(r => ({
      time:               r.time_slot,
      broken:             Number(r.broken_snap || 0),
      total:              Number(r.total_snap  || 0),
      ratio_all_asin:     Number(r.ratio_all_asin || 0),
      ratio_all_time:     Number(r.ratio_all_time || 0),
      ratio_duration_day: Number(r.ratio_duration_day || 0),
    }));

    res.json({ data });
  } catch (e) {
    console.error('analytics/ratio fast error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});



/* =========================================================
   2) 顶部固定看板 /analytics/fixed-boards （不受筛选影响）
========================================================= */
router.get('/fixed-boards', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from / to 必填' });

    // Global
    const sqlAll = `
      SELECT
        MIN(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS from_time,
        MAX(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS to_time,
        COUNT(*) AS total_links,

        -- 快照口径
        ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,

        -- 去重时长口径（country+asin+小时槽）
        (
          SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
          FROM (
            SELECT
              country,
              asin,
              DATE_FORMAT(${bj('event_time')}, '%Y%m%d%H') AS slot,
              MAX(is_broken) AS any_broken
            FROM monitor_snapshots
            WHERE event_time BETWEEN ? AND ?
            GROUP BY country, asin, slot
          ) z
        ) AS ratio_all_time,

        -- 局部占比（分母各自记录）
        ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_high,
        ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_low,

        -- 供全局高/低峰占比使用（分母=total_links）
        SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) AS broken_high,
        SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) AS broken_low
      FROM monitor_snapshots
      WHERE event_time BETWEEN ? AND ?
    `;
    const [[all]] = await db2.query(sqlAll, [from, to, from, to]);

    // Regions（US/EU）
    const sqlRegion = `
      SELECT
        o.region,
        o.from_time,
        o.to_time,
        o.total_links,
        o.ratio_all_asin,
        (
          SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
          FROM (
            SELECT
              h.country,
              h.asin,
              DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H') AS slot,
              MAX(h.is_broken) AS any_broken
            FROM monitor_snapshots h
            WHERE h.event_time BETWEEN ? AND ?
              AND (CASE WHEN h.country='US' THEN 'US' ELSE 'EU' END) = o.region
            GROUP BY h.country, h.asin, slot
          ) z
        ) AS ratio_all_time,
        o.ratio_high,
        o.ratio_low,
        o.broken_high,
        o.broken_low
      FROM (
        SELECT
          CASE WHEN country='US' THEN 'US' ELSE 'EU' END AS region,
          MIN(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS from_time,
          MAX(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS to_time,
          COUNT(*) AS total_links,
          ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
          ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) /
                NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_high,
          ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) /
                NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_low,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) AS broken_high,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) AS broken_low
        FROM monitor_snapshots
        WHERE event_time BETWEEN ? AND ?
        GROUP BY region
      ) o
    `;
    const [regions] = await db2.query(sqlRegion, [from, to, from, to]);

    const globalPeakAbnormalRate = all?.total_links ? Number(((all.broken_high || 0) / all.total_links * 100).toFixed(2)) : 0;
    const globalLowPeakAbnormalRate = all?.total_links ? Number(((all.broken_low  || 0) / all.total_links * 100).toFixed(2)) : 0;

    res.json({
      all: {
        period: `${all?.from_time || ''} ~ ${all?.to_time || ''}`,
        total_links:      Number(all?.total_links || 0),
        ratio_all_asin:   Number(all?.ratio_all_asin || 0),
        ratio_all_time:   Number(all?.ratio_all_time || 0),
        ratio_high:       Number(all?.ratio_high || 0),
        ratio_low:        Number(all?.ratio_low  || 0),
        global_peak_rate: globalPeakAbnormalRate,
        global_low_rate:  globalLowPeakAbnormalRate,
      },
      regions: (regions || []).map(r => {
        const gPeak = r.total_links ? Number(((r.broken_high || 0) / r.total_links * 100).toFixed(2)) : 0;
        const gLow  = r.total_links ? Number(((r.broken_low  || 0) / r.total_links * 100).toFixed(2)) : 0;
        return {
          region: r.region,
          period: `${r.from_time} ~ ${r.to_time}`,
          total_links:      Number(r.total_links || 0),
          ratio_all_asin:   Number(r.ratio_all_asin || 0),
          ratio_all_time:   Number(r.ratio_all_time || 0),
          ratio_high:       Number(r.ratio_high || 0),
          ratio_low:        Number(r.ratio_low  || 0),
          global_peak_rate: gPeak,
          global_low_rate:  gLow,
        };
      }),
    });
  } catch (e) {
    console.error('analytics/fixed-boards error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================================================
   3) 周期汇总 /analytics/period-summary （受筛选）
========================================================= */
router.get('/period-summary', async (req, res) => {
  try {
    const { from, to, site = '', brand = '' } = req.query;
    const countries = req.query.countries ?? req.query.country ?? '';
    const { where, params } = buildWhere({ from, to, countries, site, brand, status: '' });

    console.log('[period-summary] query=', req.query);

    const sql = `
      SELECT
        s.country,
        s.site,
        s.amazon_brand,
        MIN(DATE_FORMAT(${bj('s.event_time')}, '%Y-%m-%d %H:%i:%s')) AS from_time,
        MAX(DATE_FORMAT(${bj('s.event_time')}, '%Y-%m-%d %H:%i:%s')) AS to_time,
        COUNT(*) AS total_links,

        -- 快照口径
        ROUND(SUM(s.is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,

        -- 去重时长口径（限定同组合）
        (
          SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
          FROM (
            SELECT
              h.country,
              h.asin,
              DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H') AS slot,
              MAX(h.is_broken) AS any_broken
            FROM monitor_snapshots h
            WHERE h.event_time BETWEEN ? AND ?
              AND h.country      = s.country
              AND h.site         = s.site
              AND h.amazon_brand = s.amazon_brand
            GROUP BY h.country, h.asin, slot
          ) z
        ) AS ratio_all_time,

        -- 局部占比
        ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN s.is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_high,
        ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN s.is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_low,

        -- 供全局占比显示
        SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN s.is_broken ELSE 0 END) AS broken_high,
        SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN s.is_broken ELSE 0 END) AS broken_low

      FROM monitor_snapshots s
      WHERE ${where.join(' AND ')}
      GROUP BY s.country, s.site, s.amazon_brand
      ORDER BY s.country, s.site, s.amazon_brand
    `;
    const [rows] = await db2.query(sql, [from, to, ...params]);

    const data = rows.map(r => ({
      country: r.country,
      site: r.site,
      brand: r.amazon_brand,
      period: `${r.from_time} ~ ${r.to_time}`,
      total_links:       Number(r.total_links || 0),
      ratio_all_asin:    Number(r.ratio_all_asin || 0),
      ratio_all_time:    Number(r.ratio_all_time || 0),
      ratio_high:        Number(r.ratio_high || 0),
      ratio_low:         Number(r.ratio_low  || 0),
      ratio_high_global: r.total_links ? Number(((r.broken_high || 0) / r.total_links * 100).toFixed(2)) : 0,
      ratio_low_global:  r.total_links ? Number(((r.broken_low  || 0) / r.total_links * 100).toFixed(2)) : 0,
    }));
  // 避免浏览器缓存旧结果（可保留）
res.set('Cache-Control', 'no-store')
// debug=2：回传当前连接的库/主机 + 这段时间 site=108 的基数
if (String(req.query.debug || '') === '2') {
  const [[chk]] = await db2.query(
    `SELECT DATABASE() AS db, @@hostname AS host,
            COUNT(*) AS n,
            MIN(event_time) AS min_ts,
            MAX(event_time) AS max_ts
     FROM monitor_snapshots
     WHERE site = ? AND event_time BETWEEN ? AND ?`,
    [site || '108', from, to]
  );
  return res.json({ debug: { where, params, query: req.query }, check: chk, data, total: data.length });
}

// 若要临时看 where/params，给请求带上 ?debug=1
if (String(req.query.debug || '') === '1') {
  return res.json({ debug: { where, params, query: req.query }, data, total: data.length })
};
    res.json({ data, total: data.length });
  } catch (e) {
    console.error('analytics/period-summary error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================================================
   4) 分页表 /analytics/ratio-table
========================================================= */
router.get('/ratio-table', async (req, res) => {
  try {
    const {
      from, to,
      country = 'ALL', // 兼容旧参数
      site = '',
      brand = '',
      bucket = 'hour',
      page = 1,
      pageSize = 50,
    } = req.query;

    const countries = req.query.countries ?? country ?? '';
    const { where, params } = buildWhere({ from, to, countries, site, brand, status: '' });

    const offset = (Number(page) > 0 ? Number(page) - 1 : 0) * (Number(pageSize) || 50);
    const cntSql = `SELECT COUNT(DISTINCT ${slotExpr(bucket)}) AS n FROM monitor_snapshots WHERE ${where.join(' AND ')}`;
    const [[{ n }]] = await db2.query(cntSql, params);

    const sql = `
      SELECT
        o.time_slot,
        o.total,
        o.ratio_all_asin,
        ROUND(COALESCE(SUM(d.any_broken)/NULLIF(COUNT(d.ts),0),0)*100, 2) AS ratio_all_time,
        -- 局部占比（快照口径）
        ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_high,
        ROUND(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_low
      FROM (
        SELECT
          ${slotExpr(bucket)} AS time_slot,
          COUNT(*) AS total,
          ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin
        FROM monitor_snapshots
        WHERE ${where.join(' AND ')}
        GROUP BY time_slot
      ) o
      JOIN monitor_snapshots s
        ON ${slotExpr(bucket)} = o.time_slot
       AND ${where.map(w => w.replace('event_time', 's.event_time')).join(' AND ')}
      LEFT JOIN (
        SELECT
          ${slotExpr(bucket)} AS ts,
          country,
          asin,
          MAX(is_broken) AS any_broken
        FROM monitor_snapshots
        WHERE ${where.join(' AND ')}
        GROUP BY ts, country, asin
      ) d
        ON d.ts = o.time_slot
      GROUP BY o.time_slot, o.total, o.ratio_all_asin
      ORDER BY o.time_slot DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db2.query(sql, [...params, ...params, ...params, Number(pageSize) || 50, offset]);
    res.json({ data: rows, total: n });
  } catch (e) {
    console.error('analytics/ratio-table error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================================================
   5) 明细页 /analytics/snapshots
========================================================= */
router.get('/snapshots', async (req, res) => {
  try {
    let {
      from, to,
      country = 'ALL', // 兼容旧参数
      site = '',
      brand = '',
      status = '',
      batch = '',
      page = 1,
      pageSize = 50
    } = req.query;

    if (!from || !to) return res.status(400).json({ error: 'from / to 必填' });

    page = Number(page) || 1;
    pageSize = Number(pageSize) || 50;
    const offset = (page - 1) * pageSize;

    const countries = req.query.countries ?? country ?? 'ALL';

    const where = ['s.event_time BETWEEN ? AND ?'];
    const params = [from, to];
    if (countries && countries !== 'ALL') { where.push('s.country = ?'); params.push(countries); }
    if (site)                         { where.push('s.site = ?');    params.push(site); }
    if (brand)                        { where.push('s.amazon_brand = ?'); params.push(brand); }
    if (status)                       { where.push('s.status = ?');  params.push(status); }
    if (batch)                        { where.push('s.batch = ?');   params.push(Number(batch)); }

    const countSql = `
      SELECT COUNT(*) AS n
      FROM monitor_snapshots s
      WHERE ${where.join(' AND ')}
    `;
    const [[{ n }]] = await db2.query(countSql, params);

    const dataSql = `
      SELECT
        DATE_FORMAT(${bj('s.event_time')}, '%Y-%m-%d %H:%i:%s') AS time,
        s.country,
        s.site,
        s.brand           AS brand_my,
        s.amazon_brand,
        s.asin,
        s.status,
        s.chain_type,
        s.batch,
        ${PEAK_EXPR('s')} AS peak_flag,
        s.is_broken,

        (
          SELECT COUNT(DISTINCT DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H'))
          FROM monitor_snapshots h
          WHERE h.asin = s.asin
            AND h.country = s.country
            AND h.event_time BETWEEN ? AND ?
        ) AS batches,

        (
          SELECT COUNT(DISTINCT DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H'))
          FROM monitor_snapshots h
          WHERE h.asin = s.asin
            AND h.country = s.country
            AND h.event_time BETWEEN ? AND ?
            AND (${PEAK_EXPR('h')}) = 1
        ) AS peak_batches,

        (
          SELECT COUNT(DISTINCT DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H'))
          FROM monitor_snapshots h
          WHERE h.asin = s.asin
            AND h.country = s.country
            AND h.event_time BETWEEN ? AND ?
            AND (${PEAK_EXPR('h')}) = 0
        ) AS off_peak_batches

      FROM monitor_snapshots s
      WHERE ${where.join(' AND ')}
      ORDER BY s.event_time DESC
      LIMIT ? OFFSET ?
    `;

    const dataParams = [
      from, to,   // batches
      from, to,   // peak_batches
      from, to,   // off_peak_batches
      ...params,
      pageSize, offset
    ];

    const [rows] = await db2.query(dataSql, dataParams);

    const data = rows.map(r => {
      const batches = Number(r.batches || 0);
      const peakBatches = Number(r.peak_batches || 0);
      const offPeakBatches = Number(r.off_peak_batches || 0);
      return {
        time: r.time,
        country: r.country,
        site: r.site,
        brand_my: r.brand_my,
        amazon_brand: r.amazon_brand,
        asin: r.asin,
        status: r.status,
        chain_type: r.chain_type,
        batch: r.batch,
        peak_flag: Number(r.peak_flag || 0),
        is_broken: Number(r.is_broken || 0),
        batches,
        peak_batches: peakBatches,
        off_peak_batches: offPeakBatches,
        ratio_high_only: batches > 0 ? (peakBatches / batches) : 0,
        ratio_low_only:  batches > 0 ? (offPeakBatches / batches) : 0,
      };
    });

    const totalCount = data.length;
    const peakBroken = data.filter(s => s.peak_flag === 1 && s.is_broken === 1).length;
    const lowBroken  = data.filter(s => s.peak_flag === 0 && s.is_broken === 1).length;

    const global = {
      peakAbnormalRate: totalCount ? (peakBroken / totalCount) : 0,
      lowAbnormalRate:  totalCount ? (lowBroken  / totalCount) : 0,
    };

    res.json({ data, total: n, global });
  } catch (e) {
    console.error('analytics/snapshots error:', e);
    res.status(500).json({ error: '查询失败', detail: String(e && e.message || e) });
  }
});

/* =========================================================
   6) 批次列表（极简）/analytics/batches-min
========================================================= */
const BATCH_MIN_SORT_MAP = {
  batch: 's.batch',
  row_count: 'row_count',
};

router.get('/batches-min', async (req, res) => {
  try {
    let {
      from, to,
      country = 'ALL', // 兼容旧参数
      site = '',
      brand = '',
      status = '',
      keyword = '',
      page = 1,
      pageSize = 50,
      sortBy = 'batch',
      sortOrder = 'desc'
    } = req.query;

    if (!from || !to) {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 3600 * 1000);
      const fmt = d => d.toISOString().slice(0,19).replace('T',' ');
      from = fmt(start);
      to   = fmt(end);
    }

    const countries = req.query.countries ?? country ?? '';
    const { where, params } = buildWhere({ from, to, countries, site, brand, status });

    const kw = String(keyword || '').trim();
    if (kw) {
      where.push('(CAST(s.batch AS CHAR) LIKE ? OR s.site LIKE ? OR s.amazon_brand LIKE ?)');
      params.push(`%${kw}%`, `%${kw}%`, `%${kw}%`);
    }

    page = Math.max(1, Number(page) || 1);
    pageSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const offset = (page - 1) * pageSize;

    const cntSql = `
      SELECT COUNT(*) AS n
      FROM (
        SELECT DISTINCT s.batch
        FROM monitor_snapshots s
        WHERE ${where.join(' AND ')}
      ) t
    `;
    const [[{ n }]] = await db2.query(cntSql, params);

    const sortCol = BATCH_MIN_SORT_MAP[sortBy] || 's.batch';
    sortOrder = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    const dataSql = `
      SELECT
        s.batch,
        COUNT(*) AS row_count
      FROM monitor_snapshots s
      WHERE ${where.join(' AND ')}
      GROUP BY s.batch
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db2.query(dataSql, [...params, pageSize, offset]);

    res.json({ data: rows || [], total: n });
  } catch (e) {
    console.error('analytics/batches-min error:', e);
    res.status(500).json({ error: '查询失败' });
  }
});

router.delete('/batches-min', async (req, res) => {
  try {
    const batches = String(req.query.batches || '')
      .split(',').map(s => s.trim()).filter(Boolean).map(Number).filter(Number.isInteger);
    if (!batches.length) return res.status(400).json({ error: 'batches 不能为空' });

    const sql = `DELETE FROM monitor_snapshots WHERE batch IN (${batches.map(()=>'?').join(',')})`;
    const [ret] = await db2.query(sql, batches);
    res.json({ success: true, affectedRows: ret.affectedRows || 0 });
  } catch (e) {
    console.error('analytics/batches-min delete error:', e);
    res.status(500).json({ error: '删除失败' });
  }
});

/* =========================================================
   7) 导出 /analytics/export  (type: all | regions | period)
========================================================= */
router.get('/export', async (req, res) => {
  try {
    const { from, to, site = '', brand = '', type = '' } = req.query;
    const country = req.query.countries ?? req.query.country ?? 'ALL';
    if (!from || !to) return res.status(400).json({ error: 'from/to 必填' });

    const wb = new ExcelJS.Workbook();
    const title = `analytics_${from.replace(/\W/g,'')}_${to.replace(/\W/g,'')}`;

    // ---- A. 全部汇总 ----
    if (!type || type === 'all') {
      const sqlAll = `
        SELECT
          COUNT(*) AS total_links,
          SUM(is_broken) AS broken,
          ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
          (
            SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
            FROM (
              SELECT country, asin,
                     DATE_FORMAT(${bj('event_time')}, '%Y%m%d%H') AS slot,
                     MAX(is_broken) AS any_broken
              FROM monitor_snapshots
              WHERE event_time BETWEEN ? AND ?
              GROUP BY country, asin, slot
            ) z
          ) AS ratio_all_time,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) AS broken_high,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) AS broken_low,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END) AS rows_high,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END) AS rows_low
        FROM monitor_snapshots
        WHERE event_time BETWEEN ? AND ?
      `;
      const [[g]] = await db2.query(sqlAll, [from,to, from,to]);
      const global_peak_rate = g?.total_links ? +(g.broken_high / g.total_links * 100).toFixed(2) : 0;
      const global_low_rate  = g?.total_links ? +(g.broken_low  / g.total_links * 100).toFixed(2) : 0;

      const ws = wb.addWorksheet('Global');
      ws.addRow(['Period', `${from} ~ ${to}`]);
      ws.addRow([
        'total_links','broken',
        'ratio_all_asin(%)','ratio_all_time(%)',
        'broken_high','ratio_high(%)',
        'broken_low','ratio_low(%)',
        'global_peak_rate(%)','global_low_rate(%)'
      ]);
      ws.addRow([
        Number(g?.total_links||0),
        Number(g?.broken||0),
        Number(g?.ratio_all_asin||0),
        Number(g?.ratio_all_time||0),
        Number(g?.broken_high||0),
        g?.rows_high ? +(g.broken_high/g.rows_high*100).toFixed(2) : 0,
        Number(g?.broken_low||0),
        g?.rows_low ? +(g.broken_low/g.rows_low*100).toFixed(2) : 0,
        global_peak_rate,
        global_low_rate
      ]);
      ws.columns.forEach(c => { c.width = 18; });
    }

    // ---- B. US / EU 区域 ----
    if (!type || type === 'regions') {
      const sqlRegion = `
        SELECT
          o.region,
          o.total_links,
          o.broken,
          o.ratio_all_asin,
          (
            SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
            FROM (
              SELECT
                h.country,
                h.asin,
                DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H') AS slot,
                MAX(h.is_broken) AS any_broken
              FROM monitor_snapshots h
              WHERE h.event_time BETWEEN ? AND ?
                AND (CASE WHEN h.country='US' THEN 'US' ELSE 'EU' END) = o.region
              GROUP BY h.country, h.asin, slot
            ) z
          ) AS ratio_all_time,
          o.broken_high,
          o.rows_high,
          o.broken_low,
          o.rows_low
        FROM (
          SELECT
            CASE WHEN country='US' THEN 'US' ELSE 'EU' END AS region,
            COUNT(*) AS total_links,
            SUM(is_broken) AS broken,
            ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
            SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) AS broken_high,
            SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) AS broken_low,
            SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END) AS rows_high,
            SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END) AS rows_low
          FROM monitor_snapshots
          WHERE event_time BETWEEN ? AND ?
          GROUP BY region
        ) o
      `;
      const [rows] = await db2.query(sqlRegion, [from,to, from,to]);

      const ws = wb.addWorksheet('US_EU');
      ws.addRow(['Period', `${from} ~ ${to}`]);
      ws.addRow([
        'region','total_links','broken',
        'ratio_all_asin(%)','ratio_all_time(%)',
        'broken_high','ratio_high(%)',
        'broken_low','ratio_low(%)',
      ]);

      rows.forEach(r => {
        ws.addRow([
          r.region,
          Number(r.total_links||0),
          Number(r.broken||0),
          Number(r.ratio_all_asin||0),
          Number(r.ratio_all_time||0),
          Number(r.broken_high||0),
          r.rows_high ? +(r.broken_high/r.rows_high*100).toFixed(2) : 0,
          Number(r.broken_low||0),
          r.rows_low ? +(r.broken_low/r.rows_low*100).toFixed(2) : 0,
        ]);
      });
      ws.columns.forEach(c => { c.width = 18; });
    }

    // ---- C. 周期汇总（受筛选影响）----
    if (!type || type === 'period') {
      const { where, params } = buildWhere({ from,to, countries: country, site, brand, status: '' });
      const sql = `
        SELECT
          s.country, s.site, s.amazon_brand,
          COUNT(*) AS total_links,
          SUM(is_broken) AS broken,
          ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
          (
            SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
            FROM (
              SELECT
                h.country, h.asin,
                DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H') AS slot,
                MAX(h.is_broken) AS any_broken
              FROM monitor_snapshots h
              WHERE h.event_time BETWEEN ? AND ?
                AND h.country      = s.country
                AND h.site         = s.site
                AND h.amazon_brand = s.amazon_brand
              GROUP BY h.country, h.asin, slot
            ) z
          ) AS ratio_all_time,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN is_broken ELSE 0 END) AS broken_high,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN is_broken ELSE 0 END) AS broken_low,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=1 THEN 1 ELSE 0 END) AS rows_high,
          SUM(CASE WHEN (${IS_PEAK_EXPR()})=0 THEN 1 ELSE 0 END) AS rows_low
        FROM monitor_snapshots s
        WHERE ${where.join(' AND ')}
        GROUP BY s.country, s.site, s.amazon_brand
        ORDER BY s.country, s.site, s.amazon_brand
      `;
      const [rows] = await db2.query(sql, [from, to, ...params]);

      const ws = wb.addWorksheet('PeriodSummary');
      ws.addRow(['Period', `${from} ~ ${to}`]);
      ws.addRow([
        'country','site','amazon_brand',
        'total_links','broken',
        'ratio_all_asin(%)','ratio_all_time(%)',
        'broken_high','ratio_high(%)',
        'broken_low','ratio_low(%)'
      ]);

      rows.forEach(r=>{
        ws.addRow([
          r.country, r.site, r.amazon_brand,
          Number(r.total_links||0),
          Number(r.broken||0),
          Number(r.ratio_all_asin||0),
          Number(r.ratio_all_time||0),
          Number(r.broken_high||0),
          r.rows_high ? +(r.broken_high/r.rows_high*100).toFixed(2) : 0,
          Number(r.broken_low||0),
          r.rows_low ? +(r.broken_low/r.rows_low*100).toFixed(2) : 0
        ]);
      });
      ws.columns.forEach(c => { c.width = 18; });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${title}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('analytics/export error:', e);
    res.status(500).json({ error: '导出失败' });
  }
});

module.exports = router;
