const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { ethers } = require('ethers');
const Database   = require('better-sqlite3');
const fs         = require('fs');
const path       = require('path');

const app = express();

// Railway / Heroku / Cloudflare → 1 reverse proxy devant l'app.
// Sans ça, express-rate-limit throw ValidationError ERR_ERL_UNEXPECTED_X_FORWARDED_FOR
// et le process crash à chaque requête rate-limitée.
// "1" = trust le 1er proxy (Railway). Ne PAS mettre "true" en prod (IP spoofable).
app.set('trust proxy', 1);

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

// ─── MIGRATION : events (task #20 golden snake) ──────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,
    multiplier  REAL NOT NULL DEFAULT 3.0,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    reason      TEXT DEFAULT 'auto',
    meta_json   TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_type_active ON events(type, ended_at);
`);

// ─── MIGRATION : seasons (idempotent) ────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS seasons (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER,
    stats_json  TEXT
  );
  CREATE TABLE IF NOT EXISTS season_results (
    season_id      INTEGER NOT NULL,
    address        TEXT NOT NULL,
    rank           INTEGER NOT NULL,
    best_score     INTEGER NOT NULL,
    games_played   INTEGER NOT NULL,
    total_claimed  REAL NOT NULL,
    max_streak     INTEGER DEFAULT 0,
    PRIMARY KEY (season_id, address)
  );
  CREATE INDEX IF NOT EXISTS idx_season_results_rank ON season_results(season_id, rank);
  -- Task #22 : NFT trophy drops (ERC-721)
  CREATE TABLE IF NOT EXISTS nft_drops (
    season_id   INTEGER NOT NULL,
    address     TEXT NOT NULL,
    rank        INTEGER NOT NULL,
    status      TEXT NOT NULL DEFAULT 'eligible',  -- eligible | minted
    nonce       TEXT,
    tx_hash     TEXT,
    minted_at   INTEGER,
    created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (season_id, address)
  );
  CREATE INDEX IF NOT EXISTS idx_nft_drops_addr ON nft_drops(address);
  CREATE INDEX IF NOT EXISTS idx_nft_drops_status ON nft_drops(status);
  -- Task #97 : proof nonces persisted (anti-replay survives Railway redeploy)
  -- Before this, seenProofNonces lived in RAM (new Map()). Railway restart → empty
  -- map → attacker could replay a previously captured signed payload. Now the
  -- nonce is DB-backed with TTL = PROOF_MAX_AGE_SEC * 2, cleaned by cron.
  CREATE TABLE IF NOT EXISTS proof_nonces (
    nonce      TEXT PRIMARY KEY,
    address    TEXT NOT NULL,
    action     TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_proof_nonces_exp ON proof_nonces(expires_at);
`);

// Seed initial season if none exists
const seasonCount = db.prepare('SELECT COUNT(*) as c FROM seasons').get().c;
if (seasonCount === 0) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO seasons (name, started_at) VALUES (?, ?)').run('Season 1', now);
  console.log('🏆 Initial season "Season 1" created');
}

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

