// routes/comp-history.js
const express = require('express');
const router = express.Router();
const db3 = require('../utils/db3');
const xlsx = require('xlsx');

/** 构造 WHERE 语句与参数（列表、导出共用） */
function buildWhere({ from = '', to = '', country = 'ALL', status = '', q = '',  batch = '', group_id = '', }) {
  const where = [];
  const params = [];

  // 时间可选（没传=全部时间）
  if (from && to) {
    where.push('s.event_time BETWEEN ? AND ?');
    params.push(from, to);
  }

  if (country && country !== 'ALL') {
    where.push('s.country = ?');
    params.push(country);
  }

  if (status === 'broken') where.push('s.is_broken = 1');
  else if (status === 'ok') where.push('s.is_broken = 0');

  if (batch)   { where.push(`s.batch=?`); params.push(batch); }          // ← 新增
  if (group_id){ where.push(`s.group_id=?`); params.push(group_id); }    // ← 新增

  if (q) {
    const kw = `%${q}%`;
    // 关键字：ASIN / 父体ASIN / 品牌(亚马逊) / 站点 / 竞品组名
    where.push('(s.asin LIKE ? OR s.parent_asin LIKE ? OR s.amazon_brand LIKE ? OR s.site LIKE ? OR g.name LIKE ?)');
    params.push(kw, kw, kw, kw, kw);
  }

  return { whereSQL: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** 列表 */
router.get('/', async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, parseInt(req.query.pageSize, 10) || 50);
    const limit    = pageSize;
    const offset   = (page - 1) * limit;

    const { whereSQL, params } = buildWhere(req.query);

    // 计数（带 JOIN，便于按组名/站点等过滤）
    const [[{ cnt }]] = await db3.query(
      `
      SELECT COUNT(*) AS cnt
      FROM snapshots s
      LEFT JOIN comp_asins  ca ON ca.asin = s.asin
      LEFT JOIN comp_groups g  ON g.id   = ca.group_id
      ${whereSQL}
      `,
      params
    );

    // 列表
    const [list] = await db3.query(
    `
    SELECT
        DATE_FORMAT(CONVERT_TZ(s.event_time, '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s') AS time,
        s.country,
        s.site,
        s.asin,
        s.parent_asin,               -- ✅ 加上父体
        s.amazon_brand,
        s.is_broken,
        s.chain_type,
        s.batch,
        s.group_name,
        g.name AS group_name         -- 可选：竞品组名
    FROM snapshots s
    LEFT JOIN comp_asins  ca ON ca.asin = s.asin
    LEFT JOIN comp_groups g  ON g.id   = ca.group_id
    ${whereSQL}
    ORDER BY s.event_time DESC, s.id DESC
    LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
    );


    return res.json({ total: Number(cnt || 0), data: list || [] });
  } catch (e) {
    console.error('[comp-history] list error:', e);
    return res.status(500).json({ error: 'query_failed' });
  }
});

/** 导出 Excel */
router.get('/export', async (req, res) => {
  try {
    const { whereSQL, params } = buildWhere(req.query);

    // 导出行数上限
    const MAX = 50000;

    const [rows] = await db3.query(
    `
    SELECT
        s.country,
        s.asin,
        s.parent_asin,  -- ✅ 加上父体
        DATE_FORMAT(CONVERT_TZ(s.event_time, '+00:00', '+08:00'), '%Y-%m-%d %H:%i:%s') AS time,
        s.is_broken,
        s.chain_type,
        s.batch
    FROM snapshots s
    ${whereSQL}
    ORDER BY s.event_time DESC, s.id DESC
    LIMIT ${MAX}
    `,
    params
    );


    // 表头与数据
    const header = ['国家', 'ASIN', '父体ASIN', '时间', '变体状态', '主链/副评', '批次'];
    const data = rows.map(r => ([
    r.country,
    r.asin,
    r.parent_asin || '',
    r.time,
    Number(r.is_broken) ? '异常' : '正常',
    r.chain_type === 1 ? '主链' : (r.chain_type === 2 ? '副评' : ''),
    r.batch || ''
    ]));


    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet([header, ...data]);
    xlsx.utils.book_append_sheet(wb, ws, 'History');

    const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename=comp_history_${Date.now()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buf);
  } catch (e) {
    console.error('[comp-history] export error:', e);
    return res.status(500).json({ error: 'export_failed' });
  }
});

module.exports = router;
