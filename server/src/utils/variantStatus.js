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

function decorateAsinStatus(record) {
  if (!record) {
    return null;
  }

  return {
    ...record,
    ...buildEffectiveStatus({
      autoBroken: record.is_broken,
      manualBroken: record.manual_broken,
    }),
    manualBrokenReason: record.manual_broken_reason || null,
    manualBrokenUpdatedAt: record.manual_broken_updated_at || null,
    manualBrokenUpdatedBy: record.manual_broken_updated_by || null,
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
    toFlag(child.manualBroken),
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

function buildAsinEffectiveBrokenExpr(alias = 'a') {
  return `(COALESCE(${alias}.is_broken, 0) = 1 OR COALESCE(${alias}.manual_broken, 0) = 1)`;
}

function buildVariantGroupEffectiveBrokenExpr(
  groupAlias = 'vg',
  childAlias = 'a2',
) {
  const childBrokenExpr = buildAsinEffectiveBrokenExpr(childAlias);
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
  buildEffectiveStatus,
  buildVariantGroupEffectiveBrokenExpr,
  decorateAsinStatus,
  decorateVariantGroupStatus,
};