// ─── MIGRATION : multi-games support (Phase 4) ────────────────────────────────
// Ajoute une colonne `game` sur les 4 tables core pour permettre à d'autres jeux
// (pong, flappy, breakout, 2048, minesweeper, space-invaders) d'utiliser les
// mêmes primitives sessions/claims/leaderboard/score_history.
// Backward-compatible : DEFAULT 'snake' donc les INSERTs existants (sans `game`)
// sont automatiquement taggés 'snake'. Lookups via idx composites.
{
  const _gameTables = ['sessions', 'claims', 'leaderboard', 'score_history'];
  for (const _t of _gameTables) {
    const _has = db.prepare(
      `SELECT COUNT(*) as c FROM pragma_table_info(?) WHERE name='game'`
    ).get(_t).c;
    if (!_has) {
      console.log(`🔧 Migrating ${_t}: adding game column (default 'snake')...`);
      db.exec(`ALTER TABLE ${_t} ADD COLUMN game TEXT NOT NULL DEFAULT 'snake';`);
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_leaderboard_game_score ON leaderboard(game, best_score DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_game          ON sessions(game, created_at);
    CREATE INDEX IF NOT EXISTS idx_claims_game            ON claims(game, claimed_at);
    CREATE INDEX IF NOT EXISTS idx_history_game           ON score_history(game, created_at);
  `);

  // ─── Rebuild leaderboard avec PK composite (address, game) ───
  // SQLite ne permet pas ALTER PRIMARY KEY. Rebuild safe en transaction.
  // Idempotent : vérif si la PK courante contient déjà `game`.
  {
    const _pkCols = db.prepare(
      `SELECT name FROM pragma_table_info('leaderboard') WHERE pk > 0 ORDER BY pk`
    ).all().map(r => r.name);
    const _hasCompositePK = _pkCols.includes('address') && _pkCols.includes('game');
    if (!_hasCompositePK) {
      console.log(`🔧 Rebuilding leaderboard with composite PK (address, game)... current PK: [${_pkCols.join(',')}]`);
      const _tx = db.transaction(() => {
        db.exec(`
          CREATE TABLE leaderboard_v2 (
            address        TEXT NOT NULL,
            game           TEXT NOT NULL DEFAULT 'snake',
            best_score     INTEGER NOT NULL DEFAULT 0,
            total_claimed  REAL DEFAULT 0,
            games_played   INTEGER DEFAULT 0,
            last_played    INTEGER DEFAULT (strftime('%s','now')),
            updated_at     INTEGER DEFAULT (strftime('%s','now')),
            streak_count      INTEGER DEFAULT 0,
            max_streak        INTEGER DEFAULT 0,
            last_streak_date  TEXT,
            PRIMARY KEY (address, game)
          );
        `);
        // Copie les colonnes existantes (dynamique — certaines ne sont ajoutées qu'au run pour streak)
        const _cols = db.prepare(`SELECT name FROM pragma_table_info('leaderboard')`).all().map(r => r.name);
        const _have = (c) => _cols.includes(c) ? c : `NULL AS ${c}`;
        const _selectCols = [
          'address',
          _cols.includes('game') ? 'game' : `'snake' AS game`,
          'best_score',
          'total_claimed',
          'games_played',
          'last_played',
          'updated_at',
          _have('streak_count'),
          _have('max_streak'),
          _have('last_streak_date'),
        ].join(', ');
        db.exec(`INSERT INTO leaderboard_v2 SELECT ${_selectCols} FROM leaderboard;`);
        db.exec(`DROP TABLE leaderboard;`);
        db.exec(`ALTER TABLE leaderboard_v2 RENAME TO leaderboard;`);
        db.exec(`
          CREATE INDEX IF NOT EXISTS idx_leaderboard_score       ON leaderboard(best_score DESC);
          CREATE INDEX IF NOT EXISTS idx_leaderboard_game_score  ON leaderboard(game, best_score DESC);
        `);
      });
      _tx();
      console.log('✅ leaderboard rebuilt with PK(address, game)');
    }
  }

  console.log('✅ Multi-games migration ready (sessions/claims/leaderboard/score_history)');
}

// ─── MIGRATION : claim idempotency (fix race condition post-launch) ──────────
// Ajoute claim_nonce / claim_sig / claim_amount sur sessions pour permettre un
// retry côté frontend si le contract revert on-chain (ex: require(false) pour
// raison transitoire). Évite le DELETE + daily_claims increment prématuré qui
// rendait le retry impossible ("Session invalide ou non terminée").
// Idempotent.
{
  const _sessionCols = db.prepare(`SELECT name FROM pragma_table_info('sessions')`).all().map(r => r.name);
  if (!_sessionCols.includes('claim_nonce')) {
    console.log('🔧 Migrating sessions: adding claim_nonce/claim_sig/claim_amount + claimed_at...');
    db.exec(`
      ALTER TABLE sessions ADD COLUMN claim_nonce  TEXT;
      ALTER TABLE sessions ADD COLUMN claim_sig    TEXT;
      ALTER TABLE sessions ADD COLUMN claim_amount TEXT;
      ALTER TABLE sessions ADD COLUMN claimed_at   INTEGER;
    `);
    console.log('✅ Sessions idempotency columns added');
  }
}

// Whitelist des jeux supportés. Phase 5 ajoutera les 6 autres jeux.
const SUPPORTED_GAMES = ['snake', 'pong', 'flappy', 'breakout', 'space-invaders', '2048', 'minesweeper'];
function normalizeGame(g) {
  const s = String(g || 'snake').toLowerCase();
  return SUPPORTED_GAMES.includes(s) ? s : 'snake';
}

// ─── BALANCE: reward divisor par jeu (task #130) ──────────────────────────────
// Tous les jeux ne génèrent pas le même nb de points/minute. Un diviseur identique
// (10) favorise les jeux "point-rich" (2048 = 2000+ pts/partie) au détriment des
// jeux skill-heavy (Invaders = 50-100 pts). Ce map normalise les rewards à ~1-10
// $SNAKE/minute par jeu pour éviter le farm.
// Formule: baseReward = cappedScore / GAME_REWARD_DIVISORS[game]
const GAME_REWARD_DIVISORS = {
  'snake':          10,   // baseline (10 pts = 1 $SNAKE)
  'pong':           10,
  'flappy':         10,
  'breakout':       10,
  'minesweeper':    10,
  'space-invaders': 5,    // buff x2 (jeu difficile, peu de points/partie)
  '2048':           150,  // nerf x15 (jeu trivial à points, évite farm bot)
};
function getRewardDivisor(game) {
  return GAME_REWARD_DIVISORS[game] || 10;
}

// ─── MIGRATION : usernames (task #68) ─────────────────────────────────────────
// Pseudo lié à un wallet. 3-16 chars ASCII [a-zA-Z0-9_-].
// Unicité case-insensitive (COLLATE NOCASE).
// First setup = free. Ensuite : 1 free change par mois calendrier OU paid change (burn 1000 $SNAKE).
// last_free_change_month au format 'YYYY-MM' UTC.
db.exec(`
  CREATE TABLE IF NOT EXISTS usernames (
    wallet                 TEXT PRIMARY KEY,
    username               TEXT NOT NULL UNIQUE COLLATE NOCASE,
    set_at                 INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_changed_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    last_free_change_month TEXT,
    paid_changes_count     INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_usernames_username ON usernames(username COLLATE NOCASE);
`);
console.log('✅ Usernames table ready');

// Tracking des tx de burn consommées (anti-replay)
db.exec(`
  CREATE TABLE IF NOT EXISTS username_burns (
    tx_hash     TEXT PRIMARY KEY,
    wallet      TEXT NOT NULL,
    amount      TEXT NOT NULL,
    consumed_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);

// ─── MIGRATION : NFT Boost cache (task #71) ──────────────────────────────────
// Cache multiplier bps pour hot path session/end (reads sync, pas de RPC).
// Refresh async via endpoint /api/boost/multiplier + cron 10min sur wallets actifs.
// bps = basis points (200 = +2%, 400 = +4%, 800 = +8%, etc.)
// updated_at = timestamp Unix. TTL côté lecture = 15 min (warn si plus vieux).
db.exec(`
  CREATE TABLE IF NOT EXISTS boost_mult_cache (
    wallet      TEXT PRIMARY KEY,
    bps         INTEGER NOT NULL DEFAULT 0,
    updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_boost_mult_updated ON boost_mult_cache(updated_at);
`);
console.log('✅ Boost multiplier cache table ready');

// ─── MIGRATION : Tournaments 24h (task #69) ──────────────────────────────────
// tournaments = meta par édition (24h). Une seule ligne "open" à la fois.
// tournament_entries = wallets inscrits, avec best_score mis à jour pendant la fenêtre.
// Prize pool accumulé côté DB en wei (string BigInt compatible). Split 40/20/10 pour top 3.
// Payout déclenché par cron quand end_at < now.
db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    start_at        INTEGER NOT NULL,
    end_at          INTEGER NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'open',   -- open|closing|closed|failed
    entry_fee_wei   TEXT    NOT NULL DEFAULT '0',
    prize_pool_wei  TEXT    NOT NULL DEFAULT '0',
    entries_count   INTEGER NOT NULL DEFAULT 0,
    winner1         TEXT,
    winner2         TEXT,
    winner3         TEXT,
    payout_tx_1     TEXT,
    payout_tx_2     TEXT,
    payout_tx_3     TEXT,
    closed_at       INTEGER,
    created_at      INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tournaments_status ON tournaments(status);
  CREATE INDEX IF NOT EXISTS idx_tournaments_end ON tournaments(end_at);

  CREATE TABLE IF NOT EXISTS tournament_entries (
    tournament_id  INTEGER NOT NULL,
    wallet         TEXT    NOT NULL,
    paid_tx        TEXT    NOT NULL,
    paid_amount    TEXT    NOT NULL DEFAULT '0',
    best_score     INTEGER NOT NULL DEFAULT 0,
    games_played   INTEGER NOT NULL DEFAULT 0,
    paid_at        INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (tournament_id, wallet),
    FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
  );
  CREATE INDEX IF NOT EXISTS idx_tournament_entries_score
    ON tournament_entries(tournament_id, best_score DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_tournament_entries_tx
    ON tournament_entries(paid_tx);
`);
console.log('✅ Tournaments tables ready');

// ─── MIGRATION : Clans / Guildes (task #70) ──────────────────────────────────
// clans = meta guilde. Création = burn $SNAKE obligatoire (CLAN_CREATE_BURN).
// clan_members = 1 wallet = 1 clan max. role = 'owner' | 'member'.
// Tag 2-6 chars alphanum, display court sur leaderboard.
db.exec(`
  CREATE TABLE IF NOT EXISTS clans (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    tag          TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    owner        TEXT    NOT NULL,
    burn_tx      TEXT,
    burn_amount  TEXT,
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_clans_owner ON clans(owner);

  CREATE TABLE IF NOT EXISTS clan_members (
    wallet     TEXT    NOT NULL PRIMARY KEY,
    clan_id    INTEGER NOT NULL,
    role       TEXT    NOT NULL DEFAULT 'member',
    joined_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    FOREIGN KEY (clan_id) REFERENCES clans(id)
  );
  CREATE INDEX IF NOT EXISTS idx_clan_members_clan ON clan_members(clan_id);

  CREATE TABLE IF NOT EXISTS clan_create_burns (
    tx_hash     TEXT PRIMARY KEY,
    wallet      TEXT NOT NULL,
    amount      TEXT NOT NULL,
    consumed_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS clan_weekly_payouts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    week_start      INTEGER NOT NULL,
    week_end        INTEGER NOT NULL,
    clan1_id        INTEGER,
    clan2_id        INTEGER,
    clan3_id        INTEGER,
    clan1_score     INTEGER,
    clan2_score     INTEGER,
    clan3_score     INTEGER,
    pool_wei        TEXT NOT NULL DEFAULT '0',
    executed_at     INTEGER
  );
`);
console.log('✅ Clans tables ready');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const SIGNER_PK            = process.env.SIGNER_PK;
const CONTRACT_ADDRESS     = process.env.CONTRACT_ADDRESS;        // $SNAKE ERC-20
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;    // SnakeTrophyNFT ERC-721
const BOOST_NFT_ADDRESS    = process.env.BOOST_NFT_ADDRESS || ''; // SnakeBoostNFT ERC-721 (task #71, optional)

// Tournaments 24h (task #69). Activable via TOURNAMENT_ENABLED=1. Entry fee par défaut = 1 POL.
// PAYOUT_WALLET = adresse qui reçoit les entrées et d'où partent les gains (= signer wallet).
const TOURNAMENT_ENABLED    = process.env.TOURNAMENT_ENABLED === '1';
const TOURNAMENT_DURATION_H = parseInt(process.env.TOURNAMENT_DURATION_H || '24', 10);
const TOURNAMENT_ENTRY_POL  = process.env.TOURNAMENT_ENTRY_POL || '1';     // en POL (string), default 1 POL
const TOURNAMENT_PAYOUT_WALLET = (process.env.TOURNAMENT_PAYOUT_WALLET || '').toLowerCase();
const TOURNAMENT_MIN_CONFIRMATIONS = parseInt(process.env.TOURNAMENT_MIN_CONFIRMATIONS || '2', 10);

// Clans / Guildes (task #70). Burn = 1000 $SNAKE pour créer un clan.
// CLAN_WEEKLY_POOL_SNAKE = pool distribué au top 3 clans chaque dimanche 20h UTC.
// Split 50/30/20 aux owners de chaque clan (ils redistribuent off-chain ou via claim).
const CLAN_ENABLED             = process.env.CLAN_ENABLED === '1';
const CLAN_CREATE_BURN_AMOUNT  = process.env.CLAN_CREATE_BURN_AMOUNT || '1000';  // 1000 $SNAKE
const CLAN_MAX_MEMBERS         = parseInt(process.env.CLAN_MAX_MEMBERS || '10', 10);
const CLAN_WEEKLY_POOL_SNAKE   = process.env.CLAN_WEEKLY_POOL_SNAKE   || '0';    // '0' = désactivé
const CLAN_WEEKLY_SPLIT_BPS    = [5000, 3000, 2000]; // 50/30/20

// Royalty / fee wallet pour clan create + username paid-change.
// Si configuré : les tokens vont au FEE_WALLET (project revenue) au lieu de BURN_ADDRESS.
// L'owner peut ensuite burn manuellement une partie via Polygonscan (split 70/30 reco).
// Si vide : fallback legacy = 100% burn direct vers 0x...dEaD.
const CLAN_FEE_WALLET          = (process.env.CLAN_FEE_WALLET || '').trim().toLowerCase();
const USERNAME_FEE_WALLET      = (process.env.USERNAME_FEE_WALLET || '').trim().toLowerCase();
const USERNAME_BURN_AMOUNT     = '1000'; // 1000 $SNAKE (unité entière, converti en wei plus bas)

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

// ─── WALLET PROOF (EIP-191) — task #56 hardening ─────────────────────────────
// Force le caller à prouver ownership du wallet via signMessage avant actions sensibles
// (/api/claim, /api/nft/mint-sig). Défense contre griefing (attacker force claim
// pour wallet victime) et MITM frontend.
// REQUIRE_WALLET_PROOF=1 pour enforce, sinon warn-only (rollout progressif).
const REQUIRE_WALLET_PROOF  = process.env.REQUIRE_WALLET_PROOF === '1';
const PROOF_MAX_AGE_SEC     = parseInt(process.env.PROOF_MAX_AGE_SEC || '300', 10); // 5 min window
// ─── Nonces anti-replay persistés en DB (task #97) ────────────────────────────
// Avant : new Map() en RAM. Problème : un Railway redeploy (auto sur push git ou
// crash + restart) vidait la Map → replay attack possible sur une signature
// capturée qui était encore dans sa fenêtre de validité (ts ≤ 300s).
// Maintenant : INSERT dans proof_nonces avec PRIMARY KEY → toute tentative de
// replay lève SQLITE_CONSTRAINT, on mappe sur "replay detected".
const _insertNonceStmt = db.prepare(
  `INSERT INTO proof_nonces (nonce, address, action, expires_at) VALUES (?, ?, ?, ?)`
);
const _hasNonceStmt = db.prepare(
  `SELECT 1 FROM proof_nonces WHERE nonce = ? AND expires_at > ? LIMIT 1`
);
// Cleanup toutes les 10 min des nonces expirés pour garder la table maigre.
setInterval(() => {
  try {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('DELETE FROM proof_nonces WHERE expires_at < ?').run(now);
  } catch (e) {
    console.warn('⚠️ proof_nonces cleanup failed:', e.message);
  }
}, 10 * 60 * 1000).unref?.();

function buildProofMessage(action, address, ts, nonce) {
  return `SnakeCoin ${action}\nAddress: ${address.toLowerCase()}\nTimestamp: ${ts}\nNonce: ${nonce}`;
}
/**
 * Verify EIP-191 signature for ownership proof.
 * @param {string} action     - 'Claim' | 'MintTrophy' | 'LinkDiscord'
 * @param {string} address    - wallet claimed by caller
 * @param {object} proof      - { ts: number, nonce: string, signature: string }
 * @returns {{ok: boolean, error?: string}}
 */
function verifyWalletProof(action, address, proof) {
  if (!proof || typeof proof !== 'object') return { ok: false, error: 'Proof manquante' };
  const { ts, nonce, signature } = proof;
  if (!Number.isInteger(ts))   return { ok: false, error: 'Proof.ts invalide' };
  if (!nonce || typeof nonce !== 'string' || nonce.length < 8) return { ok: false, error: 'Proof.nonce invalide' };
  if (!signature || typeof signature !== 'string') return { ok: false, error: 'Proof.signature manquante' };

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > PROOF_MAX_AGE_SEC) {
    return { ok: false, error: `Proof expirée (max ${PROOF_MAX_AGE_SEC}s)` };
  }
  // Anti-replay : nonce unique persisté en DB (task #97).
  // Check preemptif (expiry-aware) puis INSERT — double défense contre race.
  try {
    const hit = _hasNonceStmt.get(nonce, nowSec);
    if (hit) return { ok: false, error: 'Proof déjà utilisée (replay)' };
  } catch (_) { /* fallthrough vers INSERT qui va throw */ }

  let recovered;
  try {
    recovered = ethers.verifyMessage(buildProofMessage(action, address, ts, nonce), signature);
  } catch (e) {
    return { ok: false, error: 'Signature invalide (format)' };
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, error: 'Signature ne correspond pas à cette adresse' };
  }
  // TTL = 2× la fenêtre de validité. Le client ne peut pas replay même si la
  // ligne vit encore quelques minutes après expiration, car le check `ts`
  // au-dessus rejette déjà la signature.
  try {
    _insertNonceStmt.run(nonce, address.toLowerCase(), action, nowSec + PROOF_MAX_AGE_SEC * 2);
  } catch (e) {
    // SQLITE_CONSTRAINT_PRIMARYKEY = replay détecté en race condition.
    if (e && /UNIQUE|PRIMARY KEY|constraint/i.test(e.message)) {
      return { ok: false, error: 'Proof déjà utilisée (replay)' };
    }
    console.warn('⚠️ proof_nonces insert failed:', e.message);
    // Fail-closed : on refuse plutôt que laisser passer si la DB est cassée.
    return { ok: false, error: 'Backend nonce store unavailable' };
  }
  return { ok: true };
}

if (!SIGNER_PK) { console.error('❌ SIGNER_PK manquant dans .env'); process.exit(1); }

const wallet = new ethers.Wallet(SIGNER_PK);
console.log('✅ Signer wallet:', wallet.address);

// ─── RPC provider (task #68 : verif on-chain burn tx pour username paid-change) ─
// Lazy init. Si POLYGON_RPC absent, /api/username/paid-change refusera avec 503.
const POLYGON_RPC  = process.env.POLYGON_RPC || '';
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD';
let rpcProvider = null;
function getProvider() {
  if (rpcProvider) return rpcProvider;
  if (!POLYGON_RPC) return null;
  try {
    rpcProvider = new ethers.JsonRpcProvider(POLYGON_RPC);
    console.log('✅ Polygon RPC provider ready');
    return rpcProvider;
  } catch (e) {
    console.warn('⚠️ RPC provider init failed:', e.message);
    return null;
  }
}

// ERC-20 Transfer event topic : keccak256("Transfer(address,address,uint256)")
const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

// ─── SnakeBoostNFT ABI (task #71) ────────────────────────────────────────────
// Minimal read-only ABI pour le backend. getActiveMultiplierBps est la source
// of truth: best permanent + best seasonal (stackés), retourne bps (200 = +2%).
const BOOST_NFT_ABI = [
  'function getActiveMultiplierBps(address wallet) view returns (uint16)',
  'function tiers(uint8 tier) view returns (uint256 priceUsd, uint256 snakeBurnAmount, uint16 multiplierBps, uint32 supplyCap, uint32 minted, bool active)',
  'function seasonal(uint32 id) view returns (string name, string emoji, uint256 priceUsd, uint256 snakeBurnAmount, uint16 multiplierBps, uint32 supplyCap, uint32 minted, uint64 openUntil, bool active)',
  'function getPolPrice(uint8 tier) view returns (uint256)',
  'function getSeasonalPolPrice(uint32 id) view returns (uint256)',
  'function currentSeasonalId() view returns (uint32)',
  'function getMaticUsdPrice() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function tokenMeta(uint256 tokenId) view returns (uint8 tier, uint32 seasonalId, uint64 mintedAt)',
  'event BoostMinted(address indexed wallet, uint256 indexed tokenId, uint8 tier, uint32 seasonalId, uint16 multiplierBps, uint8 paymentMode)',
];

// Lazy boost contract (evite init si BOOST_NFT_ADDRESS non set)
let boostContractReader = null;
function getBoostContract() {
  if (boostContractReader) return boostContractReader;
  if (!BOOST_NFT_ADDRESS) return null;
  const provider = getProvider();
  if (!provider) return null;
  try {
    boostContractReader = new ethers.Contract(BOOST_NFT_ADDRESS, BOOST_NFT_ABI, provider);
    console.log('✅ SnakeBoostNFT reader ready:', BOOST_NFT_ADDRESS);
    return boostContractReader;
  } catch (e) {
    console.warn('⚠️ Boost contract init failed:', e.message);
    return null;
  }
}

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

// ─── TWITCH IRC BOT (task #24, raw WebSocket) ────────────────────────────────
// Raw WebSocket vers irc-ws.chat.twitch.tv:443 (stack minimal, full error visibility)
// Env : TWITCH_CHANNEL, TWITCH_USERNAME, TWITCH_OAUTH (oauth:xxx)
const TWITCH_CHANNEL  = (process.env.TWITCH_CHANNEL  || '').toLowerCase().replace(/^#/, '');
const TWITCH_USERNAME = (process.env.TWITCH_USERNAME || '').toLowerCase();
const TWITCH_OAUTH    = process.env.TWITCH_OAUTH || '';
let twitchWs      = null;
let twitchReady   = false;
let twitchAttempt = 0;
const twitchQueue = [];
let twitchSendTokens = 15;
setInterval(() => { twitchSendTokens = Math.min(15, twitchSendTokens + 1); }, 2000);

function twitchSay(msg) {
  if (!twitchReady || !twitchWs) return false;
  try {
    twitchWs.send(`PRIVMSG #${TWITCH_CHANNEL} :${msg}\r\n`);
    return true;
  } catch (e) {
    console.log('🟣 twitch send err:', e.message);
    return false;
  }
}

function twitchNotify(message) {
  if (!TWITCH_CHANNEL) return;
  const m = String(message).slice(0, 480);
  if (twitchSendTokens <= 0) {
    if (twitchQueue.length < 30) twitchQueue.push(m);
    return;
  }
  twitchSendTokens--;
  if (!twitchSay(m) && twitchQueue.length < 30) twitchQueue.push(m);
}
setInterval(() => {
  while (twitchReady && twitchQueue.length && twitchSendTokens > 0) {
    twitchSendTokens--;
    const m = twitchQueue.shift();
    twitchSay(m);
  }
}, 2500);

function twitchConnect() {
  if (!TWITCH_CHANNEL || !TWITCH_USERNAME || !TWITCH_OAUTH) {
    console.log('🟣 Twitch bot disabled (set TWITCH_CHANNEL + TWITCH_USERNAME + TWITCH_OAUTH to enable)');
    return;
  }
  let WebSocket;
  try { WebSocket = require('ws'); }
  catch (e) { console.log('🟣 Twitch: `ws` module missing:', e.message); return; }

  const url = 'wss://irc-ws.chat.twitch.tv:443';
  console.log(`🟣 Twitch: connecting to ${url} as ${TWITCH_USERNAME} → #${TWITCH_CHANNEL} (attempt ${twitchAttempt + 1})`);
  try {
    twitchWs = new WebSocket(url, { handshakeTimeout: 15000 });
  } catch (e) {
    console.log('🟣 Twitch WS ctor error:', e.message);
    scheduleReconnect(); return;
  }

  twitchWs.on('open', () => {
    console.log('🟣 Twitch: WebSocket OPEN, authenticating...');
    // Twitch IRC capabilities + auth
    twitchWs.send('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
    twitchWs.send(`PASS ${TWITCH_OAUTH}\r\n`);
    twitchWs.send(`NICK ${TWITCH_USERNAME}\r\n`);
  });

  twitchWs.on('message', (data) => {
    const text = data.toString('utf-8');
    for (const line of text.split('\r\n')) {
      if (!line) continue;
      // Keepalive : PING :tmi.twitch.tv → PONG :tmi.twitch.tv
      if (line.startsWith('PING')) {
        twitchWs.send(line.replace('PING', 'PONG') + '\r\n');
        continue;
      }
      // Welcome message (001) = auth success → join channel
      if (line.includes(' 001 ')) {
        console.log(`🟣 Twitch: authenticated as ${TWITCH_USERNAME}, joining #${TWITCH_CHANNEL}`);
        twitchWs.send(`JOIN #${TWITCH_CHANNEL}\r\n`);
        continue;
      }
      // JOIN ack = we're in
      if (line.includes(` JOIN #${TWITCH_CHANNEL}`) && line.includes(TWITCH_USERNAME)) {
        twitchReady   = true;
        twitchAttempt = 0;
        console.log(`🟣 Twitch: joined #${TWITCH_CHANNEL} successfully ✅`);
        continue;
      }
      // Auth failed
      if (line.includes('NOTICE') && line.toLowerCase().includes('login')) {
        console.log('🟣 Twitch AUTH FAIL:', line.trim());
        continue;
      }
      // Parse PRIVMSG pour commandes !snake !top !stats !golden !score !quests
      const m = line.match(/^(?:@(\S+) )?:(\S+?)!\S+ PRIVMSG (#\S+) :(.*)$/);
      if (!m) continue;
      const [, tags, sender, chan, msg] = m;
      if (chan.toLowerCase() !== '#' + TWITCH_CHANNEL) continue;
      const txt = msg.trim();
      if (!txt.startsWith('!')) continue;
      const [cmdRaw, ...args] = txt.split(/\s+/);
      const cmd = cmdRaw.toLowerCase();
      try {
        if (cmd === '!snake') {
          twitchNotify('🐍 SnakeCoin Play-to-Earn → snowdiablo.xyz · earn $SNAKE on Polygon · discord.gg/snake');
        } else if (cmd === '!top') {
          const rows = db.prepare(`SELECT address, best_score FROM leaderboard ORDER BY best_score DESC LIMIT 3`).all();
          if (!rows.length) { twitchNotify('No scores yet 🐍'); }
          else {
            const str = rows.map((r, i) => `${i+1}. ${shortAddr(r.address)} → ${r.best_score}`).join(' | ');
            twitchNotify(`🏆 Top 3: ${str}`);
          }
        } else if (cmd === '!stats') {
          const totalClaims = db.prepare('SELECT COUNT(*) as c FROM claims').get().c;
          const totalPlayers = db.prepare('SELECT COUNT(DISTINCT address) as c FROM leaderboard').get().c;
          const totalSnake = db.prepare('SELECT COALESCE(SUM(total_claimed),0) as s FROM leaderboard').get().s;
          twitchNotify(`📊 ${totalPlayers} players · ${totalClaims} claims · ${totalSnake.toFixed(0)} SNAKE distributed`);
        } else if (cmd === '!golden') {
          const g = getGoldenState();
          if (g.active) {
            const remain = g.ends_at ? Math.floor((g.ends_at - Date.now()/1000) / 60) : -1;
            twitchNotify(`⚡ GOLDEN SNAKE ACTIVE x${g.multiplier}` + (remain > 0 ? ` · ${remain}min restantes` : ' · mode manuel'));
          } else {
            const nxt = g.next_start ? new Date(g.next_start * 1000).toUTCString().slice(5, 22) + ' UTC' : '?';
            twitchNotify(`⚡ Golden Snake inactif · next: ${nxt}`);
          }
        } else if (cmd === '!score') {
          const wallet = (args[0] || '').toLowerCase();
          if (!ethers.isAddress(wallet)) { twitchNotify(`@${sender} usage: !score 0x...`); return; }
          const row = db.prepare('SELECT best_score, games_played, total_claimed FROM leaderboard WHERE address=?').get(wallet);
          if (!row) { twitchNotify(`@${sender} ${shortAddr(wallet)} : no games played`); return; }
          twitchNotify(`📈 ${shortAddr(wallet)} → best ${row.best_score} · ${row.games_played} games · ${(row.total_claimed||0).toFixed(2)} SNAKE`);
        } else if (cmd === '!quests') {
          const wallet = (args[0] || '').toLowerCase();
          if (!ethers.isAddress(wallet)) { twitchNotify(`@${sender} usage: !quests 0x...`); return; }
          const q = computeQuestsForAddress(wallet);
          const summary = q.quests.map(x => `${x.icon}${x.progress}/${x.goal}${x.done ? '✓' : ''}`).join(' ');
          twitchNotify(`🎯 ${shortAddr(wallet)} quests: ${summary}` + (q.all_done ? ' · ALL DONE 🎉' : ''));
        }
      } catch (e) { console.log('🟣 twitch cmd err:', e.message); }
    }
  });

  twitchWs.on('error', (err) => {
    console.log(`🟣 Twitch WS ERROR (code=${err.code || '?'}): ${err.message}`);
  });

  twitchWs.on('close', (code, reason) => {
    const wasReady = twitchReady;
    twitchReady = false;
    console.log(`🟣 Twitch WS CLOSE code=${code} reason="${reason}" wasReady=${wasReady}`);
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  twitchAttempt++;
  const delayMs = Math.min(30000, 1000 * Math.pow(1.5, Math.min(twitchAttempt, 10)));
  console.log(`🟣 Twitch: reconnect in ${Math.round(delayMs/1000)}s (attempt #${twitchAttempt})`);
  setTimeout(twitchConnect, delayMs);
}

// Bootstrap
twitchConnect();

// ─── BLUESKY AUTO-POST (task #25) ────────────────────────────────────────────
// AT Protocol via fetch natif (Node 18+), pas de dep externe.
// Auto-post : nouveau record all-time, whale alerts (cumul >=500), golden events.
// Env : BSKY_HANDLE (ex snowdiablo.bsky.social), BSKY_APP_PASSWORD (genere sur bsky.app settings).
const BSKY_HANDLE       = process.env.BSKY_HANDLE       || '';
const BSKY_APP_PASSWORD = process.env.BSKY_APP_PASSWORD || '';
const BSKY_PDS          = 'https://bsky.social';
const BSKY_MIN_INTERVAL = 5 * 60 * 1000;  // 5min entre posts (anti-spam)
let bskySession = null;      // { accessJwt, refreshJwt, did, exp }
let bskyLastPost = 0;
const bskyQueue = [];
let bskyPosting = false;

async function bskyAuth() {
  if (!BSKY_HANDLE || !BSKY_APP_PASSWORD) return null;
  // Session cache : valide ~2h, renouvele apres 1h30 par securite
  if (bskySession && Date.now() < bskySession.exp) return bskySession;
  try {
    const r = await fetch(`${BSKY_PDS}/xrpc/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: BSKY_HANDLE, password: BSKY_APP_PASSWORD }),
    });
    if (!r.ok) throw new Error(`createSession ${r.status}: ${await r.text()}`);
    const d = await r.json();
    bskySession = { accessJwt: d.accessJwt, refreshJwt: d.refreshJwt, did: d.did, exp: Date.now() + 90 * 60 * 1000 };
    console.log(`🦋 Bluesky: session ready for ${d.handle} (did=${d.did.slice(0, 24)}...)`);
    return bskySession;
  } catch (e) {
    console.log('🦋 Bluesky auth failed:', e.message);
    bskySession = null;
    return null;
  }
}

// Detecte les URLs dans un texte et construit les facets pour les rendre clickables.
function bskyBuildFacets(text) {
  const facets = [];
  const regex = /https?:\/\/[^\s)]+/g;
  const enc = new TextEncoder();
  let m;
  while ((m = regex.exec(text)) !== null) {
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    const byteEnd   = enc.encode(text.slice(0, m.index + m[0].length)).length;
    facets.push({
      index: { byteStart, byteEnd },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }],
    });
  }
  return facets;
}

async function bskyPostNow(text) {
  const sess = await bskyAuth();
  if (!sess) return { ok: false, error: 'no session' };
  try {
    const record = {
      $type: 'app.bsky.feed.post',
      text: text.slice(0, 300),       // bluesky limit 300 chars
      createdAt: new Date().toISOString(),
      langs: ['fr', 'en'],
      facets: bskyBuildFacets(text),
    };
    const r = await fetch(`${BSKY_PDS}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sess.accessJwt}` },
      body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record }),
    });
    if (!r.ok) {
      const body = await r.text();
      // 401 = token expired, retry une fois
      if (r.status === 401) { bskySession = null; return await bskyPostNow(text); }
      throw new Error(`createRecord ${r.status}: ${body}`);
    }
    const d = await r.json();
    console.log(`🦋 Bluesky: posted → ${d.uri}`);
    bskyLastPost = Date.now();
    return { ok: true, uri: d.uri, cid: d.cid };
  } catch (e) {
    console.log('🦋 Bluesky post failed:', e.message);
    return { ok: false, error: e.message };
  }
}

function bskyNotify(text) {
  if (!BSKY_HANDLE || !BSKY_APP_PASSWORD) return;
  // Rate-limit : 5min mini entre posts
  const wait = bskyLastPost + BSKY_MIN_INTERVAL - Date.now();
  if (wait > 0) {
    if (bskyQueue.length < 10) bskyQueue.push(text);
    return;
  }
  if (bskyPosting) {
    if (bskyQueue.length < 10) bskyQueue.push(text);
    return;
  }
  bskyPosting = true;
  bskyPostNow(text).finally(() => { bskyPosting = false; });
}

// Drain queue toutes les 30s si le cooldown est expire
setInterval(() => {
  if (!bskyQueue.length || bskyPosting) return;
  if (Date.now() < bskyLastPost + BSKY_MIN_INTERVAL) return;
  const msg = bskyQueue.shift();
  bskyPosting = true;
  bskyPostNow(msg).finally(() => { bskyPosting = false; });
}, 30000);

if (BSKY_HANDLE && BSKY_APP_PASSWORD) {
  bskyAuth().then(s => { if (s) console.log('🦋 Bluesky bot enabled →', BSKY_HANDLE); });
} else {
  console.log('🦋 Bluesky disabled (set BSKY_HANDLE + BSKY_APP_PASSWORD to enable)');
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

// ─── NFT TROPHY MULTIPLIER (Task #46) ────────────────────────────────────────
// Lit le rank le + élevé minté pour ce wallet (toutes saisons confondues, status='minted')
// → applique le multiplier permanent : Gold +25 / Silver +15 / Bronze +10 / Top10 +5
// Source de vérité = nft_drops (sync par /api/nft/confirm + cron on-chain scan futur).
// Stateless DB read → pas d'appel RPC dans le hot-path /api/session/end.
function getNftTier(addr) {
  if (!addr) return { tier: null, rank: null, multiplier: 1.0, bonus_pct: 0 };
  const a = addr.toLowerCase();
  const row = db.prepare(`
    SELECT MIN(rank) AS best_rank
    FROM nft_drops
    WHERE address = ? AND status = 'minted'
  `).get(a);
  const rank = row && row.best_rank != null ? row.best_rank : null;
  if (rank === null) return { tier: null, rank: null, multiplier: 1.0, bonus_pct: 0 };
  if (rank === 1) return { tier: 'Gold',   rank, multiplier: 1.25, bonus_pct: 25 };
  if (rank === 2) return { tier: 'Silver', rank, multiplier: 1.15, bonus_pct: 15 };
  if (rank === 3) return { tier: 'Bronze', rank, multiplier: 1.10, bonus_pct: 10 };
  return            { tier: 'Top10',  rank, multiplier: 1.05, bonus_pct: 5  };
}
function nftMultiplier(addr) { return getNftTier(addr).multiplier; }

// ─── NFT BOOST MULTIPLIER (Task #71) ─────────────────────────────────────────
// Lecture SYNC depuis la table boost_mult_cache (hot path /api/session/end).
// Le cache est rafraîchi :
//   - async au démarrage + via endpoint /api/boost/multiplier/:addr
//   - par cron toutes les 10 min pour wallets actifs
// Retourne { bps, multiplier, stale, age_sec } — jamais null.
// Si BOOST_NFT_ADDRESS absent → tout le monde = 1.0x (no-op gracieux).
const BOOST_CACHE_TTL_SEC = parseInt(process.env.BOOST_CACHE_TTL_SEC || '900', 10); // 15 min warn threshold

function getBoostMultFromCache(addr) {
  if (!addr || !BOOST_NFT_ADDRESS) {
    return { bps: 0, multiplier: 1.0, stale: false, age_sec: 0, cached: false };
  }
  const a = addr.toLowerCase();
  const row = db.prepare('SELECT bps, updated_at FROM boost_mult_cache WHERE wallet = ?').get(a);
  if (!row) return { bps: 0, multiplier: 1.0, stale: true, age_sec: null, cached: false };
  const nowSec = Math.floor(Date.now() / 1000);
  const age = nowSec - row.updated_at;
  const mult = 1 + (row.bps / 10000);
  return { bps: row.bps, multiplier: mult, stale: age > BOOST_CACHE_TTL_SEC, age_sec: age, cached: true };
}

function boostMultiplier(addr) { return getBoostMultFromCache(addr).multiplier; }

// Refresh ASYNC via RPC (non bloquant hot path).
// Fire-and-forget : si échec, garde la valeur cache précédente.
async function refreshBoostMultFor(addr) {
  if (!addr) return null;
  const contract = getBoostContract();
  if (!contract) return null;
  const a = addr.toLowerCase();
  try {
    const bpsRaw = await contract.getActiveMultiplierBps(a);
    const bps = Number(bpsRaw);
    if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
      console.warn('⚠️ Boost bps out of range for', a, ':', bps);
      return null;
    }
    db.prepare(`
      INSERT INTO boost_mult_cache (wallet, bps, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET bps = excluded.bps, updated_at = excluded.updated_at
    `).run(a, bps, Math.floor(Date.now() / 1000));
    return bps;
  } catch (e) {
    console.warn('⚠️ refreshBoostMultFor', a, ':', e.message);
    return null;
  }
}

// Catalog fetch : 3 tiers permanents + seasonal courant. Cached en mémoire 5 min.
let boostCatalogCache = null;
let boostCatalogExpiry = 0;
const BOOST_CATALOG_TTL_MS = 5 * 60 * 1000;

async function getBoostCatalog() {
  const nowMs = Date.now();
  if (boostCatalogCache && nowMs < boostCatalogExpiry) return boostCatalogCache;
  const contract = getBoostContract();
  if (!contract) return { available: false, tiers: [], seasonal: null };

  const TIER_NAMES = { 1: 'Basic', 2: 'Pro', 3: 'Elite' };
  const out = { available: true, contract: BOOST_NFT_ADDRESS, tiers: [], seasonal: null };
  try {
    // Tiers 1..3 (Basic/Pro/Elite). Tier 0 = None, 4 = Seasonal (exclus)
    for (let t = 1; t <= 3; t++) {
      const cfg = await contract.tiers(t);
      let polPrice = null;
      try { polPrice = (await contract.getPolPrice(t)).toString(); } catch(_) {}
      out.tiers.push({
        id: t,
        name: TIER_NAMES[t] || `Tier${t}`,
        price_usd_1e8: cfg[0].toString(),        // 1e8 USD (Chainlink format)
        snake_burn_wei: cfg[1].toString(),       // wei ($SNAKE)
        multiplier_bps: Number(cfg[2]),
        supply_cap: Number(cfg[3]),
        minted: Number(cfg[4]),
        active: cfg[5],
        pol_price_wei: polPrice,
      });
    }
    // Seasonal courant (peut ne pas exister)
    try {
      const currId = Number(await contract.currentSeasonalId());
      if (currId > 0) {
        const s = await contract.seasonal(currId);
        let polPrice = null;
        try { polPrice = (await contract.getSeasonalPolPrice(currId)).toString(); } catch(_) {}
        out.seasonal = {
          id: currId,
          name: s[0],
          emoji: s[1],
          price_usd_1e8: s[2].toString(),
          snake_burn_wei: s[3].toString(),
          multiplier_bps: Number(s[4]),
          supply_cap: Number(s[5]),
          minted: Number(s[6]),
          open_until: Number(s[7]),
          active: s[8],
          pol_price_wei: polPrice,
        };
      }
    } catch (e) {
      // Pas de seasonal actif → ignore
    }
    boostCatalogCache = out;
    boostCatalogExpiry = nowMs + BOOST_CATALOG_TTL_MS;
    return out;
  } catch (e) {
    console.warn('⚠️ getBoostCatalog failed:', e.message);
    return { available: false, error: e.message, tiers: [], seasonal: null };
  }
}

// ─── TOURNAMENTS 24h (task #69) ──────────────────────────────────────────────
// Design : fenêtre rolling 24h, une seule "open" à la fois. Entry = POL tx on-chain
// vers TOURNAMENT_PAYOUT_WALLET. Score = best_score mis à jour pendant la fenêtre.
// Payout : 40 / 20 / 10 % via signer wallet (ethers.Wallet → sendTransaction).
// Les 30% restants restent projet dans le payout_wallet.

function _parsePolToWei(polStr) {
  // Accepte "1", "1.0", "0.5". Retourne BigInt.
  try { return ethers.parseEther(String(polStr)); }
  catch (_) { return 10n ** 18n; } // fallback = 1 POL
}

const TOURNAMENT_ENTRY_WEI = _parsePolToWei(TOURNAMENT_ENTRY_POL);
const TOURNAMENT_PROJECT_CUT_BPS = 3000; // 30% projet, 70% winners
const TOURNAMENT_WINNERS_BPS = [4000, 2000, 1000]; // 40/20/10

function getCurrentTournament() {
  const nowSec = Math.floor(Date.now() / 1000);
  const row = db.prepare(`
    SELECT * FROM tournaments
    WHERE status = 'open' AND end_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(nowSec);
  return row || null;
}

function ensureTournamentOpen() {
  if (!TOURNAMENT_ENABLED) return null;
  let t = getCurrentTournament();
  if (t) return t;
  // Pas de tournoi actif → en ouvrir un neuf 24h
  const nowSec = Math.floor(Date.now() / 1000);
  const endSec = nowSec + (TOURNAMENT_DURATION_H * 3600);
  const info = db.prepare(`
    INSERT INTO tournaments (start_at, end_at, status, entry_fee_wei, prize_pool_wei)
    VALUES (?, ?, 'open', ?, '0')
  `).run(nowSec, endSec, TOURNAMENT_ENTRY_WEI.toString());
  console.log(`🏆 Tournament #${info.lastInsertRowid} opened (ends in ${TOURNAMENT_DURATION_H}h)`);
  return getCurrentTournament();
}

function registerTournamentScore(wallet, score) {
  if (!TOURNAMENT_ENABLED) return null;
  if (!wallet || !Number.isFinite(score) || score <= 0) return null;
  const addr = String(wallet).toLowerCase();
  const t = getCurrentTournament();
  if (!t) return null;
  const existing = db.prepare(`
    SELECT wallet, best_score FROM tournament_entries
    WHERE tournament_id = ? AND wallet = ?
  `).get(t.id, addr);
  if (!existing) return null; // wallet pas inscrit → ignore
  const newBest = Math.max(existing.best_score || 0, Math.floor(score));
  db.prepare(`
    UPDATE tournament_entries
       SET best_score = ?, games_played = games_played + 1, updated_at = strftime('%s','now')
     WHERE tournament_id = ? AND wallet = ?
  `).run(newBest, t.id, addr);
  return { tournament_id: t.id, best_score: newBest, improved: newBest > (existing.best_score || 0) };
}

function getTournamentRank(tournamentId, wallet) {
  if (!tournamentId || !wallet) return null;
  const addr = String(wallet).toLowerCase();
  const row = db.prepare(`
    SELECT wallet, best_score,
           (SELECT COUNT(*) FROM tournament_entries te2
             WHERE te2.tournament_id = te.tournament_id
               AND te2.best_score > te.best_score) + 1 AS rank
      FROM tournament_entries te
     WHERE tournament_id = ? AND wallet = ?
  `).get(tournamentId, addr);
  return row || null;
}

function getTournamentLeaderboard(tournamentId, limit = 20) {
  if (CLAN_ENABLED) {
    return db.prepare(`
      SELECT te.wallet, te.best_score, te.games_played, te.paid_at, te.updated_at,
             c.tag AS clan_tag, c.name AS clan_name, c.id AS clan_id
        FROM tournament_entries te
        LEFT JOIN clan_members cm ON cm.wallet = te.wallet
        LEFT JOIN clans c ON c.id = cm.clan_id AND c.active = 1
       WHERE te.tournament_id = ?
       ORDER BY te.best_score DESC, te.paid_at ASC
       LIMIT ?
    `).all(tournamentId, limit);
  }
  return db.prepare(`
    SELECT wallet, best_score, games_played, paid_at, updated_at
      FROM tournament_entries
     WHERE tournament_id = ?
     ORDER BY best_score DESC, paid_at ASC
     LIMIT ?
  `).all(tournamentId, limit);
}

// ─── CLANS / GUILDES (task #70) ──────────────────────────────────────────────
// Validation name 3-20 chars, alphanum + underscore + space. Tag 2-6 alphanum.
function validateClanName(name) {
  if (typeof name !== 'string') return { ok: false, error: 'name_required' };
  const trimmed = name.trim();
  if (trimmed.length < 3 || trimmed.length > 20) return { ok: false, error: 'name_length_3_20' };
  if (!/^[A-Za-z0-9_ ]+$/.test(trimmed)) return { ok: false, error: 'name_chars_alphanum_underscore_space' };
  return { ok: true, name: trimmed };
}

function validateClanTag(tag) {
  if (typeof tag !== 'string') return { ok: false, error: 'tag_required' };
  const up = tag.trim().toUpperCase();
  if (up.length < 2 || up.length > 6) return { ok: false, error: 'tag_length_2_6' };
  if (!/^[A-Z0-9]+$/.test(up)) return { ok: false, error: 'tag_chars_alphanum' };
  return { ok: true, tag: up };
}

function getClanOfWallet(wallet) {
  const addr = String(wallet || '').toLowerCase();
  if (!addr) return null;
  return db.prepare(`
    SELECT c.id, c.name, c.tag, c.owner, c.created_at, cm.role, cm.joined_at
      FROM clan_members cm
      JOIN clans c ON c.id = cm.clan_id
     WHERE cm.wallet = ? AND c.active = 1
  `).get(addr) || null;
}

function countClanMembers(clanId) {
  const r = db.prepare('SELECT COUNT(*) AS c FROM clan_members WHERE clan_id = ?').get(clanId);
  return r?.c || 0;
}

function listClans(limit = 50) {
  return db.prepare(`
    SELECT c.id, c.name, c.tag, c.owner, c.created_at,
           (SELECT COUNT(*) FROM clan_members cm WHERE cm.clan_id = c.id) AS members
      FROM clans c
     WHERE c.active = 1
     ORDER BY members DESC, c.created_at ASC
     LIMIT ?
  `).all(limit);
}

function getClanById(clanId) {
  const c = db.prepare(`SELECT * FROM clans WHERE id = ? AND active = 1`).get(clanId);
  if (!c) return null;
  const members = db.prepare(`
    SELECT cm.wallet, cm.role, cm.joined_at,
           COALESCE(lb.max_score, 0) AS best_score,
           COALESCE(lb.games_played, 0) AS games_played
      FROM clan_members cm
      LEFT JOIN leaderboard lb ON lb.address = cm.wallet
     WHERE cm.clan_id = ?
     ORDER BY cm.role DESC, cm.joined_at ASC
  `).all(clanId);
  return { ...c, members };
}

// Vérif on-chain du burn pour création clan (réplique pattern #68).
// Accepte SOIT transfer vers BURN_ADDRESS (legacy) SOIT transfer vers CLAN_FEE_WALLET (royalty mode).
async function verifyClanCreateBurn(provider, txHash, fromWallet) {
  const rcpt = await provider.getTransactionReceipt(txHash);
  if (!rcpt) return { ok: false, error: 'tx_not_found' };
  if (rcpt.status !== 1) return { ok: false, error: 'tx_failed_on_chain' };
  const snakeAddrLc = (CONTRACT_ADDRESS || '').toLowerCase();
  const burnTopic   = '0x000000000000000000000000' + BURN_ADDRESS.slice(2).toLowerCase();
  const feeTopic    = CLAN_FEE_WALLET ? '0x000000000000000000000000' + CLAN_FEE_WALLET.slice(2) : null;
  const fromTopic   = '0x000000000000000000000000' + String(fromWallet).slice(2).toLowerCase();
  const requiredWei = ethers.parseUnits(CLAN_CREATE_BURN_AMOUNT, 18);
  let burned = 0n;
  let feePaid = 0n;
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() !== snakeAddrLc) continue;
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    if (log.topics[1].toLowerCase() !== fromTopic) continue;
    const toTopic = log.topics[2].toLowerCase();
    if (toTopic === burnTopic) {
      burned += BigInt(log.data);
    } else if (feeTopic && toTopic === feeTopic) {
      feePaid += BigInt(log.data);
    }
    // Accept si burn>=required OU fee>=required OU (burn+fee)>=required
    if (burned + feePaid >= requiredWei) return { ok: true, burned, feePaid };
  }
  return { ok: false, error: 'burn_not_found', burned, feePaid };
}

// ─── GOLDEN SNAKE MODE (task #20) ────────────────────────────────────────────
// Auto-window : samedi 20h UTC → dimanche 20h UTC (24h), x3 rewards.
// Override manuel via /api/admin/events/golden/toggle.
const GOLDEN_MULTIPLIER   = 3.0;
const GOLDEN_DAY_UTC      = 6;   // 0=dimanche, 6=samedi
const GOLDEN_HOUR_UTC     = 20;  // 20h UTC start
const GOLDEN_DURATION_H   = 24;

function isInAutoGoldenWindow(now = new Date()) {
  // Compute last saturday 20:00 UTC (start of current weekly window)
  const n = new Date(now);
  const day = n.getUTCDay();
  // offset days back to last saturday
  const daysBack = (day - GOLDEN_DAY_UTC + 7) % 7;
  const start = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - daysBack, GOLDEN_HOUR_UTC, 0, 0));
  const end   = new Date(start.getTime() + GOLDEN_DURATION_H * 3600 * 1000);
  return { in_window: now >= start && now < end, start, end };
}

function getGoldenState() {
  // 1) manual override = row type='golden' with ended_at IS NULL
  const manual = db.prepare(`SELECT * FROM events WHERE type='golden' AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).get();
  if (manual) {
    return {
      active: true,
      multiplier: manual.multiplier,
      mode: 'manual',
      started_at: manual.started_at,
      ends_at: null,
      reason: manual.reason,
    };
  }
  // 2) auto weekly window
  const now = new Date();
  const w = isInAutoGoldenWindow(now);
  if (w.in_window) {
    return {
      active: true,
      multiplier: GOLDEN_MULTIPLIER,
      mode: 'auto',
      started_at: Math.floor(w.start.getTime() / 1000),
      ends_at:    Math.floor(w.end.getTime()   / 1000),
      reason: 'weekly',
    };
  }
  // 3) inactive → next window
  // compute next saturday 20h UTC
  const nxt = new Date(now);
  const day = nxt.getUTCDay();
  const daysAhead = (GOLDEN_DAY_UTC - day + 7) % 7 || (nxt.getUTCHours() < GOLDEN_HOUR_UTC ? 0 : 7);
  nxt.setUTCDate(nxt.getUTCDate() + daysAhead);
  nxt.setUTCHours(GOLDEN_HOUR_UTC, 0, 0, 0);
  return {
    active: false,
    multiplier: 1.0,
    mode: 'inactive',
    next_start: Math.floor(nxt.getTime() / 1000),
  };
}

// Bootstrap : log state au demarrage + Discord notify si auto active
(() => {
  const g = getGoldenState();
  if (g.active) console.log(`⚡ GOLDEN SNAKE active (${g.mode}) - multiplier x${g.multiplier}`);
  else console.log(`⚡ Golden snake inactive - next window: ${new Date((g.next_start||0)*1000).toISOString()}`);
})();

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

// Limiter public pour endpoints GET lourds (lecture DB) — 60 req/min/IP
// Évite scraping abusif de /api/nft/eligibility & /api/nft/multiplier
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requêtes (60/min).' }
});

// Limiter spécifique pour les endpoints "challenge" (préparation proof)
const proofLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Trop de demandes de challenge.' }
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  // Healthcheck "profond" : pas juste un 200 bête. On ping la DB + on renvoie
  // du signal exploitable par Uptime Kuma (last_check_ms, db_ok). Si la DB
  // tombe ou le volume Railway est détaché, on retourne 503 pour que l'alerte
  // se déclenche au lieu d'un faux-positif vert.
  const t0 = Date.now();
  let dbOk = false;
  try {
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch (e) {
    console.error('❌ /health DB ping failed:', e.message);
  }
  const payload = {
    status : dbOk ? 'ok' : 'degraded',
    signer : wallet.address,
    db_ok  : dbOk,
    latency_ms: Date.now() - t0,
    uptime_s: Math.floor(process.uptime()),
    ts     : Math.floor(Date.now() / 1000),
  };
  res.status(dbOk ? 200 : 503).json(payload);
});

// ─── WALLET PROOF CHALLENGE (task #56) ────────────────────────────────────────
// Retourne un message déterministe à signer côté wallet pour prouver ownership.
// Le client appelle /api/proof/challenge?action=Claim&address=0x...
// → signe message côté wallet → renvoie { ts, nonce, signature } dans payload
// des routes protégées (/api/claim, /api/nft/mint-sig).
app.get('/api/proof/challenge', proofLimiter, (req, res) => {
  const action  = String(req.query.action || '').replace(/[^A-Za-z]/g, '').slice(0, 32);
  const address = String(req.query.address || '');
  const ALLOWED = new Set(['Claim', 'MintTrophy', 'LinkDiscord', 'SetUsername', 'BurnUsername']);
  if (!ALLOWED.has(action)) {
    return res.status(400).json({ error: 'action invalide (Claim|MintTrophy|LinkDiscord|SetUsername|BurnUsername)' });
  }
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  const ts    = Math.floor(Date.now() / 1000);
  const nonce = ethers.hexlify(ethers.randomBytes(12)); // 24 hex chars
  const message = buildProofMessage(action, address, ts, nonce);
  res.json({ action, address: address.toLowerCase(), ts, nonce, message, max_age_sec: PROOF_MAX_AGE_SEC });
});

app.post('/api/session/start', (req, res) => {
  const { address, game } = req.body;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse wallet invalide' });
  }
  const addr = address.toLowerCase();
  // Phase 4 : multi-games. Default 'snake' pour backward compat.
  const gameName = normalizeGame(game);

  // Anti-spam : rejette si session créée il y a < MIN_SESSION_GAP sec (scope au game)
  const lastSession = db.prepare(
    'SELECT created_at FROM sessions WHERE address=? AND game=? ORDER BY created_at DESC LIMIT 1'
  ).get(addr, gameName);
  if (lastSession) {
    const gap = Math.floor(Date.now()/1000) - lastSession.created_at;
    if (gap < MIN_SESSION_GAP) {
      return res.status(429).json({ error: `Attends ${MIN_SESSION_GAP - gap}s avant nouvelle session` });
    }
  }

  const sessionId = ethers.hexlify(ethers.randomBytes(16));
  db.prepare(`INSERT INTO sessions (id, address, game, score, reward) VALUES (?, ?, ?, 0, 0)`)
    .run(sessionId, addr, gameName);
  res.json({ sessionId, game: gameName });
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
    console.warn(`[CHEAT] ${shortAddr(session.address)} score=${cappedScore} duration=${duration}s`);
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
    console.warn(`[CHEAT] ${shortAddr(session.address)} ratio=${ratio.toFixed(2)} pts/sec`);
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
  const sessionGame = normalizeGame(session.game);
  const streakRow = db.prepare(
    'SELECT streak_count, max_streak, last_streak_date FROM leaderboard WHERE address=? AND game=?'
  ).get(addr, sessionGame);
  const prevStreak     = streakRow ? (streakRow.streak_count || 0) : 0;
  const prevMaxStreak  = streakRow ? (streakRow.max_streak   || 0) : 0;
  const lastStreakDate = streakRow ? streakRow.last_streak_date    : null;

  // Only advance streak on valid scoring sessions (anti-cheat already passed)
  const newStreak    = cappedScore > 0 ? computeStreak(prevStreak, lastStreakDate, today) : prevStreak;
  const newMaxStreak = Math.max(prevMaxStreak, newStreak);
  const multiplier   = streakMultiplier(newStreak);

  // Base reward + streak multiplier + golden snake multiplier (task #20) + NFT trophy multiplier (task #46) + NFT boost multiplier (task #71)
  const goldenState = getGoldenState();
  const goldenMult  = goldenState.active ? goldenState.multiplier : 1.0;
  const nftTier     = getNftTier(addr);
  const nftMult     = nftTier.multiplier;
  const boostInfo   = getBoostMultFromCache(addr);
  const boostMult   = boostInfo.multiplier;
  // Async refresh en fond si cache manquant/stale (non bloquant pour hot path)
  if (BOOST_NFT_ADDRESS && (!boostInfo.cached || boostInfo.stale)) {
    refreshBoostMultFor(addr).catch(() => {});
  }
  // Ratio pts→$SNAKE PAR JEU (task #130). Voir GAME_REWARD_DIVISORS ligne ~260.
  // Précision 2 décimales pour que les petits boost (+2%, +4%) soient visibles.
  // Sans cette précision, le double Math.floor écrasait tout boost < +10% pour score < 500.
  const divisor         = getRewardDivisor(sessionGame);
  const baseRewardFloat = cappedScore / divisor;
  const rewardFloat     = baseRewardFloat * multiplier * goldenMult * nftMult * boostMult;
  // Arrondi DOWN à 2 décimales (évite que le signer paye plus que calculé)
  const reward          = Math.min(Math.floor(rewardFloat * 100) / 100, MAX_PER_SESSION);

  db.prepare('UPDATE sessions SET score=?, reward=?, validated=1 WHERE id=?')
    .run(cappedScore, reward, sessionId);

  // Snapshot pré-update pour détecter records + milestones (scope au game de la session)
  const prevRow = db.prepare('SELECT best_score, games_played FROM leaderboard WHERE address=? AND game=?').get(addr, sessionGame);
  const prevBest  = prevRow ? prevRow.best_score  : 0;
  const prevGames = prevRow ? prevRow.games_played : 0;
  const allTimeMax = db.prepare('SELECT COALESCE(MAX(best_score),0) as m FROM leaderboard WHERE game=?').get(sessionGame).m;

  // ─── Task #25 : Bluesky auto-post si new all-time record ─────────────────
  if (cappedScore > allTimeMax && allTimeMax > 0) {
    bskyNotify(`🐍 NEW ALL-TIME RECORD on SnakeCoin! ${shortAddr(addr)} just scored ${cappedScore}. Can you beat it? https://snowdiablo.xyz #SnakeCoin #P2E #Polygon`);
  }

  db.prepare(`
    INSERT INTO leaderboard (address, game, best_score, games_played, last_played, updated_at,
                             streak_count, max_streak, last_streak_date)
    VALUES (?, ?, ?, 1, strftime('%s','now'), strftime('%s','now'), ?, ?, ?)
    ON CONFLICT(address, game) DO UPDATE SET
      best_score       = MAX(best_score, excluded.best_score),
      games_played     = games_played + 1,
      last_played      = excluded.last_played,
      updated_at       = excluded.updated_at,
      streak_count     = excluded.streak_count,
      max_streak       = excluded.max_streak,
      last_streak_date = excluded.last_streak_date
  `).run(addr, sessionGame, cappedScore, newStreak, newMaxStreak, cappedScore > 0 ? today : lastStreakDate);

  db.prepare('INSERT INTO score_history (address, game, score) VALUES (?, ?, ?)')
    .run(addr, sessionGame, cappedScore);

  // ─── TOURNAMENT score tracking (task #69) ───────────────────────────────────
  // Fire-and-forget sync: si wallet inscrit au tournoi en cours, update best_score.
  let tournamentBlock = null;
  if (TOURNAMENT_ENABLED && cappedScore > 0) {
    try {
      const upd = registerTournamentScore(addr, cappedScore);
      if (upd) {
        const rk = getTournamentRank(upd.tournament_id, addr);
        const tCur = db.prepare('SELECT end_at FROM tournaments WHERE id = ?').get(upd.tournament_id);
        tournamentBlock = {
          id:            upd.tournament_id,
          best_score:    upd.best_score,
          rank:          rk?.rank || null,
          improved:      upd.improved,
          time_left_sec: tCur ? Math.max(0, tCur.end_at - Math.floor(Date.now() / 1000)) : 0,
        };
      }
    } catch (e) {
      console.warn('[TOURNAMENT] score tracking failed:', e.message);
    }
  }

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
    twitchNotify(`🔥 ${shortAddr(addr)} is on a ${streakMilestone}-day streak!` + (streakMilestone >= 30 ? ' LEGEND STATUS 👑' : ''));
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
    golden_active: goldenState.active,
    golden_multiplier: goldenMult,
    streak: {
      current:    newStreak,
      max:        newMaxStreak,
      multiplier: multiplier,
      milestone:  streakMilestone || null,
    },
    nft: {
      tier:       nftTier.tier,        // 'Gold' | 'Silver' | 'Bronze' | 'Top10' | null
      rank:       nftTier.rank,        // 1..10 ou null
      multiplier: nftMult,             // 1.0 | 1.05 | 1.10 | 1.15 | 1.25
      bonus_pct:  nftTier.bonus_pct,   // 0 | 5 | 10 | 15 | 25
    },
    boost: {
      bps:        boostInfo.bps,       // 0..10000
      multiplier: boostMult,           // 1.0 | 1.02 | 1.04 | 1.08 | ...
      bonus_pct:  boostInfo.bps / 100, // 0 | 2 | 4 | 8 | ...
      stale:      boostInfo.stale,     // true si cache > TTL
      cached:     boostInfo.cached,
    },
    tournament: tournamentBlock,
  });
});

app.post('/api/claim', limiter, async (req, res) => {
  const { address, sessionId, proof } = req.body;

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  if (!CONTRACT_ADDRESS) {
    return res.status(503).json({ error: 'Contrat non configuré' });
  }

  // ─── EIP-191 ownership proof (task #56) ─────────────────────────────────
  // En mode enforce : rejet si proof absente/invalide.
  // En mode warn : log si absente (permet rollout progressif sans breaking).
  if (proof || REQUIRE_WALLET_PROOF) {
    const v = verifyWalletProof('Claim', address, proof);
    if (!v.ok) {
      if (REQUIRE_WALLET_PROOF) {
        return res.status(401).json({ error: `Proof wallet : ${v.error}` });
      }
      console.warn(`[CLAIM] proof invalide pour ${shortAddr(address)} : ${v.error}`);
    }
  } else {
    console.warn(`[CLAIM] ${shortAddr(address)} sans proof EIP-191 (legacy path)`);
  }

  const addr = address.toLowerCase();

  // ─── Diag granulaire (fix "Session invalide ou non terminée" trop vague) ──
  // Sans ça, impossible de distinguer : sessionId inconnu, wrong wallet,
  // anti-cheat validated=1 reward=0, ou session déjà consommée.
  const rawSession = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (!rawSession) {
    console.warn(`[CLAIM] session inconnue sessionId=${sessionId} addr=${shortAddr(addr)}`);
    return res.status(400).json({ error: 'Session introuvable (démarre une nouvelle partie)' });
  }
  if (rawSession.address !== addr) {
    console.warn(`[CLAIM] wallet mismatch sessionAddr=${shortAddr(rawSession.address)} claimAddr=${shortAddr(addr)}`);
    return res.status(400).json({ error: 'Wallet différent de celui qui a joué la session' });
  }
  if (!rawSession.validated) {
    console.warn(`[CLAIM] session non validée sessionId=${sessionId} addr=${shortAddr(addr)}`);
    return res.status(400).json({ error: 'Session non terminée (finis la partie avant de claim)' });
  }
  if (rawSession.reward <= 0) {
    console.warn(`[CLAIM] reward=0 sessionId=${sessionId} addr=${shortAddr(addr)} score=${rawSession.score}`);
    return res.status(400).json({ error: 'Pas assez de points (min 10) ou session rejetée par anti-cheat' });
  }

  const session = rawSession;

  // ─── Idempotence : si la signature a déjà été émise pour cette session,
  // la re-renvoyer telle quelle. Le contract va la rejeter si le nonce a
  // déjà été consommé on-chain, sinon le retry marchera. Pas de double-mint
  // possible (le contract a sa propre protection used[nonce]).
  if (session.claim_nonce && session.claim_sig && session.claim_amount) {
    console.log(`[CLAIM] replay sig pour session=${sessionId} addr=${shortAddr(addr)} amount=${session.reward}`);
    return res.json({
      amount: session.claim_amount,
      nonce: session.claim_nonce,
      sig: session.claim_sig,
      reward: session.reward,
      replay: true,
    });
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

  // Le contract DÉPLOYÉ (SnakeToken v.prod) utilise keccak256(abi.encode(...)) NON-packed
  // (anti-collision hash — voir commentaire "Fix #1" dans le contract source sur Polygonscan).
  // → DOIT utiliser AbiCoder.defaultAbiCoder().encode (= abi.encode Solidity), PAS solidityPacked.
  // Layout non-packed : 4 × 32 bytes = 128 bytes (chaque param padded à 32 bytes).
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'address'],
    [address, amount, nonce, CONTRACT_ADDRESS]
  );
  const hash = ethers.keccak256(encoded);
  const sig  = await wallet.signMessage(ethers.getBytes(hash));

  console.log(`[CLAIM] issue sig addr=${shortAddr(addr)} reward=${session.reward} nonce=${nonce.slice(0,10)}...`);

  db.prepare('INSERT INTO claims (nonce, address, amount) VALUES (?,?,?)')
    .run(nonce, addr, amount.toString());

  db.prepare(`
    INSERT INTO daily_claims (address, day, total) VALUES (?,?,?)
    ON CONFLICT(address, day) DO UPDATE SET total = total + ?
  `).run(addr, today, session.reward, session.reward);

  // FIX race condition : on NE SUPPRIME PAS la session avant confirmation on-chain.
  // On stocke la sig pour pouvoir la re-renvoyer si retry. Double-mint bloqué par
  // used[nonce] côté contract. Cleanup via cron (sessions > 1h avec claim_nonce set).
  db.prepare(`
    UPDATE sessions
       SET claim_nonce=?, claim_sig=?, claim_amount=?, claimed_at=strftime('%s','now')
     WHERE id=?
  `).run(nonce, sig, amount.toString(), sessionId);

  // Snapshot pré-update pour détecter milestones claim (scope au game de la session)
  const claimGame = normalizeGame(session.game);
  const prevClaimedRow = db.prepare('SELECT total_claimed FROM leaderboard WHERE address=? AND game=?').get(addr, claimGame);
  const prevClaimed = prevClaimedRow ? prevClaimedRow.total_claimed : 0;
  const newClaimed  = prevClaimed + session.reward;

  db.prepare(`
    UPDATE leaderboard SET
      total_claimed = total_claimed + ?,
      updated_at    = strftime('%s','now')
    WHERE address = ? AND game = ?
  `).run(session.reward, addr, claimGame);

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
    twitchNotify(`💰 ${shortAddr(address)} just claimed ${session.reward} $SNAKE 🐍`);
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
    twitchNotify(`💎 ${shortAddr(address)} just hit ${claimedMilestone} $SNAKE cumulative! ` + (claimedMilestone >= 500 ? '🚀 WHALE ALERT' : ''));
    if (claimedMilestone >= 500) {
      bskyNotify(`🚀 WHALE ALERT on SnakeCoin 🐍 ${shortAddr(address)} just crossed ${claimedMilestone} $SNAKE cumulative claimed on Polygon. https://snowdiablo.xyz #SnakeCoin #Whale #Polygon`);
    }
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

// ─── NFT TROPHY DROPS (Task #22) ──────────────────────────────────────────────
// GET /api/nft/eligibility/:address — retourne les trophées mintables pour ce wallet
app.get('/api/nft/eligibility/:address', publicLimiter, (req, res) => {
  const address = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  const drops = db.prepare(`
    SELECT season_id, rank, status, tx_hash, minted_at
    FROM nft_drops
    WHERE address = ?
    ORDER BY season_id DESC, rank ASC
  `).all(address);

  const tierOf = (rank) => {
    if (rank === 1) return 'Gold';
    if (rank === 2) return 'Silver';
    if (rank === 3) return 'Bronze';
    return 'Top10';
  };

  // Current active multiplier (task #46)
  const activeTier = getNftTier(address);

  res.json({
    address,
    contract: NFT_CONTRACT_ADDRESS || null,
    mintFee_pol: '10', // affiche 10 POL côté UI (source de vérité = contract.mintFee())
    active_multiplier: {
      tier:       activeTier.tier,       // 'Gold' | 'Silver' | 'Bronze' | 'Top10' | null
      rank:       activeTier.rank,       // 1..10 ou null
      multiplier: activeTier.multiplier, // 1.0 | 1.05 | 1.10 | 1.15 | 1.25
      bonus_pct:  activeTier.bonus_pct,  // 0 | 5 | 10 | 15 | 25
    },
    drops: drops.map(d => ({
      season: d.season_id,
      rank: d.rank,
      tier: tierOf(d.rank),
      status: d.status,
      tx_hash: d.tx_hash,
      minted_at: d.minted_at ? new Date(d.minted_at * 1000).toISOString() : null,
    })),
  });
});

// GET /api/nft/multiplier/:address — endpoint léger pour UI (badge multiplier en temps réel)
app.get('/api/nft/multiplier/:address', publicLimiter, (req, res) => {
  const address = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  const t = getNftTier(address);
  res.json({
    address,
    tier:       t.tier,
    rank:       t.rank,
    multiplier: t.multiplier,
    bonus_pct:  t.bonus_pct,
    label:      t.tier ? `${t.tier} +${t.bonus_pct}%` : 'No trophy',
  });
});

// ─── NFT BOOST endpoints (task #71) ──────────────────────────────────────────
// GET /api/boost/catalog — liste des tiers permanents + seasonal courant
app.get('/api/boost/catalog', publicLimiter, async (req, res) => {
  if (!BOOST_NFT_ADDRESS) {
    return res.json({ available: false, reason: 'BOOST_NFT_ADDRESS not configured', tiers: [], seasonal: null });
  }
  try {
    const cat = await getBoostCatalog();
    res.json(cat);
  } catch (e) {
    console.error('[BOOST CATALOG] error:', e.message);
    res.status(500).json({ error: 'catalog fetch failed' });
  }
});

// GET /api/boost/multiplier/:address — lit cache + refresh async en fond si stale
// Ne bloque JAMAIS : retourne la valeur cache immédiatement, trigger un refresh
// RPC en fond si cache stale ou manquant (the call returns fresh value via polling).
app.get('/api/boost/multiplier/:address', publicLimiter, (req, res) => {
  const address = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  if (!BOOST_NFT_ADDRESS) {
    return res.json({ address, available: false, bps: 0, multiplier: 1.0, bonus_pct: 0, stale: false, cached: false });
  }
  const m = getBoostMultFromCache(address);
  // Fire-and-forget refresh si pas en cache ou stale
  if (!m.cached || m.stale) {
    refreshBoostMultFor(address).catch(() => {});
  }
  res.json({
    address,
    available:  true,
    bps:        m.bps,
    multiplier: m.multiplier,
    bonus_pct:  m.bps / 100,
    stale:      m.stale,
    cached:     m.cached,
    age_sec:    m.age_sec,
  });
});

// POST /api/boost/refresh — force un refresh synchrone (renvoie la valeur à jour)
// Utilisé par le frontend après un mint réussi pour rafraîchir l'UI instantanément.
app.post('/api/boost/refresh', publicLimiter, async (req, res) => {
  const address = (req.body?.address || '').toLowerCase();
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  if (!BOOST_NFT_ADDRESS) {
    return res.status(503).json({ error: 'BOOST_NFT_ADDRESS not configured' });
  }
  const bps = await refreshBoostMultFor(address);
  if (bps === null) {
    // Fallback : retourne le cache existant si refresh RPC a échoué
    const m = getBoostMultFromCache(address);
    return res.json({
      address,
      bps:        m.bps,
      multiplier: m.multiplier,
      bonus_pct:  m.bps / 100,
      refreshed:  false,
      cached:     m.cached,
    });
  }
  res.json({
    address,
    bps,
    multiplier: 1 + bps / 10000,
    bonus_pct:  bps / 100,
    refreshed:  true,
  });
});

// GET /api/boost/inventory/:address — liste les tokenIds détenus + metadata
// Best-effort : nécessite que le contract supporte tokenOfOwnerByIndex (ERC721Enumerable).
app.get('/api/boost/inventory/:address', publicLimiter, async (req, res) => {
  const address = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  const contract = getBoostContract();
  if (!contract) {
    return res.json({ address, available: false, tokens: [] });
  }
  const TIER_NAMES = { 0: 'None', 1: 'Basic', 2: 'Pro', 3: 'Elite', 4: 'Seasonal' };
  try {
    const bal = Number(await contract.balanceOf(address));
    const tokens = [];
    const MAX = Math.min(bal, 50); // safety cap
    for (let i = 0; i < MAX; i++) {
      try {
        const tokenId = await contract.tokenOfOwnerByIndex(address, i);
        const meta = await contract.tokenMeta(tokenId);
        tokens.push({
          token_id:     tokenId.toString(),
          tier:         Number(meta[0]),
          tier_name:    TIER_NAMES[Number(meta[0])] || 'Unknown',
          seasonal_id:  Number(meta[1]),
          minted_at:    Number(meta[2]),
        });
      } catch (e) {
        // Enumerable pas dispo ? break loop
        break;
      }
    }
    res.json({ address, available: true, balance: bal, tokens });
  } catch (e) {
    console.error('[BOOST INVENTORY] error:', e.message);
    res.status(500).json({ error: 'inventory fetch failed' });
  }
});

// ─── TOURNAMENTS endpoints (task #69) ────────────────────────────────────────
// GET /api/tournament/current — metadata tournoi en cours
app.get('/api/tournament/current', publicLimiter, (req, res) => {
  if (!TOURNAMENT_ENABLED) {
    return res.json({ enabled: false, reason: 'Tournaments not enabled on this deployment' });
  }
  const t = ensureTournamentOpen();
  if (!t) {
    return res.json({ enabled: true, active: false });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  res.json({
    enabled:         true,
    active:          true,
    id:              t.id,
    start_at:        t.start_at,
    end_at:          t.end_at,
    time_left_sec:   Math.max(0, t.end_at - nowSec),
    entry_fee_wei:   t.entry_fee_wei,
    entry_fee_pol:   ethers.formatEther(t.entry_fee_wei || '0'),
    prize_pool_wei:  t.prize_pool_wei,
    prize_pool_pol:  ethers.formatEther(t.prize_pool_wei || '0'),
    entries_count:   t.entries_count,
    payout_wallet:   TOURNAMENT_PAYOUT_WALLET || null,
    split_bps:       { winner1: TOURNAMENT_WINNERS_BPS[0], winner2: TOURNAMENT_WINNERS_BPS[1], winner3: TOURNAMENT_WINNERS_BPS[2], project: TOURNAMENT_PROJECT_CUT_BPS },
    disclaimer:      'Skill-based competition — no gambling. Entry proceeds fund prize pool + project ops.',
  });
});

// GET /api/tournament/leaderboard — top 20 du tournoi courant (ou ?id=N)
app.get('/api/tournament/leaderboard', publicLimiter, (req, res) => {
  if (!TOURNAMENT_ENABLED) return res.json({ enabled: false, entries: [] });
  const tid = req.query.id ? parseInt(req.query.id, 10) : null;
  let tournament;
  if (tid) {
    tournament = db.prepare('SELECT * FROM tournaments WHERE id = ?').get(tid);
  } else {
    tournament = ensureTournamentOpen();
  }
  if (!tournament) return res.json({ enabled: true, active: false, entries: [] });
  const entries = getTournamentLeaderboard(tournament.id, 20);
  res.json({
    enabled:        true,
    active:         tournament.status === 'open',
    tournament_id:  tournament.id,
    end_at:         tournament.end_at,
    prize_pool_wei: tournament.prize_pool_wei,
    entries: entries.map((e, idx) => ({
      rank:          idx + 1,
      wallet:        e.wallet,
      wallet_short:  `${e.wallet.slice(0,6)}…${e.wallet.slice(-4)}`,
      best_score:    e.best_score,
      games_played:  e.games_played,
      clan_tag:      e.clan_tag || null,
      clan_name:     e.clan_name || null,
      clan_id:       e.clan_id || null,
    })),
  });
});

// POST /api/tournament/enter — inscription via POL tx on-chain vers PAYOUT_WALLET
// body : { wallet, tx_hash }
app.post('/api/tournament/enter', limiter, async (req, res) => {
  if (!TOURNAMENT_ENABLED) return res.status(503).json({ error: 'Tournaments not enabled' });
  if (!TOURNAMENT_PAYOUT_WALLET) return res.status(503).json({ error: 'TOURNAMENT_PAYOUT_WALLET not configured' });

  const wallet  = (req.body?.wallet || '').toLowerCase();
  const txHash  = (req.body?.tx_hash || '').toLowerCase();

  if (!ethers.isAddress(wallet)) return res.status(400).json({ error: 'Adresse invalide' });
  if (!/^0x[0-9a-f]{64}$/i.test(txHash)) return res.status(400).json({ error: 'tx_hash invalide' });

  const provider = getProvider();
  if (!provider) return res.status(503).json({ error: 'RPC provider non configuré' });

  const t = ensureTournamentOpen();
  if (!t) return res.status(400).json({ error: 'Aucun tournoi actif' });

  // Idempotence : refuse si tx déjà consommée
  const existing = db.prepare('SELECT wallet FROM tournament_entries WHERE paid_tx = ?').get(txHash);
  if (existing) {
    return res.status(409).json({ error: 'Cette transaction a déjà été utilisée', wallet: existing.wallet });
  }

  // Vérif on-chain : to = TOURNAMENT_PAYOUT_WALLET, from = wallet, value >= entry_fee, confirmed
  let tx, receipt;
  try {
    tx = await provider.getTransaction(txHash);
    receipt = await provider.getTransactionReceipt(txHash);
  } catch (e) {
    console.warn('[TOURNAMENT ENTER] RPC error:', e.message);
    return res.status(502).json({ error: 'RPC lookup failed' });
  }
  if (!tx || !receipt) return res.status(404).json({ error: 'Transaction introuvable' });
  if (receipt.status !== 1) return res.status(400).json({ error: 'Transaction non confirmée ou échouée' });

  const txFrom = (tx.from || '').toLowerCase();
  const txTo   = (tx.to   || '').toLowerCase();
  if (txFrom !== wallet) return res.status(400).json({ error: 'tx.from ne correspond pas au wallet' });
  if (txTo !== TOURNAMENT_PAYOUT_WALLET) return res.status(400).json({ error: 'tx.to ne correspond pas au PAYOUT_WALLET' });

  const entryWei = BigInt(t.entry_fee_wei || '0');
  const txValue  = BigInt(tx.value || 0n);
  if (txValue < entryWei) {
    return res.status(400).json({ error: `Montant insuffisant (${ethers.formatEther(txValue)} POL < ${ethers.formatEther(entryWei)} POL)` });
  }

  // Vérif confirmations
  try {
    const latest = await provider.getBlockNumber();
    const confs  = latest - (receipt.blockNumber || latest);
    if (confs < TOURNAMENT_MIN_CONFIRMATIONS) {
      return res.status(202).json({
        error: 'Attente de confirmations',
        confirmations: confs,
        required: TOURNAMENT_MIN_CONFIRMATIONS,
      });
    }
  } catch (e) {
    console.warn('[TOURNAMENT ENTER] block lookup failed:', e.message);
  }

  // Insert + update pool (transaction DB)
  const tx2 = db.transaction(() => {
    db.prepare(`
      INSERT INTO tournament_entries (tournament_id, wallet, paid_tx, paid_amount)
      VALUES (?, ?, ?, ?)
    `).run(t.id, wallet, txHash, txValue.toString());
    const pool = BigInt(t.prize_pool_wei || '0') + txValue;
    db.prepare(`
      UPDATE tournaments
         SET prize_pool_wei = ?, entries_count = entries_count + 1
       WHERE id = ?
    `).run(pool.toString(), t.id);
  });
  try {
    tx2();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Wallet déjà inscrit ou tx déjà consommée' });
    }
    console.error('[TOURNAMENT ENTER] db error:', e.message);
    return res.status(500).json({ error: 'DB error' });
  }

  console.log(`🏆 Tournament #${t.id} : ${wallet.slice(0,6)}…${wallet.slice(-4)} inscrit (${ethers.formatEther(txValue)} POL)`);
  res.json({
    ok:            true,
    tournament_id: t.id,
    wallet,
    best_score:    0,
    time_left_sec: Math.max(0, t.end_at - Math.floor(Date.now() / 1000)),
  });
});

// ─── CLANS endpoints (task #70) ──────────────────────────────────────────────
// POST /api/clan/create — burn 1000 $SNAKE → crée un clan
// body: { wallet, name, tag, burn_tx, proof }
app.post('/api/clan/create', limiter, async (req, res) => {
  if (!CLAN_ENABLED) return res.status(503).json({ error: 'clans_disabled' });
  const { wallet, name, tag, burn_tx, proof } = req.body || {};

  if (!wallet || !ethers.isAddress(wallet)) return res.status(400).json({ error: 'Adresse invalide' });
  const nameV = validateClanName(name);
  if (!nameV.ok) return res.status(400).json({ error: nameV.error });
  const tagV = validateClanTag(tag);
  if (!tagV.ok) return res.status(400).json({ error: tagV.error });
  if (!burn_tx || !/^0x[0-9a-fA-F]{64}$/.test(burn_tx)) return res.status(400).json({ error: 'burn_tx invalide' });

  // EIP-191 proof obligatoire (action destructive)
  const v = verifyWalletProof('CreateClan', wallet, proof);
  if (!v.ok) return res.status(401).json({ error: `Proof wallet : ${v.error}` });

  const addr = wallet.toLowerCase();
  if (!CONTRACT_ADDRESS) return res.status(503).json({ error: 'Contrat $SNAKE non configuré' });
  const provider = getProvider();
  if (!provider) return res.status(503).json({ error: 'RPC non configuré' });

  // Uniqueness checks
  if (getClanOfWallet(addr)) return res.status(409).json({ error: 'already_in_clan' });
  const nameExists = db.prepare('SELECT id FROM clans WHERE name = ? COLLATE NOCASE AND active = 1').get(nameV.name);
  if (nameExists) return res.status(409).json({ error: 'name_taken' });
  const tagExists = db.prepare('SELECT id FROM clans WHERE tag = ? COLLATE NOCASE AND active = 1').get(tagV.tag);
  if (tagExists) return res.status(409).json({ error: 'tag_taken' });

  // Anti-replay
  const already = db.prepare('SELECT 1 FROM clan_create_burns WHERE tx_hash = ?').get(burn_tx);
  if (already) return res.status(409).json({ error: 'tx_already_used' });

  // Verify burn on-chain
  let verif;
  try {
    verif = await verifyClanCreateBurn(provider, burn_tx, addr);
  } catch (e) {
    return res.status(502).json({ error: 'rpc_error', message: e.message });
  }
  if (!verif.ok) return res.status(400).json({ error: verif.error, message: `Burn ${CLAN_CREATE_BURN_AMOUNT} $SNAKE requis vers ${BURN_ADDRESS}` });

  // Insert clan + owner membership + burn record (tx)
  let clanId;
  const txDb = db.transaction(() => {
    db.prepare(`INSERT INTO clan_create_burns (tx_hash, wallet, amount) VALUES (?, ?, ?)`)
      .run(burn_tx, addr, verif.burned.toString());
    const info = db.prepare(`
      INSERT INTO clans (name, tag, owner, burn_tx, burn_amount)
      VALUES (?, ?, ?, ?, ?)
    `).run(nameV.name, tagV.tag, addr, burn_tx, verif.burned.toString());
    clanId = info.lastInsertRowid;
    db.prepare(`INSERT INTO clan_members (wallet, clan_id, role) VALUES (?, ?, 'owner')`).run(addr, clanId);
  });
  try {
    txDb();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'conflict' });
    console.error('[CLAN CREATE]', e.message);
    return res.status(500).json({ error: 'db_error' });
  }

  console.log(`[CLAN] created #${clanId} "${nameV.name}" [${tagV.tag}] by ${shortAddr(addr)}`);
  res.json({ ok: true, clan_id: clanId, name: nameV.name, tag: tagV.tag });
});

// POST /api/clan/join — rejoint un clan (body : wallet, clan_id, proof)
app.post('/api/clan/join', limiter, async (req, res) => {
  if (!CLAN_ENABLED) return res.status(503).json({ error: 'clans_disabled' });
  const { wallet, clan_id, proof } = req.body || {};
  if (!wallet || !ethers.isAddress(wallet)) return res.status(400).json({ error: 'Adresse invalide' });
  const cid = parseInt(clan_id, 10);
  if (!Number.isInteger(cid) || cid < 1) return res.status(400).json({ error: 'clan_id invalide' });
  const v = verifyWalletProof('JoinClan', wallet, proof);
  if (!v.ok) return res.status(401).json({ error: `Proof wallet : ${v.error}` });
  const addr = wallet.toLowerCase();
  if (getClanOfWallet(addr)) return res.status(409).json({ error: 'already_in_clan' });
  const clan = db.prepare('SELECT id, active FROM clans WHERE id = ?').get(cid);
  if (!clan || !clan.active) return res.status(404).json({ error: 'clan_not_found' });
  if (countClanMembers(cid) >= CLAN_MAX_MEMBERS) return res.status(409).json({ error: 'clan_full' });
  try {
    db.prepare(`INSERT INTO clan_members (wallet, clan_id, role) VALUES (?, ?, 'member')`).run(addr, cid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'already_in_clan' });
    return res.status(500).json({ error: 'db_error' });
  }
  res.json({ ok: true, clan_id: cid });
});

// POST /api/clan/leave — quitter son clan (wallet, proof). Si owner → transfert auto au plus ancien membre, sinon clan dissous.
app.post('/api/clan/leave', limiter, async (req, res) => {
  if (!CLAN_ENABLED) return res.status(503).json({ error: 'clans_disabled' });
  const { wallet, proof } = req.body || {};
  if (!wallet || !ethers.isAddress(wallet)) return res.status(400).json({ error: 'Adresse invalide' });
  const v = verifyWalletProof('LeaveClan', wallet, proof);
  if (!v.ok) return res.status(401).json({ error: `Proof wallet : ${v.error}` });
  const addr = wallet.toLowerCase();
  const membership = getClanOfWallet(addr);
  if (!membership) return res.status(404).json({ error: 'not_in_clan' });

  const txDb = db.transaction(() => {
    db.prepare('DELETE FROM clan_members WHERE wallet = ?').run(addr);
    if (membership.role === 'owner') {
      // Promouvoir le plus ancien membre restant, ou dissoudre
      const next = db.prepare(`
        SELECT wallet FROM clan_members WHERE clan_id = ? ORDER BY joined_at ASC LIMIT 1
      `).get(membership.id);
      if (next) {
        db.prepare(`UPDATE clans SET owner = ? WHERE id = ?`).run(next.wallet, membership.id);
        db.prepare(`UPDATE clan_members SET role = 'owner' WHERE wallet = ?`).run(next.wallet);
      } else {
        db.prepare(`UPDATE clans SET active = 0 WHERE id = ?`).run(membership.id);
      }
    }
  });
  try { txDb(); } catch (e) { return res.status(500).json({ error: 'db_error' }); }
  res.json({ ok: true, dissolved: membership.role === 'owner' && countClanMembers(membership.id) === 0 });
});

// GET /api/clan/list — liste publique, pagination limit (défaut 50, max 200)
app.get('/api/clan/list', publicLimiter, (req, res) => {
  if (!CLAN_ENABLED) return res.json({ enabled: false, clans: [] });
  const lim = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  res.json({ enabled: true, clans: listClans(lim) });
});

// GET /api/config/fees — expose au frontend où envoyer les tokens $SNAKE pour clan/username.
// Si FEE_WALLET configuré → royalty mode (revenue project), sinon → BURN_ADDRESS (deflation pure).
app.get('/api/config/fees', publicLimiter, (req, res) => {
  res.json({
    burn_address:         BURN_ADDRESS,
    clan_fee_wallet:      CLAN_FEE_WALLET     || null,
    username_fee_wallet:  USERNAME_FEE_WALLET || null,
    clan_target:          CLAN_FEE_WALLET     || BURN_ADDRESS,
    username_target:      USERNAME_FEE_WALLET || BURN_ADDRESS,
    clan_amount:          CLAN_CREATE_BURN_AMOUNT,
    username_amount:      USERNAME_BURN_AMOUNT,
    royalty_mode:         !!(CLAN_FEE_WALLET || USERNAME_FEE_WALLET),
  });
});

// GET /api/clan/mine/:wallet — clan du wallet
app.get('/api/clan/mine/:wallet', publicLimiter, (req, res) => {
  if (!CLAN_ENABLED) return res.json({ enabled: false, clan: null });
  const addr = (req.params.wallet || '').toLowerCase();
  if (!ethers.isAddress(addr)) return res.status(400).json({ error: 'Adresse invalide' });
  res.json({ enabled: true, clan: getClanOfWallet(addr) });
});

// GET /api/clan/:id — détails + membres
app.get('/api/clan/:id', publicLimiter, (req, res) => {
  if (!CLAN_ENABLED) return res.json({ enabled: false, clan: null });
  const cid = parseInt(req.params.id, 10);
  if (!Number.isInteger(cid) || cid < 1) return res.status(400).json({ error: 'clan_id invalide' });
  const clan = getClanById(cid);
  if (!clan) return res.status(404).json({ error: 'clan_not_found' });
  res.json({ enabled: true, clan });
});

// GET /api/clan/leaderboard — top clans par somme des scores membres (weekly rolling)
app.get('/api/clan/leaderboard', publicLimiter, (req, res) => {
  if (!CLAN_ENABLED) return res.json({ enabled: false, clans: [] });
  const cutoff = Math.floor(Date.now() / 1000) - (7 * 24 * 3600);
  const rows = db.prepare(`
    SELECT c.id, c.name, c.tag, c.owner,
           COUNT(cm.wallet) AS members,
           COALESCE(SUM(CASE WHEN sh.created_at >= ? THEN sh.score ELSE 0 END), 0) AS weekly_score
      FROM clans c
      LEFT JOIN clan_members cm ON cm.clan_id = c.id
      LEFT JOIN score_history sh ON sh.address = cm.wallet
     WHERE c.active = 1
     GROUP BY c.id
     ORDER BY weekly_score DESC, members DESC
     LIMIT 20
  `).all(cutoff);
  res.json({ enabled: true, period: 'weekly_rolling_7d', clans: rows });
});

// POST /api/nft/mint-sig — retourne une signature de mint pour un trophée éligible
app.post('/api/nft/mint-sig', limiter, async (req, res) => {
  const { address, season, rank, proof } = req.body || {};
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  if (!Number.isInteger(season) || season < 1) {
    return res.status(400).json({ error: 'season invalide' });
  }
  if (!Number.isInteger(rank) || rank < 1 || rank > 10) {
    return res.status(400).json({ error: 'rank doit être entre 1 et 10' });
  }
  if (!NFT_CONTRACT_ADDRESS) {
    return res.status(503).json({ error: 'Contrat NFT non configuré' });
  }

  // ─── EIP-191 ownership proof (task #56) ─────────────────────────────────
  if (proof || REQUIRE_WALLET_PROOF) {
    const v = verifyWalletProof('MintTrophy', address, proof);
    if (!v.ok) {
      if (REQUIRE_WALLET_PROOF) {
        return res.status(401).json({ error: `Proof wallet : ${v.error}` });
      }
      console.warn(`[MINT-SIG] proof invalide pour ${shortAddr(address)} : ${v.error}`);
    }
  } else {
    console.warn(`[MINT-SIG] ${shortAddr(address)} sans proof EIP-191 (legacy path)`);
  }

  const addr = address.toLowerCase();

  // Check éligibilité
  const drop = db.prepare(`
    SELECT * FROM nft_drops WHERE season_id=? AND address=?
  `).get(season, addr);
  if (!drop) {
    return res.status(403).json({ error: 'Pas éligible pour cette saison' });
  }
  if (drop.rank !== rank) {
    return res.status(403).json({ error: `Rank incorrect (éligible pour #${drop.rank})` });
  }
  if (drop.status === 'minted') {
    return res.status(409).json({ error: 'Trophée déjà minté', tx_hash: drop.tx_hash });
  }

  // Génère nonce + signature (format: abi.encode(address, season, rank, nonce, contractAddr))
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['address', 'uint256', 'uint256', 'bytes32', 'address'],
    [address, season, rank, nonce, NFT_CONTRACT_ADDRESS]
  );
  const hash = ethers.keccak256(encoded);
  const sig  = await wallet.signMessage(ethers.getBytes(hash));

  // Stocke nonce pour tracking (optionnel mais pratique)
  db.prepare(`UPDATE nft_drops SET nonce=? WHERE season_id=? AND address=?`)
    .run(nonce, season, addr);

  res.json({
    season,
    rank,
    nonce,
    sig,
    contract: NFT_CONTRACT_ADDRESS,
  });
});

// POST /api/nft/confirm — user report après tx confirmée on-chain (optionnel, sinon cron on-chain scan)
app.post('/api/nft/confirm', (req, res) => {
  const { address, season, rank, tx_hash } = req.body || {};
  if (!address || !ethers.isAddress(address) || !tx_hash || !Number.isInteger(season) || !Number.isInteger(rank)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const addr = address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const r = db.prepare(`
    UPDATE nft_drops SET status='minted', tx_hash=?, minted_at=?
    WHERE season_id=? AND address=? AND rank=?
  `).run(tx_hash, now, season, addr, rank);

  if (r.changes === 0) {
    return res.status(404).json({ error: 'Drop introuvable' });
  }

  // Notify public
  const tierOf = (rk) => rk === 1 ? 'Gold' : rk === 2 ? 'Silver' : rk === 3 ? 'Bronze' : 'Top10';
  const tier = tierOf(rank);
  twitchNotify(`🏆 ${shortAddr(address)} just minted a ${tier} Trophy for Season ${season}! snowdiablo.xyz`);
  bskyNotify(`🏆 NEW TROPHY MINTED 🐍\n${shortAddr(address)} claimed the ${tier} Trophy from Season ${season} on SnakeCoin P2E.\nhttps://snowdiablo.xyz #SnakeCoin #NFT #Polygon`);
  publicFeed({
    embeds: [{
      title: `🏆 Trophée ${tier} minté · Saison ${season}`,
      description: `[${shortAddr(address)}](https://polygonscan.com/address/${address}) vient de mint son NFT trophée !\nTX : [voir sur Polygonscan](https://polygonscan.com/tx/${tx_hash})`,
      color: rank === 1 ? 0xFFD700 : rank === 2 ? 0xC0C0C0 : rank === 3 ? 0xCD7F32 : 0x00ff88,
      footer: { text: 'SnakeCoin · Trophy Collection' },
      timestamp: new Date().toISOString(),
    }],
  });

  res.json({ ok: true });
});

// ─── USERNAMES (task #68 — wallet-linked pseudo) ──────────────────────────────
// Blacklist username (admin env var JSON array OR default common slurs/reserved).
// Force NOCASE compare. Regex anti-unicode + anti-confusion.
const USERNAME_BLACKLIST_DEFAULT = [
  'admin','administrator','snowdiablo','snakecoin','anthropic','claude','system',
  'root','mod','moderator','support','staff','owner','null','undefined','deleted',
  'snake','official','team','bot','discord','polygon','ethereum',
  'nigger','nigga','fag','faggot','retard','rape','kike','chink','tranny',
].map(s => s.toLowerCase());
let USERNAME_BLACKLIST = [...USERNAME_BLACKLIST_DEFAULT];
try {
  if (process.env.USERNAME_BLACKLIST) {
    const extra = JSON.parse(process.env.USERNAME_BLACKLIST);
    if (Array.isArray(extra)) USERNAME_BLACKLIST.push(...extra.map(s => String(s).toLowerCase()));
  }
} catch (e) { console.warn('⚠️ USERNAME_BLACKLIST parse err:', e.message); }

const USERNAME_REGEX   = /^[A-Za-z0-9_-]{3,16}$/;
const USERNAME_MIN_LEN = 3;
const USERNAME_MAX_LEN = 16;
// USERNAME_BURN_AMOUNT déclaré globalement plus haut avec les env vars (pour accès depuis /api/config/fees)

function validateUsername(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'username_missing' };
  const u = raw.trim();
  if (u.length < USERNAME_MIN_LEN || u.length > USERNAME_MAX_LEN) {
    return { ok: false, error: 'username_length' };
  }
  if (!USERNAME_REGEX.test(u)) return { ok: false, error: 'username_invalid_chars' };
  if (USERNAME_BLACKLIST.includes(u.toLowerCase())) return { ok: false, error: 'username_forbidden' };
  // Interdit commencer/finir par - ou _ (esthétique + anti-confusion)
  if (/^[-_]|[-_]$/.test(u)) return { ok: false, error: 'username_invalid_chars' };
  return { ok: true, username: u };
}

function currentMonthUTC() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getUsernameByWallet(wallet) {
  if (!wallet) return null;
  return db.prepare('SELECT * FROM usernames WHERE wallet = ?').get(wallet.toLowerCase());
}
function isUsernameTaken(username, exceptWallet = null) {
  const row = db.prepare('SELECT wallet FROM usernames WHERE username = ? COLLATE NOCASE').get(username);
  if (!row) return false;
  if (exceptWallet && row.wallet.toLowerCase() === exceptWallet.toLowerCase()) return false;
  return true;
}

// GET /api/username/:wallet → resolve
app.get('/api/username/:wallet', publicLimiter, (req, res) => {
  const addr = (req.params.wallet || '').toLowerCase();
  if (!ethers.isAddress(addr)) return res.status(400).json({ error: 'Adresse invalide' });
  const row = getUsernameByWallet(addr);
  if (!row) return res.json({ wallet: addr, username: null });
  const currentMonth = currentMonthUTC();
  const can_free_change = row.last_free_change_month !== currentMonth;
  res.json({
    wallet: addr,
    username: row.username,
    set_at: row.set_at,
    last_changed_at: row.last_changed_at,
    last_free_change_month: row.last_free_change_month,
    can_free_change,
    next_free_change_month: can_free_change ? currentMonth : nextMonthUTC(),
    paid_changes_count: row.paid_changes_count || 0,
  });
});

function nextMonthUTC() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// GET /api/username/check/:name → availability
app.get('/api/username/check/:name', publicLimiter, (req, res) => {
  const v = validateUsername(req.params.name || '');
  if (!v.ok) return res.json({ available: false, valid: false, reason: v.error });
  const taken = isUsernameTaken(v.username);
  res.json({ available: !taken, valid: true, username: v.username });
});

// POST /api/username/set
// Body: { address, username, proof }
// - Premier set : gratuit
// - Changement : gratuit 1x/mois (last_free_change_month != currentMonth) sinon 403 USE /paid-change
app.post('/api/username/set', limiter, (req, res) => {
  const { address, username, proof } = req.body || {};
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }

  // EIP-191 proof (cohérent avec le reste du projet)
  if (proof || REQUIRE_WALLET_PROOF) {
    const v = verifyWalletProof('SetUsername', address, proof);
    if (!v.ok) {
      if (REQUIRE_WALLET_PROOF) {
        return res.status(401).json({ error: `Proof wallet : ${v.error}` });
      }
      console.warn(`[USERNAME/SET] proof invalide pour ${shortAddr(address)} : ${v.error}`);
    }
  } else {
    console.warn(`[USERNAME/SET] ${shortAddr(address)} sans proof EIP-191 (legacy path)`);
  }

  const val = validateUsername(username);
  if (!val.ok) return res.status(400).json({ error: val.error });

  const addr = address.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const currentMonth = currentMonthUTC();
  const existing = getUsernameByWallet(addr);

  if (existing) {
    // Si même username (case-insensitive) → idempotent
    if (existing.username.toLowerCase() === val.username.toLowerCase()) {
      return res.json({ ok: true, username: existing.username, idempotent: true });
    }
    // Sinon : limite 1 free change/mois
    if (existing.last_free_change_month === currentMonth) {
      return res.status(403).json({
        error: 'username_free_change_used',
        message: 'Changement gratuit déjà utilisé ce mois. Utilise /api/username/paid-change (burn 1000 $SNAKE) pour changer maintenant.',
        next_free_change_month: nextMonthUTC(),
      });
    }
    if (isUsernameTaken(val.username, addr)) {
      return res.status(409).json({ error: 'username_taken' });
    }
    try {
      db.prepare(`
        UPDATE usernames
        SET username = ?, last_changed_at = ?, last_free_change_month = ?
        WHERE wallet = ?
      `).run(val.username, now, currentMonth, addr);
    } catch (e) {
      if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'username_taken' });
      throw e;
    }
    console.log(`[USERNAME] ${shortAddr(addr)} changed → ${val.username} (free monthly)`);
    return res.json({
      ok: true,
      username: val.username,
      type: 'free_change',
      next_free_change_month: nextMonthUTC(),
    });
  }

  // Premier set — gratuit, ne consomme PAS le free change du mois
  if (isUsernameTaken(val.username)) {
    return res.status(409).json({ error: 'username_taken' });
  }
  try {
    db.prepare(`
      INSERT INTO usernames (wallet, username, set_at, last_changed_at, last_free_change_month)
      VALUES (?, ?, ?, ?, NULL)
    `).run(addr, val.username, now, now);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'username_taken' });
    throw e;
  }
  console.log(`[USERNAME] ${shortAddr(addr)} set → ${val.username} (first)`);
  publicFeed({
    embeds: [{
      title: `🆕 Nouveau pseudo enregistré`,
      description: `[${shortAddr(addr)}](https://polygonscan.com/address/${addr}) → **${val.username}**`,
      color: 0x00ff88,
      timestamp: new Date().toISOString(),
    }],
  });
  res.json({ ok: true, username: val.username, type: 'first_set' });
});

