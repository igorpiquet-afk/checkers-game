'use strict';

/* =========================================================
   Unicorn Checkers — Game Logic
   Board coordinates: row 0 = top (purple's back row), row 7 = bottom (pink's back row)
   Pink moves "up" (decreasing row), Purple moves "down" (increasing row)
   ========================================================= */

const BOARD_SIZE = 8;
const PLAYERS = { PINK: 'pink', PURPLE: 'purple' };

const state = {
  board: [],          // 8x8 array of null | {player, king}
  turn: PLAYERS.PINK,
  selected: null,      // {row, col}
  legalMoves: [],      // legal moves for the selected piece this turn
  mustCapturePieces: [],// list of {row, col} that have a mandatory capture this turn
  activeChain: null,   // {row, col} piece mid multi-jump (must continue with same piece)
  scores: { pink: 0, purple: 0 },
  lastMove: null,      // {from, to} for highlighting
  gameOver: false,
};

function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const isDark = (row + col) % 2 === 1;
      if (!isDark) continue;
      if (row < 3) {
        board[row][col] = { player: PLAYERS.PURPLE, king: false };
      } else if (row > 4) {
        board[row][col] = { player: PLAYERS.PINK, king: false };
      }
    }
  }
  return board;
}

function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

function opponentOf(player) {
  return player === PLAYERS.PINK ? PLAYERS.PURPLE : PLAYERS.PINK;
}

function forwardDirections(piece) {
  if (piece.king) return [-1, 1];
  return piece.player === PLAYERS.PINK ? [-1] : [1];
}

/** Returns { simple: [{row,col}], captures: [{row,col, capturedRow, capturedCol}] } */
function getMovesForPiece(board, row, col) {
  const piece = board[row][col];
  if (!piece) return { simple: [], captures: [] };

  const simple = [];
  const captures = [];
  const rowDirs = forwardDirections(piece);
  const colDirs = [-1, 1];

  for (const dr of rowDirs) {
    for (const dc of colDirs) {
      const r1 = row + dr;
      const c1 = col + dc;
      if (!inBounds(r1, c1)) continue;

      if (!board[r1][c1]) {
        simple.push({ row: r1, col: c1 });
      } else if (board[r1][c1].player !== piece.player) {
        const r2 = row + dr * 2;
        const c2 = col + dc * 2;
        if (inBounds(r2, c2) && !board[r2][c2]) {
          captures.push({ row: r2, col: c2, capturedRow: r1, capturedCol: c1 });
        }
      }
    }
  }

  return { simple, captures };
}

function getAllMoves(board, player) {
  const withCaptures = [];
  const withSimple = [];

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (!piece || piece.player !== player) continue;
      const { simple, captures } = getMovesForPiece(board, row, col);
      if (captures.length) withCaptures.push({ row, col, moves: captures });
      if (simple.length) withSimple.push({ row, col, moves: simple });
    }
  }

  // Mandatory capture rule: if any capture exists, only capture moves are legal.
  if (withCaptures.length) {
    return { forced: true, pieces: withCaptures };
  }
  return { forced: false, pieces: withSimple };
}

function cloneBoard(board) {
  return board.map(row => row.map(cell => (cell ? { ...cell } : null)));
}

/* ---------------- Rendering ---------------- */

const boardEl = document.getElementById('board');
const turnTextEl = document.getElementById('turn-text');
const scorePinkEl = document.getElementById('score-pink');
const scorePurpleEl = document.getElementById('score-purple');
const captureHintEl = document.getElementById('capture-hint');
const logListEl = document.getElementById('log-list');
const winModal = document.getElementById('win-modal');
const winTitle = document.getElementById('win-title');
const winMessage = document.getElementById('win-message');
const rulesModal = document.getElementById('rules-modal');

function buildBoardDom() {
  boardEl.innerHTML = '';
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const square = document.createElement('div');
      const isDark = (row + col) % 2 === 1;
      square.className = `square ${isDark ? 'dark' : 'light'}`;
      square.dataset.row = row;
      square.dataset.col = col;
      if (isDark) {
        square.addEventListener('click', () => onSquareClick(row, col));
      }
      boardEl.appendChild(square);
    }
  }
}

function squareEl(row, col) {
  return boardEl.children[row * BOARD_SIZE + col];
}

function render() {
  // Clear pieces + classes
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const el = squareEl(row, col);
      el.classList.remove('selectable', 'selected', 'last-move');
      el.innerHTML = '';

      const piece = state.board[row][col];
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = `piece ${piece.player}${piece.king ? ' king' : ''}`;
        pieceEl.textContent = piece.king ? '👑' : '🦄';
        el.appendChild(pieceEl);
      }
    }
  }

  // Last move highlight
  if (state.lastMove) {
    squareEl(state.lastMove.from.row, state.lastMove.from.col).classList.add('last-move');
    squareEl(state.lastMove.to.row, state.lastMove.to.col).classList.add('last-move');
  }

  // Selected piece + legal destination dots
  if (state.selected) {
    squareEl(state.selected.row, state.selected.col).classList.add('selected');
    for (const move of state.legalMoves) {
      squareEl(move.row, move.col).classList.add('selectable');
    }
  }

  turnTextEl.textContent = `${playerName(state.turn)}'s turn`;
  document.querySelector('[data-player="pink"]').classList.toggle('active-player', state.turn === PLAYERS.PINK && !state.gameOver);
  document.querySelector('[data-player="purple"]').classList.toggle('active-player', state.turn === PLAYERS.PURPLE && !state.gameOver);

  scorePinkEl.textContent = state.scores.pink;
  scorePurpleEl.textContent = state.scores.purple;

  const movesInfo = getAllMoves(state.board, state.turn);
  captureHintEl.hidden = !(movesInfo.forced && !state.gameOver);
}

