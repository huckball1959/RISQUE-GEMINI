/**
 * Battle replay: territory snapshots recorded per round. Playback lives in replay-machine.html.
 * Events live in risqueReplayByRound (no global cap — avoids losing early rounds). Each round bucket has a per-round cap.
 */
(function () {
  "use strict";
  var REPLAY_TAPE_SIDECAR_KEY = "risqueReplayTapeSidecar";

  /**
   * Opt-in tape debugging for a new match (host + replay-machine):
   *   • URL: ?replayDebug=1 on game.html or replay-machine.html
   *   • Or: localStorage.setItem('risqueReplayDebug','1') then reload
   * Disable: localStorage.removeItem('risqueReplayDebug') and drop the query param.
   */
  function risqueReplayDebugIsOn() {
    try {
      if (typeof window !== "undefined" && window.location) {
        if (new URL(window.location.href).searchParams.get("replayDebug") === "1") return true;
      }
      if (typeof localStorage !== "undefined" && localStorage.getItem("risqueReplayDebug") === "1") {
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  function risqueReplayDebugLog() {
    if (!risqueReplayDebugIsOn()) return;
    try {
      var a = ["[ReplayDebug]"].concat(Array.prototype.slice.call(arguments));
      console.log.apply(console, a);
    } catch (eL) {
      /* ignore */
    }
  }

  window.risqueReplayDebugIsOn = risqueReplayDebugIsOn;
  window.risqueReplayDebugLog = risqueReplayDebugLog;

  /**
   * Strict indexOf fails when currentPlayer spelling differs from turnOrder (case/trim).
   * Granular disk flush matches tape recordedForPlayer to prev — wrong index ⇒ empty rNpM files.
   */
  window.risqueReplayResolveTurnOrderIndex = function (turnOrder, playerName) {
    if (!Array.isArray(turnOrder) || playerName == null) return { index: -1, canonical: "" };
    var raw = String(playerName).trim();
    if (!raw) return { index: -1, canonical: "" };
    var i;
    for (i = 0; i < turnOrder.length; i++) {
      var t = turnOrder[i];
      if (!t) continue;
      var s = String(t).trim();
      if (s === raw) return { index: i, canonical: s };
    }
    var low = raw.toLowerCase();
    for (i = 0; i < turnOrder.length; i++) {
      t = turnOrder[i];
      if (!t) continue;
      s = String(t).trim();
      if (s.toLowerCase() === low) return { index: i, canonical: s };
    }
    return { index: -1, canonical: raw };
  };

  var TAPE_VERSION = 2;
  /** Per completed round only — deal-heavy round 1 can be large; battles rarely approach this. */
  var MAX_EVENTS_PER_ROUND = 12000;

  var REPLAY_STRIP_KEYS = [
    "risqueReplayTape",
    /* Keep risqueReplayTapeSessionKey in saves so load + sidecar can match the same match (tiny string). */
    "risqueReplayPlayerColors",
    "risqueReplayByRound",
    "risqueReplayPlaybackActive",
    "risqueReplayHudRound",
    "risqueReplayHudActorLine",
    "risqueReplayBattleFlashLabels",
    "risquePublicReplayRound",
    "risquePublicReplayEliminationSplash",
    "phaseReplayIndex",
    /* RAM-only battle-stills buffer; never persist to localStorage / sidecar clones */
    "risqueCheapReplayStills",
    "risqueCheapReplayBattleSeq",
    "risqueCheapReplayFrameSeq"
  ];

  function tapeVersionOk(v) {
    return v === 1 || v === TAPE_VERSION;
  }

  /**
   * Single-pass JSON that skips top-level replay blobs — avoids multi‑MB stringify during long sessions
   * (Blitz/Campaign instant record many battle frames; cloning the full tape every time was O(session²)).
   */
  window.risqueJsonStringifyOmitReplayKeys = function (obj) {
    if (!obj || typeof obj !== "object") return "{}";
    try {
      return JSON.stringify(obj, function (key, val) {
        if (key !== "" && REPLAY_STRIP_KEYS.indexOf(key) !== -1) return undefined;
        return val;
      });
    } catch (e) {
      try {
        return JSON.stringify({});
      } catch (e2) {
        return "{}";
      }
    }
  };

  window.risqueCloneGameStateOmitReplayKeys = function (gs) {
    if (!gs || typeof gs !== "object") return null;
    try {
      return JSON.parse(window.risqueJsonStringifyOmitReplayKeys(gs));
    } catch (e) {
      return null;
    }
  };

  window.risqueStripReplayFromGameStateClone = function (gs) {
    if (!gs || typeof gs !== "object") return gs;
    var out = window.risqueCloneGameStateOmitReplayKeys(gs);
    return out != null ? out : gs;
  };

  /** Omit RAM-only cheap-replay buffers from localStorage (always; keys are huge during long matches). */
  window.risqueJsonStringifyGameStateForStorage = function (obj) {
    if (!obj || typeof obj !== "object") return "{}";
    try {
      return JSON.stringify(obj, function (key, val) {
        if (key === "risqueCheapReplayStills" || key === "risqueCheapReplayBattleSeq" || key === "risqueCheapReplayFrameSeq")
          return undefined;
        return val;
      });
    } catch (e) {
      try {
        return JSON.stringify(obj);
      } catch (e2) {
        return "{}";
      }
    }
  };

  /** Coalesce frequent disk sidecar writes during rapid combat (every battle called stringify of the full tape). */
  var __replaySidecarTimer = null;
  var __replaySidecarGsRef = null;

  function replayTapeEventCountFast(gs) {
    if (typeof window.risqueReplayTapeTotalEventCount === "function") {
      try {
        return window.risqueReplayTapeTotalEventCount(gs);
      } catch (eCnt) {
        /* ignore */
      }
    }
    return 0;
  }

  function replaySidecarPersistDelayMs(gs) {
    var n = replayTapeEventCountFast(gs);
    if (n > 400) return 2400;
    if (n > 200) return 1600;
    if (n > 80) return 900;
    return 450;
  }

  function scheduleReplayTapeSidecarPersist(gs) {
    if (gs && typeof gs === "object") {
      var tierSc =
        gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
      if (tierSc === "battle_stills" || tierSc === "host_ultra") return;
    }
    __replaySidecarGsRef = gs;
    if (__replaySidecarTimer != null) return;
    var delay = replaySidecarPersistDelayMs(gs);
    __replaySidecarTimer = setTimeout(function () {
      __replaySidecarTimer = null;
      var g = __replaySidecarGsRef;
      __replaySidecarGsRef = null;
      if (!g) return;
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(
          function () {
            replayTapeSidecarPersist(g);
          },
          { timeout: 3000 }
        );
      } else {
        replayTapeSidecarPersist(g);
      }
    }, delay);
  }

  window.risqueReplayScheduleTapeSidecarPersist = scheduleReplayTapeSidecarPersist;
  window.risqueReplayFlushTapeSidecarSchedule = function () {
    if (__replaySidecarTimer != null) {
      clearTimeout(__replaySidecarTimer);
      __replaySidecarTimer = null;
    }
    var g = __replaySidecarGsRef;
    __replaySidecarGsRef = null;
    if (g) replayTapeSidecarPersist(g);
  };

  function replayTapeSidecarSerialize(gs) {
    if (!gs || typeof gs !== "object") return null;
    if (!gs.risqueReplayByRound || typeof gs.risqueReplayByRound !== "object") return null;
    var hasAny = false;
    var keys = Object.keys(gs.risqueReplayByRound);
    var i;
    for (i = 0; i < keys.length; i++) {
      var arr = gs.risqueReplayByRound[keys[i]];
      if (Array.isArray(arr) && arr.length) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) return null;
    return {
      v: 1,
      savedAt: Date.now(),
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      risqueReplayTape: gs.risqueReplayTape && typeof gs.risqueReplayTape === "object" ? gs.risqueReplayTape : null,
      risqueReplayByRound: gs.risqueReplayByRound,
      risqueReplayPlayerColors:
        gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
          ? gs.risqueReplayPlayerColors
          : {},
      risqueReplayGranularWatermark:
        gs.risqueReplayGranularWatermark != null ? Number(gs.risqueReplayGranularWatermark) || 0 : 0,
      risqueReplayDealDeployDiskWritten: !!gs.risqueReplayDealDeployDiskWritten
    };
  }

  var REPLAY_SIDECAR_MAX_BYTES = 2800000;
  var __replaySidecarSkippedWarned = false;

  function replayTapeSidecarPersist(gs) {
    try {
      var payload = replayTapeSidecarSerialize(gs);
      if (!payload) return false;
      var json = JSON.stringify(payload);
      if (json.length > REPLAY_SIDECAR_MAX_BYTES) {
        if (!__replaySidecarSkippedWarned) {
          __replaySidecarSkippedWarned = true;
          try {
            console.warn(
              "[Replay] Sidecar not written — tape too large for localStorage (" +
                json.length +
                " bytes). Replay stays in RAM; use SAVE + REPLAY or finish the game for a disk file."
            );
          } catch (eW) {
            /* ignore */
          }
        }
        return false;
      }
      localStorage.setItem(REPLAY_TAPE_SIDECAR_KEY, json);
      return true;
    } catch (eSide) {
      if (eSide && (eSide.name === "QuotaExceededError" || eSide.code === 22)) {
        try {
          localStorage.removeItem(REPLAY_TAPE_SIDECAR_KEY);
        } catch (eRm) {
          /* ignore */
        }
        if (!__replaySidecarSkippedWarned) {
          __replaySidecarSkippedWarned = true;
          try {
            console.warn(
              "[Replay] Sidecar quota — removed risqueReplayTapeSidecar. Tape remains in memory this session."
            );
          } catch (eW2) {
            /* ignore */
          }
        }
      }
      return false;
    }
  }

  /** Stuck tab recovery: clear replay sidecar + game logs (host console). Does not reset an in-progress match in RAM. */
  window.risqueReplayEmergencyClearBrowserStorage = function () {
    var keys = ["risqueReplayTapeSidecar", "gameLogs", "risqueTransitionLedger"];
    var i;
    for (i = 0; i < keys.length; i++) {
      try {
        localStorage.removeItem(keys[i]);
      } catch (eK) {
        /* ignore */
      }
    }
    try {
      console.warn("[Replay] Cleared sidecar and log keys. Start a new game from login if the tab is unstable.");
    } catch (eL) {
      /* ignore */
    }
    return true;
  };

  function replayTapeSidecarRestore(gs) {
    if (!gs || typeof gs !== "object") return false;
    var hasReplayNow =
      (gs.risqueReplayByRound && Object.keys(gs.risqueReplayByRound).length > 0) ||
      (gs.risqueReplayTape && Array.isArray(gs.risqueReplayTape.events) && gs.risqueReplayTape.events.length > 0);
    if (hasReplayNow) return false;
    try {
      var raw = localStorage.getItem(REPLAY_TAPE_SIDECAR_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return false;
      var gSk = gs.risqueReplayTapeSessionKey != null ? String(gs.risqueReplayTapeSessionKey).trim() : "";
      var pSk = parsed.sessionKey != null ? String(parsed.sessionKey).trim() : "";
      if (pSk && gSk && pSk !== gSk) {
        return false;
      }
      if (pSk && !gSk) {
        gs.risqueReplayTapeSessionKey = parsed.sessionKey;
        gSk = pSk;
      }
      if (!parsed.risqueReplayByRound || typeof parsed.risqueReplayByRound !== "object") return false;
      var pKeys = Object.keys(parsed.risqueReplayByRound);
      if (!pKeys.length) return false;
      gs.risqueReplayByRound = parsed.risqueReplayByRound;
      if (parsed.risqueReplayTape && typeof parsed.risqueReplayTape === "object") {
        gs.risqueReplayTape = parsed.risqueReplayTape;
      }
      if (parsed.sessionKey) {
        gs.risqueReplayTapeSessionKey = parsed.sessionKey;
      }
      if (parsed.risqueReplayPlayerColors && typeof parsed.risqueReplayPlayerColors === "object") {
        gs.risqueReplayPlayerColors = parsed.risqueReplayPlayerColors;
      }
      if (parsed.risqueReplayGranularWatermark != null) {
        gs.risqueReplayGranularWatermark = Number(parsed.risqueReplayGranularWatermark) || 0;
      }
      if (parsed.risqueReplayDealDeployDiskWritten === true) {
        gs.risqueReplayDealDeployDiskWritten = true;
      }
      return true;
    } catch (eRst) {
      return false;
    }
  }

  window.risqueReplayPersistTapeSidecar = replayTapeSidecarPersist;
  window.risqueReplayRestoreFromSidecar = replayTapeSidecarRestore;

  /** Cancel debounced sidecar write and persist immediately (page hide / hard refresh). */
  window.risqueReplayPersistTapeSidecarImmediate = function (gs) {
    if (__replaySidecarTimer != null) {
      clearTimeout(__replaySidecarTimer);
      __replaySidecarTimer = null;
    }
    __replaySidecarGsRef = null;
    if (!gs || typeof gs !== "object") return false;
    return replayTapeSidecarPersist(gs);
  };

  window.risqueReplayTapeEventCount = function (gs) {
    if (!gs || typeof gs !== "object") return 0;
    if (typeof window.risqueReplayTapeTotalEventCount === "function") {
      return window.risqueReplayTapeTotalEventCount(gs);
    }
    if (gs.risqueReplayByRound && typeof gs.risqueReplayByRound === "object") {
      var n = 0;
      var keys = Object.keys(gs.risqueReplayByRound);
      var i;
      for (i = 0; i < keys.length; i++) {
        var arr = gs.risqueReplayByRound[keys[i]];
        if (Array.isArray(arr)) n += arr.length;
      }
      return n;
    }
    return 0;
  };

  function ensureReplayByRound(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayByRound || typeof gs.risqueReplayByRound !== "object") {
      gs.risqueReplayByRound = {};
    }
  }

  /**
   * One-time split: legacy saves only had risqueReplayTape.events. After migrate, new events go only to byRound.
   */
  function migrateLegacyTapeToByRound(gs) {
    if (!gs || !gs.risqueReplayTape || !Array.isArray(gs.risqueReplayTape.events)) return;
    ensureReplayByRound(gs);
    if (Object.keys(gs.risqueReplayByRound).length > 0) return;
    if (!gs.risqueReplayTape.events.length) return;
    gs.risqueReplayTape.events.forEach(function (ev) {
      var rk = ev && ev.round != null ? String(ev.round) : "1";
      if (!Array.isArray(gs.risqueReplayByRound[rk])) gs.risqueReplayByRound[rk] = [];
      gs.risqueReplayByRound[rk].push(ev);
    });
    gs.risqueReplayTape.events = [];
  }

  /** Pull init + deal frames out of wrong round buckets (legacy bug: stamped with live gs.round). */
  function repairMisplacedOpeningInByRound(gs) {
    if (!gs || !gs.risqueReplayByRound || typeof gs.risqueReplayByRound !== "object") return;
    var br = gs.risqueReplayByRound;
    var keys = Object.keys(br).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var toInit = [];
    var toDeal = [];
    var ki;
    for (ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      if (k === "1") continue;
      var arr = br[k];
      if (!Array.isArray(arr) || !arr.length) continue;
      var keep = [];
      var j;
      for (j = 0; j < arr.length; j++) {
        var e = arr[j];
        if (!e) {
          keep.push(e);
          continue;
        }
        if (e.type === "init") {
          e.round = 1;
          toInit.push(e);
        } else if (e.type === "board" && e.segment === "deal") {
          e.round = 1;
          toDeal.push(e);
        } else {
          keep.push(e);
        }
      }
      br[k] = keep;
    }
    if (!toInit.length && !toDeal.length) return;
    if (!Array.isArray(br["1"])) br["1"] = [];
    br["1"] = toInit.concat(toDeal).concat(br["1"]);
  }

  /**
   * Ordered event list (e.g. Mock Game Maker). Migrates legacy tape if needed.
   */
  window.risqueReplayFlattenEvents = function (gs) {
    if (!gs) return [];
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    repairMisplacedOpeningInByRound(gs);
    var keys = Object.keys(gs.risqueReplayByRound).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var out = [];
    keys.forEach(function (k) {
      (gs.risqueReplayByRound[k] || []).forEach(function (e) {
        out.push(e);
      });
    });
    return out;
  };

  /**
   * Same tape migrations + ordering as {@link risqueReplayFlattenEvents}, but O(1) extra memory — for autosave
   * tiers that skip granular rNpM.json (e.g. safe_lean) and only advance {@link risqueReplayGranularWatermark}.
   */
  window.risqueReplayTapeTotalEventCount = function (gs) {
    if (!gs) return 0;
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    repairMisplacedOpeningInByRound(gs);
    var br = gs.risqueReplayByRound;
    if (!br || typeof br !== "object") return 0;
    var keys = Object.keys(br).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var n = 0;
    var i;
    for (i = 0; i < keys.length; i++) {
      var arr = br[keys[i]];
      if (Array.isArray(arr)) n += arr.length;
    }
    return n;
  };

  /** Battle + elimination only — used for replay{N}.json when N ≥ 2 (opening/deal stay in replay-deal + round 1). */
  function isAttackPhaseTailReplayEvent(e) {
    if (!e) return false;
    if (e.type === "elimination") return true;
    return e.type === "board" && e.segment === "battle";
  }

  /**
   * Sidecar JSON for one completed round only (smaller files; chain in replay machine).
   * @param {object} gs
   * @param {number} [exportRound] — completed round number; defaults to gs.round
   */
  window.risqueBuildRoundReplayExport = function (gs, exportRound) {
    if (!gs || typeof gs !== "object") return null;
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    var n =
      exportRound != null && isFinite(Number(exportRound))
        ? Math.floor(Number(exportRound))
        : (function () {
            var r = gs.round;
            var x = typeof r === "number" ? r : parseInt(r, 10);
            return isFinite(x) && x >= 1 ? x : 1;
          })();
    var key = String(n);
    var evs = gs.risqueReplayByRound[key];
    if (!Array.isArray(evs) || !evs.length) return null;
    var slice = evs.slice();
    var attackTailOnly = n >= 2;
    if (attackTailOnly) {
      var tail = slice.filter(isAttackPhaseTailReplayEvent);
      if (tail.length) slice = tail;
    }
    var openingRecorded = slice.some(function (e) {
      return e && e.type === "init";
    });
    var hasDealFrames = slice.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
    var pack = {
      format: "risque-replay-v1",
      replayScope: "round",
      replayRound: n,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: gs.round,
      phase: gs.phase != null ? String(gs.phase) : "",
      currentPlayer: gs.currentPlayer != null ? String(gs.currentPlayer) : "",
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      playerColors:
        gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
          ? gs.risqueReplayPlayerColors
          : {},
      tape: {
        v: TAPE_VERSION,
        events: slice,
        openingRecorded: openingRecorded,
        hasDealFrames: hasDealFrames
      }
    };
    if (attackTailOnly) {
      try {
        pack.risqueReplayRoundAttackTailOnly = true;
      } catch (ePk) {
        /* ignore */
      }
    }
    return pack;
  };

  function shouldRecord(gs) {
    if (!gs || typeof gs !== "object") return false;
    if (window.risqueDisplayIsPublic) return false;
    /* Battle stills tier: no in-memory tape / sidecar — only rqwb-* stills flushed at game end. */
    if (gs.risqueAutosaveTier === "battle_stills" || gs.risqueAutosaveTier === "host_ultra") return false;
    return true;
  }

  function ensureTape(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayTape || typeof gs.risqueReplayTape !== "object") {
      gs.risqueReplayTape = { v: TAPE_VERSION, events: [], openingRecorded: false, hasDealFrames: false };
      return;
    }
    var tape = gs.risqueReplayTape;
    if (tape.v !== TAPE_VERSION) {
      tape.v = TAPE_VERSION;
    }
    if (!Array.isArray(tape.events)) {
      tape.events = [];
    }
    if (typeof tape.hasDealFrames !== "boolean") {
      tape.hasDealFrames = window.risqueReplayFlattenEvents(gs).some(function (e) {
        return e && e.type === "board" && e.segment === "deal";
      });
    }
  }

  function ensureReplayTapeSessionKey(gs) {
    if (!gs || typeof gs !== "object") return;
    if (gs.risqueReplayTapeSessionKey) return;
    try {
      gs.risqueSimpleAutosaveSeq = 0;
    } catch (eR) {
      /* ignore */
    }
    try {
      gs.risqueReplayGranularWatermark = 0;
      delete gs.risqueReplayDealDeployDiskWritten;
    } catch (eGr) {
      /* ignore */
    }
    gs.risqueReplayTapeSessionKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "rsq-" + String(Date.now()) + "-" + String(Math.floor(Math.random() * 1e9));
  }

  function mergeReplayPlayerColors(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayPlayerColors || typeof gs.risqueReplayPlayerColors !== "object") {
      gs.risqueReplayPlayerColors = {};
    }
    var m = gs.risqueReplayPlayerColors;
    (gs.players || []).forEach(function (p) {
      if (!p || !p.name || p.color == null || String(p.color).trim() === "") return;
      m[String(p.name).trim().toLowerCase()] = String(p.color).trim().toLowerCase();
    });
  }

  function snapshotBoard(gs) {
    var out = {};
    if (!gs || !gs.players) return out;
    gs.players.forEach(function (p) {
      if (!p || !p.name) return;
      (p.territories || []).forEach(function (t) {
        if (!t || !t.name) return;
        out[t.name] = { owner: String(p.name), troops: Number(t.troops) || 0 };
      });
    });
    return out;
  }

  function stampRound(gs, evt) {
    if (!evt) return;
    /* Init/deal must always be round 1. Previously we assigned gs.round first, then returned — late
     * ensureOpeningFrom (e.g. first battle in round 5) bucketed opening under "5", flatten order broke,
     * Wayback showed R5 during deal and skipped early rounds. */
    if (evt.type === "init" || (evt.type === "board" && evt.segment === "deal")) {
      evt.round = 1;
      return;
    }
    var r = gs && gs.round;
    var n = typeof r === "number" ? r : parseInt(r, 10);
    evt.round = isFinite(n) && n >= 1 ? n : 1;
    if (gs && gs.currentPlayer != null && String(gs.currentPlayer).trim() !== "") {
      var cpStamp = String(gs.currentPlayer).trim();
      if (
        Array.isArray(gs.turnOrder) &&
        gs.turnOrder.length &&
        typeof window.risqueReplayResolveTurnOrderIndex === "function"
      ) {
        var torStamp = window.risqueReplayResolveTurnOrderIndex(gs.turnOrder, gs.currentPlayer);
        if (torStamp && torStamp.index >= 0 && torStamp.canonical) {
          cpStamp = String(torStamp.canonical);
        }
      }
      evt.recordedForPlayer = cpStamp;
    }
  }

  function appendReplayEvent(gs, evt) {
    if (!gs || !evt) return false;
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    stampRound(gs, evt);
    var k = String(evt.round != null ? evt.round : 1);
    if (!Array.isArray(gs.risqueReplayByRound[k])) gs.risqueReplayByRound[k] = [];
    var bucket = gs.risqueReplayByRound[k];
    if (bucket.length >= MAX_EVENTS_PER_ROUND) return false;
    bucket.push(evt);
    return true;
  }

  function pushMirror() {
    if (typeof window.risqueMirrorPushGameState === "function") {
      try {
        window.risqueMirrorPushGameState();
      } catch (eM) {
        /* ignore */
      }
    }
  }

  function shouldDeferReplaySidecarPersist() {
    try {
      if (window.__risqueDealRunActive) return true;
      if (typeof window !== "undefined" && window.risqueDeploy1Active === true) return true;
    } catch (eDef) {
      /* ignore */
    }
    return false;
  }

  function pushRaw(gs, evt) {
    ensureTape(gs);
    if (!appendReplayEvent(gs, evt)) return;
    if (risqueReplayDebugIsOn() && evt) {
      var seg0 = evt.segment != null ? String(evt.segment) : "";
      var typ0 = String(evt.type || "");
      var nk0 =
        evt.board && typeof evt.board === "object" ? Object.keys(evt.board).length : 0;
      risqueReplayDebugLog(
        "record",
        typ0 + (seg0 ? "/" + seg0 : ""),
        "stampRound=" + (evt.round != null ? evt.round : "—"),
        "liveRound=" + (gs && gs.round != null ? gs.round : "—"),
        "boardKeys=" + nk0,
        "cp=" + (gs && gs.currentPlayer != null ? String(gs.currentPlayer) : "")
      );
    }
    mergeReplayPlayerColors(gs);
    if (!shouldDeferReplaySidecarPersist()) {
      scheduleReplayTapeSidecarPersist(gs);
    }
    if (typeof window.risqueScheduleMirrorPush === "function") {
      window.risqueScheduleMirrorPush();
    } else if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  }

  window.risqueReplaySeedOpening = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    migrateLegacyTapeToByRound(gs);
    var tape = gs.risqueReplayTape;
    if (tape.openingRecorded) return;
    tape.openingRecorded = true;
    if (tape.hasDealFrames) {
      mergeReplayPlayerColors(gs);
      replayTapeSidecarPersist(gs);
      pushMirror();
      return;
    }
    mergeReplayPlayerColors(gs);
    var evInit = {
      type: "init",
      board: snapshotBoard(gs),
      playerColors: Object.assign({}, gs.risqueReplayPlayerColors)
    };
    if (!appendReplayEvent(gs, evInit)) return;
    replayTapeSidecarPersist(gs);
    pushMirror();
  };

  window.risqueReplayRecordDeal = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var tape = gs.risqueReplayTape;
    tape.hasDealFrames = true;
    var evDeal = { type: "board", segment: "deal", board: snapshotBoard(gs) };
    pushRaw(gs, evDeal);
  };

  function ensureOpeningFrom(gs) {
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    migrateLegacyTapeToByRound(gs);
    var tape = gs.risqueReplayTape;
    if (tape.openingRecorded) return;
    tape.openingRecorded = true;
    if (tape.hasDealFrames) {
      mergeReplayPlayerColors(gs);
      replayTapeSidecarPersist(gs);
      pushMirror();
      return;
    }
    mergeReplayPlayerColors(gs);
    var evInit2 = {
      type: "init",
      board: snapshotBoard(gs),
      playerColors: Object.assign({}, gs.risqueReplayPlayerColors)
    };
    if (!appendReplayEvent(gs, evInit2)) return;
    replayTapeSidecarPersist(gs);
    pushMirror();
  }

  window.risqueReplayRecordDeploy = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureOpeningFrom(gs);
    pushRaw(gs, { type: "board", segment: "deploy", board: snapshotBoard(gs) });
  };

  /**
   * Build a risque-replay-v1 pack from an ordered event slice (granular disk exports).
   * Exposed for risque-session-disk (per-player attack phase files).
   */
  function buildGranularReplayPack(gs, eventsSlice, meta) {
    meta = meta || {};
    if (!gs || typeof gs !== "object" || !Array.isArray(eventsSlice)) return null;
    var allowEmpty = meta.allowEmptyDiskSegment === true;
    if (!eventsSlice.length && !allowEmpty) return null;
    var openingRecorded = eventsSlice.some(function (e) {
      return e && e.type === "init";
    });
    var hasDealFrames = eventsSlice.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
    var rr =
      meta.replayRound != null && isFinite(Number(meta.replayRound))
        ? Math.floor(Number(meta.replayRound))
        : 1;
    mergeReplayPlayerColors(gs);
    return {
      format: "risque-replay-v1",
      replayScope: meta.replayScope != null ? String(meta.replayScope) : "round",
      replayRound: rr,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: meta.round != null ? meta.round : rr,
      phase: meta.phase != null ? String(meta.phase) : "",
      currentPlayer: meta.currentPlayer != null ? String(meta.currentPlayer) : "",
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      /* Per-player attack slices only — Wayback uses this for slower glue playback. */
      risqueReplayGranularAttackPhase: meta.granularAttackPhase === true,
      playerColors:
        gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
          ? gs.risqueReplayPlayerColors
          : {},
      tape: {
        v: TAPE_VERSION,
        events: eventsSlice.slice(),
        openingRecorded: openingRecorded,
        hasDealFrames: hasDealFrames
      }
    };
  }

  window.risqueReplayBuildGranularExportPack = buildGranularReplayPack;

  /**
   * Call when the host enters cardplay (phase flip or cardplay page mount).
   * Writes replay-deal.json once: init + deal + deploy/reinforce frames before the first battle snapshot.
   */
  window.risqueReplayOnHostEnterCardplay = function () {
    /* DD.json is written once after setup deploy completes (see deploy.js); no cardplay flush. */
  };

  /**
   * Once per match: DD.json = init + deal + deploy/reinforce frames before the first battle snapshot.
   * Called when all players finish starting deployment (setup deploy).
   */
  function tryFlushGranularDealDeployReplay(gs) {
    if (!shouldRecord(gs)) return;
    if (gs.risqueAutosaveTier === "battle_stills" || gs.risqueAutosaveTier === "host_ultra") return;
    if (gs.risqueAutosaveTier === "safe_no_replay") return;
    /* DD.json is cheap and valuable; keep this one even in low-write mode. */
    if (gs.risqueReplayDealDeployDiskWritten) return;
    if (gs.__risqueReplayDealFlushInFlight) return;
    if (typeof window.risqueSessionDiskWriteReplayPackNamed !== "function") return;
    if (
      typeof window.risqueSessionDiskHasWritableSaveTarget === "function" &&
      !window.risqueSessionDiskHasWritableSaveTarget()
    ) {
      if (!window.__risqueReplayDealNoFolderWarned) {
        window.__risqueReplayDealNoFolderWarned = true;
        console.warn(
          "[Replay] Connect the host save folder (launcher / round setup) to write DD.json. " +
            "The browser does not show a download dialog — files are saved straight into the folder you picked."
        );
      }
      return;
    }
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    repairMisplacedOpeningInByRound(gs);
    var flat = window.risqueReplayFlattenEvents(gs);
    if (!Array.isArray(flat) || !flat.length) return;
    var firstBattle = -1;
    var bi;
    for (bi = 0; bi < flat.length; bi++) {
      var ev = flat[bi];
      if (ev && ev.type === "board" && ev.segment === "battle") {
        firstBattle = bi;
        break;
      }
    }
    var prefix = firstBattle === -1 ? flat.slice() : flat.slice(0, firstBattle);
    if (!prefix.length) return;
    var pack = buildGranularReplayPack(gs, prefix, {
      replayScope: "round",
      replayRound: 1,
      round: 1,
      phase: "deploy",
      currentPlayer: gs.currentPlayer != null ? String(gs.currentPlayer) : "",
      granularAttackPhase: false
    });
    if (!pack) return;
    try {
      gs.__risqueReplayDealFlushInFlight = true;
    } catch (eFl) {
      /* ignore */
    }
    var gRef = gs;
    setTimeout(function () {
      Promise.resolve(window.risqueSessionDiskWriteReplayPackNamed(gRef, "DD.json", pack))
        .then(function (ok) {
          try {
            delete gRef.__risqueReplayDealFlushInFlight;
          } catch (eIf) {
            /* ignore */
          }
          if (ok) {
            try {
              gRef.risqueReplayDealDeployDiskWritten = true;
            } catch (eOk) {
              /* ignore */
            }
          }
        })
        .catch(function () {
          try {
            delete gRef.__risqueReplayDealFlushInFlight;
          } catch (eC) {
            /* ignore */
          }
        });
    }, 0);
  }

  window.risqueReplayTryWriteDdJsonAfterSetupDeploy = tryFlushGranularDealDeployReplay;

  window.risqueReplayRecordBattle = function (gs, meta) {
    if (gs && typeof gs === "object") {
      var tierB =
        gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
      if (tierB === "battle_stills" || tierB === "host_ultra") {
        if (typeof window.risqueCheapReplayCaptureBattleOutcome === "function") {
          try {
            window.risqueCheapReplayCaptureBattleOutcome(gs, meta || null);
          } catch (eBs) {
            /* ignore */
          }
        }
        return;
      }
    }
    if (!shouldRecord(gs)) return;
    ensureOpeningFrom(gs);
    var board = snapshotBoard(gs);
    if (lastBoardJsonFromTape(gs) === boardJsonStable(board)) return;
    pushRaw(gs, { type: "board", segment: "battle", board: board });
  };

  /** Fortify / reinforcement transfers — kept distinct from battle frames so replay can include final moves. */
  window.risqueReplayRecordReinforce = function (gs) {
    if (!shouldRecord(gs)) return;
    ensureOpeningFrom(gs);
    pushRaw(gs, { type: "board", segment: "reinforce", board: snapshotBoard(gs) });
  };

  window.risqueReplayRecordElimination = function (gs, conqueror, defeated) {
    if (gs && typeof gs === "object") {
      var tierE =
        gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
      if (tierE === "battle_stills" || tierE === "host_ultra") {
        if (typeof window.risqueCheapReplayCaptureBattleOutcome === "function") {
          try {
            window.risqueCheapReplayCaptureBattleOutcome(gs, {
              attackerName: conqueror,
              defenderName: defeated,
              playerConquest: true,
              eliminated: true,
              allowDuplicateBoard: true
            });
          } catch (eBsE) {
            /* ignore */
          }
        }
        return;
      }
    }
    if (!shouldRecord(gs)) return;
    ensureTape(gs);
    ensureReplayTapeSessionKey(gs);
    var defName = defeated != null ? String(defeated).trim() : "";
    var defCol = "";
    if (gs && gs.players && defName) {
      var dpi;
      for (dpi = 0; dpi < gs.players.length; dpi++) {
        var dp = gs.players[dpi];
        if (dp && String(dp.name) === defName) {
          if (dp.color != null && String(dp.color).trim() !== "") {
            defCol = String(dp.color).trim().toLowerCase();
          }
          break;
        }
      }
    }
    if (!defCol && gs && gs.risqueReplayPlayerColors && defName) {
      var rpc = gs.risqueReplayPlayerColors;
      var rk;
      for (rk in rpc) {
        if (!Object.prototype.hasOwnProperty.call(rpc, rk)) continue;
        if (String(rk).trim().toLowerCase() === defName.toLowerCase()) {
          if (rpc[rk] != null && String(rpc[rk]).trim() !== "") {
            defCol = String(rpc[rk]).trim().toLowerCase();
          }
          break;
        }
      }
    }
    var evElim = {
      type: "elimination",
      conqueror: String(conqueror || ""),
      defeated: defName,
      defeatedColor: defCol
    };
    pushRaw(gs, evElim);
  };

  window.risqueReplayClearTapeSidecar = function () {
    try {
      localStorage.removeItem("risqueReplayTapeSidecar");
    } catch (e) {
      /* ignore */
    }
  };

  /**
   * Previously dropped completed rounds from RAM after autosave to shrink stringify / mirror payloads.
   * That broke Wayback and replay-full merges when disk round files were missing or stale (playback jumped
   * from deal to R4, etc.). Tape now stays in memory for the session; replay-full.json + replayN.json are
   * refreshed from disk autosave and turn checkpoints. QuotaExceeded handling in saveState may still prune
   * oldest buckets via risqueReplayPruneOldestRoundBuckets.
   */
  window.risqueReplayReleaseCompletedRoundAfterAutosave = function () {
    /* no-op — keep risqueReplayByRound intact for stable session replay and crash recovery */
  };

  /**
   * Keep only the newest `keepCount` numeric round buckets. Used when localStorage quota is tight.
   * @returns {number} number of buckets removed
   */
  window.risqueReplayPruneOldestRoundBuckets = function (gs, keepCount) {
    if (!gs || !gs.risqueReplayByRound || typeof gs.risqueReplayByRound !== "object") return 0;
    var keep = Math.max(2, Math.floor(Number(keepCount) || 3));
    var nums = Object.keys(gs.risqueReplayByRound)
      .map(function (key) {
        return Math.floor(Number(key) || 0);
      })
      .filter(function (x) {
        return x >= 1;
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (nums.length <= keep) return 0;
    var dropped = 0;
    var i;
    for (i = 0; i < nums.length - keep; i += 1) {
      try {
        delete gs.risqueReplayByRound[String(nums[i])];
        dropped++;
      } catch (ePr) {}
    }
    return dropped;
  };

  /** Idempotent session id for replay + autosave dedup (persists on game state). */
  window.risqueReplayEnsureTapeSessionKey = function (gs) {
    ensureReplayTapeSessionKey(gs);
  };

  function boardJsonStable(board) {
    try {
      return JSON.stringify(board || {});
    } catch (eB) {
      return "";
    }
  }

  /** Last board snapshot on the tape (O(buckets) walk, no flatten allocation). */
  function lastBoardJsonFromTape(gs) {
    if (!gs) return "";
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    var keys = Object.keys(gs.risqueReplayByRound || {}).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    var ri, bi, arr, e;
    for (ri = keys.length - 1; ri >= 0; ri--) {
      arr = gs.risqueReplayByRound[keys[ri]];
      if (!Array.isArray(arr) || !arr.length) continue;
      for (bi = arr.length - 1; bi >= 0; bi--) {
        e = arr[bi];
        if (e && e.type === "board" && e.board) {
          return boardJsonStable(e.board);
        }
        if (e && e.type === "init" && e.board) {
          return boardJsonStable(e.board);
        }
      }
    }
    return "";
  }

  /**
   * If the live board differs from the last recorded board frame, append a battle snapshot.
   * Catches in-progress attacks / transfers that have not yet been flushed to a round autosave file.
   */
  window.risqueReplayEnsureLatestBoardFrame = function (gs) {
    if (!gs || typeof gs !== "object") return false;
    if (gs.risqueAutosaveTier === "battle_stills" || gs.risqueAutosaveTier === "host_ultra") return false;
    if (!shouldRecord(gs)) return false;
    ensureOpeningFrom(gs);
    var currJ = boardJsonStable(snapshotBoard(gs));
    if (lastBoardJsonFromTape(gs) === currJ) return false;
    window.risqueReplayRecordBattle(gs);
    return true;
  };

  /**
   * Full tape from game start through current memory (all rounds in risqueReplayByRound), for Wayback / disk export.
   * Exports the complete recorded timeline — we do not trim the live round to “players so far”, so replay files
   * and the replay machine see the whole round (not just the last battle frame).
   * @returns {object|null} risque-replay-v1 pack or null if no events
   */
  window.risqueBuildSessionReplayExport = function (gs) {
    if (!gs || typeof gs !== "object") return null;
    ensureLatestBoardFrameForExport(gs);
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    var evs = window.risqueReplayFlattenEvents(gs);
    if (!Array.isArray(evs) || !evs.length) return null;
    /* Do not thin deal frames here — session export must preserve full deal animation for Wayback/replay-full. */
    evs = replayNormalizeTapeEventOrder(evs);
    if (!Array.isArray(evs) || !evs.length) return null;
    var maxR = maxRoundInEvents(evs);
    var gRn = floorGameRound(gs);
    if (isFinite(gRn) && gRn > maxR) maxR = gRn;
    var openingRecorded = evs.some(function (e) {
      return e && e.type === "init";
    });
    var hasDealFrames = evs.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
    return {
      format: "risque-replay-v1",
      replayScope: "session",
      replayRound: maxR,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: gs.round,
      phase: gs.phase != null ? String(gs.phase) : "",
      currentPlayer: gs.currentPlayer != null ? String(gs.currentPlayer) : "",
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      playerColors:
        gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
          ? gs.risqueReplayPlayerColors
          : {},
      tape: {
        v: TAPE_VERSION,
        events: evs,
        openingRecorded: openingRecorded,
        hasDealFrames: hasDealFrames
      }
    };
  };

  function packSavedAtMsMerge(p) {
    var n = p && p.savedAt != null ? Number(p.savedAt) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function effectiveReplayRoundFromPackMerge(p) {
    if (!p) return 0;
    var rr = Number(p.replayRound != null ? p.replayRound : p.round) || 0;
    if (rr >= 1) return rr;
    var evs = p.tape && p.tape.events;
    if (!Array.isArray(evs) || !evs.length) return 0;
    var i;
    var minR = 0;
    for (i = 0; i < evs.length; i++) {
      var er = evs[i] && evs[i].round != null ? Number(evs[i].round) : NaN;
      if (!isFinite(er) || er < 1) continue;
      if (minR === 0 || er < minR) minR = er;
    }
    return minR;
  }

  function tapeHasInitAndDeal(evs) {
    if (!Array.isArray(evs)) return false;
    var hi = evs.some(function (e) {
      return e && e.type === "init";
    });
    var hd = evs.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
    return hi && hd;
  }

  /** Init+deal, or per-territory deal (many steps), or deal+deploy — matches on-disk tapes that omit legacy init. */
  /** Exported for tier-3 endgame merge (game-shell). */
  window.risqueTapeHasUsableReplayOpening = function tapeHasUsableReplayOpening(evs) {
    if (!Array.isArray(evs)) return false;
    var dealN = 0;
    var depN = 0;
    var hi = false;
    var i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (!e) continue;
      if (e.type === "init") hi = true;
      if (e.type === "board" && e.segment === "deal") dealN++;
      if (e.type === "board" && e.segment === "deploy") depN++;
    }
    if (hi && dealN) return true;
    if (dealN >= 8) return true;
    if (dealN >= 1 && depN >= 1) return true;
    return false;
  };

  function tapeHasInitOnly(evs) {
    if (!Array.isArray(evs)) return false;
    return evs.some(function (e) {
      return e && e.type === "init";
    });
  }

  function tapeHasDealOnly(evs) {
    if (!Array.isArray(evs)) return false;
    return evs.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
  }

  /** First init frame from a session tape (round sidecars often have deal but omit init). */
  function extractFirstInitFromEvents(evs) {
    if (!Array.isArray(evs)) return [];
    var i;
    for (i = 0; i < evs.length; i++) {
      if (evs[i] && evs[i].type === "init") {
        return [evs[i]];
      }
    }
    return [];
  }

  /** Init + consecutive deal frames at the start of a session snapshot (for splicing onto round-only files). */
  function extractOpeningPrefixEvents(evs) {
    var out = [];
    if (!Array.isArray(evs)) return out;
    var i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (!e) continue;
      if (e.type === "init") {
        out.push(e);
        continue;
      }
      if (e.type === "board" && e.segment === "deal") {
        out.push(e);
        continue;
      }
      break;
    }
    return out;
  }

  /** Disk JSON and legacy tapes may stamp init/deal with live gs.round — playback HUD must see round 1. */
  function sanitizeInitDealRoundStamps(events) {
    if (!Array.isArray(events)) return events;
    var i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e) continue;
      if (e.type === "init" || (e.type === "board" && e.segment === "deal")) {
        e.round = 1;
      }
    }
    return events;
  }

  /**
   * Folder merges and disk+RAM Wayback concat can leave stray mid-game frames before the first init
   * (e.g. a stamped-R5 battle flashes on PLAY, then init/deal runs — HUD jumps to R4).
   * Move the first init + consecutive deal frames to the front; drop duplicate inits from the tail.
   */
  function replayNormalizeTapeEventOrder(events) {
    if (!Array.isArray(events)) return events;
    if (events.length < 2) {
      sanitizeInitDealRoundStamps(events);
      return events;
    }
    var iInit = -1;
    var i;
    for (i = 0; i < events.length; i++) {
      if (events[i] && events[i].type === "init") {
        iInit = i;
        break;
      }
    }
    if (iInit <= 0) {
      sanitizeInitDealRoundStamps(events);
      return events;
    }
    var prefix = [];
    var pi = iInit;
    prefix.push(events[pi]);
    pi++;
    while (pi < events.length) {
      var e = events[pi];
      if (e && e.type === "board" && e.segment === "deal") {
        prefix.push(e);
        pi++;
        continue;
      }
      break;
    }
    var before = events.slice(0, iInit);
    var after = events.slice(iInit + prefix.length);
    var tail = before.concat(after);
    var outTail = [];
    for (i = 0; i < tail.length; i++) {
      var ev = tail[i];
      if (ev && ev.type === "init") continue;
      outTail.push(ev);
    }
    var combined = prefix.concat(outTail);
    sanitizeInitDealRoundStamps(combined);
    return combined;
  }

  window.risqueReplayNormalizeTapeEventOrder = replayNormalizeTapeEventOrder;

  function pickRichestSessionPack(sessionPacks) {
    if (!sessionPacks || !sessionPacks.length) return null;
    var withOpen = sessionPacks.filter(function (p) {
      return tapeHasInitAndDeal(p.tape && p.tape.events);
    });
    var pool = withOpen.length ? withOpen : sessionPacks;
    var best = null;
    var bestLen = -1;
    pool.forEach(function (p) {
      var n = p.tape && p.tape.events ? p.tape.events.length : 0;
      if (n > bestLen) {
        bestLen = n;
        best = p;
      }
    });
    return best;
  }

  /**
   * Merge round-scoped segment files by replay round.
   * Multiple files with the same replayRound used to keep only the newest — that dropped glued r1p1+r1p2+r1p3.
   * Files marked risqueReplayGranularAttackPhase are concatenated in save-time order for that round.
   */
  function mergeRoundScopedPacksOnly(roundPacks) {
    if (!roundPacks || !roundPacks.length) return null;
    if (roundPacks.length === 1) {
      var sole = roundPacks[0];
      if (sole && sole.risqueReplayGranularAttackPhase === true) {
        try {
          sole.risqueReplayGranularGlueRelax = true;
        } catch (eSole) {}
      }
      return sole;
    }
    var byRound = {};
    roundPacks.forEach(function (p) {
      var rr = effectiveReplayRoundFromPackMerge(p);
      if (!rr) return;
      if (!byRound[rr]) byRound[rr] = [];
      byRound[rr].push({ pack: p, sav: packSavedAtMsMerge(p) });
    });
    var nonGranularDupRounds = [];
    var resolved = [];
    Object.keys(byRound).forEach(function (k) {
      var rr = Number(k);
      if (!isFinite(rr) || rr < 1) return;
      var lst = byRound[k].slice().sort(function (a, b) {
        return a.sav - b.sav;
      });
      var sortSav = lst.length ? lst[0].sav : 0;
      function openingSidecarNoBattle(pk) {
        if (!pk || !pk.tape || !Array.isArray(pk.tape.events) || !pk.tape.events.length) return false;
        if (pk.risqueReplayGranularAttackPhase === true) return false;
        if (!tapeHasUsableReplayOpening(pk.tape.events)) return false;
        return !pk.tape.events.some(function (e) {
          return e && e.type === "board" && e.segment === "battle";
        });
      }
      var openSeg = lst.filter(function (x) {
        return x.pack && openingSidecarNoBattle(x.pack);
      });
      var granSeg = lst.filter(function (x) {
        return x.pack && x.pack.risqueReplayGranularAttackPhase === true;
      });
      var otherSeg = lst.filter(function (x) {
        return openSeg.indexOf(x) < 0 && granSeg.indexOf(x) < 0;
      });
      /* DD.json + r1p1… share replayRound 1; without this branch the non-granular path keeps newest only and drops the deal/deploy opening. */
      if (granSeg.length && openSeg.length) {
        var eventsOpenGran = [];
        openSeg.forEach(function (x) {
          var teO = x.pack.tape && x.pack.tape.events;
          if (teO && teO.length) eventsOpenGran = eventsOpenGran.concat(teO.slice());
        });
        granSeg.forEach(function (x) {
          var teG = x.pack.tape && x.pack.tape.events;
          if (teG && teG.length) eventsOpenGran = eventsOpenGran.concat(teG.slice());
        });
        var tailPkOg = granSeg.length ? granSeg[granSeg.length - 1].pack : openSeg[openSeg.length - 1].pack;
        var mgColorsOg = {};
        openSeg.concat(granSeg).forEach(function (x) {
          var pc = x.pack && x.pack.playerColors;
          if (!pc || typeof pc !== "object") return;
          Object.keys(pc).forEach(function (key) {
            var v = pc[key];
            if (v == null || String(v).trim() === "") return;
            var kn = String(key).trim().toLowerCase();
            if (mgColorsOg[kn] == null || String(mgColorsOg[kn]).trim() === "") {
              mgColorsOg[kn] = String(v).trim().toLowerCase();
            }
          });
        });
        var warnOg = [
          "Opening tape (deal/deploy) + " +
            granSeg.length +
            " attack segment file(s) for round " +
            rr +
            " (save-time order)."
        ];
        if (otherSeg.length) {
          warnOg.push(
            "Ignored " +
              otherSeg.length +
              " other replay file(s) for round " +
              rr +
              " in favor of opening + attack segments."
          );
        }
        resolved.push({
          rr: rr,
          sav: sortSav,
          pack: {
            format: "risque-replay-v1",
            replayScope: "merged",
            replayRound: rr,
            risqueReplayGranularGlueRelax: true,
            tapeFormatVersion: TAPE_VERSION,
            savedAt: Date.now(),
            round: tailPkOg.round,
            phase: tailPkOg.phase,
            currentPlayer: tailPkOg.currentPlayer,
            sessionKey: tailPkOg.sessionKey,
            playerColors: mgColorsOg,
            tape: {
              v: TAPE_VERSION,
              events: eventsOpenGran,
              openingRecorded: eventsOpenGran.some(function (e) {
                return e && e.type === "init";
              }),
              hasDealFrames: eventsOpenGran.some(function (e) {
                return e && e.type === "board" && e.segment === "deal";
              })
            },
            __mergeWarnings: warnOg
          }
        });
        return;
      }
      var allGran = lst.every(function (x) {
        return x.pack && x.pack.risqueReplayGranularAttackPhase === true;
      });
      if (allGran) {
        if (lst.length === 1) {
          var pOne = lst[0].pack;
          try {
            pOne.risqueReplayGranularGlueRelax = true;
          } catch (eOne) {}
          resolved.push({ pack: pOne, rr: rr, sav: sortSav });
        } else {
          var eventsConcat = [];
          lst.forEach(function (x) {
            var te = x.pack.tape && x.pack.tape.events;
            if (te && te.length) eventsConcat = eventsConcat.concat(te.slice());
          });
          var tailPk = lst[lst.length - 1].pack;
          var mgColors = {};
          lst.forEach(function (x) {
            var pc = x.pack && x.pack.playerColors;
            if (!pc || typeof pc !== "object") return;
            Object.keys(pc).forEach(function (key) {
              var v = pc[key];
              if (v == null || String(v).trim() === "") return;
              var kn = String(key).trim().toLowerCase();
              if (mgColors[kn] == null || String(mgColors[kn]).trim() === "") {
                mgColors[kn] = String(v).trim().toLowerCase();
              }
            });
          });
          resolved.push({
            rr: rr,
            sav: sortSav,
            pack: {
              format: "risque-replay-v1",
              replayScope: "merged",
              replayRound: rr,
              risqueReplayGranularGlueRelax: true,
              tapeFormatVersion: TAPE_VERSION,
              savedAt: Date.now(),
              round: tailPk.round,
              phase: tailPk.phase,
              currentPlayer: tailPk.currentPlayer,
              sessionKey: tailPk.sessionKey,
              playerColors: mgColors,
              tape: {
                v: TAPE_VERSION,
                events: eventsConcat,
                openingRecorded: eventsConcat.some(function (e) {
                  return e && e.type === "init";
                }),
                hasDealFrames: eventsConcat.some(function (e) {
                  return e && e.type === "board" && e.segment === "deal";
                })
              },
              __mergeWarnings: [
                "Glued " +
                  lst.length +
                  " granular attack segment files for round " +
                  rr +
                  " (oldest save first within the round)."
              ]
            }
          });
        }
      } else {
        lst.sort(function (a, b) {
          return b.sav - a.sav;
        });
        if (lst.length > 1) nonGranularDupRounds.push(rr);
        resolved.push({ pack: lst[0].pack, rr: rr, sav: sortSav });
      }
    });
    resolved.sort(function (a, b) {
      if (a.sav !== b.sav) return a.sav - b.sav;
      return a.rr - b.rr;
    });
    var sorted = resolved.map(function (s) {
      return s.pack;
    });
    var replayRoundOrder = resolved.map(function (s) {
      return s.rr;
    });
    var rrMonotone = true;
    var i;
    for (i = 1; i < resolved.length; i++) {
      if (resolved[i].rr < resolved[i - 1].rr) {
        rrMonotone = false;
        break;
      }
    }
    var events = [];
    var lastR = 0;
    var gaps = [];
    for (i = 0; i < sorted.length; i++) {
      var p = sorted[i];
      var rr = resolved[i].rr;
      var te = p.tape && p.tape.events;
      if (te && te.length) {
        events = events.concat(te);
      }
      if (lastR > 0 && rr > lastR + 1) {
        gaps.push("jump from round " + lastR + " to " + rr);
      }
      lastR = rr;
    }
    var headLast = sorted[sorted.length - 1];
    var skSet = {};
    sorted.forEach(function (q) {
      if (q.sessionKey) skSet[String(q.sessionKey)] = true;
    });
    var skList = Object.keys(skSet);
    var warns = [];
    sorted.forEach(function (q) {
      if (q && Array.isArray(q.__mergeWarnings)) {
        q.__mergeWarnings.forEach(function (w) {
          if (w && warns.indexOf(w) === -1) warns.push(w);
        });
      }
    });
    if (nonGranularDupRounds.length) {
      var uq = [];
      nonGranularDupRounds.forEach(function (d) {
        if (uq.indexOf(d) === -1) uq.push(d);
      });
      warns.push(
        "Same round appeared in multiple non-granular files — kept the newest by save time for rounds: " +
          uq.join(", ")
      );
    }
    if (gaps.length) {
      warns.push("Some rounds missing between segments: " + gaps.join("; ") + " (still playing what you loaded).");
    }
    if (!rrMonotone) {
      warns.push("Save-time order does not match ascending round numbers — playback follows save timestamps.");
    }
    if (skList.length > 1) warns.push("Mixed session keys across files — OK if you meant to combine sessions.");
    var evs = events;
    if (typeof window.risqueReplayStripBackwardStampedRoundBoards === "function") {
      try {
        var stMerged = window.risqueReplayStripBackwardStampedRoundBoards(evs.slice());
        if (risqueReplayDebugIsOn()) {
          risqueReplayDebugLog(
            "merge strip",
            "in=" + evs.length,
            "out=" + stMerged.events.length,
            "skipped=" + (stMerged.skipped || 0)
          );
        }
        evs = stMerged.events;
        if (stMerged.skipped > 0 && stMerged.message && warns.indexOf(stMerged.message) === -1) {
          warns.push(stMerged.message);
        }
      } catch (eStripMr) {
        /* ignore */
      }
    }
    var mergedPlayerColors = {};
    var sortedForColors = sorted.slice().sort(function (a, b) {
      return effectiveReplayRoundFromPackMerge(a) - effectiveReplayRoundFromPackMerge(b);
    });
    sortedForColors.forEach(function (seg) {
      var pc = seg && seg.playerColors;
      if (!pc || typeof pc !== "object") return;
      Object.keys(pc).forEach(function (k) {
        var v = pc[k];
        if (v == null || String(v).trim() === "") return;
        var kn = String(k).trim().toLowerCase();
        if (mergedPlayerColors[kn] == null || String(mergedPlayerColors[kn]).trim() === "") {
          mergedPlayerColors[kn] = String(v).trim().toLowerCase();
        }
      });
    });
    var topGlueRelax = sorted.some(function (q) {
      return q && q.risqueReplayGranularGlueRelax === true;
    });
    return {
      format: "risque-replay-v1",
      replayScope: "merged",
      replayRounds: replayRoundOrder,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: headLast.round,
      phase: headLast.phase,
      currentPlayer: headLast.currentPlayer,
      sessionKey: headLast.sessionKey,
      risqueReplayGranularGlueRelax: topGlueRelax,
      playerColors: mergedPlayerColors,
      tape: {
        v: TAPE_VERSION,
        events: evs,
        openingRecorded: evs.some(function (e) {
          return e && e.type === "init";
        }),
        hasDealFrames: evs.some(function (e) {
          return e && e.type === "board" && e.segment === "deal";
        })
      },
      __mergeWarnings: warns
    };
  }

  function distinctStampedRoundsForMerge(evs) {
    if (!Array.isArray(evs)) return 0;
    var seen = {};
    var i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (!e || e.round == null) continue;
      var n = Math.floor(Number(e.round));
      if (isFinite(n) && n >= 1) seen[n] = true;
    }
    return Object.keys(seen).length;
  }

  /**
   * Merge per-round segment packs + optional session snapshots (replay-full.json).
   * Session/merged packs are not bucketed by replayRound (that wrongly stuffed the whole tape into one round).
   * When round segments lack deal/init, prepend opening from a session snapshot.
   */
  window.risqueMergeReplayV1Packs = function (packs) {
    if (!packs || !packs.length) return null;
    if (packs.length === 1) return packs[0];

    var roundPacks = [];
    var sessionPacks = [];
    packs.forEach(function (p) {
      if (!p || !p.tape || !Array.isArray(p.tape.events) || !p.tape.events.length) return;
      var sc = p.replayScope;
      var pev = p.tape.events;
      if (sc === "session" || sc === "merged") sessionPacks.push(p);
      else if (sc === "round") roundPacks.push(p);
      else if (tapeHasInitAndDeal(pev) && pev.length >= 64) sessionPacks.push(p);
      else roundPacks.push(p);
    });

    if (sessionPacks.length && !roundPacks.length) {
      return pickRichestSessionPack(sessionPacks);
    }

    if (roundPacks.length && !sessionPacks.length) {
      return mergeRoundScopedPacksOnly(roundPacks);
    }

    if (roundPacks.length && sessionPacks.length) {
      var bestSessionPick = pickRichestSessionPack(sessionPacks);
      var merged = mergeRoundScopedPacksOnly(roundPacks);
      if (
        bestSessionPick &&
        bestSessionPick.tape &&
        Array.isArray(bestSessionPick.tape.events) &&
        bestSessionPick.tape.events.length &&
        tapeHasInitAndDeal(bestSessionPick.tape.events)
      ) {
        var evMergedEarly =
          merged && merged.tape && merged.tape.events ? merged.tape.events : [];
        var evSessEarly = bestSessionPick.tape.events;
        var mrLenEarly = evMergedEarly.length;
        var bsLenEarly = evSessEarly.length;
        var mrDcEarly = distinctStampedRoundsForMerge(evMergedEarly);
        var bsDcEarly = distinctStampedRoundsForMerge(evSessEarly);
        /* Folder often has replay-full.json + replay-final.json plus replay4/replay5.json — stitching
         * round packs alone skips early rounds when segments already include init+deal; prefer full session. */
        if (bsDcEarly > mrDcEarly || bsLenEarly >= mrLenEarly) {
          bestSessionPick.tape.events = replayNormalizeTapeEventOrder(evSessEarly.slice());
          return bestSessionPick;
        }
      }
      if (!merged || !merged.tape || !Array.isArray(merged.tape.events)) {
        return bestSessionPick || merged;
      }
      var evs = merged.tape.events;
      var needsOpen = !tapeHasInitAndDeal(evs);
      if (needsOpen) {
        sessionPacks.sort(function (a, b) {
          return packSavedAtMsMerge(b) - packSavedAtMsMerge(a);
        });
        var pi;
        for (pi = 0; pi < sessionPacks.length; pi++) {
          var sp = sessionPacks[pi];
          var se = sp.tape && sp.tape.events;
          if (!Array.isArray(se) || !se.length) continue;
          /*
           * Per-round exports usually include deal frames but not init; replay-full has init + deal.
           * Prepending the full session opening would run the whole deal twice — only splice init.
           */
          var pref;
          if (tapeHasDealOnly(evs) && !tapeHasInitOnly(evs)) {
            pref = extractFirstInitFromEvents(se);
          } else {
            pref = extractOpeningPrefixEvents(se);
          }
          if (pref.length) {
            var w = merged.__mergeWarnings ? merged.__mergeWarnings.slice() : [];
            w.push(
              pref.length === 1 && pref[0] && pref[0].type === "init"
                ? "Prepended init from session tape (round files already had deal frames)."
                : "Prepended deal/init from session file so playback starts at the map setup."
            );
            merged.tape.events = pref.concat(evs);
            merged.tape.openingRecorded = merged.tape.events.some(function (e) {
              return e && e.type === "init";
            });
            merged.tape.hasDealFrames = merged.tape.events.some(function (e) {
              return e && e.type === "board" && e.segment === "deal";
            });
            merged.__mergeWarnings = w;
            break;
          }
        }
      }
      return merged;
    }

    return null;
  };

  function eventRoundStamp(e) {
    if (!e || e.round == null) return 1;
    var n = typeof e.round === "number" ? e.round : parseInt(e.round, 10);
    return isFinite(n) && n >= 1 ? n : 1;
  }

  function floorGameRound(gs) {
    if (!gs || typeof gs !== "object") return 1;
    var gr = gs.round;
    if (typeof gr === "number" && isFinite(gr) && gr >= 1) return Math.floor(gr);
    var x = parseInt(gr, 10);
    return isFinite(x) && x >= 1 ? x : 1;
  }

  /**
   * Host REPLAY / Wayback: keep events from deal through full prior rounds, then only this round's events
   * for players at or before {@link gs.currentPlayer} in {@link gs.turnOrder}. Drops later players' frames
   * for the live round (e.g. round 10 with P3 up → round 9 complete + P1 and P2 only in round 10).
   * Events without recordedForPlayer (legacy tape): full live round is kept so older saves do not lose battles.
   */
  window.risqueReplaySliceThroughPendingTurn = function (gs, events) {
    if (!gs || typeof gs !== "object" || !Array.isArray(events) || !events.length) {
      return Array.isArray(events) ? events.slice() : [];
    }
    var order = Array.isArray(gs.turnOrder)
      ? gs.turnOrder.map(function (x) {
          return x != null ? String(x) : "";
        })
      : [];
    var curP = gs.currentPlayer != null ? String(gs.currentPlayer).trim() : "";
    var curIdx = curP ? order.indexOf(curP) : -1;
    if (curIdx < 0) return events.slice();

    var curRn = floorGameRound(gs);
    var out = [];
    var i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      var er = eventRoundStamp(e);
      if (er < curRn) {
        out.push(e);
        continue;
      }
      if (er > curRn) break;
      var rp = e.recordedForPlayer != null ? String(e.recordedForPlayer).trim() : "";
      if (!rp) {
        out.push(e);
        continue;
      }
      var ri = order.indexOf(rp);
      if (ri < 0) {
        out.push(e);
        continue;
      }
      /* Skip later players' frames this round but keep scanning — avoids empty export if event order differs. */
      if (ri <= curIdx) {
        out.push(e);
      }
    }
    return out;
  };

  function ensureLatestBoardFrameForExport(gs) {
    if (!gs || typeof gs !== "object") return;
    try {
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        window.risqueReplayEnsureLatestBoardFrame(gs);
      }
    } catch (eB) {
      /* ignore */
    }
  }

  function maxRoundInEvents(evs) {
    var maxR = 1;
    if (!Array.isArray(evs)) return maxR;
    evs.forEach(function (e) {
      var r = e && e.round != null ? Number(e.round) : NaN;
      if (isFinite(r) && r > maxR) maxR = Math.floor(r);
    });
    return maxR;
  }

  /**
   * Wayback export: completed rounds from merged disk autosaves + live tail (>= current round) from memory.
   * Fixes reload / quota cases where history lives in *-replay.json but the latest battles only exist in RAM.
   *
   * Live host: if RAM still has any tape for a round before the current round, export from memory only.
   * Otherwise a sparse/partial disk merge drops whole completed rounds (e.g. all of round 4) even though
   * risqueReplayByRound still holds them.
   */
  function waybackPackEventCount(p) {
    return p && p.tape && Array.isArray(p.tape.events) ? p.tape.events.length : 0;
  }

  function waybackPackHasDealFrames(p) {
    var evs = p && p.tape && p.tape.events;
    if (!Array.isArray(evs)) return false;
    var j;
    for (j = 0; j < evs.length; j++) {
      var e = evs[j];
      if (e && e.type === "board" && e.segment === "deal") return true;
    }
    return false;
  }

  /** Distinct numeric event.round stamps — detects gappy disk merges (e.g. jumps R1 deal → R4) vs full RAM tape. */
  function waybackCountDistinctRoundStamps(evs) {
    if (!Array.isArray(evs)) return 0;
    var seen = {};
    var j;
    for (j = 0; j < evs.length; j++) {
      var e = evs[j];
      if (!e || e.round == null) continue;
      var n = Math.floor(Number(e.round));
      if (isFinite(n) && n >= 1) seen[n] = true;
    }
    return Object.keys(seen).length;
  }

  function waybackCountBattleFrames(evs) {
    if (!Array.isArray(evs)) return 0;
    var n = 0;
    var j;
    for (j = 0; j < evs.length; j++) {
      var e = evs[j];
      if (e && e.type === "board" && e.segment === "battle") n++;
    }
    return n;
  }

  /**
   * True if RAM still holds any completed round strictly before the live round (by bucket key and by event stamps).
   */
  function memoryHasPriorRoundTape(gs, currentR, memFlat) {
    var brKeys = Object.keys((gs && gs.risqueReplayByRound) || {});
    var mi;
    for (mi = 0; mi < brKeys.length; mi++) {
      var kn = Number(brKeys[mi]);
      if (!isFinite(kn) || kn >= currentR) continue;
      var arr = gs.risqueReplayByRound[brKeys[mi]];
      if (Array.isArray(arr) && arr.length) return true;
    }
    for (mi = 0; mi < memFlat.length; mi++) {
      if (eventRoundStamp(memFlat[mi]) < currentR) return true;
    }
    return false;
  }

  window.risqueBuildWaybackTapePack = function (gs, diskMergedPack) {
    if (!gs || typeof gs !== "object") return null;
    ensureLatestBoardFrameForExport(gs);
    migrateLegacyTapeToByRound(gs);
    ensureReplayByRound(gs);
    var memFlat = window.risqueReplayFlattenEvents(gs);
    var gr = gs.round;
    var currentR =
      typeof gr === "number" && isFinite(gr) && gr >= 1 ? Math.floor(gr) : Math.max(1, parseInt(gr, 10) || 1);

    var sessionPack = null;
    try {
      sessionPack = window.risqueBuildSessionReplayExport(gs);
    } catch (eSess) {
      sessionPack = null;
    }

    if (!diskMergedPack || !diskMergedPack.tape || !Array.isArray(diskMergedPack.tape.events)) {
      return sessionPack;
    }
    var diskEvs = diskMergedPack.tape.events;
    if (!diskEvs.length) {
      return sessionPack;
    }

    if (memoryHasPriorRoundTape(gs, currentR, memFlat)) {
      return sessionPack;
    }

    var fromDisk = [];
    var i;
    for (i = 0; i < diskEvs.length; i++) {
      if (eventRoundStamp(diskEvs[i]) < currentR) {
        fromDisk.push(diskEvs[i]);
      }
    }
    /* Use by-round bucket keys, not per-event stamps: legacy or edge events with round null
     * stamp as 1 via eventRoundStamp and would be filtered out of fromMem (e.g. 1 >= 2 false),
     * dropping the live tail while fromDisk does not pick them up — last battle missing in Wayback. */
    var fromMem = [];
    var brObj = (gs && gs.risqueReplayByRound) || {};
    var bucketKeys = Object.keys(brObj).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    for (i = 0; i < bucketKeys.length; i++) {
      var bk = bucketKeys[i];
      var kn = Number(bk);
      if (!isFinite(kn) || kn < currentR) continue;
      var arr = brObj[bk];
      if (!Array.isArray(arr)) continue;
      var j;
      for (j = 0; j < arr.length; j++) {
        fromMem.push(arr[j]);
      }
    }
    while (
      fromMem.length &&
      fromMem[0] &&
      fromMem[0].type === "init" &&
      fromDisk.some(function (e) {
        return e && e.type === "init";
      })
    ) {
      fromMem.shift();
    }
    var combined = replayNormalizeTapeEventOrder(fromDisk.concat(fromMem));
    if (!combined.length) {
      return sessionPack;
    }
    var maxR = maxRoundInEvents(combined);
    if (isFinite(currentR) && currentR > maxR) maxR = currentR;
    var mergedPack = {
      format: "risque-replay-v1",
      replayScope: "session",
      replayRound: maxR,
      tapeFormatVersion: TAPE_VERSION,
      savedAt: Date.now(),
      round: gs.round,
      phase: gs.phase != null ? String(gs.phase) : "",
      currentPlayer: gs.currentPlayer != null ? String(gs.currentPlayer) : "",
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      playerColors:
        gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object"
          ? gs.risqueReplayPlayerColors
          : {},
      tape: {
        v: TAPE_VERSION,
        events: combined,
        openingRecorded: combined.some(function (e) {
          return e && e.type === "init";
        }),
        hasDealFrames: combined.some(function (e) {
          return e && e.type === "board" && e.segment === "deal";
        })
      }
    };

    /* Disk+RAM splice can beat session on raw length while replay-full.json is stale (gaps R2–R3, jump to R4).
     * Prefer RAM export when it has strictly better round spread or more battle frames; ties go to memory. */
    var sn = waybackPackEventCount(sessionPack);
    var mn = waybackPackEventCount(mergedPack);
    var sEvs = sessionPack && sessionPack.tape ? sessionPack.tape.events : null;
    var mEvs = mergedPack.tape ? mergedPack.tape.events : null;
    var sDc = waybackCountDistinctRoundStamps(sEvs);
    var mDc = waybackCountDistinctRoundStamps(mEvs);
    var sBat = waybackCountBattleFrames(sEvs);
    var mBat = waybackCountBattleFrames(mEvs);
    if (
      sessionPack &&
      (sn > mn ||
        sn === mn ||
        (waybackPackHasDealFrames(sessionPack) && !waybackPackHasDealFrames(mergedPack)) ||
        sDc > mDc ||
        sBat > mBat)
    ) {
      return sessionPack;
    }
    /*
     * Disk merge can drop init/deal when duplicate replayRound files keep only the newest (DD vs replay1),
     * or when autosave used a clone with gs.round forced to a completed round — merged then beat session
     * on length while being a tail snapshot. Prefer RAM session when it still has a usable opening
     * (init+deal, or per-territory deal+deploy) and matches or beats merged round spread (ties → session).
     */
    if (sessionPack && tapeHasUsableReplayOpening(sEvs)) {
      if (!tapeHasUsableReplayOpening(mEvs)) return sessionPack;
      if (sDc >= mDc) return sessionPack;
    }
    return mergedPack;
  };

  /**
   * Lean localStorage gameState (speed): strip replay keys before persist. Default OFF (reliability-first).
   * Opt in: `?lsReplayLite=1` or `localStorage.setItem('risqueLsReplayLite','1')`.
   * Opt out after opting in: `?lsReplayLite=0` or `risqueLsReplayLite=0`.
   */
  function risqueLsReplayLiteEffective() {
    try {
      if (typeof window !== "undefined" && window.location) {
        var q = new URL(window.location.href).searchParams.get("lsReplayLite");
        if (q === "0") return false;
        if (q === "1") return true;
      }
      if (typeof localStorage !== "undefined") {
        var v = localStorage.getItem("risqueLsReplayLite");
        if (v === "0") return false;
        if (v === "1") return true;
      }
    } catch (e) {
      /* ignore */
    }
    /* Reliability-first default: keep replay in STORAGE_KEY unless explicitly enabled. */
    return false;
  }
  window.risqueLsReplayLiteEffective = risqueLsReplayLiteEffective;

  var __risqueLsReplayLiteLogged = false;
  function risqueMaybeLogLsReplayLitePatchOnce() {
    if (__risqueLsReplayLiteLogged || !risqueLsReplayLiteEffective()) return;
    __risqueLsReplayLiteLogged = true;
    try {
      console.info(
        "[RISQUE] Lean localStorage: replay tape omitted from persisted gameState for speed. " +
          "Live replay unchanged in memory. Disable: ?lsReplayLite=0 or localStorage risqueLsReplayLite=0."
      );
    } catch (eL) {
      /* ignore */
    }
  }

  (function patchLocalStorageGameStateReplayStrip() {
    var SK = "gameState";
    try {
      var _origSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key !== SK || typeof value !== "string") {
          return _origSetItem.apply(this, arguments);
        }
        if (!risqueLsReplayLiteEffective()) {
          return _origSetItem.apply(this, arguments);
        }
        try {
          var parsed = JSON.parse(value);
          if (!parsed || typeof parsed !== "object") {
            return _origSetItem.apply(this, arguments);
          }
          risqueMaybeLogLsReplayLitePatchOnce();
          var slim =
            typeof window.risqueStripReplayFromGameStateClone === "function"
              ? window.risqueStripReplayFromGameStateClone(parsed)
              : parsed;
          value = JSON.stringify(slim);
        } catch (e) {
          /* keep original value */
        }
        return _origSetItem.call(this, key, value);
      };
    } catch (ePatch) {
      /* ignore */
    }
  })();
})();
