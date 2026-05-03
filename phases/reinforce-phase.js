/**
 * Reinforcement phase runtime mount for game.html ?phase=reinforce.
 */
(function () {
  "use strict";

  function mount(stageHost, opts) {
    opts = opts || {};
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    /* Paint the board from shell state before HUD slot swap so the map never sits empty while async init ran. */
    if (
      window.gameState &&
      typeof window.gameUtils.validateGameState === "function" &&
      window.gameUtils.validateGameState(window.gameState)
    ) {
      try {
        window.gameUtils.initGameView();
        window.gameUtils.resizeCanvas();
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
      } catch (eEarlyPaint) {
        /* ignore */
      }
    }

    var stalePrompt = document.getElementById("prompt");
    if (stalePrompt && stalePrompt.parentNode) stalePrompt.parentNode.removeChild(stalePrompt);
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }

    window.__risqueReinforceInitialized = false;
    window.handleTerritoryClick = window.handleTerritoryClick || null;

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      if (window.gameState) {
        window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
      }
      var rSlot = document.getElementById("risque-phase-content");
      if (rSlot) {
        rSlot.innerHTML =
          '<div class="reinforce-compact-root reinforce-compact-root--actions-only">' +
          '<div class="reinforce-compact-grid">' +
          '<div class="reinforce-row reinforce-row--pick-hint-only" id="reinforce-row-pick-hint">' +
          '<div class="reinforce-pick-hint-unified">' +
          '<div id="reinforce-pick-hint" class="reinforce-pick-hint-text" role="status" aria-live="polite">' +
          '<span class="reinforce-pick-hint-head">CHOOSE FROM AND TO TERRITORIES</span>' +
          "</div>" +
          '<span class="reinforce-pick-or">OR</span>' +
          '<button type="button" id="reinforce-btn-skip" class="reinforce-btn-compact reinforce-btn-skip-paired">SKIP</button>' +
          "</div>" +
          "</div>" +
          '<div class="reinforce-row reinforce-row--reset-num">' +
          '<button type="button" id="reinforce-btn-reset" class="reinforce-btn-compact">RESET</button>' +
          '<div class="reinforce-troops-holder" id="reinforce-troops-holder" hidden aria-hidden="true"></div>' +
          "</div>" +
          '<div class="reinforce-row reinforce-row--confirm-only">' +
          '<button type="button" id="reinforce-btn-r1third" class="reinforce-btn-compact reinforce-btn-compact--full-width">CONFIRM</button>' +
          "</div>" +
          '<div class="reinforce-troop-prompt" id="reinforce-row-troop" hidden>' +
          '<div class="reinforce-row reinforce-row--troop-split">' +
          '<button type="button" id="reinforce-btn-allbut1" class="reinforce-btn-compact">ALL BUT 1</button>' +
          '<button type="button" id="reinforce-btn-allbut3" class="reinforce-btn-compact">ALL BUT 3</button>' +
          "</div>" +
          '<button type="button" id="reinforce-btn-confirm-move" class="reinforce-btn-compact reinforce-btn-compact--full-width">CONFIRM</button>' +
          "</div>" +
          "</div>" +
          "</div>";
      }
      /* Reinforce UI stays in #risque-phase-content; CSS flex order hoists it above #hud-main-panel
       * so it is not trapped below the voice + strip stack (below-the-fold / clipped chrome). */
      if (document.body) {
        document.body.setAttribute("data-risque-reinforce-slot-mode", "phase");
      }
    } else {
      uiOverlay.innerHTML =
        '<div class="text title" id="reinforce-title">Reinforcement</div>' +
        '<div class="text player-name" id="reinforce-player-name"></div>';
    }

    if (window.gameState) {
      window.gameState.phase = "reinforce";
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (e) {
        /* ignore */
      }
    }

    if (typeof window.initReinforcePhase === "function") {
      window.initReinforcePhase();
    }

    try {
      window.gameUtils.resizeCanvas();
      if (window.gameState) {
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
      }
    } catch (eLatePaint) {
      /* ignore */
    }
    requestAnimationFrame(function () {
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
        window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.reinforce = { mount: mount };
})();
