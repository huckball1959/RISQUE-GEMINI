# RISQUE Migration Milestones

## Workflow Rules
- Keep `RISKQUE PRECURSOR` untouched as baseline.
- Make changes only in this `RISQUE` folder.
- After each passed milestone, create a dated folder snapshot.

## Milestones

### M1 - Launcher + Single-Page Shell
Status: Complete

Goal:
- Add a thin `index.html` launcher.
- Add `game.html` + `game-shell.js` runtime shell.
- ~~Keep legacy flow intact as fallback.~~ (Legacy HTML prototypes removed; runtime is canonical.)

Exit Criteria:
- `index.html` loads.
- `Open New Runtime` launches `game.html`.
- `game.html` boots and renders the active phase view.

Snapshot Name:
- `RISQUE_M1_shell_2026-03-30`

### M2 - Stabilize `cardplay -> receivecard`
Status: In Progress

Goal:
- Port this loop to single-page phase rendering.
- Enforce one transition path with phase contracts.

Exit Criteria:
- Can complete 2+ consecutive turns without root redirects.
- Resume enters valid phase and continues.

Snapshot Name:
- `RISQUE_M2_cardplay_receivecard_2026-03-30`

### M3 - Full Turn Loop in Single-Page Runtime
Status: Pending

Goal:
- Port `income -> deploy -> attack -> reinforce -> receivecard`.
- Remove cross-page dependencies in the normal loop.

Exit Criteria:
- 2+ full rounds complete in runtime shell.
- Legacy pages are no longer required for normal play.

Snapshot Name:
- `RISQUE_M3_full_turn_loop_2026-03-30`

## Validation Notes
- Test path:
  - `commit-turn -> leaving-private -> turn-reveal -> attack -> reinforce -> cardplay(next=receivecard) -> receivecard`
- If looped/stuck:
  - Keep `gameState`.
  - Clear only `gameLogs` and `risqueNavLog`.
