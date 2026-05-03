# RISQUE-BETA Development Log

## 2026-04-26

### Session focus
- Resolve con-income double-pay behavior after cardplay/conquest sequence.
- Resolve campaign "leave 3 behind" behavior that could leave repeated one-troop territories.

### Completed

1) Con-income double-pay fix validated
- Problem:
  - After completing Europe via cardplay, normal income paid Europe.
  - Later in the same turn, after deploy -> campaign eliminate -> con-cardplay -> con-income, Europe was being treated as new and paid again.
- Resolution:
  - Added standard-income continent-key metadata fallback for "already paid this turn" when attack baseline is missing.
  - Unified con-income "exclude as new" checks to use attack baseline first, metadata fallback second.
  - Added case-insensitive current-player lookup in con-income path.
  - Added lifecycle clears for new metadata.
  - Corrected a syntax error in `js/core.js` discovered during runtime check.
- Validation result:
  - Repro sequence now pays only newly acquired Australia (14), not Europe again.

2) Campaign leave-behind consistency validated
- Problem:
  - In campaign mode with leave-behind set to 3, run could continue through multiple hops that left 1 troop behind repeatedly.
- Resolution:
  - Added campaign auto-transfer halt condition:
    - If leave-behind is greater than 1,
    - and hop is not final,
    - and only 1 troop remains on source after mandatory capture move,
    - then campaign halts after that capture and returns control for manual continuation.
- Validation result:
  - Behavior now matches expectation; no repeated one-troop leftovers across multiple campaign hops.

### Files touched in this session
- `js/core.js`
- `phases/income.js`
- `phases/con-income-phase.js`
- `phases/deploy.js`
- `phases/con-transfertroops-phase.js`
- `phases/attack.js`
- `game.html`

### Notes for next testing pass
- Re-test same flows after remote deployment (non-`file://`) to confirm parity with local behavior.
- If any mismatch appears, capture:
  - phase URL (`game.html?phase=...`)
  - host/public tab context
  - exact step where payout or transfer behavior diverges
