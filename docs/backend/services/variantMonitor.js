// backend/services/variantMonitor.js
require('dotenv').config();
const https = require('https');
const cron = require('node-cron');
const _pLimit = require('p-limit');
const pLimit = _pLimit.default || _pLimit; // 兼容 v2(CJS)/v3(ESM)

const db = require('../utils/db');
const db2 = require('../utils/db2');
const { writeSnapshot } = require('./writeSnapshot');
const { makeSp, MARKETPLACE, getCatalogItem } = require('../utils/spapi');

/* =========================
 *  可选 legacy spClient（用于父体兜底）
 * ========================= */
let legacySpClient = null;
try {
  legacySpClient = require('../utils/spClient'); // 需导出 getParentAndStatus(asin, country)
  console.log('[VARIANT-MONITOR] legacy spClient loaded');
} catch (e) {
  console.log('[VARIANT-MONITOR] no legacy spClient, SP-API only');
}

/* =========================
 *  Feishu：按国家/区域切换 webhook
 * ========================= */
const EU_COUNTRIES = new Set(['UK', 'DE', 'FR', 'IT', 'ES']);
function getFeishuWebhookByCountry(country) {
  return EU_COUNTRIES.has(country)
    ? process.env.FEISHU_WEBHOOK_EU    // 欧洲走 EU 钩子
    : process.env.FEISHU_WEBHOOK_URL;  // 美国/默认
}

// 支持传入 webhookUrl（不传则走默认）
async function sendToFeishu(text, webhookUrl) {
  const urlStr = webhookUrl || process.env.FEISHU_WEBHOOK_URL;
  const url = new URL(urlStr);
  const body = JSON.stringify({ msg_type: 'text', content: { text } });
  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk.toString()));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* =========================
 *  DB：加载 ASIN
 *  把 asins.brand 选出来作为 manual_brand
 * ========================= */
async function loadAsinsFromDB() {
  const [rows] = await db.query(`
    SELECT 
      a.asin,
      a.site,                         -- ASIN 级别的站点
      a.brand AS manual_brand,        -- 手工维护品牌
      a.id         AS asin_id,
      IFNULL(vg.country, 'US') AS marketKey,
      vg.name      AS groupName,
      vg.feishu_enabled,
      vg.id        AS group_id
    FROM asins a
    LEFT JOIN variant_groups vg ON a.variant_id = vg.id
  `);
  return rows;
}

/* =========================
 *  SP-API：获取变体 + 父体 + 品牌
 *  先用我们封装的 makeSp；父体不出来再用 legacySpClient 兜底
 * ========================= */
