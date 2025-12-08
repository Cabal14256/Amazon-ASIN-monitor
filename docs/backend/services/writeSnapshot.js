// backend/services/writeSnapshot.js
const db2 = require('../utils/db2');   // 新库 asin_analytics
let db = null, db3 = null;
try { db  = require('../utils/db');  } catch (_) {}
try { db3 = require('../utils/db3'); } catch (_) {}

const AUTO_HISTORY_OFF = String(process.env.AUTO_HISTORY_OFF || '0') === '1';

function pickConn(name) {
  if (name === 'db3') return db3;
  if (name === 'db2') return db2;
  return db || db2; // 默认：老库优先，退回新库
}

// 解析 histTable：若调用端明确给了 histTable（可为 null），优先用之；
// 否则根据环境变量 AUTO_HISTORY_OFF 决定默认是否写历史。
function resolveHistTable(opts) {
  if (Object.prototype.hasOwnProperty.call(opts, 'histTable')) {
    return opts.histTable; // 允许为 null 显式关闭
  }
  return AUTO_HISTORY_OFF ? null : 'variant_history';
}

/**
 * 写快照 +（可选）历史
 * payload: {
 *   batch, country, site, brand, amazonBrand, asin,
 *   hasVariation, chain_type, parent_title
 * }
 * opts: {
 *   snapTable='monitor_snapshots', histTable=?, snapConn='db2', histConn='db'
 * }
 */
async function writeSnapshot(payload, opts = {}) {
  const {
    snapTable = 'monitor_snapshots',
    snapConn  = 'db2',
    histConn  = 'db',
  } = opts;

  const histTable = resolveHistTable(opts);

  const {
    batch        = null,
    country      = null,
    site         = null,
    brand        = null,
    amazonBrand  = null,
    asin,
    hasVariation,
    chain_type   = null,
    parent_title = null,
  } = payload || {};

  if (!asin) throw new Error('writeSnapshot: asin 必填');
  if (typeof hasVariation === 'undefined') {
    throw new Error('writeSnapshot: hasVariation 必填');
  }

  const is_broken = hasVariation ? 0 : 1;
  const status    = hasVariation ? '恢复' : '异常';

  // A) 快照：一定要把 parent_title 一起写进 monitor_snapshots
  const snapSql = `
    INSERT INTO ${snapTable}
      (event_time, batch, country, site, brand, amazon_brand, group_id, group_name,
       asin, status, is_broken, chain_type, parent_title, peak_flag)
    VALUES (UTC_TIMESTAMP(), ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, 0)
  `;
  await pickConn(snapConn).query(snapSql, [
    batch,
    country,
    site,
    brand,
    amazonBrand,
    asin,
    status,
    is_broken,
    chain_type,
    parent_title,
  ]);

  // B) 历史（可选，根据 histTable 是否为 null 决定）
  if (histTable) {
    const histSql = `
      INSERT INTO ${histTable}
        (country, site, asin, event_time, status, parent_title, chain_type, batch)
      VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?, ?, ?)
    `;
    await pickConn(histConn).query(histSql, [
      country,
      site,
      asin,
      status,
      parent_title,
      chain_type,
      batch,
    ]);
  }

  return { ok: true, wroteHistory: !!histTable };
}

module.exports = { writeSnapshot };
