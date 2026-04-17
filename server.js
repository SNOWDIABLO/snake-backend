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

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SIGNER_PK        = process.env.SIGNER_PK;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const DAILY_LIMIT      = parseFloat(process.env.DAILY_LIMIT || '100');
const MAX_PER_SESSION  = parseFloat(process.env.MAX_PER_SESSION || '50');
const PORT             = process.env.PORT || 3000;
const DISCORD_WEBHOOK  = process.env.DISCORD_WEBHOOK || '';

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
function shortAddr(a){ return a.slice(0,6) + '…' + a.slice(-4); }

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

  const reward = Math.min(Math.floor(cappedScore / 10), MAX_PER_SESSION);

  db.prepare('UPDATE sessions SET score=?, reward=?, validated=1 WHERE id=?')
    .run(cappedScore, reward, sessionId);

  const addr = session.address;
  db.prepare(`
    INSERT INTO leaderboard (address, best_score, games_played, last_played, updated_at)
    VALUES (?, ?, 1, strftime('%s','now'), strftime('%s','now'))
    ON CONFLICT(address) DO UPDATE SET
      best_score   = MAX(best_score, excluded.best_score),
      games_played = games_played + 1,
      last_played  = excluded.last_played,
      updated_at   = excluded.updated_at
  `).run(addr, cappedScore);

  db.prepare('INSERT INTO score_history (address, score) VALUES (?, ?)')
    .run(addr, cappedScore);

  res.json({ sessionId, score: cappedScore, reward });
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
  if (!row) return res.json({ address: addr, best_score: 0, games_played: 0, total_claimed: 0, rank: null });
  const rank = db.prepare('SELECT COUNT(*)+1 as r FROM leaderboard WHERE best_score > ?').get(row.best_score).r;
  res.json({ ...row, rank });
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
  if (DISCORD_WEBHOOK) console.log('🤖 Discord webhook enabled');
  if (ADMIN_TOKEN)     console.log('🔐 Admin token configured');
});
