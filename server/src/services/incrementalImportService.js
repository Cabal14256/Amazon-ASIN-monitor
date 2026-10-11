const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const standardDb = require('../config/database');
const competitorDb = require('../config/competitor-database');
const cacheService = require('./cacheService');
const { parseImportPayload } = require('./importService');

const QUERY_BATCH_SIZE = 100;

function getConfig(mode) {
  if (mode === 'standard') {
    return {
      db: standardDb,
      groupTable: 'variant_groups',
      asinTable: 'asins',
      withSite: true,
    };
  }
  if (mode === 'competitor') {
    return {
      db: competitorDb,
      groupTable: 'competitor_variant_groups',
      asinTable: 'competitor_asins',
      withSite: false,
    };
  }
  const error = new Error('不支持的导入类型');
  error.statusCode = 400;
  throw error;
}

function batches(items, size = QUERY_BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < items.length; index += size)
    result.push(items.slice(index, index + size));
  return result;
}

function groupNaturalKey(row, withSite) {
  const fold = (value) =>
    String(value ?? '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .trimEnd()
      .toLocaleLowerCase();
  return JSON.stringify([
    fold(row.groupName !== undefined ? row.groupName : row.name),
    fold(row.country),
    withSite ? fold(row.site) : '',
    fold(row.brand),
  ]);
}

function asinKey(asin, country) {
  return JSON.stringify([
    String(asin ?? '')
      .trim()
      .toUpperCase(),
    String(country ?? '')
      .trim()
      .toUpperCase(),
  ]);
}

function normalizedStoredAsinType(value) {
  if (value === 'MAIN_LINK') return '1';
  if (value === 'SUB_REVIEW') return '2';
  return value || null;
}

function pickGroup(group, withSite) {
  if (!group) return null;
  return {
    id: group.id || null,
    name: group.name,
    country: group.country,
    ...(withSite ? { site: group.site } : {}),
    brand: group.brand,
  };
}

function pickAsin(asin, withSite) {
  if (!asin) return null;
  return {
    id: asin.id,
    asin: asin.asin,
    name: asin.name || null,
    asinType: normalizedStoredAsinType(asin.asin_type),
    country: asin.country,
    ...(withSite ? { site: asin.site } : {}),
    brand: asin.brand,
    variantGroupId: asin.variant_group_id,
  };
}

function changesBetween(current, target, fields) {
  return fields
    .filter((field) => (current?.[field] ?? null) !== (target?.[field] ?? null))
    .map((field) => ({
      field,
      from: current?.[field] ?? null,
      to: target?.[field] ?? null,
    }));
}

function emptySummary(total) {
  return {
    total,
    processedCount: total,
    successCount: 0,
    createdCount: 0,
    updatedCount: 0,
    movedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    createdGroupCount: 0,
    updatedGroupCount: 0,
    groupOnlyCount: 0,
    missingCount: 0,
    verificationPassed: true,
  };
}

/**
 * Pure diff planner. The snapshots have the database's snake_case column names.
 * Operations contain only business fields so monitor/manual/history columns survive.
 */
function planIncrementalImport(
  parsed,
  { groups = [], asins = [], mode = 'standard' } = {},
) {
  const withSite = mode !== 'competitor';
  const groupById = new Map(groups.map((group) => [String(group.id), group]));
  const groupByNatural = new Map();
  for (const group of groups) {
    const key = groupNaturalKey(group, withSite);
    if (!groupByNatural.has(key)) groupByNatural.set(key, []);
    groupByNatural.get(key).push(group);
  }
  const asinByKey = new Map(
    asins.map((asin) => [asinKey(asin.asin, asin.country), asin]),
  );
  const entries = (parsed.rows || []).map((input) => ({
    input,
    errors: [...(input.errors || [])],
    group: null,
    groupKey: null,
  }));

  for (const entry of entries) {
    const row = entry.input;
    if (!row.groupId) continue;
    const group = groupById.get(String(row.groupId));
    if (!group) {
      entry.errors.push(`变体组ID不存在: ${row.groupId}`);
    } else {
      entry.group = group;
      entry.groupKey = `id:${group.id}`;
      if (String(group.country).toUpperCase() !== row.country) {
        entry.errors.push(
          `变体组ID ${row.groupId} 属于 ${group.country}，与文件国家 ${row.country} 不同`,
        );
      }
    }
  }

  // An explicit ID may appear on several rows. All nonblank target attributes
  // must agree; otherwise none of the rows for that ID may change the group.
  const explicitTargets = new Map();
  for (const entry of entries) {
    if (!entry.input.groupId || !entry.group) continue;
    const key = entry.groupKey;
    if (!explicitTargets.has(key))
      explicitTargets.set(key, { values: {}, entries: [] });
    const target = explicitTargets.get(key);
    target.entries.push(entry);
    for (const field of withSite
      ? ['groupName', 'site', 'brand']
      : ['groupName', 'brand']) {
      const value = entry.input[field];
      if (!value) continue;
      if (
        target.values[field] !== undefined &&
        target.values[field] !== value
      ) {
        target.conflict = true;
      } else {
        target.values[field] = value;
      }
    }
  }
  for (const target of explicitTargets.values()) {
    if (target.conflict) {
      for (const entry of target.entries)
        entry.errors.push('同一变体组ID的目标名称、站点或品牌互相矛盾');
    }
  }

  const plannedByNatural = new Map();
  for (const [key, target] of explicitTargets) {
    if (target.conflict) continue;
    const usable = target.entries.filter((entry) => !entry.errors.length);
    if (!usable.length) continue;
    const group = usable[0].group;
    const values = {};
    for (const entry of usable) {
      for (const field of withSite
        ? ['groupName', 'site', 'brand']
        : ['groupName', 'brand']) {
        if (entry.input[field]) values[field] = entry.input[field];
      }
    }
    const desired = {
      name: values.groupName || group.name,
      country: group.country,
      ...(withSite ? { site: values.site || group.site } : {}),
      brand: values.brand || group.brand,
    };
    const naturalKey = groupNaturalKey(desired, withSite);
    if (!plannedByNatural.has(naturalKey)) plannedByNatural.set(naturalKey, []);
    const changesNaturalKey = naturalKey !== groupNaturalKey(group, withSite);
    plannedByNatural
      .get(naturalKey)
      .push({ key, target, group, changesNaturalKey });
    if (
      changesNaturalKey &&
      (groupByNatural.get(naturalKey) || []).some(
        (match) => match.id !== group.id,
      )
    ) {
      for (const entry of target.entries)
        entry.errors.push('目标变体组属性与现有其他变体组冲突');
    }
  }
  for (const planned of plannedByNatural.values()) {
    if (planned.length > 1) {
      for (const item of planned) {
        if (item.changesNaturalKey) {
          for (const entry of item.target.entries)
            entry.errors.push('多个变体组ID指向相同目标变体组属性');
        }
      }
    }
  }

  for (const entry of entries) {
    const row = entry.input;
    if (row.groupId || !row.groupName || !row.brand || (withSite && !row.site))
      continue;
    const key = groupNaturalKey(row, withSite);
    const matching = groupByNatural.get(key) || [];
    const planned = (plannedByNatural.get(key) || []).filter(
      (item) =>
        !item.target.entries.some((candidate) => candidate.errors.length),
    );
    if (
      matching.length > 1 ||
      planned.length > 1 ||
      (matching.length === 1 &&
        planned.length === 1 &&
        matching[0].id !== planned[0].group.id)
    ) {
      entry.errors.push('数据库或文件中有多个匹配的变体组，需填写变体组ID');
    } else if (planned.length === 1) {
      entry.group = planned[0].group;
      entry.groupKey = planned[0].key;
    } else if (matching.length === 1) {
      entry.group = matching[0];
      entry.groupKey = `id:${matching[0].id}`;
    } else {
      entry.groupKey = `new:${key}`;
    }
  }

  const entriesByAsin = new Map();
  for (const entry of entries) {
    if (!entry.input.asin) continue;
    const key = asinKey(entry.input.asin, entry.input.country);
    if (!entriesByAsin.has(key)) entriesByAsin.set(key, []);
    entriesByAsin.get(key).push(entry);
  }
  for (const duplicates of entriesByAsin.values()) {
    if (duplicates.length < 2) continue;
    const targets = new Set(
      duplicates.map(
        (entry) =>
          entry.groupKey ||
          (entry.input.groupId
            ? `id:${entry.input.groupId}`
            : `new:${groupNaturalKey(entry.input, withSite)}`),
      ),
    );
    if (targets.size > 1) {
      for (const entry of duplicates)
        entry.errors.push('同一ASIN和国家在文件中指向不同变体组');
    } else {
      const valid = duplicates.filter((entry) => !entry.errors.length);
      for (const entry of valid.slice(1))
        entry.errors.push('同一ASIN和国家在文件中重复');
    }
  }

  const activeByGroup = new Map();
  for (const entry of entries) {
    if (entry.errors.length) continue;
    if (!activeByGroup.has(entry.groupKey))
      activeByGroup.set(entry.groupKey, []);
    activeByGroup.get(entry.groupKey).push(entry);
  }
  const groupTargets = new Map();
  const operations = {
    groupCreates: [],
    groupUpdates: [],
    asinCreates: [],
    asinUpdates: [],
  };
  for (const [key, groupEntries] of activeByGroup) {
    const first = groupEntries[0];
    const current = first.group;
    const target = current
      ? pickGroup(current, withSite)
      : {
          id: null,
          name: first.input.groupName,
          country: first.input.country,
          ...(withSite ? { site: first.input.site } : {}),
          brand: first.input.brand,
        };
    if (current && groupEntries.some((entry) => entry.input.groupId)) {
      const specified = {};
      for (const entry of groupEntries) {
        if (!entry.input.groupId) continue;
        for (const field of withSite
          ? ['groupName', 'site', 'brand']
          : ['groupName', 'brand']) {
          if (entry.input[field]) specified[field] = entry.input[field];
        }
      }
      if (specified.groupName) target.name = specified.groupName;
      if (specified.site && withSite) target.site = specified.site;
      if (specified.brand) target.brand = specified.brand;
    }
    groupTargets.set(key, target);
    if (!current) {
      operations.groupCreates.push({ key, ...target });
    } else if (groupEntries.some((entry) => entry.input.groupId)) {
      const groupChanges = changesBetween(
        pickGroup(current, withSite),
        target,
        withSite ? ['name', 'site', 'brand'] : ['name', 'brand'],
      );
      if (groupChanges.length) {
        operations.groupUpdates.push({ id: current.id, changes: groupChanges });
      }
    }
  }

  const rows = [];
  const summary = emptySummary(entries.length);
  for (const entry of entries) {
    const input = entry.input;
    const currentAsin = input.asin
      ? asinByKey.get(asinKey(input.asin, input.country))
      : null;
    const currentGroup = currentAsin
      ? groupById.get(String(currentAsin.variant_group_id)) || null
      : entry.group;
    const targetGroup = entry.errors.length
      ? null
      : groupTargets.get(entry.groupKey);
    const current = {
      group: pickGroup(currentGroup, withSite),
      asin: pickAsin(currentAsin, withSite),
    };
    let target = {
      group: {
        id: input.groupId || null,
        name: input.groupName,
        country: input.country,
        ...(withSite ? { site: input.site } : {}),
        brand: input.brand,
      },
      asin: input.asin
        ? {
            asin: input.asin,
            name: input.name,
            asinType: input.asinType,
            country: input.country,
            ...(withSite ? { site: input.site } : {}),
            brand: input.brand,
            variantGroupId: input.groupId || null,
          }
        : null,
    };
    let changes = [];
    let groupChanges = [];
    let action = 'skipped';
    if (!entry.errors.length) {
      groupChanges = entry.group
        ? changesBetween(
            pickGroup(entry.group, withSite),
            targetGroup,
            withSite ? ['name', 'site', 'brand'] : ['name', 'brand'],
          )
        : [];
      if (!input.asin) {
        summary.groupOnlyCount += 1;
        action = groupChanges.length ? 'group-update' : 'unchanged';
        target = { group: targetGroup, asin: null };
      } else {
        const targetAsin = {
          id: currentAsin?.id || null,
          asin: input.asin,
          name: input.name || currentAsin?.name || null,
          asinType:
            input.asinType || normalizedStoredAsinType(currentAsin?.asin_type),
          country: input.country,
          ...(withSite
            ? {
                site:
                  input.site ||
                  (currentAsin ? currentAsin.site : targetGroup.site),
              }
            : {}),
          brand:
            input.brand ||
            (currentAsin ? currentAsin.brand : targetGroup.brand),
          variantGroupId: targetGroup.id || null,
        };
        target = { group: targetGroup, asin: targetAsin };
        changes = changesBetween(
          current.asin,
          targetAsin,
          withSite
            ? ['name', 'asinType', 'site', 'brand', 'variantGroupId']
            : ['name', 'asinType', 'brand', 'variantGroupId'],
        );
        if (!currentAsin) {
          action = 'create';
          summary.createdCount += 1;
          operations.asinCreates.push({
            rowNumber: input.rowNumber,
            groupKey: entry.groupKey,
            ...targetAsin,
          });
        } else if (changes.length) {
          const moved = currentAsin.variant_group_id !== targetGroup.id;
          action = moved ? 'move' : 'update';
          summary.updatedCount += 1;
          if (moved) summary.movedCount += 1;
          operations.asinUpdates.push({
            rowNumber: input.rowNumber,
            id: currentAsin.id,
            groupKey: entry.groupKey,
            changes,
          });
        } else {
          action = 'unchanged';
        }
      }
    }
    if (action === 'skipped') summary.failedCount += 1;
    if (action === 'unchanged') summary.unchangedCount += 1;
    rows.push({
      rowNumber: input.rowNumber,
      asin: input.asin || null,
      country: input.country,
      groupId: input.groupId || null,
      groupName: input.groupName || null,
      action,
      current,
      target,
      changes,
      groupChanges,
      errors: entry.errors,
    });
  }
  summary.createdGroupCount = operations.groupCreates.length;
  summary.updatedGroupCount = operations.groupUpdates.length;
  summary.skippedCount = summary.failedCount;
  summary.successCount = summary.total - summary.failedCount;
  return { summary, rows, operations };
}

async function loadSnapshots(parsed, config, query, { lock = false } = {}) {
  const candidateRows = parsed.rows || [];
  const groupIds = [
    ...new Set(candidateRows.map((row) => row.groupId).filter(Boolean)),
  ];
  const naturalRows = new Map(
    candidateRows
      .filter(
        (row) =>
          !row.groupId &&
          row.groupName &&
          row.country &&
          row.brand &&
          (!config.withSite || row.site),
      )
      .map((row) => [groupNaturalKey(row, config.withSite), row]),
  );
  const asinRows = [
    ...new Map(
      candidateRows
        .filter((row) => /^[A-Z0-9]{10}$/.test(row.asin) && row.country)
        .map((row) => [asinKey(row.asin, row.country), row]),
    ).values(),
  ];
  const groups = new Map();
  const suffix = lock ? ' FOR UPDATE' : '';
  for (const batch of batches(groupIds)) {
    const records = await query(
      `SELECT id, name, country, ${config.withSite ? 'site, ' : ''}brand FROM ${
        config.groupTable
      } WHERE id IN (${batch.map(() => '?').join(',')})${suffix}`,
      batch,
    );
    for (const group of records) groups.set(group.id, group);
  }
  const explicitRows = new Map();
  for (const row of candidateRows.filter((candidate) => candidate.groupId)) {
    if (!explicitRows.has(row.groupId)) explicitRows.set(row.groupId, []);
    explicitRows.get(row.groupId).push(row);
  }
  for (const [id, rows] of explicitRows) {
    const existing = groups.get(id);
    if (!existing) continue;
    const desired = {
      groupName: rows.find((row) => row.groupName)?.groupName || existing.name,
      country: existing.country,
      ...(config.withSite
        ? { site: rows.find((row) => row.site)?.site || existing.site }
        : {}),
      brand: rows.find((row) => row.brand)?.brand || existing.brand,
    };
    naturalRows.set(groupNaturalKey(desired, config.withSite), desired);
  }
  for (const batch of batches([...naturalRows.values()])) {
    const predicate = config.withSite
      ? '(name = ? AND country = ? AND site = ? AND brand = ?)'
      : '(name = ? AND country = ? AND brand = ?)';
    const params = batch.flatMap((row) =>
      config.withSite
        ? [row.groupName, row.country, row.site, row.brand]
        : [row.groupName, row.country, row.brand],
    );
    const records = await query(
      `SELECT id, name, country, ${config.withSite ? 'site, ' : ''}brand FROM ${
        config.groupTable
      } WHERE ${batch.map(() => predicate).join(' OR ')}${suffix}`,
      params,
    );
    for (const group of records) groups.set(group.id, group);
  }
  const asins = new Map();
  for (const batch of batches(asinRows)) {
    const params = batch.flatMap((row) => [row.asin, row.country]);
    const records = await query(
      `SELECT id, asin, name, asin_type, country, ${
        config.withSite ? 'site, ' : ''
      }brand, variant_group_id FROM ${
        config.asinTable
      } WHERE (asin, country) IN (${batch
        .map(() => '(?, ?)')
        .join(',')})${suffix}`,
      params,
    );
    for (const asin of records) asins.set(asin.id, asin);
  }
  const sourceIds = [
    ...new Set(
      [...asins.values()]
        .map((asin) => asin.variant_group_id)
        .filter((id) => id && !groups.has(id)),
    ),
  ];
  for (const batch of batches(sourceIds)) {
    const records = await query(
      `SELECT id, name, country, ${config.withSite ? 'site, ' : ''}brand FROM ${
        config.groupTable
      } WHERE id IN (${batch.map(() => '?').join(',')})${suffix}`,
      batch,
    );
    for (const group of records) groups.set(group.id, group);
  }
  return { groups: [...groups.values()], asins: [...asins.values()] };
}

function digestPlan(fileHash, plan) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify({ fileHash, rows: plan.rows, summary: plan.summary }),
    )
    .digest('hex');
}

