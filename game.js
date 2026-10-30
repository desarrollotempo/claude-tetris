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

// Menú de pausa
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const pauseControls = document.getElementById('pause-controls');
const startLevelSelect = document.getElementById('start-level');

// Ajuste (no estado de partida): persiste entre reinicios, no se resetea en init()
let startLevel = 1;
// Nivel con el que empezó la partida en curso (copia de startLevel fijada en init())
let gameStartLevel = 1;
// Tras reanudar: teclas pulsadas de nuevo (null = sin filtro). Las repeticiones automáticas
// (e.repeat) de teclas mantenidas durante la pausa se ignoran hasta que se vuelvan a pulsar.
let freshKeys = null;

function intervalForLevel(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
}

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
    level = gameStartLevel + Math.floor(lines / 10);
    dropInterval = intervalForLevel(level);
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

// ---- Skins visuales ----
// Cada skin define sus colores (índice 0 nulo, 1–7 tetrominós, 8 tuerca),
// fondo del canvas (null = fondo del tema CSS), color de la rejilla
// (null = color según tema claro/oscuro) y su propia función de dibujo.

function drawBlockRetro(context, x, y, color, size, alpha) {
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawBlockNeon(context, x, y, color, size, alpha) {
  const a = alpha ?? 1;
  const px = x * size + 3, py = y * size + 3, s = size - 6;
  context.shadowColor = color;
  context.shadowBlur = 14;
  context.fillStyle = color;
  context.globalAlpha = a * 0.25;
  context.fillRect(px, py, s, s);
  context.globalAlpha = a;
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(px, py, s, s);
  // reset del glow para que no se filtre a otros dibujos
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.fillStyle = 'rgba(255,255,255,0.5)';
  context.fillRect(px + s / 2 - 2, py + s / 2 - 2, 4, 4);
  context.globalAlpha = 1;
}

function roundRectPath(context, px, py, w, h, r) {
  context.beginPath();
  context.moveTo(px + r, py);
  context.arcTo(px + w, py, px + w, py + h, r);
  context.arcTo(px + w, py + h, px, py + h, r);
  context.arcTo(px, py + h, px, py, r);
  context.arcTo(px, py, px + w, py, r);
  context.closePath();
}

function drawBlockPastel(context, x, y, color, size, alpha) {
  const px = x * size + 1.5, py = y * size + 1.5, s = size - 3;
  context.globalAlpha = alpha ?? 1;
  roundRectPath(context, px, py, s, s, size * 0.25);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.6)';
  context.lineWidth = 1.5;
  context.stroke();
  // brillo suave
  roundRectPath(context, px + s * 0.2, py + s * 0.15, s * 0.35, s * 0.18, s * 0.09);
  context.fillStyle = 'rgba(255,255,255,0.45)';
  context.fill();
  context.globalAlpha = 1;
}

function drawBlockPixel(context, x, y, color, size, alpha) {
  const px = x * size, py = y * size;
  const p = size / 6; // 6×6 "píxeles" por bloque
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(px, py, size, size);
  // bisel: claro arriba/izquierda, oscuro abajo/derecha
  context.fillStyle = 'rgba(255,255,255,0.35)';
  context.fillRect(px, py, size - p, p);
  context.fillRect(px, py + p, p, size - 2 * p);
  context.fillStyle = 'rgba(0,0,0,0.35)';
  context.fillRect(px + p, py + size - p, size - p, p);
  context.fillRect(px + size - p, py, p, size - p);
  // textura interior: damero de píxeles
  context.fillStyle = 'rgba(0,0,0,0.12)';
  for (let r = 1; r < 5; r++)
    for (let c = 1; c < 5; c++)
      if ((r + c) % 2 === 0) context.fillRect(px + c * p, py + r * p, p, p);
  context.fillStyle = 'rgba(255,255,255,0.5)';
  context.fillRect(px + p, py + p, p, p);
  // contorno oscuro
  context.strokeStyle = 'rgba(0,0,0,0.6)';
  context.lineWidth = 1;
  context.strokeRect(px + 0.5, py + 0.5, size - 1, size - 1);
  context.globalAlpha = 1;
}

const SKINS = {
  retro: {
    label: 'Retro',
    colors: [...COLORS, '#a1887f'],
    bg: null,
    grid: null,
    drawBlock: drawBlockRetro,
  },
  neon: {
    label: 'Neón',
    colors: [null, '#00f0ff', '#fff200', '#ff00ff', '#39ff14', '#ff073a', '#3d5afe', '#ff9100', '#e0e0ff'],
    bg: '#000000',
    grid: '#11111f',
    drawBlock: drawBlockNeon,
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a8e6ef', '#fdf3b0', '#d7bde2', '#bfe8c4', '#f7b7b7', '#b9c3ee', '#fcd5a8', '#d9cbc2'],
    bg: null,
    grid: null,
    drawBlock: drawBlockPastel,
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#2ec4d6', '#f2c300', '#9b3fc4', '#3fae49', '#d93636', '#3b4fc4', '#f07c1c', '#8d6e63'],
    bg: null,
    grid: null,
    drawBlock: drawBlockPixel,
  },
};

