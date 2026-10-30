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

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
// Records: combo actual / máximo de la partida; onStartScreen bloquea el teclado antes de "Jugar"
let combo = 0, maxCombo = 0, onStartScreen = true, pendingRecord = null;

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
  const linesBefore = lines;
  merge();
  clearLines();
  trackCombo(lines > linesBefore);
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

function endGame() {
  draw();
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
  showGameOverRecords();
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
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
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  combo = 0;
  maxCombo = 0;
  onStartScreen = false;
  hideRecordsUI();
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Records: no mover piezas mientras se escribe el nombre ni en la pantalla de inicio
  if (isTypingTarget(e.target) || onStartScreen) return;
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

// ---- Tabla de records (localStorage) ----
const RECORDS_KEY = 'tetris-records';
const PLAYER_NAME_KEY = 'tetris-player-name';
const MAX_RECORDS = 5;
const NAME_MAX_LEN = 12;

const recordsUI = document.getElementById('records-ui');
const recordsBody = document.getElementById('records-body');
const recordsEmpty = document.getElementById('records-empty');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');
const newRecordMsg = document.getElementById('new-record-msg');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const startBtn = document.getElementById('start-btn');

function isTypingTarget(el) {
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

function trackCombo(clearedLines) {
  combo = clearedLines ? combo + 1 : 0;
  if (combo > maxCombo) maxCombo = combo;
}

function defaultRecords() {
  return { top: [], bestCombo: 0, maxLines: 0 };
}

function toCount(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function loadRecords() {
  const rec = defaultRecords();
  let data;
  try {
    data = JSON.parse(localStorage.getItem(RECORDS_KEY));
  } catch (_) {
    return rec;
  }
  if (!data || typeof data !== 'object') return rec;
  if (Array.isArray(data.top)) {
    rec.top = data.top
      .filter(e => e && typeof e === 'object' && Number.isFinite(Number(e.score)))
      .map(e => ({
        name: String(e.name ?? '').slice(0, NAME_MAX_LEN) || 'Anónimo',
        score: toCount(e.score),
        lines: toCount(e.lines),
        level: toCount(e.level) || 1,
        date: typeof e.date === 'string' ? e.date : '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RECORDS);
  }
  rec.bestCombo = toCount(data.bestCombo);
  rec.maxLines = toCount(data.maxLines);
  return rec;
}

function saveRecords(rec) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(rec));
  } catch (_) { /* almacenamiento no disponible: se ignora */ }
}

function loadPlayerName() {
  try {
    return (localStorage.getItem(PLAYER_NAME_KEY) || '').slice(0, NAME_MAX_LEN);
  } catch (_) {
    return '';
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem(PLAYER_NAME_KEY, name);
  } catch (_) { /* ignorar */ }
}

function qualifiesForTop(rec, value) {
  if (value <= 0) return false;
  return rec.top.length < MAX_RECORDS || value > rec.top[rec.top.length - 1].score;
}

// Pinta la tabla; highlightIndex marca la fila recién guardada
function renderRecords(highlightIndex = -1, newStats = {}) {
  const rec = loadRecords();
  recordsBody.replaceChildren();
  rec.top.forEach((r, i) => {
    const tr = document.createElement('tr');
    if (i === highlightIndex) tr.classList.add('highlight');
    if (r.date) tr.title = new Date(r.date).toLocaleDateString();
    for (const val of [i + 1, r.name, r.score.toLocaleString(), r.lines, r.level]) {
      const td = document.createElement('td');
      td.textContent = String(val); // textContent: el nombre nunca se interpreta como HTML
      tr.appendChild(td);
    }
    recordsBody.appendChild(tr);
  });
  recordsEmpty.classList.toggle('hidden', rec.top.length > 0);
  bestComboEl.textContent = rec.bestCombo;
  maxLinesEl.textContent = rec.maxLines;
  bestComboEl.classList.toggle('new', !!newStats.combo);
  maxLinesEl.classList.toggle('new', !!newStats.lines);
}

function hideRecordsUI() {
  pendingRecord = null;
  recordsUI.classList.add('hidden');
  nameForm.classList.add('hidden');
  newRecordMsg.classList.add('hidden');
  startBtn.classList.add('hidden');
  restartBtn.classList.remove('hidden');
  overlay.classList.remove('start');
}

function showStartScreen() {
  onStartScreen = true;
  hideRecordsUI();
  overlay.classList.add('start');
  overlayTitle.textContent = 'RÉCORDS';
  overlayScore.textContent = '';
  restartBtn.classList.add('hidden');
  startBtn.classList.remove('hidden');
  recordsUI.classList.remove('hidden');
  renderRecords();
  overlay.classList.remove('hidden');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
}

function showGameOverRecords() {
  const rec = loadRecords();
  const newStats = { combo: maxCombo > rec.bestCombo, lines: lines > rec.maxLines };
  rec.bestCombo = Math.max(rec.bestCombo, maxCombo);
  rec.maxLines = Math.max(rec.maxLines, lines);
  saveRecords(rec);

  recordsUI.classList.remove('hidden');
  if (qualifiesForTop(rec, score)) {
    pendingRecord = { score, lines, level, date: new Date().toISOString(), newStats };
    newRecordMsg.classList.remove('hidden');
    nameForm.classList.remove('hidden');
    nameInput.value = loadPlayerName();
    nameInput.focus();
    nameInput.select();
  }
  renderRecords(-1, newStats);
}

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  if (!pendingRecord) return;
  const name = nameInput.value.trim().slice(0, NAME_MAX_LEN) || 'Anónimo';
  savePlayerName(name);
  const { newStats, ...data } = pendingRecord;
  const entry = { name, ...data };
  pendingRecord = null;

  const rec = loadRecords();
  rec.top.push(entry);
  // sort estable: con empate, la puntuación nueva queda detrás de la existente
  rec.top.sort((a, b) => b.score - a.score);
  const index = rec.top.indexOf(entry);
  rec.top = rec.top.slice(0, MAX_RECORDS);
  saveRecords(rec);

  nameInput.blur();
  nameForm.classList.add('hidden');
  renderRecords(index < MAX_RECORDS ? index : -1, newStats);
});

resetRecordsBtn.addEventListener('click', () => {
  resetRecordsBtn.blur();
  if (!confirm('¿Seguro que quieres borrar todos los records?')) return;
  try {
    localStorage.removeItem(RECORDS_KEY);
  } catch (_) { /* ignorar */ }
  // Si había una puntuación pendiente de guardar, sigue pudiendo guardarse
  renderRecords();
});

startBtn.addEventListener('click', init);

showStartScreen();