function hashFile(file) {
  return crypto
    .createHash('sha256')
    .update(
      Buffer.isBuffer(file.buffer)
        ? file.buffer
        : Buffer.from(file.buffer || []),
    )
    .digest('hex');
}

async function createIncrementalPreview(file, { mode = 'standard', db } = {}) {
  const config = getConfig(mode);
  if (db) config.db = db;
  const parsed = await parseImportPayload(file, { mode, kind: 'incremental' });
  const snapshots = await loadSnapshots(parsed, config, config.db.query);
  const plan = planIncrementalImport(parsed, { ...snapshots, mode });
  const fileHash = hashFile(file);
  return {
    summary: plan.summary,
    rows: plan.rows,
    digest: digestPlan(fileHash, plan),
    fileHash,
  };
}

function staleError() {
  const error = new Error('预览已过期，请重新比对');
  error.statusCode = 409;
  error.code = 'PREVIEW_STALE';
  return error;
}

async function withImportLock(db, mode, handler) {
  // MySQL named locks live on the connection, not the transaction. Keep the
  // connection until after commit so two imports cannot both decide to create
  // the same natural-key group before either commit is visible.
  if (typeof db.getConnection !== 'function')
    return db.withTransaction(handler);
  const lockConnection = await db.getConnection();
  const lockName = `asin-incremental-import:${mode}`;
  let acquired = false;
  let transactionStarted = false;
  try {
    const [records] = await lockConnection.query(
      'SELECT GET_LOCK(?, 30) AS acquired',
      [lockName],
    );
    acquired = Number(records?.[0]?.acquired) === 1;
    if (!acquired) {
      const error = new Error('增量导入正在处理，请稍后重试');
      error.code = 'IMPORT_LOCK_TIMEOUT';
      error.statusCode = 503;
      throw error;
    }
    await lockConnection.beginTransaction();
    transactionStarted = true;
    const query = db.createQueryExecutor(lockConnection);
    const result = await handler({ query });
    await lockConnection.commit();
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) await lockConnection.rollback();
    throw error;
  } finally {
    if (acquired) {
      try {
        await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } finally {
        lockConnection.release();
      }
    } else {
      lockConnection.release();
    }
  }
}

