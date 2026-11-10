function createMonitorTaskRunStateStore() {
  const states = new Map();

  return {
    get(scope) {
      if (!states.has(scope)) {
        states.set(scope, {
          isRunning: false,
          pendingRunCountries: null,
          pendingRunBatchConfig: null,
          pendingRunCompletion: null,
        });
      }
      return states.get(scope);
    },
  };
}

module.exports = {
  createMonitorTaskRunStateStore,
};
