/**
 * Standalone battle tape playback (risque-replay-v1 JSON). Uses core.js map rendering only.
 */
(function () {
  "use strict";

  /** Matches launcher default (scripts/RISQUE.ps1); browsers cannot open this path without a folder pick. */
  var RISQUE_DEFAULT_WINDOWS_SAVE_FOLDER = "C:\\risque\\save";

  var TAPE_VERSION = 2;
  var MS_DEPLOY = 90;
  var MS_BATTLE = 140;
  /** Granular attack-only tapes (and glued Wayback merges): readable battle pacing vs full-session tape. */
  var MS_BATTLE_GRANULAR_GLUE = 290;
  /** Extra beat when glued segments jump to the next player's battle frames. */
  var MS_GRANULAR_PLAYER_GAP = 480;
  /** Hold after elimination splash so flash + message are readable (scaled by playback speed). */
  var MS_ELIMINATION = 1300;
  var MS_INIT = 80;
  var MS_DEAL = 95;
  var MS_REPLAY_START_HOLD = 450;
  /** After a successful load, start playback automatically (pause with PAUSE or STOP). */
  var AUTO_START_PLAYBACK_AFTER_LOAD = false;
  var AUTO_START_DELAY_MS = 320;

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

  function applyBoard(gs, board) {
    if (!gs || !gs.players || !board) return;
    var replay = !!gs.risqueReplayPlaybackActive;
    if (replay) {
      var need = {};
      Object.keys(board).forEach(function (label) {
        var cell = board[label];
        if (cell && cell.owner) need[String(cell.owner)] = true;
      });
      Object.keys(need).forEach(function (nm) {
        var hit = gs.players.some(function (x) {
          return x && String(x.name) === nm;
        });
        if (!hit) {
          gs.players.push({
            name: nm,
            territories: [],
            cards: [],
            cardCount: 0,
            color: replayGhostColorForOwner(gs, nm),
            risqueReplayGhostPlayer: true
          });
        }
      });
    }
    gs.players.forEach(function (p) {
      p.territories = [];
    });
    Object.keys(board).forEach(function (label) {
      var cell = board[label];
      if (!cell || !cell.owner) return;
      var own = String(cell.owner);
      var pl = gs.players.find(function (x) {
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
      if (String(a.owner) !== String(b.owner) || (Number(a.troops) || 0) !== (Number(b.troops) || 0)) {
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

  function segmentUiLabelFromFilename(name) {
    var s = String(name || "").trim();
    if (!s) return "?";
    var base = s.replace(/\.json$/i, "");
    if (/^dd$/i.test(base)) return "DD";
    return base;
  }

  /**
   * One chip per loaded segment file (DD + rNpM), up to {@link MAX_SEGMENT_CHIPS}, for long matches.
   */
  function buildSegmentSeekHints(playbackEvents, sourcePacks) {
    if (!playbackEvents || !playbackEvents.length || !sourcePacks || sourcePacks.length < 2) {
      return null;
    }
    var sorted = sourcePacks.slice().sort(function (a, b) {
      return packSavedAtMs(a) - packSavedAtMs(b);
    });
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
    return hints.length > 1 ? hints : null;
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
    if (collapsed.length && collapsed[0].index === 0 && collapsed[0].round > 1) {
      collapsed.unshift({ index: 0, round: 1 });
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

    var anchors = collectStampAnchorsForSeek(pe);
    var ai;
    for (ai = 0; ai < anchors.length - 1; ai++) {
      var L = anchors[ai];
      var R = anchors[ai + 1];
      if (L.round < t && t < R.round) {
        var spanR = R.round - L.round;
        if (spanR <= 0) continue;
        if (L.index === R.index) {
          var spread = Math.max(0, pe.length - 1);
          return Math.max(0, Math.min(pe.length - 1, Math.floor((spread * (t - L.round)) / spanR)));
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

  function setWatchRoundIdle() {
    var el = document.getElementById("risque-replay-watch-round");
    if (!el) return;
    el.textContent = "—";
  }

  function setWatchRoundDisplay(n, labelOverride) {
    var el = document.getElementById("risque-replay-watch-round");
    if (!el) return;
    if (labelOverride != null && String(labelOverride).length) {
      el.textContent = String(labelOverride);
      return;
    }
    if (n == null || !isFinite(Number(n)) || Number(n) < 1) {
      el.textContent = "—";
    } else {
      el.textContent = String(Math.floor(Number(n)));
    }
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
        btn2.setAttribute("aria-label", "Round " + String(rnf) + ", saved " + formatReplaySavedAtChip(packSavedAtMs(p)));
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
    setWatchRoundIdle();
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
      return;
    }
    if (gs.risqueReplayMachineHudPhase === "deal") {
      setWatchRoundDisplay(null, "Dealing");
      return;
    }
    var raw = gs.risqueReplayHudRound;
    var n = typeof raw === "number" ? raw : parseInt(raw, 10);
    if (!isFinite(n) || n < 1) {
      var r2 = gs.round;
      n = typeof r2 === "number" ? r2 : parseInt(r2, 10);
    }
    if (!isFinite(n) || n < 1) n = 1;
    setWatchRoundDisplay(n);
  }

  function removeReplaySplash() {
    var el = document.getElementById("risque-replay-splash");
    if (el && el.parentNode) el.parentNode.removeChild(el);
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
    setWatchRoundIdle();
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
        replayApplyOnePlayback(gs, playbackEvents[j], ctxBulk);
        lastStampedRound = ctxBulk.lastStampedRound;
        lastReplayBoardSnapshot = ctxBulk.lastReplayBoardSnapshot;
      }
      idx = nextIdx;
      gs.phaseReplayIndex = idx;
      delete gs.risqueReplayBattleFlashLabels;
      removeReplaySplash();
      window.gameUtils.renderTerritories(null, gs);
      window.gameUtils.renderStats(gs);
      syncRoundHud(gs);
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
      replayApplyOnePlayback(gs, ev, ctxStep);
      lastStampedRound = ctxStep.lastStampedRound;
      lastReplayBoardSnapshot = ctxStep.lastReplayBoardSnapshot;

      syncRoundHud(gs);

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

  function prepareLoadedPack(pack, sourcePacks, statusLineAfterOk) {
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
      setStatus(statusLineAfterOk != null ? String(statusLineAfterOk) : "");
      setTransportStandbyLoaded();
      updateTransportPlayPauseUi(null);
      updateRoundsLoadedUi(sourcePacks || [pack], pack);
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
        return;
      }
      var toPlay = packs.length === 1 ? packs[0] : mergeReplayPacks(packs);
      if (!toPlay) {
        setStatus(
          "Could not merge replay files — ensure js/replay-tape.js is loaded before replay-machine.js."
        );
        return;
      }
      if (!toPlay.tape || !Array.isArray(toPlay.tape.events) || !toPlay.tape.events.length) {
        setStatus("No events to play — empty or invalid tape after merge.");
        return;
      }
      enrichPlayerColorsFromTape(toPlay);
      var msgParts = [];
      if (toPlay.__mergeWarnings && toPlay.__mergeWarnings.length) {
        msgParts.push(toPlay.__mergeWarnings.join(" "));
      }
      if (skipped.length) {
        msgParts.push("Skipped " + skipped.length + ": " + skipped.join("; ") + ".");
      }
      window.__risqueReplayAutoStartTok = (window.__risqueReplayAutoStartTok || 0) + 1;
      var autoTok = window.__risqueReplayAutoStartTok;
      prepareLoadedPack(toPlay, packs, msgParts.length ? msgParts.join(" ") : "");
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
    if (!window.RISQUE_REPLAY_MACHINE) return;
    var stage = document.querySelector(".replay-stage-host");
    var canvas = document.getElementById("canvas");
    var hud = document.getElementById("runtime-hud-root");
    if (!stage || !canvas || !hud || !hud.classList.contains("runtime-hud-root--replay-machine")) return;
    var cr = canvas.getBoundingClientRect();
    if (cr.width < 4) return;
    var scale = cr.width / 1920;
    /* Viewport X of map anchor (panel uses translateX(-50%) so this is the column center). */
    var centerViewportX = cr.left + 1500 * scale;
    hud.style.left = centerViewportX + "px";
    /* Width comes only from replay-machine.html + game.css (never inline — avoids fighting 800px cap). */
  }

  window.risqueReplayPositionHud = risqueReplayPositionHud;

  function risqueReplayWaybackFolderHintSuffix(expectedPath) {
    var pathLine = expectedPath && String(expectedPath).trim() ? String(expectedPath).trim() : "";
    var win = false;
    try {
      win =
        /Win/i.test(navigator.platform || "") || /Windows/i.test(navigator.userAgent || "");
    } catch (ePl) {
      win = false;
    }
    if (!win) {
      return (
        " Connect saved folder once (same directory the host uses for JSON)." +
        (pathLine ? " Launcher path hint: " + pathLine + "." : "")
      );
    }
    if (!pathLine) pathLine = RISQUE_DEFAULT_WINDOWS_SAVE_FOLDER;
    return (
      " Pick your save folder once with Connect saved folder — default " +
      pathLine +
      " (same folder round autosave uses)."
    );
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
            if (/^risque-ckpt-/i.test(String(name)) || /^game-ckpt-/i.test(String(name)) || /^replay-ckpt-/i.test(String(name))) continue;
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
    if (!meta.length) {
      setStatus(
        "No replay tapes in this folder — flat saves use DD.json, rNpM.json, replay*.json at the save root (see REPLAY/ only for old layouts)."
      );
      return;
    }
    var files = meta.map(function (x) {
      return x.file;
    });
    onFilesSelected(files);
    if (!opts.skipStatus) {
      setStatus("Loaded " + files.length + " replay file(s) from folder.");
    }
  }

  async function risqueReplayVerifyAndLoadFromStoredHandle(dirHandle) {
    if (!dirHandle) return false;
    var readableFn = window.risqueSaveFolderEnsureReadable;
    if (typeof readableFn !== "function") return false;
    try {
      var h = await readableFn(dirHandle);
      if (!h) return false;
      await risqueReplayLoadFromDirectoryHandle(h, { skipStatus: true });
      setStatus("Replay folder ready — tapes loaded automatically.");
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Browsers deny requestPermission() without a user gesture. If the game already stored the
   * folder handle in IDB, one tap anywhere retries permission so replay loads without opening
   * the directory picker again.
   */
  function risqueReplayWireOneShotGestureForStoredFolder(hintEl) {
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
        .then(function (ok) {
          window.__risqueReplayFolderNeedsGesture = false;
          if (ok && hintEl) {
            hintEl.textContent =
              "Replay folder connected — rounds below. Use Refresh if you add new tapes.";
          } else if (!ok && hintEl) {
            hintEl.textContent =
              "Permission still blocked — use “Connect saved folder” once, same folder as the game.";
          }
        })
        .catch(function () {});
    }
    document.addEventListener("pointerdown", onFirst, true);
    document.addEventListener("keydown", onFirst, true);
  }

  function risqueReplayBootStoredFolderFromIdb(hintEl) {
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
          if (hintEl) {
            hintEl.textContent =
              "Click or tap anywhere on this page to read your saved replay folder (no folder picker).";
          }
          risqueReplayWireOneShotGestureForStoredFolder(hintEl);
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
    risqueReplayApplyExternalMonitorWindow();
    wireReplayTransportControls();
    var exitReplayBtn = document.getElementById("risque-replay-exit-overlay");
    if (exitReplayBtn) {
      exitReplayBtn.addEventListener("click", function () {
        try {
          window.close();
        } catch (e) {}
        window.setTimeout(function () {
          try {
            if (window.closed) return;
            setStatus("Close this replay window manually if Exit did nothing (browser security).");
          } catch (e2) {}
        }, 200);
      });
    }
    var pickBtn = document.getElementById("risque-replay-file-pick");
    var roundsSec = document.getElementById("risque-replay-rounds-section");
    if (pickBtn) {
      pickBtn.addEventListener("click", function () {
        var el = document.getElementById("risque-replay-file");
        if (el) el.click();
      });
    }
    if (roundsSec) {
      roundsSec.addEventListener("click", function (e) {
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
      });
    }
    window.risqueReplayPickFile = function () {
      var el = document.getElementById("risque-replay-file");
      if (el) el.click();
    };
    document.addEventListener("keydown", function (e) {
      if (e.altKey && String(e.key).toLowerCase() === "o") {
        e.preventDefault();
        window.risqueReplayPickFile();
      }
    });
    risqueReplayPositionHud();
    window.addEventListener("resize", risqueReplayPositionHud);
    requestAnimationFrame(function () {
      risqueReplayPositionHud();
      requestAnimationFrame(risqueReplayPositionHud);
    });
    var inp = document.getElementById("risque-replay-file");
    if (inp) {
      inp.addEventListener("change", function () {
        // inp.files is live — clearing value empties it. Snapshot before reset.
        var filesSnap =
          inp.files && inp.files.length ? Array.prototype.slice.call(inp.files, 0) : [];
        inp.value = "";
        if (filesSnap.length) {
          onFilesSelected(filesSnap);
        }
      });
    }
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!window.__risqueReplayLoadedPack) return;
      e.preventDefault();
      replayStopToCleanStandby();
    });
    setWatchRoundIdle();
    updateRoundsLoadedUi(null, null);

    var hintEl = document.getElementById("risque-replay-folder-hint");
    var openedFromGameAuto = false;
    try {
      openedFromGameAuto = new URLSearchParams(window.location.search).get("auto") === "1";
    } catch (eAu) {
      openedFromGameAuto = false;
    }
    var pathsPromise =
      typeof window.risqueFetchLauncherPathsJson === "function"
        ? window.risqueFetchLauncherPathsJson()
        : fetch("risque-launcher-paths.json", { cache: "no-store" }).then(function (r) {
            return r.ok ? r.json() : null;
          });
    pathsPromise
      .then(function (j) {
        if (openedFromGameAuto) return;
        if (!hintEl) return;
        if (window.__risqueReplayFolderNeedsGesture) return;
        var expected =
          j && (j.saveRoot || j.saveDir || j.replayDir)
            ? String(j.saveRoot || j.saveDir || j.replayDir).trim()
            : "";
        var suffix = risqueReplayWaybackFolderHintSuffix(expected);
        if (j && j.replayDir && j.saveRoot && String(j.replayDir).replace(/[/\\]+$/, "") === String(j.saveRoot).replace(/[/\\]+$/, "")) {
          hintEl.textContent = "Replays save under: " + j.saveRoot + "." + suffix;
          return;
        }
        if (j && j.replayDir && (!j.saveRoot || String(j.replayDir) !== String(j.saveRoot))) {
          hintEl.textContent = "Launcher replay folder: " + j.replayDir + "." + suffix;
          return;
        }
        if (j && (j.saveRoot || j.saveDir)) {
          var sr = j.saveRoot || j.saveDir;
          hintEl.textContent = "Launcher save folder: " + sr + "." + suffix;
          return;
        }
        hintEl.textContent =
          "Wayback reads tapes from your flat save folder." +
            suffix +
            " After one pick, the folder is remembered.";
      })
      .catch(function () {
        if (openedFromGameAuto) return;
        if (window.__risqueReplayFolderNeedsGesture) return;
        if (hintEl) {
          hintEl.textContent =
            "Wayback reads tapes from your flat save folder." +
              risqueReplayWaybackFolderHintSuffix("") +
              " Open replay-machine from the repo folder when possible so risque-launcher-paths.json can be loaded.";
        }
      });

    var folderBtn = document.getElementById("risque-replay-folder-connect");
    var refreshBtn = document.getElementById("risque-replay-folder-refresh");
    if (folderBtn && typeof window.showDirectoryPicker === "function") {
      folderBtn.addEventListener("click", function () {
        window
          .showDirectoryPicker({ id: "risque-save-root", mode: "readwrite" })
          .then(function (dir) {
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
      });
    } else if (folderBtn) {
      folderBtn.disabled = true;
      folderBtn.title = "Folder picker needs Chromium (Chrome/Edge) on https or localhost.";
    }

    if (refreshBtn && typeof window.risqueSaveFolderIdbGet === "function") {
      refreshBtn.addEventListener("click", function () {
        window.risqueSaveFolderIdbGet().then(function (h) {
          if (!h) {
            setStatus("No folder saved yet — use Connect saved folder once.");
            return;
          }
          risqueReplayVerifyAndLoadFromStoredHandle(h);
        });
      });
    } else     if (refreshBtn) {
      refreshBtn.disabled = true;
    }

    /* Host stashes the live tape in localStorage right before opening Wayback; that must win over on-disk merge
     * (replay-full.json / folder merge can lag the last battle). Folder load is fallback when LS is empty / quota. */
    var waybackBootstrappedFromGame = false;

    function replayPackLooksRich(pk) {
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
        bsRaw = localStorage.getItem("risqueWaybackBootstrapPack");
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
      prepareLoadedPack(bsPack, [bsPack], "Tape loaded from game — press PLAY.");
      return true;
    }

    if (openedFromGameAuto) {
      try {
        if (applyLsBootstrapPackOrFalse()) {
          waybackBootstrappedFromGame = true;
          if (hintEl) {
            hintEl.textContent =
              "Tape loaded from live game — press PLAY. Refresh reloads files from your save folder.";
          }
        }
      } catch (eBsFirst) {
        try {
          localStorage.removeItem("risqueWaybackBootstrapPack");
        } catch (eRmFirst) {
          /* ignore */
        }
        setStatus(
          "Replay from game failed to parse — open REPLAY again from the host map, or Connect saved folder."
        );
      }

      if (!waybackBootstrappedFromGame) {
        var folderChain =
          typeof window.risqueSaveFolderIdbGet === "function"
            ? window.risqueSaveFolderIdbGet().then(function (h) {
                if (!h) return null;
                var rf = window.risqueSaveFolderEnsureReadable;
                return typeof rf === "function"
                  ? rf(h).then(function (rh) {
                      return rh || h;
                    })
                  : Promise.resolve(h);
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
            var foldRich = replayPackLooksRich(pk);
            if (folderOk && foldRich) {
              waybackBootstrappedFromGame = true;
              if (hintEl) {
                hintEl.textContent =
                  "Tape loaded from your save folder — press PLAY. Refresh reloads after new saves.";
              }
              return;
            }
            try {
              if (applyLsBootstrapPackOrFalse()) {
                waybackBootstrappedFromGame = true;
              }
            } catch (eBs) {
              try {
                localStorage.removeItem("risqueWaybackBootstrapPack");
              } catch (eRm) {
                /* ignore */
              }
              setStatus(
                "Replay from game failed to parse — open REPLAY again from the host map, or Connect saved folder."
              );
            }
            if (openedFromGameAuto && hintEl) {
              hintEl.textContent = waybackBootstrappedFromGame
                ? "Tape ready — PLAY is enabled. Use Refresh to reload from your save folder if needed."
                : "Opened from the game — if nothing loaded, press REPLAY again on the host (same browser). Or Connect saved folder / click once for permission.";
            }
          })
          .catch(function () {
            try {
              if (applyLsBootstrapPackOrFalse()) {
                waybackBootstrappedFromGame = true;
              }
            } catch (eBs2) {
              try {
                localStorage.removeItem("risqueWaybackBootstrapPack");
              } catch (eRm2) {
                /* ignore */
              }
            }
            if (openedFromGameAuto && hintEl) {
              hintEl.textContent = waybackBootstrappedFromGame
                ? "Tape ready — PLAY is enabled. Use Refresh to reload from your save folder if needed."
                : "Opened from the game — if nothing loaded, press REPLAY again on the host (same browser). Or Connect saved folder / click once for permission.";
            }
          })
          .then(function () {
            if (!waybackBootstrappedFromGame) {
              risqueReplayBootStoredFolderFromIdb(hintEl);
            }
          });
      } else if (hintEl && !hintEl.textContent) {
        hintEl.textContent =
          "Tape loaded from live game — press PLAY. Refresh reloads files from your save folder.";
      }
    } else {
      risqueReplayBootStoredFolderFromIdb(hintEl);
    }
  });
})();
