let gameState = {};
var __risqueTransferPulseRafId = null;
var __risqueTransferPulseTickingStartMs = null;
/** Set `window.RISQUE_DEBUG_CORE = true` in the console for verbose Core logging. */
function risqueCoreDebugLog() {
  if (typeof window !== 'undefined' && window.RISQUE_DEBUG_CORE === true) {
    console.log.apply(console, arguments);
  }
}
/**
 * Territory markers render into the SVG inside #canvas only. Avoid document.querySelector('.svg-overlay'):
 * phase-transition freeze clones can insert extra roots and break first-match updates.
 */
function risqueGetCanvasSvgOverlay() {
  var canvas = document.getElementById('canvas');
  return canvas ? canvas.querySelector('.svg-overlay') : null;
}
window.risqueGetCanvasSvgOverlay = risqueGetCanvasSvgOverlay;

let isLaunchPage = true;
window.gameUtils = {
  territories: {
    afghanistan: { x: 748.18703, y: 468.32483, r: 30 },
    alaska: { x: 64.842522, y: 265.11024, r: 30 },
    alberta: { x: 146.86418, y: 365.16731, r: 30 },
    argentina: { x: 216.67912, y: 865.5414, r: 30 },
    brazil: { x: 284.95276, y: 732.33664, r: 30 },
    central_america: { x: 170.62205, y: 576.33074, r: 30 },
    china: { x: 855.15353, y: 493.48229, r: 30 },
    congo: { x: 595.46457, y: 748.55315, r: 30 },
    east_africa: { x: 641.71065, y: 681.1122, r: 30 },
    eastern_australia: { x: 1031.498, y: 746.77561, r: 30 },
    eastern_united_states: { x: 235.21063, y: 484.45871, r: 30 },
    egypt: { x: 582.83267, y: 621.50789, r: 30 },
    great_britain: { x: 498.44884, y: 456.57284, r: 30 },
    greenland: { x: 439.11614, y: 186.99803, r: 30 },
    iceland: { x: 515.34449, y: 294.36614, r: 30 },
    india: { x: 784.82483, y: 575.37996, r: 30 },
    indonesia: { x: 919.56503, y: 651.08858, r: 30 },
    irkutsk: { x: 916.07483, y: 338.23819, r: 30 },
    japan: { x: 985.51178, y: 454.41733, r: 30 },
    kamchatka: { x: 1027.0748, y: 309.67323, r: 30 },
    madagascar: { x: 685.31104, y: 834.99803, r: 30 },
    middle_east: { x: 681.33664, y: 589.1575, r: 30 },
    mongolia: { x: 909.8268, y: 427.87798, r: 30 },
    new_guinea: { x: 1025.3918, y: 655.91931, r: 30 },
    north_africa: { x: 508.37009, y: 669.15949, r: 30 },
    northern_europe: { x: 565.99608, y: 468.75595, r: 30 },
    northwest_territory: { x: 152.10828, y: 280.28149, r: 30 },
    ontario: { x: 242.19095, y: 368.77561, r: 30 },
    peru: { x: 200.3622, y: 765.23618, r: 30 },
    quebec: { x: 335.49802, y: 392.32682, r: 30 },
    scandinavia: { x: 578.69884, y: 349.31694, r: 30 },
    siam: { x: 881.69294, y: 581.48035, r: 30 },
    siberia: { x: 843.189, y: 196.64172, r: 30 },
    south_africa: { x: 602.40358, y: 829.0689, r: 30 },
    southern_europe: { x: 595.3347, y: 536.85237, r: 30 },
    ukraine: { x: 659.55711, y: 373.06298, r: 30 },
    ural: { x: 770.04923, y: 331.71261, r: 30 },
    venezuela: { x: 201.64369, y: 644.07278, r: 30 },
    western_australia: { x: 939.25995, y: 751.57681, r: 30 },
    western_europe: { x: 512.22638, y: 537.55513, r: 30 },
    western_united_states: { x: 142.3996, y: 456.57874, r: 30 },
    yakutsk: { x: 954.67323, y: 213.27755, r: 30 }
  },
  continents: {
    south_america: ['argentina', 'brazil', 'peru', 'venezuela'],
    north_america: ['alaska', 'alberta', 'central_america', 'eastern_united_states', 'greenland', 'northwest_territory', 'ontario', 'quebec', 'western_united_states'],
    africa: ['congo', 'east_africa', 'egypt', 'madagascar', 'north_africa', 'south_africa'],
    europe: ['great_britain', 'iceland', 'northern_europe', 'scandinavia', 'southern_europe', 'ukraine', 'western_europe'],
    asia: ['afghanistan', 'china', 'india', 'irkutsk', 'japan', 'kamchatka', 'middle_east', 'mongolia', 'siam', 'siberia', 'ural', 'yakutsk'],
    australia: ['eastern_australia', 'indonesia', 'new_guinea', 'western_australia']
  },
  continentValues: {
    south_america: { value: 2, increment: 2, bg: '#00ff00' },
    north_america: { value: 5, increment: 5, bg: '#ffff00' },
    africa: { value: 3, increment: 3, bg: '#ffa500' },
    europe: { value: 5, increment: 5, bg: '#008080' },
    asia: { value: 7, increment: 7, bg: '#90ee90' },
    australia: { value: 2, increment: 2, bg: '#e6e6fa' }
  },
  continentDisplayNames: {
    south_america: 'S. America',
    north_america: 'N. America',
    africa: 'Africa',
    europe: 'Europe',
    asia: 'Asia',
    australia: 'Australia'
  },
  adjacencies: {
    afghanistan: ["china", "india", "middle_east", "ukraine", "ural"],
    alaska: ["kamchatka", "northwest_territory", "alberta"],
    alberta: ["alaska", "northwest_territory", "ontario", "western_united_states"],
    argentina: ["brazil", "peru"],
    brazil: ["argentina", "peru", "venezuela", "north_africa"],
    central_america: ["venezuela", "eastern_united_states", "western_united_states"],
    china: ["afghanistan", "india", "siam", "mongolia", "siberia", "ural"],
    congo: ["east_africa", "north_africa", "south_africa"],
    east_africa: ["congo", "egypt", "madagascar", "north_africa", "south_africa", "middle_east"],
    eastern_australia: ["new_guinea", "western_australia"],
    eastern_united_states: ["central_america", "ontario", "quebec", "western_united_states"],
    egypt: ["east_africa", "north_africa", "southern_europe", "middle_east"],
    great_britain: ["iceland", "northern_europe", "scandinavia", "western_europe"],
    greenland: ["iceland", "ontario", "northwest_territory", "quebec"],
    iceland: ["greenland", "great_britain", "scandinavia"],
    india: ["afghanistan", "china", "siam", "middle_east"],
    indonesia: ["new_guinea", "siam", "western_australia"],
    irkutsk: ["kamchatka", "mongolia", "siberia", "yakutsk"],
    japan: ["kamchatka", "mongolia"],
    kamchatka: ["alaska", "irkutsk", "mongolia", "japan", "yakutsk"],
    madagascar: ["east_africa", "south_africa"],
    middle_east: ["afghanistan", "east_africa", "egypt", "india", "southern_europe", "ukraine"],
    mongolia: ["china", "irkutsk", "japan", "siberia", "kamchatka"],
    new_guinea: ["eastern_australia", "indonesia", "western_australia"],
    north_africa: ["brazil", "congo", "east_africa", "egypt", "southern_europe", "western_europe"],
    northern_europe: ["great_britain", "scandinavia", "southern_europe", "ukraine", "western_europe"],
    northwest_territory: ["alaska", "alberta", "ontario", "greenland"],
    ontario: ["alberta", "eastern_united_states", "northwest_territory", "quebec", "western_united_states", "greenland"],
    peru: ["argentina", "brazil", "venezuela"],
    quebec: ["eastern_united_states", "ontario", "greenland"],
    scandinavia: ["great_britain", "iceland", "northern_europe", "ukraine"],
    siam: ["china", "india", "indonesia"],
    siberia: ["china", "irkutsk", "mongolia", "ural", "yakutsk"],
    south_africa: ["congo", "east_africa", "madagascar"],
    southern_europe: ["egypt", "north_africa", "northern_europe", "western_europe", "middle_east", "ukraine"],
    ukraine: ["afghanistan", "middle_east", "northern_europe", "scandinavia", "southern_europe", "ural"],
    ural: ["afghanistan", "china", "siberia", "ukraine"],
    venezuela: ["brazil", "central_america", "peru"],
    western_australia: ["eastern_australia", "indonesia", "new_guinea"],
    western_europe: ["great_britain", "north_africa", "northern_europe", "southern_europe"],
    western_united_states: ["alberta", "central_america", "eastern_united_states", "ontario"],
    yakutsk: ["irkutsk", "kamchatka", "siberia"]
  },
  cardNames: [
    'afghanistan', 'alaska', 'alberta', 'argentina', 'brazil', 'central_america', 'china',
    'congo', 'east_africa', 'eastern_australia', 'eastern_united_states', 'egypt', 'great_britain',
    'greenland', 'iceland', 'india', 'indonesia', 'irkutsk', 'japan', 'kamchatka', 'madagascar',
    'middle_east', 'mongolia', 'new_guinea', 'north_africa', 'northern_europe', 'northwest_territory',
    'ontario', 'peru', 'quebec', 'scandinavia', 'siam', 'siberia', 'south_africa', 'southern_europe',
    'ukraine', 'ural', 'venezuela', 'western_australia', 'western_europe', 'western_united_states',
    'yakutsk', 'wildcard1', 'wildcard2'
  ],
  cardTypes: {
    afghanistan: 'infantry', alaska: 'artillery', alberta: 'artillery', argentina: 'infantry',
    brazil: 'infantry', central_america: 'infantry', china: 'artillery', congo: 'artillery',
    east_africa: 'infantry', eastern_australia: 'cavalry', eastern_united_states: 'artillery',
    egypt: 'cavalry', great_britain: 'infantry', greenland: 'cavalry', iceland: 'cavalry',
    india: 'cavalry', indonesia: 'infantry', irkutsk: 'artillery', japan: 'cavalry',
    kamchatka: 'artillery', madagascar: 'cavalry', middle_east: 'artillery', mongolia: 'cavalry',
    new_guinea: 'cavalry', north_africa: 'infantry', northern_europe: 'cavalry',
    northwest_territory: 'cavalry', ontario: 'artillery', peru: 'cavalry', quebec: 'artillery',
    scandinavia: 'infantry', siam: 'cavalry', siberia: 'infantry', south_africa: 'artillery',
    southern_europe: 'infantry', ukraine: 'infantry', ural: 'infantry', venezuela: 'cavalry',
    western_australia: 'artillery', western_europe: 'infantry', western_united_states: 'artillery',
    yakutsk: 'artillery', wildcard1: 'wildcard', wildcard2: 'wildcard'
  },
  risqueEnsureDiscardPile: function (gameState) {
    if (!gameState || typeof gameState !== 'object') return;
    if (!Array.isArray(gameState.discardPile)) gameState.discardPile = [];
  },
  risqueShuffleStringArray: function (arr) {
    var copy = Array.isArray(arr) ? arr.slice() : [];
    for (var i = copy.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  },
  /**
   * When the draw pile is empty but the discard has cards, shuffle discard into the deck (Risk-style).
   */
  risqueMaybeReshuffleDiscardIntoDeck: function (gameState) {
    this.risqueEnsureDiscardPile(gameState);
    if (!gameState) return false;
    if (!Array.isArray(gameState.deck)) gameState.deck = [];
    if (gameState.deck.length > 0) return false;
    if (!gameState.discardPile.length) return false;
    gameState.deck = this.risqueShuffleStringArray(gameState.discardPile);
    gameState.discardPile = [];
    return true;
  },
  /** Permanent plays: card names leave circulation until reshuffled into the deck. */
  risqueDiscardCardNames: function (gameState, names) {
    this.risqueEnsureDiscardPile(gameState);
    if (!gameState || !names || !names.length) return;
    var self = this;
    names.forEach(function (nm) {
      if (!nm || self.cardNames.indexOf(nm) === -1) return;
      gameState.discardPile.push(nm);
      if (Array.isArray(gameState.deck)) {
        var ix = gameState.deck.indexOf(nm);
        if (ix !== -1) gameState.deck.splice(ix, 1);
      }
    });
  },
  /** Undo a pending play when a card returns to hand before confirm (one instance of name). */
  risqueReturnCardNameFromDiscard: function (gameState, name) {
    this.risqueEnsureDiscardPile(gameState);
    if (!name || !Array.isArray(gameState.discardPile)) return;
    for (var i = gameState.discardPile.length - 1; i >= 0; i--) {
      if (gameState.discardPile[i] === name) {
        gameState.discardPile.splice(i, 1);
        return;
      }
    }
  },
  colorMap:
    typeof window !== "undefined" &&
    window.risquePlayerColors &&
    window.risquePlayerColors.base
      ? Object.assign({}, window.risquePlayerColors.base, { black: window.risquePlayerColors.base.white })
      : {
          blue: "#87bfff",
          red: "#ff0000",
          pink: "#ff69b4",
          black: "#f8fafc",
          white: "#f8fafc",
          green: "#8fd8a8",
          yellow: "#ffff00"
        },
  /**
   * STATS panel row background only (HUD table + SVG stats-group). Map and markers keep {@link colorMap}.
   * Colors resolve from risque-colors.js (single source of truth).
   */
  statsPanelPlayerBgHex: function(colorKey) {
    if (typeof window !== "undefined" && typeof window.risqueColorHex === "function") {
      return window.risqueColorHex(colorKey);
    }
    const k = colorKey != null ? String(colorKey).trim().toLowerCase() : "";
    return this.colorMap[k] || "#808080";
  },
  /** STATS row: light text on dark-ish fills vs dark text on pastels (blue/green/yellow). */
  statsPanelPlayerUseLightText: function(colorKey) {
    if (typeof window !== "undefined" && typeof window.risqueStatsUseLightText === "function") {
      return window.risqueStatsUseLightText(colorKey);
    }
    const k = colorKey != null ? String(colorKey).trim().toLowerCase() : "";
    return k === "red" || k === "pink";
  },
  /** Resolve player.color to a hex (handles saved casing / spacing). */
  colorHexForPlayer: function(player) {
    if (!player || player.color == null || String(player.color).trim() === '') return null;
    if (typeof window !== "undefined" && typeof window.risqueColorHex === "function") {
      return window.risqueColorHex(player.color);
    }
    const k = String(player.color).trim().toLowerCase();
    return this.colorMap[k] || null;
  },
  /** Territory list entry may be {name}, string, or legacy {id}. */
  territoryNameFromEntry: function(pt) {
    if (pt == null) return '';
    if (typeof pt === 'string') return pt;
    if (typeof pt.name === 'string' && pt.name !== '') return pt.name;
    if (typeof pt.id === 'string' && pt.id !== '') return pt.id;
    return '';
  },
  /**
   * Prefer gameState.continents[continent].territories when present (authoritative for the running match),
   * else core.continents.
   */
  getContinentTerritoryIdsForBoard: function(gameState, continentKey) {
    try {
      const gs =
        gameState &&
        gameState.continents &&
        gameState.continents[continentKey] &&
        gameState.continents[continentKey].territories;
      if (Array.isArray(gs) && gs.length && gs.every(t => typeof t === 'string')) {
        return gs;
      }
    } catch (e) {
      /* ignore */
    }
    return this.continents[continentKey] || [];
  },
  getNextContinentValue: function(continent, collectionCount) {
    const increments = {
      south_america: 2,
      north_america: 5,
      africa: 3,
      europe: 5,
      asia: 7,
      australia: 2
    };
    const baseValue = this.continentValues[continent].value;
    return baseValue + (collectionCount * increments[continent]);
  },
  /**
   * After eliminating a player: continents the conqueror now fully controls that include at least one
   * territory the defeated still held (income for newly completed continent from that campaign).
   */
  computePendingContinentsAfterElimination: function(gameState, conquerorName, defeatedPlayer) {
    try {
      if (!gameState || !defeatedPlayer || !Array.isArray(defeatedPlayer.territories) || !defeatedPlayer.territories.length) {
        return [];
      }
      const defeatedTids = [];
      for (let i = 0; i < defeatedPlayer.territories.length; i++) {
        const tn = this.territoryNameFromEntry(defeatedPlayer.territories[i]);
        if (tn) defeatedTids.push(tn);
      }
      if (!defeatedTids.length) return [];
      const conqueror = gameState.players && gameState.players.find(p => p && p.name === conquerorName);
      if (!conqueror || !Array.isArray(conqueror.territories)) return [];
      const pending = [];
      const self = this;
      Object.keys(this.continents || {}).forEach(contKey => {
        const ids = self.getContinentTerritoryIdsForBoard(gameState, contKey);
        if (!ids.length) return;
        const hasAll = ids.every(tid =>
          conqueror.territories.some(pt => self.territoryNameFromEntry(pt) === tid)
        );
        if (!hasAll) return;
        const touchesDefeated = ids.some(tid => defeatedTids.indexOf(tid) !== -1);
        if (touchesDefeated) pending.push(contKey);
      });
      return pending;
    } catch (e) {
      return [];
    }
  },
  /**
   * Continent keys the player fully controls on the current board (runtime gameState.continents when set).
   */
  listFullyHeldContinentKeysForPlayer: function (gameState, player) {
    var out = [];
    try {
      if (!gameState || !player || !Array.isArray(player.territories)) return out;
      var self = this;
      Object.keys(this.continents || {}).forEach(function (contKey) {
        var ids = self.getContinentTerritoryIdsForBoard(gameState, contKey);
        if (!ids.length) return;
        var hasAll = ids.every(function (tid) {
          return player.territories.some(function (pt) {
            return self.territoryNameFromEntry(pt) === tid;
          });
        });
        if (hasAll) out.push(contKey);
      });
    } catch (eList) {
      /* ignore */
    }
    return out;
  },
  RISQUE_ATTACK_START_BASELINE_SESSION_KEY: "risqueConquestAttackStartBaseline",
  writeRisqueConquestAttackStartSession: function (turnKey, continentsArray) {
    try {
      if (typeof sessionStorage === "undefined") return;
      if (typeof window !== "undefined" && window.risqueDisplayIsPublic) return;
      if (!turnKey || !Array.isArray(continentsArray)) return;
      sessionStorage.setItem(
        this.RISQUE_ATTACK_START_BASELINE_SESSION_KEY,
        JSON.stringify({ turnKey: turnKey, continents: continentsArray })
      );
    } catch (eW) {
      /* ignore */
    }
  },
  clearRisqueConquestAttackStartSession: function () {
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.removeItem(this.RISQUE_ATTACK_START_BASELINE_SESSION_KEY);
    } catch (eC) {
      /* ignore */
    }
  },
  /**
   * Baseline continents the attacker fully held at attack mount. Prefer gameState; if missing (e.g. TV
   * tab overwrote shared localStorage), restore from this tab's sessionStorage (host-only write).
   */
  getRisqueConquestAttackStartBaselineList: function (gameState) {
    try {
      if (!gameState) return [];
      var tk =
        (Number(gameState.round) || 1) +
        "|" +
        String(gameState.currentPlayer || "");
      var fromState = gameState.risqueConquestAttackEntryContinents;
      if (Array.isArray(fromState) && fromState.length > 0) {
        if (String(gameState.risqueConquestAttackEntryTurnKey || "") === tk) {
          return fromState.slice();
        }
      }
      if (typeof sessionStorage === "undefined") return [];
      var raw = sessionStorage.getItem(this.RISQUE_ATTACK_START_BASELINE_SESSION_KEY);
      if (!raw) return [];
      var o = JSON.parse(raw);
      if (!o || String(o.turnKey || "") !== tk) return [];
      return Array.isArray(o.continents) ? o.continents.slice() : [];
    } catch (eR) {
      return [];
    }
  },
  /**
   * Every host attack mount (risquePhases.attack.mount): record which continents the current player fully controls at attack
   * start, and drop pre-attack continent-income bookkeeping. Con-income and pending recompute treat only
   * continents gained after this snapshot as campaign "new" (cardplay/income/snapshot state is ignored).
   */
  captureRisqueConquestAttackEntryContinentsIfNeeded: function (gameState) {
    try {
      if (!gameState || (typeof window !== "undefined" && window.risqueDisplayIsPublic)) return;
      delete gameState.risqueContinentsPaidLastStandardMeta;
      var cur = gameState.currentPlayer;
      var tk = (Number(gameState.round) || 1) + "|" + String(cur || "");
      var cp =
        gameState.players &&
        gameState.players.find(function (p) {
          return p && String(p.name || "").toUpperCase() === String(cur || "").toUpperCase();
        });
      if (!cp || !Array.isArray(cp.territories)) return;
      gameState.risqueConquestAttackEntryTurnKey = tk;
      gameState.risqueConquestAttackEntryContinents = this.listFullyHeldContinentKeysForPlayer(gameState, cp);
      this.writeRisqueConquestAttackStartSession(tk, gameState.risqueConquestAttackEntryContinents);
      try {
        delete gameState.risqueConquestStandardIncomeContinentKeysMeta;
      } catch (eStdDel) {
        /* ignore */
      }
    } catch (eCap) {
      /* ignore */
    }
  },
  /**
   * Continents that must not pay again as "new" in con-income: fully held at attack mount, OR (if that
   * baseline is missing) continents that just received a standard-income collection increment this turn.
   */
  isContinentExcludedFromConIncomeNew: function (gameState, continentKey) {
    try {
      if (!gameState || continentKey == null || continentKey === "") return false;
      var k = String(continentKey);
      var attack = this.getRisqueConquestAttackStartBaselineList(gameState);
      if (attack.length > 0) {
        return attack.indexOf(k) !== -1;
      }
      var m = gameState.risqueConquestStandardIncomeContinentKeysMeta;
      if (
        m &&
        Array.isArray(m.keys) &&
        m.keys.indexOf(k) !== -1 &&
        Number(m.round) === Number(gameState.round) &&
        String(m.player || "").toUpperCase() === String(gameState.currentPlayer || "").toUpperCase()
      ) {
        return true;
      }
    } catch (eEx) {
      /* ignore */
    }
    return false;
  },
  /**
   * Prefer gameState.pendingNewContinents when set (e.g. elimination); else diff full control vs continentsSnapshot.
   */
  computePendingNewContinentsForConquest: function (gameState) {
    try {
      if (!gameState) return [];
      var self = this;
      var paidChain = gameState.risqueConquestChainPaidContinents || [];
      var notPaidInChain = function (k) {
        return paidChain.indexOf(k) === -1;
      };
      var exclude = function (k) {
        return self.isContinentExcludedFromConIncomeNew(gameState, k);
      };
      if (Array.isArray(gameState.pendingNewContinents) && gameState.pendingNewContinents.length > 0) {
        return gameState.pendingNewContinents.slice().filter(notPaidInChain).filter(function (k) {
          return !exclude(k);
        });
      }
      var cur = gameState.currentPlayer;
      var cp =
        gameState.players &&
        gameState.players.find(function (p) {
          return p && String(p.name || "").toUpperCase() === String(cur || "").toUpperCase();
        });
      if (!cp || !Array.isArray(cp.territories)) return [];
      var owned = [];
      Object.keys(this.continents || {}).forEach(function (contKey) {
        var ids = self.getContinentTerritoryIdsForBoard(gameState, contKey);
        if (!ids.length) return;
        var hasAll = ids.every(function (tid) {
          return cp.territories.some(function (pt) {
            return self.territoryNameFromEntry(pt) === tid;
          });
        });
        if (hasAll) owned.push(contKey);
      });
      var attackEntry = this.getRisqueConquestAttackStartBaselineList(gameState);
      var stdMeta = gameState.risqueConquestStandardIncomeContinentKeysMeta;
      var stdActive =
        stdMeta &&
        Array.isArray(stdMeta.keys) &&
        stdMeta.keys.length > 0 &&
        Number(stdMeta.round) === Number(gameState.round) &&
        String(stdMeta.player || "").toUpperCase() === String(gameState.currentPlayer || "").toUpperCase();
      if (attackEntry.length > 0 || stdActive) {
        return owned.filter(function (k) {
          return notPaidInChain(k) && !exclude(k);
        });
      }
      var snapshot = gameState.continentsSnapshot || {};
      var snapKeys = Object.keys(snapshot);
      return owned.filter(function (k) {
        return snapKeys.indexOf(k) === -1 && notPaidInChain(k) && !exclude(k);
      });
    } catch (e) {
      return [];
    }
  },
  /**
   * True if this continent must not receive con-income "new continent" payout (attack baseline or
   * post–cardplay standard income fallback).
   */
  shouldSkipConIncomeBaselineContinent: function (gameState, continentKey) {
    return this.isContinentExcludedFromConIncomeNew(gameState, continentKey);
  },
  /**
   * Strip pending continents already held at attack start.
   */
  filterConIncomePendingContinentsArray: function (gameState) {
    try {
      if (!gameState) return [];
      var pending = Array.isArray(gameState.pendingNewContinents) ? gameState.pendingNewContinents.slice() : [];
      var self = this;
      return pending.filter(function (key) {
        return !self.shouldSkipConIncomeBaselineContinent(gameState, key);
      });
    } catch (eF) {
      return [];
    }
  },
  /**
   * Call when advancing currentPlayer to the next seat (receivecard end-turn, reinforce, devtools, etc.).
   * Elimination / conquest chains set conquer-mode routing flags; if they survive into the next player's
   * turn, post-cardplay routes to con-income (books + “new” continents only) instead of standard income.
   */
  clearContinentalConquestRoutingOnTurnAdvance: function (gameState) {
    try {
      if (!gameState) return;
      delete gameState.risqueConquestChainActive;
      delete gameState.risqueRuntimeCardplayIncomeMode;
      delete gameState.risqueConquestChainPaidContinents;
      delete gameState.risqueSkipContinentSnapshotRefresh;
      delete gameState.risqueConquestAttackEntryTurnKey;
      delete gameState.risqueConquestAttackEntryContinents;
      delete gameState.risqueContinentsPaidLastStandardMeta;
      delete gameState.risqueConquestStandardIncomeContinentKeysMeta;
      this.clearRisqueConquestAttackStartSession();
    } catch (e) {
      /* ignore */
    }
  },
  continentSnapshot: function(player) {
    const snapshot = {};
    const gs = typeof window !== 'undefined' && window.gameState ? window.gameState : null;
    for (const continent of Object.keys(this.continents)) {
      const territoryIds = this.getContinentTerritoryIdsForBoard(gs, continent);
      snapshot[continent] =
        territoryIds.length > 0 &&
        territoryIds.every(tid =>
          player.territories.some(pt => this.territoryNameFromEntry(pt) === tid)
        );
    }
    return snapshot;
  },
  initStyles: function() {
    const style = document.createElement('style');
    style.textContent = `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html, body {
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000000;
        font-family: Arial, sans-serif;
        touch-action: none;
        -webkit-text-size-adjust: none;
        -webkit-user-select: none;
        user-select: none;
      }
      .canvas-wrapper {
        width: 1920px;
        height: 1080px;
        position: absolute;
        top: 0;
        left: 50%;
        transform-origin: top center;
        transform: translate(-50%, 0);
        background: #000000;
        border: none;
        pointer-events: auto;
        opacity: 0;
        transition: opacity 2s ease;
        display: none;
      }
      .canvas-wrapper.visible {
        display: block;
        opacity: 1;
      }
      .stage-image {
        position: absolute;
        width: 1920px;
        height: 1080px;
        top: 0;
        left: 0;
        z-index: 0;
        object-fit: contain;
        background: #333333;
        display: none;
      }
      .stage-image.visible {
        display: block;
      }
      .stage-image-desat-mask {
        position: absolute;
        width: 1920px;
        height: 1080px;
        top: 0;
        left: 0;
        z-index: 0;
        object-fit: contain;
        pointer-events: none;
        clip-path: inset(20px 860px 20px 20px);
        display: none;
      }
      .stage-image-desat-mask.visible {
        display: block;
      }
      .svg-overlay {
        position: absolute;
        width: 1920px;
        height: 1080px;
        top: 0;
        left: 0;
        z-index: 1;
        pointer-events: all;
        display: none;
      }
      .svg-overlay.visible {
        display: block;
      }
      .ui-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 1920px;
        height: 1080px;
        z-index: 2;
        pointer-events: none;
        opacity: 0;
        transition: opacity 2s ease;
      }
      .ui-overlay.visible {
        opacity: 1;
      }
      .ui-overlay * {
        pointer-events: auto;
      }
      .territory-circle {
        cursor: pointer;
        stroke: #000000;
        stroke-width: 2;
        pointer-events: all;
        transition: r 0.2s, stroke-width 0.2s;
      }
      .svg-overlay circle.territory-circle.territory-circle--deal-pop {
        transition: r 0.45s cubic-bezier(0.22, 1, 0.36, 1), stroke-width 0.2s;
      }
      .territory-number.territory-number--deal-pop {
        transition: opacity 0.38s ease-out;
      }
      .territory-circle:hover {
        r: 35;
      }
      .territory-circle.selected {
        stroke-width: 3;
      }
      .territory-circle.campaign-warpath {
        stroke-width: 3;
        filter: drop-shadow(0 0 4px rgba(255, 255, 120, 0.9));
      }
      .territory-number {
        font-family: Arial, sans-serif;
        font-weight: bold;
        font-size: 21px;
        text-anchor: middle;
        dominant-baseline: central;
        pointer-events: all;
        cursor: pointer;
      }
      .territory-number text {
        pointer-events: all;
        cursor: pointer;
      }
      .error {
        position: absolute;
        left: 1105px;
        top: 950px;
        max-width: 200px;
        white-space: normal;
        color: #ff0000;
        font-family: Arial, sans-serif;
        font-size: 16px;
        font-weight: 900;
        z-index: 2;
        pointer-events: none;
        text-align: left;
        visibility: hidden;
      }
      .error.visible {
        visibility: visible;
      }
      .load-button {
        position: absolute;
        top: 540px;
        left: 960px;
        transform: translate(-50%, -50%);
        width: 200px;
        padding: 10px;
        font-size: 16px;
        font-weight: bold;
        border: none;
        border-radius: 4px;
        background: #28a745;
        color: #ffffff;
        cursor: pointer;
        z-index: 3;
        opacity: 0;
        transition: opacity 2s ease;
      }
      .load-button.visible {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
    risqueCoreDebugLog('[Core] Styles initialized');
  },
  initLaunchPage: function() {
    const canvasWrapper = document.getElementById('canvas');
    if (!canvasWrapper) return;
    canvasWrapper.innerHTML = `
      <div id="launcher-title">PLAYER PHASE LAUNCHER</div>
      <button class="load-button" id="load-button">Load Game</button>
      <input type="file" id="load-game-input" accept=".json" style="display: none;">
      <div id="error" class="error"></div>
    `;
    const loadButton = document.getElementById('load-button');
    const loadInput = document.getElementById('load-game-input');
    loadButton.addEventListener('click', () => {
      risqueCoreDebugLog('[Core] Load Game button clicked');
      loadInput.click();
    });
    loadInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (!file) {
        risqueCoreDebugLog('[Core] No file selected');
        this.showError('No file selected');
        return;
      }
      risqueCoreDebugLog(`[Core] Loading file: ${file.name}`);
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          gameState = JSON.parse(e.target.result);
          if (!this.validateGameState(gameState)) {
            console.error('[Core] Invalid game state in file');
            this.showError('Invalid game state in file');
            return;
          }
          localStorage.setItem('gameState', JSON.stringify(gameState));
          /* Manual file load must win over stale IndexedDB hydrate on next page (if any IDB layer bumps seq). */
          try {
            localStorage.setItem('risqueGameStateIdbSeq', String(Date.now()));
          } catch (eSeq) {
            /* ignore */
          }
          risqueCoreDebugLog('[Core] Game state loaded from file:', gameState);
          if (window.risqueNavigateWithFade) {
            window.risqueNavigateWithFade('game.html?phase=cardplay&legacyNext=income.html');
          } else {
            window.location.href = 'game.html?phase=cardplay&legacyNext=income.html';
          }
        } catch (err) {
          console.error(`[Core] Error parsing file: ${err.message}`);
          this.showError('Error parsing game file');
        }
        loadInput.value = '';
      };
      reader.readAsText(file);
    });
    this.resizeCanvas();
    risqueCoreDebugLog('[Core] Launch page initialized');
  },
  initGameView: function() {
    risqueCoreDebugLog('[Core] Initializing game view for non-launch page');
    const canvasWrapper = document.getElementById('canvas');
    if (!canvasWrapper) {
      risqueCoreDebugLog('[Core] Canvas wrapper not found for initGameView');
      this.showError('Canvas wrapper not found');
      return;
    }
    let stageImage = canvasWrapper.querySelector('.stage-image');
    if (!stageImage) {
      stageImage = document.createElement('img');
      stageImage.id = 'stage-image';
      stageImage.src = 'assets/images/stage.png';
      stageImage.alt = 'Stage';
      stageImage.className = 'stage-image';
      stageImage.onerror = () => this.showError('Failed to load stage image');
      canvasWrapper.appendChild(stageImage);
      risqueCoreDebugLog('[Core] Stage image created');
    }
    let stageImageDesat = canvasWrapper.querySelector('.stage-image-desat-mask');
    if (!stageImageDesat) {
      stageImageDesat = document.createElement('img');
      stageImageDesat.src = 'assets/images/stage.png';
      stageImageDesat.alt = '';
      stageImageDesat.setAttribute('aria-hidden', 'true');
      stageImageDesat.className = 'stage-image-desat-mask';
      canvasWrapper.appendChild(stageImageDesat);
      risqueCoreDebugLog('[Core] Stage desaturation mask created');
    }
    let svgOverlay = canvasWrapper.querySelector('.svg-overlay');
    if (!svgOverlay) {
      svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svgOverlay.setAttribute('class', 'svg-overlay');
      svgOverlay.setAttribute('viewBox', '0 0 1920 1080');
      svgOverlay.setAttribute('width', '1920');
      svgOverlay.setAttribute('height', '1080');
      canvasWrapper.appendChild(svgOverlay);
      risqueCoreDebugLog('[Core] SVG overlay created');
    }
    var sat = typeof window.risqueMapSaturation === 'function' ? Number(window.risqueMapSaturation()) : 1;
    if (!Number.isFinite(sat) || sat <= 0) sat = 1;
    if (sat > 2) sat = 2;
    var satCss = 'saturate(' + String(sat) + ')';
    /* Desaturate map art mask only — keep territory markers/numbers at full color. */
    stageImage.style.filter = '';
    stageImageDesat.style.filter = satCss;
    svgOverlay.style.filter = '';
    this.resizeCanvas();
    risqueCoreDebugLog('[Core] Game view initialized');
  },
  validateGameState: function(gameState) {
    const isValid = gameState &&
      gameState.players &&
      Array.isArray(gameState.players) &&
      gameState.players.length >= 1 &&
      gameState.currentPlayer &&
      gameState.turnOrder &&
      gameState.players.every(p => p.name && p.color && Array.isArray(p.territories));
    risqueCoreDebugLog(`[Core] Game state valid: ${isValid}`);
    return isValid;
  },
  formatTerritoryDisplayName: function(label) {
    if (!label) return '';
    return String(label).replace(/_/g, ' ').replace(/\b\w/g, function (ch) {
      return ch.toUpperCase();
    });
  },
  sanitizeTransientState: function(gameState) {
    if (!gameState || typeof gameState !== 'object') return { state: gameState, changed: false };

    let changed = false;

    // Conquest chain (elimination) leaves phase !== 'attack' while capture troop transfer is still pending.
    const phase = gameState.phase;
    /* Continental elimination chain: attack may keep attackPhase === pending_transfer until
     * con-transfertroops finishes the optional move into the captured territory. */
    const conquestChainPhase =
      phase === 'conquer' ||
      phase === 'con-cardtransfer' ||
      phase === 'con-cardplay' ||
      phase === 'con-income' ||
      phase === 'con-deploy' ||
      phase === 'con-transfertroops' ||
      phase === 'con-receivecard';

    // Clear stale attack transfer locks when not actively in attack phase.
    // These flags can survive in save files and then block territory clicks later.
    if (
      gameState.phase !== 'attack' &&
      gameState.attackPhase === 'pending_transfer' &&
      !conquestChainPhase &&
      !gameState.risqueConquestChainActive
    ) {
      gameState.attackPhase = 'attack';
      gameState.attackingTerritory = null;
      gameState.acquiredTerritory = null;
      gameState.minTroopsToTransfer = 0;
      gameState.conqueredThisTurn = false;
      delete gameState.risqueDeferConquerElimination;
      changed = true;
      risqueCoreDebugLog('[Core] Sanitized stale pending_transfer (wrong phase) from save');
    }

    // In attack phase, pending_transfer must reference territories the current player still owns.
    if (gameState.phase === 'attack' && gameState.attackPhase === 'pending_transfer') {
      const cp = gameState.currentPlayer;
      const p = gameState.players && gameState.players.find(x => x.name === cp);
      const atkName = gameState.attackingTerritory && gameState.attackingTerritory.name;
      const acqName = gameState.acquiredTerritory && gameState.acquiredTerritory.name;
      const atk = p && atkName ? p.territories.find(t => t.name === atkName) : null;
      const acq = p && acqName ? p.territories.find(t => t.name === acqName) : null;
      if (!p || !atkName || !acqName || !atk || !acq) {
        gameState.attackPhase = 'attack';
        gameState.attackingTerritory = null;
        gameState.acquiredTerritory = null;
        gameState.minTroopsToTransfer = 0;
        delete gameState.risqueDeferConquerElimination;
        changed = true;
        risqueCoreDebugLog('[Core] Sanitized invalid pending_transfer (missing territories) from save');
      }
    }

    if (
      gameState.risqueDeferConquerElimination &&
      (gameState.attackPhase !== 'pending_transfer' || !gameState.acquiredTerritory)
    ) {
      delete gameState.risqueDeferConquerElimination;
      changed = true;
    }

    if (gameState.risquePublicConquestCelebrationHtml != null && !gameState.risqueConquestFlowActive) {
      delete gameState.risquePublicConquestCelebrationHtml;
      changed = true;
    }

    if (gameState.phase !== 'deploy' && gameState.risqueDeployTransientPrimary != null) {
      delete gameState.risqueDeployTransientPrimary;
      changed = true;
    }

    if (gameState.phase !== 'reinforce' && gameState.risqueReinforcePreview != null) {
      delete gameState.risqueReinforcePreview;
      changed = true;
    }

    if (gameState.phase !== 'login' && gameState.risquePublicLoginHostFade != null) {
      delete gameState.risquePublicLoginHostFade;
      changed = true;
    }

    if (
      gameState.phase !== 'cardplay' &&
      gameState.phase !== 'con-cardplay' &&
      gameState.risquePublicCardplayBookCards != null
    ) {
      delete gameState.risquePublicCardplayBookCards;
      changed = true;
    }

    if (
      gameState.phase !== 'cardplay' &&
      gameState.phase !== 'con-cardplay' &&
      gameState.risquePublicBookProcessing != null
    ) {
      delete gameState.risquePublicBookProcessing;
      changed = true;
    }

    /* TV name roulette: only strip when not actively in player select (mirror + host HUD rely on these). */
    if (
      gameState.risquePublicPlayerSelectFlash != null &&
      String(gameState.phase || '') !== 'playerSelect'
    ) {
      delete gameState.risquePublicPlayerSelectFlash;
      changed = true;
    }

    if (
      gameState.risquePublicUiSelectKind != null &&
      String(gameState.phase || '') !== 'playerSelect'
    ) {
      delete gameState.risquePublicUiSelectKind;
      changed = true;
    }

    if (
      gameState.risquePublicDealPopTerritory != null &&
      String(gameState.phase || '') !== 'deal'
    ) {
      delete gameState.risquePublicDealPopTerritory;
      changed = true;
    }

    if (gameState.phase !== 'cardplay' && gameState.phase !== 'con-cardplay') {
      if (gameState.risqueCardplayUseFrozenPublicMirror != null) {
        delete gameState.risqueCardplayUseFrozenPublicMirror;
        changed = true;
      }
      if (gameState.risqueCardplayPublicMirrorSnapshot != null) {
        delete gameState.risqueCardplayPublicMirrorSnapshot;
        changed = true;
      }
      if (gameState.risqueCardplayPublicPlayerSnapshot != null) {
        delete gameState.risqueCardplayPublicPlayerSnapshot;
        changed = true;
      }
      if (gameState.risquePublicCardplayAerialSkipHostDecisionSeq != null) {
        delete gameState.risquePublicCardplayAerialSkipHostDecisionSeq;
        changed = true;
      }
    }

    if (this.normalizeAerialWildcardCounters(gameState)) {
      changed = true;
    }

    return { state: gameState, changed };
  },
  /**
   * Coerce string/JSON quirks and keep `aerialAttackUsesRemaining` + `aerialAttackEligible` consistent.
   * Call when applying attack UI locks (not only on load) so in-memory state cannot re-enable Aerial spuriously.
   */
  normalizeAerialWildcardCounters: function (gs) {
    if (!gs || typeof gs !== 'object') return false;
    var changed = false;
    var raw = gs.aerialAttackUsesRemaining;
    var num = Number(raw);
    var hasFinite = raw != null && String(raw).trim() !== '' && Number.isFinite(num);
    if (hasFinite) {
      var ac = Math.max(0, Math.floor(num));
      if (gs.aerialAttackUsesRemaining !== ac) {
        gs.aerialAttackUsesRemaining = ac;
        changed = true;
      }
      var wantEl = ac > 0;
      if (!!gs.aerialAttackEligible !== wantEl) {
        gs.aerialAttackEligible = wantEl;
        changed = true;
      }
    } else {
      var el = !!gs.aerialAttackEligible;
      var inferred = el ? 1 : 0;
      if (gs.aerialAttackUsesRemaining !== inferred) {
        gs.aerialAttackUsesRemaining = inferred;
        changed = true;
      }
      if (!!gs.aerialAttackEligible !== el) {
        gs.aerialAttackEligible = el;
        changed = true;
      }
    }
    return changed;
  },
  /** Wildcards can stack multiple aerial placements; legacy saves used boolean aerialAttackEligible only. */
  getAerialAttackUsesRemaining: function (gs) {
    if (!gs) return 0;
    var raw = gs.aerialAttackUsesRemaining;
    if (raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw))) {
      return Math.max(0, Math.floor(Number(raw)));
    }
    return gs.aerialAttackEligible ? 1 : 0;
  },
  setAerialAttackUsesRemaining: function (gs, n) {
    if (!gs) return 0;
    var v = Math.max(0, Math.floor(Number(n) || 0));
    gs.aerialAttackUsesRemaining = v;
    gs.aerialAttackEligible = v > 0;
    return v;
  },
  addAerialAttackUses: function (gs, delta) {
    if (!gs) return 0;
    var next = this.getAerialAttackUsesRemaining(gs) + (Number(delta) || 0);
    return this.setAerialAttackUsesRemaining(gs, next);
  },
  getUrlPhaseParam: function() {
    try {
      return new URLSearchParams(window.location.search).get('phase');
    } catch (e) {
      return null;
    }
  },
  loadGameState: function(callback) {
    try {
      gameState = JSON.parse(localStorage.getItem('gameState') || '{}');
      risqueCoreDebugLog('[Core] Loaded gameState:', gameState);
      const sanitized = this.sanitizeTransientState(gameState);
      gameState = sanitized.state;
      if (sanitized.changed) {
        try {
          localStorage.setItem('gameState', JSON.stringify(gameState));
        } catch (e) {
          console.warn('[Core] Could not persist sanitized gameState', e);
        }
      }
      if (!this.validateGameState(gameState)) {
        console.error('[Core] Invalid game state');
        this.showError('Invalid game state');
        callback(null);
        return;
      }
      if (!gameState.continentCollectionCounts) {
        gameState.continentCollectionCounts = {
          south_america: 0,
          north_america: 0,
          africa: 0,
          europe: 0,
          asia: 0,
          australia: 0
        };
        risqueCoreDebugLog('[Core] Initialized continentCollectionCounts:', gameState.continentCollectionCounts);
      }
      if (gameState.phase === 'getcard' && gameState.deck && gameState.deck.length > 0) {
        const currentPlayer = gameState.players.find(p => p.name === gameState.currentPlayer);
        if (currentPlayer) {
          const card = gameState.deck.shift();
          currentPlayer.cards = currentPlayer.cards || [];
          currentPlayer.cards.push(card);
          currentPlayer.cardCount = currentPlayer.cards.length;
          risqueCoreDebugLog(`[Core] Drew card ${card} for ${currentPlayer.name}`);
        }
        const currentIndex = gameState.turnOrder.indexOf(gameState.currentPlayer);
        const nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
        gameState.currentPlayer = gameState.turnOrder[nextIndex];
        if (typeof this.clearContinentalConquestRoutingOnTurnAdvance === 'function') {
          this.clearContinentalConquestRoutingOnTurnAdvance(gameState);
        }
        gameState.phase = 'cardplay';
        localStorage.setItem('gameState', JSON.stringify(gameState));
        risqueCoreDebugLog(`[Core] Advanced to next player: ${gameState.currentPlayer}, phase: cardplay`);
      }
      callback(gameState);
    } catch (e) {
      console.error('[Core] Failed to load game state:', e.message);
      this.showError('Failed to load game state');
      try {
        callback(null);
      } catch (cbErr) {
        console.error('[Core] loadGameState callback(null) failed:', cbErr && cbErr.message);
      }
    }
  },
  showError: function(message) {
    const errorDiv = document.getElementById('error');
    if (!errorDiv) {
      if (message) console.error('[Core] Error element not found for message:', message);
      return;
    }
    if (!message) {
      errorDiv.textContent = '';
      errorDiv.classList.remove('visible');
      return;
    }
    errorDiv.textContent = message;
    errorDiv.classList.add('visible');
    setTimeout(() => errorDiv.classList.remove('visible'), 5000);
    risqueCoreDebugLog(`[Core] Error displayed: ${message}`);
  },
  risqueStartTransferPulseTicker: function () {
    const self = this;
    const gs0 = window.gameState;
    if (!gs0 || !gs0.risqueTransferPulse) {
      __risqueTransferPulseTickingStartMs = null;
      return;
    }
    const pulseStart = gs0.risqueTransferPulse.startMs;
    if (
      __risqueTransferPulseTickingStartMs === pulseStart &&
      __risqueTransferPulseRafId != null
    ) {
      return;
    }
    __risqueTransferPulseTickingStartMs = pulseStart;
    if (__risqueTransferPulseRafId != null) {
      cancelAnimationFrame(__risqueTransferPulseRafId);
      __risqueTransferPulseRafId = null;
    }
    function tick() {
      const gs = window.gameState;
      if (!gs || !gs.risqueTransferPulse) {
        __risqueTransferPulseRafId = null;
        __risqueTransferPulseTickingStartMs = null;
        return;
      }
      const p = gs.risqueTransferPulse;
      const dur = Number.isFinite(p.durationMs) ? p.durationMs : 1000;
      self.renderTerritories(null, gs, window.deployedTroops || {});
      if (Date.now() - p.startMs >= dur) {
        __risqueTransferPulseRafId = null;
        __risqueTransferPulseTickingStartMs = null;
        if (!window.risqueDisplayIsPublic) {
          delete gs.risqueTransferPulse;
        }
        self.renderTerritories(null, gs, window.deployedTroops || {});
        if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === 'function') {
          window.risqueMirrorPushGameState();
        }
        if (
          !window.risqueDisplayIsPublic &&
          typeof window.risqueOnHostTransferPulseComplete === 'function'
        ) {
          var cbPulse = window.risqueOnHostTransferPulseComplete;
          window.risqueOnHostTransferPulseComplete = null;
          try {
            cbPulse();
          } catch (ePulseCb) {
            /* ignore */
          }
        }
        return;
      }
      __risqueTransferPulseRafId = requestAnimationFrame(tick);
    }
    __risqueTransferPulseRafId = requestAnimationFrame(tick);
  },
  renderTerritories: function(changedLabel, gameState, deployedTroops = {}, renderOpts) {
    renderOpts = renderOpts && typeof renderOpts === 'object' ? renderOpts : {};
    const popIn = !!(renderOpts.popIn && changedLabel);
    risqueCoreDebugLog(`[Core] Rendering territories, changedLabel: ${changedLabel || 'all'}, viewTroopsActive: ${window.viewTroopsActive || false}, deployedTroops:`, deployedTroops);
    try {
      const svg = risqueGetCanvasSvgOverlay();
      if (!svg) {
        console.error('[Core] SVG overlay not found');
        this.showError('SVG overlay not found');
        return;
      }
      const urlPhase = this.getUrlPhaseParam();
      const isMockGameMaker = !!window.RISQUE_MOCK_MAKER;
      const replayPlayback = !!(gameState && gameState.risqueReplayPlaybackActive);
      /* Login: clean board — strip markers once, then bail (no territory loop below).
       * Mock Game Maker keeps painting neutral 001 chips even if ?phase=login is in the URL.
       * Wayback / tape playback must draw chips: exports may still carry phase login or ?phase=login. */
      if (
        gameState &&
        !isMockGameMaker &&
        !replayPlayback &&
        (gameState.phase === 'login' || urlPhase === 'login')
      ) {
        if (!changedLabel) {
          svg
            .querySelectorAll('circle.territory-circle, text.territory-number, g.territory-number, g.territory-troop-notches, g.territory-deploy-satellite')
            .forEach(el => el.remove());
        }
        return;
      }
      /* Full-map redraw: avoid bulk-removing every marker before the loop. That left the SVG empty for a
       * frame while hundreds of nodes were recreated — visible as a grey flash / missing chips. Each
       * territory iteration already removes its own prior circle/text/satellite before drawing. */
      const territoryNames = Object.keys(this.territories);
      const renderTerritories = changedLabel ? [changedLabel] : territoryNames;
      renderTerritories.forEach(label => {
        if (label === 'wildcard1' || label === 'wildcard2') return;
        const territory = this.territories[label];
        if (!territory) {
          console.error(`[Core] No coordinates for ${label}`);
          this.showError(`No coordinates for ${label}`);
          return;
        }
        const isPublicView = !!window.risqueDisplayIsPublic;
        let playerName = null;
        let troops = 1;
        for (const player of gameState.players) {
          const t = player.territories.find(t => t.name === label);
          if (t) {
            playerName = player.name;
            troops = t.troops;
            break;
          }
        }
        /* Reinforcement: host sees wheel preview on map; public TV only swells markers (no troop math until confirm). */
        if (
          gameState &&
          String(gameState.phase) === 'reinforce' &&
          gameState.risqueReinforcePreview &&
          playerName === gameState.currentPlayer &&
          !isPublicView
        ) {
          const rp = gameState.risqueReinforcePreview;
          const amt = Number(rp.amount);
          if (Number.isFinite(amt) && amt >= 1 && rp.source === label) {
            troops = Number(troops) - amt;
          } else if (Number.isFinite(amt) && amt >= 1 && rp.destination === label) {
            troops = Number(troops) + amt;
          }
        }
        const transferPulse = gameState && gameState.risqueTransferPulse;
        if (
          transferPulse &&
          transferPulse.label === label &&
          typeof transferPulse.fromTroops === 'number' &&
          typeof transferPulse.toTroops === 'number'
        ) {
          const dur = Number.isFinite(transferPulse.durationMs) ? transferPulse.durationMs : 1000;
          const elapsed = Date.now() - transferPulse.startMs;
          if (elapsed < dur) {
            const tProg = Math.min(1, Math.max(0, elapsed / dur));
            troops = Math.round(
              transferPulse.fromTroops + (transferPulse.toTroops - transferPulse.fromTroops) * tProg
            );
          }
        }
        svg.querySelectorAll(`circle[data-label="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`.territory-number[data-label="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`g.territory-deploy-satellite[data-label="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`circle.territory-troop-fill[data-label="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`clipPath[data-troop-fill-clip="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`g.territory-troop-notches[data-label="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`circle[data-mgm-marker-vis="${label}"]`).forEach(el => el.remove());
        svg.querySelectorAll(`circle.territory-circle-outline[data-label="${label}"]`).forEach(el => el.remove());
        /* No neutral/gray chips — only draw markers for owned territories (deal pops in over empty map).
         * Mock Game Maker must still render clickable neutral chips so you can paint from an empty board. */
        if (!playerName && !isMockGameMaker) {
          return;
        }
        const player = playerName
          ? gameState.players.find(p => p && String(p.name) === String(playerName))
          : null;
        /* Replay can reference eliminated owners; applyBoard adds ghosts — if still missing, draw gray chip. */
        if (playerName && !player && !(gameState && gameState.risqueReplayPlaybackActive)) {
          return;
        }
        const color =
          playerName && player
            ? this.colorMap[player.color] || '#ffffff'
            : playerName && gameState && gameState.risqueReplayPlaybackActive
              ? '#555555'
              : '#64748b';
        const ownerColorKey =
          player && player.color != null ? String(player.color).trim().toLowerCase() : '';
        const deployMirrorDraft =
          gameState &&
          String(gameState.phase) === 'deploy' &&
          gameState.risqueDeployMirrorDraft &&
          typeof gameState.risqueDeployMirrorDraft === 'object'
            ? gameState.risqueDeployMirrorDraft
            : null;
        const effectiveDeployedTroops =
          isPublicView &&
          deployMirrorDraft &&
          deployMirrorDraft.deltas &&
          typeof deployMirrorDraft.deltas === 'object'
            ? deployMirrorDraft.deltas
            : deployedTroops;
        const rawDeployDeltaForScale =
          effectiveDeployedTroops && effectiveDeployedTroops[label] != null
            ? Number(effectiveDeployedTroops[label])
            : 0;
        /* Only the current deployer’s territories use session deltas for bump / satellite (avoids stale mirror or handoff bugs). */
        const deployDelta =
          playerName === gameState.currentPlayer && Number.isFinite(rawDeployDeltaForScale)
            ? rawDeployDeltaForScale
            : 0;
        const isDeployed =
          window.viewTroopsActive &&
          (effectiveDeployedTroops[label] || 0) > 0 &&
          playerName === gameState.currentPlayer;
        const textColor = isDeployed
          ? '#000000'
          : !playerName
            ? '#f1f5f9'
            : player && (player.color === 'pink' || player.color === 'yellow')
              ? '#000000'
              : '#ffffff';
        const mgmSelLabelsEarly = window.RISQUE_MGM_SELECTED_LABELS;
        const mgmMarkerSelectedEarly =
          isMockGameMaker && Array.isArray(mgmSelLabelsEarly) && mgmSelLabelsEarly.indexOf(label) !== -1;
        /* MGM: selected chip swells to 1.5× radius (+50%) on a non-interactive layer; hit circle stays normal r. */
        const MGM_SELECT_R_MULT = 1.5;
        const mgmVisScale = mgmMarkerSelectedEarly ? MGM_SELECT_R_MULT : 1;
        const useMgmDual =
          isMockGameMaker && mgmMarkerSelectedEarly && !popIn;
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttributeNS(null, 'cx', territory.x);
        circle.setAttributeNS(null, 'cy', territory.y);
        circle.setAttributeNS(
          null,
          'fill',
          !playerName
            ? (isDeployed ? '#ffffff' : color)
            : (typeof window.risqueMarkerOwnedCenterFill === "function"
                ? window.risqueMarkerOwnedCenterFill()
                : "#000000")
        );
        circle.setAttributeNS(null, 'stroke', playerName ? color : '#000000');
        circle.setAttributeNS(null, 'stroke-width', playerName ? '7' : (isDeployed ? '4' : '2'));
        circle.setAttributeNS(null, 'class', 'territory-circle' + (!playerName && isMockGameMaker ? ' territory-circle--mock-unowned' : ''));
        circle.setAttributeNS(null, 'data-label', label);
        circle.setAttributeNS(null, 'role', 'button');
        circle.setAttributeNS(
          null,
          'aria-label',
          playerName
            ? `Select ${label.replace(/_/g, ' ')} (Troops: ${troops})`
            : `Select ${label.replace(/_/g, ' ')} (unowned)`
        );
        circle.style.opacity = '1';
        circle.style.pointerEvents = 'all';
        if (playerName) {
          circle.style.stroke = color;
          circle.style.strokeWidth = '7';
        }
        let mgmVis = null;
        if (useMgmDual) {
          mgmVis = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          mgmVis.setAttributeNS(null, 'cx', territory.x);
          mgmVis.setAttributeNS(null, 'cy', territory.y);
          mgmVis.setAttributeNS(null, 'fill', circle.getAttributeNS(null, 'fill') || color);
          mgmVis.setAttributeNS(null, 'stroke', circle.getAttributeNS(null, 'stroke') || '#000000');
          mgmVis.setAttributeNS(null, 'stroke-width', circle.getAttributeNS(null, 'stroke-width') || '2');
          mgmVis.setAttributeNS(
            null,
            'class',
            (circle.getAttributeNS(null, 'class') || 'territory-circle') + ' territory-mgm-selected-visual'
          );
          mgmVis.setAttributeNS(null, 'data-mgm-marker-vis', label);
          mgmVis.setAttributeNS(null, 'aria-hidden', 'true');
          mgmVis.style.pointerEvents = 'none';
          mgmVis.style.opacity = '1';
          circle.setAttributeNS(null, 'fill', 'transparent');
          circle.setAttributeNS(null, 'stroke', 'none');
          circle.setAttributeNS(null, 'stroke-width', '0');
          circle.setAttributeNS(null, 'class', 'territory-circle territory-mgm-hit');
        }
        const surface = mgmVis || circle;
        const baseR = Number(territory.r) || 30;
        const warpathLabelsFromState =
          gameState && Array.isArray(gameState.risquePublicCampaignWarpathLabels)
            ? gameState.risquePublicCampaignWarpathLabels
            : null;
        /* Public TV must follow mirrored gameState only — never fall back to window globals (stale after host clears path). */
        const warpathLabels = replayPlayback
          ? Array.isArray(gameState && gameState.risquePublicCampaignWarpathLabels)
            ? gameState.risquePublicCampaignWarpathLabels
            : []
          : isPublicView
            ? Array.isArray(gameState && gameState.risquePublicCampaignWarpathLabels)
              ? gameState.risquePublicCampaignWarpathLabels
              : []
            : warpathLabelsFromState != null
              ? warpathLabelsFromState
              : Array.isArray(renderOpts.campaignWarpathLabels)
                ? renderOpts.campaignWarpathLabels
                : Array.isArray(window.__risqueCampaignWarpathLabels)
                  ? window.__risqueCampaignWarpathLabels
                  : [];
        const onWarpath = warpathLabels.indexOf(label) !== -1;
        if (onWarpath) {
          surface.classList.add('campaign-warpath');
        }
        const warpathScale = onWarpath ? 1.25 : 1;
        const spectatorLabels = gameState && Array.isArray(gameState.risqueSpectatorFocusLabels)
          ? gameState.risqueSpectatorFocusLabels
          : [];
        const onSpectatorFocus = spectatorLabels.indexOf(label) !== -1;
        const spectatorScale = onSpectatorFocus ? 1.25 : 1;
        /* Cardplay map beats (swell + halo): gameState fields are written on host and mirrored to public —
         * apply on both views so host sees the same expanding markers / animations as the TV. */
        const cardplaySharedHL =
          gameState && Array.isArray(gameState.risquePublicCardplayHighlightLabels)
            ? gameState.risquePublicCardplayHighlightLabels
            : [];
        const onCardplaySharedHL = cardplaySharedHL.indexOf(label) !== -1;
        const cardplayHlMode =
          gameState && gameState.risquePublicCardplayHighlightMode != null
            ? String(gameState.risquePublicCardplayHighlightMode)
            : '';
        const battleLossFlash =
          gameState &&
          Array.isArray(gameState.risqueBattleLossFlashLabels) &&
          gameState.risqueBattleLossFlashLabels.indexOf(label) !== -1;
        const replayBattleFlash =
          gameState &&
          gameState.risqueReplayPlaybackActive &&
          Array.isArray(gameState.risqueReplayBattleFlashLabels) &&
          gameState.risqueReplayBattleFlashLabels.indexOf(label) !== -1;
        /* Swell beat (larger r) then halo — host + public use the same gameState-driven labels/mode. */
        let cardplayScale = 1;
        if (onCardplaySharedHL) {
          cardplayScale = cardplayHlMode === 'swell' ? 1.92 : 1.5;
        }
        if (onCardplaySharedHL) {
          if (cardplayHlMode === 'swell') {
            surface.classList.add('risque-cardplay-public-swell');
          } else {
            surface.classList.add('risque-cardplay-public-highlight');
          }
        }
        if (battleLossFlash) {
          surface.classList.add('risque-battle-loss-flash');
        }
        if (replayBattleFlash) {
          surface.classList.add('risque-replay-battle-flash');
        }
        const isDeployPhase = gameState && String(gameState.phase) === 'deploy';
        const deployMirrorSelected =
          isPublicView &&
          deployMirrorDraft &&
          deployMirrorDraft.selected != null &&
          String(deployMirrorDraft.selected) !== ''
            ? String(deployMirrorDraft.selected)
            : null;
        const deployTerritorySelected =
          isDeployPhase &&
          playerName === gameState.currentPlayer &&
          (isPublicView ? deployMirrorSelected === label : window.selectedTerritory === label);
        if (deployTerritorySelected) {
          surface.classList.add('selected');
        }
        const deployPendingBump = isDeployPhase && deployDelta > 0 ? 1.5 : 1;
        const deploySelectBump = deployTerritorySelected ? 1.22 : 1;
        const transferPulseDur = transferPulse && Number.isFinite(transferPulse.durationMs) ? transferPulse.durationMs : 1000;
        const transferPulseActive =
          transferPulse &&
          transferPulse.label === label &&
          Date.now() - transferPulse.startMs < transferPulseDur;
        const transferPulseScale = transferPulseActive ? 1.5 : 1;
        const combinedScale = Math.max(
          warpathScale,
          spectatorScale,
          cardplayScale,
          deployPendingBump,
          deploySelectBump,
          transferPulseScale
        );
        const displayBaseR = baseR * combinedScale;
        const MARKER_RING_STROKE_W = 7;
        const MARKER_OUTLINE_STROKE_W = 3;
        const markerOutlineRadiusOffset = (MARKER_RING_STROKE_W + MARKER_OUTLINE_STROKE_W) / 2;
        const markerOutlineRadiusFor = rBase => Math.max(0, Number(rBase) + markerOutlineRadiusOffset);
        const markerInnerSeparatorRadiusFor = rBase =>
          Math.max(0, Number(rBase) - MARKER_RING_STROKE_W / 2);
        let markerOutline = null;
        let markerInnerSeparator = null;
        if (playerName) {
          markerOutline = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          markerOutline.setAttributeNS(null, 'cx', territory.x);
          markerOutline.setAttributeNS(null, 'cy', territory.y);
          markerOutline.setAttributeNS(null, 'fill', 'none');
          markerOutline.setAttributeNS(null, 'stroke', '#000000');
          markerOutline.setAttributeNS(null, 'stroke-width', String(MARKER_OUTLINE_STROKE_W));
          markerOutline.setAttributeNS(null, 'class', 'territory-circle-outline');
          markerOutline.setAttributeNS(null, 'data-label', label);
          markerOutline.setAttributeNS(null, 'aria-hidden', 'true');
          markerOutline.style.pointerEvents = 'none';
          var sep =
            typeof window.risqueMarkerRingInnerStroke === "function"
              ? window.risqueMarkerRingInnerStroke()
              : { color: "#000000", width: 2 };
          markerInnerSeparator = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          markerInnerSeparator.setAttributeNS(null, 'cx', territory.x);
          markerInnerSeparator.setAttributeNS(null, 'cy', territory.y);
          markerInnerSeparator.setAttributeNS(null, 'fill', 'none');
          markerInnerSeparator.setAttributeNS(
            null,
            'stroke',
            sep && sep.color ? String(sep.color) : '#000000'
          );
          markerInnerSeparator.setAttributeNS(
            null,
            'stroke-width',
            String(sep && Number.isFinite(Number(sep.width)) ? Number(sep.width) : 2)
          );
          markerInnerSeparator.setAttributeNS(null, 'data-label', label);
          markerInnerSeparator.setAttributeNS(null, 'aria-hidden', 'true');
          markerInnerSeparator.style.pointerEvents = 'none';
        }
        let fillGeom = null;
        if (playerName) {
          const troopCount = Math.max(0, Math.floor(Number(troops) || 0));
          /* Fluid height = ones digit: full when count is a multiple of 10 (50→full, 55→half). */
          const mod10 = troopCount % 10;
          const displayFillFrac =
            troopCount <= 0 ? 0 : mod10 === 0 ? 1 : mod10 / 10;
          const ringRForMarker =
            useMgmDual && mgmVis ? displayBaseR * MGM_SELECT_R_MULT : displayBaseR;
          const innerR = Math.max(6, ringRForMarker - Math.max(5, Math.round(ringRForMarker * 0.14)));
          const fillH = troopCount > 0 ? Math.max(2, Math.round(innerR * 2 * displayFillFrac)) : 0;
          const fillY = Math.round(territory.y + innerR - fillH);
          const fillX = Math.round(territory.x - innerR);
          const fillW = Math.round(innerR * 2);
          /* Decade dots: 11–20→1 … 55→5, 50→4; losing one from 50→49 keeps 4 dots, fluid 9/10. */
          const decadeNotchCount =
            troopCount <= 10 ? 0 : Math.min(10, Math.floor((troopCount - 1) / 10));
          const showCenturyGreenNotch = troopCount > 100;
          fillGeom = {
            innerR,
            fillX,
            fillY,
            fillW,
            fillH,
            troopCount,
            decadeNotchCount,
            showCenturyGreenNotch,
            ringRForMarker,
          };
        }
        const risqueSvgNs = 'http://www.w3.org/2000/svg';
        const numberTextContent = (
          playerName
            ? Number(troops) || 1
            : isMockGameMaker
              ? 1
              : 0
        ).toString().padStart(3, '0');
        const pathNorm = (window.location.pathname || '').replace(/\\/g, '/').toLowerCase();
        var bodyPhaseAttr = '';
        try {
          bodyPhaseAttr =
            typeof document !== 'undefined' && document.body
              ? String(document.body.getAttribute('data-risque-phase') || '')
              : '';
        } catch (eBp) {
          bodyPhaseAttr = '';
        }
        const isAttackUi =
          pathNorm.endsWith('/attack.html') ||
          gameState.phase === 'attack' ||
          urlPhase === 'attack' ||
          bodyPhaseAttr === 'attack';
        const isReinforceUi =
          gameState.phase === 'reinforce' ||
          urlPhase === 'reinforce';
        const useGlobalTerritoryHandler =
          typeof window.handleTerritoryClick === 'function' &&
          (isMockGameMaker || isAttackUi || isReinforceUi);
        let number;
        const numberPointerTargets = [];
        number = document.createElementNS(risqueSvgNs, 'text');
        number.setAttributeNS(null, 'x', String(territory.x));
        number.setAttributeNS(null, 'y', String(territory.y));
        number.setAttributeNS(null, 'class', 'territory-number');
        number.setAttributeNS(null, 'text-anchor', 'middle');
        number.setAttributeNS(null, 'dominant-baseline', 'central');
        number.setAttributeNS(null, 'font-size', String(Math.round(21 * mgmVisScale)));
        number.setAttributeNS(null, 'font-family', 'Arial, sans-serif');
        number.setAttributeNS(null, 'font-weight', 'bold');
        number.setAttributeNS(null, 'data-label', label);
        number.textContent = numberTextContent;
        number.style.opacity = '1';
        number.style.pointerEvents = 'all';
        if (playerName) {
          number.setAttributeNS(null, 'fill', '#ffffff');
          number.setAttributeNS(null, 'stroke', '#000000');
          number.setAttributeNS(null, 'stroke-width', '5');
          number.setAttributeNS(null, 'paint-order', 'stroke fill');
        } else {
          number.setAttributeNS(null, 'fill', '#ffffff');
          number.setAttributeNS(null, 'stroke', '#000000');
          number.setAttributeNS(null, 'stroke-width', String(Math.max(2.25, 3.0 * mgmVisScale) + 1));
          number.setAttributeNS(null, 'paint-order', 'stroke fill');
        }
        numberPointerTargets.push(number);
        if (useGlobalTerritoryHandler) {
          const troopsForHandler = playerName ? Number(troops) || 1 : 1;
          const clickHandler = e => {
            risqueCoreDebugLog(`[Core] Circle clicked: ${label}`);
            window.handleTerritoryClick(label, playerName || 'None', troopsForHandler, e);
            if (isMockGameMaker && e && typeof e.stopPropagation === 'function') e.stopPropagation();
          };
          const keydownHandler = e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              risqueCoreDebugLog(`[Core] Circle keydown: ${label}`);
              window.handleTerritoryClick(label, playerName || 'None', troopsForHandler, e);
              if (isMockGameMaker && typeof e.stopPropagation === 'function') e.stopPropagation();
            }
          };
          circle.addEventListener('click', clickHandler);
          circle.addEventListener('keydown', keydownHandler);
          numberPointerTargets.forEach(el => {
            el.addEventListener('click', clickHandler);
            el.addEventListener('keydown', keydownHandler);
          });
        } else {
          const clickHandler = () => this.handleTerritoryClick(label, circle, territory.r, gameState);
          circle.addEventListener('click', clickHandler);
          numberPointerTargets.forEach(el => el.addEventListener('click', clickHandler));
        }
        let troopFill = null;
        let troopFillClip = null;
        if (playerName && fillGeom && fillGeom.troopCount > 0) {
          const { innerR, fillX, fillY, fillW, fillH } = fillGeom;
          const clipId = `risque-troop-fill-clip-${String(label).replace(/[^a-z0-9_-]/gi, '_')}`;
          troopFillClip = document.createElementNS(risqueSvgNs, 'clipPath');
          troopFillClip.setAttributeNS(null, 'id', clipId);
          troopFillClip.setAttributeNS(null, 'data-troop-fill-clip', label);
          const fillRect = document.createElementNS(risqueSvgNs, 'rect');
          fillRect.setAttributeNS(null, 'x', String(fillX));
          fillRect.setAttributeNS(null, 'y', String(fillY));
          fillRect.setAttributeNS(null, 'width', String(fillW));
          fillRect.setAttributeNS(null, 'height', String(fillH));
          troopFillClip.appendChild(fillRect);
          troopFill = document.createElementNS(risqueSvgNs, 'circle');
          troopFill.setAttributeNS(null, 'cx', territory.x);
          troopFill.setAttributeNS(null, 'cy', territory.y);
          troopFill.setAttributeNS(null, 'r', String(innerR));
          const troopFluidFill = color;
          troopFill.setAttributeNS(null, 'fill', troopFluidFill);
          troopFill.setAttributeNS(null, 'class', 'territory-troop-fill');
          troopFill.setAttributeNS(null, 'data-label', label);
          troopFill.setAttributeNS(null, 'aria-hidden', 'true');
          troopFill.setAttributeNS(null, 'clip-path', `url(#${clipId})`);
          troopFill.style.opacity = '1';
          troopFill.style.pointerEvents = 'none';
          troopFill.setAttributeNS(null, 'stroke', 'none');
          troopFill.setAttributeNS(null, 'stroke-width', '0');
        }
        let troopNotchGroup = null;
        if (playerName && fillGeom && (fillGeom.decadeNotchCount > 0 || fillGeom.showCenturyGreenNotch)) {
          const cx = territory.x;
          const cy = territory.y;
          const ringR = fillGeom.ringRForMarker;
          const strokeBand = playerName ? 7 : 2;
          const strokeInner = ringR - strokeBand / 2;
          const strokeOuter = ringR + strokeBand / 2;
          /* Inset from outer stroke so dots never touch the outside edge (1–2px gap). */
          const outerPad = 2;
          const dotR =
            3.5 *
            Math.max(1.5, Math.min(3.2, ringR * 0.052 * mgmVisScale));
          const rOuterLimit = strokeOuter - outerPad - dotR;
          const rInnerLimit = strokeInner + dotR + 0.5;
          const bandBias = strokeInner + (strokeOuter - strokeInner) * 0.55;
          const rCircleCenter = Math.max(rInnerLimit, Math.min(rOuterLimit, bandBias));
          /* Decade dots: uniform white fill + 5px black rim for every player color. */
          /* First dot at 7 o'clock, then every 36° clockwise. */
          const notchBaseRad = (2 * Math.PI) / 3;
          troopNotchGroup = document.createElementNS(risqueSvgNs, 'g');
          troopNotchGroup.setAttributeNS(null, 'class', 'territory-troop-notches');
          troopNotchGroup.setAttributeNS(null, 'data-label', label);
          troopNotchGroup.setAttributeNS(null, 'aria-hidden', 'true');
          troopNotchGroup.style.pointerEvents = 'none';
          const addDotAt = (phi, fillHex, strokeHex = null, strokeW = 0) => {
            const c = Math.cos(phi);
            const s = Math.sin(phi);
            const dot = document.createElementNS(risqueSvgNs, 'circle');
            dot.setAttributeNS(null, 'cx', String(cx + rCircleCenter * c));
            dot.setAttributeNS(null, 'cy', String(cy + rCircleCenter * s));
            dot.setAttributeNS(null, 'r', String(dotR));
            dot.setAttributeNS(null, 'fill', fillHex);
            if (strokeHex && strokeW > 0) {
              dot.setAttributeNS(null, 'stroke', strokeHex);
              dot.setAttributeNS(null, 'stroke-width', String(strokeW));
              dot.setAttributeNS(null, 'paint-order', 'stroke fill');
            } else {
              dot.setAttributeNS(null, 'stroke', 'none');
              dot.setAttributeNS(null, 'stroke-width', '0');
            }
            troopNotchGroup.appendChild(dot);
          };
          for (let k = 0; k < fillGeom.decadeNotchCount; k++) {
            const phi = notchBaseRad + (k * 2 * Math.PI) / 10;
            addDotAt(phi, '#ffffff', '#000000', 5);
          }
          if (fillGeom.showCenturyGreenNotch) {
            addDotAt(Math.PI / 2, '#16a34a', '#000000', 5);
          }
        }
        if (useMgmDual && mgmVis) {
          const visR = displayBaseR * MGM_SELECT_R_MULT;
          let hoverDepth = 0;
          circle.setAttributeNS(null, 'r', popIn ? '0' : String(displayBaseR));
          mgmVis.setAttributeNS(null, 'r', popIn ? '0' : String(displayBaseR));
          if (markerOutline) {
            markerOutline.setAttributeNS(null, 'r', popIn ? '0' : String(markerOutlineRadiusFor(displayBaseR)));
          }
          if (markerInnerSeparator) {
            markerInnerSeparator.setAttributeNS(
              null,
              'r',
              popIn ? '0' : String(markerInnerSeparatorRadiusFor(displayBaseR))
            );
          }
          const bumpMgmRadii = () => {
            const hitR = displayBaseR + 5;
            circle.setAttributeNS(null, 'r', String(hitR));
            mgmVis.setAttributeNS(null, 'r', String(hitR * MGM_SELECT_R_MULT));
            if (markerOutline) {
              markerOutline.setAttributeNS(null, 'r', String(markerOutlineRadiusFor(hitR * MGM_SELECT_R_MULT)));
            }
            if (markerInnerSeparator) {
              markerInnerSeparator.setAttributeNS(
                null,
                'r',
                String(markerInnerSeparatorRadiusFor(hitR * MGM_SELECT_R_MULT))
              );
            }
          };
          const resetMgmRadii = () => {
            circle.setAttributeNS(null, 'r', String(displayBaseR));
            mgmVis.setAttributeNS(null, 'r', String(visR));
            if (markerOutline) {
              markerOutline.setAttributeNS(null, 'r', String(markerOutlineRadiusFor(visR)));
            }
            if (markerInnerSeparator) {
              markerInnerSeparator.setAttributeNS(
                null,
                'r',
                String(markerInnerSeparatorRadiusFor(visR))
              );
            }
          };
          const onHoverEnter = () => {
            hoverDepth += 1;
            if (!deployTerritorySelected) bumpMgmRadii();
          };
          const onHoverLeave = () => {
            hoverDepth = Math.max(0, hoverDepth - 1);
            if (hoverDepth === 0) resetMgmRadii();
          };
          circle.addEventListener('mouseenter', onHoverEnter);
          circle.addEventListener('mouseleave', onHoverLeave);
          numberPointerTargets.forEach(el => {
            el.addEventListener('mouseenter', onHoverEnter);
            el.addEventListener('mouseleave', onHoverLeave);
          });
        } else {
          let hoverDepth = 0;
          circle.setAttributeNS(null, 'r', popIn ? '0' : String(displayBaseR));
          if (markerOutline) {
            markerOutline.setAttributeNS(null, 'r', popIn ? '0' : String(markerOutlineRadiusFor(displayBaseR)));
          }
          if (markerInnerSeparator) {
            markerInnerSeparator.setAttributeNS(
              null,
              'r',
              popIn ? '0' : String(markerInnerSeparatorRadiusFor(displayBaseR))
            );
          }
          const bumpBaseRadii = () => {
            circle.setAttributeNS(null, 'r', displayBaseR + 5);
            if (markerOutline) markerOutline.setAttributeNS(null, 'r', String(markerOutlineRadiusFor(displayBaseR + 5)));
            if (markerInnerSeparator) {
              markerInnerSeparator.setAttributeNS(
                null,
                'r',
                String(markerInnerSeparatorRadiusFor(displayBaseR + 5))
              );
            }
          };
          const resetBaseRadii = () => {
            circle.setAttributeNS(null, 'r', String(displayBaseR));
            if (markerOutline) markerOutline.setAttributeNS(null, 'r', String(markerOutlineRadiusFor(displayBaseR)));
            if (markerInnerSeparator) {
              markerInnerSeparator.setAttributeNS(
                null,
                'r',
                String(markerInnerSeparatorRadiusFor(displayBaseR))
              );
            }
          };
          const onHoverEnter = () => {
            hoverDepth += 1;
            if (!deployTerritorySelected) bumpBaseRadii();
          };
          const onHoverLeave = () => {
            hoverDepth = Math.max(0, hoverDepth - 1);
            if (hoverDepth === 0) resetBaseRadii();
          };
          circle.addEventListener('mouseenter', onHoverEnter);
          circle.addEventListener('mouseleave', onHoverLeave);
          numberPointerTargets.forEach(el => {
            el.addEventListener('mouseenter', onHoverEnter);
            el.addEventListener('mouseleave', onHoverLeave);
          });
        }
        if (markerOutline) svg.appendChild(markerOutline);
        if (mgmVis) svg.appendChild(mgmVis);
        if (troopFillClip) svg.appendChild(troopFillClip);
        svg.appendChild(circle);
        if (markerInnerSeparator) svg.appendChild(markerInnerSeparator);
        if (troopFill) svg.appendChild(troopFill);
        if (troopNotchGroup) svg.appendChild(troopNotchGroup);
        svg.appendChild(number);
        if (useMgmDual && mgmVis && !popIn) {
          const visTargetR = displayBaseR * MGM_SELECT_R_MULT;
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              mgmVis.setAttributeNS(null, 'r', String(visTargetR));
              if (markerOutline) markerOutline.setAttributeNS(null, 'r', String(markerOutlineRadiusFor(visTargetR)));
              if (markerInnerSeparator) {
                markerInnerSeparator.setAttributeNS(
                  null,
                  'r',
                  String(markerInnerSeparatorRadiusFor(visTargetR))
                );
              }
            });
          });
        }
        if (popIn) {
          number.style.opacity = '0';
          number.classList.add('territory-number--deal-pop');
          circle.classList.add('territory-circle--deal-pop');
          /* One frame at r=0 so the CSS transition on r actually runs (setTimeout(10) was too flaky). */
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              circle.setAttributeNS(null, 'r', String(displayBaseR));
              if (markerOutline) markerOutline.setAttributeNS(null, 'r', String(markerOutlineRadiusFor(displayBaseR)));
              if (markerInnerSeparator) {
                markerInnerSeparator.setAttributeNS(
                  null,
                  'r',
                  String(markerInnerSeparatorRadiusFor(displayBaseR))
                );
              }
              number.style.opacity = '1';
            });
          });
          var dealPopCleanup = function () {
            circle.classList.remove('territory-circle--deal-pop');
            number.classList.remove('territory-number--deal-pop');
          };
          circle.addEventListener(
            'transitionend',
            function onDealPopEnd(e) {
              if (e.propertyName !== 'r' && e.propertyName !== 'radius') return;
              clearTimeout(dealPopFallback);
              dealPopCleanup();
              circle.removeEventListener('transitionend', onDealPopEnd);
            }
          );
          var dealPopFallback = setTimeout(function () {
            dealPopCleanup();
          }, 600);
        }
        /* Host + public TV: show +N satellite when deploy deltas exist (public uses risqueDeployMirrorDraft.deltas). */
        const showDeploySatellite =
          isDeployPhase && playerName === gameState.currentPlayer && deployDelta > 0;
        if (showDeploySatellite) {
          const deltaLabel = '+' + String(deployDelta);
          const satFont = 21;
          const padX = Math.max(4, Math.round(satFont * 0.28));
          const padY = Math.max(1, Math.round(satFont * 0.06));
          const charW = satFont * 0.58;
          const charSlots = Math.max(4, deltaLabel.length);
          const rectW = Math.round(padX * 2 + charSlots * charW);
          const rectH = Math.round(satFont * 1.05 + padY * 2);
          const rx = 2;
          const numHalfH = 11;
          const gapAboveTroops = 3;
          const shiftRight = Math.max(7, Math.round(displayBaseR * 0.26));
          const bottomY = territory.y - numHalfH - gapAboveTroops;
          const satCx = territory.x + shiftRight;
          const satCy = bottomY - rectH / 2;
          const satG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          satG.setAttributeNS(null, 'class', 'territory-deploy-satellite');
          satG.setAttributeNS(null, 'data-label', label);
          satG.setAttributeNS(null, 'aria-hidden', 'true');
          const satBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          satBg.setAttributeNS(null, 'x', String(satCx - rectW / 2));
          satBg.setAttributeNS(null, 'y', String(satCy - rectH / 2));
          satBg.setAttributeNS(null, 'width', String(rectW));
          satBg.setAttributeNS(null, 'height', String(rectH));
          satBg.setAttributeNS(null, 'rx', String(rx));
          satBg.setAttributeNS(null, 'ry', String(rx));
          const satTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          satTxt.setAttributeNS(null, 'x', String(satCx));
          satTxt.setAttributeNS(null, 'y', String(satCy));
          satTxt.setAttributeNS(null, 'text-anchor', 'middle');
          satTxt.setAttributeNS(null, 'dominant-baseline', 'central');
          satTxt.setAttributeNS(null, 'font-size', String(satFont));
          satTxt.setAttributeNS(null, 'font-family', 'Arial, sans-serif');
          satTxt.setAttributeNS(null, 'font-weight', 'bold');
          satTxt.textContent = deltaLabel;
          satG.appendChild(satBg);
          satG.appendChild(satTxt);
          svg.appendChild(satG);
        }
        risqueCoreDebugLog(`[Core] Rendered territory ${label}: owner=${playerName || 'none'}, color=${isDeployed ? '#ffffff' : color}, troops=${troops}, deployed=${isDeployed}, x=${territory.x}, y=${territory.y}`);
      });
      risqueCoreDebugLog(`[Core] Rendered ${renderTerritories.length} territory markers`);
    } catch (e) {
      console.error('[Core] Error rendering territories:', e.message);
      this.showError('Error rendering territories');
    }
  },
  handleTerritoryClick: function(label, circle, originalR, gameState) {
    risqueCoreDebugLog(`[Core] Clicked territory: ${label}`);
    var prevDeploySelection =
      gameState && String(gameState.phase) === 'deploy' ? window.selectedTerritory : null;
    if (gameState && String(gameState.phase) === 'deploy' && gameState.risqueDeployTransientPrimary != null) {
      delete gameState.risqueDeployTransientPrimary;
    }
    if (!gameState || !gameState.players) {
      console.error('[Core] Game state or players undefined');
      this.showError('Game state or players undefined');
      window.selectedTerritory = null;
      requestAnimationFrame(() => {
        this.renderTerritories(null, gameState, window.deployedTroops || {});
        this.renderStats(gameState);
      });
      return;
    }
    const player = gameState.players.find(p => p.name === gameState.currentPlayer);
    const territory = player?.territories.find(t => t.name === label);
    if (label === window.selectedTerritory) {
      window.selectedTerritory = null;
      this.showError('');
    } else {
      window.selectedTerritory = null;
      this.showError('');
      if (territory) {
        window.selectedTerritory = label;
      } else {
        this.showError(`You do not own ${label.replace(/_/g, ' ')}.`);
      }
    }
    circle.setAttributeNS(null, 'r', originalR);
    circle.classList.toggle('selected', !!window.selectedTerritory && window.selectedTerritory === label);
    requestAnimationFrame(() => {
      this.renderTerritories(null, gameState, window.deployedTroops || {});
      this.renderStats(gameState);
      if (typeof window.risqueSetSpectatorFocus === 'function') {
        window.risqueSetSpectatorFocus(window.selectedTerritory ? [window.selectedTerritory] : []);
      }
      if (
        gameState &&
        String(gameState.phase) === 'deploy' &&
        typeof window.risqueRefreshDeployNarration === 'function'
      ) {
        window.risqueRefreshDeployNarration(gameState, { prevSelection: prevDeploySelection });
      }
    });
  },
  renderStats: function(gameState) {
    risqueCoreDebugLog('[Core] Rendering SVG stats, gameState:', gameState);
    try {
      const svg = risqueGetCanvasSvgOverlay();
      if (!svg) {
        console.error('[Core] SVG overlay not found');
        this.showError('SVG overlay not found');
        return;
      }
      if (typeof window !== 'undefined' && window.RISQUE_REPLAY_MACHINE) {
        const replayRm = svg.querySelector('#stats-group');
        if (replayRm && replayRm.parentNode) replayRm.parentNode.removeChild(replayRm);
        const replayHud = document.getElementById('hud-stats-panel');
        if (replayHud) replayHud.replaceChildren();
        return;
      }
      const hudPanelEarly = document.getElementById('hud-stats-panel');
      let statGs = gameState;
      const coreMissing =
        !gameState ||
        !Array.isArray(gameState.players) ||
        !gameState.currentPlayer ||
        !Array.isArray(gameState.turnOrder) ||
        !gameState.players.some(p => p && p.name === gameState.currentPlayer);

      if (coreMissing) {
        if (!hudPanelEarly) {
          if (!gameState || !gameState.players || !gameState.currentPlayer || !gameState.turnOrder) {
            console.error('[Core] Invalid gameState: missing players, currentPlayer, or turnOrder');
            this.showError('Invalid game state');
            return;
          }
          const curPlayerRow = gameState.players.find(p => p.name === gameState.currentPlayer);
          if (!curPlayerRow) {
            console.error('[Core] Current player not found in gameState');
            this.showError('Current player not found');
            return;
          }
        } else {
          const players = Array.isArray(gameState.players)
            ? gameState.players.map(p => ({
                name: p && p.name != null ? String(p.name) : '',
                color: (p && p.color) || 'gray',
                territories: p && Array.isArray(p.territories) ? p.territories : [],
                troopsTotal: p ? Number(p.troopsTotal) || 0 : 0,
                cards: p && p.cards,
                cardCount: p && p.cardCount
              }))
            : [];
          let turnOrder =
            Array.isArray(gameState.turnOrder) && gameState.turnOrder.length
              ? gameState.turnOrder.slice()
              : players.map(p => p.name).filter(Boolean);
          if (!turnOrder.length) turnOrder = [''];
          let currentPlayerNorm = gameState.currentPlayer;
          if (!currentPlayerNorm || !players.some(p => p.name === currentPlayerNorm)) {
            currentPlayerNorm =
              (turnOrder[0] && players.some(p => p.name === turnOrder[0]) ? turnOrder[0] : '') ||
              (players[0] && players[0].name) ||
              '';
          }
          statGs = Object.assign({}, gameState, { players, turnOrder, currentPlayer: currentPlayerNorm });
        }
      }
      const existingStats = svg.querySelector('#stats-group');
      const statsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      statsGroup.setAttribute('id', 'stats-group');
      statsGroup.setAttribute('aria-label', 'Game statistics table');
      const tableX = 1105;
      const tableY = 20;
      const cellPadding = 3.0375;
      const borderWidth = 1.0125;
      const headerFontSize = 10.125;
      const cellFontSize = 11.1375;
      const rowHeight = 22.275;
      const headerRowHeight = 20.25;
      const columnWidths = [116.7855, 116.7855, 116.7855, 116.7855 + 314.128125];
      const maxPlayers = 6;
      const rows = [];
      rows.push(['Player', 'Territories', 'Troops', 'Cards']);
      const player1c = statGs.turnOrder[0];
      const orderedPlayers = [];
      const player1cData = statGs.players.find(p => p.name === player1c);
      if (player1cData) orderedPlayers.push(player1cData);
      statGs.turnOrder
        .filter(name => name !== player1c)
        .forEach(name => {
          const player = statGs.players.find(p => p.name === name);
          if (player) orderedPlayers.push(player);
        });
      for (let i = 0; i < maxPlayers; i++) {
        const p = orderedPlayers[i] || { name: '', territories: [], troopsTotal: 0, cardCount: 0 };
        const troops = Number(p.troopsTotal) || 0;
        const cards = this.playerCardCount(p);
        const nameCell = p.name ? String(p.name) : '';
        rows.push([nameCell, p.territories.length || 0, troops, p.name ? cards : 0]);
        risqueCoreDebugLog(`[Core] Stats for ${p.name || 'empty'}: territories=${p.territories.length || 0}, troops=${troops}, cards=${cards}`);
      }
      const deckRemaining = Array.isArray(statGs.deck) ? statGs.deck.length : 0;
      rows.push([
        'ROUNDS:',
        String(statGs.round != null ? statGs.round : 1),
        'IN DECK:',
        String(deckRemaining)
      ]);
      const continentLegend = this.getContinentBoardControllers(statGs);
      let currentY = tableY + cellPadding;
      rows.forEach((row, rowIndex) => {
        let currentX = tableX + cellPadding;
        const isHeader = rowIndex === 0;
        const isPlayerRow = rowIndex >= 1 && rowIndex <= maxPlayers;
        const isRoundsRow = rowIndex === rows.length - 1;
        const playerName = isPlayerRow ? row[0] : null;
        const player = playerName ? statGs.players.find(p => p.name === playerName) : null;
        const isCurrentPlayer = !!playerName && playerName === statGs.currentPlayer;
        const rowHeightToUse = isHeader ? headerRowHeight : rowHeight;
        const fontSize = isHeader ? headerFontSize : cellFontSize;
        row.forEach((cell, colIndex) => {
          const cellRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          cellRect.setAttribute('x', currentX);
          cellRect.setAttribute('y', currentY);
          cellRect.setAttribute('width', columnWidths[colIndex]);
          cellRect.setAttribute('height', rowHeightToUse);
          cellRect.setAttribute(
            'fill',
            isPlayerRow && player ? this.statsPanelPlayerBgHex(player.color) : 'transparent'
          );
          cellRect.setAttribute('stroke', isCurrentPlayer ? '#ffffff' : '#000000');
          cellRect.setAttribute('stroke-width', isCurrentPlayer ? '3' : borderWidth);
          cellRect.style.opacity = isPlayerRow && !isCurrentPlayer ? '0.5' : '1';
          statsGroup.appendChild(cellRect);
          if (cell) {
            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', currentX + columnWidths[colIndex] / 2);
            text.setAttribute('y', currentY + rowHeightToUse / 2);
            let fill = '#000000';
            if (isRoundsRow) fill = '#00ff00';
            else if (isPlayerRow && player && this.statsPanelPlayerUseLightText(player.color)) fill = '#ffffff';
            text.setAttribute('fill', fill);
            text.setAttribute('font-family', 'Arial, sans-serif');
            text.setAttribute('font-size', fontSize);
            text.setAttribute('font-weight', 'bold');
            text.setAttribute('text-anchor', 'middle');
            text.setAttribute('dominant-baseline', 'central');
            text.setAttribute('opacity', '1');
            text.textContent = cell.toString();
            statsGroup.appendChild(text);
          }
          currentX += columnWidths[colIndex] + borderWidth;
        });
        currentY += rowHeightToUse + borderWidth;
      });
      const tableInnerW =
        columnWidths.reduce((a, w) => a + w, 0) + borderWidth * (columnWidths.length - 1);
      const legendGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      legendGroup.setAttribute('id', 'stats-continent-legend');
      legendGroup.setAttribute('aria-label', 'Board continents');
      const legendFont = cellFontSize;
      const ballR = legendFont * 0.52;
      const legendYBase = currentY + 12 + legendFont;
      const perLegendRow = 3;
      const legendRowPitch = legendFont * 2.15;
      const slotW = tableInnerW / perLegendRow;
      continentLegend.forEach((entry, i) => {
        const rowIdx = Math.floor(i / perLegendRow);
        const colIdx = i % perLegendRow;
        const slotCX = tableX + cellPadding + (colIdx + 0.5) * slotW;
        const legendYMid = legendYBase + rowIdx * legendRowPitch;
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('transform', `translate(${slotCX},${legendYMid})`);
        const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        label.setAttribute('x', String(-ballR - 8));
        label.setAttribute('y', '0');
        label.setAttribute('font-family', 'Arial, sans-serif');
        label.setAttribute('font-size', String(legendFont));
        label.setAttribute('font-weight', 'bold');
        label.setAttribute('text-anchor', 'end');
        label.setAttribute('dominant-baseline', 'central');
        label.setAttribute('fill', '#00ff00');
        label.textContent = `${entry.label} = ${entry.payoff}`;
        g.appendChild(label);
        const ball = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        ball.setAttribute('cx', String(ballR + 9));
        ball.setAttribute('cy', '0');
        ball.setAttribute('r', String(ballR));
        const continentBallFill = entry.player
          ? this.colorHexForPlayer(entry.player) || '#808080'
          : '#00ff00';
        ball.setAttribute('fill', continentBallFill);
        g.appendChild(ball);
        legendGroup.appendChild(g);
      });
      statsGroup.appendChild(legendGroup);
      if (existingStats) {
        existingStats.replaceWith(statsGroup);
      } else {
        svg.appendChild(statsGroup);
      }
      risqueCoreDebugLog(`[Core] Rendered SVG stats at x=${tableX}, y=${tableY}`);

      const hudPanel = document.getElementById('hud-stats-panel');
      if (hudPanel) {
        hudPanel.replaceChildren();
        const wrap = document.createElement('div');
        wrap.className = 'hud-stats-inner';
        const tbl = document.createElement('table');
        tbl.className = 'hud-stats-table';
        rows.forEach((row, rowIndex) => {
          const tr = document.createElement('tr');
          const isHeader = rowIndex === 0;
          const isPlayerRow = rowIndex >= 1 && rowIndex <= maxPlayers;
          const isRoundsRow = rowIndex === rows.length - 1;
          const playerName = isPlayerRow ? row[0] : null;
          const player = playerName ? statGs.players.find(p => p.name === playerName) : null;
          const isCurrentPlayer = isPlayerRow && !!playerName && playerName === statGs.currentPlayer;
          if (isHeader) {
            tr.className = 'hud-stats-header-row';
          } else if (isPlayerRow) {
            tr.classList.add('hud-stats-player-row');
            if (player) tr.classList.add('hud-stats-player-row--filled');
            else tr.classList.add('hud-stats-player-row--empty');
          } else if (isRoundsRow) {
            tr.className = 'hud-stats-rounds-row';
          }
          if (isCurrentPlayer) tr.classList.add('hud-stats-current');
          row.forEach(cell => {
            const cellEl = document.createElement(isHeader ? 'th' : 'td');
            const t = cell != null && cell !== '' ? String(cell) : '';
            cellEl.textContent = t;
            if (isPlayerRow && player) {
              cellEl.style.background = this.statsPanelPlayerBgHex(player.color);
              cellEl.classList.add(
                this.statsPanelPlayerUseLightText(player.color)
                  ? 'hud-stats-player-cell--on-dark'
                  : 'hud-stats-player-cell--on-light'
              );
              cellEl.style.opacity = isCurrentPlayer ? '1' : '0.55';
            }
            tr.appendChild(cellEl);
          });
          tbl.appendChild(tr);
        });
        wrap.appendChild(tbl);
        const leg = document.createElement('div');
        leg.className = 'hud-stats-continent-legend';
        leg.setAttribute('aria-label', 'Board continents');
        for (let r = 0; r < continentLegend.length; r += 3) {
          const rowEl = document.createElement('div');
          rowEl.className = 'hud-stats-continent-legend-row';
          continentLegend.slice(r, r + 3).forEach(entry => {
            const item = document.createElement('span');
            item.className = 'hud-stats-continent-item';
            item.title = entry.player
              ? `${entry.label} = ${entry.payoff} · ${entry.player.name}`
              : `${entry.label} = ${entry.payoff} · unclaimed`;
            const nameEl = document.createElement('span');
            nameEl.className = 'hud-stats-continent-name';
            nameEl.textContent = `${entry.label} = ${entry.payoff}`;
            const ball = document.createElement('span');
            ball.className = 'hud-stats-continent-ball';
            ball.setAttribute('aria-hidden', 'true');
            const continentBallFill = entry.player
              ? this.colorHexForPlayer(entry.player) || '#808080'
              : '#00ff00';
            ball.style.setProperty('background-color', continentBallFill, 'important');
            item.appendChild(nameEl);
            item.appendChild(ball);
            rowEl.appendChild(item);
          });
          leg.appendChild(rowEl);
        }
        wrap.appendChild(leg);
        hudPanel.appendChild(wrap);
        statsGroup.setAttribute('visibility', 'hidden');
      } else {
        statsGroup.removeAttribute('visibility');
      }
    } catch (e) {
      console.error('[Core] Error rendering stats:', e.message);
      this.showError('Error rendering stats');
    }
  },
  getPlayerContinents: function(player) {
    try {
      const continentsOwned = [];
      const gs = typeof window !== 'undefined' && window.gameState ? window.gameState : null;
      for (const continent of Object.keys(this.continents)) {
        const territoryIds = this.getContinentTerritoryIdsForBoard(gs, continent);
        if (
          territoryIds.length &&
          territoryIds.every(tid =>
            player.territories.some(pt => this.territoryNameFromEntry(pt) === tid)
          )
        ) {
          continentsOwned.push(this.continentDisplayNames[continent]);
        }
      }
      return continentsOwned;
    } catch (e) {
      console.error('[Core] Error in getPlayerContinents:', e.message);
      return [];
    }
  },
  /** Full control of a continent on the board, or null if split / unowned. */
  getContinentBoardOwner: function(gameState, continentKey) {
    try {
      const territoryIds = this.getContinentTerritoryIdsForBoard(gameState, continentKey);
      if (!territoryIds.length || !gameState || !Array.isArray(gameState.players)) return null;
      for (let i = 0; i < gameState.players.length; i++) {
        const p = gameState.players[i];
        if (!p || !Array.isArray(p.territories)) continue;
        const hasAll = territoryIds.every(tid =>
          p.territories.some(pt => this.territoryNameFromEntry(pt) === tid)
        );
        if (hasAll) return p;
      }
      return null;
    } catch (e) {
      console.error('[Core] Error in getContinentBoardOwner:', e.message);
      return null;
    }
  },
  /** Stable order for stats legend under the table (HUD + SVG). Includes next card-payoff value per continent. */
  getContinentBoardControllers: function(gameState) {
    const order = ['south_america', 'north_america', 'africa', 'europe', 'asia', 'australia'];
    const counts = (gameState && gameState.continentCollectionCounts) || {};
    return order.map(key => {
      const collectionCount = Number(counts[key]) || 0;
      let payoff = 0;
      try {
        payoff = this.getNextContinentValue(key, collectionCount);
      } catch (e) {
        payoff = 0;
      }
      return {
        key,
        label: this.continentDisplayNames[key] || key,
        player: this.getContinentBoardOwner(gameState, key),
        payoff
      };
    });
  },
  playerCardCount: function(player) {
    if (!player || !player.name) return 0;
    if (Array.isArray(player.cards)) return player.cards.length;
    const n = Number(player.cardCount);
    return Number.isFinite(n) ? n : 0;
  },
  /**
   * Risk-style set: three matching unit types, or one infantry + one cavalry + one artillery. Wildcards substitute.
   * @param {string[]} cardIds - exactly three card ids (territory or wildcard)
   */
  isValidRisqueThreeCardSet: function(cardIds) {
    if (!Array.isArray(cardIds) || cardIds.length !== 3) return false;
    var ct = { infantry: 0, cavalry: 0, artillery: 0, wildcard: 0 };
    for (var x = 0; x < 3; x++) {
      var t = this.cardTypes[cardIds[x]] || 'wildcard';
      if (t === 'wildcard') ct.wildcard++;
      else if (t === 'infantry') ct.infantry++;
      else if (t === 'cavalry') ct.cavalry++;
      else if (t === 'artillery') ct.artillery++;
    }
    var w = ct.wildcard;
    var i = ct.infantry;
    var c = ct.cavalry;
    var a = ct.artillery;
    if (i + w >= 3 || c + w >= 3 || a + w >= 3) return true;
    if (i > 1 || c > 1 || a > 1) return false;
    if (i + c + a + w !== 3) return false;
    var need = (i === 0 ? 1 : 0) + (c === 0 ? 1 : 0) + (a === 0 ? 1 : 0);
    return w >= need;
  },
  /**
   * Whether the hand contains at least one valid 3-card set (checks all triplets when hand size > 3).
   * @param {{ name: string }[]|string[]} cards - card objects with .name or string ids
   */
  canFormValidRisqueBook: function(cards) {
    if (!Array.isArray(cards) || cards.length < 3) return false;
    var ids = [];
    for (var u = 0; u < cards.length; u++) {
      var entry = cards[u];
      var id = typeof entry === 'string' ? entry : entry && entry.name;
      if (!id) return false;
      ids.push(id);
    }
    var n = ids.length;
    if (n === 3) return this.isValidRisqueThreeCardSet(ids);
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        for (var k = j + 1; k < n; k++) {
          if (this.isValidRisqueThreeCardSet([ids[i], ids[j], ids[k]])) return true;
        }
      }
    }
    return false;
  },
  getTerritoryNames: function() {
    return Object.keys(this.territories);
  },
  getTerritoryCoords: function() {
    return this.territories;
  },
  getAdjacencies: function(territory) {
    return this.adjacencies[territory] || [];
  },
  resizeCanvas: function() {
    const canvas = document.getElementById('canvas');
    if (!canvas) {
      risqueCoreDebugLog('[Core] Canvas not found for scaling');
      return;
    }
    var availW = window.innerWidth;
    var availH = window.innerHeight;
    if (window.RISQUE_REPLAY_MACHINE) {
      var host = document.querySelector('.replay-stage-host');
      if (host && typeof host.getBoundingClientRect === 'function') {
        var r = host.getBoundingClientRect();
        if (r.width > 32 && r.height > 32) {
          availW = r.width;
          availH = r.height;
        }
      }
    }
    const scale = Math.min(availH / 1080, availW / 1920);
    canvas.style.transform = `translate(-50%, 0) scale(${scale})`;
    canvas.classList.add('visible');
    const stageImage = canvas.querySelector('.stage-image');
    const stageImageDesat = canvas.querySelector('.stage-image-desat-mask');
    const svgOverlay = canvas.querySelector('.svg-overlay');
    const uiOverlay = document.querySelector('.ui-overlay');
    if (stageImage) stageImage.classList.add('visible');
    if (stageImageDesat) stageImageDesat.classList.add('visible');
    if (svgOverlay) svgOverlay.classList.add('visible');
    if (uiOverlay) uiOverlay.classList.add('visible');
    risqueCoreDebugLog('[Core] Canvas scaled:', { scale, innerWidth: window.innerWidth, innerHeight: window.innerHeight });
    if (window.RISQUE_REPLAY_MACHINE && typeof window.risqueReplayPositionHud === "function") {
      try {
        window.risqueReplayPositionHud();
      } catch (eRp) {
        /* ignore */
      }
    }
  },
  renderAll: function(gameState, changedLabel = null, deployedTroops = {}) {
    this.renderTerritories(changedLabel, gameState, deployedTroops);
    this.renderStats(gameState);
  },
  renderGame: function() {
    this.loadGameState((gameState) => {
      if (gameState) {
        requestAnimationFrame(() => {
          this.renderAll(gameState);
        });
      }
    });
  },
  /**
   * Focus clears the field so typing replaces the value; blur with nothing typed restores the previous value.
   * Opt out: data-risque-no-clear-on-focus on the input.
   */
  installNumericInputClearOnFocus: function () {
    if (window.__risqueNumericInputClearWired) return;
    window.__risqueNumericInputClearWired = true;
    document.addEventListener(
      'focusin',
      function (e) {
        var t = e.target;
        if (!t || t.nodeName !== 'INPUT' || t.type !== 'number') return;
        if (t.disabled || t.readOnly) return;
        if (t.getAttribute('data-risque-no-clear-on-focus') != null) return;
        t.setAttribute('data-risque-numeric-prev', t.value);
        t.value = '';
      },
      false
    );
    document.addEventListener(
      'focusout',
      function (e) {
        var t = e.target;
        if (!t || t.nodeName !== 'INPUT' || t.type !== 'number') return;
        if (t.getAttribute('data-risque-no-clear-on-focus') != null) return;
        var prev = t.getAttribute('data-risque-numeric-prev');
        t.removeAttribute('data-risque-numeric-prev');
        var raw = String(t.value == null ? '' : t.value).trim();
        if (raw === '') {
          if (prev != null && prev !== '') {
            t.value = prev;
            try {
              t.dispatchEvent(new Event('input', { bubbles: true }));
              t.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e1) {
              /* ignore */
            }
          }
        }
      },
      false
    );
  },
  init: function() {
    this.initStyles();
    var _pathLower = (window.location.pathname || "").toLowerCase();
    if (_pathLower.indexOf("launch.html") !== -1 || _pathLower.endsWith("index.html")) {
      isLaunchPage = true;
      this.initLaunchPage();
    } else {
      isLaunchPage = false;
      risqueCoreDebugLog('[Core] Initializing game view for non-launch page');
      this.initGameView();
    }
    window.addEventListener('resize', () => requestAnimationFrame(() => this.resizeCanvas()));
    document.addEventListener('fullscreenchange', () => requestAnimationFrame(() => this.resizeCanvas()));
    document.addEventListener('webkitfullscreenchange', () => requestAnimationFrame(() => this.resizeCanvas()));
    document.addEventListener('mozfullscreenchange', () => requestAnimationFrame(() => this.resizeCanvas()));
    document.addEventListener('MSFullscreenChange', () => requestAnimationFrame(() => this.resizeCanvas()));
    document.addEventListener('wheel', e => {
      if (e.ctrlKey) e.preventDefault();
    }, { passive: false });
    document.addEventListener('keydown', e => {
      if (e.key === 'Equal' || e.key === 'Minus' || (e.ctrlKey && (e.key === '+' || e.key === '-'))) {
        e.preventDefault();
      }
    });
    risqueCoreDebugLog('[Core] Initialized');
  }
};

