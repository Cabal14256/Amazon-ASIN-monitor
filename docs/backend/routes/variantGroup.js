//backend/routes/variantGroup.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { monitorAsinsOnce } = require('../services/variantMonitor');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ dest: 'uploads/' });

// ✅ 获取所有变体组及其 ASIN 列表
router.get('/', async (req, res) => {
  try {
    const { country } = req.query;
    let sql = 'SELECT id, name, country, site, feishu_enabled FROM variant_groups';
    const params = [];
    if (country) {
      sql += ' WHERE country=?';
      params.push(country);
    }
    sql += ' ORDER BY id DESC';
    const [groups] = await db.query(sql, params);

    // 查询每个组的 ASIN
    for (const group of groups) {
    // 组 -> ASIN 列表
    const [asins] = await db.query(
      'SELECT id, asin, site, brand, amazon_brand, is_broken, chain_type FROM asins WHERE variant_id = ?',
      [group.id]
    );

        group.asins = asins;
    }

    res.json(groups);  // 返回查询结果
  } catch (err) {
    console.error('获取变体组失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});




// ✅ 添加一个新的变体组（名称唯一）
router.post('/', async (req, res) => {
  const { name, country } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '名称不能为空' });
  }
  if (!country || !country.trim()) {
    return res.status(400).json({ error: '国家不能为空' });
  }

  try {
    // 检查是否重名
    const [[existing]] = await db.query(
      'SELECT id FROM variant_groups WHERE name = ? AND country = ?', [name.trim(), country.trim().toUpperCase()]
    );
    if (existing) {
      return res.status(409).json({ error: '该名称已存在' });
    }

    // 插入变体组
    const [result] = await db.query(
      'INSERT INTO variant_groups (name, country) VALUES (?, ?)', [name.trim(), country.trim().toUpperCase()]
    );
    res.json({ id: result.insertId, name: name.trim(), country: country.trim().toUpperCase(), asins: [] });
  } catch (err) {
    console.error('添加变体组失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});


// ✅ 删除指定变体组（包括其下所有 ASIN）
router.delete('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ error: '无效的 ID' });

  try {
    // 先删除组下所有 ASIN
    await db.query('DELETE FROM asins WHERE variant_id = ?', [id]);

    // 再删除变体组本身
    const [result] = await db.query('DELETE FROM variant_groups WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到该变体组' });
    }

    res.json({ message: '删除成功' });
  } catch (err) {
    console.error('删除变体组失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// ✅ 给某个变体组添加一个 ASIN（支持 site + brand + chainType）
router.post('/:id/asins', async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { asin, site = '', brand = '', chainType = null } = req.body;

  if (!groupId || !asin || !asin.trim()) {
    return res.status(400).json({ error: '无效的变体组 ID 或 ASIN' });
  }

  try {
    const [[existing]] = await db.query(
      'SELECT id FROM asins WHERE variant_id = ? AND asin = ?',
      [groupId, asin.trim().toUpperCase()]
    );
    if (existing) {
      return res.status(409).json({ error: '该 ASIN 已存在于此组' });
    }

    await db.query(
      'INSERT INTO asins (asin, site, variant_id, group_id, brand, chain_type) VALUES (?, ?, ?, ?, ?, ?)',
      [asin.trim().toUpperCase(), site.trim(), groupId, groupId, brand.trim(), chainType]
    );

    res.json({ message: 'ASIN 添加成功' });
  } catch (err) {
    console.error('添加 ASIN 失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});




// ✅ 从变体组中删除某个 ASIN
router.delete('/:groupId/asins/:asinId', async (req, res) => {
  const groupId = parseInt(req.params.groupId);
  const asinId = parseInt(req.params.asinId);

  if (!groupId || !asinId) {
    return res.status(400).json({ error: '无效的参数' });
  }

  try {
    // 删除指定 ID 的 ASIN（且确保它属于该组）
    const [result] = await db.query(
      'DELETE FROM asins WHERE id = ? AND variant_id = ?',
      [asinId, groupId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到该 ASIN 或不属于该变体组' });
    }

    res.json({ message: 'ASIN 删除成功' });
  } catch (err) {
    console.error('删除 ASIN 失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// ✅ 修改变体组名称
router.put('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name } = req.body;

  if (!id || !name || !name.trim()) {
    return res.status(400).json({ error: '无效的 ID 或名称为空' });
  }

  try {
    // 检查是否重名（排除自己）
    const [[existing]] = await db.query('SELECT id FROM variant_groups WHERE name = ? AND id != ?', [name.trim(), id]);
    if (existing) {
      return res.status(409).json({ error: '该名称已存在' });
    }

    // 更新名称
    const [result] = await db.query('UPDATE variant_groups SET name = ? WHERE id = ?', [name.trim(), id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到该变体组' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('更新变体组名称失败:', err);
    res.status(500).json({ error: '数据库错误' });
  }
});

// ✅ 修改飞书通知状态
router.put('/:id/feishu', async (req, res) => {
  const groupId = req.params.id
  const { feishu_enabled } = req.body

  try {
    const [result] = await db.execute(
      'UPDATE variant_groups SET feishu_enabled = ? WHERE id = ?',
      [feishu_enabled ? 1 : 0, groupId]
    )

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '变体组未找到' })
    }

    res.json({ message: '飞书通知状态已更新' })
  } catch (err) {
    console.error('更新飞书通知失败:', err)
    res.status(500).json({ message: '服务器错误' })
  }
})

// ✅ 修改通知策略
router.put('/:id/notify', async (req, res) => {
  const id = parseInt(req.params.id);
  const { notify_partial, notify_full, notify_frequency } = req.body;

  if (!['always', 'daily', 'once'].includes(notify_frequency)) {
    return res.status(400).json({ error: '无效的通知频率' });
  }

  try {
    const [result] = await db.query(
      `UPDATE variant_groups 
       SET notify_partial = ?, notify_full = ?, notify_frequency = ?
       WHERE id = ?`,
      [notify_partial ? 1 : 0, notify_full ? 1 : 0, notify_frequency, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到变体组' });
    }

    res.json({ message: '通知设置已更新' });
  } catch (err) {
    console.error('更新通知设置失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});



// 一键飞书：异常变体推送
router.post('/feishu-alert', async (req, res) => {
  try {
    await monitorAsinsOnce();
    res.json({ success: true, message: '异常变体已发送飞书' });
  } catch (e) {
    res.status(500).json({ success: false, message: '发送失败', error: e.toString() });
  }
});

// 批量导入（Excel）
// 依赖 multer + xlsx：npm i multer xlsx


// 批量导入（Excel）——方案A：把 site 存到 asins
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: '未上传文件' });

    const workbook = XLSX.readFile(file.path);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    // 表头
    const header     = rows[0] || [];
    const idxCountry = header.indexOf('国家');
    const idxChain   = header.indexOf('主链/副评');    // 可填：主链/副评 或 1/2
    const idxGroup   = header.indexOf('变体组');
    const idxAsin    = header.indexOf('ASIN');
    const idxFeishu  = header.indexOf('飞书通知');     // 0 / 1
    const idxSite    = header.indexOf('站点');
    const idxBrand   = header.indexOf('品牌');         // 可选

    if (idxCountry < 0 || idxGroup < 0 || idxAsin < 0 || idxFeishu < 0 || idxSite < 0) {
      return res.status(400).json({ error: 'Excel需包含“国家、变体组、ASIN、飞书通知、站点”五列（可选：品牌、主链/副评）' });
    }

    // （国家 + 组名）聚合
    const groupMap = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const country   = String(row[idxCountry] || '').trim().toUpperCase();
      const groupName = String(row[idxGroup]   || '').trim();
      const asin      = String(row[idxAsin]    || '').trim().toUpperCase();
      const feishuStr = String(row[idxFeishu]  || '').trim();
      const site      = String(row[idxSite]    || '').trim();
      const brand     = idxBrand >= 0 ? String(row[idxBrand] || '').trim() : '';

      if (!country || !groupName || !asin) continue;

      // 解析主链/副评（每一行都要解析！）
      let chainType = null;
      if (idxChain >= 0) {
        const raw = row[idxChain];
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
          const s = String(raw).trim();
          if (s === '主链') chainType = 1;
          else if (s === '副评') chainType = 2;
          else {
            const n = Number(s);
            if (n === 1 || n === 2) chainType = n;
          }
        }
      }

      const feishu_enabled = feishuStr === '1' ? 1 : 0;

      const key = `${country}|||${groupName}`;
      if (!groupMap[key]) {
        groupMap[key] = { country, groupName, feishu_enabled, items: [] };
      }
      // ✅ 这一行的 chainType 放进 items
      groupMap[key].items.push({ asin, site, brand, chainType });
    }

    // 全量同步
    for (const key in groupMap) {
      const { country, groupName, feishu_enabled, items } = groupMap[key];

      // 1) 取/建 变体组
      let [found] = await db.query(
        'SELECT id FROM variant_groups WHERE name=? AND country=?',
        [groupName, country]
      );
      let groupId;
      if (found.length === 0) {
        const [ins] = await db.query(
          'INSERT INTO variant_groups (name, country, feishu_enabled) VALUES (?, ?, ?)',
          [groupName, country, feishu_enabled]
        );
        groupId = ins.insertId;
      } else {
        groupId = found[0].id;
        // 同步飞书开关
        await db.query('UPDATE variant_groups SET feishu_enabled=? WHERE id=?', [feishu_enabled, groupId]);
      }

      // 2) 查询该组已有 ASIN
      let [dbAsins] = await db.query(
        'SELECT id, asin FROM asins WHERE variant_id=?',
        [groupId]
      );
      const dbAsinSet = new Set(dbAsins.map(a => a.asin));

      // 3) 插/改
      for (const { asin, site, brand, chainType } of items) {
        if (!dbAsinSet.has(asin)) {
          // 新增时写入 site/brand/chain_type
          await db.query(
            'INSERT INTO asins (asin, variant_id, group_id, site, brand, chain_type) VALUES (?, ?, ?, ?, ?, ?)',
            [asin, groupId, groupId, site || null, brand || null, chainType]
          );
        } else {
          // 已存在则更新 site/brand/chain_type
          await db.query(
            'UPDATE asins SET site = ?, brand = ?, chain_type = ? WHERE variant_id = ? AND asin = ?',
            [site || null, brand || null, chainType, groupId, asin]
          );
        }
      }

      // 4) 删除 Excel 中已去掉的
      for (const dbRow of dbAsins) {
        if (!items.find(x => x.asin === dbRow.asin)) {
          await db.query('DELETE FROM asins WHERE id=?', [dbRow.id]);
        }
      }
    }

    res.json({ success: true, message: '批量导入/同步成功（已保存站点/品牌/主链-副评）' });
  } catch (err) {
    console.error('批量导入异常:', err);
    res.status(500).json({ error: err.message });
  }
});







// 一键物理删除变体组及其ASIN（带操作日志）
// routes/variantGroup.js
router.post('/delete-all', async (req, res) => {
  const { operator } = req.body;
  try {
    // 先删除所有 asins
    await db.query('DELETE FROM asins');
    // 删除所有变体组
    await db.query('DELETE FROM variant_groups');
    // 写日志
    await db.query(
      'INSERT INTO admin_logs (operator, action, action_time, detail) VALUES (?, ?, NOW(), ?)',
      [operator || '未知', '全部删除变体组', '删除所有变体组及ASIN']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ✅ 批量删除选中的变体组（含其 ASIN），带操作日志
router.post('/delete-selected', async (req, res) => {
  const { ids = [], operator } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请选择要删除的变体组' });
  }

  // 只保留数字ID，防注入
  const groupIds = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (groupIds.length === 0) {
    return res.status(400).json({ error: '参数无有效ID' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 先删 asins
    await conn.query(
      `DELETE FROM asins WHERE variant_id IN (${groupIds.map(() => '?').join(',')})`,
      groupIds
    );
    // 再删 groups
    const [ret] = await conn.query(
      `DELETE FROM variant_groups WHERE id IN (${groupIds.map(() => '?').join(',')})`,
      groupIds
    );

    // 写操作日志
    await conn.query(
      `INSERT INTO admin_logs (operator, action, action_time, detail)
       VALUES (?, ?, NOW(), ?)`,
      [operator || '未知', '批量删除变体组', `删除组ID: ${groupIds.join(',')}`]
    );

    await conn.commit();
    res.json({ success: true, deleted: ret.affectedRows });
  } catch (e) {
    await conn.rollback();
    console.error('删除选中变体组失败:', e);
    res.status(500).json({ error: '删除失败' });
  } finally {
    conn.release();
  }
});



module.exports = router;
