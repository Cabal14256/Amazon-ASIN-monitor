const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const VariantGroup = require('./VariantGroup');
const MonitorHistory = require('./MonitorHistory');
const { decorateAsinStatus } = require('../utils/variantStatus');

// 转换ASIN类型：将旧格式(MAIN_LINK/SUB_REVIEW)转换为新格式(1/2)
function normalizeAsinType(asinType) {
  if (!asinType) return null;
  const type = String(asinType).trim();
  // 兼容旧格式
  if (type === 'MAIN_LINK') return '1';
  if (type === 'SUB_REVIEW') return '2';
  // 新格式直接返回
  if (type === '1' || type === 1) return '1';
  if (type === '2' || type === 2) return '2';
  return null;
}

function buildManualActionCheckResult({
  action,
  reason,
  updatedBy,
  previousRecord,
  currentRecord,
  operationTime,
}) {
  return {
    source: 'MANUAL_ACTION',
    entityType: 'ASIN',
    action,
    operator: updatedBy || null,
    reason: reason || '',
    statusSource: currentRecord?.statusSource || 'NORMAL',
    manualBroken: currentRecord?.manualBroken === 1 ? 1 : 0,
    autoIsBroken: currentRecord?.autoIsBroken === 1 ? 1 : 0,
    effectiveIsBroken: currentRecord?.isBroken === 1 ? 1 : 0,
    previousStatusSource: previousRecord?.statusSource || 'NORMAL',
    previousManualBroken: previousRecord?.manualBroken === 1 ? 1 : 0,
    previousAutoIsBroken: previousRecord?.autoIsBroken === 1 ? 1 : 0,
    previousEffectiveIsBroken: previousRecord?.isBroken === 1 ? 1 : 0,
    manualBrokenReason: currentRecord?.manualBrokenReason || '',
    manualBrokenUpdatedAt:
      currentRecord?.manualBrokenUpdatedAt || operationTime,
    manualBrokenUpdatedBy:
      currentRecord?.manualBrokenUpdatedBy || updatedBy || null,
    manualBrokenScope: currentRecord?.manualBrokenScope || 'NONE',
    manualExcludedFromGroup:
      currentRecord?.manualExcludedFromGroup === 1 ? 1 : 0,
    manualExcludedReason: currentRecord?.manualExcludedReason || '',
    manualExcludedUpdatedAt: currentRecord?.manualExcludedUpdatedAt || null,
    manualExcludedUpdatedBy: currentRecord?.manualExcludedUpdatedBy || null,
  };
}

function buildParentManualOptions(record) {
  return {
    parentManualBroken: record?.parent_manual_broken || 0,
    parentManualBrokenReason: record?.parent_manual_broken_reason || null,
    parentManualBrokenUpdatedAt:
      record?.parent_manual_broken_updated_at || null,
    parentManualBrokenUpdatedBy:
      record?.parent_manual_broken_updated_by || null,
  };
}

