/**
 * Single map for paths relative to the site root (game.html, index.html, replay-machine.html, docs/…).
 * Runtime phases should use game.html?phase=… only; this file is for launcher, manual/help tabs,
 * and future migration off standalone conquer/win pages.
 *
 * Not loaded by game.html: con-*.html, phases/reinforce.html, phases/deploy2.html (optional standalone pages)
 * (grep before deleting). Mock Game Maker/index.html patches manual/help to ../… for subfolder-relative paths.
 *
 * loginRecovery / risqueLoginRecoveryUrl: same as index.html default (cardplay after login, no privacy gate).
 * risqueLoginRecoveryViaPrivacyUrl: deploy/income/deal invalid-state recovery (privacy gate before cardplay).
 */
(function () {
  "use strict";

  var LOGIN_RECOVERY =
    "game.html?phase=login&loginLegacyNext=game.html%3Fphase%3DplayerSelect%26selectKind%3DfirstCard&loginLoadRedirect=game.html%3Fphase%3Dcardplay%26legacyNext%3Dincome.html";

  window.RISQUE_URLS = {
    game: "game.html",
    index: "index.html",
    manual: "docs/manual.html",
    help: "docs/help.html",
    conquer: "game.html?phase=conquer",
    win: "win.html",
    loginRecovery: LOGIN_RECOVERY
  };

  var FALLBACK = {
    game: "game.html",
    index: "index.html",
    manual: "docs/manual.html",
    help: "docs/help.html",
    conquer: "game.html?phase=conquer",
    win: "win.html",
    loginRecovery: LOGIN_RECOVERY,
    replayMachine: "replay-machine.html"
  };

  window.risqueResolveDocUrl = function (name) {
    var U = window.RISQUE_URLS;
    if (U && typeof U[name] === "string" && U[name]) return U[name];
    return FALLBACK[name] || "";
  };

  window.risqueLoginRecoveryUrl = function () {
    return window.risqueResolveDocUrl("loginRecovery");
  };

  /**
   * Same document as the runtime (e.g. game.html) with ?phase=postgame, preserving other query params (e.g. display=public).
   */
  window.risquePostgameUrl = function () {
    var base = "game.html";
    try {
      var path = String(window.location.pathname || "");
      var leaf = path.split("/").pop();
      if (leaf && leaf.indexOf(".html") !== -1) {
        base = leaf;
      }
    } catch (ePath) {
      /* ignore */
    }
    try {
      var sp = new URLSearchParams(window.location.search);
      sp.set("phase", "postgame");
      var q = sp.toString();
      return base + (q ? "?" + q : "");
    } catch (eQ) {
      return base + "?phase=postgame";
    }
  };

  /**
   * Alternate recovery used by setup phases: after login, loadRedirect runs privacy gate then cardplay.
   * (Direct loginRecovery skips the gate — see index.html default entry.)
   */
  window.risqueLoginRecoveryViaPrivacyUrl = function () {
    return (
      "game.html?phase=login&loginLegacyNext=" +
      encodeURIComponent("game.html?phase=playerSelect&selectKind=firstCard") +
      "&loginLoadRedirect=" +
      encodeURIComponent(
        "game.html?phase=privacyGate&next=" +
          encodeURIComponent("game.html?phase=cardplay&legacyNext=income.html")
      )
    );
  };

  /** Single-flight fetch of scripts-written paths (same folder as site root when served). */
  var launcherPathsPromise = null;
  window.risqueFetchLauncherPathsJson = function () {
    if (launcherPathsPromise) return launcherPathsPromise;
    launcherPathsPromise = fetch("risque-launcher-paths.json", { cache: "no-store" })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
    return launcherPathsPromise;
  };
})();
