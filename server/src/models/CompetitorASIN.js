const { query, withTransaction } = require('../config/competitor-database');
const { v4: uuidv4 } = require('uuid');
const CompetitorVariantGroup = require('./CompetitorVariantGroup');

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

function normalizeAsinCode(asin) {
  return asin ? String(asin).trim().toUpperCase() : asin;
}

function normalizeCountryCode(country) {
  return country ? String(country).trim().toUpperCase() : country;
}

function createValidationError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function findVariantGroupById(variantGroupId, queryExecutor = query) {
  if (!variantGroupId) {
    return null;
  }

  const [group] = await queryExecutor(
    `SELECT id, country FROM competitor_variant_groups WHERE id = ?`,
    [variantGroupId],
  );
  return group || null;
}

class CompetitorASIN {
  // 查询所有ASIN
  static async findAll(params = {}) {
    const { variantGroupId, country, current = 1, pageSize = 10 } = params;
    let sql = `SELECT * FROM competitor_asins WHERE 1=1`;
    const conditions = [];

    if (variantGroupId) {
      sql += ` AND variant_group_id = ?`;
      conditions.push(variantGroupId);
    }

    if (country) {
      sql += ` AND country = ?`;
      conditions.push(normalizeCountryCode(country));
    }

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    const list = await query(sql, conditions);
    return list;
  }

  // 根据ID查询ASIN
  static async findById(id) {
    const [asin] = await query(
      `SELECT
        id, asin, name, asin_type, country, brand, variant_group_id,
        is_broken, variant_status, create_time, update_time,
        last_check_time, feishu_notify_enabled
      FROM competitor_asins WHERE id = ?`,
      [id],
    );
    if (asin) {
      return {
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: normalizeAsinType(asin.asin_type),
        country: asin.country,
        brand: asin.brand,
        variantGroupId: asin.variant_group_id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 0,
      };
    }
    return null;
  }

  // 更新飞书通知开关
  static async updateFeishuNotify(asinId, enabled) {
    await query(
      `UPDATE competitor_asins SET feishu_notify_enabled = ?, update_time = NOW() WHERE id = ?`,
      [enabled ? 1 : 0, asinId],
    );
    CompetitorVariantGroup.clearCache();
    return this.findById(asinId);
  }

