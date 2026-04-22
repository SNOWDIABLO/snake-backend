/* ===================================================================
   SnowDiablo Arcade — Breakout engine
   Canvas 2D, 60fps. Paddle + ball + brick grid.
   Score = +1 per brick destroyed. 10 bricks = 1 $SNAKE.
   Progressive : ball speed ramps up every row cleared.
   Public API:
     new BreakoutGame(canvas, { onScore, onTokensPreview, onGameOver })
     game.start() / game.stop() / game.setKey() / game.setTouchX() / game.clearTouch()
   =================================================================== */

const W = 720;
const H = 480;

// Paddle
const PAD_W = 96;
const PAD_H = 12;
const PAD_Y = H - 32;
const PAD_SPEED = 8;

// Ball
const BALL_R = 7;
const START_SPEED = 5;
const SPEED_GAIN = 0.15;
const MAX_SPEED = 11;

// Brick grid
const BRICK_ROWS = 6;
const BRICK_COLS = 12;
const BRICK_W = 54;
const BRICK_H = 20;
const BRICK_PAD = 4;
const BRICK_TOP = 60;
const BRICK_LEFT = (W - (BRICK_COLS * (BRICK_W + BRICK_PAD) - BRICK_PAD)) / 2;

const ROW_COLORS = ['#ff3b6b', '#ff7b00', '#ffcc00', '#00ffa6', '#00c2ff', '#a066ff'];

export class BreakoutGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;

    this.onScore = callbacks.onScore || (() => {});
    this.onTokensPreview = callbacks.onTokensPreview || (() => {});
    this.onGameOver = callbacks.onGameOver || (() => {});

    this.running = false;
    this.highScore = Number(localStorage.getItem('breakoutHi') || 0);

    this.keys = { left: false, right: false };
    this.touchX = null;
    this._rafId = null;

    this._reset();
    this._draw();
  }

  _reset() {
    this.padX = W / 2 - PAD_W / 2;
    this.ball = { x: W / 2, y: PAD_Y - BALL_R - 4, vx: START_SPEED * 0.6, vy: -START_SPEED };
    this.speed = START_SPEED;
    this.score = 0;
    this.bricks = [];
    for (let r = 0; r < BRICK_ROWS; r++) {
      for (let c = 0; c < BRICK_COLS; c++) {
        this.bricks.push({
          x: BRICK_LEFT + c * (BRICK_W + BRICK_PAD),
          y: BRICK_TOP + r * (BRICK_H + BRICK_PAD),
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
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  setKey(which, pressed) {
    if (which === 'left' || which === 'right') this.keys[which] = !!pressed;
  }
  setTouchX(x) { this.touchX = x; }
  clearTouch() { this.touchX = null; }

  _loop = () => {
    if (!this.running) return;
    this._tick();
    this._draw();
    this._rafId = requestAnimationFrame(this._loop);
  };

  _tick() {
    // Paddle — keyboard
    if (this.keys.left)  this.padX -= PAD_SPEED;
    if (this.keys.right) this.padX += PAD_SPEED;
    // Paddle — touch (centers paddle on finger)
    if (this.touchX != null) {
      this.padX += (this.touchX - (this.padX + PAD_W / 2)) * 0.35;
    }
    this.padX = Math.max(0, Math.min(W - PAD_W, this.padX));

    // Ball
    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;

    // Walls
    if (this.ball.x - BALL_R < 0) {
      this.ball.x = BALL_R;
      this.ball.vx = Math.abs(this.ball.vx);
    }
    if (this.ball.x + BALL_R > W) {
      this.ball.x = W - BALL_R;
      this.ball.vx = -Math.abs(this.ball.vx);
    }
    if (this.ball.y - BALL_R < 0) {
      this.ball.y = BALL_R;
      this.ball.vy = Math.abs(this.ball.vy);
    }

    // Bottom = miss
    if (this.ball.y - BALL_R > H) {
      this._gameOver();
      return;
    }

    // Paddle
    if (this.ball.vy > 0 &&
        this.ball.y + BALL_R >= PAD_Y &&
        this.ball.y + BALL_R <= PAD_Y + PAD_H &&
        this.ball.x >= this.padX - BALL_R &&
        this.ball.x <= this.padX + PAD_W + BALL_R) {
      const hitOffset = ((this.ball.x - this.padX) / PAD_W) * 2 - 1;
      const clamped = Math.max(-0.85, Math.min(0.85, hitOffset));
      const ang = clamped * (Math.PI / 3);
      this.speed = Math.min(this.speed + SPEED_GAIN * 0.2, MAX_SPEED);
      this.ball.vx = Math.sin(ang) * this.speed;
      this.ball.vy = -Math.abs(Math.cos(ang) * this.speed);
      this.ball.y = PAD_Y - BALL_R - 1;
    }

    // Bricks
    for (const b of this.bricks) {
      if (!b.alive) continue;
      if (this.ball.x + BALL_R < b.x) continue;
      if (this.ball.x - BALL_R > b.x + BRICK_W) continue;
      if (this.ball.y + BALL_R < b.y) continue;
      if (this.ball.y - BALL_R > b.y + BRICK_H) continue;

      // Hit. Decide reflect axis based on which side ball entered from
      const cx = b.x + BRICK_W / 2;
      const cy = b.y + BRICK_H / 2;
      const dx = Math.abs(this.ball.x - cx) - BRICK_W / 2;
      const dy = Math.abs(this.ball.y - cy) - BRICK_H / 2;
      if (dx > dy) this.ball.vx = -this.ball.vx;
      else         this.ball.vy = -this.ball.vy;

      b.alive = false;
      this.score++;
      this.speed = Math.min(this.speed + SPEED_GAIN * 0.05, MAX_SPEED);
      this.onScore(this.score);
      this.onTokensPreview(this.score / 10);

      // Refill field if all cleared
      if (!this.bricks.some(bb => bb.alive)) {
        for (const bb of this.bricks) bb.alive = true;
        this.speed = Math.min(this.speed + 1, MAX_SPEED);
      }
      break; // one brick per frame
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
      try { localStorage.setItem('breakoutHi', String(this.score)); } catch {}
    }
    const tokens = Math.floor((this.score / 10) * 100) / 100;
    this.onGameOver({ score: this.score, tokens });
  }

  _draw() {
    const ctx = this.ctx;
    // Background
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(1, '#120020');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Grid border
    ctx.strokeStyle = '#ff6bcb';
    ctx.shadowColor = '#ff6bcb';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);
    ctx.shadowBlur = 0;

    // Bricks
    for (const b of this.bricks) {
      if (!b.alive) continue;
      ctx.fillStyle = ROW_COLORS[b.row] || '#ffffff';
      ctx.shadowColor = ROW_COLORS[b.row] || '#ffffff';
      ctx.shadowBlur = 10;
      ctx.fillRect(b.x, b.y, BRICK_W, BRICK_H);
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(b.x, b.y, BRICK_W, 3);
    }

    // Paddle
    ctx.fillStyle = '#00ffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 14;
    ctx.fillRect(this.padX, PAD_Y, PAD_W, PAD_H);
    ctx.shadowBlur = 0;

    // Ball
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00ffff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