// POST /api/username/paid-change
// Body: { address, username, tx_hash, proof }
// Vérifie on-chain que tx_hash = transfer 1000 $SNAKE de `address` → BURN_ADDRESS (0x...dEaD).
// Consomme le tx_hash (anti-replay) et autorise le changement IMMÉDIAT (override monthly lock).
app.post('/api/username/paid-change', limiter, async (req, res) => {
  const { address, username, tx_hash, proof } = req.body || {};
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Adresse invalide' });
  }
  if (!tx_hash || typeof tx_hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) {
    return res.status(400).json({ error: 'tx_hash invalide' });
  }

  // EIP-191 proof (obligatoire ici : action destructive + coûteuse)
  const v = verifyWalletProof('BurnUsername', address, proof);
  if (!v.ok) return res.status(401).json({ error: `Proof wallet : ${v.error}` });

  const val = validateUsername(username);
  if (!val.ok) return res.status(400).json({ error: val.error });

  const addr = address.toLowerCase();
  if (isUsernameTaken(val.username, addr)) {
    return res.status(409).json({ error: 'username_taken' });
  }

  if (!CONTRACT_ADDRESS) {
    return res.status(503).json({ error: 'Contrat $SNAKE non configuré (CONTRACT_ADDRESS)' });
  }
  const provider = getProvider();
  if (!provider) {
    return res.status(503).json({ error: 'RPC Polygon non configuré (POLYGON_RPC)' });
  }

  // Anti-replay : tx_hash déjà consommé ?
  const alreadyUsed = db.prepare('SELECT 1 FROM username_burns WHERE tx_hash = ?').get(tx_hash);
  if (alreadyUsed) return res.status(409).json({ error: 'tx_hash_already_used' });

  // Vérif on-chain du burn
  let rcpt;
  try {
    rcpt = await provider.getTransactionReceipt(tx_hash);
  } catch (e) {
    return res.status(502).json({ error: 'RPC error fetching receipt' });
  }
  if (!rcpt) return res.status(400).json({ error: 'tx_not_found (en attente de confirmation ?)' });
  if (rcpt.status !== 1) return res.status(400).json({ error: 'tx_failed_on_chain' });

  // Parcours logs : cherche Transfer($SNAKE, from=addr, to=BURN || USERNAME_FEE_WALLET, value >= 1000e18)
  // Royalty mode : transfer peut aller au USERNAME_FEE_WALLET au lieu de BURN_ADDRESS.
  const snakeAddrLc = CONTRACT_ADDRESS.toLowerCase();
  const burnTopic   = '0x000000000000000000000000' + BURN_ADDRESS.slice(2).toLowerCase();
  const feeTopic    = USERNAME_FEE_WALLET ? '0x000000000000000000000000' + USERNAME_FEE_WALLET.slice(2) : null;
  const fromTopic   = '0x000000000000000000000000' + addr.slice(2).toLowerCase();
  const requiredWei = ethers.parseUnits(USERNAME_BURN_AMOUNT, 18);

  let matched = false;
  let burnedAmount = 0n;
  let feePaid = 0n;
  for (const log of rcpt.logs) {
    if (log.address.toLowerCase() !== snakeAddrLc) continue;
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;
    if (log.topics.length < 3) continue;
    if (log.topics[1].toLowerCase() !== fromTopic) continue;
    const toTopic = log.topics[2].toLowerCase();
    const value = BigInt(log.data);
    if (toTopic === burnTopic) {
      burnedAmount += value;
    } else if (feeTopic && toTopic === feeTopic) {
      feePaid += value;
    } else {
      continue;
    }
    if (burnedAmount + feePaid >= requiredWei) { matched = true; break; }
  }

  if (!matched) {
    const targets = USERNAME_FEE_WALLET ? `${BURN_ADDRESS} ou ${USERNAME_FEE_WALLET}` : BURN_ADDRESS;
    return res.status(400).json({
      error: 'burn_not_found',
      message: `tx doit transférer ≥ ${USERNAME_BURN_AMOUNT} $SNAKE de ${addr} vers ${targets}`,
    });
  }

  // Consomme le tx + apply change
  const now = Math.floor(Date.now() / 1000);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO username_burns (tx_hash, wallet, amount) VALUES (?, ?, ?)`)
      .run(tx_hash, addr, burnedAmount.toString());

    const existing = getUsernameByWallet(addr);
    if (existing) {
      db.prepare(`
        UPDATE usernames
        SET username = ?, last_changed_at = ?, paid_changes_count = paid_changes_count + 1
        WHERE wallet = ?
      `).run(val.username, now, addr);
    } else {
      db.prepare(`
        INSERT INTO usernames (wallet, username, set_at, last_changed_at, paid_changes_count)
        VALUES (?, ?, ?, ?, 1)
      `).run(addr, val.username, now, now);
    }
  });
  try {
    tx();
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'username_taken_or_tx_reused' });
    throw e;
  }

  console.log(`[USERNAME] ${shortAddr(addr)} paid-change → ${val.username} (burn tx ${tx_hash.slice(0,10)}...)`);
  twitchNotify(`🔥 ${shortAddr(addr)} burned 1000 $SNAKE to become "${val.username}"`);
  publicFeed({
    embeds: [{
      title: `🔥 Burn Username Change`,
      description: `[${shortAddr(addr)}](https://polygonscan.com/address/${addr}) burned **1000 $SNAKE** → nouveau pseudo : **${val.username}**\nTX : [voir](https://polygonscan.com/tx/${tx_hash})`,
      color: 0xff6b00,
      timestamp: new Date().toISOString(),
    }],
  });

  res.json({
    ok: true,
    username: val.username,
    type: 'paid_change',
    burned: USERNAME_BURN_AMOUNT,
    tx_hash,
  });
});

