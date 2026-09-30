const SPLIT_STATUS = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  NORMAL: 'NORMAL',
  BROKEN: 'BROKEN',
});

const PARENT_TITLE_STATUS = Object.freeze({
  PRESENT: 'PRESENT',
  EMPTY: 'EMPTY',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

function parentTitleStatus(result, currentParentAsin) {
  if (!currentParentAsin) return PARENT_TITLE_STATUS.NOT_APPLICABLE;
  const status = result.details?.parentTitleStatus;
  return status === PARENT_TITLE_STATUS.PRESENT ||
    status === PARENT_TITLE_STATUS.EMPTY
    ? status
    : PARENT_TITLE_STATUS.UNKNOWN;
}

function isRelationshipSource(result) {
  return (
    result?.meta?.source === 'spapi' &&
    result.meta.relationshipsObserved === true &&
    result.statusSource !== 'MANUAL'
  );
}

function normalizeParentAsin(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : null;
}

function observationTime(value) {
  if (typeof value === 'string' && !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return null;
  }
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// Null means that the observation is not sufficient to change the split state.
// A title lookup failure cannot establish or restore a normal state.
function classifySplitObservation(result, previous = {}) {
  if (
    !isRelationshipSource(result) ||
    result.errorType ||
    result.error ||
    result.isDeferred
  ) {
    return null;
  }

  const baselineParentAsin = normalizeParentAsin(previous.baselineParentAsin);
  const currentParentAsin = normalizeParentAsin(result.details?.parentAsin);
  const titleStatus = parentTitleStatus(result, currentParentAsin);
  if (result.details?.hasVariantRelationships === false) {
    return {
      status: SPLIT_STATUS.BROKEN,
      reason: 'RELATIONSHIP_LOST',
      baselineParentAsin,
      currentParentAsin,
      parentTitleStatus: titleStatus,
    };
  }
  if (result.details?.hasVariantRelationships !== true) return null;

  // An established child baseline can recover only after seeing its original
  // parent again. A parent ASIN may legitimately have children and no parent.
  if (baselineParentAsin && !currentParentAsin) return null;
  if (result.details?.parentAsin && !currentParentAsin) return null;
  const parentChanged = Boolean(
    baselineParentAsin && currentParentAsin !== baselineParentAsin,
  );
  // Proven relationship changes take precedence over unknown title evidence.
  // Legacy cached results have no title status and must not recover a split.
  if (!parentChanged && titleStatus === PARENT_TITLE_STATUS.UNKNOWN)
    return null;
  const titleEmpty = titleStatus === PARENT_TITLE_STATUS.EMPTY;
  return {
    status:
      parentChanged || titleEmpty ? SPLIT_STATUS.BROKEN : SPLIT_STATUS.NORMAL,
    reason: parentChanged
      ? 'PARENT_CHANGED'
      : titleEmpty
      ? 'PARENT_TITLE_EMPTY'
      : null,
    baselineParentAsin: baselineParentAsin || currentParentAsin,
    currentParentAsin,
    parentTitleStatus: titleStatus,
  };
}

function enabled(value) {
  return value === null || value === undefined || Number(value) !== 0;
}

function unknownMember(member) {
  return {
    asin: member.asin,
    country: member.country,
    baselineParentAsin: null,
    currentParentAsin: null,
    status: SPLIT_STATUS.UNKNOWN,
    reason: null,
    parentTitleStatus: null,
    observedAt: null,
  };
}

/** Reduce one complete group batch against the authoritative current members. */
function reduceGroupSplitState(
  previous,
  group,
  currentMembers,
  observations = [],
) {
  const oldMembers = previous?.members || {};
  let membershipChanged =
    !previous ||
    previous.country !== group.country ||
    Object.keys(oldMembers).length !== currentMembers.length;
  const members = Object.fromEntries(
    currentMembers.map((member) => {
      const old = oldMembers[member.id];
      const sameIdentity = Boolean(
        old && old.asin === member.asin && old.country === member.country,
      );
      if (!sameIdentity) membershipChanged = true;
      return [member.id, sameIdentity ? { ...old } : unknownMember(member)];
    }),
  );

  // Keep only the newest observation per member before evaluating the group.
  // Equal timestamps are idempotent, including repeated cache responses.
  const latest = new Map();
  for (const observation of observations) {
    const asinId = observation?.asinId;
    if (!Object.hasOwn(members, asinId)) continue;
    const observedAt = observationTime(
      observation.observedAt ?? observation.result?.meta?.observedAt,
    );
    if (!observedAt) continue;
    const prior = latest.get(asinId);
    if (!prior || observedAt > prior.observedAt) {
      latest.set(asinId, { ...observation, observedAt });
    }
  }
  for (const [asinId, observation] of latest) {
    const member = members[asinId];
    if (observation.uncertain === true) {
      if (
        (!member.observedAt || observation.observedAt > member.observedAt) &&
        (!member.pendingObservedAt ||
          observation.observedAt > member.pendingObservedAt)
      ) {
        members[asinId] = {
          ...member,
          pending: true,
          pendingObservedAt: observation.observedAt,
        };
      }
      continue;
    }
    if (
      member.pendingObservedAt &&
      observation.observedAt < member.pendingObservedAt
    )
      continue;
    if (member.observedAt && observation.observedAt <= member.observedAt)
      continue;
    const classification = classifySplitObservation(observation.result, member);
    if (!classification) {
      // Preserve the last confirmed member state while blocking group recovery
      // until this newer inconclusive observation has been resolved.
      if (
        isRelationshipSource(observation.result) &&
        (!member.pendingObservedAt ||
          observation.observedAt > member.pendingObservedAt)
      ) {
        members[asinId] = {
          ...member,
          pending: true,
          pendingObservedAt: observation.observedAt,
        };
      }
      continue;
    }
    members[asinId] = {
      ...member,
      ...classification,
      observedAt: observation.observedAt,
      pending: false,
      pendingObservedAt: null,
    };
  }

  const values = Object.values(members);
  const status = values.some((member) => member.status === SPLIT_STATUS.BROKEN)
    ? SPLIT_STATUS.BROKEN
    : values.some((member) => member.pending)
    ? membershipChanged
      ? SPLIT_STATUS.UNKNOWN
      : previous?.status || SPLIT_STATUS.UNKNOWN
    : values.length > 0 &&
      values.every((member) => member.status === SPLIT_STATUS.NORMAL)
    ? SPLIT_STATUS.NORMAL
    : SPLIT_STATUS.UNKNOWN;
  let newEvent = null;
  // Existing deployments have no title baseline. Seed their first empty title
  // as an existing condition; only a confirmed PRESENT -> EMPTY can page.
  const eventMembers = currentMembers.filter(
    ({ id }) =>
      members[id].status === SPLIT_STATUS.BROKEN &&
      (members[id].reason !== 'PARENT_TITLE_EMPTY' ||
        (oldMembers[id]?.status === SPLIT_STATUS.NORMAL &&
          oldMembers[id]?.parentTitleStatus === PARENT_TITLE_STATUS.PRESENT)),
  );
  if (
    !membershipChanged &&
    previous?.status === SPLIT_STATUS.NORMAL &&
    status === SPLIT_STATUS.BROKEN &&
    eventMembers.length > 0
  ) {
    const changes = eventMembers.map(({ id }) => ({
      asinId: id,
      reason: members[id].reason,
      baselineParentAsin: members[id].baselineParentAsin,
      currentParentAsin: members[id].currentParentAsin,
    }));
    newEvent = {
      variantGroupId: group.id,
      country: group.country,
      occurredAt: eventMembers
        .map(({ id }) => members[id].observedAt)
        .sort()[0],
      reason: changes.some((change) => change.reason === 'PARENT_CHANGED')
        ? 'PARENT_CHANGED'
        : changes.some((change) => change.reason === 'PARENT_TITLE_EMPTY')
        ? 'PARENT_TITLE_EMPTY'
        : 'RELATIONSHIP_LOST',
      details: {
        triggerAsinIds: eventMembers.map(({ id }) => id),
        changes,
      },
      notifyEnabled:
        enabled(group.feishu_notify_enabled) &&
        eventMembers.some((member) => enabled(member.feishu_notify_enabled)),
    };
  }
  return {
    country: group.country,
    status,
    members,
    newEvent,
    asins: currentMembers.map(({ id }) => ({
      asinId: id,
      status: members[id].status,
      reason: members[id].reason,
      baselineParentAsin: members[id].baselineParentAsin,
      currentParentAsin: members[id].currentParentAsin,
      parentTitleStatus: members[id].parentTitleStatus,
    })),
  };
}

// Monitoring timestamps use Beijing wall-clock values in MySQL DATETIME.
// Arithmetic avoids ICU producing an invalid 24:xx hour at midnight.
function toBeijingDateTime(value) {
  const normalized = observationTime(value);
  if (!normalized) throw new TypeError('Invalid split observation time');
  return new Date(new Date(normalized).getTime() + 8 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, -1);
}

module.exports = {
  SPLIT_STATUS,
  classifySplitObservation,
  reduceGroupSplitState,
  toBeijingDateTime,
};
