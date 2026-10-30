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
  overlay.classList.remove('hidden');
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
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
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

init();
