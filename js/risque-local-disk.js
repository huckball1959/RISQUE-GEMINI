/**
 * Loopback disk API client (http://127.0.0.1:5599 by default). Loaded by game.html so file:// host can
 * write SAVE without File System Access. scripts/RISQUE.ps1 starts scripts/risque-disk-server.ps1 in
 * the background before Chromium; risque-launcher-paths.json includes diskApiBase (override via env RISQUE_DISK_PORT).
 */
(function () {
  "use strict";

  var apiBase = "";
  var active = false;

  window.risqueLocalDiskConfigure = function (baseUrl) {
    apiBase = String(baseUrl || "").replace(/\/+$/, "");
  };

  window.risqueLocalDiskIsConfigured = function () {
    return !!apiBase;
  };

  window.risqueLocalDiskIsActive = function () {
    return !!active;
  };

  window.risqueLocalDiskSetActive = function (v) {
    active = !!v;
    window.__risqueLocalDiskActive = active;
    window.__risqueLocalDiskMarker = active ? { __risqueLocalDisk: true } : null;
  };

  function post(path, body) {
    return fetch(apiBase + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {})
    });
  }

  /** Probe server; sets active on success. */
  window.risqueLocalDiskProbe = function () {
    if (!apiBase) {
      window.risqueLocalDiskSetActive(false);
      return Promise.resolve(false);
    }
    return fetch(apiBase + "/api/health", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        var ok = !!(j && j.ok);
        window.risqueLocalDiskSetActive(ok);
        return ok;
      })
      .catch(function () {
        window.risqueLocalDiskSetActive(false);
        return false;
      });
  };

  /** Bootstrap from risque-launcher-paths.json + health check. */
  window.risqueLocalDiskBootstrap = function () {
    var fallbackBase = "http://127.0.0.1:5599";
    var chain = Promise.resolve(null);
    if (typeof window.risqueFetchLauncherPathsJson === "function") {
      chain = window.risqueFetchLauncherPathsJson();
    }
    return chain.then(function (j) {
      var b =
        (j && j.diskApiBase && String(j.diskApiBase).trim()) ||
        (j && j.diskApiUrl && String(j.diskApiUrl).trim()) ||
        fallbackBase;
      window.risqueLocalDiskConfigure(b);
      return window.risqueLocalDiskProbe();
    });
  };

  /**
   * After disk bootstrap: if URL ?risqueResumePeriodicCheckpoint=1 and/or LS resume flag is set, read
   * risque-periodic-restart-game.json via POST (fetch works from file:// where sync XHR may not) and jump to cardplay.
   * @returns {Promise<boolean>} true if navigation was triggered
   */
  window.risqueLocalDiskTryApplyPeriodicRestartCheckpoint = function () {
    if (typeof window !== "undefined" && window.risqueDisplayIsPublic) return Promise.resolve(false);
    var want = false;
    try {
      want = new URL(window.location.href).searchParams.get("risqueResumePeriodicCheckpoint") === "1";
    } catch (eU) {
      /* ignore */
    }
    try {
      if (localStorage.getItem("risqueAutoResumeCardplayAfterLauncherRestart") === "1") want = true;
    } catch (eL) {
      /* ignore */
    }
    if (!want) return Promise.resolve(false);
    if (!apiBase) return Promise.resolve(false);
    return post("/api/read", { path: "risque-periodic-restart-game.json" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j || !j.ok || j.content == null) return false;
        var raw = String(j.content);
        var gs;
        try {
          gs = JSON.parse(raw);
        } catch (eP) {
          return false;
        }
        if (!gs || gs.phase !== "cardplay" || !gs.players || !gs.players.length) return false;
        try {
          localStorage.setItem("gameState", raw);
        } catch (eS) {
          /* ignore */
        }
        try {
          localStorage.removeItem("risqueAutoResumeCardplayAfterLauncherRestart");
        } catch (eR) {
          /* ignore */
        }
        var rd = "";
        try {
          rd = new URL(window.location.href).searchParams.get("replayDebug") || "";
        } catch (e2) {
          /* ignore */
        }
        var target = "game.html?phase=cardplay&legacyNext=income.html";
        if (rd === "1" || rd === "0") target += "&replayDebug=" + rd;
        window.location.replace(target);
        return true;
      })
      .catch(function () {
        return false;
      });
  };

  window.risqueLocalDiskWrite = function (relPath, text) {
    var p = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return post("/api/write", { path: p, content: text != null ? String(text) : "" }).then(function (r) {
      if (!r.ok) throw new Error("risque-disk write failed");
      return r.json();
    });
  };

  window.risqueLocalDiskRead = function (relPath) {
    var p = String(relPath || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return post("/api/read", { path: p }).then(function (r) {
      if (!r.ok) throw new Error("risque-disk read failed");
      return r.json();
    });
  };

  window.risqueLocalDiskListDir = function (relDir) {
    var d = String(relDir || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return post("/api/list", { dir: d }).then(function (r) {
      if (!r.ok) throw new Error("risque-disk list failed");
      return r.json();
    });
  };

  window.risqueLocalDiskDeleteFiles = function (paths) {
    if (!paths || !paths.length) return Promise.resolve({ ok: true, removed: 0 });
    var norm = paths.map(function (x) {
      return String(x || "").replace(/\\/g, "/").replace(/^\/+/, "");
    });
    return post("/api/delete-files", { paths: norm }).then(function (r) {
      if (!r.ok) throw new Error("risque-disk delete failed");
      return r.json();
    });
  };

  window.risqueLocalDiskDeletePrefix = function (dirRel, prefix) {
    var d = String(dirRel || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return post("/api/delete-prefix", { dir: d, prefix: String(prefix || "") }).then(function (r) {
      if (!r.ok) throw new Error("risque-disk delete-prefix failed");
      return r.json();
    });
  };

  /** Local launcher only: spawn risque-browser-restart-job.ps1 (kill RISQUE-tagged Chromium/Edge, re-run RISQUE.bat -SkipMenu). */
  window.risqueLocalDiskRequestBrowserRestart = function () {
    return post("/api/restart-browser", { confirm: "risque-restart" }).then(function (r) {
      if (!r.ok) throw new Error("risque-disk restart-browser failed");
      return r.json();
    });
  };

  /** Ensure branch dir exists (flat GAME/ or REPLAY/). Empty sessionName = flat layout. */
  window.risqueLocalDiskTouchSession = function (branch, sessionName) {
    var b = String(branch || "").replace(/\\/g, "/");
    if (!b) return Promise.resolve();
    var s = String(sessionName || "").trim();
    if (!s) {
      return window.risqueLocalDiskWrite(b + "/.risque-flat", '{"v":2}\n');
    }
    return window.risqueLocalDiskWrite(b + "/" + s + "/.risque-session", '{"v":1}\n');
  };
})();
