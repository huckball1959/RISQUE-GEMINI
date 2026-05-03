Mock risque-replay-v1 JSON files for testing replay-machine / Wayback without your SAVE folder.

- mock-session-r1-r5.json — clean session tape (init, deal, battles stamped rounds 1–5). The top-level
  "round" / "replayRound" fields are intentionally set like a mid-game export (e.g. 5) so you can verify
  the UI no longer flashes that number before PLAY (see minimalStateFromPack in replay-machine.js).

Copy a .json file into your REPLAY folder or use Open file in the replay machine to load it alone.

If live tapes still misbehave, archive old replay-full.json / replay-final.json and let the host write fresh exports after loading this codebase.
