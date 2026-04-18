# SnakeCoin Discord Bot — Deploy on VPS

## 1. SSH into VPS

```bash
ssh root@65.75.209.135
```

## 2. Install Node 20 + PM2 (Debian/Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs build-essential python3
npm i -g pm2
```

## 3. Upload the bot

From your local machine (PowerShell):

```powershell
cd "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend"
scp -r discord-bot root@65.75.209.135:/opt/snakecoin-bot
```

Or clone via git if you commit it.

## 4. Configure `.env`

```bash
cd /opt/snakecoin-bot
cp .env.example .env
nano .env
```

Fill all values:
- `DISCORD_TOKEN` — from https://discord.com/developers/applications/<your-app>/bot → Reset Token
- `DISCORD_CLIENT_ID` — "Application ID" on the General Information page
- `DISCORD_GUILD_ID` — Right-click your Discord server → Copy Server ID (need Developer Mode on in User Settings)
- `DISCORD_CHANNEL_ID` — Right-click target channel → Copy Channel ID
- `DISCORD_HOLDER_ROLE_ID` — Right-click the "Snake Hodler" role → Copy Role ID (create it first)

## 5. Install deps + register slash commands

```bash
npm install
node register-commands.js
```

You should see: `✅ Registered 5 commands to guild <id>`

## 6. Start with PM2

```bash
mkdir -p logs
pm2 start ecosystem.config.js
pm2 logs snakecoin-bot --lines 50
pm2 save
pm2 startup  # then copy-paste the systemd command it prints
```

## 7. Verify

In your Discord:
- Type `/` in any channel — you should see the bot's commands
- Run `/stats`, `/topscore`, `/play`
- Link a wallet: `/link address:0x...`

## 8. Give the bot the right permissions

When adding the bot to your server via OAuth2 URL generator, use scopes:
- `bot`
- `applications.commands`

Bot Permissions needed:
- `Send Messages`
- `Embed Links`
- `Manage Roles` (required for Snake Hodler role auto-assign — and the bot's role MUST be ABOVE the Snake Hodler role in the server's role hierarchy)
- `Read Message History`

Example invite URL (replace `CLIENT_ID`):
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=268519424&scope=bot%20applications.commands
```

## 9. Monitoring

```bash
pm2 status                    # process state
pm2 logs snakecoin-bot        # tail logs
pm2 restart snakecoin-bot     # restart
pm2 monit                     # live dashboard
```

## Troubleshooting

**Bot online but slash commands missing** → you forgot `node register-commands.js`. Re-run it.

**Role sync fails with "Missing Permissions"** → the bot's role must be ABOVE the Snake Hodler role. Server Settings → Roles → drag bot role up.

**No Transfer events posted** → check `POLYGON_RPC` isn't rate-limited. Free RPCs sometimes drop long-lived WebSocket subscriptions. Switch to `https://polygon.llamarpc.com` or get a free Alchemy/Infura key.

**Port collision** → bot doesn't open any port. If you want a backend→bot webhook, add express and open one.
