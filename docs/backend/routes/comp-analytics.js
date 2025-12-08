// backend/routes/comp-analytics.js
const express = require('express');
const router = express.Router();
const db3 = require('../utils/db3'); // ✅ 新库 asin_competitor 的连接

// === 你的库里 event_time 已是北京时间（+08:00），无需转换 ===
const DB_TIME_IS_UTC = false;
function bj(expr = 'event_time') {
  return DB_TIME_IS_UTC ? `CONVERT_TZ(${expr}, '+00:00', '+08:00')` : expr;
}

// ---------------- 高峰判定（与现有一致） ----------------
const IS_PEAK_BJ = (() => {
  const H = `HOUR(${bj('event_time')})`;
  return `
    CASE
      WHEN country='US' AND (
        (${H} BETWEEN 2 AND 5) OR (${H} BETWEEN 9 AND 11)
      ) THEN 1
      WHEN country='UK' AND (
        (${H} BETWEEN 22 AND 23) OR (${H} BETWEEN 0 AND 1) OR (${H} BETWEEN 3 AND 5)
      ) THEN 1
      WHEN country IN ('DE','FR','ES','IT') AND (
        (${H} BETWEEN 20 AND 23) OR (${H} BETWEEN 2 AND 4)
      ) THEN 1
      ELSE 0
    END
  `;
})();
function PEAK_EXPR(alias = 's') {
  const H = `HOUR(${bj(`${alias}.event_time`)})`;
  return `
    CASE
      WHEN ${alias}.country='US' AND (
        (${H} BETWEEN 2 AND 5) OR (${H} BETWEEN 9 AND 11)
      ) THEN 1
      WHEN ${alias}.country='UK' AND (
        (${H} BETWEEN 22 AND 23) OR (${H} BETWEEN 0 AND 1) OR (${H} BETWEEN 3 AND 5)
      ) THEN 1
      WHEN ${alias}.country IN ('DE','FR','ES','IT') AND (
        (${H} BETWEEN 20 AND 23) OR (${H} BETWEEN 2 AND 4)
      ) THEN 1
      ELSE 0
    END
  `;
}

function parseList(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}
function buildWhere({ from, to, countries, site, brand, status }) {
  if (!from || !to) throw new Error('from/to 必填');
  const where = ['event_time BETWEEN ? AND ?'];
  const params = [from, to];

  const listCountries = parseList(countries);
  if (listCountries.length && !(listCountries.length === 1 && listCountries[0] === 'ALL')) {
    where.push(`country IN (${listCountries.map(() => '?').join(',')})`);
    params.push(...listCountries);
  }
  if (site)  { where.push('site = ?');           params.push(site.trim()); }
  if (brand) { where.push('amazon_brand = ?');   params.push(brand.trim()); }
  if (status){ where.push('status = ?');         params.push(status.trim()); }
  return { where, params };
}
function slotExpr(interval) {
  return interval === 'day'
    ? `DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d 00:00:00')`
    : `DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:00:00')`;
}

// ✅ 使用 asin_competitor 库里的 snapshots 表
const T = 'snapshots';

