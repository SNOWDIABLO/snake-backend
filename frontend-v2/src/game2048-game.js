/* ===================================================================
   SnowDiablo Arcade — 2048 engine
   Grid 4x4 + tile merges. Onscoreincrement = tile value merged.
   Economy : score / 100 = tokens preview (so a 2048 run ~20 $SNAKE max).
   Public API:
     new Game2048(canvas, { onScore, onTokensPreview, onGameOver })
     game.start() / game.stop() / game.move('left'|'right'|'up'|'down')
   Swipe handling lives in main-2048.js.
   =================================================================== */

const BG = '#15042a';
const GRID_BG = '#2a1050';
const CELL_BG = '#140028';

const TILE_COLORS = {
  2: '#1a3060', 4: '#1a4080', 8: '#1a6080', 16: '#1a80a0', 32: '#1aa0c0',
  64: '#10c0d0', 128: '#10d0b0', 256: '#10c080', 512: '#ffc800',
  1024: '#ff8000', 2048: '#ff3060', 4096: '#ff00ff', 8192: '#ffffff'
};

const SIZE = 4;

export class Game2048 {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const CELL = 110;
    const PAD = 12;
    this.CELL = CELL;
    this.PAD = PAD;
    const dim = SIZE * CELL + (SIZE + 1) * PAD;
    canvas.width = dim;
    canvas.height = dim;

    this.onScore = callbacks.onScore || (() => {});
    this.onTokensPreview = callbacks.onTokensPreview || (() => {});
    this.onGameOver = callbacks.onGameOver || (() => {});

    this.running = false;
    this.highScore = Number(localStorage.getItem('game2048Hi') || 0);

    this._reset();
    this._draw();
  }

  _reset() {
    this.grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
    this.score = 0;
    this._spawn();
    this._spawn();
  }

  start() {
    if (this.running) return;
    this._reset();
    this.running = true;
    this.onScore(0);
    this.onTokensPreview(0);
    this._draw();
  }

  stop() { this.running = false; }

  _spawn() {
    const empty = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (this.grid[r][c] === 0) empty.push([r, c]);
    if (!empty.length) return false;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    this.grid[r][c] = Math.random() < 0.9 ? 2 : 4;
    return true;
  }

  _slideRow(row) {
    let arr = row.filter(v => v !== 0);
    let gain = 0;
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i] === arr[i + 1]) {
        arr[i] *= 2;
        gain += arr[i];
        arr.splice(i + 1, 1);
      }
    }
    while (arr.length < SIZE) arr.push(0);
    return { row: arr, gain };
  }

  _rotateCW(grid) {
    const n = SIZE;
    const out = Array.from({ length: n }, () => Array(n).fill(0));
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        out[c][n - 1 - r] = grid[r][c];
    return out;
  }

  _rotateCCW(grid) {
    return this._rotateCW(this._rotateCW(this._rotateCW(grid)));
  }

  move(dir) {
    if (!this.running) return false;

    // All moves are implemented as "slide left" with rotations
    let g = this.grid.map(row => row.slice());
    if (dir === 'up')    g = this._rotateCCW(g);
    if (dir === 'down')  g = this._rotateCW(g);
    if (dir === 'right') g = g.map(r => r.slice().reverse());

    let moved = false;
    let totalGain = 0;
    const newG = g.map(row => {
      const { row: slid, gain } = this._slideRow(row);
      totalGain += gain;
      for (let i = 0; i < SIZE; i++) if (row[i] !== slid[i]) moved = true;
      return slid;
    });

    let result = newG;
    if (dir === 'up')    result = this._rotateCW(newG);
    if (dir === 'down')  result = this._rotateCCW(newG);
    if (dir === 'right') result = newG.map(r => r.slice().reverse());

    if (!moved) return false;

    this.grid = result;
    this.score += totalGain;
    this.onScore(this.score);
    this.onTokensPreview(this.score / 100);
    this._spawn();
    this._draw();

    if (this._gameIsOver()) {
      this._gameOver();
    }
    return true;
  }

  _gameIsOver() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (this.grid[r][c] === 0) return false;
        if (r + 1 < SIZE && this.grid[r + 1][c] === this.grid[r][c]) return false;
        if (c + 1 < SIZE && this.grid[r][c + 1] === this.grid[r][c]) return false;
      }
    return true;
  }

  _gameOver() {
    this.running = false;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem('game2048Hi', String(this.score)); } catch {}
    }
    const tokens = Math.floor((this.score / 100) * 100) / 100;
    this.onGameOver({ score: this.score, tokens });
  }

  _draw() {
    const ctx = this.ctx;
    const { CELL, PAD } = this;
    const dim = this.canvas.width;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, dim, dim);

    ctx.fillStyle = GRID_BG;
    ctx.fillRect(0, 0, dim, dim);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const x = PAD + c * (CELL + PAD);
        const y = PAD + r * (CELL + PAD);
        ctx.fillStyle = CELL_BG;
        ctx.fillRect(x, y, CELL, CELL);

        const v = this.grid[r][c];
        if (!v) continue;
        const color = TILE_COLORS[v] || '#ffffff';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillRect(x + 2, y + 2, CELL - 4, CELL - 4);
        ctx.shadowBlur = 0;

        const fs = v >= 1024 ? 28 : v >= 128 ? 34 : 40;
        ctx.fillStyle = v <= 4 ? '#ffffff' : '#0a0020';
        ctx.font = `bold ${fs}px "Courier New", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), x + CELL / 2, y + CELL / 2);
      }
    }
  }
}