// ─── PUBLIC STATS ─────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  // Phase 4 : ?game=snake|pong|... filtre par jeu ; ?game=all (ou absent + no games) = agrégé
  const rawGame = req.query.game ? String(req.query.game).toLowerCase() : null;
  const isAll   = rawGame === 'all';
  const game    = (rawGame && !isAll) ? normalizeGame(rawGame) : null;

  let totalClaims, todayClaims, totalPlayers, totalGames, distributed, highestScore;
  if (game) {
    totalClaims  = db.prepare('SELECT COUNT(*) as c FROM claims WHERE game = ?').get(game).c;
    todayClaims  = db.prepare(`SELECT COUNT(*) as c FROM claims WHERE game = ? AND claimed_at > strftime('%s','now','-1 day')`).get(game).c;
    totalPlayers = db.prepare('SELECT COUNT(*) as c FROM leaderboard WHERE game = ?').get(game).c;
    totalGames   = db.prepare('SELECT COUNT(*) as c FROM score_history WHERE game = ?').get(game).c;
    distributed  = db.prepare('SELECT COALESCE(SUM(total_claimed),0) as s FROM leaderboard WHERE game = ?').get(game).s;
    highestScore = db.prepare('SELECT COALESCE(MAX(best_score),0) as m FROM leaderboard WHERE game = ?').get(game).m;
  } else {
    totalClaims  = db.prepare('SELECT COUNT(*) as c FROM claims').get().c;
    todayClaims  = db.prepare(`SELECT COUNT(*) as c FROM claims WHERE claimed_at > strftime('%s','now','-1 day')`).get().c;
    totalPlayers = db.prepare('SELECT COUNT(*) as c FROM leaderboard').get().c;
    totalGames   = db.prepare('SELECT COUNT(*) as c FROM score_history').get().c;
    distributed  = db.prepare('SELECT COALESCE(SUM(total_claimed),0) as s FROM leaderboard').get().s;
    highestScore = db.prepare('SELECT COALESCE(MAX(best_score),0) as m FROM leaderboard').get().m;
  }
  res.json({
    game: game || 'all',
    totalClaims, todayClaims,
    totalPlayers, totalGames,
    totalSnakeDistributed: distributed,
    highestScore,
  });
});

