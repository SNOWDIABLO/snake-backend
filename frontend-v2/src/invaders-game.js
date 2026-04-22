/* ===================================================================
   SnowDiablo Arcade — Space Invaders engine
   Canvas 2D, 60fps. Player ship + bullets + aliens + shields.
   Score = +1 per alien killed. 10 aliens = 1 $SNAKE.
   Progressive : aliens descend faster and bomb drop rate rises per wave.
   =================================================================== */

const W = 720;
const H = 540;

const SHIP_W = 48;
const SHIP_H = 20;
const SHIP_Y = H - 46;
const SHIP_SPEED = 6;

const BULLET_W = 3;
const BULLET_H = 12;
const BULLET_SPEED = 8;
const SHOOT_CD = 14;       // frames

const ALIEN_W = 32;
const ALIEN_H = 22;
const ALIEN_GAP_X = 14;
const ALIEN_GAP_Y = 14;
const ALIEN_ROWS = 4;
const ALIEN_COLS = 10;
const ALIEN_STEP_BASE = 30;  // frames between advances
const ALIEN_STEP_MIN  = 8;
const ALIEN_DROP = 16;
const ALIEN_BOMB_RATE_BASE = 0.009;  // per alien per frame
const ALIEN_BOMB_RATE_MAX  = 0.032;
const ALIEN_COLORS = ['#ff3b6b', '#ff9500', '#ffd400', '#00ffa6'];

