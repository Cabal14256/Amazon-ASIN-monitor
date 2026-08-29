const ASIN_INSERT_COLUMNS = Object.freeze({
  asin: Object.freeze([
    'id',
    'asin',
    'name',
    'asin_type',
    'country',
    'site',
    'brand',
    'variant_group_id',
    'is_broken',
    'variant_status',
  ]),
  competitor: Object.freeze([
    'id',
    'asin',
    'name',
    'asin_type',
    'country',
    'brand',
    'variant_group_id',
    'is_broken',
    'variant_status',
    'feishu_notify_enabled',
  ]),
});

const VARIANT_GROUP_INSERT_COLUMNS = Object.freeze({
  asin: Object.freeze([
    'id',
    'name',
    'country',
    'site',
    'brand',
    'is_broken',
    'variant_status',
  ]),
  competitor: Object.freeze([
    'id',
    'name',
    'country',
    'brand',
    'is_broken',
    'variant_status',
    'feishu_notify_enabled',
  ]),
});

module.exports = {
  ASIN_INSERT_COLUMNS,
  VARIANT_GROUP_INSERT_COLUMNS,
};