app.get('/api/leaderboard', (req, res) => {
  const period = (req.query.period || 'all').toLowerCase();
  const limit  = Math.min(parseInt(req.query.limit || '10', 10), 100);

  // Phase 4 : ?game= filtre par jeu. Défaut = 'snake' (backward compat).
  // ?game=all = aggregate tous jeux (legacy behavior).
  const rawGame = req.query.game ? String(req.query.game).toLowerCase() : 'snake';
  const isAll   = rawGame === 'all';
  const game    = isAll ? null : normalizeGame(rawGame);

  // task #70 : tag clan injecté si CLAN_ENABLED. Jointure via clan_members → clans.
  const clanJoin   = CLAN_ENABLED ? `LEFT JOIN clan_members cm ON cm.wallet = {ALIAS}
      LEFT JOIN clans c ON c.id = cm.clan_id AND c.active = 1` : '';
  const clanSelect = CLAN_ENABLED ? ', c.tag AS clan_tag, c.name AS clan_name, c.id AS clan_id' : '';

  let rows;
  if (period === 'day' || period === 'week') {
    const offset = period === 'day' ? '-1 day' : '-7 days';
    const gameFilter = game ? 'AND sh.game = ?' : '';
    const params = game ? [offset, game, limit] : [offset, limit];
    rows = db.prepare(`
      SELECT sh.address, MAX(sh.score) as best_score, COUNT(*) as games_played,
             u.username AS display_name${clanSelect}
      FROM score_history sh
      LEFT JOIN usernames u ON u.wallet = sh.address
      ${clanJoin.replace('{ALIAS}', 'sh.address')}
      WHERE sh.created_at > strftime('%s','now', ?) ${gameFilter}
      GROUP BY sh.address
      ORDER BY best_score DESC
      LIMIT ?
    `).all(...params);
  } else {
    const gameFilter = game ? 'WHERE lb.game = ?' : '';
    const params = game ? [game, limit] : [limit];
    rows = db.prepare(`
      SELECT lb.address, lb.best_score, lb.games_played, lb.total_claimed,
             lb.streak_count, lb.max_streak, lb.last_streak_date,
             u.username AS display_name${clanSelect}
      FROM leaderboard lb
      LEFT JOIN usernames u ON u.wallet = lb.address
      ${clanJoin.replace('{ALIAS}', 'lb.address')}
      ${gameFilter}
      ORDER BY lb.best_score DESC
      LIMIT ?
    `).all(...params);
  }
  res.json({ period, limit, game: game || 'all', leaderboard: rows });
});

