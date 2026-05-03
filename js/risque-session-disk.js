/**
 * All session JSON under the picked save root (launcher default C:\\risque\\save, flat layout).
 * Host-only; uses File System Access save folder or risque-local-disk virtual paths (flat names).
 */
(function () {
  "use strict";

  /* Flat SAVE folder names (legacy risque-* names still read everywhere we scan). */
  var RQFINAL_GAME = "game-final.json";
  var RQFINAL_REPLAY = "replay-final.json";

  var cachedSessionKey = null;
  var cachedGameDh = null;
  var cachedReplayDh = null;

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

  /** Opens the picked save root for both file types. */
  function ensureSessionPairHandles(gs) {
    if (!gs || typeof gs !== "object") return Promise.resolve(null);
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

  function jsonStable(o) {
    try {
      return JSON.stringify(o);
    } catch (eJ) {
      return "";
    }
  }

  window.risqueSessionDiskScheduleTurnCheckpoint = function (gs, prevPlayerName) {
    if (!gs || window.risqueDisplayIsPublic) return;
    if (!hasWritableSaveTarget()) return;
    var turnOrder = gs.turnOrder;
    if (!Array.isArray(turnOrder) || !turnOrder.length) return;
    try {
      ensureSessionFolderName(gs);
    } catch (eE) {
      /* ignore */
    }
    var snap;
    try {
      snap = JSON.parse(jsonStable(gs));
    } catch (eS) {
      return;
    }
    if (!snap) return;
    var prev = prevPlayerName != null ? String(prevPlayerName) : "";
    setTimeout(function () {
      window.risqueSessionDiskWriteTurnCheckpoint(snap, prev);
    }, 0);
  };

  function granularDiskNameMatch(a, b) {
    var sa = a != null ? String(a).trim().toLowerCase() : "";
    var sb = b != null ? String(b).trim().toLowerCase() : "";
    return sa !== "" && sb !== "" && sa === sb;
  }

  /**
   * Write a named replay pack into the replay save dir ( Wayback granular: replay-deal.json, r2p3-replay.json, … ).
   */
  window.risqueSessionDiskWriteReplayPackNamed = function (gs, fname, pack) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(false);
    if (gs.risqueReplayDiskSaveDisabled === true) return Promise.resolve(false);
    if (!fname || !pack || pack.format !== "risque-replay-v1") return Promise.resolve(false);
    if (!getRoot() && !localDiskActive()) return Promise.resolve(false);
    return window.risqueSessionDiskEnsureReplayDirHandle(gs).then(function (replayDir) {
      if (!replayDir) return false;
      var rjson;
      try {
        rjson = JSON.stringify(pack, null, 2);
      } catch (eJ) {
        return false;
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
    if (liveGs.risqueReplayDiskSaveDisabled === true) return Promise.resolve(true);
    try {
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        window.risqueReplayEnsureLatestBoardFrame(liveGs);
      }
    } catch (eEnsure) {
      /* ignore */
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
    for (ci = 0; ci < chunk.length; ci++) {
      var e = chunk[ci];
      if (!e) continue;
      if (e.type === "board" && e.segment === "battle" && granularDiskNameMatch(e.recordedForPlayer, prev)) {
        attackOnly.push(e);
      } else if (e.type === "elimination" && granularDiskNameMatch(e.conqueror, prev)) {
        attackOnly.push(e);
      }
    }
    try {
      liveGs.risqueReplayGranularWatermark = flat.length;
    } catch (eWm) {
      /* ignore */
    }
    if (!attackOnly.length) return Promise.resolve(true);
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
      rjson = JSON.stringify(pack, null, 2);
    } catch (eJson) {
      return Promise.resolve(true);
    }
    return writeTextFile(replayDir, fname, rjson).catch(function () {
      return false;
    });
  }

  window.risqueSessionDiskWriteTurnCheckpoint = function (snap, prevPlayerName) {
    if (!snap || window.risqueDisplayIsPublic) return Promise.resolve(false);
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
      var gameDir = pair[0];
      var replayDir = pair[1];
      if (!gameDir || !replayDir) return false;
      var roundNum = Math.max(1, Math.floor(Number(snap.round) || 1));
      var rt = roundTag2(roundNum);
      var liveGs = typeof window.gameState === "object" && window.gameState ? window.gameState : snap;
      var seq =
        typeof window.risqueAllocSimpleAutosaveSeq === "function"
          ? window.risqueAllocSimpleAutosaveSeq(liveGs)
          : 1;
      var baseGame = "game-ckpt-r" + rt + "-" + seq;
      var forDisk = snap;
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forDisk = window.risqueStripReplayFromGameStateClone(snap);
        }
      } catch (eSt) {
        forDisk = snap;
      }
      var payload;
      try {
        payload = JSON.stringify(forDisk, null, 2);
      } catch (eP) {
        return false;
      }
      var gname = baseGame + ".json";
      var prevNm = prevPlayerName;
      return writeTextFile(gameDir, gname, payload)
        .then(function () {
          return writeGranularAttackPhaseReplay(replayDir, liveGs, snap, prevNm);
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

  /** Delete turn checkpoints for a completed round (after round autosave succeeds). */
  window.risqueSessionDiskDeleteTurnCheckpointsForRound = function (gs, completedRound) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve();
    if (!hasWritableSaveTarget()) return Promise.resolve();
    var r = Math.max(1, Math.floor(Number(completedRound) || 1));
    var rt = roundTag2(r);
    var prefixGame = "game-ckpt-r" + rt + "-";
    var prefixReplay = "replay-ckpt-r" + rt + "-";
    var prefixLegacy = "risque-ckpt-r" + rt + "-";
    return Promise.all([
      window.risqueSessionDiskEnsureGameDirHandle(gs),
      window.risqueSessionDiskEnsureReplayDirHandle(gs)
    ]).then(function (pair) {
      var gameDir = pair[0];
      var replayDir = pair[1];
      if (!gameDir || !replayDir) return;
      if (gameDir.__risqueVirtualDir && replayDir.__risqueVirtualDir) {
        var gRel = virtualRelDir(gameDir);
        var rRel = virtualRelDir(replayDir);
        return Promise.all([
          typeof window.risqueLocalDiskDeletePrefix === "function"
            ? window.risqueLocalDiskDeletePrefix(gRel, prefixGame)
            : Promise.resolve(),
          typeof window.risqueLocalDiskDeletePrefix === "function"
            ? window.risqueLocalDiskDeletePrefix(gRel, prefixLegacy)
            : Promise.resolve(),
          typeof window.risqueLocalDiskDeletePrefix === "function"
            ? window.risqueLocalDiskDeletePrefix(rRel, prefixReplay)
            : Promise.resolve(),
          typeof window.risqueLocalDiskDeletePrefix === "function"
            ? window.risqueLocalDiskDeletePrefix(rRel, prefixLegacy)
            : Promise.resolve()
        ]);
      }
      if (typeof gameDir.entries !== "function" || typeof replayDir.entries !== "function") return;
      return Promise.all([
        deleteEntriesMatching(gameDir, function (name) {
          var s = String(name);
          return s.indexOf(prefixGame) === 0 || s.indexOf(prefixLegacy) === 0;
        }),
        deleteEntriesMatching(replayDir, function (name) {
          var s = String(name);
          return s.indexOf(prefixReplay) === 0 || s.indexOf(prefixLegacy) === 0;
        })
      ]);
    });
  };

  function deleteEntriesMatching(dirHandle, pred) {
    if (dirHandle && dirHandle.__risqueVirtualDir) {
      var relDir = virtualRelDir(dirHandle);
      if (typeof window.risqueLocalDiskListDir !== "function" || typeof window.risqueLocalDiskDeleteFiles !== "function") {
        return Promise.resolve();
      }
      return window.risqueLocalDiskListDir(relDir).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.entries)) return;
        var toDel = [];
        j.entries.forEach(function (e) {
          var n = e && e.name ? String(e.name) : "";
          var kind = e && e.kind ? String(e.kind) : "file";
          if (kind !== "file" && kind !== "") return;
          if (pred(n)) toDel.push(relDir + "/" + n);
        });
        if (toDel.length) return window.risqueLocalDiskDeleteFiles(toDel);
      });
    }
    return (async function () {
      try {
        var iter = dirHandle.entries();
        for await (var step of iter) {
          var name = step[0];
          if (pred(name)) {
            try {
              await dirHandle.removeEntry(name);
            } catch (eRm) {
              /* ignore */
            }
          }
        }
      } catch (eIt) {
        /* ignore */
      }
    })();
  }

  /** Delete files where pred(name) is true; returns Promise resolving to removed count. */
  function deleteFilesMatchingCount(dirHandle, pred) {
    if (!dirHandle) return Promise.resolve(0);
    if (dirHandle.__risqueVirtualDir) {
      var relDir = virtualRelDir(dirHandle);
      if (
        typeof window.risqueLocalDiskListDir !== "function" ||
        typeof window.risqueLocalDiskDeleteFiles !== "function"
      ) {
        return Promise.resolve(0);
      }
      return window.risqueLocalDiskListDir(relDir).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.entries)) return 0;
        var toDel = [];
        j.entries.forEach(function (e) {
          var n = e && e.name ? String(e.name) : "";
          var kind = e && e.kind ? String(e.kind) : "file";
          if (kind !== "file" && kind !== "") return;
          if (pred(n)) toDel.push((relDir ? relDir + "/" : "") + n);
        });
        if (!toDel.length) return 0;
        return window.risqueLocalDiskDeleteFiles(toDel).then(function () {
          return toDel.length;
        });
      });
    }
    if (typeof dirHandle.entries !== "function") return Promise.resolve(0);
    return (async function () {
      var count = 0;
      try {
        var iter = dirHandle.entries();
        for await (var step of iter) {
          var name = step[0];
          if (pred(name)) {
            try {
              await dirHandle.removeEntry(name);
              count++;
            } catch (eRm) {
              /* ignore */
            }
          }
        }
      } catch (eIt) {
        /* ignore */
      }
      return count;
    })();
  }

  function checkpointRoundFromFilename(name) {
    var m = String(name).match(/^(?:risque-ckpt|game-ckpt|replay-ckpt)-r(\d+)-/i);
    return m ? parseInt(m[1], 10) : null;
  }

  /**
   * Remove turn-checkpoint files for rounds strictly before gs.round (orphans after crashes or failed deletes).
   * Never removes checkpoints for the live round — those may still be needed for mid-round recovery.
   */
  window.risqueSessionDiskCleanupStaleCheckpoints = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(0);
    if (!hasWritableSaveTarget()) return Promise.resolve(0);
    var curR = Math.max(1, Math.floor(Number(gs.round) || 1));
    function pred(name) {
      var rr = checkpointRoundFromFilename(name);
      return rr != null && isFinite(rr) && rr < curR;
    }
    return Promise.all([
      window.risqueSessionDiskEnsureGameDirHandle(gs),
      window.risqueSessionDiskEnsureReplayDirHandle(gs)
    ]).then(function (pair) {
      var gameDir = pair[0];
      var replayDir = pair[1];
      if (!gameDir || !replayDir) return 0;
      return Promise.all([
        deleteFilesMatchingCount(gameDir, pred),
        deleteFilesMatchingCount(replayDir, pred)
      ]).then(function (parts) {
        return (parts[0] || 0) + (parts[1] || 0);
      });
    });
  };

  /** After game win: write consolidated pair and remove intermediate JSON in both session dirs. */
  window.risqueSessionDiskFinalizeGameWin = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(false);
    if (!gs.risqueGameWinAutosaved) return Promise.resolve(false);
    if (!hasWritableSaveTarget()) return Promise.resolve(false);
    return Promise.all([
      window.risqueSessionDiskEnsureGameDirHandle(gs),
      window.risqueSessionDiskEnsureReplayDirHandle(gs)
    ]).then(function (pair) {
      var gameDir = pair[0];
      var replayDir = pair[1];
      if (!gameDir || !replayDir) return false;
      var forDisk = gs;
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forDisk = window.risqueStripReplayFromGameStateClone(gs);
        }
      } catch (eF) {
        forDisk = gs;
      }
      var gjson;
      try {
        gjson = JSON.stringify(forDisk, null, 2);
      } catch (eG) {
        return false;
      }
      var replayPack = null;
      try {
        replayPack =
          typeof window.risqueBuildSessionReplayExport === "function"
            ? window.risqueBuildSessionReplayExport(gs)
            : null;
      } catch (eRp) {
        replayPack = null;
      }
      return window.risqueSessionDiskStitchAndTidyReplayFolder(gs)
        .catch(function () {
          /* non-fatal */
        })
        .then(function () {
          return writeTextFile(gameDir, RQFINAL_GAME, gjson);
        })
        .then(function () {
          if (!replayPack || replayPack.format !== "risque-replay-v1") return Promise.resolve();
          var rjson;
          try {
            rjson = JSON.stringify(replayPack, null, 2);
          } catch (eJ) {
            return Promise.resolve();
          }
          return writeTextFile(replayDir, RQFINAL_REPLAY, rjson);
        })
        .then(function () {
          return Promise.all([sweepIntermediateFiles(gameDir), sweepIntermediateFiles(replayDir)]);
        })
        .then(function () {
          return true;
        })
        .catch(function () {
          return false;
        });
    });
  };

  function sweepIntermediateFiles(sessionDh) {
    if (sessionDh && sessionDh.__risqueVirtualDir) {
      var relDir = virtualRelDir(sessionDh);
      if (typeof window.risqueLocalDiskListDir !== "function" || typeof window.risqueLocalDiskDeleteFiles !== "function") {
        return Promise.resolve();
      }
      return window.risqueLocalDiskListDir(relDir).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.entries)) return;
        var toDel = [];
        j.entries.forEach(function (e) {
          var name = e && e.name ? String(e.name) : "";
          var kind = e && e.kind ? String(e.kind) : "file";
          if (!name || (kind !== "file" && kind !== "")) return;
          var ln = name.toLowerCase();
          var normSlash = String(name).replace(/\\/g, "/");
          if (/^replay-discard\//i.test(normSlash)) {
            return;
          }
          if (/^rqdiscard-/i.test(name)) {
            return;
          }
          if (
            ln === RQFINAL_GAME.toLowerCase() ||
            ln === RQFINAL_REPLAY.toLowerCase() ||
            ln === "replay-full.json" ||
            ln === "risque-full-replay.json"
          ) {
            return;
          }
          /* Granular Wayback bisection tapes — keep after session finalize. */
          if (ln === "replay-deal.json" || /^r\d+p\d+-replay\.json$/i.test(name)) {
            return;
          }
          var isOurs =
            /^risque-ckpt-/i.test(name) ||
            /^game-ckpt-/i.test(name) ||
            /^replay-ckpt-/i.test(name) ||
            /^risque-game-/i.test(name) ||
            /^risque-replay-/i.test(name) ||
            /^game\d+\.json$/i.test(ln) ||
            /^replay\d+\.json$/i.test(ln) ||
            /^game-emergency-/i.test(name) ||
            /^replay-emergency-/i.test(name) ||
            /^risque-emergency-/i.test(name) ||
            /^rqck-/i.test(name) ||
            /^rqgs-/i.test(name) ||
            /^rqem-/i.test(name) ||
            /^rqrp/i.test(name) ||
            (ln.endsWith("-replay.json") && !/^rqfinal-/.test(ln) && !/^rqwb-/.test(ln));
          if (!isOurs) return;
          toDel.push((relDir ? relDir + "/" : "") + name);
        });
        if (toDel.length) return window.risqueLocalDiskDeleteFiles(toDel);
      });
    }
    return (async function () {
      try {
        var iter = sessionDh.entries();
        for await (var step of iter) {
          var name = step[0];
          var ln = String(name).toLowerCase();
          var normSlashN = String(name).replace(/\\/g, "/");
          if (/^replay-discard(\/|$)/i.test(normSlashN)) {
            continue;
          }
          if (/^rqdiscard-/i.test(name)) {
            continue;
          }
          if (
            ln === RQFINAL_GAME.toLowerCase() ||
            ln === RQFINAL_REPLAY.toLowerCase() ||
            ln === "replay-full.json" ||
            ln === "risque-full-replay.json"
          ) {
            continue;
          }
          if (ln === "replay-deal.json" || /^r\d+p\d+-replay\.json$/i.test(String(name))) {
            continue;
          }
          var isOurs =
            /^risque-ckpt-/i.test(name) ||
            /^game-ckpt-/i.test(name) ||
            /^replay-ckpt-/i.test(name) ||
            /^risque-game-/i.test(name) ||
            /^risque-replay-/i.test(name) ||
            /^game\d+\.json$/i.test(ln) ||
            /^replay\d+\.json$/i.test(ln) ||
            /^game-emergency-/i.test(name) ||
            /^replay-emergency-/i.test(name) ||
            /^risque-emergency-/i.test(name) ||
            /^rqck-/i.test(name) ||
            /^rqgs-/i.test(name) ||
            /^rqem-/i.test(name) ||
            /^rqrp/i.test(name) ||
            (ln.endsWith("-replay.json") && !/^rqfinal-/.test(ln) && !/^rqwb-/.test(ln));
          if (!isOurs) continue;
          try {
            await sessionDh.removeEntry(name);
          } catch (eR2) {
            /* ignore */
          }
        }
      } catch (eSw) {
        /* ignore */
      }
    })();
  }

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
