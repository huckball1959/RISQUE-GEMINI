/**
 * Card play phase — mounted from game.html when phase is cardplay (canonical implementation).
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-cardplay-styles";
  var mountOpts = { legacyNext: null, onLog: null };

  function risqueCardplayDoc(name) {
    if (typeof window.risqueResolveDocUrl === "function") {
      return window.risqueResolveDocUrl(name);
    }
    return name === "conquer" ? "game.html?phase=conquer" : "";
  }

  function loginRecoveryUrl() {
    return typeof window.risqueLoginRecoveryUrl === "function"
      ? window.risqueLoginRecoveryUrl()
      : "game.html?phase=login&loginLegacyNext=game.html%3Fphase%3DplayerSelect%26selectKind%3DfirstCard&loginLoadRedirect=game.html%3Fphase%3Dcardplay%26legacyNext%3Dincome.html";
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = ".cardplay-player-name { font-family: Arial, sans-serif; font-size: 20px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; text-shadow: 2px 2px 2px rgba(0, 0, 0, 0.7); position: absolute; left: 1110px; top: 250px; z-index: 10; pointer-events: none; } .cardplay-message { font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; color: #ffffff; position: absolute; left: 1110px; top: 900px; text-align: left; z-index: 10; pointer-events: none; } .cardplay-button-container { position: absolute; top: 309px; left: 1105px; display: flex; flex-direction: column; align-items: flex-start; width: 258px; z-index: 10; } .cardplay-button { width: 258px; height: 36px; margin: 10px 0; background: #000000; color: #ffffff; font-family: Arial, sans-serif; font-size: 16px; font-weight: bold; text-align: center; border: none; border-radius: 4px; cursor: pointer; z-index: 10; } .cardplay-button.enabled { background: #000000; color: #ffffff; opacity: 1; } .cardplay-button:hover:not(:disabled) { background: #1a1a1a; color: #ffffff; } .cardplay-button:active:not(:disabled) { transform: scale(0.95); } .cardplay-button:disabled { background: #000000; color: #ffffff; opacity: 0.5; cursor: not-allowed; } .cardplay-button.dissolve-in { opacity: 0; animation: dissolveIn 1s forwards; } .card { position: absolute; z-index: 10; cursor: pointer; pointer-events: auto; } .card.selected { border: 3px solid #ffff00; } .card.played { opacity: 0.5; cursor: not-allowed; } .card.processing { border: 3px solid #ff0000; } .popup { position: absolute; left: 870px; top: 400px; min-width: 280px; max-width: 480px; width: max-content; box-sizing: border-box; background: #ffffff; border: 2px solid #000000; padding: 14px; z-index: 3; display: none; font-family: Arial, sans-serif; font-size: 14px; color: #000000; box-shadow: 0 4px 14px rgba(0,0,0,0.3); } .popup * { color: inherit; } .popup-message { margin-bottom: 12px; color: #000000 !important; font-weight: 700; font-size: 15px; line-height: 1.35; } .popup-select, .popup-input { width: 100%; margin-bottom: 10px; display: none; color: #000000 !important; background: #ffffff; border: 2px solid #000000; font-size: 14px; padding: 6px 8px; font-weight: 600; } .popup-button { margin-right: 10px; margin-top: 6px; background: #1a1a1a; color: #ffffff !important; border: 2px solid #000000; border-radius: 6px; padding: 10px 18px; font-size: 13px; font-weight: 700; cursor: pointer; } .popup-button:hover:not(:disabled) { background: #333333; color: #ffffff !important; } @keyframes dissolveIn { from { opacity: 0; } to { opacity: 1; } } .popup{z-index:100050!important;color:#000000!important;}";
    document.head.appendChild(s);
  }

  function cardplayStatusEl() {
    return document.getElementById("cardplay-inline-error") || document.getElementById("error");
  }

  function setCardplayError(msg) {
    var el = cardplayStatusEl();
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle(
      "cardplay-inline-error--warn",
      !!(msg && /not a valid set|invalid book/i.test(String(msg)))
    );
  }

  function generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function normalizeAllPlayerCards(gameState) {
    if (!gameState || !Array.isArray(gameState.players)) return;
    gameState.players.forEach(player => {
      player.cards = (Array.isArray(player.cards) ? player.cards : []).map(card => {
        if (typeof card === "string") return { name: card, id: generateUUID() };
        if (card && card.name) return { name: card.name, id: card.id || generateUUID() };
        return null;
      }).filter(Boolean);
      player.cardCount = player.cards.length;
    });
  }

  function removeCardFromHand(player, cardId, cardName) {
    if (!player || !Array.isArray(player.cards)) return false;
    const before = player.cards.length;
    let removed = false;
    player.cards = player.cards.filter(card => {
      if (!removed && card && card.id === cardId) {
        removed = true;
        return false;
      }
      return true;
    });
    if (!removed && cardName) {
      player.cards = player.cards.filter(card => {
        if (!removed && card && card.name === cardName) {
          removed = true;
          return false;
        }
        return true;
      });
    }
    player.cardCount = player.cards.length;
    return removed || player.cards.length < before;
  }

  console.log("[Cardplay] Module loaded at", new Date().toLocaleString());
    let initialGameState = null;
    let selectedCards = [];
    let summaryMessages = [];
    let isBookSelectionMode = false;
    let isIndividualSelectionMode = false;
    let processingBook = false;
    let currentBookCardIndex = -1;
    let hasConfirmed = false;
    let playedCards = [];
    /** Cleared on mount / reset — do not use persisted risqueCardplayTvRecapPublished alone or a stale disk flag can skip publishing and jump to income. */
    let recapMirrorSentForCommit = false;
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
      const logEntry = `[${timestamp}] [Cardplay] ${message}`;
      const logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
      logs.push(logEntry);
      if (data) logs.push(JSON.stringify(data, null, 2));
      localStorage.setItem("gameLogs", JSON.stringify(logs));
      console.log(logEntry, data || "");
      if (typeof mountOpts.onLog === "function") mountOpts.onLog(logEntry, data);
    }

    function prettyCardTerritory(id) {
      if (!id) return "";
      return String(id).replace(/_/g, " ").replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
    }
    function playedCardPreamble(card, territory) {
      var t = prettyCardTerritory(territory);
      var c = String(card || "").toLowerCase();
      if (c === "wildcard1" || c === "wildcard2") {
        return "Played Wildcard → " + t + ".";
      }
      if (c === String(territory || "").toLowerCase()) {
        return "Played " + t + ".";
      }
      return "Played " + prettyCardTerritory(card) + " on " + t + ".";
    }
    /**
     * @param {boolean} [skipMirrorPush] - If true, update host local state only. Used when leaving card play
     *   so the public TV keeps recap + risquePublicBookProcessing until income mirror arrives (otherwise the
     *   recap is wiped before the TV can animate).
     */
    function clearCardplayPublicSpectator(skipMirrorPush) {
      if (!window.gameState) return;
      window.gameState.risquePublicCardplayPrimary = "";
      window.gameState.risquePublicCardplayReport = "";
      delete window.gameState.risquePublicCardplayBookCards;
      delete window.gameState.risquePublicBookProcessing;
      window.gameState.risquePublicCardplayHighlightLabels = [];
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eClr) {}
      if (!skipMirrorPush && typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
    }
    /**
     * Public TV mirror uses live gameState.players — that reveals card resolutions on the map before CONFIRM.
     * Freeze a snapshot (risqueMirrorPushGameState swaps players from it until recap is published).
     */
    function captureCardplayPublicBoardSnapshot() {
      if (!window.gameState || window.risqueDisplayIsPublic) return;
      try {
        window.gameState.risqueCardplayUseFrozenPublicMirror = true;
        window.gameState.risqueCardplayPublicMirrorSnapshot = {
          players: JSON.parse(JSON.stringify(window.gameState.players)),
          aerialAttack: !!(
            (window.gameUtils &&
              typeof window.gameUtils.getAerialAttackUsesRemaining === "function" &&
              window.gameUtils.getAerialAttackUsesRemaining(window.gameState) > 0) ||
            window.gameState.aerialAttackEligible ||
            (window.gameState.aerialAttack && typeof window.gameState.aerialAttack === "object")
          ),
          bookPlayedThisTurn: !!window.gameState.bookPlayedThisTurn,
          conqueredThisTurn: !!window.gameState.conqueredThisTurn,
          cardEarnedViaCardplay: !!window.gameState.cardEarnedViaCardplay,
          risquePublicEliminationBanner:
            window.gameState.risquePublicEliminationBanner != null
              ? String(window.gameState.risquePublicEliminationBanner)
              : ""
        };
      } catch (eCap) {
        /* ignore */
      }
    }
    function clearCardplayPublicBoardSnapshot() {
      if (!window.gameState) return;
      delete window.gameState.risqueCardplayUseFrozenPublicMirror;
      delete window.gameState.risqueCardplayPublicMirrorSnapshot;
    }
    function wipeCardplayPublicMapHighlight() {
      if (!window.gameState) return;
      window.gameState.risquePublicCardplayHighlightLabels = [];
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eW) {}
      if (window.gameState.risqueCardplaySuppressPublicSpectator === true) return;
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
    }

    var CARDPLAY_RECAP_ACK_KEY = "risquePublicCardplayRecapAck";
    var AERIAL_COUNTER_DECISION_KEY = "risquePublicAerialCounterDecision";
    var AERIAL_DECISION_READY_KEY = "risquePublicAerialDecisionReady";
    var CARDPLAY_PROCESSING_STATE_KEY = "risquePublicCardplayProcessingState";

    function cardplayFindPendingAerialAction() {
      if (!Array.isArray(playedCards)) return null;
      for (var i = 0; i < playedCards.length; i += 1) {
        var pc = playedCards[i];
        if (pc && pc.action === "aerial_attack") return { index: i, action: pc };
      }
      return null;
    }

    function cardplayRequiredCounterWildcardForPendingAerial() {
      var pending = cardplayFindPendingAerialAction();
      if (!pending || !pending.action || !pending.action.cards || !pending.action.cards[0]) return "";
      var played = String(pending.action.cards[0].card || "").toLowerCase();
      if (played === "wildcard1") return "wildcard2";
      if (played === "wildcard2") return "wildcard1";
      return "";
    }

    function cardplayGetAerialDecisionForReqSeq(reqSeq) {
      if (reqSeq == null || reqSeq === "") return null;
      try {
        var raw = localStorage.getItem(AERIAL_COUNTER_DECISION_KEY);
        if (!raw) return null;
        var d = JSON.parse(raw);
        if (!d || Number(d.seq) !== Number(reqSeq)) return null;
        return d;
      } catch (e) {
        return null;
      }
    }

    function cardplayIsAerialDecisionReady(reqSeq) {
      if (reqSeq == null || reqSeq === "") return false;
      try {
        var raw = localStorage.getItem(AERIAL_DECISION_READY_KEY);
        if (!raw) return false;
        var d = JSON.parse(raw);
        return !!(d && d.ready === true && Number(d.seq) === Number(reqSeq));
      } catch (e) {
        return false;
      }
    }

    function cardplayIsPublicProcessingDone(reqSeq) {
      if (reqSeq == null || reqSeq === "") return false;
      try {
        var raw = localStorage.getItem(CARDPLAY_PROCESSING_STATE_KEY);
        if (!raw) return false;
        var s = JSON.parse(raw);
        return !!(s && Number(s.seq) === Number(reqSeq) && String(s.state || "") === "done");
      } catch (e) {
        return false;
      }
    }

    function cardplayAerialCounterHoldActive(reqSeq) {
      var d = cardplayGetAerialDecisionForReqSeq(reqSeq);
      if (!d || String(d.choice || "") !== "countered") return false;
      var holdUntil = Number(d.holdUntilMs || 0);
      if (!holdUntil) return false;
      return Date.now() < holdUntil;
    }

    function cardplayPlayerHasSpecificWildcard(playerName, wildcardName) {
      if (!window.gameState || !Array.isArray(window.gameState.players)) return false;
      var p = window.gameState.players.find(function (x) {
        return x && String(x.name || "") === String(playerName || "");
      });
      if (!p || !Array.isArray(p.cards)) return false;
      var want = String(wildcardName || "").toLowerCase();
      return p.cards.some(function (c) {
        return c && c.name && String(c.name).toLowerCase() === want;
      });
    }

    function cardplayGetOpposingPlayers() {
      if (!window.gameState || !Array.isArray(window.gameState.players)) return [];
      var cur = String(window.gameState.currentPlayer || "");
      return window.gameState.players
        .filter(function (p) {
          return p && String(p.name || "") !== cur;
        })
        .map(function (p) {
          return String(p.name || "");
        });
    }

    function cardplayFindAndConsumeCounterWildcard(ownerName, requiredWildcard) {
      if (!window.gameState || !Array.isArray(window.gameState.players)) return null;
      var current = String(window.gameState.currentPlayer || "");
      var players = window.gameState.players;
      var preferred = ownerName != null ? String(ownerName) : "";
      var req = String(requiredWildcard || "").toLowerCase();
      function tryConsumeFromPlayer(p) {
        if (!p || !Array.isArray(p.cards)) return null;
        var ci;
        for (ci = 0; ci < p.cards.length; ci += 1) {
          var c = p.cards[ci];
          var nm = c && c.name != null ? String(c.name).toLowerCase() : "";
          if ((req && nm === req) || (!req && (nm === "wildcard1" || nm === "wildcard2"))) {
            var removed = p.cards.splice(ci, 1)[0];
            p.cardCount = p.cards.length;
            return {
              player: String(p.name || ""),
              card: removed && removed.name ? String(removed.name).toLowerCase() : nm
            };
          }
        }
        return null;
      }
      if (preferred) {
        var pPref = players.find(function (p0) {
          return p0 && String(p0.name || "") === preferred;
        });
        if (pPref && String(pPref.name || "") !== current) {
          var usedPref = tryConsumeFromPlayer(pPref);
          if (usedPref) return usedPref;
          return null;
        }
        return null;
      }
      var i;
      for (i = 0; i < players.length; i += 1) {
        var p = players[i];
        if (!p || String(p.name || "") === current) continue;
        var used = tryConsumeFromPlayer(p);
        if (used) return used;
      }
      return null;
    }

    function applyPendingAerialCounterDecision() {
      if (!window.gameState || window.risqueDisplayIsPublic) return false;
      var reqSeq = window.gameState.risquePublicCardplayRecapAckRequiredSeq;
      if (reqSeq == null || reqSeq === "") return false;
      var raw = null;
      try {
        raw = localStorage.getItem(AERIAL_COUNTER_DECISION_KEY);
      } catch (eRaw) {
        raw = null;
      }
      if (!raw) return false;
      var msg;
      try {
        msg = JSON.parse(raw);
      } catch (eParse) {
        return false;
      }
      if (!msg || Number(msg.seq) !== Number(reqSeq)) return false;
      if (String(msg.phase || "") !== "cardplay") return false;
      if (String(msg.choice || "") !== "countered") return false;
      var pending = cardplayFindPendingAerialAction();
      if (!pending || pending.index < 0) return false;
      var requiredCounter = cardplayRequiredCounterWildcardForPendingAerial();
      var consumed = cardplayFindAndConsumeCounterWildcard(msg.counterPlayer, requiredCounter);
      if (!consumed) {
        try {
          localStorage.removeItem(AERIAL_COUNTER_DECISION_KEY);
        } catch (eClrInvalid) {}
        setCardplayError(
          String(msg.counterPlayer || "Selected player") +
            " does not have the required counter wildcard. Confirm to continue."
        );
        return false;
      }
      playedCards.splice(pending.index, 1);
      if (window.gameUtils && typeof window.gameUtils.addAerialAttackUses === "function") {
        window.gameUtils.addAerialAttackUses(window.gameState, -1);
      } else {
        window.gameState.aerialAttackEligible = false;
      }
      window.gameState.aerialAttack = false;
      summaryMessages.push(
        "Aerial attack countered by " + consumed.player + " (" + String(consumed.card || "wildcard").toUpperCase() + ")."
      );
      window.gameState.risquePublicCardplayPrimary =
        "Aerial attack countered by " + String(consumed.player || "opponent") + ".";
      window.gameState.risquePublicCardplayReport = "Original aerial attack is void.";
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eSave) {}
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      updateSummaryDisplay();
      checkCardStatus();
      return true;
    }

    function cardplayRecapAckSatisfied() {
      applyPendingAerialCounterDecision();
      var req = window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq;
      if (req == null || req === "") return true;
      var pendingAerial = cardplayFindPendingAerialAction();
      if (pendingAerial) {
        try {
          var rawDec = localStorage.getItem(AERIAL_COUNTER_DECISION_KEY);
          if (!rawDec) return false;
          var d = JSON.parse(rawDec);
          if (Number(d.seq) !== Number(req)) return false;
          var choice = String((d && d.choice) || "");
          if (choice !== "confirmed" && choice !== "countered") return false;
        } catch (eDec) {
          return false;
        }
      }
      try {
        var raw = localStorage.getItem(CARDPLAY_RECAP_ACK_KEY);
        if (!raw) return false;
        var a = JSON.parse(raw);
        /* Exact match only — a stale higher seq from another session must not satisfy a new recap. */
        return Number(a.seq) === Number(req);
      } catch (eA) {
        return false;
      }
    }

    function stopHostIncomeGateAckPoll() {
      if (window.__risqueHostIncomeGatePoll) {
        clearInterval(window.__risqueHostIncomeGatePoll);
        window.__risqueHostIncomeGatePoll = null;
      }
      if (window.__risqueHostAutoIncomeTimer) {
        clearTimeout(window.__risqueHostAutoIncomeTimer);
        window.__risqueHostAutoIncomeTimer = null;
      }
    }

    function collectPlayedCardIdsForRecap(list) {
      var ids = [];
      if (!Array.isArray(list)) return ids;
      list.forEach(function (pc) {
        (pc.cards || []).forEach(function (c) {
          if (c && c.card) ids.push(String(c.card).toLowerCase());
        });
      });
      return ids;
    }

    function territoryTitleLine(raw) {
      if (!raw) return "";
      var s = String(raw).toLowerCase();
      if (s === "wildcard1" || s === "wildcard2") return "WILDCARD";
      return prettyCardTerritory(raw);
    }

    /** Public TV: territory / card id as ALL CAPS with spaces (not title case). */
    function terrCapsTerritory(raw) {
      if (!raw) return "";
      var s = String(raw).toLowerCase();
      if (s === "wildcard1" || s === "wildcard2") return "WILDCARD";
      return String(raw).replace(/_/g, " ").toUpperCase();
    }

    /** Short labels under cards (e.g. N.W. for northwest_territory). */
    var RISQUE_TERR_ABBREV = {
      northwest_territory: "N.W.",
      eastern_united_states: "E.U.S.",
      western_united_states: "W.U.S.",
      central_america: "C.AM.",
      great_britain: "G.B.",
      northern_europe: "N.EUR.",
      southern_europe: "S.EUR.",
      eastern_australia: "E.AUS.",
      western_australia: "W.AUS.",
      south_africa: "S.AF.",
      north_africa: "N.AF.",
      east_africa: "E.AF.",
      new_guinea: "N.G.",
      middle_east: "M.EAST"
    };

    function abbreviateTerritoryForRecap(raw) {
      if (!raw) return "";
      var key = String(raw).toLowerCase();
      if (RISQUE_TERR_ABBREV[key]) return RISQUE_TERR_ABBREV[key];
      var parts = key.split("_").filter(Boolean);
      if (parts.length >= 2 && key.length > 14) {
        return (
          parts
            .map(function (p) {
              return p.charAt(0).toUpperCase();
            })
            .join(".") + "."
        );
      }
      return terrCapsTerritory(raw);
    }

    function currentPlayerAcquireStrokeColor() {
      var cp =
        window.gameState && window.gameState.players
          ? window.gameState.players.find(function (p) {
              return p.name === window.gameState.currentPlayer;
            })
          : null;
      if (!cp || !window.gameUtils || !window.gameUtils.colorMap) return null;
      return window.gameUtils.colorMap[cp.color] || null;
    }

    /**
     * Public bullet list (caps): BOOK: T1 - T2 - T3; other plays = territory name or WILDCARD only —
     * troop deltas (+2/-2) and ACQUIRED etc. appear under card art, not here.
     */
    function buildPublicRecapDisplayLines(playedCards) {
      var rows = [];
      if (!Array.isArray(playedCards)) return rows;
      playedCards.forEach(function (pc) {
        if (!pc || !pc.cards || !pc.cards.length) return;
        if (pc.action === "book") {
          var names = [];
          var bi;
          for (bi = 0; bi < pc.cards.length; bi++) {
            var c = pc.cards[bi];
            var eff = pc.effects && pc.effects[bi];
            var raw =
              eff && eff.territory != null && String(eff.territory).length
                ? eff.territory
                : c && c.card;
            var line = terrCapsTerritory(raw);
            if (line) names.push(line);
          }
          if (names.length) {
            rows.push({
              text: "BOOK: " + names.join(" - "),
              kind: "book"
            });
          }
          return;
        }
        if (pc.action === "aerial_attack") {
          rows.push({ text: "WILDCARD", kind: "wildcard" });
          return;
        }
        var terr = pc.territory;
        var T = terr ? terrCapsTerritory(terr) : "";
        var c0 = pc.cards[0] && String(pc.cards[0].card || "").toLowerCase();
        var isWildCard = c0 === "wildcard1" || c0 === "wildcard2";
        if (pc.action === "acquire" && terr) {
          rows.push({ text: T, kind: "bullet" });
          return;
        }
        if (pc.action === "add_troops" && terr) {
          rows.push({ text: T, kind: "bullet" });
          return;
        }
        if (pc.action === "remove_troops" && terr) {
          rows.push({ text: T, kind: "bullet" });
          return;
        }
        if (pc.action === "declined") {
          rows.push({
            text: isWildCard ? "WILDCARD" : T || "CARD",
            kind: "bullet"
          });
          return;
        }
        if (pc.action === "no_effect" && terr) {
          rows.push({ text: T, kind: "bullet" });
        }
      });
      return rows;
    }

    var RISQUE_WILD_ACQUIRE_STROKE = "#2563eb";

    /**
     * Public TV: one caption per book card — troop delta (+2 / -2) or ACQUIRED / DECLINED / NO EFFECT.
     */
    function recapLabelForBookEffect(effect, cardRef) {
      var stroke = currentPlayerAcquireStrokeColor();
      var none = { skipCaption: true, isAerial: false, acquireStrokeColor: null };
      if (!effect || !effect.action) return none;
      var action = effect.action;
      var cardName = cardRef && cardRef.card ? String(cardRef.card).toLowerCase() : "";
      var isWild = cardName === "wildcard1" || cardName === "wildcard2";
      var wildSideFromEffect = "";
      if (isWild && effect.territory != null && String(effect.territory) !== "") {
        var tk = String(effect.territory).toLowerCase();
        if (tk !== "wildcard1" && tk !== "wildcard2") {
          wildSideFromEffect = abbreviateTerritoryForRecap(effect.territory);
        }
      }
      function attachWild(o) {
        if (wildSideFromEffect) o.wildSideLabel = wildSideFromEffect;
        return o;
      }
      if (action === "add_troops") {
        return attachWild({
          combined: "+2",
          tone: "pos",
          skipCaption: false,
          isAerial: false,
          acquireStrokeColor: null
        });
      }
      if (action === "remove_troops") {
        return attachWild({
          combined: "-2",
          tone: "neg",
          skipCaption: false,
          isAerial: false,
          acquireStrokeColor: null
        });
      }
      if (action === "acquire") {
        return attachWild({
          combined: "ACQUIRED",
          tone: "acq",
          isAerial: false,
          acquireStrokeColor: isWild ? RISQUE_WILD_ACQUIRE_STROKE : stroke,
          skipCaption: false
        });
      }
      if (action === "declined") {
        return attachWild({
          combined: "DECLINED",
          tone: "muted",
          skipCaption: false,
          isAerial: false,
          acquireStrokeColor: null
        });
      }
      if (action === "no_effect") {
        return attachWild({
          combined: "NO EFFECT",
          tone: "muted",
          skipCaption: false,
          isAerial: false,
          acquireStrokeColor: null
        });
      }
      return none;
    }

    function recapLabelForSinglePlayed(pc) {
      var stroke = currentPlayerAcquireStrokeColor();
      if (!pc || !pc.cards || !pc.cards.length) {
        return { title: "", value: "…", tone: "muted", isAerial: false, acquireStrokeColor: null, skipCaption: false };
      }
      var cardName = String(pc.cards[0].card || "").toLowerCase();
      var isWild = cardName === "wildcard1" || cardName === "wildcard2";
      var terr = pc.territory;
      var terrShort = terr ? abbreviateTerritoryForRecap(terr) : "";
      if (pc.action === "aerial_attack") {
        return {
          combined: "AERIAL ATTACK",
          tone: "acq",
          isAerial: true,
          acquireStrokeColor: null,
          skipCaption: true,
          wildSideLabel: "AERIAL ATTACK"
        };
      }
      if (pc.action === "declined") {
        var ld = {
          combined: "DECLINED",
          tone: "muted",
          isAerial: false,
          acquireStrokeColor: null,
          skipCaption: false
        };
        if (isWild && terrShort) ld.wildSideLabel = terrShort;
        return ld;
      }
      if (pc.action === "add_troops") {
        var la = {
          combined: "+2",
          tone: "pos",
          isAerial: false,
          acquireStrokeColor: null,
          skipCaption: false
        };
        if (isWild && terrShort) la.wildSideLabel = terrShort;
        return la;
      }
      if (pc.action === "remove_troops") {
        var lr = {
          combined: "-2",
          tone: "neg",
          isAerial: false,
          acquireStrokeColor: null,
          skipCaption: false
        };
        if (isWild && terrShort) lr.wildSideLabel = terrShort;
        return lr;
      }
      if (pc.action === "acquire") {
        var lq = {
          combined: "ACQUIRED",
          tone: "acq",
          isAerial: false,
          acquireStrokeColor: isWild ? RISQUE_WILD_ACQUIRE_STROKE : stroke,
          skipCaption: false
        };
        if (isWild && terrShort) lq.wildSideLabel = terrShort;
        return lq;
      }
      if (pc.action === "no_effect") {
        var ln = {
          combined: "NO EFFECT",
          tone: "muted",
          isAerial: false,
          acquireStrokeColor: null,
          skipCaption: false
        };
        if (isWild && terrShort) ln.wildSideLabel = terrShort;
        return ln;
      }
      return { title: terrShort || "—", value: "…", tone: "muted", isAerial: false, acquireStrokeColor: null, skipCaption: false };
    }

    /** Public TV recap only: book triples vs singles + per-card labels (not rendered on host). */
    function buildRecapCardGroups(list) {
      var groups = [];
      if (!Array.isArray(list)) return groups;
      list.forEach(function (pc) {
        if (!pc || !pc.cards || !pc.cards.length) return;
        var ids = pc.cards
          .map(function (c) {
            return c && c.card ? String(c.card).toLowerCase() : "";
          })
          .filter(Boolean);
        if (pc.action === "book") {
          var labels = [];
          var i;
          for (i = 0; i < pc.cards.length; i++) {
            labels.push(recapLabelForBookEffect(pc.effects && pc.effects[i], pc.cards[i]));
          }
          groups.push({ kind: "book", ids: ids, labels: labels });
        } else {
          var lbl = recapLabelForSinglePlayed(pc);
          ids.forEach(function (id) {
            groups.push({ kind: "single", ids: [id], labels: [lbl] });
          });
        }
      });
      return groups;
    }

    function proceedCardplayToIncome(delayMs) {
      if (!window.gameState) return;
      stopHostIncomeGateAckPoll();
      window.__risqueCardplayHostIncomeOnly = false;
      clearCardplayPublicSpectator(true);
      clearCardplayPublicBoardSnapshot();
      delete window.gameState.risquePublicCardplayRecap;
      delete window.gameState.risquePublicCardplayRecapAckRequiredSeq;
      delete window.gameState.risqueCardplayTvRecapPublished;
      window.gameState.risqueCardplaySuppressPublicSpectator = false;
      var gs = window.gameState;
      var _raw = mountOpts.legacyNext;
      var nav =
        window.risquePostCardplayNavigator && typeof window.risquePostCardplayNavigator.resolveAfterRuntimeCardplay === "function"
          ? window.risquePostCardplayNavigator.resolveAfterRuntimeCardplay(gs, _raw)
          : { phase: "income", href: "game.html?phase=income" };
      /* Keep phase as cardplay until finishLeaveCardplay — setting income early while cardplay DOM is still
       * mounted caused host HUD/map glitches and matched a long default delay before navigation. */
      var _nextLegacy;
      if (nav.phase === "con-income") {
        var rs = _raw != null ? String(_raw) : "";
        if (rs.indexOf("phase=con-income") !== -1) {
          _nextLegacy = rs.indexOf("game.html") === 0 ? rs : "game.html?" + rs.replace(/^\?/, "");
        } else if (rs.indexOf("phase=income") !== -1) {
          var innerLegacy = "";
          try {
            var qAt = rs.indexOf("legacyNext=");
            if (qAt !== -1) {
              var rest = rs.slice(qAt + "legacyNext=".length);
              var amp = rest.indexOf("&");
              innerLegacy = amp === -1 ? decodeURIComponent(rest) : decodeURIComponent(rest.slice(0, amp));
            }
          } catch (eIn) {
            innerLegacy = "";
          }
          _nextLegacy =
            "game.html?phase=con-income" +
            (innerLegacy ? "&legacyNext=" + encodeURIComponent(innerLegacy) : "");
        } else {
          _nextLegacy = nav.href;
        }
      } else {
        _nextLegacy =
          !_raw || _raw === "income.html" || _raw === "in-come.html"
            ? "game.html?phase=income"
            : _raw;
      }
      logToStorage("Navigating after cardplay", { next: _nextLegacy, resolvedPhase: nav.phase });
      var wait = delayMs != null ? Number(delayMs) : 0;
      if (!Number.isFinite(wait) || wait < 0) wait = 0;

      function finishLeaveCardplay() {
        try {
          gs.phase = nav.phase;
          localStorage.setItem("gameState", JSON.stringify(gs));
        } catch (eS) {
          /* ignore */
        }
        try {
          window.location.href = _nextLegacy;
        } catch (eNav) {
          window.location.assign(_nextLegacy);
        }
      }

      if (wait > 0) {
        setTimeout(finishLeaveCardplay, wait);
      } else {
        /* Two animation frames: commit the last map + panel paint before unload (avoids “empty” frame). */
        requestAnimationFrame(function () {
          requestAnimationFrame(finishLeaveCardplay);
        });
      }
    }

    function wireHostContinueToIncomeBtn(btn) {
      if (!btn || btn.dataset.risqueWired) return;
      btn.dataset.risqueWired = "1";
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        var req = window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq;
        if (req != null) {
          try {
            localStorage.setItem(CARDPLAY_RECAP_ACK_KEY, JSON.stringify({ seq: Number(req), at: Date.now() }));
          } catch (eW) {}
        }
        stopHostIncomeGateAckPoll();
        btn.disabled = true;
        proceedCardplayToIncome();
      });
    }

    function wireCardplayContinueIncomeOnce() {
      wireHostContinueToIncomeBtn(document.getElementById("cardplay-continue-income-btn"));
    }

    function cardplayHostIncomeGateInnerHtml() {
      return (
        '<div class="cardplay-host-income-gate-panel">' +
        '<div id="cardplay-inline-error" class="cardplay-inline-error cardplay-host-income-gate-error" role="status"></div>' +
        '<div id="cardplay-host-aerial-decision" class="cardplay-host-aerial-decision" hidden>' +
        '<div class="cardplay-host-aerial-decision-title">Aerial attack decision</div>' +
        '<div class="cardplay-host-aerial-decision-row">' +
        '<button type="button" id="cardplay-host-aerial-confirm-btn" class="cardplay-host-continue-income-btn">Confirm Aerial Attack</button>' +
        '<button type="button" id="cardplay-host-aerial-counter-btn" class="cardplay-host-continue-income-btn">Aerial Attack Countered</button>' +
        "</div>" +
        '<div id="cardplay-host-aerial-counter-row" class="cardplay-host-aerial-decision-row" hidden>' +
        '<select id="cardplay-host-aerial-counter-player" class="cardplay-host-aerial-select"></select>' +
        "</div>" +
        "</div>" +
        '<div id="cardplay-host-auto-income-msg" class="cardplay-host-auto-income-msg">Card processing in progress...</div>' +
        "</div>"
      );
    }

    function wireHostAerialDecisionControls() {
      var bConfirm = document.getElementById("cardplay-host-aerial-confirm-btn");
      var bCounter = document.getElementById("cardplay-host-aerial-counter-btn");
      var sel = document.getElementById("cardplay-host-aerial-counter-player");
      var counterRow = document.getElementById("cardplay-host-aerial-counter-row");
      if (!bConfirm || !bCounter || !sel || !counterRow) return;
      if (!bConfirm.dataset.risqueWired) {
        bConfirm.dataset.risqueWired = "1";
        bConfirm.addEventListener("click", function () {
          var req = window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq;
          if (req == null || req === "") return;
          try {
            localStorage.setItem(
              AERIAL_COUNTER_DECISION_KEY,
              JSON.stringify({ seq: Number(req), choice: "confirmed", phase: "cardplay", at: Date.now() })
            );
          } catch (eC) {}
          refreshHostIncomeGateUi();
        });
      }
      if (!bCounter.dataset.risqueWired) {
        bCounter.dataset.risqueWired = "1";
        bCounter.addEventListener("click", function () {
          counterRow.removeAttribute("hidden");
          setCardplayError("Select the countering player.");
          refreshHostIncomeGateUi();
        });
      }
      if (!sel.dataset.risqueWired) {
        sel.dataset.risqueWired = "1";
        sel.addEventListener("change", function () {
          var req = window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq;
          var picked = String((sel && sel.value) || "");
          var needed = cardplayRequiredCounterWildcardForPendingAerial();
          if (!picked) {
            setCardplayError("Choose a player to verify counter.");
            return;
          }
          if (!cardplayPlayerHasSpecificWildcard(picked, needed)) {
            setCardplayError(picked + " does not have the required counter wildcard.");
            return;
          }
          if (req == null || req === "") return;
          try {
            localStorage.setItem(
              AERIAL_COUNTER_DECISION_KEY,
              JSON.stringify({
                seq: Number(req),
                choice: "countered",
                counterPlayer: picked,
                phase: "cardplay",
                holdUntilMs: Date.now() + 5200,
                at: Date.now()
              })
            );
          } catch (eAp) {}
          setCardplayError("Counter validated for " + picked + ".");
          refreshHostIncomeGateUi();
        });
      }
    }

    /**
     * Host only: after CONFIRM publishes the recap to the public mirror, replace the private card UI
     * with a single green Continue control (public/TV unchanged).
     */
    function mountCardplayHostIncomeGateUi() {
      if (window.risqueDisplayIsPublic) return;
      window.__risqueCardplayHostIncomeOnly = true;
      var inner = '<div class="cardplay-host-income-gate" id="cardplay-host-income-gate-root">' + cardplayHostIncomeGateInnerHtml() + "</div>";
      var slot = document.getElementById("risque-phase-content");
      if (slot) {
        slot.innerHTML = inner;
      } else {
        var ov = document.getElementById("ui-overlay");
        if (ov) {
          ov.innerHTML = '<div class="cardplay-host-income-gate cardplay-host-income-gate--legacy">' + cardplayHostIncomeGateInnerHtml() + "</div>";
        }
      }
      wireHostAerialDecisionControls();
      stopHostIncomeGateAckPoll();
      window.__risqueHostIncomeGatePoll = setInterval(function () {
        if (!document.getElementById("cardplay-host-income-gate-root")) {
          stopHostIncomeGateAckPoll();
          return;
        }
        refreshHostIncomeGateUi();
      }, 350);
      refreshHostIncomeGateUi();
      setCardplayError("");
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eGs) {}
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
        requestAnimationFrame(function () {
          window.risqueRuntimeHud.syncPosition();
        });
      }
    }

    function refreshHostIncomeGateUi() {
      var autoMsg = document.getElementById("cardplay-host-auto-income-msg");
      var aerialWrap = document.getElementById("cardplay-host-aerial-decision");
      var bAerialConfirm = document.getElementById("cardplay-host-aerial-confirm-btn");
      var bAerialCounter = document.getElementById("cardplay-host-aerial-counter-btn");
      var aerialCounterRow = document.getElementById("cardplay-host-aerial-counter-row");
      var aerialSelect = document.getElementById("cardplay-host-aerial-counter-player");
      var needAck =
        window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq != null;
      var pendingAerial = !!cardplayFindPendingAerialAction();
      var reqSeq = window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq;
      var dec = cardplayGetAerialDecisionForReqSeq(reqSeq);
      var aerialReady = cardplayIsAerialDecisionReady(reqSeq);
      var decisionButtonsEnabled = !!aerialReady;
      if (aerialWrap) {
        if (
          pendingAerial &&
          needAck &&
          !(dec && (dec.choice === "confirmed" || dec.choice === "countered"))
        ) {
          aerialWrap.removeAttribute("hidden");
        } else {
          aerialWrap.setAttribute("hidden", "");
        }
      }
      if (bAerialConfirm) {
        bAerialConfirm.disabled = !decisionButtonsEnabled;
        bAerialConfirm.title = decisionButtonsEnabled
          ? "Confirm aerial attack processing."
          : "Waiting for public wildcard processing to reach aerial step.";
      }
      if (bAerialCounter) {
        bAerialCounter.disabled = !decisionButtonsEnabled;
        bAerialCounter.title = decisionButtonsEnabled
          ? "Choose this if someone calls a valid counter."
          : "Waiting for public wildcard processing to reach aerial step.";
      }
      if (aerialSelect) {
        var players = cardplayGetOpposingPlayers();
        var keep = String(aerialSelect.value || "");
        aerialSelect.innerHTML = '<option value="">Choose countering player</option>';
        players.forEach(function (nm) {
          var opt = document.createElement("option");
          opt.value = nm;
          opt.textContent = nm;
          aerialSelect.appendChild(opt);
        });
        if (keep && players.indexOf(keep) !== -1) aerialSelect.value = keep;
      }
      if (aerialCounterRow && (!pendingAerial || (dec && dec.choice === "countered"))) {
        aerialCounterRow.setAttribute("hidden", "");
      }
      var counterHold = !!(needAck && cardplayAerialCounterHoldActive(reqSeq));
      var publicDone = !needAck || cardplayIsPublicProcessingDone(reqSeq);
      var ackOk = (!needAck || cardplayRecapAckSatisfied()) && !counterHold && publicDone;
      if (autoMsg) {
        autoMsg.textContent = ackOk
          ? "Card processing complete. Moving to income..."
          : pendingAerial && needAck && !aerialReady
            ? "Waiting for public wildcard processing before aerial decision."
          : !publicDone
            ? "Waiting for public card processing to finish."
          : counterHold
            ? "Waiting for public counter animation to finish."
            : "Card processing in progress...";
      }
      if (ackOk) {
        if (!window.__risqueHostAutoIncomeTimer) {
          window.__risqueHostAutoIncomeTimer = setTimeout(function () {
            window.__risqueHostAutoIncomeTimer = null;
            proceedCardplayToIncome(300);
          }, 1700);
        }
      } else if (window.__risqueHostAutoIncomeTimer) {
        clearTimeout(window.__risqueHostAutoIncomeTimer);
        window.__risqueHostAutoIncomeTimer = null;
      }
    }

    function updateCardplayTvGateVisibility() {
      if (window.__risqueCardplayHostIncomeOnly) {
        refreshHostIncomeGateUi();
        return;
      }
      var wrap = document.getElementById("cardplay-continue-income-wrap");
      if (!wrap) return;
      /* Gate on ack seq + pending ack only. Do not require risqueCardplayTvRecapPublished: mount may clear
       * that flag when recap payload is missing while risquePublicCardplayRecapAckRequiredSeq still applies. */
      var needGate =
        window.gameState &&
        window.gameState.risquePublicCardplayRecapAckRequiredSeq != null &&
        !cardplayRecapAckSatisfied();
      if (!needGate) {
        wrap.setAttribute("hidden", "");
        wrap.classList.remove("cardplay-continue-income-wrap--visible");
        var b = document.getElementById("cardplay-continue-income-btn");
        if (b) {
          var needAckB =
            window.gameState && window.gameState.risquePublicCardplayRecapAckRequiredSeq != null;
          b.disabled = !!(needAckB && !cardplayRecapAckSatisfied());
          b.title = b.disabled
            ? "Wait until the public display finishes the card recap animation."
            : "Go to income when ready.";
        }
        return;
      }
      wrap.removeAttribute("hidden");
      wrap.classList.add("cardplay-continue-income-wrap--visible");
      wireCardplayContinueIncomeOnce();
      var bCompact = document.getElementById("cardplay-continue-income-btn");
      if (bCompact) {
        bCompact.disabled = !cardplayRecapAckSatisfied();
        bCompact.title = bCompact.disabled
          ? "Wait until the public display finishes the card recap animation."
          : "Go to income when ready.";
      }
    }

    function setCardplayPublicSpectator(primary, report, territoryLabels) {
      if (!window.gameState) return;
      if (window.gameState.risqueCardplaySuppressPublicSpectator === true) return;
      window.gameState.risquePublicCardplayPrimary = primary != null ? String(primary) : "";
      window.gameState.risquePublicCardplayReport = report != null ? String(report) : "";
      delete window.gameState.risquePublicCardplayBookCards;
      delete window.gameState.risquePublicBookProcessing;
      var L = Array.isArray(territoryLabels) ? territoryLabels.filter(Boolean).map(String) : [];
      window.gameState.risquePublicCardplayHighlightLabels = L;
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eS) {}
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
    }
    function announceCardplayEffect(ctx) {
      if (!ctx || !window.gameState) return;
      var cur = ctx.currentName || window.gameState.currentPlayer || "Player";
      var card = ctx.card;
      var territory = ctx.territory;
      var action = ctx.action;
      if (action === "aerial_attack") {
        setCardplayPublicSpectator(
          "Played Wildcard. " + cur + " may use aerial attack this turn.",
          "Use during attack phase.",
          []
        );
        return;
      }
      var pre = playedCardPreamble(card, territory);
      var t = prettyCardTerritory(territory);
      var primary = "";
      var report = "";
      var labels = territory ? [territory] : [];
      if (action === "add_troops") {
        primary = cur + " plays " + t + " and adds two troops.";
        report =
          ctx.troopsAfter != null ? "Now " + ctx.troopsAfter + " troops on " + t + "." : "";
      } else if (action === "remove_troops") {
        primary = cur + " plays " + t + " and subtracts two troops.";
        report =
          (ctx.ownerName || "Defender") +
          (ctx.troopsAfter != null ? " now " + ctx.troopsAfter + " troops." : ".");
      } else if (action === "acquire") {
        primary = cur + " played and acquired " + t + ".";
        report = "Territory now held by " + cur + ".";
      } else if (action === "declined") {
        primary = pre + " Declined — " + t + " unchanged.";
        labels = [];
      } else if (action === "no_effect") {
        primary = pre + " No effect.";
        labels = [];
      } else {
        return;
      }
      setCardplayPublicSpectator(primary, report, labels);
    }

    /** True while a modal prompt is open in the compact HUD (not [hidden]). */
    function isCardplayLocalPromptVisible() {
      var el = document.getElementById("cardplay-local-prompt");
      return !!(el && !el.hasAttribute("hidden"));
    }

    /**
     * CONFIRM must not advance to income while the player is mid-play or a card dialog is open.
     * Otherwise handleNextPhase sees playedCards.length === 0 and calls proceedCardplayToIncome().
     */
    function cardplayConfirmShouldBeHeld() {
      if (processingBook) return true;
      if (isCardplayLocalPromptVisible()) return true;
      if (selectedCards.length > 0) return true;
      return false;
    }

    /** Stale recap from another player's turn (e.g. load/save) must not mix with this player's session. */
    function normalizeCardplayRecapForCurrentPlayer(gs) {
      if (!gs || window.risqueDisplayIsPublic) return;
      var cur = String(gs.currentPlayer || "");
      var recap = gs.risquePublicCardplayRecap;
      var pn = recap && recap.playerName != null ? String(recap.playerName) : "";
      if (pn && cur && pn !== cur) {
        delete gs.risqueCardplayTvRecapPublished;
        delete gs.risquePublicCardplayRecap;
        delete gs.risquePublicCardplayRecapAckRequiredSeq;
      }
    }

    function cardplayInit() {
      const uiOverlay = document.getElementById("ui-overlay");
      if (!uiOverlay) {
        logToStorage('UI overlay not found');
        window.gameUtils.showError("UI overlay not found");
        return;
      }
      const gameState = window.gameState;
      if (!gameState || !gameState.players || !gameState.currentPlayer) {
        logToStorage('Invalid game state');
        window.gameUtils.showError("Invalid game state. Redirecting to risque.");
        setTimeout(() => {
          var u = loginRecoveryUrl();
          if (window.risqueNavigateWithFade) window.risqueNavigateWithFade(u); else window.location.href = u;
        }, 2000);
        return;
      }
      normalizeAllPlayerCards(gameState);
      normalizeCardplayRecapForCurrentPlayer(gameState);
      gameState.risqueCardplaySuppressPublicSpectator = true;
      const currentPlayer = gameState.players.find(p => p.name === gameState.currentPlayer);
      if (!currentPlayer) {
        logToStorage('Current player not found');
        window.gameUtils.showError("Current player not found. Redirecting to risque.");
        setTimeout(() => {
          var u = loginRecoveryUrl();
          if (window.risqueNavigateWithFade) window.risqueNavigateWithFade(u); else window.location.href = u;
        }, 2000);
        return;
      }
      if (window.risqueDisplayIsPublic) {
        logToStorage("Cardplay public view: HUD + map; card play is host-only");
        const uiPub = document.getElementById("ui-overlay");
        if (typeof window.risqueDismissAttackPrompt === "function") {
          window.risqueDismissAttackPrompt();
        }
        if (uiPub && window.risqueRuntimeHud) {
          uiPub.className = "ui-overlay visible";
          uiPub.classList.remove("fade-out");
          window.risqueRuntimeHud.ensure(uiPub);
          window.risqueRuntimeHud.clearPhaseSlot();
          window.risqueRuntimeHud.setAttackChromeInteractive(false);
          window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
          var slotPub = document.getElementById("risque-phase-content");
          if (slotPub) {
            var handPub =
              typeof window.risquePublicFormatCardplaySpectatorHandLine === "function"
                ? window.risquePublicFormatCardplaySpectatorHandLine(gameState)
                : "";
            slotPub.innerHTML =
              '<div class="risque-public-private-hint" role="status">' +
              '<p class="risque-public-private-hint__lead">Card play is private — use the host screen to play cards.</p>' +
              '<p id="risque-public-cardplay-hand-count" class="risque-public-private-hint__count" aria-live="polite"></p>' +
              "</div>";
            var countPub = document.getElementById("risque-public-cardplay-hand-count");
            if (countPub) countPub.textContent = handPub || "";
          }
          requestAnimationFrame(function () {
            if (window.risqueRuntimeHud) window.risqueRuntimeHud.syncPosition();
          });
        }
        requestAnimationFrame(function () {
          window.gameUtils.resizeCanvas();
          window.gameUtils.initGameView();
          window.gameUtils.renderTerritories(null, window.gameState);
          window.gameUtils.renderStats(window.gameState);
        });
        return;
      }
      // Normalize current player cards too (safe duplicate pass).
      currentPlayer.cards = currentPlayer.cards.map(card => {
        if (typeof card === 'string') return { name: card, id: generateUUID() };
        if (card && card.name) return { name: card.name, id: card.id || generateUUID() };
        return null;
      }).filter(Boolean);
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
      if (!gameState.risqueSkipContinentSnapshotRefresh) {
        const continentsSnapshot = {};
        for (const [continent, data] of Object.entries(gameState.continents)) {
          if (Array.isArray(data.territories) && data.territories.every(t => typeof t === 'string' && currentPlayer.territories.some(pt => pt.name === t))) {
            continentsSnapshot[continent] = data.territories;
          }
        }
        gameState.continentsSnapshot = continentsSnapshot;
        logToStorage('Continent snapshot taken', { continentsSnapshot });
      } else {
        delete gameState.risqueSkipContinentSnapshotRefresh;
        logToStorage('Continent snapshot preserved (conquest elimination chain)', {
          continentsSnapshot: gameState.continentsSnapshot,
          pendingNewContinents: gameState.pendingNewContinents
        });
      }
      localStorage.setItem('gameState', JSON.stringify(gameState));
      initialGameState = JSON.parse(JSON.stringify(gameState));
      if (!window.risqueDisplayIsPublic) {
        captureCardplayPublicBoardSnapshot();
      }
      const playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
      const hasCards = currentPlayer.cardCount > 0;
      const unplayedCards = getUnplayedCards();
      const canFormBook = unplayedCards.length >= 3 && canFormValidBook(unplayedCards);
      const useHud = !!window.risqueRuntimeHud;
      let cardHtml = "";
      let cardHtmlCompact = "";
      if (hasCards) {
        unplayedCards.forEach((card, index) => {
          if (index < cardPositions.length && window.gameUtils.cardNames.includes(card.name) && card.id) {
            const pos = cardPositions[index];
            const alt = card.name.replace(/_/g, " ");
            if (useHud) {
              cardHtmlCompact +=
                '<img class="card cardplay-compact-card" src="assets/images/Cards/' +
                String(card.name || "").toUpperCase() +
                '.webp" data-card="' +
                card.name +
                '" data-id="' +
                card.id +
                '" alt="' +
                alt +
                ' card">';
            } else {
              cardHtml += `
              <img class="card" src="assets/images/Cards/${String(card.name || "").toUpperCase()}.webp" style="left: ${pos.x}px; top: ${pos.y}px; width: ${pos.width}px; height: ${pos.height}px;" data-card="${card.name}" data-id="${card.id}" alt="${alt} card">
            `;
            }
          }
        });
      }
      const handLine = hasCards ? `Cards: ${unplayedCards.map(c => c.name).join(", ")}` : "You have no cards, and that's OK";
      const hudHintInitial = hasCards
        ? "CARD or BOOK, then tap a card below."
        : "No cards in hand.";
      const cardplayBodyHtmlLegacy =
        '<div id="no-cards-message" class="cardplay-message">' +
        (hasCards ? `Cards in hand: ${unplayedCards.map(c => c.name).join(", ")}` : "You have no cards, and that's OK") +
        "</div>" +
        '<div id="summary-lines" class="cardplay-message"></div>' +
        '<div class="cardplay-button-container">' +
        '<button id="play-card-button" class="cardplay-button" ' +
        (!hasCards ? "disabled" : "") +
        ">CARD</button>" +
        '<button id="select-cards-button" class="cardplay-button" ' +
        (!canFormBook ? "disabled" : "") +
        ">SELECT CARDS FOR BOOK</button>" +
        '<button id="reset-button" class="cardplay-button" disabled>RESET</button>' +
        '<button id="next-phase-button" class="cardplay-button dissolve-in" ' +
        (hasCards && unplayedCards.length > 4 ? "disabled" : "") +
        ">CONFIRM</button>" +
        "</div>" +
        '<div class="cardplay-panel-confirm-row" role="group" aria-label="Confirm (duplicate control)">' +
        '<button type="button" id="cardplay-panel-confirm-btn" class="cardplay-panel-confirm-btn" ' +
        (hasCards && unplayedCards.length > 4 ? "disabled" : "") +
        ">CONFIRM</button>" +
        "</div>" +
        '<div id="cardplay-continue-income-wrap" class="cardplay-continue-income-wrap cardplay-continue-income-wrap--host" hidden>' +
        '<button type="button" id="cardplay-continue-income-btn" class="cardplay-button cardplay-continue-income-btn">Continue to Income</button>' +
        "</div>";
      const cardplayBodyHtmlHud =
        '<div class="cardplay-compact-root">' +
        '<div id="cardplay-local-prompt" class="cardplay-local-prompt" hidden>' +
        '<div id="cardplay-local-prompt-text" class="cardplay-local-prompt-text"></div>' +
        '<div id="cardplay-local-prompt-extras" class="cardplay-local-prompt-extras"></div>' +
        '<div id="cardplay-local-prompt-actions" class="cardplay-local-prompt-actions"></div>' +
        "</div>" +
        '<div id="cardplay-inline-error" class="cardplay-inline-error" role="status"></div>' +
        '<div id="cardplay-valid-book-reminder" class="cardplay-valid-book-reminder" role="status" aria-live="polite" hidden></div>' +
        '<div id="no-cards-message" class="cardplay-compact-msg cardplay-hud-hint" aria-live="polite">' +
        hudHintInitial +
        "</div>" +
        '<div class="cardplay-compact-toolbar">' +
        '<button type="button" id="play-card-button" class="cardplay-button cardplay-btn-compact" ' +
        (!hasCards ? "disabled" : "") +
        ">CARD</button>" +
        '<button type="button" id="select-cards-button" class="cardplay-button cardplay-btn-compact" ' +
        (!canFormBook ? "disabled" : "") +
        ">BOOK</button>" +
        '<button type="button" id="reset-button" class="cardplay-button cardplay-btn-compact" disabled>RST</button>' +
        '<button type="button" id="cardplay-skip-income-btn" class="cardplay-button cardplay-btn-compact" ' +
        (hasCards && unplayedCards.length > 4 ? "disabled " : "") +
        'title="Skip to income (no recap gate)">SKIP</button>' +
        '<button type="button" id="next-phase-button" class="cardplay-button cardplay-btn-compact dissolve-in" ' +
        (hasCards && unplayedCards.length > 4 ? "disabled" : "") +
        ">CONFIRM</button>" +
        "</div>" +
        '<div class="cardplay-panel-confirm-row" role="group" aria-label="Confirm (duplicate control)">' +
        '<button type="button" id="cardplay-panel-confirm-btn" class="cardplay-panel-confirm-btn" ' +
        (hasCards && unplayedCards.length > 4 ? "disabled" : "") +
        ">CONFIRM</button>" +
        "</div>" +
        '<div id="cardplay-card-grid" class="cardplay-card-row"></div>' +
        '<div id="cardplay-continue-income-wrap" class="cardplay-continue-income-wrap cardplay-continue-income-wrap--host" hidden>' +
        '<button type="button" id="cardplay-continue-income-btn" class="cardplay-button cardplay-btn-compact cardplay-continue-income-btn">Continue to Income</button>' +
        "</div>" +
        "</div>";
      const cardplayBodyHtml = useHud ? cardplayBodyHtmlHud : cardplayBodyHtmlLegacy;
      if (window.risqueRuntimeHud) {
        if (typeof window.risqueDismissAttackPrompt === "function") {
          window.risqueDismissAttackPrompt();
        }
        window.risqueRuntimeHud.ensure(uiOverlay);
        window.risqueRuntimeHud.clearPhaseSlot();
        window.risqueRuntimeHud.setAttackChromeInteractive(false);
        window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        const slot = document.getElementById("risque-phase-content");
        if (slot) {
          slot.innerHTML = cardplayBodyHtml;
          const grid = document.getElementById("cardplay-card-grid");
          if (grid && cardHtmlCompact) grid.innerHTML = cardHtmlCompact;
        }
        var rhRoot = document.getElementById("runtime-hud-root");
        /* Panel-only layout: hide HUD stats + full control panel (dice/voice/slots/log); card UI lives in #risque-phase-content. */
        if (rhRoot) rhRoot.classList.add("runtime-hud-root--cardplay-panel-only");
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud) window.risqueRuntimeHud.syncPosition();
        });
      } else {
        uiOverlay.innerHTML =
          '<div class="cardplay-player-name" style="color: ' +
          playerColor +
          '">' +
          currentPlayer.name +
          "'s Card Play</div>" +
          cardplayBodyHtmlLegacy +
          cardHtml;
        var rhLegacy = document.getElementById("runtime-hud-root");
        if (rhLegacy) rhLegacy.classList.add("runtime-hud-root--cardplay-panel-only");
      }
      const buttons = [
        { id: "play-card-button", enabled: hasCards, handler: handlePlayCard },
        { id: "select-cards-button", enabled: canFormBook, handler: handleSelectCards },
        { id: "reset-button", enabled: false, handler: handleReset },
        { id: "next-phase-button", enabled: false, handler: handleNextPhase },
        { id: "cardplay-panel-confirm-btn", enabled: false, handler: handleNextPhase }
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
        } else if (button.id !== "cardplay-panel-confirm-btn") {
          logToStorage(`Button ${button.id} not found`);
          window.gameUtils.showError(`Button ${button.id} not found`);
        }
      });
      var skipIncBtn = document.getElementById("cardplay-skip-income-btn");
      if (skipIncBtn) {
        skipIncBtn.addEventListener("click", handleSkipCardplayToIncome);
      }
      if (hasCards) {
        if (useHud) {
          const g = document.getElementById('cardplay-card-grid');
          wireCardplayCardClicks(g);
        } else {
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
      }
      updateSummaryDisplay();
      checkCardStatus();
      /* Host: draw the map in the same turn as the HUD slot swap — deferring to rAF left one frame with
       * missing markers/stats while the public tab (mirror poll) stayed smooth. */
      try {
        window.gameUtils.resizeCanvas();
        window.gameUtils.initGameView();
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
      } catch (eMap0) {
        logToStorage("cardplayInit map render error: " + (eMap0 && eMap0.message ? eMap0.message : String(eMap0)));
      }
      requestAnimationFrame(function () {
        var svgOverlay = document.querySelector(".svg-overlay");
        logToStorage("Rendering markers, numbers, and stats", {
          svgContent: svgOverlay ? svgOverlay.innerHTML : "No SVG overlay"
        });
      });
      if (currentPlayer.cardCount > 4) {
        setCardplayError(`You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`);
      }
      localStorage.setItem('gameState', JSON.stringify(gameState));
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      refreshCardplayPublicHandCountMirror();
    }
    function getUnplayedCards() {
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (!currentPlayer) return [];
      const playedCardNames = playedCards.flatMap(pc => pc.cards || []);
      return currentPlayer.cards.filter(card => !playedCardNames.some(pc => pc.id === card.id));
    }

    function isCardplayHudCompact() {
      return !!document.querySelector('.cardplay-compact-root');
    }

    function refreshCardplayHudHint() {
      const noCardsMessage = document.getElementById('no-cards-message');
      if (!noCardsMessage || !isCardplayHudCompact()) return;
      const unplayedCards = getUnplayedCards();
      if (unplayedCards.length === 0) {
        noCardsMessage.textContent = 'No cards in hand.';
        return;
      }
      if (isBookSelectionMode) {
        noCardsMessage.textContent =
          selectedCards.length >= 3 ? 'Processing book…' : `Select ${3 - selectedCards.length} more card(s) for BOOK.`;
        return;
      }
      if (isIndividualSelectionMode) {
        noCardsMessage.textContent = 'Tap one card to play, or RST to cancel.';
        return;
      }
      noCardsMessage.textContent = 'CARD (one card) or BOOK (three cards), then tap below.';
    }

    function wireCardplayCardClicks(root) {
      if (!root) return;
      root.querySelectorAll('.card').forEach(function (card) {
        card.addEventListener('click', function () {
          toggleCardSelection(card);
        });
        card.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          unPlayCard(card);
        });
      });
    }

    function rebuildCardplayCompactHand() {
      const grid = document.getElementById('cardplay-card-grid');
      if (!grid || !window.gameState || !window.gameUtils) return;
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (!currentPlayer) return;
      const playedIds = new Set();
      playedCards.forEach(function (pc) {
        (pc.cards || []).forEach(function (c) {
          if (c && c.id) playedIds.add(c.id);
        });
      });
      const unplayed = (currentPlayer.cards || []).filter(function (c) {
        return c && c.id && !playedIds.has(c.id);
      });
      let html = '';
      unplayed.forEach(function (card, index) {
        if (index < cardPositions.length && window.gameUtils.cardNames.includes(card.name) && card.id) {
          const alt = card.name.replace(/_/g, ' ');
          html +=
            '<img class="card cardplay-compact-card" src="assets/images/Cards/' +
            String(card.name || "").toUpperCase() +
            '.webp" data-card="' +
            card.name +
            '" data-id="' +
            card.id +
            '" alt="' +
            alt +
            ' card">';
        }
      });
      grid.innerHTML = html;
      wireCardplayCardClicks(grid);
      refreshValidBookReminder();
    }

    function undoIndividualCardPromptAndReturn() {
      isIndividualSelectionMode = true;
      selectedCards = [];
      document.querySelectorAll('.card').forEach(function (c) {
        c.classList.remove('selected');
      });
      refreshCardplayHudHint();
      checkCardStatus();
    }

    function canFormValidBook(cards) {
      return window.gameUtils.canFormValidRisqueBook(cards);
    }

    /** Nudge host when the current unplayed hand contains at least one cashable three-card set. */
    function refreshValidBookReminder() {
      var el = document.getElementById("cardplay-valid-book-reminder");
      if (!el) return;
      if (window.__risqueCardplayHostIncomeOnly) {
        el.textContent = "";
        el.setAttribute("hidden", "");
        return;
      }
      if (processingBook) {
        el.textContent = "";
        el.setAttribute("hidden", "");
        return;
      }
      if (isBookSelectionMode) {
        el.textContent = "";
        el.setAttribute("hidden", "");
        return;
      }
      var unplayed = getUnplayedCards();
      var canBook = unplayed.length >= 3 && canFormValidBook(unplayed);
      if (canBook) {
        el.textContent = "Your hand includes a valid book.";
        el.removeAttribute("hidden");
      } else {
        el.textContent = "";
        el.setAttribute("hidden", "");
      }
    }

    function willEliminatePlayer(owner, territory) {
      if (!owner) return false;
      const remainingTerritories = owner.territories.filter(t => t.name !== territory);
      return remainingTerritories.length === 0 && owner.troopsTotal <= (owner.territories.find(t => t.name === territory)?.troops || 0);
    }
    async function toggleCardSelection(img) {
      const cardName = img.dataset.card;
      const cardId = img.dataset.id;
      if (!cardplayStatusEl()) {
        logToStorage('Error element not found');
        return;
      }
      if (!isBookSelectionMode && !isIndividualSelectionMode) {
        // Make single-card play the default so card clicks always work.
        isIndividualSelectionMode = true;
        isBookSelectionMode = false;
        selectedCards = [];
        document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
        if (isCardplayHudCompact()) {
          setCardplayError('');
        } else {
          setCardplayError('Select a card');
        }
      }
      if (img.classList.contains('played')) {
        setCardplayError('Card has been played');
        return;
      }
      if (img.classList.contains('selected')) {
        img.classList.remove('selected');
        selectedCards = selectedCards.filter(c => c.id !== cardId);
        setCardplayError('');
        updateSummaryDisplay();
        checkCardStatus();
        return;
      }
      if (isBookSelectionMode && selectedCards.length >= 3) {
        if (isCardplayHudCompact()) {
          setCardplayError('');
          refreshCardplayHudHint();
        } else {
          setCardplayError('Select exactly 3 cards');
        }
        return;
      }
      if (isIndividualSelectionMode && selectedCards.length >= 1) {
        if (isCardplayHudCompact()) {
          setCardplayError('');
          refreshCardplayHudHint();
        } else {
          setCardplayError('Select exactly 1 card');
        }
        return;
      }
      img.classList.add('selected');
      selectedCards.push({ card: cardName, id: cardId });
      logToStorage('Card selected', { card: cardName, id: cardId });
      setCardplayError('');
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
      playedCards.splice(playedCardIndex, 1);
      summaryMessages.splice(playedCardIndex, 1);
      loadCards();
      updateSummaryDisplay();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      clearCardplayPublicSpectator();
      logToStorage('Card unplayed', { card: cardName, id: cardId });
      checkCardStatus();
    }
    async function validateAndProcessBook() {
      if (!cardplayStatusEl()) {
        logToStorage('Error element not found');
        return;
      }
      const cardNames = selectedCards.map(sc => sc.card);
      if (!validateBook(cardNames)) {
        setCardplayError(
          "Warning: Not a valid set. You need 3 matching unit types (infantry, cavalry, or artillery), or one of each type. Wildcards count as any."
        );
        isBookSelectionMode = true;
        selectedCards = [];
        document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
        checkCardStatus();
        refreshCardplayHudHint();
        return;
      }
      const action = await showPopup('Book complete. Process cards.', null, false, false, 'continueOnly');
      if (!action) {
        setCardplayError('Book cancelled');
        isBookSelectionMode = false;
        selectedCards = [];
        document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
        checkCardStatus();
        return;
      }
      setCardplayError('');
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
        setCardplayError(
          `Warning: Removed ${originalCardCount - currentPlayer.cards.length} cards instead of 3. Continuing.`
        );
      }
      window.gameState.bookPlayedThisTurn = true;
      currentPlayer.bookValue = (currentPlayer.bookValue || 0) + 1;
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      logToStorage('Book selected, processing effects', { cards: cardNames, cardCount: currentPlayer.cardCount, bookValue: currentPlayer.bookValue });
      updateSummaryDisplay();
      await processBookCardEffect(bookPlayedCard);
    }
    async function processBookCardEffect(bookPlayedCard) {
      if (currentBookCardIndex >= selectedCards.length) {
        processingBook = false;
        currentBookCardIndex = -1;
        document.querySelectorAll('.card').forEach(card => card.classList.remove('processing'));
        const effectMessages = bookPlayedCard.effects.map(effect => {
          if (!effect.territory) {
            logToStorage('Effect missing territory', { effect });
            return `Effect: Invalid (missing territory)`;
          }
          if (effect.action === 'add_troops') {
            return `${effect.territory.toUpperCase()}: +2 troops (${
              window.gameState.players.find(p => p.name === window.gameState.currentPlayer)?.territories.find(t => t.name === effect.territory)?.troops.toString().padStart(3, '0') || '000'
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
          setCardplayError(`Book processed. Select another book or tap CONFIRM when ready. (${unplayedCards.length} cards left)`);
          isBookSelectionMode = true;
        } else if (currentPlayer.cardCount > 4) {
          setCardplayError(`You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`);
        } else {
          setCardplayError('Book processed. Play more cards or tap CONFIRM when ready.');
        }
        loadCards();
        checkCardStatus();
        return;
      }
      wipeCardplayPublicMapHighlight();
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
        if (window.isResetting) return;
        if (!territory || !window.gameUtils.cardNames.includes(territory.toLowerCase())) {
          bookPlayedCard.effects.push({ territory: card, action: 'declined', cardId });
          updateSummaryDisplay();
          setCardplayPublicSpectator(
            "Book — Wildcard territory choice declined.",
            "",
            []
          );
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
        action = await showPopup(message, null, true, false, 'yesDecline');
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
            announceCardplayEffect({
              card: card,
              territory: territory,
              action: "add_troops",
              currentName: currentPlayer.name,
              troopsAfter: territoryObj.troops
            });
          }
        } else {
          effect.action = 'declined';
          announceCardplayEffect({
            card: card,
            territory: territory,
            action: "declined",
            currentName: currentPlayer.name
          });
        }
      } else {
        const owner = window.gameState.players.find(p => p.territories.some(t => t.name === territory));
        if (!owner) {
          effect.action = 'no_effect';
          announceCardplayEffect({
            card: card,
            territory: territory,
            action: "no_effect",
            currentName: currentPlayer.name
          });
        } else {
          const troops = owner.territories.find(t => t.name === territory)?.troops || 1;
          if (troops > 2) {
            message = `Remove 2 troops from ${territory.toUpperCase()}?`;
            action = await showPopup(message, null, true, false, 'yesDecline');
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
                announceCardplayEffect({
                  card: card,
                  territory: territory,
                  action: "remove_troops",
                  currentName: currentPlayer.name,
                  ownerName: owner.name,
                  troopsAfter: territoryObj.troops
                });
              }
            } else {
              effect.action = 'declined';
              announceCardplayEffect({
                card: card,
                territory: territory,
                action: "declined",
                currentName: currentPlayer.name
              });
            }
          } else {
            message = `Acquire ${territory.toUpperCase()}?`;
            action = await showPopup(message, null, true, false, 'yesDecline');
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
                  selectedCards = [];
                  document.querySelectorAll('.card').forEach(function (c) {
                    c.classList.remove('selected');
                  });
                  showPopup(`Acquiring ${territory.toUpperCase()} will eliminate ${owner.name}. Tap CONFIRM to proceed.`, null, false, true);
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
                announceCardplayEffect({
                  card: card,
                  territory: territory,
                  action: "acquire",
                  currentName: currentPlayer.name
                });
              }
            } else {
              effect.action = 'declined';
              announceCardplayEffect({
                card: card,
                territory: territory,
                action: "declined",
                currentName: currentPlayer.name
              });
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
      wipeCardplayPublicMapHighlight();
      isIndividualSelectionMode = false;
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      let playedCardData = { cards: [{ card, id: cardId }], action: '', confirmed: false, territory };
      if (['wildcard1', 'wildcard2'].includes(card)) {
        playedCardData.territory = territory;
      } else {
        playedCardData.territory = card;
      }
      const isOwned = currentPlayer.territories.some(t => t.name === playedCardData.territory);
      let message = '';
      let action = false;
      if (isOwned) {
        message = `Add 2 troops to ${playedCardData.territory.toUpperCase()}?`;
        action = await showPopup(message, null, true, false, 'yesDeclineBack');
        if (window.isResetting) return;
        if (action === null) {
          undoIndividualCardPromptAndReturn();
          return;
        }
        if (action) {
          const territoryObj = currentPlayer.territories.find(t => t.name === playedCardData.territory);
          if (territoryObj) {
            territoryObj.troops = (territoryObj.troops || 1) + 2;
            currentPlayer.troopsTotal += 2;
            playedCardData.action = 'add_troops';
            localStorage.setItem('gameState', JSON.stringify(window.gameState));
            window.gameUtils.renderTerritories(playedCardData.territory, window.gameState);
            logToStorage('Added troops to owned territory', { territory: playedCardData.territory, troops: territoryObj.troops });
            announceCardplayEffect({
              card: card,
              territory: playedCardData.territory,
              action: "add_troops",
              currentName: currentPlayer.name,
              troopsAfter: territoryObj.troops
            });
          }
        } else {
          playedCardData.action = 'declined';
          announceCardplayEffect({
            card: card,
            territory: playedCardData.territory,
            action: "declined",
            currentName: currentPlayer.name
          });
        }
      } else {
        const owner = window.gameState.players.find(p => p.territories.some(t => t.name === playedCardData.territory));
        if (!owner) {
          playedCardData.action = 'no_effect';
          announceCardplayEffect({
            card: card,
            territory: playedCardData.territory,
            action: "no_effect",
            currentName: currentPlayer.name
          });
        } else {
          const troops = owner.territories.find(t => t.name === playedCardData.territory)?.troops || 1;
          if (troops > 2) {
            message = `Remove 2 troops from ${playedCardData.territory.toUpperCase()}?`;
            action = await showPopup(message, null, true, false, 'yesDeclineBack');
            if (window.isResetting) return;
            if (action === null) {
              undoIndividualCardPromptAndReturn();
              return;
            }
            if (action) {
              const territoryObj = owner.territories.find(t => t.name === playedCardData.territory);
              if (territoryObj) {
                territoryObj.troops -= 2;
                owner.troopsTotal -= 2;
                playedCardData.action = 'remove_troops';
                playedCardData.owner = owner.name;
                localStorage.setItem('gameState', JSON.stringify(window.gameState));
                window.gameUtils.renderTerritories(playedCardData.territory, window.gameState);
                logToStorage('Removed troops from enemy territory', { territory: playedCardData.territory, owner: owner.name, troops: territoryObj.troops });
                announceCardplayEffect({
                  card: card,
                  territory: playedCardData.territory,
                  action: "remove_troops",
                  currentName: currentPlayer.name,
                  ownerName: owner.name,
                  troopsAfter: territoryObj.troops
                });
              }
            } else {
              playedCardData.action = 'declined';
              announceCardplayEffect({
                card: card,
                territory: playedCardData.territory,
                action: "declined",
                currentName: currentPlayer.name
              });
            }
          } else {
            message = `Acquire ${playedCardData.territory.toUpperCase()}?`;
            action = await showPopup(message, null, true, false, 'yesDeclineBack');
            if (window.isResetting) return;
            if (action === null) {
              undoIndividualCardPromptAndReturn();
              return;
            }
            if (action) {
              const ownerTerritory = owner.territories.find(t => t.name === playedCardData.territory);
              if (ownerTerritory) {
                if (willEliminatePlayer(owner, playedCardData.territory)) {
                  pendingElimination = {
                    type: 'individual',
                    playedCardData,
                    territory: playedCardData.territory,
                    owner: owner.name,
                    ownerTerritory,
                    card,
                    cardId
                  };
                  playedCards.push(playedCardData);
                  currentPlayer.cards = currentPlayer.cards.filter(c => c.id !== cardId);
                  currentPlayer.cardCount = currentPlayer.cards.length;
                  selectedCards = [];
                  document.querySelectorAll('.card').forEach(function (c) {
                    c.classList.remove('selected');
                  });
                  showPopup(`Acquiring ${playedCardData.territory.toUpperCase()} will eliminate ${owner.name}. Tap CONFIRM to proceed.`, null, false, true);
                  return;
                }
                owner.territories = owner.territories.filter(t => t.name !== playedCardData.territory);
                owner.troopsTotal -= ownerTerritory.troops;
                currentPlayer.territories.push({ name: playedCardData.territory, troops: 1 });
                currentPlayer.troopsTotal += 1;
                playedCardData.action = 'acquire';
                playedCardData.owner = owner.name;
                playedCardData.troops = ownerTerritory.troops;
                localStorage.setItem('gameState', JSON.stringify(window.gameState));
                window.gameUtils.renderTerritories(playedCardData.territory, window.gameState);
                logToStorage('Territory acquired', { territory: playedCardData.territory, from: owner.name, to: currentPlayer.name });
                announceCardplayEffect({
                  card: card,
                  territory: playedCardData.territory,
                  action: "acquire",
                  currentName: currentPlayer.name
                });
              }
            } else {
              playedCardData.action = 'declined';
              announceCardplayEffect({
                card: card,
                territory: playedCardData.territory,
                action: "declined",
                currentName: currentPlayer.name
              });
            }
          }
        }
      }
      playedCards.push(playedCardData);
      summaryMessages.push(playedCardData.action === 'add_troops' ? `${playedCardData.territory}: +2 troops (${currentPlayer.territories.find(t => t.name === playedCardData.territory)?.troops.toString().padStart(3, '0') || '000'}) - Pending` :
        playedCardData.action === 'remove_troops' ? `${playedCardData.territory}: ${playedCardData.owner} lost 2 troops (${window.gameState.players.find(p => p.name === playedCardData.owner)?.territories.find(t => t.name === playedCardData.territory)?.troops.toString().padStart(3, '0') || '000'} remaining) - Pending` :
        playedCardData.action === 'acquire' ? `${playedCardData.territory}: Acquired by ${currentPlayer.name} (001) - Pending` :
        playedCardData.action === 'declined' ? `${playedCardData.territory}: Declined - Pending` :
        `${playedCardData.territory}: No effect - Pending`);
      removeCardFromHand(currentPlayer, cardId, card);
      const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
      if (cardElement) {
        cardElement.classList.add('played');
      }
      updateSummaryDisplay();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      logToStorage('Individual card effect processed', { card, territory: playedCardData.territory, action: playedCardData.action });
      selectedCards = [];
      document.querySelectorAll('.card').forEach(function (c) {
        c.classList.remove('selected');
      });
      checkCardStatus();
    }
    async function processWildcardCard(card, cardId) {
      const options = [
        { value: 'territory', text: '1) Territory Card' },
        { value: 'aerial', text: '2) Aerial Attack' }
      ];
      const action = await showPopup('Use wildcard as:', options);
      selectedCards = [];
      document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
      if (!action) {
        if (window.isResetting) return;
        setCardplayError('Wildcard action declined');
        playedCards.push({ cards: [{ card, id: cardId }], action: 'declined', confirmed: false });
        summaryMessages.push('Wildcard: Declined - Pending');
        updateSummaryDisplay();
        setCardplayPublicSpectator("Played Wildcard. Action declined.", "", []);
        checkCardStatus();
        return;
      }
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (action === 'territory') {
        const territoryOptions = window.gameUtils.cardNames
          .filter(name => !['wildcard1', 'wildcard2'].includes(name))
          .map(name => ({ value: name, text: name.toUpperCase() }));
        const territory = await showPopup('Assign wildcard to a territory:', territoryOptions);
        if (!territory || !window.gameUtils.cardNames.includes(territory.toLowerCase())) {
          if (window.isResetting) return;
          setCardplayError('Invalid territory selected');
          playedCards.push({ cards: [{ card, id: cardId }], action: 'declined', confirmed: false });
          summaryMessages.push('Wildcard: Territory selection declined - Pending');
          updateSummaryDisplay();
          setCardplayPublicSpectator("Wildcard — territory choice declined.", "", []);
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
        const playedCardData = { cards: [{ card, id: cardId }], action: 'aerial_attack', confirmed: false };
        playedCards.push(playedCardData);
        removeCardFromHand(currentPlayer, cardId, card);
        const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
        if (cardElement) {
          cardElement.classList.add('played');
        }
        summaryMessages.push(`${String(card).toUpperCase()}: Aerial Attack enabled - Pending`);
        updateSummaryDisplay();
        localStorage.setItem('gameState', JSON.stringify(window.gameState));
        announceCardplayEffect({
          card: card,
          territory: "",
          action: "aerial_attack",
          currentName: currentPlayer.name
        });
        logToStorage('Wildcard used for aerial attack', { card, id: cardId });
        checkCardStatus();
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
    function updateSummaryDisplay() {
      const summaryLines = document.getElementById('summary-lines');
      if (summaryLines) {
        summaryLines.textContent = summaryMessages.join('\n');
      }
    }
    function loadCards() {
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      const unplayedCards = getUnplayedCards();
      const cardElements = document.querySelectorAll('.card');
      cardElements.forEach(card => {
        const cardId = card.dataset.id;
        if (!unplayedCards.some(c => c.id === cardId)) {
          card.classList.add('played');
        } else {
          card.classList.remove('played');
        }
      });
      const noCardsMessage = document.getElementById('no-cards-message');
      if (noCardsMessage) {
        if (isCardplayHudCompact()) {
          refreshCardplayHudHint();
        } else {
          noCardsMessage.textContent =
            unplayedCards.length > 0
              ? `Cards in hand: ${unplayedCards.map(c => c.name).join(', ')}`
              : "You have no cards, and that's OK";
        }
      }
      refreshValidBookReminder();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
    }
    function checkCardStatus() {
      if (window.__risqueCardplayHostIncomeOnly) {
        refreshHostIncomeGateUi();
        return;
      }
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      const unplayedCards = getUnplayedCards();
      const canFormBook = unplayedCards.length >= 3 && canFormValidBook(unplayedCards);
      const hasUnconfirmedActions = playedCards.some(pc => !pc.confirmed);
      const hasCardActions = playedCards.length > 0;
      const playCardButton = document.getElementById('play-card-button');
      const selectCardsButton = document.getElementById('select-cards-button');
      const resetButton = document.getElementById('reset-button');
      const nextPhaseButton = document.getElementById('next-phase-button');
      if (playCardButton) {
        playCardButton.disabled = !unplayedCards.length;
        playCardButton.classList.toggle('enabled', !!unplayedCards.length);
      }
      if (selectCardsButton) {
        selectCardsButton.disabled = !canFormBook;
        selectCardsButton.classList.toggle('enabled', canFormBook);
      }
      if (resetButton) {
        resetButton.disabled = !(selectedCards.length > 0 || playedCards.length > 0);
        resetButton.classList.toggle('enabled', selectedCards.length > 0 || playedCards.length > 0);
      }
      var holdConfirm = cardplayConfirmShouldBeHeld();
      if (nextPhaseButton) {
        var nextOk = hasCardActions && unplayedCards.length <= 4 && !holdConfirm;
        nextPhaseButton.disabled = !nextOk;
        nextPhaseButton.classList.toggle('enabled', nextOk);
      }
      var panelConfirmBtn = document.getElementById("cardplay-panel-confirm-btn");
      if (panelConfirmBtn && nextPhaseButton) {
        panelConfirmBtn.disabled = nextPhaseButton.disabled;
        panelConfirmBtn.classList.toggle("enabled", nextPhaseButton.classList.contains("enabled"));
      }
      var skipIncBtn = document.getElementById("cardplay-skip-income-btn");
      if (skipIncBtn) {
        var skipOk =
          unplayedCards.length <= 4 && !holdConfirm && !hasUnconfirmedActions;
        skipIncBtn.disabled = !skipOk;
        skipIncBtn.classList.toggle("enabled", skipOk);
        skipIncBtn.title = skipOk
          ? "Skip to income (no recap gate)"
          : unplayedCards.length > 4
            ? "Play or trade down to 4 or fewer cards before skipping."
            : hasUnconfirmedActions
              ? "Confirm or reset your card play before skipping."
              : "Finish the on-screen prompt before skipping.";
      }
      updateCardplayTvGateVisibility();
      if (currentPlayer.cardCount > 4) {
        var errOver = cardplayStatusEl();
        var keepInvalidBookOver =
          errOver &&
          /not a valid set|invalid book/i.test(String(errOver.textContent || ""));
        if (!keepInvalidBookOver) {
          setCardplayError(`You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`);
        }
      } else if (
        window.gameState.risquePublicCardplayRecapAckRequiredSeq != null &&
        !cardplayRecapAckSatisfied()
      ) {
        setCardplayError("");
      } else if (!hasUnconfirmedActions && unplayedCards.length <= 4) {
        var errEl = cardplayStatusEl();
        var keepWarn =
          errEl &&
          /not a valid set|invalid book/i.test(String(errEl.textContent || ""));
        if (!keepWarn) {
          setCardplayError("");
        }
      }
      refreshCardplayHudHint();
      refreshValidBookReminder();
      refreshCardplayPublicHandCountMirror();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
    }

    function clearCardplayLocalPrompt() {
      const host = document.getElementById('cardplay-local-prompt');
      const t = document.getElementById('cardplay-local-prompt-text');
      const ex = document.getElementById('cardplay-local-prompt-extras');
      const ac = document.getElementById('cardplay-local-prompt-actions');
      if (t) t.textContent = '';
      if (ex) ex.innerHTML = '';
      if (ac) ac.innerHTML = '';
      if (host) host.setAttribute('hidden', '');
    }

    function showCardplayLocalPopup(message, options, showCancel, isConfirm, dialogKind) {
      dialogKind = dialogKind || 'default';
      return new Promise(function (resolve) {
        const host = document.getElementById('cardplay-local-prompt');
        const textEl = document.getElementById('cardplay-local-prompt-text');
        const extras = document.getElementById('cardplay-local-prompt-extras');
        const actions = document.getElementById('cardplay-local-prompt-actions');
        if (!host || !textEl || !extras || !actions) {
          resolve(false);
          return;
        }
        function finish(val) {
          clearCardplayLocalPrompt();
          try {
            checkCardStatus();
          } catch (eFin) {}
          resolve(val);
        }
        textEl.textContent = message || '';
        extras.innerHTML = '';
        actions.innerHTML = '';
        if (options && Array.isArray(options)) {
          const sel = document.createElement('select');
          sel.id = 'cardplay-local-select';
          sel.className = 'cardplay-local-select';
          options.forEach(function (opt) {
            const o = document.createElement('option');
            o.value = String(opt.value);
            o.textContent = opt.text != null ? opt.text : String(opt.label != null ? opt.label : opt.value);
            sel.appendChild(o);
          });
          extras.appendChild(sel);
          const okBtn = document.createElement('button');
          okBtn.type = 'button';
          okBtn.className = 'cardplay-local-btn';
          okBtn.textContent = 'OK';
          okBtn.addEventListener('click', function () {
            const s = document.getElementById('cardplay-local-select');
            finish(s ? s.value : true);
          });
          actions.appendChild(okBtn);
          if (showCancel) {
            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'cardplay-local-btn cardplay-local-btn--secondary';
            cancelBtn.textContent = 'Cancel';
            cancelBtn.addEventListener('click', function () {
              finish(false);
            });
            actions.appendChild(cancelBtn);
          }
          host.removeAttribute('hidden');
          try {
            checkCardStatus();
          } catch (ePrompt) {}
          try {
            okBtn.focus();
          } catch (eSel) {
            /* ignore */
          }
          return;
        }
        if (isConfirm) {
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.id = 'cardplay-local-num';
          inp.className = 'cardplay-local-num';
          inp.min = '0';
          inp.value = '0';
          extras.appendChild(inp);
          const okNum = document.createElement('button');
          okNum.type = 'button';
          okNum.className = 'cardplay-local-btn';
          okNum.textContent = 'OK';
          okNum.addEventListener('click', function () {
            const n = document.getElementById('cardplay-local-num');
            const v = n ? parseInt(n.value, 10) : 0;
            finish(Number.isFinite(v) ? v : 0);
          });
          actions.appendChild(okNum);
          host.removeAttribute('hidden');
          try {
            checkCardStatus();
          } catch (ePrompt) {}
          try {
            okNum.focus();
          } catch (eNum) {
            /* ignore */
          }
          return;
        }
        if (dialogKind === 'continueOnly') {
          const contBtn = document.createElement('button');
          contBtn.type = 'button';
          contBtn.className = 'cardplay-local-btn';
          contBtn.textContent = 'Continue';
          contBtn.addEventListener('click', function () {
            finish(true);
          });
          actions.appendChild(contBtn);
          host.removeAttribute('hidden');
          try {
            checkCardStatus();
          } catch (ePrompt) {}
          try {
            contBtn.focus();
          } catch (eCont) {
            /* ignore */
          }
          return;
        }
        if (dialogKind === 'yesDecline' || dialogKind === 'yesDeclineBack') {
          const yesBtn = document.createElement('button');
          yesBtn.type = 'button';
          yesBtn.className = 'cardplay-local-btn';
          yesBtn.textContent = 'Yes';
          yesBtn.addEventListener('click', function () {
            finish(true);
          });
          actions.appendChild(yesBtn);
          const declBtn = document.createElement('button');
          declBtn.type = 'button';
          declBtn.className = 'cardplay-local-btn cardplay-local-btn--secondary';
          declBtn.textContent = 'Decline';
          declBtn.addEventListener('click', function () {
            finish(false);
          });
          actions.appendChild(declBtn);
          if (dialogKind === 'yesDeclineBack') {
            const backBtn = document.createElement('button');
            backBtn.type = 'button';
            backBtn.className = 'cardplay-local-btn cardplay-local-btn--tertiary';
            backBtn.textContent = 'Back';
            backBtn.addEventListener('click', function () {
              finish(null);
            });
            actions.appendChild(backBtn);
          }
          host.removeAttribute('hidden');
          try {
            checkCardStatus();
          } catch (ePrompt) {}
          try {
            yesBtn.focus();
          } catch (eY) {
            /* ignore */
          }
          return;
        }
        const okBtn2 = document.createElement('button');
        okBtn2.type = 'button';
        okBtn2.className = 'cardplay-local-btn';
        okBtn2.textContent = 'OK';
        okBtn2.addEventListener('click', function () {
          finish(true);
        });
        actions.appendChild(okBtn2);
        if (showCancel) {
          const cancelBtn2 = document.createElement('button');
          cancelBtn2.type = 'button';
          cancelBtn2.className = 'cardplay-local-btn cardplay-local-btn--secondary';
          cancelBtn2.textContent = 'Cancel';
          cancelBtn2.addEventListener('click', function () {
            finish(false);
          });
          actions.appendChild(cancelBtn2);
        }
        host.removeAttribute('hidden');
        try {
          checkCardStatus();
        } catch (ePrompt) {}
        try {
          okBtn2.focus();
        } catch (eOk) {
          /* ignore */
        }
      });
    }

    async function showPopup(message, options = null, showCancel = true, isConfirm = false, dialogKind = 'default') {
      if (isCardplayHudCompact()) {
        if (typeof window.risqueDismissAttackPrompt === 'function') {
          window.risqueDismissAttackPrompt();
        }
        return showCardplayLocalPopup(message, options, showCancel, isConfirm, dialogKind);
      }
      const voiceText = document.getElementById("control-voice-text");
      const useVoice = !!(
        voiceText &&
        typeof window.risqueSharedShowPrompt === "function" &&
        typeof window.risqueDismissAttackPrompt === "function"
      );
      return new Promise(resolve => {
        const finish = function (val) {
          if (useVoice) window.risqueDismissAttackPrompt();
          resolve(val);
        };
        if (useVoice) {
          if (dialogKind === "continueOnly") {
            window.risqueSharedShowPrompt(message, [{ label: "Continue", onClick: function () { finish(true); } }]);
            return;
          }
          if (options && Array.isArray(options)) {
            const choices = options.map(function (o) {
              return {
                value: o.value,
                label: o.text != null ? o.text : o.label != null ? o.label : String(o.value),
                text: o.text
              };
            });
            const optRow = [
              {
                label: "OK",
                onClick: function () {
                  const sel = document.getElementById("cardplay-voice-select");
                  finish(sel ? sel.value : true);
                }
              }
            ];
            if (showCancel) optRow.push({ label: "Cancel", onClick: function () { finish(false); } });
            window.risqueSharedShowPrompt(message, optRow, { promptSelect: { choices: choices } });
          } else if (isConfirm) {
            window.risqueSharedShowPrompt(
              message,
              [
                {
                  label: "OK",
                  onClick: function () {
                    const inp = document.getElementById("cardplay-voice-num");
                    const n = inp ? parseInt(inp.value, 10) : 0;
                    finish(Number.isFinite(n) ? n : 0);
                  }
                }
              ],
              { promptNumber: { min: 0, value: 0 } }
            );
          } else {
            const row = [{ label: "OK", onClick: function () { finish(true); } }];
            if (showCancel) row.push({ label: "Cancel", onClick: function () { finish(false); } });
            window.risqueSharedShowPrompt(message, row);
          }
          return;
        }
        if (dialogKind === "continueOnly") {
          const popupC = document.createElement("div");
          popupC.className = "popup";
          popupC.style.display = "block";
          popupC.innerHTML =
            "<div class=\"popup-message\"></div><button type=\"button\" class=\"popup-button ok\">Continue</button>";
          const msgElC = popupC.querySelector(".popup-message");
          if (msgElC) msgElC.textContent = message;
          document.body.appendChild(popupC);
          const okC = popupC.querySelector(".popup-button.ok");
          if (okC) okC.focus();
          if (okC) {
            okC.addEventListener("click", function () {
              document.body.removeChild(popupC);
              resolve(true);
            });
          }
          return;
        }
        const popup = document.createElement("div");
        popup.className = "popup";
        popup.style.display = "block";
        let popupContent = "<div class=\"popup-message\"></div>";
        let select = "";
        if (options) {
          select = "<select class=\"popup-select\" style=\"display: block;\">";
          options.forEach(opt => {
            select += "<option value=\"" + String(opt.value).replace(/"/g, "&quot;") + "\">" + String(opt.text).replace(/</g, "&lt;") + "</option>";
          });
          select += "</select>";
          popupContent += select;
        }
        let input = "";
        if (!options && isConfirm) {
          input = "<input type=\"number\" class=\"popup-input\" style=\"display: block;\" min=\"0\">";
          popupContent += input;
        }
        let buttons = "<button type=\"button\" class=\"popup-button ok\">OK</button>";
        if (showCancel) {
          buttons += "<button type=\"button\" class=\"popup-button cancel\">Cancel</button>";
        }
        popup.innerHTML = popupContent + buttons;
        const msgEl = popup.querySelector(".popup-message");
        if (msgEl) msgEl.textContent = message;
        document.body.appendChild(popup);
        const okButton = popup.querySelector(".popup-button.ok");
        const cancelButton = popup.querySelector(".popup-button.cancel");
        const selectElement = popup.querySelector(".popup-select");
        const inputElement = popup.querySelector(".popup-input");
        if (okButton) okButton.focus();
        if (okButton) {
          okButton.addEventListener("click", () => {
            const value = selectElement ? selectElement.value : inputElement ? parseInt(inputElement.value, 10) || 0 : true;
            document.body.removeChild(popup);
            resolve(value);
          });
        }
        if (cancelButton) {
          cancelButton.addEventListener("click", () => {
            document.body.removeChild(popup);
            resolve(false);
          });
        }
      });
    }
    async function handlePlayCard() {
      wipeCardplayPublicMapHighlight();
      isIndividualSelectionMode = true;
      isBookSelectionMode = false;
      selectedCards = [];
      document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
      if (isCardplayHudCompact()) {
        setCardplayError('');
      } else {
        setCardplayError('Select a card');
      }
      checkCardStatus();
    }
    async function handleSelectCards() {
      wipeCardplayPublicMapHighlight();
      isBookSelectionMode = true;
      isIndividualSelectionMode = false;
      selectedCards = [];
      document.querySelectorAll('.card').forEach(card => card.classList.remove('selected'));
      if (isCardplayHudCompact()) {
        setCardplayError('');
      } else {
        setCardplayError('Select 3 cards for a book');
      }
      checkCardStatus();
    }
    async function handleReset() {
      clearCardplayLocalPrompt();
      window.isResetting = true;
      try {
        if (!initialGameState || !Array.isArray(initialGameState.players)) {
          return;
        }
        window.gameState.players = JSON.parse(JSON.stringify(initialGameState.players));
        window.gameState.continentSnapshot = JSON.parse(JSON.stringify(initialGameState.continentSnapshot || {}));
        if (initialGameState.continentsSnapshot != null) {
          window.gameState.continentsSnapshot = JSON.parse(JSON.stringify(initialGameState.continentsSnapshot));
        }
        ['bookPlayedThisTurn', 'conqueredThisTurn', 'cardEarnedViaCardplay'].forEach(function (k) {
          if (Object.prototype.hasOwnProperty.call(initialGameState, k)) {
            window.gameState[k] = initialGameState[k];
          }
        });
        if (window.gameUtils && typeof window.gameUtils.setAerialAttackUsesRemaining === "function") {
          window.gameUtils.setAerialAttackUsesRemaining(window.gameState, 0);
        } else {
          window.gameState.aerialAttackEligible = false;
        }
        window.gameState.aerialAttack = false;
        delete window.gameState.risquePublicCardplayRecap;
        delete window.gameState.risquePublicCardplayRecapAckRequiredSeq;
        delete window.gameState.risqueCardplayTvRecapPublished;
        window.gameState.risqueCardplaySuppressPublicSpectator = true;
        window.__risqueCardplayHostIncomeOnly = false;
        playedCards = [];
        recapMirrorSentForCommit = false;
        summaryMessages = [];
        selectedCards = [];
        isBookSelectionMode = false;
        isIndividualSelectionMode = false;
        processingBook = false;
        currentBookCardIndex = -1;
        hasConfirmed = false;
        pendingElimination = null;
        document.querySelectorAll('.card').forEach(card => {
          card.classList.remove('selected', 'played', 'processing');
        });
        setCardplayError('Actions reset');
        if (isCardplayHudCompact()) {
          rebuildCardplayCompactHand();
        }
        loadCards();
        updateSummaryDisplay();
        checkCardStatus();
        try {
          window.gameUtils.renderTerritories(null, window.gameState);
          window.gameUtils.renderStats(window.gameState);
        } catch (eR) {
          logToStorage('Reset render error: ' + (eR.message || String(eR)));
        }
        localStorage.setItem('gameState', JSON.stringify(window.gameState));
        clearCardplayPublicSpectator();
        captureCardplayPublicBoardSnapshot();
        if (typeof window.risqueMirrorPushGameState === "function") {
          window.risqueMirrorPushGameState();
        }
        const cp = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
        logToStorage('Game state reset', cp ? { player: cp.name, cards: cp.cards, territories: cp.territories } : {});
      } finally {
        window.isResetting = false;
      }
    }
    function playedCardIncludesTerritoryAcquire(pc) {
      if (!pc) return false;
      if (pc.action === 'acquire') return true;
      if (Array.isArray(pc.effects) && pc.effects.some(e => e && e.action === 'acquire')) return true;
      return false;
    }
    function commitPlayedCardSummaries() {
      const unconfirmedActions = playedCards.filter(pc => !pc.confirmed);
      if (unconfirmedActions.length === 0) return;
      if (typeof window.risqueAppendCommittedCardplayToGallery === "function") {
        window.risqueAppendCommittedCardplayToGallery(window.gameState, unconfirmedActions);
      }
      logToStorage('Committing played card summaries', { actions: unconfirmedActions });
      unconfirmedActions.forEach(playedCard => {
        playedCard.confirmed = true;
        const effectMessages = playedCard.effects ? playedCard.effects.map(effect => {
          if (!effect.territory) {
            logToStorage('Effect missing territory in commitPlayedCardSummaries', { effect });
            return `Effect: Invalid (missing territory)`;
          }
          if (effect.action === 'add_troops') {
            return `${effect.territory.toUpperCase()}: +2 troops (${
              window.gameState.players.find(p => p.name === window.gameState.currentPlayer)?.territories.find(t => t.name === effect.territory)?.troops.toString().padStart(3, '0') || '000'
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
        }) : [
          playedCard.action === 'aerial_attack' ? `Wildcard: Aerial Attack enabled` :
          !playedCard.territory ? `Effect: Invalid (missing territory)` :
          playedCard.action === 'add_troops' ? `${playedCard.territory.toUpperCase()}: +2 troops (${
            window.gameState.players.find(p => p.name === window.gameState.currentPlayer)?.territories.find(t => t.name === playedCard.territory)?.troops.toString().padStart(3, '0') || '000'
          })` :
          playedCard.action === 'remove_troops' ? `${playedCard.territory.toUpperCase()}: ${playedCard.owner} lost 2 troops (${
            window.gameState.players.find(p => p.name === playedCard.owner)?.territories.find(t => t.name === playedCard.territory)?.troops.toString().padStart(3, '0') || '000'
          } remaining)` :
          playedCard.action === 'acquire' ? `${playedCard.territory.toUpperCase()}: Acquired by ${window.gameState.currentPlayer} (001)` :
          playedCard.action === 'declined' ? `${playedCard.territory.toUpperCase()}: Declined` :
          `${playedCard.territory}: No effect`
        ];
        const index = summaryMessages.findIndex(msg => msg.includes(playedCard.cards.map(c => c.card.toUpperCase()).join(', ')));
        if (index !== -1) {
          summaryMessages[index] = playedCard.action === 'book' ?
            `Book: ${playedCard.cards.map(c => c.card.toUpperCase()).join(', ')} - ${effectMessages.join('; ')}` :
            effectMessages[0];
        }
      });
      hasConfirmed = true;
      updateSummaryDisplay();
      /* End-of-turn deck card (reinforce → receive-card) only if at least one territory was captured
       * via cardplay this turn — not for books that were all declined / add troops only / etc. */
      const anyTerritoryAcquire = unconfirmedActions.some(playedCardIncludesTerritoryAcquire);
      if (anyTerritoryAcquire) {
        window.gameState.conqueredThisTurn = true;
        window.gameState.cardEarnedViaCardplay = true;
      }
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      logToStorage('Played card summaries committed', { actions: unconfirmedActions });
    }

    async function resolvePendingEliminationFromConfirm() {
      if (!pendingElimination) return;
      const { type, playedCardData, bookPlayedCard, territory, owner, ownerTerritory, card, cardId, index } = pendingElimination;
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      const ownerPlayer = window.gameState.players.find(p => p.name === owner);
      ownerPlayer.territories = ownerPlayer.territories.filter(t => t.name !== territory);
      ownerPlayer.troopsTotal -= ownerTerritory.troops;
      currentPlayer.territories.push({ name: territory, troops: 1 });
      currentPlayer.troopsTotal += 1;
      var defenderEliminated = !ownerPlayer.territories || ownerPlayer.territories.length === 0;
      window.gameState.conqueredThisTurn = true;
      window.gameState.cardEarnedViaCardplay = true;
      if (defenderEliminated) {
        var transferredCards = ownerPlayer.cards ? ownerPlayer.cards.slice() : [];
        currentPlayer.cards = (currentPlayer.cards || []).concat(
          transferredCards.map(function (c) {
            return { name: c.name, id: generateUUID() };
          })
        );
        currentPlayer.cardCount = currentPlayer.cards.length;
        ownerPlayer.cards = [];
        ownerPlayer.cardCount = 0;
        window.gameState.risquePublicEliminationBanner =
          currentPlayer.name + " has conquered " + owner + ".";
        window.gameState.defeatedPlayer = owner;
        window.gameState.turnOrder = window.gameState.turnOrder.filter(function (name) {
          return name !== owner;
        });
        window.gameState.transferredCardCount = transferredCards.length;
      }
      if (type === 'book') {
        bookPlayedCard.effects[index].action = 'acquire';
        bookPlayedCard.effects[index].owner = owner;
        bookPlayedCard.effects[index].troops = ownerTerritory.troops;
      } else {
        playedCardData.action = 'acquire';
        playedCardData.owner = owner;
        playedCardData.troops = ownerTerritory.troops;
      }
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
      window.gameUtils.renderTerritories(territory, window.gameState);
      logToStorage('Player eliminated', { territory, from: owner, to: currentPlayer.name });
      announceCardplayEffect({
        card: card,
        territory: territory,
        action: "acquire",
        currentName: currentPlayer.name
      });
      pendingElimination = null;
      if (type === 'book') {
        currentBookCardIndex++;
        await processBookCardEffect(bookPlayedCard);
        return;
      }
      const cardElement = document.querySelector(`.card[data-card="${card}"][data-id="${cardId}"]`);
      if (cardElement) {
        cardElement.classList.add('played');
      }
      updateSummaryDisplay();
      checkCardStatus();
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
      setTimeout(function () {
        window.location.href = risqueCardplayDoc("conquer");
      }, 2000);
    }

    function collectFlatCardIdsForPublicRecapAnim(list) {
      var ids = [];
      if (!Array.isArray(list)) return ids;
      list.forEach(function (pc) {
        if (!pc || !pc.cards) return;
        pc.cards.forEach(function (c) {
          if (c && c.card) ids.push(String(c.card).toLowerCase());
        });
      });
      return ids;
    }

    function orderCardplayActionsForPublicProcessing(list) {
      if (!Array.isArray(list)) return [];
      var books = [];
      var singles = [];
      list.forEach(function (pc) {
        if (!pc) return;
        if (pc.action === "book") books.push(pc);
        else singles.push(pc);
      });
      return books.concat(singles);
    }

    function publishCardplayRecapToPublicMirror() {
      clearCardplayPublicBoardSnapshot();
      var nextSeq = (Number(window.gameState.risquePublicCardplayRecapSeq) || 0) + 1;
      window.gameState.risquePublicCardplayRecapSeq = nextSeq;
      var orderedForPublic = orderCardplayActionsForPublicProcessing(playedCards);
      var pubRows = buildPublicRecapDisplayLines(orderedForPublic);
      window.gameState.risquePublicCardplayRecap = {
        seq: nextSeq,
        playerName: String(window.gameState.currentPlayer || "Player"),
        lines: pubRows.map(function (r) {
          return r.text;
        }),
        publicLineKinds: pubRows.map(function (r) {
          return r.kind;
        }),
        cardIds: collectPlayedCardIdsForRecap(orderedForPublic),
        cardGroups: buildRecapCardGroups(orderedForPublic)
      };
      window.gameState.risquePublicCardplayRecapAckRequiredSeq = nextSeq;
      window.gameState.risqueCardplaySuppressPublicSpectator = false;
      /* Invalidate any prior TV ack so the host cannot Continue until this recap’s animation finishes on public. */
      try {
        localStorage.removeItem(CARDPLAY_RECAP_ACK_KEY);
        localStorage.removeItem(AERIAL_COUNTER_DECISION_KEY);
      } catch (eClrAck) {}
      var flatIds = collectFlatCardIdsForPublicRecapAnim(orderedForPublic);
      if (flatIds.length) {
        window.gameState.risquePublicCardplayBookCards = flatIds;
      } else {
        delete window.gameState.risquePublicCardplayBookCards;
      }
      var nm = String(window.gameState.currentPlayer || "Player");
      var disp = nm ? nm.charAt(0).toUpperCase() + nm.slice(1) : "Player";
      window.gameState.risquePublicCardplayPrimary = disp.toUpperCase() + " · CARD PLAY";
      if (typeof window.risqueBuildPublicCardplayRecapProcessingPayload === "function") {
        var proc = window.risqueBuildPublicCardplayRecapProcessingPayload(orderedForPublic, window.gameState);
        if (proc && Array.isArray(proc.steps) && proc.steps.length > 0) {
          proc.seq = nextSeq;
          window.gameState.risquePublicBookProcessing = proc;
        }
      }
      window.gameState.risqueCardplayTvRecapPublished = true;
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
    }

    function refreshCardplayPublicHandCountMirror() {
      if (!window.gameState || window.risqueDisplayIsPublic) return;
      if (window.gameState.risqueCardplayUseFrozenPublicMirror) return;
      var cur = window.gameState.players.find(function (p) {
        return p.name === window.gameState.currentPlayer;
      });
      if (!cur) return;
      var unplayed = getUnplayedCards();
      var n = unplayed.length;
      var nm = String(cur.name || "Player");
      var nameDisp = nm.charAt(0).toUpperCase() + nm.slice(1);
      window.gameState.risquePublicCardplaySpectatorHandCount = n;
      window.gameState.risquePublicCardplaySpectatorPlayer = nameDisp;
      var hasUnconfirmedActions = playedCards.some(function (pc) {
        return !pc.confirmed;
      });
      var allowVoiceHandMirror =
        window.gameState.risqueCardplaySuppressPublicSpectator !== true && !hasUnconfirmedActions;
      if (allowVoiceHandMirror) {
        window.gameState.risquePublicCardplayPrimary =
          nameDisp + " has " + n + " card" + (n === 1 ? "" : "s") + " in hand.";
        window.gameState.risquePublicCardplayReport =
          n === 5
            ? nameDisp + " has 5 cards in hand — a card or book must be played."
            : n > 5
              ? nameDisp + " must play or trade down to at most 5 cards."
              : "Card play in progress.";
      }
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (eH) {}
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
    }

    function handleSkipCardplayToIncome() {
      if (pendingElimination) {
        setCardplayError("Resolve elimination before skipping.");
        return;
      }
      if (cardplayConfirmShouldBeHeld()) {
        setCardplayError("Finish the on-screen prompt before skipping.");
        return;
      }
      var unplayedForSkip = getUnplayedCards();
      if (unplayedForSkip.length > 4) {
        setCardplayError(
          `You have ${unplayedForSkip.length} cards in hand. Must play or trade down to 4 or fewer before skipping.`
        );
        return;
      }
      if (playedCards.some(function (pc) { return !pc.confirmed; })) {
        setCardplayError("Confirm or reset your card play before skipping.");
        return;
      }
      if (playedCards.length > 0) {
        if (
          !window.confirm(
            "Skip card play and go to income? In-progress actions on this screen will be discarded."
          )
        ) {
          return;
        }
      }
      playedCards = [];
      recapMirrorSentForCommit = false;
      summaryMessages = [];
      try {
        delete window.gameState.risquePublicCardplayRecap;
        delete window.gameState.risqueCardplayTvRecapPublished;
        delete window.gameState.risquePublicCardplayRecapAckRequiredSeq;
      } catch (eSk) {}
      proceedCardplayToIncome(250);
    }

    async function handleNextPhase() {
      if (pendingElimination) {
        await resolvePendingEliminationFromConfirm();
        return;
      }
      if (cardplayConfirmShouldBeHeld()) {
        setCardplayError(
          "Finish your card play or the on-screen prompt before CONFIRM. Use those buttons, or RESET."
        );
        return;
      }
      if (playedCards.some(pc => !pc.confirmed)) {
        commitPlayedCardSummaries();
        checkCardStatus();
      }
      if (playedCards.some(pc => !pc.confirmed)) {
        setCardplayError('Could not finalize card play — try again.');
        return;
      }
      var hadPlaysForGate = Array.isArray(playedCards) && playedCards.length > 0;
      if (
        hadPlaysForGate &&
        recapMirrorSentForCommit &&
        !document.getElementById("cardplay-host-income-gate-root") &&
        !window.risqueDisplayIsPublic
      ) {
        mountCardplayHostIncomeGateUi();
      }
      const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
      if (currentPlayer.cardCount > 4) {
        setCardplayError(`You have ${currentPlayer.cardCount} cards. Must play/dump to 4 or fewer.`);
        return;
      }
      var hadPlays = Array.isArray(playedCards) && playedCards.length > 0;
      if (hadPlays && !recapMirrorSentForCommit) {
        publishCardplayRecapToPublicMirror();
        recapMirrorSentForCommit = true;
        try {
          localStorage.setItem('gameState', JSON.stringify(window.gameState));
        } catch (ePub) {}
        mountCardplayHostIncomeGateUi();
        return;
      }
      if (hadPlays && !cardplayRecapAckSatisfied()) {
        setCardplayError(
          "Tap Continue to Income when the audience has seen the summary."
        );
        return;
      }
      proceedCardplayToIncome();
    }

  function mount(host, opts) {
    mountOpts = opts || {};
    injectStyles();
    initialGameState = null;
    selectedCards = [];
    summaryMessages = [];
    isBookSelectionMode = false;
    isIndividualSelectionMode = false;
    processingBook = false;
    currentBookCardIndex = -1;
    hasConfirmed = false;
    playedCards = [];
    pendingElimination = null;
    if (!window.gameUtils) {
      console.error('[Cardplay] gameUtils missing');
      return;
    }
    var gs = window.gameState;
    if (!gs || !gs.players || !gs.currentPlayer || !gs.turnOrder || !Array.isArray(gs.turnOrder) || gs.turnOrder.length === 0) {
      logToStorage('Invalid or missing game state at mount');
      if (window.gameUtils.showError) window.gameUtils.showError('Invalid game state.');
      setTimeout(function () {
        var u = loginRecoveryUrl();
        if (window.risqueNavigateWithFade) window.risqueNavigateWithFade(u); else window.location.href = u;
      }, 2000);
      return;
    }
    gs.phase = 'cardplay';
    try {
      delete gs.risquePublicNextPlayerHandoffPrimary;
      delete gs.risquePublicNextPlayerHandoffReport;
    } catch (eHandoff) {
      /* ignore */
    }
    gs.risqueCardplaySuppressPublicSpectator = true;
    window.__risqueCardplayHostIncomeOnly = false;
    delete gs.risqueCardplayTvRecapPublished;
    recapMirrorSentForCommit = false;
    try {
      localStorage.setItem('gameState', JSON.stringify(gs));
    } catch (e) {}
    if (!window.__risqueCardplayRecapStorageWired) {
      window.__risqueCardplayRecapStorageWired = true;
      window.addEventListener("storage", function (ev) {
        if (ev.key === AERIAL_COUNTER_DECISION_KEY) {
          try {
            applyPendingAerialCounterDecision();
          } catch (eCtr) {}
        }
        if (ev.key !== "risquePublicCardplayRecapAck" || ev.newValue == null) return;
        try {
          if (
            document.getElementById("next-phase-button") ||
            document.getElementById("cardplay-host-continue-income-btn") ||
            document.getElementById("cardplay-continue-income-btn")
          ) {
            checkCardStatus();
          }
        } catch (eSt) {}
      });
    }
    clearCardplayPublicSpectator();
    cardplayInit();
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.cardplay = { mount: mount };
})();
