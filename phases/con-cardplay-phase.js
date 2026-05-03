/**
 * Conquest card play phase (was con-cardplay.html). Mounted from game.html ?phase=con-cardplay.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-con-cardplay-phase-v1";

  function injectConCardplayStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "#risque-con-cardplay-legacy{position:absolute;left:0;top:0;width:100%;height:100%;z-index:15;pointer-events:none;}" +
      "#risque-con-cardplay-legacy .risque-con-cardplay-ui{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:auto;opacity:1;transition:opacity 1s ease-in-out;}" +
      "#risque-con-cardplay-legacy .cardplay-player-name{font-family:Arial,sans-serif;font-size:20px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:.5px;text-shadow:2px 2px 2px rgba(0,0,0,.7);position:absolute;left:1110px;top:250px;z-index:10;pointer-events:none;}" +
      "#risque-con-cardplay-legacy .cardplay-message{font-family:Arial,sans-serif;font-size:24px;font-weight:bold;color:#fff;position:absolute;" +
      "left:1110px;top:900px;text-align:left;z-index:10;pointer-events:none;}" +
      "#risque-con-cardplay-legacy .cardplay-button-container{position:absolute;top:309px;left:1105px;display:flex;flex-direction:column;" +
      "align-items:flex-start;width:258px;z-index:10;}" +
      "#risque-con-cardplay-legacy .cardplay-button{width:258px;height:36px;margin:10px 0;background:#000;color:#fff;font-family:Arial,sans-serif;" +
      "font-size:16px;font-weight:bold;text-align:center;border:none;border-radius:4px;cursor:pointer;z-index:10;}" +
      "#risque-con-cardplay-legacy .cardplay-button.enabled{opacity:1;}" +
      "#risque-con-cardplay-legacy .cardplay-button:hover:not(:disabled){background:#1a1a1a;color:#fff;}" +
      "#risque-con-cardplay-legacy .cardplay-button:active:not(:disabled){transform:scale(.95);}" +
      "#risque-con-cardplay-legacy .cardplay-button:disabled{opacity:.5;cursor:not-allowed;}" +
      "#risque-con-cardplay-legacy .cardplay-button.dissolve-in{opacity:0;animation:risque-con-cardplay-dissolveIn 1s forwards;}" +
      "#risque-con-cardplay-legacy .card{position:absolute;z-index:10;cursor:pointer;}" +
      "#risque-con-cardplay-legacy .card.selected{border:3px solid #ff0;}" +
      "#risque-con-cardplay-legacy .card.played{opacity:.5;cursor:not-allowed;}" +
      "#risque-con-cardplay-legacy .card.processing{border:3px solid #f00;}" +
      "#risque-con-cardplay-legacy .popup{position:absolute;left:1105px;top:620px;width:218px;box-sizing:content-box;background:#fff;border:2px solid #000;" +
      "padding:20px;z-index:20;display:none;font-family:Arial,sans-serif;font-size:20px;}" +
      "#risque-con-cardplay-legacy .popup-message{margin-bottom:10px;}" +
      "#risque-con-cardplay-legacy .popup-select,#risque-con-cardplay-legacy .popup-input{width:100%;margin-bottom:10px;display:none;}" +
      "#risque-con-cardplay-legacy .popup-button{margin-right:10px;background:#280b0b;color:#fff;border:none;border-radius:5px;padding:8px 16px;font-size:14px;cursor:pointer;}" +
      "#risque-con-cardplay-legacy .popup-button:hover:not(:disabled){background:#3c1212;}" +
      "@keyframes risque-con-cardplay-dissolveIn{from{opacity:0}to{opacity:1}}" +
      "body.risque-con-cardplay-mounted .runtime-hud-root{visibility:hidden!important;pointer-events:none!important;}";
    document.head.appendChild(st);
  }

  function risqueConCardplayDeployUrl() {
    return "game.html?phase=deploy&kind=turn";
  }

  function risqueConCardplayIncomeUrl() {
    return "game.html?phase=con-income";
  }

  function risqueConCardplayNavigate(url) {
    try {
      document.body.classList.remove("risque-con-cardplay-mounted");
    } catch (eRm) {
      /* ignore */
    }
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(url);
    } else {
      window.location.href = url;
    }
  }

  function risqueConCardplayRecovery() {
    var u =
      typeof window.risqueLoginRecoveryViaPrivacyUrl === "function"
        ? window.risqueLoginRecoveryViaPrivacyUrl()
        : "index.html";
    risqueConCardplayNavigate(u);
  }

  function stashHostUiOverlayForConCardplay() {
    var u = document.getElementById("ui-overlay");
    if (!u || u.dataset.risqueConCardplayStash === "1") return;
    u.dataset.risqueConCardplayStash = "1";
    u.dataset.risqueConCardplayPrevId = u.id || "ui-overlay";
    u.id = "risque-ui-overlay-stashed-con-cardplay";
    u.setAttribute("hidden", "hidden");
    u.style.visibility = "hidden";
  }

  function risqueConCardplayOnResize() {
    requestAnimationFrame(function () {
      if (window.gameUtils && window.gameUtils.resizeCanvas) {
        window.gameUtils.resizeCanvas();
      }
    });
  }

  function risqueConCardplayOnWheel(e) {
    if (e.ctrlKey) e.preventDefault();
  }

  function risqueConCardplayOnKeydown(e) {
    if (e.key === "Equal" || e.key === "Minus" || (e.ctrlKey && (e.key === "+" || e.key === "-"))) {
      e.preventDefault();
    }
  }
    console.log('[Con-Cardplay] Loaded at', new Date().toLocaleString());
    window.gameUtils = window.gameUtils || {};
    window.gameUtils.initLaunchPage = () => {};
    let initialGameState = null;
    let selectedCards = [];
    let summaryMessages = [];
    let isBookSelectionMode = false;
    let isIndividualSelectionMode = false;
    let processingBook = false;
    let currentBookCardIndex = -1;
    let hasConfirmed = false;
    let playedCards = [];
    let pendingElimination = null;
    const cardPositions = [
      { x: 1409, y: 263, width: 150, height: 200 },
      { x: 1566, y: 263, width: 150, height: 200 },
      { x: 1725, y: 263, width: 150, height: 200 },
      { x: 1409, y: 468, width: 150, height: 200 },
      { x: 1566, y: 468, width: 150, height: 200 },
      { x: 1725, y: 468, width: 150, height: 200 },
      { x: 1409, y: 673, width: 150, height: 200 },
      { x: 1566, y: 673, width: 150, height: 200 },
      { x: 1725, y: 673, width: 150, height: 200 }
    ];
    function logToStorage(message, data) {
      const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      const logEntry = `[${timestamp}] [Con-Cardplay] ${message}`;
      const logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
      logs.push(logEntry);
      if (data) logs.push(JSON.stringify(data, null, 2));
      localStorage.setItem("gameLogs", JSON.stringify(logs));
      console.log(logEntry, data || '');
    }
    function conCardplayPrettyTerritory(id) {
      if (!id) return "";
      if (window.gameUtils && typeof window.gameUtils.formatTerritoryDisplayName === "function") {
        return window.gameUtils.formatTerritoryDisplayName(id);
      }
      return String(id).replace(/_/g, " ").replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
    }
    function conCardplayPrettyCardName(card) {
      if (!card) return "";
      var c = String(card).toLowerCase();
      if (c === "wildcard1" || c === "wildcard2") return "Wildcard";
      return conCardplayPrettyTerritory(card);
    }
    function prependConCardplayCombatLog(lines) {
      if (!window.gameState || !Array.isArray(lines) || !lines.length) return;
      if (!Array.isArray(window.gameState.risqueCombatLogTail)) {
        window.gameState.risqueCombatLogTail = [];
      }
      var i;
      for (i = lines.length - 1; i >= 0; i -= 1) {
        window.gameState.risqueCombatLogTail.unshift({
          text: String(lines[i]),
          kind: "cardplay"
        });
      }
      while (window.gameState.risqueCombatLogTail.length > 50) {
        window.gameState.risqueCombatLogTail.pop();
      }
    }
    /** Build TV/public mirror lines for confirmed card actions (phase con-cardplay). */
    function buildConCardplayConfirmMirror(actions, playerName) {
      var primaryParts = [];
      var reportParts = [];
      var TN = playerName || "Player";
      var bookCardIds = null;
      var bookLogLines = [];
      (actions || []).forEach(function (action) {
        if (!action) return;
        if (action.action === "book") {
          primaryParts.push(TN + " plays Book.");
          if (action.cards && action.cards.length) {
            bookCardIds = action.cards.map(function (c) {
              return c && c.card ? String(c.card).toLowerCase() : "";
            }).filter(Boolean);
          }
          (action.effects || []).forEach(function (eff) {
            var terr = conCardplayPrettyTerritory(eff.territory);
            if (eff.action === "add_troops") {
              bookLogLines.push(TN + " adds two troops to " + terr + ".");
            } else if (eff.action === "remove_troops") {
              bookLogLines.push(terr + " loses two troops.");
            } else if (eff.action === "acquire") {
              bookLogLines.push(TN + " played and acquired " + terr + ".");
            } else if (eff.action === "declined") {
              bookLogLines.push(terr + ": Declined.");
            } else if (eff.action === "no_effect") {
              bookLogLines.push(terr + ": No effect.");
            }
          });
          bookLogLines.push("Ten troops added to the bank.");
        } else if (action.action === "aerial_attack") {
          primaryParts.push(TN + " plays Wildcard.");
          reportParts.push("Aerial attack enabled this turn.");
        } else {
          var tid =
            action.territory != null && action.territory !== ""
              ? action.territory
              : action.cards && action.cards[0]
                ? action.cards[0].card
                : "";
          if (action.action === "add_troops") {
            var c0 = action.cards && action.cards[0];
            var cl = c0 ? conCardplayPrettyCardName(c0.card) : conCardplayPrettyTerritory(tid);
            primaryParts.push(TN + " plays " + cl + ".");
            reportParts.push(TN + " adds two troops to " + conCardplayPrettyTerritory(tid) + ".");
          } else if (action.action === "remove_troops") {
            var c1 = action.cards && action.cards[0];
            var cl1 = c1 ? conCardplayPrettyCardName(c1.card) : conCardplayPrettyTerritory(tid);
            primaryParts.push(TN + " plays " + cl1 + ".");
            reportParts.push(conCardplayPrettyTerritory(tid) + " loses two troops.");
          } else if (action.action === "acquire") {
            var c2 = action.cards && action.cards[0];
            var cl2 = c2 ? conCardplayPrettyCardName(c2.card) : conCardplayPrettyTerritory(tid);
            primaryParts.push(TN + " plays " + cl2 + ".");
            reportParts.push(TN + " played and acquired " + conCardplayPrettyTerritory(tid) + ".");
          } else if (action.action === "declined") {
            var c3 = action.cards && action.cards[0];
            var cl3 = c3 ? conCardplayPrettyCardName(c3.card) : "Card";
            primaryParts.push(TN + " plays " + cl3 + ".");
            reportParts.push(conCardplayPrettyTerritory(tid) + ": Declined.");
          } else if (action.action === "no_effect") {
            var c4 = action.cards && action.cards[0];
            var cl4 = c4 ? conCardplayPrettyCardName(c4.card) : conCardplayPrettyTerritory(tid);
            primaryParts.push(TN + " plays " + cl4 + ".");
            reportParts.push(conCardplayPrettyTerritory(tid) + ": No effect.");
          }
        }
      });
      var hasBookCards = bookCardIds && bookCardIds.length > 0;
      return {
        primary: primaryParts.join("\n"),
        report: reportParts.join("\n"),
        bookCardIds: hasBookCards ? bookCardIds : null,
        bookLogLines: bookLogLines.length ? bookLogLines : null
      };
    }
    function isPublicBookMapTerritory(name) {
      var n = String(name || "").toLowerCase();
      return n && n !== "wildcard1" && n !== "wildcard2";
    }
    function troopSnapshotForPublicBook(gs) {
      var m = {};
      if (!gs || !gs.players) return m;
      gs.players.forEach(function (p) {
        (p.territories || []).forEach(function (t) {
          if (t && t.name) m[t.name] = { owner: p.name, troops: Number(t.troops) || 0 };
        });
      });
      return m;
    }
    function territoryVoiceUpperForPublicBook(name) {
      if (window.gameUtils && typeof window.gameUtils.formatTerritoryDisplayName === "function") {
        return String(window.gameUtils.formatTerritoryDisplayName(name || "")).toUpperCase();
      }
      return conCardplayPrettyTerritory(name).toUpperCase();
    }
    /** Ordered steps for public TV: reverse-walk effects from final board to get from/to troop counts. */
    function buildPublicBookProcessingPayload(bookAction, playerName, gs) {
      if (!bookAction || bookAction.action !== "book" || !gs) return null;
      var TN = String(playerName || gs.currentPlayer || "Player").toUpperCase();
      var effects = bookAction.effects || [];
      var m = troopSnapshotForPublicBook(gs);
      var steps = [];
      var i;
      for (i = effects.length - 1; i >= 0; i--) {
        var e = effects[i];
        var tid = e.territory;
        var mapTid = isPublicBookMapTerritory(tid) ? tid : null;
        var step = {
          effect: e.action,
          mapTerritory: mapTid,
          voice: "",
          troopsFrom: 0,
          troopsTo: 0,
          animateTroops: false
        };
        if (e.action === "add_troops") {
          if (!mapTid || !m[mapTid]) continue;
          var toAdd = m[mapTid].troops;
          m[mapTid].troops = Math.max(0, toAdd - 2);
          var fromAdd = m[mapTid].troops;
          step.troopsFrom = fromAdd;
          step.troopsTo = toAdd;
          step.animateTroops = fromAdd !== toAdd;
          step.voice = TN + " ADDS 2 TROOPS TO " + territoryVoiceUpperForPublicBook(mapTid);
        } else if (e.action === "remove_troops") {
          if (!mapTid || !m[mapTid]) continue;
          var toRm = m[mapTid].troops;
          m[mapTid].troops = toRm + 2;
          var fromRm = m[mapTid].troops;
          step.troopsFrom = fromRm;
          step.troopsTo = toRm;
          step.animateTroops = fromRm !== toRm;
          step.voice = TN + " REMOVES 2 TROOPS FROM " + territoryVoiceUpperForPublicBook(mapTid);
        } else if (e.action === "acquire") {
          if (!mapTid || !m[mapTid]) continue;
          var toAcq = m[mapTid].troops;
          var defTroops = Number(e.troops) || 1;
          m[mapTid] = { owner: e.owner, troops: defTroops };
          step.troopsFrom = defTroops;
          step.troopsTo = toAcq;
          step.animateTroops = defTroops !== toAcq;
          step.voice = TN + " ACQUIRED " + territoryVoiceUpperForPublicBook(mapTid);
        } else if (e.action === "declined") {
          var labD = mapTid ? territoryVoiceUpperForPublicBook(mapTid) : conCardplayPrettyCardName(tid).toUpperCase();
          step.voice = TN + " DECLINED TO PROCESS " + labD;
          if (mapTid && m[mapTid]) {
            var td = m[mapTid].troops;
            step.troopsFrom = step.troopsTo = td;
          }
        } else if (e.action === "no_effect") {
          var labN = mapTid ? territoryVoiceUpperForPublicBook(mapTid) : String(tid || "").toUpperCase();
          step.voice = TN + " â€” NO EFFECT FOR " + labN;
          if (mapTid && m[mapTid]) {
            var tn0 = m[mapTid].troops;
            step.troopsFrom = step.troopsTo = tn0;
          }
        } else {
          continue;
        }
        steps.unshift(step);
      }
      if (!steps.length) return null;
      return { seq: Date.now(), playerName: playerName, steps: steps };
    }
    function applyConCardplayPublicMirror(primary, report, bookCardIds, bookLogLines, bookActionOpt, mirrorPlayerName) {
      if (!window.gameState) return;
      window.gameState.risquePublicCardplayPrimary = primary != null ? String(primary) : "";
      window.gameState.risquePublicCardplayReport = report != null ? String(report) : "";
      if (Array.isArray(bookCardIds) && bookCardIds.length > 0) {
        window.gameState.risquePublicCardplayBookCards = bookCardIds.map(function (c) {
          return String(c || "").toLowerCase();
        });
      } else {
        delete window.gameState.risquePublicCardplayBookCards;
        delete window.gameState.risquePublicBookProcessing;
      }
      if (
        Array.isArray(bookCardIds) &&
        bookCardIds.length > 0 &&
        bookActionOpt &&
        bookActionOpt.action === "book"
      ) {
        var payload = buildPublicBookProcessingPayload(
          bookActionOpt,
          mirrorPlayerName != null ? mirrorPlayerName : window.gameState.currentPlayer,
          window.gameState
        );
        if (payload && payload.steps && payload.steps.length) {
          window.gameState.risquePublicBookProcessing = payload;
        } else {
          delete window.gameState.risquePublicBookProcessing;
        }
      }
      if (Array.isArray(bookLogLines) && bookLogLines.length > 0) {
        prependConCardplayCombatLog(bookLogLines);
      }
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eMir) {
        logToStorage("applyConCardplayPublicMirror save failed", { error: String(eMir) });
      }
    }
    function clearConCardplayPublicMirror() {
      applyConCardplayPublicMirror("", "", null, null, null, null);
    }
    function cardplayInit() {
      logToStorage('Starting cardplayInit');
      let canvasWrapper = document.getElementById("canvas");
      if (!canvasWrapper) {
        logToStorage('Canvas wrapper not found, creating');
        canvasWrapper = document.createElement('div');
        canvasWrapper.className = 'canvas-wrapper';
        canvasWrapper.id = 'canvas';
        canvasWrapper.innerHTML = `
          <svg class="svg-overlay" viewBox="0 0 1920 1080"></svg>
          <div class="ui-overlay" id="risque-con-cardplay-ui"></div>
          <div id="error" class="error"></div>
        `;
        document.body.appendChild(canvasWrapper);
      }
      let uiOverlay = document.getElementById("risque-con-cardplay-ui");
      if (!uiOverlay) {
        logToStorage('UI overlay not found, creating');
        uiOverlay = document.createElement('div');
        uiOverlay.className = 'ui-overlay';
        uiOverlay.id = 'risque-con-cardplay-ui';
        canvasWrapper.appendChild(uiOverlay);
      }
      const gameState = window.gameState;
      if (!gameState || !gameState.players || !gameState.currentPlayer) {
        logToStorage('Invalid game state');
        window.gameUtils.showError("Invalid game state. Redirecting to launch.");
        setTimeout(() => { risqueConCardplayRecovery(); }, 2000);
        return;
      }
      // Conquest card play always runs income next; stale aerial flags (e.g. from wildcards) skipped con-income.
      if (window.gameUtils && typeof window.gameUtils.setAerialAttackUsesRemaining === "function") {
        window.gameUtils.setAerialAttackUsesRemaining(window.gameState, 0);
      } else {
        window.gameState.aerialAttackEligible = false;
      }
      window.gameState.aerialAttack = false;
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (e) {
        logToStorage("Could not persist aerialAttack clear", { error: String(e) });
      }
      initialGameState = JSON.parse(JSON.stringify(gameState));
      logToStorage('Game state copied', { currentPlayer: gameState.currentPlayer });
      const currentPlayer = gameState.players.find(p => p.name === gameState.currentPlayer);
      if (!currentPlayer) {
        logToStorage('Current player not found');
        window.gameUtils.showError("Current player not found. Redirecting to launch.");
        setTimeout(() => { risqueConCardplayRecovery(); }, 2000);
        return;
      }
      currentPlayer.cards = currentPlayer.cards.map(card => {
        if (typeof card === 'string') {
          return { name: card, id: generateUUID() };
        }
        return card;
      });
      currentPlayer.cardCount = currentPlayer.cards.length;
      logToStorage('Current player cards', { player: currentPlayer.name, cards: currentPlayer.cards, cardCount: currentPlayer.cardCount });
      const defaultContinents = {
        north_america: { territories: ['alaska', 'alberta', 'central_america', 'eastern_united_states', 'greenland', 'northwest_territory', 'ontario', 'quebec', 'western_united_states'], bonus: 5 },
        south_america: { territories: ['argentina', 'brazil', 'peru', 'venezuela'], bonus: 2 },
        europe: { territories: ['great_britain', 'iceland', 'northern_europe', 'scandinavia', 'southern_europe', 'ukraine', 'western_europe'], bonus: 5 },
        africa: { territories: ['congo', 'east_africa', 'egypt', 'madagascar', 'north_africa', 'south_africa'], bonus: 3 },
        asia: { territories: ['afghanistan', 'china', 'india', 'irkutsk', 'japan', 'kamchatka', 'middle_east', 'mongolia', 'siam', 'siberia', 'ural', 'yakutsk'], bonus: 7 },
        australia: { territories: ['eastern_australia', 'indonesia', 'new_guinea', 'western_australia'], bonus: 2 }
      };
      if (!gameState.continents || typeof gameState.continents !== 'object') {
        gameState.continents = defaultContinents;
        logToStorage('Initialized gameState.continents with default values and bonuses');
      }
      for (const [continent, data] of Object.entries(gameState.continents)) {
        if (!data.territories || !Array.isArray(data.territories)) {
          gameState.continents[continent] = defaultContinents[continent] || { territories: [], bonus: 0 };
          logToStorage(`Fixed malformed territories for continent ${continent}`);
        }
        if (!data.bonus) {
          gameState.continents[continent].bonus = defaultContinents[continent].bonus || 0;
          logToStorage(`Set bonus for continent ${continent}`, { bonus: gameState.continents[continent].bonus });
        }
      }
      const playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
      const hasCards = currentPlayer.cardCount > 0;
      const unplayedCards = getUnplayedCards();
      const canFormBook = unplayedCards.length >= 3 && canFormValidBook(unplayedCards);
      let cardHtml = "";
      if (hasCards) {
        unplayedCards.forEach((card, index) => {
          if (index < cardPositions.length && window.gameUtils.cardNames.includes(card.name)) {
            const pos = cardPositions[index];
            cardHtml += `
              <img class="card" src="assets/images/Cards/${String(card.name || "").toUpperCase()}.webp" style="left: ${pos.x}px; top: ${pos.y}px; width: ${pos.width}px; height: ${pos.height}px;" data-card="${card.name}" data-id="${card.id}" alt="${card.name.replace(/_/g, " ")} card">
            `;
          }
        });
      }
      uiOverlay.innerHTML = `
        <div class="cardplay-player-name" style="color: ${playerColor}">${currentPlayer.name}'s Card Play</div>
        <div id="no-cards-message" class="cardplay-message">${hasCards ? `Cards in hand: ${unplayedCards.map(c => c.name).join(', ')}` : "You have no cards, and that's OK"}</div>
        <div id="summary-lines" class="cardplay-message"></div>
        <div class="cardplay-button-container">
          <button id="play-card-button" class="cardplay-button" ${!hasCards ? 'disabled' : ''}>PLAY CARD</button>
          <button id="select-cards-button" class="cardplay-button" ${!canFormBook ? 'disabled' : ''}>SELECT CARDS FOR BOOK</button>
          <button id="reset-button" class="cardplay-button" ${!hasCards && !playedCards.some(pc => !pc.confirmed) ? 'disabled' : ''}>RESET</button>
          <button id="confirm-button" class="cardplay-button" disabled>CONFIRM</button>
          <button id="next-phase-button" class="cardplay-button dissolve-in" ${hasCards && unplayedCards.length > 4 ? 'disabled' : ''}>Proceed to Income</button>
        </div>
        ${cardHtml}
      `;
      logToStorage('UI overlay rendered', { cardCount: unplayedCards.length });
      const buttons = [
        { id: "play-card-button", enabled: hasCards, handler: handlePlayCard },
        { id: "select-cards-button", enabled: canFormBook, handler: handleSelectCards },
        { id: "reset-button", enabled: hasCards || playedCards.some(pc => !pc.confirmed), handler: handleReset },
        { id: "confirm-button", enabled: false, handler: handleConfirm },
        { id: "next-phase-button", enabled: !hasCards || unplayedCards.length <= 4, handler: handleNextPhase }
      ];
      buttons.forEach(button => {
        const el = document.getElementById(button.id);
        if (el) {
          el.disabled = !button.enabled;
          el.classList.toggle("enabled", button.enabled);
          el.onclick = button.handler;
          el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') button.handler();
          });
        } else {
          logToStorage(`Button ${button.id} not found`);
          window.gameUtils.showError(`Button ${button.id} not found`);
        }
      });
      if (hasCards) {
        document.querySelectorAll('.card').forEach(card => {
          card.addEventListener('click', () => {
            toggleCardSelection(card);
          });
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            unPlayCard(card);
          });
        });
      }
      updateSummaryDisplay();
      checkCardStatus();
      requestAnimationFrame(() => {
        logToStorage('Initializing game view');
        window.gameUtils.resizeCanvas();
        window.gameUtils.initGameView();
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
        const svgOverlay = document.querySelector('.svg-overlay');
        logToStorage('Rendering markers, numbers, and stats', { svgContent: svgOverlay ? svgOverlay.innerHTML : 'No SVG overlay' });
      });
      if (currentPlayer.cardCount > 4) {
        document.getElementById('risque-con-cardplay-error').textContent = `You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`;
      }
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      logToStorage('cardplayInit completed');
    }
    function getUnplayedCards() {
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (!currentPlayer) return [];
      const playedCardNames = playedCards.flatMap(pc => pc.cards || []);
      return currentPlayer.cards.filter(card => !playedCardNames.some(pc => pc.id === card.id));
    }
    function canFormValidBook(cards) {
      return window.gameUtils.canFormValidRisqueBook(cards);
    }
    function willEliminatePlayer(owner, territory) {
      if (!owner) return false;
      const remainingTerritories = owner.territories.filter(t => t.name !== territory);
      return remainingTerritories.length === 0 && owner.troopsTotal <= (owner.territories.find(t => t.name === territory)?.troops || 0);
    }
    async function toggleCardSelection(img) {
      const cardName = img.dataset.card;
      const cardId = img.dataset.id;
      const errorText = document.getElementById('risque-con-cardplay-error');
      if (!errorText) {
        logToStorage('Error element not found');
        return;
      }
      if (!isBookSelectionMode && !isIndividualSelectionMode) {
        errorText.textContent = 'Select an action first (e.g., Book or Play Card)';
        return;
      }
      if (img.classList.contains('played')) {
        errorText.textContent = 'Card has been played';
        return;
      }
      if (img.classList.contains('selected')) {
        img.classList.remove('selected');
        selectedCards = selectedCards.filter(c => c.id !== cardId);
        errorText.textContent = '';
        updateSummaryDisplay();
        checkCardStatus();
        return;
      }
      if (isBookSelectionMode && selectedCards.length >= 3) {
        errorText.textContent = 'Select exactly 3 cards';
        return;
      }
      if (isIndividualSelectionMode && selectedCards.length >= 1) {
        errorText.textContent = 'Select exactly 1 card';
        return;
      }
      img.classList.add('selected');
      selectedCards.push({ card: cardName, id: cardId });
      logToStorage('Card selected', { card: cardName, id: cardId });
      errorText.textContent = '';
      if (isBookSelectionMode && selectedCards.length === 3) {
        await validateAndProcessBook();
      } else if (isIndividualSelectionMode && selectedCards.length === 1) {
        const selectedCard = selectedCards[0].card;
        if (['wildcard1', 'wildcard2'].includes(selectedCard)) {
          await processWildcardCard(selectedCard, cardId);
        } else {
          await processIndividualCardEffect(selectedCard, selectedCard, cardId);
        }
      }
      checkCardStatus();
    }
    async function unPlayCard(img) {
      const cardName = img.dataset.card;
      const cardId = img.dataset.id;
      if (!img.classList.contains('played')) return;
      const action = await showPopup(`Put card ${cardName.toUpperCase()} back in hand?`);
      if (!action) return;
      const playedCardIndex = playedCards.findIndex(pc => pc.cards && pc.cards.some(c => c.id === cardId));
      if (playedCardIndex === -1) return;
      const playedCard = playedCards[playedCardIndex];
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      currentPlayer.cards.push({ name: cardName, id: cardId });
      currentPlayer.cardCount = currentPlayer.cards.length;
      if (window.gameUtils && typeof window.gameUtils.risqueReturnCardNameFromDiscard === "function") {
        window.gameUtils.risqueReturnCardNameFromDiscard(window.gameState, cardName);
      }
      playedCards.splice(playedCardIndex, 1);
      summaryMessages.splice(playedCardIndex, 1);
      loadCards();
      updateSummaryDisplay();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      logToStorage('Card unplayed', { card: cardName, id: cardId });
      checkCardStatus();
    }
    async function validateAndProcessBook() {
      const errorText = document.getElementById('risque-con-cardplay-error');
      if (!errorText) {
        logToStorage('Error element not found');
        return;
      }
      const cardNames = selectedCards.map(sc => sc.card);
      if (!validateBook(cardNames)) {
        errorText.textContent =
          'Warning: Not a valid set. You need 3 matching unit types (infantry, cavalry, or artillery), or one of each type. Wildcards count as any.';
        errorText.classList.add('cardplay-inline-error--warn');
        isBookSelectionMode = true;
        selectedCards = [];
        document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
        checkCardStatus();
        return;
      }
      const action = await showPopup('Book complete. Process card effects?');
      if (!action) {
        errorText.textContent = 'Book declined';
        isBookSelectionMode = false;
        selectedCards = [];
        document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
        checkCardStatus();
        return;
      }
      errorText.textContent = '';
      isBookSelectionMode = false;
      processingBook = true;
      currentBookCardIndex = 0;
      const bookPlayedCard = {
        action: 'book',
        cards: [...selectedCards],
        effects: [],
        confirmed: false
      };
      playedCards.push(bookPlayedCard);
      summaryMessages.push(`Book: ${cardNames.map(c => c.toUpperCase()).join(', ')} - Pending`);
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      const originalCardCount = currentPlayer.cards.length;
      const originalCards = [...currentPlayer.cards];
      const idsToRemove = selectedCards.map(sc => sc.id);
      currentPlayer.cards = currentPlayer.cards.filter(card => !idsToRemove.includes(card.id));
      currentPlayer.cardCount = currentPlayer.cards.length;
      if (window.gameUtils && typeof window.gameUtils.risqueDiscardCardNames === "function") {
        window.gameUtils.risqueDiscardCardNames(
          window.gameState,
          selectedCards.map(sc => sc.card)
        );
      }
      logToStorage('Cards removed for book', {
        originalCards: originalCardCount,
        removed: selectedCards.map(sc => ({ name: sc.card, id: sc.id })),
        remaining: currentPlayer.cards
      });
      if (currentPlayer.cards.length !== originalCardCount - 3) {
        logToStorage('Card removal warning: unexpected count', {
          expected: originalCardCount - 3,
          actual: currentPlayer.cards.length,
          originalCards,
          removedIds: idsToRemove,
          remainingCards: currentPlayer.cards
        });
        errorText.textContent = `Warning: Removed ${originalCardCount - currentPlayer.cards.length} cards instead of 3. Continuing.`;
      }
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      logToStorage('Book selected, processing effects', { cards: cardNames, cardCount: currentPlayer.cardCount });
      updateSummaryDisplay();
      await processBookCardEffect(bookPlayedCard);
    }
    async function processBookCardEffect(bookPlayedCard) {
      if (currentBookCardIndex >= selectedCards.length) {
        processingBook = false;
        currentBookCardIndex = -1;
        document.querySelectorAll('.card').forEach(card => card.classList.remove('processing'));
        const effectMessages = bookPlayedCard.effects.map(effect => {
          if (effect.action === 'add_troops') {
            return `${effect.territory.toUpperCase()}: +2 troops (${
              window.gameState.players.find(p => p.name === window.gameState.currentPlayer).territories.find(t => t.name === effect.territory)?.troops.toString().padStart(3, '0') || '000'
            })`;
          } else if (effect.action === 'remove_troops') {
            return `${effect.territory.toUpperCase()}: ${effect.owner} lost 2 troops (${
              window.gameState.players.find(p => p.name === effect.owner)?.territories.find(t => t.name === effect.territory)?.troops.toString().padStart(3, '0') || '000'
            } remaining)`;
          } else if (effect.action === 'acquire') {
            return `${effect.territory.toUpperCase()}: Acquired by ${window.gameState.currentPlayer} (001)`;
          } else if (effect.action === 'declined') {
            return `${effect.territory.toUpperCase()}: Declined`;
          } else {
            return `${effect.territory.toUpperCase()}: No effect`;
          }
        });
        const index = summaryMessages.findIndex(msg => msg.startsWith(`Book: ${bookPlayedCard.cards.map(c => c.card.toUpperCase()).join(', ')}`));
        summaryMessages[index] = `Book: ${bookPlayedCard.cards.map(c => c.card.toUpperCase()).join(', ')} - ${effectMessages.join('; ')}`;
        updateSummaryDisplay();
        localStorage.setItem('gameState', JSON.stringify(window.gameState));
        logToStorage('Book effects processed', { effects: bookPlayedCard.effects });
        selectedCards = [];
        document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
        const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
        const unplayedCards = getUnplayedCards();
        if (unplayedCards.length >= 3 && canFormValidBook(unplayedCards)) {
          document.getElementById('risque-con-cardplay-error').textContent = `Book processed. Select another book or confirm actions. (${unplayedCards.length} cards left)`;
          isBookSelectionMode = true;
        } else if (currentPlayer.cardCount > 4) {
          document.getElementById('risque-con-cardplay-error').textContent = `You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`;
        } else {
          document.getElementById('risque-con-cardplay-error').textContent = 'Book processed. Confirm actions or play individual cards.';
        }
        loadCards();
        checkCardStatus();
        return;
      }
      document.querySelectorAll('.card').forEach(card => card.classList.remove('processing'));
      const card = selectedCards[currentBookCardIndex].card;
      const cardId = selectedCards[currentBookCardIndex].id;
      const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
      if (cardElement) {
        cardElement.classList.add('processing');
      }
      let territory = card;
      if (['wildcard1', 'wildcard2'].includes(card)) {
        const territoryOptions = window.gameUtils.cardNames
          .filter(name => !['wildcard1', 'wildcard2'].includes(name))
          .map(name => ({ value: name, text: name.toUpperCase() }));
        territory = await showPopup('Assign wildcard to a territory:', territoryOptions);
        if (!territory || !window.gameUtils.cardNames.includes(territory.toLowerCase())) {
          bookPlayedCard.effects.push({ territory: card, action: 'declined', cardId });
          updateSummaryDisplay();
          currentBookCardIndex++;
          localStorage.setItem('gameState', JSON.stringify(window.gameState));
          await processBookCardEffect(bookPlayedCard);
          return;
        }
        territory = territory.toLowerCase();
      }
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      const isOwned = currentPlayer.territories.some(t => t.name === territory);
      let message = '';
      let action = false;
      let effect = { territory, card, cardId };
      if (isOwned) {
        message = `Add 2 troops to ${territory.toUpperCase()}?`;
        action = await showPopup(message);
        if (window.isResetting) return;
        if (action) {
          const territoryObj = currentPlayer.territories.find(t => t.name === territory);
          if (territoryObj) {
            territoryObj.troops = (territoryObj.troops || 1) + 2;
            currentPlayer.troopsTotal += 2;
            effect.action = 'add_troops';
            localStorage.setItem('gameState', JSON.stringify(window.gameState));
            window.gameUtils.renderTerritories(territory, window.gameState);
            logToStorage('Added troops to owned territory', { territory, troops: territoryObj.troops });
          }
        } else {
          effect.action = 'declined';
        }
      } else {
        const owner = window.gameState.players.find(p => p.territories.some(t => t.name === territory));
        if (!owner) {
          effect.action = 'no_effect';
        } else {
          const troops = owner.territories.find(t => t.name === territory)?.troops || 1;
          if (troops > 2) {
            message = `Remove 2 troops from ${territory.toUpperCase()}?`;
            action = await showPopup(message);
            if (window.isResetting) return;
            if (action) {
              const territoryObj = owner.territories.find(t => t.name === territory);
              if (territoryObj) {
                territoryObj.troops -= 2;
                owner.troopsTotal -= 2;
                effect.action = 'remove_troops';
                effect.owner = owner.name;
                localStorage.setItem('gameState', JSON.stringify(window.gameState));
                window.gameUtils.renderTerritories(territory, window.gameState);
                logToStorage('Removed troops from enemy territory', { territory, owner: owner.name, troops: territoryObj.troops });
              }
            } else {
              effect.action = 'declined';
            }
          } else {
            message = `Acquire ${territory.toUpperCase()}?`;
            action = await showPopup(message);
            if (window.isResetting) return;
            if (action) {
              const ownerTerritory = owner.territories.find(t => t.name === territory);
              if (ownerTerritory) {
                if (willEliminatePlayer(owner, territory)) {
                  pendingElimination = {
                    type: 'book',
                    bookPlayedCard,
                    territory,
                    owner: owner.name,
                    ownerTerritory,
                    card,
                    effect,
                    cardId,
                    index: currentBookCardIndex
                  };
                  showPopup(`Acquiring ${territory.toUpperCase()} will eliminate ${owner.name}. Hit confirm to proceed.`, null, false, true);
                  return;
                }
                owner.territories = owner.territories.filter(t => t.name !== territory);
                owner.troopsTotal -= ownerTerritory.troops;
                currentPlayer.territories.push({ name: territory, troops: 1 });
                currentPlayer.troopsTotal += 1;
                effect.action = 'acquire';
                effect.owner = owner.name;
                effect.troops = ownerTerritory.troops;
                localStorage.setItem('gameState', JSON.stringify(window.gameState));
                window.gameUtils.renderTerritories(territory, window.gameState);
                logToStorage('Territory acquired', { territory, from: owner.name, to: currentPlayer.name });
              }
            } else {
              effect.action = 'declined';
            }
          }
        }
      }
      bookPlayedCard.effects.push(effect);
      if (cardElement) {
        cardElement.classList.add('played');
        cardElement.classList.remove('processing');
      }
      currentBookCardIndex++;
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      await processBookCardEffect(bookPlayedCard);
    }
    async function processIndividualCardEffect(card, territory, cardId) {
      isIndividualSelectionMode = false;
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      let playedCardData = { cards: [{ card, id: cardId }], action: '', confirmed: false };
      if (['wildcard1', 'wildcard2'].includes(card)) {
        playedCardData.territory = territory;
      } else {
        territory = card;
      }
      const isOwned = currentPlayer.territories.some(t => t.name === territory);
      let message = '';
      let action = false;
      if (isOwned) {
        message = `Add 2 troops to ${territory.toUpperCase()}?`;
        action = await showPopup(message);
        if (window.isResetting) return;
        if (action) {
          const territoryObj = currentPlayer.territories.find(t => t.name === territory);
          if (territoryObj) {
            territoryObj.troops = (territoryObj.troops || 1) + 2;
            currentPlayer.troopsTotal += 2;
            summaryMessages.push(`${territory}: +2 troops (${territoryObj.troops.toString().padStart(3, '0')}) - Pending`);
            playedCardData.action = 'add_troops';
            localStorage.setItem('gameState', JSON.stringify(window.gameState));
            window.gameUtils.renderTerritories(territory, window.gameState);
            logToStorage('Added troops to owned territory', { territory, troops: territoryObj.troops });
          }
        } else {
          summaryMessages.push(`${territory}: Declined - Pending`);
          playedCardData.action = 'declined';
        }
      } else {
        const owner = window.gameState.players.find(p => p.territories.some(t => t.name === territory));
        if (!owner) {
          summaryMessages.push(`${territory}: No owner, no effect - Pending`);
          playedCardData.action = 'no_effect';
        } else {
          const troops = owner.territories.find(t => t.name === territory)?.troops || 1;
          if (troops > 2) {
            message = `Remove 2 troops from ${territory.toUpperCase()}?`;
            action = await showPopup(message);
            if (window.isResetting) return;
            if (action) {
              const territoryObj = owner.territories.find(t => t.name === territory);
              if (territoryObj) {
                territoryObj.troops -= 2;
                owner.troopsTotal -= 2;
                summaryMessages.push(`${territory}: ${owner.name} lost 2 troops (${territoryObj.troops.toString().padStart(3, '0')} remaining) - Pending`);
                playedCardData.action = 'remove_troops';
                playedCardData.owner = owner.name;
                localStorage.setItem('gameState', JSON.stringify(window.gameState));
                window.gameUtils.renderTerritories(territory, window.gameState);
                logToStorage('Removed troops from enemy territory', { territory, owner: owner.name, troops: territoryObj.troops });
              }
            } else {
              summaryMessages.push(`${territory}: Declined - Pending`);
              playedCardData.action = 'declined';
            }
          } else {
            message = `Acquire ${territory.toUpperCase()}?`;
            action = await showPopup(message);
            if (window.isResetting) return;
            if (action) {
              const ownerTerritory = owner.territories.find(t => t.name === territory);
              if (ownerTerritory) {
                if (willEliminatePlayer(owner, territory)) {
                  pendingElimination = {
                    type: 'individual',
                    playedCardData,
                    territory,
                    owner: owner.name,
                    ownerTerritory,
                    card,
                    cardId
                  };
                  playedCards.push(playedCardData);
                  currentPlayer.cards = currentPlayer.cards.filter(c => c.id !== cardId);
                  currentPlayer.cardCount = currentPlayer.cards.length;
                  if (window.gameUtils && typeof window.gameUtils.risqueDiscardCardNames === "function") {
                    window.gameUtils.risqueDiscardCardNames(window.gameState, [card]);
                  }
                  const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
                  if (cardElement) {
                    cardElement.classList.add('played');
                  }
                  summaryMessages.push(`${territory}: Acquired by ${currentPlayer.name} (001) - Pending`);
                  showPopup(`Acquiring ${territory.toUpperCase()} will eliminate ${owner.name}. Hit confirm to proceed.`, null, false, true);
                  updateSummaryDisplay();
                  localStorage.setItem('gameState', JSON.stringify(window.gameState));
                  checkCardStatus();
                  return;
                }
                owner.territories = owner.territories.filter(t => t.name !== territory);
                owner.troopsTotal -= ownerTerritory.troops;
                currentPlayer.territories.push({ name: territory, troops: 1 });
                currentPlayer.troopsTotal += 1;
                summaryMessages.push(`${territory}: Acquired by ${currentPlayer.name} (001) - Pending`);
                playedCardData.action = 'acquire';
                playedCardData.owner = owner.name;
                playedCardData.troops = ownerTerritory.troops;
                localStorage.setItem('gameState', JSON.stringify(window.gameState));
                window.gameUtils.renderTerritories(territory, window.gameState);
                logToStorage('Territory acquired', { territory, from: owner.name, to: currentPlayer.name });
              }
            } else {
              summaryMessages.push(`${territory}: Declined - Pending`);
              playedCardData.action = 'declined';
            }
          }
        }
      }
      playedCards.push(playedCardData);
      currentPlayer.cards = currentPlayer.cards.filter(c => c.id !== cardId);
      currentPlayer.cardCount = currentPlayer.cards.length;
      if (window.gameUtils && typeof window.gameUtils.risqueDiscardCardNames === "function") {
        window.gameUtils.risqueDiscardCardNames(window.gameState, [card]);
      }
      const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
      if (cardElement) {
        cardElement.classList.add('played');
      }
      updateSummaryDisplay();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      checkCardStatus();
    }
    async function processWildcardCard(card, cardId) {
      isIndividualSelectionMode = false;
      const options = [
        { value: 'territory', text: '1) Territory Card' },
        { value: 'aerial', text: '2) Aerial Attack' }
      ];
      const action = await showPopup('Use wildcard as:', options);
      selectedCards = [];
      document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
      if (!action) {
        if (window.isResetting) return;
        summaryMessages.push('Wildcard: Declined - Pending');
        playedCards.push({ cards: [{ card, id: cardId }], action: 'declined', confirmed: false });
        updateSummaryDisplay();
        document.getElementById('risque-con-cardplay-error').textContent = '';
        checkCardStatus();
        return;
      }
      let playedCardData = { cards: [{ card, id: cardId }], confirmed: false };
      if (action === 'territory') {
        const territoryOptions = window.gameUtils.cardNames
          .filter(name => !['wildcard1', 'wildcard2'].includes(name))
          .map(name => ({ value: name, text: name.toUpperCase() }));
        const territory = await showPopup('Select territory for wildcard:', territoryOptions);
        if (!territory || !window.gameUtils.cardNames.includes(territory.toLowerCase())) {
          if (window.isResetting) return;
          summaryMessages.push('Wildcard: Territory selection declined - Pending');
          playedCards.push({ cards: [{ card, id: cardId }], action: 'declined', confirmed: false });
          updateSummaryDisplay();
          document.getElementById('risque-con-cardplay-error').textContent = '';
          checkCardStatus();
          return;
        }
        await processIndividualCardEffect(card, territory.toLowerCase(), cardId);
      } else if (action === 'aerial') {
        if (window.isResetting) return;
        if (window.gameUtils && typeof window.gameUtils.addAerialAttackUses === "function") {
          window.gameUtils.addAerialAttackUses(window.gameState, 1);
        } else {
          window.gameState.aerialAttackEligible = true;
        }
        window.gameState.aerialAttack = false;
        summaryMessages.push('Wildcard: Aerial Attack enabled - Pending');
        playedCardData.action = 'aerial_attack';
        playedCards.push(playedCardData);
        const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
        currentPlayer.cards = currentPlayer.cards.filter(c => c.id !== cardId);
        currentPlayer.cardCount = currentPlayer.cards.length;
        if (window.gameUtils && typeof window.gameUtils.risqueDiscardCardNames === "function") {
          window.gameUtils.risqueDiscardCardNames(window.gameState, [card]);
        }
        const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
        if (cardElement) {
          cardElement.classList.add('played');
        }
        updateSummaryDisplay();
        document.getElementById('confirm-button').disabled = !playedCards.some(pc => !pc.confirmed) || getUnplayedCards().length > 4;
        localStorage.setItem('gameState', JSON.stringify(window.gameState));
        logToStorage('Wildcard used for aerial attack', { card, id: cardId });
        checkCardStatus();
      }
    }
    function checkPlayerElimination() {
      const players = window.gameState.players;
      for (const player of players) {
        if (player.name !== window.gameState.currentPlayer && player.territories.length === 0 && player.troopsTotal <= 0) {
          return true;
        }
      }
      return false;
    }
    function updateSummaryDisplay() {
      const summaryDiv = document.getElementById('summary-lines');
      if (summaryDiv) {
        summaryDiv.innerHTML = '';
        summaryMessages.forEach(msg => {
          const line = document.createElement('div');
          line.className = 'summary-line';
          line.textContent = msg;
          summaryDiv.appendChild(line);
        });
      }
      const noCardsMessage = document.getElementById('no-cards-message');
      if (noCardsMessage) {
        const unplayedCards = getUnplayedCards();
        noCardsMessage.textContent = unplayedCards.length > 0 ? `Cards in hand: ${unplayedCards.map(c => c.name).join(', ')}` : "You have no cards, and that's OK";
      }
    }
    function loadCards() {
      document.querySelectorAll('.card').forEach(card => card.remove());
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      const unplayedCards = getUnplayedCards();
      let cardHtml = '';
      unplayedCards.forEach((card, index) => {
        if (index >= cardPositions.length) return;
        if (!window.gameUtils.cardNames.includes(card.name)) return;
        const pos = cardPositions[index];
        cardHtml += `
          <img class="card" src="assets/images/Cards/${String(card.name || "").toUpperCase()}.webp" style="left: ${pos.x}px; top: ${pos.y}px; width: ${pos.width}px; height: ${pos.height}px;" data-card="${card.name}" data-id="${card.id}" alt="${card.name.replace(/_/g, " ")} card">
        `;
      });
      const uiOverlay = document.getElementById("risque-con-cardplay-ui");
      if (uiOverlay) {
        uiOverlay.insertAdjacentHTML("beforeend", cardHtml);
      } else {
        logToStorage('UI overlay not found for card rendering');
        window.gameUtils.showError("UI overlay not found for card rendering");
      }
      document.querySelectorAll('.card').forEach(card => {
        card.addEventListener('click', () => {
          toggleCardSelection(card);
        });
        card.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          unPlayCard(card);
        });
      });
      logToStorage('Cards loaded', { cards: unplayedCards });
    }
    function checkCardStatus() {
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (!currentPlayer) {
        logToStorage('Current player not found in checkCardStatus');
        return;
      }
      const unplayedCards = getUnplayedCards();
      const canFormBook = unplayedCards.length >= 3 && canFormValidBook(unplayedCards);
      const hasUnconfirmedActions = playedCards.some(pc => !pc.confirmed) || pendingElimination;
      const buttons = [
        { id: 'play-card-button', enabled: unplayedCards.length > 0 && !processingBook },
        { id: 'select-cards-button', enabled: canFormBook && !processingBook },
        { id: 'reset-button', enabled: hasUnconfirmedActions || unplayedCards.length > 0 },
        { id: 'confirm-button', enabled: hasUnconfirmedActions },
        { id: 'next-phase-button', enabled: !hasUnconfirmedActions && (!unplayedCards.length || unplayedCards.length <= 4) }
      ];
      buttons.forEach(button => {
        const el = document.getElementById(button.id);
        if (el) {
          el.disabled = !button.enabled;
          el.classList.toggle("enabled", button.enabled);
        }
      });
      if (currentPlayer.cardCount > 4) {
        var errO = document.getElementById('risque-con-cardplay-error');
        if (errO) {
          var keepInv = /not a valid set|invalid book/i.test(String(errO.textContent || ''));
          if (!keepInv) {
            errO.textContent = `You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`;
            errO.classList.remove('cardplay-inline-error--warn');
          } else {
            errO.classList.add('cardplay-inline-error--warn');
          }
        }
      }
    }
    function validateBook(cards) {
      if (!cards || cards.length !== 3) return false;
      const ids = cards
        .map(function (c) {
          return typeof c === 'string' ? c : c && c.name;
        })
        .filter(Boolean);
      return ids.length === 3 && window.gameUtils.isValidRisqueThreeCardSet(ids);
    }
    function handlePlayCard() {
      if (processingBook) {
        document.getElementById('risque-con-cardplay-error').textContent = 'Finish book selection first';
        return;
      }
      isIndividualSelectionMode = true;
      isBookSelectionMode = false;
      selectedCards = [];
      document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
      document.getElementById('risque-con-cardplay-error').textContent = 'Select one card';
      checkCardStatus();
    }
    function handleSelectCards() {
      if (processingBook) {
        document.getElementById('risque-con-cardplay-error').textContent = 'Finish book selection first';
        return;
      }
      isBookSelectionMode = true;
      isIndividualSelectionMode = false;
      selectedCards = [];
      document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
      document.getElementById('risque-con-cardplay-error').textContent = 'Select three cards';
      checkCardStatus();
    }
    function handleReset() {
      window.isResetting = true;
      const popup = document.getElementById('popup');
      if (popup && popup.style.display === 'block' && window.popupResolve) {
        popup.style.display = 'none';
        const yesButton = document.getElementById('yes-button');
        const noButton = document.getElementById('no-button');
        if (yesButton) yesButton.replaceWith(yesButton.cloneNode(true));
        if (noButton) noButton.replaceWith(noButton.cloneNode(true));
        window.popupResolve(false);
        window.popupResolve = null;
      }
      window.gameState = JSON.parse(JSON.stringify(initialGameState));
      window.gameState.cardplayConquered = false;
      playedCards = [];
      summaryMessages = [];
      isBookSelectionMode = false;
      isIndividualSelectionMode = false;
      processingBook = false;
      currentBookCardIndex = -1;
      hasConfirmed = false;
      selectedCards = [];
      pendingElimination = null;
      document.querySelectorAll('.card').forEach(card => {
        card.classList.remove('selected');
        card.classList.remove('played');
        card.classList.remove('processing');
      });
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (currentPlayer) {
        currentPlayer.cards = currentPlayer.cards.map(card => {
          if (typeof card === 'string') {
            return { name: card, id: generateUUID() };
          }
          return card;
        });
        currentPlayer.cardCount = currentPlayer.cards.length;
      }
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      clearConCardplayPublicMirror();
      logToStorage('Reset card play phase');
      loadCards();
      updateSummaryDisplay();
      checkCardStatus();
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
      window.isResetting = false;
    }
    function handleConfirm() {
      const unconfirmedActions = playedCards.filter(pc => !pc.confirmed);
      if (unconfirmedActions.length === 0 && !pendingElimination) {
        document.getElementById('risque-con-cardplay-error').textContent = 'No actions to confirm';
        return;
      }
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (pendingElimination) {
        const { type, territory, owner, ownerTerritory, card, bookPlayedCard, effect, cardId, index } = pendingElimination;
        const ownerPlayer = window.gameState.players.find(p => p.name === owner);
        window.gameState.defeatedPlayer = owner;
        window.gameState.cardplayConquered = true;
        window.gameState.conqueredThisTurn = true;
        /* Match phases/cardplay.js: capturing via cardplay still earns a deck card at receive-card / reinforce. */
        window.gameState.cardEarnedViaCardplay = true;
        ownerPlayer.territories = ownerPlayer.territories.filter(t => t.name !== territory);
        ownerPlayer.troopsTotal -= ownerTerritory.troops;
        currentPlayer.territories.push({ name: territory, troops: 1 });
        currentPlayer.troopsTotal += 1;
        if (type === 'book') {
          effect.action = 'acquire';
          effect.owner = owner;
          effect.troops = ownerTerritory.troops;
          bookPlayedCard.effects.push(effect);
          const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
          if (cardElement) {
            cardElement.classList.add('played');
            cardElement.classList.remove('processing');
          }
          currentBookCardIndex = index + 1;
          localStorage.setItem('gameState', JSON.stringify(window.gameState));
          window.gameUtils.renderTerritories(territory, window.gameState);
          logToStorage('Territory acquired, player eliminated', { territory, from: owner, to: currentPlayer.name });
          pendingElimination = null;
          const popup = document.getElementById('popup');
          if (popup) popup.style.display = 'none';
          if (currentBookCardIndex < selectedCards.length) {
            processBookCardEffect(bookPlayedCard);
            return;
          } else {
            const effectMessages = bookPlayedCard.effects.map(effect => {
              if (effect.action === 'add_troops') {
                return `${effect.territory.toUpperCase()}: +2 troops (${
                  window.gameState.players.find(p => p.name === window.gameState.currentPlayer).territories.find(t => t.name === effect.territory)?.troops.toString().padStart(3, '0') || '000'
                })`;
              } else if (effect.action === 'remove_troops') {
                return `${effect.territory.toUpperCase()}: ${effect.owner} lost 2 troops (${
                  window.gameState.players.find(p => p.name === effect.owner)?.territories.find(t => t.name === effect.territory)?.troops.toString().padStart(3, '0') || '000'
                } remaining)`;
              } else if (effect.action === 'acquire') {
                return `${effect.territory.toUpperCase()}: Acquired by ${window.gameState.currentPlayer} (001)`;
              } else if (effect.action === 'declined') {
                return `${effect.territory.toUpperCase()}: Declined`;
              } else {
                return `${effect.territory.toUpperCase()}: No effect`;
              }
            });
            const index = summaryMessages.findIndex(msg => msg.startsWith(`Book: ${bookPlayedCard.cards.map(c => c.card.toUpperCase()).join(', ')}`));
            summaryMessages[index] = `Book: ${bookPlayedCard.cards.map(c => c.card.toUpperCase()).join(', ')} - ${effectMessages.join('; ')}`;
            updateSummaryDisplay();
            processingBook = false;
            currentBookCardIndex = -1;
            document.querySelectorAll('.card').forEach(card => card.classList.remove('processing'));
            selectedCards = [];
            window.gameState.players = window.gameState.players.filter(p => p.name !== owner);
            window.gameState.defeatedPlayer = null;
            window.gameState.cardplayConquered = false;
            localStorage.setItem('gameState', JSON.stringify(window.gameState));
            logToStorage('Book effects processed, player removed', { effects: bookPlayedCard.effects, removedPlayer: owner });
            {
              const mirElimBook = buildConCardplayConfirmMirror([bookPlayedCard], currentPlayer.name);
              applyConCardplayPublicMirror(
                mirElimBook.primary,
                mirElimBook.report,
                mirElimBook.bookCardIds,
                mirElimBook.bookLogLines,
                bookPlayedCard,
                currentPlayer.name
              );
            }
            checkCardStatus();
            document.getElementById('risque-con-cardplay-ui').classList.add('fade-out');
            setTimeout(() => { risqueConCardplayNavigate("game.html?phase=conquer"); }, 2000);
            return;
          }
        } else {
          let playedCardData = pendingElimination.playedCardData;
          playedCardData.action = 'acquire';
          playedCardData.owner = owner;
          playedCardData.troops = ownerTerritory.troops;
          playedCardData.territory = territory;
          localStorage.setItem('gameState', JSON.stringify(window.gameState));
          window.gameUtils.renderTerritories(territory, window.gameState);
          logToStorage('Territory acquired, player eliminated', { territory, from: owner, to: currentPlayer.name });
          window.gameState.players = window.gameState.players.filter(p => p.name !== owner);
          window.gameState.defeatedPlayer = null;
          window.gameState.cardplayConquered = false;
          localStorage.setItem('gameState', JSON.stringify(window.gameState));
          logToStorage('Player removed', { removedPlayer: owner });
          pendingElimination = null;
          const popup = document.getElementById('popup');
          if (popup) popup.style.display = 'none';
          updateSummaryDisplay();
          {
            const mirElimInd = buildConCardplayConfirmMirror([playedCardData], currentPlayer.name);
            applyConCardplayPublicMirror(
              mirElimInd.primary,
              mirElimInd.report,
              mirElimInd.bookCardIds,
              mirElimInd.bookLogLines,
              null,
              null
            );
          }
          checkCardStatus();
          document.getElementById('risque-con-cardplay-ui').classList.add('fade-out');
          setTimeout(() => { risqueConCardplayNavigate("game.html?phase=conquer"); }, 2000);
          return;
        }
      }
      unconfirmedActions.forEach(action => {
        if (action.action === 'book') {
          currentPlayer.troopsTotal += 10;
          currentPlayer.bookValue = (currentPlayer.bookValue || 0) + 1;
          currentPlayer.bankValue = (currentPlayer.bankValue || 0) + 10;
          summaryMessages.push('Book: 10 troops added to BANK - Confirmed');
        } else if (action.action === 'aerial_attack') {
          window.gameState.aerialAttack = false;
          summaryMessages.push('Wildcard: Aerial Attack enabled - Confirmed');
        } else if (action.action === 'add_troops') {
          summaryMessages.push(`${action.territory.toUpperCase()}: +2 troops (${currentPlayer.territories.find(t => t.name === action.territory)?.troops.toString().padStart(3, '0') || '000'}) - Confirmed`);
        } else if (action.action === 'remove_troops') {
          summaryMessages.push(`${action.territory.toUpperCase()}: ${action.owner} lost 2 troops (${window.gameState.players.find(p => p.name === action.owner)?.territories.find(t => t.name === action.territory)?.troops.toString().padStart(3, '0') || '000'} remaining) - Confirmed`);
        } else if (action.action === 'acquire') {
          summaryMessages.push(`${action.territory.toUpperCase()}: Acquired by ${currentPlayer.name} (001) - Confirmed`);
        } else if (action.action === 'declined') {
          summaryMessages.push(`${action.territory.toUpperCase()}: Declined - Confirmed`);
        } else if (action.action === 'no_effect') {
          summaryMessages.push(`${action.territory.toUpperCase()}: No effect - Confirmed`);
        }
        action.confirmed = true;
        const index = summaryMessages.findIndex(msg => msg.includes('Pending') && msg.includes(action.cards.map(c => c.card.toUpperCase()).join(', ')));
        if (index !== -1) {
          summaryMessages[index] = summaryMessages[index].replace(' - Pending', ' - Confirmed');
        }
      });
      if (unconfirmedActions.length > 0) {
        window.gameState.cardEarnedViaCardplay = true;
      }
      hasConfirmed = true;
      {
        const mir = buildConCardplayConfirmMirror(unconfirmedActions, currentPlayer.name);
        const bookForPublic = unconfirmedActions.find(a => a.action === "book") || null;
        applyConCardplayPublicMirror(
          mir.primary,
          mir.report,
          mir.bookCardIds,
          mir.bookLogLines,
          bookForPublic,
          currentPlayer.name
        );
      }
      updateSummaryDisplay();
      checkCardStatus();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      logToStorage('Actions confirmed', { actions: unconfirmedActions });
      window.gameUtils.renderStats(window.gameState);
    }
    function handleNextPhase() {
      const unplayedCards = getUnplayedCards();
      if (unplayedCards.length > 4) {
        document.getElementById('risque-con-cardplay-error').textContent = 'You must play down to 4 cards or fewer';
        return;
      }
      if (playedCards.some(pc => !pc.confirmed) || pendingElimination) {
        document.getElementById('risque-con-cardplay-error').textContent = 'Confirm all actions before proceeding';
        return;
      }
      try {
        var gsNav = window.gameState;
        var navResolved = null;
        try {
          if (
            window.risquePostCardplayNavigator &&
            typeof window.risquePostCardplayNavigator.resolveAfterConCardplay === 'function'
          ) {
            navResolved = window.risquePostCardplayNavigator.resolveAfterConCardplay(gsNav);
          }
        } catch (eNav2) {
          navResolved = null;
        }
        var nextPage;
        if (navResolved && navResolved.href && navResolved.phase) {
          gsNav.phase = navResolved.phase;
          try {
            gsNav.risquePostCardplayCalculatorId = navResolved.calculatorId || '';
          } catch (eCid) {
            /* ignore */
          }
          nextPage = navResolved.href;
          logToStorage('Navigating after con-cardplay (navigator)', { next: nextPage, calculatorId: navResolved.calculatorId });
        } else {
          gsNav.phase = gsNav.aerialAttackEligible ? 'deploy' : 'con-income';
          nextPage = gsNav.aerialAttackEligible ? risqueConCardplayDeployUrl() : risqueConCardplayIncomeUrl();
          logToStorage('Navigating to ' + nextPage);
        }
        localStorage.setItem('gameState', JSON.stringify(gsNav));
        document.getElementById('risque-con-cardplay-ui').classList.add('fade-out');
        setTimeout(() => {
          risqueConCardplayNavigate(nextPage);
        }, 2000);
      } catch (e) {
        console.error('[Con-Cardplay] Failed to proceed:', e);
        logToStorage('Failed to proceed', { error: e.message });
        window.gameUtils.showError('Failed to navigate to ' + (window.gameState.aerialAttackEligible ? risqueConCardplayDeployUrl() : risqueConCardplayIncomeUrl()));
      }
    }
    function showPopup(message, options = null, showInput = false, notification = false) {
      return new Promise(resolve => {
        let popup = document.getElementById('popup');
        if (!popup) {
          popup = document.createElement('div');
          popup.id = 'popup';
          popup.className = 'popup';
          popup.innerHTML = `
            <div id="popup-message" class="popup-message"></div>
            <select id="popup-select" class="popup-select"></select>
            <input id="popup-input" type="text" class="popup-input">
            <button id="yes-button" class="popup-button">Yes</button>
            <button id="no-button" class="popup-button">No</button>
          `;
          document.getElementById('risque-con-cardplay-ui').appendChild(popup);
        }
        const popupMessage = document.getElementById('popup-message');
        const popupSelect = document.getElementById('popup-select');
        const popupInput = document.getElementById('popup-input');
        const yesButton = document.getElementById('yes-button');
        const noButton = document.getElementById('no-button');
        popupMessage.textContent = message;
        popupInput.style.display = showInput ? 'block' : 'none';
        popupInput.value = '';
        if (options) {
          popupSelect.innerHTML = '';
          options.forEach(option => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.text;
            popupSelect.appendChild(opt);
          });
          popupSelect.style.display = 'block';
        } else {
          popupSelect.style.display = 'none';
        }
        yesButton.style.display = notification ? 'none' : 'inline-block';
        noButton.style.display = notification ? 'none' : 'inline-block';
        popup.style.display = 'block';
        if (notification) {
          window.popupResolve = resolve;
          return;
        }
        window.popupResolve = resolve;
        const handleResponse = (response) => {
          popup.style.display = 'none';
          window.popupResolve = null;
          resolve(response);
          yesButton.removeEventListener('click', yesHandler);
          noButton.removeEventListener('click', noHandler);
        };
        const yesHandler = () => handleResponse(options ? popupSelect.value : (showInput ? popupInput.value : true));
        const noHandler = () => handleResponse(false);
        yesButton.addEventListener('click', yesHandler);
        noButton.addEventListener('click', noHandler);
      });
    }
  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    injectConCardplayStyles();
    stashHostUiOverlayForConCardplay();
    document.body.classList.add("risque-con-cardplay-mounted");

    var canvas = document.getElementById("canvas");
    if (!canvas || !window.gameUtils) {
      return;
    }
    var prev = document.getElementById("risque-con-cardplay-legacy");
    if (prev && prev.parentNode) {
      prev.parentNode.removeChild(prev);
    }
    var shell = document.createElement("div");
    shell.id = "risque-con-cardplay-legacy";
    var ui = document.createElement("div");
    ui.id = "risque-con-cardplay-ui";
    ui.className = "risque-con-cardplay-ui";
    var err = document.createElement("div");
    err.id = "risque-con-cardplay-error";
    err.className = "error";
    shell.appendChild(ui);
    shell.appendChild(err);
    canvas.appendChild(shell);

    if (window.risqueDisplayIsPublic) {
      shell.style.pointerEvents = "none";
    }

    function beginAfterState(gs) {
      if (!gs) {
        window.gameUtils.showError("No game state found. Redirecting to launch.");
        setTimeout(risqueConCardplayRecovery, 2000);
        return;
      }
      window.gameState = gs;
      try {
        if (window.location.protocol !== "file:") {
          var params = new URLSearchParams(window.location.search);
          if (params.get("phase") !== "con-cardplay") {
            params.set("phase", "con-cardplay");
            var qs = params.toString();
            window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : "") + window.location.hash);
          }
        }
      } catch (eH) {
        /* ignore */
      }
      try {
        gs.phase = "con-cardplay";
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
        onLog("Con-cardplay mount: state ready", { phase: gs.phase, currentPlayer: gs.currentPlayer });
      }
      cardplayInit();
      window.addEventListener("resize", risqueConCardplayOnResize);
      document.addEventListener("wheel", risqueConCardplayOnWheel, { passive: false });
      document.addEventListener("keydown", risqueConCardplayOnKeydown);
    }

    window.gameUtils.loadGameState(beginAfterState);
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.conCardplay = { mount: mount };
})();
