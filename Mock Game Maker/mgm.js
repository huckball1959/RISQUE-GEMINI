/**
 * Mock Game Maker — build gameState for RISQUE, export to localStorage / JSON file.
 * Depends on ../js/core.js (gameUtils), ../js/replay-tape.js (tape helpers / flatten).
 *
 * Exports are normalized to match current runtime expectations (replay tape v2, stamped rounds,
 * Lucky ledger/session roster, stripped live-session keys) so JSON loads cleanly in game.html.
 */
(function () {
  "use strict";

  var CONTINENT_ORDER = [
    "south_america",
    "north_america",
    "africa",
    "europe",
    "asia",
    "australia"
  ];
  /**
   * Start phase for export: `value` is the &lt;select&gt; id; `payloadPhase` is written to gameState.phase
   * (canonical runtime phase). Optional URL/query hints: deployKind, selectKind, privacyGate.
   */
  var START_PHASES = [
    { value: "attack", label: "Attack", payloadPhase: "attack" },
    { value: "reinforce", label: "Reinforce", payloadPhase: "reinforce" },
    { value: "cardplay", label: "Card play", payloadPhase: "cardplay" },
    { value: "income", label: "Income", payloadPhase: "income" },
    { value: "receivecard", label: "Receive card", payloadPhase: "receivecard" },
    { value: "deal", label: "Deal", payloadPhase: "deal" },
    { value: "deploy1", label: "Deploy (first / setup)", payloadPhase: "deploy", deployKind: "setup" },
    { value: "deploy2", label: "Deploy (turn)", payloadPhase: "deploy", deployKind: "turn" },
    {
      value: "playerSelect_firstCard",
      label: "Player select — first card",
      payloadPhase: "playerSelect",
      selectKind: "firstCard"
    },
    {
      value: "playerSelect_deployOrder",
      label: "Player select — deploy order",
      payloadPhase: "playerSelect",
      selectKind: "deployOrder"
    },
    {
      value: "playerSelect_cardPlay",
      label: "Player select — card play order",
      payloadPhase: "playerSelect",
      selectKind: "cardPlay"
    },
    { value: "privacyGate", label: "Privacy gate", payloadPhase: "cardplay", privacyGate: true }
  ];

  var gameState = null;
  /** False until real players are chosen (blocks map paint during embedded login). */
  var mgmEditorReady = false;

  /** Sentinel: palette row that clears a territory to unowned when clicked on the map. */
  var MGM_PALETTE_UNOWNED = "__unowned__";
  /** Which player color we paint with (name string), or `MGM_PALETTE_UNOWNED` for erase. */
  var mgmPalettePlayerName = null;
  /** Ctrl / ⌘ + click toggles membership (bulk palette, random troops, continent select); synced to `window.RISQUE_MGM_SELECTED_LABELS` in core.js. */
  var mgmSelectedTerritories = [];

  function isPaletteUnownedMode() {
    return mgmPalettePlayerName === MGM_PALETTE_UNOWNED;
  }

  /** Map paint + troop wheel/input: player selected on the palette (not Round & phase). */
  function paletteActorName() {
    if (!gameState || !mgmPalettePlayerName || isPaletteUnownedMode()) return null;
    var n = String(mgmPalettePlayerName);
    if (!gameState.players || !gameState.players.some(function (p) { return p.name === n; })) return null;
    return n;
  }

  function palettePlayersSig() {
    if (!gameState || !gameState.players) return "";
    return gameState.players
      .map(function (p) {
        return p.name + "\t" + (p.color || "");
      })
      .join("|");
  }

  function mgmPaletteChipColors(playerColor) {
    var hex = (window.gameUtils && window.gameUtils.colorMap[playerColor]) || "#475569";
    var fg = "#ffffff";
    if (playerColor === "yellow" || playerColor === "pink") fg = "#0f172a";
    return { bg: hex, fg: fg };
  }

  function renderMgmPalette() {
    var host = el("mgm-map-palette");
    if (!host || !gameState || !gameState.players) return;
    var sig = palettePlayersSig();
    if (host.dataset.mgmPaletteSig !== sig) {
      host.dataset.mgmPaletteSig = sig;
      host.innerHTML = "";
      gameState.players.forEach(function (p) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mgm-palette-chip";
        btn.setAttribute("data-palette-key", p.name);
        var cols = mgmPaletteChipColors(p.color);
        btn.style.backgroundColor = cols.bg;
        btn.style.color = cols.fg;
        var span = document.createElement("span");
        span.className = "mgm-palette-chip-name";
        span.textContent = p.name;
        btn.appendChild(span);
        btn.onclick = function () {
          mgmPalettePlayerName = p.name;
          if (mgmSelectedTerritories.length > 0) {
            applyPaletteColorToLabels(mgmSelectedTerritories.slice(), p.name);
            showStatus(p.name + ": " + mgmSelectedTerritories.length + " territories.");
          } else {
            showStatus(p.name);
          }
          renderMgmPalette();
          renderMap();
        };
        host.appendChild(btn);
      });
      var clr = document.createElement("button");
      clr.type = "button";
      clr.className = "mgm-palette-chip mgm-palette-chip--unowned";
      clr.setAttribute("data-palette-key", MGM_PALETTE_UNOWNED);
      clr.textContent = "Unowned";
      clr.onclick = function () {
        mgmPalettePlayerName = MGM_PALETTE_UNOWNED;
        if (mgmSelectedTerritories.length > 0) {
          var n = mgmSelectedTerritories.length;
          applyUnownedToLabels(mgmSelectedTerritories.slice());
          mgmSelectedTerritories = [];
          lastTerritory = null;
          showStatus("Cleared " + n);
        } else {
          showStatus("Unowned");
        }
        renderMgmPalette();
        renderMap();
      };
      host.appendChild(clr);
    }
    Array.prototype.forEach.call(host.querySelectorAll("[data-palette-key]"), function (b) {
      var k = b.getAttribute("data-palette-key");
      b.classList.toggle("mgm-palette-chip-active", k === mgmPalettePlayerName);
    });
  }

  var lastTerritory = null;
  var shellMounted = false;
  var designerUiWired = false;
  /** Logical board (must match core.js stage / SVG viewBox). */
  var MGM_BOARD_W = 1920;
  var MGM_BOARD_H = 1080;
  var DRAFT_STORAGE_KEY = "risqueMockMakerDraft";
  /** Car-radio card hand presets for Mock Game Maker (same browser as login presets). */
  var MGM_CARD_PRESETS_KEY = "risqueMgmCardPresetsV1";
  /** Click-to-assign: deck card selected until dropped or assigned */
  var selectedDeckCardName = null;
  /** Must match js/replay-tape.js TAPE_VERSION for instant replay. */
  var REPLAY_TAPE_VERSION = 2;

  /**
   * Same idea as risqueReplayHasTape (replay-tape.js): any replayable segment (deal, init, deploy, battle, elimination).
   * If true, export keeps that tape — no synthetic overwrite.
   */
  function scanEventListForPlayback(ev) {
    if (!ev || !ev.length) return false;
    var i;
    for (i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (!e || !e.type) continue;
      if (e.type === "init" && e.board) return true;
      if (
        e.type === "board" &&
        e.board &&
        (e.segment === "deal" || e.segment === "deploy" || e.segment === "battle" || e.segment === "reinforce")
      ) {
        return true;
      }
      if (e.type === "elimination") return true;
    }
    return false;
  }

  /**
   * True if we should keep the embedded tape (v1/v2) instead of replacing with a synthetic one.
   * Handles legacy flat {@link risqueReplayTape.events} and per-round {@link risqueReplayByRound}.
   */
  function existingTapeHasBattlePlayback(gs) {
    try {
      var ev = typeof window.risqueReplayFlattenEvents === "function" ? window.risqueReplayFlattenEvents(gs) : null;
      if (ev && ev.length && scanEventListForPlayback(ev)) return true;
      if (!ev || !ev.length) {
        var br = gs && gs.risqueReplayByRound;
        if (br && typeof br === "object") {
          var keys = Object.keys(br);
          var ki;
          for (ki = 0; ki < keys.length; ki++) {
            var bucket = br[keys[ki]];
            if (scanEventListForPlayback(bucket)) return true;
          }
        }
        var t = gs && gs.risqueReplayTape;
        if (!t || (t.v !== 1 && t.v !== REPLAY_TAPE_VERSION) || !t.events || !t.events.length) return false;
        ev = t.events;
      }
      return scanEventListForPlayback(ev);
    } catch (err) {
      return false;
    }
  }

  /** Same shape as replay-tape snapshotBoard — full label → { owner, troops }. */
  function snapshotBoardForTape(gs) {
    var out = {};
    if (!gs || !gs.players) return out;
    gs.players.forEach(function (p) {
      if (!p || !p.name) return;
      (p.territories || []).forEach(function (t) {
        if (!t || !t.name) return;
        out[t.name] = { owner: String(p.name), troops: Number(t.troops) || 0 };
      });
    });
    return out;
  }

  function cloneBoardCell(c) {
    return { owner: String(c.owner), troops: Number(c.troops) || 0 };
  }

  function cloneBoard(b) {
    var o = {};
    Object.keys(b).forEach(function (k) {
      o[k] = cloneBoardCell(b[k]);
    });
    return o;
  }

  /**
   * Invent a plausible battle sequence so risqueReplayHasTape(copy) is true after load.
   * Uses an enemy border (if any) to simulate a conquest into the exported position; otherwise troop drift.
   */
  function buildSyntheticReplayTape(gs) {
    var finalBoard = snapshotBoardForTape(gs);
    var labels = Object.keys(finalBoard);
    if (!labels.length) return null;

    var events = [];
    var adj = window.gameUtils && window.gameUtils.adjacencies;
    var pair = null;

    if (adj) {
      for (var i = 0; i < labels.length; i++) {
        var to = labels[i];
        var neigh = adj[to];
        if (!neigh) continue;
        for (var j = 0; j < neigh.length; j++) {
          var from = neigh[j];
          if (!finalBoard[from] || !finalBoard[to]) continue;
          if (finalBoard[from].owner !== finalBoard[to].owner) {
            pair = { from: from, to: to, att: finalBoard[from].owner, def: finalBoard[to].owner };
            break;
          }
        }
        if (pair) break;
      }
    }

    var initBoard = cloneBoard(finalBoard);

    if (pair) {
      var tF = finalBoard[pair.to].troops;
      initBoard[pair.to] = {
        owner: pair.def,
        troops: Math.max(1, tF + 2 + ((Math.floor(Math.random() * 4) | 0) % 4))
      };
      initBoard[pair.from] = cloneBoardCell(finalBoard[pair.from]);
      initBoard[pair.from].troops = Math.max(1, finalBoard[pair.from].troops + 1);
    } else {
      labels.forEach(function (lab, idx) {
        initBoard[lab].troops = Math.max(1, finalBoard[lab].troops + (idx % 5));
      });
    }

    events.push({ type: "init", board: cloneBoard(initBoard) });

    function pushBattle(board) {
      events.push({ type: "board", segment: "battle", board: cloneBoard(board) });
    }

    if (pair) {
      var mid = cloneBoard(initBoard);
      mid[pair.to].troops = Math.max(
        1,
        Math.floor((initBoard[pair.to].troops + finalBoard[pair.to].troops) / 2)
      );
      pushBattle(mid);

      var conquered = cloneBoard(finalBoard);
      conquered[pair.to] = { owner: pair.att, troops: 1 };
      conquered[pair.from] = cloneBoardCell(finalBoard[pair.from]);
      conquered[pair.from].troops = Math.max(1, finalBoard[pair.from].troops - 1);
      pushBattle(conquered);

      if (gs.players && gs.players.length >= 2) {
        events.push({
          type: "elimination",
          conqueror: String(pair.att),
          defeated: String(pair.def)
        });
      }
      pushBattle(finalBoard);
    } else {
      var s;
      for (s = 0; s < 4; s++) {
        var alpha = (s + 1) / 5;
        var frame = {};
        labels.forEach(function (lab) {
          var it = initBoard[lab].troops;
          var ft = finalBoard[lab].troops;
          frame[lab] = {
            owner: finalBoard[lab].owner,
            troops: Math.max(1, Math.round(it + (ft - it) * alpha))
          };
        });
        pushBattle(frame);
      }
      pushBattle(finalBoard);
    }

    stampSyntheticTapeEventRounds(events, gs && gs.round);
    return {
      v: REPLAY_TAPE_VERSION,
      openingRecorded: true,
      hasDealFrames: false,
      events: events
    };
  }

  /** Match replay-tape stampRound — every exported tape event carries {@link round}. */
  function stampSyntheticTapeEventRounds(events, roundRaw) {
    var r = typeof roundRaw === "number" ? roundRaw : parseInt(roundRaw, 10);
    var rn = isFinite(r) && r >= 1 ? Math.floor(r) : 1;
    var i;
    for (i = 0; i < events.length; i++) {
      var e = events[i];
      if (e && typeof e === "object") e.round = rn;
    }
  }

  /**
   * Strip keys that must not ship in a cold-load save (live replay UI, migrated buckets).
   * Keeps {@link risqueReplayTape} — caller sets or replaces it afterward.
   */
  function stripMgmExportLiveReplayKeys(gs) {
    if (!gs || typeof gs !== "object") return;
    delete gs.risqueReplayPlaybackActive;
    delete gs.risqueReplayHudRound;
    delete gs.risqueReplayHudActorLine;
    delete gs.risqueReplayBattleFlashLabels;
    delete gs.risquePublicReplayRound;
    delete gs.risquePublicReplayEliminationSplash;
    delete gs.phaseReplayIndex;
    delete gs.risqueReplayMachineHudPhase;
  }

  /** Defaults aligned with game-shell normalizeState so Login load + runtime phases behave. */
  function ensureMgmExportShellDefaults(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!Array.isArray(gs.risquePlayedCardsGallery)) gs.risquePlayedCardsGallery = [];
    if (!gs.risqueLuckyLedger || typeof gs.risqueLuckyLedger !== "object") {
      gs.risqueLuckyLedger = { byPlayer: {} };
    }
    if (typeof gs.risqueLuckyLedger.byPlayer !== "object" || gs.risqueLuckyLedger.byPlayer === null) {
      gs.risqueLuckyLedger.byPlayer = {};
    }
    (gs.players || []).forEach(function (p) {
      var nm = p && p.name ? String(p.name) : "";
      if (!nm) return;
      if (!gs.risqueLuckyLedger.byPlayer[nm]) {
        gs.risqueLuckyLedger.byPlayer[nm] = {
          dice: 0,
          sixes: 0,
          roundWins: 0,
          roundLosses: 0,
          roundTies: 0
        };
      }
    });
    if (!Array.isArray(gs.risqueLuckySessionRoster) || !gs.risqueLuckySessionRoster.length) {
      var roster = [];
      var seen = {};
      function push(nm) {
        if (!nm || seen[nm]) return;
        seen[nm] = true;
        roster.push(nm);
      }
      var ti;
      for (ti = 0; ti < (gs.turnOrder || []).length; ti++) {
        if (gs.turnOrder[ti]) push(String(gs.turnOrder[ti]));
      }
      for (ti = 0; ti < (gs.players || []).length; ti++) {
        var pr = gs.players[ti] && gs.players[ti].name;
        if (pr) push(String(pr));
      }
      Object.keys(gs.risqueLuckyLedger.byPlayer || {}).forEach(function (k) {
        if (k) push(String(k));
      });
      if (roster.length) gs.risqueLuckySessionRoster = roster;
    }
    if (gs.setupComplete === true && gs.risqueHostHudStatsColumnRetired == null) {
      var ph = String(gs.phase || "");
      var retire = {
        income: 1,
        "con-income": 1,
        cardplay: 1,
        "con-cardplay": 1,
        attack: 1,
        reinforce: 1,
        receivecard: 1,
        getcard: 1,
        deploy: 1,
        conquer: 1,
        "con-cardtransfer": 1,
        "con-deploy": 1,
        "con-receivecard": 1,
        "con-transfertroops": 1
      };
      if (retire[ph]) gs.risqueHostHudStatsColumnRetired = true;
    }
  }

  /** Session key + player color map for replay tape consumers (instant replay + replay machine). */
  function ensureMgmReplayTapeSidecar(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueReplayTapeSessionKey) {
      gs.risqueReplayTapeSessionKey =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : "rsq-" + String(Date.now()) + "-" + String(Math.floor(Math.random() * 1e9));
    }
    var m = {};
    (gs.players || []).forEach(function (p) {
      if (!p || !p.name || p.color == null || String(p.color).trim() === "") return;
      m[String(p.name).trim().toLowerCase()] = String(p.color).trim().toLowerCase();
    });
    gs.risqueReplayPlayerColors = m;
    var tape = gs.risqueReplayTape;
    if (tape && typeof tape === "object") {
      if (typeof tape.hasDealFrames !== "boolean") {
        tape.hasDealFrames = !!(
          tape.events &&
          tape.events.some(function (e) {
            return e && e.type === "board" && e.segment === "deal";
          })
        );
      }
      if (tape.v !== 1 && tape.v !== REPLAY_TAPE_VERSION) {
        tape.v = REPLAY_TAPE_VERSION;
      }
    }
  }

  /** Transient flags that should never survive an MGM export (mirror / pulse / TV scratch). */
  function stripMgmExportVolatileRuntimeKeys(gs) {
    if (!gs || typeof gs !== "object") return;
    delete gs.risqueTransferPulse;
    delete gs.risqueBattleLossFlashLabels;
    delete gs.risquePublicPlayerSelectFlash;
    delete gs.risquePublicDealPopTerritory;
    delete gs.risqueMirrorDeployRouteHint;
    delete gs.risqueDeferConquerElimination;
    delete gs.risqueConquestFlowActive;
    delete gs.risquePublicConquestCelebrationHtml;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function makeId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function allTerritoryLabels() {
    return Object.keys(window.gameUtils.territories).filter(function (k) {
      return k !== "wildcard1" && k !== "wildcard2";
    });
  }

  function allCardNames() {
    return window.gameUtils.cardNames.slice();
  }

  function buildContinentsObject() {
    var gu = window.gameUtils;
    var o = {};
    CONTINENT_ORDER.forEach(function (key) {
      o[key] = {
        territories: gu.continents[key].slice(),
        bonus: gu.continentValues[key].value
      };
    });
    return o;
  }

  /** Force continent base bonuses (and territory lists) to match game rules in core.js. */
  function syncContinentBonusesFromRules() {
    if (!gameState) return;
    var rules = buildContinentsObject();
    if (!gameState.continents) {
      gameState.continents = rules;
      return;
    }
    CONTINENT_ORDER.forEach(function (key) {
      if (!gameState.continents[key]) {
        gameState.continents[key] = {
          territories: rules[key].territories.slice(),
          bonus: rules[key].bonus
        };
        return;
      }
      gameState.continents[key].bonus = rules[key].bonus;
      if (!gameState.continents[key].territories || !gameState.continents[key].territories.length) {
        gameState.continents[key].territories = rules[key].territories.slice();
      }
    });
  }

  function cardNamesInHands() {
    var used = {};
    gameState.players.forEach(function (p) {
      (p.cards || []).forEach(function (c) {
        var n = typeof c === "string" ? c : c && c.name;
        if (n) used[n] = true;
      });
    });
    return used;
  }

  function rebuildDeck() {
    var used = cardNamesInHands();
    gameState.deck = allCardNames().filter(function (n) {
      return !used[n];
    });
  }

  /** Lowercase snake_case id — matches gameUtils.cardNames. */
  function canonicalMgmCardId(raw) {
    if (raw == null) return "";
    return String(raw)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  }

  /**
   * Risk deck: each territory card and each wildcard is in at most one hand.
   * Keeps the first copy in turnOrder; removes duplicates and unknown ids from later players.
   */
  function dedupeMgmHandsAcrossPlayers() {
    if (!gameState || !Array.isArray(gameState.players) || !window.gameUtils || !window.gameUtils.cardNames) {
      return;
    }
    var legal = {};
    window.gameUtils.cardNames.forEach(function (n) {
      legal[n] = 1;
    });
    var order =
      Array.isArray(gameState.turnOrder) && gameState.turnOrder.length
        ? gameState.turnOrder.slice()
        : [];
    var orderedPlayers = [];
    order.forEach(function (nm) {
      var p = gameState.players.find(function (x) {
        return x && x.name === nm;
      });
      if (p) orderedPlayers.push(p);
    });
    gameState.players.forEach(function (p) {
      if (p && orderedPlayers.indexOf(p) === -1) orderedPlayers.push(p);
    });
    var claimed = {};
    orderedPlayers.forEach(function (p) {
      if (!p) return;
      p.cards = p.cards || [];
      var next = [];
      p.cards.forEach(function (c) {
        var cn = canonicalMgmCardId(typeof c === "string" ? c : c && c.name);
        if (!cn || !legal[cn]) return;
        if (claimed[cn]) return;
        claimed[cn] = true;
        next.push(cn);
      });
      p.cards = next;
      syncPlayerAggregates(p);
    });
  }

  function syncPlayerAggregates(p) {
    p.territories = p.territories || [];
    p.cards = p.cards || [];
    var sum = 0;
    p.territories.forEach(function (t) {
      sum += Number(t.troops) || 0;
    });
    p.troopsTotal = sum;
    p.cardCount = p.cards.length;
  }

  function syncAllAggregates() {
    gameState.players.forEach(syncPlayerAggregates);
  }

  function getOwnerName(label) {
    for (var i = 0; i < gameState.players.length; i++) {
      var p = gameState.players[i];
      if (p.territories.some(function (t) { return t.name === label; })) return p.name;
    }
    return null;
  }

  function removeTerritoryFromAll(label) {
    gameState.players.forEach(function (p) {
      p.territories = p.territories.filter(function (t) { return t.name !== label; });
    });
  }

  function getTroopCountOnLabel(label) {
    var owner = getOwnerName(label);
    if (!owner) return 1;
    var p = gameState.players.find(function (x) {
      return x.name === owner;
    });
    var t = p && p.territories.find(function (x) {
      return x.name === label;
    });
    return Math.max(1, Number(t && t.troops) || 1);
  }

  function applyPaletteColorToLabels(labels, playerName) {
    var p = gameState.players.find(function (x) {
      return x.name === playerName;
    });
    if (!p) return;
    labels.forEach(function (label) {
      var prevT = getTroopCountOnLabel(label);
      removeTerritoryFromAll(label);
      p.territories.push({ name: label, troops: prevT });
    });
  }

  function applyUnownedToLabels(labels) {
    labels.forEach(function (label) {
      removeTerritoryFromAll(label);
    });
  }

  function mgmRandomTroopsOnSelection() {
    if (!mgmSelectedTerritories.length) return;
    mgmSelectedTerritories.forEach(function (label) {
      var owner = getOwnerName(label);
      if (!owner) return;
      var p = gameState.players.find(function (x) {
        return x.name === owner;
      });
      var t = p && p.territories.find(function (x) {
        return x.name === label;
      });
      if (t) t.troops = 1 + Math.floor(Math.random() * 25);
    });
    renderMap();
    showStatus("Random 1–25");
  }

  function showStatus(msg) {
    var s = el("mgm-status");
    if (s) s.textContent = msg || "";
  }

  function clearDeckCardSelection() {
    selectedDeckCardName = null;
    var grid = el("deck-card-grid");
    if (grid) {
      grid.querySelectorAll(".deck-card-tile.selected").forEach(function (n) {
        n.classList.remove("selected");
      });
    }
  }

  function loadMgmCardPresetsMap() {
    try {
      var raw = localStorage.getItem(MGM_CARD_PRESETS_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return o && typeof o === "object" ? o : {};
    } catch (e) {
      return {};
    }
  }

  function persistMgmCardPresetsMap(map) {
    try {
      localStorage.setItem(MGM_CARD_PRESETS_KEY, JSON.stringify(map || {}));
    } catch (e) {
      /* ignore quota */
    }
  }

  function captureCardPresetFromGameState() {
    var hands = {};
    if (!gameState || !gameState.players) return { v: 1, hands: hands };
    gameState.players.forEach(function (p) {
      hands[p.name] = (p.cards || [])
        .map(function (c) {
          return typeof c === "string" ? c : c && c.name;
        })
        .filter(Boolean);
    });
    return { v: 1, hands: hands };
  }

  function validateMgmCardPresetPayload(payload) {
    if (!payload || typeof payload.hands !== "object" || payload.hands === null) {
      return "Missing card data.";
    }
    var legal = {};
    allCardNames().forEach(function (n) {
      legal[n] = 1;
    });
    var seenTerritory = {};
    var w1 = 0;
    var w2 = 0;
    var keys = Object.keys(payload.hands);
    var ki;
    for (ki = 0; ki < keys.length; ki++) {
      var playerName = keys[ki];
      var arr = payload.hands[playerName];
      if (!Array.isArray(arr)) continue;
      if (arr.length > 5) return "More than 5 cards for " + playerName + ".";
      var seenInHand = {};
      var i;
      for (i = 0; i < arr.length; i++) {
        var cn = canonicalMgmCardId(typeof arr[i] === "string" ? arr[i] : "");
        if (!cn) return "Invalid card in " + playerName + "'s hand.";
        if (!legal[cn]) return "Unknown card: " + cn;
        if (seenInHand[cn]) return "Duplicate in one hand (" + playerName + "): " + cn;
        seenInHand[cn] = 1;
        if (cn === "wildcard1") {
          w1++;
        } else if (cn === "wildcard2") {
          w2++;
        } else {
          if (seenTerritory[cn]) return "Same territory card in two hands: " + cn;
          seenTerritory[cn] = 1;
        }
      }
    }
    if (w1 > 1 || w2 > 1) return "Too many wildcards in preset.";
    return "";
  }

  function mgmCardPresetSummary(payload) {
    if (!payload || !payload.hands) return "";
    var parts = [];
    Object.keys(payload.hands).forEach(function (name) {
      var arr = payload.hands[name];
      if (!Array.isArray(arr) || !arr.length) return;
      parts.push(name + " " + arr.length);
    });
    return parts.join(" · ");
  }

  function getMgmCardPresetStored(slotIndex) {
    var map = loadMgmCardPresetsMap();
    return map[String(slotIndex)] || null;
  }

  function updateMgmCardPresetButtonTitles() {
    var bar = el("mgm-card-preset-bar");
    if (!bar) return;
    Array.prototype.forEach.call(bar.querySelectorAll(".mgm-card-preset-slot"), function (btn) {
      var idx = parseInt(btn.getAttribute("data-preset-index"), 10);
      if (isNaN(idx) || idx < 0 || idx > 5) return;
      var payload = getMgmCardPresetStored(idx);
      var sum = payload ? mgmCardPresetSummary(payload) : "";
      var hint =
        "Click: load preset " +
        (idx + 1) +
        " · Right-click (confirm) or hold ~3s: save current hands · ";
      btn.setAttribute("title", hint + (sum || "Empty — save your layout here."));
    });
  }

  function applyMgmCardPreset(slotIndex) {
    if (!mgmEditorReady || !gameState) return;
    var payload = getMgmCardPresetStored(slotIndex);
    if (!payload || !payload.hands) {
      showStatus("Card preset " + (slotIndex + 1) + " is empty. Right-click or hold a slot to save.");
      return;
    }
    var err = validateMgmCardPresetPayload(payload);
    if (err) {
      showStatus("Cannot load preset " + (slotIndex + 1) + ": " + err);
      return;
    }
    gameState.players.forEach(function (p) {
      p.cards = [];
    });
    gameState.players.forEach(function (p) {
      var list = payload.hands[p.name];
      if (!Array.isArray(list)) return;
      var i;
      for (i = 0; i < list.length && (p.cards || []).length < 5; i++) {
        var cn = typeof list[i] === "string" ? String(list[i]).trim() : "";
        if (!cn) continue;
        p.cards.push(cn);
      }
      syncPlayerAggregates(p);
    });
    rebuildDeck();
    clearDeckCardSelection();
    renderMap();
    var modal = el("mgm-card-modal");
    if (modal && !modal.hasAttribute("hidden")) {
      renderCardModalHands();
      refreshDeckGrid();
    }
    showStatus("Loaded card preset " + (slotIndex + 1) + ".");
  }

  function trySaveMgmCardPresetSlot(slotIndex, how) {
    if (!mgmEditorReady || !gameState) return;
    var payload = captureCardPresetFromGameState();
    var err = validateMgmCardPresetPayload(payload);
    if (err) {
      showStatus("Cannot save preset: " + err);
      return;
    }
    if (how === "menu") {
      if (
        !window.confirm(
          "Save the current card hands (all players) as Card preset " + (slotIndex + 1) + "?"
        )
      ) {
        return;
      }
    }
    var map = loadMgmCardPresetsMap();
    map[String(slotIndex)] = payload;
    persistMgmCardPresetsMap(map);
    updateMgmCardPresetButtonTitles();
    var via = how === "hold" ? " (held ~3s)" : how === "menu" ? " (right-click)" : "";
    showStatus("Saved card preset " + (slotIndex + 1) + via + ".");
  }

  function attachMgmCardPresetSlotListeners(btn, idx) {
    var LONG_MS = 3000;
    var longTimer = null;

    btn.addEventListener("contextmenu", function (e) {
      e.preventDefault();
      trySaveMgmCardPresetSlot(idx, "menu");
    });

    function clearLong() {
      if (longTimer) {
        clearTimeout(longTimer);
        longTimer = null;
      }
    }

    function onPointerDown(e) {
      if (e.type === "mousedown" && e.button !== 0) return;
      clearLong();
      longTimer = setTimeout(function () {
        longTimer = null;
        trySaveMgmCardPresetSlot(idx, "hold");
        btn._mgmCardPresetIgnoreClickUntil = Date.now() + 700;
      }, LONG_MS);
    }

    function onPointerUp() {
      clearLong();
    }

    btn.addEventListener("mousedown", onPointerDown);
    btn.addEventListener("touchstart", onPointerDown, { passive: true });
    btn.addEventListener("mouseup", onPointerUp);
    btn.addEventListener("mouseleave", onPointerUp);
    btn.addEventListener("touchend", onPointerUp);
    btn.addEventListener("touchcancel", onPointerUp);

    btn.addEventListener("click", function (e) {
      if (btn._mgmCardPresetIgnoreClickUntil && Date.now() < btn._mgmCardPresetIgnoreClickUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      applyMgmCardPreset(idx);
    });
  }

  function ensureMgmCardPresetBarWired() {
    var bar = el("mgm-card-preset-bar");
    if (!bar || bar.getAttribute("data-mgm-wired") === "1") return;
    bar.setAttribute("data-mgm-wired", "1");
    bar.innerHTML = "";
    var i;
    for (i = 0; i < 6; i++) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mgm-card-preset-slot";
      btn.setAttribute("data-preset-index", String(i));
      btn.innerHTML =
        '<span class="mgm-card-preset-line">Preset</span><span class="mgm-card-preset-num">' +
        (i + 1) +
        "</span>";
      attachMgmCardPresetSlotListeners(btn, i);
      bar.appendChild(btn);
    }
    updateMgmCardPresetButtonTitles();
  }

  function clearDraftStorage() {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  function renderMap() {
    if (!window.gameUtils || !gameState) return;
    window.RISQUE_MGM_SELECTED_LABELS =
      mgmEditorReady && Array.isArray(mgmSelectedTerritories) ? mgmSelectedTerritories.slice() : [];
    window.gameState = gameState;
    syncAllAggregates();
    rebuildDeck();
    window.gameUtils.renderTerritories(null, gameState, {});
    window.gameUtils.renderStats(gameState);
    renderCardModalHands();
    refreshDeckGrid();
    syncTroopControlUi();
    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
    });
  }

  function syncTroopControlUi() {
    var inp = el("mgm-troop-input");
    var lab = el("mgm-troop-territory");
    if (!inp || !lab) return;
    if (!gameState || !paletteActorName() || !lastTerritory) {
      lab.textContent = "—";
      inp.value = "1";
      inp.disabled = true;
      return;
    }
    if (getOwnerName(lastTerritory) !== paletteActorName()) {
      lab.textContent = "—";
      inp.value = "1";
      inp.disabled = true;
      return;
    }
    var p = gameState.players.find(function (x) {
      return x.name === paletteActorName();
    });
    var t = p && p.territories.find(function (x) {
      return x.name === lastTerritory;
    });
    if (!t) {
      lab.textContent = "—";
      inp.value = "1";
      inp.disabled = true;
      return;
    }
    lab.textContent = lastTerritory.replace(/_/g, " ");
    inp.value = String(Math.max(1, Math.min(9999, Number(t.troops) || 1)));
    inp.disabled = false;
  }

  function applyTroopFromInput() {
    var inp = el("mgm-troop-input");
    if (!inp || inp.disabled || !lastTerritory || !paletteActorName() || !gameState) return;
    if (getOwnerName(lastTerritory) !== paletteActorName()) return;
    var v = parseInt(inp.value, 10);
    if (!Number.isFinite(v) || v < 1) {
      showStatus("Enter a troop count of at least 1.");
      syncTroopControlUi();
      return;
    }
    v = Math.min(9999, v);
    var p = gameState.players.find(function (x) {
      return x.name === paletteActorName();
    });
    var t = p && p.territories.find(function (x) {
      return x.name === lastTerritory;
    });
    if (!t) return;
    t.troops = v;
    inp.value = String(v);
    renderMap();
    showStatus(lastTerritory.replace(/_/g, " ") + ": " + v + " troops.");
  }

  function initMgmToolNav() {
    var buttons = document.querySelectorAll(".mgm-tool-nav-btn[data-mgm-tool]");
    var panels = document.querySelectorAll(".mgm-tool-panel[data-mgm-panel]");
    function showTool(toolId) {
      buttons.forEach(function (b) {
        b.classList.toggle("mgm-tool-nav-btn-active", b.getAttribute("data-mgm-tool") === toolId);
      });
      panels.forEach(function (pan) {
        pan.hidden = pan.getAttribute("data-mgm-panel") !== toolId;
      });
    }
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = btn.getAttribute("data-mgm-tool");
        if (!t) return;
        showTool(t);
      });
    });
    showTool("map");
  }

  function getMgmExportGameBase() {
    if (window.RISQUE_MGM_EXPORT_GAME_BASE == null) return "../";
    return String(window.RISQUE_MGM_EXPORT_GAME_BASE);
  }

  function joinExportBaseAndGameUrl(base, q) {
    var b = String(base || "").replace(/\/+$/, "");
    if (b === "") return q;
    return b + "/" + q.replace(/^\.\//, "");
  }

  function handleTerritoryClick(label, ownerStr, troops, ev) {
    ev = ev || {};
    var multiToggle = !!(ev.ctrlKey || ev.metaKey);
    if (!mgmEditorReady) {
      showStatus("Finish player setup first.");
      return;
    }
    if (multiToggle) {
      var ix = mgmSelectedTerritories.indexOf(label);
      if (ix >= 0) mgmSelectedTerritories.splice(ix, 1);
      else mgmSelectedTerritories.push(label);
      lastTerritory = mgmSelectedTerritories.length ? mgmSelectedTerritories[mgmSelectedTerritories.length - 1] : null;
      syncTroopControlUi();
      renderMap();
      return;
    }

    if (mgmPalettePlayerName == null) {
      showStatus("Palette first.");
      return;
    }
    if (isPaletteUnownedMode()) {
      removeTerritoryFromAll(label);
      mgmSelectedTerritories = [];
      lastTerritory = null;
      syncTroopControlUi();
      renderMap();
      showStatus("Unowned");
      return;
    }
    var actor = paletteActorName();
    if (!actor) {
      showStatus("Palette first.");
      return;
    }
    var owner = ownerStr && ownerStr !== "None" ? ownerStr : null;
    var troopsNum = Number(troops);

    if (owner === actor) {
      if (!multiToggle) {
        mgmSelectedTerritories = [label];
      }
      lastTerritory = label;
      syncTroopControlUi();
      renderMap();
      /* Do not focus #mgm-troop-input here: it steals the next map click (first click blurs input only). */
      return;
    }

    if (!multiToggle) {
      mgmSelectedTerritories = [label];
    }
    lastTerritory = label;
    removeTerritoryFromAll(label);
    var p = gameState.players.find(function (x) {
      return x.name === actor;
    });
    var t = owner ? Math.max(1, troopsNum || 1) : 1;
    p.territories.push({ name: label, troops: t });
    syncTroopControlUi();
    renderMap();
  }

  function createDraftState(playerDefs) {
    var turnOrder = playerDefs.map(function (p) { return p.name; });
    var players = playerDefs.map(function (d, i) {
      return {
        name: d.name,
        color: d.color,
        playerOrder: i + 1,
        bookValue: 0,
        continentValues: {},
        bankValue: 0,
        cardCount: 0,
        cards: [],
        territories: [],
        troopsTotal: 0,
        confirmed: true
      };
    });
    var gs = {
      phase: "attack",
      attackPhase: "attack",
      selectionPhase: "firstCard",
      players: players,
      turnOrder: turnOrder,
      currentPlayer: turnOrder[0],
      round: 1,
      aerialAttack: false,
      aerialAttackEligible: false,
      aerialBridge: null,
      conquered: false,
      conqueredThisTurn: false,
      deck: allCardNames().slice(),
      isInitialDeploy: false,
      continents: buildContinentsObject(),
      continentCollectionCounts: {
        south_america: 0,
        north_america: 0,
        africa: 0,
        europe: 0,
        asia: 0,
        australia: 0
      },
      continentsSnapshot: {},
      cardplayConquered: false,
      cardEarnedViaAttack: false,
      cardEarnedViaCardplay: false,
      cardAwardedThisTurn: false,
      lastCardDrawn: null,
      defeatedPlayer: null,
      winner: null,
      attackingTerritory: null,
      acquiredTerritory: null,
      minTroopsToTransfer: 0,
      transferredCardCount: 0,
      pendingNewContinents: [],
      risquePlayedCardsGallery: [],
      risqueLuckyLedger: { byPlayer: {} },
      risqueLuckySessionRoster: playerDefs.map(function (d) {
        return d.name;
      })
    };
    return gs;
  }

  function territoryLabelsForContinent(continentKey) {
    if (!window.gameUtils || !gameState) return [];
    return window.gameUtils.getContinentTerritoryIdsForBoard(gameState, continentKey).slice();
  }

  function selectContinentTerritories(continentKey) {
    if (!mgmEditorReady || !gameState || !window.gameUtils) return;
    var ids = territoryLabelsForContinent(continentKey);
    if (!ids.length) return;
    mgmSelectedTerritories = ids;
    lastTerritory = mgmSelectedTerritories.length ? mgmSelectedTerritories[mgmSelectedTerritories.length - 1] : null;
    syncTroopControlUi();
    renderMap();
    var dn =
      (window.gameUtils.continentDisplayNames && window.gameUtils.continentDisplayNames[continentKey]) ||
      continentKey;
    showStatus(dn + ": " + mgmSelectedTerritories.length + " territories selected.");
  }

  function buildMgmContinentSelectButtons() {
    var wrap = el("mgm-continent-select-wrap");
    if (!wrap || wrap.getAttribute("data-mgm-continent-btns") === "1") return;
    if (!window.gameUtils || !window.gameUtils.continentDisplayNames) return;
    wrap.setAttribute("data-mgm-continent-btns", "1");
    var names = window.gameUtils.continentDisplayNames;
    CONTINENT_ORDER.forEach(function (key) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mgm-btn mgm-continent-sel-btn";
      b.setAttribute("data-mgm-continent", key);
      b.textContent = names[key] || key;
      b.addEventListener("click", function () {
        selectContinentTerritories(key);
      });
      wrap.appendChild(b);
    });
  }

  function wireDesignerUi() {
    buildMgmContinentSelectButtons();
    var troopInp = el("mgm-troop-input");
    if (troopInp) {
      troopInp.addEventListener("change", applyTroopFromInput);
      troopInp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          applyTroopFromInput();
        }
      });
    }

    var selAll = el("mgm-select-all-terr");
    if (selAll) {
      selAll.onclick = function () {
        mgmSelectedTerritories = allTerritoryLabels().slice();
        lastTerritory =
          mgmSelectedTerritories.length > 0
            ? mgmSelectedTerritories[mgmSelectedTerritories.length - 1]
            : null;
        syncTroopControlUi();
        renderMap();
      };
    }
    var selNone = el("mgm-select-none-terr");
    if (selNone) {
      selNone.onclick = function () {
        mgmSelectedTerritories = [];
        lastTerritory = null;
        syncTroopControlUi();
        renderMap();
      };
    }
    var rndT = el("mgm-random-troops");
    if (rndT) {
      rndT.onclick = function () {
        mgmRandomTroopsOnSelection();
      };
    }

    el("mgm-open-card-assignment").onclick = openCardAssignmentModal;
    el("mgm-card-modal-close").onclick = closeCardAssignmentModal;
    el("mgm-card-modal-done").onclick = closeCardAssignmentModal;
    el("mgm-card-modal-backdrop").onclick = closeCardAssignmentModal;
    document.addEventListener("keydown", function mgmCardModalEsc(ev) {
      if (ev.key !== "Escape") return;
      var m = el("mgm-card-modal");
      if (!m || m.hasAttribute("hidden")) return;
      closeCardAssignmentModal();
    });

    ensureMgmCardPresetBarWired();

    el("mgm-export-ls").onclick = exportToLocalStorage;
    el("mgm-export-file").onclick = exportJsonFile;
    el("mgm-new-session").onclick = function () {
      if (!window.confirm("Discard this mock and return to the login screen?")) return;
      clearDraftStorage();
      location.reload();
    };
    el("mgm-import-file").onchange = onImportFile;

    el("mgm-round").onchange = function () {
      gameState.round = Math.max(1, parseInt(el("mgm-round").value, 10) || 1);
      renderMap();
    };
    el("mgm-first-player").onchange = function () {
      gameState.currentPlayer = el("mgm-first-player").value;
      lastTerritory = null;
      syncTroopControlUi();
      renderMap();
      showStatus("Current player (for export / runtime): " + gameState.currentPlayer);
    };

    CONTINENT_ORDER.forEach(function (key) {
      var sel = el("mgm-cc-" + key);
      if (sel) {
        sel.onchange = function () {
          gameState.continentCollectionCounts[key] = parseInt(sel.value, 10) || 0;
          renderMap();
        };
      }
    });

    var ccApplyAll = el("mgm-cc-apply-all");
    if (ccApplyAll && !ccApplyAll.dataset.mgmWired) {
      ccApplyAll.dataset.mgmWired = "1";
      ccApplyAll.addEventListener("click", function () {
        var bulk = el("mgm-cc-bulk-value");
        applyContinentCollectionToAll(bulk ? bulk.value : "0");
      });
    }
    var ccRandomAll = el("mgm-cc-random-all");
    if (ccRandomAll && !ccRandomAll.dataset.mgmWired) {
      ccRandomAll.dataset.mgmWired = "1";
      ccRandomAll.addEventListener("click", function () {
        randomContinentCollectionsOneToTen();
      });
    }
  }

  function renderCardModalHands() {
    var host = el("mgm-card-modal-hands");
    if (!host) return;
    host.innerHTML = "";
    gameState.players.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "mgm-card-modal-player-block";

      var title = document.createElement("div");
      title.className = "mgm-card-modal-player-title";
      title.style.borderLeft = "4px solid " + (window.gameUtils.colorMap[p.color] || "#888");
      title.textContent = p.name + " (" + (p.cards || []).length + "/5 cards)";

      var drop = document.createElement("div");
      drop.className = "mgm-card-modal-drop";

      function readDroppedCardName(ev) {
        var raw =
          ev.dataTransfer.getData("text/card") ||
          ev.dataTransfer.getData("text/plain") ||
          "";
        raw = String(raw).trim();
        return raw || null;
      }

      function onAssignClick(ev) {
        if (ev.target.closest && ev.target.closest("button")) return;
        if (!selectedDeckCardName) {
          showStatus("Click a card on the right, then click this player’s drop zone (or drag a card here).");
          return;
        }
        tryGiveCard(p.name, selectedDeckCardName);
      }

      title.addEventListener("click", onAssignClick);
      drop.addEventListener("click", onAssignClick);

      /* dragover does not bubble — listeners must be on the actual drop target, not a parent row. */
      drop.addEventListener("dragenter", function (e) {
        e.preventDefault();
        drop.classList.add("drop-hint");
      });
      drop.addEventListener("dragover", function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        drop.classList.add("drop-hint");
      });
      drop.addEventListener("dragleave", function (e) {
        var rt = e.relatedTarget;
        if (!rt || !drop.contains(rt)) drop.classList.remove("drop-hint");
      });
      drop.addEventListener("drop", function (e) {
        e.preventDefault();
        drop.classList.remove("drop-hint");
        var name = readDroppedCardName(e);
        if (name) tryGiveCard(p.name, name);
      });

      (p.cards || []).forEach(function (c) {
        var n = typeof c === "string" ? c : c.name;
        drop.appendChild(makeHandPill(p.name, n));
      });

      row.appendChild(title);
      row.appendChild(drop);
      host.appendChild(row);
    });
  }

  function openCardAssignmentModal() {
    var m = el("mgm-card-modal");
    if (!m) return;
    ensureMgmCardPresetBarWired();
    updateMgmCardPresetButtonTitles();
    clearDeckCardSelection();
    m.removeAttribute("hidden");
    renderCardModalHands();
    refreshDeckGrid();
  }

  function closeCardAssignmentModal() {
    var m = el("mgm-card-modal");
    if (!m) return;
    m.setAttribute("hidden", "");
  }

  function makeHandPill(playerName, cardName) {
    var pill = document.createElement("span");
    pill.className = "hand-pill";
    pill.textContent = cardName.replace(/_/g, " ");
    var x = document.createElement("button");
    x.type = "button";
    x.textContent = "×";
    x.onclick = function () {
      removeCardFromPlayer(playerName, cardName);
    };
    pill.appendChild(x);
    return pill;
  }

  function countCardInGame(cardName) {
    var want = canonicalMgmCardId(cardName);
    if (!want) return 0;
    var n = 0;
    gameState.players.forEach(function (p) {
      (p.cards || []).forEach(function (c) {
        var cn = canonicalMgmCardId(typeof c === "string" ? c : c && c.name);
        if (cn === want) n++;
      });
    });
    return n;
  }

  function tryGiveCard(playerName, cardName) {
    cardName = canonicalMgmCardId(cardName);
    if (!cardName) return;
    var p = gameState.players.find(function (x) { return x.name === playerName; });
    if (!p) return;
    if ((p.cards || []).length >= 5) {
      showStatus("Hand full (max 5). Remove a card first.");
      return;
    }
    if (cardName !== "wildcard1" && cardName !== "wildcard2") {
      if (countCardInGame(cardName) >= 1) {
        showStatus("That territory card is already in a hand.");
        return;
      }
    } else {
      if (countCardInGame(cardName) >= 1) {
        showStatus("That wildcard is already assigned.");
        return;
      }
    }
    p.cards.push(cardName);
    syncPlayerAggregates(p);
    rebuildDeck();
    clearDeckCardSelection();
    showStatus(cardName.replace(/_/g, " ") + " → " + playerName);
    renderMap();
    refreshDeckGrid();
  }

  function removeCardFromPlayer(playerName, cardName) {
    var p = gameState.players.find(function (x) { return x.name === playerName; });
    if (!p || !p.cards) return;
    var idx = -1;
    for (var i = 0; i < p.cards.length; i++) {
      var c = p.cards[i];
      var n = typeof c === "string" ? c : c.name;
      if (n === cardName) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;
    p.cards.splice(idx, 1);
    syncPlayerAggregates(p);
    rebuildDeck();
    renderMap();
    refreshDeckGrid();
  }

  function refreshDeckGrid() {
    var grid = el("deck-card-grid");
    if (!grid) return;
    grid.innerHTML = "";
    var used = cardNamesInHands();
    allCardNames().forEach(function (name) {
      if (used[name]) return;
      var tile = document.createElement("div");
      tile.className = "deck-card-tile";
      if (name === selectedDeckCardName) tile.classList.add("selected");
      tile.textContent = name.replace(/_/g, " ");
      tile.draggable = true;
      tile.dataset.card = name;
      tile.addEventListener("dragstart", function (e) {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.setData("text/card", name);
        tile.classList.add("dragging");
      });
      tile.addEventListener("dragend", function () {
        tile.classList.remove("dragging");
      });
      tile.addEventListener("click", function (ev) {
        ev.stopPropagation();
        selectedDeckCardName = selectedDeckCardName === name ? null : name;
        grid.querySelectorAll(".deck-card-tile").forEach(function (t) {
          var cn = t.getAttribute("data-card");
          t.classList.toggle("selected", cn === selectedDeckCardName);
        });
        showStatus(
          selectedDeckCardName
            ? "Selected: " +
                name.replace(/_/g, " ") +
                " — click a player’s drop zone (or drag onto it)."
            : "Card selection cleared."
        );
      });
      grid.appendChild(tile);
    });
  }

  function normalizeCardsForExport(cards) {
    return (cards || []).map(function (c) {
      var n = typeof c === "string" ? c : c && c.name;
      return { name: n, id: (c && c.id) || makeId() };
    });
  }

  function getSelectedStartPhaseMeta() {
    var v = (el("mgm-start-phase") && el("mgm-start-phase").value) || "attack";
    for (var i = 0; i < START_PHASES.length; i++) {
      if (START_PHASES[i].value === v) {
        return START_PHASES[i];
      }
    }
    return START_PHASES[0];
  }

  function buildRuntimeOpenUrl(meta) {
    if (!meta) {
      meta = START_PHASES[0];
    }
    if (meta.privacyGate) {
      return (
        "game.html?phase=privacyGate&next=" + encodeURIComponent("game.html?phase=cardplay")
      );
    }
    if (meta.deployKind) {
      return "game.html?phase=deploy&kind=" + encodeURIComponent(meta.deployKind);
    }
    if (meta.selectKind) {
      return (
        "game.html?phase=playerSelect&selectKind=" + encodeURIComponent(meta.selectKind)
      );
    }
    return "game.html?phase=" + encodeURIComponent(meta.payloadPhase);
  }

  /** Map saved gameState → &lt;select&gt; value (handles deploy / playerSelect aliases). */
  function startPhaseSelectValueFromGameState(gs) {
    if (!gs || gs.phase == null) {
      return null;
    }
    var ph = String(gs.phase);
    if (ph === "playerSelect") {
      var sk = String(gs.selectionPhase || gs.risquePublicUiSelectKind || "firstCard");
      for (var i = 0; i < START_PHASES.length; i++) {
        var x = START_PHASES[i];
        if (x.payloadPhase === "playerSelect" && x.selectKind === sk) {
          return x.value;
        }
      }
      return "playerSelect_firstCard";
    }
    if (ph === "deploy") {
      try {
        var dr = localStorage.getItem("risqueMirrorDeployRoute");
        if (dr === "deploy1" || dr === "setup") {
          return "deploy1";
        }
      } catch (eDr) {
        /* ignore */
      }
      return "deploy2";
    }
    for (var j = 0; j < START_PHASES.length; j++) {
      var o = START_PHASES[j];
      if (o.payloadPhase === ph && !o.selectKind && !o.deployKind && !o.privacyGate) {
        return o.value;
      }
    }
    return null;
  }

  function syncStartPhaseSelectFromGameState(gs) {
    var sel = el("mgm-start-phase");
    if (!sel || !gs) {
      return;
    }
    var v = startPhaseSelectValueFromGameState(gs);
    if (v) {
      sel.value = v;
    }
  }

  /**
   * Remove fields that belong to other phases or a live session — they confuse the runtime when
   * loading a hand-built JSON (e.g. frozen cardplay mirror + income phase, or stale deploy banners).
   */
  function stripMockMakerEphemeralFields(gs) {
    if (!gs || typeof gs !== "object") return;
    var ph = String(gs.phase || "");
    if (ph !== "cardplay" && ph !== "con-cardplay") {
      delete gs.risqueCardplayUseFrozenPublicMirror;
      delete gs.risqueCardplayPublicMirrorSnapshot;
      delete gs.risqueCardplayPublicPlayerSnapshot;
      delete gs.risqueCardplaySuppressPublicSpectator;
      delete gs.risqueCardplayTvRecapPublished;
      delete gs.risquePublicCardplayRecap;
      delete gs.risquePublicCardplayRecapAckRequiredSeq;
      delete gs.risquePublicCardplayRecapSeq;
      delete gs.risquePublicCardplayAerialSkipHostDecisionSeq;
      delete gs.risquePublicCardplayPrimary;
      delete gs.risquePublicCardplayReport;
      delete gs.risquePublicCardplayHighlightLabels;
    }
    if (
      (ph === "cardplay" || ph === "con-cardplay") &&
      window.gameUtils &&
      typeof window.gameUtils.clearStaleConquestCardplayFieldsUnlessChain === "function"
    ) {
      window.gameUtils.clearStaleConquestCardplayFieldsUnlessChain(gs);
    }
    if (ph !== "deploy" && ph !== "deploy1" && ph !== "deploy2") {
      delete gs.risquePublicDeployBanner;
      delete gs.risqueDeployMirrorDraft;
    }
    if (ph !== "income" && ph !== "con-income") {
      delete gs.risquePublicIncomeBreakdown;
    }
  }

  /**
   * Same numbers as phases/income.js incomeInit — so a saved JSON opened at phase=income already
   * has {@link gameState.risquePublicIncomeBreakdown}; private HUD + refreshVisuals can paint the grid
   * before income.js mount runs (MGM exports used to omit this and looked “broken” vs login play).
   */
  function attachIncomeBreakdownForIncomeExport(gs) {
    if (!gs || typeof gs !== "object") return;
    var ph = String(gs.phase || "");
    if (ph !== "income" && ph !== "con-income") return;
    if (!window.gameUtils || typeof window.gameUtils.getPlayerContinents !== "function") return;
    if (!gs.continentCollectionCounts) {
      gs.continentCollectionCounts = {
        south_america: 0,
        north_america: 0,
        africa: 0,
        europe: 0,
        asia: 0,
        australia: 0
      };
    }
    var currentPlayer = gs.players && gs.players.find(function (p) {
      return p && p.name === gs.currentPlayer;
    });
    if (!currentPlayer) return;
    var territoryCount = (currentPlayer.territories || []).length;
    var territoryBonus = Math.max(Math.floor(territoryCount / 3), 3);
    var bookCount = gs.bookPlayedThisTurn ? currentPlayer.bookValue || 0 : 0;
    var bookBonus = bookCount * 10;
    var ownedContinents = window.gameUtils.getPlayerContinents(currentPlayer);
    var continentBonus = ownedContinents.reduce(function (sum, continent) {
      var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
        return window.gameUtils.continentDisplayNames[k] === continent;
      });
      var collectionCount = gs.continentCollectionCounts[key] || 0;
      return sum + window.gameUtils.getNextContinentValue(key, collectionCount);
    }, 0);
    var continentRowsForMirror = [];
    ownedContinents.forEach(function (c) {
      var cKey = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
        return window.gameUtils.continentDisplayNames[k] === c;
      });
      var cVal =
        cKey != null
          ? window.gameUtils.getNextContinentValue(cKey, gs.continentCollectionCounts[cKey] || 0)
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
    var total = territoryBonus + bookBonus + continentBonus;
    gs.risquePublicIncomeBreakdown = {
      territoryCount: territoryCount,
      territoryBonus: territoryBonus,
      continentRows: continentRowsForMirror,
      showBook: !!(gs.bookPlayedThisTurn && bookBonus > 0),
      bookCount: bookCount,
      bookBonus: bookBonus,
      total: total
    };
  }

  function finalizeStateForExport() {
    syncContinentBonusesFromRules();
    syncAllAggregates();
    dedupeMgmHandsAcrossPlayers();
    rebuildDeck();
    var meta = getSelectedStartPhaseMeta();
    var copy = JSON.parse(JSON.stringify(gameState));
    copy.phase = meta.privacyGate ? "cardplay" : meta.payloadPhase;
    if (meta.selectKind) {
      copy.selectionPhase = meta.selectKind;
    } else if (!copy.selectionPhase) {
      copy.selectionPhase = "firstCard";
    }
    copy.attackPhase = "attack";
    copy.attackingTerritory = null;
    copy.acquiredTerritory = null;
    copy.minTroopsToTransfer = 0;
    copy.conqueredThisTurn = false;
    copy.players.forEach(function (p) {
      p.cards = normalizeCardsForExport(p.cards);
      p.cardCount = p.cards.length;
      syncPlayerAggregates(p);
    });
    var used = {};
    copy.players.forEach(function (p) {
      p.cards.forEach(function (c) {
        used[c.name] = true;
      });
    });
    copy.deck = allCardNames().filter(function (n) {
      return !used[n];
    });
    copy.round = Math.max(1, parseInt(el("mgm-round").value, 10) || 1);
    copy.currentPlayer = el("mgm-first-player").value || copy.turnOrder[0];
    if (meta.deployKind === "setup") {
      try {
        localStorage.setItem("risqueMirrorDeployRoute", "deploy1");
      } catch (eDep) {
        /* ignore */
      }
    } else if (meta.deployKind === "turn") {
      try {
        localStorage.setItem("risqueMirrorDeployRoute", "deploy2");
      } catch (eDep2) {
        /* ignore */
      }
    }
    copy.setupComplete = true;
    stripMockMakerEphemeralFields(copy);
    attachIncomeBreakdownForIncomeExport(copy);
    ensureMgmExportShellDefaults(copy);
    stripMgmExportVolatileRuntimeKeys(copy);
    var keepImportedTape = existingTapeHasBattlePlayback(copy);
    stripMgmExportLiveReplayKeys(copy);
    if (!keepImportedTape) {
      var tapeOut = buildSyntheticReplayTape(copy);
      if (tapeOut) {
        copy.risqueReplayTape = tapeOut;
        delete copy.risqueReplayByRound;
      }
    }
    ensureMgmReplayTapeSidecar(copy);
    return { payload: copy, startMeta: meta };
  }

  function validateSoft() {
    var labels = allTerritoryLabels();
    var assigned = {};
    var problems = [];
    gameState.players.forEach(function (p) {
      p.territories.forEach(function (t) {
        if (assigned[t.name]) problems.push(t.name + " on two players");
        assigned[t.name] = p.name;
      });
    });
    labels.forEach(function (lab) {
      if (!assigned[lab]) problems.push(lab.replace(/_/g, " ") + " unowned");
    });
    return problems;
  }

  function exportToLocalStorage() {
    var problems = validateSoft();
    if (problems.length) {
      var ok = window.confirm(
        "Warnings:\n• " + problems.slice(0, 8).join("\n• ") +
        (problems.length > 8 ? "\n…" : "") +
        "\n\nExport anyway?"
      );
      if (!ok) return;
    }
    var fin = finalizeStateForExport();
    try {
      localStorage.setItem("gameState", JSON.stringify(fin.payload));
    } catch (e) {
      alert("Could not write localStorage: " + (e.message || e));
      return;
    }
    clearDraftStorage();
    var q = buildRuntimeOpenUrl(fin.startMeta);
    var base = getMgmExportGameBase();
    if (base === "") {
      showStatus(
        "Saved gameState to localStorage. Set window.RISQUE_MGM_EXPORT_GAME_BASE (e.g. \"../\") to jump to game.html, or open the main game and load from storage / your JSON file."
      );
      return;
    }
    window.location.href = joinExportBaseAndGameUrl(base, q);
  }

  function sanitizeExportBasename(raw) {
    var s = (raw || "").trim() || "risque-mock-game";
    s = s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-");
    if (s.length > 120) s = s.slice(0, 120);
    return s || "risque-mock-game";
  }

  function fallbackDownloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJsonFile() {
    var fin = finalizeStateForExport();
    var base = sanitizeExportBasename(el("mgm-export-filename") && el("mgm-export-filename").value);
    var filename = /\.json$/i.test(base) ? base : base + ".json";
    var blob = new Blob([JSON.stringify(fin.payload, null, 2)], { type: "application/json" });

    if (typeof window.showSaveFilePicker === "function") {
      window
        .showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "JSON",
              accept: { "application/json": [".json"] }
            }
          ]
        })
        .then(function (handle) {
          return handle.createWritable();
        })
        .then(function (writable) {
          return writable.write(blob).then(function () {
            return writable.close();
          });
        })
        .then(function () {
          showStatus("Saved where you chose in the dialog.");
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") {
            showStatus("Save cancelled.");
            return;
          }
          console.warn("[Mock Game Maker] showSaveFilePicker failed", err);
          fallbackDownloadBlob(blob, filename);
          showStatus("Could not open Save dialog — downloaded “" + filename + "” instead.");
        });
    } else {
      fallbackDownloadBlob(blob, filename);
      showStatus(
        "This browser can’t pick a save folder here. Downloaded “" +
          filename +
          "”. Use Chrome or Edge (or open this site over http://localhost) to get a full Save dialog."
      );
    }
  }

  function onTerritoryWheel(e) {
    if (!mgmEditorReady || !gameState || !paletteActorName()) return;
    if (!window.RISQUE_MOCK_MAKER && !e.altKey) return;
    var t = e.target;
    if (!t) return;
    var tag = t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON") return;
    var label = null;
    if (typeof t.closest === "function") {
      var node = t.closest("[data-label]");
      if (node) label = node.getAttribute("data-label");
    }
    if (!label) {
      var onMap =
        typeof t.closest === "function" &&
        (t.closest("#canvas") || t.closest(".svg-overlay"));
      if (
        onMap &&
        lastTerritory &&
        getOwnerName(lastTerritory) === paletteActorName()
      ) {
        label = lastTerritory;
      } else {
        return;
      }
    }
    if (!label) return;
    if (getOwnerName(label) !== paletteActorName()) return;
    e.preventDefault();
    e.stopPropagation();
    var step = e.deltaY < 0 ? 1 : -1;
    if (e.shiftKey) step *= 5;
    var p = gameState.players.find(function (x) {
      return x.name === paletteActorName();
    });
    var terr = p && p.territories.find(function (x) {
      return x.name === label;
    });
    if (!terr) return;
    terr.troops = Math.max(1, Math.min(9999, (Number(terr.troops) || 1) + step));
    lastTerritory = label;
    showStatus(
      label.replace(/_/g, " ") +
        ": " +
        terr.troops +
        " troops (wheel" +
        (window.RISQUE_MOCK_MAKER ? "" : " with Alt") +
        "; Shift = ±5)"
    );
    renderMap();
  }

  function attachMapWheelListener() {
    var host = document.getElementById("canvas");
    if (!host || host.dataset.mgmWheelBound === "1") return;
    host.dataset.mgmWheelBound = "1";
    /* Capture on #canvas so wheel reaches territory nodes reliably (SVG-only listeners can be flaky). */
    host.addEventListener("wheel", onTerritoryWheel, { passive: false, capture: true });
  }

  function wrapMockMakerResizeCanvas() {
    if (window.__mgmCoreResizeCanvas) return;
    window.__mgmCoreResizeCanvas = window.gameUtils.resizeCanvas.bind(window.gameUtils);
    window.gameUtils.resizeCanvas = function () {
      var canvas = document.getElementById("canvas");
      if (!canvas) return;
      var sd = el("screen-designer");
      var inMaker = !!window.RISQUE_MOCK_MAKER && sd && el("mgm-designer-root");
      if (!inMaker) {
        window.__mgmCoreResizeCanvas();
        return;
      }
      var root = el("mgm-designer-root");
      var frame = el("mgm-designer-frame");
      var pad = 20;
      var scale = Math.min(
        (window.innerHeight - pad) / MGM_BOARD_H,
        (window.innerWidth - pad) / MGM_BOARD_W
      );
      if (scale <= 0 || !isFinite(scale)) scale = 0.25;
      if (root) {
        root.style.width = Math.max(1, MGM_BOARD_W * scale) + "px";
        root.style.height = Math.max(1, MGM_BOARD_H * scale) + "px";
      }
      if (frame) {
        frame.style.transform = "scale(" + scale + ")";
        frame.style.transformOrigin = "top left";
      }
      canvas.style.transform = "none";
      canvas.classList.add("visible");
      var stageImage = document.querySelector(".stage-image");
      var svgOverlay = document.querySelector(".svg-overlay");
      if (stageImage) stageImage.classList.add("visible");
      if (svgOverlay) svgOverlay.classList.add("visible");
      var uiOverlay = document.querySelector(".ui-overlay");
      if (uiOverlay) uiOverlay.classList.add("visible");
    };
  }

  function onImportFile(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        var data = null;
        if (
          window.risquePhases &&
          window.risquePhases.login &&
          typeof window.risquePhases.login.normalizeImportedGameState === "function"
        ) {
          data = window.risquePhases.login.normalizeImportedGameState(parsed);
        }
        if (!data) {
          window.alert(
            "Could not load this JSON as a RISQUE save.\n\n" +
              "• Choose the actual .json file (browsers cannot import a whole folder).\n" +
              "• Need at least 2 players with names. Saves wrapped as { \"gameState\": { … } } are OK.\n" +
              "• Update phases/login.js from your RISQUE build if this tool is old."
          );
          ev.target.value = "";
          return;
        }
        ingestImportedState(data);
      } catch (err) {
        window.alert("Invalid JSON: " + (err.message || err));
      }
      ev.target.value = "";
    };
    reader.readAsText(f);
  }

  function ensureDesignerMounted() {
    if (!shellMounted) {
      window.gameUtils.initStyles();
      shellMounted = true;
    }
    window.gameUtils.initGameView();
    var img = document.querySelector(".stage-image");
    if (img) img.src = "../assets/images/stage.png";
    window.handleTerritoryClick = handleTerritoryClick;
    var svg = document.querySelector(".svg-overlay");
    if (svg) svg.classList.add("visible");
    if (img) img.classList.add("visible");
    wrapMockMakerResizeCanvas();
    attachMapWheelListener();
    if (!designerUiWired) {
      wireDesignerUi();
      designerUiWired = true;
      window.addEventListener("resize", function () {
        if (window.gameUtils && window.gameUtils.resizeCanvas) window.gameUtils.resizeCanvas();
      });
    }
  }

  function ingestImportedState(data) {
    if (
      window.risquePhases &&
      window.risquePhases.login &&
      typeof window.risquePhases.login.normalizeImportedGameState === "function"
    ) {
      var again = window.risquePhases.login.normalizeImportedGameState(data);
      if (again) data = again;
    }
    if (!data.players || !Array.isArray(data.players) || data.players.length < 2) {
      alert("Need at least 2 players in JSON.");
      return;
    }
    data.players.forEach(function (p) {
      p.cards = (p.cards || []).map(function (c) {
        return typeof c === "string" ? c : c.name;
      });
    });
    gameState = data;
    dedupeMgmHandsAcrossPlayers();
    rebuildDeck();
    if (!gameState.turnOrder || !gameState.turnOrder.length) {
      gameState.turnOrder = gameState.players.map(function (p) {
        return p.name;
      });
    }
    if (!gameState.turnOrder.some(function (n) { return n === gameState.currentPlayer; })) {
      gameState.currentPlayer = gameState.turnOrder[0];
    }
    if (!gameState.continents) gameState.continents = buildContinentsObject();
    syncContinentBonusesFromRules();
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
    var embedHost = el("mgm-embedded-login-host");
    if (embedHost) embedHost.innerHTML = "";
    var chrome = el("mgm-editor-chrome");
    if (chrome) chrome.hidden = false;
    mgmEditorReady = true;
    el("screen-designer").hidden = false;
    ensureDesignerMounted();
    window.gameState = gameState;
    el("mgm-round").value = String(gameState.round || 1);
    fillFirstPlayerSelect();
    fillContinentCountSelectors();
    mgmSelectedTerritories = [];
    mgmPalettePlayerName = gameState.currentPlayer || gameState.turnOrder[0];
    renderMgmPalette();
    syncStartPhaseSelectFromGameState(gameState);
    renderMap();
    showStatus("Imported JSON.");
  }

  function fillFirstPlayerSelect() {
    var sel = el("mgm-first-player");
    sel.innerHTML = "";
    gameState.turnOrder.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      if (n === gameState.currentPlayer) o.selected = true;
      sel.appendChild(o);
    });
  }

  function ensureContinentBulkValueSelect() {
    var bulk = el("mgm-cc-bulk-value");
    if (!bulk || bulk.options.length > 0) return;
    for (var v = 0; v <= 20; v++) {
      var o = document.createElement("option");
      o.value = String(v);
      o.textContent = String(v);
      bulk.appendChild(o);
    }
  }

  function syncContinentCollectionSelectsFromState() {
    if (!gameState || !gameState.continentCollectionCounts) return;
    CONTINENT_ORDER.forEach(function (key) {
      var sel = el("mgm-cc-" + key);
      if (!sel) return;
      var v = Math.max(0, Math.min(20, parseInt(gameState.continentCollectionCounts[key], 10) || 0));
      gameState.continentCollectionCounts[key] = v;
      sel.value = String(v);
    });
  }

  function applyContinentCollectionToAll(value) {
    if (!mgmEditorReady || !gameState || !gameState.continentCollectionCounts) return;
    var v = Math.max(0, Math.min(20, parseInt(value, 10) || 0));
    CONTINENT_ORDER.forEach(function (key) {
      gameState.continentCollectionCounts[key] = v;
    });
    syncContinentCollectionSelectsFromState();
    var bulk = el("mgm-cc-bulk-value");
    if (bulk) bulk.value = String(v);
    renderMap();
    showStatus("All continents: collection count " + v + ".");
  }

  function randomContinentCollectionsOneToTen() {
    if (!mgmEditorReady || !gameState || !gameState.continentCollectionCounts) return;
    CONTINENT_ORDER.forEach(function (key) {
      gameState.continentCollectionCounts[key] = 1 + Math.floor(Math.random() * 10);
    });
    syncContinentCollectionSelectsFromState();
    renderMap();
    showStatus("All continents: random collection count 1–10.");
  }

  function fillContinentCountSelectors() {
    ensureContinentBulkValueSelect();
    CONTINENT_ORDER.forEach(function (key) {
      var sel = el("mgm-cc-" + key);
      if (!sel) return;
      var current = gameState.continentCollectionCounts[key] || 0;
      sel.innerHTML = "";
      for (var v = 0; v <= 20; v++) {
        var o = document.createElement("option");
        o.value = String(v);
        o.textContent = String(v);
        if (v === current) o.selected = true;
        sel.appendChild(o);
      }
    });
    var bulk = el("mgm-cc-bulk-value");
    if (bulk && bulk.options.length) {
      var firstKey = CONTINENT_ORDER[0];
      var sample = gameState.continentCollectionCounts[firstKey];
      bulk.value = String(Math.max(0, Math.min(20, parseInt(sample, 10) || 0)));
    }
  }

  function startDesignerWithPlayerDefs(defs) {
    if (!defs || defs.length < 2) {
      alert("Need at least 2 players.");
      return;
    }
    var chrome = el("mgm-editor-chrome");
    if (chrome) chrome.hidden = false;
    gameState = createDraftState(defs);
    el("mgm-round").value = "1";
    fillFirstPlayerSelect();
    fillContinentCountSelectors();
    el("screen-designer").hidden = false;
    ensureDesignerMounted();
    window.gameState = gameState;
    mgmSelectedTerritories = [];
    mgmPalettePlayerName = gameState.currentPlayer || gameState.turnOrder[0];
    renderMgmPalette();
    mgmEditorReady = true;
    renderMap();
    showStatus("Ready");
  }

  /** Temporary lineup so the map can render all gray 001 chips before real login. */
  function mgmPlaceholderPlayerDefs() {
    return [
      { name: "P1", color: "blue" },
      { name: "P2", color: "red" }
    ];
  }

  function bootstrapMgmPreLogin() {
    mgmEditorReady = false;
    var chrome = el("mgm-editor-chrome");
    if (chrome) chrome.hidden = true;
    var host = el("mgm-embedded-login-host");
    if (host) host.innerHTML = "";
    gameState = createDraftState(mgmPlaceholderPlayerDefs());
    el("mgm-round").value = "1";
    fillFirstPlayerSelect();
    fillContinentCountSelectors();
    ensureDesignerMounted();
    window.gameState = gameState;
    mgmSelectedTerritories = [];
    mgmPalettePlayerName = gameState.players[0] ? gameState.players[0].name : null;
    renderMgmPalette();
    renderMap();
  }

  function mountMockLogin() {
    if (!window.risquePhases || !window.risquePhases.login) {
      alert("Login module missing — check that ../phases/login.js loads.");
      return;
    }
    var embedHost = el("mgm-embedded-login-host");
    if (!embedHost) {
      alert("Missing #mgm-embedded-login-host.");
      return;
    }
    window.risquePhases.login.mount(null, {
      embedHost: embedHost,
      welcomeText: "MOCK GAME MAKER",
      loginPrompt: "INPUT PLAYER NAME AND CHOOSE COLOR",
      loginButtonLabel: "OPEN MOCK EDITOR",
      loadButtonLabel: "IMPORT MOCK JSON",
      skipPersist: true,
      skipFixResumePhase: true,
      legacyNext: "#",
      loadRedirect: "#",
      loginRedirectDelayMs: 0,
      onLoginSuccess: function (gs) {
        var defs = gs.players.map(function (p) {
          return { name: p.name, color: p.color };
        });
        startDesignerWithPlayerDefs(defs);
      },
      onLoadSuccess: function (gs) {
        ingestImportedState(gs);
      }
    });
  }

  function initStartPhaseSelect() {
    var sel = el("mgm-start-phase");
    sel.innerHTML = "";
    START_PHASES.forEach(function (o) {
      var opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    sel.value = "attack";
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!window.gameUtils) {
      alert("gameUtils missing — ensure ../js/core.js loads before mgm.js.");
      return;
    }
    initMgmToolNav();
    initStartPhaseSelect();
    /* Always start fresh: do not restore the last mock from localStorage. */
    clearDraftStorage();
    bootstrapMgmPreLogin();
    mountMockLogin();
  });
})();
