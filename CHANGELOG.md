# RISQUE-BETA Changelog

## 2026-04-26

### Fixed - Con-income double continent payout after cardplay campaign chain
- Prevent con-income from paying a continent again when it was already paid in the same turn's standard income (example: Europe after post-cardplay income).
- Added fallback exclusion metadata for standard-income continent keys when the attack-phase baseline snapshot is missing.
- Kept attack-entry baseline/session logic as primary source of truth; fallback only applies when baseline is unavailable.
- Made con-income current-player matching case-insensitive to avoid skipped filters on name-case differences.
- Cleared related conquest metadata on attack capture, turn advance, and conquest routing cleanup points.
- Fixed a `core.js` syntax error that caused a black screen on startup.

Files:
- `js/core.js`
- `phases/income.js`
- `phases/con-income-phase.js`
- `phases/deploy.js`
- `phases/con-transfertroops-phase.js`
- `game.html`

### Fixed - Campaign leave-behind consistency for multi-hop runs
- In campaign auto-transfer runs, when "leave N behind" (`N > 1`) cannot be sustained on a non-final hop (source would be left at 1), campaign now halts after that capture instead of continuing and creating multiple weak one-troop leftovers.
- Final hop still allows a thin finish (1-2 troops) where legally forced by battle outcome.

Files:
- `phases/attack.js`
- `game.html`
