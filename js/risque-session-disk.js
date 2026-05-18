/**
 * All session JSON under the picked save root (launcher default C:\\risque\\save, flat layout).
 * Host-only; uses File System Access save folder or risque-local-disk virtual paths (flat names).
 */
(function () {
  "use strict";

  var cachedSessionKey = null;
  var cachedGameDh = null;
  var cachedReplayDh = null;

  /** Serialize turn disk work so rapid end-turn / advance cannot interleave writes. */
  var __risqueSessionDiskTurnWriteChain = Promise.resolve();
  function enqueueTurnDiskWrite(fn) {
    var p = __risqueSessionDiskTurnWriteChain.then(
      function () {
        return fn();
      },
      function () {
        return fn();
      }
    );
    __risqueSessionDiskTurnWriteChain = p.catch(function () {
      return undefined;
    });
    return p;
  }

  /** Resolves after all queued turn disk writes finish (use before navigation if a caller skipped capturing ScheduleTurnCheckpoint's promise). */
  window.risqueSessionDiskAwaitTurnWriteQueue = function () {
    return __risqueSessionDiskTurnWriteChain.then(function () {
      return true;
    });
  };

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  function getRoot() {
    return typeof window.risqueHostSaveFolderGet === "function" ? window.risqueHostSaveFolderGet() : null;
  }

  function localDiskActive() {
    return typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive();
  }

  /** Picker save root or launcher disk API (no folder pick). */
  function hasWritableSaveTarget() {
    var r = getRoot();
    if (r && typeof r.getDirectoryHandle === "function") return true;
    return localDiskActive();
  }

  window.risqueSessionDiskHasWritableSaveTarget = hasWritableSaveTarget;

  function roundTag2(r) {
    var n = Math.max(1, Math.floor(Number(r) || 1));
    return n < 10 ? "0" + n : String(n);
  }

  window.risqueSessionDiskInvalidateCache = function () {
    cachedSessionKey = null;
    cachedGameDh = null;
    cachedReplayDh = null;
  };

  function ensureSessionFolderName(gs) {
    if (!gs || typeof gs !== "object") return null;
    var ex = gs.risqueAutosaveSessionDir;
    if (ex && String(ex).trim()) {
      return String(ex).trim();
    }
    var d = new Date();
    var name =
      "RQSESS-" +
      d.getFullYear() +
      pad2(d.getMonth() + 1) +
      pad2(d.getDate()) +
      "-" +
      pad2(d.getHours()) +
      pad2(d.getMinutes()) +
      pad2(d.getSeconds());
    try {
      gs.risqueAutosaveSessionDir = name;
    } catch (eN) {
      /* ignore */
    }
    return name;
  }

  function virtualRelPath(dirHandle, fname) {
    var fn = String(fname || "").replace(/^\/+/, "");
    var sess = dirHandle && dirHandle.session != null ? String(dirHandle.session).trim() : "";
    var br = dirHandle && dirHandle.branch != null ? String(dirHandle.branch).replace(/\/+$/, "") : "";
    if (sess) {
      return (br ? br + "/" : "") + sess + "/" + fn;
    }
    return br ? br + "/" + fn : fn;
  }

  function virtualRelDir(dirHandle) {
    var sess = dirHandle && dirHandle.session != null ? String(dirHandle.session).trim() : "";
    var br = dirHandle && dirHandle.branch != null ? String(dirHandle.branch).replace(/\/+$/, "") : "";
    if (sess) {
      return (br ? br + "/" : "") + sess;
    }
    return br || "";
  }

  /** Single directory handle: game + replay JSON share the save root. */
  function openSaveRootFlat(root2) {
    if (!root2 || typeof root2.getDirectoryHandle !== "function") {
      return Promise.resolve(null);
    }
    cachedSessionKey = "__save_root__";
    cachedGameDh = root2;
    cachedReplayDh = root2;
    return Promise.resolve({ game: cachedGameDh, replay: cachedReplayDh });
  }

  /** Opens the picked save root for both file types (flat layout; gs unused). */
  function ensureSessionPairHandles(gs) {
    if (cachedGameDh && cachedReplayDh && cachedSessionKey === "__save_root__") {
      return Promise.resolve({ game: cachedGameDh, replay: cachedReplayDh });
    }
    if (localDiskActive()) {
      return Promise.resolve()
        .then(function () {
          cachedSessionKey = "__save_root__";
          cachedGameDh = { __risqueVirtualDir: true, branch: "", session: "" };
          cachedReplayDh = { __risqueVirtualDir: true, branch: "", session: "" };
          return { game: cachedGameDh, replay: cachedReplayDh };
        })
        .catch(function () {
          return null;
        });
    }
    return openSaveRootFlat(getRoot());
  }

  window.risqueSessionDiskEnsureGameDirHandle = function (gs) {
    return ensureSessionPairHandles(gs).then(function (pair) {
      return pair ? pair.game : null;
    });
  };

  window.risqueSessionDiskEnsureReplayDirHandle = function (gs) {
    return ensureSessionPairHandles(gs).then(function (pair) {
      return pair ? pair.replay : null;
    });
  };

  /**
   * Back-compat: first caller used one dir for both file types — now maps to the game branch only.
   * Prefer ensureGameDirHandle / ensureReplayDirHandle explicitly.
   */
  window.risqueSessionDiskEnsureWriteDirHandle = window.risqueSessionDiskEnsureGameDirHandle;

  /**
   * After reload or fresh login with a connected save folder: reattach the save root (all JSON flat in that folder).
   */
  window.risqueSessionDiskReattachFromGameState = function (gs) {
    window.risqueSessionDiskInvalidateCache();
    if (!gs) return Promise.resolve(null);
    return window.risqueSessionDiskEnsureGameDirHandle(gs);
  };

  window.risqueSessionDiskScheduleTurnCheckpoint = function (gs, prevPlayerName) {
    if (!gs || window.risqueDisplayIsPublic) return;
    if (gs.risqueAutosaveTier === "manual") return;
    var tierSched = gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
    if (tierSched === "battle_stills" || tierSched === "host_ultra") return;
    var turnOrder = gs.turnOrder;
    if (!Array.isArray(turnOrder) || !turnOrder.length) return;
    try {
      ensureSessionFolderName(gs);
    } catch (eE) {
      /* ignore */
    }
    var snap = (function () {
      if (!gs || typeof gs !== "object") return null;
      var ord = Array.isArray(gs.turnOrder) ? gs.turnOrder.slice() : [];
      return { turnOrder: ord, round: gs.round };
    })();
    if (!snap) return;
    var prev = prevPlayerName != null ? String(prevPlayerName) : "";
    var bootWait =
      typeof window.risqueWaitForAutosaveFolderBoot === "function"
        ? window.risqueWaitForAutosaveFolderBoot()
        : Promise.resolve(null);
    /* Same as round autosave: launcher health probe is async — do not skip disk while risqueLocalDiskIsActive is still false. */
    return bootWait.then(function () {
      if (!hasWritableSaveTarget()) return;
      /* Do not defer with setTimeout(0): receive-card chains sync navigation on a Promise microtask
       * (risqueNavigateWithFade → location.href) and can unload before a timer runs — dropping rNpM / rNpMgame. */
      return enqueueTurnDiskWrite(function () {
        return window.risqueSessionDiskWriteTurnCheckpoint(snap, prev);
      });
    });
  };

  function granularDiskNameMatch(a, b) {
    var sa = a != null ? String(a).trim().toLowerCase() : "";
    var sb = b != null ? String(b).trim().toLowerCase() : "";
    return sa !== "" && sb !== "" && sa === sb;
  }

  /** Same batting-order seat as prev (handles spelling vs turnOrder[] without losing battles on disk). */
  function granularSameTurnSeat(turnOrder, nameA, nameB) {
    if (granularDiskNameMatch(nameA, nameB)) return true;
    if (!Array.isArray(turnOrder) || !turnOrder.length) return false;
    if (typeof window.risqueReplayResolveTurnOrderIndex !== "function") return false;
    var ta = window.risqueReplayResolveTurnOrderIndex(turnOrder, nameA);
    var tb = window.risqueReplayResolveTurnOrderIndex(turnOrder, nameB);
    if (!ta || !tb || ta.index < 0 || tb.index < 0) return false;
    return ta.index === tb.index;
  }

  /**
   * Write a named replay pack into the replay save dir ( Wayback granular: replay-deal.json, r2p3-replay.json, … ).
   */
  window.risqueSessionDiskWriteReplayPackNamed = function (gs, fname, pack) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(false);
    if (!fname || !pack || pack.format !== "risque-replay-v1") return Promise.resolve(false);
    if (!getRoot() && !localDiskActive()) return Promise.resolve(false);
    return window.risqueSessionDiskEnsureReplayDirHandle(gs).then(function (replayDir) {
      if (!replayDir) return false;
      var rjson;
      try {
        rjson = JSON.stringify(pack);
      } catch (eJ) {
        return false;
      }
      if (!rjson || String(rjson).length < 32) {
        return Promise.resolve(false);
      }
      return writeTextFile(replayDir, String(fname), rjson)
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    });
  };

  /**
   * After each turn ends: r{N}p{M}-replay.json = battle + elimination frames recorded since last watermark
   * for the player who just finished (attack phase only; N = round, M = 1-based turn order index).
   */
  function writeGranularAttackPhaseReplay(replayDir, liveGs, snap, prevPlayerName) {
    var prev = prevPlayerName != null ? String(prevPlayerName).trim() : "";
    if (!prev || !liveGs || !replayDir) return Promise.resolve(true);
    var turnOrderEarly = snap.turnOrder || liveGs.turnOrder;
    if (
      Array.isArray(turnOrderEarly) &&
      turnOrderEarly.length &&
      typeof window.risqueReplayResolveTurnOrderIndex === "function"
    ) {
      var torPrev = window.risqueReplayResolveTurnOrderIndex(turnOrderEarly, prev);
      if (torPrev && torPrev.index >= 0 && torPrev.canonical) prev = torPrev.canonical;
    }
    try {
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        window.risqueReplayEnsureLatestBoardFrame(liveGs);
      }
    } catch (eEnsure) {
      /* ignore */
    }
    var tier = liveGs.risqueAutosaveTier != null ? String(liveGs.risqueAutosaveTier) : "";
    var granularDiskOn =
      liveGs.risqueReplayGranularDiskWritesEnabled === true && tier !== "safe_no_replay";
    if (!granularDiskOn) {
      var evCount =
        typeof window.risqueReplayTapeTotalEventCount === "function"
          ? window.risqueReplayTapeTotalEventCount(liveGs)
          : 0;
      if (!evCount) return Promise.resolve(true);
      try {
        liveGs.risqueReplayGranularWatermark = evCount;
      } catch (eWmFast) {
        /* ignore */
      }
      return Promise.resolve(true);
    }
    var flat =
      typeof window.risqueReplayFlattenEvents === "function"
        ? window.risqueReplayFlattenEvents(liveGs)
        : [];
    if (!Array.isArray(flat) || !flat.length) return Promise.resolve(true);
    /* Saves before granular export: skip one-shot catch-up (would merge many rounds into one rNpM file). */
    if (liveGs.risqueReplayGranularWatermark == null) {
      try {
        liveGs.risqueReplayGranularWatermark = flat.length;
      } catch (eLeg) {
        /* ignore */
      }
      return Promise.resolve(true);
    }
    var wm = Math.max(0, Math.floor(Number(liveGs.risqueReplayGranularWatermark) || 0));
    var chunk = wm < flat.length ? flat.slice(wm) : [];
    var attackOnly = [];
    var ci;
    var ordForMatch = turnOrderEarly;
    for (ci = 0; ci < chunk.length; ci++) {
      var e = chunk[ci];
      if (!e) continue;
      if (
        e.type === "board" &&
        e.segment === "battle" &&
        (granularDiskNameMatch(e.recordedForPlayer, prev) || granularSameTurnSeat(ordForMatch, e.recordedForPlayer, prev))
      ) {
        attackOnly.push(e);
      } else if (
        e.type === "elimination" &&
        (granularDiskNameMatch(e.conqueror, prev) || granularSameTurnSeat(ordForMatch, e.conqueror, prev))
      ) {
        attackOnly.push(e);
      }
    }
    if (!attackOnly.length && chunk.length) {
      for (ci = 0; ci < chunk.length; ci++) {
        var eLo = chunk[ci];
        if (!eLo) continue;
        var rfp = eLo.recordedForPlayer != null ? String(eLo.recordedForPlayer).trim() : "";
        if (eLo.type === "board" && eLo.segment === "battle" && !rfp) {
          attackOnly.push(eLo);
        } else if (eLo.type === "elimination") {
          var cq = eLo.conqueror != null ? String(eLo.conqueror).trim() : "";
          if (!cq) attackOnly.push(eLo);
        }
      }
    }
    try {
      liveGs.risqueReplayGranularWatermark = flat.length;
    } catch (eWm) {
      /* ignore */
    }
    if (!attackOnly.length) {
      if (!chunk.length) return Promise.resolve(true);
      var turnOrderEmpty = snap.turnOrder || liveGs.turnOrder;
      if (!Array.isArray(turnOrderEmpty) || !turnOrderEmpty.length) return Promise.resolve(true);
      var piE = -1;
      var pkE;
      for (pkE = 0; pkE < turnOrderEmpty.length; pkE++) {
        if (granularDiskNameMatch(turnOrderEmpty[pkE], prev)) {
          piE = pkE;
          break;
        }
      }
      if (piE < 0) return Promise.resolve(true);
      var nextE = (piE + 1) % turnOrderEmpty.length;
      var completedREmpty =
        nextE === 0
          ? Math.max(1, (Number(snap.round) || 1) - 1)
          : Math.max(1, Number(snap.round) || 1);
      var fnameEmpty = "r" + completedREmpty + "p" + (piE + 1) + ".json";
      var packEmpty =
        typeof window.risqueReplayBuildGranularExportPack === "function"
          ? window.risqueReplayBuildGranularExportPack(liveGs, [], {
              replayScope: "round",
              replayRound: completedREmpty,
              round: completedREmpty,
              phase: "attack",
              currentPlayer: prev,
              granularAttackPhase: true,
              allowEmptyDiskSegment: true
            })
          : null;
      if (!packEmpty || packEmpty.format !== "risque-replay-v1") return Promise.resolve(true);
      var jEmpty;
      try {
        jEmpty = JSON.stringify(packEmpty);
      } catch (eJe) {
        return Promise.resolve(true);
      }
      return writeTextFile(replayDir, fnameEmpty, jEmpty).catch(function () {
        return false;
      });
    }
    var turnOrder = snap.turnOrder || liveGs.turnOrder;
    if (!Array.isArray(turnOrder) || !turnOrder.length) return Promise.resolve(true);
    var pi = -1;
    var pk;
    for (pk = 0; pk < turnOrder.length; pk++) {
      if (granularDiskNameMatch(turnOrder[pk], prev)) {
        pi = pk;
        break;
      }
    }
    if (pi < 0) return Promise.resolve(true);
    var nextAfterPrev = (pi + 1) % turnOrder.length;
    var completedRound =
      nextAfterPrev === 0
        ? Math.max(1, (Number(snap.round) || 1) - 1)
        : Math.max(1, Number(snap.round) || 1);
    var playerNum = pi + 1;
    var fname = "r" + completedRound + "p" + playerNum + ".json";
    var pack =
      typeof window.risqueReplayBuildGranularExportPack === "function"
        ? window.risqueReplayBuildGranularExportPack(liveGs, attackOnly, {
            replayScope: "round",
            replayRound: completedRound,
            round: completedRound,
            phase: "attack",
            currentPlayer: prev,
            granularAttackPhase: true
          })
        : null;
    if (!pack || pack.format !== "risque-replay-v1") return Promise.resolve(true);
    var rjson;
    try {
      rjson = JSON.stringify(pack);
    } catch (eJson) {
      return Promise.resolve(true);
    }
    return writeTextFile(replayDir, fname, rjson).catch(function () {
      return false;
    });
  }

  window.risqueSessionDiskWriteTurnCheckpoint = function (snap, prevPlayerName) {
    if (!snap || window.risqueDisplayIsPublic) return Promise.resolve(false);
    var liveGsTier =
      typeof window.gameState === "object" && window.gameState && window.gameState.risqueAutosaveTier != null
        ? String(window.gameState.risqueAutosaveTier)
        : snap.risqueAutosaveTier != null
          ? String(snap.risqueAutosaveTier)
          : "";
    if (liveGsTier === "manual") {
      return Promise.resolve(false);
    }
    if (liveGsTier === "battle_stills" || liveGsTier === "host_ultra") {
      return Promise.resolve(true);
    }
    if (
      typeof window.risqueSessionDiskHasWritableSaveTarget === "function" &&
      !window.risqueSessionDiskHasWritableSaveTarget()
    ) {
      return Promise.resolve(false);
    }
    return Promise.all([
      window.risqueSessionDiskEnsureGameDirHandle(snap),
      window.risqueSessionDiskEnsureReplayDirHandle(snap)
    ]).then(function (pair) {
      if (!pair[0] || !pair[1]) return false;
      var gameDir = pair[0];
      var replayDir = pair[1];
      var liveGs = typeof window.gameState === "object" && window.gameState ? window.gameState : snap;
      var prevNm = prevPlayerName;
      if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function") {
        try {
          window.risqueReplayTryWriteDdJsonAfterSetupDeploy(liveGs);
        } catch (eDdRetry) {
          /* ignore */
        }
      }
      var ordCk = snap.turnOrder || liveGs.turnOrder;
      var prevCanon = prevNm;
      if (
        Array.isArray(ordCk) &&
        ordCk.length &&
        typeof window.risqueReplayResolveTurnOrderIndex === "function"
      ) {
        var torCk = window.risqueReplayResolveTurnOrderIndex(ordCk, prevNm);
        if (torCk && torCk.index >= 0 && torCk.canonical) prevCanon = String(torCk.canonical);
      }
      var piCk = -1;
      var pkCk;
      for (pkCk = 0; pkCk < (ordCk || []).length; pkCk++) {
        if (granularDiskNameMatch(ordCk[pkCk], prevCanon)) {
          piCk = pkCk;
          break;
        }
      }
      var roundNumCk = Math.max(1, Math.floor(Number(snap.round) || 1));
      var gnameCk;
      if (piCk >= 0 && Array.isArray(ordCk) && ordCk.length) {
        var nextAfterPrevCk = (piCk + 1) % ordCk.length;
        var completedRoundCk =
          nextAfterPrevCk === 0
            ? Math.max(1, (Number(snap.round) || 1) - 1)
            : Math.max(1, Number(snap.round) || 1);
        gnameCk = "r" + completedRoundCk + "p" + (piCk + 1) + "game.json";
      } else {
        gnameCk = "r" + roundNumCk + "p0game.json";
      }
      var forDiskCk = liveGs;
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forDiskCk = window.risqueStripReplayFromGameStateClone(liveGs);
        }
      } catch (eStripCk) {
        forDiskCk = liveGs;
      }
      var payloadCk;
      try {
        payloadCk = JSON.stringify(forDiskCk);
      } catch (eJsonCk) {
        return Promise.resolve(false);
      }
      return writeTextFile(gameDir, gnameCk, payloadCk)
        .then(function () {
          return writeGranularAttackPhaseReplay(replayDir, liveGs, snap, prevNm);
        })
        .then(function (granRes) {
          return granRes !== false;
        })
        .catch(function () {
          return false;
        });
    });
  };

  function writeTextFile(dirHandle, fname, text) {
    if (dirHandle && dirHandle.__risqueVirtualDir) {
      var rel = virtualRelPath(dirHandle, fname);
      if (typeof window.risqueLocalDiskWrite !== "function") {
        return Promise.reject(new Error("risqueLocalDiskWrite missing"));
      }
      return window.risqueLocalDiskWrite(rel, text != null ? String(text) : "");
    }
    return dirHandle
      .getFileHandle(fname, { create: true })
      .then(function (fh) {
        return fh.createWritable();
      })
      .then(function (w) {
        var wr = w.write(text);
        return Promise.resolve(wr).then(function () {
          return w.close();
        });
      });
  }

  function readTextFile(dirHandle, fname) {
    if (!dirHandle || !fname) return Promise.resolve(null);
    if (dirHandle.__risqueVirtualDir) {
      var rel = virtualRelPath(dirHandle, fname);
      if (typeof window.risqueLocalDiskRead !== "function") return Promise.resolve(null);
      return window.risqueLocalDiskRead(rel).then(function (rj) {
        if (!rj || !rj.ok || rj.content == null) return null;
        return String(rj.content);
      }).catch(function () {
        return null;
      });
    }
    return dirHandle
      .getFileHandle(String(fname))
      .then(function (fh) {
        return fh.getFile();
      })
      .then(function (file) {
        return file.text();
      })
      .catch(function () {
        return null;
      });
  }

  function listReplayTopLevelFileNames(replayDir) {
    if (!replayDir) return Promise.resolve([]);
    if (replayDir.__risqueVirtualDir) {
      var relDir = virtualRelDir(replayDir);
      if (typeof window.risqueLocalDiskListDir !== "function") return Promise.resolve([]);
      return window.risqueLocalDiskListDir(relDir).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.entries)) return [];
        var out = [];
        j.entries.forEach(function (e) {
          var name = e && e.name ? String(e.name) : "";
          var kind = e && e.kind ? String(e.kind) : "file";
          if (!name || (kind !== "file" && kind !== "")) return;
          out.push(name);
        });
        return out;
      });
    }
    return (async function () {
      var names = [];
      try {
        var iter = replayDir.entries();
        for await (var step of iter) {
          var h = step[1];
          if (h && h.kind === "file") names.push(step[0]);
        }
      } catch (eList) {
        /* ignore */
      }
      return names;
    })();
  }

  function removeReplayTopLevelFile(replayDir, fname) {
    if (!replayDir || !fname) return Promise.resolve(false);
    if (replayDir.__risqueVirtualDir) {
      var rel = virtualRelPath(replayDir, fname);
      if (typeof window.risqueLocalDiskDeleteFiles !== "function") return Promise.resolve(false);
      return window.risqueLocalDiskDeleteFiles([rel])
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    }
    return replayDir
      .removeEntry(String(fname))
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  }

  /** Flat layout: no replay-discard subfolder (legacy stub). */
  function ensureReplayDiscardDir(replayDir) {
    return Promise.resolve();
  }

  function sliceTapeEventsBeforeFirstBattle(evs) {
    if (!Array.isArray(evs)) return [];
    var out = [];
    var i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e && e.type === "board" && e.segment === "battle") {
        break;
      }
      out.push(e);
    }
    return out;
  }

  function tryParseReplayPackV1Text(txt) {
    if (txt == null || typeof txt !== "string" || !String(txt).trim()) return null;
    try {
      var o = JSON.parse(txt);
      if (o && o.format === "risque-replay-v1" && o.tape && Array.isArray(o.tape.events)) return o;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  /**
   * Granular segments are battle-heavy; prepending keeps deal/init/deploy from the prior replay{N}.json or replay-deal.json.
   */
  function prependOpeningPrefixOntoMergedGranularRound(replayDir, roundNum, mergedPack) {
    if (!replayDir || !mergedPack || !mergedPack.tape || !Array.isArray(mergedPack.tape.events)) {
      return Promise.resolve(mergedPack);
    }
    var r = Math.max(1, Math.floor(Number(roundNum) || 1));
    var outName = "replay" + String(r) + ".json";
    return readTextFile(replayDir, outName).then(function (existingTxt) {
      var prefixEvs = [];
      var exPk = tryParseReplayPackV1Text(existingTxt);
      if (exPk && exPk.tape.events.length) {
        prefixEvs = sliceTapeEventsBeforeFirstBattle(exPk.tape.events);
      }
      var dealRead = Promise.resolve();
      if (!prefixEvs.length && r === 1) {
        dealRead = readTextFile(replayDir, "DD.json").then(function (dealTxt) {
          var dp = tryParseReplayPackV1Text(dealTxt);
          if (dp && dp.tape.events.length) {
            prefixEvs = sliceTapeEventsBeforeFirstBattle(dp.tape.events);
            if (!prefixEvs.length) {
              prefixEvs = dp.tape.events.slice();
            }
          }
          if (prefixEvs.length) return;
          return readTextFile(replayDir, "replay-deal.json").then(function (legacyDeal) {
            var dp2 = tryParseReplayPackV1Text(legacyDeal);
            if (dp2 && dp2.tape.events.length) {
              prefixEvs = sliceTapeEventsBeforeFirstBattle(dp2.tape.events);
              if (!prefixEvs.length) {
                prefixEvs = dp2.tape.events.slice();
              }
            }
          });
        });
      }
      return dealRead.then(function () {
        if (!prefixEvs.length) return mergedPack;
        var mergedHasInit = mergedPack.tape.events.some(function (e) {
          return e && e.type === "init";
        });
        if (mergedHasInit) return mergedPack;
        mergedPack.tape.events = prefixEvs.concat(mergedPack.tape.events);
        mergedPack.tape.openingRecorded = mergedPack.tape.events.some(function (e) {
          return e && e.type === "init";
        });
        mergedPack.tape.hasDealFrames = mergedPack.tape.events.some(function (e) {
          return e && e.type === "board" && e.segment === "deal";
        });
        if (typeof window.risqueReplayNormalizeTapeEventOrder === "function") {
          try {
            mergedPack.tape.events = window.risqueReplayNormalizeTapeEventOrder(mergedPack.tape.events.slice());
          } catch (eNorm) {
            /* ignore */
          }
        }
        if (typeof window.risqueReplayStripBackwardStampedRoundBoards === "function") {
          try {
            var evDiskPre = mergedPack.tape.events.length;
            var st = window.risqueReplayStripBackwardStampedRoundBoards(mergedPack.tape.events.slice());
            mergedPack.tape.events = st.events;
            if (typeof window.risqueReplayDebugLog === "function") {
              window.risqueReplayDebugLog(
                "disk prepend strip",
                "in=" + evDiskPre,
                "out=" + mergedPack.tape.events.length,
                "skipped=" + (st.skipped || 0)
              );
            }
            if (st.skipped > 0 && st.message) {
              if (!mergedPack.__mergeWarnings) mergedPack.__mergeWarnings = [];
              if (mergedPack.__mergeWarnings.indexOf(st.message) === -1) mergedPack.__mergeWarnings.push(st.message);
            }
          } catch (eStrip) {
            /* ignore */
          }
        }
        return mergedPack;
      });
    });
  }

  /** Flat replay layout: no merge/stitch of rNpM chips (legacy hook stays API-stable). */
  window.risqueSessionDiskStitchGranularRoundReplay = function () {
    return Promise.resolve(false);
  };

  window.risqueSessionDiskStitchAllOutstandingGranularReplays = function () {
    return Promise.resolve(0);
  };

  function granularReplayBasename(name) {
    var norm = String(name || "").replace(/\\/g, "/");
    if (/^replay-discard\//i.test(norm)) return null;
    var base = norm.indexOf("/") >= 0 ? norm.replace(/^.*\//, "") : norm;
    if (/^rqdiscard-/i.test(base)) return null;
    if (!/^r\d+p\d+(?:-replay)?\.json$/i.test(base)) return null;
    return base;
  }

  /** After stitching: any r{N}p* still at replay root (unmergeable / lone corrupt segment) → discard subfolder. */
  function moveRemainingGranularOrphansToDiscard(replayDir) {
    if (!replayDir) return Promise.resolve(0);
    return listReplayTopLevelFileNames(replayDir).then(function (names) {
      var toMove = [];
      names.forEach(function (name) {
        var b = granularReplayBasename(name);
        if (b && toMove.indexOf(b) === -1) toMove.push(b);
      });
      if (!toMove.length) return 0;
      return ensureReplayDiscardDir(replayDir).then(function () {
        var moved = 0;
        return toMove.reduce(function (seq, fname) {
          return seq.then(function () {
            return readTextFile(replayDir, fname).then(function (txt) {
              if (txt == null) return;
              var flat = "rqdiscard-" + String(fname).replace(/^rqdiscard-/i, "");
              return writeTextFile(replayDir, flat, txt).then(function () {
                return removeReplayTopLevelFile(replayDir, fname).then(function () {
                  moved++;
                });
              });
            });
          });
        }, Promise.resolve()).then(function () {
          return moved;
        });
      });
    });
  }

  window.risqueSessionDiskStitchAndTidyReplayFolder = function () {
    return Promise.resolve({ stitchedRounds: 0, orphansMoved: 0 });
  };

  window.risqueSessionDiskScheduleReplayStitchTidyOnResume = function () {};

  /**
   * Legacy hook after round autosave. Policy: never delete DD, rNpM.json, rNpMgame.json, or ckpt-* files from disk.
   */
  window.risqueSessionDiskDeleteTurnCheckpointsForRound = function () {
    return Promise.resolve();
  };

  /**
   * Legacy periodic cleanup from game-shell. Policy: no automatic removal of session saves.
   */
  window.risqueSessionDiskCleanupStaleCheckpoints = function () {
    return Promise.resolve(0);
  };

  /**
   * Last battle wins the game without a receivecard turn checkpoint — {@link writeGranularAttackPhaseReplay}
   * never ran with a 2+ player turnOrder (length 1 breaks rNpM math). Attack sets {@link gs.risqueReplayGameWinDiskFlush}
   * before the final turnOrder shrink; we replay a normal turn checkpoint using that snapshot so rNpM + rNpMgame
   * land on disk before celebration UI.
   */
  window.risqueSessionDiskFlushReplayAfterGameWin = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(false);
    if (String(gs.risqueAutosaveTier || "") === "manual") {
      try {
        delete gs.risqueReplayGameWinDiskFlush;
      } catch (eManFlush) {
        /* ignore */
      }
      return Promise.resolve(false);
    }
    var meta = gs.risqueReplayGameWinDiskFlush;
    if (!meta || !Array.isArray(meta.turnOrderBefore) || meta.turnOrderBefore.length < 2) {
      return Promise.resolve(false);
    }
    var prev = meta.conqueror != null ? String(meta.conqueror).trim() : "";
    if (!prev || typeof window.risqueSessionDiskWriteTurnCheckpoint !== "function") {
      return Promise.resolve(false);
    }
    var snap = {
      turnOrder: meta.turnOrderBefore,
      round: Math.max(1, Number(meta.roundAtElimination) || 1)
    };
    var bootWait =
      typeof window.risqueWaitForAutosaveFolderBoot === "function"
        ? window.risqueWaitForAutosaveFolderBoot()
        : Promise.resolve(null);
    return bootWait.then(function () {
      return Promise.resolve(window.risqueSessionDiskWriteTurnCheckpoint(snap, prev))
        .then(function (ok) {
          return !!ok;
        })
        .catch(function () {
          return false;
        })
        .then(function (ok) {
          try {
            delete gs.risqueReplayGameWinDiskFlush;
          } catch (eDel) {
            /* ignore */
          }
          return ok;
        });
    });
  };

  /**
   * After game win: previously wrote game-final.json + replay-final.json and deleted intermediate session JSON.
   * Policy: do not consolidate or remove anything — keep all per-round / granular saves for Wayback and experiments.
   * Postgame "ARCHIVE GAME REPLAY" still writes an explicit full-session file when you choose.
   */
  window.risqueSessionDiskFinalizeGameWin = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(false);
    if (!gs.risqueGameWinAutosaved) return Promise.resolve(false);
    if (!hasWritableSaveTarget()) return Promise.resolve(false);
    return Promise.resolve(true);
  };

  /** Read UTF-8 text from the save root (or virtual launcher path); null if missing/unreadable. */
  window.risqueSessionDiskReadTextFile = function (dirHandle, fname) {
    return readTextFile(dirHandle, fname);
  };

  window.risqueSessionDiskWriteTextFile = function (dirHandle, fname, text) {
    if (!dirHandle) return Promise.resolve(false);
    if (dirHandle.__risqueVirtualDir) {
      var rel = virtualRelPath(dirHandle, fname);
      if (typeof window.risqueLocalDiskWrite !== "function") return Promise.resolve(false);
      return window
        .risqueLocalDiskWrite(rel, text != null ? String(text) : "")
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    }
    if (typeof dirHandle.getFileHandle !== "function") return Promise.resolve(false);
    var raw = String(fname || "file.txt");
    var parts = raw.replace(/\\/g, "/").split("/").filter(function (p) {
      return p && p !== "." && p !== "..";
    });
    if (!parts.length) return Promise.resolve(false);
    function ensureDirAndWrite(dh, idx) {
      if (idx >= parts.length - 1) {
        return dh
          .getFileHandle(parts[idx], { create: true })
          .then(function (fh) {
            return fh.createWritable();
          })
          .then(function (w) {
            var wr = w.write(text != null ? String(text) : "");
            return Promise.resolve(wr).then(function () {
              return w.close();
            });
          });
      }
      return dh.getDirectoryHandle(parts[idx], { create: true }).then(function (sub) {
        return ensureDirAndWrite(sub, idx + 1);
      });
    }
    return ensureDirAndWrite(dirHandle, 0)
      .then(function () {
        return true;
      })
      .catch(function () {
        return false;
      });
  };
})();
