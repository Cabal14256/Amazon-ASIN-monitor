const DEFAULT_TTL_MS = Number(process.env.CACHE_DEFAULT_TTL_MS) || 30 * 1000;
const DEFAULT_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 2000;
const DEFAULT_CLEANUP_INTERVAL_MS =
  Number(process.env.CACHE_CLEANUP_INTERVAL_MS) || 60 * 1000;

class CacheService {
  constructor() {
    this.store = new Map();
    this.ttl = DEFAULT_TTL_MS;
    this.maxEntries = DEFAULT_MAX_ENTRIES;
    this.cleanupInterval = DEFAULT_CLEANUP_INTERVAL_MS;
    this._cleanupTimer = null;
    this._startCleanup();
  }

  configure({ ttl, maxEntries, cleanupInterval } = {}) {
    if (typeof ttl === 'number' && ttl > 0) {
      this.ttl = ttl;
    }
    if (typeof maxEntries === 'number' && maxEntries > 0) {
      this.maxEntries = maxEntries;
    }
    if (typeof cleanupInterval === 'number' && cleanupInterval > 0) {
      this.cleanupInterval = cleanupInterval;
      this._restartCleanup();
    }
  }

  _startCleanup() {
    if (this._cleanupTimer) {
      return;
    }
    this._cleanupTimer = setInterval(() => {
      this._evictExpired();
    }, this.cleanupInterval);
    this._cleanupTimer.unref && this._cleanupTimer.unref();
  }

  _restartCleanup() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._startCleanup();
  }

  _evictExpired() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiry) {
        this.store.delete(key);
      }
    }
  }

  _ensureCapacity() {
    if (this.store.size < this.maxEntries) {
      return;
    }
    const oldestKey = this.store.keys().next().value;
    if (oldestKey) {
      this.store.delete(oldestKey);
    }
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    this._ensureCapacity();
    const expiry = Date.now() + ttl;
    this.store.set(key, { value, expiry });
  }

  delete(key) {
    this.store.delete(key);
  }

  deleteByPrefix(prefix) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}

module.exports = new CacheService();
