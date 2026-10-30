# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla JavaScript Tetris on HTML5 Canvas. No dependencies, no `package.json`, no build step, no tests, no linter. The README and UI text are in Spanish; keep user-facing strings (overlay text, button labels, HUD) in Spanish.

## Running

Open `index.html` directly in a browser, or serve the folder statically (recommended):

```bash
python -m http.server 8000   # then open http://localhost:8000
npx serve .
```

## Architecture

Three files: `index.html` (DOM: `#board` canvas, side panel with HUD, `#next-canvas`, shared `#overlay`), `style.css`, and `game.js` (all logic, loaded as a classic non-module script with `'use strict'`).

Key points in `game.js` that span multiple functions:

- **State is module-level globals** (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, `animId`, …), all (re)initialized in `init()`. `init()` is also the restart handler, so any new state must be reset there.
- **Board** is a `ROWS × COLS` matrix of `0` or a color index `1–7`. Piece shapes in `PIECES` store their own type index as the cell value, so `merge()` copies values directly and `COLORS[index]` gives the color. Adding a piece type means extending `PIECES`, `COLORS`, and the `* 7` in `randomPiece()` together.
- **Collision** (`collide(shape, x, y)`) is the single source of truth for movement, rotation (`tryRotate` with simple horizontal kicks `[0,-1,1,-2,2]`, not SRS), ghost projection (`ghostY`), and game-over detection in `spawn()`.
- **Lock pipeline**: `lockPiece()` → `merge()` → `clearLines()` (updates lines/score/level/`dropInterval`) → `spawn()` (promotes `next` to `current`, may call `endGame()`).
- **Game loop** (`loop`) uses `requestAnimationFrame` with a `dropAccum` time accumulator against `dropInterval`; it redraws the whole board every frame. Pause/game-over work by cancelling `animId`. GAME OVER uses `#overlay`; pause (`P`/`Escape`) opens the separate `#pause-menu` (`openPauseMenu`/`resume`).
- **Input blocking**: while `paused`, keydown only drives menu navigation (`handleMenuKey`). On resume, every key still held (`keysDown`) is copied to `blockedKeys` and ignored until its keyup.
- **Start level**: `startLevel` is a menu setting that survives `init()`; `init()` copies it to `startLevelOfGame`, and `clearLines()` computes `level = startLevelOfGame + floor(lines / 10)`. Speed comes from `speedFor(level)`.
- **Canvas sizing is coupled**: `#board` width/height in `index.html` must equal `COLS × BLOCK` by `ROWS × BLOCK`. The next-piece preview assumes a 4×4 grid of 30px cells (120×120 canvas).
