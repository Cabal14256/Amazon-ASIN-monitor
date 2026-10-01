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

function readParentHistory(member = {}) {
  if (member.parentHistory) return { ...member.parentHistory };
  const baselineParentAsin = normalizeParentAsin(member.baselineParentAsin);
  const currentParentAsin = normalizeParentAsin(member.currentParentAsin);
  const changed = Boolean(
    baselineParentAsin &&
      currentParentAsin &&
      baselineParentAsin !== currentParentAsin,
  );
  return {
    status: changed ? 'CHANGED' : baselineParentAsin ? 'UNCHANGED' : 'UNKNOWN',
    baselineParentAsin,
    currentParentAsin,
    // Legacy snapshots know the original and latest parent, but their last
    // polling time is not the change time. Existing audit events stay intact.
    previousParentAsin: null,
    changedAt: null,
    observedAt: member.observedAt || null,
  };
}

function normalizeMember(member) {
  const parentHistory = readParentHistory(member);
  // Legacy parent-change alerts were not evidence of unhealthy relationships.
  // Require a fresh observation before establishing the new health baseline.
  return member.reason === 'PARENT_CHANGED'
    ? { ...member, parentHistory, status: SPLIT_STATUS.UNKNOWN, reason: null }
    : { ...member, parentHistory };
}

function canObserve(result) {
  return (
    isRelationshipSource(result) &&
    !result.errorType &&
    !result.error &&
    !result.isDeferred
  );
}

function observeParentHistory(result, member, observedAt) {
  const previous = readParentHistory(member);
  if (
    !canObserve(result) ||
    result.details?.hasVariantRelationships !== true ||
    (previous.observedAt && observedAt <= previous.observedAt)
  )
    return previous;
  const currentParentAsin = normalizeParentAsin(result.details?.parentAsin);
  if (!currentParentAsin) return previous;
  const previousParentAsin =
    previous.currentParentAsin || previous.baselineParentAsin;
  const changed = Boolean(
    previousParentAsin && currentParentAsin !== previousParentAsin,
  );
  return {
    status: changed || previous.status === 'CHANGED' ? 'CHANGED' : 'UNCHANGED',
    baselineParentAsin: previous.baselineParentAsin || currentParentAsin,
    currentParentAsin,
    previousParentAsin: changed
      ? previousParentAsin
      : previous.previousParentAsin,
    changedAt: changed ? observedAt : previous.changedAt,
    observedAt,
  };
}

// Null means that the observation is not sufficient to change the split state.
// A title lookup failure cannot establish or restore a normal state.
function classifySplitObservation(result, previous = {}) {
  if (!canObserve(result)) {
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

  // A child still needs a valid current parent, but it may be a different one.
  // A parent ASIN may legitimately have children and no parent.
  if (baselineParentAsin && !currentParentAsin) return null;
  if (result.details?.parentAsin && !currentParentAsin) return null;
  if (titleStatus === PARENT_TITLE_STATUS.UNKNOWN) return null;
  const titleEmpty = titleStatus === PARENT_TITLE_STATUS.EMPTY;
  return {
    status: titleEmpty ? SPLIT_STATUS.BROKEN : SPLIT_STATUS.NORMAL,
    reason: titleEmpty ? 'PARENT_TITLE_EMPTY' : null,
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
      return [
        member.id,
        normalizeMember(sameIdentity ? old : unknownMember(member)),
      ];
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
    const parentHistory = observeParentHistory(
      observation.result,
      member,
      observation.observedAt,
    );
    members[asinId] = { ...member, parentHistory };
    const classification = classifySplitObservation(observation.result, {
      ...member,
      baselineParentAsin: parentHistory.baselineParentAsin,
    });
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
          parentHistory,
          pending: true,
          pendingObservedAt: observation.observedAt,
        };
      }
      continue;
    }
    members[asinId] = {
      ...member,
      ...classification,
      parentHistory,
      observedAt: observation.observedAt,
      pending: false,
      pendingObservedAt: null,
    };
  }

  const values = Object.values(members);
  const legacyHealth = Object.values(oldMembers).some(
    (member) => member.reason === 'PARENT_CHANGED',
  );
  const previousHealthStatus = legacyHealth
    ? SPLIT_STATUS.UNKNOWN
    : previous?.status;
  const status = values.some((member) => member.status === SPLIT_STATUS.BROKEN)
    ? SPLIT_STATUS.BROKEN
    : values.some((member) => member.pending)
    ? membershipChanged
      ? SPLIT_STATUS.UNKNOWN
      : previousHealthStatus || SPLIT_STATUS.UNKNOWN
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
    previousHealthStatus === SPLIT_STATUS.NORMAL &&
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
      reason: changes.some((change) => change.reason === 'PARENT_TITLE_EMPTY')
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
  const parentChanges = currentMembers.filter(({ id }) => {
    const old = oldMembers[id];
    const member = members[id];
    const history = members[id].parentHistory;
    return (
      old &&
      old.asin === member.asin &&
      old.country === member.country &&
      history.changedAt &&
      history.changedAt !== readParentHistory(oldMembers[id]).changedAt
    );
  });
  const newParentEvent =
    previous?.country === group.country && parentChanges.length > 0
      ? {
          variantGroupId: group.id,
          country: group.country,
          occurredAt: parentChanges
            .map(({ id }) => members[id].parentHistory.changedAt)
            .sort()[0],
          reason: 'PARENT_CHANGED',
          details: {
            triggerAsinIds: parentChanges.map(({ id }) => id),
            changes: parentChanges.map(({ id }) => ({
              asinId: id,
              reason: 'PARENT_CHANGED',
              ...members[id].parentHistory,
            })),
          },
          notifyEnabled: false,
        }
      : null;
  return {
    country: group.country,
    status,
    members,
    newEvent,
    newParentEvent,
    asins: currentMembers.map(({ id }) => ({
      asinId: id,
      status: members[id].status,
      reason: members[id].reason,
      baselineParentAsin: members[id].baselineParentAsin,
      currentParentAsin: members[id].currentParentAsin,
      parentTitleStatus: members[id].parentTitleStatus,
      parentHistory: members[id].parentHistory,
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
  normalizeMember,
};
