/**
 * Battle tape playback (risque-replay-v1 JSON). Uses core.js map rendering.
 * Embedded in game.html host panel (inline Wayback); replay-machine.html remains as optional standalone page.
 */
(function () {
  "use strict";

  /** Same key as host game-shell — public game.html polls this for the TV map. */
  var RISQUE_PUBLIC_MIRROR_LS_KEY = "risquePublicMirrorState";
  var __risqueReplayMirrorSeqCounter = 0;

  /**
   * Push the current replay board into localStorage so game.html?display=public can animate the map in sync.
   * Does not touch the host session STORAGE_KEY (replay-machine never loads game-shell).
   */
  function risqueReplayMirrorPushToPublicBoard(gs, opts) {
    opts = opts || {};
    if (!gs || typeof gs !== "object") return;
    try {
      var payload = JSON.parse(JSON.stringify(gs));
      if (opts.playbackOff) {
        delete payload.risqueReplayPlaybackActive;
        delete payload.phaseReplayIndex;
      } else {
        payload.risqueReplayPlaybackActive = true;
      }
      delete payload.risqueReplayTape;
      delete payload.risqueReplayByRound;
      delete payload.risquePublicReplayRound;
      delete payload.risquePlayedCardsGallery;
      delete payload.risqueLuckyLedger;
      delete payload.phaseReplayIndex;
      if (Array.isArray(payload.risqueCombatLogTail) && payload.risqueCombatLogTail.length > 48) {
        payload.risqueCombatLogTail = payload.risqueCombatLogTail.slice(-48);
      }
      __risqueReplayMirrorSeqCounter += 1;
      payload.risquePublicMirrorSeq = __risqueReplayMirrorSeqCounter;
      localStorage.setItem(RISQUE_PUBLIC_MIRROR_LS_KEY, JSON.stringify(payload));
    } catch (e) {
      /* Quota, privacy mode, or non-persistent storage — TV may stay on last live frame. */
    }
  }
  window.risqueReplayMirrorPushToPublicBoard = risqueReplayMirrorPushToPublicBoard;

  var TAPE_VERSION = 2;
  var MS_DEPLOY = 130;
  var MS_BATTLE = 220;
  /** Granular attack-only tapes (and glued Wayback merges): readable battle pacing vs full-session tape. */
  var MS_BATTLE_GRANULAR_GLUE = 290;
  /** Extra beat when glued segments jump to the next player's battle frames. */
  var MS_GRANULAR_PLAYER_GAP = 480;
  /** Hold after elimination splash so flash + message are readable (scaled by playback speed). */
  var MS_ELIMINATION = 1300;
  var MS_INIT = 80;
  var MS_DEAL = 150;
  var MS_REPLAY_START_HOLD = 450;
  /** After a successful load, start playback automatically (pause with PAUSE or STOP). */
  var AUTO_START_PLAYBACK_AFTER_LOAD = false;
  var AUTO_START_DELAY_MS = 320;

  /**
   * After prepareLoadedPack: autoplay if ?replayAutoplay=1 or inline mount set __risqueReplayInlineAutoplayPending.
   */
  function scheduleReplayAutoplayIfDesired() {
    if (window.__risqueReplayAutoplayScheduled) return;
    var ap = false;
    try {
      ap = new URLSearchParams(window.location.search).get("replayAutoplay") === "1";
    } catch (eAu0) {
      ap = false;
    }
    if (!ap && window.__risqueReplayInlineAutoplayPending) {
      ap = true;
      window.__risqueReplayInlineAutoplayPending = false;
    }
    if (!ap) return;
    window.__risqueReplayAutoplayScheduled = true;
    window.setTimeout(function () {
      startPlaybackFromLoadedPack();
    }, AUTO_START_DELAY_MS);
  }

  function tapeVersionOk(v) {
    var n = typeof v === "number" ? v : parseInt(v, 10);
    return n === 1 || n === TAPE_VERSION;
  }

  function speedMultiplier() {
    var el = document.getElementById("risque-replay-speed");
    var n = el ? Number(el.value) : 100;
    if (!Number.isFinite(n) || n < 25) n = 25;
    if (n > 200) n = 200;
    return n / 100;
  }

  function scaledDelay(ms) {
    var sp = speedMultiplier();
    if (sp <= 0) return ms;
    return Math.max(16, Math.round(ms / sp));
  }

  function setStatus(msg) {
    var el = document.getElementById("risque-replay-status");
    if (el) el.textContent = msg || "";
  }

  function setReplayEndedLine(on) {
    var el = document.getElementById("risque-replay-ended");
    if (!el) return;
    el.textContent = on ? "REPLAY ENDED" : "";
  }

  /** Round label for merge / UI; falls back to first stamped event round in the tape. */
  function effectiveReplayRoundFromPack(p) {
    if (!p) return 0;
    var rr = Number(p.replayRound != null ? p.replayRound : p.round) || 0;
    if (rr >= 1) return rr;
    var evs = p.tape && p.tape.events;
    if (!Array.isArray(evs) || !evs.length) return 0;
    var i;
    var minR = 0;
    for (i = 0; i < evs.length; i++) {
      var er = getEventRound(evs[i]);
      if (er != null && (minR === 0 || er < minR)) minR = er;
    }
    return minR;
  }

  function packSavedAtMs(p) {
    var n = p && p.savedAt != null ? Number(p.savedAt) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function formatReplaySavedAtChip(ms) {
    var n = packSavedAtMs({ savedAt: ms });
    if (!n) return "—";
    try {
      return new Date(n).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return "—";
    }
  }

  /** Shared implementation lives in replay-tape.js (also used by host Wayback disk export). */
  function mergeReplayPacks(packs) {
    if (!packs || !packs.length) return null;
    if (packs.length === 1) return packs[0];
    if (typeof window.risqueMergeReplayV1Packs === "function") {
      return window.risqueMergeReplayV1Packs(packs);
    }
    return null;
  }

  /** Lowercase keys/values so board owner names match export sidecar after trim/case drift. */
  function normalizeReplayPlayerColorsMap(obj) {
    var out = {};
    if (!obj || typeof obj !== "object") return out;
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v == null || String(v).trim() === "") return;
      var kn = String(k).trim().toLowerCase();
      if (out[kn] == null || String(out[kn]).trim() === "") {
        out[kn] = String(v).trim().toLowerCase();
      }
    });
    return out;
  }

  /**
   * Ensure every territory owner on the tape has a color. Prefer tape snapshots (init.playerColors,
   * elimination.defeatedColor) and pack.playerColors; only then assign palette slots — arbitrary
   * palette order previously replaced real hues (e.g. yellow → green).
   */
  function enrichPlayerColorsFromTape(pack) {
    if (!pack || typeof pack !== "object" || !pack.tape || !Array.isArray(pack.tape.events)) {
      return pack;
    }
    var m = normalizeReplayPlayerColorsMap(
      pack.playerColors && typeof pack.playerColors === "object" ? pack.playerColors : {}
    );
    function mergeGapColors(src) {
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        if (v == null || String(v).trim() === "") return;
        var kn = String(k).trim().toLowerCase();
        var vv = String(v).trim().toLowerCase();
        if (m[kn] == null || String(m[kn]).trim() === "") m[kn] = vv;
      });
    }
    pack.tape.events.forEach(function (e) {
      if (!e) return;
      if (e.type === "init" && e.playerColors && typeof e.playerColors === "object") {
        mergeGapColors(e.playerColors);
      }
      if (e.type === "elimination") {
        var d = e.defeated != null ? String(e.defeated).trim() : "";
        var dc = e.defeatedColor != null ? String(e.defeatedColor).trim().toLowerCase() : "";
        if (d && dc) {
          var dk = d.toLowerCase();
          if (m[dk] == null || String(m[dk]).trim() === "") m[dk] = dc;
        }
      }
    });
    var usedColors = {};
    Object.keys(m).forEach(function (k) {
      var c = m[k];
      if (c) usedColors[c] = true;
    });
    var palette = ["blue", "red", "green", "yellow", "pink", "orange", "purple", "cyan", "brown", "lime"];
    var pi = 0;
    function nextColor() {
      var t;
      for (t = 0; t < 48; t++) {
        var c = palette[pi % palette.length];
        pi++;
        if (!usedColors[c]) {
          usedColors[c] = true;
          return c;
        }
      }
      return "teal";
    }
    function ensureName(nm) {
      var n = String(nm || "").trim().toLowerCase();
      if (!n) return;
      var cur = m[n] != null ? String(m[n]).trim() : "";
      if (cur) return;
      m[n] = nextColor();
    }
    pack.tape.events.forEach(function (e) {
      if (!e || e.type !== "board" || !e.board || typeof e.board !== "object") return;
      Object.keys(e.board).forEach(function (label) {
        var cell = e.board[label];
        if (cell && cell.owner) ensureName(cell.owner);
      });
    });
    pack.playerColors = m;
    return pack;
  }

  function looksLikeGameBackupNotTape(raw) {
    return (
      raw &&
      typeof raw === "object" &&
      Array.isArray(raw.players) &&
      raw.phase &&
      !raw.format &&
      !raw.risqueReplayTape
    );
  }

  function normalizeImportedReplay(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.format === "risque-replay-v1" && raw.tape && tapeVersionOk(raw.tape.v)) {
      if (!Array.isArray(raw.tape.events)) return null;
      if (!packSavedAtMs(raw)) {
        try {
          raw.savedAt = Date.now();
        } catch (eSa) {
          /* ignore */
        }
      }
      raw.playerColors = normalizeReplayPlayerColorsMap(
        raw.playerColors && typeof raw.playerColors === "object" ? raw.playerColors : {}
      );
      return raw;
    }
    if (raw.risqueReplayTape && tapeVersionOk(raw.risqueReplayTape.v)) {
      if (!Array.isArray(raw.risqueReplayTape.events)) return null;
      var sav =
        packSavedAtMs(raw) ||
        (raw.exportedAt != null && isFinite(Number(raw.exportedAt)) ? Number(raw.exportedAt) : 0) ||
        Date.now();
      return {
        format: "risque-replay-v1",
        tapeFormatVersion: TAPE_VERSION,
        savedAt: sav,
        round: raw.round,
        phase: raw.phase,
        currentPlayer: raw.currentPlayer,
        sessionKey: raw.risqueReplayTapeSessionKey || null,
        playerColors: normalizeReplayPlayerColorsMap(
          raw.risqueReplayPlayerColors && typeof raw.risqueReplayPlayerColors === "object"
            ? raw.risqueReplayPlayerColors
            : {}
        ),
        tape: {
          v: raw.risqueReplayTape.v,
          events: raw.risqueReplayTape.events,
          openingRecorded: !!raw.risqueReplayTape.openingRecorded,
          hasDealFrames: !!raw.risqueReplayTape.hasDealFrames
        }
      };
    }
    return null;
  }

  function replayGhostColorForOwner(gs, ownerName) {
    var nm = String(ownerName || "").trim().toLowerCase();
    if (!nm) return "black";
    var m = gs && gs.risqueReplayPlayerColors;
    if (m && m[nm]) return m[nm];
    return "black";
  }

  /**
   * Merged tapes / disk segments can spell the same human player with different casing between frames.
   * Strict === would create two ghost players and split the map until the next frame — wrong colors
   * (especially visible across a battle delay) then self-correct when casing lines up again.
   */
  function replayFindPlayerByOwner(players, ownerRaw) {
    if (!players || ownerRaw == null) return null;
    var own = String(ownerRaw).trim();
    if (!own) return null;
    var i;
    for (i = 0; i < players.length; i++) {
      var x = players[i];
      if (x && String(x.name) === own) return x;
    }
    var low = own.toLowerCase();
    var hit = null;
    for (i = 0; i < players.length; i++) {
      var x2 = players[i];
      if (!x2 || x2.name == null) continue;
      if (String(x2.name).trim().toLowerCase() === low) {
        if (hit) return null;
        hit = x2;
      }
    }
    return hit;
  }

  function applyBoard(gs, board) {
    if (!gs || !gs.players || !board) return;
    var replay = !!gs.risqueReplayPlaybackActive;
    if (replay) {
      var canonByLower = {};
      Object.keys(board).forEach(function (label) {
        var cell = board[label];
        if (!cell || !cell.owner) return;
        var raw = String(cell.owner).trim();
        if (!raw) return;
        var low = raw.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(canonByLower, low)) return;
        var existing = replayFindPlayerByOwner(gs.players, raw);
        canonByLower[low] = existing ? String(existing.name) : raw;
      });
      Object.keys(canonByLower).forEach(function (low) {
        var nm = canonByLower[low];
        if (replayFindPlayerByOwner(gs.players, nm)) return;
        gs.players.push({
          name: nm,
          territories: [],
          cards: [],
          cardCount: 0,
          color: replayGhostColorForOwner(gs, nm),
          risqueReplayGhostPlayer: true
        });
      });
    }
    gs.players.forEach(function (p) {
      p.territories = [];
    });
    Object.keys(board).forEach(function (label) {
      var cell = board[label];
      if (!cell || !cell.owner) return;
      var own = String(cell.owner);
      var pl = replay
        ? replayFindPlayerByOwner(gs.players, own)
        : gs.players.find(function (x) {
            return x && String(x.name) === own;
          });
      if (pl) {
        pl.territories.push({
          name: label,
          troops: Number(cell.troops) || 0
        });
      }
    });
    gs.players.forEach(function (p) {
      p.troopsTotal = (p.territories || []).reduce(function (s, t) {
        return s + (Number(t.troops) || 0);
      }, 0);
    });
    if (replay) {
      gs.players = gs.players.filter(function (p) {
        if (!p || !p.risqueReplayGhostPlayer) return true;
        return p.territories && p.territories.length > 0;
      });
    }
  }

  function boardSnapshotFromTape(board) {
    if (!board || typeof board !== "object") return {};
    var out = {};
    Object.keys(board).forEach(function (k) {
      var c = board[k];
      if (c && c.owner) {
        out[k] = { owner: String(c.owner), troops: Number(c.troops) || 0 };
      }
    });
    return out;
  }

  function replayDiffChangedTerritoryLabels(prev, next) {
    var labels = [];
    var seen = {};
    function add(lab) {
      if (!lab || seen[lab]) return;
      seen[lab] = true;
      labels.push(lab);
    }
    var keys = {};
    if (prev) Object.keys(prev).forEach(function (k) {
      keys[k] = true;
    });
    if (next) Object.keys(next).forEach(function (k) {
      keys[k] = true;
    });
    Object.keys(keys).forEach(function (lab) {
      var a = prev ? prev[lab] : null;
      var b = next ? next[lab] : null;
      if (!a && !b) return;
      if (!a || !b) {
        add(lab);
        return;
      }
      if (
        String(a.owner).trim().toLowerCase() !== String(b.owner).trim().toLowerCase() ||
        (Number(a.troops) || 0) !== (Number(b.troops) || 0)
      ) {
        add(lab);
      }
    });
    return labels;
  }

  function filterFullReplayEvents(events) {
    if (!events || !events.length) return [];
    var out = [];
    var i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e || !e.type) continue;
      if (e.type === "init" && e.board) {
        out.push(e);
      } else if (
        e.type === "board" &&
        e.board &&
        (e.segment === "deal" ||
          e.segment === "deploy" ||
          e.segment === "battle" ||
          e.segment === "reinforce")
      ) {
        out.push(e);
      } else if (e.type === "elimination") {
        out.push(e);
      }
    }
    return out;
  }

  /** Numeric `ev.round` when present; ignores deal/init special-cases (caller filters by segment). */
  function replayExplicitRoundStamp(ev) {
    if (!ev || ev.round == null) return null;
    var n = typeof ev.round === "number" ? ev.round : parseInt(ev.round, 10);
    if (!isFinite(n) || n < 1) return null;
    return Math.floor(n);
  }

  /**
   * Granular segment files sometimes embed *battle* frames stamped with an older round after later-round
   * battles already appeared (e.g. two round-4 boards at the head of a replayRound-5 pack). Playing them
   * rewinds the map.
   *
   * We only strip **battle** boards using a high-water mark from **init + battle** stamps. Deploy/reinforce
   * and elimination stamps can lead or lag gs.round in-session; feeding them into maxR caused legitimate
   * end-of-round battles to be dropped (jump straight to “finish”, missing last hop, sporadic flashes).
   */
  function stripBackwardStampedRoundBoardEvents(events) {
    if (!Array.isArray(events)) return { events: [], skipped: 0, message: "" };
    if (!events.length) return { events: events.slice(), skipped: 0, message: "" };
    var maxBattleR = 0;
    var out = [];
    var skipped = 0;
    var exStale = null;
    var exPeak = null;
    var i;
    for (i = 0; i < events.length; i++) {
      var ev = events[i];
      if (!ev || !ev.type) {
        out.push(ev);
        continue;
      }
      if (ev.type === "init") {
        out.push(ev);
        maxBattleR = Math.max(maxBattleR, 1);
        continue;
      }
      if (ev.type === "board") {
        var seg = ev.segment != null ? String(ev.segment) : "";
        /* Recorder forces deal to round 1 — never treat as a timeline regression. */
        if (seg === "deal") {
          out.push(ev);
          continue;
        }
        if (seg === "battle") {
          var r = replayExplicitRoundStamp(ev);
          if (r != null && r < maxBattleR) {
            skipped++;
            if (exStale == null) {
              exStale = r;
              exPeak = maxBattleR;
            }
            if (typeof window.risqueReplayDebugIsOn === "function" && window.risqueReplayDebugIsOn()) {
              try {
                console.log(
                  "[ReplayDebug] strip drop",
                  seg,
                  "stamp=" + r,
                  "maxBattleWas=" + maxBattleR,
                  "rec=" + (ev.recordedForPlayer != null ? String(ev.recordedForPlayer) : "")
                );
              } catch (eSd) {
                /* ignore */
              }
            }
            continue;
          }
          out.push(ev);
          if (r != null) maxBattleR = Math.max(maxBattleR, r);
          continue;
        }
        /* deploy / reinforce: never strip; stamp does not advance battle watermark. */
        out.push(ev);
        continue;
      }
      if (ev.type === "elimination") {
        out.push(ev);
        continue;
      }
      out.push(ev);
    }
    var msg = "";
    if (skipped > 0 && exStale != null && exPeak != null) {
      msg =
        "Replay: removed " +
        skipped +
        " out-of-sequence battle frame(s) stamped round " +
        exStale +
        " after round " +
        exPeak +
        " battle line had advanced (stale segment tail/head).";
    } else if (skipped > 0) {
      msg =
        "Replay: removed " +
        skipped +
        " out-of-sequence battle frame(s) stamped earlier than the current battle timeline.";
    }
    return { events: out, skipped: skipped, message: msg };
  }

  function getEventRound(ev) {
    if (!ev) return null;
    /* Opening frames must not use stamped gs.round from the live export pass (e.g. deal saved under round 5 in file). */
    if (ev.type === "init") return 1;
    if (ev.type === "board" && ev.segment === "deal") return 1;
    if (ev.round != null) {
      var n = typeof ev.round === "number" ? ev.round : parseInt(ev.round, 10);
      if (isFinite(n) && n >= 1) return n;
    }
    return null;
  }

  function collectReplayRounds(playbackEvents) {
    var seen = {};
    var i;
    for (i = 0; i < playbackEvents.length; i++) {
      var r = getEventRound(playbackEvents[i]);
      if (r != null) seen[r] = true;
    }
    return Object.keys(seen)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .filter(function (x) {
        return isFinite(x);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  /**
   * Same round inference as Wayback chips: explicit stamps advance carry; unstamped deal follows carry;
   * init/deal legacy defaults; remaining frames use getEventRound or carry.
   */
  function buildInferredRoundPerFrame(playbackEvents) {
    var pe = playbackEvents || [];
    var out = new Array(pe.length);
    var cur = 1;
    var i;
    for (i = 0; i < pe.length; i++) {
      var ev = pe[i];
      var r = null;
      if (!ev) {
        out[i] = cur;
        continue;
      }
      if (ev.type === "init") {
        r = 1;
        cur = 1;
      } else if (ev.type === "board" && ev.segment === "deal") {
        r = cur;
      } else if (ev.round != null) {
        var ex = typeof ev.round === "number" ? ev.round : parseInt(ev.round, 10);
        if (isFinite(ex) && ex >= 1) {
          r = ex;
          cur = ex;
        }
      }
      if (r == null) {
        r = getEventRound(ev);
        if (r != null) cur = r;
      }
      if (r == null) r = cur;
      out[i] = r;
    }
    return out;
  }

  /** If stamps skip integers (e.g. 1 … 4), UI still lists R2,R3 so jumps match a full match timeline. */
  function gapFillMissingRoundKeys(seen) {
    var arr = Object.keys(seen)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .filter(function (x) {
        return isFinite(x) && x >= 1;
      })
      .sort(function (a, b) {
        return a - b;
      });
    if (arr.length < 2) return;
    var j;
    for (j = 0; j < arr.length - 1; j++) {
      var a = arr[j];
      var b = arr[j + 1];
      if (b > a + 1) {
        var k;
        for (k = a + 1; k < b; k++) {
          seen[k] = true;
        }
      }
    }
  }

  /**
   * Round chips: union of (a) merge metadata replayRounds, (b) each source file's replayRound / replayRounds,
   * (c) tape timeline with carry-forward so unstamped deal/deploy/battle frames don't collapse to R1 only,
   * (d) gap-fill between observed rounds when stamps skip (common for unstamped mid-match rounds).
   */
  function collectReplayRoundsForUiChips(playbackEvents, mergedPack, sourcePacks) {
    var seen = {};
    function addRn(rn) {
      var n = Math.floor(Number(rn));
      if (!isFinite(n) || n < 1) return;
      seen[n] = true;
    }
    if (mergedPack && Array.isArray(mergedPack.replayRounds)) {
      mergedPack.replayRounds.forEach(addRn);
    }
    if (sourcePacks && sourcePacks.length) {
      var pi;
      for (pi = 0; pi < sourcePacks.length; pi++) {
        var pk = sourcePacks[pi];
        if (!pk) continue;
        var hdr = effectiveReplayRoundFromPack(pk);
        if (hdr >= 1) addRn(hdr);
        if (Array.isArray(pk.replayRounds)) {
          pk.replayRounds.forEach(addRn);
        }
      }
    }
    var pe = playbackEvents || [];
    var inferred = buildInferredRoundPerFrame(pe);
    var ii;
    for (ii = 0; ii < inferred.length; ii++) {
      addRn(inferred[ii]);
    }
    if (mergedPack && mergedPack.replayRound != null) {
      addRn(mergedPack.replayRound);
    }
    var raw = mergedPack && mergedPack.tape && mergedPack.tape.events;
    if (Array.isArray(raw)) {
      var ri;
      for (ri = 0; ri < raw.length; ri++) {
        var rw = raw[ri];
        if (rw && rw.round != null) {
          var rx = typeof rw.round === "number" ? rw.round : parseInt(rw.round, 10);
          if (isFinite(rx) && rx >= 1) addRn(rx);
        }
      }
    }
    gapFillMissingRoundKeys(seen);
    return Object.keys(seen)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .filter(function (x) {
        return isFinite(x);
      })
      .sort(function (a, b) {
        return a - b;
      });
  }

  function indexFirstBattle(playbackEvents) {
    var i;
    for (i = 0; i < playbackEvents.length; i++) {
      var e = playbackEvents[i];
      if (e && e.type === "board" && e.segment === "battle") return i;
    }
    return -1;
  }

  var MAX_SEGMENT_CHIPS = 55;

  /** DD first, then r1p1, r1p2, …, r2p1, …; session / replayN names sort last (tie-break: savedAt). */
  function waybackSegmentPackSortCmp(a, b) {
    function keyFromFilename(fname) {
      var s = String(fname || "").trim().toLowerCase();
      if (s === "dd.json") return { t: 0, r: 0, p: 0 };
      if (s === "replay-deal.json") return { t: 1, r: 0, p: 0 };
      var m = /^r(\d+)p(\d+)\.json$/i.exec(s);
      if (m) {
        return { t: 2, r: parseInt(m[1], 10) || 0, p: parseInt(m[2], 10) || 0 };
      }
      if (s === "replay-full.json" || s === "risque-full-replay.json" || s === "rqwb-full-replay.json") {
        return { t: 80, r: 0, p: 0 };
      }
      if (/^replay\d+\.json$/i.test(s)) return { t: 70, r: 0, p: 0 };
      return { t: 50, r: 0, p: 0 };
    }
    var fa = a && a.__risqueSourceFilename ? String(a.__risqueSourceFilename) : "";
    var fb = b && b.__risqueSourceFilename ? String(b.__risqueSourceFilename) : "";
    var ka = keyFromFilename(fa);
    var kb = keyFromFilename(fb);
    if (ka.t !== kb.t) return ka.t - kb.t;
    if (ka.r !== kb.r) return ka.r - kb.r;
    if (ka.p !== kb.p) return ka.p - kb.p;
    return packSavedAtMs(a) - packSavedAtMs(b);
  }

  function segmentUiLabelFromFilename(name) {
    var s = String(name || "").trim();
    if (!s) return "?";
    var base = s.replace(/\.json$/i, "");
    if (/^dd$/i.test(base)) return "DD";
    return base;
  }

  /**
   * One chip per disk segment file (DD + rNpM), up to {@link MAX_SEGMENT_CHIPS}.
   * Only packs with __risqueSourceFilename (folder / file picker). Live host bootstrap uses round chips.
   */
  function buildSegmentSeekHints(playbackEvents, sourcePacks) {
    if (!playbackEvents || !playbackEvents.length || !sourcePacks || !sourcePacks.length) {
      return null;
    }
    var named = sourcePacks.filter(function (p) {
      return p && p.__risqueSourceFilename && String(p.__risqueSourceFilename).trim();
    });
    if (!named.length) return null;
    var sorted = named.slice().sort(waybackSegmentPackSortCmp);
    var hints = [];
    var searchFrom = 0;
    var pi;
    for (pi = 0; pi < sorted.length && hints.length < MAX_SEGMENT_CHIPS; pi++) {
      var p = sorted[pi];
      var fname = p.__risqueSourceFilename || "";
      var label = segmentUiLabelFromFilename(fname);
      var idx = 0;
      if (p.risqueReplayGranularAttackPhase === true) {
        var wantPlayer =
          p.currentPlayer != null ? String(p.currentPlayer).trim().toLowerCase() : "";
        var wantRound = effectiveReplayRoundFromPack(p);
        idx = -1;
        var i;
        for (i = searchFrom; i < playbackEvents.length; i++) {
          var ev = playbackEvents[i];
          if (!ev || ev.type !== "board" || ev.segment !== "battle") continue;
          var rp =
            ev.recordedForPlayer != null ? String(ev.recordedForPlayer).trim().toLowerCase() : "";
          var er = getEventRound(ev);
          var roundOk = !wantRound || wantRound < 1 || er == null || er === wantRound;
          if (wantPlayer && rp === wantPlayer && roundOk) {
            idx = i;
            break;
          }
        }
        if (idx < 0 && wantPlayer) {
          for (i = searchFrom; i < playbackEvents.length; i++) {
            var ev2 = playbackEvents[i];
            if (
              ev2 &&
              ev2.type === "board" &&
              ev2.segment === "battle" &&
              ev2.recordedForPlayer != null &&
              String(ev2.recordedForPlayer).trim().toLowerCase() === wantPlayer
            ) {
              idx = i;
              break;
            }
          }
        }
        if (idx < 0) {
          for (i = searchFrom; i < playbackEvents.length; i++) {
            var ev3 = playbackEvents[i];
            if (ev3 && ev3.type === "board" && ev3.segment === "battle") {
              idx = i;
              break;
            }
          }
        }
        if (idx < 0) idx = Math.min(searchFrom, Math.max(0, playbackEvents.length - 1));
        searchFrom = idx + 1;
      } else {
        idx = 0;
        var fb = indexFirstBattle(playbackEvents);
        searchFrom = fb >= 0 ? fb : playbackEvents.length;
      }
      hints.push({ label: label, seekIndex: idx });
    }
    return hints.length ? hints : null;
  }

  /** Explicit round stamps (plus init→R1) for seeking into gap-filled rounds when stamps skip integers. */
  function collectStampAnchorsForSeek(playbackEvents) {
    var pe = playbackEvents || [];
    var anchors = [];
    var i;
    for (i = 0; i < pe.length; i++) {
      var ev = pe[i];
      if (!ev) continue;
      if (ev.type === "init") {
        anchors.push({ index: i, round: 1 });
        continue;
      }
      if (ev.type === "board" && ev.segment === "deal") {
        var dRound = getEventRound(ev);
        if (dRound != null) anchors.push({ index: i, round: dRound });
        continue;
      }
      if (ev.round != null) {
        var ex = typeof ev.round === "number" ? ev.round : parseInt(ev.round, 10);
        if (isFinite(ex) && ex >= 1) {
          anchors.push({ index: i, round: Math.floor(ex) });
        }
      }
    }
    anchors.sort(function (a, b) {
      if (a.index !== b.index) return a.index - b.index;
      return a.round - b.round;
    });
    var collapsed = [];
    var k;
    for (k = 0; k < anchors.length; k++) {
      var a = anchors[k];
      if (!collapsed.length || collapsed[collapsed.length - 1].index !== a.index) {
        collapsed.push({ index: a.index, round: a.round });
      } else {
        var last = collapsed[collapsed.length - 1];
        if (a.round > last.round) last.round = a.round;
      }
    }
    if (collapsed.length && collapsed[0].index > 0) {
      collapsed.unshift({ index: 0, round: 1 });
    }
    /*
     * Never duplicate the same tape index in consecutive anchors: an extra {0,1} before {0,R} made
     * replaySeekIndexForRound use L.index===R.index and jump ~80% through the tape for mid-round seeks
     * (felt like "R5 is haunted" when jumping round chips late game).
     */
    if (collapsed.length && collapsed[0].index === 0 && collapsed[0].round > 1) {
      collapsed[0] = { index: 0, round: 1 };
    }
    return collapsed;
  }

  /**
   * Jump to round N: prefer first frame whose inferred round equals N; else interpolate between consecutive
   * explicit stamps when round numbers skip; else first inferred >= N.
   */
  function replaySeekIndexForRound(playbackEvents, target) {
    var pe = playbackEvents || [];
    if (!pe.length) return 0;
    var t = Math.floor(Number(target));
    if (!isFinite(t) || t < 1) return 0;

    var inferred = buildInferredRoundPerFrame(pe);
    var j;
    for (j = 0; j < inferred.length; j++) {
      if (inferred[j] === t) return j;
    }

    for (j = 0; j < pe.length; j++) {
      var evR = pe[j];
      if (!evR || evR.round == null) continue;
      var rawR = Math.floor(Number(evR.round));
      if (isFinite(rawR) && rawR === t) return j;
    }

    var anchors = collectStampAnchorsForSeek(pe);
    var ai;
    for (ai = 0; ai < anchors.length - 1; ai++) {
      var L = anchors[ai];
      var R = anchors[ai + 1];
      if (L.round < t && t < R.round) {
        var spanR = R.round - L.round;
        if (spanR <= 0) continue;
        if (L.index === R.index) {
          continue;
        }
        var spanI = R.index - L.index;
        if (spanI > 0) {
          var idx = L.index + Math.floor((spanI * (t - L.round)) / spanR);
          return Math.max(0, Math.min(idx, pe.length - 1));
        }
      }
    }

    for (j = 0; j < inferred.length; j++) {
      if (inferred[j] >= t) return j;
    }
    return 0;
  }

  function replayComputeStartIndex(playbackEvents, mode, roundMin) {
    if (!playbackEvents || !playbackEvents.length) return 0;
    var m = String(mode || "deal").toLowerCase();
    if (m === "first_battle") {
      var ib = indexFirstBattle(playbackEvents);
      return ib >= 0 ? ib : 0;
    }
    if (m === "from_round") {
      return replaySeekIndexForRound(playbackEvents, roundMin);
    }
    return 0;
  }

  function recordedBattlePlayer(ev) {
    if (!ev || ev.type !== "board" || ev.segment !== "battle") return null;
    var n = ev.recordedForPlayer;
    if (n == null || String(n).trim() === "") return null;
    return String(n).trim().toLowerCase();
  }

  /** Short line for public Wayback chrome (who is acting this frame). */
  function replayHudActorLineForEvent(ev) {
    if (!ev || !ev.type) return "";
    if (ev.type === "init") return "Opening";
    if (ev.type === "elimination") {
      var cq = String(ev.conqueror || "").trim();
      var df = String(ev.defeated || "").trim();
      if (cq && df) return cq + " eliminated " + df;
      if (df) return df + " eliminated";
      if (cq) return cq + " elimination";
      return "";
    }
    if (ev.type !== "board") return "";
    if (ev.segment === "deal") return "";
    var who =
      ev.recordedForPlayer != null && String(ev.recordedForPlayer).trim() !== ""
        ? String(ev.recordedForPlayer).trim()
        : "";
    var seg = ev.segment != null ? String(ev.segment) : "";
    if (seg === "battle") return who ? who + " attacks" : "Attack phase";
    if (seg === "deploy") return who ? who + " deploys" : "Deploy";
    if (seg === "reinforce") return who ? who + " reinforces" : "Reinforce";
    return "";
  }

  function replayDelayForEvent(ev, ctx) {
    ctx = ctx || {};
    var relax = !!ctx.granularGlueRelax;
    var nextEv = ctx.nextEv;
    var battleMs = relax ? MS_BATTLE_GRANULAR_GLUE : MS_BATTLE;
    if (!ev || !ev.type) return scaledDelay(battleMs);
    var ms;
    if (ev.type === "init") ms = MS_INIT;
    else if (ev.type === "elimination") ms = MS_ELIMINATION;
    else if (ev.type === "board") {
      if (ev.segment === "deal") ms = MS_DEAL;
      else if (ev.segment === "deploy" || ev.segment === "reinforce") ms = MS_DEPLOY;
      else ms = battleMs;
    } else ms = battleMs;
    var d = scaledDelay(ms);
    if (relax && nextEv) {
      var p0 = recordedBattlePlayer(ev);
      var p1 = recordedBattlePlayer(nextEv);
      if (p0 && p1 && p0 !== p1) {
        d += scaledDelay(MS_GRANULAR_PLAYER_GAP);
      }
    }
    return d;
  }

  function replayApplyOnePlayback(gs, ev, ctx) {
    if (!gs || !ev || !window.gameUtils) return;
    ctx = ctx || {};
    var skipFx = !!ctx.skipFx;
    var stamped = getEventRound(ev);
    if (stamped != null) {
      ctx.lastStampedRound = stamped;
      gs.round = stamped;
    }
    gs.risqueReplayHudRound =
      ctx.lastStampedRound != null ? ctx.lastStampedRound : ctx.replayRoundFallback;
    if (ev.type === "board" && ev.segment === "deal") {
      gs.risqueReplayMachineHudPhase = "deal";
    } else {
      delete gs.risqueReplayMachineHudPhase;
    }

    var actorLine = replayHudActorLineForEvent(ev);
    if (actorLine) gs.risqueReplayHudActorLine = actorLine;
    else delete gs.risqueReplayHudActorLine;

    if (ev.type === "init") {
      delete gs.risqueReplayBattleFlashLabels;
      applyBoard(gs, ev.board);
      refreshTurnOrder(gs);
      ctx.lastReplayBoardSnapshot = boardSnapshotFromTape(ev.board);
      if (!skipFx) {
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
      }
    } else if (ev.type === "board") {
      delete gs.risqueReplayBattleFlashLabels;
      var nextSnap = boardSnapshotFromTape(ev.board);
      if (!skipFx && ev.segment === "battle" && ctx.lastReplayBoardSnapshot) {
        gs.risqueReplayBattleFlashLabels = replayDiffChangedTerritoryLabels(
          ctx.lastReplayBoardSnapshot,
          nextSnap
        );
      }
      applyBoard(gs, ev.board);
      refreshTurnOrder(gs);
      ctx.lastReplayBoardSnapshot = nextSnap;
      if (!skipFx) {
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
        if (ev.segment === "battle" && gs.risqueReplayBattleFlashLabels) {
          var flashCopy = gs.risqueReplayBattleFlashLabels;
          window.setTimeout(function () {
            if (!window.gameState || window.gameState !== gs) return;
            if (!gs.risqueReplayPlaybackActive) return;
            if (gs.risqueReplayBattleFlashLabels !== flashCopy) return;
            delete gs.risqueReplayBattleFlashLabels;
            window.gameUtils.renderTerritories(null, gs);
          }, 240);
        }
      }
    } else if (ev.type === "elimination") {
      delete gs.risqueReplayBattleFlashLabels;
      if (!skipFx) showEliminationSplash(ev.conqueror, ev.defeated);
    }
  }

  function clearReplayChipHighlight() {
    var list = document.getElementById("risque-replay-file-list");
    if (!list) return;
    var marked = list.querySelectorAll(".risque-replay-round-chip--active");
    var mi;
    for (mi = 0; mi < marked.length; mi++) marked[mi].classList.remove("risque-replay-round-chip--active");
  }

  /**
   * Highlights the chip for the current tape position: segment files (DD / rNpM) by seek index,
   * or round chips (R1, R2, …) by stamped round.
   * Segment chips use phaseReplayIndex (next event to play), not last-applied index — otherwise a seek
   * to r1p2 leaves "last applied" on the last r1p1 frame and the UI flashes r1p1 until the next step().
   */
  function updateReplayChipHighlight(gs) {
    var list = document.getElementById("risque-replay-file-list");
    if (!list) return;
    clearReplayChipHighlight();
    if (!gs || !gs.risqueReplayPlaybackActive) return;

    var pack = window.__risqueReplayLoadedPack;
    var chips = list.querySelectorAll("button.risque-replay-round-chip");
    if (!chips.length) return;

    var phaseIdx = gs.phaseReplayIndex != null ? Math.floor(Number(gs.phaseReplayIndex)) || 0 : 0;
    if (phaseIdx < 0) phaseIdx = 0;

    var hints = pack && Array.isArray(pack.__segmentSeekHints) ? pack.__segmentSeekHints : null;
    var firstSeek = chips[0] && chips[0].getAttribute("data-seek-index");
    if (hints && hints.length && firstSeek != null) {
      var refPos = phaseIdx;
      var pick = 0;
      var hi;
      for (hi = hints.length - 1; hi >= 0; hi--) {
        var six = parseInt(String(hints[hi].seekIndex), 10) || 0;
        if (refPos >= six) {
          pick = hi;
          break;
        }
      }
      if (pick < chips.length) chips[pick].classList.add("risque-replay-round-chip--active");
      return;
    }

    var n = 1;
    if (gs.risqueReplayMachineHudPhase === "deal") {
      n = 1;
    } else {
      var raw = gs.risqueReplayHudRound;
      n = typeof raw === "number" ? raw : parseInt(raw, 10);
      if (!isFinite(n) || n < 1) {
        var r2 = gs.round;
        n = typeof r2 === "number" ? r2 : parseInt(r2, 10);
      }
      if (!isFinite(n) || n < 1) n = 1;
    }
    var chip = list.querySelector(
      '.risque-replay-round-chip[data-round="' + String(Math.floor(n)) + '"]'
    );
    if (chip) chip.classList.add("risque-replay-round-chip--active");
  }

  /** Tape JSON files in this load (folder refresh or file picker). Hidden for live bootstrap from host. */
  function updateReplayTapeCountLine(n) {
    var el = document.getElementById("risque-replay-tape-count");
    if (!el) return;
    if (n == null || !isFinite(Number(n)) || Number(n) < 1) {
      el.textContent = "";
      return;
    }
    el.textContent = "TOTAL REPLAY FILES=" + String(Math.floor(Number(n)));
  }

  function updateRoundsLoadedUi(sourcePacks, mergedPack) {
    var el = document.getElementById("risque-replay-file-list");
    if (!el) return;
    el.innerHTML = "";
    if (!mergedPack || !mergedPack.tape || !Array.isArray(mergedPack.tape.events)) {
      var dash0 = document.createElement("span");
      dash0.className = "risque-replay-round-chips-empty";
      dash0.textContent = "—";
      el.appendChild(dash0);
      return;
    }
    var segHintsUi = mergedPack.__segmentSeekHints;
    if (Array.isArray(segHintsUi) && segHintsUi.length) {
      var hi;
      for (hi = 0; hi < segHintsUi.length; hi++) {
        var sh = segHintsUi[hi];
        var sb = document.createElement("button");
        sb.type = "button";
        sb.className = "risque-replay-round-chip";
        sb.setAttribute("data-seek-index", String(sh.seekIndex));
        sb.setAttribute("aria-label", "Jump to segment " + String(sh.label));
        sb.title = "Segment " + String(sh.label);
        var sSpan = document.createElement("span");
        sSpan.className = "risque-replay-round-chip-r";
        sSpan.textContent = String(sh.label);
        sb.appendChild(sSpan);
        el.appendChild(sb);
      }
      return;
    }
    /* Chips: timeline + merge headers + per-file replayRound (replay4.json, legacy …-replay.json, …). */
    var tapeRounds = collectReplayRoundsForUiChips(
      filterFullReplayEvents(mergedPack.tape.events.slice()),
      mergedPack,
      sourcePacks
    );
    var any = false;
    var seenRn = {};
    var ri;
    for (ri = 0; ri < tapeRounds.length; ri++) {
      var rn = tapeRounds[ri];
      if (!rn || seenRn[rn]) continue;
      seenRn[rn] = true;
      any = true;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "risque-replay-round-chip";
      btn.setAttribute("data-round", String(rn));
      btn.setAttribute("aria-label", "Jump to round " + String(rn));
      btn.title = "Round " + String(rn);
      var rSpan = document.createElement("span");
      rSpan.className = "risque-replay-round-chip-r";
      rSpan.textContent = "R" + String(rn);
      btn.appendChild(rSpan);
      el.appendChild(btn);
    }
    if (!any && sourcePacks && sourcePacks.length) {
      var ordered = sourcePacks.slice().sort(function (a, b) {
        return packSavedAtMs(a) - packSavedAtMs(b);
      });
      var ci;
      for (ci = 0; ci < ordered.length; ci++) {
        var p = ordered[ci];
        var rnf = effectiveReplayRoundFromPack(p);
        if (!rnf || seenRn[rnf]) continue;
        seenRn[rnf] = true;
        any = true;
        var btn2 = document.createElement("button");
        btn2.type = "button";
        btn2.className = "risque-replay-round-chip";
        btn2.setAttribute("data-round", String(rnf));
        btn2.setAttribute(
          "aria-label",
          "Round " + String(rnf) + ", saved " + formatReplaySavedAtChip(packSavedAtMs(p))
        );
        btn2.title = formatReplaySavedAtChip(packSavedAtMs(p));
        var rSpan2 = document.createElement("span");
        rSpan2.className = "risque-replay-round-chip-r";
        rSpan2.textContent = "R" + String(rnf);
        btn2.appendChild(rSpan2);
        el.appendChild(btn2);
      }
    }
    if (!any) {
      var dash2 = document.createElement("span");
      dash2.className = "risque-replay-round-chips-empty";
      dash2.textContent = "—";
      el.appendChild(dash2);
    }
  }

  function seekPlaybackToRound(roundNum) {
    var pack = window.__risqueReplayLoadedPack;
    if (!pack || !window.gameUtils) return;
    var rawEv = pack.tape && pack.tape.events;
    var pe = filterFullReplayEvents(Array.isArray(rawEv) ? rawEv.slice() : []);
    if (!pe.length) return;
    var r = parseInt(roundNum, 10);
    if (!isFinite(r) || r < 1) return;
    var target = replayComputeStartIndex(pe, "from_round", r);
    var s = window.__risqueReplaySession;
    if (s && typeof s.seekToIndex === "function") {
      s.seekToIndex(target);
    } else {
      runPlaybackFromPack(pack, target);
    }
  }

  function seekPlaybackToIndex(idx) {
    var pack = window.__risqueReplayLoadedPack;
    if (!pack || !window.gameUtils) return;
    var rawEv = pack.tape && pack.tape.events;
    var pe = filterFullReplayEvents(Array.isArray(rawEv) ? rawEv.slice() : []);
    if (!pe.length) return;
    var t = Math.max(0, Math.min(Math.floor(Number(idx)) || 0, pe.length - 1));
    var s = window.__risqueReplaySession;
    if (s && typeof s.seekToIndex === "function") {
      s.seekToIndex(t);
    } else {
      runPlaybackFromPack(pack, t);
    }
  }

  function setTransportEnabled(enabled) {
    var ids = [
      "risque-replay-transport-play",
      "risque-replay-transport-pause",
      "risque-replay-transport-stop"
    ];
    var i;
    for (i = 0; i < ids.length; i++) {
      var node = document.getElementById(ids[i]);
      if (node) node.disabled = !enabled;
    }
  }

  /** Tape loaded, not playing: PLAY + STOP on; PAUSE off. */
  function setTransportStandbyLoaded() {
    var pauseBtn = document.getElementById("risque-replay-transport-pause");
    if (pauseBtn) pauseBtn.disabled = true;
    var playBtn = document.getElementById("risque-replay-transport-play");
    if (playBtn) playBtn.disabled = false;
    var stopBtn = document.getElementById("risque-replay-transport-stop");
    if (stopBtn) stopBtn.disabled = false;
  }

  /** Natural end of tape: PLAY + PAUSE off; STOP on to reset the board. */
  function setTransportReplayEnded() {
    var playBtn = document.getElementById("risque-replay-transport-play");
    var pauseBtn = document.getElementById("risque-replay-transport-pause");
    var stopBtn = document.getElementById("risque-replay-transport-stop");
    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
  }

  function transportSyncStopButton() {
    var stopBtn = document.getElementById("risque-replay-transport-stop");
    if (stopBtn) stopBtn.disabled = !window.__risqueReplayLoadedPack;
  }

  function updateTransportPlayPauseUi(session) {
    var playBtn = document.getElementById("risque-replay-transport-play");
    var pauseBtn = document.getElementById("risque-replay-transport-pause");
    if (window.__risqueReplayEnded) {
      if (playBtn) playBtn.disabled = true;
      if (pauseBtn) pauseBtn.disabled = true;
      transportSyncStopButton();
      return;
    }
    if (!session || !session.playbackEvents) {
      if (window.__risqueReplayLoadedPack && !window.__risqueReplaySession) {
        if (playBtn) playBtn.disabled = false;
        if (pauseBtn) pauseBtn.disabled = true;
      } else {
        if (playBtn) playBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = true;
      }
      transportSyncStopButton();
      return;
    }
    if (playBtn) playBtn.disabled = !session.paused;
    if (pauseBtn) pauseBtn.disabled = session.paused;
    transportSyncStopButton();
  }

  /** Empty map and stats (no territory markers). Keeps tape files loaded for PLAY. */
  function resetReplayBoardClean() {
    if (!window.gameUtils) return;
    window.gameState = {
      phase: "attack",
      round: 1,
      currentPlayer: "",
      turnOrder: [],
      players: [],
      deck: []
    };
    window.gameUtils.renderTerritories(null, window.gameState);
    window.gameUtils.renderStats(window.gameState);
  }

  /** STOP: end session, clear map to blank, leave JSON loaded and enable PLAY. */
  function replayStopToCleanStandby() {
    if (!window.__risqueReplayLoadedPack) return;
    window.__risqueReplayAutoStartTok = (window.__risqueReplayAutoStartTok || 0) + 1;
    stopPlayback({ skipStatusMsg: true, silentTransport: true });
    resetReplayBoardClean();
    setTransportStandbyLoaded();
    updateTransportPlayPauseUi(null);
    clearReplayChipHighlight();
    updateReplayTapeCountLine(null);
  }

  function removeReplayRoundHud() {
    var legacy = document.getElementById("risque-replay-round-hud");
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
  }

  function syncRoundHud(gs) {
    if (!gs || !gs.risqueReplayPlaybackActive) {
      removeReplayRoundHud();
      var staleBar = document.getElementById("risque-replay-bar");
      if (staleBar && staleBar.parentNode) staleBar.parentNode.removeChild(staleBar);
      clearReplayChipHighlight();
      return;
    }
    updateReplayChipHighlight(gs);
  }

  function removeReplaySplash() {
    var el = document.getElementById("risque-replay-splash");
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (window.gameState && typeof window.gameState === "object") {
      delete window.gameState.risquePublicReplayEliminationSplash;
    }
    try {
      if (
        window.gameState &&
        window.gameState.risqueReplayPlaybackActive &&
        typeof risqueReplayMirrorPushToPublicBoard === "function"
      ) {
        risqueReplayMirrorPushToPublicBoard(window.gameState);
      }
    } catch (eRmMir) {
      /* ignore */
    }
  }

  function showEliminationSplash(conqueror, defeated) {
    removeReplaySplash();
    var conq = String(conqueror || "").trim() || "?";
    var def = String(defeated || "").trim() || "?";
    var root = document.createElement("div");
    root.id = "risque-replay-splash";
    root.className = "risque-replay-splash risque-replay-splash--elimination";
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "assertive");
    var line = document.createElement("div");
    line.className = "risque-replay-splash-line risque-replay-splash-line--elimination";
    line.textContent = conq + " has conquered " + def;
    root.appendChild(line);
    document.body.appendChild(root);
    if (window.gameState && typeof window.gameState === "object") {
      window.gameState.risquePublicReplayEliminationSplash = {
        conqueror: conq,
        defeated: def,
        at: Date.now()
      };
    }
    try {
      if (window.gameState && typeof risqueReplayMirrorPushToPublicBoard === "function") {
        risqueReplayMirrorPushToPublicBoard(window.gameState);
      }
    } catch (eSpMir) {
      /* ignore */
    }
  }

  function removeReplayStartOverlay() {
    var el = document.getElementById("risque-replay-start-overlay");
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function minimalStateFromPack(pack) {
    /* Do not seed gs.round from pack.round — that is “live game when exported” (often 5–6) and flashes on
     * the watch display before the first tape frame. Playback advances round from init/deal/battle stamps. */
    var ph = pack.phase != null ? String(pack.phase) : "attack";
    /* Saved JSON often carries live phase=login; renderTerritories would otherwise strip all markers. */
    if (ph === "login") ph = "attack";
    var gs = {
      phase: ph,
      round: 1,
      currentPlayer: pack.currentPlayer != null ? String(pack.currentPlayer) : "",
      turnOrder: [],
      players: [],
      deck: [],
      risqueReplayPlaybackActive: true,
      risqueReplayPlayerColors: normalizeReplayPlayerColorsMap(
        pack.playerColors && typeof pack.playerColors === "object" ? pack.playerColors : {}
      )
    };
    return gs;
  }

  function refreshTurnOrder(gs) {
    if (!gs || !gs.players) return;
    var names = gs.players.map(function (p) {
      return p && p.name ? String(p.name) : "";
    }).filter(Boolean);
    gs.turnOrder = names;
    if (!gs.currentPlayer || names.indexOf(gs.currentPlayer) === -1) {
      gs.currentPlayer = names[0] || "";
    }
  }

  var __timer = null;

  function stopPlayback(opts) {
    opts = opts || {};
    window.__risqueReplaySession = null;
    if (!opts.replayEnded) {
      window.__risqueReplayEnded = false;
      setReplayEndedLine(false);
    }
    if (!opts.silentTransport) {
      if (opts.replayEnded) {
        setTransportReplayEnded();
      } else if (window.__risqueReplayLoadedPack) {
        setTransportStandbyLoaded();
      } else {
        setTransportEnabled(false);
      }
    }
    if (opts.replayEnded) {
      window.__risqueReplayEnded = true;
      setReplayEndedLine(true);
    }
    updateTransportPlayPauseUi(null);
    clearReplayChipHighlight();
    if (__timer != null) {
      clearTimeout(__timer);
      __timer = null;
    }
    removeReplayStartOverlay();
    removeReplaySplash();
    removeReplayRoundHud();
    var barEarly = document.getElementById("risque-replay-bar");
    if (barEarly && barEarly.parentNode) barEarly.parentNode.removeChild(barEarly);
    if (window.gameState && typeof window.gameState === "object") {
      delete window.gameState.risqueReplayPlaybackActive;
      delete window.gameState.phaseReplayIndex;
      delete window.gameState.risqueReplayBattleFlashLabels;
      delete window.gameState.risqueReplayMachineHudPhase;
      delete window.gameState.risqueReplayHudActorLine;
    }
    var replayWinOneShot = false;
    if (
      opts.replayEnded &&
      window.gameState &&
      Array.isArray(window.gameState.players) &&
      window.gameState.players.length === 1
    ) {
      var pWin = window.gameState.players[0];
      if (pWin && pWin.name) {
        window.gameState.risqueGameWinImmediate = true;
        window.gameState.winner = String(pWin.name);
        replayWinOneShot = true;
      }
    }
    try {
      if (window.gameState && typeof window.gameState === "object") {
        risqueReplayMirrorPushToPublicBoard(window.gameState, { playbackOff: true });
      }
    } catch (eMirStop) {
      /* ignore */
    }
    if (window.gameState && typeof window.gameState === "object" && replayWinOneShot) {
      delete window.gameState.risqueGameWinImmediate;
      delete window.gameState.winner;
    }
    if (!opts.skipStatusMsg) {
      setStatus("");
    }
  }

  function runPlaybackFromPack(pack, startIndex) {
    if (!window.gameUtils) {
      setStatus("Map engine not ready.");
      return;
    }
    stopPlayback({ skipStatusMsg: true, silentTransport: true });
    var playbackEvents = filterFullReplayEvents(pack.tape.events.slice());
    if (!playbackEvents.length) {
      setStatus("No playable frames on this tape.");
      return;
    }

    try {
      if (typeof window.gameUtils.resizeCanvas === "function") {
        window.gameUtils.resizeCanvas();
      }
    } catch (eRc) {
      /* ignore */
    }

    var packRef = pack;
    var granularGlueRelax = !!(
      packRef &&
      (packRef.risqueReplayGranularGlueRelax === true || packRef.risqueReplayGranularAttackPhase === true)
    );
    var gs = minimalStateFromPack(pack);
    window.gameState = gs;

    var idx = Math.max(
      0,
      Math.min(Math.floor(Number(startIndex)) || 0, Math.max(0, playbackEvents.length - 1))
    );

    var replayRoundFallback = (function () {
      var r = gs.round;
      var n = typeof r === "number" ? r : parseInt(r, 10);
      return isFinite(n) && n >= 1 ? n : 1;
    })();
    var lastStampedRound = null;
    var lastReplayBoardSnapshot = null;
    var paused = false;

    var canvasEl = document.getElementById("canvas");
    if (!canvasEl) return;

    gs.risqueReplayPlaybackActive = true;
    setTransportEnabled(true);
    var session = {
      playbackEvents: playbackEvents,
      paused: false,
      play: function () {},
      pause: function () {},
      seekToIndex: function () {}
    };

    function rebuildStateAt(nextIdx) {
      nextIdx = Math.max(0, Math.min(playbackEvents.length, Math.floor(nextIdx)));
      gs = minimalStateFromPack(packRef);
      window.gameState = gs;
      gs.risqueReplayPlaybackActive = true;
      lastStampedRound = null;
      lastReplayBoardSnapshot = null;
      var ctxBulk = {
        lastStampedRound: null,
        lastReplayBoardSnapshot: null,
        replayRoundFallback: replayRoundFallback,
        skipFx: true
      };
      var j;
      for (j = 0; j < nextIdx; j++) {
        try {
          replayApplyOnePlayback(gs, playbackEvents[j], ctxBulk);
        } catch (eBulk) {
          try {
            console.error("[Replay] seek rebuild failed at j=" + j, playbackEvents[j], eBulk);
          } catch (eLg) {
            /* ignore */
          }
          setStatus(
            "Replay seek stopped at frame " +
              j +
              " — " +
              (eBulk && eBulk.message ? eBulk.message : String(eBulk))
          );
          break;
        }
        lastStampedRound = ctxBulk.lastStampedRound;
        lastReplayBoardSnapshot = ctxBulk.lastReplayBoardSnapshot;
      }
      idx = j < nextIdx ? j : nextIdx;
      gs.phaseReplayIndex = idx;
      delete gs.risqueReplayBattleFlashLabels;
      removeReplaySplash();
      window.gameUtils.renderTerritories(null, gs);
      window.gameUtils.renderStats(gs);
      syncRoundHud(gs);
      risqueReplayMirrorPushToPublicBoard(gs);
    }

    function clearTimer() {
      if (__timer != null) {
        clearTimeout(__timer);
        __timer = null;
      }
    }

    function scheduleAfter(ms) {
      if (paused) return;
      clearTimer();
      __timer = setTimeout(step, ms);
    }

    function step() {
      clearTimer();
      removeReplaySplash();
      if (!window.gameState || !window.gameState.risqueReplayPlaybackActive) return;

      if (idx >= playbackEvents.length) {
        stopPlayback({ replayEnded: true });
        return;
      }

      var ev = playbackEvents[idx];
      idx += 1;
      gs.phaseReplayIndex = idx;

      var ctxStep = {
        lastStampedRound: lastStampedRound,
        lastReplayBoardSnapshot: lastReplayBoardSnapshot,
        replayRoundFallback: replayRoundFallback,
        skipFx: false
      };
      try {
        replayApplyOnePlayback(gs, ev, ctxStep);
      } catch (eStep) {
        try {
          console.error("[Replay] apply event failed at index " + (idx - 1), ev, eStep);
        } catch (eLog) {
          /* ignore */
        }
        setStatus(
          "Replay stopped: error applying frame " +
            (idx - 1) +
            " — " +
            (eStep && eStep.message ? eStep.message : String(eStep))
        );
        stopPlayback({ skipStatusMsg: true, silentTransport: true });
        return;
      }
      lastStampedRound = ctxStep.lastStampedRound;
      lastReplayBoardSnapshot = ctxStep.lastReplayBoardSnapshot;

      if (typeof window.risqueReplayDebugIsOn === "function" && window.risqueReplayDebugIsOn()) {
        try {
          var di = idx - 1;
          var dSeg =
            ev && ev.type === "board" ? String(ev.segment || "") : ev && ev.type ? String(ev.type) : "?";
          var dR = ev && ev.round != null ? ev.round : "—";
          var dK =
            ev && ev.board && typeof ev.board === "object" ? Object.keys(ev.board).length : "—";
          var dRec = ev && ev.recordedForPlayer != null ? String(ev.recordedForPlayer) : "—";
          if (typeof window.risqueReplayDebugLog === "function") {
            window.risqueReplayDebugLog(
              "play",
              "i=" + di,
              ev && ev.type,
              dSeg,
              "stamp=" + dR,
              "hudR=" + (gs.risqueReplayHudRound != null ? gs.risqueReplayHudRound : "—"),
              "keys=" + dK,
              "rec=" + dRec
            );
          }
        } catch (eSt) {
          /* ignore */
        }
      }

      syncRoundHud(gs);
      risqueReplayMirrorPushToPublicBoard(gs);

      if (idx >= playbackEvents.length) {
        stopPlayback({ replayEnded: true });
        return;
      }

      var nextEv = idx < playbackEvents.length ? playbackEvents[idx] : null;
      var d = replayDelayForEvent(ev, { granularGlueRelax: granularGlueRelax, nextEv: nextEv });
      scheduleAfter(d);
    }

    rebuildStateAt(idx);

    session.play = function () {
      if (!gs.risqueReplayPlaybackActive) return;
      if (idx >= playbackEvents.length) return;
      paused = false;
      session.paused = false;
      updateTransportPlayPauseUi(session);
      scheduleAfter(0);
    };
    session.pause = function () {
      paused = true;
      session.paused = true;
      clearTimer();
      updateTransportPlayPauseUi(session);
    };
    session.seekToIndex = function (targetIdx) {
      if (!gs.risqueReplayPlaybackActive) return;
      var t = Math.max(
        0,
        Math.min(Math.floor(Number(targetIdx)) || 0, Math.max(0, playbackEvents.length - 1))
      );
      paused = false;
      session.paused = false;
      clearTimer();
      rebuildStateAt(t);
      updateTransportPlayPauseUi(session);
      scheduleAfter(scaledDelay(MS_REPLAY_START_HOLD));
    };

    paused = false;
    session.paused = false;
    window.__risqueReplaySession = session;
    updateTransportPlayPauseUi(session);

    __timer = setTimeout(function () {
      __timer = null;
      step();
    }, scaledDelay(MS_REPLAY_START_HOLD));
  }

  function prepareLoadedPack(pack, sourcePacks) {
    try {
      var rawEv = pack && pack.tape && pack.tape.events;
      if (!Array.isArray(rawEv) || !rawEv.length) {
        setStatus(
          "This file has no tape events. Use the small *-replay.json from autosave — not the browser backup.json."
        );
        return;
      }
      var normEv = rawEv.slice();
      if (typeof window.risqueReplayNormalizeTapeEventOrder === "function") {
        normEv = window.risqueReplayNormalizeTapeEventOrder(normEv);
      }
      var stripRes = stripBackwardStampedRoundBoardEvents(normEv);
      if (typeof window.risqueReplayDebugIsOn === "function" && window.risqueReplayDebugIsOn()) {
        try {
          var evBeforeStrip = normEv.length;
          if (typeof window.risqueReplayDebugLog === "function") {
            window.risqueReplayDebugLog(
              "prepareLoadedPack",
              "raw=" + rawEv.length,
              "afterNorm=" + evBeforeStrip,
              "afterStrip=" + stripRes.events.length,
              "stripped=" + stripRes.skipped
            );
          } else {
            console.log(
              "[ReplayDebug] prepareLoadedPack stripped=" + stripRes.skipped + " afterStrip=" + stripRes.events.length
            );
          }
        } catch (ePl) {
          /* ignore */
        }
      }
      normEv = stripRes.events;
      if (stripRes.skipped > 0 && stripRes.message) {
        try {
          if (!pack.__mergeWarnings) pack.__mergeWarnings = [];
          if (pack.__mergeWarnings.indexOf(stripRes.message) === -1) pack.__mergeWarnings.push(stripRes.message);
        } catch (eMw) {
          /* ignore */
        }
      }
      pack.tape.events = normEv;
      var playbackEvents = filterFullReplayEvents(normEv.slice());
      if (!playbackEvents.length) {
        setStatus("Tape has no playable frames (deal / deploy / battle / elimination).");
        return;
      }
      try {
        delete pack.__segmentSeekHints;
      } catch (eSeg) {}
      var segHintsBuilt = buildSegmentSeekHints(playbackEvents, sourcePacks || [pack]);
      if (segHintsBuilt) pack.__segmentSeekHints = segHintsBuilt;
      stopPlayback({ skipStatusMsg: true, silentTransport: true });
      window.__risqueReplayLoadedPack = pack;
      resetReplayBoardClean();
      setStatus("");
      setTransportStandbyLoaded();
      updateTransportPlayPauseUi(null);
      updateRoundsLoadedUi(sourcePacks || [pack], pack);
      clearReplayChipHighlight();
      scheduleReplayAutoplayIfDesired();
    } catch (e) {
      setStatus("Replay error: " + (e && e.message ? e.message : String(e)));
      try {
        console.error(e);
      } catch (eLog) {
        /* ignore */
      }
    }
  }

  function startPlaybackFromLoadedPack() {
    var pack = window.__risqueReplayLoadedPack;
    if (!pack || !window.gameUtils) {
      if (!window.gameUtils) setStatus("Map engine not ready.");
      return;
    }
    var rawEv = pack.tape && pack.tape.events;
    var playbackEvents = filterFullReplayEvents(Array.isArray(rawEv) ? rawEv.slice() : []);
    if (!playbackEvents.length) return;
    /* Always from first playable frame (init / deal). Skipping via “lowest stamped round” jumped past init when round was missing or tape started mid-round. */
    runPlaybackFromPack(pack, 0);
  }

  function readFileAsJson(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          resolve(JSON.parse(String(reader.result || "")));
        } catch (e) {
          reject(e);
        }
      };
      reader.onerror = function () {
        reject(new Error("read"));
      };
      reader.readAsText(file);
    });
  }

  function readFileAsUtf8Text(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("read"));
      };
      reader.readAsText(file);
    });
  }

  /** Crude map snapshot from a saved gameState (for Wayback fallback when no replay tapes exist). */
  function fallbackBoardSnapshotFromGameState(gs) {
    var out = {};
    if (!gs || !Array.isArray(gs.players)) return out;
    gs.players.forEach(function (p) {
      if (!p || !p.name) return;
      (p.territories || []).forEach(function (t) {
        if (!t || !t.name) return;
        out[t.name] = { owner: String(p.name), troops: Number(t.troops) || 0 };
      });
    });
    return out;
  }

  /**
   * Build a minimal risque-replay-v1 tape from r{N}p{M}game.json checkpoints (sorted).
   * Used when the folder has no DD/rNpM replay segments — coarse territory animation only.
   */
  async function risqueReplayBuildFallbackTapeFromDirCheckpoints(dirHandle) {
    if (!dirHandle || typeof dirHandle.entries !== "function") return null;
    var items = [];
    async function collectFrom(dh) {
      var iter = dh.entries();
      for await (var step of iter) {
        var name = step[0];
        var h = step[1];
        if (!h || h.kind !== "file") continue;
        if (!/^r\d+p\d+game\.json$/i.test(String(name))) continue;
        var file = await h.getFile();
        var m = /^r(\d+)p(\d+)game\.json$/i.exec(String(name));
        var rk = m ? Number(m[1]) * 1000 + Number(m[2]) : 0;
        items.push({ rk: rk, file: file });
      }
    }
    await collectFrom(dirHandle);
    try {
      var repDh = await dirHandle.getDirectoryHandle("REPLAY", { create: false });
      await collectFrom(repDh);
    } catch (eRep) {
      try {
        var repLo = await dirHandle.getDirectoryHandle("replay", { create: false });
        await collectFrom(repLo);
      } catch (eRep2) {
        /* ignore */
      }
    }
    if (!items.length) return null;
    items.sort(function (a, b) {
      return a.rk - b.rk;
    });
    var events = [];
    var fi;
    for (fi = 0; fi < items.length; fi++) {
      var txt;
      try {
        txt = await readFileAsUtf8Text(items[fi].file);
      } catch (eRead) {
        continue;
      }
      var raw;
      try {
        raw = JSON.parse(txt);
      } catch (eParse) {
        continue;
      }
      if (!raw || !Array.isArray(raw.players)) continue;
      var board = fallbackBoardSnapshotFromGameState(raw);
      if (!Object.keys(board).length) continue;
      var seg = events.length === 0 ? "deal" : "battle";
      var r = Math.max(1, Number(raw.round) || 1);
      var cp = raw.currentPlayer != null ? String(raw.currentPlayer).trim() : "";
      events.push({
        type: "board",
        segment: seg,
        board: board,
        round: r,
        recordedForPlayer: cp
      });
    }
    if (!events.length) return null;
    return {
      format: "risque-replay-v1",
      savedAt: Date.now(),
      playerColors: {},
      tape: {
        v: TAPE_VERSION,
        openingRecorded: true,
        hasDealFrames: true,
        events: events
      }
    };
  }

  window.risqueReplayBuildFallbackTapeFromDirCheckpoints = risqueReplayBuildFallbackTapeFromDirCheckpoints;

  function onFilesSelected(fileList) {
    if (!fileList || !fileList.length) {
      return;
    }
    var files = Array.prototype.slice.call(fileList, 0);
    Promise.all(
      files.map(function (f) {
        return readFileAsJson(f)
          .then(function (raw) {
            return { ok: true, raw: raw, name: f && f.name ? f.name : "file" };
          })
          .catch(function () {
            return { ok: false, raw: null, name: f && f.name ? f.name : "file" };
          });
      })
    ).then(function (results) {
      var packs = [];
      var skipped = [];
      var fi;
      for (fi = 0; fi < results.length; fi++) {
        var res = results[fi];
        if (!res.ok) {
          skipped.push(res.name + " (unreadable JSON)");
          continue;
        }
        var rawOne = res.raw;
        if (looksLikeGameBackupNotTape(rawOne)) {
          skipped.push(res.name + " (game backup, not *-replay.json)");
          continue;
        }
        var pack = normalizeImportedReplay(rawOne);
        if (!pack) {
          skipped.push(res.name + " (not a replay tape)");
          continue;
        }
        pack.__risqueSourceFilename = res.name;
        packs.push(pack);
      }
      if (!packs.length) {
        var failMsg =
          skipped.length === 1
            ? "No replay loaded — " + skipped[0]
            : "No replay loaded. Skipped: " + skipped.join("; ");
        setStatus(failMsg);
        updateReplayTapeCountLine(null);
        return;
      }
      var toPlay = packs.length === 1 ? packs[0] : mergeReplayPacks(packs);
      if (!toPlay) {
        setStatus(
          "Could not merge replay files — ensure js/replay-tape.js is loaded before replay-machine.js."
        );
        updateReplayTapeCountLine(null);
        return;
      }
      if (!toPlay.tape || !Array.isArray(toPlay.tape.events) || !toPlay.tape.events.length) {
        setStatus("No events to play — empty or invalid tape after merge.");
        updateReplayTapeCountLine(null);
        return;
      }
      enrichPlayerColorsFromTape(toPlay);
      window.__risqueReplayAutoStartTok = (window.__risqueReplayAutoStartTok || 0) + 1;
      var autoTok = window.__risqueReplayAutoStartTok;
      updateReplayTapeCountLine(files.length);
      prepareLoadedPack(toPlay, packs);
      if (AUTO_START_PLAYBACK_AFTER_LOAD) {
        window.setTimeout(function () {
          if (window.__risqueReplayAutoStartTok !== autoTok) return;
          startPlaybackFromLoadedPack();
        }, AUTO_START_DELAY_MS);
      }
    });
  }

  /** Center of panel at logical x=1500 from canvas left (1920×1080 space); width capped at 800px. */
  function risqueReplayPositionHud() {
    var hud = document.getElementById("runtime-hud-root");
    if (!hud || !hud.classList.contains("runtime-hud-root--replay-machine")) return;
    var allow =
      !!window.RISQUE_REPLAY_MACHINE || document.body.classList.contains("replay-machine-page");
    if (!allow) return;
    var stage = document.querySelector(".replay-stage-host");
    var canvas = document.getElementById("canvas");
    if (!stage || !canvas) return;
    var cr = canvas.getBoundingClientRect();
    if (cr.width < 4) return;
    var scale = cr.width / 1920;
    /* Viewport X of map anchor (panel uses translateX(-50%) so this is the column center). */
    var centerViewportX = cr.left + 1500 * scale;
    hud.style.left = centerViewportX + "px";
    /* Width comes only from replay-machine.html + game.css (never inline — avoids fighting 800px cap). */
  }

  window.risqueReplayPositionHud = risqueReplayPositionHud;

  function risqueReplayWireHudResizeOnce() {
    if (window.__risqueReplayHudResizeListener) {
      risqueReplayPositionHud();
      return;
    }
    window.__risqueReplayHudResizeListener = function () {
      risqueReplayPositionHud();
    };
    window.addEventListener("resize", window.__risqueReplayHudResizeListener);
    risqueReplayPositionHud();
    requestAnimationFrame(function () {
      risqueReplayPositionHud();
      requestAnimationFrame(risqueReplayPositionHud);
    });
  }

  function risqueReplayUnwireHudResize() {
    if (!window.__risqueReplayHudResizeListener) return;
    window.removeEventListener("resize", window.__risqueReplayHudResizeListener);
    window.__risqueReplayHudResizeListener = null;
  }
  window.risqueReplayStripBackwardStampedRoundBoards = stripBackwardStampedRoundBoardEvents;

  /**
   * When DD + at least one rNpM.json exist, Wayback merge uses granular tapes only — drop replayN.json and
   * replay-full.json from the folder load so merge does not replace the chip chain with one session blob.
   */
  function filterReplayMetaGranularWaybackFirst(metaArr) {
    if (!metaArr || !metaArr.length) return metaArr;
    var hasDd = false;
    var hasRM = false;
    var i;
    for (i = 0; i < metaArr.length; i++) {
      var nm = metaArr[i] && metaArr[i].name ? String(metaArr[i].name).toLowerCase() : "";
      if (nm === "dd.json" || nm === "replay-deal.json") hasDd = true;
      if (/^r\d+p\d+\.json$/i.test(nm)) hasRM = true;
    }
    if (!hasDd || !hasRM) return metaArr;
    return metaArr.filter(function (m) {
      var nm = m && m.name ? String(m.name).toLowerCase() : "";
      if (/^replay\d+\.json$/i.test(nm)) return false;
      if (nm === "replay-full.json" || nm === "risque-full-replay.json" || nm === "rqwb-full-replay.json") {
        return false;
      }
      return true;
    });
  }

  /**
   * Collect replay JSON from the save root, REPLAY/ (flat), and one level of legacy session folders
   * (RQSESS-* or yyyy-MM-dd_HHmmss). Auto-load picks the bucket whose newest replay file is most recent.
   */
  async function risqueReplayCollectReplayFilesFromDir(dirHandle) {
    if (!dirHandle || typeof dirHandle.entries !== "function") return [];
    var buckets = {};
    function pushMeta(bucketKey, name, file) {
      if (!buckets[bucketKey]) buckets[bucketKey] = [];
      buckets[bucketKey].push({
        file: file,
        name: name,
        lastModified: file.lastModified || 0
      });
    }
    async function scanDir(dh, bucketKey, depth) {
      try {
        var iter = dh.entries();
        for await (var step of iter) {
          var name = step[0];
          var h = step[1];
          if (!h) continue;
          if (h.kind === "file") {
            if (/^rqck-/i.test(String(name))) continue;
            if (
              /^risque-ckpt-/i.test(String(name)) ||
              /^game-ckpt-/i.test(String(name)) ||
              /^replay-ckpt-/i.test(String(name)) ||
              /^r\d+p\d+game\.json$/i.test(String(name))
            )
              continue;
            if (/^risque-emergency-/i.test(String(name)) || /^game-emergency-/i.test(String(name)) || /^replay-emergency-/i.test(String(name))) continue;
            var lower = String(name).toLowerCase();
            if (!lower.endsWith(".json")) continue;
            if (/^rqdiscard-/i.test(String(name))) continue;
            /* Keep session tapes (replay-full.json, replay-final.json, …): skipping them broke folder load when
             * the organizer only left merged tapes under REPLAY/. Game snapshots (game-final, RQGS-… .json) never
             * match isTape because "replay" is not in the filename. */
            var isTape =
              /^dd\.json$/i.test(lower) ||
              /^replay-deal\.json$/i.test(lower) ||
              /^r\d+p\d+\.json$/i.test(lower) ||
              /^r\d+p\d+-replay\.json$/i.test(lower) ||
              /^replay\d+\.json$/i.test(lower) ||
              /^risque-replay-\d+\.json$/i.test(lower) ||
              /^rqrp/i.test(String(name)) ||
              (lower.indexOf("replay") !== -1 &&
                !/^game\d+\.json$/i.test(lower) &&
                !/^game-final\.json$/i.test(lower) &&
                !/^game-emergency-/i.test(String(name)));
            if (!isTape) continue;
            var file = await h.getFile();
            pushMeta(bucketKey, name, file);
            continue;
          }
          if (
            h.kind === "directory" &&
            depth < 1 &&
            (/^rqsess-/i.test(String(name)) || /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(String(name)))
          ) {
            var sub = await dh.getDirectoryHandle(name);
            await scanDir(sub, name, depth + 1);
          }
        }
      } catch (e) {
        console.warn(e);
      }
    }
    await scanDir(dirHandle, "__root__", 0);
    try {
      var replayUpper = await dirHandle.getDirectoryHandle("REPLAY", { create: false });
      await scanDir(replayUpper, "__root__", 0);
    } catch (eReplayScan) {
      try {
        var replayLower = await dirHandle.getDirectoryHandle("replay", { create: false });
        await scanDir(replayLower, "__root__", 0);
      } catch (eReplayScan2) {
        /* Legacy: replay JSON under save root or root/RQSESS-* only. */
      }
    }
    var bestKey = null;
    var bestScore = -1;
    var keys = Object.keys(buckets);
    var ki;
    for (ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      var arr = buckets[k];
      if (!arr || !arr.length) continue;
      var mx = 0;
      var ai;
      for (ai = 0; ai < arr.length; ai++) {
        mx = Math.max(mx, arr[ai].lastModified || 0);
      }
      if (mx > bestScore) {
        bestScore = mx;
        bestKey = k;
      }
    }
    if (!bestKey || !buckets[bestKey]) return [];
    var out = buckets[bestKey].slice();
    out.sort(function (a, b) {
      return a.lastModified - b.lastModified;
    });
    return out;
  }

  /**
   * Sort tapes oldest-first for merge order. We always pass every segment file + replay-full together —
   * dropping per-round files in favor of replay-full alone caused merges that started mid-game (no R1 deal).
   */
  async function risqueReplayPreferWaybackFullTapeAsync(metaArr) {
    if (!metaArr || !metaArr.length) return metaArr;
    var out = metaArr.slice();
    out.sort(function (a, b) {
      return (a.lastModified || 0) - (b.lastModified || 0);
    });
    return out;
  }

  async function risqueReplayLoadFromDirectoryHandle(dirHandle, opts) {
    opts = opts || {};
    var meta = await risqueReplayCollectReplayFilesFromDir(dirHandle);
    meta = await risqueReplayPreferWaybackFullTapeAsync(meta);
    meta = filterReplayMetaGranularWaybackFirst(meta);
    if (!meta.length) {
      var fbPack = await risqueReplayBuildFallbackTapeFromDirCheckpoints(dirHandle);
      if (fbPack && fbPack.tape && fbPack.tape.events && fbPack.tape.events.length) {
        var fbBlob = new Blob([JSON.stringify(fbPack, null, 2)], { type: "application/json" });
        var fbFile = new File([fbBlob], "wayback-fallback-checkpoints.json", {
          type: "application/json",
          lastModified: Date.now()
        });
        onFilesSelected([fbFile]);
        setStatus(
          "Fallback replay: built a coarse animation from rNpMgame-style checkpoints (no DD/rNpM tapes in this folder)."
        );
        updateReplayTapeCountLine(1);
        if (!opts.skipStatus) {
          /* keep status message visible */
        }
        return;
      }
      setStatus(
        "No replay tapes in this folder — Wayback needs DD.json and rNpM.json (or *-replay.json). Files like r2p3game.json are resume checkpoints only, not animated tapes."
      );
      updateReplayTapeCountLine(null);
      return;
    }
    var files = meta.map(function (x) {
      return x.file;
    });
    onFilesSelected(files);
    if (!opts.skipStatus) {
      setStatus("");
    }
  }

  async function risqueReplayVerifyAndLoadFromStoredHandle(dirHandle) {
    if (!dirHandle) return false;
    var readableFn = window.risqueSaveFolderEnsureReadable;
    if (typeof readableFn !== "function") return false;
    try {
      var h = await readableFn(dirHandle);
      if (!h) return false;
      try {
        window.__risqueReplayConnectedSaveRootHandle = dirHandle;
      } catch (eRoot) {
        /* ignore */
      }
      var wh = dirHandle;
      if (typeof window.risqueSaveFolderEnsureWritable === "function") {
        try {
          var wResolved = await window.risqueSaveFolderEnsureWritable(dirHandle);
          if (wResolved) wh = wResolved;
        } catch (eW) {
          /* ignore */
        }
      }
      if (typeof window.risqueHostSaveFolderAdoptDirectoryHandle === "function") {
        window.risqueHostSaveFolderAdoptDirectoryHandle(wh);
      }
      await risqueReplayLoadFromDirectoryHandle(h, { skipStatus: true });
      setStatus("");
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Same as the Refresh button: re-scan the remembered save folder from disk (when permitted). */
  function risqueReplayRefreshFromStoredFolder() {
    if (typeof window.risqueSaveFolderIdbGet !== "function") return Promise.resolve();
    return window.risqueSaveFolderIdbGet().then(function (h) {
      if (!h) {
        setStatus("No folder saved yet — use Connect saved folder once.");
        return;
      }
      return risqueReplayVerifyAndLoadFromStoredHandle(h);
    });
  }

  function risqueReplayScheduleLaunchFolderRefresh() {
    window.setTimeout(function () {
      risqueReplayRefreshFromStoredFolder().catch(function () {});
    }, 50);
  }

  /**
   * Browsers deny requestPermission() without a user gesture. If the game already stored the
   * folder handle in IDB, one tap anywhere retries permission so replay loads without opening
   * the directory picker again.
   */
  function risqueReplayWireOneShotGestureForStoredFolder() {
    if (window.__risqueReplayFolderGestureWired) return;
    window.__risqueReplayFolderGestureWired = true;
    function cleanup() {
      document.removeEventListener("pointerdown", onFirst, true);
      document.removeEventListener("keydown", onFirst, true);
    }
    function onFirst(ev) {
      var t = ev && ev.target;
      if (t && t.closest) {
        if (
          t.closest("#risque-replay-folder-connect") ||
          t.closest("#risque-replay-folder-refresh")
        ) {
          return;
        }
      }
      cleanup();
      if (typeof window.risqueSaveFolderIdbGet !== "function") return;
      window
        .risqueSaveFolderIdbGet()
        .then(function (h) {
          if (!h) return false;
          return risqueReplayVerifyAndLoadFromStoredHandle(h);
        })
        .then(function () {
          window.__risqueReplayFolderNeedsGesture = false;
        })
        .catch(function () {});
    }
    document.addEventListener("pointerdown", onFirst, true);
    document.addEventListener("keydown", onFirst, true);
  }

  function risqueReplayBootStoredFolderFromIdb() {
    var getFn = window.risqueSaveFolderIdbGet;
    var readableFn = window.risqueSaveFolderEnsureReadable;
    if (typeof getFn !== "function") return;
    getFn()
      .then(function (h) {
        if (!h) return null;
        if (typeof readableFn !== "function") return h;
        return readableFn(h).then(function (rh) {
          if (rh) return h;
          return { __risqueNeedFolderGesture: true };
        });
      })
      .then(function (res) {
        if (!res) return;
        if (res.__risqueNeedFolderGesture) {
          window.__risqueReplayFolderNeedsGesture = true;
          risqueReplayWireOneShotGestureForStoredFolder();
          return;
        }
        window.__risqueReplayFolderNeedsGesture = false;
        return risqueReplayVerifyAndLoadFromStoredHandle(res);
      })
      .catch(function () {});
  }

  function wireReplayTransportControls() {
    function bind(id, fn) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function () {
        var s = window.__risqueReplaySession;
        if (s && typeof s[fn] === "function") s[fn]();
      });
    }
    var playEl = document.getElementById("risque-replay-transport-play");
    if (playEl) {
      playEl.addEventListener("click", function () {
        var s = window.__risqueReplaySession;
        if (s && typeof s.play === "function") {
          s.play();
          return;
        }
        startPlaybackFromLoadedPack();
      });
    }
    bind("risque-replay-transport-pause", "pause");
    var stopEl = document.getElementById("risque-replay-transport-stop");
    if (stopEl) {
      stopEl.addEventListener("click", function () {
        replayStopToCleanStandby();
      });
    }
  }

  /**
   * Inner HTML of #risque-main-panel-body — must match replay-machine.html (standalone Wayback).
   */
  function risqueReplayMachinePanelBodyInnerHtml() {
    return (
      '<div class="risque-replay-centered-stack">' +
      '<div class="risque-replay-machine-brand">' +
      '<p class="risque-replay-machine-brand-the">THE</p>' +
      '<p class="risque-replay-machine-brand-main">WAYBACK MACHINE</p>' +
      "</div>" +
      '<div class="risque-replay-file-row risque-replay-file-row--primary">' +
      '<button type="button" id="risque-replay-folder-connect" class="risque-replay-file-pick-btn risque-replay-file-pick-btn--primary" title="Pick your flat save folder once (default C:\\risque\\save with scripts\\RISQUE.bat — same as round autosave)">' +
      "Connect saved folder" +
      "</button>" +
      '<button type="button" id="risque-replay-folder-refresh" class="risque-replay-file-pick-btn" title="Reload all *replay*.json from the connected folder">' +
      "Refresh" +
      "</button>" +
      "</div>" +
      '<div class="risque-replay-scope-row">' +
      '<button type="button" id="risque-replay-scope-root" class="risque-replay-file-pick-btn" title="Load tapes from the connected save root">' +
      "Save root" +
      "</button>" +
      '<button type="button" id="risque-replay-scope-archive" class="risque-replay-file-pick-btn" title="Load from archive subfolder (save\\archive)">' +
      "Archive" +
      "</button>" +
      "</div>" +
      '<p id="risque-replay-launcher-path-hint" class="risque-replay-launcher-hint" aria-live="polite"></p>' +
      '<div class="risque-replay-file-row risque-replay-file-row--manual">' +
      '<button type="button" id="risque-replay-file-pick" class="risque-replay-file-pick-btn">' +
      "Choose replay files" +
      "</button>" +
      '<input type="file" id="risque-replay-file" class="risque-replay-file-input-native" accept=".json,application/json" multiple tabindex="-1" aria-label="Choose one or more RQRP replay JSON files" />' +
      "</div>" +
      '<div class="risque-replay-rounds-section" id="risque-replay-rounds-section">' +
      '<div id="risque-replay-tape-count" class="risque-replay-tape-count-line" aria-live="polite"></div>' +
      '<div id="risque-replay-file-list" class="risque-replay-round-chips" role="group" aria-label="Replay segments"></div>' +
      "</div>" +
      "</div>" +
      '<p id="risque-replay-status" class="risque-replay-status-line"></p>' +
      '<div class="risque-replay-transport-deck">' +
      '<div class="risque-replay-transport-row">' +
      '<button type="button" id="risque-replay-transport-play" class="risque-replay-transport-btn" disabled>PLAY</button>' +
      '<button type="button" id="risque-replay-transport-pause" class="risque-replay-transport-btn" disabled>PAUSE</button>' +
      '<button type="button" id="risque-replay-transport-stop" class="risque-replay-transport-btn" disabled>STOP</button>' +
      "</div>" +
      "</div>" +
      '<div class="risque-replay-tape-row risque-replay-tape-row--speed">' +
      '<label class="risque-replay-speed-label" for="risque-replay-speed">Playback speed</label>' +
      '<input type="range" id="risque-replay-speed" class="risque-replay-speed-slider" min="25" max="200" value="100" />' +
      "</div>" +
      '<p id="risque-replay-ended" class="risque-replay-ended-line" aria-live="polite"></p>' +
      '<div class="risque-replay-exit-row">' +
      '<button type="button" id="risque-replay-exit-overlay" class="risque-replay-exit-btn" title="Close Wayback and return to the game">' +
      "Exit replay" +
      "</button>" +
      "</div>"
    );
  }

  /** Full #runtime-hud-root subtree as in replay-machine.html (map sibling overlay). */
  function risqueReplayMachineFullHudHtml() {
    return (
      '<div id="runtime-hud-root" class="runtime-hud-root runtime-hud-root--replay-machine" aria-label="Wayback Machine controls">' +
      '<div id="hud-main-panel" class="attack-control-panel unified-attack-panel">' +
      '<div id="risque-main-panel-body" class="risque-main-panel-body risque-replay-machine-fill">' +
      risqueReplayMachinePanelBodyInnerHtml() +
      "</div></div></div>"
    );
  }

  function risqueReplayUpdateLauncherPathHint() {
    var el = document.getElementById("risque-replay-launcher-path-hint");
    if (!el) return;
    el.textContent =
      "Launcher default save folder is usually C:\\risque\\save — Connect once so mid-game saves match disk.";
    if (typeof window.risqueFetchLauncherPathsJson !== "function") return;
    window
      .risqueFetchLauncherPathsJson()
      .then(function (j) {
        if (!el.isConnected) return;
        if (j && j.saveRoot) {
          try {
            window.risqueLauncherSaveRootPath = String(j.saveRoot);
          } catch (eLs) {
            /* ignore */
          }
          el.textContent =
            "Launcher saveRoot: " +
            String(j.saveRoot) +
            " — pick this folder (or a parent) when you Connect.";
        }
      })
      .catch(function () {});
  }

  function risqueReplayScopeLoadRoot() {
    var dh = window.__risqueReplayConnectedSaveRootHandle;
    if (!dh || typeof dh.entries !== "function") {
      setStatus("Connect save folder first.");
      return;
    }
    risqueReplayLoadFromDirectoryHandle(dh, {}).catch(function () {});
  }

  function risqueReplayScopeLoadArchive() {
    var dh = window.__risqueReplayConnectedSaveRootHandle;
    if (!dh || typeof dh.getDirectoryHandle !== "function") {
      setStatus("Connect save folder first.");
      return;
    }
    dh.getDirectoryHandle("archive", { create: false })
      .then(function (arch) {
        return risqueReplayLoadFromDirectoryHandle(arch, {});
      })
      .then(function () {
        setStatus("Loaded tapes from archive/");
      })
      .catch(function () {
        setStatus("No archive folder — create save\\archive or use Save root.");
      });
  }

  function replayPackLooksRichForBootstrap(pk) {
    if (!pk || !pk.tape || !Array.isArray(pk.tape.events) || !pk.tape.events.length) return false;
    var evs = pk.tape.events;
    var hi;
    for (hi = 0; hi < evs.length; hi++) {
      var e = evs[hi];
      if (e && e.type === "board" && e.segment === "deal") return true;
    }
    return evs.length > 120;
  }

  function applyLsBootstrapPackOrFalse() {
    var bsRaw = null;
    try {
      if (window.__risqueWaybackBootstrapPackMemory) {
        bsRaw = String(window.__risqueWaybackBootstrapPackMemory);
        try {
          delete window.__risqueWaybackBootstrapPackMemory;
        } catch (eDelMem) {
          window.__risqueWaybackBootstrapPackMemory = null;
        }
      }
    } catch (eMemRead) {
      /* ignore */
    }
    try {
      if (!bsRaw) bsRaw = localStorage.getItem("risqueWaybackBootstrapPack");
    } catch (eLs0) {
      /* ignore */
    }
    if (!bsRaw && window.opener) {
      try {
        bsRaw = window.opener.localStorage.getItem("risqueWaybackBootstrapPack");
      } catch (eOp) {
        /* ignore */
      }
    }
    if (!bsRaw) return false;
    try {
      localStorage.removeItem("risqueWaybackBootstrapPack");
    } catch (eRm0) {
      /* ignore */
    }
    var bsParsed;
    try {
      bsParsed = JSON.parse(bsRaw);
    } catch (eParseBs) {
      return false;
    }
    var bsPack = normalizeImportedReplay(bsParsed);
    if (
      !bsPack &&
      bsParsed &&
      bsParsed.format === "risque-replay-v1" &&
      bsParsed.tape &&
      tapeVersionOk(bsParsed.tape.v)
    ) {
      bsPack = bsParsed;
    }
    if (!bsPack) return false;
    enrichPlayerColorsFromTape(bsPack);
    updateReplayTapeCountLine(null);
    prepareLoadedPack(bsPack, [bsPack]);
    return true;
  }

  function risqueReplayMachineBootstrapTapeFromGame(openedFromGameAuto) {
    var waybackBootstrappedFromGame = false;
    function tryApplyLsBootstrap() {
      if (!applyLsBootstrapPackOrFalse()) return false;
      waybackBootstrappedFromGame = true;
      return true;
    }
    if (openedFromGameAuto) {
      try {
        /* Postgame auto-open must preserve the live in-memory tape.
         * Auto refresh can overwrite it with sparse folder tapes (e.g., DD.json only). */
        tryApplyLsBootstrap();
      } catch (eBsFirst) {
        try {
          localStorage.removeItem("risqueWaybackBootstrapPack");
        } catch (eRmFirst) {
          /* ignore */
        }
        setStatus(
          "Replay from game failed to parse — Connect saved folder or choose replay files."
        );
      }

      if (!waybackBootstrappedFromGame) {
        var folderChain =
          typeof window.risqueSaveFolderIdbGet === "function"
            ? window.risqueSaveFolderIdbGet().then(function (h) {
                if (!h) return null;
                try {
                  window.__risqueReplayConnectedSaveRootHandle = h;
                } catch (eCr) {
                  /* ignore */
                }
                var rf = window.risqueSaveFolderEnsureReadable;
                var wf = window.risqueSaveFolderEnsureWritable;
                var readP =
                  typeof rf === "function"
                    ? rf(h).then(function (rh) {
                        return rh || h;
                      })
                    : Promise.resolve(h);
                var writeP =
                  typeof wf === "function"
                    ? wf(h).then(function (wh) {
                        return wh || h;
                      })
                    : Promise.resolve(h);
                return Promise.all([readP, writeP]).then(function (pair) {
                  var dhRead = pair[0];
                  var wh = pair[1];
                  if (typeof window.risqueHostSaveFolderAdoptDirectoryHandle === "function") {
                    window.risqueHostSaveFolderAdoptDirectoryHandle(wh);
                  }
                  return dhRead;
                });
              })
            : Promise.resolve(null);

        folderChain
          .then(function (dh) {
            if (!dh || typeof dh.entries !== "function") return Promise.resolve(false);
            return risqueReplayLoadFromDirectoryHandle(dh, { skipStatus: true }).then(function () {
              return !!window.__risqueReplayLoadedPack;
            });
          })
          .then(function (folderOk) {
            var pk = window.__risqueReplayLoadedPack;
            var foldRich = replayPackLooksRichForBootstrap(pk);
            if (folderOk && foldRich) {
              waybackBootstrappedFromGame = true;
              return;
            }
            try {
              tryApplyLsBootstrap();
            } catch (eBs) {
              try {
                localStorage.removeItem("risqueWaybackBootstrapPack");
              } catch (eRm) {
                /* ignore */
              }
              setStatus(
                "Replay from game failed to parse — Connect saved folder or choose replay files."
              );
            }
          })
          .catch(function () {
            try {
              tryApplyLsBootstrap();
            } catch (eBs2) {
              try {
                localStorage.removeItem("risqueWaybackBootstrapPack");
              } catch (eRm2) {
                /* ignore */
              }
            }
          })
          .then(function () {
            if (!waybackBootstrappedFromGame) {
              risqueReplayBootStoredFolderFromIdb();
              risqueReplayScheduleLaunchFolderRefresh();
            }
          });
      }
    } else {
      risqueReplayBootStoredFolderFromIdb();
      risqueReplayScheduleLaunchFolderRefresh();
    }
  }

  function risqueReplayMachineUnmountInline() {
    if (!window.__risqueInlineWaybackActive) return;
    window.__risqueReplayAutoStartTok = (window.__risqueReplayAutoStartTok || 0) + 1;
    stopPlayback({ skipStatusMsg: true, silentTransport: true });
    delete window.__risqueReplayLoadedPack;
    window.__risqueReplayEnded = false;
    setReplayEndedLine(false);
    removeReplaySplash();
    removeReplayRoundHud();
    removeReplayStartOverlay();
    var barEarly = document.getElementById("risque-replay-bar");
    if (barEarly && barEarly.parentNode) barEarly.parentNode.removeChild(barEarly);
    var waybackRoot = document.getElementById("runtime-hud-root");
    var stage = document.querySelector(".runtime-stage-host");
    var overlay = document.getElementById("ui-overlay");
    var restoreRoot = window.__risqueReplayInlineDetachedHudRoot;
    if (waybackRoot && waybackRoot.parentNode) {
      waybackRoot.parentNode.removeChild(waybackRoot);
    }
    if (restoreRoot && overlay) {
      overlay.appendChild(restoreRoot);
    }
    delete window.__risqueReplayInlineDetachedHudRoot;
    document.body.classList.remove("replay-machine-page");
    if (stage) {
      stage.classList.remove("replay-stage-host");
    }
    risqueReplayUnwireHudResize();
    var hudEl = document.getElementById("runtime-hud-root");
    if (hudEl) {
      hudEl.style.left = "";
    }
    var bk = window.__risqueReplayInlineBackupGameState;
    delete window.__risqueReplayInlineBackupGameState;
    if (bk && typeof bk === "object") {
      window.gameState = bk;
      try {
        localStorage.setItem("gameState", JSON.stringify(bk));
      } catch (eLs) {
        /* ignore */
      }
    }
    if (typeof window.gameUtils !== "undefined" && window.gameUtils && window.gameState) {
      try {
        window.gameUtils.resizeCanvas();
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
      } catch (eR) {
        /* ignore */
      }
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      try {
        window.risqueMirrorPushGameState();
      } catch (eM) {
        /* ignore */
      }
    }
    if (
      typeof window.risqueRuntimeHud !== "undefined" &&
      window.risqueRuntimeHud &&
      typeof window.risqueRuntimeHud.syncPosition === "function"
    ) {
      try {
        window.risqueRuntimeHud.syncPosition();
      } catch (eS) {
        /* ignore */
      }
    }
    window.__risqueInlineWaybackActive = false;
    window.__risqueReplayAutoplayScheduled = false;
    window.__risqueReplayInlineAutoplayPending = false;
    if (typeof window.risqueReplayDisableGranularDiskWrites === "function") {
      try {
        window.risqueReplayDisableGranularDiskWrites("wayback-exit", window.gameState);
      } catch (eGranOff) {
        /* ignore */
      }
    }
  }

  window.risqueReplayMachineUnmountInline = risqueReplayMachineUnmountInline;

  window.risqueReplayMachineMountInline = function (opts) {
    opts = opts || {};
    if (window.__risqueInlineWaybackActive) return;
    if (!window.gameUtils) return;
    var stage = document.querySelector(".runtime-stage-host");
    var overlay = document.getElementById("ui-overlay");
    var oldRoot = document.getElementById("runtime-hud-root");
    if (!stage || !overlay || !oldRoot) return;

    window.__risqueInlineWaybackActive = true;
    window.__risqueReplayAutoplayScheduled = false;
    window.__risqueReplayInlineAutoplayPending = !!opts.replayAutoplay;
    try {
      window.__risqueReplayInlineBackupGameState = window.gameState
        ? JSON.parse(JSON.stringify(window.gameState))
        : null;
    } catch (eBk) {
      window.__risqueReplayInlineBackupGameState = null;
    }

    window.__risqueReplayInlineDetachedHudRoot = oldRoot;
    oldRoot.remove();

    var wrap = document.createElement("div");
    wrap.innerHTML = risqueReplayMachineFullHudHtml();
    var newRoot = wrap.firstElementChild;
    if (!newRoot) {
      overlay.appendChild(oldRoot);
      delete window.__risqueReplayInlineDetachedHudRoot;
      window.__risqueInlineWaybackActive = false;
      return;
    }
    stage.appendChild(newRoot);

    document.body.classList.add("replay-machine-page");
    stage.classList.add("replay-stage-host");

    risqueReplayUpdateLauncherPathHint();
    risqueReplayMachineEnsureHandlersWired();
    risqueReplayWireHudResizeOnce();
    clearReplayChipHighlight();
    updateReplayTapeCountLine(null);
    updateRoundsLoadedUi(null, null);
    risqueReplayMachineBootstrapTapeFromGame(true);
  };

  function risqueReplayMachineEnsureHandlersWired() {
    wireReplayTransportControls();
    var exitReplayBtn = document.getElementById("risque-replay-exit-overlay");
    if (exitReplayBtn) {
      exitReplayBtn.onclick = function () {
        if (window.__risqueInlineWaybackActive) {
          risqueReplayMachineUnmountInline();
          return;
        }
        try {
          window.close();
        } catch (e) {}
        window.setTimeout(function () {
          try {
            if (window.closed) return;
            setStatus("Close this replay window manually if Exit did nothing (browser security).");
          } catch (e2) {}
        }, 200);
      };
    }
    var pickBtn = document.getElementById("risque-replay-file-pick");
    var roundsSec = document.getElementById("risque-replay-rounds-section");
    if (pickBtn) {
      pickBtn.onclick = function () {
        var el = document.getElementById("risque-replay-file");
        if (el) el.click();
      };
    }
    if (roundsSec) {
      roundsSec.onclick = function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var chip = t.closest(".risque-replay-round-chip");
        if (!chip || !roundsSec.contains(chip)) return;
        var si = chip.getAttribute("data-seek-index");
        if (si != null && String(si).length) {
          var ix = parseInt(si, 10);
          if (isFinite(ix) && ix >= 0) {
            e.preventDefault();
            seekPlaybackToIndex(ix);
            return;
          }
        }
        var r = parseInt(chip.getAttribute("data-round"), 10);
        if (!isFinite(r) || r < 1) return;
        e.preventDefault();
        seekPlaybackToRound(r);
      };
    }
    window.risqueReplayPickFile = function () {
      var el = document.getElementById("risque-replay-file");
      if (el) el.click();
    };
    if (!window.__risqueReplayDocKeysWired) {
      window.__risqueReplayDocKeysWired = true;
      document.addEventListener("keydown", function (e) {
        if (e.altKey && String(e.key).toLowerCase() === "o") {
          e.preventDefault();
          window.risqueReplayPickFile();
        }
      });
      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        if (!window.__risqueReplayLoadedPack) return;
        e.preventDefault();
        replayStopToCleanStandby();
      });
    }
    if (window.RISQUE_REPLAY_MACHINE) {
      risqueReplayWireHudResizeOnce();
    }
    var inp = document.getElementById("risque-replay-file");
    if (inp) {
      inp.onchange = function () {
        var filesSnap =
          inp.files && inp.files.length ? Array.prototype.slice.call(inp.files, 0) : [];
        inp.value = "";
        if (filesSnap.length) {
          onFilesSelected(filesSnap);
        }
      };
    }

    var folderBtn = document.getElementById("risque-replay-folder-connect");
    var refreshBtn = document.getElementById("risque-replay-folder-refresh");
    if (folderBtn && typeof window.showDirectoryPicker === "function") {
      folderBtn.onclick = function () {
        window
          .showDirectoryPicker({ id: "risque-save-root", mode: "readwrite" })
          .then(function (dir) {
            try {
              window.__risqueReplayConnectedSaveRootHandle = dir;
            } catch (eD) {
              /* ignore */
            }
            if (typeof window.risqueHostSaveFolderAdoptDirectoryHandle === "function") {
              window.risqueHostSaveFolderAdoptDirectoryHandle(dir);
            }
            var put =
              typeof window.risqueSaveFolderIdbPut === "function"
                ? window.risqueSaveFolderIdbPut(dir)
                : Promise.resolve();
            return put.then(function () {
              return risqueReplayLoadFromDirectoryHandle(dir);
            });
          })
          .catch(function (e) {
            if (e && e.name !== "AbortError") {
              setStatus("Folder: " + (e && e.message ? e.message : String(e)));
            }
          });
      };
    } else if (folderBtn) {
      folderBtn.disabled = true;
      folderBtn.title = "Folder picker needs Chromium (Chrome/Edge) on https or localhost.";
    }

    if (refreshBtn && typeof window.risqueSaveFolderIdbGet === "function") {
      refreshBtn.onclick = function () {
        risqueReplayRefreshFromStoredFolder();
      };
    } else if (refreshBtn) {
      refreshBtn.disabled = true;
    }

    var scopeRoot = document.getElementById("risque-replay-scope-root");
    var scopeArch = document.getElementById("risque-replay-scope-archive");
    if (scopeRoot) {
      scopeRoot.onclick = function () {
        risqueReplayScopeLoadRoot();
      };
    }
    if (scopeArch) {
      scopeArch.onclick = function () {
        risqueReplayScopeLoadArchive();
      };
    }
  }

  function risqueReplayApplyExternalMonitorWindow() {
    try {
      var q = new URLSearchParams(window.location.search);
      if (q.get("extWin") !== "1") return;
      var l = parseInt(q.get("extLeft"), 10);
      var t = parseInt(q.get("extTop"), 10);
      var w = parseInt(q.get("extW"), 10);
      var h = parseInt(q.get("extH"), 10);
      if (!isFinite(l) || !isFinite(t) || !isFinite(w) || !isFinite(h)) return;
      if (w < 320 || h < 240) return;
      function apply() {
        try {
          window.moveTo(l, t);
          window.resizeTo(w, h);
        } catch (e) {}
      }
      apply();
      window.setTimeout(apply, 50);
      window.setTimeout(apply, 250);
    } catch (e0) {}
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!window.RISQUE_REPLAY_MACHINE) return;
    risqueReplayApplyExternalMonitorWindow();
    risqueReplayMachineEnsureHandlersWired();
    risqueReplayUpdateLauncherPathHint();
    clearReplayChipHighlight();
    updateReplayTapeCountLine(null);
    updateRoundsLoadedUi(null, null);

    var openedFromGameAuto = false;
    try {
      openedFromGameAuto = new URLSearchParams(window.location.search).get("auto") === "1";
    } catch (eAu) {
      openedFromGameAuto = false;
    }

    risqueReplayMachineBootstrapTapeFromGame(openedFromGameAuto);
    try {
      var launcherDisk =
        (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()) ||
        (typeof window.risqueLocalDiskIsConfigured === "function" && window.risqueLocalDiskIsConfigured());
      if (launcherDisk) {
        setStatus("Launcher disk path active (C:\\risque\\save). Manual folder connect is optional.");
      }
    } catch (eLdHint) {
      /* ignore */
    }
    scheduleReplayAutoplayIfDesired();
  });
})();
