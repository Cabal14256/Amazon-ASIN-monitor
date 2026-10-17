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
  const regions = Object.keys(groupedCountries);
  const queueRegion = regions.length > 1 ? 'GLOBAL' : regions[0];
  const queue = regionQueues[queueRegion];
  if (!queue) {
    throw new Error(`缺少 ${queueRegion || 'default'} 区域的监控队列`);
  }

  const taskCountries =
    regions.length > 1 ? countries : groupedCountries[queueRegion];
  const job = await queue.enqueue(taskCountries, batchConfig, options);
  return [job];
}

module.exports = {
  groupCountriesByRegion,
  getMonitorRunScope,
  enqueueMonitorCountries,
};
