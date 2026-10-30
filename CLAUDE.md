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
- **Board** is a `ROWS × COLS` matrix of `0` or a color index `1–8` (8 = the nut "challenge" piece, a 3×3 ring with a hollow center; `drawNutHole()` draws its center circle on the falling piece, ghost and preview only). Piece shapes in `PIECES` store their own type index as the cell value, so `merge()` copies values directly and `COLORS[index]` gives the color. Adding a piece type means extending `PIECES`, `COLORS`, every `SKINS[*].colors`, and the `* 8` in `randomPiece()` together.
- **Collision** (`collide(shape, x, y)`) is the single source of truth for movement, rotation (`tryRotate` with simple horizontal kicks `[0,-1,1,-2,2]`, not SRS), ghost projection (`ghostY`), and game-over detection in `spawn()`.
- **Lock pipeline**: `lockPiece()` → `merge()` → `clearLines()` (updates lines/score/level/`dropInterval`) → `spawn()` (promotes `next` to `current`, may call `endGame()`).
- **Game loop** (`loop`) uses `requestAnimationFrame` with a `dropAccum` time accumulator against `dropInterval`; it redraws the whole board every frame. Pause/game-over work by cancelling `animId`; the same `#overlay` element is reused for both PAUSA and GAME OVER. `showPauseMenu(bool)` swaps between `#pause-menu` (pause) and `#restart-btn` (game over).
- **Pause menu**: `P`/`Escape` call `togglePause()`; game inputs are ignored while `paused || gameOver`. Resuming resets `dropAccum`/`lastTime` and sets `freshKeys` so auto-repeat keydowns of keys held through the pause are ignored. Menu buttons `blur()` after click so Space/Enter can't re-trigger them.
- **`startLevel`** is a setting (from the pause menu's `#start-level` select), not per-game state: it is *not* reset in `init()`. `init()` copies it into per-game `gameStartLevel` (so changing it mid-game only affects the next game), and `clearLines()` computes `level = gameStartLevel + floor(lines / 10)`; speed comes from `intervalForLevel()`.
- **Records** (block at the end of `game.js`): stored in `localStorage` under `tetris-records` (`{ top: [{name, score, lines, level, date}], bestCombo, maxLines }`, max 5, parsed defensively by `loadRecords()`) plus `tetris-player-name` for the last used name. On load `showStartScreen()` shows the overlay with the table; the game only starts via `init()` from the "Jugar" button (`onStartScreen` blocks keys until then). `lockPiece()` calls `trackCombo()` (combo = consecutive locks that clear lines; `maxCombo` per game). `endGame()` calls `showGameOverRecords()`, which shows the name form if the score qualifies. The keydown handler ignores events targeting inputs. `init()` calls `hideRecordsUI()` so the records UI never shows during PAUSA.
- **Skins** (`SKINS` = `retro`/`neon`/`pastel`/`pixel`, active one in the `skin` global): each has `label`, `colors` (index 0 null, 1–8), `bg` (canvas fill or null for the CSS theme background), `grid` (or null for the theme-based color) and its own `drawBlock`. The top-level `drawBlock(context, x, y, colorIndex, size, alpha)` resolves `skin.colors[colorIndex]` and delegates, so read colors via `skin.colors`, not `COLORS` (which is only the retro base palette). `draw()`/`drawNext()` fill `skin.bg`; `drawGrid()` uses `skin.grid`. Skins that use `shadowBlur` must reset it to 0. The `#skin-select` choice persists in `localStorage` key `tetris-skin` and `applySkin()` redraws immediately. Skin is a setting, not reset in `init()`.
- **Canvas sizing is coupled**: `#board` width/height in `index.html` must equal `COLS × BLOCK` by `ROWS × BLOCK`. The next-piece preview assumes a 4×4 grid of 30px cells (120×120 canvas).
