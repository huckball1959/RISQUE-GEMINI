/**
 * Battle stills tier (`battle_stills`, legacy `host_ultra`): lean map slideshow — post-deal, then one still
 * per battle outcome (after capture transfer or after a non-conquest fight). RAM only during play; flushed
 * to REPLAY/rqwb-still-*.json + rqwb-stills-manifest.json. Not written into localStorage.
 */
(function () {
  "use strict";

  var STILL_FORMAT = "risque-replay-still-v1";
  var MANIFEST_FORMAT = "risque-replay-stills-manifest-v1";
  var FILE_PREFIX = "rqwb-still-";
  /** In-RAM cap per round segment; older frames flush to disk at round end. */
  var MAX_SESSION_STILLS = 24;

  function tierBattleStills(gs) {
    if (!gs || typeof gs !== "object" || window.risqueDisplayIsPublic) return false;
    var t = gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
    return t === "battle_stills" || t === "host_ultra";
  }

  /**
   * Stills live outside gameState — refreshVisuals() assigns window.gameState from a localStorage clone
   * that omits risqueCheapReplayStills, which was wiping the replay buffer every phase refresh.
   */
  function getSessionStore(gs) {
    if (!window.__risqueCheapReplaySessionStore) {
      window.__risqueCheapReplaySessionStore = {
        sessionKey: "",
        stills: [],
        frameSeq: 0,
        battleSeq: 0,
        flushedFrameCount: 0
      };
    }
    var st = window.__risqueCheapReplaySessionStore;
    if (gs && typeof gs === "object") {
      ensureTapeKey(gs);
      var sk = gs.risqueReplayTapeSessionKey != null ? String(gs.risqueReplayTapeSessionKey) : "";
      if (sk && st.sessionKey && st.sessionKey !== sk) {
        st.stills = [];
        st.frameSeq = 0;
        st.battleSeq = 0;
      }
      if (sk) st.sessionKey = sk;
    }
    if (!Array.isArray(st.stills)) st.stills = [];
    return st;
  }

  function getStillsRows(gs) {
    return getSessionStore(gs).stills;
  }

  /** Stills must stay off gameState — many phases JSON.stringify(gameState) without replay strip keys. */
  window.risqueCheapReplayDetachFromGameState = function (gs) {
    if (!gs || typeof gs !== "object") return;
    try {
      delete gs.risqueCheapReplayStills;
      delete gs.risqueCheapReplayFrameSeq;
      delete gs.risqueCheapReplayBattleSeq;
    } catch (eD) {
      /* ignore */
    }
  };

  function pruneSessionStillsIfNeeded(st) {
    if (!st || !Array.isArray(st.stills) || st.stills.length <= MAX_SESSION_STILLS) return;
    var dealIdx = -1;
    var i;
    for (i = 0; i < st.stills.length; i++) {
      if (st.stills[i] && st.stills[i].kind === "deal") {
        dealIdx = i;
        break;
      }
    }
    var drop = st.stills.length - MAX_SESSION_STILLS;
    var trimmed = st.stills.slice(drop);
    if (dealIdx >= 0) {
      var dealRow = st.stills[dealIdx];
      var hasDeal = false;
      for (i = 0; i < trimmed.length; i++) {
        if (trimmed[i] && trimmed[i].kind === "deal") {
          hasDeal = true;
          break;
        }
      }
      if (!hasDeal) trimmed.unshift(dealRow);
    }
    st.stills = trimmed;
    try {
      console.warn(
        "[Replay] Battle stills trimmed to " + MAX_SESSION_STILLS + " frames (oldest dropped) to keep the tab responsive."
      );
    } catch (eW) {
      /* ignore */
    }
  }

  function snapshotBoard(gs) {
    if (typeof window.risqueReplaySnapshotBoardForStills === "function") {
      return window.risqueReplaySnapshotBoardForStills(gs);
    }
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

  function mergePlayerColorsFromState(gs) {
    var m = {};
    if (!gs || !Array.isArray(gs.players)) return m;
    gs.players.forEach(function (p) {
      if (!p || !p.name || p.color == null || String(p.color).trim() === "") return;
      m[String(p.name).trim().toLowerCase()] = String(p.color).trim().toLowerCase();
    });
    return m;
  }

  /** Full color map for still + Wayback: replay table, live players, and board owner names. */
  function snapshotPlayerColorsAtCapture(gs, board) {
    var m = {};
    if (!gs) return m;
    if (gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object") {
      Object.keys(gs.risqueReplayPlayerColors).forEach(function (k) {
        var kk = String(k).trim().toLowerCase();
        if (!kk) return;
        var v = gs.risqueReplayPlayerColors[k];
        if (v != null && String(v).trim() !== "") m[kk] = String(v).trim().toLowerCase();
      });
    }
    (gs.players || []).forEach(function (p) {
      if (!p || !p.name || p.color == null || String(p.color).trim() === "") return;
      m[String(p.name).trim().toLowerCase()] = String(p.color).trim().toLowerCase();
    });
    if (board && typeof board === "object") {
      Object.keys(board).forEach(function (tname) {
        var cell = board[tname];
        if (!cell || !cell.owner) return;
        var low = String(cell.owner).trim().toLowerCase();
        if (!low || m[low]) return;
        var pi;
        for (pi = 0; pi < (gs.players || []).length; pi++) {
          var p = gs.players[pi];
          if (!p || !p.name) continue;
          if (String(p.name).trim().toLowerCase() === low && p.color != null && String(p.color).trim() !== "") {
            m[low] = String(p.color).trim().toLowerCase();
            return;
          }
        }
      });
    }
    var stateM = mergePlayerColorsFromState(gs);
    Object.keys(stateM).forEach(function (k) {
      if (!m[k] || String(m[k]).trim() === "") m[k] = stateM[k];
    });
    return m;
  }

  function defaultCaption(kind, gs) {
    var r = Math.max(1, Number(gs && gs.round) || 1);
    var who = gs && gs.currentPlayer != null ? String(gs.currentPlayer).trim() : "";
    if (kind === "deal") return "Round " + r + " — Deal complete";
    if (kind === "battle_outcome") return "Round " + r + " — Battle";
    if (kind === "post_setup_deploy") return "Round " + r + " — Opening deployment complete (all players)";
    if (kind === "turn_deploy") return "Round " + r + " — " + (who || "?") + " — Turn deployment complete";
    if (kind === "attack_phase") return "Round " + r + " — " + (who || "?") + " — Attack phase complete";
    if (kind === "reinforce") return "Round " + r + " — " + (who || "?") + " — Reinforcement complete";
    return "Round " + r + " — " + (who || "?");
  }

  function prettyTerritoryLabel(id) {
    var s = id != null ? String(id).trim() : "";
    if (!s) return "territory";
    return s.replace(/_/g, " ");
  }

  function buildBattleOutcomeCaption(meta, gs) {
    if (meta && meta.caption != null && String(meta.caption).trim() !== "") {
      return String(meta.caption).trim();
    }
    var atk = meta && meta.attackerName != null ? String(meta.attackerName).trim() : "";
    var def = meta && meta.defenderName != null ? String(meta.defenderName).trim() : "";
    if (!atk && gs && gs.currentPlayer != null) atk = String(gs.currentPlayer).trim();
    if (!def && gs && gs.risqueCheapReplayLastDefender != null) {
      def = String(gs.risqueCheapReplayLastDefender).trim();
    }
    var terr = meta && meta.territoryName != null ? String(meta.territoryName).trim() : "";
    if (meta && (meta.playerConquest || meta.eliminated)) {
      if (atk && def) return atk + " conquers " + def;
      return defaultCaption("battle_outcome", gs);
    }
    if (meta && meta.territoryCaptured) {
      if (atk && def) return atk + " conquers " + def;
      if (atk && terr) return atk + " takes " + prettyTerritoryLabel(terr);
      return defaultCaption("battle_outcome", gs);
    }
    if (atk && def && terr) {
      return atk + " attacks " + def + " — " + prettyTerritoryLabel(terr) + " holds";
    }
    if (atk && def) return atk + " attacks " + def;
    return defaultCaption("battle_outcome", gs);
  }

  function lastStillBoardStable(gs) {
    var rows = getStillsRows(gs);
    if (!rows.length) return "";
    var last = rows[rows.length - 1];
    return last && last.board ? boardJsonStableForBudget(last.board) : "";
  }

  function ensureTapeKey(gs) {
    if (!gs || typeof gs !== "object") return;
    if (gs.risqueReplayTapeSessionKey) return;
    if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
      try {
        window.risqueReplayEnsureTapeSessionKey(gs);
      } catch (eK) {
        /* ignore */
      }
    }
    if (!gs.risqueReplayTapeSessionKey) {
      try {
        gs.risqueReplayTapeSessionKey =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : "rsq-" + String(Date.now()) + "-" + String(Math.floor(Math.random() * 1e9));
      } catch (eF) {
        /* ignore */
      }
    }
  }

  function ensureStillsArray(gs) {
    getSessionStore(gs);
    window.risqueCheapReplayDetachFromGameState(gs);
  }

  function bumpFrameSeq(gs) {
    var st = getSessionStore(gs);
    if (typeof st.frameSeq !== "number" || !isFinite(st.frameSeq)) st.frameSeq = 0;
    st.frameSeq += 1;
    return st.frameSeq;
  }

  function pushPhaseStill(gs, internalKind, captionOpt, metaOpt) {
    if (!tierBattleStills(gs)) return;
    ensureTapeKey(gs);
    ensureStillsArray(gs);
    var board = snapshotBoard(gs);
    if (!board || !Object.keys(board).length) return;
    var stable = boardJsonStableForBudget(board);
    if (metaOpt && metaOpt.allowDuplicateBoard !== true && stable && stable === lastStillBoardStable(gs)) {
      return;
    }
    var seq = bumpFrameSeq(gs);
    var round = Math.max(1, Number(gs.round) || 1);
    var colorsSnap = snapshotPlayerColorsAtCapture(gs, board);
    var cap = captionOpt != null && String(captionOpt).trim() !== "" ? String(captionOpt).trim() : defaultCaption(internalKind, gs);
    var slug = String(internalKind || "frame").replace(/[^a-z0-9_\-]/gi, "_");
    var battleSeq = 0;
    var st = getSessionStore(gs);
    if (internalKind === "battle_outcome") {
      if (typeof st.battleSeq !== "number" || !isFinite(st.battleSeq)) st.battleSeq = 0;
      st.battleSeq += 1;
      battleSeq = st.battleSeq;
      slug = "battle" + battleSeq;
    }
    var fileLeaf = FILE_PREFIX + "r" + round + "-f" + seq + "-" + slug + ".json";
    st.stills.push({
      fileName: fileLeaf,
      kind: internalKind,
      round: round,
      actor: gs.currentPlayer != null ? String(gs.currentPlayer).trim() : "",
      board: board,
      playerColorsSnap: colorsSnap,
      caption: cap
    });
    pruneSessionStillsIfNeeded(st);
    window.risqueCheapReplayDetachFromGameState(gs);
  }

  window.risqueCheapReplayClear = function (gs) {
    if (window.__risqueCheapReplaySessionStore) {
      window.__risqueCheapReplaySessionStore.stills = [];
      window.__risqueCheapReplaySessionStore.frameSeq = 0;
      window.__risqueCheapReplaySessionStore.battleSeq = 0;
      window.__risqueCheapReplaySessionStore.sessionKey = "";
    }
    if (!gs || typeof gs !== "object") return;
    try {
      delete gs.risqueCheapReplayStills;
      delete gs.risqueCheapReplayFrameSeq;
      delete gs.risqueCheapReplayBattleSeq;
    } catch (eC) {
      /* ignore */
    }
  };

  window.risqueCheapReplayCapturePostDeal = function (gs) {
    if (!tierBattleStills(gs)) return;
    pushPhaseStill(gs, "deal", null);
  };

  window.risqueCheapReplayCapturePostSetupDeploy = function (gs) {
    /* Lean tier 5: replay starts post-deal only. */
    return;
  };

  /** After income deploy: current player placed all reinforcements from bank → attack. */
  window.risqueCheapReplayCaptureTurnDeployDone = function (gs) {
    return;
  };

  /** When the active player leaves the attack phase (→ reinforce). */
  window.risqueCheapReplayCaptureAttackPhaseDone = function (gs) {
    return;
  };

  /** After reinforcement step → receive-card. */
  window.risqueCheapReplayCaptureReinforceDone = function (gs) {
    return;
  };

  /**
   * Post-battle map still (tier 5). Call after troop transfer on captures, or after a non-conquest roll.
   * @param {object} gs gameState
   * @param {object|null} meta { attackerName, defenderName, territoryName, territoryCaptured, playerConquest, eliminated, caption, skipIfPendingTransfer }
   */
  window.risqueCheapReplayCaptureBattleOutcome = function (gs, meta) {
    if (!tierBattleStills(gs)) return;
    meta = meta && typeof meta === "object" ? meta : {};
    if (meta.skipIfPendingTransfer && gs.attackPhase === "pending_transfer") return;
    var cap = buildBattleOutcomeCaption(meta, gs);
    pushPhaseStill(gs, "battle_outcome", cap, meta);
  };

  function mergeManifestFrames(existing, incoming) {
    var out = [];
    var seen = {};
    var i;
    var lists = [existing, incoming];
    var li;
    for (li = 0; li < lists.length; li++) {
      var arr = lists[li];
      if (!Array.isArray(arr)) continue;
      for (i = 0; i < arr.length; i++) {
        var fr = arr[i];
        if (!fr || !fr.file) continue;
        var fn = String(fr.file);
        if (!fn || fn.indexOf("..") >= 0 || seen[fn]) continue;
        seen[fn] = true;
        out.push(fr);
      }
    }
    return out;
  }

  /**
   * Write rqwb-still-*.json + manifest (merge with existing on disk). Optionally clear in-RAM stills after success.
   */
  window.risqueCheapReplayFlushToDisk = function (gs, opts) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(false);
    if (!tierBattleStills(gs)) return Promise.resolve(false);
    opts = opts && typeof opts === "object" ? opts : {};
    var clearRam = opts.clearRam !== false;
    var rows = getStillsRows(gs);
    if (!Array.isArray(rows) || !rows.length) return Promise.resolve(false);
    if (
      typeof window.risqueSessionDiskHasWritableSaveTarget === "function" &&
      !window.risqueSessionDiskHasWritableSaveTarget()
    ) {
      return Promise.resolve(false);
    }
    if (typeof window.risqueSessionDiskEnsureReplayDirHandle !== "function") {
      return Promise.resolve(false);
    }
    var readFn =
      typeof window.risqueSessionDiskReadTextFile === "function"
        ? window.risqueSessionDiskReadTextFile
        : null;
    var writeFn = window.risqueSessionDiskWriteTextFile;
    if (typeof writeFn !== "function") return Promise.resolve(false);

    ensureTapeKey(gs);
    var st = getSessionStore(gs);
    var mergedColors = {};
    var ci;
    for (ci = 0; ci < rows.length; ci++) {
      var snap = rows[ci].playerColorsSnap;
      if (!snap || typeof snap !== "object") continue;
      Object.keys(snap).forEach(function (k) {
        var kk = String(k).trim().toLowerCase();
        if (!kk) return;
        mergedColors[kk] = String(snap[k]).trim().toLowerCase();
      });
    }
    var endColors = mergePlayerColorsFromState(gs);
    Object.keys(endColors).forEach(function (k) {
      var kk = String(k).trim().toLowerCase();
      if (kk) mergedColors[kk] = String(endColors[k]).trim().toLowerCase();
    });
    var sk = gs.risqueReplayTapeSessionKey != null ? String(gs.risqueReplayTapeSessionKey) : "";
    var newFrames = [];

    return window.risqueSessionDiskEnsureReplayDirHandle(gs).then(function (replayDir) {
      if (!replayDir) return false;
      var chain = Promise.resolve(null);
      if (readFn) {
        chain = readFn(replayDir, "rqwb-stills-manifest.json").then(function (txt) {
          if (!txt) return null;
          try {
            var parsed = JSON.parse(txt);
            if (parsed && parsed.format === MANIFEST_FORMAT && Array.isArray(parsed.frames)) {
              return parsed;
            }
          } catch (eP) {
            /* ignore */
          }
          return null;
        });
      }
      return chain.then(function (prevManifest) {
        var prevFrames = prevManifest && Array.isArray(prevManifest.frames) ? prevManifest.frames : [];
        if (prevManifest && prevManifest.playerColors && typeof prevManifest.playerColors === "object") {
          Object.keys(prevManifest.playerColors).forEach(function (pk) {
            var pkk = String(pk).trim().toLowerCase();
            if (pkk && prevManifest.playerColors[pk] != null) {
              mergedColors[pkk] = String(prevManifest.playerColors[pk]).trim().toLowerCase();
            }
          });
        }
        var writeChain = Promise.resolve(true);
        var ri;
        for (ri = 0; ri < rows.length; ri++) {
          (function (row) {
            var fname = row.fileName ? String(row.fileName) : "";
            if (!fname || fname.indexOf("..") >= 0) return;
            var cap = row.caption != null ? String(row.caption) : "";
            var body = {
              format: STILL_FORMAT,
              kind: row.kind,
              round: row.round,
              actor: row.actor || "",
              caption: cap,
              board: row.board,
              playerColors:
                row.playerColorsSnap && typeof row.playerColorsSnap === "object" ? row.playerColorsSnap : {}
            };
            var json;
            try {
              json = JSON.stringify(body);
            } catch (eJ) {
              json = null;
            }
            if (!json) return;
            newFrames.push({
              file: fname,
              kind: row.kind,
              round: row.round,
              actor: row.actor || "",
              caption: cap
            });
            writeChain = writeChain.then(function () {
              return writeFn(replayDir, fname, json).then(function (ok) {
                return !!ok;
              });
            });
          })(rows[ri]);
        }
        return writeChain.then(function () {
          var manifest = {
            format: MANIFEST_FORMAT,
            sessionKey: sk || null,
            savedAt: Date.now(),
            playerColors: mergedColors,
            frames: mergeManifestFrames(prevFrames, newFrames)
          };
          var mj;
          try {
            mj = JSON.stringify(manifest);
          } catch (eM) {
            mj = null;
          }
          if (!mj) return false;
          return writeFn(replayDir, "rqwb-stills-manifest.json", mj).then(function (okM) {
            if (okM) {
              st.flushedFrameCount = manifest.frames.length;
              if (clearRam) {
                st.stills = [];
              }
            }
            window.risqueCheapReplayDetachFromGameState(gs);
            return !!okM;
          });
        });
      });
    });
  };

  /** End of round: spill stills to disk and free RAM (tier 5). */
  window.risqueCheapReplayFlushRoundToDisk = function (gs) {
    return window.risqueCheapReplayFlushToDisk(gs, { clearRam: true });
  };

  var TAPE_V_BUDGET = 2;
  var BUDGET_FRAME_MS = 1000;

  function boardJsonStableForBudget(b) {
    if (!b || typeof b !== "object") return "";
    var keys = Object.keys(b).sort();
    var parts = [];
    var i;
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      var c = b[k];
      if (!c || typeof c !== "object") continue;
      parts.push(
        k +
          ":" +
          String(c.owner != null ? c.owner : "").trim().toLowerCase() +
          ":" +
          String(Number(c.troops) || 0)
      );
    }
    return parts.join("|");
  }

  function cloneBoardForBudget(b) {
    if (!b || typeof b !== "object") return {};
    try {
      return JSON.parse(JSON.stringify(b));
    } catch (eC) {
      return {};
    }
  }

  function stillKindToReplaySegment(kind) {
    var k = String(kind || "").trim();
    if (k === "deal") return "deal";
    if (k === "battle_outcome" || k === "attack_phase") return "battle";
    if (k === "post_setup_deploy" || k === "turn_deploy") return "deploy";
    if (k === "reinforce") return "reinforce";
    return "battle";
  }

  function phaseToBudgetSegment(phase) {
    var p = String(phase || "").trim().toLowerCase();
    if (p === "deploy" || p === "deal") return "deploy";
    if (p === "attack" || p === "pending_transfer") return "battle";
    if (p === "reinforce" || p === "receive-card" || p.indexOf("cardplay") >= 0) return "reinforce";
    return "battle";
  }

  /**
   * SAVE + REPLAY while on battle_stills: synthesize risque-replay-v1 from in-RAM phase stills (deal → last
   * captured phase) plus an optional one-frame tail when the live board differs (mid-phase manual save).
   */
  window.risqueBuildBudgetReplayPackFromCheapStills = function (gs) {
    if (!gs || typeof gs !== "object") return null;
    var tier = gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
    if (tier !== "battle_stills" && tier !== "host_ultra") return null;

    window.risqueCheapReplayDetachFromGameState(gs);
    var rows = getStillsRows(gs).slice();
    var mergedColors = {};
    var ci;
    for (ci = 0; ci < rows.length; ci++) {
      var snap = rows[ci] && rows[ci].playerColorsSnap;
      if (!snap || typeof snap !== "object") continue;
      Object.keys(snap).forEach(function (k2) {
        var kk = String(k2).trim().toLowerCase();
        if (kk) mergedColors[kk] = String(snap[k2]).trim().toLowerCase();
      });
    }
    var endColors = mergePlayerColorsFromState(gs);
    Object.keys(endColors).forEach(function (k2) {
      var kk = String(k2).trim().toLowerCase();
      if (kk) mergedColors[kk] = String(endColors[k2]).trim().toLowerCase();
    });
    if (gs.risqueReplayPlayerColors && typeof gs.risqueReplayPlayerColors === "object") {
      Object.keys(gs.risqueReplayPlayerColors).forEach(function (k2) {
        var kk = String(k2).trim().toLowerCase();
        if (kk && gs.risqueReplayPlayerColors[k2] != null && String(gs.risqueReplayPlayerColors[k2]).trim() !== "") {
          mergedColors[kk] = String(gs.risqueReplayPlayerColors[k2]).trim().toLowerCase();
        }
      });
    }

    var events = [];
    var maxR = Math.max(1, Number(gs.round) || 1);
    var firstBoard = {};
    if (rows.length && rows[0].board && typeof rows[0].board === "object" && Object.keys(rows[0].board).length) {
      firstBoard = cloneBoardForBudget(rows[0].board);
    } else {
      firstBoard = cloneBoardForBudget(snapshotBoard(gs));
    }
    if (!firstBoard || !Object.keys(firstBoard).length) return null;

    var colorsForInit = {};
    try {
      colorsForInit = JSON.parse(JSON.stringify(mergedColors));
    } catch (eCol) {
      colorsForInit = mergedColors;
    }

    events.push({
      type: "init",
      round: 1,
      board: cloneBoardForBudget(firstBoard),
      playerColors: colorsForInit
    });

    var ri;
    for (ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      if (!row || !row.board || typeof row.board !== "object" || !Object.keys(row.board).length) continue;
      var seg = stillKindToReplaySegment(row.kind);
      var r = Math.max(1, Number(row.round) || 1);
      if (r > maxR) maxR = r;
      var actor = row.actor != null ? String(row.actor).trim() : "";
      var cap =
        row.caption != null && String(row.caption).trim() !== ""
          ? String(row.caption).trim()
          : defaultCaption(row.kind, gs);
      events.push({
        type: "board",
        segment: seg,
        board: cloneBoardForBudget(row.board),
        round: r,
        recordedForPlayer: actor,
        risqueReplayNarration: cap,
        risqueReplayFixedDelayMs: BUDGET_FRAME_MS
      });
    }

    if (!rows.length) {
      events.push({
        type: "board",
        segment: "deploy",
        board: cloneBoardForBudget(firstBoard),
        round: Math.max(1, Number(gs.round) || 1),
        recordedForPlayer: gs.currentPlayer != null ? String(gs.currentPlayer).trim() : "",
        risqueReplayNarration: "Budget replay — no phase stills captured yet (saved very early).",
        risqueReplayFixedDelayMs: BUDGET_FRAME_MS
      });
    }

    var lastJ = "";
    if (rows.length && rows[rows.length - 1] && rows[rows.length - 1].board) {
      lastJ = boardJsonStableForBudget(rows[rows.length - 1].board);
    }
    var tailBoard = snapshotBoard(gs);
    var tailJ = boardJsonStableForBudget(tailBoard);
    if (rows.length && tailJ !== lastJ && tailBoard && Object.keys(tailBoard).length) {
      var tr = Math.max(1, Number(gs.round) || 1);
      if (tr > maxR) maxR = tr;
      var who = gs.currentPlayer != null ? String(gs.currentPlayer).trim() : "";
      events.push({
        type: "board",
        segment: phaseToBudgetSegment(gs.phase),
        board: cloneBoardForBudget(tailBoard),
        round: tr,
        recordedForPlayer: who,
        risqueReplayNarration: "Manual save — board at this moment (mid-phase snapshot).",
        risqueReplayFixedDelayMs: BUDGET_FRAME_MS
      });
    }

    if (events.length < 2) return null;

    var hasDealFrames = events.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });

    return {
      format: "risque-replay-v1",
      replayScope: "session",
      replayRound: maxR,
      tapeFormatVersion: TAPE_V_BUDGET,
      risqueReplayLooseTimeline: true,
      risqueReplayStillsPack: true,
      savedAt: Date.now(),
      round: gs.round,
      phase: gs.phase != null ? String(gs.phase) : "",
      currentPlayer: gs.currentPlayer != null ? String(gs.currentPlayer) : "",
      sessionKey: gs.risqueReplayTapeSessionKey || null,
      playerColors: mergedColors,
      tape: {
        v: TAPE_V_BUDGET,
        events: events,
        openingRecorded: true,
        hasDealFrames: hasDealFrames
      }
    };
  };

  /** After round-end flush cleared RAM, load rqwb-stills from disk for Wayback / REPLAY. */
  window.risqueBuildBudgetReplayPackFromDiskStillsAsync = function (gs) {
    if (!gs || typeof gs !== "object" || !tierBattleStills(gs)) return Promise.resolve(null);
    var readFn =
      typeof window.risqueSessionDiskReadTextFile === "function"
        ? window.risqueSessionDiskReadTextFile
        : null;
    if (!readFn) return Promise.resolve(null);

    function loadManifestFromDir(dir) {
      if (!dir) return Promise.resolve(null);
      return readFn(dir, "rqwb-stills-manifest.json").then(function (txt) {
        if (!txt) return null;
        try {
          var m = JSON.parse(txt);
          if (m && m.format === MANIFEST_FORMAT && Array.isArray(m.frames) && m.frames.length) {
            return { dir: dir, manifest: m };
          }
        } catch (eM) {
          /* ignore */
        }
        return null;
      });
    }

    var chain = Promise.resolve(null);
    if (typeof window.risqueSessionDiskEnsureReplayDirHandle === "function") {
      chain = window.risqueSessionDiskEnsureReplayDirHandle(gs).then(loadManifestFromDir);
    }
    return chain.then(function (hit) {
      if (!hit && typeof window.risqueSessionDiskEnsureGameDirHandle === "function") {
        return window.risqueSessionDiskEnsureGameDirHandle(gs).then(loadManifestFromDir);
      }
      return hit;
    }).then(function (hit) {
      if (!hit || !hit.manifest || !hit.manifest.frames.length) return null;
      var dir = hit.dir;
      var frames = hit.manifest.frames;
      var loaded = [];
      var li = 0;
      function loadNext() {
        if (li >= frames.length) return Promise.resolve(loaded);
        var fr = frames[li];
        li += 1;
        var fn = fr && fr.file ? String(fr.file) : "";
        if (!fn || fn.indexOf("..") >= 0) return loadNext();
        return readFn(dir, fn).then(function (stillTxt) {
          if (stillTxt) {
            try {
              var body = JSON.parse(stillTxt);
              if (body && body.board && typeof body.board === "object") {
                loaded.push({
                  kind: body.kind || fr.kind,
                  round: body.round != null ? body.round : fr.round,
                  actor: body.actor || fr.actor || "",
                  caption: body.caption != null ? body.caption : fr.caption,
                  board: body.board,
                  playerColorsSnap:
                    body.playerColors && typeof body.playerColors === "object" ? body.playerColors : {}
                });
              }
            } catch (eB) {
              /* ignore */
            }
          }
          return loadNext();
        });
      }
      return loadNext().then(function (rows) {
        if (!rows.length) return null;
        var st = getSessionStore(gs);
        var prev = st.stills;
        st.stills = rows;
        var pack = window.risqueBuildBudgetReplayPackFromCheapStills(gs);
        st.stills = prev;
        return pack;
      });
    });
  };
})();
