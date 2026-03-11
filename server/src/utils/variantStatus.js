function toFlag(value) {
  return Number(value) === 1;
}

function getStatusSource(autoBroken, manualBroken) {
  const auto = toFlag(autoBroken);
  const manual = toFlag(manualBroken);

  if (auto && manual) {
    return 'AUTO+MANUAL';
  }
  if (manual) {
    return 'MANUAL';
  }
  if (auto) {
    return 'AUTO';
  }
  return 'NORMAL';
}

function buildEffectiveStatus({ autoBroken = 0, manualBroken = 0 }) {
  const auto = toFlag(autoBroken);
  const manual = toFlag(manualBroken);
  const isBroken = auto || manual;

  return {
    isBroken: isBroken ? 1 : 0,
    variantStatus: isBroken ? 'BROKEN' : 'NORMAL',
    autoIsBroken: auto ? 1 : 0,
    autoVariantStatus: auto ? 'BROKEN' : 'NORMAL',
    manualBroken: manual ? 1 : 0,
    statusSource: getStatusSource(auto, manual),
  };
}

function buildAsinManualBrokenScope(
  selfManualBroken = 0,
  inheritedManualBroken = 0,
) {
  const self = toFlag(selfManualBroken);
  const inherited = toFlag(inheritedManualBroken);

  if (self && inherited) {
    return 'SELF+GROUP';
  }
  if (self) {
    return 'SELF';
  }
  if (inherited) {
    return 'GROUP';
  }
  return 'NONE';
}

function decorateAsinStatus(record, options = {}) {
  if (!record) {
    return null;
  }

  const selfManualBroken = toFlag(record.manual_broken);
  const inheritedManualBroken = toFlag(options.parentManualBroken);
  const effectiveManualBroken = selfManualBroken || inheritedManualBroken;
  const manualBrokenScope = buildAsinManualBrokenScope(
    selfManualBroken,
    inheritedManualBroken,
  );
  const selfManualBrokenReason = record.manual_broken_reason || null;
  const selfManualBrokenUpdatedAt = record.manual_broken_updated_at || null;
  const selfManualBrokenUpdatedBy = record.manual_broken_updated_by || null;
  const inheritedManualBrokenReason = inheritedManualBroken
    ? options.parentManualBrokenReason || null
    : null;
  const inheritedManualBrokenUpdatedAt = inheritedManualBroken
    ? options.parentManualBrokenUpdatedAt || null
    : null;
  const inheritedManualBrokenUpdatedBy = inheritedManualBroken
    ? options.parentManualBrokenUpdatedBy || null
    : null;

  return {
    ...record,
    ...buildEffectiveStatus({
      autoBroken: record.is_broken,
      manualBroken: effectiveManualBroken ? 1 : 0,
    }),
    manualBroken: effectiveManualBroken ? 1 : 0,
    manualBrokenScope,
    manualBrokenReason: selfManualBroken
      ? selfManualBrokenReason
      : inheritedManualBrokenReason,
    manualBrokenUpdatedAt: selfManualBroken
      ? selfManualBrokenUpdatedAt
      : inheritedManualBrokenUpdatedAt,
    manualBrokenUpdatedBy: selfManualBroken
      ? selfManualBrokenUpdatedBy
      : inheritedManualBrokenUpdatedBy,
    selfManualBroken: selfManualBroken ? 1 : 0,
    selfManualBrokenReason,
    selfManualBrokenUpdatedAt,
    selfManualBrokenUpdatedBy,
    inheritedManualBroken: inheritedManualBroken ? 1 : 0,
    inheritedManualBrokenReason,
    inheritedManualBrokenUpdatedAt,
    inheritedManualBrokenUpdatedBy,
  };
}

function decorateVariantGroupStatus(record, children = []) {
  if (!record) {
    return null;
  }

  const ownManualBroken = toFlag(record.manual_broken);
  const hasAutoBrokenChild = children.some((child) =>
    toFlag(child.autoIsBroken),
  );
  const hasManualBrokenChild = children.some((child) =>
    toFlag(child.selfManualBroken ?? child.manualBroken),
  );
  const effectiveStatus = buildEffectiveStatus({
    autoBroken: toFlag(record.is_broken) || hasAutoBrokenChild ? 1 : 0,
    manualBroken: ownManualBroken || hasManualBrokenChild ? 1 : 0,
  });

  return {
    ...record,
    ...effectiveStatus,
    manualBroken: ownManualBroken ? 1 : 0,
    manualBrokenReason: record.manual_broken_reason || null,
    manualBrokenUpdatedAt: record.manual_broken_updated_at || null,
    manualBrokenUpdatedBy: record.manual_broken_updated_by || null,
    children,
  };
}

function buildAsinEffectiveBrokenExpr(alias = 'a', variantGroupAlias = '') {
  const inheritedGroupManualExpr = variantGroupAlias
    ? `COALESCE(${variantGroupAlias}.manual_broken, 0) = 1`
    : `EXISTS (
      SELECT 1
      FROM variant_groups vg_manual
      WHERE vg_manual.id = ${alias}.variant_group_id
        AND COALESCE(vg_manual.manual_broken, 0) = 1
    )`;

  return `(
    COALESCE(${alias}.is_broken, 0) = 1
    OR COALESCE(${alias}.manual_broken, 0) = 1
    OR ${inheritedGroupManualExpr}
  )`;
}

function buildVariantGroupEffectiveBrokenExpr(
  groupAlias = 'vg',
  childAlias = 'a2',
) {
  const childBrokenExpr = buildAsinEffectiveBrokenExpr(childAlias, groupAlias);
  return `(
    COALESCE(${groupAlias}.is_broken, 0) = 1
    OR COALESCE(${groupAlias}.manual_broken, 0) = 1
    OR EXISTS (
      SELECT 1
      FROM asins ${childAlias}
      WHERE ${childAlias}.variant_group_id = ${groupAlias}.id
        AND ${childBrokenExpr}
    )
  )`;
}

module.exports = {
  buildAsinEffectiveBrokenExpr,
  buildAsinManualBrokenScope,
  buildEffectiveStatus,
  buildVariantGroupEffectiveBrokenExpr,
  decorateAsinStatus,
  decorateVariantGroupStatus,
};
