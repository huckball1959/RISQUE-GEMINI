/**
 * Conquer-mode income — `phase=con-income` (not “continental”; “con” = conquer). Absorbed from legacy con-income.html.
 * Campaign = from attack phase entry until an elimination before leaving attack. “New” continent pay uses
 * continents newly completed since attack entry (continentsSnapshot) vs current board.
 * When pendingNew is empty after recompute, apply the same territory + held-continent reinforcement as
 * phases/income.js — otherwise a played book (+10) could be the only payout (old fallback only ran when
 * total was &lt; 1). Continents the attacker fully held at **attack phase mount** (every
 * `?phase=attack` host mount refreshes `risqueConquestAttackEntryContinents`) define campaign “new”;
 * cardplay `continentsSnapshot` is only used if that list is still empty (e.g. legacy save).
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-con-income-phase-v3";

  function injectStyles() {
    var legacy = document.getElementById("risque-con-income-phase-v1");
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
    legacy = document.getElementById("risque-con-income-phase-v2");
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "#risque-con-income-legacy{position:absolute;left:0;top:0;width:100%;height:100%;z-index:15;pointer-events:none;}" +
      "#risque-con-income-legacy .risque-con-income-ui{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:auto;opacity:1;transition:opacity 1s ease-in-out;}" +
      "#risque-con-income-legacy .income-player-name{font-family:Arial,sans-serif;font-size:20px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:.5px;text-shadow:2px 2px 2px rgba(0,0,0,.7);position:absolute;left:1110px;top:250px;z-index:10;pointer-events:none;}" +
      "#risque-con-income-legacy .income-table-container{position:absolute;top:309px;left:1120px;width:760px;z-index:10;visibility:visible;opacity:0;transition:opacity 1s ease-in-out;}" +
      "#risque-con-income-legacy .income-table-container.visible{opacity:1;}" +
      "#risque-con-income-legacy .income-table{border-collapse:collapse;width:100%;}" +
      "#risque-con-income-legacy .income-table th,#risque-con-income-legacy .income-table td{border:2px solid #000;padding:8px;text-align:center;font-family:Arial,sans-serif;font-size:11.1375px;font-weight:bold;}" +
      "#risque-con-income-legacy .income-table th{background-color:#ccc;}" +
      "#risque-con-income-legacy .income-table td{background-color:#fff;}" +
      "#risque-con-income-legacy .income-button{width:258px;height:36px;margin:10px auto 0;position:relative;background:#000;color:#fff;font-family:Arial,sans-serif;" +
      "font-size:16px;font-weight:bold;text-align:center;border:none;border-radius:4px;cursor:pointer;z-index:10;visibility:visible;opacity:0;transition:opacity 1s ease-in-out;display:block;}" +
      "#risque-con-income-legacy .income-button.visible{opacity:1;}" +
      "#risque-con-income-legacy .income-button:hover:not(:disabled){background:#1a1a1a;color:#fff;}" +
      "#risque-con-income-legacy .income-button:active:not(:disabled){transform:scale(.95);}" +
      "#risque-con-income-legacy .income-button:disabled{opacity:.5;cursor:not-allowed;}" +
      "@media (max-width:1400px){" +
      "#risque-con-income-legacy .income-player-name{left:50%;transform:translateX(-50%);top:max(12px,6vh);max-width:min(920px,94vw);text-align:center;}" +
      "#risque-con-income-legacy .income-table-container{left:50%;transform:translateX(-50%);top:max(72px,14vh);width:min(760px,96vw);max-height:min(560px,70vh);overflow:auto;}" +
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

  /**
   * con-cardplay renames/hides #ui-overlay; game-shell's HUD + income grid target that element.
   * Restore it when entering con-income so control-voice + maybeEnsureRuntimeHud work on the host.
   */
  function unstashHostUiOverlayFromConPhases() {
    var ids = ["risque-ui-overlay-stashed-con-cardplay", "risque-ui-overlay-stashed-con-income"];
    var i;
    for (i = 0; i < ids.length; i++) {
      var u = document.getElementById(ids[i]);
      if (!u) continue;
      var prev =
        (u.dataset && u.dataset.risqueConCardplayPrevId) ||
        (u.dataset && u.dataset.risqueConIncomePrevId) ||
        "ui-overlay";
      u.id = prev;
      try {
        delete u.dataset.risqueConCardplayStash;
        delete u.dataset.risqueConCardplayPrevId;
        delete u.dataset.risqueConIncomeStash;
        delete u.dataset.risqueConIncomePrevId;
      } catch (eDs) {
        /* ignore */
      }
      u.removeAttribute("hidden");
      u.style.visibility = "";
    }
  }

  function conIncomeNewCardId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function logToStorage(message, data) {
    var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var logEntry = "[" + ts + "] [ConIncome] " + message;
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
  }

  function computeOwnedContinents(player) {
    var owned = [];
    var continents = window.gameState && window.gameState.continents;
    if (!continents || !player || !player.territories) return owned;
    var cont;
    for (cont in continents) {
      if (!Object.prototype.hasOwnProperty.call(continents, cont)) continue;
      var data = continents[cont];
      if (
        data &&
        data.territories &&
        data.territories.every(function (t) {
          return player.territories.some(function (pt) {
            return pt.name === t;
          });
        })
      ) {
        owned.push(cont);
      }
    }
    return owned;
  }

  function conIncomeInit() {
    try {
      var uiOverlay = document.getElementById("risque-con-income-ui");
      if (!uiOverlay) {
        logToStorage("UI overlay not found");
        window.gameUtils.showError("UI overlay not found");
        return;
      }
      var gameState = window.gameState;
      try {
        delete gameState.risquePublicIncomeBreakdown;
      } catch (eBr0) {
        /* ignore */
      }
      if (!gameState || !gameState.players || !gameState.currentPlayer || !gameState.continentCollectionCounts) {
        logToStorage("Invalid game state");
        window.gameUtils.showError("Invalid game state. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return;
      }
      var currentPlayer = gameState.players.find(function (p) {
        return (
          p &&
          String(p.name || "").toUpperCase() === String(gameState.currentPlayer || "").toUpperCase()
        );
      });
      if (!currentPlayer) {
        logToStorage("Current player not found");
        window.gameUtils.showError("Current player not found. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return;
      }
      if (typeof window.gameUtils.getRisqueConquestAttackStartBaselineList === "function") {
        var baselineRestore = window.gameUtils.getRisqueConquestAttackStartBaselineList(gameState);
        if (baselineRestore.length) {
          var btk =
            (Number(gameState.round) || 1) + "|" + String(gameState.currentPlayer || "");
          gameState.risqueConquestAttackEntryTurnKey = btk;
          gameState.risqueConquestAttackEntryContinents = baselineRestore.slice();
        }
      }
      /* Recompute when baselines exist; if that yields nothing but conquer already set pending (e.g. snapshot missing in save), keep conquer's list. */
      if (typeof window.gameUtils.computePendingNewContinentsForConquest === "function") {
        var recomputed = window.gameUtils.computePendingNewContinentsForConquest(gameState);
        var prevPending = gameState.pendingNewContinents;
        if (recomputed && recomputed.length > 0) {
          gameState.pendingNewContinents = recomputed;
        } else if (Array.isArray(prevPending) && prevPending.length > 0) {
          gameState.pendingNewContinents = prevPending;
        } else {
          gameState.pendingNewContinents = recomputed || [];
        }
        /* computePendingNewContinentsForConquest already filters attack-entry baseline; re-apply if state was only adjusted above. */
        gameState.pendingNewContinents = window.gameUtils.computePendingNewContinentsForConquest(gameState);
        if (typeof window.gameUtils.filterConIncomePendingContinentsArray === "function") {
          gameState.pendingNewContinents = window.gameUtils.filterConIncomePendingContinentsArray(gameState);
        }
      }
      if (!Object.keys(gameState.continentsSnapshot || {}).length) {
        logToStorage("WARNING: continentsSnapshot empty — deploy/attack should set baseline before dice", {
          phase: gameState.phase,
          currentPlayer: gameState.currentPlayer
        });
      }
      currentPlayer.bankValue = currentPlayer.bankValue || 0;
      var playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
      var bookCount = currentPlayer.bookValue || 0;
      var bookBonus = bookCount * 10;
      var continentBonus = 0;
      var ownedContinents = computeOwnedContinents(currentPlayer);
      var snapshot = gameState.continentsSnapshot || {};
      var snapshotOwned = Object.keys(snapshot).filter(function (key) {
        return snapshot[key];
      });
      var pendingNew = gameState.pendingNewContinents || [];
      var attackEntryContinents =
        typeof window.gameUtils.getRisqueConquestAttackStartBaselineList === "function"
          ? window.gameUtils.getRisqueConquestAttackStartBaselineList(gameState)
          : gameState.risqueConquestAttackEntryContinents || [];
      logToStorage("Income continent trace", {
        snapshotOwned: snapshotOwned,
        turnStartKeys: Object.keys(gameState.risqueTurnStartContinentsSnapshot || {}),
        ownedContinents: ownedContinents,
        pendingNew: pendingNew,
        collectionCounts: gameState.continentCollectionCounts,
        baselineLocked: !!gameState.risqueConquestIncomeBaselineLocked,
        attackEntryContinents: attackEntryContinents,
        chainActive: !!gameState.risqueConquestChainActive,
        runtimeIncomeMode: gameState.risqueRuntimeCardplayIncomeMode || ""
      });
      var continentDetails = "";
      var continentRowsForMirror = [];
      var cdn = window.gameUtils && window.gameUtils.continentDisplayNames;
      pendingNew.forEach(function (key) {
        if (
          window.gameUtils &&
          typeof window.gameUtils.shouldSkipConIncomeBaselineContinent === "function" &&
          window.gameUtils.shouldSkipConIncomeBaselineContinent(gameState, key)
        ) {
          logToStorage("Con-income skip pending continent (baseline / standard income already paid)", {
            key: key
          });
          return;
        }
        var collectionCount = gameState.continentCollectionCounts[key] || 0;
        var bonus =
          typeof window.gameUtils.getContinentConquestIncomeValue === "function"
            ? window.gameUtils.getContinentConquestIncomeValue(gameState, key)
            : window.gameUtils.getNextContinentValue(key, collectionCount);
        continentBonus += bonus;
        continentDetails +=
          key.toUpperCase() + "(collections=" + collectionCount + ")(next rung)=" + bonus + ", ";
        logToStorage("New continent bonus: " + key, { collections: collectionCount, bonus: bonus });
        var disp = (cdn && cdn[key]) || String(key);
        var nm = String(disp)
          .replace("South America", "S. America")
          .replace("North America", "N. America");
        continentRowsForMirror.push({ name: nm, bonus: bonus });
      });
      continentDetails = continentDetails.slice(0, -2) || "NONE";
      var territoryCount = (currentPlayer.territories || []).length;
      var territoryBonusRow = 0;
      var skipTerritoryRow = true;
      var continentBonusHeld = 0;
      var useStandardHeldSupplement =
        pendingNew.length === 0 &&
        territoryCount > 0 &&
        window.gameUtils &&
        typeof window.gameUtils.getPlayerContinents === "function" &&
        typeof window.gameUtils.getNextContinentValue === "function";
      var skipHeldContinentFromPreAttackBaseline = true;

      if (useStandardHeldSupplement) {
        territoryBonusRow = Math.max(Math.floor(territoryCount / 3), 3);
        skipTerritoryRow = false;
        var heldDisplay = window.gameUtils.getPlayerContinents(currentPlayer);
        var hi;
        for (hi = 0; hi < heldDisplay.length; hi++) {
          var cNm = heldDisplay[hi];
          var cKey = null;
          var dn = window.gameUtils.continentDisplayNames;
          if (dn && typeof dn === "object") {
            for (var k0 in dn) {
              if (!Object.prototype.hasOwnProperty.call(dn, k0)) continue;
              if (dn[k0] === cNm) {
                cKey = k0;
                break;
              }
            }
          }
          if (cKey == null) continue;
          if (
            skipHeldContinentFromPreAttackBaseline &&
            window.gameUtils &&
            typeof window.gameUtils.shouldSkipConIncomeBaselineContinent === "function" &&
            window.gameUtils.shouldSkipConIncomeBaselineContinent(gameState, cKey)
          ) {
            continue;
          }
          var cVal = window.gameUtils.getNextContinentValue(cKey, gameState.continentCollectionCounts[cKey] || 0);
          if (cVal > 0) {
            continentBonusHeld += cVal;
            var dispH = (cdn && cdn[cKey]) || String(cKey);
            var nmH = String(dispH)
              .replace("South America", "S. America")
              .replace("North America", "N. America");
            continentRowsForMirror.push({ name: nmH, bonus: cVal });
          }
        }
        logToStorage("Con-income standard territory + held continents (no pending new continents)", {
          territoryCount: territoryCount,
          territoryBonusRow: territoryBonusRow,
          continentBonusHeld: continentBonusHeld,
          bookBonus: bookBonus,
          continentBonusNew: continentBonus
        });
      }

      var total = bookBonus + continentBonus + territoryBonusRow + continentBonusHeld;

      /* If books + new continents pay nothing but the player still holds ground, apply classic territory
       * reinforcement (same floor as phases/income.js). Prevents $0 bank + “skip deploy” when snapshot /
       * pending state is wrong or a session was routed through con-income by mistake. */
      if (!useStandardHeldSupplement && total < 1 && territoryCount > 0) {
        territoryBonusRow = Math.max(Math.floor(territoryCount / 3), 3);
        total = bookBonus + continentBonus + territoryBonusRow;
        skipTerritoryRow = false;
        logToStorage("Con-income territory fallback applied", {
          territoryCount: territoryCount,
          territoryBonusRow: territoryBonusRow,
          bookBonus: bookBonus,
          continentBonus: continentBonus
        });
      }

      var continentSubhead =
        pendingNew.length > 0
          ? "New continents"
          : useStandardHeldSupplement && continentRowsForMirror.length > 0
            ? "Continents held"
            : "New continents";
      /* Same mirror field as phases/income.js — host HUD + public TV paint #control-voice-text from this. */
      gameState.risquePublicIncomeBreakdown = {
        skipTerritoryRow: skipTerritoryRow,
        territoryCount: territoryCount,
        territoryBonus: territoryBonusRow,
        continentSubhead: continentSubhead,
        showBook: bookBonus > 0,
        bookCount: bookCount,
        bookBonus: bookBonus,
        continentRows: continentRowsForMirror,
        total: total
      };
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (eBr) {
        /* ignore */
      }
      /**
       * After con-cardplay, .runtime-hud-root--cardplay-panel-only hides #hud-main-panel (which contains
       * #control-voice). phases/income.js calls clearPhaseSlot() to remove that class — con-income must too
       * or the mirrored income grid is painted into an invisible panel (host only sees banner + phase slot).
       */
      var hostUiOverlay = document.getElementById("ui-overlay");
      var useHud = !!(window.risqueRuntimeHud && !window.risqueDisplayIsPublic && hostUiOverlay);
      if (useHud) {
        try {
          window.risqueRuntimeHud.ensure(hostUiOverlay);
          window.risqueRuntimeHud.clearPhaseSlot();
          window.risqueRuntimeHud.setAttackChromeInteractive(false);
          window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        } catch (eHud) {
          logToStorage("Runtime HUD prep failed", { error: eHud && eHud.message ? eHud.message : String(eHud) });
        }
        try {
          window.gameState.risqueControlVoice = {
            primary: (String(currentPlayer.name || "Player") + " · CONQUER MODE · INCOME").toUpperCase(),
            report: ("TOTAL INCOME " + total).toUpperCase(),
            reportClass: "ucp-voice-report ucp-voice-report--public-income"
          };
        } catch (eCv0) {
          /* ignore */
        }
      }
      function applyHostConIncomeGrid() {
        if (!gameState || !gameState.risquePublicIncomeBreakdown) return;
        if (window.risqueDisplayIsPublic) return;
        if (typeof window.risqueHostApplyIncomeBreakdownVoice === "function") {
          window.risqueHostApplyIncomeBreakdownVoice(gameState);
        }
      }
      applyHostConIncomeGrid();
      requestAnimationFrame(function () {
        applyHostConIncomeGrid();
        if (typeof window.risqueMirrorPushGameState === "function") {
          window.risqueMirrorPushGameState();
        }
      });
      setTimeout(function () {
        applyHostConIncomeGrid();
        if (typeof window.risqueMirrorPushGameState === "function") {
          window.risqueMirrorPushGameState();
        }
      }, 120);
      var handleConfirm = function () {
        logToStorage("Confirm button clicked");
        try {
          delete gameState.risquePublicIncomeBreakdown;
        } catch (eDelBr) {
          /* ignore */
        }
        logToStorage("Game state before update", {
          phase: gameState.phase,
          bankValue: currentPlayer.bankValue,
          troopsTotal: currentPlayer.troopsTotal
        });
        var terrTroopSum = currentPlayer.territories.reduce(function (sum, t) {
          return sum + (Number(t.troops) || 0);
        }, 0);
        currentPlayer.bankValue = total;
        currentPlayer.troopsTotal = terrTroopSum + total;
        currentPlayer.bookValue = 0;
        var pendingKeys = (gameState.pendingNewContinents || []).slice();
        pendingKeys.forEach(function (key) {
          gameState.continentCollectionCounts[key] = (gameState.continentCollectionCounts[key] || 0) + 1;
        });
        var paidAcc = gameState.risqueConquestChainPaidContinents || [];
        pendingKeys.forEach(function (key) {
          if (paidAcc.indexOf(key) === -1) paidAcc.push(key);
        });
        gameState.risqueConquestChainPaidContinents = paidAcc;
        logToStorage("Incremented continent counts (new continents only)", { updatedCounts: gameState.continentCollectionCounts });
        gameState.pendingNewContinents = [];
        /* One Risk deck draw if still owed: card-acquire (cardplayConquered) or combat elimination
         * (risqueCombatDeckPending — not cleared by con-cardplay book/elim branches). Skip if receive-card
         * already awarded a deck draw this turn. */
        var oweConquestDeck =
          !gameState.cardAwardedThisTurn &&
          !!(gameState.risqueCombatDeckPending || gameState.cardplayConquered || gameState.risqueEliminationDeckOwed);
        /* Player elimination still owes attack → reinforce → receive-card. Awarding the deck here sets
         * cardAwardedThisTurn early; reinforce then skips receive-card and jumps to next-player handoff. */
        var deferElimDeckToReceiveCard = !!gameState.risqueEliminationDeckOwed;
        if (oweConquestDeck && !deferElimDeckToReceiveCard) {
          var deck = gameState.deck;
          if (deck && deck.length > 0) {
            var raw = deck.shift();
            var cardName =
              typeof raw === "string" ? raw : raw && raw.name ? String(raw.name) : "";
            if (cardName) {
              currentPlayer.cards.push({ name: cardName, id: conIncomeNewCardId() });
              currentPlayer.cardCount = currentPlayer.cards.length;
              gameState.cardAwardedThisTurn = true;
              logToStorage("Card awarded for conquest (con-income deck)", {
                player: currentPlayer.name,
                card: cardName,
                fromCombatPending: !!gameState.risqueCombatDeckPending
              });
            }
          } else {
            gameState.cardAwardedThisTurn = true;
          }
        }
        gameState.cardplayConquered = false;
        if (!deferElimDeckToReceiveCard) {
          gameState.risqueCombatDeckPending = false;
          gameState.risqueEliminationDeckOwed = false;
        }
        uiOverlay.classList.add("fade-out");
        if (currentPlayer.bankValue <= 0) {
          gameState.phase = "attack";
          try {
            localStorage.setItem("gameState", JSON.stringify(gameState));
          } catch (e1) {
            /* ignore */
          }
          if (typeof window.risqueHostReplaceShellGameState === "function") {
            window.risqueHostReplaceShellGameState(gameState);
          }
          if (typeof window.risqueMirrorPushGameState === "function") {
            window.risqueMirrorPushGameState();
          }
          logToStorage("Game state updated (zero income, skip deploy)", {
            bankValue: currentPlayer.bankValue,
            troopsTotal: currentPlayer.troopsTotal,
            cardCount: currentPlayer.cardCount,
            phase: gameState.phase
          });
          window.gameUtils.showError("No troops available to deploy. Returning to attack.");
          setTimeout(function () {
            navigateTo("game.html?phase=attack");
          }, 2000);
        } else {
          if (gameState.phase === "deploy") {
            logToStorage("Warning: Phase already set to deploy, possible double-click", { phase: gameState.phase });
          }
          /* Canonical turn deploy (phases/deploy.js) — not con-deploy-phase: that legacy overlay + runtime HUD.ensure fused attack chrome with the old layout. */
          gameState.phase = "deploy";
          try {
            localStorage.setItem("gameState", JSON.stringify(gameState));
          } catch (e2) {
            /* ignore */
          }
          if (typeof window.risqueHostReplaceShellGameState === "function") {
            window.risqueHostReplaceShellGameState(gameState);
          }
          if (typeof window.risqueMirrorPushGameState === "function") {
            window.risqueMirrorPushGameState();
          }
          logToStorage("Game state updated", {
            bankValue: currentPlayer.bankValue,
            troopsTotal: currentPlayer.troopsTotal,
            cardCount: currentPlayer.cardCount,
            phase: gameState.phase
          });
          logToStorage("Navigating to deploy (turn, conquest)", { cardplayConquered: gameState.cardplayConquered });
          setTimeout(function () {
            navigateTo("game.html?phase=deploy&kind=turn&conquestAfterDeploy=1");
          }, 2000);
        }
      };
      var confirmButton = null;
      if (useHud) {
        var legacyShell = document.getElementById("risque-con-income-legacy");
        if (legacyShell) legacyShell.style.display = "none";
        uiOverlay.innerHTML = "";
        uiOverlay.classList.remove("visible");
        var incSlot = document.getElementById("risque-phase-content");
        if (incSlot) {
          incSlot.innerHTML = "";
          /* Income grid is only in #control-voice-text via risqueHostApplyIncomeBreakdownVoice — avoid duplicating it here. */
          var incStack = document.createElement("div");
          incStack.className = "income-hud-phase-stack";
          var incBtn = document.createElement("button");
          incBtn.type = "button";
          incBtn.className = "income-button visible income-button--hud income-button--hud-solo";
          incBtn.textContent = "Continue";
          incStack.appendChild(incBtn);
          incSlot.appendChild(incStack);
          confirmButton = incBtn;
        }
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
            window.risqueRuntimeHud.syncPosition();
          }
        });
        logToStorage("Con-income UI: HUD path (clearPhaseSlot + control-voice grid + Continue in phase slot)", {
          bookBonus: bookBonus,
          continentBonus: continentBonus,
          total: total
        });
      } else {
        var scale = window.innerWidth / 1920;
        var trTerritoryLegacy =
          !skipTerritoryRow && territoryBonusRow > 0
            ? "<tr><td>TERRITORY</td><td>TERRITORY COUNT: " +
              territoryCount +
              "</td><td>BONUS: " +
              territoryBonusRow +
              "</td></tr>"
            : "";
        var continentValLegacy = continentBonus + continentBonusHeld;
        var continentDetailsLegacy = continentDetails;
        if (useStandardHeldSupplement && continentBonusHeld > 0 && continentDetails === "NONE") {
          continentDetailsLegacy = "Continents held (standard scaling)";
        }
        var incomeContent =
          '<div class="income-player-name" style="color: ' +
          playerColor +
          '">' +
          currentPlayer.name +
          "'s Income</div>" +
          '<div class="income-table-container visible">' +
          '<table class="income-table">' +
          "<thead><tr>" +
          '<th style="width:' +
          200 * scale +
          'px">Label</th>' +
          '<th style="width:' +
          385.3203125 * scale +
          'px">Details</th>' +
          '<th style="width:' +
          200 * scale +
          'px">Value</th>' +
          "</tr></thead><tbody>" +
          trTerritoryLegacy +
          "<tr><td>BOOKS</td><td>BOOK COUNT: " +
          (bookCount === 0 ? "NONE" : bookCount) +
          "</td><td>BOOK: " +
          bookBonus +
          "</td></tr>" +
          "<tr><td>CONTINENTS</td><td>" +
          continentDetailsLegacy +
          "</td><td>CONTINENTS: " +
          continentValLegacy +
          "</td></tr>" +
          "<tr><td></td><td>TOTAL</td><td>" +
          total +
          "</td></tr></tbody></table>" +
          '<button type="button" class="income-button visible">Confirm</button>' +
          "</div>";
        uiOverlay.innerHTML = incomeContent;
        uiOverlay.classList.add("visible");
        logToStorage("UI overlay updated with incomeContent", {
          bookBonus: bookBonus,
          continentBonus: continentValLegacy,
          total: total,
          continentDetails: continentDetailsLegacy
        });
        confirmButton = uiOverlay.querySelector(".income-button");
      }
      if (confirmButton) {
        confirmButton.addEventListener("click", handleConfirm);
        confirmButton.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            handleConfirm();
          }
        });
      } else {
        window.gameUtils.showError("Confirm button not found");
      }
      logToStorage("Income UI rendering completed");
      window.gameUtils.initGameView();
      window.gameUtils.renderTerritories(null, gameState);
      window.gameUtils.renderStats(gameState);
    } catch (e) {
      logToStorage("Failed to initialize con-income", { error: e && e.message ? e.message : String(e) });
      window.gameUtils.showError("Failed to initialize income phase");
      setTimeout(function () {
        navigateTo(loginRecoveryHref());
      }, 2000);
    }
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    injectStyles();
    /* con-cardplay leaves this on body — it sets .runtime-hud-root { visibility:hidden }, which hides #control-voice-text. */
    try {
      document.body.classList.remove("risque-con-cardplay-mounted");
    } catch (eRmCp) {
      /* ignore */
    }
    var ccLegacy = document.getElementById("risque-con-cardplay-legacy");
    if (ccLegacy && ccLegacy.parentNode) {
      ccLegacy.parentNode.removeChild(ccLegacy);
    }
    unstashHostUiOverlayFromConPhases();
    document.body.classList.add("risque-con-income-mounted");

    var canvas = document.getElementById("canvas");
    if (!canvas || !window.gameUtils) {
      return;
    }
    var prev = document.getElementById("risque-con-income-legacy");
    if (prev && prev.parentNode) {
      prev.parentNode.removeChild(prev);
    }
    var shell = document.createElement("div");
    shell.id = "risque-con-income-legacy";
    var ui = document.createElement("div");
    ui.id = "risque-con-income-ui";
    ui.className = "risque-con-income-ui";
    shell.appendChild(ui);
    canvas.appendChild(shell);

    if (window.risqueDisplayIsPublic) {
      shell.style.pointerEvents = "none";
    }

    function beginAfterState(gs) {
      if (!gs) {
        window.gameUtils.showError("No game state found. Redirecting to launch.");
        setTimeout(function () {
          navigateTo(loginRecoveryHref());
        }, 2000);
        return;
      }
      window.gameState = gs;
      try {
        if (window.location.protocol !== "file:") {
          var params = new URLSearchParams(window.location.search);
          if (params.get("phase") !== "con-income") {
            params.set("phase", "con-income");
            var qs = params.toString();
            window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
          }
        }
      } catch (eH) {
        /* ignore */
      }
      try {
        gs.phase = "con-income";
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
        onLog("Con-income mount: state ready", { phase: gs.phase, currentPlayer: gs.currentPlayer });
      }
      conIncomeInit();
      if (!window.risqueDisplayIsPublic) {
        var uio = document.getElementById("ui-overlay");
        if (uio && window.risqueRuntimeHud && typeof window.risqueRuntimeHud.ensure === "function") {
          try {
            window.risqueRuntimeHud.ensure(uio);
          } catch (eEns) {
            /* ignore */
          }
        }
        if (typeof window.risqueRefreshControlVoiceMirror === "function") {
          try {
            window.risqueRefreshControlVoiceMirror(gs);
          } catch (eCv) {
            /* ignore */
          }
        }
        requestAnimationFrame(function () {
          if (typeof window.risqueRefreshControlVoiceMirror === "function") {
            try {
              window.risqueRefreshControlVoiceMirror(window.gameState || gs);
            } catch (eCv2) {
              /* ignore */
            }
          }
        });
      }
      window.addEventListener("resize", function () {
        requestAnimationFrame(function () {
          if (window.gameUtils && window.gameUtils.resizeCanvas) {
            window.gameUtils.resizeCanvas();
          }
        });
      });
    }

    window.gameUtils.loadGameState(beginAfterState);
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.conIncome = { mount: mount };
})();
