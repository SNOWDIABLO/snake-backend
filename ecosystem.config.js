module.exports = {
  apps: [
    {
      name: 'snake-backend',
      script: './server.js',
      cwd: '/var/www/snake-backend',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 5000,
      kill_timeout: 5000,
      wait_ready: false,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '/var/log/snake-backend/error.log',
      out_file: '/var/log/snake-backend/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