function mapDecoratedAsin(normalized, parentId = normalized?.variant_group_id) {
  return {
    id: normalized.id,
    asin: normalized.asin,
    name: normalized.name,
    asinType: normalizeAsinType(normalized.asin_type),
    country: normalized.country,
    site: normalized.site,
    brand: normalized.brand,
    variantGroupId: normalized.variant_group_id,
    parentId,
    isBroken: normalized.isBroken,
    variantStatus: normalized.variantStatus,
    autoIsBroken: normalized.autoIsBroken,
    autoVariantStatus: normalized.autoVariantStatus,
    manualBroken: normalized.manualBroken,
    manualBrokenScope: normalized.manualBrokenScope,
    manualBrokenReason: normalized.manualBrokenReason,
    manualBrokenUpdatedAt: normalized.manualBrokenUpdatedAt,
    manualBrokenUpdatedBy: normalized.manualBrokenUpdatedBy,
    selfManualBroken: normalized.selfManualBroken,
    selfManualBrokenReason: normalized.selfManualBrokenReason,
    selfManualBrokenUpdatedAt: normalized.selfManualBrokenUpdatedAt,
    selfManualBrokenUpdatedBy: normalized.selfManualBrokenUpdatedBy,
    manualExcludedFromGroup: normalized.manualExcludedFromGroup,
    manualExcludedReason: normalized.manualExcludedReason,
    manualExcludedUpdatedAt: normalized.manualExcludedUpdatedAt,
    manualExcludedUpdatedBy: normalized.manualExcludedUpdatedBy,
    inheritedManualBroken: normalized.inheritedManualBroken,
    inheritedManualBrokenReason: normalized.inheritedManualBrokenReason,
    inheritedManualBrokenUpdatedAt: normalized.inheritedManualBrokenUpdatedAt,
    inheritedManualBrokenUpdatedBy: normalized.inheritedManualBrokenUpdatedBy,
    statusSource: normalized.statusSource,
    createTime: normalized.create_time,
    updateTime: normalized.update_time,
    lastCheckTime: normalized.last_check_time,
    feishuNotifyEnabled:
      normalized.feishu_notify_enabled !== null
        ? normalized.feishu_notify_enabled
        : 1,
  };
}