async function getVariantData(asin, marketKey) {
  const asinNorm = String(asin || '').trim().toUpperCase();

  let variations = [];
  let brotherAsins = [];
  let hasVariation = false;
  let brand = null;
  let parentAsin = null;

  // 1) 官方 SP-API 调 catalogItems v2022-04-01
  try {
    const sp = makeSp(marketKey);                                // 按 US/EU 取凭据
    const marketplaceId = MARKETPLACE[marketKey] || MARKETPLACE.US;

    const result = await getCatalogItem(sp, asinNorm, marketplaceId);

    const relationships = Array.isArray(result?.relationships) ? result.relationships : [];
    const variationsField = Array.isArray(result?.variations) ? result.variations : [];
    variations = variationsField.length ? variationsField : relationships;

    // 旧结构：variation.asins 里是兄弟 asin
    const asinsList = Array.isArray(variations?.[0]?.asins) ? variations[0].asins : [];
    brotherAsins = asinsList
      .map(x => String(x || '').toUpperCase())
      .filter(a => a && a !== asinNorm);
    hasVariation = brotherAsins.length > 0;

    // 品牌：优先 summaries.brandName，其次 attributes.brand
    brand =
      result?.summaries?.[0]?.brandName ??
      (Array.isArray(result?.attributes?.brand)
        ? result.attributes.brand[0]
        : result?.attributes?.brand) ??
      null;

    // 旧结构：summaries.parentAsin
    parentAsin = result?.summaries?.[0]?.parentAsin || null;

    // 旧结构：relationships[*].relationships[*].type === 'PARENT' && asin
    if (!parentAsin && Array.isArray(result?.relationships)) {
      for (const rel of result.relationships) {
        const arr = Array.isArray(rel?.relationships) ? rel.relationships : [];
        const p = arr.find(x => String(x?.type).toUpperCase() === 'PARENT' && x?.asin);
        if (p?.asin) {
          parentAsin = p.asin;
          break;
        }
      }
    }

    // ⭐ 新结构：variations[*].relationships[*].parentAsins[0]
    if (!parentAsin && Array.isArray(variations)) {
      for (const v of variations) {
        const rels = Array.isArray(v?.relationships) ? v.relationships : [];
        for (const r of rels) {
          if (Array.isArray(r?.parentAsins) && r.parentAsins.length) {
            parentAsin = r.parentAsins[0];
            break;
          }
        }
        if (parentAsin) break;
      }
    }

  } catch (e) {
    console.error(`❌ 获取 ASIN ${asinNorm} @ ${marketKey} 失败:`, e?.message || e);
  }

  // 2) 如果官方 SP-API 还没给出父体，再用 legacySpClient 兜底
  if (!parentAsin && legacySpClient && typeof legacySpClient.getParentAndStatus === 'function') {
    try {
      const r = await legacySpClient.getParentAndStatus(asinNorm, marketKey);
      const raw = r?.parent_asin ?? r?.parentAsin ?? r?.parent ?? null;
      if (raw) parentAsin = String(raw).toUpperCase();
      if (typeof r?.is_broken === 'number') {
        hasVariation = r.is_broken === 0;
      }
    } catch (e) {
      console.warn('[VARIANT-MONITOR] legacy spClient failed:', e?.message || e);
    }
  }

  // 3) 只要拿到父体，就认为存在变体（哪怕没有兄弟 asins）
  if (parentAsin && !hasVariation) {
    hasVariation = true;
  }

  return {
    variations,
    brotherAsins,
    hasVariation,
    brand: brand ?? '未知',
    parentAsin: parentAsin ? String(parentAsin).toUpperCase() : null,
  };
}


/* =========================
 *  variations → 父体（兜底）
 * ========================= */
function getParentAsinFromVariations(variations, asin) {
  if (!Array.isArray(variations)) return null;
  const asinNorm = String(asin || '').toUpperCase();
  for (const rel of variations) {
    const type = rel.variationType || rel.relationshipType || rel.type;
    if (String(type).toUpperCase() === 'PARENT' && Array.isArray(rel.asins) && rel.asins.length) {
      const up = String(rel.asins[0] || '').toUpperCase();
      if (up && up !== asinNorm) return up;
    }
  }
  return null;
}

/* =========================
 *  快照链路类型 1/2/null（保持不变）
 * ========================= */
async function snapshotChainType(asin, country) {
  const [[row]] = await db.query(
    `SELECT a.chain_type
     FROM asins a
     JOIN variant_groups vg ON vg.id = a.variant_id
     WHERE a.asin = ? AND vg.country = ?
     LIMIT 1`,
    [asin, country]
  );
  return row?.chain_type ?? null;
}

/* =========================
 *  保存历史：把 parent_title 确保写进 asin_analytics.monitor_snapshots
 * ========================= */
