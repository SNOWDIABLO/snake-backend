const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { ethers } = require('ethers');
const Database   = require('better-sqlite3');
const fs         = require('fs');
const path       = require('path');

const app = express();

// ─── DB PATH (persistent volume aware) ────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || 'snake.db';
const DB_DIR  = path.dirname(DB_PATH);
if (DB_DIR && DB_DIR !== '.' && !fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}
console.log(`📦 SQLite DB path: ${DB_PATH}`);
const db = new Database(DB_PATH);

// ─── DB INIT ──────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    address    TEXT NOT NULL,
    score      INTEGER NOT NULL,
    reward     REAL NOT NULL,
    validated  INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS claims (
    nonce      TEXT PRIMARY KEY,
    address    TEXT NOT NULL,
    amount     TEXT NOT NULL,
    claimed_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS daily_claims (
    address    TEXT NOT NULL,
    day        TEXT NOT NULL,
    total      REAL DEFAULT 0,
    PRIMARY KEY (address, day)
  );
  CREATE TABLE IF NOT EXISTS leaderboard (
    address        TEXT PRIMARY KEY,
    best_score     INTEGER NOT NULL DEFAULT 0,
    total_claimed  REAL DEFAULT 0,
    games_played   INTEGER DEFAULT 0,
    last_played    INTEGER DEFAULT (strftime('%s','now')),
    updated_at     INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS score_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    address    TEXT NOT NULL,
    score      INTEGER NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_history_time ON score_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_history_addr ON score_history(address);
  CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(best_score DESC);
`);

// ─── MIGRATION : streak columns (idempotent) ──────────────────────────────────
const hasStreakCol = db.prepare(
  `SELECT COUNT(*) as c FROM pragma_table_info('leaderboard') WHERE name='streak_count'`
).get().c;
if (!hasStreakCol) {
  console.log('🔧 Migrating leaderboard: adding streak columns...');
  db.exec(`
    ALTER TABLE leaderboard ADD COLUMN streak_count     INTEGER DEFAULT 0;
    ALTER TABLE leaderboard ADD COLUMN max_streak       INTEGER DEFAULT 0;
    ALTER TABLE leaderboard ADD COLUMN last_streak_date TEXT;
  `);
  console.log('✅ Streak columns added to leaderboard');
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SIGNER_PK        = process.env.SIGNER_PK;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const DAILY_LIMIT      = parseFloat(process.env.DAILY_LIMIT || '100');
const MAX_PER_SESSION  = parseFloat(process.env.MAX_PER_SESSION || '50');
const PORT             = process.env.PORT || 3000;
const DISCORD_WEBHOOK  = process.env.DISCORD_WEBHOOK || '';
const PUBLIC_FEED_WEBHOOK = process.env.PUBLIC_FEED_WEBHOOK || '';

// ─── ANTI-CHEAT THRESHOLDS ───────────────────────────────────────────────────
const MIN_SESSION_SEC  = parseInt(process.env.MIN_SESSION_SEC || '3', 10);   // <3s = bot
const MAX_PTS_PER_SEC  = parseFloat(process.env.MAX_PTS_PER_SEC || '5');     // humain pro = 3-4
const MIN_SESSION_GAP  = parseInt(process.env.MIN_SESSION_GAP || '2', 10);   // 2s entre sessions/wallet

// ─── ADMIN ───────────────────────────────────────────────────────────────────
const ADMIN_TOKEN      = process.env.ADMIN_TOKEN || '';
function adminAuth(req, res, next) {
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'Admin disabled (no token)' });
  const header = req.get('Authorization') || '';
  const token  = header.replace(/^Bearer\s+/i, '');
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

if (!SIGNER_PK) { console.error('❌ SIGNER_PK manquant dans .env'); process.exit(1); }

const wallet = new ethers.Wallet(SIGNER_PK);
console.log('✅ Signer wallet:', wallet.address);

// ─── Discord webhook helper (non-blocking) ──────────────────────────────────
async function discordNotify(embed) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
  } catch (e) { console.log('discord webhook:', e.message); }
}

// ─── PUBLIC FEED (channel public Discord) ────────────────────────────────────
async function publicFeed(payload) {
  if (!PUBLIC_FEED_WEBHOOK) return;
  try {
    await fetch(PUBLIC_FEED_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.log('public feed webhook:', e.message); }
}

// Milestones joueur — déclenche à chaque palier franchi
const GAMES_MILESTONES  = [10, 50, 100, 250, 500, 1000];
const CLAIMED_MILESTONES = [10, 50, 100, 500, 1000, 5000];
const STREAK_MILESTONES  = [3, 7, 14, 30, 50, 100];
function crossedMilestone(oldVal, newVal, milestones) {
  return milestones.find(m => oldVal < m && newVal >= m);
}

function shortAddr(a){ return a.slice(0,6) + '…' + a.slice(-4); }

// ─── STREAK helpers ──────────────────────────────────────────────────────────
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
// Calcule le nouveau streak à partir de l'état précédent et de la date du jour
function computeStreak(prevStreak, lastStreakDate, today) {
  if (!lastStreakDate)           return prevStreak >= 1 ? prevStreak : 1; // première fois ou données legacy
  if (lastStreakDate === today)  return prevStreak; // déjà joué aujourd'hui → pas de change
  if (lastStreakDate === yesterdayUTC()) return prevStreak + 1; // continuité
  return 1; // streak cassée → reset
}
// Multiplier reward selon streak
function streakMultiplier(streak) {
  if (streak >= 30) return 2.0;
  if (streak >= 14) return 1.5;
  if (streak >= 7)  return 1.25;
  if (streak >= 3)  return 1.1;
  return 1.0;
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json());
// CORS admin routes — any origin allowed (auth via bearer token)
app.use('/api/admin', cors({
  origin: true,
  methods: ['GET','POST'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}));

// CORS public routes — restricted to known origins
app.use(cors({
  origin: ['https://snowdiablo.xyz', 'http://snowdiablo.xyz', 'http://localhost'],
  methods: ['GET','POST'],
}));

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de requêtes. Réessaie dans une heure.' }
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', signer: wallet.address });
});

app.post('/api/session/start', (req, res) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse wallet invalide' });
  }
  const addr = address.toLowerCase();

  // Anti-spam : rejette si session créée il y a < MIN_SESSION_GAP sec
  const lastSession = db.prepare(
    'SELECT created_at FROM sessions WHERE address=? ORDER BY created_at DESC LIMIT 1'
  ).get(addr);
  if (lastSession) {
    const gap = Math.floor(Date.now()/1000) - lastSession.created_at;
    if (gap < MIN_SESSION_GAP) {
      return res.status(429).json({ error: `Attends ${MIN_SESSION_GAP - gap}s avant nouvelle session` });
    }
  }

  const sessionId = ethers.hexlify(ethers.randomBytes(16));
  db.prepare(`INSERT INTO sessions (id, address, score, reward) VALUES (?, ?, 0, 0)`)
    .run(sessionId, addr);
  res.json({ sessionId });
});

app.post('/api/session/end', (req, res) => {
  const { sessionId, score, address } = req.body;
  if (!sessionId || typeof score !== 'number' || score < 0) {
    return res.status(400).json({ error: 'Données invalides' });
  }

  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (session.validated) return res.status(400).json({ error: 'Session déjà validée' });

  const cappedScore  = Math.min(score, 500);

  // ─── ANTI-CHEAT ──────────────────────────────────────────────────────────
  const now      = Math.floor(Date.now() / 1000);
  const duration = Math.max(1, now - session.created_at);
  const ratio    = cappedScore / duration;

  // Trop rapide = bot
  if (cappedScore > 0 && duration < MIN_SESSION_SEC) {
    db.prepare('UPDATE sessions SET validated=1, score=0, reward=0 WHERE id=?').run(sessionId);
    console.warn(`[CHEAT] ${session.address} score=${cappedScore} duration=${duration}s`);
    discordNotify({
      title: '🚨 Anti-cheat trigger',
      color: 0xff3333,
      fields: [
        { name: 'Wallet',   value: shortAddr(session.address), inline: true },
        { name: 'Score',    value: `${cappedScore}`, inline: true },
        { name: 'Duration', value: `${duration}s (min ${MIN_SESSION_SEC}s)`, inline: true },
        { name: 'Reason',   value: 'Session trop courte (probable bot)', inline: false },
      ],
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ error: 'Session rejetée (trop courte)' });
  }

  // Trop de points/seconde = speed hack
  if (ratio > MAX_PTS_PER_SEC) {
    db.prepare('UPDATE sessions SET validated=1, score=0, reward=0 WHERE id=?').run(sessionId);
    console.warn(`[CHEAT] ${session.address} ratio=${ratio.toFixed(2)} pts/sec`);
    discordNotify({
      title: '🚨 Anti-cheat trigger',
      color: 0xff3333,
      fields: [
        { name: 'Wallet',   value: shortAddr(session.address), inline: true },
        { name: 'Score',    value: `${cappedScore}`, inline: true },
        { name: 'Duration', value: `${duration}s`, inline: true },
        { name: 'Ratio',    value: `${ratio.toFixed(2)} pts/s (max ${MAX_PTS_PER_SEC})`, inline: true },
        { name: 'Reason',   value: 'Ratio points/sec anormal', inline: false },
      ],
      timestamp: new Date().toISOString(),
    });
    return res.status(400).json({ error: 'Score rejeté (vitesse anormale)' });
  }

  const addr = session.address;

  // ─── STREAK compute (before reward, so reward applies multiplier) ─────────
  const today = todayUTC();
  const streakRow = db.prepare(
    'SELECT streak_count, max_streak, last_streak_date FROM leaderboard WHERE address=?'
  ).get(addr);
  const prevStreak     = streakRow ? (streakRow.streak_count || 0) : 0;
  const prevMaxStreak  = streakRow ? (streakRow.max_streak   || 0) : 0;
  const lastStreakDate = streakRow ? streakRow.last_streak_date    : null;

  // Only advance streak on valid scoring sessions (anti-cheat already passed)
  const newStreak    = cappedScore > 0 ? computeStreak(prevStreak, lastStreakDate, today) : prevStreak;
  const newMaxStreak = Math.max(prevMaxStreak, newStreak);
  const multiplier   = streakMultiplier(newStreak);

  // Base reward + streak multiplier
  const baseReward = Math.min(Math.floor(cappedScore / 10), MAX_PER_SESSION);
  const reward     = Math.min(Math.floor(baseReward * multiplier), MAX_PER_SESSION);

  db.prepare('UPDATE sessions SET score=?, reward=?, validated=1 WHERE id=?')
    .run(cappedScore, reward, sessionId);

  // Snapshot pré-update pour détecter records + milestones
  const prevRow = db.prepare('SELECT best_score, games_played FROM leaderboard WHERE address=?').get(addr);
  const prevBest  = prevRow ? prevRow.best_score  : 0;
  const prevGames = prevRow ? prevRow.games_played : 0;
  const allTimeMax = db.prepare('SELECT COALESCE(MAX(best_score),0) as m FROM leaderboard').get().m;

  db.prepare(`
    INSERT INTO leaderboard (address, best_score, games_played, last_played, updated_at,
                             streak_count, max_streak, last_streak_date)
    VALUES (?, ?, 1, strftime('%s','now'), strftime('%s','now'), ?, ?, ?)
    ON CONFLICT(address) DO UPDATE SET
      best_score       = MAX(best_score, excluded.best_score),
      games_played     = games_played + 1,
      last_played      = excluded.last_played,
      updated_at       = excluded.updated_at,
      streak_count     = excluded.streak_count,
      max_streak       = excluded.max_streak,
      last_streak_date = excluded.last_streak_date
  `).run(addr, cappedScore, newStreak, newMaxStreak, cappedScore > 0 ? today : lastStreakDate);

  db.prepare('INSERT INTO score_history (address, score) VALUES (?, ?)')
    .run(addr, cappedScore);

  // ─── PUBLIC FEED — nouveau record all-time ─────────────────────────────────
  if (cappedScore > allTimeMax && cappedScore >= 20) {
    publicFeed({
      content: `🔥 **NOUVEAU RECORD ALL-TIME !** 🏆`,
      embeds: [{
        title: '🐍 Record SnakeCoin battu',
        description: `[${shortAddr(addr)}](https://polygonscan.com/address/${addr}) vient de poser **${cappedScore} points** !\nL'ancien record était de **${allTimeMax}** points.`,
        color: 0xffd700,
        fields: [
          { name: 'Score', value: `**${cappedScore}** pts`, inline: true },
          { name: 'Reward', value: `${reward} $SNAKE`, inline: true },
        ],
        footer: { text: 'SnakeCoin · jouer sur snowdiablo.xyz' },
        timestamp: new Date().toISOString(),
      }],
    });
  }
  // Record personnel (sans être all-time) — seulement si score notable
  else if (cappedScore > prevBest && cappedScore >= 30) {
    publicFeed({
      embeds: [{
        title: '🎯 Nouveau record personnel',
        description: `[${shortAddr(addr)}](https://polygonscan.com/address/${addr}) améliore son best : **${cappedScore}** pts (avant ${prevBest})`,
        color: 0x3b82f6,
        footer: { text: 'SnakeCoin' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // ─── PUBLIC FEED — milestone games_played ──────────────────────────────────
  const newGames = prevGames + 1;
  const gameMilestone = crossedMilestone(prevGames, newGames, GAMES_MILESTONES);
  if (gameMilestone) {
    publicFeed({
      embeds: [{
        title: `🎮 Milestone : ${gameMilestone} parties jouées`,
        description: `[${shortAddr(addr)}](https://polygonscan.com/address/${addr}) vient d'atteindre **${gameMilestone} parties** !`,
        color: 0xa855f7,
        footer: { text: 'SnakeCoin · dedication reward' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // ─── PUBLIC FEED — milestone streak quotidien ──────────────────────────────
  const streakMilestone = crossedMilestone(prevStreak, newStreak, STREAK_MILESTONES);
  if (streakMilestone) {
    const mult = streakMultiplier(newStreak);
    publicFeed({
      content: streakMilestone >= 30 ? `🔥 **${streakMilestone} JOURS D'AFFILÉE — LEGEND STATUS** 🔥` : null,
      embeds: [{
        title: `🔥 Streak ${streakMilestone} jours !`,
        description: `[${shortAddr(addr)}](https://polygonscan.com/address/${addr}) joue **${streakMilestone} jours d'affilée** sans casser sa série.\nMultiplier actif : **x${mult}**`,
        color: streakMilestone >= 30 ? 0xff6b00 : 0xf97316,
        fields: [
          { name: 'Streak actuel', value: `🔥 ${newStreak} jours`, inline: true },
          { name: 'Record perso',  value: `${newMaxStreak} jours`, inline: true },
          { name: 'Multiplier',    value: `x${mult}`, inline: true },
        ],
        footer: { text: 'SnakeCoin · daily streak' },
        timestamp: new Date().toISOString(),
      }],
    });
    // Discord staff aussi (rare event, worth tracking)
    discordNotify({
      title: `🔥 Streak milestone — ${streakMilestone} jours`,
      color: 0xff6b00,
      fields: [
        { name: 'Wallet',     value: shortAddr(addr), inline: true },
        { name: 'Streak',     value: `${newStreak} jours`, inline: true },
        { name: 'Multiplier', value: `x${mult}`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    sessionId,
    score: cappedScore,
    reward,
    streak: {
      current:    newStreak,
      max:        newMaxStreak,
      multiplier: multiplier,
      milestone:  streakMilestone || null,
    },
  });
});

app.post('/api/claim', limiter, async (req, res) => {
  const { address, sessionId } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  if (!CONTRACT_ADDRESS) {
    return res.status(503).json({ error: 'Contrat non configuré' });
  }

  const addr = address.toLowerCase();

  const session = db.prepare('SELECT * FROM sessions WHERE id=? AND address=? AND validated=1')
    .get(sessionId, addr);
  if (!session) {
    return res.status(400).json({ error: 'Session invalide ou non terminée' });
  }
  if (session.reward <= 0) {
    return res.status(400).json({ error: 'Pas assez de points (min 10)' });
  }

  const today = new Date().toISOString().slice(0,10);
  const daily = db.prepare('SELECT total FROM daily_claims WHERE address=? AND day=?')
    .get(addr, today);
  const alreadyClaimed = daily ? daily.total : 0;

  if (alreadyClaimed + session.reward > DAILY_LIMIT) {
    return res.status(400).json({
      error: `Limite journalière atteinte (${DAILY_LIMIT} $SNAKE/jour)`
    });
  }

  const nonce  = ethers.hexlify(ethers.randomBytes(32));
  const amount = ethers.parseEther(session.reward.toString());

  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'address'],
    [address, amount, nonce, CONTRACT_ADDRESS]
  );
  const hash = ethers.keccak256(encoded);
  const sig  = await wallet.signMessage(ethers.getBytes(hash));

  db.prepare('INSERT INTO claims (nonce, address, amount) VALUES (?,?,?)')
    .run(nonce, addr, amount.toString());

  db.prepare(`
    INSERT INTO daily_claims (address, day, total) VALUES (?,?,?)
    ON CONFLICT(address, day) DO UPDATE SET total = total + ?
  `).run(addr, today, session.reward, session.reward);

  db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);

  // Snapshot pré-update pour détecter milestones claim
  const prevClaimedRow = db.prepare('SELECT total_claimed FROM leaderboard WHERE address=?').get(addr);
  const prevClaimed = prevClaimedRow ? prevClaimedRow.total_claimed : 0;
  const newClaimed  = prevClaimed + session.reward;

  db.prepare(`
    UPDATE leaderboard SET
      total_claimed = total_claimed + ?,
      updated_at    = strftime('%s','now')
    WHERE address = ?
  `).run(session.reward, addr);

  discordNotify({
    title: '💰 New $SNAKE Claim',
    color: 0x00ff88,
    fields: [
      { name: 'Wallet',  value: `[${shortAddr(address)}](https://polygonscan.com/address/${address})`, inline: true },
      { name: 'Amount',  value: `${session.reward} $SNAKE`, inline: true },
      { name: 'Nonce',   value: '`' + nonce.slice(0, 10) + '…`', inline: false },
    ],
    timestamp: new Date().toISOString(),
    footer: { text: 'SnakeCoin · Polygon' },
  });

  // ─── PUBLIC FEED — gros claim (≥ 10 SNAKE) ─────────────────────────────────
  if (session.reward >= 10) {
    publicFeed({
      embeds: [{
        title: '💸 Gros claim en cours',
        description: `[${shortAddr(address)}](https://polygonscan.com/address/${address}) vient de claim **${session.reward} $SNAKE**`,
        color: 0x22c55e,
        footer: { text: 'SnakeCoin · Polygon mainnet' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  // ─── PUBLIC FEED — milestone total_claimed ─────────────────────────────────
  const claimedMilestone = crossedMilestone(prevClaimed, newClaimed, CLAIMED_MILESTONES);
  if (claimedMilestone) {
    publicFeed({
      content: claimedMilestone >= 500 ? `🚀 WHALE ALERT` : null,
      embeds: [{
        title: `💎 Milestone : ${claimedMilestone} $SNAKE claimés au total`,
        description: `[${shortAddr(address)}](https://polygonscan.com/address/${address}) franchit la barre des **${claimedMilestone} $SNAKE cumulés** !`,
        color: claimedMilestone >= 500 ? 0xef4444 : 0xeab308,
        footer: { text: 'SnakeCoin · legend status' },
        timestamp: new Date().toISOString(),
      }],
    });
  }

  res.json({
    amount: amount.toString(),
    nonce,
    sig,
    reward: session.reward,
  });
});

// ─── PUBLIC STATS ─────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const totalClaims  = db.prepare('SELECT COUNT(*) as c FROM claims').get().c;
  const todayClaims  = db.prepare(`SELECT COUNT(*) as c FROM claims WHERE claimed_at > strftime('%s','now','-1 day')`).get().c;
  const totalPlayers = db.prepare('SELECT COUNT(*) as c FROM leaderboard').get().c;
  const totalGames   = db.prepare('SELECT COUNT(*) as c FROM score_history').get().c;
  const distributed  = db.prepare('SELECT COALESCE(SUM(total_claimed),0) as s FROM leaderboard').get().s;
  const highestScore = db.prepare('SELECT COALESCE(MAX(best_score),0) as m FROM leaderboard').get().m;
  res.json({
    totalClaims, todayClaims,
    totalPlayers, totalGames,
    totalSnakeDistributed: distributed,
    highestScore,
  });
});

app.get('/api/leaderboard', (req, res) => {
  const period = (req.query.period || 'all').toLowerCase();
  const limit  = Math.min(parseInt(req.query.limit || '10', 10), 100);

  let rows;
  if (period === 'day' || period === 'week') {
    const offset = period === 'day' ? '-1 day' : '-7 days';
    rows = db.prepare(`
      SELECT address, MAX(score) as best_score, COUNT(*) as games_played
      FROM score_history
      WHERE created_at > strftime('%s','now', ?)
      GROUP BY address
      ORDER BY best_score DESC
      LIMIT ?
    `).all(offset, limit);
  } else {
    rows = db.prepare(`
      SELECT address, best_score, games_played, total_claimed
      FROM leaderboard
      ORDER BY best_score DESC
      LIMIT ?
    `).all(limit);
  }
  res.json({ period, limit, leaderboard: rows });
});

app.get('/api/player/:address', (req, res) => {
  const addr = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(addr)) return res.status(400).json({ error: 'Adresse invalide' });
  const row = db.prepare('SELECT * FROM leaderboard WHERE address = ?').get(addr);
  if (!row) return res.json({
    address: addr, best_score: 0, games_played: 0, total_claimed: 0, rank: null,
    streak: { current: 0, max: 0, multiplier: 1.0, active: false, last_date: null },
  });
  const rank = db.prepare('SELECT COUNT(*)+1 as r FROM leaderboard WHERE best_score > ?').get(row.best_score).r;

  // Streak status : "active" si last_streak_date == today OR yesterday
  const today   = todayUTC();
  const yest    = yesterdayUTC();
  const last    = row.last_streak_date;
  const active  = last === today || last === yest;
  // Si active mais pas joué aujourd'hui, le streak risque de casser → "at_risk"
  const atRisk  = active && last !== today;
  // Si dernière date < hier, streak est déjà cassé → current effectif = 0
  const effectiveCurrent = active ? (row.streak_count || 0) : 0;
  const mult = streakMultiplier(effectiveCurrent);

  res.json({
    ...row,
    rank,
    streak: {
      current:    effectiveCurrent,
      max:        row.max_streak || 0,
      multiplier: mult,
      active,
      at_risk:    atRisk,
      last_date:  last,
      played_today: last === today,
    },
  });
});

// ─── STREAK endpoint dédié (léger, cacheable) ──────────────────────────────────
app.get('/api/streak/:address', (req, res) => {
  const addr = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(addr)) return res.status(400).json({ error: 'Adresse invalide' });
  const row = db.prepare(
    'SELECT streak_count, max_streak, last_streak_date FROM leaderboard WHERE address = ?'
  ).get(addr);
  if (!row) {
    return res.json({
      address: addr,
      current: 0, max: 0, multiplier: 1.0,
      active: false, at_risk: false, played_today: false, last_date: null,
      next_milestone: STREAK_MILESTONES[0],
    });
  }
  const today  = todayUTC();
  const yest   = yesterdayUTC();
  const last   = row.last_streak_date;
  const active = last === today || last === yest;
  const atRisk = active && last !== today;
  const effectiveCurrent = active ? (row.streak_count || 0) : 0;
  const mult   = streakMultiplier(effectiveCurrent);
  const nextMilestone = STREAK_MILESTONES.find(m => m > effectiveCurrent) || null;

  res.json({
    address: addr,
    current:        effectiveCurrent,
    max:            row.max_streak || 0,
    multiplier:     mult,
    active,
    at_risk:        atRisk,
    played_today:   last === today,
    last_date:      last,
    next_milestone: nextMilestone,
    days_to_next:   nextMilestone ? nextMilestone - effectiveCurrent : null,
  });
});

// ─── ADMIN ROUTES ─────────────────────────────────────────────────────────────
app.get('/api/admin/backup', adminAuth, (req, res) => {
  const tmpPath = `/tmp/snake-backup-${Date.now()}.db`;
  try {
    db.exec(`VACUUM INTO '${tmpPath}'`);
    const stat = fs.statSync(tmpPath);
    const date = new Date().toISOString().slice(0,10);
    res.download(tmpPath, `snake-${date}.db`, (err) => {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      if (err) console.error('backup download error:', err.message);
    });
    console.log(`[BACKUP] served ${stat.size} bytes to ${req.ip}`);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    console.error('backup failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
  const sessions24h = db.prepare(`SELECT COUNT(*) as c FROM score_history WHERE created_at > strftime('%s','now','-1 day')`).get().c;
  const cheatAttempts = db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE validated=1 AND reward=0 AND score=0`).get().c;
  const topWallets  = db.prepare(`SELECT address, best_score, total_claimed, games_played FROM leaderboard ORDER BY total_claimed DESC LIMIT 20`).all();
  const recentClaims = db.prepare(`SELECT address, amount, claimed_at FROM claims ORDER BY claimed_at DESC LIMIT 50`).all();
  const totalDistributed = db.prepare('SELECT COALESCE(SUM(total_claimed),0) as s FROM leaderboard').get().s;
  res.json({
    sessions24h,
    cheatAttempts,
    totalDistributed,
    topWallets,
    recentClaims,
  });
});

app.listen(PORT, () => {
  console.log(`🐍 SnakeCoin backend running on port ${PORT}`);
  console.log(`💼 Contract: ${CONTRACT_ADDRESS || '⚠️ NON CONFIGURÉ'}`);
  if (DISCORD_WEBHOOK)     console.log('🤖 Discord webhook enabled (staff)');
  if (PUBLIC_FEED_WEBHOOK) console.log('📢 Public feed webhook enabled (#snake-feed)');
  if (ADMIN_TOKEN)         console.log('🔐 Admin token configured');
});
