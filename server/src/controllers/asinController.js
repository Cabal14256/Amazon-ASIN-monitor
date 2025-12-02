const VariantGroup = require('../models/VariantGroup');
const ASIN = require('../models/ASIN');

// 查询变体组列表
exports.getVariantGroups = async (req, res) => {
  try {
    const { keyword, country, variantStatus, current, pageSize } = req.query;
    console.log('查询参数:', {
      keyword,
      country,
      variantStatus,
      current,
      pageSize,
    });
    const result = await VariantGroup.findAll({
      keyword,
      country,
      variantStatus,
      current: current || 1,
      pageSize: pageSize || 10,
    });
    res.json({
      success: true,
      data: result,
      errorCode: 0,
    });
  } catch (error) {
    console.error('查询变体组列表错误:', error);
    console.error('错误堆栈:', error.stack);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
      errorDetails:
        process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};

// 获取变体组详情
exports.getVariantGroupById = async (req, res) => {
  try {
    const { groupId } = req.params;
    const group = await VariantGroup.findById(groupId);
    if (!group) {
      return res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: group,
      errorCode: 0,
    });
  } catch (error) {
    console.error('查询变体组详情错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '查询失败',
      errorCode: 500,
    });
  }
};

// 创建变体组
exports.createVariantGroup = async (req, res) => {
  try {
    const { name, country, site, brand } = req.body;
    if (!name || !country || !site || !brand) {
      return res.status(400).json({
        success: false,
        errorMessage: '名称、国家、站点和品牌为必填项',
        errorCode: 400,
      });
    }
    const group = await VariantGroup.create({ name, country, site, brand });
    res.json({
      success: true,
      data: group,
      errorCode: 0,
    });
  } catch (error) {
    console.error('创建变体组错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '创建失败',
      errorCode: 500,
    });
  }
};

// 更新变体组
exports.updateVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { name, country, site, brand } = req.body;
    if (!name || !country || !site || !brand) {
      return res.status(400).json({
        success: false,
        errorMessage: '名称、国家、站点和品牌为必填项',
        errorCode: 400,
      });
    }
    const group = await VariantGroup.update(groupId, {
      name,
      country,
      site,
      brand,
    });
    if (!group) {
      return res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: group,
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新变体组错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 删除变体组
exports.deleteVariantGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    await VariantGroup.delete(groupId);
    res.json({
      success: true,
      data: '删除成功',
      errorCode: 0,
    });
  } catch (error) {
    console.error('删除变体组错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '删除失败',
      errorCode: 500,
    });
  }
};

// 添加ASIN
exports.createASIN = async (req, res) => {
  try {
    const { asin, name, country, site, brand, parentId, asinType } = req.body;
    if (!asin || !country || !site || !brand || !parentId) {
      return res.status(400).json({
        success: false,
        errorMessage: 'ASIN、国家、站点、品牌和变体组ID为必填项',
        errorCode: 400,
      });
    }
    // 验证asinType值
    if (asinType && !['MAIN_LINK', 'SUB_REVIEW'].includes(asinType)) {
      return res.status(400).json({
        success: false,
        errorMessage: 'ASIN类型必须是 MAIN_LINK 或 SUB_REVIEW',
        errorCode: 400,
      });
    }
    const asinData = await ASIN.create({
      asin,
      name: name || null, // name字段可选
      country,
      site,
      brand,
      variantGroupId: parentId,
      asinType: asinType || null,
    });
    res.json({
      success: true,
      data: asinData,
      errorCode: 0,
    });
  } catch (error) {
    console.error('创建ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '创建失败',
      errorCode: 500,
    });
  }
};

