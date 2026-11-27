// PM2 进程配置：pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'waystone-backend',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '200M',
      env: { NODE_ENV: 'production' },
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      time: true
    }
  ]
};
