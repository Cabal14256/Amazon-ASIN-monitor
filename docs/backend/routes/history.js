// routes/history.js
const express = require('express');
const router = express.Router();

// 注意：这里保持你原来的 db 路径
const db = require('../db'); // 如果你实际在 utils 里，就改成 '../utils/db'
const { getVariantData } = require('../services/variantMonitor');
const ExcelJS = require('exceljs');

const MARKETPLACE_IDS = {
  US: 'ATVPDKIKX0DER',
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  ES: 'A1RKKUPIHCS9HS',
  IT: 'APJ6JRA9NG5V4',
};

/* =========================
 * 1. 获取历史记录（分页+筛选）
 * ========================= */
router.get('/', async (req, res) => {
  try {
    const { country, asin, page = 1, pageSize = 20 } = req.query;

    let sql = `
      SELECT
        country,
        asin,
        DATE_FORMAT(event_time, '%Y-%m-%d %H:%i:%s') AS event_time,
        status,
        parent_title,
        chain_type,
        batch
      FROM variant_history
      WHERE 1=1`;
    let countSql = 'SELECT COUNT(*) AS total FROM variant_history WHERE 1=1';

    const params = [];
    const countParams = [];

    if (country) {
      sql += ' AND country=?';
      countSql += ' AND country=?';
      params.push(country);
      countParams.push(country);
    }
    if (asin) {
      sql += ' AND asin=?';
      countSql += ' AND asin=?';
      params.push(asin);
      countParams.push(asin);
    }

    sql += ' ORDER BY event_time DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (page - 1) * pageSize);

    const [rows] = await db.query(sql, params);
    const [countRes] = await db.query(countSql, countParams);

    res.json({ data: rows, total: countRes[0].total });
  } catch (e) {
    console.error('history list error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================
 * 2. 清空历史记录
 * ========================= */
router.post('/clear', async (req, res) => {
  try {
    await db.query('TRUNCATE TABLE variant_history');
    const operator = req.body.operator || '未知';
    await db.query(
      'INSERT INTO admin_logs (operator, action, action_time, detail) VALUES (?, ?, NOW(), ?)',
      [operator, '清除历史', '清空所有历史记录']
    );
    res.json({ success: true });
  } catch (e) {
    console.error('history clear error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================
 * 3. 导出历史记录为 Excel
 * ========================= */
router.get('/export', async (req, res) => {
  try {
    const { country = '', asin = '', start = '', end = '' } = req.query;

    const conds = [];
    const params = [];
    if (country) { conds.push('vh.country = ?'); params.push(country); }
    if (asin)    { conds.push('vh.asin LIKE ?'); params.push(`%${asin}%`); }
    if (start)   { conds.push('vh.event_time >= ?'); params.push(`${start} 00:00:00`); }
    if (end)     { conds.push('vh.event_time <= ?'); params.push(`${end} 23:59:59`); }

    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const [rows] = await db.query(
      `SELECT
         vh.country,
         vh.asin,
         DATE_FORMAT(vh.event_time, '%Y-%m-%d %H:%i:%s') AS event_time,
         vh.status,
         vh.parent_title,
         vh.chain_type,
         vh.batch,
         vg.name AS group_name
       FROM variant_history vh
       LEFT JOIN asins a
              ON a.asin = vh.asin
       LEFT JOIN variant_groups vg
              ON vg.id = a.variant_id
             AND vg.country = vh.country
       ${whereSql}
       ORDER BY vh.event_time DESC`,
      params
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('历史记录');

    sheet.columns = [
      { header: '国家',       key: 'country',      width: 8  },
      { header: 'ASIN',       key: 'asin',         width: 16 },
      { header: '被拆时间',   key: 'event_time',   width: 20 },
      { header: '变体状态',   key: 'status',       width: 10 },
      { header: '父体ASIN',   key: 'parent_title', width: 38 },
      { header: '主链/副评',   key: 'chain_type',   width: 10 },
      { header: '批次',       key: 'batch',        width: 8  },
      { header: '变体组名称', key: 'group_name',   width: 30 },
    ];

    const data = rows.map(r => ({
      ...r,
      chain_type:
        Number(r.chain_type) === 1 ? '主链' :
        Number(r.chain_type) === 2 ? '副评' : ''
    }));
    sheet.addRows(data);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=history_${Date.now()}.xlsx`
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('history/export error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================
 * 4. 批量查询变体状态（手动查询）
 *    —— 在这里写入 parent_title & chain_type
 * ========================= */
router.post('/query', async (req, res) => {
  try {
    const { country: userInputCountry, asins } = req.body;

    if (!userInputCountry || !Array.isArray(asins) || !asins.length) {
      return res.json({ success: false, msg: 'country 或 asins 参数缺失' });
    }

    const country = String(userInputCountry).toUpperCase();

    // 当前最大批次
    const [rowsMax] = await db.query('SELECT MAX(batch) AS maxBatch FROM variant_history');
    const batch = (rowsMax[0]?.maxBatch || 0) + 1;

    for (const asinRaw of asins) {
      const asin = String(asinRaw || '').trim().toUpperCase();
      if (!asin) continue;

      // 一次性拿到：是否有变体 + 父体 ASIN
      const { hasVariation, parentAsin } = await getVariantData(asin, country);
      const status = hasVariation ? '恢复' : '异常';

      // 取主链/副评
      const [[row]] = await db.query(
        `SELECT a.chain_type
           FROM asins a
           JOIN variant_groups vg ON vg.id = a.variant_id
          WHERE a.asin = ? AND vg.country = ?
          LIMIT 1`,
        [asin, country]
      );
      const chainType = row?.chain_type ?? null;

      // 写入历史（关键：parent_title = parentAsin）
      await db.query(
        `INSERT INTO variant_history
           (country, asin, event_time, status, parent_title, chain_type, batch)
         VALUES (?, ?, NOW(), ?, ?, ?, ?)`,
        [country, asin, status, parentAsin || null, chainType, batch]
      );
    }

    res.json({ success: true, batch });
  } catch (e) {
    console.error('批量查询异常:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
