// backend/services/compMonitor.js
const db3 = require('../utils/db3');
const axios = require('axios');
const { makeSp, MARKETPLACE, getCatalogItem } = require('../utils/spapi');

// 行为开关 & 并发
const WRITE_BACK  = String(process.env.COMP_WRITEBACK || '1') === '1';
const CONCURRENCY = Math.max(1, Number(process.env.COMP_CONCURRENCY || 4) || 4);

/** 仅拦“父体与自身相同”，其余值全部保留 */
function normalizeParent(parent, asin) {
  if (parent == null) return null;
  const p = String(parent).trim();
  if (!p) return null; // 空串视为无父体
  const a = String(asin).trim();
  if (p.toUpperCase() === a.toUpperCase()) return null; // 父体与自身相同 → 置空
  return p;
}

// ---------- 可选第三方客户端（兼容旧实现；如无则忽略） ----------
let legacySpClient = null;
try {
  legacySpClient = require('../utils/spClient'); // 需导出 getParentAndStatus(asin, country)
  console.log('[SP-CLIENT] loaded');
} catch {
  console.warn('[SP-CLIENT] not found, will use SP-API/built-in');
}

// ---------- 内置抓取（兜底）：访问商品页从 html 里抠出 parentAsin ----------
const DOMAINS = {
  US: 'www.amazon.com',
  UK: 'www.amazon.co.uk',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  IT: 'www.amazon.it',
  ES: 'www.amazon.es',
};

async function builtInGetParentAndStatus(asin, country = 'US') {
  const host = DOMAINS[country] || DOMAINS.US;
  const url = `https://${host}/dp/${asin}?psc=1`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
      proxy: false,
    });

    const raw =
      data.match(/"parentAsin"\s*:\s*"([^"]+)"/i)?.[1] ||
      data.match(/"parent_asin"\s*:\s*"([^"]+)"/i)?.[1] ||
      data.match(/data-asin-parent="([^"]+)"/i)?.[1] ||
      data.match(/"twisterJsInit".*?"parentAsin"\s*:\s*"([^"]+)"/i)?.[1] ||
      data.match(/"variationDisplayData".*?"parentAsin"\s*:\s*"([^"]+)"/i)?.[1] ||
      null;

    const parent_asin = normalizeParent(raw, asin);
    return { parent_asin, is_broken: parent_asin ? 0 : 1 };
  } catch {
    return { parent_asin: null, is_broken: 1 };
  }
}

// ---------- 用我们封装好的 amazon-sp-api 先查 ----------
async function spGetParentAndStatus(asin, country) {
  const sp = makeSp(country); // 会按 US/EU 分区拿对的 clientId/secret/token
  const marketplaceId = MARKETPLACE[country] || MARKETPLACE.US;

  const data = await getCatalogItem(sp, asin, marketplaceId);

  // 1) 直取 summaries.parentAsin（最稳定）
  let parent = data?.summaries?.[0]?.parentAsin || null;

  // 2) 有些类目只在 relationships 里给 parent
  if (!parent && Array.isArray(data?.relationships)) {
    for (const rel of data.relationships) {
      // v2022-04-01 里常见形态：rel.type === 'VARIATION' 且 rel.relationships 数组里含 { type:'PARENT', asin:'...' }
      const arr = Array.isArray(rel?.relationships) ? rel.relationships : [];
      const p = arr.find(x => String(x?.type).toUpperCase() === 'PARENT' && x?.asin);
      if (p?.asin) { parent = p.asin; break; }
    }
  }

  parent = normalizeParent(parent, asin);
  return { parent_asin: parent, is_broken: parent ? 0 : 1 };
}

