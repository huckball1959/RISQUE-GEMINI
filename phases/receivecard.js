/**
 * Receive-card phase: deck validation, optional draw, end turn / save, and game.html mount (?phase=receivecard).
 */
(function () {
  "use strict";

  function receiveCardLog(message, data) {
    var timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var logEntry = "[" + timestamp + "] [ReceiveCard] " + message;
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

  function receiveCardShuffleArray(array) {
    var arr = array.slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function receiveCardGenerateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function receiveCardValidateDeck() {
    var gs = window.gameState;
    if (!gs || !window.gameUtils || !window.gameUtils.cardNames) return;
    var allPlayerCards = gs.players.reduce(function (acc, player) {
      var cards = player.cards || [];
      return acc.concat(cards.map(function (card) {
        return typeof card === "string" ? card : card.name;
      }));
    }, []);
    var discard = Array.isArray(gs.discardPile) ? gs.discardPile : [];
    var validDeck = window.gameUtils.cardNames.filter(function (card) {
      return allPlayerCards.indexOf(card) === -1 && discard.indexOf(card) === -1;
    });
    if (
      !gs.deck ||
      !Array.isArray(gs.deck) ||
      gs.deck.length <= 2 ||
      !gs.deck.every(function (card) {
        return window.gameUtils.cardNames.indexOf(card) !== -1;
      })
    ) {
      gs.deck = receiveCardShuffleArray(validDeck.slice());
      receiveCardLog("Deck invalid or too small, reset", { totalCards: gs.deck.length });
    }
    if (
      gs.deck.some(function (card) {
        return allPlayerCards.indexOf(card) !== -1 || discard.indexOf(card) !== -1;
      })
    ) {
      gs.deck = receiveCardShuffleArray(validDeck.slice());
      receiveCardLog("Deck overlapped hands/discard, reset", { totalCards: gs.deck.length });
    }
  }

  function receiveCardDrawCard() {
    var gs = window.gameState;
    if (
      window.gameUtils &&
      typeof window.gameUtils.risqueMaybeReshuffleDiscardIntoDeck === "function"
    ) {
      window.gameUtils.risqueMaybeReshuffleDiscardIntoDeck(gs);
    }
    receiveCardValidateDeck();
    if (!gs.deck || gs.deck.length === 0) {
      receiveCardLog("No cards available to draw");
      return null;
    }
    var randomIndex = Math.floor(Math.random() * gs.deck.length);
    var card = gs.deck.splice(randomIndex, 1)[0];
    return { name: card, id: receiveCardGenerateUUID() };
  }

  function receiveCardHasValidBook() {
    var gs = window.gameState;
    if (!gs || !window.gameUtils || typeof window.gameUtils.canFormValidRisqueBook !== "function") {
      return false;
    }
    var p =
      gs.players &&
      gs.players.find(function (x) {
        return x.name === gs.currentPlayer;
      });
    return !!(p && window.gameUtils.canFormValidRisqueBook(p.cards || []));
  }

  function receiveCardHandCountLine() {
    var gs = window.gameState;
    if (!gs || !gs.players) return "TOTAL CARDS IN HAND = 0";
    var p = gs.players.find(function (x) {
      return x.name === gs.currentPlayer;
    });
    var n = p && p.cards ? p.cards.length : 0;
    return "TOTAL CARDS IN HAND = " + n;
  }

  function receiveCardSyncBookPill() {
    var pill = document.getElementById("receivecard-book-pill");
    if (!pill) return;
    var hasBook = receiveCardHasValidBook();
    if (hasBook) {
      pill.hidden = false;
      pill.setAttribute("aria-hidden", "false");
    } else {
      pill.hidden = true;
      pill.setAttribute("aria-hidden", "true");
    }
  }

  function receiveCardSetMessage(text) {
    var t = text != null ? String(text) : "";
    var isDrawLine = /^new card:/i.test(t);
    var isNoDeckEarnedLine = /no (new )?deck card|did not earn|no card earned/i.test(t);
    /* Conquest elimination review: always show the line (book gate would blank it otherwise). */
    if (
      t &&
      !isDrawLine &&
      !receiveCardHasValidBook() &&
      !(window.gameState && window.gameState.risqueConquestElimReceiveCard) &&
      !isNoDeckEarnedLine
    ) {
      t = "";
    }
    var totalLine = receiveCardHandCountLine();
    var report = totalLine;
    if (t) {
      report = t + "\n\n" + totalLine;
    }
    var el = document.getElementById("receivecard-compact-message");
    if (el) {
      el.textContent = report;
    }
    receiveCardSyncBookPill();
    if (
      window.risqueRuntimeHud &&
      typeof window.risqueRuntimeHud.setControlVoiceText === "function" &&
      window.gameState &&
      window.gameState.currentPlayer
    ) {
      window.risqueRuntimeHud.setControlVoiceText(
        String(window.gameState.currentPlayer).toUpperCase() + " · RECEIVE CARD",
        report,
        { force: true }
      );
    }
  }

  /**
   * Read-only snapshot for debugging receive-card / reinforce gating (call from console:
   * risqueDebugReceiveCard() ). Also written to gameLogs when receiveCardRunDisplay runs if
   * localStorage risqueDebugReceiveCardVerbose === "1".
   */
  function receiveCardEligibilitySnapshot(gs) {
    gs = gs || window.gameState;
    var out = {
      phase: gs ? String(gs.phase || "") : "",
      currentPlayer: gs ? gs.currentPlayer : null,
      cardEarnedViaAttack: !!(gs && gs.cardEarnedViaAttack),
      cardEarnedViaCardplay: !!(gs && gs.cardEarnedViaCardplay),
      conqueredThisTurn: !!(gs && gs.conqueredThisTurn),
      cardAwardedThisTurn: !!(gs && gs.cardAwardedThisTurn),
      lastCardDrawn: gs && gs.lastCardDrawn != null ? gs.lastCardDrawn : null,
      risqueConquestElimReceiveCard: !!(gs && gs.risqueConquestElimReceiveCard),
      conquestElimQuery: false,
      conquestElimReview: false,
      deckWouldAwardEligible: false,
      deckLength: gs && Array.isArray(gs.deck) ? gs.deck.length : 0,
      reasonDeckBlocked: ""
    };
    try {
      out.conquestElimQuery =
        new URLSearchParams(window.location.search).get("conquestElim") === "1";
    } catch (eQ) {
      out.conquestElimQuery = false;
    }
    out.conquestElimReview =
      !!(gs && gs.risqueConquestElimReceiveCard && !window.risqueDisplayIsPublic);
    out.deckWouldAwardEligible =
      !!(gs && (gs.cardEarnedViaAttack || gs.cardEarnedViaCardplay)) &&
      !(gs && gs.cardAwardedThisTurn) &&
      !out.conquestElimReview;
    if (out.conquestElimReview) {
      out.reasonDeckBlocked = "conquest_elim_review_skips_deck_draw_until_after_reinforce";
    } else if (!(gs && (gs.cardEarnedViaAttack || gs.cardEarnedViaCardplay))) {
      out.reasonDeckBlocked = "no_cardEarnedViaAttack_or_cardEarnedViaCardplay";
    } else if (gs && gs.cardAwardedThisTurn) {
      out.reasonDeckBlocked = "cardAwardedThis_turn_already_true";
    } else {
      out.reasonDeckBlocked = "";
    }
    return out;
  }

  function receiveCardAdvanceTurn() {
    var gameState = window.gameState || {};
    if (!gameState.turnOrder || !Array.isArray(gameState.turnOrder) || gameState.turnOrder.length === 0) {
      receiveCardLog("Invalid game state for advancing turn");
      receiveCardSetMessage("Invalid game state.");
      return false;
    }
    var currentIndex = gameState.turnOrder.indexOf(gameState.currentPlayer);
    if (currentIndex === -1) {
      receiveCardLog("Current player not in turn order");
      receiveCardSetMessage("Invalid turn order.");
      return false;
    }
    var prevPlayerJustFinished = gameState.turnOrder[currentIndex];
    var nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
    gameState.currentPlayer = gameState.turnOrder[nextIndex];
    if (typeof window.gameUtils.clearContinentalConquestRoutingOnTurnAdvance === "function") {
      window.gameUtils.clearContinentalConquestRoutingOnTurnAdvance(gameState);
    }
    gameState.lastCardDrawn = null;
    gameState.cardEarnedViaAttack = false;
    gameState.cardEarnedViaCardplay = false;
    gameState.cardAwardedThisTurn = false;
    gameState.conqueredThisTurn = false;
    var completedRound = 0;
    if (nextIndex === 0) {
      completedRound = Number(gameState.round) || 1;
      gameState.round = completedRound + 1;
    }
    gameState.phase = "cardplay";
    receiveCardLog("Advanced turn", {
      currentPlayer: gameState.currentPlayer,
      round: gameState.round,
      phase: gameState.phase
    });
    if (typeof window.risqueReplayOnHostEnterCardplay === "function" && !window.risqueDisplayIsPublic) {
      window.risqueReplayOnHostEnterCardplay(gameState);
    }
    if (
      typeof window.risqueSessionDiskScheduleTurnCheckpoint === "function" &&
      !window.risqueDisplayIsPublic
    ) {
      window.risqueSessionDiskScheduleTurnCheckpoint(gameState, prevPlayerJustFinished);
    }
    return completedRound;
  }

  function receiveCardRunDisplay() {
    var handStrip = document.getElementById("receivecard-hand-strip");
    var newImg = document.getElementById("receivecard-new-img");
    if (!handStrip) return;
    if (!window.gameState || !window.gameState.players) {
      receiveCardSetMessage("Invalid game state.");
      return;
    }
    var gs = window.gameState;
    var currentPlayer = gs.players.find(function (p) {
      return p.name === gs.currentPlayer;
    });
    if (!currentPlayer) {
      receiveCardSetMessage("Current player not found.");
      return;
    }
    if (window.risqueDisplayIsPublic) {
      receiveCardSetMessage("");
      handStrip.innerHTML = "";
      if (newImg) {
        newImg.src = "assets/images/Cards/CARDBACK.webp";
        newImg.alt = "";
        newImg.classList.remove("receivecard-new-glow");
      }
      return;
    }
    currentPlayer.cards = currentPlayer.cards || [];
    receiveCardValidateDeck();

    var drawnThisStep = null;
    /* Conquest elimination screen is only for reviewing transferred cards + Continue → cardplay.
     * Do not draw from the deck here: that would set cardAwardedThisTurn and block the real
     * post-reinforcement receive-card (same bug as “no deck card after eliminating a player”). */
    var conquestElimReview = !!(gs.risqueConquestElimReceiveCard && !window.risqueDisplayIsPublic);
    var transferredCount = Math.max(0, Number(gs.transferredCardCount) || 0);
    var eligible =
      !!(gs.cardEarnedViaAttack || gs.cardEarnedViaCardplay) &&
      !gs.cardAwardedThisTurn &&
      !conquestElimReview;

    if (conquestElimReview) {
      receiveCardSetMessage(
        "Defeated player's cards are in your hand (gold outline). Your capture deck card will be drawn after reinforcement."
      );
      drawnThisStep = null;
    } else if (eligible) {
      drawnThisStep = receiveCardDrawCard();
      if (drawnThisStep && !currentPlayer.cards.some(function (c) {
        return (typeof c === "string" ? c : c.name) === drawnThisStep.name;
      })) {
        currentPlayer.cards.push(drawnThisStep);
        currentPlayer.cardCount = currentPlayer.cards.length;
        gs.cardAwardedThisTurn = true;
        gs.lastCardDrawn = drawnThisStep.name;
        receiveCardSetMessage("New card: " + drawnThisStep.name.replace(/_/g, " ").toUpperCase());
      } else {
        receiveCardSetMessage("No unique cards available.");
        gs.cardAwardedThisTurn = true;
        drawnThisStep = null;
      }
    } else {
      receiveCardSetMessage(
        "You did not earn a new deck card this turn (capture at least one territory to earn one)."
      );
    }

    handStrip.innerHTML = "";
    var conquestStartIdx = Math.max(0, currentPlayer.cards.length - transferredCount);
    currentPlayer.cards.forEach(function (card, idx) {
      var cardName = typeof card === "string" ? card : card.name;
      var img = document.createElement("img");
      img.className = "receivecard-thumb";
      if (drawnThisStep && cardName === drawnThisStep.name) {
        img.classList.add("receivecard-thumb-new");
      } else {
        img.classList.add("receivecard-thumb-existing");
      }
      if (conquestElimReview && transferredCount > 0 && idx >= conquestStartIdx) {
        img.classList.add("receivecard-thumb-conquest");
      }
      img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
      img.alt = cardName.replace(/_/g, " ");
      handStrip.appendChild(img);
    });

    if (newImg) {
      if (drawnThisStep) {
        newImg.src = "assets/images/Cards/" + String(drawnThisStep.name || "").toUpperCase() + ".webp";
        newImg.alt = drawnThisStep.name.replace(/_/g, " ");
        newImg.classList.add("receivecard-new-glow");
      } else {
        newImg.src = "assets/images/Cards/CARDBACK.webp";
        newImg.alt = conquestElimReview
          ? "Deck card after reinforcement"
          : eligible
            ? "No card"
            : "No card earned";
        newImg.classList.remove("receivecard-new-glow");
      }
    }

    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e2) {
      /* ignore */
    }

    var snap = receiveCardEligibilitySnapshot(gs);
    snap.drawnThisStep = drawnThisStep ? drawnThisStep.name : null;
    receiveCardLog("receiveCardRunDisplay", snap);
    try {
      if (localStorage.getItem("risqueDebugReceiveCardVerbose") === "1") {
        console.info("[ReceiveCard] eligibility snapshot", snap);
      }
    } catch (eV) {
      /* ignore */
    }
  }

  /**
   * After conquest elimination deck screen: remove defeated player, keep conqueror, prepare cardplay chain.
   * @returns {string} full URL with postReceive=1, or "" if invalid
   */
  function risqueApplyConquestEliminationContinueMutations() {
    var gs = window.gameState;
    if (!gs || !gs.players || !Array.isArray(gs.players)) {
      receiveCardLog("Conquest CONTINUE: invalid gameState");
      return "";
    }
    var defeatedName =
      gs.defeatedPlayer != null && String(gs.defeatedPlayer).trim() !== ""
        ? String(gs.defeatedPlayer).trim()
        : "";
    if (!defeatedName) {
      receiveCardLog("Conquest CONTINUE: missing defeatedPlayer");
      receiveCardSetMessage("Missing defeated player in state.");
      return "";
    }

    /* Risk: one deck card this turn if you captured — elimination required capturing their last territory.
     * reinforce.js gates receive-card on cardEarnedVia*; mid-chain saves sometimes dropped these flags. */
    if (!gs.cardEarnedViaAttack && !gs.cardEarnedViaCardplay) {
      gs.cardEarnedViaAttack = true;
    }

    var wasChain = !!gs.risqueConquestChainActive;
    if (!wasChain) {
      gs.risqueConquestChainPaidContinents = [];
    }
    var defeatedPl = gs.players.find(function (p) {
      return p && p.name === defeatedName;
    });
    var pendingCont = [];
    if (
      defeatedPl &&
      window.gameUtils &&
      typeof window.gameUtils.computePendingContinentsAfterElimination === "function"
    ) {
      pendingCont = window.gameUtils.computePendingContinentsAfterElimination(gs, gs.currentPlayer, defeatedPl);
    }
    /* Same campaign: only pay continent income for land newly taken from *this* defeat — not again for continents already paid earlier in the chain. */
    var paidSoFar = gs.risqueConquestChainPaidContinents || [];
    pendingCont = pendingCont.filter(function (k) {
      return paidSoFar.indexOf(k) === -1;
    });
    receiveCardLog("Conquest elimination pending continents", {
      pending: pendingCont,
      defeated: defeatedName,
      paidSoFar: paidSoFar.slice()
    });

    gs.players = gs.players.filter(function (p) {
      return p && p.name !== defeatedName;
    });
    gs.turnOrder = (gs.turnOrder || []).filter(function (n) {
      return n !== defeatedName;
    });
    gs.defeatedPlayer = null;
    gs.transferredCardCount = 0;
    gs.risqueConquestElimReceiveCard = false;
    gs.phase = "cardplay";
    if (typeof window.risqueReplayOnHostEnterCardplay === "function" && !window.risqueDisplayIsPublic) {
      window.risqueReplayOnHostEnterCardplay(gs);
    }
    gs.risquePublicConCardTransferPrimary = "";
    gs.risquePublicConCardTransferReport = "";
    /* Keep attackPhase / attackingTerritory / acquiredTerritory if still pending troop transfer into capture. */
    gs.risqueConquestChainActive = true;
    /* Runtime cardplay → income: navigator must use con-income until chain ends (legacyNext alone may be income.html). */
    gs.risqueRuntimeCardplayIncomeMode = "conquer";
    gs.pendingNewContinents = pendingCont;
    /* Cardplay must not overwrite continentsSnapshot after elimination — keep baseline for snapshot-diff fallback. */
    gs.risqueSkipContinentSnapshotRefresh = true;

    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {
      receiveCardLog("Conquest CONTINUE: save failed", { error: e.message || String(e) });
    }
    if (typeof window.risqueHostReplaceShellGameState === "function") {
      window.risqueHostReplaceShellGameState(gs);
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }

    var deployUrl = "game.html?phase=deploy&kind=turn";
    if (gs.risqueConquestChainActive) {
      deployUrl += "&conquestAfterDeploy=1";
    }
    /* Conquer-mode income (con-income): books + new continents; see phases/con-income-phase.js. */
    var incomeUrl = "game.html?phase=con-income&legacyNext=" + encodeURIComponent(deployUrl);
    var nav = "game.html?phase=cardplay&legacyNext=" + encodeURIComponent(incomeUrl);

    receiveCardLog("Conquest CONTINUE → runtime cardplay (chain)", {
      currentPlayer: gs.currentPlayer,
      defeatedRemoved: defeatedName,
      playersLeft: gs.players.length,
      next: nav
    });
    return nav + "&postReceive=1";
  }

  /**
   * After conquest elimination receive-card: runtime cardplay chain — remove defeated
   * player, keep current player (conqueror), conquer cardplay next. Do not advance turn.
   */
  function receiveCardEndTurnConquestElimination() {
    var navWithSkip = risqueApplyConquestEliminationContinueMutations();
    if (!navWithSkip) return;
    function goConquestCardplay() {
      if (typeof window.risqueMarkPostReceiveCardplayBlackout === "function") {
        window.risqueMarkPostReceiveCardplayBlackout();
      }
      if (window.risqueNavigateWithFade) {
        window.risqueNavigateWithFade(navWithSkip);
      } else {
        window.location.href = navWithSkip;
      }
    }
    /* No tablet handoff: host keeps the same device through elimination → cardplay (game-shell also skips cardplay entry when postReceive=1). */
    goConquestCardplay();
  }

  function receiveCardEndTurn() {
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }
    var gs0 = window.gameState || {};
    if (gs0.risqueConquestElimReceiveCard) {
      receiveCardEndTurnConquestElimination();
      return;
    }
    var completedRound = receiveCardAdvanceTurn();
    if (completedRound === false) return;
    var gsAfter = window.gameState || {};
    try {
      delete gsAfter.risqueControlVoice;
    } catch (eCvDel) {
      /* ignore */
    }
    var nextPlayerName = (gsAfter.currentPlayer ? gsAfter.currentPlayer : "the next player").toString();
    try {
      gsAfter.risquePublicNextPlayerHandoffPrimary = "Next player is " + nextPlayerName;
      gsAfter.risquePublicNextPlayerHandoffReport = "";
    } catch (eHand) {
      /* ignore */
    }
    try {
      localStorage.setItem("gameState", JSON.stringify(gsAfter));
    } catch (e) {
      /* ignore */
    }
    /**
     * Round autosave is async (folder boot + disk). risqueNavigateWithFade uses synchronous location.href;
     * without awaiting, the page can unload before writes run — especially when privacy handoff is skipped.
     */
    var roundSaveChain = Promise.resolve();
    if (completedRound > 0 && typeof window.risqueRoundAutosaveOnRoundComplete === "function") {
      var completedFromState = (Number(gsAfter.round) || 0) - 1;
      var crArg = completedFromState > 0 ? completedFromState : completedRound;
      var maybeSaveP = window.risqueRoundAutosaveOnRoundComplete(gsAfter, crArg);
      if (maybeSaveP && typeof maybeSaveP.then === "function") {
        roundSaveChain = maybeSaveP;
      }
    }
    function runReceiveCardHandoffAndNavigate() {
      if (typeof window.risqueHostReplaceShellGameState === "function") {
        window.risqueHostReplaceShellGameState(gsAfter);
      }
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      var nextHandoffMsg =
        "Next player\n\nHand the tablet to " + nextPlayerName + " for card play.\n\nOnly this player should tap Continue.";
      function goNextPlayerCardplay() {
        var target = "game.html?phase=cardplay&legacyNext=income.html&postReceive=1";
        if (typeof window.risqueMarkPostReceiveCardplayBlackout === "function") {
          window.risqueMarkPostReceiveCardplayBlackout();
        }
        if (window.risqueNavigateWithFade) {
          window.risqueNavigateWithFade(target);
        } else {
          window.location.href = target;
        }
      }
      var PGn = window.risquePhases && window.risquePhases.privacyGate;
      if (!window.risqueDisplayIsPublic && PGn && typeof PGn.mountHostTabletHandoff === "function") {
        PGn.mountHostTabletHandoff({
          message: nextHandoffMsg,
          onContinue: goNextPlayerCardplay,
          onLog: function (line) {
            receiveCardLog(line);
          }
        });
      } else {
        goNextPlayerCardplay();
      }
    }
    roundSaveChain.then(runReceiveCardHandoffAndNavigate, runReceiveCardHandoffAndNavigate);
  }

  function receiveCardPrepareLoadedState() {
    var gs = window.gameState;
    if (!gs || !window.gameUtils || !window.gameUtils.validateGameState(gs)) return false;
    if (typeof gs.round === "undefined") gs.round = 1;
    if (typeof gs.cardAwardedThisTurn === "undefined") gs.cardAwardedThisTurn = false;
    if (typeof gs.cardEarnedViaAttack === "undefined") gs.cardEarnedViaAttack = false;
    if (typeof gs.cardEarnedViaCardplay === "undefined") gs.cardEarnedViaCardplay = false;
    gs.lastCardDrawn = null;
    gs.players.forEach(function (player) {
      if (!player.cards || !Array.isArray(player.cards)) {
        player.cards = [];
        player.cardCount = 0;
      } else {
        player.cards = player.cards.filter(function (card) {
          var cardName = typeof card === "string" ? card : card.name;
          return window.gameUtils.cardNames.indexOf(cardName) !== -1;
        });
        player.cardCount = player.cards.length;
      }
    });
    receiveCardValidateDeck();
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {
      /* ignore */
    }
    return true;
  }

  function initReceiveCardPhase() {
    if (window.__risqueReceiveCardInitialized) return;
    if (!window.gameState || !window.gameUtils) return;
    if (!receiveCardPrepareLoadedState()) {
      if (window.gameUtils.showError) window.gameUtils.showError("Invalid game state for receive card.");
      return;
    }
    var endBtn = document.getElementById("receivecard-btn-end");
    if (!endBtn) return;

    endBtn.onclick = function () {
      receiveCardEndTurn();
    };

    window.gameState.phase = "receivecard";
    try {
      localStorage.setItem("gameState", JSON.stringify(window.gameState));
    } catch (e2) {
      /* ignore */
    }

    receiveCardRunDisplay();

    if (window.risqueRuntimeHud && window.gameState) {
      window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      window.gameUtils.initGameView();
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
    });

    window.__risqueReceiveCardInitialized = true;
  }

  window.initReceiveCardPhase = initReceiveCardPhase;
  window.receiveCardRunDisplay = receiveCardRunDisplay;
  window.risqueReceiveCardPrepareLoadedState = receiveCardPrepareLoadedState;
  window.risqueApplyConquestEliminationContinueMutations = risqueApplyConquestEliminationContinueMutations;
  window.risqueReceiveCardAdvanceTurn = receiveCardAdvanceTurn;
  window.risqueDebugReceiveCard = receiveCardEligibilitySnapshot;
})();

