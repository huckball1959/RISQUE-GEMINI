/**
 * Post-conquest card transfer interstitial (was con-cardtransfer.html).
 * Proceed continues to game.html ?phase=con-cardplay.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-con-cardtransfer-phase-v1";

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loginRecoveryHref() {
    if (typeof window.risqueLoginRecoveryViaPrivacyUrl === "function") {
      return window.risqueLoginRecoveryViaPrivacyUrl();
    }
    return "index.html";
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      ".risque-con-cardtransfer-stack{display:flex;flex-direction:column;gap:14px;padding:8px 4px 16px;max-width:100%;}" +
      ".risque-con-cardtransfer-title{font-family:Arial,sans-serif;font-size:clamp(18px,1.6vw,26px);font-weight:900;" +
      "text-transform:uppercase;letter-spacing:.04em;color:#f8fafc;text-align:center;line-height:1.2;}" +
      ".risque-con-cardtransfer-msg{font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#e2e8f0;" +
      "line-height:1.45;text-align:center;}" +
      ".risque-con-cardtransfer-btn{min-height:44px;padding:10px 16px;border:0;border-radius:8px;font-family:Arial,sans-serif;" +
      "font-size:15px;font-weight:800;cursor:pointer;background:#e2e8f0;color:#0f172a;border:1px solid #e2e8f0;width:100%;max-width:320px;align-self:center;}" +
      ".risque-con-cardtransfer-btn:hover:not(:disabled){background:#cbd5e1;}" +
      ".risque-con-cardtransfer-btn:disabled{opacity:0.45;cursor:not-allowed;}" +
      ".risque-con-cardtransfer-public-hint{font-size:12px;font-weight:600;color:#94a3b8;text-align:center;margin-top:4px;}";
    document.head.appendChild(st);
  }

  function persist(gs) {
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {
      /* ignore */
    }
    if (typeof window.risqueHostReplaceShellGameState === "function") {
      window.risqueHostReplaceShellGameState(gs);
    } else {
      window.gameState = gs;
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  }

  function navigateTo(url) {
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(url);
    } else {
      window.location.href = url;
    }
  }

  function cardCountAsWord(n) {
    var words = [
      "Zero",
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
      "Seven",
      "Eight",
      "Nine",
      "Ten",
      "Eleven",
      "Twelve",
      "Thirteen",
      "Fourteen",
      "Fifteen",
      "Sixteen",
      "Seventeen",
      "Eighteen",
      "Nineteen",
      "Twenty"
    ];
    var num = Math.floor(Number(n));
    if (!Number.isFinite(num) || num < 0) return "Zero";
    if (num < words.length) return words[num];
    return String(num);
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;

    function logToStorage(message, data) {
      var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      var logEntry = "[" + ts + "] [CardTransfer] " + message;
      try {
        var logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
        if (!Array.isArray(logs)) logs = [];
        logs.push(logEntry);
        if (data) logs.push(JSON.stringify(data, null, 2));
        localStorage.setItem("gameLogs", JSON.stringify(logs));
      } catch (e) {
        /* ignore */
      }
      console.log(logEntry, data || "");
      if (typeof onLog === "function") onLog(logEntry, data);
    }

    injectStyles();
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    var gs = window.gameState;
    if (!gs) {
      logToStorage("No game state found");
      window.gameUtils.showError("No game state found. Redirecting to launch.");
      setTimeout(function () {
        navigateTo(loginRecoveryHref());
      }, 2000);
      return;
    }

    try {
      if (window.location.protocol !== "file:") {
        var params = new URLSearchParams(window.location.search);
        if (params.get("phase") !== "con-cardtransfer") {
          params.set("phase", "con-cardtransfer");
          var qs = params.toString();
          var newUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
          window.history.replaceState(null, "", newUrl);
        }
      }
    } catch (eHist) {
      /* ignore */
    }

    if (!gs.players || !gs.currentPlayer || !gs.defeatedPlayer) {
      logToStorage("Invalid game state: missing players, currentPlayer, or defeatedPlayer");
      window.gameUtils.showError("Invalid game state. Redirecting to launch.");
      setTimeout(function () {
        navigateTo(loginRecoveryHref());
      }, 2000);
      return;
    }

    var currentPlayer = gs.players.find(function (p) {
      return p.name === gs.currentPlayer;
    });
    var defeatedPlayer = gs.players.find(function (p) {
      return p.name === gs.defeatedPlayer;
    });
    if (!currentPlayer || !defeatedPlayer) {
      logToStorage("Current player or defeated player not found");
      window.gameUtils.showError("Player not found. Redirecting to launch.");
      setTimeout(function () {
        navigateTo(loginRecoveryHref());
      }, 2000);
      return;
    }

    var transferredCardCount = gs.transferredCardCount || 0;
    var defeatedName = defeatedPlayer.name;
    logToStorage("Cards transferred", {
      from: defeatedName,
      to: currentPlayer.name,
      cardCount: transferredCardCount
    });
    var cardWord = transferredCardCount === 1 ? "card" : "cards";
    var countWord = cardCountAsWord(transferredCardCount);
    gs.risquePublicConCardTransferPrimary =
      currentPlayer.name + " receives " + countWord + " " + cardWord + " from " + defeatedName + ".";
    gs.risquePublicConCardTransferReport = "";
    gs.phase = "con-cardtransfer";
    persist(gs);

    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      window.risqueRuntimeHud.updateTurnBannerFromState(gs);
      if (typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        window.risqueRuntimeHud.setControlVoiceText(
          String(currentPlayer.name || "").toUpperCase() + " — CARD TRANSFER",
          gs.risquePublicConCardTransferPrimary,
          { force: true }
        );
      }
    }

    var slot = document.getElementById("risque-phase-content");
    if (!slot) {
      logToStorage("Phase slot not found");
      window.gameUtils.showError("Phase slot not found.");
      return;
    }

    if (gs.risqueConquestChainActive) {
      var rh = document.getElementById("runtime-hud-root");
      if (rh) rh.classList.add("runtime-hud-root--cardplay-panel-only");
    }

    var publicHint = window.risqueDisplayIsPublic
      ? '<p class="risque-con-cardtransfer-public-hint">Host advances on the private screen.</p>'
      : "";

    slot.innerHTML =
      '<div class="risque-con-cardtransfer-stack">' +
      '<div class="risque-con-cardtransfer-title">' +
      escapeHtml(currentPlayer.name) +
      "</div>" +
      '<div class="risque-con-cardtransfer-msg">' +
      escapeHtml("Received " + countWord + " " + cardWord + " from " + defeatedName) +
      "</div>" +
      publicHint +
      '<button type="button" id="risque-con-cardtransfer-proceed" class="risque-con-cardtransfer-btn">' +
      "Proceed to Card Play" +
      "</button>" +
      "</div>";

    var proceedButton = document.getElementById("risque-con-cardtransfer-proceed");
    var proceedLocked = false;

    function proceedToCardPlay(source) {
      if (window.risqueDisplayIsPublic) return;
      if (proceedLocked) return;
      proceedLocked = true;
      logToStorage(source === "keydown" ? "Proceed button keydown" : "Proceed button clicked", {
        cardplayConquered: gs.cardplayConquered
      });
      if (!gs.cardEarnedViaAttack && !gs.cardEarnedViaCardplay) {
        gs.cardEarnedViaAttack = true;
      }
      gs.players = gs.players.filter(function (p) {
        return p.name !== defeatedName;
      });
      gs.turnOrder = (gs.turnOrder || []).filter(function (p) {
        return p !== defeatedName;
      });
      gs.defeatedPlayer = null;
      gs.transferredCardCount = 0;
      gs.phase = "con-cardplay";
      gs.risquePublicConCardTransferPrimary = "";
      gs.risquePublicConCardTransferReport = "";
      logToStorage("Player removed and game state updated", {
        removedPlayer: defeatedName,
        newPlayerCount: gs.players.length,
        newTurnOrder: gs.turnOrder,
        cardplayConquered: gs.cardplayConquered
      });
      try {
        persist(gs);
      } catch (eSave) {
        logToStorage("Save before con-cardplay failed", { error: eSave.message || String(eSave) });
      }
      uiOverlay.classList.add("fade-out");
      setTimeout(function () {
        logToStorage("Navigating to runtime con-cardplay", { cardplayConquered: gs.cardplayConquered });
        navigateTo("game.html?phase=con-cardplay");
      }, 2000);
    }

    if (proceedButton) {
      if (window.risqueDisplayIsPublic) {
        proceedButton.disabled = true;
      } else {
        proceedButton.addEventListener("click", function () {
          proceedToCardPlay("click");
        });
        proceedButton.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            proceedToCardPlay("keydown");
          }
        });
      }
    } else {
      logToStorage("Proceed button not found");
      window.gameUtils.showError("Proceed button not found");
    }

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    logToStorage("Card transfer phase initialized (runtime)", {
      currentPlayer: currentPlayer.name,
      defeatedPlayer: defeatedPlayer.name,
      cardCount: transferredCardCount,
      cardplayConquered: gs.cardplayConquered
    });

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      if (window.gameUtils.initGameView) {
        window.gameUtils.initGameView();
      }
      window.gameUtils.renderTerritories(null, gs);
      window.gameUtils.renderStats(gs);
      if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
        window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.conCardtransfer = { mount: mount };
})();