const SKIN_KEY = 'tetris-skin';
let skin = SKINS.retro;

function loadSkinName() {
  try {
    const name = localStorage.getItem(SKIN_KEY);
    if (name && Object.prototype.hasOwnProperty.call(SKINS, name)) return name;
  } catch (e) { /* localStorage no disponible */ }
  return 'retro';
}

function saveSkinName(name) {
  try { localStorage.setItem(SKIN_KEY, name); } catch (e) { /* ignorar */ }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  skin.drawBlock(context, x, y, skin.colors[colorIndex], size, alpha);
}

function drawGrid() {
  ctx.strokeStyle = skin.grid || (document.documentElement.dataset.theme === 'light' ? '#e3e6f0' : '#22222e');
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
  if (skin.bg) {
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
  if (skin.bg) {
    nextCtx.fillStyle = skin.bg;
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  }
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
  showPauseMenu(false);
  overlay.classList.remove('hidden');
  showGameOverRecords();
}

// Alterna entre el menú de pausa y el botón único de Game Over (comparten #overlay)
function showPauseMenu(show) {
  pauseMenu.classList.toggle('hidden', !show);
  restartBtn.classList.toggle('hidden', show);
  if (!show) setControlsVisible(false);
}

function setControlsVisible(show) {
  pauseControls.classList.toggle('hidden', !show);
  controlsBtn.setAttribute('aria-expanded', String(show));
  controlsBtn.textContent = show ? 'Ocultar controles' : 'Ver controles';
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    showPauseMenu(false);
    if (document.activeElement && overlay.contains(document.activeElement)) document.activeElement.blur();
    freshKeys = new Set();
    dropAccum = 0;
    lastTime = performance.now();
    cancelAnimationFrame(animId);
    animId = requestAnimationFrame(loop);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    startLevelSelect.value = String(startLevel);
    showPauseMenu(true);
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
  gameStartLevel = startLevel;
  level = gameStartLevel;
  paused = false;
  gameOver = false;
  freshKeys = null;
  dropInterval = intervalForLevel(level);
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
  showPauseMenu(false);
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Records: no mover piezas mientras se escribe el nombre ni en la pantalla de inicio
  if (isTypingTarget(e.target) || onStartScreen) return;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    // Esc con el selector de nivel enfocado solo cierra su desplegable, no reanuda
    if (e.code === 'Escape' && e.target === startLevelSelect) { startLevelSelect.blur(); return; }
    if (e.repeat) return; // mantener P/Esc no debe abrir y cerrar el menú en bucle
    e.preventDefault();
    togglePause();
    return;
  }
  if (paused || gameOver) return; // menú abierto: inputs del juego bloqueados
  if (freshKeys) {
    // Tras reanudar, solo se aceptan repeticiones de teclas pulsadas de nuevo después de la pausa
    if (e.repeat && !freshKeys.has(e.code)) return;
    if (!e.repeat) freshKeys.add(e.code);
  }
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

// Menú de pausa: cada botón pierde el foco tras el clic para que Space/Enter no lo reactive
resumeBtn.addEventListener('click', () => {
  resumeBtn.blur();
  if (paused) togglePause();
});
pauseRestartBtn.addEventListener('click', () => {
  pauseRestartBtn.blur();
  init();
});
controlsBtn.addEventListener('click', () => {
  controlsBtn.blur();
  setControlsVisible(pauseControls.classList.contains('hidden'));
});
startLevelSelect.addEventListener('change', () => {
  const lvl = parseInt(startLevelSelect.value, 10);
  if (lvl >= 1 && lvl <= 10) startLevel = lvl;
  startLevelSelect.blur();
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

// Skin: selector persistente en localStorage, se aplica en caliente
const skinSelect = document.getElementById('skin-select');

function applySkin(name) {
  const valid = Object.prototype.hasOwnProperty.call(SKINS, name);
  skin = valid ? SKINS[name] : SKINS.retro;
  skinSelect.value = valid ? name : 'retro';
  // redibujar aunque el juego esté en pausa o terminado
  if (board && current) draw();
  if (next) drawNext();
}

for (const [name, def] of Object.entries(SKINS)) {
  const opt = document.createElement('option');
  opt.value = name;
  opt.textContent = def.label;
  skinSelect.appendChild(opt);
}
skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  saveSkinName(skinSelect.value);
  skinSelect.blur(); // devuelve flechas/Space al juego
});
// mientras el select tiene foco, sus teclas no mueven la pieza
skinSelect.addEventListener('keydown', e => e.stopPropagation());
applySkin(loadSkinName());

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
  if (skin.bg) {
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