export class InvadersGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    this.onScore = callbacks.onScore || (() => {});
    this.onTokensPreview = callbacks.onTokensPreview || (() => {});
    this.onGameOver = callbacks.onGameOver || (() => {});

    this.running = false;
    this.highScore = Number(localStorage.getItem('invadersHi') || 0);

    this.keys = { left: false, right: false, fire: false };
    this.touchX = null;
    this._rafId = null;
    this._frame = 0;
    this._shootCD = 0;

    this._reset();
    this._draw();
  }

  _reset() {
    this.shipX = W / 2 - SHIP_W / 2;
    this.bullets = [];
    this.bombs = [];
    this.score = 0;
    this.wave = 1;
    this._alienDir = 1;
    this._alienLastStep = 0;
    this._spawnWave();
  }

  _spawnWave() {
    this.aliens = [];
    const startX = 60;
    const startY = 50 + (this.wave - 1) * 12;
    for (let r = 0; r < ALIEN_ROWS; r++) {
      for (let c = 0; c < ALIEN_COLS; c++) {
        this.aliens.push({
          x: startX + c * (ALIEN_W + ALIEN_GAP_X),
          y: startY + r * (ALIEN_H + ALIEN_GAP_Y),
          row: r,
          alive: true
        });
      }
    }
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
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
  }

  setKey(which, pressed) { if (which in this.keys) this.keys[which] = !!pressed; }
  setTouchX(x) { this.touchX = x; }
  clearTouch() { this.touchX = null; }
  fire() { this.keys.fire = true; setTimeout(() => this.keys.fire = false, 50); }

  _loop = () => {
    if (!this.running) return;
    this._tick();
    this._draw();
    this._rafId = requestAnimationFrame(this._loop);
  };

  _stepInterval() {
    // Speed up as waves progress AND as aliens die
    const alive = this.aliens.filter(a => a.alive).length;
    const killRatio = 1 - alive / (ALIEN_ROWS * ALIEN_COLS);
    const waveBoost = Math.min(1, (this.wave - 1) / 4);
    const k = Math.min(1, killRatio * 0.7 + waveBoost * 0.5);
    return Math.max(ALIEN_STEP_MIN, Math.round(ALIEN_STEP_BASE - (ALIEN_STEP_BASE - ALIEN_STEP_MIN) * k));
  }

  _bombRate() {
    const waveBoost = Math.min(1, (this.wave - 1) / 5);
    return ALIEN_BOMB_RATE_BASE + (ALIEN_BOMB_RATE_MAX - ALIEN_BOMB_RATE_BASE) * waveBoost;
  }

  _tick() {
    this._frame++;
    if (this._shootCD > 0) this._shootCD--;

    // Ship
    if (this.keys.left)  this.shipX -= SHIP_SPEED;
    if (this.keys.right) this.shipX += SHIP_SPEED;
    if (this.touchX != null) {
      this.shipX += (this.touchX - (this.shipX + SHIP_W / 2)) * 0.35;
    }
    this.shipX = Math.max(8, Math.min(W - SHIP_W - 8, this.shipX));

    // Fire
    if (this.keys.fire && this._shootCD <= 0) {
      this.bullets.push({ x: this.shipX + SHIP_W / 2 - BULLET_W / 2, y: SHIP_Y - BULLET_H });
      this._shootCD = SHOOT_CD;
    }

    // Bullets
    for (const b of this.bullets) b.y -= BULLET_SPEED;
    this.bullets = this.bullets.filter(b => b.y + BULLET_H > 0);

    // Aliens movement
    if (this._frame - this._alienLastStep >= this._stepInterval()) {
      this._alienLastStep = this._frame;
      let minX = Infinity, maxX = -Infinity;
      for (const a of this.aliens) if (a.alive) { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + ALIEN_W); }
      const nextLeft = minX + this._alienDir * 14;
      const nextRight = maxX + this._alienDir * 14;
      if (nextLeft < 8 || nextRight > W - 8) {
        this._alienDir *= -1;
        for (const a of this.aliens) if (a.alive) a.y += ALIEN_DROP;
      } else {
        for (const a of this.aliens) if (a.alive) a.x += this._alienDir * 14;
      }
    }

    // Alien bombs
    const bombRate = this._bombRate();
    for (const a of this.aliens) {
      if (!a.alive) continue;
      if (Math.random() < bombRate / (ALIEN_ROWS * ALIEN_COLS)) {
        this.bombs.push({ x: a.x + ALIEN_W / 2 - 2, y: a.y + ALIEN_H });
      }
    }
    for (const bm of this.bombs) bm.y += 4 + this.wave * 0.3;
    this.bombs = this.bombs.filter(b => b.y < H);

    // Bullet x alien
    for (const b of this.bullets) {
      for (const a of this.aliens) {
        if (!a.alive) continue;
        if (b.x < a.x + ALIEN_W && b.x + BULLET_W > a.x &&
            b.y < a.y + ALIEN_H && b.y + BULLET_H > a.y) {
          a.alive = false;
          b.y = -1000;
          this.score++;
          this.onScore(this.score);
          this.onTokensPreview(this.score / 5);
          break;
        }
      }
    }
    this.bullets = this.bullets.filter(b => b.y + BULLET_H > 0);

    // Wave cleared
    if (!this.aliens.some(a => a.alive)) {
      this.wave++;
      this._spawnWave();
    }

    // Alien reached ship line
    for (const a of this.aliens) {
      if (a.alive && a.y + ALIEN_H >= SHIP_Y) { this._gameOver(); return; }
    }
    // Bomb hits ship
    for (const bm of this.bombs) {
      if (bm.x + 4 > this.shipX && bm.x < this.shipX + SHIP_W &&
          bm.y + 12 > SHIP_Y && bm.y < SHIP_Y + SHIP_H) {
        this._gameOver();
        return;
      }
    }
  }

  _gameOver() {
    this.running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem('invadersHi', String(this.score)); } catch {}
    }
    const tokens = Math.floor((this.score / 5) * 100) / 100;
    this.onGameOver({ score: this.score, tokens });
  }

  _draw() {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#000010');
    grad.addColorStop(1, '#0a0024');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < 40; i++) {
      const x = (i * 181 + this._frame) % W;
      const y = (i * 113) % H;
      ctx.fillRect(x, y, 1, 1);
    }

    // Aliens
    for (const a of this.aliens) {
      if (!a.alive) continue;
      ctx.fillStyle = ALIEN_COLORS[a.row] || '#ffffff';
      ctx.shadowColor = ALIEN_COLORS[a.row] || '#ffffff';
      ctx.shadowBlur = 10;
      // Body
      ctx.fillRect(a.x + 4, a.y + 4, ALIEN_W - 8, ALIEN_H - 10);
      // Legs (flicker)
      const leg = (this._frame >> 3) & 1;
      ctx.fillRect(a.x + (leg ? 2 : 6), a.y + ALIEN_H - 5, 4, 5);
      ctx.fillRect(a.x + ALIEN_W - (leg ? 6 : 10), a.y + ALIEN_H - 5, 4, 5);
      // Eyes
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000';
      ctx.fillRect(a.x + 10, a.y + 8, 3, 3);
      ctx.fillRect(a.x + ALIEN_W - 13, a.y + 8, 3, 3);
    }
    ctx.shadowBlur = 0;

    // Bullets
    ctx.fillStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 8;
    for (const b of this.bullets) ctx.fillRect(b.x, b.y, BULLET_W, BULLET_H);
    ctx.shadowBlur = 0;

    // Bombs
    ctx.fillStyle = '#ff3b6b';
    ctx.shadowColor = '#ff3b6b';
    ctx.shadowBlur = 8;
    for (const b of this.bombs) ctx.fillRect(b.x, b.y, 4, 12);
    ctx.shadowBlur = 0;

    // Ship
    ctx.fillStyle = '#00ffa6';
    ctx.shadowColor = '#00ffa6';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(this.shipX + SHIP_W / 2, SHIP_Y);
    ctx.lineTo(this.shipX + SHIP_W, SHIP_Y + SHIP_H);
    ctx.lineTo(this.shipX, SHIP_Y + SHIP_H);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Base line
    ctx.strokeStyle = 'rgba(0,255,166,0.3)';
    ctx.beginPath();
    ctx.moveTo(0, SHIP_Y + SHIP_H + 2);
    ctx.lineTo(W, SHIP_Y + SHIP_H + 2);
    ctx.stroke();

    // HUD wave
    ctx.fillStyle = '#00ffff';
    ctx.font = 'bold 14px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('WAVE ' + this.wave, 12, 20);
  }
}
