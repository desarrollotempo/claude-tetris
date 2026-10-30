'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const newRecordEl = document.getElementById('new-record');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('player-name');
const recordsEl = document.getElementById('records');
const recordsBody = document.getElementById('records-body');
const bestComboEl = document.getElementById('best-combo');
const bestLinesEl = document.getElementById('best-lines');
const bestComboStat = document.getElementById('best-combo-stat');
const bestLinesStat = document.getElementById('best-lines-stat');
const resetRecordsBtn = document.getElementById('reset-records');

const RECORDS_KEY = 'tetris-records';
const MAX_RECORDS = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, maxCombo;
// Récords persistidos: { top: [{ name, score, lines, combo }], bestCombo, maxLines }
let records = loadRecords();
// Partida terminada que entra en el top y aún no tiene nombre
let pendingEntry = null;
// Índice en records.top de la última puntuación guardada (para resaltarla)
let savedIndex = -1;
let newBestCombo = false, newBestLines = false;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  // Combo: piezas consecutivas que limpian al menos una línea
  combo = cleared ? combo + 1 : 0;
  maxCombo = Math.max(maxCombo, combo);
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = document.documentElement.dataset.theme === 'light' ? '#e3e6f0' : '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- Récords (localStorage) ----

function loadRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (data && Array.isArray(data.top)) {
      return {
        top: data.top.slice(0, MAX_RECORDS),
        bestCombo: data.bestCombo | 0,
        maxLines: data.maxLines | 0,
      };
    }
  } catch (e) { /* datos corruptos o localStorage no disponible */ }
  return { top: [], bestCombo: 0, maxLines: 0 };
}

function saveRecords() {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch (e) { /* localStorage no disponible: los récords solo duran esta sesión */ }
}

// Posición que ocuparía una puntuación en el top, o -1 si no entra
function recordRank(value) {
  if (value <= 0) return -1;
  let i = records.top.findIndex(r => value > r.score);
  if (i === -1) i = records.top.length;
  return i < MAX_RECORDS ? i : -1;
}

function savePendingEntry(name) {
  if (!pendingEntry) return;
  const rank = recordRank(pendingEntry.score);
  pendingEntry.name = name.trim() || 'Anónimo';
  if (rank !== -1) {
    records.top.splice(rank, 0, pendingEntry);
    records.top.length = Math.min(records.top.length, MAX_RECORDS);
    saveRecords();
  }
  savedIndex = rank;
  pendingEntry = null;
}

function renderRecords() {
  const rows = records.top.map(r => ({ ...r }));
  let highlight = savedIndex;
  if (pendingEntry) {
    highlight = recordRank(pendingEntry.score);
    if (highlight !== -1) {
      rows.splice(highlight, 0, { ...pendingEntry, name: '???' });
      rows.length = Math.min(rows.length, MAX_RECORDS);
    }
  }

  recordsBody.replaceChildren();
  if (!rows.length) {
    const tr = recordsBody.insertRow();
    const td = tr.insertCell();
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = 'Sin récords todavía';
  }
  rows.forEach((r, i) => {
    const tr = recordsBody.insertRow();
    if (i === highlight) tr.className = 'current';
    [i + 1, r.name, r.score.toLocaleString(), r.lines].forEach(v => {
      tr.insertCell().textContent = v; // textContent: el nombre nunca se interpreta como HTML
    });
  });

  bestComboEl.textContent = records.bestCombo;
  bestLinesEl.textContent = records.maxLines;
  bestComboStat.classList.toggle('best', newBestCombo);
  bestLinesStat.classList.toggle('best', newBestLines);
}

function showStartScreen() {
  board = createBoard();
  gameOver = true; // bloquea el teclado hasta que empiece la partida
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  overlayTitle.textContent = 'TETRIS';
  overlayTitle.classList.add('start');
  overlayScore.textContent = '';
  newRecordEl.classList.add('hidden');
  nameForm.classList.add('hidden');
  recordsEl.classList.remove('hidden');
  restartBtn.textContent = 'Jugar';
  renderRecords();
  overlay.classList.remove('hidden');
}

function endGame() {
  draw();
  gameOver = true;
  cancelAnimationFrame(animId);

  newBestCombo = maxCombo > records.bestCombo;
  newBestLines = lines > records.maxLines;
  records.bestCombo = Math.max(records.bestCombo, maxCombo);
  records.maxLines = Math.max(records.maxLines, lines);
  saveRecords();

  const rank = recordRank(score);
  pendingEntry = rank !== -1 ? { name: '', score, lines, combo: maxCombo } : null;
  savedIndex = -1;

  overlayTitle.textContent = 'GAME OVER';
  overlayTitle.classList.remove('start');
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()} · Líneas: ${lines} · Combo máx.: ${maxCombo}`;
  if (rank !== -1) {
    newRecordEl.textContent = `¡NUEVO RÉCORD! Puesto #${rank + 1}`;
    newRecordEl.classList.remove('hidden');
    nameForm.classList.remove('hidden');
    nameInput.value = '';
  } else {
    newRecordEl.classList.add('hidden');
    nameForm.classList.add('hidden');
  }
  recordsEl.classList.remove('hidden');
  restartBtn.textContent = 'Reiniciar';
  renderRecords();
  overlay.classList.remove('hidden');
  if (rank !== -1) nameInput.focus();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayTitle.classList.remove('start');
    overlayScore.textContent = '';
    newRecordEl.classList.add('hidden');
    nameForm.classList.add('hidden');
    recordsEl.classList.add('hidden');
    restartBtn.textContent = 'Reiniciar';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  // Si se reinicia sin escribir nombre, el récord se guarda como anónimo
  savePendingEntry('');
  savedIndex = -1;
  newBestCombo = newBestLines = false;
  restartBtn.blur(); // evita que Space vuelva a pulsar el botón durante la partida
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  combo = 0;
  maxCombo = 0;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.target === nameInput) return; // escribiendo el nombre del récord
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  savePendingEntry(nameInput.value);
  nameForm.classList.add('hidden');
  nameInput.blur();
  renderRecords();
  restartBtn.focus();
});

resetRecordsBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los récords?')) return;
  records = { top: [], bestCombo: 0, maxLines: 0 };
  savedIndex = -1;
  newBestCombo = newBestLines = false;
  saveRecords();
  // Una partida terminada pendiente de nombre vuelve a contar contra la tabla vacía
  if (pendingEntry) {
    records.bestCombo = pendingEntry.combo;
    records.maxLines = pendingEntry.lines;
    saveRecords();
  }
  renderRecords();
  resetRecordsBtn.blur();
});

// Tema: oscuro por defecto, el switch cambia a claro
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');
themeToggle.addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  themeToggle.setAttribute('aria-checked', String(light));
  themeIcon.textContent = light ? '☀️' : '🌙';
  themeToggle.blur(); // evita que Space/Enter vuelva a activar el switch
});

showStartScreen();
