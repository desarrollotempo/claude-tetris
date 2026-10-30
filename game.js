'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Skins: cada una define su paleta, fondo, grid y función de dibujo de bloque.
// COLORS se reasigna al cambiar de skin (ver applySkin).
const SKINS = {
  retro: {
    label: 'Retro',
    colors: [
      null,
      '#4dd0e1', // I - cyan
      '#ffd54f', // O - yellow
      '#ba68c8', // T - purple
      '#81c784', // S - green
      '#e57373', // Z - red
      '#7986cb', // J - indigo
      '#ffb74d', // L - orange
    ],
    background: null, // usa el fondo del tema (CSS)
    grid: null,       // usa el color de grid del tema
    drawBlock: drawBlockRetro,
  },
  neon: {
    label: 'Neon',
    colors: [null, '#00f0ff', '#fff200', '#ff00ff', '#39ff14', '#ff1744', '#2979ff', '#ff9100'],
    background: '#000000',
    grid: '#0d0d1a',
    drawBlock: drawBlockNeon,
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a0e7e5', '#fff1a8', '#d7b9f5', '#b4f8c8', '#ffaebc', '#a7c7e7', '#ffd6a5'],
    background: null,
    grid: null,
    drawBlock: drawBlockPastel,
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#3cbcfc', '#f8b800', '#b53cfc', '#58d854', '#e40058', '#0058f8', '#fc7460'],
    background: null,
    grid: null,
    drawBlock: drawBlockPixel,
  },
};

const SKIN_KEY = 'tetris-skin';
let skin = SKINS.retro;
let COLORS = skin.colors;

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
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const menuControls = document.getElementById('menu-controls');
const startLevelEl = document.getElementById('start-level');
const levelDownBtn = document.getElementById('level-down');
const levelUpBtn = document.getElementById('level-up');

const MAX_START_LEVEL = 10;

let board, current, next, score, lines, level, startLevelOfGame, paused, gameOver, lastTime, dropAccum, dropInterval, animId;

// Ajuste del menú: persiste entre partidas, por eso no se reinicia en init()
let startLevel = 1;

// Teclas pulsadas ahora mismo, y teclas ignoradas hasta que se suelten
// (evita movimientos accidentales al cerrar el menú con una tecla mantenida)
const keysDown = new Set();
let blockedKeys = new Set();

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
    level = startLevelOfGame + Math.floor(lines / 10);
    dropInterval = speedFor(level);
    updateHUD();
  }
}

function speedFor(lvl) {
  return Math.max(100, 1000 - (lvl - 1) * 90);
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
  context.save();
  context.globalAlpha = alpha ?? 1;
  skin.drawBlock(context, x * size, y * size, COLORS[colorIndex], size);
  context.restore();
}

function drawBlockRetro(context, px, py, color, size) {
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(px + 1, py + 1, size - 2, 4);
}

function drawBlockNeon(context, px, py, color, size) {
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.fillStyle = color + '33'; // relleno translúcido
  context.fillRect(px + 3, py + 3, size - 6, size - 6);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(px + 3, py + 3, size - 6, size - 6);
  // núcleo brillante
  context.shadowBlur = 6;
  context.fillStyle = 'rgba(255,255,255,0.6)';
  context.fillRect(px + size / 2 - 2, py + size / 2 - 2, 4, 4);
}

function roundRectPath(context, x, y, w, h, r) {
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawBlockPastel(context, px, py, color, size) {
  const r = size * 0.25;
  roundRectPath(context, px + 2, py + 2, size - 4, size - 4, r);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = 'rgba(0,0,0,0.12)';
  context.lineWidth = 1;
  context.stroke();
  // brillo suave
  roundRectPath(context, px + 5, py + 4, size - 10, size * 0.3, r * 0.6);
  context.fillStyle = 'rgba(255,255,255,0.45)';
  context.fill();
}

// Patrón 6×6 de "píxeles": 0 = color base, 1 = luz, 2 = sombra, 3 = contorno
const PIXEL_PATTERN = [
  [3, 3, 3, 3, 3, 3],
  [3, 1, 1, 1, 0, 3],
  [3, 1, 0, 0, 2, 3],
  [3, 1, 0, 0, 2, 3],
  [3, 0, 2, 2, 2, 3],
  [3, 3, 3, 3, 3, 3],
];
const PIXEL_SHADES = [null, 'rgba(255,255,255,0.45)', 'rgba(0,0,0,0.3)', 'rgba(0,0,0,0.6)'];

function drawBlockPixel(context, px, py, color, size) {
  const n = PIXEL_PATTERN.length;
  const p = size / n;
  context.fillStyle = color;
  context.fillRect(px, py, size, size);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const shade = PIXEL_SHADES[PIXEL_PATTERN[r][c]];
      if (!shade) continue;
      context.fillStyle = shade;
      context.fillRect(px + c * p, py + r * p, p, p);
    }
}

