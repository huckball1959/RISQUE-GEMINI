/**
 * Legacy deal.html — deal territory cards onto the board (JS).
 */
(function () {
  "use strict";

  var TERRITORIES = [
    "afghanistan", "alaska", "alberta", "argentina", "brazil", "central_america", "china", "congo",
    "east_africa", "eastern_australia", "eastern_united_states", "egypt", "great_britain", "greenland",
    "iceland", "india", "indonesia", "irkutsk", "japan", "kamchatka", "madagascar", "middle_east",
    "mongolia", "new_guinea", "north_africa", "northern_europe", "northwest_territory", "ontario",
    "peru", "quebec", "scandinavia", "siam", "siberia", "south_africa", "southern_europe", "ukraine",
    "ural", "venezuela", "western_australia", "western_europe", "western_united_states", "yakutsk"
  ];

  function loginRecoveryHref() {
    return window.risqueLoginRecoveryViaPrivacyUrl();
  }

  function logLines(msg, logFn) {
    var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var line = "[" + ts + "] [DealJS] " + msg;
    console.log(line);
    if (typeof logFn === "function") logFn(line);
    try {
      var logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
      if (!Array.isArray(logs)) logs = [];
      logs.push(line);
      localStorage.setItem("gameLogs", JSON.stringify(logs));
    } catch (e) {
      /* ignore */
    }
  }

  function validateDealState(gameState) {
    if (!gameState) return false;
    var requiredFields = [
      "phase",
      "players",
      "turnOrder",
      "currentPlayer",
      "round",
      "aerialAttack",
      "aerialBridge",
      "conquered",
      "deck",
      "isInitialDeploy",
      "continents"
    ];
    var continentsOk = ["south_america", "north_america", "africa", "europe", "asia", "australia"].every(
      function (c) {
        return gameState.continents && gameState.continents[c];
      }
    );
    return (
      requiredFields.every(function (field) {
        return Object.prototype.hasOwnProperty.call(gameState, field);
      }) &&
      gameState.phase === "deal" &&
      gameState.players.length >= 2 &&
      gameState.turnOrder.length === gameState.players.length &&
      gameState.currentPlayer !== null &&
      gameState.turnOrder.indexOf(gameState.currentPlayer) !== -1 &&
      gameState.deck.length <= 44 &&
      continentsOk
    );
  }

  /**
   * @param {HTMLElement} stageHost
   * @param {{ log?: function }} opts
   */
  function run(stageHost, opts) {
    opts = opts || {};
    var logFn = opts.log;

    var gameState = null;
    try {
      gameState = JSON.parse(localStorage.getItem("gameState") || "{}");
    } catch (e) {
      logLines("Parse error: " + e.message, logFn);
      window.location.href = loginRecoveryHref();
      return;
    }

    if (!validateDealState(gameState)) {
      logLines("Invalid game state for deal phase", logFn);
      window.location.href = loginRecoveryHref();
      return;
    }

    window.gameState = gameState;

    var canvas = document.getElementById("canvas");
    if (!canvas || !window.gameUtils) {
      logLines("Missing canvas or gameUtils", logFn);
      return;
    }

    if (window.__risqueDealRunActive) {
      logLines("Deal.run skipped — already running (prevents double deal)", logFn);
      return;
    }
    window.__risqueDealRunActive = true;

    window.gameUtils.initGameView();
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
      window.risqueRuntimeHud.setControlVoiceText("DEALING CARDS NOW", "");
    }

    var players = gameState.players;
    var alreadyAssigned = {};
    players.forEach(function (p) {
      (p.territories || []).forEach(function (terr) {
        if (terr && terr.name) alreadyAssigned[terr.name] = true;
      });
    });
    var territories = TERRITORIES.filter(function (id) {
      return !alreadyAssigned[id];
    });

    var currentPlayerIndex = players.findIndex(function (p) {
      return p.name === gameState.currentPlayer;
    });
    if (currentPlayerIndex === -1) {
      window.__risqueDealRunActive = false;
      logLines("Invalid currentPlayer", logFn);
      window.location.href = loginRecoveryHref();
      return;
    }

    function finishDealAndAdvance() {
      window.__risqueDealRunActive = false;
      gameState.deck = gameState.deck.filter(function (t) {
        return !gameState.players.some(function (p) {
          return p.territories.some(function (terr) {
            return terr.name === t;
          });
        });
      });
      gameState.currentPlayer = gameState.turnOrder[0];
      gameState.phase = "deal";
      gameState.selectionPhase = "deployOrder";
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (e2) {
        logLines("Save error: " + e2.message, logFn);
      }
      logLines("Deal complete → deploy-order selection", logFn);
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        window.risqueRuntimeHud.setControlVoiceText("DEAL COMPLETE — NEXT: DEPLOY ORDER", "");
      }
      setTimeout(function () {
        if (window.risqueNavigateWithFade) {
          window.risqueNavigateWithFade("game.html?phase=playerSelect&selectKind=deployOrder");
        } else {
          window.location.href = "game.html?phase=playerSelect&selectKind=deployOrder";
        }
      }, 3000);
    }

    function assignTerritory() {
      if (!territories.length) {
        finishDealAndAdvance();
        return;
      }

      var territoryIndex = Math.floor(Math.random() * territories.length);
      var territory = territories[territoryIndex];
      var player = players[currentPlayerIndex];
      if (!player.territories) player.territories = [];
      player.territories.push({ name: territory, troops: 1 });
      player.troopsTotal = (player.troopsTotal || 0) + 1;
      player.bankValue = (player.bankValue || 0) - 1;
      territories.splice(territoryIndex, 1);
      currentPlayerIndex = (currentPlayerIndex + 1) % players.length;

      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (e3) {
        logLines("Save error: " + e3.message, logFn);
      }

      window.gameUtils.renderTerritories(territory, gameState, {}, { popIn: true });
      window.gameUtils.renderStats(gameState);
      window.gameUtils.resizeCanvas();
      /* TV mirror: one-shot territory id so public board can use the same popIn grow as host (see game-shell). */
      gameState.risquePublicDealPopTerritory = territory;
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        window.risqueRuntimeHud.setControlVoiceText(
          "DEALING CARDS NOW — " + territories.length + " TERRITORIES LEFT",
          ""
        );
      } else if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      try {
        delete gameState.risquePublicDealPopTerritory;
      } catch (ePop) {
        /* ignore */
      }
      if (typeof window.risqueReplayRecordDeal === "function") {
        try {
          window.risqueReplayRecordDeal(gameState);
        } catch (eRep) {
          /* ignore */
        }
      }
      setTimeout(assignTerritory, 500);
    }

    if (!territories.length) {
      logLines("No territories left to assign — skipping second deal, advancing", logFn);
      if (typeof window.risqueReplayRecordDeal === "function") {
        try {
          window.risqueReplayRecordDeal(gameState);
        } catch (eRep0) {
          /* ignore */
        }
      }
      finishDealAndAdvance();
      return;
    }

    logLines("Starting deal animation (" + territories.length + " territories)", logFn);
    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      setTimeout(assignTerritory, 500);
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.deal = {
    run: run
  };
})();
