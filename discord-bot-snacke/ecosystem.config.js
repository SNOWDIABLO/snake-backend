// PM2 process manager config — auto-restart, logs, boot on reboot
module.exports = {
  apps: [{
    name:           'snakecoin-bot',
    script:         'bot.js',
    cwd:            __dirname,
    instances:      1,
    exec_mode:      'fork',
    autorestart:    true,
    watch:          false,
    max_memory_restart: '300M',
    env: {
      NODE_ENV: 'production',
    },
    error_file:     './logs/err.log',
    out_file:       './logs/out.log',
    merge_logs:     true,
    time:           true,
  }],
};