class ASIN {
  // 查询所有ASIN
  static async findAll(params = {}) {
    const { variantGroupId, country, current = 1, pageSize = 10 } = params;
    let sql = `
      SELECT
        a.*,
        vg.manual_broken as parent_manual_broken,
        vg.manual_broken_reason as parent_manual_broken_reason,
        vg.manual_broken_updated_at as parent_manual_broken_updated_at,
        vg.manual_broken_updated_by as parent_manual_broken_updated_by
      FROM asins a
      LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
      WHERE 1=1
    `;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND a.variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (country) {
      sql += ` AND a.country = ?`;
      conditions.push(country);
    }

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY a.create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);
    return list.map((asin) =>
      mapDecoratedAsin(
        decorateAsinStatus(asin, buildParentManualOptions(asin)),
      ),
    );
  }

  // 根据ID查询ASIN
  static async findById(id) {
    const [asin] = await query(
      `SELECT 
        a.id, a.asin, a.name, a.asin_type, a.country, a.site, a.brand,
        a.variant_group_id, a.is_broken, a.variant_status, a.manual_broken,
        a.manual_broken_reason, a.manual_broken_updated_at,
        a.manual_broken_updated_by, a.manual_excluded_from_group,
        a.manual_excluded_reason, a.manual_excluded_updated_at,
        a.manual_excluded_updated_by, a.create_time, a.update_time,
        a.last_check_time, a.feishu_notify_enabled,
        vg.manual_broken as parent_manual_broken,
        vg.manual_broken_reason as parent_manual_broken_reason,
        vg.manual_broken_updated_at as parent_manual_broken_updated_at,
        vg.manual_broken_updated_by as parent_manual_broken_updated_by
      FROM asins a
      LEFT JOIN variant_groups vg ON vg.id = a.variant_group_id
      WHERE a.id = ?`,
      [id],
    );
    if (asin) {
      return mapDecoratedAsin(
        decorateAsinStatus(asin, buildParentManualOptions(asin)),
      );
    }
    return null;
  }

  // 更新飞书通知开关
  static async updateFeishuNotify(asinId, enabled) {
    await query(
      `UPDATE asins SET feishu_notify_enabled = ?, update_time = NOW() WHERE id = ?`,
      [enabled ? 1 : 0, asinId],
    );
    return this.findById(asinId);
  }

  // 同时更新变体状态和监控时间（减少写入次数）
  static async updateVariantStatusAndCheckTime(asinId, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE asins
       SET is_broken = ?, variant_status = ?, last_check_time = NOW(), update_time = NOW()
       WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, asinId],
    );
  }

  // 更新监控时间
  static async updateLastCheckTime(asinId) {
    await query(
      `UPDATE asins SET last_check_time = NOW(), update_time = NOW() WHERE id = ?`,
      [asinId],
    );
  }

  // 根据ASIN编码查询（可选：同时查询国家）
  static async findByASIN(asin, country = null) {
    if (country) {
      const [result] = await query(
        `SELECT * FROM asins WHERE asin = ? AND country = ?`,
        [asin, country],
      );
      return result;
    }
    const [result] = await query(`SELECT * FROM asins WHERE asin = ?`, [asin]);
    return result;
  }

  // 创建ASIN
  static async create(data) {
    const id = uuidv4();
    const { asin, name, country, site, brand, variantGroupId, asinType } = data;

    // 检查ASIN是否已存在（同一国家）
    const existing = await this.findByASIN(asin, country);
    if (existing) {
      throw new Error(`ASIN ${asin} 在国家 ${country} 中已存在`);
    }

    await query(
      `INSERT INTO asins (id, asin, name, asin_type, country, site, brand, variant_group_id, is_broken, variant_status) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'NORMAL')`,
      [
        id,
        asin,
        name || null,
        asinType || null,
        country,
        site,
        brand,
        variantGroupId,
      ],
    );

    // 更新变体组的更新时间（ASIN变动）
    if (variantGroupId) {
      await VariantGroup.updateTimeOnASINChange(variantGroupId);
    }

    return this.findById(id);
  }

  // 更新ASIN
  static async update(id, data) {
    const { asin, name, country, site, brand, asinType } = data;
    await query(
      `UPDATE asins SET asin = ?, name = ?, asin_type = ?, country = ?, site = ?, brand = ?, update_time = NOW() WHERE id = ?`,
      [asin, name, asinType || null, country, site, brand, id],
    );
    return this.findById(id);
  }

  // 移动到其他变体组
  static async moveToGroup(asinId, targetGroupId) {
    // 先获取当前ASIN的变体组ID（源变体组）
    const asin = await this.findById(asinId);
    if (!asin) {
      throw new Error('ASIN不存在');
    }
    const sourceGroupId = asin.variantGroupId;

    await query(
      `UPDATE asins SET variant_group_id = ?, update_time = NOW() WHERE id = ?`,
      [targetGroupId, asinId],
    );

    // 更新源变体组和目标变体组的更新时间（ASIN变动）
    if (sourceGroupId) {
      await VariantGroup.updateTimeOnASINChange(sourceGroupId);
    }
    if (targetGroupId && targetGroupId !== sourceGroupId) {
      await VariantGroup.updateTimeOnASINChange(targetGroupId);
    }

    return this.findById(asinId);
  }

  // 删除ASIN
  static async delete(id) {
    // 先获取ASIN的变体组ID，以便更新变体组的更新时间
    const asin = await this.findById(id);
    const variantGroupId = asin?.variantGroupId;

    await query(`DELETE FROM asins WHERE id = ?`, [id]);

    // 更新变体组的更新时间（ASIN变动）
    if (variantGroupId) {
      await VariantGroup.updateTimeOnASINChange(variantGroupId);
    }

    return true;
  }

  // 更新变体状态
  static async updateVariantStatus(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE asins SET is_broken = ?, variant_status = ?, update_time = NOW() WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );
  }

  // 更新人工异常标记
  static async updateManualBroken(id, markedBroken, reason, updatedBy = null) {
    return this.updateManualBrokenAction(id, {
      action: markedBroken ? 'MARK_BROKEN' : 'CLEAR_SELF_MANUAL',
      reason,
      updatedBy,
    });
  }

  static async updateManualBrokenAction(
    id,
    { action, reason, updatedBy = null } = {},
  ) {
    const existing = await this.findById(id);
    if (!existing) {
      return null;
    }

    const normalizedAction = String(action || '')
      .trim()
      .toUpperCase();
    const normalizedReason = reason ? String(reason).trim().slice(0, 500) : '';
    const normalizedUpdatedBy = updatedBy
      ? String(updatedBy).trim().slice(0, 100)
      : null;
    const operationTime = new Date();
    const nextState = {
      manualBroken: existing.selfManualBroken === 1 ? 1 : 0,
      manualBrokenReason: existing.selfManualBrokenReason || null,
      manualBrokenUpdatedAt: existing.selfManualBrokenUpdatedAt || null,
      manualBrokenUpdatedBy: existing.selfManualBrokenUpdatedBy || null,
      manualExcludedFromGroup: existing.manualExcludedFromGroup === 1 ? 1 : 0,
      manualExcludedReason: existing.manualExcludedReason || null,
      manualExcludedUpdatedAt: existing.manualExcludedUpdatedAt || null,
      manualExcludedUpdatedBy: existing.manualExcludedUpdatedBy || null,
    };

    switch (normalizedAction) {
      case 'MARK_BROKEN':
        nextState.manualBroken = 1;
        nextState.manualBrokenReason = normalizedReason || null;
        nextState.manualBrokenUpdatedAt = operationTime;
        nextState.manualBrokenUpdatedBy = normalizedUpdatedBy;
        break;
      case 'CLEAR_SELF_MANUAL':
        nextState.manualBroken = 0;
        nextState.manualBrokenReason = null;
        nextState.manualBrokenUpdatedAt = null;
        nextState.manualBrokenUpdatedBy = null;
        break;
      case 'EXCLUDE_GROUP_MANUAL':
        nextState.manualExcludedFromGroup = 1;
        nextState.manualExcludedReason = normalizedReason || null;
        nextState.manualExcludedUpdatedAt = operationTime;
        nextState.manualExcludedUpdatedBy = normalizedUpdatedBy;
        break;
      case 'CLEAR_GROUP_EXCLUSION':
        nextState.manualExcludedFromGroup = 0;
        nextState.manualExcludedReason = null;
        nextState.manualExcludedUpdatedAt = null;
        nextState.manualExcludedUpdatedBy = null;
        break;
      default:
        throw new Error('不支持的人工标记动作');
    }

    await query(
      `UPDATE asins
       SET manual_broken = ?,
           manual_broken_reason = ?,
           manual_broken_updated_at = ?,
           manual_broken_updated_by = ?,
           manual_excluded_from_group = ?,
           manual_excluded_reason = ?,
           manual_excluded_updated_at = ?,
           manual_excluded_updated_by = ?,
           update_time = NOW()
       WHERE id = ?`,
      [
        nextState.manualBroken,
        nextState.manualBrokenReason,
        nextState.manualBrokenUpdatedAt,
        nextState.manualBrokenUpdatedBy,
        nextState.manualExcludedFromGroup,
        nextState.manualExcludedReason,
        nextState.manualExcludedUpdatedAt,
        nextState.manualExcludedUpdatedBy,
        id,
      ],
    );

    if (existing.variantGroupId) {
      await VariantGroup.updateTimeOnASINChange(existing.variantGroupId);
    } else {
      VariantGroup.clearCache();
    }

    const updated = await this.findById(id);

    let variantGroupName = null;
    if (existing.variantGroupId) {
      const [groupSnapshot] = await query(
        `SELECT name FROM variant_groups WHERE id = ?`,
        [existing.variantGroupId],
      );
      variantGroupName = groupSnapshot?.name || null;
    }

    await MonitorHistory.create({
      asinId: existing.id,
      asinCode: existing.asin || null,
      asinName: existing.name || null,
      siteSnapshot: existing.site || null,
      brandSnapshot: existing.brand || null,
      variantGroupId: existing.variantGroupId || null,
      variantGroupName,
      checkType: 'ASIN',
      country: existing.country || null,
      isBroken: updated?.isBroken === 1 ? 1 : 0,
      checkTime: operationTime,
      checkResult: buildManualActionCheckResult({
        action: normalizedAction,
        reason:
          normalizedReason ||
          existing.manualBrokenReason ||
          existing.manualExcludedReason ||
          '',
        updatedBy: normalizedUpdatedBy || updatedBy || null,
        previousRecord: existing,
        currentRecord: updated,
        operationTime,
      }),
    });

    return updated;
  }
}

module.exports = ASIN;
