/* ===================================================================
   SnowDiablo Arcade — Minesweeper engine
   Beginner-friendly grid 10x10 with 12 mines. Score = safe cells revealed.
   Economy : 10 safe cells = 1 $SNAKE preview (before multipliers).
   - Left click / tap : reveal
   - Right click / long-press : flag
   - Game ends on mine hit (loss) or all safe cells revealed (win → bonus).
   =================================================================== */

const ROWS = 10;
const COLS = 10;
const MINES = 12;
const CELL = 40;

const BG = '#0a0020';
const HIDDEN_BG = '#2a1050';
const HIDDEN_EDGE = '#4a2080';
const REVEALED_BG = '#0f0a28';
const FLAG_COLOR = '#ff3b6b';
const MINE_COLOR = '#ff1a4a';

const NUM_COLORS = [
  null,
  '#00ffff', // 1
  '#00ffa6', // 2
  '#ffd400', // 3
  '#ff9500', // 4
  '#ff3b6b', // 5
  '#ff6bcb', // 6
  '#a066ff', // 7
  '#ffffff'  // 8
];

export class MinesweeperGame {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.width = COLS * CELL;
    canvas.height = ROWS * CELL;

    this.onScore = callbacks.onScore || (() => {});
    this.onTokensPreview = callbacks.onTokensPreview || (() => {});
    this.onGameOver = callbacks.onGameOver || (() => {});

    this.running = false;
    this.highScore = Number(localStorage.getItem('mineHi') || 0);

    this._reset();
    this._draw();
  }

  _reset() {
    this.cells = [];
    this.revealedCount = 0;
    this.score = 0;
    this._firstClick = true;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        this.cells.push({ r, c, mine: false, revealed: false, flagged: false, adj: 0 });
      }
    }
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

  _cellAt(r, c) {
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return null;
    return this.cells[r * COLS + c];
  }

  _placeMines(safeR, safeC) {
    const safeIdxs = new Set();
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = safeR + dr, c = safeC + dc;
        if (r >= 0 && c >= 0 && r < ROWS && c < COLS) safeIdxs.add(r * COLS + c);
      }
    }
    let placed = 0;
    while (placed < MINES) {
      const i = Math.floor(Math.random() * this.cells.length);
      if (safeIdxs.has(i)) continue;
      if (this.cells[i].mine) continue;
      this.cells[i].mine = true;
      placed++;
    }
    // Compute adj
    for (const cell of this.cells) {
      if (cell.mine) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const neigh = this._cellAt(cell.r + dr, cell.c + dc);
          if (neigh && neigh.mine) n++;
        }
      }
      cell.adj = n;
    }
  }

  _flood(startR, startC) {
    const stack = [[startR, startC]];
    while (stack.length) {
      const [r, c] = stack.pop();
      const cell = this._cellAt(r, c);
      if (!cell || cell.revealed || cell.flagged || cell.mine) continue;
      cell.revealed = true;
      this.revealedCount++;
      this.score++;
      if (cell.adj === 0) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            stack.push([r + dr, c + dc]);
          }
        }
      }
    }
  }

  reveal(r, c) {
    if (!this.running) return;
    const cell = this._cellAt(r, c);
    if (!cell || cell.revealed || cell.flagged) return;

    if (this._firstClick) {
      this._placeMines(r, c);
      this._firstClick = false;
    }

    if (cell.mine) {
      cell.revealed = true;
      // reveal all mines
      for (const c2 of this.cells) if (c2.mine) c2.revealed = true;
      this._draw();
      this._endRun(false);
      return;
    }

    this._flood(r, c);
    this.onScore(this.score);
    this.onTokensPreview(this.score / 10);
    this._draw();

    // Win check
    const safeCells = ROWS * COLS - MINES;
    if (this.revealedCount >= safeCells) {
      // Bonus : +5 points for clearing the board
      this.score += 5;
      this.onScore(this.score);
      this.onTokensPreview(this.score / 10);
      this._endRun(true);
    }
  }

  toggleFlag(r, c) {
    if (!this.running) return;
    const cell = this._cellAt(r, c);
    if (!cell || cell.revealed) return;
    cell.flagged = !cell.flagged;
    this._draw();
  }

  _endRun(win) {
    this.running = false;
    if (this.score > this.highScore) {
      this.highScore = this.score;
      try { localStorage.setItem('mineHi', String(this.score)); } catch {}
    }
    const tokens = Math.floor((this.score / 10) * 100) / 100;
    this.onGameOver({ score: this.score, tokens, win });
  }

  // Convert canvas coords to grid cell
  cellFromCanvasCoords(x, y) {
    const c = Math.floor(x / CELL);
    const r = Math.floor(y / CELL);
    if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return null;
    return { r, c };
  }

  _draw() {
    const ctx = this.ctx;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (const cell of this.cells) {
      const x = cell.c * CELL;
      const y = cell.r * CELL;

      if (cell.revealed) {
        ctx.fillStyle = REVEALED_BG;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = '#1a0833';
        ctx.strokeRect(x + 0.5, y + 0.5, CELL, CELL);

        if (cell.mine) {
          ctx.fillStyle = MINE_COLOR;
          ctx.shadowColor = MINE_COLOR;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, CELL * 0.27, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(x + CELL / 2, y + 4);
          ctx.lineTo(x + CELL / 2, y + CELL - 4);
          ctx.moveTo(x + 4, y + CELL / 2);
          ctx.lineTo(x + CELL - 4, y + CELL / 2);
          ctx.stroke();
        } else if (cell.adj > 0) {
          ctx.fillStyle = NUM_COLORS[cell.adj] || '#ffffff';
          ctx.shadowColor = NUM_COLORS[cell.adj] || '#ffffff';
          ctx.shadowBlur = 6;
          ctx.font = 'bold 22px "Courier New", monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(cell.adj), x + CELL / 2, y + CELL / 2 + 1);
          ctx.shadowBlur = 0;
        }
      } else {
        ctx.fillStyle = HIDDEN_BG;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.strokeStyle = HIDDEN_EDGE;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);

        if (cell.flagged) {
          ctx.fillStyle = FLAG_COLOR;
          ctx.shadowColor = FLAG_COLOR;
          ctx.shadowBlur = 8;
          // Triangle flag
          ctx.beginPath();
          ctx.moveTo(x + 10, y + 8);
          ctx.lineTo(x + CELL - 10, y + 14);
          ctx.lineTo(x + 10, y + 20);
          ctx.closePath();
          ctx.fill();
          // Pole
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x + 9, y + 8, 2, CELL - 16);
          ctx.shadowBlur = 0;
        }
      }
    }
  }
}
