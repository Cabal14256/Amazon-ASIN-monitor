/**
 * SP-API统一调度器
 * 实现优先级队列和按operation的队列管理，集中控制所有SP-API调用
 * 参考文档: docs/1. 先搞清楚：你到底有多少配额？.md
 */

const logger = require('../utils/logger');
const rateLimiter = require('./rateLimiter');
const { PRIORITY } = rateLimiter;
const operationIdentifier = require('./spApiOperationIdentifier');

/**
 * 每个operation的队列和限流配置
 */
class OperationQueue {
  constructor(operation, region, config = {}) {
    this.operation = operation;
    this.region = region;
    this.queue = []; // 任务队列
    this.running = 0; // 当前正在执行的请求数
    this.rate = config.rate || 1; // 每秒最多多少请求
    this.burst = config.burst || 2; // 瞬时最多多少请求
    this.processing = false; // 是否正在处理队列
  }

  /**
   * 添加任务到队列
   * @param {Object} task - 任务对象 {task, resolve, reject, priority}
   */
  enqueue(task) {
    this.queue.push(task);
    // 按优先级排序（优先级小的在前）
    this.queue.sort(
      (a, b) =>
        (a.priority || PRIORITY.SCHEDULED) - (b.priority || PRIORITY.SCHEDULED),
    );

    // 如果队列在处理中，不需要再次启动
    if (!this.processing) {
      this.processQueue();
    }
  }

  /**
   * 处理队列
   */
  async processQueue() {
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      while (this.queue.length > 0 && this.running < this.burst) {
        const task = this.queue.shift();
        if (!task) break;

        // 检查速率限制：确保不会超过rate
        const now = Date.now();
        const timeSinceLastRequest = now - (this.lastRequestTime || 0);
        const minInterval = 1000 / this.rate; // 最小请求间隔（毫秒）

        if (timeSinceLastRequest < minInterval && this.lastRequestTime) {
          // 需要等待
          const waitTime = minInterval - timeSinceLastRequest;
          await new Promise((resolve) => {
            setTimeout(resolve, waitTime);
          });
        }

        this.running++;
        this.lastRequestTime = Date.now();

        // 执行任务
        task
          .task()
          .then((result) => {
            this.running--;
            task.resolve(result);
            // 继续处理队列
            this.processQueue();
          })
          .catch((error) => {
            this.running--;
            task.reject(error);
            // 继续处理队列
            this.processQueue();
          });
      }
    } finally {
      this.processing = false;
    }

    // 如果队列不为空且未达到burst限制，继续处理
    if (this.queue.length > 0 && this.running < this.burst) {
      // 使用setTimeout来避免阻塞
      setTimeout(() => this.processQueue(), 100);
    }
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      operation: this.operation,
      region: this.region,
      queueLength: this.queue.length,
      running: this.running,
      rate: this.rate,
      burst: this.burst,
    };
  }
}

/**
 * 统一调度器
 */
class SPAPIScheduler {
  constructor() {
    // 存储每个operation的队列：{ region: { operation: OperationQueue } }
    this.queues = {
      US: {},
      EU: {},
    };

    // 启动定时器，定期处理队列（每100ms检查一次）
    this.interval = setInterval(() => {
      this.processAllQueues();
    }, 100);
  }

  /**
   * 处理所有队列
   */
  processAllQueues() {
    for (const region of ['US', 'EU']) {
      const regionQueues = this.queues[region];
      for (const operationQueue of Object.values(regionQueues)) {
        if (operationQueue.queue.length > 0) {
          operationQueue.processQueue();
        }
      }
    }
  }

  /**
   * 获取或创建operation队列
   * @param {string} operation - Operation名称
   * @param {string} region - 区域代码
   * @returns {OperationQueue}
   */
  getOrCreateQueue(operation, region) {
    const normalizedRegion = region === 'US' ? 'US' : 'EU';

    if (!this.queues[normalizedRegion][operation]) {
      // 获取operation的默认配置
      const opConfig =
        rateLimiter.DEFAULT_OPERATION_CONFIGS[operation] ||
        rateLimiter.DEFAULT_OPERATION_CONFIGS.default;

      this.queues[normalizedRegion][operation] = new OperationQueue(
        operation,
        normalizedRegion,
        {
          rate: opConfig.rate,
          burst: opConfig.burst,
        },
      );

      logger.info(
        `[SPAPIScheduler] 创建operation队列: ${normalizedRegion}/${operation} (rate: ${opConfig.rate}/s, burst: ${opConfig.burst})`,
      );
    }

    return this.queues[normalizedRegion][operation];
  }