function playerName(player) {
  return player === PLAYERS.PINK ? 'Cotton Candy' : 'Galaxy Dream';
}

function addLogEntry(text) {
  const li = document.createElement('li');
  li.textContent = text;
  logListEl.appendChild(li);
  logListEl.scrollTop = logListEl.scrollHeight;
}

/* ---------------- Interaction ---------------- */

function onSquareClick(row, col) {
  if (state.gameOver) return;

  const piece = state.board[row][col];
  const movesInfo = getAllMoves(state.board, state.turn);

  // If mid multi-jump chain, only that piece may move.
  if (state.activeChain) {
    const isChainSquare = state.activeChain.row === row && state.activeChain.col === col;
    if (isChainSquare) return; // already selected
    const move = state.legalMoves.find(m => m.row === row && m.col === col);
    if (move) applyMove(state.activeChain.row, state.activeChain.col, move);
    return;
  }

  // Selecting one of your own pieces
  if (piece && piece.player === state.turn) {
    const allowedPieceIds = movesInfo.pieces.map(p => `${p.row},${p.col}`);
    if (movesInfo.forced && !allowedPieceIds.includes(`${row},${col}`)) {
      flashHint();
      return;
    }
    const entry = movesInfo.pieces.find(p => p.row === row && p.col === col);
    state.selected = { row, col };
    state.legalMoves = entry ? entry.moves : [];
    render();
    return;
  }

  // Clicking a destination square
  if (state.selected) {
    const move = state.legalMoves.find(m => m.row === row && m.col === col);
    if (move) {
      applyMove(state.selected.row, state.selected.col, move);
    } else {
      state.selected = null;
      state.legalMoves = [];
      render();
    }
  }
}

function flashHint() {
  captureHintEl.hidden = false;
  captureHintEl.style.animation = 'none';
  // Force reflow to restart animation
  void captureHintEl.offsetWidth;
  captureHintEl.style.animation = '';
}

function applyMove(fromRow, fromCol, move) {
  const piece = state.board[fromRow][fromCol];
  const isCapture = move.capturedRow !== undefined;

  state.board[move.row][move.col] = piece;
  state.board[fromRow][fromCol] = null;

  if (isCapture) {
    const capturedPiece = state.board[move.capturedRow][move.capturedCol];
    state.board[move.capturedRow][move.capturedCol] = null;
    state.scores[state.turn]++;
    spawnCaptureSparkles(move.capturedRow, move.capturedCol);
    addLogEntry(`${playerName(state.turn)} captured a ${playerName(capturedPiece.player)} piece!`);
  } else {
    addLogEntry(`${playerName(state.turn)} moved ${coordLabel(fromRow, fromCol)} → ${coordLabel(move.row, move.col)}`);
  }

  state.lastMove = { from: { row: fromRow, col: fromCol }, to: { row: move.row, col: move.col } };

  // Kinging
  let justKinged = false;
  if (!piece.king) {
    if ((piece.player === PLAYERS.PINK && move.row === 0) || (piece.player === PLAYERS.PURPLE && move.row === BOARD_SIZE - 1)) {
      piece.king = true;
      justKinged = true;
      addLogEntry(`${playerName(state.turn)}'s piece became a Unicorn King! 👑`);
    }
  }

  render();
  animateMovedPiece(move.row, move.col);
  if (justKinged) {
    spawnCelebrationBurst(move.row, move.col, true);
  }

  // Multi-jump: same piece must continue if more captures available
  // (works whether or not the piece just kinged, since forwardDirections()
  // already reflects the updated piece.king flag)
  if (isCapture) {
    const { captures } = getMovesForPiece(state.board, move.row, move.col);
    if (captures.length) {
      state.activeChain = { row: move.row, col: move.col };
      state.selected = { row: move.row, col: move.col };
      state.legalMoves = captures;
      render();
      return;
    }
  }

  endTurn();
}

function coordLabel(row, col) {
  const files = 'abcdefgh';
  return `${files[col]}${8 - row}`;
}

function endTurn() {
  state.selected = null;
  state.legalMoves = [];
  state.activeChain = null;
  state.turn = opponentOf(state.turn);
  render();
  checkGameOver();
}

function checkGameOver() {
  const movesInfo = getAllMoves(state.board, state.turn);
  const hasPieces = state.board.flat().some(p => p && p.player === state.turn);
  const hasMoves = movesInfo.pieces.length > 0;

  if (!hasPieces || !hasMoves) {
    state.gameOver = true;
    const winner = opponentOf(state.turn);
    showWin(winner, !hasPieces ? 'captured all the pieces' : 'has no legal moves left');
  }
}

