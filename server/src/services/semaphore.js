class Semaphore {
  constructor(maxConcurrent = 1) {
    this._maxConcurrent = Math.max(Math.floor(maxConcurrent), 1);
    this._current = 0;
    this._queue = [];
  }

  acquire() {
    return new Promise((resolve) => {
      if (this._current < this._maxConcurrent) {
        this._current += 1;
        resolve();
        return;
      }
      this._queue.push(resolve);
    });
  }

  release() {
    if (this._current > 0) {
      this._current -= 1;
    }
    if (this._queue.length > 0 && this._current < this._maxConcurrent) {
      this._current += 1;
      const next = this._queue.shift();
      if (next) {
        next();
      }
    }
  }

  setMax(newMax) {
    const normalized = Math.max(Math.floor(newMax), 1);
    this._maxConcurrent = normalized;
    while (this._queue.length > 0 && this._current < this._maxConcurrent) {
      this._current += 1;
      const next = this._queue.shift();
      if (next) {
        next();
      }
    }
  }
}

module.exports = Semaphore;
