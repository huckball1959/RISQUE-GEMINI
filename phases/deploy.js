/**
 * Deployment — one module, two behaviors.
 *
 * URL: game.html?phase=deploy&kind=setup — first deployment (all players, starting armies).
 * URL: game.html?phase=deploy&kind=turn — income deploy, then attack.
 * Legacy ?phase=deploy1|deploy2 is rewritten to the above by game-shell.js.
 */
(function () {
  "use strict";

  var STYLE_ID_DEPLOY_TURN = "risque-deploy2-styles-v1";

  function loginRecoveryHref() {
    return window.risqueLoginRecoveryViaPrivacyUrl();
  }

  /**
   * Full-screen handoff before setup deploy UI is shown (streaming / hot-seat).
   * @param {string} playerName
   * @param {"first"|"next"} kind
   * @param {function()} onContinue
   * @param {function(string)=} logFn
   */
  function mountSetupDeployHandoff(playerName, kind, onContinue, logFn) {
    var label = (playerName || "the next player").toString();
    var msg =
      kind === "first"
        ? "Setup deployment\n\nHand the tablet to " +
          label +
          ".\n\nOnly this player should tap Continue."
        : "Hand the tablet to " +
          label +
          " for deployment.\n\nOnly this player should tap Continue.";
    if (
      !window.risquePhases ||
      !window.risquePhases.privacyGate ||
      typeof window.risquePhases.privacyGate.mount !== "function"
    ) {
      if (typeof logFn === "function") {
        logFn("[DeploySetup] Privacy gate unavailable; skipping handoff overlay.");
      }
      if (typeof onContinue === "function") onContinue();
      return;
    }
    window.risquePhases.privacyGate.mount(document.body, {
      message: msg,
      buttonLabel: "Continue",
      onContinue: function () {
        if (typeof onContinue === "function") onContinue();
      },
      onLog: logFn
    });
  }

  function injectDeployTurnStyles() {
    if (document.getElementById(STYLE_ID_DEPLOY_TURN)) return;

    var s = document.createElement("style");
    s.id = STYLE_ID_DEPLOY_TURN;
    s.textContent =
      ".deploy-player-name{font-family:Arial,sans-serif;font-size:58px;font-weight:bold;line-height:1.05;text-align:center;position:absolute;left:1152px;top:500px;width:704px;height:110px;z-index:10;pointer-events:none;" +
      "-webkit-text-stroke:2px #000000;text-shadow:-2px -2px 0 rgba(0,0,0,0.85),2px -2px 0 rgba(0,0,0,0.85),-2px 2px 0 rgba(0,0,0,0.85),2px 2px 0 rgba(0,0,0,0.85);}" +
      ".deploy-subline{display:block;font-size:44px;line-height:1.05;}" +
      ".bank-label,.bank-number{font-family:Arial,sans-serif;font-size:38px;font-weight:bold;text-align:center;position:absolute;z-index:10;pointer-events:none;color:#ffffff;" +
      "-webkit-text-stroke:2px #000000;text-shadow:-2px -2px 0 rgba(0,0,0,0.85),2px -2px 0 rgba(0,0,0,0.85),-2px 2px 0 rgba(0,0,0,0.85),2px 2px 0 rgba(0,0,0,0.85);}" +
      ".bank-label{left:1328px;top:666px;width:220px;height:72px;}" +
      ".bank-number{left:1548px;top:666px;width:144px;height:72px;}" +
      ".deploy-button{position:absolute;background:#dcdcdc;border:2px solid #000000;border-radius:4px;color:#000000;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;text-align:center;cursor:pointer;transition:background 0.2s,transform 0.1s;pointer-events:all;z-index:10;}" +
      ".deploy-button:hover:not(:disabled){background:#c0c0c0;}" +
      ".deploy-button:active:not(:disabled){transform:scale(0.95);}" +
      ".deploy-button:disabled{background:#e0e0e0;border-color:#999999;color:#999999;cursor:not-allowed;}";
    document.head.appendChild(s);
  }

  function logLineSetup(message, logFn) {
    var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var line = "[" + ts + "] [DeploySetup] " + message;
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

  /** Initial setup: cycle players until all starting banks empty → card-play order. */
  function runSetupDeploy(stageHost, opts) {
    opts = opts || {};
    var logFn = opts.log;
    window.risqueDeploy1Active = true;
    window.viewTroopsActive = false;
    if (typeof window.risqueSetMirrorDeployRoute === "function") {
      window.risqueSetMirrorDeployRoute("setup");
    }

    var canvas = document.getElementById("canvas");
    var uiOverlay = document.getElementById("ui-overlay");
    if (!canvas || !uiOverlay || !window.gameUtils) {
      logLineSetup("Missing canvas, ui-overlay, or gameUtils", logFn);
      return;
    }

    var phaseSlot = document.getElementById("risque-phase-content");
    if (!phaseSlot) {
      logLineSetup("Missing #risque-phase-content (setup HUD not ready)", logFn);
      return;
    }

    uiOverlay.className = "ui-overlay visible";
    uiOverlay.classList.remove("fade-out");

    phaseSlot.innerHTML =
      '<div class="deploy2-compact-root">' +
      '<div class="deploy2-bank-row">' +
      '<span class="deploy2-bank-label">Bank</span>' +
      '<span id="deploy1-bank-number" class="deploy2-bank-number">000</span>' +
      "</div>" +
      '<p class="deploy2-hint">Select a territory. Scroll the wheel or type a number and press Enter. Use − for removals.</p>' +
      '<div class="deploy2-actions deploy1-deploy-actions deploy1-deploy-actions--hud-row">' +
      '<button type="button" id="deploy1-reset" class="deploy1-action-btn">RESET</button>' +
      '<button type="button" id="deploy1-add-2" class="deploy1-action-btn">+2</button>' +
      '<button type="button" id="deploy1-add-5" class="deploy1-action-btn">+5</button>' +
      '<button type="button" id="deploy1-add-10" class="deploy1-action-btn">+10</button>' +
      '<button type="button" id="deploy1-add-all" class="deploy1-action-btn">ALL</button>' +
      '<button type="button" id="deploy1-confirm" class="deploy1-action-btn">CONFIRM</button>' +
      "</div>" +
      "</div>";

    var bankNumber = document.getElementById("deploy1-bank-number");
    var confirmButton = document.getElementById("deploy1-confirm");
    var resetButton = document.getElementById("deploy1-reset");

    var gameState = null;
    var deploymentOrder = [];
    var currentPlayerIndex = 0;
    var initialBankValues = {};
    var deploymentInitialized = false;
    var keyboardBuffer = "";
    var negativeInput = false;
    var deployedTroops = {};

    function renderMap(changedLabel) {
      window.gameState = gameState;
      window.deployedTroops = deployedTroops[gameState.currentPlayer] || {};
      window.gameUtils.renderAll(gameState, changedLabel, window.deployedTroops);
      if (typeof window.risquePersistHostGameState === "function") {
        window.risquePersistHostGameState();
      }
    }

    /** Drop deploy-only UI (bumps, white “bank” fill, +N satellites, mirror draft) and redraw — call after phase leaves deploy. */
    function clearDeployChromeThenRedraw() {
      window.gameState = gameState;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      window.deployedTroops = {};
      if (gameState.risqueDeployMirrorDraft) {
        delete gameState.risqueDeployMirrorDraft;
      }
      if (gameState.risqueDeployTransientPrimary) {
        delete gameState.risqueDeployTransientPrimary;
      }
      if (typeof window.risqueSetSpectatorFocus === "function") {
        window.risqueSetSpectatorFocus([]);
      }
      window.gameUtils.renderTerritories(null, gameState, {});
      window.gameUtils.renderStats(gameState);
    }

    function persistGameStateForPublicMirror() {
      try {
        if (window.gameState && !window.risqueDisplayIsPublic) {
          localStorage.setItem("gameState", JSON.stringify(window.gameState));
        }
      } catch (e0) {
        /* ignore */
      }
    }

    function updateDeployVoice(warnMessage) {
      if (!window.risqueRuntimeHud || typeof window.risqueRuntimeHud.setControlVoiceText !== "function") {
        return;
      }
      if (!gameState) return;
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var primary = player.name.toUpperCase() + "\nDEPLOY ALL TROOPS FROM YOUR BANK";
      if (warnMessage) {
        try {
          gameState.risquePublicDeployBanner =
            player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + String(warnMessage);
        } catch (eBanner0) {}
        window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + String(warnMessage), "");
        persistGameStateForPublicMirror();
        return;
      }
      if (typeof window.risqueRefreshDeployNarration === "function") {
        window.risqueRefreshDeployNarration(gameState);
        persistGameStateForPublicMirror();
        return;
      }
      var bank = Math.max(0, Number(player.bankValue) || 0);
      var r =
        bank === 0
          ? "0 troops remaining in bank — confirm when finished"
          : bank === 1
            ? "1 troop remaining in bank"
            : bank + " troops remaining in bank";
      try {
        gameState.risquePublicDeployBanner =
          player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + r;
      } catch (eBanner1) {}
      window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + r, "");
      persistGameStateForPublicMirror();
    }

    function updateBankDisplay() {
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      bankNumber.textContent = player ? player.bankValue.toString().padStart(3, "0") : "000";
      updateDeployVoice();
    }

    function onWheel(e) {
      if (!gameState || !window.selectedTerritory) return;
      e.preventDefault();
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      var territory = player && player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      var delta = e.deltaY > 0 ? -1 : 1;
      var newTroops = territory.troops + delta;
      if (newTroops < 1) {
        return;
      }
      if (delta > 0 && player.bankValue === 0) {
        window.gameUtils.showError("");
        updateDeployVoice("No troops left in bank.");
        return;
      }
      territory.troops = newTroops;
      player.bankValue -= delta;
      player.troopsTotal += delta;
      deployedTroops[player.name][territory.name] = territory.troops - 1;
      renderMap(window.selectedTerritory);
      updateBankDisplay();
      window.gameUtils.showError("");
      if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
        window.risqueSetSpectatorFocus([window.selectedTerritory]);
      }
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (err) {
        console.warn("[Deploy] Failed to save game state.");
      }
    }

    /** Move bank to selected territory until `leaveInBank` troops remain (wheel shortcut). */
    function applyBulkDeploySetup(leaveInBank) {
      leaveInBank = Math.max(0, Math.floor(Number(leaveInBank) || 0));
      if (!gameState || !window.selectedTerritory) {
        return;
      }
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var territory = player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      var bank = Math.max(0, Number(player.bankValue) || 0);
      var toAdd = bank - leaveInBank;
      if (toAdd <= 0) {
        window.gameUtils.showError("");
        updateDeployVoice(
          bank <= leaveInBank
            ? "Not enough in bank to leave " + leaveInBank + " behind on this territory."
            : ""
        );
        return;
      }
      territory.troops += toAdd;
      player.bankValue -= toAdd;
      player.troopsTotal += toAdd;
      deployedTroops[player.name][territory.name] = territory.troops - 1;
      renderMap(window.selectedTerritory);
      updateBankDisplay();
      window.gameUtils.showError("");
      if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
        window.risqueSetSpectatorFocus([window.selectedTerritory]);
      }
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (err) {
        console.warn("[Deploy] Failed to save game state.");
      }
    }

    function applyDeployFromBankSetup(troopChange) {
      troopChange = Math.floor(Number(troopChange) || 0);
      if (troopChange <= 0 || !gameState) return;
      if (!window.selectedTerritory) {
        return;
      }
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var territory = player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      var newTroops = territory.troops + troopChange;
      if (newTroops < 1) {
        return;
      }
      if (troopChange > player.bankValue) {
        window.gameUtils.showError("");
        updateDeployVoice(
          "Only " +
            player.bankValue +
            " troop" +
            (player.bankValue === 1 ? "" : "s") +
            " left in bank."
        );
        return;
      }
      territory.troops = newTroops;
      player.bankValue -= troopChange;
      player.troopsTotal += troopChange;
      deployedTroops[player.name][territory.name] = territory.troops - 1;
      renderMap(window.selectedTerritory);
      updateBankDisplay();
      window.gameUtils.showError("");
      if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
        window.risqueSetSpectatorFocus([window.selectedTerritory]);
      }
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (err) {
        console.warn("[Deploy] Failed to save game state.");
      }
    }

    function installDeploySetupAuxMenu() {
      window.risqueGetAuxMouseMenu = function () {
        if (!window.risqueDeploy1Active || !gameState) {
          return null;
        }
        return {
          title: "Deployment",
          hint: window.selectedTerritory
            ? "Thumb-button menu — or keep using the wheel on the map."
            : "Select a territory on the map first.",
          anchor: true,
          actions: [
            {
              label: "Confirm",
              action: function () {
                if (confirmButton) confirmButton.click();
              }
            },
            { label: "Cancel", action: function () {} },
            {
              label: "Put all but 1 in bank on territory",
              action: function () {
                applyBulkDeploySetup(1);
              }
            },
            {
              label: "Put all but 3 in bank on territory",
              action: function () {
                applyBulkDeploySetup(3);
              }
            },
            {
              label: "Reset",
              action: function () {
                if (resetButton) resetButton.click();
              }
            }
          ]
        };
      };
    }

    function onKeyDown(e) {
      if (!gameState || !window.selectedTerritory) return;
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      var territory = player && player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      if (e.key === "Enter") {
        if (keyboardBuffer === "") return;
        var troops = parseInt(keyboardBuffer, 10);
        if (isNaN(troops)) {
          keyboardBuffer = "";
          negativeInput = false;
          return;
        }
        var troopChange = negativeInput ? -troops : troops;
        var newTroops2 = territory.troops + troopChange;
        if (newTroops2 < 1) {
          keyboardBuffer = "";
          negativeInput = false;
          return;
        }
        if (troopChange > player.bankValue) {
          window.gameUtils.showError("");
          updateDeployVoice(
            "Only " + player.bankValue + " troop" + (player.bankValue === 1 ? "" : "s") + " left in bank."
          );
          keyboardBuffer = "";
          negativeInput = false;
          return;
        }
        territory.troops = newTroops2;
        player.bankValue -= troopChange;
        player.troopsTotal += troopChange;
        deployedTroops[player.name][territory.name] = territory.troops - 1;
        keyboardBuffer = "";
        negativeInput = false;
        var prettyT1 =
          window.gameUtils && window.gameUtils.formatTerritoryDisplayName
            ? window.gameUtils.formatTerritoryDisplayName(territory.name)
            : territory.name.replace(/_/g, " ");
        if (troopChange > 0 && typeof window.risqueDeployTroopCountToWord === "function") {
          gameState.risqueDeployTransientPrimary =
            player.name +
            " has deployed " +
            window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
            " troops to " +
            prettyT1 +
            ".";
        } else if (troopChange < 0 && typeof window.risqueDeployTroopCountToWord === "function") {
          gameState.risqueDeployTransientPrimary =
            player.name +
            " has removed " +
            window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
            " troops from " +
            prettyT1 +
            ".";
        }
        window.selectedTerritory = null;
        window.gameUtils.showError("");
        renderMap(null);
        updateBankDisplay();
        try {
          localStorage.setItem("gameState", JSON.stringify(gameState));
        } catch (err2) {
          console.warn("[Deploy] Failed to save game state.");
        }
      } else if (e.key === "-") {
        negativeInput = true;
        keyboardBuffer = "";
      } else if (e.key >= "0" && e.key <= "9") {
        keyboardBuffer += e.key;
        if (keyboardBuffer.length > 3) {
          keyboardBuffer = keyboardBuffer.slice(0, -1);
        }
      }
    }

    function initializeDeployment() {
      if (deploymentInitialized) return;
      window.gameUtils.loadGameState(function (loadedGameState) {
        if (!loadedGameState) {
          console.warn("[Deploy] Invalid game state. Redirecting.");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 1000);
          return;
        }
        gameState = loadedGameState;
        var invalidPlayer = gameState.players.find(function (p) {
          return !p.territories || p.territories.length === 0;
        });
        if (invalidPlayer) {
          console.warn("[Deploy] Invalid: player has no territories.");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 1000);
          return;
        }
        if (!gameState.currentPlayer || gameState.turnOrder.indexOf(gameState.currentPlayer) === -1) {
          console.warn("[Deploy] Invalid current player.");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 1000);
          return;
        }
        deploymentOrder = gameState.turnOrder.slice();
        currentPlayerIndex = deploymentOrder.indexOf(gameState.currentPlayer);
        gameState.phase = "deploy";
        gameState.players.forEach(function (player) {
          initialBankValues[player.name] = player.bankValue || 0;
          deployedTroops[player.name] = {};
          player.territories.forEach(function (t) {
            deployedTroops[player.name][t.name] = t.troops - 1;
          });
        });
        deploymentInitialized = true;
        logLineSetup("Initialized: currentPlayer=" + gameState.currentPlayer, logFn);
        window.viewTroopsActive = false;
        window.gameState = gameState;
        installDeploySetupAuxMenu();
        function revealSetupDeployAfterHandoff() {
          renderMap(null);
          updateBankDisplay();
          if (typeof window.risqueReplaySeedOpening === "function") {
            window.risqueReplaySeedOpening(gameState);
          }
          if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
            window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
          }
          if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
            requestAnimationFrame(function () {
              window.risqueRuntimeHud.syncPosition();
            });
          }
        }
        mountSetupDeployHandoff(gameState.currentPlayer, "first", revealSetupDeployAfterHandoff, logFn);
      });
    }

    resetButton.addEventListener("click", function () {
      var player = gameState && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) {
        console.warn("[Deploy] No current player.");
        return;
      }
      player.bankValue = initialBankValues[player.name] || 0;
      player.territories.forEach(function (t) {
        t.troops = 1;
        deployedTroops[player.name][t.name] = 0;
      });
      player.troopsTotal = player.territories.length;
      keyboardBuffer = "";
      negativeInput = false;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      window.gameUtils.showError("");
      renderMap(null);
      updateBankDisplay();
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (e) {
        console.warn("[Deploy] Failed to save game state.");
      }
    });

    confirmButton.addEventListener("click", function () {
      var player = gameState && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) {
        console.warn("[Deploy] No current player.");
        return;
      }
      if (player.bankValue > 0) {
        window.gameUtils.showError("");
        updateDeployVoice("Deploy every troop from your bank before confirming.");
        return;
      }
      if (gameState.players.every(function (p) {
        return p.bankValue === 0;
      })) {
        try {
          /* Next URL is playerSelect&selectKind=cardPlay — not cardplay yet; mirror/TV need phase playerSelect for name roulette. */
          gameState.phase = "playerSelect";
          clearDeployChromeThenRedraw();
          if (typeof window.risqueReplayRecordDeploy === "function") {
            window.risqueReplayRecordDeploy(gameState);
          }
          if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function") {
            window.risqueReplayTryWriteDdJsonAfterSetupDeploy(gameState);
          }
          localStorage.setItem("gameState", JSON.stringify(gameState));
          if (typeof window.risquePersistHostGameState === "function") {
            window.risquePersistHostGameState();
          }
          if (uiOverlay) uiOverlay.classList.remove("fade-out");
          setTimeout(function () {
            if (typeof window.risqueSetMirrorDeployRoute === "function") {
              window.risqueSetMirrorDeployRoute(null);
            }
            window.risqueDeploy1Active = false;
            if (window.risqueNavigateWithFade) {
              window.risqueNavigateWithFade("game.html?phase=playerSelect&selectKind=cardPlay");
            } else {
              window.location.href = "game.html?phase=playerSelect&selectKind=cardPlay";
            }
          }, 0);
        } catch (e) {
          console.warn("[Deploy] Failed to save game state.");
        }
        return;
      }
      currentPlayerIndex = (currentPlayerIndex + 1) % deploymentOrder.length;
      gameState.currentPlayer = deploymentOrder[currentPlayerIndex];
      keyboardBuffer = "";
      negativeInput = false;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      if (gameState.risqueDeployTransientPrimary) {
        delete gameState.risqueDeployTransientPrimary;
      }
      window.gameUtils.showError("");
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (e2) {
        console.warn("[Deploy] Failed to save game state.");
      }
      if (typeof window.risqueReplayRecordDeploy === "function") {
        window.risqueReplayRecordDeploy(gameState);
      }
      /* Handoff before the next deployer sees the map (streaming / hot-seat). */
      mountSetupDeployHandoff(gameState.currentPlayer, "next", function () {
        /* Redraw + mirror push BEFORE spectator focus: risqueSetSpectatorFocus pushes gameState and must see the new deployer’s window.deployedTroops (not the previous player’s). */
        renderMap(null);
        if (typeof window.risqueSetSpectatorFocus === "function") {
          window.risqueSetSpectatorFocus([]);
        }
        updateBankDisplay();
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
          window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        }
        if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
          requestAnimationFrame(function () {
            window.risqueRuntimeHud.syncPosition();
          });
        }
      }, logFn);
    });

    var deploy1Add2 = document.getElementById("deploy1-add-2");
    var deploy1Add5 = document.getElementById("deploy1-add-5");
    var deploy1Add10 = document.getElementById("deploy1-add-10");
    var deploy1AddAll = document.getElementById("deploy1-add-all");
    if (deploy1Add2) {
      deploy1Add2.addEventListener("click", function () {
        applyDeployFromBankSetup(2);
      });
    }
    if (deploy1Add5) {
      deploy1Add5.addEventListener("click", function () {
        applyDeployFromBankSetup(5);
      });
    }
    if (deploy1Add10) {
      deploy1Add10.addEventListener("click", function () {
        applyDeployFromBankSetup(10);
      });
    }
    if (deploy1AddAll) {
      deploy1AddAll.addEventListener("click", function () {
        applyBulkDeploySetup(0);
      });
    }

    var svg = document.querySelector(".svg-overlay");
    if (svg) svg.addEventListener("wheel", onWheel, { passive: false });

    document.addEventListener("keydown", onKeyDown);

    window.gameUtils.initGameView();
    requestAnimationFrame(function () {
      initializeDeployment();
      window.gameUtils.resizeCanvas();
    });
  }

  /** Turn deploy: single player, then attack. */
  function mountTurnDeploy(host, opts) {
    opts = opts || {};
    var attackUrl = opts.attackUrl || "game.html?phase=attack";
    var conquestAfterDeployQuery = !!opts.conquestAfterDeploy;
    try {
      if (new URLSearchParams(window.location.search || "").get("conquestAfterDeploy") === "1") {
        conquestAfterDeployQuery = true;
      }
    } catch (eCq) {
      /* ignore */
    }

    injectDeployTurnStyles();

    if (!window.gameUtils) {
      console.error("[DeployTurn] gameUtils missing");
      return;
    }

    if (typeof window.risqueSetMirrorDeployRoute === "function") {
      window.risqueSetMirrorDeployRoute("turn");
    }

    var uiOverlay = document.getElementById("ui-overlay");
    var stageSvg = document.querySelector(".svg-overlay");
    if (!uiOverlay || !stageSvg) {
      console.warn("[Deploy] Missing ui overlay or svg overlay.");
      return;
    }

    var gameState = window.gameState;
    if (!gameState || !gameState.players || !gameState.currentPlayer) {
      console.warn("[Deploy] Invalid game state for deploy (turn).");
      setTimeout(function () {
        window.location.href = loginRecoveryHref();
      }, 2000);
      return;
    }

    if (gameState.round === 1) {
      gameState.players.forEach(function (player) {
        if (player.cardCount > 1) {
          player.cardCount = 1;
          player.cards = player.cards.slice(0, 1);
        }
      });
    }

    /**
     * Classic turn deploy (income → deploy with no conquestAfterDeploy) must drop conquer-mode-only
     * cardplay/income flags. Otherwise stale risqueRuntimeCardplayIncomeMode + risqueConquestChainActive
     * from an old elimination/conquest session force con-income (books + “new” continents only) on the
     * next cardplay even during normal Risk turns.
     * Conquest deploy always uses ?conquestAfterDeploy=1 (see con-income-phase.js); keep flags until
     * con-transfertroops → attack or a later classic deploy clears them.
     */
    if (!conquestAfterDeployQuery && !window.risqueDisplayIsPublic) {
      var clearedConquestIncome = false;
      if (
        gameState.risqueRuntimeCardplayIncomeMode === "conquer" ||
        gameState.risqueRuntimeCardplayIncomeMode === "continental"
      ) {
        delete gameState.risqueRuntimeCardplayIncomeMode;
        clearedConquestIncome = true;
      }
      if (gameState.risqueConquestChainActive) {
        delete gameState.risqueConquestChainActive;
        clearedConquestIncome = true;
      }
      if (gameState.risqueConquestChainPaidContinents) {
        delete gameState.risqueConquestChainPaidContinents;
        clearedConquestIncome = true;
      }
      if (gameState.risqueConquestAttackEntryTurnKey != null || gameState.risqueConquestAttackEntryContinents) {
        delete gameState.risqueConquestAttackEntryTurnKey;
        delete gameState.risqueConquestAttackEntryContinents;
        if (window.gameUtils && typeof window.gameUtils.clearRisqueConquestAttackStartSession === "function") {
          window.gameUtils.clearRisqueConquestAttackStartSession();
        }
        delete gameState.risqueConquestStandardIncomeContinentKeysMeta;
        clearedConquestIncome = true;
      }
      if (clearedConquestIncome) {
        try {
          localStorage.setItem("gameState", JSON.stringify(gameState));
        } catch (eSavClr) {
          /* ignore */
        }
        if (typeof window.risqueHostReplaceShellGameState === "function") {
          window.risqueHostReplaceShellGameState(gameState);
        }
        if (typeof window.risquePersistHostGameState === "function") {
          window.risquePersistHostGameState();
        }
      }
    }

    var initialBankValues = {};
    var keyboardBuffer = "";
    var deployedTroops = {};
    var deploymentInitialized = false;

    function persistGameStateForPublicMirror() {
      try {
        if (window.gameState && !window.risqueDisplayIsPublic) {
          localStorage.setItem("gameState", JSON.stringify(window.gameState));
        }
      } catch (e0) {
        /* ignore */
      }
    }

    function pushDeployMirror() {
      if (typeof window.risquePersistHostGameState === "function") {
        window.risquePersistHostGameState();
      }
    }

    function updateDeployVoice(warnMessage) {
      if (!window.risqueRuntimeHud || typeof window.risqueRuntimeHud.setControlVoiceText !== "function") {
        return;
      }
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var primary = player.name.toUpperCase() + "\nDEPLOY ALL TROOPS FROM YOUR BANK";
      if (warnMessage) {
        try {
          gameState.risquePublicDeployBanner =
            player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + String(warnMessage);
        } catch (eBanner1) {}
        window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + String(warnMessage), "");
        persistGameStateForPublicMirror();
        return;
      }
      if (typeof window.risqueRefreshDeployNarration === "function") {
        window.risqueRefreshDeployNarration(gameState);
        persistGameStateForPublicMirror();
        return;
      }
      var bank = Math.max(0, Number(player.bankValue) || 0);
      var r =
        bank === 0
          ? "0 troops remaining in bank — confirm when finished"
          : bank === 1
            ? "1 troop remaining in bank"
            : bank + " troops remaining in bank";
      try {
        gameState.risquePublicDeployBanner =
          player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + r;
      } catch (eBanner2) {}
      window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + r, "");
      persistGameStateForPublicMirror();
    }

    function updateBankDisplay() {
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      var bankNumber = document.getElementById("bank-number");
      if (bankNumber) {
        var v = player ? Number(player.bankValue) : 0;
        bankNumber.textContent = (v || 0).toString().padStart(3, "0");
      }
      updateDeployVoice();
    }

    function updatePlayerNameDisplay() {
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (window.risqueRuntimeHud && document.getElementById("runtime-hud-root")) {
        window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        return;
      }
      var playerNameText = document.getElementById("player-name");
      if (playerNameText) {
        if (player) {
          playerNameText.innerHTML =
            player.name + '<span class="deploy-subline">is deploying</span>';
          playerNameText.style.color = window.gameUtils.colorMap[player.color] || "#000000";
        } else {
          playerNameText.textContent = "No Player";
          playerNameText.style.color = "#000000";
        }
      }
    }

    function initializeDeployment() {
      if (deploymentInitialized) return;

      var invalidPlayer = gameState.players.find(function (p) {
        return !p.territories || p.territories.length === 0;
      });
      if (invalidPlayer) {
        console.warn("[Deploy] Invalid game state: player has no territories.");
        setTimeout(function () {
          window.location.href = loginRecoveryHref();
        }, 2000);
        return;
      }

      var currentPlayer = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!currentPlayer) {
        console.warn("[Deploy] Current player not found.");
        setTimeout(function () {
          window.location.href = loginRecoveryHref();
        }, 2000);
        return;
      }

      initialBankValues = {};
      gameState.players.forEach(function (player) {
        initialBankValues[player.name] = Number(player.bankValue) || 0;
        var territoryTroops = (player.territories || []).reduce(function (sum, t) {
          return sum + (Number(t.troops) || 0);
        }, 0);
        player.troopsTotal = territoryTroops + (Number(player.bankValue) || 0);
      });

      deployedTroops = {};
      currentPlayer.territories.forEach(function (t) {
        deployedTroops[t.name] = 0;
      });

      window.deployedTroops = deployedTroops;
      window.viewTroopsActive = false;
      deploymentInitialized = true;

      gameState.phase = "deploy";
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (e2) {
        /* ignore */
      }

      window.gameState = gameState;
      window.gameUtils.renderAll(gameState, null, deployedTroops);
      updatePlayerNameDisplay();
      updateBankDisplay();
      pushDeployMirror();
    }

    function rerender(changedLabel) {
      /* Match setup deploy (renderMap): full map + stats; never toggle viewTroopsActive — markers use deploy bump + satellite. */
      window.gameState = gameState;
      window.deployedTroops = deployedTroops;
      window.gameUtils.renderAll(gameState, changedLabel, deployedTroops);
      updateBankDisplay();
      pushDeployMirror();
    }

    /** Same idea as setup deploy: after phase leaves deploy, one redraw without bumps / satellites / white fill. */
    function clearTurnDeployChromeThenRedraw() {
      window.gameState = gameState;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      deployedTroops = {};
      window.deployedTroops = {};
      if (gameState.risqueDeployMirrorDraft) {
        delete gameState.risqueDeployMirrorDraft;
      }
      if (gameState.risqueDeployTransientPrimary) {
        delete gameState.risqueDeployTransientPrimary;
      }
      if (typeof window.risqueSetSpectatorFocus === "function") {
        window.risqueSetSpectatorFocus([]);
      }
      window.gameUtils.renderTerritories(null, gameState, {});
      window.gameUtils.renderStats(gameState);
    }

    function bindWheelAndKeyboardHandlers() {
      stageSvg.addEventListener(
        "wheel",
        function (e) {
          if (!window.selectedTerritory) {
            return;
          }

          e.preventDefault();

          var player = gameState.players.find(function (p) {
            return p.name === gameState.currentPlayer;
          });
          if (!player) return;

          var territory = player.territories.find(function (t) {
            return t.name === window.selectedTerritory;
          });
          if (!territory) {
            return;
          }

          var delta = e.deltaY > 0 ? -1 : 1;
          var newTroops = territory.troops + delta;
          var newDeployedTroops =
            (deployedTroops[territory.name] || 0) + delta;

          if (newTroops < 1) {
            return;
          }
          if (delta < 0 && newDeployedTroops < 0) {
            return;
          }
          if (delta > 0 && player.bankValue === 0) {
            window.gameUtils.showError("");
            updateDeployVoice("No troops left in bank.");
            return;
          }

          territory.troops = newTroops;
          player.bankValue -= delta;
          player.troopsTotal =
            player.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + Number(player.bankValue);

          deployedTroops[territory.name] = newDeployedTroops;
          window.deployedTroops = deployedTroops;
          keyboardBuffer = "";

          window.gameUtils.showError("");
          requestAnimationFrame(function () {
            rerender(window.selectedTerritory);
            if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
              window.risqueSetSpectatorFocus([window.selectedTerritory]);
            }
          });

          try {
            localStorage.setItem("gameState", JSON.stringify(gameState));
          } catch (e2) {
            /* ignore */
          }
        },
        { passive: false }
      );

      document.addEventListener("keydown", function (e) {
        if (!window.selectedTerritory) {
          return;
        }

        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) return;

        var territory = player.territories.find(function (t) {
          return t.name === window.selectedTerritory;
        });
        if (!territory) {
          return;
        }

        if (e.key === "Enter") {
          if (keyboardBuffer === "") return;

          var troops = parseInt(keyboardBuffer, 10);
          if (isNaN(troops) || troops === 0) {
            keyboardBuffer = "";
            return;
          }

          var troopChange = troops;
          var newTroops = territory.troops + troopChange;
          var newDeployedTroops =
            (deployedTroops[territory.name] || 0) + troopChange;

          if (newTroops < 1) {
            keyboardBuffer = "";
            return;
          }
          if (troopChange < 0 && newDeployedTroops < 0) {
            keyboardBuffer = "";
            return;
          }
          if (troopChange > player.bankValue) {
            window.gameUtils.showError("");
            updateDeployVoice(
              "Only " + player.bankValue + " troop" + (player.bankValue === 1 ? "" : "s") + " left in bank."
            );
            keyboardBuffer = "";
            return;
          }

          territory.troops = newTroops;
          player.bankValue -= troopChange;
          player.troopsTotal =
            player.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + Number(player.bankValue);

          deployedTroops[territory.name] = newDeployedTroops;
          window.deployedTroops = deployedTroops;
          var prettyT =
            window.gameUtils && window.gameUtils.formatTerritoryDisplayName
              ? window.gameUtils.formatTerritoryDisplayName(territory.name)
              : territory.name.replace(/_/g, " ");
          if (troopChange > 0) {
            gameState.risqueDeployTransientPrimary =
              player.name +
              " has deployed " +
              window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
              " troops to " +
              prettyT +
              ".";
          } else if (troopChange < 0) {
            gameState.risqueDeployTransientPrimary =
              player.name +
              " has removed " +
              window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
              " troops from " +
              prettyT +
              ".";
          }
          window.selectedTerritory = null;
          keyboardBuffer = "";
          window.gameUtils.showError("");

          requestAnimationFrame(function () {
            rerender(territory.name);
          });

          try {
            localStorage.setItem("gameState", JSON.stringify(gameState));
          } catch (e2) {
            /* ignore */
          }
        } else if (e.key >= "0" && e.key <= "9") {
          keyboardBuffer += e.key;
          if (keyboardBuffer.length > 3) {
            keyboardBuffer = keyboardBuffer.slice(0, -1);
          }
        }
      });
    }

    function deployInit() {
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) {
        console.warn("[Deploy] Current player not found.");
        return;
      }

      var playerColor = window.gameUtils.colorMap[player.color] || "#000000";

      var useHud = !!window.risqueRuntimeHud;
      var deploySlotHtml = useHud
        ? '<div class="deploy2-compact-root">' +
          '<div class="deploy2-bank-row">' +
          '<span id="bank-label" class="deploy2-bank-label">Bank</span>' +
          '<span id="bank-number" class="deploy2-bank-number">000</span>' +
          "</div>" +
          '<p class="deploy2-hint">Select a territory. Scroll the wheel or type a number and press Enter. Use − for removals.</p>' +
          '<div class="deploy2-actions deploy1-deploy-actions deploy1-deploy-actions--hud-row">' +
          '<button type="button" id="reset" class="deploy1-action-btn" aria-label="Reset deployment">RESET</button>' +
          '<button type="button" id="deploy-add-2" class="deploy1-action-btn" aria-label="Add two troops from bank">+2</button>' +
          '<button type="button" id="deploy-add-5" class="deploy1-action-btn" aria-label="Add five troops from bank">+5</button>' +
          '<button type="button" id="deploy-add-10" class="deploy1-action-btn" aria-label="Add ten troops from bank">+10</button>' +
          '<button type="button" id="deploy-add-all" class="deploy1-action-btn" aria-label="Deploy all troops from bank to territory">ALL</button>' +
          '<button type="button" id="confirm" class="deploy1-action-btn" aria-label="Confirm deployment">CONFIRM</button>' +
          "</div>" +
          "</div>"
        : '<div id="bank-label" class="bank-label">Bank</div>' +
          '<div id="bank-number" class="bank-number">000</div>' +
          '<button type="button" id="reset" class="deploy-button" style="left: 1152px; top: 768px; width: 704px; height: 64px;">Reset</button>' +
          '<button type="button" id="confirm" class="deploy-button" style="left: 1152px; top: 864px; width: 704px; height: 64px;">Confirm</button>';
      if (window.risqueRuntimeHud) {
        if (typeof window.risqueRuntimeHud.ensureSetupUnifiedHud === "function") {
          window.risqueRuntimeHud.ensureSetupUnifiedHud(uiOverlay, "", { force: true });
        } else {
          window.risqueRuntimeHud.ensure(uiOverlay);
        }
        window.risqueRuntimeHud.clearPhaseSlot();
        window.risqueRuntimeHud.setAttackChromeInteractive(false);
        window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        var dSlot = document.getElementById("risque-phase-content");
        if (dSlot) dSlot.innerHTML = deploySlotHtml;
        if (gameState.risqueConquestChainActive) {
          var rhDep = document.getElementById("runtime-hud-root");
          if (rhDep) rhDep.classList.add("runtime-hud-root--cardplay-panel-only");
        }
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud) window.risqueRuntimeHud.syncPosition();
        });
      } else {
        uiOverlay.innerHTML =
          '<div id="player-name" class="deploy-player-name" style="color: ' +
          playerColor +
          '">' +
          player.name +
          '<span class="deploy-subline">is deploying</span>' +
          "</div>" +
          deploySlotHtml;
      }

      uiOverlay.classList.add("visible");
      uiOverlay.classList.remove("fade-out");

      if (!window.gameUtils.validateGameState(gameState)) {
        console.warn("[Deploy] Invalid game state.");
        return;
      }

      if (typeof window.risqueReplaySeedOpening === "function") {
        window.risqueReplaySeedOpening(gameState);
      }

      initializeDeployment();
      bindWheelAndKeyboardHandlers();

      var confirmButton = document.getElementById("confirm");
      var resetButton = document.getElementById("reset");

      if (!confirmButton || !resetButton) {
        console.warn("[Deploy] Missing critical DOM elements.");
        return;
      }

      resetButton.addEventListener("click", function () {
        var p = gameState.players.find(function (x) {
          return x.name === gameState.currentPlayer;
        });
        if (!p) return;

        p.bankValue = initialBankValues[p.name] || 0;
        p.territories.forEach(function (t) {
          var initialTroops = t.troops - (deployedTroops[t.name] || 0);
          t.troops = initialTroops > 0 ? initialTroops : 1;
        });
        p.troopsTotal =
          p.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(p.bankValue);

        deployedTroops = {};
        window.deployedTroops = deployedTroops;
        p.territories.forEach(function (t) {
          deployedTroops[t.name] = 0;
        });

        window.selectedTerritory = null;
        window.viewTroopsActive = false;
        keyboardBuffer = "";
        window.gameUtils.showError("");

        requestAnimationFrame(function () {
          window.gameState = gameState;
          window.deployedTroops = deployedTroops;
          window.gameUtils.renderAll(gameState, null, deployedTroops);
          updateBankDisplay();
        });

        try {
          localStorage.setItem("gameState", JSON.stringify(gameState));
        } catch (e2) {
          /* ignore */
        }
        pushDeployMirror();
      });

      function applyBulkDeployTurn(leaveInBank) {
        leaveInBank = Math.max(0, Math.floor(Number(leaveInBank) || 0));
        if (!gameState || !window.selectedTerritory) {
          return;
        }
        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) return;
        var territory = player.territories.find(function (t) {
          return t.name === window.selectedTerritory;
        });
        if (!territory) return;
        var bank = Math.max(0, Number(player.bankValue) || 0);
        var toAdd = bank - leaveInBank;
        if (toAdd <= 0) {
          window.gameUtils.showError("");
          updateDeployVoice(
            bank <= leaveInBank
              ? "Not enough in bank to leave " + leaveInBank + " behind."
              : ""
          );
          return;
        }
        var newTroops = territory.troops + toAdd;
        var newDeployedTroops = (deployedTroops[territory.name] || 0) + toAdd;
        if (newTroops < 1) {
          return;
        }
        var destBeforeBulk = Number(territory.troops || 0);
        territory.troops = newTroops;
        player.bankValue -= toAdd;
        player.troopsTotal =
          player.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(player.bankValue);
        deployedTroops[territory.name] = newDeployedTroops;
        window.deployedTroops = deployedTroops;
        keyboardBuffer = "";
        window.gameUtils.showError("");
        requestAnimationFrame(function () {
          rerender(window.selectedTerritory);
          if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
            window.risqueSetSpectatorFocus([window.selectedTerritory]);
          }
        });
        try {
          localStorage.setItem("gameState", JSON.stringify(gameState));
        } catch (e2) {
          /* ignore */
        }
        try {
          gameState.risqueTransferPulse = {
            label: territory.name,
            fromTroops: destBeforeBulk,
            toTroops: newTroops,
            startMs: Date.now(),
            durationMs: 1000
          };
          if (window.gameUtils && typeof window.gameUtils.risqueStartTransferPulseTicker === "function") {
            window.gameUtils.risqueStartTransferPulseTicker();
          }
        } catch (ePulseBulk) {
          /* ignore */
        }
        pushDeployMirror();
      }

      /** Add N troops from bank to selected territory (host HUD +2 / +5 / +10). */
      function applyDeployFromBank(troopChange) {
        troopChange = Math.floor(Number(troopChange) || 0);
        if (troopChange <= 0) return;
        if (!window.selectedTerritory) {
          return;
        }
        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) return;
        var territory = player.territories.find(function (t) {
          return t.name === window.selectedTerritory;
        });
        if (!territory) {
          return;
        }
        var newTroops = territory.troops + troopChange;
        var newDeployedTroops = (deployedTroops[territory.name] || 0) + troopChange;
        if (newTroops < 1) {
          return;
        }
        if (troopChange > player.bankValue) {
          window.gameUtils.showError("");
          updateDeployVoice(
            "Only " +
              player.bankValue +
              " troop" +
              (player.bankValue === 1 ? "" : "s") +
              " left in bank."
          );
          return;
        }
        var destBeforeDeploy = Number(territory.troops || 0);
        territory.troops = newTroops;
        player.bankValue -= troopChange;
        player.troopsTotal =
          player.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(player.bankValue);
        deployedTroops[territory.name] = newDeployedTroops;
        window.deployedTroops = deployedTroops;
        keyboardBuffer = "";
        window.gameUtils.showError("");
        var prettyT =
          window.gameUtils && window.gameUtils.formatTerritoryDisplayName
            ? window.gameUtils.formatTerritoryDisplayName(territory.name)
            : territory.name.replace(/_/g, " ");
        gameState.risqueDeployTransientPrimary =
          player.name +
          " has deployed " +
          window.risqueDeployTroopCountToWord(troopChange) +
          " troops to " +
          prettyT +
          ".";
        requestAnimationFrame(function () {
          rerender(window.selectedTerritory);
          if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
            window.risqueSetSpectatorFocus([window.selectedTerritory]);
          }
        });
        try {
          localStorage.setItem("gameState", JSON.stringify(gameState));
        } catch (e2) {
          /* ignore */
        }
        try {
          gameState.risqueTransferPulse = {
            label: territory.name,
            fromTroops: destBeforeDeploy,
            toTroops: newTroops,
            startMs: Date.now(),
            durationMs: 1000
          };
          if (window.gameUtils && typeof window.gameUtils.risqueStartTransferPulseTicker === "function") {
            window.gameUtils.risqueStartTransferPulseTicker();
          }
        } catch (ePulseDep) {
          /* ignore */
        }
        pushDeployMirror();
      }

      var deployAdd2 = document.getElementById("deploy-add-2");
      var deployAdd5 = document.getElementById("deploy-add-5");
      var deployAdd10 = document.getElementById("deploy-add-10");
      var deployAddAll = document.getElementById("deploy-add-all");
      if (deployAdd2) {
        deployAdd2.addEventListener("click", function () {
          applyDeployFromBank(2);
        });
      }
      if (deployAdd5) {
        deployAdd5.addEventListener("click", function () {
          applyDeployFromBank(5);
        });
      }
      if (deployAdd10) {
        deployAdd10.addEventListener("click", function () {
          applyDeployFromBank(10);
        });
      }
      if (deployAddAll) {
        deployAddAll.addEventListener("click", function () {
          applyBulkDeployTurn(0);
        });
      }

      window.risqueGetAuxMouseMenu = function () {
        if (window.risqueDeploy1Active || String(gameState.phase) !== "deploy") {
          return null;
        }
        return {
          title: "Deployment",
          hint: window.selectedTerritory
            ? "Thumb-button menu — or keep using the wheel on the map."
            : "Select a territory on the map first.",
          anchor: true,
          actions: [
            {
              label: "Confirm",
              action: function () {
                confirmButton.click();
              }
            },
            { label: "Cancel", action: function () {} },
            {
              label: "Put all but 1 in bank on territory",
              action: function () {
                applyBulkDeployTurn(1);
              }
            },
            {
              label: "Put all but 3 in bank on territory",
              action: function () {
                applyBulkDeployTurn(3);
              }
            },
            {
              label: "Reset",
              action: function () {
                resetButton.click();
              }
            }
          ]
        };
      };

      confirmButton.addEventListener("click", function () {
        var p = gameState.players.find(function (x) {
          return x.name === gameState.currentPlayer;
        });
        if (!p) return;
        if (p.bankValue > 0) {
          window.gameUtils.showError("");
          updateDeployVoice("Deploy every troop from your bank before confirming.");
          return;
        }

        p.troopsTotal = p.territories.reduce(function (sum, t) {
          return sum + (Number(t.troops) || 0);
        }, 0);

        var needsFinishConquestTransfer =
          (conquestAfterDeployQuery || gameState.risqueConquestChainActive) &&
          gameState.conqueredThisTurn === true &&
          gameState.attackingTerritory &&
          gameState.acquiredTerritory &&
          (gameState.attackPhase === "pending_transfer" || gameState.risqueConquestChainActive === true);

        if (needsFinishConquestTransfer) {
          try {
            gameState.phase = "con-transfertroops";
            gameState.risqueConquestTransferProceedTo = "attack";
            clearTurnDeployChromeThenRedraw();
            if (typeof window.risqueReplayRecordDeploy === "function") {
              window.risqueReplayRecordDeploy(gameState);
            }
            localStorage.setItem("gameState", JSON.stringify(gameState));
            pushDeployMirror();
            if (typeof window.risqueHostReplaceShellGameState === "function") {
              window.risqueHostReplaceShellGameState(gameState);
            }
            if (uiOverlay) uiOverlay.classList.remove("fade-out");
            setTimeout(function () {
              if (typeof window.risqueSetMirrorDeployRoute === "function") {
                window.risqueSetMirrorDeployRoute(null);
              }
              var destT = "con-transfertroops.html";
              if (window.risqueNavigateWithFade) {
                window.risqueNavigateWithFade(destT);
              } else {
                window.location.href = destT;
              }
            }, 0);
          } catch (eCt) {
            console.warn("[Deploy] Failed to save game state.");
          }
          return;
        }

        try {
          gameState.phase = "attack";
          clearTurnDeployChromeThenRedraw();
          if (typeof window.risqueReplayRecordDeploy === "function") {
            window.risqueReplayRecordDeploy(gameState);
          }
          localStorage.setItem("gameState", JSON.stringify(gameState));
          pushDeployMirror();
          if (typeof window.risqueHostReplaceShellGameState === "function") {
            window.risqueHostReplaceShellGameState(gameState);
          }
          if (uiOverlay) uiOverlay.classList.remove("fade-out");
          setTimeout(function () {
            if (typeof window.risqueSetMirrorDeployRoute === "function") {
              window.risqueSetMirrorDeployRoute(null);
            }
            var dest = attackUrl;
            /* Old bookmarked attack.html; attack phase is game.html?phase=attack */
            if (typeof dest === "string" && dest.indexOf("attack.html") !== -1) {
              dest = "game.html?phase=attack";
            }
            if (window.risqueNavigateWithFade) {
              window.risqueNavigateWithFade(dest);
            } else {
              window.location.href = dest;
            }
          }, 0);
        } catch (e) {
          console.warn("[Deploy] Failed to save game state.");
        }
      });
    }

    deployInit();
    requestAnimationFrame(function () {
      if (window.gameUtils && window.gameUtils.resizeCanvas) {
        window.gameUtils.resizeCanvas();
      }
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.deploy1 = { run: runSetupDeploy };
  window.risquePhases.deploy2 = { mount: mountTurnDeploy };
  window.risquePhases.deploy = {
    runSetup: runSetupDeploy,
    runTurn: mountTurnDeploy,
    deployKindFromPhase: function (ph) {
      var s = String(ph || "").trim();
      if (s === "deploy1") return "setup";
      if (s === "deploy2") return "turn";
      return null;
    }
  };
})();