async function applyOperations(plan, config, query, checkCancelled) {
  let pendingWrites = 0;
  let lastCheckAt = 0;
  const checkDuringWrites = async () => {
    if (!checkCancelled) return;
    pendingWrites += 1;
    const now = Date.now();
    if (
      pendingWrites === 1 ||
      pendingWrites % 25 === 0 ||
      now - lastCheckAt >= 250
    ) {
      lastCheckAt = now;
      await checkCancelled('导入任务已取消（增量写入已回滚）');
    }
  };
  const groupIds = new Map();
  for (const item of plan.operations.groupCreates) {
    await checkDuringWrites();
    const id = uuidv4();
    groupIds.set(item.key, id);
    const columns = config.withSite
      ? 'id, name, country, site, brand'
      : 'id, name, country, brand';
    const values = config.withSite
      ? [id, item.name, item.country, item.site, item.brand]
      : [id, item.name, item.country, item.brand];
    await query(
      `INSERT INTO ${config.groupTable} (${columns}) VALUES (${values
        .map(() => '?')
        .join(',')})`,
      values,
    );
  }
  for (const item of plan.operations.groupUpdates) {
    await checkDuringWrites();
    const fields = item.changes.map((change) => `${change.field} = ?`);
    await query(
      `UPDATE ${config.groupTable} SET ${fields.join(
        ', ',
      )}, update_time = NOW() WHERE id = ?`,
      [...item.changes.map((change) => change.to), item.id],
    );
  }
  const touchedGroupIds = new Set();
  for (const item of plan.operations.asinCreates) {
    await checkDuringWrites();
    const groupId = item.variantGroupId || groupIds.get(item.groupKey);
    if (!groupId) throw new Error('无法确定新ASIN所属变体组');
    const columns = config.withSite
      ? 'id, asin, name, asin_type, country, site, brand, variant_group_id'
      : 'id, asin, name, asin_type, country, brand, variant_group_id';
    const values = config.withSite
      ? [
          uuidv4(),
          item.asin,
          item.name,
          item.asinType,
          item.country,
          item.site,
          item.brand,
          groupId,
        ]
      : [
          uuidv4(),
          item.asin,
          item.name,
          item.asinType,
          item.country,
          item.brand,
          groupId,
        ];
    await query(
      `INSERT INTO ${config.asinTable} (${columns}) VALUES (${values
        .map(() => '?')
        .join(',')})`,
      values,
    );
    touchedGroupIds.add(groupId);
  }
  for (const item of plan.operations.asinUpdates) {
    await checkDuringWrites();
    const changes = item.changes.map((change) => ({
      ...change,
      field:
        change.field === 'asinType'
          ? 'asin_type'
          : change.field === 'variantGroupId'
          ? 'variant_group_id'
          : change.field,
      to:
        change.field === 'variantGroupId' && change.to === null
          ? groupIds.get(item.groupKey)
          : change.to,
    }));
    await query(
      `UPDATE ${config.asinTable} SET ${changes
        .map((change) => `${change.field} = ?`)
        .join(', ')}, update_time = NOW() WHERE id = ?`,
      [...changes.map((change) => change.to), item.id],
    );
    const move = item.changes.find(
      (change) => change.field === 'variantGroupId',
    );
    if (move) {
      if (move.from) touchedGroupIds.add(move.from);
      touchedGroupIds.add(move.to || groupIds.get(item.groupKey));
    }
  }
  for (const batch of batches([...touchedGroupIds])) {
    await checkDuringWrites();
    await query(
      `UPDATE ${config.groupTable} SET update_time = NOW() WHERE id IN (${batch
        .map(() => '?')
        .join(',')})`,
      batch,
    );
  }
}

