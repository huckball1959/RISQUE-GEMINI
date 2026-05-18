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

  var __risqueReceiveCardContinueDefaultLabel = "CONTINUE";
  /** Host HUD: new deck card shown in lower pane until CONTINUE merges into upper hand. */
  var RECEIVE_CARD_STAGING_DELAY_MS = 2000;

  function receiveCardStagingDelayMs() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return 0;
      }
    } catch (eMq) {
      /* ignore */
    }
    return RECEIVE_CARD_STAGING_DELAY_MS;
  }

  function receiveCardSetContinueSaving(busy) {
    var btn = document.getElementById("receivecard-btn-end");
    if (btn) {
      if (busy) {
        if (!btn.getAttribute("data-default-label")) {
          try {
            btn.setAttribute(
              "data-default-label",
              (btn.textContent || __risqueReceiveCardContinueDefaultLabel).trim() || __risqueReceiveCardContinueDefaultLabel
            );
          } catch (eLab) {
            btn.setAttribute("data-default-label", __risqueReceiveCardContinueDefaultLabel);
          }
        }
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        btn.textContent = "Saving…";
      } else {
        var def = btn.getAttribute("data-default-label") || __risqueReceiveCardContinueDefaultLabel;
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        btn.hidden = false;
        btn.removeAttribute("aria-hidden");
        btn.textContent = def;
      }
    }
    if (busy) {
      var msg = document.getElementById("receivecard-compact-message");
      if (msg) {
        try {
          msg.textContent = "Saving turn to disk…";
        } catch (eM) {
          /* ignore */
        }
      }
    }
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

  /** Territory card id in lowercase snake_case — must match gameUtils.cardNames (Prepare Loaded used to drop mixed-case hands). */
  function receiveCardCanonicalTerritoryCardName(raw) {
    if (raw == null) return "";
    return String(raw)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
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

  function receiveCardThumbClassForIndex(conquestElimReview, transferredCount, cardsLen, idx) {
    var base = "receivecard-thumb";
    if (conquestElimReview && transferredCount > 0 && idx >= Math.max(0, cardsLen - transferredCount)) {
      return base + " receivecard-thumb-existing receivecard-thumb-conquest";
    }
    return base + " receivecard-thumb-existing";
  }

  function receiveCardAppendThumbToStrip(strip, cardName, extraClass) {
    if (!strip || !cardName) return;
    var img = document.createElement("img");
    img.className = "receivecard-thumb" + (extraClass ? " " + extraClass : "");
    img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
    img.alt = String(cardName || "").replace(/_/g, " ");
    strip.appendChild(img);
  }

  function receiveCardApplyStagingMergeUi() {
    var gs = window.gameState;
    var upper = document.getElementById("receivecard-hand-strip-upper");
    var staging = document.getElementById("receivecard-staging-grid");
    if (!gs || !gs.players || !upper || !staging) return;
    var currentPlayer = gs.players.find(function (p) {
      return p.name === gs.currentPlayer;
    });
    if (!currentPlayer || !currentPlayer.cards) return;
    currentPlayer.cards = currentPlayer.cards || [];
    var transferredCount = Math.max(0, Number(gs.transferredCardCount) || 0);
    var conquestElimReview = !!(gs.risqueConquestElimReceiveCard && !window.risqueDisplayIsPublic);
    upper.innerHTML = "";
    var n = currentPlayer.cards.length;
    currentPlayer.cards.forEach(function (card, idx) {
      var cardName = typeof card === "string" ? card : card.name;
      var img = document.createElement("img");
      img.className = receiveCardThumbClassForIndex(conquestElimReview, transferredCount, n, idx);
      img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
      img.alt = String(cardName || "").replace(/_/g, " ");
      upper.appendChild(img);
    });
    staging.innerHTML =
      '<div class="receivecard-staging-merge-note" role="status">Added to hand above.</div>';
  }

  function receiveCardScheduleAdvanceAfterStagingMerge() {
    try {
      if (window.__risqueReceiveCardStagingTimer) {
        clearTimeout(window.__risqueReceiveCardStagingTimer);
      }
    } catch (eClr) {
      /* ignore */
    }
    receiveCardApplyStagingMergeUi();
    window.__risqueReceiveCardStagingMerged = true;
    window.__risqueReceiveCardStagingMergeNeeded = false;
    var btn = document.getElementById("receivecard-btn-end");
    if (btn) {
      btn.disabled = true;
      btn.setAttribute("aria-hidden", "true");
      btn.hidden = true;
    }
    window.__risqueReceiveCardStagingTimer = setTimeout(function () {
      window.__risqueReceiveCardStagingTimer = null;
      receiveCardRunTurnAdvanceAndHandoff();
    }, receiveCardStagingDelayMs());
  }

  function receiveCardWritePeriodicRestartArtifacts(gs) {
    if (!gs || typeof window.risqueLocalDiskIsActive !== "function" || !window.risqueLocalDiskIsActive()) {
      return Promise.resolve();
    }
    if (typeof window.risqueLocalDiskWrite !== "function") {
      return Promise.resolve();
    }
    var forDisk = gs;
    try {
      if (typeof window.risqueStripReplayFromGameStateClone === "function") {
        forDisk = window.risqueStripReplayFromGameStateClone(gs);
      }
    } catch (eStrip) {
      forDisk = gs;
    }
    var gameJson;
    try {
      gameJson = JSON.stringify(forDisk, null, 2);
    } catch (eGj) {
      return Promise.reject(eGj);
    }
    var replayPack = null;
    try {
      replayPack =
        typeof window.risqueBuildSessionReplayExport === "function" ? window.risqueBuildSessionReplayExport(gs) : null;
    } catch (eRp) {
      replayPack = null;
    }
    var chain = window.risqueLocalDiskWrite("risque-periodic-restart-game.json", gameJson);
    if (replayPack && replayPack.format === "risque-replay-v1") {
      chain = chain.then(function () {
        return window.risqueLocalDiskWrite(
          "risque-periodic-restart-replay.json",
          JSON.stringify(replayPack, null, 2)
        );
      });
    }
    chain = chain.then(function () {
      return window.risqueLocalDiskWrite(".risque-pending-periodic-host-resume", '{"v":1}\n');
    });
    return Promise.resolve(chain).catch(function (eW) {
      receiveCardLog("Periodic restart file write failed", eW);
      throw eW;
    });
  }

  /**
   * Autosave tiers 1–3 (safe_fun / safe_lean / safe_no_replay): never trigger launcher periodic browser restart,
   * even when risque-launcher-paths.json sets periodicBrowserRestartEveryRounds (file:// reads interval via disk API).
   */
  function receiveCardAutosaveTierSkipsPeriodicBrowserRestart(gs) {
    var t = gs && gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
    return t === "safe_fun" || t === "safe_lean" || t === "safe_no_replay";
  }

  /** file:// cannot fetch risque-launcher-paths.json (opaque origin); read interval from save-folder context via disk API. */
  function receiveCardResolvePeriodicRestartEveryRounds() {
    function fromObj(o) {
      var every = 0;
      try {
        if (o && o.periodicBrowserRestartEveryRounds != null) {
          every = Math.floor(Number(o.periodicBrowserRestartEveryRounds));
          if (!isFinite(every) || every < 0) every = 0;
        }
      } catch (eJ) {
        every = 0;
      }
      return every;
    }
    var fetchP =
      typeof window.risqueFetchLauncherPathsJsonFresh === "function"
        ? window.risqueFetchLauncherPathsJsonFresh()
        : typeof window.risqueFetchLauncherPathsJson === "function"
          ? window.risqueFetchLauncherPathsJson()
          : Promise.resolve(null);
    return Promise.resolve(fetchP)
      .then(
        function (j) {
          return fromObj(j);
        },
        function () {
          return 0;
        }
      )
      .then(function (n) {
        if (n > 0) return n;
        if (
          typeof window.risqueLocalDiskIsActive !== "function" ||
          !window.risqueLocalDiskIsActive() ||
          typeof window.risqueLocalDiskRead !== "function"
        ) {
          return 0;
        }
        return window
          .risqueLocalDiskRead(".risque-launcher-resume-context.json")
          .then(function (rj) {
            if (!rj || !rj.ok || rj.content == null) return 0;
            try {
              return fromObj(JSON.parse(String(rj.content)));
            } catch (eParse) {
              return 0;
            }
          })
          .catch(function () {
            return 0;
          });
      });
  }

  function receiveCardRunTurnAdvanceAndHandoff() {
    receiveCardSetContinueSaving(true);
    var advTurn = receiveCardAdvanceTurn();
    if (advTurn === false) {
      receiveCardSetContinueSaving(false);
      try {
        window.__risqueReceiveCardEndTurnBusy = false;
      } catch (eRel0) {
        /* ignore */
      }
      return;
    }
    try {
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
      var completedRound = advTurn.completedRound;
      var roundSaveChain = Promise.resolve();
      if (completedRound > 0 && typeof window.risqueRoundAutosaveOnRoundComplete === "function") {
        var completedFromState = (Number(gsAfter.round) || 0) - 1;
        var crArg = completedFromState > 0 ? completedFromState : completedRound;
        var maybeSaveP = window.risqueRoundAutosaveOnRoundComplete(gsAfter, crArg);
        if (maybeSaveP && typeof maybeSaveP.then === "function") {
          roundSaveChain = maybeSaveP;
        }
      }
      var diskChain =
        advTurn.turnDisk && typeof advTurn.turnDisk.then === "function"
          ? advTurn.turnDisk
          : Promise.resolve(true);
      if (
        (!advTurn.turnDisk || typeof advTurn.turnDisk.then !== "function") &&
        typeof window.risqueSessionDiskHasWritableSaveTarget === "function" &&
        window.risqueSessionDiskHasWritableSaveTarget()
      ) {
        receiveCardLog("Missing turnDisk with active save target; awaiting write queue.");
        diskChain =
          typeof window.risqueSessionDiskAwaitTurnWriteQueue === "function"
            ? window.risqueSessionDiskAwaitTurnWriteQueue()
            : diskChain;
      }
      function runReceiveCardHandoffAndNavigate(periodicEveryRounds) {
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
          if (
            typeof window.risqueNavigateGameHtmlSoft === "function" &&
            window.risqueNavigateGameHtmlSoft(target)
          ) {
            try {
              window.__risqueReceiveCardEndTurnBusy = false;
            } catch (eBusySoft) {}
            return;
          }
          if (window.risqueNavigateWithFade) {
            window.risqueNavigateWithFade(target);
          } else {
            window.location.href = target;
          }
        }
        var PGn = window.risquePhases && window.risquePhases.privacyGate;
        var pe = periodicEveryRounds != null ? Math.floor(Number(periodicEveryRounds)) : 0;
        if (!isFinite(pe) || pe < 0) {
          pe = 0;
        }
        var wantPeriodic =
          !receiveCardAutosaveTierSkipsPeriodicBrowserRestart(gsAfter) &&
          pe > 0 &&
          completedRound > 0 &&
          completedRound % pe === 0 &&
          typeof window.risqueLocalDiskRequestBrowserRestart === "function" &&
          typeof window.risqueLocalDiskIsActive === "function" &&
          window.risqueLocalDiskIsActive() &&
          !window.risqueDisplayIsPublic;
        if (wantPeriodic) {
          Promise.resolve()
            .then(function () {
              return receiveCardWritePeriodicRestartArtifacts(gsAfter);
            })
            .then(function () {
              try {
                localStorage.setItem("risqueAutoResumeCardplayAfterLauncherRestart", "1");
              } catch (eLsAr) {
                /* ignore */
              }
            })
            .then(function () {
              if (PGn && typeof PGn.mountHostTabletHandoff === "function") {
                PGn.mountHostTabletHandoff({
                  message:
                    "THE GAME WILL RESTART AND BE BACK IN A MOMENT.\n\n" + nextHandoffMsg,
                  buttonLabel: "Continue",
                  autoContinueAfterMs: 5000,
                  retainOverlayAfterContinue: true,
                  onContinue: function () {
                    try {
                      localStorage.setItem("gameState", JSON.stringify(gsAfter));
                    } catch (eFlush) {
                      /* ignore */
                    }
                    var req = window.risqueLocalDiskRequestBrowserRestart;
                    if (typeof req !== "function") return;
                    Promise.resolve(req())
                      .then(function (j) {
                        receiveCardLog("Browser restart API ok", j || {});
                        receiveCardSetMessage(
                          "Restart scheduled — Chromium/Edge should close in a few seconds, then the launcher will open again."
                        );
                      })
                      .catch(function (eRs) {
                        receiveCardLog("Browser restart request failed", eRs);
                        receiveCardSetMessage(
                          "Restart failed (update scripts + restart RISQUE.bat so the save helper has /api/restart-browser). Going to card play."
                        );
                        try {
                          if (PGn && typeof PGn.unmount === "function") {
                            PGn.unmount();
                          }
                        } catch (eUm) {
                          /* ignore */
                        }
                        goNextPlayerCardplay();
                      });
                  },
                  onLog: function (line) {
                    receiveCardLog(line);
                  }
                });
              } else {
                var req2 = window.risqueLocalDiskRequestBrowserRestart;
                if (typeof req2 === "function") {
                  Promise.resolve(req2()).catch(function (e2) {
                    receiveCardLog("Browser restart request failed (no handoff)", e2);
                  });
                }
                goNextPlayerCardplay();
              }
            })
            .catch(function (ePer) {
              receiveCardLog("Periodic restart prep failed", ePer);
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
            });
          return;
        }
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
      Promise.all([roundSaveChain, diskChain])
        .then(function () {
          return typeof window.risqueSessionDiskAwaitTurnWriteQueue === "function"
            ? window.risqueSessionDiskAwaitTurnWriteQueue()
            : Promise.resolve(true);
        })
        .then(function () {
          return receiveCardResolvePeriodicRestartEveryRounds();
        })
        .then(function (every) {
          runReceiveCardHandoffAndNavigate(every);
        })
        .catch(function (err) {
            receiveCardLog("Turn save / round autosave failed", err);
            receiveCardSetMessage(
              "Could not finish saving to disk. Check folder access, wait a moment, then tap Continue again."
            );
            receiveCardSetContinueSaving(false);
            try {
              window.__risqueReceiveCardEndTurnBusy = false;
            } catch (eRelF) {
              /* ignore */
            }
          });
    } catch (eRcBody) {
      try {
        window.__risqueReceiveCardEndTurnBusy = false;
      } catch (eRelB) {
        /* ignore */
      }
      throw eRcBody;
    }
  }

  function receiveCardAdvanceTurn() {
    var gameState = window.gameState || {};
    if (!gameState.turnOrder || !Array.isArray(gameState.turnOrder) || gameState.turnOrder.length === 0) {
      receiveCardLog("Invalid game state for advancing turn");
      receiveCardSetMessage("Invalid game state.");
      return false;
    }
    var tor =
      typeof window.risqueReplayResolveTurnOrderIndex === "function"
        ? window.risqueReplayResolveTurnOrderIndex(gameState.turnOrder, gameState.currentPlayer)
        : null;
    var currentIndex =
      tor && typeof tor.index === "number" && tor.index >= 0
        ? tor.index
        : gameState.turnOrder.indexOf(gameState.currentPlayer);
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
    var turnDisk = null;
    if (
      typeof window.risqueSessionDiskScheduleTurnCheckpoint === "function" &&
      !window.risqueDisplayIsPublic
    ) {
      try {
        turnDisk = window.risqueSessionDiskScheduleTurnCheckpoint(gameState, prevPlayerJustFinished);
      } catch (eTd) {
        turnDisk = null;
      }
    }
    return { completedRound: completedRound, turnDisk: turnDisk };
  }

  function receiveCardRunDisplay() {
    var upperStrip = document.getElementById("receivecard-hand-strip-upper");
    var stagingGrid = document.getElementById("receivecard-staging-grid");
    var stagingWrap = document.getElementById("receivecard-staging-wrap");
    var legacyHandStrip = document.getElementById("receivecard-hand-strip");
    var newImg = document.getElementById("receivecard-new-img");
    var useDual = !!(upperStrip && stagingGrid);
    if (!useDual && !legacyHandStrip) return;
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
      if (legacyHandStrip) legacyHandStrip.innerHTML = "";
      if (upperStrip) upperStrip.innerHTML = "";
      if (stagingGrid) stagingGrid.innerHTML = "";
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
      receiveCardSetMessage("");
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

    window.__risqueReceiveCardStagingMerged = false;
    window.__risqueReceiveCardStagingMergeNeeded = !!drawnThisStep;

    var nHand = currentPlayer.cards.length;
    var lastCard = nHand > 0 ? currentPlayer.cards[nHand - 1] : null;
    var lastName = lastCard ? (typeof lastCard === "string" ? lastCard : lastCard.name) : "";
    var stagingShowsNewDraw =
      !!drawnThisStep && lastName === drawnThisStep.name && nHand >= 1;
    var conquestStartIdx = Math.max(0, currentPlayer.cards.length - transferredCount);

    if (useDual) {
      upperStrip.innerHTML = "";
      stagingGrid.innerHTML = "";
      if (stagingWrap) stagingWrap.removeAttribute("hidden");
      var stagingStripLabel = document.getElementById("receivecard-staging-strip-label");
      var upperStripLabelEl = document.getElementById("receivecard-upper-strip-label");
      if (upperStripLabelEl && !conquestElimReview) {
        upperStripLabelEl.textContent = "Cards in hand";
      }
      if (stagingStripLabel && !conquestElimReview) {
        stagingStripLabel.textContent = "Received card";
      }
      if (stagingShowsNewDraw) {
        currentPlayer.cards.slice(0, -1).forEach(function (card, idx) {
          var cardName = typeof card === "string" ? card : card.name;
          var img = document.createElement("img");
          img.className = "receivecard-thumb receivecard-thumb-existing";
          if (conquestElimReview && transferredCount > 0 && idx >= conquestStartIdx) {
            img.classList.add("receivecard-thumb-conquest");
          }
          img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
          img.alt = cardName.replace(/_/g, " ");
          upperStrip.appendChild(img);
        });
        receiveCardAppendThumbToStrip(
          stagingGrid,
          drawnThisStep.name,
          "receivecard-thumb-new receivecard-new-glow"
        );
      } else if (conquestElimReview) {
        /* Merged hand in state = [your cards before elimination][defender's cards]. Prefer slicing by
         * transferredCardCount so UI matches JSON (snapshots first caused duplicates after loads). */
        var defeatedDisp =
          gs.defeatedPlayer != null && String(gs.defeatedPlayer).trim() !== ""
            ? String(gs.defeatedPlayer).trim()
            : "eliminated player";
        var snapBefore = Array.isArray(gs.risqueConquestHandBeforeTakeover)
          ? gs.risqueConquestHandBeforeTakeover
          : null;
        var snapTaken = Array.isArray(gs.risqueConquestTakenCards) ? gs.risqueConquestTakenCards : null;
        var snapOk =
          snapBefore &&
          snapTaken &&
          snapBefore.length + snapTaken.length > 0;
        var upperStripLabel = document.getElementById("receivecard-upper-strip-label");
        if (upperStripLabel) {
          upperStripLabel.textContent =
            transferredCount > 0 ? "Your hand (before transfer)" : "Cards in hand";
        }
        if (stagingStripLabel) {
          stagingStripLabel.textContent =
            transferredCount > 0
              ? "Cards taken from " + defeatedDisp
              : "Cards from " + defeatedDisp;
        }
        var nMerge = currentPlayer.cards.length;
        var splitOk =
          transferredCount > 0 && transferredCount <= nMerge;

        function renderConquestSplitUpperTaken(beforeNames, takenNames) {
          var cn = window.gameUtils && window.gameUtils.cardNames ? window.gameUtils.cardNames : null;
          beforeNames.forEach(function (nm) {
            var canon = receiveCardCanonicalTerritoryCardName(nm);
            if (!canon || !cn || cn.indexOf(canon) === -1) return;
            var img = document.createElement("img");
            img.className = "receivecard-thumb receivecard-thumb-existing";
            img.src = "assets/images/Cards/" + canon.toUpperCase() + ".webp";
            img.alt = canon.replace(/_/g, " ");
            upperStrip.appendChild(img);
          });
          takenNames.forEach(function (nm) {
            var canon = receiveCardCanonicalTerritoryCardName(nm);
            if (!canon || !cn || cn.indexOf(canon) === -1) return;
            receiveCardAppendThumbToStrip(
              stagingGrid,
              canon,
              "receivecard-thumb-existing receivecard-thumb-conquest"
            );
          });
        }

        if (splitOk) {
          var cut = nMerge - transferredCount;
          renderConquestSplitUpperTaken(
            currentPlayer.cards.slice(0, cut).map(function (c) {
              return typeof c === "string" ? c : c.name;
            }),
            currentPlayer.cards.slice(cut).map(function (c) {
              return typeof c === "string" ? c : c.name;
            })
          );
        } else if (transferredCount === 0) {
          if (upperStripLabel) {
            upperStripLabel.textContent = "Cards in hand";
          }
          if (stagingStripLabel) {
            stagingStripLabel.textContent = "Taken cards";
          }
          currentPlayer.cards.forEach(function (card) {
            var cardName = typeof card === "string" ? card : card.name;
            var img = document.createElement("img");
            img.className = "receivecard-thumb receivecard-thumb-existing";
            img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
            img.alt = String(cardName || "").replace(/_/g, " ");
            upperStrip.appendChild(img);
          });
          stagingGrid.innerHTML =
            '<div class="receivecard-staging-conquest-note" role="status">' +
            "<p>No <strong>transferred card count</strong> (unexpected). Full current hand is above.</p>" +
            "</div>";
        } else if (snapOk) {
          receiveCardLog("Conquest split: using snapshots (transfer count vs hand mismatch)", {
            transferredCount: transferredCount,
            handLen: nMerge
          });
          renderConquestSplitUpperTaken(snapBefore, snapTaken);
        } else {
          receiveCardLog("Conquest receive-card: split mismatch", {
            transferredCount: transferredCount,
            handLen: currentPlayer.cards.length,
            conquestStartIdx: conquestStartIdx,
            defeated: defeatedDisp
          });
          currentPlayer.cards.forEach(function (card, idx) {
            var cardName = typeof card === "string" ? card : card.name;
            var img = document.createElement("img");
            img.className = "receivecard-thumb receivecard-thumb-existing";
            if (transferredCount > 0 && idx >= Math.max(0, currentPlayer.cards.length - transferredCount)) {
              img.classList.add("receivecard-thumb-conquest");
            }
            img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
            img.alt = String(cardName || "").replace(/_/g, " ");
            upperStrip.appendChild(img);
          });
          stagingGrid.innerHTML =
            '<div class="receivecard-staging-conquest-note" role="status">' +
            "<p><strong>Could not split</strong> using saved transfer count (" +
            transferredCount +
            ") and current hand (" +
            currentPlayer.cards.length +
            "). Full merged hand is shown above; gold outline uses the last N cards if N matches.</p>" +
            "<p>Territory deck card still comes <strong>after reinforcement</strong>.</p>" +
            "</div>";
        }
      } else {
        currentPlayer.cards.forEach(function (card) {
          var cardName = typeof card === "string" ? card : card.name;
          var img = document.createElement("img");
          img.className = "receivecard-thumb receivecard-thumb-existing";
          img.src = "assets/images/Cards/" + String(cardName || "").toUpperCase() + ".webp";
          img.alt = cardName.replace(/_/g, " ");
          upperStrip.appendChild(img);
        });
        var placeholderAlt = eligible
          ? "No unique card from deck"
          : "No deck card earned this turn";
        stagingGrid.innerHTML =
          '<div class="receivecard-staging-placeholder-wrap">' +
          '<img class="receivecard-thumb receivecard-staging-placeholder" src="assets/images/Cards/CARDBACK.webp" alt="" />' +
          '<div class="receivecard-staging-placeholder-caption">' +
          placeholderAlt +
          "</div></div>";
      }
    } else if (legacyHandStrip) {
      legacyHandStrip.innerHTML = "";
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
        legacyHandStrip.appendChild(img);
      });
      if (newImg) {
        if (drawnThisStep) {
          newImg.style.display = "";
          newImg.src = "assets/images/Cards/" + String(drawnThisStep.name || "").toUpperCase() + ".webp";
          newImg.alt = drawnThisStep.name.replace(/_/g, " ");
          newImg.classList.add("receivecard-new-glow");
        } else if (conquestElimReview) {
          /* Same rule as dual-pane staging: no misleading deck cardback after elimination. */
          newImg.style.display = "none";
          newImg.removeAttribute("src");
          newImg.alt = "";
          newImg.classList.remove("receivecard-new-glow");
        } else {
          newImg.style.display = "";
          newImg.src = "assets/images/Cards/CARDBACK.webp";
          newImg.alt = eligible ? "No card" : "No card earned";
          newImg.classList.remove("receivecard-new-glow");
        }
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
    if (window.gameUtils && typeof window.gameUtils.syncConquestPendingNewContinents === "function") {
      pendingCont = window.gameUtils.syncConquestPendingNewContinents(gs);
    } else if (
      defeatedPl &&
      window.gameUtils &&
      typeof window.gameUtils.computePendingContinentsAfterElimination === "function"
    ) {
      pendingCont = window.gameUtils.computePendingContinentsAfterElimination(gs, gs.currentPlayer, defeatedPl);
      var paidSoFar = gs.risqueConquestChainPaidContinents || [];
      pendingCont = pendingCont.filter(function (k) {
        return paidSoFar.indexOf(k) === -1;
      });
      gs.pendingNewContinents = pendingCont;
    }
    var paidSoFar = gs.risqueConquestChainPaidContinents || [];
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
    delete gs.risqueConquestHandBeforeTakeover;
    delete gs.risqueConquestTakenCards;
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
    /* Conquer-mode income (con-income): books + new continents; see phases/income.js runConquerIncome. */
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
      if (
        typeof window.risqueNavigateGameHtmlSoft === "function" &&
        window.risqueNavigateGameHtmlSoft(navWithSkip)
      ) {
        return;
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
    if (window.__risqueReceiveCardEndTurnBusy) {
      receiveCardLog("Ignored duplicate end-turn (still processing)");
      return;
    }
    if (window.__risqueReceiveCardStagingMergeNeeded && !window.__risqueReceiveCardStagingMerged) {
      window.__risqueReceiveCardEndTurnBusy = true;
      receiveCardScheduleAdvanceAfterStagingMerge();
      return;
    }
    window.__risqueReceiveCardEndTurnBusy = true;
    receiveCardRunTurnAdvanceAndHandoff();
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
        player.cards = player.cards
          .map(function (card) {
            var raw = typeof card === "string" ? card : card && card.name;
            var canon = receiveCardCanonicalTerritoryCardName(raw);
            if (!canon || window.gameUtils.cardNames.indexOf(canon) === -1) return null;
            if (typeof card === "string") return canon;
            var o = Object.assign({}, card);
            o.name = canon;
            return o;
          })
          .filter(function (c) {
            return c != null;
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

    if (typeof window.risqueRestoreHostMapCanvasFromPhaseArtifacts === "function") {
      window.risqueRestoreHostMapCanvasFromPhaseArtifacts();
    }
    try {
      delete window.__risqueSuppressHostMapRedraw;
    } catch (eSupRc) {
      /* ignore */
    }

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
    /* Full page unload cleared this; same-document nav does not — unblock Continue on later visits. */
    try {
      window.__risqueReceiveCardEndTurnBusy = false;
    } catch (eBusyMount) {}
    try {
      if (window.__risqueReceiveCardStagingTimer) {
        clearTimeout(window.__risqueReceiveCardStagingTimer);
      }
    } catch (eStg) {
      /* ignore */
    }
    window.__risqueReceiveCardStagingTimer = null;
    window.__risqueReceiveCardStagingMergeNeeded = false;
    window.__risqueReceiveCardStagingMerged = false;

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
        var conquestUi =
          conquestElim ||
          !!(window.gameState && window.gameState.risqueConquestElimReceiveCard);
        var conquestHead = conquestUi
          ? '<div class="receivecard-strip-label receivecard-strip-label--conquest">Conquest · take eliminated player\'s cards</div>'
          : "";
        var rootExtraClass = conquestUi ? " receivecard-compact-root--conquest-elim" : "";
        slot.innerHTML =
          '<div class="receivecard-compact-root receivecard-compact-root--simple' +
          rootExtraClass +
          '" role="region" aria-label="Your cards">' +
          '<div class="risque-book-pill-row">' +
          '<div id="receivecard-book-pill" class="risque-book-pill" hidden role="status" aria-hidden="true">' +
          '<span class="risque-book-pill-label">BOOK</span>' +
          '<span class="risque-book-pill-check" aria-hidden="true">\u2713</span>' +
          "</div>" +
          "</div>" +
          conquestHead +
          '<div id="receivecard-compact-message" class="receivecard-compact-message" aria-live="polite"></div>' +
          '<div class="receivecard-hand-staging-split">' +
          '<div class="receivecard-hand-stack">' +
          '<div id="receivecard-upper-strip-label" class="receivecard-strip-label">Cards in hand</div>' +
          '<div id="receivecard-hand-strip-upper" class="receivecard-hand-strip receivecard-hand-strip--upper"></div>' +
          "</div>" +
          '<div id="receivecard-staging-wrap" class="receivecard-staging-wrap">' +
          '<div id="receivecard-staging-strip-label" class="receivecard-strip-label receivecard-strip-label--staging">Received card</div>' +
          '<div id="receivecard-staging-grid" class="receivecard-staging-grid"></div>' +
          "</div>" +
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
        '<div id="receivecard-hand-staging-split" style="position:absolute;left:1100px;top:460px;width:800px;display:flex;flex-direction:column;gap:12px;">' +
        '<div><div style="color:#0f0;font-size:14px;font-weight:bold;">CARDS IN HAND</div>' +
        '<div id="receivecard-hand-strip-upper" style="display:flex;gap:6px;flex-wrap:wrap;"></div></div>' +
        '<div style="border:1px solid #0f0;padding:8px;border-radius:6px;">' +
        '<div style="color:#0f0;font-size:14px;font-weight:bold;">RECEIVED CARD</div>' +
        '<div id="receivecard-staging-grid" style="display:flex;gap:8px;flex-wrap:wrap;min-height:120px;"></div></div></div>' +
        '<div id="receivecard-hand-strip" style="display:none"></div>' +
        '<img id="receivecard-new-img" class="card-image" style="display:none;left:1250px;top:620px;width:150px;height:240px;" src="assets/images/Cards/CARDBACK.webp" alt="" />' +
        '<button type="button" id="receivecard-btn-end" class="button" style="left:1250px;top:900px;width:280px;height:36px;">Continue</button>';
    }

    if (typeof window.initReceiveCardPhase === "function") {
      window.initReceiveCardPhase();
    }

    if (typeof window.risqueRepaintHostMapSoon === "function" && window.gameState) {
      window.risqueRepaintHostMapSoon(window.gameState);
    } else {
      requestAnimationFrame(function () {
        window.gameUtils.resizeCanvas();
        if (window.gameState) {
          window.gameUtils.renderTerritories(null, window.gameState);
          window.gameUtils.renderStats(window.gameState);
        }
      });
    }
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.receivecard = { mount: mount };
})();
