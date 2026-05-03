/**
 * Continental conquest deploy (was con-deploy.html). Bank → territories via wheel / keypad;
 * then attack or con-transfertroops. Mounted from game.html ?phase=con-deploy.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-con-deploy-phase-v1";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "#risque-con-deploy-legacy{position:absolute;left:0;top:0;width:100%;height:100%;z-index:15;pointer-events:none;}" +
      "#risque-con-deploy-legacy .risque-con-deploy-ui{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:auto;opacity:1;transition:opacity 1s ease-in-out;}" +
      "#risque-con-deploy-legacy.fade-out .risque-con-deploy-ui{opacity:0;pointer-events:none;}" +
      "#risque-con-deploy-legacy .deploy-player-name{font-family:Arial,sans-serif;font-size:40px;font-weight:bold;text-align:center;" +
      "position:absolute;left:1152px;top:508px;width:704px;height:64px;z-index:10;pointer-events:none;}" +
      "#risque-con-deploy-legacy .bank-label,#risque-con-deploy-legacy .bank-number{font-family:Arial,sans-serif;font-size:30px;font-weight:bold;" +
      "text-align:center;position:absolute;z-index:10;pointer-events:none;}" +
      "#risque-con-deploy-legacy .bank-label{left:1344px;top:672px;width:200px;height:64px;}" +
      "#risque-con-deploy-legacy .bank-number{left:1536px;top:672px;width:128px;height:64px;}" +
      "#risque-con-deploy-legacy .deploy-button{position:absolute;background:#dcdcdc;border:2px solid #000;border-radius:4px;color:#000;" +
      "font-family:Arial,sans-serif;font-size:16px;font-weight:bold;text-align:center;cursor:pointer;" +
      "transition:background .2s,transform .1s;pointer-events:auto;z-index:10;}" +
      "#risque-con-deploy-legacy .deploy-button:hover:not(:disabled){background:#c0c0c0;}" +
      "#risque-con-deploy-legacy .deploy-button:active:not(:disabled){transform:scale(.95);}" +
      "#risque-con-deploy-legacy .deploy-button:disabled{background:#e0e0e0;border-color:#999;color:#999;cursor:not-allowed;}" +
      "@media (max-width:1400px){" +
      "#risque-con-deploy-legacy .deploy-player-name{left:50%;transform:translateX(-50%);top:max(12px,8vh);width:min(704px,94vw);}" +
      "#risque-con-deploy-legacy .bank-label,#risque-con-deploy-legacy .bank-number{position:relative;left:auto;top:auto;display:block;margin:8px auto;text-align:center;}" +
      "#risque-con-deploy-legacy .deploy-button{position:relative;left:auto!important;top:auto!important;width:min(704px,94vw)!important;margin:8px auto;display:block;}" +
      "}";
    document.head.appendChild(st);
  }

  function loginRecoveryHref() {
    if (typeof window.risqueLoginRecoveryViaPrivacyUrl === "function") {
      return window.risqueLoginRecoveryViaPrivacyUrl();
    }
    return "index.html";
  }

  function navigateTo(url) {
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(url);
    } else {
      window.location.href = url;
    }
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    injectStyles();
    try {
      document.body.classList.remove("risque-con-cardplay-mounted");
    } catch (eRm) {
      /* ignore */
    }
    try {
      document.body.classList.remove("risque-con-income-mounted");
    } catch (eRm2) {
      /* ignore */
    }
    document.body.classList.add("risque-con-deploy-mounted");

    var canvas = document.getElementById("canvas");
    if (!canvas || !window.gameUtils) {
      return;
    }
    var prev = document.getElementById("risque-con-deploy-legacy");
    if (prev && prev.parentNode) {
      prev.parentNode.removeChild(prev);
    }
    var shell = document.createElement("div");
    shell.id = "risque-con-deploy-legacy";
    var ui = document.createElement("div");
    ui.id = "risque-con-deploy-ui";
    ui.className = "risque-con-deploy-ui";
    shell.appendChild(ui);
    canvas.appendChild(shell);

    if (window.risqueDisplayIsPublic) {
      shell.style.pointerEvents = "none";
    }

    function logToStorage(message, data) {
      var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      var logEntry = "[" + ts + "] [ConDeploy] " + message;
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
      if (typeof onLog === "function") {
        onLog(logEntry, data);
      }
    }

    function conDeployInit() {
      var deploymentOrder = [];
      var currentPlayerIndex = 0;
      var initialBankValues = {};
      var deploymentInitialized = false;
      var keyboardBuffer = "";
      var deployedTroops = {};

      function validateGameState(gs) {
        var requiredFields = ["phase", "players", "turnOrder", "currentPlayer", "round"];
        var isValid =
          requiredFields.every(function (field) {
            return Object.prototype.hasOwnProperty.call(gs, field);
          }) &&
          (gs.phase === "con-deploy" || gs.phase === "con-income") &&
          gs.players.length >= 2;
        if (!isValid) {
          logToStorage("Game state invalid", gs);
          console.warn("[ConDeploy] Invalid game state. Redirecting to launch.");
          setTimeout(function () {
            navigateTo(loginRecoveryHref());
          }, 2000);
          return false;
        }
        if (gs.phase === "con-income") {
          gs.phase = "con-deploy";
          logToStorage("Corrected phase from con-income to con-deploy", { phase: gs.phase });
          try {
            localStorage.setItem("gameState", JSON.stringify(gs));
          } catch (eC) {
            /* ignore */
          }
        }
        return true;
      }

      function updateBankDisplay(gs) {
        var player = gs.players
          ? gs.players.find(function (p) {
              return p.name === gs.currentPlayer;
            })
          : null;
        var bankNumber = ui.querySelector("#bank-number");
        if (bankNumber) {
          bankNumber.textContent = player ? String(player.bankValue || 0).padStart(3, "0") : "000";
          logToStorage("Updated bank display: " + bankNumber.textContent);
        }
      }

      function updatePlayerNameDisplay(gs) {
        var player = gs.players
          ? gs.players.find(function (p) {
              return p.name === gs.currentPlayer;
            })
          : null;
        var playerNameText = ui.querySelector("#player-name");
        if (playerNameText) {
          playerNameText.textContent = player ? player.name : "No Player";
          playerNameText.style.color = player
            ? window.gameUtils.colorMap[player.color] || "#000000"
            : "#000000";
          logToStorage("Updated player name: " + playerNameText.textContent);
        }
      }

      function initializeDeployment(gs) {
        if (deploymentInitialized || !gs.players) {
          logToStorage("Deployment already initialized or no players");
          return;
        }
        var invalidPlayer = gs.players.find(function (p) {
          return !p.territories || p.territories.length === 0;
        });
        if (invalidPlayer) {
          logToStorage("Player has no territories: " + invalidPlayer.name);
          console.warn("[ConDeploy] Invalid game state: player has no territories.");
          setTimeout(function () {
            navigateTo(loginRecoveryHref());
          }, 2000);
          return;
        }
        if (!gs.currentPlayer || gs.turnOrder.indexOf(gs.currentPlayer) === -1) {
          logToStorage("Invalid currentPlayer or turnOrder: " + gs.currentPlayer);
          console.warn("[ConDeploy] Invalid game state: no current player.");
          setTimeout(function () {
            navigateTo(loginRecoveryHref());
          }, 2000);
          return;
        }
        deploymentOrder = gs.turnOrder.slice();
        currentPlayerIndex = deploymentOrder.indexOf(gs.currentPlayer);
        gs.phase = "con-deploy";
        gs.players.forEach(function (player) {
          player.bankValue = player.bankValue || 0;
          initialBankValues[player.name] = player.bankValue;
          player.troopsTotal =
            player.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + player.bankValue;
        });
        deployedTroops = {};
        window.deployedTroops = deployedTroops;
        var player = gs.players.find(function (p) {
          return p.name === gs.currentPlayer;
        });
        if (player) {
          player.territories.forEach(function (t) {
            deployedTroops[t.name] = 0;
          });
        }
        window.viewTroopsActive = false;
        deploymentInitialized = true;
        logToStorage(
          "Deployment initialized: currentPlayer=" + gs.currentPlayer + ", bankValue=" + (player && player.bankValue),
          deployedTroops
        );
        try {
          localStorage.setItem("gameState", JSON.stringify(gs));
        } catch (eS) {
          /* ignore */
        }
        window.gameUtils.renderTerritories(null, gs, deployedTroops);
        updatePlayerNameDisplay(gs);
        updateBankDisplay(gs);
        window.gameUtils.renderStats(gs);
        if (typeof window.risqueReplaySeedOpening === "function") {
          window.risqueReplaySeedOpening(gs);
        }
      }

      function deployInit(gs) {
        logToStorage("Initialized for " + (gs.currentPlayer || "no current player"));
        var player = gs.players
          ? gs.players.find(function (p) {
              return p.name === gs.currentPlayer;
            })
          : null;
        if (!player) {
          logToStorage("Error: Current player not found");
          console.warn("[ConDeploy] Current player not found. Redirecting.");
          setTimeout(function () {
            navigateTo(loginRecoveryHref());
          }, 2000);
          return;
        }
        var playerColor = window.gameUtils.colorMap[player.color] || "#000000";
        ui.innerHTML =
          '<div id="player-name" class="deploy-player-name" style="color:' +
          playerColor +
          '">' +
          player.name +
          "</div>" +
          '<div id="bank-label" class="bank-label">Bank</div>' +
          '<div id="bank-number" class="bank-number">' +
          String(player.bankValue || 0).padStart(3, "0") +
          "</div>" +
          '<button type="button" id="view-troops" class="deploy-button" style="left:1152px;top:768px;width:704px;height:64px;" aria-label="View troops placed">View Troops Placed</button>' +
          '<button type="button" id="reset" class="deploy-button" style="left:1152px;top:864px;width:704px;height:64px;" aria-label="Reset troop deployment">Reset</button>' +
          '<button type="button" id="confirm" class="deploy-button" style="left:1152px;top:960px;width:704px;height:64px;" aria-label="Confirm troop deployment">Confirm</button>';
        logToStorage("UI overlay rendered");
        if (!validateGameState(gs)) {
          return;
        }
        if ((player.bankValue || 0) === 0) {
          logToStorage("No troops to deploy, checking for pending conquest troop transfer", { bankValue: player.bankValue });
          console.warn("[ConDeploy] No troops available to deploy. Returning to attack.");
          setTimeout(function () {
            var gs0 = window.gameState;
            if (gs0) delete gs0.risqueConquestIncomeBaselineLocked;
            if (gs0 && typeof window.gameUtils.ensureContinentsSnapshotBaseline === "function") {
              window.gameUtils.ensureContinentsSnapshotBaseline(gs0);
            }
            var needsT =
              gs0 &&
              gs0.conqueredThisTurn === true &&
              gs0.attackingTerritory &&
              gs0.acquiredTerritory &&
              (gs0.attackPhase === "pending_transfer" || gs0.risqueConquestChainActive === true);
            if (needsT) {
              gs0.phase = "con-transfertroops";
              gs0.risqueConquestTransferProceedTo = "attack";
              try {
                localStorage.setItem("gameState", JSON.stringify(gs0));
              } catch (e0) {
                /* ignore */
              }
              navigateTo("game.html?phase=con-transfertroops");
              return;
            }
            try {
              if (gs0) localStorage.setItem("gameState", JSON.stringify(gs0));
            } catch (e0b) {
              /* ignore */
            }
            navigateTo("game.html?phase=attack");
          }, 2000);
          return;
        }
        initializeDeployment(gs);
        var svg = canvas.querySelector(".svg-overlay");
        var confirmButton = ui.querySelector("#confirm");
        var resetButton = ui.querySelector("#reset");
        var viewTroopsButton = ui.querySelector("#view-troops");
        if (!svg || !confirmButton || !resetButton || !viewTroopsButton) {
          logToStorage("Error: Missing critical DOM elements");
          console.warn("[ConDeploy] Missing critical DOM elements.");
          return;
        }
        viewTroopsButton.addEventListener("click", function () {
          logToStorage("View Troops button clicked");
          window.viewTroopsActive = !window.viewTroopsActive;
          logToStorage("View Troops active: " + window.viewTroopsActive, deployedTroops);
          requestAnimationFrame(function () {
            window.gameUtils.renderTerritories(null, window.gameState, deployedTroops);
            window.gameUtils.renderStats(window.gameState);
          });
        });
        svg.addEventListener("click", function () {
          logToStorage("SVG clicked, checking selectedTerritory", { selectedTerritory: window.selectedTerritory });
        });
        svg.addEventListener("wheel", function (e) {
          var gsw = window.gameState;
          if (!window.selectedTerritory) {
            return;
          }
          e.preventDefault();
          var pw = gsw.players
            ? gsw.players.find(function (p) {
                return p.name === gsw.currentPlayer;
              })
            : null;
          var territory = pw
            ? pw.territories.find(function (t) {
                return t.name === window.selectedTerritory;
              })
            : null;
          if (!territory) {
            return;
          }
          var delta = e.deltaY > 0 ? -1 : 1;
          var currentTroops = territory.troops || 1;
          var isNewlyConquered = window.selectedTerritory === "middle_east";
          var minTroops = isNewlyConquered ? 3 : 1;
          var newTroops = Math.max(minTroops, currentTroops + delta);
          var newDeployedTroops = (deployedTroops[window.selectedTerritory] || 0) + delta;
          logToStorage(
            "Wheel event: territory=" +
              window.selectedTerritory +
              ", delta=" +
              delta +
              ", troops=" +
              currentTroops +
              ", newTroops=" +
              newTroops +
              ", deployedTroops=" +
              newDeployedTroops +
              ", bankValue=" +
              (pw && pw.bankValue)
          );
          if (delta > 0 && (pw.bankValue || 0) === 0) {
            return;
          }
          if (delta < 0 && newDeployedTroops < 0) {
            return;
          }
          territory.troops = newTroops;
          pw.bankValue = (pw.bankValue || 0) - delta;
          pw.troopsTotal =
            pw.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + (pw.bankValue || 0);
          deployedTroops[window.selectedTerritory] = newDeployedTroops;
          window.deployedTroops = deployedTroops;
          keyboardBuffer = "";
          window.gameUtils.showError("");
          requestAnimationFrame(function () {
            window.gameUtils.renderTerritories(window.selectedTerritory, window.gameState, deployedTroops);
            updateBankDisplay(gsw);
            window.gameUtils.renderStats(window.gameState);
          });
          try {
            localStorage.setItem("gameState", JSON.stringify(window.gameState));
          } catch (eW) {
            /* ignore */
          }
        });
        document.addEventListener("keydown", function onKeyDown(e) {
          var gsk = window.gameState;
          if (!gsk || String(gsk.phase || "") !== "con-deploy") {
            return;
          }
          if (!window.selectedTerritory) {
            return;
          }
          var pk = gsk.players
            ? gsk.players.find(function (p) {
                return p.name === gsk.currentPlayer;
              })
            : null;
          var terr = pk
            ? pk.territories.find(function (t) {
                return t.name === window.selectedTerritory;
              })
            : null;
          if (!terr) {
            return;
          }
          if (e.key === "Enter") {
            if (keyboardBuffer === "") return;
            var troops = parseInt(keyboardBuffer, 10);
            if (isNaN(troops) || troops === 0) {
              keyboardBuffer = "";
              return;
            }
            var isNewlyConqueredK = window.selectedTerritory === "middle_east";
            var minTroopsK = isNewlyConqueredK ? 3 : 1;
            var troopChange = troops;
            var newTroopsK = terr.troops + troopChange;
            var newDeployedTroopsK = (deployedTroops[window.selectedTerritory] || 0) + troopChange;
            if (newTroopsK < minTroopsK) {
              keyboardBuffer = "";
              return;
            }
            if (troopChange < 0 && newDeployedTroopsK < 0) {
              keyboardBuffer = "";
              return;
            }
            if (troopChange > (pk.bankValue || 0)) {
              keyboardBuffer = "";
              return;
            }
            terr.troops = newTroopsK;
            pk.bankValue = (pk.bankValue || 0) - troopChange;
            pk.troopsTotal =
              pk.territories.reduce(function (sum, t) {
                return sum + (Number(t.troops) || 0);
              }, 0) + (pk.bankValue || 0);
            deployedTroops[window.selectedTerritory] = newDeployedTroopsK;
            window.deployedTroops = deployedTroops;
            window.selectedTerritory = null;
            keyboardBuffer = "";
            window.gameUtils.showError("");
            requestAnimationFrame(function () {
              window.gameUtils.renderTerritories(terr.name, window.gameState, deployedTroops);
              updateBankDisplay(gsk);
              window.gameUtils.renderStats(window.gameState);
            });
            try {
              localStorage.setItem("gameState", JSON.stringify(window.gameState));
            } catch (eK) {
              /* ignore */
            }
          } else if (e.key >= "0" && e.key <= "9") {
            keyboardBuffer += e.key;
            if (keyboardBuffer.length > 3) {
              keyboardBuffer = keyboardBuffer.slice(0, -1);
            }
          }
        });
        resetButton.addEventListener("click", function () {
          logToStorage("Reset button clicked");
          var pr = window.gameState.players
            ? window.gameState.players.find(function (p) {
                return p.name === window.gameState.currentPlayer;
              })
            : null;
          if (!pr) {
            console.warn("[ConDeploy] No current player.");
            return;
          }
          pr.bankValue = initialBankValues[pr.name] || 0;
          pr.territories.forEach(function (t) {
            var initialTroops = t.troops - (deployedTroops[t.name] || 0);
            t.troops = initialTroops >= 1 ? initialTroops : t.name === "middle_east" ? 3 : 1;
          });
          pr.troopsTotal =
            pr.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + (pr.bankValue || 0);
          deployedTroops = {};
          window.deployedTroops = deployedTroops;
          pr.territories.forEach(function (t) {
            deployedTroops[t.name] = 0;
          });
          window.viewTroopsActive = false;
          window.selectedTerritory = null;
          keyboardBuffer = "";
          window.gameUtils.showError("");
          requestAnimationFrame(function () {
            window.gameUtils.renderTerritories(null, window.gameState, deployedTroops);
            updateBankDisplay(window.gameState);
            window.gameUtils.renderStats(window.gameState);
          });
          try {
            localStorage.setItem("gameState", JSON.stringify(window.gameState));
          } catch (eR) {
            /* ignore */
          }
        });
        confirmButton.addEventListener("click", function () {
          var pc = window.gameState.players
            ? window.gameState.players.find(function (p) {
                return p.name === window.gameState.currentPlayer;
              })
            : null;
          if (!pc) {
            console.warn("[ConDeploy] No current player.");
            return;
          }
          if ((pc.bankValue || 0) > 0) {
            return;
          }
          pc.troopsTotal = pc.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0);
          try {
            var gs = window.gameState;
            delete gs.risqueConquestIncomeBaselineLocked;
            if (typeof window.gameUtils.ensureContinentsSnapshotBaseline === "function") {
              window.gameUtils.ensureContinentsSnapshotBaseline(gs);
            }
            var needsFinishConquestTransfer =
              gs.conqueredThisTurn === true &&
              gs.attackingTerritory &&
              gs.acquiredTerritory &&
              (gs.attackPhase === "pending_transfer" || gs.risqueConquestChainActive === true);
            if (needsFinishConquestTransfer) {
              gs.phase = "con-transfertroops";
              gs.risqueConquestTransferProceedTo = "attack";
              if (typeof window.risqueReplayRecordDeploy === "function") {
                window.risqueReplayRecordDeploy(gs);
              }
              localStorage.setItem("gameState", JSON.stringify(gs));
              logToStorage("Conquest deploy done; con-transfertroops", {
                phase: gs.phase,
                attacking: gs.attackingTerritory.name,
                acquired: gs.acquiredTerritory.name
              });
              shell.classList.add("fade-out");
              setTimeout(function () {
                navigateTo("game.html?phase=con-transfertroops");
              }, 2000);
              return;
            }
            gs.phase = "attack";
            if (typeof window.risqueReplayRecordDeploy === "function") {
              window.risqueReplayRecordDeploy(gs);
            }
            localStorage.setItem("gameState", JSON.stringify(gs));
            logToStorage("Conquest deploy done; return to attack", { phase: gs.phase, bankValue: pc.bankValue });
            shell.classList.add("fade-out");
            setTimeout(function () {
              navigateTo("game.html?phase=attack");
            }, 2000);
          } catch (err) {
            logToStorage("Failed to save game state: " + (err && err.message ? err.message : String(err)));
            console.warn("[ConDeploy] Failed to save game state.");
          }
        });
      }

      var gs0 = window.gameState;
      if (!gs0) {
        logToStorage("No game state");
        console.warn("[ConDeploy] No game state. Redirecting.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return;
      }
      deployInit(gs0);
      window.gameUtils.initGameView();
      window.gameUtils.renderTerritories(null, gs0);
      window.gameUtils.renderStats(gs0);
    }

    function beginAfterState(gs) {
      if (!gs) {
        console.warn("[ConDeploy] No game state. Redirecting.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return;
      }
      window.gameState = gs;
      try {
        if (window.location.protocol !== "file:") {
          var params = new URLSearchParams(window.location.search);
          if (params.get("phase") !== "con-deploy") {
            params.set("phase", "con-deploy");
            var qs = params.toString();
            window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
          }
        }
      } catch (eH) {
        /* ignore */
      }
      try {
        gs.phase = "con-deploy";
        localStorage.setItem("gameState", JSON.stringify(gs));
      } catch (eP) {
        /* ignore */
      }
      if (typeof window.risqueHostReplaceShellGameState === "function") {
        window.risqueHostReplaceShellGameState(gs);
      }
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      if (typeof onLog === "function") {
        onLog("Con-deploy mount: state ready", { phase: gs.phase, currentPlayer: gs.currentPlayer });
      }
      conDeployInit();
      window.addEventListener("resize", function () {
        requestAnimationFrame(function () {
          if (window.gameUtils && window.gameUtils.resizeCanvas) {
            window.gameUtils.resizeCanvas();
          }
        });
      });
      document.addEventListener(
        "wheel",
        function (e) {
          if (e.ctrlKey) e.preventDefault();
        },
        { passive: false }
      );
      document.addEventListener("keydown", function (e) {
        if (e.key === "Equal" || e.key === "Minus" || (e.ctrlKey && (e.key === "+" || e.key === "-"))) {
          e.preventDefault();
        }
      });
    }

    window.gameUtils.loadGameState(beginAfterState);
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.conDeploy = { mount: mount };
})();
