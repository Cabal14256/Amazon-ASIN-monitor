const { query } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class VariantGroup {
  // 查询所有变体组（带分页和筛选）
  static async findAll(params = {}) {
    const {
      keyword = '',
      country = '',
      variantStatus = '',
      current = 1,
      pageSize = 10,
    } = params;

    let sql = `
      SELECT DISTINCT
        vg.*,
        COUNT(DISTINCT a.id) as asin_count
      FROM variant_groups vg
      LEFT JOIN asins a ON a.variant_group_id = vg.id
      WHERE 1=1
    `;
    const queryValues = [];

    if (keyword) {
      // 搜索变体组名称、变体组ID，以及ASIN代码
      sql += ` AND (vg.name LIKE ? OR vg.id LIKE ? OR a.asin LIKE ?)`;
      queryValues.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }

    if (country) {
      sql += ` AND vg.country = ?`;
      queryValues.push(country);
    }

    if (variantStatus) {
      const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
      sql += ` AND vg.is_broken = ?`;
      queryValues.push(isBroken);
    }

    sql += ` GROUP BY vg.id`;

    // 获取总数（需要关联ASIN表以支持ASIN搜索）
    let countSql = `SELECT COUNT(DISTINCT vg.id) as total FROM variant_groups vg LEFT JOIN asins a ON a.variant_group_id = vg.id WHERE 1=1`;
    const countValues = [];

    if (keyword) {
      // 搜索变体组名称、变体组ID，以及ASIN代码
      countSql += ` AND (vg.name LIKE ? OR vg.id LIKE ? OR a.asin LIKE ?)`;
      countValues.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (country) {
      countSql += ` AND vg.country = ?`;
      countValues.push(country);
    }
    if (variantStatus) {
      const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
      countSql += ` AND vg.is_broken = ?`;
      countValues.push(isBroken);
    }

    const countResult = await query(countSql, countValues);
    const total = countResult[0]?.total || 0;

    // 分页 - LIMIT 和 OFFSET 不能使用参数绑定，必须直接拼接（确保是整数）
    const offset = (Number(current) - 1) * Number(pageSize);
    const limit = Number(pageSize);
    sql += ` ORDER BY vg.create_time DESC LIMIT ${limit} OFFSET ${offset}`;

    // 调试日志
    console.log('执行SQL:', sql);
    console.log('查询参数:', queryValues);

    const list = await query(sql, queryValues);
    console.log('查询到的变体组数量:', list.length);

    // 为每个变体组查询ASIN列表
    for (const group of list) {
      let asinQuery = `
        SELECT 
          id, asin, name, asin_type, country, site, brand, variant_group_id, 
          is_broken, variant_status, create_time, update_time,
          last_check_time, feishu_notify_enabled
        FROM asins WHERE variant_group_id = ?
      `;
      const asinQueryValues = [group.id];

      // 如果有keyword，无论通过什么方式找到变体组（名称、ID或ASIN），都返回该变体组下的所有ASIN
      // 这样用户可以查看完整的变体组信息
      // 注意：不再对ASIN进行过滤，因为用户搜索ASIN的目的是找到包含该ASIN的变体组，然后查看该变体组下的所有ASIN
      if (keyword) {
        const groupNameMatches =
          group.name &&
          group.name.toLowerCase().includes(keyword.toLowerCase());
        const groupIdMatches =
          group.id && group.id.toLowerCase().includes(keyword.toLowerCase());
        console.log(
          `变体组 ${group.id} (${group.name}): groupNameMatches=${groupNameMatches}, groupIdMatches=${groupIdMatches}`,
        );
        // 无论通过什么方式找到变体组，都返回所有ASIN
        console.log(`变体组 ${group.id} 返回所有ASIN`);
      }

      asinQuery += ` ORDER BY create_time ASC`;

      console.log('ASIN查询SQL:', asinQuery);
      console.log('ASIN查询参数:', asinQueryValues);

      const asins = await query(asinQuery, asinQueryValues);
      console.log(`变体组 ${group.id} 查询到的ASIN数量:`, asins.length);
      group.children = asins.map((asin) => ({
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: asin.asin_type, // 转换为驼峰命名
        country: asin.country,
        site: asin.site,
        brand: asin.brand,
        parentId: group.id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 1, // 默认为1
      }));
    }

    return {
      list,
      total,
      current: Number(current),
      pageSize: Number(pageSize),
    };
  }

  // 根据ID查询变体组
  static async findById(id) {
    const [group] = await query(`SELECT * FROM variant_groups WHERE id = ?`, [
      id,
    ]);
    if (group) {
      const asins = await query(
        `SELECT 
          id, asin, name, asin_type, country, site, brand, variant_group_id, 
          is_broken, variant_status, create_time, update_time,
          last_check_time, feishu_notify_enabled
        FROM asins WHERE variant_group_id = ? ORDER BY create_time ASC`,
        [id],
      );
      group.children = asins.map((asin) => ({
        id: asin.id,
        asin: asin.asin,
        name: asin.name,
        asinType: asin.asin_type,
        country: asin.country,
        site: asin.site,
        brand: asin.brand,
        parentId: group.id,
        isBroken: asin.is_broken,
        variantStatus: asin.variant_status,
        createTime: asin.create_time,
        updateTime: asin.update_time,
        lastCheckTime: asin.last_check_time,
        feishuNotifyEnabled:
          asin.feishu_notify_enabled !== null ? asin.feishu_notify_enabled : 1,
      }));
    }
    return group;
  }

  // 创建变体组
  static async create(data) {
    const id = uuidv4();
    const { name, country, site, brand } = data;
    await query(
      `INSERT INTO variant_groups (id, name, country, site, brand, is_broken, variant_status) 
       VALUES (?, ?, ?, ?, ?, 0, 'NORMAL')`,
      [id, name, country, site, brand],
    );
    return this.findById(id);
  }

  // 更新变体组
  static async update(id, data) {
    const { name, country, site, brand } = data;
    await query(
      `UPDATE variant_groups SET name = ?, country = ?, site = ?, brand = ?, update_time = NOW() WHERE id = ?`,
      [name, country, site, brand, id],
    );
    return this.findById(id);
  }

  // 删除变体组
  static async delete(id) {
    // 外键约束会自动删除关联的ASIN
    await query(`DELETE FROM variant_groups WHERE id = ?`, [id]);
    return true;
  }

  // 更新变体状态
  static async updateVariantStatus(id, isBroken) {
    const variantStatus = isBroken ? 'BROKEN' : 'NORMAL';
    await query(
      `UPDATE variant_groups SET is_broken = ?, variant_status = ?, update_time = NOW() WHERE id = ?`,
      [isBroken ? 1 : 0, variantStatus, id],
    );
    return this.findById(id);
  }
}

module.exports = VariantGroup;