app.get('/api/player/:address', (req, res) => {
  const addr = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(addr)) return res.status(400).json({ error: 'Adresse invalide' });

  // Phase 4 : ?game= filtre par jeu. Défaut = 'snake' (backward compat).
  const rawGame = req.query.game ? String(req.query.game).toLowerCase() : 'snake';
  const game    = normalizeGame(rawGame);

  const row = db.prepare('SELECT * FROM leaderboard WHERE address = ? AND game = ?').get(addr, game);
  const uname = getUsernameByWallet(addr);
  if (!row) return res.json({
    address: addr, game, best_score: 0, games_played: 0, total_claimed: 0, rank: null,
    username: uname ? uname.username : null,
    display_name: uname ? uname.username : null,
    streak: { current: 0, max: 0, multiplier: 1.0, active: false, last_date: null },
  });
  const rank = db.prepare('SELECT COUNT(*)+1 as r FROM leaderboard WHERE game = ? AND best_score > ?').get(game, row.best_score).r;

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
    username: uname ? uname.username : null,
    display_name: uname ? uname.username : null,
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

// ─── SEASONS (task #21) ────────────────────────────────────────────────────
app.get('/api/seasons', (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, started_at, ended_at, stats_json
    FROM seasons
    ORDER BY id DESC
  `).all();
  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    started_at: r.started_at,
    ended_at: r.ended_at,
    active: r.ended_at === null,
    stats: r.stats_json ? JSON.parse(r.stats_json) : null,
  })));
});

app.get('/api/seasons/current', (req, res) => {
  const row = db.prepare(`
    SELECT id, name, started_at FROM seasons
    WHERE ended_at IS NULL
    ORDER BY id DESC LIMIT 1
  `).get();
  if (!row) return res.json({ active: false });

  // Live top 10 of current season (score_history filtered by started_at)
  const top = db.prepare(`
    SELECT address, MAX(score) as best_score, COUNT(*) as games_played
    FROM score_history
    WHERE created_at >= ?
    GROUP BY address
    ORDER BY best_score DESC, games_played DESC
    LIMIT 10
  `).all(row.started_at);
  const elapsedSec = Math.floor(Date.now() / 1000) - row.started_at;
  const elapsedDays = Math.floor(elapsedSec / 86400);

  res.json({
    active: true,
    id: row.id,
    name: row.name,
    started_at: row.started_at,
    elapsed_days: elapsedDays,
    top10: top,
  });
});

app.get('/api/seasons/:id/leaderboard', (req, res) => {
  const sid = parseInt(req.params.id, 10);
  if (isNaN(sid)) return res.status(400).json({ error: 'Invalid season id' });
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  const season = db.prepare('SELECT * FROM seasons WHERE id=?').get(sid);
  if (!season) return res.status(404).json({ error: 'Season not found' });
  const rows = db.prepare(`
    SELECT rank, address, best_score, games_played, total_claimed, max_streak
    FROM season_results
    WHERE season_id = ?
    ORDER BY rank ASC
    LIMIT ?
  `).all(sid, limit);
  res.json({
    season: { id: season.id, name: season.name, started_at: season.started_at, ended_at: season.ended_at },
    results: rows,
  });
});

// Admin: close current season + snapshot + start new one
app.post('/api/admin/seasons/close', adminAuth, express.json(), (req, res) => {
  const newName = (req.body && req.body.new_name) || `Season ${db.prepare('SELECT COUNT(*) as c FROM seasons').get().c + 1}`;
  try {
    const current = db.prepare(`SELECT * FROM seasons WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1`).get();
    if (!current) return res.status(400).json({ error: 'No active season to close' });

    const now = Math.floor(Date.now() / 1000);
    // Snapshot : top 500 joueurs de la saison (par best_score dans score_history depuis started_at)
    const snapshot = db.prepare(`
      SELECT sh.address,
             MAX(sh.score) as best_score,
             COUNT(*) as games_played,
             COALESCE(l.total_claimed, 0) as total_claimed,
             COALESCE(l.max_streak, 0) as max_streak
      FROM score_history sh
      LEFT JOIN leaderboard l ON l.address = sh.address
      WHERE sh.created_at >= ?
      GROUP BY sh.address
      ORDER BY best_score DESC, games_played DESC
      LIMIT 500
    `).all(current.started_at);

    const stats = {
      total_players: snapshot.length,
      total_sessions: db.prepare(`SELECT COUNT(*) as c FROM score_history WHERE created_at >= ?`).get(current.started_at).c,
      total_snake: db.prepare(`SELECT COALESCE(SUM(CAST(amount AS REAL)),0) as s FROM claims WHERE claimed_at >= ?`).get(current.started_at).s,
      duration_days: Math.floor((now - current.started_at) / 86400),
    };

    // Task #22 : top 10 éligible aux NFT trophées
    const top10 = snapshot.slice(0, 10);

    const closeTxn = db.transaction(() => {
      // Insert snapshot rows
      const ins = db.prepare(`INSERT INTO season_results (season_id, address, rank, best_score, games_played, total_claimed, max_streak) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      snapshot.forEach((r, i) => {
        ins.run(current.id, r.address, i + 1, r.best_score, r.games_played, r.total_claimed, r.max_streak);
      });
      // Insert NFT drops pour top 10 (status=eligible)
      const insDrop = db.prepare(`
        INSERT OR IGNORE INTO nft_drops (season_id, address, rank, status)
        VALUES (?, ?, ?, 'eligible')
      `);
      top10.forEach((r, i) => insDrop.run(current.id, r.address, i + 1));

      // Mark season closed + stats
      db.prepare(`UPDATE seasons SET ended_at=?, stats_json=? WHERE id=?`).run(now, JSON.stringify(stats), current.id);
      // Start new season
      db.prepare(`INSERT INTO seasons (name, started_at) VALUES (?, ?)`).run(newName, now);
    });
    closeTxn();

    // ─── NFT DROPS ANNOUNCE (public + social) ─────────────────────────────────
    if (top10.length > 0 && NFT_CONTRACT_ADDRESS) {
      const champ = top10[0];
      twitchNotify(`🏆 SEASON ${current.id} CLOSED! Top 10 can now mint their NFT trophies at snowdiablo.xyz — Champion: ${shortAddr(champ.address)} 🥇`);
      bskyNotify(`🏆 Season ${current.id} closed on SnakeCoin P2E 🐍\nTop 10 players can now mint their on-chain trophy NFT (Gold/Silver/Bronze/Top10).\n🥇 Champion: ${shortAddr(champ.address)}\nClaim at https://snowdiablo.xyz #SnakeCoin #NFT #Polygon`);
      publicFeed({
        content: `🏆 **Season ${current.id} fermée !** Top 10 peut mint son trophée NFT on-chain`,
        embeds: [{
          title: `🏆 Saison ${current.id} · Top 10 NFT drops`,
          description: top10.map((r, i) => {
            const medals = ['🥇','🥈','🥉'];
            const prefix = medals[i] || `#${i+1}`;
            return `${prefix} [${shortAddr(r.address)}](https://polygonscan.com/address/${r.address}) · **${r.best_score}** pts`;
          }).join('\n'),
          color: 0xFFD700,
          footer: { text: `Mint : snowdiablo.xyz · 10 POL / trophée` },
          timestamp: new Date().toISOString(),
        }],
      });
    }

    console.log(`🏆 Season ${current.id} "${current.name}" closed → ${snapshot.length} results archived. New: ${newName}`);
    // Discord staff notification
    discordNotify({
      title: `🏆 Saison clôturée : ${current.name}`,
      description: `**${snapshot.length}** joueurs · **${stats.total_sessions}** sessions · **${stats.total_snake.toFixed(2)} SNAKE** distribués sur ${stats.duration_days}j\n➡️ Nouvelle saison : **${newName}**`,
      color: 0xFFD700,
      timestamp: new Date().toISOString(),
    });
    res.json({
      closed: { id: current.id, name: current.name, stats, results_archived: snapshot.length },
      new_season: { name: newName, started_at: now },
    });
  } catch (e) {
    console.error('season close failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── BLUESKY ADMIN (task #25) ──────────────────────────────────────────────
app.get('/api/admin/bsky/status', adminAuth, (req, res) => {
  res.json({
    enabled:     Boolean(BSKY_HANDLE && BSKY_APP_PASSWORD),
    handle:      BSKY_HANDLE || null,
    session:     Boolean(bskySession),
    session_exp: bskySession ? new Date(bskySession.exp).toISOString() : null,
    last_post:   bskyLastPost ? new Date(bskyLastPost).toISOString() : null,
    queue_size:  bskyQueue.length,
    cooldown_remain_sec: Math.max(0, Math.floor((bskyLastPost + BSKY_MIN_INTERVAL - Date.now()) / 1000)),
  });
});

app.post('/api/admin/bsky/post', adminAuth, express.json(), async (req, res) => {
  const text = (req.body && req.body.text || '').slice(0, 300);
  if (!text) return res.status(400).json({ error: 'text required' });
  // Bypass rate-limit pour admin manual post
  const r = await bskyPostNow(text);
  if (!r.ok) return res.status(500).json(r);
  res.json(r);
});

// ─── TWITCH BOT ADMIN (task #24) ──────────────────────────────────────────
app.get('/api/admin/twitch/status', adminAuth, (req, res) => {
  res.json({
    enabled:    Boolean(TWITCH_CHANNEL && TWITCH_USERNAME && TWITCH_OAUTH),
    connected:  twitchReady,
    channel:    TWITCH_CHANNEL ? '#' + TWITCH_CHANNEL : null,
    username:   TWITCH_USERNAME || null,
    queue_size: twitchQueue.length,
    tokens:     twitchSendTokens,
  });
});

app.post('/api/admin/twitch/say', adminAuth, express.json(), (req, res) => {
  const msg = (req.body && req.body.message || '').slice(0, 480);
  if (!msg) return res.status(400).json({ error: 'message required' });
  if (!twitchReady) return res.status(503).json({ error: 'Twitch not connected' });
  twitchNotify(msg);
  res.json({ sent: true, message: msg });
});

// ─── GOLDEN SNAKE EVENT (task #20) ─────────────────────────────────────────
app.get('/api/events/golden', (req, res) => {
  res.json(getGoldenState());
});

// Admin toggle : start or stop a manual golden event
app.post('/api/admin/events/golden/toggle', adminAuth, express.json(), (req, res) => {
  const open = db.prepare(`SELECT * FROM events WHERE type='golden' AND ended_at IS NULL ORDER BY id DESC LIMIT 1`).get();
  const now  = Math.floor(Date.now() / 1000);
  if (open) {
    db.prepare(`UPDATE events SET ended_at=? WHERE id=?`).run(now, open.id);
    console.log(`⚡ Golden snake manual event #${open.id} closed`);
    twitchNotify(`⚡ Golden Snake event ended. Back to normal x1 rewards.`);
    discordNotify({
      title: '⚡ Golden Snake désactivé',
      description: `Event manuel clôturé (durée ${Math.floor((now - open.started_at)/60)}min)`,
      color: 0x888888,
      timestamp: new Date().toISOString(),
    });
    return res.json({ action: 'closed', event: { id: open.id, started_at: open.started_at, ended_at: now } });
  }
  const mult   = Math.max(1.1, Math.min(10, parseFloat((req.body && req.body.multiplier) || GOLDEN_MULTIPLIER)));
  const reason = (req.body && req.body.reason) || 'manual';
  const info = db.prepare(`INSERT INTO events (type, multiplier, started_at, reason) VALUES ('golden', ?, ?, ?)`).run(mult, now, reason);
  console.log(`⚡ Golden snake manual event #${info.lastInsertRowid} opened (x${mult})`);
  twitchNotify(`⚡⚡⚡ GOLDEN SNAKE MODE ON ⚡⚡⚡ x${mult} rewards on every claim! Play now → snowdiablo.xyz 🐍💰`);
  bskyNotify(`⚡ GOLDEN SNAKE MODE ACTIVE ⚡ Every claim gives x${mult} $SNAKE right now on SnakeCoin! 🐍💰 Play → https://snowdiablo.xyz #SnakeCoin #P2E #Polygon`);
  discordNotify({
    title: '⚡ GOLDEN SNAKE ACTIVÉ',
    description: `Event manuel lancé - multiplier **x${mult}** sur toutes les rewards.`,
    color: 0xFFD700,
    timestamp: new Date().toISOString(),
  });
  // Public feed aussi
  if (PUBLIC_FEED_WEBHOOK) {
    publicFeed({
      title: '⚡ GOLDEN SNAKE MODE ACTIVÉ',
      description: `Tous les scores rapportent **x${mult} SNAKE** maintenant 🐍💰\nJoue vite avant la fin !`,
      color: 0xFFD700,
      timestamp: new Date().toISOString(),
    });
  }
  res.json({ action: 'opened', event: { id: info.lastInsertRowid, multiplier: mult, started_at: now } });
});

// Admin list events history
app.get('/api/admin/events/history', adminAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM events ORDER BY id DESC LIMIT 50`).all();
  res.json(rows);
});

// ─── DAILY QUESTS (task #19) ───────────────────────────────────────────────
// 3 quêtes dérivées live depuis la DB — pas de table dédiée, reset auto à minuit UTC.
// Récompense = pure gamification (badges visuels). Le streak gère déjà le multiplier reward.
const DAILY_QUESTS = [
  { id: 'play_3',   name: '3 parties aujourd\'hui',    icon: '🎮', goal: 3,  type: 'games_count',  reward_msg: 'Warrior' },
  { id: 'score_25', name: 'Atteindre score ≥ 25',          icon: '🎯', goal: 25, type: 'max_score',    reward_msg: 'Sharpshooter' },
  { id: 'earn_5',   name: 'Gagner 5 SNAKE',             icon: '💰', goal: 5,  type: 'snake_earned', reward_msg: 'Collector' },
];

function computeQuestsForAddress(addr) {
  // cutoff = début du jour UTC
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const dayStart = Math.floor(now.getTime() / 1000);

  // games_count : nb de parties aujourd'hui (score_history)
  const gamesCount = db.prepare(`
    SELECT COUNT(*) as c FROM score_history WHERE address=? AND created_at >= ?
  `).get(addr, dayStart).c;

  // max_score : meilleur score aujourd'hui
  const maxScore = db.prepare(`
    SELECT COALESCE(MAX(score), 0) as m FROM score_history WHERE address=? AND created_at >= ?
  `).get(addr, dayStart).m;

  // snake_earned : somme des claims aujourd'hui (claims = source de verite reelle)
  // sessions.reward peut etre vide si la table sessions est prunee/non peuplee
  const claimsRows = db.prepare(`
    SELECT amount FROM claims WHERE address=? AND claimed_at >= ?
  `).all(addr, dayStart);
  const snakeEarned = claimsRows.reduce((sum, r) => {
    const n = Number(r.amount);
    // Heuristique : si > 1e15, c'est du wei (18 dec) -> divise. Sinon SNAKE direct.
    return sum + (isFinite(n) ? (n > 1e15 ? n / 1e18 : n) : 0);
  }, 0);

  const progressMap = {
    games_count:  gamesCount,
    max_score:    maxScore,
    snake_earned: snakeEarned,
  };

  let completedCount = 0;
  const quests = DAILY_QUESTS.map(q => {
    const progress = Math.min(progressMap[q.type] || 0, q.goal);
    const done = progress >= q.goal;
    if (done) completedCount++;
    return {
      id: q.id, name: q.name, icon: q.icon,
      goal: q.goal, progress, done,
      reward_msg: q.reward_msg,
      percent: Math.round((progress / q.goal) * 100),
    };
  });

  // next reset in seconds (midnight UTC)
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  const resetIn = Math.floor((tomorrow.getTime() - Date.now()) / 1000);

  return {
    quests,
    completed: completedCount,
    total: DAILY_QUESTS.length,
    all_done: completedCount === DAILY_QUESTS.length,
    reset_in_seconds: resetIn,
    day_utc: new Date(dayStart * 1000).toISOString().slice(0, 10),
  };
}

app.get('/api/quests/:address', (req, res) => {
  const addr = (req.params.address || '').toLowerCase();
  if (!ethers.isAddress(addr)) {
    // Pas d'address fournie → retourne les templates seulement
    return res.json({
      quests: DAILY_QUESTS.map(q => ({
        id: q.id, name: q.name, icon: q.icon, goal: q.goal,
        progress: 0, done: false, percent: 0, reward_msg: q.reward_msg,
      })),
      completed: 0, total: DAILY_QUESTS.length, all_done: false,
      reset_in_seconds: 86400, day_utc: new Date().toISOString().slice(0, 10),
    });
  }
  res.json(computeQuestsForAddress(addr));
});

// ─── CSV EXPORT (task #28) ─────────────────────────────────────────────────
function toCsv(rows, cols) {
  // RFC 4180: double-quote fields + escape internal quotes, CRLF
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = cols.join(',');
  const body = rows.map(r => cols.map(c => esc(r[c])).join(',')).join('\r\n');
  return header + '\r\n' + body + '\r\n';
}

app.get('/api/admin/export/claims.csv', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10000', 10), 100000);
  const rows = db.prepare(`
    SELECT nonce, address, amount, claimed_at
    FROM claims
    ORDER BY claimed_at DESC
    LIMIT ?
  `).all(limit);
  // amount is stored as string (wei-like or SNAKE depending on version) + claimed_at unix → ISO8601
  const enriched = rows.map(r => {
    const amtNum = Number(r.amount);
    // heuristique : si > 1e15, c'est en wei (18 dec), sinon c'est déjà en SNAKE
    const amtSnake = amtNum > 1e15 ? (amtNum / 1e18) : amtNum;
    return {
      nonce: r.nonce,
      address: r.address,
      amount_snake: amtSnake.toFixed(4),
      amount_raw: r.amount,
      claimed_at_iso: new Date(r.claimed_at * 1000).toISOString(),
      claimed_at_unix: r.claimed_at,
    };
  });
  const csv = toCsv(enriched, ['nonce','address','amount_snake','amount_raw','claimed_at_iso','claimed_at_unix']);
  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="snake-claims-${date}.csv"`);
  res.send('\ufeff' + csv);  // BOM for Excel UTF-8
  console.log(`[CSV] claims: ${enriched.length} rows served to ${req.ip}`);
});

