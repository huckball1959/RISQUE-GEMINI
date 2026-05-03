/**
 * Named income strategies after card play. The post-cardplay navigator picks one; phases apply it.
 * Preview helpers are for logging/debug — mount logic stays in phases/income.js and phases/con-income-phase.js (conquer-mode income).
 */
(function () {
  "use strict";

  var ID = {
    STANDARD_INCOME: "standard-income",
    CONQUEST_BOOKS_CONTINENTS: "conquest-books-continents",
    AERIAL_DEPLOY: "aerial-deploy"
  };

  /**
   * @param {object} gs
   * @returns {{ bookCount: number, bookBonus: number, pendingContinents: string[], continentTroopTotal: number }}
   */
  function previewBooksAndNewContinents(gs) {
    var out = {
      bookCount: 0,
      bookBonus: 0,
      pendingContinents: [],
      continentTroopTotal: 0
    };
    if (!gs || !window.gameUtils) return out;
    var cp =
      gs.players &&
      gs.players.find(function (p) {
        return p && p.name === gs.currentPlayer;
      });
    if (cp) {
      out.bookCount = Number(cp.bookValue) || 0;
      out.bookBonus = out.bookCount * 10;
    }
    if (typeof window.gameUtils.computePendingNewContinentsForConquest === "function") {
      out.pendingContinents = window.gameUtils.computePendingNewContinentsForConquest(gs) || [];
      out.pendingContinents.forEach(function (key) {
        if (typeof window.gameUtils.getContinentConquestIncomeValue === "function") {
          out.continentTroopTotal += window.gameUtils.getContinentConquestIncomeValue(gs, key);
        }
      });
    }
    return out;
  }

  window.risqueIncomeCalculators = {
    ID: ID,
    previewBooksAndNewContinents: previewBooksAndNewContinents
  };
})();
