'use strict';

const { Server } = require('socket.io');

// ─── Constants ────────────────────────────────────────────────────────────────
const WORLD        = 4000;
const TICK_MS      = 50;       // 20 FPS server tick
const ROUND_SECS   = 120;
const MAX_PLAYERS  = 8;
const MIN_TO_START = 2;
const BASE_SPEED   = 210;      // px/s at size 1
const SPEED_DECAY  = 0.10;
const HOLE_BASE_R  = 32;
const R_PER_SIZE   = 14;
const RESPAWN_MS   = 3500;

const OBJECTS = {
  coin:     { pts: 5,   sizeReq: 0.5, r: 13, color: '#FFD700', count: 160 },
  plant:    { pts: 12,  sizeReq: 0.8, r: 18, color: '#66BB6A', count: 80  },
  hydrant:  { pts: 18,  sizeReq: 1.0, r: 20, color: '#EF5350', count: 55  },
  bench:    { pts: 25,  sizeReq: 1.2, r: 24, color: '#A1887F', count: 45  },
  lamppost: { pts: 28,  sizeReq: 1.3, r: 22, color: '#FFC107', count: 40  },
  tree:     { pts: 42,  sizeReq: 1.6, r: 32, color: '#2E7D32', count: 45  },
  car:      { pts: 110, sizeReq: 3.2, r: 46, color: '#1565C0', count: 22  },
  truck:    { pts: 175, sizeReq: 5.0, r: 60, color: '#E65100', count: 12  },
  building: { pts: 260, sizeReq: 7.5, r: 78, color: '#37474F', count: 8   },
};

const COLORS = [
  '#FF6B6B','#4ECDC4','#45B7D1','#96E6A1',
  '#DDA0DD','#FFD93D','#FF8C69','#A8E6CF',
];

// ─── State ────────────────────────────────────────────────────────────────────
let _oid  = 1;
let _rid  = 1;
const rooms = new Map();

// ─── GameRoom ─────────────────────────────────────────────────────────────────
class GameRoom {
  constructor() {
    this.id        = _rid++;
    this.players   = new Map();
    this.objects   = new Map();
    this.state     = 'waiting';
    this.timeLeft  = ROUND_SECS;
    this._loop     = null;
    this._last     = 0;
    this._ci       = 0;
    this._io       = null;
    this._newObjs  = [];   // objects spawned since last broadcast
    this._generate();
  }

  _generate() {
    for (const [type, cfg] of Object.entries(OBJECTS)) {
      for (let i = 0; i < cfg.count; i++) this._spawnOne(type, cfg);
    }
  }

  _spawnOne(type, cfg) {
    const id = _oid++;
    const obj = {
      id, type,
      x: 120 + Math.random() * (WORLD - 240),
      y: 120 + Math.random() * (WORLD - 240),
      r: cfg.r, pts: cfg.pts, sizeReq: cfg.sizeReq, color: cfg.color,
    };
    this.objects.set(id, obj);
    return obj;
  }

