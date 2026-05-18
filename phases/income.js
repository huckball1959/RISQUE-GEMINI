/**
 * Income phase — classic `?phase=income` and conquer-mode `?phase=con-income` (opts.conquerIncome).
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-income-styles-v2";

  function loginRecoveryHref() {
    return window.risqueLoginRecoveryViaPrivacyUrl();
  }

  /** Prefer same-document game.html navigation (no full reload); fallback fade or location. */
  function navigateGameHtmlPreferSoft(url) {
    try {
      if (typeof window.risqueNavigateGameHtmlSoft === "function" && window.risqueNavigateGameHtmlSoft(url)) {
        return;
      }
    } catch (eNav) {
      /* ignore */
    }
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(url);
    } else {
      window.location.href = url;
    }
  }

  function injectStyles() {
    var legacy = document.getElementById("risque-income-styles");
    if (legacy) legacy.remove();
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".income-player-name{font-family:Arial,sans-serif;font-size:20px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:.5px;text-shadow:2px 2px 2px rgba(0,0,0,.7);position:absolute;left:1110px;top:250px;" +
      "z-index:10;pointer-events:none;}" +
      ".income-table-container{position:absolute;top:309px;left:1120px;width:760px;z-index:10;visibility:visible;color:#0f172a;" +
      "opacity:0;transition:opacity 1s ease-in-out;}" +
      ".income-table-container.visible{opacity:1;}" +
      ".income-table{border-collapse:collapse;width:100%;color:#0f172a;}" +
      ".income-table th,.income-table td{border:2px solid #000;padding:8px;text-align:center;font-family:Arial,sans-serif;" +
      "font-size:12.5px;font-weight:bold;color:#0f172a;}" +
      ".income-table th{background-color:#94a3b8;color:#0f172a;}" +
      ".income-table td{background-color:#f8fafc;color:#0f172a;}" +
      ".income-button{width:258px;height:36px;margin:10px auto 0;position:relative;background:#000;color:#fff;" +
      "font-family:Arial,sans-serif;font-size:16px;font-weight:bold;text-align:center;border:none;border-radius:4px;" +
      "cursor:pointer;z-index:10;visibility:visible;opacity:0;transition:opacity 1s ease-in-out;display:block;}" +
      ".income-button.visible{opacity:1;}" +
      ".income-button:hover:not(:disabled){background:#1a1a1a;color:#fff;}" +
      ".income-button:active:not(:disabled){transform:scale(.95);}" +
      ".income-button:disabled{background:#000;color:#fff;opacity:.5;cursor:not-allowed;}";
    document.head.appendChild(s);
  }

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

  function conquerIncomeNewCardId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function computeOwnedContinentsConquer(player, gameState) {
    var owned = [];
    var continents = gameState && gameState.continents;
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

  function mount(host, opts) {
    opts = opts || {};
    var conquerIncome = !!opts.conquerIncome;
    if (
      conquerIncome &&
      window.gameState &&
      window.gameUtils &&
      typeof window.gameUtils.isRisqueConquestIncomeChain === "function" &&
      !window.gameUtils.isRisqueConquestIncomeChain(window.gameState)
    ) {
      conquerIncome = false;
    }
    var onLog = opts.onLog;
    // Default next step: stay inside JS runtime.
    var legacyNext = opts.legacyNext != null ? opts.legacyNext : "game.html?phase=deploy&kind=turn";

    function logToStorage(message, data) {
      var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      var logEntry = "[" + ts + "] [Income] " + message;
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

    function sanitizeGameState(gameState) {
      logToStorage("Sanitized game state before save", {
        players: gameState.players.map(function (p) {
          return { name: p.name, bookValue: p.bookValue };
        }),
        bookPlayedThisTurn: gameState.bookPlayedThisTurn
      });
      return gameState;
    }

    /** Never throw — phase navigation must continue even when localStorage is full. */
    function persistGameStateSafe(gs) {
      var payload = sanitizeGameState(gs);
      if (typeof window.risquePersistGameStateForNavigation === "function") {
        return window.risquePersistGameStateForNavigation(payload);
      }
      if (typeof window.risqueSaveGameState === "function") {
        try {
          return !!window.risqueSaveGameState(payload);
        } catch (eSave) {
          console.warn("[Income] risqueSaveGameState failed", eSave);
          return false;
        }
      }
      try {
        var json =
          typeof window.risqueJsonStringifyGameStateForStorage === "function"
            ? window.risqueJsonStringifyGameStateForStorage(payload)
            : JSON.stringify(payload);
        if (typeof window.risqueTryWriteLocalStorageWithQuotaFallback === "function") {
          return window.risqueTryWriteLocalStorageWithQuotaFallback("gameState", json);
        }
        localStorage.setItem("gameState", json);
        return true;
      } catch (eLs) {
        console.warn("[Income] gameState persist failed (continuing in memory)", eLs);
        return false;
      }
    }

    function ensureContinentCollectionCounts(gameState) {
      if (!gameState.continentCollectionCounts) {
        gameState.continentCollectionCounts = {
          south_america: 0,
          north_america: 0,
          africa: 0,
          europe: 0,
          asia: 0,
          australia: 0
        };
      }
    }

    function applyRoundOneCardCap(gameState) {
      if (gameState.round === 1) {
        gameState.players.forEach(function (player) {
          if (player.cardCount > 1) {
            logToStorage("Corrected invalid card count", {
              player: player.name,
              oldCount: player.cardCount,
              newCount: 1
            });
            player.cardCount = 1;
            player.cards = player.cards.slice(0, 1);
          }
        });
      }
    }

    /**
     * Plain-language income breakdown for control voice (mirrored text; host/TV also use risquePublicIncomeBreakdown grid).
     * HUD phase slot shows the legacy spreadsheet table + Continue. Omit books/continents when +0.
     */
    function buildIncomeVoiceNarrative(
      currentPlayer,
      gameState,
      territoryCount,
      territoryBonus,
      bookCount,
      bookBonus,
      continentBonus,
      total,
      ownedContinents
    ) {
      var lines = [];
      lines.push(territoryCount + " territories — bonus equals " + territoryBonus);
      if (gameState.bookPlayedThisTurn && bookBonus > 0) {
        lines.push(
          "Books: " +
            bookCount +
            " book card" +
            (bookCount === 1 ? "" : "s") +
            " played — +" +
            bookBonus
        );
      }
      if (continentBonus > 0 && ownedContinents.length) {
        var parts = [];
        ownedContinents.forEach(function (c) {
          var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
            return window.gameUtils.continentDisplayNames[k] === c;
          });
          var v = window.gameUtils.getNextContinentValue(
            key,
            gameState.continentCollectionCounts[key] || 0
          );
          if (v > 0) {
            parts.push(c + ": +" + v);
          }
        });
        if (parts.length) {
          lines.push("Continents held: " + parts.join("; ") + ".");
        }
      }
      var primary = lines.join("\n").toUpperCase();
      var report = ("Total income: " + total).toUpperCase();
      if (primary.length > 1800) {
        primary = primary.slice(0, 1797) + "…";
      }
      return {
        primary: primary,
        report: report
      };
    }

    /** Conquer-mode income (former con-income-phase.js): books + new continents; deploy or attack next. */
    function conquerIncomeInit() {
      try {
        var uiOverlay = document.getElementById("ui-overlay");
        if (!uiOverlay) {
          logToStorage("Con-income: ui-overlay not found");
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
          logToStorage("Invalid game state (con-income)");
          window.gameUtils.showError("Invalid game state. Redirecting to launch.");
          setTimeout(function () {
            navigateGameHtmlPreferSoft(loginRecoveryHref());
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
          logToStorage("Current player not found (con-income)");
          window.gameUtils.showError("Current player not found. Redirecting to launch.");
          setTimeout(function () {
            navigateGameHtmlPreferSoft(loginRecoveryHref());
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
        if (typeof window.gameUtils.syncConquestPendingNewContinents === "function") {
          window.gameUtils.syncConquestPendingNewContinents(gameState);
        } else if (typeof window.gameUtils.computePendingNewContinentsForConquest === "function") {
          gameState.pendingNewContinents = window.gameUtils.computePendingNewContinentsForConquest(gameState);
        }
        if (!Object.keys(gameState.continentsSnapshot || {}).length) {
          logToStorage("WARNING: continentsSnapshot empty (con-income)", {
            phase: gameState.phase,
            currentPlayer: gameState.currentPlayer
          });
        }
        currentPlayer.bankValue = currentPlayer.bankValue || 0;
        var playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
        var bookCount = currentPlayer.bookValue || 0;
        var bookBonus = bookCount * 10;
        var continentBonus = 0;
        var ownedContinents = computeOwnedContinentsConquer(currentPlayer, gameState);
        var snapshot = gameState.continentsSnapshot || {};
        var snapshotOwned = Object.keys(snapshot).filter(function (key) {
          return snapshot[key];
        });
        var pendingNew = gameState.pendingNewContinents || [];
        var attackEntryContinents =
          typeof window.gameUtils.getRisqueConquestAttackStartBaselineList === "function"
            ? window.gameUtils.getRisqueConquestAttackStartBaselineList(gameState)
            : gameState.risqueConquestAttackEntryContinents || [];
        logToStorage("Con-income continent trace", {
          snapshotOwned: snapshotOwned,
          turnStartKeys: Object.keys(gameState.risqueTurnStartContinentsSnapshot || {}),
          ownedContinents: ownedContinents,
          pendingNew: pendingNew,
          capturedThisAttack: gameState.risqueConquestTerritoriesCapturedThisAttack || [],
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

        var total = bookBonus + continentBonus;

        var continentSubhead = pendingNew.length > 0 ? "New continents" : "No new continents";
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

        var hostUiOverlay = document.getElementById("ui-overlay");
        var useHud = !!(window.risqueRuntimeHud && !window.risqueDisplayIsPublic && hostUiOverlay);
        if (useHud) {
          try {
            window.risqueRuntimeHud.ensure(hostUiOverlay);
            window.risqueRuntimeHud.clearPhaseSlot();
            window.risqueRuntimeHud.setAttackChromeInteractive(false);
            window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
          } catch (eHud) {
            logToStorage("Runtime HUD prep failed (con-income)", {
              error: eHud && eHud.message ? eHud.message : String(eHud)
            });
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
          logToStorage("Con-income confirm clicked");
          try {
            delete gameState.risquePublicIncomeBreakdown;
          } catch (eDelBr) {
            /* ignore */
          }
          logToStorage("Game state before update (con-income)", {
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
          logToStorage("Incremented continent counts (con-income)", {
            updatedCounts: gameState.continentCollectionCounts
          });
          gameState.pendingNewContinents = [];
          var oweConquestDeck =
            !gameState.cardAwardedThisTurn &&
            !!(gameState.risqueCombatDeckPending || gameState.cardplayConquered || gameState.risqueEliminationDeckOwed);
          var deferElimDeckToReceiveCard = !!gameState.risqueEliminationDeckOwed;
          if (oweConquestDeck && !deferElimDeckToReceiveCard) {
            var deck = gameState.deck;
            if (deck && deck.length > 0) {
              var raw = deck.shift();
              var cardName =
                typeof raw === "string" ? raw : raw && raw.name ? String(raw.name) : "";
              if (cardName) {
                currentPlayer.cards.push({ name: cardName, id: conquerIncomeNewCardId() });
                currentPlayer.cardCount = currentPlayer.cards.length;
                gameState.cardAwardedThisTurn = true;
                logToStorage("Card awarded for conquest (con-income)", {
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
            logToStorage("Con-income zero bank → attack", { phase: gameState.phase });
            window.gameUtils.showError("No troops available to deploy. Returning to attack.");
            setTimeout(function () {
              navigateGameHtmlPreferSoft("game.html?phase=attack");
            }, 2000);
          } else {
            if (gameState.phase === "deploy") {
              logToStorage("Warning: phase already deploy (con-income)", { phase: gameState.phase });
            }
            gameState.phase = "deploy";
            try {
              localStorage.setItem("gameState", JSON.stringify(sanitizeGameState(gameState)));
            } catch (e2) {
              /* ignore */
            }
            if (typeof window.risqueHostReplaceShellGameState === "function") {
              window.risqueHostReplaceShellGameState(gameState);
            }
            if (typeof window.risqueMirrorPushGameState === "function") {
              window.risqueMirrorPushGameState();
            }
            logToStorage("Con-income → deploy (conquest)", { bankValue: currentPlayer.bankValue });
            setTimeout(function () {
              navigateGameHtmlPreferSoft(
                "game.html?phase=deploy&kind=turn&conquestAfterDeploy=1"
              );
            }, 2000);
          }
        };

        var confirmButton = null;
        if (useHud) {
          var legacyShell = document.getElementById("risque-con-income-legacy");
          if (legacyShell) legacyShell.style.display = "none";
          /* Do not set uiOverlay.innerHTML — it removes #runtime-hud-root and #risque-phase-content; classic income keeps the HUD shell and only fills the phase slot. */
          try {
            window.risqueRuntimeHud.ensure(uiOverlay);
            window.risqueRuntimeHud.clearPhaseSlot();
          } catch (eHudSlot) {
            /* ignore */
          }
          uiOverlay.classList.add("visible");
          var incSlot = document.getElementById("risque-phase-content");
          if (incSlot) {
            incSlot.innerHTML = "";
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
          logToStorage("Con-income HUD path mounted", { total: total });
        } else {
          var scale = window.innerWidth / 1920;
          var trTerritoryLegacy = "";
          var continentValLegacy = continentBonus;
          var continentDetailsLegacy = continentDetails;
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
          logToStorage("Con-income legacy table mounted", { total: total });
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
        logToStorage("Con-income UI rendering completed");
      } catch (e) {
        logToStorage("Failed to initialize con-income", { error: e && e.message ? e.message : String(e) });
        window.gameUtils.showError("Failed to initialize income phase");
        setTimeout(function () {
          navigateGameHtmlPreferSoft(loginRecoveryHref());
        }, 2000);
      }
    }

    function incomeInit() {
      console.log("[Income] Initializing income phase");
      try {
        var uiOverlay = document.getElementById("ui-overlay");
        if (!uiOverlay) {
          console.error("[Income] UI overlay not found");
          window.gameUtils.showError("UI overlay not found");
          return;
        }
        var gameState = window.gameState;
        if (!gameState || !gameState.players || !gameState.currentPlayer) {
          console.error("[Income] Invalid game state");
          window.gameUtils.showError("Invalid game state");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 2000);
          return;
        }
        ensureContinentCollectionCounts(gameState);
        var currentPlayer = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!currentPlayer) {
          console.error("[Income] Current player not found");
          window.gameUtils.showError("Current player not found");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 2000);
          return;
        }
        logToStorage("Checking bookValue for current player", {
          player: currentPlayer.name,
          bookValue: currentPlayer.bookValue,
          bookPlayedThisTurn: gameState.bookPlayedThisTurn
        });
        var playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
        var territoryCount = currentPlayer.territories.length;
        var territoryBonus = Math.max(Math.floor(territoryCount / 3), 3);
        var bookCount = gameState.bookPlayedThisTurn ? currentPlayer.bookValue || 0 : 0;
        var bookBonus = bookCount * 10;
        var continentBonus = 0;
        var ownedContinents = window.gameUtils.getPlayerContinents(currentPlayer);
        continentBonus = ownedContinents.reduce(function (sum, continent) {
          var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
            return window.gameUtils.continentDisplayNames[k] === continent;
          });
          var collectionCount = gameState.continentCollectionCounts[key] || 0;
          return sum + window.gameUtils.getNextContinentValue(key, collectionCount);
        }, 0);
        var total = territoryBonus + bookBonus + continentBonus;
        var continentRowsForMirror = [];
        ownedContinents.forEach(function (c) {
          var cKey = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
            return window.gameUtils.continentDisplayNames[k] === c;
          });
          var cVal =
            cKey != null
              ? window.gameUtils.getNextContinentValue(cKey, gameState.continentCollectionCounts[cKey] || 0)
              : 0;
          if (cVal > 0) {
            continentRowsForMirror.push({
              name: c
                .replace("South America", "S. America")
                .replace("North America", "N. America"),
              bonus: cVal
            });
          }
        });
        gameState.risquePublicIncomeBreakdown = {
          territoryCount: territoryCount,
          territoryBonus: territoryBonus,
          continentRows: continentRowsForMirror,
          showBook: !!(gameState.bookPlayedThisTurn && bookBonus > 0),
          bookCount: bookCount,
          bookBonus: bookBonus,
          total: total
        };
        var useHud = !!window.risqueRuntimeHud;
        var incomeDoneButtonLabel = useHud ? "Continue" : "Confirm";
        var btnClass =
          "income-button visible" +
          (useHud ? " income-button--hud income-button--hud-solo" : "");
        var confirmBtnHtml =
          '<button type="button" class="' +
          btnClass +
          '">' +
          incomeDoneButtonLabel +
          "</button>";
        var incomeTableBlock = "";
        if (!useHud) {
          var scale = window.innerWidth / 1920;
          var theadHtml =
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
            "</tr></thead>";
          var tbodyHtml =
            "<tbody>" +
            "<tr><td>TERRITORY BONUS</td><td>TERRITORY COUNT: " +
            territoryCount +
            "</td><td>BONUS: " +
            territoryBonus +
            "</td></tr>" +
            "<tr><td>BOOKS</td><td>BOOK COUNT: " +
            (bookCount === 0 ? "NONE" : bookCount) +
            "</td><td>BOOK: " +
            bookBonus +
            "</td></tr>" +
            "<tr><td>CONTINENTS</td><td>" +
            (ownedContinents.length
              ? ownedContinents
                  .map(function (c) {
                    var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
                      return window.gameUtils.continentDisplayNames[k] === c;
                    });
                    return (
                      c.replace("South America", "S. America").replace("North America", "N. America") +
                      "=" +
                      window.gameUtils.getNextContinentValue(
                        key,
                        gameState.continentCollectionCounts[key] || 0
                      )
                    );
                  })
                  .join(", ")
              : "NONE") +
            "</td><td>CONTINENTS: " +
            continentBonus +
            "</td></tr>" +
            "<tr><td></td><td>TOTAL</td><td>" +
            total +
            "</td></tr>" +
            "</tbody>";
          var tableHtml =
            "<table class=\"income-table\">" + theadHtml + tbodyHtml + "</table>";
          incomeTableBlock =
            '<div class="income-table-container visible">' + tableHtml + confirmBtnHtml + "</div>";
        }
        if (window.risqueRuntimeHud) {
          window.risqueRuntimeHud.ensure(uiOverlay);
          window.risqueRuntimeHud.clearPhaseSlot();
          window.risqueRuntimeHud.setAttackChromeInteractive(false);
          window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
          var voice = buildIncomeVoiceNarrative(
            currentPlayer,
            gameState,
            territoryCount,
            territoryBonus,
            bookCount,
            bookBonus,
            continentBonus,
            total,
            ownedContinents
          );
          try {
            window.gameState.risqueControlVoice = {
              primary: voice.primary,
              report: voice.report,
              reportClass: "ucp-voice-report ucp-voice-report--public-income"
            };
          } catch (eCv) {
            /* ignore */
          }
          if (typeof window.risqueMirrorPushGameState === "function") {
            window.risqueMirrorPushGameState();
          }
          function applyHostIncomeVoiceDom() {
            var gs = window.gameState || gameState;
            if (!gs || !gs.risquePublicIncomeBreakdown) return;
            if (typeof window.risqueHostApplyIncomeBreakdownVoice === "function") {
              window.risqueHostApplyIncomeBreakdownVoice(gs);
            } else if (typeof window.risqueBuildIncomeBreakdownDom === "function") {
              var vt0 = document.getElementById("control-voice-text");
              var vr0 = document.getElementById("control-voice-report");
              if (vt0) {
                vt0.classList.add("ucp-voice-text--public-income-stack");
                vt0.innerHTML = "";
                vt0.appendChild(window.risqueBuildIncomeBreakdownDom(gs.risquePublicIncomeBreakdown, gs));
              }
              if (vr0) {
                vr0.textContent = "";
                vr0.style.display = "none";
                vr0.className = "ucp-voice-report";
              }
            } else if (typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
              window.risqueRuntimeHud.setControlVoiceText(voice.primary, voice.report, {
                force: true,
                reportClass: "ucp-voice-report ucp-voice-report--public-income"
              });
            }
          }
          applyHostIncomeVoiceDom();
          requestAnimationFrame(function () {
            applyHostIncomeVoiceDom();
            if (typeof window.risqueMirrorPushGameState === "function") {
              window.risqueMirrorPushGameState();
            }
          });
          setTimeout(function () {
            applyHostIncomeVoiceDom();
            if (typeof window.risqueMirrorPushGameState === "function") {
              window.risqueMirrorPushGameState();
            }
          }, 120);
          if (typeof window.risqueClearSpectatorFocus === "function") {
            window.risqueClearSpectatorFocus();
          }
          var incSlot = document.getElementById("risque-phase-content");
          if (incSlot) {
            incSlot.innerHTML = "";
            var incStack = document.createElement("div");
            incStack.className = "income-hud-phase-stack";
            var incBtn = document.createElement("button");
            incBtn.type = "button";
            incBtn.className = btnClass;
            incBtn.textContent = incomeDoneButtonLabel;
            incStack.appendChild(incBtn);
            incSlot.appendChild(incStack);
          }
          /* Do not re-apply .runtime-hud-root--cardplay-panel-only during host income: that class hides
           * #hud-main-panel, which contains #control-voice-text where the mirrored income grid is painted
           * (same as public TV). Conquest-after-deploy keeps risqueConquestChainActive true here. */
          requestAnimationFrame(function () {
            if (window.risqueRuntimeHud) window.risqueRuntimeHud.syncPosition();
          });
        } else {
          uiOverlay.innerHTML =
            '<div class="income-player-name" style="color: ' +
            playerColor +
            '">' +
            currentPlayer.name +
            "'s Income</div>" +
            incomeTableBlock;
        }
        uiOverlay.classList.add("visible");
        logToStorage(useHud ? "UI overlay updated (income — HUD slot = public income grid + breakdown voice)" : "UI overlay updated with income table", {
          territoryBonus: territoryBonus,
          bookBonus: bookBonus,
          continentBonus: continentBonus,
          total: total,
          bookPlayedThisTurn: gameState.bookPlayedThisTurn
        });
        var confirmButton = document.querySelector(".income-button");
        var PUBLIC_INCOME_GATE_KEY = "risquePublicIncomeGateAck";
        var incomeGateToken = gameState.risquePublicIncomeGateToken;
        function incomeGateAckMatches() {
          if (!incomeGateToken || window.risqueDisplayIsPublic) return true;
          try {
            var raw = localStorage.getItem(PUBLIC_INCOME_GATE_KEY);
            var ack = raw ? JSON.parse(raw) : null;
            return !!(ack && ack.token === incomeGateToken);
          } catch (eAck) {
            return false;
          }
        }
        var incomeGatePoll = null;
        if (confirmButton) {
          logToStorage("Confirm button bound");
          if (incomeGateToken && !window.risqueDisplayIsPublic && !incomeGateAckMatches()) {
            confirmButton.disabled = true;
            confirmButton.textContent = "Waiting for public display…";
            incomeGatePoll = setInterval(function () {
              if (incomeGateAckMatches()) {
                confirmButton.disabled = false;
                confirmButton.textContent = incomeDoneButtonLabel;
                if (incomeGatePoll) {
                  clearInterval(incomeGatePoll);
                  incomeGatePoll = null;
                }
              }
            }, 250);
            window.addEventListener("storage", function incomeGateStorage(ev) {
              if (ev.key !== PUBLIC_INCOME_GATE_KEY) return;
              if (incomeGateAckMatches() && confirmButton) {
                confirmButton.disabled = false;
                confirmButton.textContent = incomeDoneButtonLabel;
                if (incomeGatePoll) {
                  clearInterval(incomeGatePoll);
                  incomeGatePoll = null;
                }
              }
            });
            setTimeout(function () {
              if (!confirmButton || !incomeGateToken) return;
              if (incomeGateAckMatches()) return;
              logToStorage("Income gate: long timeout — enabling confirm without TV ack", {});
              confirmButton.disabled = false;
              confirmButton.textContent = incomeDoneButtonLabel;
              if (incomeGatePoll) {
                clearInterval(incomeGatePoll);
                incomeGatePoll = null;
              }
            }, 120000);
          }
          var handleConfirm = function () {
            logToStorage("Confirm button clicked");
            if (incomeGateToken && !window.risqueDisplayIsPublic && !incomeGateAckMatches()) {
              return;
            }
            if (typeof window.risqueClearCardplayPublicSpectatorForMirror === "function") {
              window.risqueClearCardplayPublicSpectatorForMirror();
            }
            if (
              window.risqueRuntimeHud &&
              typeof window.risqueRuntimeHud.setControlVoiceText === "function"
            ) {
              window.risqueRuntimeHud.setControlVoiceText(
                "CONFIRMED. +" + total + " TO BANK. NEXT: DEPLOYMENT.",
                "",
                { force: true }
              );
            }
            try {
              delete gameState.risquePublicIncomeBreakdown;
            } catch (eRmInc) {
              /* ignore */
            }
            currentPlayer.bankValue = total;
            var standardIncomeContinentKeys = [];
            for (var continent in window.gameUtils.continents) {
              if (
                Object.prototype.hasOwnProperty.call(window.gameUtils.continents, continent)
              ) {
                var territories = window.gameUtils.continents[continent];
                if (
                  territories.every(function (t) {
                    return currentPlayer.territories.some(function (pt) {
                      return pt.name === t;
                    });
                  })
                ) {
                  gameState.continentCollectionCounts[continent] =
                    (gameState.continentCollectionCounts[continent] || 0) + 1;
                  standardIncomeContinentKeys.push(continent);
                }
              }
            }
            try {
              gameState.risqueConquestStandardIncomeContinentKeysMeta = {
                round: gameState.round,
                player: gameState.currentPlayer,
                keys: standardIncomeContinentKeys
              };
            } catch (eStdMeta) {
              /* ignore */
            }
            try {
              delete gameState.risqueConquestAttackEntryTurnKey;
              delete gameState.risqueConquestAttackEntryContinents;
              if (window.gameUtils && typeof window.gameUtils.clearRisqueConquestAttackStartSession === "function") {
                window.gameUtils.clearRisqueConquestAttackStartSession();
              }
            } catch (eAtkClr) {
              /* ignore */
            }
            gameState.bookPlayedThisTurn = false;
            currentPlayer.bookValue = 0;
            gameState.phase = "income";
            var persisted = persistGameStateSafe(gameState);
            logToStorage("Game state updated after income", {
              bankValue: currentPlayer.bankValue,
              phase: gameState.phase,
              bookPlayedThisTurn: gameState.bookPlayedThisTurn,
              bookValue: currentPlayer.bookValue,
              persistedToLocalStorage: persisted
            });
            if (!persisted && window.gameUtils && typeof window.gameUtils.showError === "function") {
              window.gameUtils.showError(
                "Storage full — continuing to deploy with in-memory state. Use SAVE to disk or clear site data."
              );
            }
            if (uiOverlay) uiOverlay.classList.remove("fade-out");
            setTimeout(function () {
              var dest = legacyNext;
              // Convert old legacy destination into runtime URL if needed.
              /* Old continental / saved URLs pointed at deploy2.html; canonical deploy is game.html?phase=deploy&kind=turn */
              if (typeof dest === "string" && dest.indexOf("deploy2.html") !== -1) {
                dest = "game.html?phase=deploy&kind=turn";
              }
              navigateGameHtmlPreferSoft(dest);
            }, 0);
          };
          confirmButton.addEventListener("click", handleConfirm);
          confirmButton.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") handleConfirm();
          });
        } else {
          console.error("[Income] Confirm button not found");
          window.gameUtils.showError("Confirm button not found");
        }
        console.log("[Income] Income UI rendering completed");
        /* Map/stats: single paint via game-shell refreshVisuals("Income mounted") — avoid double redraw blink */
      } catch (e) {
        console.error("[Income] Failed to initialize:", e.message);
        window.gameUtils.showError("Failed to initialize income phase");
        setTimeout(function () {
          window.location.href = loginRecoveryHref();
        }, 2000);
      }
    }

    injectStyles();

    if (!window.gameUtils) {
      console.error("[Income] gameUtils missing");
      return;
    }

    var gameState = window.gameState;
    if (!gameState || !window.gameUtils.validateGameState(gameState)) {
      logToStorage("Invalid game state at income mount");
      window.gameUtils.showError("Invalid game state");
      setTimeout(function () {
        window.location.href = loginRecoveryHref();
      }, 2000);
      return;
    }

    ensureContinentCollectionCounts(gameState);

    if (conquerIncome) {
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
      try {
        if (window.location.protocol !== "file:") {
          var paramsCi = new URLSearchParams(window.location.search);
          if (paramsCi.get("phase") !== "con-income") {
            paramsCi.set("phase", "con-income");
            var qsCi = paramsCi.toString();
            window.history.replaceState(
              null,
              "",
              window.location.pathname + (qsCi ? "?" + qsCi : "") + window.location.hash
            );
          }
        }
      } catch (eHCi) {
        /* ignore */
      }
      gameState.phase = "con-income";
      try {
        localStorage.setItem("gameState", JSON.stringify(gameState));
      } catch (ePCi) {
        /* ignore */
      }
      if (typeof window.risqueHostReplaceShellGameState === "function") {
        window.risqueHostReplaceShellGameState(gameState);
      }
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      if (typeof onLog === "function") {
        onLog("Income mount: conquer income ready", {
          phase: gameState.phase,
          currentPlayer: gameState.currentPlayer
        });
      }
      conquerIncomeInit();
      if (!window.risqueDisplayIsPublic) {
        var uioCi = document.getElementById("ui-overlay");
        if (uioCi && window.risqueRuntimeHud && typeof window.risqueRuntimeHud.ensure === "function") {
          try {
            window.risqueRuntimeHud.ensure(uioCi);
          } catch (eEnsCi) {
            /* ignore */
          }
        }
        if (typeof window.risqueRefreshControlVoiceMirror === "function") {
          try {
            window.risqueRefreshControlVoiceMirror(gameState);
          } catch (eCvCi) {
            /* ignore */
          }
          requestAnimationFrame(function () {
            try {
              window.risqueRefreshControlVoiceMirror(window.gameState || gameState);
            } catch (eCvCi2) {
              /* ignore */
            }
          });
        }
      }
      if (window.gameUtils && window.gameUtils.resizeCanvas) {
        requestAnimationFrame(function () {
          window.gameUtils.resizeCanvas();
        });
      }
      return;
    }

    try {
      document.body.classList.remove("risque-con-income-mounted");
    } catch (eRmCiBody) {
      /* ignore */
    }

    applyRoundOneCardCap(gameState);
    logToStorage("Player card counts on load", {
      players: gameState.players.map(function (p) {
        return { name: p.name, cardCount: p.cardCount, cards: p.cards };
      })
    });
    try {
      localStorage.setItem("gameState", JSON.stringify(sanitizeGameState(gameState)));
    } catch (e2) {
      /* ignore */
    }

    gameState.phase = "income";
    try {
      localStorage.setItem("gameState", JSON.stringify(gameState));
    } catch (e3) {
      /* ignore */
    }

    incomeInit();
    if (window.gameUtils && window.gameUtils.resizeCanvas) {
      requestAnimationFrame(function () {
        window.gameUtils.resizeCanvas();
      });
    }
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.income = {
    mount: mount,
    runConquerIncome: function (host, opts) {
      opts = opts || {};
      opts.conquerIncome = true;
      mount(host, opts);
    }
  };
})();
