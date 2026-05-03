# Future ideas (backlog)

## Replay / Wayback window → external monitor (auto placement)

**Problem:** The in-page `window.open` for `replay-machine.html` usually lands on the same display as the host browser. Browsers do not offer a reliable “open on monitor 2” API for normal sites.

**Idea:** Mirror the **launcher / Win32** approach already used for the public TV window:

1. Keep a **small background helper** running (e.g. PowerShell), similar in spirit to `risque-organize-watch.ps1` / emergency watcher—started from `RISQUE.ps1` when using dual display.
2. When the user clicks **REPLAY**, the **page signals the helper** via a narrow **bridge**, for example:
   - write a flag/timestamp file under `C:\RISQUE\SAVE\` (host already has a folder handle after setup), or
   - `fetch` to a **localhost** listener on `127.0.0.1` that only accepts local commands.
3. The helper **polls** until a new Chromium top-level window appears that matches the replay (e.g. window **title** contains “Replay machine”, or heuristic “newest Chrome window that isn’t host/public”).
4. Use **Win32** (`SetWindowPos` / same patterns as `risque-chromium-primary.ps1`) to move and size that window to the **secondary screen’s `WorkingArea`**.

**Rough effort:** Medium-small—geometry and window enum are familiar; the main design choice is the **browser → script** signal and **correct window identity** under multi-window Chrome.

**Recorded:** 2026-04-30
