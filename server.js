const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { ethers } = require('ethers');
const Database   = require('better-sqlite3');
const app = express();
const db  = new Database('snake.db');
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
`);
const SIGNER_PK        = process.env.SIGNER_PK;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const DAILY_LIMIT      = parseFloat(process.env.DAILY_LIMIT || '100');
const MAX_PER_SESSION  = parseFloat(process.env.MAX_PER_SESSION || '50');
const PORT             = process.env.PORT || 3000;
if (!SIGNER_PK) { console.error('SIGNER_PK manquant'); process.exit(1); }
const wallet = new ethers.Wallet(SIGNER_PK);
console.log('Signer wallet:', wallet.address);
app.use(helmet());
app.use(express.json());
app.use(cors({
  origin: ['https://snowdiablo.xyz', 'http://snowdiablo.xyz', 'http://localhost'],
  methods: ['GET','POST'],
}));
const limiter = rateLimit({ windowMs: 60*60*1000, max: 10 });
app.get('/health', (req, res) => res.json({ status: 'ok', signer: wallet.address }));
app.post('/api/session/start', (req, res) => {
  const { address } = req.body;
  if (!address || !ethers.isAddress(address))
    return res.status(400).json({ error: 'Adresse invalide' });
  const sessionId = ethers.hexlify(ethers.randomBytes(16));
  db.prepare(`INSERT INTO sessions (id, address, score, reward) VALUES (?, ?, 0, 0)`).run(sessionId, address.toLowerCase());
  res.json({ sessionId });
});
app.post('/api/session/end', (req, res) => {
  const { sessionId, score } = req.body;
  if (!sessionId || typeof score !== 'number' || score < 0)
    return res.status(400).json({ error: 'Données invalides' });
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session introuvable' });
  if (session.validated) return res.status(400).json({ error: 'Session déjà validée' });
  const cappedScore = Math.min(score, 500);
  const reward = Math.min(Math.floor(cappedScore / 10), MAX_PER_SESSION);
  db.prepare('UPDATE sessions SET score=?, reward=?, validated=1 WHERE id=?').run(cappedScore, reward, sessionId);
  res.json({ sessionId, score: cappedScore, reward });
});
app.post('/api/claim', limiter, async (req, res) => {
  const { address, sessionId } = req.body;
  if (!address || !ethers.isAddress(address))
    return res.status(400).json({ error: 'Adresse invalide' });
  if (!CONTRACT_ADDRESS)
    return res.status(503).json({ error: 'Contrat non configuré' });
  const addr = address.toLowerCase();
  const session = db.prepare('SELECT * FROM sessions WHERE id=? AND address=? AND validated=1').get(sessionId, addr);
  if (!session) return res.status(400).json({ error: 'Session invalide' });
  if (session.reward <= 0) return res.status(400).json({ error: 'Pas assez de points' });
  const today = new Date().toISOString().slice(0,10);
  const daily = db.prepare('SELECT total FROM daily_claims WHERE address=? AND day=?').get(addr, today);
  const alreadyClaimed = daily ? daily.total : 0;
  if (alreadyClaimed + session.reward > DAILY_LIMIT)
    return res.status(400).json({ error: 'Limite journalière atteinte' });
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const amount = ethers.parseEther(session.reward.toString());
  // FIX: abi.encode (pas encodePacked) pour matcher le smart contract
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address','uint256','bytes32','address'],
    [address, amount, nonce, CONTRACT_ADDRESS]
  );
  const hash = ethers.keccak256(encoded);
  const sig = await wallet.signMessage(ethers.getBytes(hash));
  db.prepare('INSERT INTO claims (nonce, address, amount) VALUES (?,?,?)').run(nonce, addr, amount.toString());
  db.prepare(`INSERT INTO daily_claims (address, day, total) VALUES (?,?,?) ON CONFLICT(address, day) DO UPDATE SET total = total + ?`).run(addr, today, session.reward, session.reward);
  db.prepare('DELETE FROM sessions WHERE id=?').run(sessionId);
  res.json({ amount: amount.toString(), nonce, sig, reward: session.reward });
});
app.get('/api/stats', (req, res) => {
  const totalClaims = db.prepare('SELECT COUNT(*) as c FROM claims').get().c;
  res.json({ totalClaims });
});
app.listen(PORT, () => {
  console.log(`SnakeCoin backend on port ${PORT}`);
  console.log(`Contract: ${CONTRACT_ADDRESS || 'NON CONFIGURE'}`);
});
