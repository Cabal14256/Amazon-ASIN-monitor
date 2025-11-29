// PM2配置文件
// 用于1Panel进程守护功能
module.exports = {
  apps: [
    {
      name: 'amazon-asin-monitor-api',
      script: './server/src/index.js',
      cwd: '/opt/amazon-asin-monitor',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // 从.env文件加载环境变量
      env_file: './server/.env',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
    },
  ],
};