  /**
   * 调度SP-API调用
   * @param {Function} task - 要执行的任务（返回Promise的函数）
   * @param {Object} options - 选项
   * @param {string} options.operation - Operation名称（可选，会自动识别）
   * @param {string} options.region - 区域代码（US/EU）
   * @param {string} options.method - HTTP方法（用于自动识别operation）
   * @param {string} options.path - API路径（用于自动识别operation）
   * @param {number} options.priority - 优先级（PRIORITY.MANUAL=1, PRIORITY.SCHEDULED=2, PRIORITY.BATCH=3）
   * @returns {Promise} 任务执行结果的Promise
   */
  async schedule(task, options = {}) {
    const {
      operation: explicitOperation = null,
      region,
      method = null,
      path = null,
      priority = PRIORITY.SCHEDULED,
    } = options;

    // 识别operation
    let operation = explicitOperation;
    if (!operation && method && path) {
      operation = operationIdentifier.identifyOperation(method, path);
    }

    if (!operation) {
      logger.warn('[SPAPIScheduler] 无法识别operation，使用默认限流器');
      // 如果无法识别operation，直接执行（使用区域级别的限流）
      if (region) {
        await rateLimiter.acquire(region, 1, priority);
      }
      return await task();
    }

    if (!region) {
      throw new Error('region参数是必需的');
    }

    // 获取或创建operation队列
    const queue = this.getOrCreateQueue(operation, region);

    // 将任务加入队列
    return new Promise((resolve, reject) => {
      queue.enqueue({
        task,
        resolve,
        reject,
        priority,
      });
    });
  }

  /**
   * 更新operation的配置（从响应头自动发现）
   * @param {string} operation - Operation名称
   * @param {string} region - 区域代码
   * @param {number} rateLimit - 从响应头发现的rate limit（requests/second）
   */
  updateOperationConfig(operation, region, rateLimit) {
    const normalizedRegion = region === 'US' ? 'US' : 'EU';
    const queue = this.queues[normalizedRegion][operation];

    if (queue && rateLimit > 0) {
      queue.rate = rateLimit;
      logger.info(
        `[SPAPIScheduler] 更新operation配置: ${normalizedRegion}/${operation} (rate: ${rateLimit}/s)`,
      );
    }
  }

  /**
   * 获取所有队列状态
   * @param {string} region - 区域代码（可选）
   * @returns {Object} 队列状态信息
   */
  getStatus(region = null) {
    const regions = region ? [region] : ['US', 'EU'];
    const status = {};

    for (const reg of regions) {
      const normalizedRegion = reg === 'US' ? 'US' : 'EU';
      status[normalizedRegion] = {};

      const regionQueues = this.queues[normalizedRegion];
      for (const [operation, queue] of Object.entries(regionQueues)) {
        status[normalizedRegion][operation] = queue.getStatus();
      }
    }

    return status;
  }

  /**
   * 清空所有队列（用于测试或紧急情况）
   */
  clearAllQueues() {
    for (const region of ['US', 'EU']) {
      this.queues[region] = {};
    }
    logger.warn('[SPAPIScheduler] 所有队列已清空');
  }

  /**
   * 停止调度器
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

// 创建全局调度器实例
const globalScheduler = new SPAPIScheduler();

module.exports = {
  schedule: (task, options) => globalScheduler.schedule(task, options),
  getStatus: (region) => globalScheduler.getStatus(region),
  updateOperationConfig: (operation, region, rateLimit) =>
    globalScheduler.updateOperationConfig(operation, region, rateLimit),
  clearAllQueues: () => globalScheduler.clearAllQueues(),
  stop: () => globalScheduler.stop(),
  SPAPIScheduler,
  OperationQueue,
};
