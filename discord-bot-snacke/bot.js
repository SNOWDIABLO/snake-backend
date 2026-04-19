// SnakeCoin Discord Bot
// Features: /stats, /topscore, /wallet, /link, /play, on-chain transfer watcher, holder role auto-assign
require('dotenv').config();

const {
  Client, GatewayIntentBits, EmbedBuilder, Events, ActivityType,
} = require('discord.js');
const { ethers } = require('ethers');
const Database   = require('better-sqlite3');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CFG = {
  TOKEN:              process.env.DISCORD_TOKEN,
  CLIENT_ID:          process.env.DISCORD_CLIENT_ID,
  GUILD_ID:           process.env.DISCORD_GUILD_ID,
  CHANNEL_ID:         process.env.DISCORD_CHANNEL_ID,
  HOLDER_ROLE_ID:     process.env.DISCORD_HOLDER_ROLE_ID || null,
  BACKEND_URL:        process.env.BACKEND_URL || 'https://snake-backend-production-e5e8.up.railway.app',
  POLYGON_RPC:        process.env.POLYGON_RPC || 'https://polygon-rpc.com',
  CONTRACT_ADDRESS:   process.env.CONTRACT_ADDRESS,
  HOLDER_THRESHOLD:   parseFloat(process.env.HOLDER_THRESHOLD || '1000'),
  MIN_TRANSFER_POST:  parseFloat(process.env.MIN_TRANSFER_POST || '10'),
  ROLE_REFRESH_MS:    parseInt(process.env.ROLE_REFRESH_MS || '600000', 10),
  PLAY_URL:           'https://snowdiablo.xyz',
};

['TOKEN','CLIENT_ID','GUILD_ID','CHANNEL_ID','CONTRACT_ADDRESS'].forEach(k => {
  if (!CFG[k]) { console.error(`❌ Missing env: DISCORD_${k} or ${k}`); process.exit(1); }
});

