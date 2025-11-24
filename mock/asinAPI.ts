// ASIN 管理 Mock 数据

// 模拟变体组和ASIN数据
const variantGroups: API.VariantGroup[] = [
  {
    id: 'group-1',
    name: 'iPhone 15 Pro 变体组',
    country: 'US',
    isBroken: 0,
    variantStatus: 'NORMAL',
    createTime: '2024-01-15 10:00:00',
    updateTime: '2024-01-20 14:30:00',
    children: [
      {
        id: 'asin-1',
        asin: 'B0CHX1W1XY',
        name: 'iPhone 15 Pro 128GB 蓝色钛金属',
        country: 'US',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-1',
        createTime: '2024-01-15 10:00:00',
        updateTime: '2024-01-20 14:30:00',
      },
      {
        id: 'asin-2',
        asin: 'B0CHX1W2XY',
        name: 'iPhone 15 Pro 256GB 蓝色钛金属',
        country: 'US',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-1',
        createTime: '2024-01-15 10:00:00',
        updateTime: '2024-01-20 14:30:00',
      },
      {
        id: 'asin-3',
        asin: 'B0CHX1W3XY',
        name: 'iPhone 15 Pro 512GB 蓝色钛金属',
        country: 'US',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-1',
        createTime: '2024-01-15 10:00:00',
        updateTime: '2024-01-20 14:30:00',
      },
    ],
  },
  {
    id: 'group-2',
    name: 'MacBook Pro 14寸 变体组',
    country: 'UK',
    isBroken: 1,
    variantStatus: 'BROKEN',
    createTime: '2024-01-10 09:00:00',
    updateTime: '2024-01-21 16:20:00',
    children: [
      {
        id: 'asin-4',
        asin: 'B09JQL8KP9',
        name: 'MacBook Pro 14寸 M3 芯片 512GB',
        country: 'UK',
        isBroken: 1,
        variantStatus: 'BROKEN',
        parentId: 'group-2',
        createTime: '2024-01-10 09:00:00',
        updateTime: '2024-01-21 16:20:00',
      },
    ],
  },
  {
    id: 'group-3',
    name: 'AirPods Pro 变体组',
    country: 'DE',
    isBroken: 0,
    variantStatus: 'NORMAL',
    createTime: '2024-01-12 11:00:00',
    updateTime: '2024-01-19 10:15:00',
    children: [
      {
        id: 'asin-5',
        asin: 'B0BDHB9Y6K',
        name: 'AirPods Pro (第2代) USB-C',
        country: 'DE',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-3',
        createTime: '2024-01-12 11:00:00',
        updateTime: '2024-01-19 10:15:00',
      },
      {
        id: 'asin-6',
        asin: 'B0BDHB9Y7K',
        name: 'AirPods Pro (第2代) Lightning',
        country: 'DE',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-3',
        createTime: '2024-01-12 11:00:00',
        updateTime: '2024-01-19 10:15:00',
      },
    ],
  },
  {
    id: 'group-4',
    name: 'iPad Air 变体组',
    country: 'FR',
    isBroken: 0,
    variantStatus: 'NORMAL',
    createTime: '2024-01-08 08:00:00',
    updateTime: '2024-01-18 13:45:00',
    children: [
      {
        id: 'asin-7',
        asin: 'B09V3HN1KC',
        name: 'iPad Air 64GB WiFi',
        country: 'FR',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-4',
        createTime: '2024-01-08 08:00:00',
        updateTime: '2024-01-18 13:45:00',
      },
      {
        id: 'asin-8',
        asin: 'B09V3HN2KC',
        name: 'iPad Air 256GB WiFi',
        country: 'FR',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-4',
        createTime: '2024-01-08 08:00:00',
        updateTime: '2024-01-18 13:45:00',
      },
      {
        id: 'asin-9',
        asin: 'B09V3HN3KC',
        name: 'iPad Air 64GB 蜂窝网络',
        country: 'FR',
        isBroken: 0,
        variantStatus: 'NORMAL',
        parentId: 'group-4',
        createTime: '2024-01-08 08:00:00',
        updateTime: '2024-01-18 13:45:00',
      },
    ],
  },
];

