# RISQUE Handoff Notes

## Current Status

Project is running with runtime phases in `game.html` and phase modules under `phases/`.
Recent focus areas were attack/reinforce/cardplay stability, UI cleanup, and save-state corruption recovery.

## Key Recent Fixes

- **Attack combat log format**
  - Attack results now use outcome buckets:
    - `1: <ATTACKER> LOSES 1`
    - `2: <ATTACKER> LOSES 2`
    - `3: <DEFENDER> LOSES 1`
    - `4: <DEFENDER> LOSES 2`
    - `5: ONE A PIECE`
  - File: `phases/attack.js`

- **Attack click "hung" behavior hardening**
  - Added stale selection resync and clearer invalid-click prompts in `window.handleTerritoryClick`.
  - Prevents silent no-op feel when attacker/defender state becomes stale.
  - File: `phases/attack.js`

- **Harness chrome hidden**
  - Runtime top bar and side panel are globally hidden.
  - File: `game.html`

- **Login load-game button visibility**
  - Runtime login (`phases/login.js`) now keeps `LOAD GAME` visible in-panel.
  - Legacy full-page login was removed; runtime login (`phases/login.js`) keeps `LOAD GAME` in-panel.

- **Save-state corruption sanitizer**
  - Added `sanitizeTransientState()` to clear stale attack transfer lock on load.
  - This fixes corrupted saves where:
    - `phase !== "attack"` but `attackPhase === "pending_transfer"`
  - Sanitizer clears:
    - `attackPhase`, `attackingTerritory`, `acquiredTerritory`, `minTroopsToTransfer`, `conqueredThisTurn`
  - File: `js/core.js`

## Root Cause Found in User Save

Observed corrupted state snapshot had:

- `phase: "cardplay"`
- `attackPhase: "pending_transfer"`
- `attackingTerritory`, `acquiredTerritory`, and `minTroopsToTransfer` still set

This can block attack clicks later because attack code early-returns when pending transfer flag remains.

## Important Runtime Files

- `game.html` - runtime shell page and script loading
- `js/game-shell.js` - routing/render shell logic across phases
- `js/core.js` - shared rendering/state load/validation/sanitization
- `phases/attack.js` - attack logic (rolls/blitzes/transfer/prompts/selection)
- `phases/reinforce.js` - reinforcement logic + live preview behaviors
- `phases/attack-phase.js` - attack UI mount markup
- `phases/reinforce-phase.js` - reinforce mount
- `phases/cardplay.js` - cardplay interactions and card normalization
- `phases/login.js` - runtime login overlay and load game flow

## Manual Test Checklist

1. Login screen
   - Confirm both `LOG IN` and `LOAD GAME` are visible.
   - Load a valid save JSON.

2. Attack selection
   - Select attacker with 2+ troops, then enemy adjacent target.
   - Verify invalid clicks show guidance prompts.

3. Attack log output
   - Confirm result lines match the 1..5 wording scheme exactly.

4. Blitz modes
   - `INSTANT BLITZ` resolves quickly and logs rounds.
   - `PAUSABLE BLITZ` toggles pause/resume.
   - `CONDITIONAL BLITZ` respects threshold input.

5. Reinforce preview
   - Mouse wheel on destination and quick buttons update markers before confirm.

6. Corrupted save recovery
   - Load a save with stale `attackPhase: "pending_transfer"` while not in attack.
   - Confirm load completes and later attack clicks are functional.

## Known Caveats

- Running via `file://` URLs may show browser security-origin warnings in console.
- Those warnings can be noisy and occasionally interfere with browser behavior.
- Prefer running under local HTTP (e.g., localhost) for consistent behavior.

## Suggested Next Improvements

- Add a one-time user-facing notice when sanitizer repairs stale save state.
- Add a small debug "state integrity" panel for phase/transient flags in dev mode.
- Add explicit save export validation before writing snapshots.

