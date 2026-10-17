function groupCountriesByRegion(countries, regionMap) {
  return (countries || []).reduce((groups, country) => {
    const region = regionMap[country] || 'US';
    groups[region] = groups[region] || [];
    groups[region].push(country);
    return groups;
  }, {});
}

function getMonitorRunScope(countries, regionMap) {
  const regions = Object.keys(groupCountriesByRegion(countries, regionMap));
  return regions.length === 1 ? regions[0] : 'GLOBAL';
}

async function enqueueMonitorCountries(
  countries,
  regionMap,
  regionQueues,
  batchConfig = null,
  options = {},
) {
  const groupedCountries = groupCountriesByRegion(countries, regionMap);
  return Promise.all(
    Object.entries(groupedCountries).map(([region, regionCountries]) => {
      const queue = regionQueues[region];
      if (!queue) {
        throw new Error(`缺少 ${region} 区域的监控队列`);
      }
      return queue.enqueue(regionCountries, batchConfig, options);
    }),
  );
}

module.exports = {
  groupCountriesByRegion,
  getMonitorRunScope,
  enqueueMonitorCountries,
};
