/* ===================================================================
   SnowDiablo Arcade — Flappy Bird engine
   Canvas 2D, 60fps, self-contained.
   Public API:
     new FlappyGame(canvas, { onScore, onTokensPreview, onGameOver })
     game.start() / game.stop() / game.flap() / game.running / game.highScore
   Physics : gravity + impulsive jump. Procedural pipe spawn with increasing difficulty.
   Scoring : +1 per pipe cleared. 10 pipes = 1 $SNAKE (client preview).
   =================================================================== */

const W = 400;
const H = 600;

// Bird
const BIRD_X = 100;
const BIRD_R = 14;
const GRAVITY = 0.32;
const JUMP_V = -7.2;
const MAX_FALL = 9;

// Pipes
const PIPE_W = 68;
const PIPE_GAP_BASE = 205;    // easy at start
const PIPE_GAP_MIN  = 155;    // hard cap
const PIPE_SPEED_BASE = 2.2;
const PIPE_SPEED_MAX  = 4.8;
const PIPE_SPAWN_BASE = 120;  // frames between spawns
const PIPE_SPAWN_MIN  = 85;

// Rails
const GROUND_H = 48;
const CEILING_H = 0;

export class FlappyGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    this.onScore = callbacks.onScore || (() => {});
    this.onTokensPreview = callbacks.onTokensPreview || (() => {});
    this.onGameOver = callbacks.onGameOver || (() => {});

    this.running = false;
    this.highScore = Number(localStorage.getItem('flappyHi') || 0);

    this._rafId = null;
    this._frame = 0;

    this._reset();
    this._drawIdle();
  }

  _reset() {
    this.bird = { y: H / 2, vy: 0, rot: 0 };
    this.pipes = [];
    this.score = 0;
    this._frame = 0;
    this._lastSpawn = 0;
  }

  start() {
    if (this.running) return;
    this._reset();
    this.running = true;
    this.onScore(0);
    this.onTokensPreview(0);
    this._loop();
  }

  stop() {
    this.running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  flap() {
    if (!this.running) return;
    this.bird.vy = JUMP_V;
  }

  // ===== Main loop =====
  _loop = () => {
    if (!this.running) return;
    this._tick();
    this._draw();
    this._rafId = requestAnimationFrame(this._loop);
  };

  _difficulty() {
    // Progressive scale : 0.0 at score 0 -> 1.0 at score 40
    return Math.min(1, this.score / 40);
  }

  _currentSpeed() {
    const k = this._difficulty();
    return PIPE_SPEED_BASE + (PIPE_SPEED_MAX - PIPE_SPEED_BASE) * k;
  }

  _currentGap() {
    const k = this._difficulty();
    return PIPE_GAP_BASE - (PIPE_GAP_BASE - PIPE_GAP_MIN) * k;
  }

  _currentSpawnInterval() {
    const k = this._difficulty();
    return Math.round(PIPE_SPAWN_BASE - (PIPE_SPAWN_BASE - PIPE_SPAWN_MIN) * k);
  }

  _tick() {
    this._frame++;

    // Bird physics
    this.bird.vy = Math.min(this.bird.vy + GRAVITY, MAX_FALL);
    this.bird.y += this.bird.vy;
    // Rotation : nose up on jump, nose down when falling
    this.bird.rot = Math.max(-0.6, Math.min(1.1, this.bird.vy / 10));

    // Spawn pipes
    const spawnEvery = this._currentSpawnInterval();
    if (this._frame - this._lastSpawn >= spawnEvery) {
      this._lastSpawn = this._frame;
      const gap = this._currentGap();
      const minTop = 40;
      const maxTop = H - GROUND_H - gap - 40;
      const gapTop = minTop + Math.random() * Math.max(0, maxTop - minTop);
      this.pipes.push({
        x: W + 10,
        gapTop,
        gap,
        passed: false
      });
    }

    // Move & cull pipes
    const sp = this._currentSpeed();
    for (const p of this.pipes) p.x -= sp;
    this.pipes = this.pipes.filter(p => p.x + PIPE_W > -10);

    // Score pipes behind bird
    for (const p of this.pipes) {
      if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
        p.passed = true;
        this.score++;
        this.onScore(this.score);
        this.onTokensPreview(this.score / 10);
      }
    }

    // Collisions : ground
    if (this.bird.y + BIRD_R >= H - GROUND_H) {
      this._gameOver();
      return;
    }
    // Collisions : ceiling
    if (this.bird.y - BIRD_R <= CEILING_H) {
      this.bird.y = CEILING_H + BIRD_R;
      this.bird.vy = 0;
    }
    // Collisions : pipes (AABB vs circle approx)
    for (const p of this.pipes) {
      if (p.x > BIRD_X + BIRD_R) break;               // future pipe
      if (p.x + PIPE_W < BIRD_X - BIRD_R) continue;   // past pipe
      // X overlap confirmed. Check Y : bird must fit inside gap
      const gapTop = p.gapTop;
      const gapBot = gapTop + p.gap;
      if (this.bird.y - BIRD_R < gapTop || this.bird.y + BIRD_R > gapBot) {
        this._gameOver();
        return;
      }
    }
  }

  _gameOver() {
    this.running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem('flappyHi', String(this.score)); } catch {}
    }
    const tokens = Math.floor((this.score / 10) * 100) / 100;
    this.onGameOver({ score: this.score, tokens });
  }

  // ===== Rendering =====
  _drawIdle() {
    this._drawBackground();
    this._drawGround();
    this._drawBird(H / 2);
    this._drawHUD('TAP SPACE');
  }

  _draw() {
    this._drawBackground();
    for (const p of this.pipes) this._drawPipe(p);
    this._drawGround();
    this._drawBird(this.bird.y, this.bird.rot);
    this._drawHUD(String(this.score));
  }

  _drawBackground() {
    const ctx = this.ctx;
    // Deep space gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0a0a1a');
    grad.addColorStop(0.6, '#10002a');
    grad.addColorStop(1, '#1a0033');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle starfield (deterministic per frame row)
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    const seed = Math.floor(this._frame / 4);
    for (let i = 0; i < 24; i++) {
      const x = (i * 97 + seed * 3) % W;
      const y = (i * 53 + seed * 2) % (H - GROUND_H);
      ctx.fillRect(x, y, 1, 1);
    }
  }

  _drawPipe(p) {
    const ctx = this.ctx;
    const gapTop = p.gapTop;
    const gapBot = p.gapTop + p.gap;

    // Neon pipes (green)
    ctx.save();
    ctx.shadowColor = '#00ffa6';
    ctx.shadowBlur = 14;

    // Top pipe
    ctx.fillStyle = '#0a5030';
    ctx.fillRect(p.x, 0, PIPE_W, gapTop);
    ctx.strokeStyle = '#00ffa6';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x + 1, 1, PIPE_W - 2, gapTop - 1);
    // Cap
    ctx.fillStyle = '#0c6a3f';
    ctx.fillRect(p.x - 4, gapTop - 18, PIPE_W + 8, 18);
    ctx.strokeRect(p.x - 3, gapTop - 17, PIPE_W + 6, 16);

    // Bottom pipe
    ctx.fillStyle = '#0a5030';
    ctx.fillRect(p.x, gapBot, PIPE_W, H - GROUND_H - gapBot);
    ctx.strokeRect(p.x + 1, gapBot + 1, PIPE_W - 2, H - GROUND_H - gapBot - 2);
    // Cap
    ctx.fillStyle = '#0c6a3f';
    ctx.fillRect(p.x - 4, gapBot, PIPE_W + 8, 18);
    ctx.strokeRect(p.x - 3, gapBot + 1, PIPE_W + 6, 16);

    ctx.restore();
  }

  _drawGround() {
    const ctx = this.ctx;
    ctx.fillStyle = '#1a0f00';
    ctx.fillRect(0, H - GROUND_H, W, GROUND_H);
    ctx.strokeStyle = '#ff6b00';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ff6b00';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(0, H - GROUND_H + 1);
    ctx.lineTo(W, H - GROUND_H + 1);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Diagonal stripes
    ctx.strokeStyle = 'rgba(255,107,0,0.35)';
    ctx.lineWidth = 1;
    const offset = -((this._frame * this._currentSpeed()) % 20);
    for (let x = offset; x < W + 20; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, H - GROUND_H + 8);
      ctx.lineTo(x + 10, H - 8);
      ctx.stroke();
    }
  }

  _drawBird(y, rot = 0) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(BIRD_X, y);
    ctx.rotate(rot);

    // Body
    ctx.shadowColor = '#ffc800';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.arc(0, 0, BIRD_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Wing
    ctx.fillStyle = '#ffffff';
    const wingFlap = Math.sin(this._frame / 4) * 3;
    ctx.beginPath();
    ctx.ellipse(-3, 2 + wingFlap, 7, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eye
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(5, -4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(6, -4, 2, 0, Math.PI * 2);
    ctx.fill();

    // Beak
    ctx.fillStyle = '#ff6b00';
    ctx.beginPath();
    ctx.moveTo(BIRD_R - 2, -1);
    ctx.lineTo(BIRD_R + 8, 2);
    ctx.lineTo(BIRD_R - 2, 5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  _drawHUD(text) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(W / 2 - 50, 12, 100, 42);
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 50 + 0.5, 12 + 0.5, 100, 42);
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 28px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    ctx.fillText(text, W / 2, 33);
    ctx.shadowBlur = 0;
  }
}