function showWin(winner, reason) {
  winTitle.textContent = `🎉 ${playerName(winner)} Wins! 🎉`;
  winMessage.textContent = `${playerName(opponentOf(winner))} ${reason}. What a magical match!`;
  winModal.hidden = false;
  spawnCelebrationBurst(3, 3, false, true);
  render();
}

/* ---------------- Animation helpers ---------------- */

function animateMovedPiece(row, col) {
  const el = squareEl(row, col).querySelector('.piece');
  if (!el) return;
  el.classList.add('moving');
  setTimeout(() => el.classList.remove('moving'), 300);
}

/* =========================================================
   Sparkle / particle canvas effects
   ========================================================= */

const canvas = document.getElementById('sparkle-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

const SPARKLE_COLORS = ['#ff8fd8', '#a78bfa', '#8ffcd6', '#8fd9ff', '#ffe066', '#ffffff'];

function randomColor() {
  return SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)];
}

function makeParticle(x, y, opts = {}) {
  const speed = opts.speed ?? 1 + Math.random() * 3;
  const angle = opts.angle ?? Math.random() * Math.PI * 2;
  return {
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed - (opts.lift ?? 0),
    size: opts.size ?? 2 + Math.random() * 3,
    color: opts.color ?? randomColor(),
    life: 0,
    maxLife: opts.maxLife ?? 40 + Math.random() * 30,
    shape: opts.shape ?? (Math.random() > 0.5 ? 'star' : 'circle'),
    gravity: opts.gravity ?? 0.03,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.2,
  };
}

function spawnAmbientSparkle() {
  if (particles.length > 160) return;
  particles.push(makeParticle(Math.random() * canvas.width, canvas.height + 10, {
    angle: -Math.PI / 2 + (Math.random() - 0.5) * 0.6,
    speed: 0.6 + Math.random() * 1.2,
    lift: 0,
    gravity: -0.002,
    maxLife: 150 + Math.random() * 100,
    size: 1.5 + Math.random() * 2.5,
  }));
}

function elementCenter(row, col) {
  const el = squareEl(row, col);
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function spawnCaptureSparkles(row, col) {
  const { x, y } = elementCenter(row, col);
  for (let i = 0; i < 26; i++) {
    particles.push(makeParticle(x, y, { speed: 2 + Math.random() * 4, maxLife: 35 + Math.random() * 20 }));
  }
}

function spawnCelebrationBurst(row, col, small, fullScreen = false) {
  if (fullScreen) {
    for (let i = 0; i < 12; i++) {
      setTimeout(() => {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height * 0.6;
        for (let j = 0; j < 30; j++) {
          particles.push(makeParticle(x, y, { speed: 1 + Math.random() * 5, maxLife: 60 + Math.random() * 40, gravity: 0.05 }));
        }
      }, i * 120);
    }
    return;
  }
  const { x, y } = elementCenter(row, col);
  const count = small ? 40 : 20;
  for (let i = 0; i < count; i++) {
    particles.push(makeParticle(x, y, { speed: 1.5 + Math.random() * 4, maxLife: 50 + Math.random() * 30 }));
  }
}

function drawStar(x, y, size, rotation, color, alpha) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const outerAngle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const innerAngle = outerAngle + Math.PI / 5;
    ctx.lineTo(Math.cos(outerAngle) * size, Math.sin(outerAngle) * size);
    ctx.lineTo(Math.cos(innerAngle) * size * 0.45, Math.sin(innerAngle) * size * 0.45);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function tick() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (Math.random() < 0.4) spawnAmbientSparkle();

  particles = particles.filter(p => p.life < p.maxLife);
  for (const p of particles) {
    p.life++;
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.rotation += p.rotationSpeed;

    const lifeRatio = p.life / p.maxLife;
    const alpha = 1 - lifeRatio;

    if (p.shape === 'star') {
      drawStar(p.x, p.y, p.size * 1.6, p.rotation, p.color, alpha);
    } else {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  requestAnimationFrame(tick);
}

/* =========================================================
   Game boot / controls
   ========================================================= */

function newGame() {
  state.board = createInitialBoard();
  state.turn = PLAYERS.PINK;
  state.selected = null;
  state.legalMoves = [];
  state.mustCapturePieces = [];
  state.activeChain = null;
  state.scores = { pink: 0, purple: 0 };
  state.lastMove = null;
  state.gameOver = false;
  logListEl.innerHTML = '';
  winModal.hidden = true;
  addLogEntry('A fresh magical match begins! Cotton Candy goes first.');
  render();
}

document.getElementById('new-game-btn').addEventListener('click', newGame);
document.getElementById('play-again-btn').addEventListener('click', newGame);
document.getElementById('rules-btn').addEventListener('click', () => { rulesModal.hidden = false; });
document.getElementById('close-rules-btn').addEventListener('click', () => { rulesModal.hidden = true; });

buildBoardDom();
newGame();
requestAnimationFrame(tick);