app.get('/api/admin/export/sessions.csv', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10000', 10), 100000);
  const rows = db.prepare(`
    SELECT id, address, score, reward, validated, created_at
    FROM sessions
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  const enriched = rows.map(r => ({
    session_id: r.id,
    address: r.address,
    score: r.score,
    reward_snake: r.reward || 0,
    validated: r.validated ? 1 : 0,
    cheat_flag: (r.validated && r.reward === 0 && r.score === 0) ? 1 : 0,
    created_at_iso: new Date(r.created_at * 1000).toISOString(),
    created_at_unix: r.created_at,
  }));
  const csv = toCsv(enriched, ['session_id','address','score','reward_snake','validated','cheat_flag','created_at_iso','created_at_unix']);
  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="snake-sessions-${date}.csv"`);
  res.send('\ufeff' + csv);
  console.log(`[CSV] sessions: ${enriched.length} rows served to ${req.ip}`);
});

app.get('/api/admin/export/scores.csv', adminAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '10000', 10), 100000);
  const rows = db.prepare(`
    SELECT id, address, score, created_at
    FROM score_history
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  const enriched = rows.map(r => ({
    id: r.id,
    address: r.address,
    score: r.score,
    created_at_iso: new Date(r.created_at * 1000).toISOString(),
    created_at_unix: r.created_at,
  }));
  const csv = toCsv(enriched, ['id','address','score','created_at_iso','created_at_unix']);
  const date = new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="snake-scores-${date}.csv"`);
  res.send('\ufeff' + csv);
  console.log(`[CSV] scores: ${enriched.length} rows served to ${req.ip}`);
});

// ─── GROWTH TIME-SERIES (pour charts dashboard) ───────────────────────────────
app.get('/api/admin/growth', adminAuth, (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 90);
  // Timestamp cutoff : début de (now - days jours)
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  // Sessions/jour (score_history)
  const sessions = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') as day,
           COUNT(*) as count,
           COUNT(DISTINCT address) as unique_players
    FROM score_history
    WHERE created_at > ?
    GROUP BY day
    ORDER BY day ASC
  `).all(cutoff);

  // Claims/jour + SNAKE distribué/jour (claims.amount est en wei string)
  const claims = db.prepare(`
    SELECT strftime('%Y-%m-%d', claimed_at, 'unixepoch') as day,
           COUNT(*) as count,
           SUM(CAST(amount as REAL) / 1e18) as snake
    FROM claims
    WHERE claimed_at > ?
    GROUP BY day
    ORDER BY day ASC
  `).all(cutoff);

  // Cheat attempts/jour (sessions validées avec reward=0 et score=0)
  const cheats = db.prepare(`
    SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') as day,
           COUNT(*) as count
    FROM sessions
    WHERE created_at > ? AND validated=1 AND reward=0 AND score=0
    GROUP BY day
    ORDER BY day ASC
  `).all(cutoff);

  // Nouveaux joueurs/jour (date du 1er score_history par adresse)
  const newPlayers = db.prepare(`
    SELECT strftime('%Y-%m-%d', first_seen, 'unixepoch') as day,
           COUNT(*) as count
    FROM (
      SELECT address, MIN(created_at) as first_seen
      FROM score_history
      GROUP BY address
      HAVING first_seen > ?
    )
    GROUP BY day
    ORDER BY day ASC
  `).all(cutoff);

  res.json({
    days,
    sessions,
    claims,
    cheats,
    new_players: newPlayers,
  });
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
  // Pagination (task #56 : ne pas vomir toute la DB en un seul call)
  const topLimit      = Math.min(Math.max(parseInt(req.query.top_limit || '10', 10) || 10, 1), 50);
  const topOffset     = Math.max(parseInt(req.query.top_offset || '0', 10) || 0, 0);
  const claimsLimit   = Math.min(Math.max(parseInt(req.query.claims_limit || '20', 10) || 20, 1), 100);
  const claimsOffset  = Math.max(parseInt(req.query.claims_offset || '0', 10) || 0, 0);

  const sessions24h = db.prepare(`SELECT COUNT(*) as c FROM score_history WHERE created_at > strftime('%s','now','-1 day')`).get().c;
  const cheatAttempts = db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE validated=1 AND reward=0 AND score=0`).get().c;
  const topCount     = db.prepare(`SELECT COUNT(*) as c FROM leaderboard WHERE total_claimed > 0`).get().c;
  const claimsCount  = db.prepare(`SELECT COUNT(*) as c FROM claims`).get().c;
  const topWallets   = db.prepare(`SELECT address, best_score, total_claimed, games_played FROM leaderboard ORDER BY total_claimed DESC LIMIT ? OFFSET ?`).all(topLimit, topOffset);
  const recentClaims = db.prepare(`SELECT address, amount, claimed_at FROM claims ORDER BY claimed_at DESC LIMIT ? OFFSET ?`).all(claimsLimit, claimsOffset);
  const totalDistributed = db.prepare('SELECT COALESCE(SUM(total_claimed),0) as s FROM leaderboard').get().s;
  res.json({
    sessions24h,
    cheatAttempts,
    totalDistributed,
    topWallets,
    recentClaims,
    pagination: {
      top:     { limit: topLimit,    offset: topOffset,    total: topCount },
      claims:  { limit: claimsLimit, offset: claimsOffset, total: claimsCount },
    },
  });
});

// ─── BOOST CACHE CRON (task #71) ─────────────────────────────────────────────
// Rafraîchit les wallets "actifs" (joué dans les 14 derniers jours) toutes les 10 min.
// Batch de 20 wallets par cycle pour éviter flood RPC. Fail silently.
const BOOST_CRON_INTERVAL_MS = parseInt(process.env.BOOST_CRON_INTERVAL_MS || '600000', 10); // 10 min
const BOOST_CRON_BATCH_SIZE  = parseInt(process.env.BOOST_CRON_BATCH_SIZE  || '20', 10);
const BOOST_ACTIVE_WINDOW_SEC = 14 * 24 * 3600;

async function refreshBoostCacheBatch() {
  if (!BOOST_NFT_ADDRESS) return;
  const contract = getBoostContract();
  if (!contract) return;
  const cutoff = Math.floor(Date.now() / 1000) - BOOST_ACTIVE_WINDOW_SEC;
  // Pick wallets actifs dont le cache est le plus ancien (ou jamais cache)
  const rows = db.prepare(`
    SELECT lb.address AS wallet, COALESCE(bmc.updated_at, 0) AS last_update
    FROM leaderboard lb
    LEFT JOIN boost_mult_cache bmc ON bmc.wallet = lb.address
    WHERE lb.last_played >= ?
    ORDER BY last_update ASC
    LIMIT ?
  `).all(cutoff, BOOST_CRON_BATCH_SIZE);
  if (rows.length === 0) return;
  let ok = 0, fail = 0;
  for (const r of rows) {
    const res = await refreshBoostMultFor(r.wallet);
    if (res !== null) ok++; else fail++;
  }
  console.log(`[BOOST CRON] refreshed ${ok}/${rows.length} wallets (${fail} failed)`);
}

if (BOOST_NFT_ADDRESS) {
  setInterval(() => { refreshBoostCacheBatch().catch(() => {}); }, BOOST_CRON_INTERVAL_MS).unref?.();
  // Kick off initial refresh 30s après start (laisse le temps au RPC provider d'init)
  setTimeout(() => { refreshBoostCacheBatch().catch(() => {}); }, 30 * 1000).unref?.();
}

