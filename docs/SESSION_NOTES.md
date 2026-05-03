# RISQUE Session Handoff

## Date
- 2026-03-30

## Current Situation
- Game intermittently returns to `index.html` during/after `receivecard.html`, especially around round 2.
- Resume can then appear "stuck" in the same loop because it re-enters the same failing phase path.
- Navigation logs (`ballbuster.json`) show repeated pattern:
  - `cardplay.html?next=receivecard.html` -> `receivecard.html` -> `index.html` ~2 seconds later.

## Working Diagnosis
- Highest-probability cause: localStorage pressure / logging growth.
- `gameState` often remains valid at crash (`phase: receivecard`, valid player/round), suggesting error-path redirect rather than true state corruption.
- The 2-second timing matches existing redirect timers in error handlers.
- Animation is considered low-likelihood root cause for the redirect loop.

## Decisions Made
- Pause feature churn and treat this as an architecture/stability issue.
- Consider fallback to clean baseline (pre-change backup) and rebuild carefully.
- Prefer direction:
  - `index.html` as thin launcher/guardrails.
  - Single-page game runtime (`game.html`) for all phases.
- Rebuild in small testable steps, with explicit phase contracts and stable persistence.

## Implemented During This Thread (Current Folder)
- Added cross-page nav logging (`nav-log.js`) and inclusion in pages.
- Added automatic `ballbuster.json` export on login return detection.
- Added resume-flow adjustment (`cardplay` should route through privacy interstitial path).
- Added quota-relief save helper and some receive-card persistence hardening.

Note: This folder may contain mixed experimental fixes from this session.

## Recommended Next Start (After Reboot)
1. Open clean backup copy (pre-change baseline) in a separate folder.
2. Run baseline validation (2+ full rounds) and record results.
3. Re-apply changes in strict order:
   - Critical bug fixes only.
   - Resume routing correctness.
   - Safe bounded logging + quota-safe persistence.
   - Replay pipeline (card/income/deploy/reveal).
   - Visual/animation changes last.
4. After each batch, test:
   - `commit-turn -> leaving-private -> turn-reveal -> attack -> reinforce -> cardplay(next=receivecard) -> receivecard`

## Immediate Recovery Tip (No Code)
- If stuck in loop, keep `gameState` and clear only:
  - `gameLogs`
  - `risqueNavLog`
- Then retry Resume.

## What To Ask Next Session
- "Use this `SESSION_NOTES.md` and help me migrate from backup baseline toward a single-page architecture."
