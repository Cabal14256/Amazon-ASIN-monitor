// backend/routes/comp-groups.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const xlsx = require('xlsx');
const db3 = require('../utils/db3');              // 竞品库（asin_competitor）
const { runCompSnapshot } = require('../services/compMonitor');

/* =========================
 * 工具：把 groupId -> asins 映射回组
 * ========================= */
function attachAsins(groups, asins) {
  const map = new Map(groups.map(g => [g.id, { ...g, asins: [] }]));
  for (const a of asins) {
    const g = map.get(a.group_id);
    if (g) {
      g.asins.push({
        id: a.id,
        asin: a.asin,
        brand: a.brand,
        site: a.site,
        amazon_brand: a.amazon_brand,
        chain_type: a.chain_type,
        is_broken: !!a.is_broken,
      });
    }
  }
  return Array.from(map.values());
}

/* =========================
 * 列表：GET /api/comp-groups?country=US|UK|...|'' 
 * ========================= */
router.get('/', async (req, res) => {
  const { country = '' } = req.query;
  try {
    const [groups] = await db3.query(
      country
        ? 'SELECT id,name,country,feishu_enabled FROM comp_groups WHERE country=? ORDER BY id DESC'
        : 'SELECT id,name,country,feishu_enabled FROM comp_groups ORDER BY id DESC',
      country ? [country] : []
    );
    if (!groups.length) return res.json([]);

    const ids = groups.map(g => g.id);
    const [asins] = await db3.query(
      `SELECT id,group_id,asin,brand,site,amazon_brand,chain_type,is_broken
         FROM comp_asins
        WHERE group_id IN (${ids.map(() => '?').join(',')})
        ORDER BY id DESC`,
      ids
    );
    res.json(attachAsins(groups, asins));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'load_failed' });
  }
});

/* =========================
 * 新建组：POST /api/comp-groups {name,country}
 * ========================= */
router.post('/', async (req, res) => {
  const { name, country } = req.body || {};
  if (!name || !country) return res.status(400).json({ error: 'name/country required' });
  try {
    const [ret] = await db3.query(
      'INSERT INTO comp_groups (name,country,feishu_enabled,created_at) VALUES (?,?,1,NOW())',
      [name.trim(), country.trim().toUpperCase()]
    );
    res.json({ id: ret.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'create_failed' });
  }
});

/* =========================
 * 改组名：PUT /api/comp-groups/:id {name}
 * ========================= */
router.put('/:id', async (req, res) => {
  const { name } = req.body || {};
  const { id } = req.params;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    await db3.query('UPDATE comp_groups SET name=? WHERE id=?', [name.trim(), id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'update_failed' });
  }
});

/* =========================
 * 删组：DELETE /api/comp-groups/:id
 * ========================= */
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await db3.query('DELETE FROM comp_asins WHERE group_id=?', [id]);
    await db3.query('DELETE FROM comp_groups WHERE id=?', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'delete_failed' });
  }
});

/* =========================
 * 批量删组：POST /api/comp-groups/delete-selected {ids:[]}
 * ========================= */
router.post('/delete-selected', async (req, res) => {
  const { ids = [] } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.json({ success: true });
  try {
    await db3.query(`DELETE FROM comp_asins  WHERE group_id IN (${ids.map(()=>'?').join(',')})`, ids);
    await db3.query(`DELETE FROM comp_groups WHERE id       IN (${ids.map(()=>'?').join(',')})`, ids);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'bulk_delete_failed' });
  }
});

/* =========================
 * 组内加 ASIN：POST /api/comp-groups/:groupId/asins {asin,site,brand,chainType}
 * ========================= */
router.post('/:groupId/asins', async (req, res) => {
  const { groupId } = req.params;
  const { asin, site = '', brand = '', chainType = null } = req.body || {};
  if (!asin) return res.status(400).json({ error: 'asin required' });

  try {
    const [ret] = await db3.query(
      `INSERT INTO comp_asins (group_id,asin,site,brand,chain_type,is_broken,created_at)
       VALUES (?,?,?,?,NULL,0,NOW())`,
      [groupId, asin.trim().toUpperCase(), site.trim(), brand.trim()]
    );
    if (chainType === 1 || chainType === 2) {
      await db3.query('UPDATE comp_asins SET chain_type=? WHERE id=?', [chainType, ret.insertId]);
    }
    res.json({ id: ret.insertId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'asin_add_failed' });
  }
});

/* =========================
 * 删 ASIN：DELETE /api/comp-groups/:groupId/asins/:asinId
 * ========================= */
router.delete('/:groupId/asins/:asinId', async (req, res) => {
  const { asinId } = req.params;
  try {
    await db3.query('DELETE FROM comp_asins WHERE id=?', [asinId]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'asin_delete_failed' });
  }
});

/* =========================
 * 改链路：PATCH /api/comp-groups/asin/:asinId/chain-type {chainType}
 * ========================= */