export default {
  'GET /api/v1/variant-groups': (req: any, res: any) => {
    const {
      keyword,
      country,
      variantStatus,
      current = 1,
      pageSize = 10,
    } = req.query;

    let filteredData = [...variantGroups];

    // 关键词搜索
    if (keyword) {
      filteredData = filteredData.filter((group) => {
        const matchGroup = group.name
          ?.toLowerCase()
          .includes(keyword.toLowerCase());
        const matchChildren = group.children?.some(
          (asin) =>
            asin.name?.toLowerCase().includes(keyword.toLowerCase()) ||
            asin.asin?.toLowerCase().includes(keyword.toLowerCase()),
        );
        return matchGroup || matchChildren;
      });
    }

    // 国家筛选
    if (country) {
      filteredData = filteredData.filter((group) => group.country === country);
    }

    // 变体状态筛选
    if (variantStatus) {
      const isBroken = variantStatus === 'BROKEN' ? 1 : 0;
      filteredData = filteredData.filter(
        (group) => group.isBroken === isBroken,
      );
    }

    // 分页处理
    const start = (current - 1) * pageSize;
    const end = start + pageSize;
    const paginatedData = filteredData.slice(start, end);

    res.json({
      success: true,
      data: {
        list: paginatedData,
        total: filteredData.length,
        current: Number(current),
        pageSize: Number(pageSize),
      },
      errorCode: 0,
    });
  },

  'GET /api/v1/variant-groups/:groupId': (req: any, res: any) => {
    const { groupId } = req.params;
    const group = variantGroups.find((g) => g.id === groupId);
    if (group) {
      res.json({
        success: true,
        data: group,
        errorCode: 0,
      });
    } else {
      res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
  },

  'POST /api/v1/variant-groups': (req: any, res: any) => {
    const newGroup: API.VariantGroup = {
      id: `group-${Date.now()}`,
      ...req.body,
      isBroken: 0,
      variantStatus: 'NORMAL',
      children: [],
      createTime: new Date().toLocaleString('zh-CN'),
      updateTime: new Date().toLocaleString('zh-CN'),
    };
    variantGroups.push(newGroup);
    res.json({
      success: true,
      data: newGroup,
      errorCode: 0,
    });
  },

  'PUT /api/v1/variant-groups/:groupId': (req: any, res: any) => {
    const { groupId } = req.params;
    const index = variantGroups.findIndex((g) => g.id === groupId);
    if (index !== -1) {
      variantGroups[index] = {
        ...variantGroups[index],
        ...req.body,
        updateTime: new Date().toLocaleString('zh-CN'),
      };
      res.json({
        success: true,
        data: variantGroups[index],
        errorCode: 0,
      });
    } else {
      res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
  },

  'DELETE /api/v1/variant-groups/:groupId': (req: any, res: any) => {
    const { groupId } = req.params;
    const index = variantGroups.findIndex((g) => g.id === groupId);
    if (index !== -1) {
      variantGroups.splice(index, 1);
      res.json({
        success: true,
        data: '删除成功',
        errorCode: 0,
      });
    } else {
      res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
  },

  'POST /api/v1/asins': (req: any, res: any) => {
    const { parentId, ...asinData } = req.body;
    const group = variantGroups.find((g) => g.id === parentId);
    if (group) {
      const newASIN: API.ASINInfo = {
        id: `asin-${Date.now()}`,
        ...asinData,
        parentId,
        isBroken: 0,
        variantStatus: 'NORMAL',
        createTime: new Date().toLocaleString('zh-CN'),
        updateTime: new Date().toLocaleString('zh-CN'),
      };
      if (!group.children) {
        group.children = [];
      }
      group.children.push(newASIN);
      res.json({
        success: true,
        data: newASIN,
        errorCode: 0,
      });
    } else {
      res.status(404).json({
        success: false,
        errorMessage: '变体组不存在',
        errorCode: 404,
      });
    }
  },

  'PUT /api/v1/asins/:asinId': (req: any, res: any) => {
    const { asinId } = req.params;
    let found = false;
    for (const group of variantGroups) {
      if (group.children) {
        const index = group.children.findIndex((a) => a.id === asinId);
        if (index !== -1) {
          group.children[index] = {
            ...group.children[index],
            ...req.body,
            updateTime: new Date().toLocaleString('zh-CN'),
          };
          found = true;
          res.json({
            success: true,
            data: group.children[index],
            errorCode: 0,
          });
          break;
        }
      }
    }
    if (!found) {
      res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
  },

  'DELETE /api/v1/asins/:asinId': (req: any, res: any) => {
    const { asinId } = req.params;
    let found = false;
    for (const group of variantGroups) {
      if (group.children) {
        const index = group.children.findIndex((a) => a.id === asinId);
        if (index !== -1) {
          group.children.splice(index, 1);
          found = true;
          res.json({
            success: true,
            data: '删除成功',
            errorCode: 0,
          });
          break;
        }
      }
    }
    if (!found) {
      res.status(404).json({
        success: false,
        errorMessage: 'ASIN不存在',
        errorCode: 404,
      });
    }
  },
};