  addPlayer(sid, name) {
    const color = COLORS[this._ci++ % COLORS.length];
    const p = {
      id: sid,
      name: (name || 'Joueur').slice(0, 16).replace(/[<>&"]/g, ''),
      x: 300 + Math.random() * (WORLD - 600),
      y: 300 + Math.random() * (WORLD - 600),
      tx: null, ty: null,
      size: 1.0, r: HOLE_BASE_R,
      score: 0, alive: true, color,
      respawnAt: 0,
    };
    this.players.set(sid, p);
    return p;
  }

  removePlayer(sid) {
    this.players.delete(sid);
    if (this.players.size === 0 && this.state === 'playing') this._end();
  }

  start(io) {
    this._io     = io;
    this.state   = 'playing';
    this.timeLeft = ROUND_SECS;
    this._last   = Date.now();
    this._loop   = setInterval(() => this._tick(), TICK_MS);
  }

  _tick() {
    const now = Date.now();
    const dt  = (now - this._last) / 1000;
    this._last = now;
    this.timeLeft -= dt;

    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._end();
      return;
    }

    const consumed   = [];
    const eliminated = [];

    // ── Move players ──────────────────────────────────────────────────────────
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (p.tx === null) continue;
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d  = Math.hypot(dx, dy);
      if (d < 5) continue;
      const speed = BASE_SPEED / (1 + p.size * SPEED_DECAY);
      const step  = Math.min(d, speed * dt);
      p.x = clamp(p.x + (dx / d) * step, p.r, WORLD - p.r);
      p.y = clamp(p.y + (dy / d) * step, p.r, WORLD - p.r);
    }

    // ── Player vs objects ─────────────────────────────────────────────────────
    for (const p of this.players.values()) {
      if (!p.alive) continue;
      for (const obj of this.objects.values()) {
        if (p.size < obj.sizeReq) continue;
        if (Math.hypot(p.x - obj.x, p.y - obj.y) < p.r * 0.78) {
          p.score += obj.pts;
          p.size  += obj.pts * 0.0022;
          p.r      = HOLE_BASE_R + (p.size - 1) * R_PER_SIZE;
          consumed.push({ id: obj.id, by: p.id });
          this.objects.delete(obj.id);
        }
      }
    }

    // ── Player vs player ──────────────────────────────────────────────────────
    const alive = [...this.players.values()].filter(q => q.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < Math.max(a.r, b.r) * 0.68) {
          if (a.size > b.size * 1.12)      this._eat(a, b, eliminated);
          else if (b.size > a.size * 1.12) this._eat(b, a, eliminated);
        }
      }
    }

    // ── Respawn ───────────────────────────────────────────────────────────────
    for (const p of this.players.values()) {
      if (!p.alive && now >= p.respawnAt) {
        p.alive  = true;
        p.x      = 300 + Math.random() * (WORLD - 600);
        p.y      = 300 + Math.random() * (WORLD - 600);
        p.size   = 1;
        p.r      = HOLE_BASE_R;
        p.tx = p.ty = null;
      }
    }

    // ── Refill world ──────────────────────────────────────────────────────────
    const newBatch = [];
    if (this.objects.size < 350) {
      for (const [type, cfg] of Object.entries(OBJECTS)) {
        const obj = this._spawnOne(type, cfg);
        newBatch.push(obj);
        if (newBatch.length >= 30) break;
      }
    }

    // ── Leaderboard ───────────────────────────────────────────────────────────
    const lb = [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, id: p.id, name: p.name, score: Math.floor(p.score), color: p.color }));

    // ── Broadcast ─────────────────────────────────────────────────────────────
    const payload = {
      p: [...this.players.values()].map(p => ({
        id: p.id, x: ~~p.x, y: ~~p.y, r: ~~p.r,
        score: Math.floor(p.score), alive: p.alive, color: p.color, name: p.name,
      })),
      t: Math.ceil(this.timeLeft),
      lb,
      c: consumed.length  ? consumed  : undefined,
      e: eliminated.length ? eliminated : undefined,
      n: newBatch.length  ? newBatch  : undefined,
    };

    for (const sid of this.players.keys()) {
      const sock = this._io?.sockets.sockets.get(sid);
      if (sock) sock.emit('S', payload);
    }
  }

  _eat(big, small, eliminated) {
    big.score += 200 + small.score * 0.14;
    big.size  += 0.45 + small.size * 0.22;
    big.r      = HOLE_BASE_R + (big.size - 1) * R_PER_SIZE;
    small.alive     = false;
    small.score     = Math.floor(small.score * 0.55);
    small.size      = 1;
    small.r         = HOLE_BASE_R;
    small.respawnAt = Date.now() + RESPAWN_MS;
    eliminated.push({ id: small.id, by: big.id });
  }

  _end() {
    if (this._loop) { clearInterval(this._loop); this._loop = null; }
    this.state = 'finished';
    const results = [...this.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p, i) => ({ rank: i + 1, name: p.name, score: Math.floor(p.score), color: p.color, id: p.id }));
    for (const sid of this.players.keys()) {
      this._io?.sockets.sockets.get(sid)?.emit('over', { results });
    }
    setTimeout(() => rooms.delete(this.id), 30_000);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function findRoom() {
  for (const r of rooms.values()) {
    if (r.state === 'waiting' && r.players.size < MAX_PLAYERS) return r;
  }
  const r = new GameRoom();
  rooms.set(r.id, r);
  return r;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function initHoleGame(httpServer) {
  const allowedOrigins = [
    'https://snowdiablo.xyz',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ];

  const io = new Server(httpServer, {
    path: '/hole-ws',
    cors: {
      origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(null, true); // permissive for now; tighten when domain is final
      },
      methods: ['GET', 'POST'],
    },
    pingInterval: 6000,
    pingTimeout:  12000,
    maxHttpBufferSize: 1e4,
  });

  io.on('connection', (socket) => {
    let room   = null;
    let player = null;

    socket.on('join', ({ name }) => {
      if (room) return; // already in a room
      room   = findRoom();
      player = room.addPlayer(socket.id, name);
      socket.join(`r${room.id}`);

      socket.emit('joined', {
        pid: socket.id,
        player,
        world: WORLD,
        objects: [...room.objects.values()],
        players: [...room.players.values()],
        roomId: room.id,
        state: room.state,
        maxPlayers: MAX_PLAYERS,
        minToStart: MIN_TO_START,
      });

      socket.to(`r${room.id}`).emit('pJoin', { player });

      if (room.state === 'waiting' && room.players.size >= MIN_TO_START) {
        const r = room;
        setTimeout(() => {
          if (r.state !== 'waiting') return;
          if (r.players.size < MIN_TO_START) return;
          r.start(io);
          io.to(`r${r.id}`).emit('start', { t: ROUND_SECS });
        }, 3000);
      }
    });

    socket.on('I', ({ tx, ty }) => {
      if (player && room?.state === 'playing' && player.alive) {
        player.tx = typeof tx === 'number' ? tx : null;
        player.ty = typeof ty === 'number' ? ty : null;
      }
    });

    socket.on('disconnect', () => {
      if (room && player) {
        room.removePlayer(socket.id);
        io.to(`r${room.id}`).emit('pLeave', { id: socket.id });
      }
    });
  });

  console.log('🕳️  Hole game server attached on /hole-ws');
  return io;
}

module.exports = { initHoleGame };