async function saveHistoryFromMonitor({
  eventTimeSql = 'NOW()',   // 兼容旧签名，不再使用
  batch,
  country,
  site,
  brand,
  amazonBrand,
  groupId,                  // 兼容旧签名，不再使用
  groupName,                // 兼容旧签名，不再使用
  asin,
  hasVariation,
  variations,
  parentAsin,               // 新增：上游已经解析好的父体
}) {
  const asinNorm = String(asin || '').toUpperCase();

  // 1) 优先用上游传进来的 parentAsin
  let parent_title = parentAsin || null;

  // 2) 如果没传，再从 variations 里兜底找一次
  if (!parent_title) {
    parent_title = getParentAsinFromVariations(variations, asinNorm);
  }

  const chain_type = await snapshotChainType(asin, country);

  // 3) 调用通用 writeSnapshot（你之前就有的逻辑）
  await writeSnapshot(
    {
      batch,
      country,
      site,
      brand,          // 我方品牌（手工）
      amazonBrand,    // 亚马逊品牌（SP-API）
      asin,
      hasVariation,
      chain_type,
      parent_title,
    },
    {
      snapTable: 'monitor_snapshots', // 快照在 asin_analytics
      histTable: process.env.AUTO_HISTORY_OFF === '1' ? null : 'variant_history',
      // 如果历史表也放在 asin_analytics，可以启用：
      // useDb2ForHistory: true,
    }
  );

  // 4) 保险补丁：直接在 asin_analytics.monitor_snapshots 上补写 parent_title
  if (parent_title) {
    try {
      await db2.query(
        `
        UPDATE monitor_snapshots
        SET parent_title = ?
        WHERE batch   = ?
          AND country = ?
          AND asin    = ?
        ORDER BY event_time DESC
        LIMIT 1
        `,
        [parent_title, batch, country, asinNorm]
      );
    } catch (e) {
      console.warn('[saveHistoryFromMonitor] 补写 parent_title 失败:', e?.message || e);
    }
  }
}

/* =========================
 *  监控主流程：调用 sendToFeishu 时按国家切 webhook
 * ========================= */
// ✅ 新版：无论是否有异常，都会推送飞书一条“摘要”（全部正常时发送“✅ 全部正常”）
//    仅列出异常分组里的异常 ASIN，避免消息过长
async function doMonitorAndNotify(asinList, newBatch, marketKey) {
  const limit = pLimit(5);

  // 并发抓取并写库
  const tasks = asinList.map((item) =>
    limit(async () => {
      const { asin, asin_id, group_id, groupName, feishu_enabled, site, manual_brand } = item;

      // ① 取 SP-API 结果（保持你原来的 parentAsin 透传）
      const { variations, brotherAsins, hasVariation, brand, parentAsin } =
        await getVariantData(asin, marketKey);
      const statusEmoji = hasVariation ? '✅' : '⚠️';
      const amazonBrand = typeof brand === 'object' ? brand?.value : brand || null;

      // ② 更新 asins 表（与原逻辑一致）
      try {
        await db.query(
          'UPDATE asins SET is_broken = ?, amazon_brand = ? WHERE id = ?',
          [hasVariation ? 0 : 1, amazonBrand, asin_id]
        );
      } catch (_) {}

      // ③ 写快照/历史（与原逻辑一致；你已在 writeSnapshot 里可控是否写历史）
      try {
        await saveHistoryFromMonitor({
          batch: newBatch,
          country: marketKey,
          site: site,
          brand: manual_brand || null,
          amazonBrand,
          groupId: group_id || null,
          groupName: groupName || null,
          asin,
          hasVariation,
          variations,
          parentAsin,        // ⚠️ 保持透传
        });
      } catch (e) {
        console.error('保存历史失败:', e?.message || e);
      }

      return { asin, statusEmoji, brand: amazonBrand, feishu_enabled, groupName, group_id };
    })
  );

  const resultList = await Promise.all(tasks);

  // ④ 按分组聚合（与原逻辑一致）
  const groupMap = {};
  for (const info of resultList) {
    const { asin, statusEmoji, brand, feishu_enabled, groupName, group_id } = info;
    if (!group_id) continue;
    (groupMap[group_id] ||= { groupName, feishu_enabled, asins: [] })
      .asins.push({ asin, status: statusEmoji, brand, feishu_enabled, groupName });
  }

  // ====== 从这里开始是“改动点”：即使全正常也要推送一条摘要 ======
  const enabledGroups = Object.values(groupMap).filter(g => g.feishu_enabled);

  // 统计摘要 + 仅收集“异常”明细
  const brokenBlocks = [];              // 每个异常分组一个 block
  let brokenGroupsCount = 0;
  let brokenAsinsCount = 0;

  for (const g of enabledGroups) {
    const brokenAsins = g.asins.filter(a => a.status === '⚠️');
    if (brokenAsins.length) {
      brokenGroupsCount += 1;
      brokenAsinsCount += brokenAsins.length;

      // 只列出异常 ASIN，避免消息过长
      const lines = brokenAsins.map(({ asin, brand }) => `- ${asin} ⚠️ 品牌：${brand || '—'}`);
      brokenBlocks.push(`⚠️ ${g.groupName}\n${lines.join('\n')}`);
    }
  }

  // 构造消息头（与原“启动”文案不同，这里做成“摘要”更清晰）
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const header =
    `【${now}】【${marketKey}】变体监控摘要\n` +
    `已开启分组：${enabledGroups.length}，异常分组：${brokenGroupsCount}，异常ASIN：${brokenAsinsCount}`;

  // 有异常 → 摘要 + 异常明细；无异常 → 摘要 + ✅ 全部正常
  const message = brokenBlocks.length
    ? `${header}\n\n${brokenBlocks.join('\n\n')}`
    : `${header}\n✅ 全部正常`;

  // ⑤ 无论是否有异常，都推送（原来只有包含“⚠️”才推）
  const webhook = getFeishuWebhookByCountry(marketKey);
  try {
    const ret = await sendToFeishu(message, webhook);
    console.log(`[${marketKey}] 飞书已推送：`, (ret && ret.slice) ? ret.slice(0, 120) : ret);
  } catch (e) {
    console.error(`[${marketKey}] 飞书推送失败:`, e?.message || e);
  }
}