// ─── TOURNAMENTS CRON (task #69) ─────────────────────────────────────────────
// Toutes les 5 min : ferme les tournois expirés → distribue prizes (40/20/10 via
// signer wallet), marque status='closed'. Puis ensureTournamentOpen() pour rolling.
// Discord webhook annonce les winners. Idempotent : ne relance pas de payout si
// status déjà 'closed' ou si payout_tx_X déjà rempli.
const TOURNAMENT_CRON_INTERVAL_MS = parseInt(process.env.TOURNAMENT_CRON_INTERVAL_MS || '300000', 10); // 5 min

async function sendTournamentPayout(toAddr, amountWei, tournamentId, position) {
  const provider = getProvider();
  if (!provider) throw new Error('RPC provider non configuré');
  const signer = new ethers.Wallet(SIGNER_PK, provider);
  // Sanity : signer doit égaler PAYOUT_WALLET
  if (TOURNAMENT_PAYOUT_WALLET && signer.address.toLowerCase() !== TOURNAMENT_PAYOUT_WALLET) {
    console.warn(`[TOURNAMENT PAYOUT] signer (${signer.address}) ≠ PAYOUT_WALLET (${TOURNAMENT_PAYOUT_WALLET}) — paiement depuis le signer`);
  }
  const tx = await signer.sendTransaction({ to: toAddr, value: amountWei });
  console.log(`[TOURNAMENT #${tournamentId}] payout #${position} → ${toAddr} = ${ethers.formatEther(amountWei)} POL · tx=${tx.hash}`);
  const receipt = await tx.wait(1);
  if (receipt.status !== 1) throw new Error(`payout tx reverted: ${tx.hash}`);
  return tx.hash;
}

async function closeTournamentAndPayout(t) {
  // Mark 'closing' pour éviter double-exécution concurrente
  const marked = db.prepare(`
    UPDATE tournaments SET status = 'closing' WHERE id = ? AND status = 'open'
  `).run(t.id);
  if (marked.changes === 0) return; // déjà closing/closed par un autre worker

  const entries = getTournamentLeaderboard(t.id, 3);
  const pool    = BigInt(t.prize_pool_wei || '0');

  // Pas d'entrées → juste fermer, rien à payer
  if (entries.length === 0 || pool === 0n) {
    db.prepare(`UPDATE tournaments SET status = 'closed', closed_at = strftime('%s','now') WHERE id = ?`).run(t.id);
    console.log(`[TOURNAMENT #${t.id}] closed (no entries / empty pool)`);
    return;
  }

  const winners = [entries[0]?.wallet || null, entries[1]?.wallet || null, entries[2]?.wallet || null];
  const txHashes = [null, null, null];

  // Payouts sequentiels (40/20/10 % du pool). Si un payout fail, on arrête la chain.
  try {
    for (let i = 0; i < 3; i++) {
      if (!winners[i]) break;
      const amount = (pool * BigInt(TOURNAMENT_WINNERS_BPS[i])) / 10000n;
      if (amount === 0n) continue;
      txHashes[i] = await sendTournamentPayout(winners[i], amount, t.id, i + 1);
    }
  } catch (e) {
    console.error(`[TOURNAMENT #${t.id}] payout FAILED:`, e.message);
    db.prepare(`
      UPDATE tournaments
         SET status = 'failed',
             winner1 = ?, winner2 = ?, winner3 = ?,
             payout_tx_1 = ?, payout_tx_2 = ?, payout_tx_3 = ?,
             closed_at = strftime('%s','now')
       WHERE id = ?
    `).run(winners[0], winners[1], winners[2], txHashes[0], txHashes[1], txHashes[2], t.id);
    return;
  }

  db.prepare(`
    UPDATE tournaments
       SET status = 'closed',
           winner1 = ?, winner2 = ?, winner3 = ?,
           payout_tx_1 = ?, payout_tx_2 = ?, payout_tx_3 = ?,
           closed_at = strftime('%s','now')
     WHERE id = ?
  `).run(winners[0], winners[1], winners[2], txHashes[0], txHashes[1], txHashes[2], t.id);

  console.log(`[TOURNAMENT #${t.id}] closed. Winners paid: ${winners.filter(Boolean).length}`);

  // Discord announce (best-effort)
  if (DISCORD_WEBHOOK) {
    const lines = entries.slice(0, 3).map((e, i) => {
      const amountWei = (pool * BigInt(TOURNAMENT_WINNERS_BPS[i])) / 10000n;
      const medal = ['🥇','🥈','🥉'][i];
      return `${medal} \`${e.wallet.slice(0,6)}…${e.wallet.slice(-4)}\` — score **${e.best_score}** — **${ethers.formatEther(amountWei)} POL**`;
    });
    const body = {
      embeds: [{
        title: `🏆 Tournament #${t.id} — Winners`,
        description: lines.join('\n') || 'No entries',
        color: 0xffd700,
        fields: [
          { name: 'Prize pool', value: `${ethers.formatEther(pool)} POL`, inline: true },
          { name: 'Entries',    value: String(t.entries_count || entries.length), inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    };
    try {
      await fetch(DISCORD_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (_) { /* non-blocking */ }
  }
}

async function tournamentCronTick() {
  if (!TOURNAMENT_ENABLED) return;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    // Tournois expirés à clôturer
    const expired = db.prepare(`
      SELECT * FROM tournaments WHERE status = 'open' AND end_at <= ?
    `).all(nowSec);
    for (const t of expired) {
      await closeTournamentAndPayout(t);
    }
    // Ouvre un nouveau si besoin (rolling)
    ensureTournamentOpen();
  } catch (e) {
    console.error('[TOURNAMENT CRON] tick failed:', e.message);
  }
}

if (TOURNAMENT_ENABLED) {
  ensureTournamentOpen(); // bootstrap à chaud
  setInterval(() => { tournamentCronTick().catch(() => {}); }, TOURNAMENT_CRON_INTERVAL_MS).unref?.();
  // Tick initial 60s après start
  setTimeout(() => { tournamentCronTick().catch(() => {}); }, 60 * 1000).unref?.();
}

// ─── CLANS WEEKLY PAYOUT CRON (task #70) ─────────────────────────────────────
// Check toutes les heures : si dimanche 20h UTC passé ET pas encore payé cette semaine
// → calcule top 3 clans (somme scores 7j), distribue pool SNAKE via signer transfer,
// insère row clan_weekly_payouts. Idempotent via (week_start) unique check.
const CLAN_WEEKLY_CRON_INTERVAL_MS = parseInt(process.env.CLAN_WEEKLY_CRON_INTERVAL_MS || '3600000', 10); // 1h

function _lastSundayAt20UTC(now = new Date()) {
  const n = new Date(now);
  const day = n.getUTCDay(); // 0=sun
  const daysBack = day === 0 && n.getUTCHours() < 20 ? 7 : day;
  const s = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() - daysBack, 20, 0, 0));
  return Math.floor(s.getTime() / 1000);
}

async function clanWeeklyPayoutTick() {
  if (!CLAN_ENABLED) return;
  const poolSnakeWei = (() => {
    try { return ethers.parseUnits(String(CLAN_WEEKLY_POOL_SNAKE || '0'), 18); }
    catch { return 0n; }
  })();
  if (poolSnakeWei === 0n) return; // désactivé

  const nowSec = Math.floor(Date.now() / 1000);
  const weekStart = _lastSundayAt20UTC(new Date(nowSec * 1000));
  const weekEnd   = weekStart + 7 * 24 * 3600;
  // Trop tôt (dimanche 20h UTC pas encore passé cette semaine) : skip
  if (nowSec < weekStart) return;

  // Idempotence
  const already = db.prepare('SELECT id FROM clan_weekly_payouts WHERE week_start = ?').get(weekStart);
  if (already) return;

  // Top 3 clans sur la fenêtre [weekStart-7d, weekStart]
  const periodStart = weekStart - 7 * 24 * 3600;
  const top3 = db.prepare(`
    SELECT c.id, c.name, c.tag, c.owner,
           COALESCE(SUM(CASE WHEN sh.created_at >= ? AND sh.created_at < ? THEN sh.score ELSE 0 END), 0) AS weekly_score
      FROM clans c
      LEFT JOIN clan_members cm ON cm.clan_id = c.id
      LEFT JOIN score_history sh ON sh.address = cm.wallet
     WHERE c.active = 1
     GROUP BY c.id
    HAVING weekly_score > 0
     ORDER BY weekly_score DESC
     LIMIT 3
  `).all(periodStart, weekStart);

  if (top3.length === 0) {
    db.prepare(`
      INSERT INTO clan_weekly_payouts (week_start, week_end, pool_wei, executed_at)
      VALUES (?, ?, ?, ?)
    `).run(weekStart, weekEnd, poolSnakeWei.toString(), nowSec);
    console.log(`[CLAN WEEKLY] week ${new Date(weekStart*1000).toISOString()} — no eligible clans`);
    return;
  }

  // Transfer SNAKE aux owners (ERC-20 transfer via signer)
  const provider = getProvider();
  const signer = provider ? new ethers.Wallet(SIGNER_PK, provider) : null;
  const erc20Abi = ['function transfer(address to, uint256 amount) returns (bool)'];
  const contract = (signer && CONTRACT_ADDRESS) ? new ethers.Contract(CONTRACT_ADDRESS, erc20Abi, signer) : null;

  for (let i = 0; i < top3.length; i++) {
    const amount = (poolSnakeWei * BigInt(CLAN_WEEKLY_SPLIT_BPS[i])) / 10000n;
    if (amount === 0n || !contract) continue;
    try {
      const tx = await contract.transfer(top3[i].owner, amount);
      console.log(`[CLAN WEEKLY] payout #${i+1} ${top3[i].tag} → ${shortAddr(top3[i].owner)} = ${ethers.formatUnits(amount, 18)} $SNAKE · tx=${tx.hash}`);
      await tx.wait(1);
    } catch (e) {
      console.error(`[CLAN WEEKLY] payout #${i+1} FAILED:`, e.message);
    }
  }

  db.prepare(`
    INSERT INTO clan_weekly_payouts
      (week_start, week_end, clan1_id, clan2_id, clan3_id, clan1_score, clan2_score, clan3_score, pool_wei, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    weekStart, weekEnd,
    top3[0]?.id || null, top3[1]?.id || null, top3[2]?.id || null,
    top3[0]?.weekly_score || 0, top3[1]?.weekly_score || 0, top3[2]?.weekly_score || 0,
    poolSnakeWei.toString(), nowSec,
  );

  // Discord announce
  if (DISCORD_WEBHOOK) {
    const lines = top3.map((c, i) => {
      const medal = ['🥇','🥈','🥉'][i];
      const amt = (poolSnakeWei * BigInt(CLAN_WEEKLY_SPLIT_BPS[i])) / 10000n;
      return `${medal} **[${c.tag}]** ${c.name} — score **${c.weekly_score}** — **${ethers.formatUnits(amt, 18)} $SNAKE**`;
    });
    try {
      await fetch(DISCORD_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: '🛡️ Clans — Top 3 Weekly',
            description: lines.join('\n'),
            color: 0x9333ea,
            fields: [{ name: 'Pool', value: `${ethers.formatUnits(poolSnakeWei, 18)} $SNAKE`, inline: true }],
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch (_) {}
  }
}

if (CLAN_ENABLED) {
  setInterval(() => { clanWeeklyPayoutTick().catch(() => {}); }, CLAN_WEEKLY_CRON_INTERVAL_MS).unref?.();
  // Tick initial 90s après start
  setTimeout(() => { clanWeeklyPayoutTick().catch(() => {}); }, 90 * 1000).unref?.();
}

// ─── Signer balance monitor (task #98) ────────────────────────────────────────
// Le signer backend paye le gas des tournament payouts + NFT mint signatures.
// S'il se vide sans qu'on s'en rende compte, les payouts échouent silencieusement
// et les tournois restent coincés en status='closing'. On poll la balance toutes
// les 6h et on ping le webhook Discord staff si < SIGNER_MIN_POL.
const SIGNER_MIN_POL   = parseFloat(process.env.SIGNER_MIN_POL   || '3');
const SIGNER_CHECK_H   = parseFloat(process.env.SIGNER_CHECK_H   || '6');
const SIGNER_ALERT_URL = process.env.SIGNER_LOW_ALERT_WEBHOOK || process.env.DISCORD_WEBHOOK || '';
let _signerLastAlertTs = 0;
async function signerBalanceTick() {
  const p = getProvider();
  if (!p) return; // pas de RPC configuré → skip silencieusement
  try {
    const bal = await p.getBalance(wallet.address);
    const pol = parseFloat(ethers.formatEther(bal));
    if (pol < SIGNER_MIN_POL) {
      // Debounce : 1 alerte / 12h max, évite spam si stuck
      const now = Date.now();
      if (now - _signerLastAlertTs > 12 * 3600 * 1000) {
        _signerLastAlertTs = now;
        console.warn(`⚠️  SIGNER LOW POL: ${pol.toFixed(3)} < ${SIGNER_MIN_POL}`);
        if (SIGNER_ALERT_URL) {
          try {
            await fetch(SIGNER_ALERT_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: `⚠️ **Signer POL LOW**\nWallet: \`${wallet.address}\`\nBalance: **${pol.toFixed(3)} POL** (threshold ${SIGNER_MIN_POL})\nTop up ASAP ou les payouts tournament / NFT mint vont fail.`
              }),
            });
          } catch (e) { console.warn('signer alert webhook failed:', e.message); }
        }
      }
    } else {
      // Reset debounce si la balance est revenue au-dessus
      if (_signerLastAlertTs) _signerLastAlertTs = 0;
    }
  } catch (e) {
    console.warn('⚠️ signerBalanceTick RPC err:', e.message);
  }
}
// Tick initial 60s après start pour laisser le temps au RPC de répondre,
// puis toutes les SIGNER_CHECK_H heures.
setTimeout(() => { signerBalanceTick().catch(() => {}); }, 60 * 1000).unref?.();
setInterval(() => { signerBalanceTick().catch(() => {}); }, SIGNER_CHECK_H * 3600 * 1000).unref?.();

// ─── Cleanup sessions consommées (fix race condition /api/claim) ──────────
// Les sessions claimées (claim_nonce != NULL) sont gardées 1h pour permettre
// un retry si le mint on-chain a revert. Après 1h on les purge pour ne pas
// faire gonfler la table.
function cleanupClaimedSessions() {
  try {
    const cutoff = Math.floor(Date.now() / 1000) - 3600;
    const r = db.prepare('DELETE FROM sessions WHERE claim_nonce IS NOT NULL AND claimed_at < ?').run(cutoff);
    if (r.changes > 0) console.log(`🧹 Purged ${r.changes} claimed sessions (> 1h old)`);
  } catch (e) {
    console.warn('cleanupClaimedSessions err:', e.message);
  }
}
setInterval(cleanupClaimedSessions, 10 * 60 * 1000).unref?.(); // toutes les 10 min

const server = app.listen(PORT, () => {
  console.log(`🐍 SnakeCoin backend running on port ${PORT}`);
  console.log(`💼 Contract $SNAKE : ${CONTRACT_ADDRESS || '⚠️ NON CONFIGURÉ'}`);
  console.log(`🏆 Contract NFT    : ${NFT_CONTRACT_ADDRESS || '⚠️ NON CONFIGURÉ (set NFT_CONTRACT_ADDRESS)'}`);
  console.log(`🚀 Contract BOOST  : ${BOOST_NFT_ADDRESS  || '⚠️ NON CONFIGURÉ (set BOOST_NFT_ADDRESS — optional)'}`);
  if (BOOST_NFT_ADDRESS) {
    const cached = db.prepare('SELECT COUNT(*) AS c FROM boost_mult_cache').get().c;
    console.log(`   └─ boost cache: ${cached} wallets · cron every ${Math.round(BOOST_CRON_INTERVAL_MS/1000)}s · batch ${BOOST_CRON_BATCH_SIZE}`);
  }
  console.log(`🏆 Tournaments    : ${TOURNAMENT_ENABLED ? `ENABLED (entry ${TOURNAMENT_ENTRY_POL} POL, ${TOURNAMENT_DURATION_H}h rolling)` : 'disabled (set TOURNAMENT_ENABLED=1)'}`);
  if (TOURNAMENT_ENABLED) {
    const open = db.prepare(`SELECT COUNT(*) AS c FROM tournaments WHERE status='open'`).get().c;
    const total = db.prepare(`SELECT COUNT(*) AS c FROM tournaments`).get().c;
    console.log(`   └─ ${open} open · ${total} total · payout_wallet=${TOURNAMENT_PAYOUT_WALLET || '⚠️ missing'}`);
  }
  console.log(`🛡️  Clans          : ${CLAN_ENABLED ? `ENABLED (create burn ${CLAN_CREATE_BURN_AMOUNT} $SNAKE · max ${CLAN_MAX_MEMBERS} members)` : 'disabled (set CLAN_ENABLED=1)'}`);
  if (CLAN_ENABLED) {
    const nClans = db.prepare(`SELECT COUNT(*) AS c FROM clans WHERE active = 1`).get().c;
    const nMem   = db.prepare(`SELECT COUNT(*) AS c FROM clan_members`).get().c;
    console.log(`   └─ ${nClans} clans · ${nMem} members · weekly pool=${CLAN_WEEKLY_POOL_SNAKE} $SNAKE`);
  }
  // Royalty mode (task #96)
  if (CLAN_FEE_WALLET || USERNAME_FEE_WALLET) {
    console.log(`💰 Royalty mode    : ENABLED`);
    if (CLAN_FEE_WALLET)     console.log(`   └─ Clan create    → ${CLAN_FEE_WALLET}`);
    if (USERNAME_FEE_WALLET) console.log(`   └─ Username paid  → ${USERNAME_FEE_WALLET}`);
  } else {
    console.log(`💰 Royalty mode    : disabled (100% burn · set CLAN_FEE_WALLET / USERNAME_FEE_WALLET to enable)`);
  }
  if (DISCORD_WEBHOOK)     console.log('🤖 Discord webhook enabled (staff)');
  if (PUBLIC_FEED_WEBHOOK) console.log('📢 Public feed webhook enabled (#snake-feed)');
  if (ADMIN_TOKEN)         console.log('🔐 Admin token configured');
  console.log(`🛡️  Wallet proof (EIP-191) : ${REQUIRE_WALLET_PROOF ? 'ENFORCE' : 'warn-only (set REQUIRE_WALLET_PROOF=1 to enforce)'}`);
});

// ─── Global error handlers + graceful shutdown (task #96) ────────────────────
// Sans ça, une promise reject non-catch ou une exception dans un setInterval
// crash le process silencieusement. Railway relance mais on perd les requêtes
// en vol et la DB peut rester dans un état sale (write in progress interrompu).
// On log la trace complète puis on exit(1) → Railway fera un restart propre.
// Pour SIGTERM (redeploy Railway) : on close le HTTP server (drain requêtes en
// cours ~5s max), puis on close la DB SQLite pour flush les writes, puis exit.
function _emergencyLog(tag, err) {
  try {
    console.error(`❌ ${tag}:`, err && err.stack ? err.stack : err);
  } catch (_) { /* console itself broken — last resort */ }
}

process.on('uncaughtException', (err) => {
  _emergencyLog('uncaughtException', err);
  // Best-effort webhook ping (optional) avant de crasher
  if (typeof DISCORD_WEBHOOK === 'string' && DISCORD_WEBHOOK) {
    try {
      fetch(DISCORD_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🔥 **Backend crash** (uncaughtException)\n\`\`\`${String(err && err.stack || err).slice(0, 1800)}\`\`\`` }),
      }).catch(() => {});
    } catch (_) {}
  }
  // Petite latence pour laisser le webhook partir puis exit → Railway restart
  setTimeout(() => process.exit(1), 500).unref?.();
});

process.on('unhandledRejection', (reason) => {
  _emergencyLog('unhandledRejection', reason);
  setTimeout(() => process.exit(1), 500).unref?.();
});

let _shuttingDown = false;
function gracefulShutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`⏹️  ${signal} received → graceful shutdown`);
  // Max 10s pour drainer, sinon force exit
  const killTimer = setTimeout(() => {
    console.warn('⏱️  shutdown timeout — force exit');
    process.exit(1);
  }, 10_000);
  killTimer.unref?.();
  server.close((err) => {
    if (err) _emergencyLog('server.close error', err);
    try { db.close(); console.log('📦 SQLite closed cleanly'); } catch (e) { _emergencyLog('db.close error', e); }
    clearTimeout(killTimer);
    process.exit(0);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Railway / Docker stop
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));  // Ctrl+C local

