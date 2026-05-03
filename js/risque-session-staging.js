/**
 * Mid-round session staging (host only): debounced checkpoints so a lockup/reboot is less likely
 * to lose the entire in-progress round. Primary store: localStorage (silent).
 * Optional disk export (RISQUE-STAGING.json) is OFF by default — programmatic downloads annoy Edge/Chrome (toolbar/toasts).
 * Opt in once on the host: localStorage.setItem("risqueStagingDiskExport", "1")
 * Opt out: removeItem or set "0".
 */
(function () {
  "use strict";

  var STAGING_BUNDLE_KEY = "risqueSessionStagingBundleV1";
  var DISK_EXPORT_OPT_IN_KEY = "risqueStagingDiskExport";
  var BUNDLE_VERSION = 1;
  var DEBOUNCE_MS = 420;
  var DISK_DEBOUNCE_MS = 2600;
  var memTimer = null;
  var diskTimer = null;
  var lastDiskAt = 0;

  function isDiskExportEnabled() {
    try {
      return String(localStorage.getItem(DISK_EXPORT_OPT_IN_KEY) || "").trim() === "1";
    } catch (e) {
      return false;
    }
  }

  function inPlayPhase(ph) {
    var p = String(ph || "");
    if (!p || p === "login" || p === "playerSelect" || p === "postgame") return false;
    return true;
  }

  function shrinkForStaging(gs) {
    if (!gs || typeof gs !== "object") return gs;
    var o;
    try {
      o = JSON.parse(JSON.stringify(gs));
    } catch (e) {
      return gs;
    }
    try {
      if (Array.isArray(o.gameLogs) && o.gameLogs.length > 80) {
        o.gameLogs = o.gameLogs.slice(-80);
      }
    } catch (e2) {
      /* ignore */
    }
    return o;
  }

  function buildBundle(gs) {
    var replayPack = null;
    try {
      replayPack =
        typeof window.risqueBuildRoundReplayExport === "function"
          ? window.risqueBuildRoundReplayExport(gs, Number(gs.round) || 1)
          : null;
    } catch (eR) {
      replayPack = null;
    }
    return {
      version: BUNDLE_VERSION,
      savedAt: Date.now(),
      round: Number(gs.round) || 1,
      phase: String(gs.phase || ""),
      currentPlayer: String(gs.currentPlayer || ""),
      gameState: shrinkForStaging(gs),
      replayPack: replayPack
    };
  }

  function writeBundleToLocalStorage(bundle) {
    var raw;
    try {
      raw = JSON.stringify(bundle);
    } catch (e) {
      return false;
    }
    try {
      localStorage.setItem(STAGING_BUNDLE_KEY, raw);
      return true;
    } catch (err) {
      if (!(err && (err.name === "QuotaExceededError" || err.code === 22))) return false;
    }
    try {
      var lite = JSON.parse(raw);
      if (lite && lite.gameState) {
        delete lite.gameState.risqueReplayTape;
        delete lite.gameState.risqueReplayByRound;
        delete lite.gameState.gameLogs;
        lite.replayPack = null;
      }
      raw = JSON.stringify(lite);
      localStorage.setItem(STAGING_BUNDLE_KEY, raw);
      return true;
    } catch (e2) {
      return false;
    }
  }

  function exportStagingDisk(bundle) {
    if (!bundle) return;
    var raw;
    try {
      raw = JSON.stringify(bundle);
    } catch (e) {
      return;
    }
    try {
      var blob = new Blob([raw], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "RISQUE-STAGING.json";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 1500);
      lastDiskAt = Date.now();
    } catch (e2) {
      /* ignore */
    }
  }

  function scheduleFlush(gs) {
    if (!gs || window.risqueDisplayIsPublic) return;
    if (!inPlayPhase(gs.phase)) return;

    if (memTimer) clearTimeout(memTimer);
    memTimer = setTimeout(function () {
      memTimer = null;
      try {
        var b = buildBundle(window.gameState || gs);
        writeBundleToLocalStorage(b);
      } catch (e) {
        /* ignore */
      }
    }, DEBOUNCE_MS);

    if (isDiskExportEnabled()) {
      if (diskTimer) clearTimeout(diskTimer);
      diskTimer = setTimeout(function () {
        diskTimer = null;
        try {
          var b2 = buildBundle(window.gameState || gs);
          writeBundleToLocalStorage(b2);
          exportStagingDisk(b2);
        } catch (e2) {
          /* ignore */
        }
      }, DISK_DEBOUNCE_MS);
    } else if (diskTimer) {
      clearTimeout(diskTimer);
      diskTimer = null;
    }
  }

  /** Called after host gameState is persisted (saveState). Debounced. */
  window.risqueStagingNotifyPersistedState = function (state) {
    if (!state || window.risqueDisplayIsPublic) return;
    scheduleFlush(state);
  };

  /** After a full round is committed to round autosave exports — clear mid-round staging. */
  window.risqueStagingClearAfterRoundCommit = function () {
    try {
      localStorage.removeItem(STAGING_BUNDLE_KEY);
    } catch (e) {
      /* ignore */
    }
    if (memTimer) {
      clearTimeout(memTimer);
      memTimer = null;
    }
    if (diskTimer) {
      clearTimeout(diskTimer);
      diskTimer = null;
    }
  };

  /** Debug / future restore UI: read parsed staging bundle from localStorage (host). */
  window.risqueStagingPeekBundle = function () {
    try {
      return JSON.parse(localStorage.getItem(STAGING_BUNDLE_KEY) || "null");
    } catch (e) {
      return null;
    }
  };
})();