(function () {
  "use strict";

  function mount(stageHost, opts) {
    opts = opts || {};
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    var conquestElim = false;
    try {
      conquestElim = new URLSearchParams(window.location.search).get("conquestElim") === "1";
    } catch (eQ) {
      conquestElim = false;
    }
    if (conquestElim && window.gameState) {
      window.gameState.risqueConquestElimReceiveCard = true;
    }

    var stalePrompt = document.getElementById("prompt");
    if (stalePrompt && stalePrompt.parentNode) stalePrompt.parentNode.removeChild(stalePrompt);
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }

    window.__risqueReceiveCardInitialized = false;

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    if (window.risqueDisplayIsPublic) {
      if (window.risqueRuntimeHud) {
        window.risqueRuntimeHud.ensure(uiOverlay);
        window.risqueRuntimeHud.clearPhaseSlot();
        window.risqueRuntimeHud.setAttackChromeInteractive(false);
        if (window.gameState) {
          window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
        }
        var slotP = document.getElementById("risque-phase-content");
        if (slotP) {
          if (conquestElim) {
            slotP.innerHTML =
              '<div class="risque-public-private-hint" role="status">' +
              "CARD TRANSFER IS PRIVATE — USE THE HOST SCREEN." +
              "</div>";
          } else {
            slotP.innerHTML =
              '<div class="risque-public-private-hint" role="status">' +
              "CARD DRAW IS PRIVATE — USE THE HOST SCREEN." +
              "</div>";
          }
        }
        requestAnimationFrame(function () {
          window.risqueRuntimeHud.syncPosition();
        });
      }
      requestAnimationFrame(function () {
        if (window.gameUtils && window.gameState) {
          window.gameUtils.resizeCanvas();
          window.gameUtils.initGameView();
          window.gameUtils.renderTerritories(null, window.gameState);
          window.gameUtils.renderStats(window.gameState);
        }
      });
      window.__risqueReceiveCardInitialized = true;
      return;
    }
    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      if (window.gameState) {
        window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
      }
      var slot = document.getElementById("risque-phase-content");
      if (slot) {
        var conquestHead = conquestElim
          ? '<div class="receivecard-strip-label receivecard-strip-label--conquest">Conquest · take eliminated player\'s cards</div>'
          : "";
        slot.innerHTML =
          '<div class="receivecard-compact-root receivecard-compact-root--simple" role="region" aria-label="Your cards">' +
          '<div class="risque-book-pill-row">' +
          '<div id="receivecard-book-pill" class="risque-book-pill" hidden role="status" aria-hidden="true">' +
          '<span class="risque-book-pill-label">BOOK</span>' +
          '<span class="risque-book-pill-check" aria-hidden="true">\u2713</span>' +
          "</div>" +
          "</div>" +
          conquestHead +
          '<div class="receivecard-strip-label">Your hand</div>' +
          '<div id="receivecard-compact-message" class="receivecard-compact-message" aria-live="polite"></div>' +
          '<div class="receivecard-compact-visual">' +
          '<div id="receivecard-hand-strip" class="receivecard-hand-strip"></div>' +
          "</div>" +
          '<div class="receivecard-compact-actions receivecard-compact-actions--bottom">' +
          '<button type="button" id="receivecard-btn-end" class="receivecard-btn-compact">CONTINUE</button>' +
          "</div>" +
          "</div>";
      }
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.syncPosition();
      });
    } else {
      uiOverlay.innerHTML =
        '<div class="text title" style="left:1152px;top:328px;width:704px;height:80px;">Receive Card</div>' +
        '<div id="receivecard-compact-message" class="text" style="left:1152px;top:380px;width:704px;font-size:28px;"></div>' +
        '<div id="receivecard-hand-strip" style="position:absolute;left:1100px;top:480px;display:flex;gap:6px;flex-wrap:wrap;max-width:800px;"></div>' +
        '<img id="receivecard-new-img" class="card-image" style="left:1250px;top:620px;width:150px;height:240px;" src="assets/images/Cards/CARDBACK.webp" alt="" />' +
        '<button type="button" id="receivecard-btn-end" class="button" style="left:1250px;top:900px;width:280px;height:36px;">Continue</button>';
    }

    if (typeof window.initReceiveCardPhase === "function") {
      window.initReceiveCardPhase();
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      if (window.gameState) {
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
      }
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.receivecard = { mount: mount };
})();