// ─── LOCAL DB (wallet↔discord links) ────────────────────────────────────────
const db = new Database('bot.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS wallet_links (
    discord_id TEXT PRIMARY KEY,
    address    TEXT NOT NULL,
    linked_at  INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_wl_addr ON wallet_links(address);
`);

// ─── ETHERS ─────────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(CFG.POLYGON_RPC);
const ERC20_ABI = [
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol()   view returns (string)',
];
const token = new ethers.Contract(CFG.CONTRACT_ADDRESS, ERC20_ABI, provider);

// ─── DISCORD CLIENT ─────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

// ─── HELPERS ────────────────────────────────────────────────────────────────
const shortAddr = a => a.slice(0,6) + '…' + a.slice(-4);
const explorer  = a => `https://polygonscan.com/address/${a}`;
const txUrl     = h => `https://polygonscan.com/tx/${h}`;

async function apiGet(path) {
  const r = await fetch(CFG.BACKEND_URL + path);
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

// ─── SLASH COMMAND HANDLERS ─────────────────────────────────────────────────
async function cmdStats(interaction) {
  await interaction.deferReply();
  try {
    const s = await apiGet('/api/stats');
    const emb = new EmbedBuilder()
      .setTitle('📊 SnakeCoin Stats')
      .setColor(0x00ff88)
      .addFields(
        { name: 'Total Players',      value: `${s.totalPlayers}`,          inline: true },
        { name: 'Games Played',       value: `${s.totalGames}`,            inline: true },
        { name: 'Highest Score',      value: `${s.highestScore}`,          inline: true },
        { name: '$SNAKE Distributed', value: `${s.totalSnakeDistributed.toLocaleString()}`, inline: true },
        { name: 'Claims Total',       value: `${s.totalClaims}`,           inline: true },
        { name: 'Claims 24h',         value: `${s.todayClaims}`,           inline: true },
      )
      .setFooter({ text: 'SnakeCoin · Polygon' })
      .setTimestamp();
    await interaction.editReply({ embeds: [emb] });
  } catch (e) {
    await interaction.editReply('❌ Failed to fetch stats: ' + e.message);
  }
}

async function cmdTopscore(interaction) {
  const period = interaction.options.getString('period') || 'all';
  await interaction.deferReply();
  try {
    const d = await apiGet(`/api/leaderboard?period=${period}&limit=10`);
    if (!d.leaderboard || d.leaderboard.length === 0) {
      return interaction.editReply(`🏆 No scores yet for period **${period}**.`);
    }
    const medals = ['🥇','🥈','🥉'];
    const lines = d.leaderboard.map((row, i) => {
      const rank = medals[i] || `\`#${(i+1).toString().padStart(2)}\``;
      return `${rank} \`${shortAddr(row.address)}\` — **${row.best_score}** pts`;
    }).join('\n');
    const emb = new EmbedBuilder()
      .setTitle(`🏆 Leaderboard (${period})`)
      .setColor(0xffcc00)
      .setDescription(lines)
      .setFooter({ text: `Play at ${CFG.PLAY_URL}` })
      .setTimestamp();
    await interaction.editReply({ embeds: [emb] });
  } catch (e) {
    await interaction.editReply('❌ Failed to fetch leaderboard: ' + e.message);
  }
}

async function cmdWallet(interaction) {
  const address = interaction.options.getString('address');
  if (!ethers.isAddress(address)) {
    return interaction.reply({ content: '❌ Invalid wallet address', ephemeral: true });
  }
  await interaction.deferReply();
  try {
    const p = await apiGet(`/api/player/${address}`);
    const balWei = await token.balanceOf(address);
    const bal    = parseFloat(ethers.formatEther(balWei));
    const emb = new EmbedBuilder()
      .setTitle(`👛 ${shortAddr(address)}`)
      .setURL(explorer(address))
      .setColor(0x00ccff)
      .addFields(
        { name: 'Best Score',    value: `${p.best_score || 0}`,            inline: true },
        { name: 'Games Played',  value: `${p.games_played || 0}`,          inline: true },
        { name: 'Rank',          value: p.rank ? `#${p.rank}` : '—',       inline: true },
        { name: '$SNAKE Claimed',value: `${(p.total_claimed||0).toFixed(2)}`, inline: true },
        { name: '$SNAKE Balance',value: `${bal.toLocaleString(undefined,{maximumFractionDigits:2})}`, inline: true },
      )
      .setTimestamp();
    await interaction.editReply({ embeds: [emb] });
  } catch (e) {
    await interaction.editReply('❌ Failed to fetch wallet: ' + e.message);
  }
}

// /link — requires EIP-191 signature proof (task #56 hardening)
// User signs off-chain: "SnakeCoin LinkDiscord\nDiscord: <uid>\nAddress: <addr>\nTimestamp: <ts>"
// → bot verifies recovered signer == address + ts within 5min window
// Prevents anyone claiming someone else's wallet on Discord
const LINK_PROOF_MAX_AGE_SEC = 300;
const seenLinkNonces = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [n, exp] of seenLinkNonces) if (exp < now) seenLinkNonces.delete(n);
}, 10 * 60 * 1000).unref?.();

function buildLinkMessage(discordId, address, ts) {
  return `SnakeCoin LinkDiscord\nDiscord: ${discordId}\nAddress: ${address.toLowerCase()}\nTimestamp: ${ts}`;
}

