/**
 * Test harness: map + one celebration line only. No runtime HUD, slots, or control voice.
 * Host:  test-celebration-isolation.html
 * TV:    test-celebration-isolation.html?display=public  (reads mirror payload first)
 */
(function () {
  "use strict";

  var STORAGE_KEY = "gameState";
  var PUBLIC_MIRROR_KEY = "risquePublicMirrorState";

  function queryDisplayPublic() {
    try {
      return new URLSearchParams(window.location.search).get("display") === "public";
    } catch (e) {
      return false;
    }
  }

  function loadGameStateForView() {
    try {
      var useMirror = queryDisplayPublic();
      var raw = useMirror
        ? localStorage.getItem(PUBLIC_MIRROR_KEY) || localStorage.getItem(STORAGE_KEY)
        : localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function celebrationLine(gs) {
    try {
      var forced = new URLSearchParams(window.location.search).get("forceLine");
      if (forced != null && String(forced).trim() !== "") return String(forced).trim();
    } catch (eF) {
      /* ignore */
    }
    if (!gs) {
      return "No save in localStorage — play on host first, then open this page (same origin).";
    }
    var ban =
      gs.risquePublicEliminationBanner != null ? String(gs.risquePublicEliminationBanner).trim() : "";
    if (ban) return ban;
    var cur = gs.currentPlayer ? String(gs.currentPlayer).trim() : "";
    var def = gs.defeatedPlayer != null ? String(gs.defeatedPlayer).trim() : "";
    if (cur && def) return cur + " has conquered " + def + ".";
    return "Guido has conquered Mickey. (placeholder — no elimination flags in save)";
  }

  function paint() {
    var gs = loadGameStateForView();
    window.gameState = gs;

    var lineEl = document.getElementById("test-celeb-line");
    if (lineEl) lineEl.textContent = celebrationLine(gs);

    var badge = document.getElementById("test-celeb-mode");
    if (badge) {
      badge.textContent = queryDisplayPublic() ? "PUBLIC (mirror → gameState)" : "HOST (gameState)";
    }

    if (!window.gameUtils || typeof window.gameUtils.renderTerritories !== "function") {
      return;
    }

    if (gs && typeof window.gameUtils.sanitizeTransientState === "function") {
      try {
        var out = window.gameUtils.sanitizeTransientState(gs);
        if (out && out.state) {
          gs = out.state;
          window.gameState = gs;
        }
      } catch (e1) {
        /* ignore */
      }
    }

    try {
      window.gameUtils.initGameView();
      window.gameUtils.renderTerritories(null, gs);
      if (typeof window.gameUtils.renderStats === "function") {
        window.gameUtils.renderStats(gs);
      }
      window.gameUtils.resizeCanvas();
    } catch (e2) {
      if (lineEl) {
        lineEl.textContent =
          celebrationLine(gs) + " — Map render: " + (e2 && e2.message ? e2.message : String(e2));
      }
    }
  }

  function boot() {
    paint();
    setInterval(paint, 2000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  window.addEventListener("storage", function (ev) {
    if (ev.key === STORAGE_KEY || ev.key === PUBLIC_MIRROR_KEY) paint();
  });

  window.addEventListener("resize", function () {
    if (window.gameUtils && window.gameUtils.resizeCanvas) window.gameUtils.resizeCanvas();
  });
})();
