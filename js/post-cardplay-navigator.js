/**
 * Single routing decision after card play: which income strategy and which game.html phase to load next.
 * Does not mutate gameState except through callers that apply { phase, calculatorId }.
 */
(function () {
  "use strict";

  var Calc = (window.risqueIncomeCalculators && window.risqueIncomeCalculators.ID) || {
    STANDARD_INCOME: "standard-income",
    CONQUEST_BOOKS_CONTINENTS: "conquest-books-continents",
    AERIAL_DEPLOY: "aerial-deploy"
  };

  function normalizeLegacyIncomeUrl(legacyNext) {
    var _raw = legacyNext;
    return !_raw || _raw === "income.html" || _raw === "in-come.html"
      ? "game.html?phase=income"
      : _raw;
  }

  /** Legacy saves may use "continental"; new code uses "conquer". */
  function cardplayIncomeModeIsConquer(gs) {
    var m = gs && gs.risqueRuntimeCardplayIncomeMode;
    return m === "conquer" || m === "continental";
  }

  /**
   * True when this cardplay mount URL encodes the conquer-mode con-income chain (receivecard elimination,
   * etc.). Classic Risk uses legacyNext → income.html / phase=income only — never con-income.
   */
  function legacyNextEncodesConIncome(legacyNext) {
    if (legacyNext == null) return false;
    return String(legacyNext).toLowerCase().indexOf("con-income") !== -1;
  }

  /**
   * Set on the conquer elimination → runtime cardplay chain so later cardplay mounts still route to
   * con-income even when legacyNext is only income.html (deploy does not repeat the nested con-income URL).
   */
  function shouldUseConquerRuntimeIncome(gs, legacyNext) {
    if (!gs || gs.risqueConquestChainActive !== true) return false;
    if (cardplayIncomeModeIsConquer(gs)) return true;
    return legacyNextEncodesConIncome(legacyNext);
  }

  /**
   * Runtime cardplay (phases/cardplay.js) → income or con-income.
   * Conquer campaign chain (e.g. post-elimination) uses conquer-mode income (con-income) only, not full territory income.
   *
   * IMPORTANT: Do not route on `risqueConquestChainActive` alone. That flag is set for many conquest
   * events but only cleared in a few code paths; it can stay true for the whole session. Using it alone
   * forced every post-cardplay turn through con-income (books + new continents only, no territory bonus),
   * often totaling 0 and breaking the game for all players. Conquer-mode income applies when the URL
   * encodes con-income OR `risqueRuntimeCardplayIncomeMode === "conquer"` (legacy: `"continental"`; receivecard elimination).
   *
   * @param {object} gs
   * @param {string|null|undefined} legacyNext - mountOpts.legacyNext
   * @returns {{ calculatorId: string, phase: string, href: string }}
   */
  function resolveAfterRuntimeCardplay(gs, legacyNext) {
    var useConquerIncome = shouldUseConquerRuntimeIncome(gs, legacyNext);
    if (useConquerIncome) {
      return {
        calculatorId: Calc.CONQUEST_BOOKS_CONTINENTS,
        phase: "con-income",
        href: "game.html?phase=con-income"
      };
    }
    return {
      calculatorId: Calc.STANDARD_INCOME,
      phase: "income",
      href: normalizeLegacyIncomeUrl(legacyNext)
    };
  }

  /**
   * Conquer cardplay (phases/con-cardplay-phase.js) → deploy if aerial card, else con-income.
   *
   * @param {object} gs
   * @returns {{ calculatorId: string, phase: string, href: string }}
   */
  function resolveAfterConCardplay(gs) {
    if (gs && gs.aerialAttackEligible) {
      return {
        calculatorId: Calc.AERIAL_DEPLOY,
        phase: "deploy",
        href: "game.html?phase=deploy&kind=turn"
      };
    }
    return {
      calculatorId: Calc.CONQUEST_BOOKS_CONTINENTS,
      phase: "con-income",
      href: "game.html?phase=con-income"
    };
  }

  window.risquePostCardplayNavigator = {
    resolveAfterRuntimeCardplay: resolveAfterRuntimeCardplay,
    resolveAfterConCardplay: resolveAfterConCardplay,
    legacyNextEncodesConIncome: legacyNextEncodesConIncome,
    shouldUseConquerRuntimeIncome: shouldUseConquerRuntimeIncome,
    shouldUseContinentalRuntimeIncome: shouldUseConquerRuntimeIncome
  };
})();