async function cmdLink(interaction) {
  const address   = interaction.options.getString('address');
  const signature = interaction.options.getString('signature');
  const tsRaw     = interaction.options.getString('timestamp');
  const ts        = parseInt(tsRaw || '', 10);

  if (!ethers.isAddress(address)) {
    return interaction.reply({ content: '❌ Invalid wallet address', ephemeral: true });
  }
  if (!signature || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    const example = buildLinkMessage(interaction.user.id, address, Math.floor(Date.now()/1000));
    return interaction.reply({
      content:
        '❌ **Signature required** — prove wallet ownership.\n\n' +
        '**Steps:**\n' +
        '1. Go to https://snowdiablo.xyz and connect your wallet\n' +
        '2. Open browser console (F12) and run:\n' +
        '```js\n' +
        `const ts=Math.floor(Date.now()/1000);\n` +
        `const msg=\`SnakeCoin LinkDiscord\\nDiscord: ${interaction.user.id}\\nAddress: \${walletAddress.toLowerCase()}\\nTimestamp: \${ts}\`;\n` +
        `const sig=await ethereum.request({method:'personal_sign',params:[msg,walletAddress]});\n` +
        `console.log('ts:',ts,'\\nsig:',sig);\n` +
        '```\n' +
        '3. Run `/link address:0x... signature:0x... timestamp:...` with the values shown.',
      ephemeral: true,
    });
  }
  if (!Number.isInteger(ts)) {
    return interaction.reply({ content: '❌ Invalid timestamp (expected Unix seconds).', ephemeral: true });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > LINK_PROOF_MAX_AGE_SEC) {
    return interaction.reply({ content: `❌ Signature expired (must be < ${LINK_PROOF_MAX_AGE_SEC}s old).`, ephemeral: true });
  }

  const addr = address.toLowerCase();
  const message = buildLinkMessage(interaction.user.id, addr, ts);

  // Anti-replay: bind nonce = discordId|ts|addr
  const replayKey = `${interaction.user.id}|${ts}|${addr}`;
  if (seenLinkNonces.has(replayKey)) {
    return interaction.reply({ content: '❌ Signature already used (replay).', ephemeral: true });
  }

  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch (e) {
    return interaction.reply({ content: '❌ Signature format invalid.', ephemeral: true });
  }
  if (recovered.toLowerCase() !== addr) {
    return interaction.reply({ content: '❌ Signature does not match this wallet (ownership not proved).', ephemeral: true });
  }
  seenLinkNonces.set(replayKey, Date.now() + LINK_PROOF_MAX_AGE_SEC * 2000);

  // Prevent same address being linked to multiple discord users
  const existing = db.prepare('SELECT discord_id FROM wallet_links WHERE address=? AND discord_id!=?')
    .get(addr, interaction.user.id);
  if (existing) {
    return interaction.reply({ content: '❌ This wallet is already linked to another Discord user.', ephemeral: true });
  }

  db.prepare(`
    INSERT INTO wallet_links (discord_id, address) VALUES (?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET address=excluded.address, linked_at=strftime('%s','now')
  `).run(interaction.user.id, addr);

  await interaction.reply({
    content: `✅ Linked \`${shortAddr(address)}\` to your Discord (signature verified).\nHolder role will be checked automatically.`,
    ephemeral: true,
  });

  // Immediate role check
  syncHolderRole(interaction.user.id, addr).catch(e => console.log('role sync:', e.message));
}

async function cmdPlay(interaction) {
  await interaction.reply({
    content: `🐍 **Play SnakeCoin** → ${CFG.PLAY_URL}\nEarn $SNAKE tokens by eating apples. Claim on Polygon.`,
  });
}

// ─── HOLDER ROLE SYNC ───────────────────────────────────────────────────────
async function syncHolderRole(discordId, address) {
  if (!CFG.HOLDER_ROLE_ID) return;
  try {
    const guild  = await client.guilds.fetch(CFG.GUILD_ID);
    const member = await guild.members.fetch(discordId).catch(() => null);
    if (!member) return;

    const balWei = await token.balanceOf(address);
    const bal    = parseFloat(ethers.formatEther(balWei));
    const shouldHave = bal >= CFG.HOLDER_THRESHOLD;
    const hasIt      = member.roles.cache.has(CFG.HOLDER_ROLE_ID);

    if (shouldHave && !hasIt) {
      await member.roles.add(CFG.HOLDER_ROLE_ID, 'Snake Hodler threshold reached');
      console.log(`+ role: ${member.user.tag} (${bal} SNAKE)`);
    } else if (!shouldHave && hasIt) {
      await member.roles.remove(CFG.HOLDER_ROLE_ID, 'Below threshold');
      console.log(`- role: ${member.user.tag} (${bal} SNAKE)`);
    }
  } catch (e) { console.log(`syncHolderRole(${discordId}):`, e.message); }
}