async function applyIncrementalImport(
  file,
  {
    mode = 'standard',
    expectedDigest,
    previewId,
    checkCancelled,
    onProgress,
    db,
  } = {},
) {
  const config = getConfig(mode);
  if (db) config.db = db;
  if (!previewId || !expectedDigest) {
    const error = new Error('缺少预览ID或差异摘要');
    error.statusCode = 400;
    throw error;
  }
  if (onProgress) await onProgress(5, '正在解析导入文件');
  const parsed = await parseImportPayload(file, { mode, kind: 'incremental' });
  const fileHash = hashFile(file);
  if (onProgress) await onProgress(25, '正在重新比对数据库');
  let result;
  let committedBusinessChanges = false;
  try {
    result = await withImportLock(config.db, mode, async ({ query }) => {
      const receipts = await query(
        'SELECT file_hash, digest, result_json FROM import_confirmation_receipts WHERE preview_id = ? FOR UPDATE',
        [previewId],
      );
      if (receipts.length) {
        const receipt = receipts[0];
        if (receipt.file_hash !== fileHash || receipt.digest !== expectedDigest)
          throw staleError();
        return typeof receipt.result_json === 'string'
          ? JSON.parse(receipt.result_json)
          : receipt.result_json;
      }
      if (checkCancelled) await checkCancelled('导入任务已取消');
      const snapshots = await loadSnapshots(parsed, config, query, {
        lock: true,
      });
      const plan = planIncrementalImport(parsed, { ...snapshots, mode });
      if (digestPlan(fileHash, plan) !== expectedDigest) throw staleError();
      if (checkCancelled) await checkCancelled('导入任务已取消');
      await applyOperations(plan, config, query, checkCancelled);
      const finalResult = {
        ...plan.summary,
        errors: plan.rows
          .filter((row) => row.errors.length)
          .map((row) => ({
            row: row.rowNumber,
            message: row.errors.join('；'),
          })),
      };
      if (checkCancelled)
        await checkCancelled('导入任务已取消（增量写入已回滚）');
      await query(
        'INSERT INTO import_confirmation_receipts (preview_id, file_hash, digest, result_json) VALUES (?, ?, ?, ?)',
        [previewId, fileHash, expectedDigest, JSON.stringify(finalResult)],
      );
      if (checkCancelled)
        await checkCancelled('导入任务已取消（增量写入已回滚）');
      committedBusinessChanges =
        plan.summary.createdCount > 0 ||
        plan.summary.updatedCount > 0 ||
        plan.summary.createdGroupCount > 0 ||
        plan.summary.updatedGroupCount > 0;
      return finalResult;
    });
  } catch (error) {
    if (
      error.code === 'ER_DUP_ENTRY' &&
      /uk_asin_country/i.test(error.sqlMessage || error.message || '')
    ) {
      throw staleError();
    }
    throw error;
  }
  if (committedBusinessChanges) {
    await cacheService.deleteByPrefixAsync(
      mode === 'competitor' ? 'competitorVariantGroups:' : 'variantGroups:',
    );
  }
  if (onProgress) {
    try {
      await onProgress(100, '增量导入完成');
    } catch (error) {
      logger.warn('增量导入已提交，但更新进度失败', { message: error.message });
    }
  }
  return result;
}

module.exports = {
  planIncrementalImport,
  createIncrementalPreview,
  applyIncrementalImport,
};