// 更新ASIN
exports.updateASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { asin, name, country, site, brand, asinType } = req.body;
    if (!asin || !country || !site || !brand) {
      return res.status(400).json({
        success: false,
        errorMessage: 'ASIN、国家、站点和品牌为必填项',
        errorCode: 400,
      });
    }
    // 验证asinType值
    if (asinType && !['MAIN_LINK', 'SUB_REVIEW'].includes(asinType)) {
      return res.status(400).json({
        success: false,
        errorMessage: 'ASIN类型必须是 MAIN_LINK 或 SUB_REVIEW',
        errorCode: 400,
      });
    }
    const asinData = await ASIN.update(asinId, {
      asin,
      name,
      country,
      site,
      brand,
      asinType,
    });
    if (!asinData) {
      return res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: asinData,
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 移动ASIN到其他变体组
exports.moveASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { targetGroupId } = req.body;
    if (!targetGroupId) {
      return res.status(400).json({
        success: false,
        errorMessage: '目标变体组ID为必填项',
        errorCode: 400,
      });
    }
    const asinData = await ASIN.moveToGroup(asinId, targetGroupId);
    if (!asinData) {
      return res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: asinData,
      errorCode: 0,
    });
  } catch (error) {
    console.error('移动ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '移动失败',
      errorCode: 500,
    });
  }
};

// 更新ASIN飞书通知开关
exports.updateASINFeishuNotify = async (req, res) => {
  try {
    const { asinId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'enabled参数必须是布尔值或0/1',
        errorCode: 400,
      });
    }
    const asinData = await ASIN.updateFeishuNotify(asinId, enabled);
    if (!asinData) {
      return res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: asinData,
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新ASIN飞书通知开关错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 更新变体组飞书通知开关
exports.updateVariantGroupFeishuNotify = async (req, res) => {
  try {
    const { groupId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean' && enabled !== 0 && enabled !== 1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'enabled参数必须是布尔值或0/1',
        errorCode: 400,
      });
    }
    const groupData = await VariantGroup.updateFeishuNotify(groupId, enabled);
    if (!groupData) {
      return res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
    res.json({
      success: true,
      data: groupData,
      errorCode: 0,
    });
  } catch (error) {
    console.error('更新变体组飞书通知开关错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '更新失败',
      errorCode: 500,
    });
  }
};

// 删除ASIN
exports.deleteASIN = async (req, res) => {
  try {
    const { asinId } = req.params;
    await ASIN.delete(asinId);
    res.json({
      success: true,
      data: '删除成功',
      errorCode: 0,
    });
  } catch (error) {
    console.error('删除ASIN错误:', error);
    res.status(500).json({
      success: false,
      errorMessage: error.message || '删除失败',
      errorCode: 500,
    });
  }
};