async function syncAllRoles() {
  if (!CFG.HOLDER_ROLE_ID) return;
  const rows = db.prepare('SELECT discord_id, address FROM wallet_links').all();
  console.log(`[role-sync] ${rows.length} linked wallets`);
  for (const r of rows) {
    await syncHolderRole(r.discord_id, r.address);
    await new Promise(r => setTimeout(r, 400)); // rate-limit friendly
  }
}

// ─── ON-CHAIN TRANSFER WATCHER ──────────────────────────────────────────────
async function startTransferWatcher() {
  console.log(`🔭 Watching Transfer events on ${CFG.CONTRACT_ADDRESS}`);
  token.on('Transfer', async (from, to, value, event) => {
    try {
      const amount = parseFloat(ethers.formatEther(value));
      if (amount < CFG.MIN_TRANSFER_POST) return;
      if (from === ethers.ZeroAddress) return; // ignore mints from zero (claims handled elsewhere)

      const channel = await client.channels.fetch(CFG.CHANNEL_ID).catch(() => null);
      if (!channel) return;

      const emb = new EmbedBuilder()
        .setTitle('🔄 $SNAKE Transfer')
        .setColor(0x00ccff)
        .addFields(
          { name: 'From',   value: `[${shortAddr(from)}](${explorer(from)})`, inline: true },
          { name: 'To',     value: `[${shortAddr(to)}](${explorer(to)})`,     inline: true },
          { name: 'Amount', value: `${amount.toLocaleString()} $SNAKE`,        inline: true },
          { name: 'Tx',     value: `[View](${txUrl(event.log.transactionHash)})`, inline: false },
        )
        .setTimestamp();
      await channel.send({ embeds: [emb] });

      // Trigger role sync if recipient is linked
      const link = db.prepare('SELECT discord_id FROM wallet_links WHERE address=?').get(to.toLowerCase());
      if (link) syncHolderRole(link.discord_id, to.toLowerCase()).catch(()=>{});
      const linkFrom = db.prepare('SELECT discord_id FROM wallet_links WHERE address=?').get(from.toLowerCase());
      if (linkFrom) syncHolderRole(linkFrom.discord_id, from.toLowerCase()).catch(()=>{});
    } catch (e) { console.log('transfer handler:', e.message); }
  });
}

// ─── CLIENT EVENTS ──────────────────────────────────────────────────────────
client.once(Events.ClientReady, async c => {
  console.log(`🤖 Logged in as ${c.user.tag}`);
  c.user.setActivity('🐍 SnakeCoin on Polygon', { type: ActivityType.Playing });

  // Start transfer watcher
  startTransferWatcher().catch(e => console.error('watcher start:', e));

  // Periodic role sync
  if (CFG.HOLDER_ROLE_ID) {
    syncAllRoles().catch(e => console.log('initial role sync:', e.message));
    setInterval(() => syncAllRoles().catch(()=>{}), CFG.ROLE_REFRESH_MS);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    switch (interaction.commandName) {
      case 'stats':    return cmdStats(interaction);
      case 'topscore': return cmdTopscore(interaction);
      case 'wallet':   return cmdWallet(interaction);
      case 'link':     return cmdLink(interaction);
      case 'play':     return cmdPlay(interaction);
    }
  } catch (e) {
    console.error('cmd error:', e);
    if (interaction.deferred) await interaction.editReply('❌ Error: ' + e.message);
    else await interaction.reply({ content: '❌ Error: ' + e.message, ephemeral: true });
  }
});

// ─── ERROR HANDLING ─────────────────────────────────────────────────────────
process.on('unhandledRejection', e => console.error('unhandled:', e));
process.on('uncaughtException',  e => console.error('uncaught:', e));

// ─── GO ─────────────────────────────────────────────────────────────────────
client.login(CFG.TOKEN);