/* =========================
 *  调度
 * ========================= */
async function monitorUSAsins() {
  const [[{ maxBatch }]] = await db.query('SELECT MAX(batch) AS maxBatch FROM variant_history');
  const newBatch = (maxBatch || 0) + 1;
  const all = await loadAsinsFromDB();
  const us = all.filter((i) => i.marketKey === 'US');
  if (us.length) await doMonitorAndNotify(us, newBatch, 'US');
}

async function monitorEUAsins() {
  const [[{ maxBatch }]] = await db.query('SELECT MAX(batch) AS maxBatch FROM variant_history');
  const newBatch = (maxBatch || 0) + 1;
  const all = await loadAsinsFromDB();
  for (const country of ['UK', 'DE', 'FR', 'IT', 'ES']) {
    const arr = all.filter((i) => i.marketKey === country);
    if (arr.length) await doMonitorAndNotify(arr, newBatch, country);
  }
}

async function monitorAllAsins() {
  await monitorUSAsins();
  await monitorEUAsins();
}

function registerMonitorJobs() {
  cron.schedule('30 * * * *', async () => {
    console.log('⏰ 每小时第 30 分钟跑美国');
    await monitorUSAsins();
  }, { timezone: 'Asia/Shanghai' });

  cron.schedule('0 * * * *', async () => {
    console.log('⏰ 整点，先美国后欧洲');
    await monitorUSAsins();
    await monitorEUAsins();
  }, { timezone: 'Asia/Shanghai' });

  (async () => {
    console.log('🚀 启动后立即跑一次美国/欧洲监控...');
    await monitorUSAsins();
    // 如需启动时也跑欧洲，解除下一行注释：
    // await monitorEUAsins();
  })();
}

/* =========================
 *  Exports
 * ========================= */
module.exports = {
  registerMonitorJobs,
  monitorAsinsOnce: monitorAllAsins,
  getVariantData,
  saveHistoryFromMonitor,
  getParentAsinFromVariations,
  snapshotChainType,
};
