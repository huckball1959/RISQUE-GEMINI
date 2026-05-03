/**
 * Force card: always draw one Risk deck card (no eligibility checks), show like receive-card,
 * then Continue → tablet handoff → next navigation (conquest elimination: cardplay chain).
 */
(function () {
  "use strict";

  function forceCardLog(message, data) {
    var timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var logEntry = "[" + timestamp + "] [ForceCard] " + message;
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

  function forceCardShuffleArray(array) {
    var arr = array.slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function forceCardGenerateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function forceCardValidateDeck() {
    var gs = window.gameState;
    if (!gs || !window.gameUtils || !window.gameUtils.cardNames) return;
    var allPlayerCards = gs.players.reduce(function (acc, player) {
      var cards = player.cards || [];
      return acc.concat(
        cards.map(function (card) {
          return typeof card === "string" ? card : card.name;
        })
      );
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
      gs.deck = forceCardShuffleArray(validDeck.slice());
      forceCardLog("Deck invalid or too small, reset", { totalCards: gs.deck.length });
    }
    if (
      gs.deck.some(function (card) {
        return allPlayerCards.indexOf(card) !== -1 || discard.indexOf(card) !== -1;
      })
    ) {
      gs.deck = forceCardShuffleArray(validDeck.slice());
      forceCardLog("Deck overlapped hands/discard, reset", { totalCards: gs.deck.length });
    }
  }

  function forceCardDrawOne() {
    var gs = window.gameState;
    if (
      window.gameUtils &&
      typeof window.gameUtils.risqueMaybeReshuffleDiscardIntoDeck === "function"
    ) {
      window.gameUtils.risqueMaybeReshuffleDiscardIntoDeck(gs);
    }
    forceCardValidateDeck();
    if (!gs.deck || gs.deck.length === 0) {
      forceCardLog("No cards available to draw");
      return null;
    }
    var randomIndex = Math.floor(Math.random() * gs.deck.length);
    var card = gs.deck.splice(randomIndex, 1)[0];
    return { name: card, id: forceCardGenerateUUID() };
  }

  function forceCardHandCountLine() {
    var gs = window.gameState;
    if (!gs || !gs.players) return "TOTAL CARDS IN HAND = 0";
    var p = gs.players.find(function (x) {
      return x.name === gs.currentPlayer;
    });
    var n = p && p.cards ? p.cards.length : 0;
    return "TOTAL CARDS IN HAND = " + n;
  }

  function forceCardSetMessage(text) {
    var t = text != null ? String(text) : "";
    var report = t ? t + "\n\n" + forceCardHandCountLine() : forceCardHandCountLine();
    var el = document.getElementById("forcecard-compact-message");
    if (el) el.textContent = report;
    if (
      window.risqueRuntimeHud &&
      typeof window.risqueRuntimeHud.setControlVoiceText === "function" &&
      window.gameState &&
      window.gameState.currentPlayer
    ) {
      window.risqueRuntimeHud.setControlVoiceText(
        String(window.gameState.currentPlayer).toUpperCase() + " · FORCE CARD",
        report,
        { force: true }
      );
    }
  }

  function forceCardRunDisplay() {
    var handStrip = document.getElementById("forcecard-hand-strip");
    var newImg = document.getElementById("forcecard-new-img");
    if (!handStrip) return;
    if (!window.gameState || !window.gameState.players) {
      forceCardSetMessage("Invalid game state.");
      return;
    }
    var gs = window.gameState;
    var currentPlayer = gs.players.find(function (p) {
      return p.name === gs.currentPlayer;
    });
    if (!currentPlayer) {
      forceCardSetMessage("Current player not found.");
      return;
    }
    if (window.risqueDisplayIsPublic) {
      forceCardSetMessage("");
      handStrip.innerHTML = "";
      if (newImg) {
        newImg.src = "assets/images/Cards/CARDBACK.webp";
        newImg.alt = "";
        newImg.classList.remove("receivecard-new-glow");
      }
      return;
    }
    currentPlayer.cards = currentPlayer.cards || [];
    forceCardValidateDeck();

    var drawnThisStep = forceCardDrawOne();
    if (drawnThisStep && drawnThisStep.name) {
      var dup = currentPlayer.cards.some(function (c) {
        return (typeof c === "string" ? c : c.name) === drawnThisStep.name;
      });
      if (dup) {
        if (gs.deck) gs.deck.push(drawnThisStep.name);
        drawnThisStep = null;
        forceCardSetMessage("Could not add duplicate card — deck adjusted.");
      } else {
        currentPlayer.cards.push(drawnThisStep);
        currentPlayer.cardCount = currentPlayer.cards.length;
        gs.cardAwardedThisTurn = true;
        gs.lastCardDrawn = drawnThisStep.name;
        gs.cardplayConquered = false;
        gs.risqueCombatDeckPending = false;
        gs.risqueEliminationDeckOwed = false;
        forceCardSetMessage("New card: " + drawnThisStep.name.replace(/_/g, " ").toUpperCase());
      }
    } else {
      forceCardSetMessage("No cards left in the deck.");
      drawnThisStep = null;
    }

    handStrip.innerHTML = "";
    currentPlayer.cards.forEach(function (card) {
      var cardName = typeof card === "string" ? card : card.name;
      var img = document.createElement("img");
      img.className = "receivecard-thumb";
      if (drawnThisStep && cardName === drawnThisStep.name) {
        img.classList.add("receivecard-thumb-new");
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
        newImg.alt = "No new card";
        newImg.classList.remove("receivecard-new-glow");
      }
    }

    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e2) {
      /* ignore */
    }
  }

  function forceCardOnContinue(conquestElim) {
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }
    var gs = window.gameState || {};
    if (conquestElim && gs.risqueConquestElimReceiveCard) {
      var navWithSkip =
        typeof window.risqueApplyConquestEliminationContinueMutations === "function"
          ? window.risqueApplyConquestEliminationContinueMutations()
          : "";
      if (!navWithSkip) return;
      var hostName = (gs.currentPlayer || "the current player").toString();
      var handoffMsg =
        "Card play\n\nHand the tablet to " +
        hostName +
        ".\n\nOnly this player should tap Continue.";
      var PG = window.risquePhases && window.risquePhases.privacyGate;
      function goCardplay() {
        if (window.risqueNavigateWithFade) {
          window.risqueNavigateWithFade(navWithSkip);
        } else {
          window.location.href = navWithSkip;
        }
      }
      if (!window.risqueDisplayIsPublic && PG && typeof PG.mountHostTabletHandoff === "function") {
        PG.mountHostTabletHandoff({
          message: handoffMsg,
          onContinue: goCardplay,
          onLog: function (line) {
            forceCardLog(line);
          }
        });
      } else {
        goCardplay();
      }
      return;
    }
    /* Non-conquest: advance turn then same handoff as receive-card */
    if (typeof window.risqueReceiveCardAdvanceTurn !== "function" || !window.risqueReceiveCardAdvanceTurn()) {
      return;
    }
    var gsFc = window.gameState || {};
    try {
      delete gsFc.risqueControlVoice;
    } catch (eCvDel) {
      /* ignore */
    }
    var nextPlayerName = (gsFc.currentPlayer ? gsFc.currentPlayer : "the next player").toString();
    try {
      gsFc.risquePublicNextPlayerHandoffPrimary = "Next player is " + nextPlayerName;
      gsFc.risquePublicNextPlayerHandoffReport = "";
    } catch (eHand) {
      /* ignore */
    }
    try {
      localStorage.setItem("gameState", JSON.stringify(gsFc));
    } catch (e) {
      /* ignore */
    }
    if (typeof window.risqueHostReplaceShellGameState === "function") {
      window.risqueHostReplaceShellGameState(gsFc);
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
    var nextHandoffMsg =
      "Next player\n\nHand the tablet to " +
      nextPlayerName +
      " for card play.\n\nOnly this player should tap Continue.";
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
          forceCardLog(line);
        }
      });
    } else {
      goNextPlayerCardplay();
    }
  }

  function initForceCardPhase(conquestElim) {
    if (window.__risqueForceCardInitialized) return;
    if (!window.gameState || !window.gameUtils) return;
    if (
      typeof window.risqueReceiveCardPrepareLoadedState === "function" &&
      !window.risqueReceiveCardPrepareLoadedState()
    ) {
      if (window.gameUtils.showError) window.gameUtils.showError("Invalid game state for force card.");
      return;
    }
    var endBtn = document.getElementById("forcecard-btn-end");
    if (!endBtn) return;

    endBtn.onclick = function () {
      forceCardOnContinue(conquestElim);
    };

    window.gameState.phase = "forcecard";
    try {
      localStorage.setItem("gameState", JSON.stringify(window.gameState));
    } catch (e2) {
      /* ignore */
    }

    forceCardRunDisplay();

    if (window.risqueRuntimeHud && window.gameState) {
      window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      window.gameUtils.initGameView();
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
    });

    window.__risqueForceCardInitialized = true;
  }

  window.initForceCardPhase = initForceCardPhase;
  window.forceCardRunDisplay = forceCardRunDisplay;
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
    var PGun = window.risquePhases && window.risquePhases.privacyGate;
    if (PGun && typeof PGun.unmount === "function") {
      PGun.unmount();
    }

    window.__risqueForceCardInitialized = false;

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
          slotP.innerHTML =
            '<div class="risque-public-private-hint" role="status">' +
            "CARD DRAW IS PRIVATE — USE THE HOST SCREEN." +
            "</div>";
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
      window.__risqueForceCardInitialized = true;
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
          ? '<div class="receivecard-strip-label receivecard-strip-label--conquest">Conquest · force deck card</div>'
          : "";
        slot.innerHTML =
          '<div class="receivecard-compact-root receivecard-compact-root--simple" role="region" aria-label="Force card">' +
          conquestHead +
          '<div class="receivecard-strip-label">Your hand</div>' +
          '<div id="forcecard-compact-message" class="receivecard-compact-message" aria-live="polite"></div>' +
          '<div class="receivecard-compact-visual">' +
          '<div id="forcecard-hand-strip" class="receivecard-hand-strip"></div>' +
          '<img id="forcecard-new-img" class="receivecard-new-img" src="assets/images/Cards/CARDBACK.webp" alt="" />' +
          "</div>" +
          '<div class="receivecard-compact-actions receivecard-compact-actions--bottom">' +
          '<button type="button" id="forcecard-btn-end" class="receivecard-btn-compact">CONTINUE</button>' +
          "</div>" +
          "</div>";
      }
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.syncPosition();
      });
    } else {
      uiOverlay.innerHTML =
        '<div class="text title" style="left:1152px;top:328px;width:704px;height:80px;">Force card</div>' +
        '<div id="forcecard-compact-message" class="text" style="left:1152px;top:380px;width:704px;font-size:28px;"></div>' +
        '<div id="forcecard-hand-strip" style="position:absolute;left:1100px;top:480px;display:flex;gap:6px;flex-wrap:wrap;max-width:800px;"></div>' +
        '<img id="forcecard-new-img" class="card-image" style="left:1250px;top:620px;width:150px;height:240px;" src="assets/images/Cards/CARDBACK.webp" alt="" />' +
        '<button type="button" id="forcecard-btn-end" class="button" style="left:1250px;top:900px;width:280px;height:36px;">Continue</button>';
    }

    if (typeof window.initForceCardPhase === "function") {
      window.initForceCardPhase(conquestElim);
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
  window.risquePhases.forcecard = { mount: mount };
})();
