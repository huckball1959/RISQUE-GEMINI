/**
 * Single routing decision after card play: which income strategy and which game.html phase to load next.
 * Does not mutate gameState except through callers that apply { phase, calculatorId }.
 */
(function () {
  "use strict";

  var Calc = (window.risqueIncomeCalculators && window.risqueIncomeCalculators.ID) || {
    STANDARD_INCOME: "standard-income",
    CONQUEST_BOOKS_CONTINENTS: "conquest-books-continents"
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
   * Con-income only during an active elimination / conquest chain (receivecard sets runtime mode).
   * Do not route on legacyNext=con-income alone — MGM mocks and con-cardplay shells used to force
   * con-income with a stale continentsSnapshot, yielding $0 (no troops, continents already in snapshot).
   */
  function shouldUseConquerRuntimeIncome(gs, legacyNext) {
    if (!gs) return false;
    if (cardplayIncomeModeIsConquer(gs)) return true;
    if (gs.risqueConquestChainActive) return true;
    return false;
  }

  /**
   * Runtime cardplay (phases/cardplay.js) → income or con-income.
   * Conquer campaign chain (e.g. post-elimination) uses conquer-mode income (con-income) only, not full territory income.
   *
   * Conquer-mode income applies when `risqueRuntimeCardplayIncomeMode` is conquer/continental (set by
   * receivecard elimination) or `risqueConquestChainActive` is true mid-chain — not from URL/phase alone.
   *
   * @param {object} gs
   * @param {string|null|undefined} legacyNext - mountOpts.legacyNext
   * @returns {{ calculatorId: string, phase: string, href: string }}
   */
  function resolveAfterRuntimeCardplay(gs, legacyNext) {
    /* Do NOT branch on `aerialAttackEligible` here. Wildcard aerial sets that flag so the player has a
     * deploy-phase aerial use; it must stay true through income. Skipping income sent hosts straight to
     * deploy with phase=income never run — book/bank stayed at 0. */
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

  window.risquePostCardplayNavigator = {
    resolveAfterRuntimeCardplay: resolveAfterRuntimeCardplay,
    legacyNextEncodesConIncome: legacyNextEncodesConIncome,
    shouldUseConquerRuntimeIncome: shouldUseConquerRuntimeIncome,
    shouldUseContinentalRuntimeIncome: shouldUseConquerRuntimeIncome
  };
})();