window.risqueDeployTroopCountToWord = function (n) {
  var words = [
    'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty'
  ];
  var num = Math.floor(Number(n));
  if (!Number.isFinite(num) || num < 0) return 'Zero';
  if (num < words.length) return words[num];
  return String(num);
};

window.risqueDeployPlacedPhrase = function (n) {
  var c = Math.max(0, Math.floor(Number(n)) || 0);
  if (c === 0) return '';
  var w = window.risqueDeployTroopCountToWord(c);
  return c === 1 ? w + ' troop placed' : w + ' troops placed';
};

window.risqueDeployBankReport = function (player) {
  var bank = Math.max(0, Number(player && player.bankValue) || 0);
  if (bank === 0) return '0 troops remaining in bank — confirm when finished';
  if (bank === 1) return '1 troop remaining in bank';
  return bank + ' troops remaining in bank';
};

/**
 * Host-only: updates control voice + mirrored gameState for public TV during phase "deploy".
 * @param {{ prevSelection?: string|null }} [opts] - previous selection before a territory click (from core)
 */
window.risqueRefreshDeployNarration = function (gameState, opts) {
  opts = opts || {};
  if (!gameState || String(gameState.phase) !== 'deploy') return;
  if (!window.risqueRuntimeHud || typeof window.risqueRuntimeHud.setControlVoiceText !== 'function') return;
  var player =
    gameState.players && gameState.players.find(function (p) {
      return p.name === gameState.currentPlayer;
    });
  if (!player) return;

  var report = window.risqueDeployBankReport(player);
  var pretty = function (id) {
    return window.gameUtils && window.gameUtils.formatTerritoryDisplayName
      ? window.gameUtils.formatTerritoryDisplayName(id)
      : String(id || '').replace(/_/g, ' ');
  };

  if (!window.selectedTerritory && gameState.risqueDeployTransientPrimary) {
    var tp = String(gameState.risqueDeployTransientPrimary);
    delete gameState.risqueDeployTransientPrimary;
    var transientVoice =
      String(report || '').trim() ? tp + '\n\n' + report : tp;
    try {
      gameState.risquePublicDeployBanner = transientVoice;
    } catch (ePubBanner0) { /* ignore */ }
    window.risqueRuntimeHud.setControlVoiceText(transientVoice, '');
    if (typeof window.risqueMirrorPushGameState === 'function') window.risqueMirrorPushGameState();
    else {
      try {
        localStorage.setItem('gameState', JSON.stringify(gameState));
      } catch (e0) { /* ignore */ }
    }
    return;
  }

  var dep = window.deployedTroops || {};
  var prev = opts.prevSelection;
  var sel = window.selectedTerritory;
  var parts = [];

  if (prev && prev !== sel && (dep[prev] || 0) > 0) {
    var nPrev = dep[prev] || 0;
    parts.push(
      player.name +
        ' has deployed ' +
        window.risqueDeployTroopCountToWord(nPrev) +
        ' troops to ' +
        pretty(prev) +
        '.'
    );
  }

  if (sel) {
    var nSel = dep[sel] || 0;
    if (nSel > 0) {
      parts.push(
        player.name +
          ' is deploying to ' +
          pretty(sel) +
          ' — ' +
          window.risqueDeployPlacedPhrase(nSel) +
          '.'
      );
    } else {
      parts.push(player.name + ' has selected ' + pretty(sel) + ' to deploy troops to.');
    }
  }

  var primary =
    parts.length > 0
      ? parts.join('\n')
      : player.name.toUpperCase() + '\nDEPLOYING TROOPS';

  var deployVoiceFull =
    String(report || '').trim() ? primary + '\n\n' + report : primary;
  try {
    gameState.risquePublicDeployBanner = deployVoiceFull;
  } catch (ePubBanner1) { /* ignore */ }
  window.risqueRuntimeHud.setControlVoiceText(deployVoiceFull, '');
  if (typeof window.risqueMirrorPushGameState === 'function') window.risqueMirrorPushGameState();
  else {
    try {
      localStorage.setItem('gameState', JSON.stringify(gameState));
    } catch (e1) { /* ignore */ }
  }
};

if (window.gameUtils && typeof window.gameUtils.installNumericInputClearOnFocus === 'function') {
  window.gameUtils.installNumericInputClearOnFocus();
}
if (!window.RISQUE_MOCK_MAKER) {
  window.gameUtils.init();
}

(function risqueInstallHostMapRedrawSuppressWrappers() {
  var gu = window.gameUtils;
  if (!gu || gu.__risqueHostMapRedrawGuardInstalled) return;
  gu.__risqueHostMapRedrawGuardInstalled = true;
  var origRt = gu.renderTerritories;
  var origRs = gu.renderStats;
  gu.renderTerritories = function () {
    if (
      typeof window !== 'undefined' &&
      !window.risqueDisplayIsPublic &&
      window.__risqueSuppressHostMapRedraw === true
    ) {
      return;
    }
    return origRt.apply(this, arguments);
  };
  gu.renderStats = function () {
    if (
      typeof window !== 'undefined' &&
      !window.risqueDisplayIsPublic &&
      window.__risqueSuppressHostMapRedraw === true
    ) {
      return;
    }
    return origRs.apply(this, arguments);
  };
})();