  // 同时更新变体状态和监控时间（减少写入次数）
  static async updateVariantStatusAndCheckTime(asinId, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE competitor_asins
       SET is_broken = ?, variant_status = ?, last_check_time = NOW(), update_time = NOW()
       WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, asinId],
    );
  }

  // 更新监控时间
  static async updateLastCheckTime(asinId) {
    await query(
      `UPDATE competitor_asins SET last_check_time = NOW(), update_time = NOW() WHERE id = ?`,
      [asinId],
    );
  }

  // 根据ASIN编码查询（可选：同时查询国家）
  static async findByASIN(asin, country = null) {
    const normalizedAsin = normalizeAsinCode(asin);
    const normalizedCountry = normalizeCountryCode(country);
    if (country) {
      const [result] = await query(
        `SELECT * FROM competitor_asins WHERE asin = ? AND country = ?`,
        [normalizedAsin, normalizedCountry],
      );
      return result;
    }
    const [result] = await query(
      `SELECT * FROM competitor_asins WHERE asin = ?`,
      [normalizedAsin],
    );
    return result;
  }

  static async findByASINWithExecutor(asin, country, options = {}) {
    const { excludeId = null, queryExecutor = query } = options;
    const normalizedAsin = normalizeAsinCode(asin);
    const normalizedCountry = normalizeCountryCode(country);
    let sql = `SELECT * FROM competitor_asins WHERE asin = ? AND country = ?`;
    const params = [normalizedAsin, normalizedCountry];

    if (excludeId) {
      sql += ` AND id <> ?`;
      params.push(excludeId);
    }

    const [result] = await queryExecutor(sql, params);
    return result || null;
  }

  // 创建ASIN
  static async create(data) {
    const id = uuidv4();
    const normalizedAsin = normalizeAsinCode(data.asin);
    const normalizedCountry = normalizeCountryCode(data.country);
    const { name, brand, variantGroupId, asinType } = data;

    await withTransaction(async ({ query: transactionQuery }) => {
      const variantGroup = await findVariantGroupById(
        variantGroupId,
        transactionQuery,
      );
      if (!variantGroup) {
        throw createValidationError('所属竞品变体组不存在');
      }
      if (variantGroup.country !== normalizedCountry) {
        throw createValidationError(
          `ASIN国家必须与所属变体组一致（${variantGroup.country}）`,
        );
      }

      const existing = await this.findByASINWithExecutor(
        normalizedAsin,
        normalizedCountry,
        { queryExecutor: transactionQuery },
      );
      if (existing) {
        throw createValidationError(
          `ASIN ${normalizedAsin} 在国家 ${normalizedCountry} 中已存在`,
        );
      }

      await transactionQuery(
        `INSERT INTO competitor_asins (id, asin, name, asin_type, country, brand, variant_group_id, is_broken, variant_status, feishu_notify_enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'NORMAL', 0)`,
        [
          id,
          normalizedAsin,
          name || null,
          normalizeAsinType(asinType),
          normalizedCountry,
          brand,
          variantGroupId,
        ],
      );

      await transactionQuery(
        `UPDATE competitor_variant_groups SET update_time = NOW() WHERE id = ?`,
        [variantGroupId],
      );
    });

    CompetitorVariantGroup.clearCache();
    return this.findById(id);
  }

  // 更新ASIN
  static async update(id, data) {
    const normalizedAsin = normalizeAsinCode(data.asin);
    const normalizedCountry = normalizeCountryCode(data.country);
    const { name, brand, asinType } = data;

    const updated = await withTransaction(
      async ({ query: transactionQuery }) => {
        const [existing] = await transactionQuery(
          `SELECT id, variant_group_id FROM competitor_asins WHERE id = ? FOR UPDATE`,
          [id],
        );
        if (!existing) {
          return false;
        }

        const variantGroup = await findVariantGroupById(
          existing.variant_group_id,
          transactionQuery,
        );
        if (!variantGroup) {
          throw createValidationError('所属竞品变体组不存在');
        }
        if (variantGroup.country !== normalizedCountry) {
          throw createValidationError(
            `ASIN国家必须与所属变体组一致（${variantGroup.country}）`,
          );
        }

        const duplicate = await this.findByASINWithExecutor(
          normalizedAsin,
          normalizedCountry,
          {
            excludeId: id,
            queryExecutor: transactionQuery,
          },
        );
        if (duplicate) {
          throw createValidationError(
            `ASIN ${normalizedAsin} 在国家 ${normalizedCountry} 中已存在`,
          );
        }

        await transactionQuery(
          `UPDATE competitor_asins
         SET asin = ?, name = ?, asin_type = ?, country = ?, brand = ?, update_time = NOW()
         WHERE id = ?`,
          [
            normalizedAsin,
            name || null,
            normalizeAsinType(asinType),
            normalizedCountry,
            brand,
            id,
          ],
        );

        await transactionQuery(
          `UPDATE competitor_variant_groups SET update_time = NOW() WHERE id = ?`,
          [existing.variant_group_id],
        );

        return true;
      },
    );

    if (!updated) {
      return null;
    }

    CompetitorVariantGroup.clearCache();
    return this.findById(id);
  }

  // 移动到其他变体组
  static async moveToGroup(asinId, targetGroupId) {
    await withTransaction(async ({ query: transactionQuery }) => {
      const [asin] = await transactionQuery(
        `SELECT id, country, variant_group_id
         FROM competitor_asins
         WHERE id = ?
         FOR UPDATE`,
        [asinId],
      );
      if (!asin) {
        throw createValidationError('ASIN不存在', 404);
      }

      const sourceGroupId = asin.variant_group_id;
      if (sourceGroupId === targetGroupId) {
        return;
      }

      const targetGroup = await findVariantGroupById(
        targetGroupId,
        transactionQuery,
      );
      if (!targetGroup) {
        throw createValidationError('目标竞品变体组不存在');
      }
      if (targetGroup.country !== asin.country) {
        throw createValidationError(
          `目标变体组国家为 ${targetGroup.country}，与ASIN当前国家 ${asin.country} 不一致`,
        );
      }

      await transactionQuery(
        `UPDATE competitor_asins SET variant_group_id = ?, update_time = NOW() WHERE id = ?`,
        [targetGroupId, asinId],
      );

      if (sourceGroupId) {
        await transactionQuery(
          `UPDATE competitor_variant_groups SET update_time = NOW() WHERE id = ?`,
          [sourceGroupId],
        );
      }
      await transactionQuery(
        `UPDATE competitor_variant_groups SET update_time = NOW() WHERE id = ?`,
        [targetGroupId],
      );
    });

    CompetitorVariantGroup.clearCache();
    return this.findById(asinId);
  }

  // 删除ASIN
  static async delete(id) {
    const asin = await this.findById(id);
    if (!asin) {
      return false;
    }
    const variantGroupId = asin?.variantGroupId;

    await query(`DELETE FROM competitor_asins WHERE id = ?`, [id]);

    if (variantGroupId) {
      await CompetitorVariantGroup.updateTimeOnASINChange(variantGroupId);
    }

    return true;
  }

  // 更新变体状态
  static async updateVariantStatus(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE competitor_asins SET is_broken = ?, variant_status = ?, update_time = NOW() WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );
  }
}

module.exports = CompetitorASIN;