function clearCanvas(context, cvs) {
  context.clearRect(0, 0, cvs.width, cvs.height);
  if (skin.background) {
    context.fillStyle = skin.background;
    context.fillRect(0, 0, cvs.width, cvs.height);
  }
}

function drawGrid() {
  ctx.strokeStyle = skin.grid ?? (document.documentElement.dataset.theme === 'light' ? '#e3e6f0' : '#22222e');
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
  clearCanvas(ctx, canvas);
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
  clearCanvas(nextCtx, nextCanvas);
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
}

function openPauseMenu() {
  paused = true;
  cancelAnimationFrame(animId);
  setControlsVisible(false);
  pauseMenu.classList.remove('hidden');
  resumeBtn.focus();
}

function closePauseMenu() {
  pauseMenu.classList.add('hidden');
  if (pauseMenu.contains(document.activeElement)) document.activeElement.blur();
  // Las teclas que siguen pulsadas no actúan hasta soltarlas
  blockedKeys = new Set(keysDown);
}

function resume() {
  if (!paused) return;
  closePauseMenu();
  paused = false;
  lastTime = performance.now();
  loop(lastTime);
}

function togglePause() {
  if (gameOver) return;
  if (paused) resume();
  else openPauseMenu();
}

function setControlsVisible(visible) {
  menuControls.classList.toggle('hidden', !visible);
  controlsBtn.setAttribute('aria-expanded', String(visible));
  controlsBtn.textContent = visible ? 'Ocultar controles' : 'Ver controles';
}

function setStartLevel(value) {
  startLevel = Math.min(MAX_START_LEVEL, Math.max(1, value));
  startLevelEl.textContent = startLevel;
  startLevelEl.setAttribute('aria-valuenow', String(startLevel));
  levelDownBtn.disabled = startLevel === 1;
  levelUpBtn.disabled = startLevel === MAX_START_LEVEL;
}

function handleMenuKey(e) {
  const items = [...pauseMenu.querySelectorAll('.menu-item')];
  const idx = items.indexOf(document.activeElement);
  switch (e.code) {
    case 'ArrowDown':
    case 'ArrowUp': {
      e.preventDefault();
      const step = e.code === 'ArrowDown' ? 1 : -1;
      const nextIdx = idx === -1 ? 0 : (idx + step + items.length) % items.length;
      items[nextIdx].focus();
      break;
    }
    case 'ArrowLeft':
    case 'ArrowRight':
      e.preventDefault();
      if (document.activeElement === startLevelEl)
        setStartLevel(startLevel + (e.code === 'ArrowRight' ? 1 : -1));
      break;
    case 'Space':
      // Space solo actúa sobre botones del menú, nunca hace scroll
      if (!(document.activeElement instanceof HTMLButtonElement)) e.preventDefault();
      break;
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
  startLevelOfGame = startLevel;
  level = startLevel;
  if (paused) closePauseMenu();
  paused = false;
  gameOver = false;
  dropInterval = speedFor(level);
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
  keysDown.add(e.code);
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (!e.repeat) togglePause();
    return;
  }
  // Menú abierto: las teclas solo navegan el menú, nunca mueven piezas
  if (paused) { handleMenuKey(e); return; }
  if (gameOver) return;
  if (blockedKeys.has(e.code)) {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    return;
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

document.addEventListener('keyup', e => {
  keysDown.delete(e.code);
  blockedKeys.delete(e.code);
});

// Si la ventana pierde el foco no llegan los keyup: olvidar todo
window.addEventListener('blur', () => {
  keysDown.clear();
  blockedKeys.clear();
});

restartBtn.addEventListener('click', init);
resumeBtn.addEventListener('click', resume);
menuRestartBtn.addEventListener('click', init);
controlsBtn.addEventListener('click', () => {
  setControlsVisible(menuControls.classList.contains('hidden'));
});
levelDownBtn.addEventListener('click', () => setStartLevel(startLevel - 1));
levelUpBtn.addEventListener('click', () => setStartLevel(startLevel + 1));

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

setStartLevel(startLevel);

// Skin: se guarda en localStorage y se aplica sin recargar
const skinSelect = document.getElementById('skin-select');

function applySkin(name) {
  const key = name in SKINS ? name : 'retro';
  skin = SKINS[key];
  COLORS = skin.colors;
  document.documentElement.dataset.skin = key;
  skinSelect.value = key;
  // redibuja aunque el loop esté detenido (pausa / game over)
  if (current) {
    draw();
    drawNext();
  }
}

for (const [key, s] of Object.entries(SKINS)) {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = s.label;
  skinSelect.appendChild(opt);
}

skinSelect.addEventListener('change', () => {
  applySkin(skinSelect.value);
  try { localStorage.setItem(SKIN_KEY, skinSelect.value); } catch (_) {}
  skinSelect.blur(); // evita que las flechas sigan cambiando la skin al jugar
});

let savedSkin = null;
try { savedSkin = localStorage.getItem(SKIN_KEY); } catch (_) {}
applySkin(savedSkin);

init();
