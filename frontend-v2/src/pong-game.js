/* ===================================================================
   SnowDiablo Arcade — Pong Game Engine
   Neon skill-based Pong. 1P vs AI. +1 point per rally survived.
   Callbacks: onScore, onGameOver, onTokensPreview
   Physics: ball angle follows paddle hit-zone (top/middle/bottom).
   AI difficulty escalates with score (tracking lag + speed cap).
   =================================================================== */

const W = 800;
const H = 400;
const PAD_W = 12;
const PAD_H = 72;
const BALL_R = 7;
const MAX_SCORE = 50;           // fin de partie safety cap
const START_SPEED = 5;          // ball initial speed (px/frame)
const SPEED_GAIN = 0.15;        // per rally
const MAX_SPEED = 13;           // plafond anti-bullet
const AI_SPEED_BASE = 3.2;      // AI paddle max speed at rally 0
const AI_SPEED_MAX = 7.5;       // at score ~ 30+
const AI_LAG_BASE = 90;         // reaction delay offset max (px)
const AI_LAG_MIN = 8;           // minimum lag (pro mode)
const PAD_SPEED = 7.2;          // player paddle speed
const TICK_MS = 1000 / 60;      // 60fps target

export class PongGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    // Force width/height (HTML attrs) si non set
    if (!canvas.width)  canvas.width  = W;
    if (!canvas.height) canvas.height = H;
    this.ctx = canvas.getContext('2d');

    this.cb = {
      onScore:         () => {},
      onGameOver:      () => {},
      onTokensPreview: () => {},
      ...callbacks
    };

    this.highScore = parseInt(localStorage.getItem('pongHi') || '0', 10) || 0;

    this.keys = { up: false, down: false };
    this.touchY = null;
    this._bindInput();

    this._reset();
    this._drawWelcome();
  }

  // ===================================================================
  //  State reset
  // ===================================================================
  _reset() {
    this.running   = false;
    this.score     = 0;
    this.tokens    = 0;
    this.rallies   = 0;
    this.paddleY   = (H - PAD_H) / 2;
    this.aiY       = (H - PAD_H) / 2;
    this.ball      = { x: W/2, y: H/2, vx: 0, vy: 0 };
    this.speed     = START_SPEED;
  }

  _randomAngle() {
    // ±25° à ±55° du plan horizontal, sens gauche au début pour laisser le joueur frapper
    const dir = Math.random() < 0.5 ? -1 : 1;
    const ang = (Math.PI / 7) + Math.random() * (Math.PI / 4);   // 25° → 70°
    const vy  = Math.sin(ang) * this.speed * (Math.random() < 0.5 ? -1 : 1);
    const vx  = Math.cos(ang) * this.speed * dir;
    return { vx, vy };
  }

  // ===================================================================
  //  Lifecycle
  // ===================================================================
  start() {
    this._reset();
    const v = this._randomAngle();
    this.ball.vx = v.vx;
    this.ball.vy = v.vy;
    this.running = true;
    this.cb.onScore(0);
    this.cb.onTokensPreview(0);
    this.loop = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.running = false;
  }

  _gameOver() {
    this.stop();
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem('pongHi', String(this.score)); } catch {}
    }
    this._drawGameOver();
    this.cb.onGameOver({ score: this.score, tokens: this.tokens });
  }

  // ===================================================================
  //  Main tick
  // ===================================================================
  _tick() {
    // --- Player paddle
    let dy = 0;
    if (this.keys.up)   dy -= PAD_SPEED;
    if (this.keys.down) dy += PAD_SPEED;
    if (this.touchY !== null) {
      const targetY = this.touchY - PAD_H / 2;
      const diff = targetY - this.paddleY;
      dy = Math.max(-PAD_SPEED * 1.6, Math.min(PAD_SPEED * 1.6, diff));
    }
    this.paddleY = Math.max(0, Math.min(H - PAD_H, this.paddleY + dy));

    // --- AI paddle : tracking imparfait. Lag décroît avec score.
    const aiSpeedCap = Math.min(
      AI_SPEED_MAX,
      AI_SPEED_BASE + (this.rallies * 0.14)
    );
    const lagMagnitude = Math.max(
      AI_LAG_MIN,
      AI_LAG_BASE - (this.rallies * 2.5)
    );
    // l'AI "voit" la balle avec un offset randomisé (jitter humain)
    const aiTargetY = this.ball.y - PAD_H / 2
      + (Math.sin(Date.now() / 300 + this.rallies) * lagMagnitude * 0.5);
    const aiDiff = aiTargetY - this.aiY;
    const aiMove = Math.max(-aiSpeedCap, Math.min(aiSpeedCap, aiDiff));
    this.aiY = Math.max(0, Math.min(H - PAD_H, this.aiY + aiMove));

    // --- Ball move
    this.ball.x += this.ball.vx;
    this.ball.y += this.ball.vy;

    // Top/bottom bounce
    if (this.ball.y - BALL_R <= 0) {
      this.ball.y = BALL_R;
      this.ball.vy = Math.abs(this.ball.vy);
    } else if (this.ball.y + BALL_R >= H) {
      this.ball.y = H - BALL_R;
      this.ball.vy = -Math.abs(this.ball.vy);
    }

    // Player paddle collision (left, x ~ PAD_W + 4 margin)
    if (this.ball.vx < 0
        && this.ball.x - BALL_R <= PAD_W + 4
        && this.ball.x - BALL_R >= 0
        && this.ball.y >= this.paddleY
        && this.ball.y <= this.paddleY + PAD_H) {
      this._hitPaddle(this.paddleY, 1);
    }
    // AI paddle collision (right)
    else if (this.ball.vx > 0
        && this.ball.x + BALL_R >= W - PAD_W - 4
        && this.ball.x + BALL_R <= W
        && this.ball.y >= this.aiY
        && this.ball.y <= this.aiY + PAD_H) {
      this._hitPaddle(this.aiY, -1);
    }

    // Miss = game over
    if (this.ball.x < -BALL_R * 2 || this.ball.x > W + BALL_R * 2) {
      this._gameOver();
      return;
    }

    // Safety cap (if something spirals)
    if (this.score >= MAX_SCORE) {
      this._gameOver();
      return;
    }

    this._draw();
  }

  _hitPaddle(padY, dirSign) {
    // angle basé sur où la balle touche le paddle (-1 = haut, 0 = centre, +1 = bas)
    const hitOffset = ((this.ball.y - padY) / PAD_H) * 2 - 1;
    const clamped = Math.max(-0.85, Math.min(0.85, hitOffset));
    const bounceAng = clamped * (Math.PI / 3);   // max 60°

    this.speed = Math.min(MAX_SPEED, this.speed + SPEED_GAIN);
    this.ball.vx = Math.cos(bounceAng) * this.speed * dirSign;
    this.ball.vy = Math.sin(bounceAng) * this.speed;

    // déplace la balle hors du paddle pour éviter double-hit
    if (dirSign > 0) this.ball.x = PAD_W + 4 + BALL_R + 1;
    else             this.ball.x = W - PAD_W - 4 - BALL_R - 1;

    // Seul le hit du joueur compte comme un rally scoré
    if (dirSign > 0) {
      this.score++;
      this.rallies++;
      this.tokens = Math.floor((this.score / 10) * 100) / 100;
      this.cb.onScore(this.score);
      this.cb.onTokensPreview(this.tokens);
    }
  }

  // ===================================================================
  //  Rendering
  // ===================================================================
  _draw() {
    const { ctx } = this;
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Center dashed line
    ctx.strokeStyle = '#1a1a33';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // Paddles (neon glow)
    this._paddle(4, this.paddleY, '#00ff88');
    this._paddle(W - PAD_W - 4, this.aiY, '#ff4466');

    // Ball
    ctx.shadowColor = '#88ccff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Scoreline top
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 22px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.score), 24, 32);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8888a0';
    ctx.fillText(`HI ${this.highScore}`, W - 24, 32);
  }

  _paddle(x, y, color) {
    const { ctx } = this;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, PAD_W, PAD_H);
    ctx.shadowBlur = 0;
  }

  _drawWelcome() {
    const { ctx } = this;
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1a1a33';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 10]);
    ctx.beginPath();
    ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    this._paddle(4, (H - PAD_H) / 2, '#00ff88');
    this._paddle(W - PAD_W - 4, (H - PAD_H) / 2, '#ff4466');

    ctx.fillStyle = '#fff';
    ctx.shadowColor = '#00ff88';
    ctx.shadowBlur = 16;
    ctx.font = 'bold 44px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('🏓 PONG', W/2, H/2 - 20);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#aab';
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('SPACE or NEW GAME to start', W/2, H/2 + 16);
    ctx.fillStyle = '#666';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('W/S or ↑/↓ to move · Touch to drag paddle', W/2, H/2 + 40);
  }

  _drawGameOver() {
    this._draw();
    const { ctx } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 32px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', W/2, H/2 - 30);
    ctx.font = '18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00ff88';
    ctx.fillText(`Rallies: ${this.score}`, W/2, H/2 + 4);
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`$SNAKE: ${this.tokens.toFixed(2)}`, W/2, H/2 + 32);
    ctx.fillStyle = '#8888a0';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('Press SPACE to restart', W/2, H/2 + 62);
  }

  // ===================================================================
  //  Input bindings (self-contained — public API exposes setKey/setTouchY)
  // ===================================================================
  _bindInput() {
    // Event listeners are attached by main-pong.js via setKey/setTouchY.
    // The engine itself is pure — no global listeners attached here to avoid leaks.
  }

  setKey(which, pressed) {
    if (which === 'up')   this.keys.up   = !!pressed;
    if (which === 'down') this.keys.down = !!pressed;
  }

  setTouchY(y) {
    this.touchY = y;
  }

  clearTouch() {
    this.touchY = null;
  }
}