// ---------- 统一出口：优先 SP-API；若 SP 报错 → 旧 spClient；再不行 → HTML 兜底 ----------
async function getParentAndStatus(asin, country) {
  // 先走官方 SP-API（最可靠）；即使拿到 null 也算成功（不再 fallback，避免误判）
  try {
    return await spGetParentAndStatus(asin, country);
  } catch (e) {
    console.warn('[SP-API] failed, try legacy client:', e?.code || e?.message || e);
  }

  // 旧 spClient（若存在）
  if (legacySpClient && typeof legacySpClient.getParentAndStatus === 'function') {
    try {
      const r = await legacySpClient.getParentAndStatus(asin, country);
      const raw = r?.parent_asin ?? r?.parentAsin ?? r?.parent ?? null;
      const parent_asin = normalizeParent(raw, asin);
      return { parent_asin, is_broken: parent_asin ? 0 : 1 };
    } catch (e) {
      console.warn('[legacy spClient] failed, fallback to HTML:', e?.message || e);
    }
  }

  // 最后兜底：抓页面
  return builtInGetParentAndStatus(asin, country);
}

// ---------- 简单并发执行器 ----------
async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      try {
        if (idx % 20 === 0) await new Promise(r => setTimeout(r, 150)); // 轻微抖动
        await worker(items[idx], idx);
      } catch (e) {
        console.error('[worker] error:', e?.message || e);
      }
    }
  });
  await Promise.all(workers);
}

/** 批次自增表：00001、00002… */
async function nextBatch() {
  await db3.query(`
    CREATE TABLE IF NOT EXISTS comp_batch_seq (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `);
  const [ret] = await db3.query('INSERT INTO comp_batch_seq () VALUES ()');
  const seq = ret.insertId;                 // 1, 2, 3, ...
  return String(seq).padStart(5, '0');      // "00001", "00002", ...
}

/**
 * 将 comp_asins 的信息快照到 snapshots
 * @param {Object} opts
 * @param {'ALL'|'US'|'UK'|'DE'|'FR'|'IT'|'ES'} [opts.country='ALL']
 * @param {number|null} [opts.groupId=null]
 * @param {number} [opts.limit=200]
 * @returns {Promise<number>} 插入条数
 */
async function runCompSnapshot({ country = 'ALL', groupId = null, limit = 200 } = {}) {
  // 1) 取本次要跑的 ASIN 列表
  const where = [];
  const params = [];
  if (country && country !== 'ALL') { where.push('g.country=?'); params.push(country); }
  if (groupId) { where.push('g.id=?'); params.push(groupId); }
  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const lim = Math.min(Math.max(+limit || 200, 1), 2000);

  const [rows] = await db3.query(
    `
    SELECT a.id asin_id, a.asin, a.site, a.brand, a.amazon_brand, a.chain_type,
           g.id group_id, g.name group_name, g.country
    FROM comp_asins a
    JOIN comp_groups g ON g.id = a.group_id
    ${whereSQL}
    ORDER BY a.id DESC
    LIMIT ?
    `,
    [...params, lim]
  );
  if (!rows.length) return 0;

  // 2) 批次号（自增 00001…；不会回退）
  const batch = await nextBatch();

  // 3) 并发写入
  let inserted = 0;

  await runWithConcurrency(rows, CONCURRENCY, async (r) => {
    const asin = String(r.asin || '').toUpperCase();

    const meta = await getParentAndStatus(asin, r.country);
    const parent_asin = normalizeParent(meta?.parent_asin, asin);
    const broken = parent_asin ? 0 : 1;

    // 写历史快照（UTC 时间；前端历史页已做 +08:00 显示）
    await db3.query(
      `INSERT INTO snapshots
         (event_time, batch, country, site, asin, parent_asin, amazon_brand,
          is_broken, group_id, group_name, chain_type)
       VALUES
         (UTC_TIMESTAMP(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        batch,
        r.country,
        r.site || '',
        asin,
        parent_asin,
        r.amazon_brand || r.brand || '',
        broken,
        r.group_id,
        r.group_name,
        r.chain_type ?? null
      ]
    );

    // 回写 comp_asins（供“竞品监控”页展示）
    if (WRITE_BACK) {
      try {
        await db3.query(
          `UPDATE comp_asins
             SET parent_asin = ?, is_broken = ?, updated_at = NOW()
           WHERE id = ?`,
          [parent_asin, broken, r.asin_id]
        );
      } catch (e) {
        console.warn('[writeback] failed:', asin, e?.message || e);
      }
    }

    inserted += 1;
  });

  return inserted;
}

module.exports = { runCompSnapshot };