/* =========================
   1) 折线图 /ratio
========================= */
router.get('/ratio', async (req, res) => {
  try {
    const { from, to, countries = '', sites = '', brands = '', interval = 'hour' } = req.query;
    const { where, params } = buildWhere({ from, to, countries, site: sites, brand: brands, status: '' });

    const slot = interval === 'day'
      ? `DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d 00:00:00')`
      : `DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:00:00')`;

    const dedupAsinKey = interval === 'day'
      ? `CONCAT(country,'|',asin,'|',DATE_FORMAT(${bj('event_time')}, '%Y%m%d'))`
      : `CONCAT(country,'|',asin,'|',DATE_FORMAT(${bj('event_time')}, '%Y%m%d%H'))`;
    const dedupHourKey = `CONCAT(country,'|',asin,'|',DATE_FORMAT(${bj('event_time')}, '%Y%m%d%H'))`;

    const sql = `
      SELECT
        ${slot} AS time_slot,
        SUM(is_broken)                        AS broken_snap,
        COUNT(*)                              AS total_snap,
        ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
        COUNT(DISTINCT ${dedupAsinKey}) AS total_asin_dedup,
        COUNT(DISTINCT CASE WHEN is_broken=1 THEN ${dedupAsinKey} END) AS broken_asin_dedup,
        ROUND(
          COUNT(DISTINCT CASE WHEN is_broken=1 THEN ${dedupAsinKey} END)
          / NULLIF(COUNT(DISTINCT ${dedupAsinKey}),0) * 100, 2
        ) AS ratio_all_time,
        COUNT(DISTINCT ${dedupHourKey}) AS total_hour_dedup,
        COUNT(DISTINCT CASE WHEN is_broken=1 THEN ${dedupHourKey} END) AS broken_hour_dedup
      FROM ${T}
      WHERE ${where.join(' AND ')}
      GROUP BY time_slot
      ORDER BY time_slot
    `;
    const [rows] = await db3.query(sql, params);

    const data = rows.map(r => ({
      time: r.time_slot,
      broken: Number(r.broken_snap || 0),
      total: Number(r.total_snap || 0),
      ratio_all_asin: Number(r.ratio_all_asin || 0),
      ratio_all_time: Number(r.ratio_all_time || 0),
      ratio_duration_day:
        interval === 'day'
          ? ( Number(r.total_hour_dedup || 0)
              ? Number(((r.broken_hour_dedup || 0) / r.total_hour_dedup * 100).toFixed(2))
              : 0)
          : 0,
    }));
    res.json({ data });
  } catch (e) {
    console.error('comp-analytics/ratio error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================
   2) 固定看板 /fixed-boards
========================= */
router.get('/fixed-boards', async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from / to 必填' });

    const sqlAll = `
      SELECT
        MIN(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS from_time,
        MAX(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS to_time,
        COUNT(*) AS total_links,
        ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
        (
          SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
          FROM (
            SELECT country, asin,
                   DATE_FORMAT(${bj('event_time')}, '%Y%m%d%H') AS slot,
                   MAX(is_broken) AS any_broken
            FROM ${T}
            WHERE event_time BETWEEN ? AND ?
            GROUP BY country, asin, slot
          ) z
        ) AS ratio_all_time,
        SUM(CASE WHEN (${IS_PEAK_BJ})=1 THEN is_broken ELSE 0 END) AS broken_high,
        SUM(CASE WHEN (${IS_PEAK_BJ})=0 THEN is_broken ELSE 0 END) AS broken_low,
        SUM(CASE WHEN (${IS_PEAK_BJ})=1 THEN 1 ELSE 0 END) AS rows_high,
        SUM(CASE WHEN (${IS_PEAK_BJ})=0 THEN 1 ELSE 0 END) AS rows_low
      FROM ${T}
      WHERE event_time BETWEEN ? AND ?
    `;
    const [[all]] = await db3.query(sqlAll, [from, to, from, to]);

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
            SELECT h.country, h.asin,
                   DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H') AS slot,
                   MAX(h.is_broken) AS any_broken
            FROM ${T} h
            WHERE h.event_time BETWEEN ? AND ?
              AND (CASE WHEN h.country='US' THEN 'US' ELSE 'EU' END) = o.region
            GROUP BY h.country, h.asin, slot
          ) z
        ) AS ratio_all_time,
        o.broken_high, o.broken_low
      FROM (
        SELECT
          CASE WHEN country='US' THEN 'US' ELSE 'EU' END AS region,
          MIN(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS from_time,
          MAX(DATE_FORMAT(${bj('event_time')}, '%Y-%m-%d %H:%i:%s')) AS to_time,
          COUNT(*) AS total_links,
          ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
          SUM(CASE WHEN (${IS_PEAK_BJ})=1 THEN is_broken ELSE 0 END) AS broken_high,
          SUM(CASE WHEN (${IS_PEAK_BJ})=0 THEN is_broken ELSE 0 END) AS broken_low
        FROM ${T}
        WHERE event_time BETWEEN ? AND ?
        GROUP BY region
      ) o
    `;
    const [regions] = await db3.query(sqlRegion, [from,to, from,to]);

    const globalPeakRate = all?.total_links ? Number(((all.broken_high || 0) / all.total_links * 100).toFixed(2)) : 0;
    const globalLowRate  = all?.total_links ? Number(((all.broken_low  || 0) / all.total_links * 100).toFixed(2)) : 0;

    res.json({
      all: {
        period: `${all?.from_time || ''} ~ ${all?.to_time || ''}`,
        total_links: Number(all?.total_links || 0),
        ratio_all_asin: Number(all?.ratio_all_asin || 0),
        ratio_all_time: Number(all?.ratio_all_time || 0),
        ratio_high: all?.rows_high ? Number((all.broken_high / all.rows_high * 100).toFixed(2)) : 0,
        ratio_low:  all?.rows_low  ? Number((all.broken_low  / all.rows_low  * 100).toFixed(2)) : 0,
        global_peak_rate: globalPeakRate,
        global_low_rate:  globalLowRate,
      },
      regions: (regions || []).map(r => {
        const gPeak = r.total_links ? Number(((r.broken_high || 0) / r.total_links * 100).toFixed(2)) : 0;
        const gLow  = r.total_links ? Number(((r.broken_low  || 0) / r.total_links * 100).toFixed(2)) : 0;
        return {
          region: r.region,
          period: `${r.from_time} ~ ${r.to_time}`,
          total_links: Number(r.total_links || 0),
          ratio_all_asin: Number(r.ratio_all_asin || 0),
          ratio_all_time: Number(r.ratio_all_time || 0),
          global_peak_rate: gPeak,
          global_low_rate:  gLow,
        };
      }),
    });
  } catch (e) {
    console.error('comp-analytics/fixed-boards error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================
   3) 周期汇总 /period-summary
========================= */
router.get('/period-summary', async (req, res) => {
  try {
    const { from, to, country = 'ALL', site = '', brand = '' } = req.query;
    const { where, params } = buildWhere({ from, to, countries: country, site, brand, status: '' });

    const sql = `
      SELECT
        s.country, s.site, s.amazon_brand,
        MIN(DATE_FORMAT(${bj('s.event_time')}, '%Y-%m-%d %H:%i:%s')) AS from_time,
        MAX(DATE_FORMAT(${bj('s.event_time')}, '%Y-%m-%d %H:%i:%s')) AS to_time,
        COUNT(*) AS total_links,
        ROUND(SUM(s.is_broken)/COUNT(*)*100, 2) AS ratio_all_asin,
        (
          SELECT ROUND(SUM(any_broken)/COUNT(*)*100, 2)
          FROM (
            SELECT h.country, h.asin,
                   DATE_FORMAT(${bj('h.event_time')}, '%Y%m%d%H') AS slot,
                   MAX(h.is_broken) AS any_broken
            FROM ${T} h
            WHERE h.event_time BETWEEN ? AND ?
              AND h.country = s.country
              AND h.site = s.site
              AND h.amazon_brand = s.amazon_brand
            GROUP BY h.country, h.asin, slot
          ) z
        ) AS ratio_all_time,
        SUM(CASE WHEN (${IS_PEAK_BJ})=1 THEN s.is_broken ELSE 0 END) AS broken_high,
        SUM(CASE WHEN (${IS_PEAK_BJ})=0 THEN s.is_broken ELSE 0 END) AS broken_low
      FROM ${T} s
      WHERE ${where.join(' AND ')}
      GROUP BY s.country, s.site, s.amazon_brand
      ORDER BY s.country, s.site, s.amazon_brand
    `;
    const [rows] = await db3.query(sql, [...params, from, to]);

    const data = rows.map(r => ({
      country: r.country,
      site: r.site,
      brand: r.amazon_brand,
      period: `${r.from_time} ~ ${r.to_time}`,
      total_links: Number(r.total_links || 0),
      ratio_all_asin: Number(r.ratio_all_asin || 0),
      ratio_all_time: Number(r.ratio_all_time || 0),
      ratio_high: r.total_links ? Number(((r.broken_high || 0) / r.total_links * 100).toFixed(2)) : 0,
      ratio_low:  r.total_links ? Number(((r.broken_low  || 0) / r.total_links * 100).toFixed(2)) : 0,
    }));
    res.json({ data });
  } catch (e) {
    console.error('comp-analytics/period-summary error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================
   4) 分页表 /ratio-table
========================= */
router.get('/ratio-table', async (req, res) => {
  try {
    const { from, to, country = 'ALL', site = '', brand = '', bucket = 'hour', page = 1, pageSize = 50 } = req.query;
    const { where, params } = buildWhere({ from, to, countries: country, site, brand, status: '' });

    const offset = (Number(page) > 0 ? Number(page) - 1 : 0) * (Number(pageSize) || 50);
    const cntSql = `SELECT COUNT(DISTINCT ${slotExpr(bucket)}) AS n FROM ${T} WHERE ${where.join(' AND ')}`;
    const [[{ n }]] = await db3.query(cntSql, params);

    const sql = `
      SELECT
        o.time_slot,
        o.total,
        o.ratio_all_asin,
        ROUND(COALESCE(SUM(d.any_broken)/NULLIF(COUNT(d.ts),0),0)*100, 2) AS ratio_all_time,
        ROUND(SUM(CASE WHEN (${IS_PEAK_BJ})=1 THEN is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_BJ})=1 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_high,
        ROUND(SUM(CASE WHEN (${IS_PEAK_BJ})=0 THEN is_broken ELSE 0 END) /
              NULLIF(SUM(CASE WHEN (${IS_PEAK_BJ})=0 THEN 1 ELSE 0 END),0) * 100, 2) AS ratio_low
      FROM (
        SELECT
          ${slotExpr(bucket)} AS time_slot,
          COUNT(*) AS total,
          ROUND(SUM(is_broken)/COUNT(*)*100, 2) AS ratio_all_asin
        FROM ${T}
        WHERE ${where.join(' AND ')}
        GROUP BY time_slot
      ) o
      JOIN ${T} s
        ON ${slotExpr(bucket)} = o.time_slot
       AND ${where.map(w => w.replace('event_time', 's.event_time')).join(' AND ')}
      LEFT JOIN (
        SELECT
          ${slotExpr(bucket)} AS ts,
          country,
          asin,
          MAX(is_broken) AS any_broken
        FROM ${T}
        WHERE ${where.join(' AND ')}
        GROUP BY ts, country, asin
      ) d
        ON d.ts = o.time_slot
      GROUP BY o.time_slot, o.total, o.ratio_all_asin
      ORDER BY o.time_slot DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db3.query(sql, [...params, ...params, ...params, Number(pageSize) || 50, offset]);
    res.json({ data: rows, total: n });
  } catch (e) {
    console.error('comp-analytics/ratio-table error:', e);
    res.status(500).json({ error: '统计失败' });
  }
});