router.patch('/asin/:asinId/chain-type', async (req, res) => {
  const { asinId } = req.params;
  const { chainType = null } = req.body || {};
  try {
    await db3.query('UPDATE comp_asins SET chain_type=? WHERE id=?', [chainType, asinId]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'chain_update_failed' });
  }
});

/* =========================
 * 飞书开关：PUT /api/comp-groups/:id/feishu {feishu_enabled}
 * ========================= */
router.put('/:id/feishu', async (req, res) => {
  const { id } = req.params;
  const { feishu_enabled } = req.body || {};
  try {
    await db3.query('UPDATE comp_groups SET feishu_enabled=? WHERE id=?', [feishu_enabled ? 1 : 0, id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'feishu_update_failed' });
  }
});

/* =========================
 * 批量导入 Excel：POST /api/comp-groups/import  （表单字段名：file）
 * 支持列：country/国家、group/组名/变体组名/group_name、asin/ASIN、site/站点、
 *       brand/品牌、amazon_brand/亚马逊品牌、chain_type/链路(1/2/主链/副评)、飞书通知/feishu
 * ========================= */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

function val(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') {
      return String(obj[k]).trim();
    }
  }
  return '';
}

async function ensureCompGroup(country, name, feishuFlag) {
  const [rows] = await db3.query(
    'SELECT id FROM comp_groups WHERE country=? AND name=? LIMIT 1',
    [country, name]
  );
  if (rows.length) {
    if (feishuFlag !== null) {
      await db3.query('UPDATE comp_groups SET feishu_enabled=? WHERE id=?', [feishuFlag ? 1 : 0, rows[0].id]);
    }
    return { id: rows[0].id, created: false };
  }
  const [ins] = await db3.query(
    'INSERT INTO comp_groups (country,name,feishu_enabled,created_at) VALUES (?,?,?,NOW())',
    [country, name, feishuFlag === null ? 1 : (feishuFlag ? 1 : 0)]
  );
  return { id: ins.insertId, created: true };
}

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'missing_file' });

    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

    let groupsCreated = 0;
    let asinsInserted = 0;
    let skipped = 0;

    for (const r of rows) {
      const country = val(r, '国家', 'country').toUpperCase();
      const groupName = val(r, '变体组', '组名', '变体组名', 'group', 'group_name');
      const asin = val(r, 'asin', 'ASIN').toUpperCase();
      const site = val(r, 'site', '站点');
      const brand = val(r, 'brand', '品牌');
      const parentAsin  = val(r, 'parent_asin', '父体ASIN', '父asin', 'ParentASIN');

      const feishuRaw = val(r, '飞书通知', 'feishu');
      const feishuFlag = feishuRaw === ''
        ? null
        : ['1', '是', 'yes', 'true'].includes((feishuRaw.toLowerCase?.() || feishuRaw));

      let chainRaw = val(r, 'chain_type', '链路', '主链/副评');
      let chainType = null;
      if (chainRaw) {
        chainRaw = String(chainRaw).trim();
        if (chainRaw === '1' || chainRaw === '主链') chainType = 1;
        else if (chainRaw === '2' || chainRaw === '副评') chainType = 2;
      }

      // 国家 + 组名 必填；ASIN 可空（只建组）
      if (!country || !groupName) { skipped++; continue; }

      const { id: gid, created } = await ensureCompGroup(country, groupName, feishuFlag);
      if (created) groupsCreated++;

      if (!asin) continue;

      // 建议 DB 给 comp_asins 建唯一索引 (group_id, asin)
      const [ret] = await db3.query(
        'INSERT IGNORE INTO comp_asins (group_id,asin,parent_asin,site,brand,amazon_brand,chain_type,is_broken,created_at) VALUES (?,?,?,?,?,?,?,0,NOW())',
        [gid, asin, parentAsin || null, site || null, brand || null, amazonBrand || null, chainType]
      );
      if (ret.affectedRows > 0) asinsInserted++; else skipped++;
    }

    res.json({ success: true, groupsCreated, asinsInserted, skipped });
  } catch (e) {
    console.error('comp-groups import error:', e);
    res.status(500).json({ success: false, error: e.message || 'import_failed' });
  }
});

/* =========================
 * 立即监控：POST /api/comp-groups/run-now
 * body: { country?: 'ALL'|'US'|'UK'|'DE'|'FR'|'IT'|'ES', groupId?: number, limit?: number }
 * ========================= */
router.post('/run-now', async (req, res) => {
  const { country = 'ALL', groupId = null, limit = 500 } = req.body || {};
  try {
    const startedAt = new Date().toISOString();
    const inserted = await runCompSnapshot({ country, groupId, limit });
    res.json({ success: true, startedAt, inserted, country, groupId });
  } catch (e) {
    console.error('[comp-groups/run-now] error:', e);
    res.status(500).json({ success: false, error: 'run_failed', detail: e?.message });
  }
});

/* =========================
 * 飞书占位：POST /api/comp-groups/feishu-alert
 * ========================= */
router.post('/feishu-alert', async (_req, res) => {
  try {
    // TODO: 接真实飞书逻辑
    res.json({ success: true, message: '触发成功' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '触发失败' });
  }
});

module.exports = router;
