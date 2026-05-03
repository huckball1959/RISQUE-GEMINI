/**
 * Conquest optional troop move after deploy (was con-transfertroops.html).
 * Mounted from game.html ?phase=con-transfertroops or when saved phase is con-transfertroops.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-con-transfertroops-phase-v1";

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
      ".risque-con-trooptransfer-stack{display:flex;flex-direction:column;gap:12px;padding:8px 4px 12px;max-width:100%;}" +
      ".risque-con-trooptransfer-msg{font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#f8fafc;line-height:1.45;}" +
      ".risque-con-trooptransfer-actions{display:flex;flex-direction:column;gap:8px;}" +
      ".risque-con-trooptransfer-btn{min-height:36px;padding:8px 14px;border:0;border-radius:6px;font-family:Arial,sans-serif;font-size:15px;font-weight:800;cursor:pointer;background:#0f172a;color:#f8fafc;border:1px solid #334155;}" +
      ".risque-con-trooptransfer-btn:hover:not(:disabled){background:#1e293b;}" +
      ".risque-con-trooptransfer-btn:disabled{opacity:0.45;cursor:not-allowed;}" +
      ".risque-con-trooptransfer-btn--primary{background:#e2e8f0;color:#0f172a;border-color:#e2e8f0;}" +
      ".risque-con-trooptransfer-btn--primary:hover:not(:disabled){background:#cbd5e1;}" +
      ".risque-con-trooptransfer-popup{margin-top:8px;padding:14px;border:2px solid #334155;border-radius:8px;background:#1e293b;color:#f8fafc;font-family:Arial,sans-serif;font-size:14px;display:none;}" +
      ".risque-con-trooptransfer-popup.is-open{display:block;}" +
      ".risque-con-trooptransfer-popup-msg{margin-bottom:10px;}" +
      ".risque-con-trooptransfer-popup-input{width:100%;box-sizing:border-box;margin-bottom:10px;padding:6px 8px;border-radius:4px;border:1px solid #64748b;background:#0f172a;color:#f8fafc;}" +
      ".risque-con-trooptransfer-popup-row{display:flex;gap:8px;flex-wrap:wrap;}" +
      ".risque-con-trooptransfer-popup-row button{flex:1;min-width:100px;padding:8px 12px;border:0;border-radius:6px;font-weight:700;cursor:pointer;background:#334155;color:#f8fafc;}" +
      ".risque-con-trooptransfer-popup-row button:hover:not(:disabled){background:#475569;}" +
      ".risque-con-trooptransfer-public-hint{font-size:12px;font-weight:600;color:#94a3b8;margin-top:4px;}";
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

  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;

    function logToStorage(message, data) {
      var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      var logEntry = "[" + ts + "] [TroopTransfer] " + message;
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

    var currentPlayer = null;
    var transferCompleted = false;

    function maxAdditionalTroopsMovable(gs) {
      if (!gs || !gs.attackingTerritory) return 0;
      var t = Number(gs.attackingTerritory.troops) || 0;
      return Math.max(0, t - 1);
    }

    function validateGameState(gs) {
      var requiredFields = ["phase", "players", "turnOrder", "currentPlayer", "round"];
      var isValid =
        gs &&
        requiredFields.every(function (field) {
          return Object.prototype.hasOwnProperty.call(gs, field);
        }) &&
        gs.phase === "con-transfertroops" &&
        gs.players.length >= 1;
      if (!isValid) {
        logToStorage("Invalid game state", gs);
        window.gameUtils.showError("Invalid game state. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return false;
      }
      currentPlayer = gs.players.find(function (p) {
        return p.name === gs.currentPlayer;
      });
      if (!currentPlayer) {
        logToStorage("Current player not found");
        window.gameUtils.showError("Current player not found. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return false;
      }
      if (gs.attackingTerritory && gs.attackingTerritory.name) {
        var atLive = currentPlayer.territories.find(function (t) {
          return t.name === gs.attackingTerritory.name;
        });
        if (atLive) {
          gs.attackingTerritory = { name: atLive.name, troops: Number(atLive.troops) || 0 };
        }
      }
      if (gs.acquiredTerritory && gs.acquiredTerritory.name) {
        var acLive = currentPlayer.territories.find(function (t) {
          return t.name === gs.acquiredTerritory.name;
        });
        if (acLive) {
          gs.acquiredTerritory = { name: acLive.name, troops: Number(acLive.troops) || 0 };
        }
      }
      if (gs.conqueredThisTurn === undefined) {
        logToStorage("conqueredThisTurn undefined, defaulting to false");
        gs.conqueredThisTurn = false;
      }
      if (!gs.conqueredThisTurn) {
        logToStorage("No conquest this turn, redirecting to runtime cardplay");
        window.gameUtils.showError("No troops to transfer. Redirecting to card play.");
        setTimeout(function () {
          navigateTo("game.html?phase=cardplay");
        }, 2000);
        return false;
      }
      if (!gs.attackingTerritory || !gs.acquiredTerritory) {
        logToStorage("Missing attack data", {
          attackingTerritory: gs.attackingTerritory,
          acquiredTerritory: gs.acquiredTerritory
        });
        window.gameUtils.showError("Missing attack data. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return false;
      }
      if (
        !currentPlayer.territories.some(function (t) {
          return t.name === gs.attackingTerritory.name;
        }) ||
        !currentPlayer.territories.some(function (t) {
          return t.name === gs.acquiredTerritory.name;
        })
      ) {
        logToStorage("Invalid territory ownership", {
          attackingTerritory: gs.attackingTerritory && gs.attackingTerritory.name,
          acquiredTerritory: gs.acquiredTerritory && gs.acquiredTerritory.name,
          player: currentPlayer.name
        });
        window.gameUtils.showError("Invalid territory ownership. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return false;
      }
      var adjacencyMap = window.gameUtils.getAdjacencyMap ? window.gameUtils.getAdjacencyMap() : {};
      if (
        !adjacencyMap[gs.attackingTerritory.name] ||
        adjacencyMap[gs.attackingTerritory.name].indexOf(gs.acquiredTerritory.name) === -1
      ) {
        logToStorage("Territories not adjacent", {
          attackingTerritory: gs.attackingTerritory.name,
          acquiredTerritory: gs.acquiredTerritory.name
        });
        window.gameUtils.showError("Territories not adjacent. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return false;
      }
      var maxAdd = maxAdditionalTroopsMovable(gs);
      if (maxAdd < 1) {
        logToStorage(
          "No optional troops to move (minimum already placed or only garrison left); skipping transfer UI",
          {
            attackingTerritory: gs.attackingTerritory && gs.attackingTerritory.name,
            troops: gs.attackingTerritory && gs.attackingTerritory.troops
          }
        );
        transferCompleted = true;
      }
      return true;
    }

    function showPopup(slot, message, buttons, showInput, error) {
      var popup = document.getElementById("risque-con-trooptransfer-popup");
      if (!popup) {
        popup = document.createElement("div");
        popup.id = "risque-con-trooptransfer-popup";
        popup.className = "risque-con-trooptransfer-popup";
        popup.innerHTML =
          '<div id="risque-con-trooptransfer-popup-msg" class="risque-con-trooptransfer-popup-msg"></div>' +
          '<input id="risque-con-trooptransfer-popup-input" type="number" class="risque-con-trooptransfer-popup-input" />' +
          '<div class="risque-con-trooptransfer-popup-row">' +
          '<button type="button" id="risque-con-trooptransfer-popup-confirm">Confirm</button>' +
          '<button type="button" id="risque-con-trooptransfer-popup-cancel">Cancel</button>' +
          "</div>";
        slot.appendChild(popup);
      }
      var msgEl = document.getElementById("risque-con-trooptransfer-popup-msg");
      var inp = document.getElementById("risque-con-trooptransfer-popup-input");
      var cBtn = document.getElementById("risque-con-trooptransfer-popup-confirm");
      var xBtn = document.getElementById("risque-con-trooptransfer-popup-cancel");
      if (msgEl) {
        while (msgEl.firstChild) {
          msgEl.removeChild(msgEl.firstChild);
        }
        msgEl.appendChild(document.createTextNode(message));
      }
      if (inp) {
        inp.style.display = showInput ? "block" : "none";
        inp.value = showInput ? "1" : "";
      }
      if (error && msgEl) {
        var err = document.createElement("div");
        err.textContent = error;
        err.style.marginTop = "8px";
        err.style.color = "#fca5a5";
        msgEl.appendChild(err);
      }
      if (cBtn) cBtn.textContent = (buttons[0] && buttons[0].label) || "Confirm";
      if (xBtn) xBtn.textContent = (buttons[1] && buttons[1].label) || "Cancel";
      if (cBtn) {
        cBtn.onclick =
          (buttons[0] && buttons[0].onClick) ||
          function () {
            popup.classList.remove("is-open");
          };
      }
      if (xBtn) {
        xBtn.onclick =
          (buttons[1] && buttons[1].onClick) ||
          function () {
            popup.classList.remove("is-open");
          };
      }
      popup.classList.add("is-open");
      logToStorage("Popup shown: " + message, { error: error || "" });
    }

    function closePopup() {
      var popup = document.getElementById("risque-con-trooptransfer-popup");
      if (popup) popup.classList.remove("is-open");
    }

    function handleTroopTransfer(gs, slot) {
      if (window.risqueDisplayIsPublic) return;
      if (transferCompleted) {
        window.gameUtils.showError("Troop transfer already completed.");
        logToStorage("Troop transfer attempted after completion");
        return;
      }
      var maxTroops = maxAdditionalTroopsMovable(gs);
      var minTroops = 1;
      if (maxTroops < minTroops) {
        transferCompleted = true;
        var pb = document.getElementById("risque-con-trooptransfer-proceed");
        var tb = document.getElementById("risque-con-trooptransfer-transfer");
        if (pb) pb.disabled = false;
        if (tb) tb.disabled = true;
        window.gameUtils.showError("");
        logToStorage("No additional troops to move; use Proceed", {
          troops: gs.attackingTerritory.troops
        });
        return;
      }
      showPopup(
        slot,
        "Transfer troops from " +
          gs.attackingTerritory.name.replace(/_/g, " ").toUpperCase() +
          " to " +
          gs.acquiredTerritory.name.replace(/_/g, " ").toUpperCase() +
          " (min " +
          minTroops +
          ", max " +
          maxTroops +
          ")",
        [
          {
            label: "Confirm",
            onClick: function () {
              var troopsInput = document.getElementById("risque-con-trooptransfer-popup-input");
              var troops = parseInt(troopsInput && troopsInput.value, 10);
              if (isNaN(troops) || troops < minTroops || troops > maxTroops) {
                closePopup();
                showPopup(
                  slot,
                  "Enter troops (min " + minTroops + ", max " + maxTroops + ")",
                  [
                    {
                      label: "Confirm",
                      onClick: function () {}
                    },
                    {
                      label: "Cancel",
                      onClick: function () {
                        closePopup();
                      }
                    }
                  ],
                  true,
                  "Please enter a number between " + minTroops + " and " + maxTroops + "."
                );
                logToStorage("Invalid troop input", { troops: troops, minTroops: minTroops, maxTroops: maxTroops });
                return;
              }
              var attackerTerritory = currentPlayer.territories.find(function (t) {
                return t.name === gs.attackingTerritory.name;
              });
              var acquiredTerritory = currentPlayer.territories.find(function (t) {
                return t.name === gs.acquiredTerritory.name;
              });
              attackerTerritory.troops -= troops;
              acquiredTerritory.troops += troops;
              currentPlayer.troopsTotal = currentPlayer.territories.reduce(function (sum, t) {
                return sum + t.troops;
              }, 0);
              transferCompleted = true;
              logToStorage("Troops transferred", {
                from: attackerTerritory.name,
                to: acquiredTerritory.name,
                troops: troops,
                fromTroops: attackerTerritory.troops,
                toTroops: acquiredTerritory.troops,
                troopsTotal: currentPlayer.troopsTotal
              });
              persist(gs);
              window.gameUtils.renderTerritories(null, gs);
              closePopup();
              var tb2 = document.getElementById("risque-con-trooptransfer-transfer");
              var pb2 = document.getElementById("risque-con-trooptransfer-proceed");
              if (tb2) tb2.disabled = true;
              if (pb2) pb2.disabled = false;
              logToStorage("Transfer completed, Proceed button enabled");
            }
          },
          {
            label: "Cancel",
            onClick: function () {
              closePopup();
            }
          }
        ],
        true
      );
    }

    function handleProceed(gs) {
      if (window.risqueDisplayIsPublic) return;
      var proceedTo = gs.risqueConquestTransferProceedTo;
      if (proceedTo === "attack") {
        if (!transferCompleted && gs.conqueredThisTurn) {
          window.gameUtils.showError("Complete troop transfer first.");
          logToStorage("Proceed attempted before transfer (finale → attack)");
          return;
        }
        delete gs.risqueConquestIncomeBaselineLocked;
        if (typeof window.gameUtils.ensureContinentsSnapshotBaseline === "function") {
          window.gameUtils.ensureContinentsSnapshotBaseline(gs);
        }
        gs.phase = "attack";
        gs.attackPhase = "attack";
        gs.attackingTerritory = null;
        gs.acquiredTerritory = null;
        gs.minTroopsToTransfer = 0;
        gs.conqueredThisTurn = false;
        delete gs.risqueConquestTransferProceedTo;
        delete gs.risqueConquestChainActive;
        delete gs.risqueConquestChainPaidContinents;
        delete gs.risqueRuntimeCardplayIncomeMode;
        delete gs.risqueConquestAttackEntryTurnKey;
        delete gs.risqueConquestAttackEntryContinents;
        if (window.gameUtils && typeof window.gameUtils.clearRisqueConquestAttackStartSession === "function") {
          window.gameUtils.clearRisqueConquestAttackStartSession();
        }
        delete gs.risqueConquestStandardIncomeContinentKeysMeta;
        try {
          persist(gs);
        } catch (eSave) {
          logToStorage("Save before attack failed", { error: eSave.message || String(eSave) });
        }
        logToStorage("Conquest troop transfer finished; navigating to attack", { phase: gs.phase });
        var uio = document.getElementById("ui-overlay");
        if (uio) uio.classList.add("fade-out");
        setTimeout(function () {
          navigateTo("game.html?phase=attack");
        }, 2000);
        return;
      }
      if (!transferCompleted && gs.conqueredThisTurn) {
        window.gameUtils.showError("Complete troop transfer first.");
        logToStorage("Proceed attempted before transfer");
        return;
      }
      gs.phase = "con-cardplay";
      gs.attackingTerritory = null;
      gs.acquiredTerritory = null;
      gs.minTroopsToTransfer = 0;
      gs.conqueredThisTurn = false;
      delete gs.risqueConquestTransferProceedTo;
      persist(gs);
      logToStorage("Navigating to runtime cardplay", { phase: gs.phase });
      var uio2 = document.getElementById("ui-overlay");
      if (uio2) uio2.classList.add("fade-out");
      setTimeout(function () {
        navigateTo("game.html?phase=cardplay");
      }, 2000);
    }

    injectStyles();
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    var gs = window.gameState;
    if (!gs) {
      logToStorage("No game state");
      window.gameUtils.showError("No game state found. Redirecting to launch.");
      setTimeout(function () {
        navigateTo(loginRecoveryHref());
      }, 2000);
      return;
    }

    try {
      if (window.location.protocol !== "file:") {
        var params = new URLSearchParams(window.location.search);
        if (params.get("phase") !== "con-transfertroops") {
          params.set("phase", "con-transfertroops");
          var qs = params.toString();
          var newUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
          window.history.replaceState(null, "", newUrl);
        }
      }
    } catch (eHist) {
      /* ignore */
    }

    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      window.risqueRuntimeHud.updateTurnBannerFromState(gs);
    }

    if (!validateGameState(gs)) return;

    var attackingTerritoryName = gs.attackingTerritory.name.replace(/_/g, " ").toUpperCase();
    var acquiredTerritoryName = gs.acquiredTerritory.name.replace(/_/g, " ").toUpperCase();

    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
      window.risqueRuntimeHud.setControlVoiceText(
        String(currentPlayer.name || "").toUpperCase() + " — TROOP TRANSFER",
        "Move optional troops from " + attackingTerritoryName + " into " + acquiredTerritoryName + ".",
        { force: true }
      );
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
      ? '<p class="risque-con-trooptransfer-public-hint">Host completes this step on the private screen.</p>'
      : "";

    slot.innerHTML =
      '<div class="risque-con-trooptransfer-stack">' +
      '<div class="risque-con-trooptransfer-msg">' +
      escapeHtml("Transfer troops from " + attackingTerritoryName + " to " + acquiredTerritoryName) +
      "</div>" +
      publicHint +
      '<div class="risque-con-trooptransfer-actions">' +
      '<button type="button" id="risque-con-trooptransfer-transfer" class="risque-con-trooptransfer-btn risque-con-trooptransfer-btn--primary">' +
      "Transfer Troops" +
      "</button>" +
      '<button type="button" id="risque-con-trooptransfer-proceed" class="risque-con-trooptransfer-btn">' +
      "Proceed" +
      "</button>" +
      "</div>" +
      "</div>";

    var transferButton = document.getElementById("risque-con-trooptransfer-transfer");
    var proceedButton = document.getElementById("risque-con-trooptransfer-proceed");
    if (transferCompleted && proceedButton) {
      proceedButton.disabled = false;
      if (transferButton) transferButton.disabled = true;
    }
    if (window.risqueDisplayIsPublic) {
      if (transferButton) transferButton.disabled = true;
      if (proceedButton) proceedButton.disabled = true;
    } else {
      if (transferButton) {
        transferButton.addEventListener("click", function () {
          handleTroopTransfer(gs, slot);
        });
      }
      if (proceedButton) {
        proceedButton.addEventListener("click", function () {
          handleProceed(gs);
        });
      }
    }

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    logToStorage("Troop transfer UI mounted (runtime)", {
      player: currentPlayer.name,
      attackingTerritory: attackingTerritoryName,
      acquiredTerritory: acquiredTerritoryName
    });

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      window.gameUtils.initGameView();
      window.gameUtils.renderTerritories(null, gs);
      window.gameUtils.renderStats(gs);
      if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
        window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.conTransfertroops = { mount: mount };
})();