/* =========================
   5) 明细 /snapshots
========================= */
router.get('/snapshots', async (req, res) => {
  try {
    let { from, to, country = 'ALL', site = '', brand = '', status = '', page = 1, pageSize = 50 } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from / to 必填' });

    const norm = v => (typeof v === 'string' ? v.trim() : v);
    const empty = v => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    country = norm(country); if (!country || country === 'ALL') country = '';
    site   = norm(site);     if (empty(site))   site = '';
    brand  = norm(brand);    if (empty(brand))  brand = '';
    status = norm(status);   if (empty(status)) status = '';

    page = Math.max(1, Number(page) || 1);
    pageSize = Math.min(200, Math.max(1, Number(pageSize) || 50));
    const offset = (page - 1) * pageSize;

    const where = ['s.event_time BETWEEN ? AND ?'];
    const params = [from, to];
    if (country) { where.push('s.country = ?');      params.push(country); }
    if (site)    { where.push('s.site = ?');         params.push(site); }
    if (brand)   { where.push('s.amazon_brand = ?'); params.push(brand); }
    if (status)  { where.push('s.status = ?');       params.push(status); }

    const cntSql = `SELECT COUNT(*) AS n FROM ${T} s WHERE ${where.join(' AND ')}`;
    const [[{ n }]] = await db3.query(cntSql, params);

    const dataSql = `
      SELECT
        DATE_FORMAT(${bj('s.event_time')}, '%Y-%m-%d %H:%i:%s') AS time,
        s.country, s.site, s.amazon_brand, s.asin, s.status, s.chain_type, s.batch,
        ${PEAK_EXPR('s')} AS peak_flag, s.is_broken
      FROM ${T} s
      WHERE ${where.join(' AND ')}
      ORDER BY s.event_time DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db3.query(dataSql, [...params, pageSize, offset]);
    res.json({ data: rows || [], total: n });
  } catch (e) {
    console.error('comp-analytics/snapshots error:', e);
    res.status(500).json({ error: '查询失败' });
  }
});

module.exports = router;
