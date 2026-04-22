/* ===================================================================
   SnowDiablo Arcade — Snake Game Engine
   Pure game logic + canvas rendering. No backend coupling.
   Callbacks: onScore, onGameOver, onTokensPreview
   =================================================================== */

const GRID      = 20;
const TICK_MS   = 130;

export class SnakeGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.cols   = canvas.width  / GRID;
    this.rows   = canvas.height / GRID;

    this.cb = {
      onScore:         () => {},
      onGameOver:      () => {},
      onTokensPreview: () => {},
      ...callbacks
    };

    this.snake   = [];
    this.dir     = { x: 1, y: 0 };
    this.nextDir = { x: 1, y: 0 };
    this.food    = { x: 0, y: 0 };
    this.score   = 0;
    this.tokens  = 0;
    this.running = false;
    this.loop    = null;
    this.highScore = parseInt(localStorage.getItem('snakeHS_v2') || '0');

    this._initState();
    this._drawWelcome();
  }

  _initState() {
    this.snake   = [{x:12,y:12},{x:11,y:12},{x:10,y:12}];
    this.dir     = { x: 1, y: 0 };
    this.nextDir = { x: 1, y: 0 };
    this.food    = this._randomFood();
    this.score   = 0;
    this.tokens  = 0;
    this.running = false;
  }

  _randomFood() {
    let f;
    do {
      f = {
        x: Math.floor(Math.random() * this.cols),
        y: Math.floor(Math.random() * this.rows)
      };
    } while (this.snake.some(s => s.x === f.x && s.y === f.y));
    return f;
  }

  start() {
    if (this.loop) clearInterval(this.loop);
    this._initState();
    this.running = true;
    this._draw();
    this.loop = setInterval(() => this._tick(), TICK_MS);
    this.cb.onScore(0);
    this.cb.onTokensPreview(0);
  }

  setDir(dx, dy) {
    if (dx === -this.dir.x && dy === -this.dir.y) return;
    this.nextDir = { x: dx, y: dy };
  }

  _tick() {
    this.dir = this.nextDir;
    const head = {
      x: this.snake[0].x + this.dir.x,
      y: this.snake[0].y + this.dir.y
    };

    // Wall
    if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
      return this._gameOver();
    }
    // Self-collision
    if (this.snake.some(s => s.x === head.x && s.y === head.y)) {
      return this._gameOver();
    }

    this.snake.unshift(head);

    if (head.x === this.food.x && head.y === this.food.y) {
      this.score++;
      this.tokens = Math.floor((this.score / 10) * 100) / 100;
      this.food = this._randomFood();
      if (this.score > this.highScore) {
        this.highScore = this.score;
        localStorage.setItem('snakeHS_v2', String(this.highScore));
      }
      this.cb.onScore(this.score);
      this.cb.onTokensPreview(this.tokens);
    } else {
      this.snake.pop();
    }
    this._draw();
  }

  _gameOver() {
    clearInterval(this.loop);
    this.loop = null;
    this.running = false;
    this._drawGameOver();
    this.cb.onGameOver({ score: this.score, tokens: this.tokens });
  }

  stop() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.running = false;
  }

  // ===================================================================
  //  Rendering
  // ===================================================================

  _draw() {
    const { ctx, canvas, snake, food, dir } = this;
    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = '#15152a';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= canvas.width; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y <= canvas.height; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Food
    ctx.font = `${GRID - 2}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍎', food.x * GRID + GRID / 2, food.y * GRID + GRID / 2);

    // Snake
    snake.forEach((seg, i) => {
      const ratio = 1 - (i / snake.length) * 0.5;
      ctx.fillStyle = `rgb(0,${Math.floor(255 * ratio)},${Math.floor(136 * ratio)})`;
      ctx.beginPath();
      ctx.roundRect(seg.x * GRID + 1, seg.y * GRID + 1, GRID - 2, GRID - 2, 4);
      ctx.fill();
      if (i === 0) {
        ctx.fillStyle = '#000';
        const ex = dir.x === 0
          ? [GRID * 0.3, GRID * 0.7]
          : (dir.x > 0 ? [GRID * 0.7, GRID * 0.7] : [GRID * 0.3, GRID * 0.3]);
        const ey = dir.y === 0
          ? [GRID * 0.3, GRID * 0.7]
          : (dir.y > 0 ? [GRID * 0.7, GRID * 0.7] : [GRID * 0.3, GRID * 0.3]);
        ctx.beginPath(); ctx.arc(seg.x * GRID + ex[0], seg.y * GRID + ey[0], 2, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(seg.x * GRID + ex[1], seg.y * GRID + ey[1], 2, 0, Math.PI*2); ctx.fill();
      }
    });
  }

  _drawWelcome() {
    this._draw();
    const { ctx, canvas } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff88';
    ctx.font = 'bold 28px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('🐍 SNAKECOIN', canvas.width/2, canvas.height/2 - 40);
    ctx.fillStyle = '#fff';
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillText('Press SPACE or click NEW GAME', canvas.width/2, canvas.height/2);
    ctx.fillStyle = '#8888a0';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('Arrows / WASD to move', canvas.width/2, canvas.height/2 + 30);
  }

  _drawGameOver() {
    this._draw();
    const { ctx, canvas, score, tokens } = this;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('GAME OVER', canvas.width/2, canvas.height/2 - 30);
    ctx.font = '18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00ff88';
    ctx.fillText(`Score: ${score}`, canvas.width/2, canvas.height/2 + 6);
    ctx.fillStyle = '#ffcc44';
    ctx.fillText(`$SNAKE: ${tokens.toFixed(2)}`, canvas.width/2, canvas.height/2 + 34);
    ctx.fillStyle = '#8888a0';
    ctx.font = '12px "JetBrains Mono", monospace';
    ctx.fillText('Press NEW GAME to retry', canvas.width/2, canvas.height/2 + 66);
  }
}

export { GRID };
