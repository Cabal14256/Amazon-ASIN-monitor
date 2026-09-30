const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const UTC8_MS = 8 * 60 * MINUTE_MS;

// ISO formatting avoids ICU locales that render midnight as 24:xx on Node 20.
const toBeijingSql = (time) =>
  new Date(time + UTC8_MS).toISOString().slice(0, 19).replace('T', ' ');

// All daily boundaries are Beijing time, independent of the worker's timezone.
function getEmergencyWindow(config, now = new Date()) {
  const end = Math.floor(now.getTime() / 1000) * 1000;
  if (!Number.isFinite(end)) throw new Error('Invalid evaluation time');
  let start = end - config.windowMinutes * MINUTE_MS;
  if (config.timeMode !== 'rolling') {
    const toMinutes = (value) => {
      const [hours, minutes] = value.split(':').map(Number);
      return hours * 60 + minutes;
    };
    const startMinute = toMinutes(config.startTime);
    const endMinute = toMinutes(config.endTime);
    const dayStart = Math.floor((end + UTC8_MS) / DAY_MS) * DAY_MS - UTC8_MS;
    const minute = (end - dayStart) / MINUTE_MS;
    let dailyStart = dayStart + startMinute * MINUTE_MS;
    if (startMinute < endMinute) {
      if (minute < startMinute || minute >= endMinute) return null;
    } else {
      if (minute >= endMinute && minute < startMinute) return null;
      if (minute < endMinute) dailyStart -= DAY_MS;
    }
    start =
      config.timeMode === 'combined' ? Math.max(start, dailyStart) : dailyStart;
  }
  return {
    startTime: toBeijingSql(start),
    endTime: toBeijingSql(end),
  };
}

module.exports = { getEmergencyWindow };