// Excel导入变体组和ASIN
exports.importFromExcel = async (req, res) => {
  try {
    if (!req.file) {
      console.error('Excel导入错误: 没有收到文件', {
        body: req.body,
        files: req.files,
        file: req.file,
      });
      return res.status(400).json({
        success: false,
        errorMessage: '请上传Excel文件',
        errorCode: 400,
      });
    }

    console.log('收到文件:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });

    const XLSX = require('xlsx');
    let workbook;
    try {
      // 处理可能的BOM（字节顺序标记）
      let buffer = req.file.buffer;
      // 检查并移除UTF-8 BOM (EF BB BF)
      if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        buffer = buffer.slice(3);
      }
      // 检查并移除UTF-16 LE BOM (FF FE)
      if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        buffer = buffer.slice(2);
      }
      // 检查并移除UTF-16 BE BOM (FE FF)
      if (buffer[0] === 0xfe && buffer[1] === 0xff) {
        buffer = buffer.slice(2);
      }

      workbook = XLSX.read(buffer, {
        type: 'buffer',
        codepage: 65001, // UTF-8
      });
    } catch (parseError) {
      console.error('Excel解析错误:', parseError);
      return res.status(400).json({
        success: false,
        errorMessage:
          'Excel文件格式错误，无法解析。请确保文件是有效的 .xlsx, .xls 或 .csv 格式',
        errorCode: 400,
      });
    }

    if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
      return res.status(400).json({
        success: false,
        errorMessage: 'Excel文件不包含任何工作表',
        errorCode: 400,
      });
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    // 使用 header: 1 来获取原始数组数据，而不是对象
    const data = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '', // 空单元格使用空字符串
      raw: false, // 不保留原始值，进行格式化
      codepage: 65001, // UTF-8
    });

    console.log('解析到的数据行数:', data.length);
    if (data.length > 0) {
      console.log('第一行数据（表头）原始:', data[0]);
      console.log(
        '第一行数据（表头）类型:',
        data[0].map((h) => typeof h),
      );
    }

    if (data.length < 2) {
      return res.status(400).json({
        success: false,
        errorMessage: 'Excel文件至少需要包含表头和数据行',
        errorCode: 400,
      });
    }

    // 解析表头，尝试修复编码问题
    const headers = data[0].map((h) => {
      let header = String(h || '').trim();
      // 尝试修复常见的编码问题（ISO-8859-1/Windows-1252 被误读为 UTF-8）
      // 如果检测到乱码特征，尝试重新编码
      if (
        header.includes('±ä') ||
        header.includes('Ìå') ||
        header.includes('×é')
      ) {
        try {
          // 尝试将ISO-8859-1编码的字符串转换为UTF-8
          const buffer = Buffer.from(header, 'latin1');
          header = buffer.toString('utf8');
        } catch (e) {
          // 如果转换失败，保持原样
        }
      }
      return header;
    });
    console.log('解析到的表头（修复后）:', headers);

    // 改进表头匹配逻辑，支持更多变体
    // 使用更宽松的匹配，支持部分匹配和位置匹配
    const groupNameIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      // 检查是否包含关键词，或者根据位置判断（通常是第一列）
      return (
        h.includes('变体组') ||
        h.includes('组名称') ||
        h === '变体组名称' ||
        h.includes('变体') ||
        h.includes('组') ||
        lowerH.includes('group') ||
        lowerH.includes('variant') ||
        (index === 0 && h.length > 0)
      ); // 如果第一列有内容，可能是变体组名称
    });
    const countryIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      return (
        h.includes('国家') ||
        h === '国家' ||
        h.includes('国') ||
        lowerH.includes('country') ||
        lowerH === 'country' ||
        (index === 1 && h.length > 0 && h.length < 10)
      ); // 第二列，短文本可能是国家
    });
    const siteIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      return (
        h.includes('站点') ||
        h === '站点' ||
        h.includes('站') ||
        lowerH.includes('site') ||
        (index === 2 && h.length > 0 && h.length < 20)
      ); // 第三列可能是站点
    });
    const brandIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      return (
        h.includes('品牌') ||
        h === '品牌' ||
        h.includes('品') ||
        lowerH.includes('brand') ||
        (index === 3 && h.length > 0 && h.length < 50)
      ); // 第四列可能是品牌
    });
    const asinIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      return (
        h.includes('ASIN') ||
        h === 'ASIN' ||
        h === 'asin' ||
        lowerH === 'asin' ||
        lowerH.includes('asin') ||
        (index === 4 && h.length > 0 && /^[A-Z0-9]+$/i.test(h))
      ); // 第五列，可能是ASIN
    });
    // ASIN名称列是可选的，如果存在就读取，不存在就忽略
    const asinNameIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      return (
        (h.includes('名称') && h.includes('ASIN')) ||
        h === 'ASIN名称' ||
        (h.includes('名称') && !h.includes('组') && !h.includes('变体组')) ||
        (lowerH.includes('asin') && lowerH.includes('name')) ||
        (lowerH.includes('name') &&
          !lowerH.includes('group') &&
          !lowerH.includes('variant'))
      );
    });

    // ASIN类型列识别（优先级：包含"类型"和"ASIN"，或者包含"类型"但不包含"组"）
    const asinTypeIndex = headers.findIndex((h, index) => {
      const lowerH = h.toLowerCase();
      // 优先匹配：包含"类型"和"ASIN"
      if ((h.includes('类型') && h.includes('ASIN')) || h === 'ASIN类型') {
        return true;
      }
      // 次优匹配：包含"类型"但不包含"组"或"变体组"
      if (h.includes('类型') && !h.includes('组') && !h.includes('变体组')) {
        return true;
      }
      // 英文匹配
      if (
        (lowerH.includes('asin') && lowerH.includes('type')) ||
        (lowerH.includes('type') && !lowerH.includes('variant'))
      ) {
        return true;
      }
      // 位置匹配：如果ASIN列后面还有列，可能是ASIN类型（通常是最后一列或倒数第二列）
      if (
        asinIndex !== -1 &&
        index > asinIndex &&
        index === headers.length - 1
      ) {
        return true;
      }
      if (
        asinIndex !== -1 &&
        index > asinIndex &&
        index === headers.length - 2
      ) {
        return true;
      }
      return false;
    });

    console.log('表头索引:', {
      groupNameIndex,
      countryIndex,
      siteIndex,
      brandIndex,
      asinIndex,
      asinNameIndex,
      asinTypeIndex,
    });

    if (groupNameIndex === -1 || countryIndex === -1 || asinIndex === -1) {
      const missingColumns = [];
      if (groupNameIndex === -1) missingColumns.push('变体组名称');
      if (countryIndex === -1) missingColumns.push('国家');
      if (asinIndex === -1) missingColumns.push('ASIN');

      return res.status(400).json({
        success: false,
        errorMessage: `Excel文件必须包含：${missingColumns.join(
          '、',
        )}列。当前表头：${headers.join(', ')}`,
        errorCode: 400,
      });
    }

    // 检查站点和品牌列（必填）
    if (siteIndex === -1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'Excel文件必须包含：站点列',
        errorCode: 400,
      });
    }
    if (brandIndex === -1) {
      return res.status(400).json({
        success: false,
        errorMessage: 'Excel文件必须包含：品牌列',
        errorCode: 400,
      });
    }

    // 按变体组名称分组
    const groupMap = new Map();
    const errors = [];
    let rowNumber = 1; // 从表头后的第一行开始

    for (let i = 1; i < data.length; i++) {
      rowNumber++;
      const row = data[i];
      if (!row || row.length === 0) continue;

      const groupName = String(row[groupNameIndex] || '').trim();
      const country = String(row[countryIndex] || '')
        .trim()
        .toUpperCase();
      const site = String(row[siteIndex] || '').trim();
      const brand = String(row[brandIndex] || '').trim();
      const asin = String(row[asinIndex] || '').trim();
      // ASIN名称是可选的，如果列不存在或为空，则使用null
      const asinName =
        asinNameIndex !== -1 ? String(row[asinNameIndex] || '').trim() : null;
      // ASIN类型是可选的
      const asinType =
        asinTypeIndex !== -1 ? String(row[asinTypeIndex] || '').trim() : '';

      console.log(`行 ${rowNumber} 数据:`, {
        groupName,
        country,
        site,
        brand,
        asin,
        asinName,
        asinType,
        asinNameIndex,
        asinTypeIndex,
        rowLength: row.length,
      });

      // 验证必填字段
      if (!groupName) {
        errors.push({ row: rowNumber, message: '变体组名称不能为空' });
        continue;
      }
      if (!country || !['US', 'UK', 'DE', 'FR', 'IT', 'ES'].includes(country)) {
        errors.push({
          row: rowNumber,
          message: `国家代码无效: ${country}，必须是 US/UK/DE/FR/IT/ES 之一`,
        });
        continue;
      }
      if (!site) {
        errors.push({ row: rowNumber, message: '站点（店铺代号）不能为空' });
        continue;
      }
      if (!brand) {
        errors.push({ row: rowNumber, message: '品牌不能为空' });
        continue;
      }
      if (!asin) {
        errors.push({ row: rowNumber, message: 'ASIN不能为空' });
        continue;
      }

      // 验证ASIN类型
      if (asinType && !['MAIN_LINK', 'SUB_REVIEW'].includes(asinType)) {
        errors.push({
          row: rowNumber,
          message: `ASIN类型无效: ${asinType}，必须是 MAIN_LINK 或 SUB_REVIEW`,
        });
        continue;
      }

      // 按变体组名称分组
      if (!groupMap.has(groupName)) {
        groupMap.set(groupName, {
          name: groupName,
          country,
          site,
          brand,
          asins: [],
        });
      }

      const group = groupMap.get(groupName);
      // 检查ASIN是否已存在
      if (!group.asins.find((a) => a.asin === asin)) {
        // ASIN名称不需要，保留空值（使用null）
        // 如果用户提供了ASIN名称，使用它；否则使用null（不使用ASIN编码）
        const finalAsinName = asinName || null;

        // 确保ASIN类型正确映射
        let finalAsinType = null;
        if (asinType) {
          const upperAsinType = asinType.toUpperCase();
          if (upperAsinType === 'MAIN_LINK' || upperAsinType === 'SUB_REVIEW') {
            finalAsinType = upperAsinType;
          }
        }

        console.log(
          `处理ASIN: ${asin}, 名称: ${finalAsinName}, 类型: ${finalAsinType}, 原始类型值: ${asinType}`,
        );

        group.asins.push({
          asin,
          name: finalAsinName,
          asinType: finalAsinType,
          site,
          brand,
        });
      }
    }

    // 批量创建变体组和ASIN
    let successCount = 0;
    let failedCount = 0;

    for (const [groupName, groupData] of groupMap.entries()) {
      try {
        // 检查变体组是否已存在（按名称和国家）
        const existingGroups = await VariantGroup.findAll({
          keyword: groupName,
          country: groupData.country,
          current: 1,
          pageSize: 1,
        });

        let groupId;
        if (existingGroups.list && existingGroups.list.length > 0) {
          // 使用已存在的变体组
          groupId = existingGroups.list[0].id;
        } else {
          // 创建新变体组
          const newGroup = await VariantGroup.create({
            name: groupData.name,
            country: groupData.country,
            site: groupData.site,
            brand: groupData.brand,
          });
          groupId = newGroup.id;
        }

        // 批量创建ASIN
        for (const asinData of groupData.asins) {
          try {
            // 检查ASIN是否已存在
            const existingASIN = await ASIN.findByASIN(asinData.asin);
            if (!existingASIN) {
              await ASIN.create({
                asin: asinData.asin,
                name: asinData.name,
                country: groupData.country,
                site: asinData.site,
                brand: asinData.brand,
                variantGroupId: groupId,
                asinType: asinData.asinType,
              });
              successCount++;
            } else {
              // ASIN已存在，跳过
              failedCount++;
              errors.push({
                row: 0,
                message: `ASIN ${asinData.asin} 已存在，跳过`,
              });
            }
          } catch (asinError) {
            failedCount++;
            errors.push({
              row: 0,
              message: `创建ASIN ${asinData.asin} 失败: ${asinError.message}`,
            });
          }
        }
      } catch (groupError) {
        failedCount += groupData.asins.length;
        errors.push({
          row: 0,
          message: `创建变体组 ${groupName} 失败: ${groupError.message}`,
        });
      }
    }

    res.json({
      success: true,
      data: {
        total: successCount + failedCount,
        successCount,
        failedCount,
        errors: errors.length > 0 ? errors : undefined,
      },
      errorCode: 0,
    });
  } catch (error) {
    console.error('Excel导入错误:', error);
    console.error('错误堆栈:', error.stack);
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      errorMessage: error.message || 'Excel导入失败',
      errorCode: statusCode,
      data: {
        successCount: 0,
        failedCount: 0,
        errors: [{ message: error.message || '未知错误' }],
      },
    });
  }
};
