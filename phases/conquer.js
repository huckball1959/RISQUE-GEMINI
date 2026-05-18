/**
 * Continental elimination celebration + handoff to receive-card (conquest path).
 * Invoked from attack.js while phase stays "attack" until the host proceeds.
 */
(function () {
  "use strict";

  var CELEBRATION_FLASH_MS = 3000;
  var STYLE_ID = "risque-conquer-inline-v1";
  var celebrationTimer = null;

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      ".runtime-hud-root--conquest-celebration #hud-attack-chrome," +
      ".runtime-hud-root--conquest-celebration #ucp-slot-strip," +
      ".runtime-hud-root--conquest-celebration #log-text," +
      ".runtime-hud-root--conquest-celebration .attack-reinforce-footer { display: none !important; }" +
      "#control-voice-text .risque-conquest-celebration-root,.risque-conquest-celebration-root{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:12px;padding:4px 4px 8px;text-align:center;max-width:100%;}" +
      ".risque-conquest-celebration-line { font-family: Arial, sans-serif; font-weight: 900; font-size: clamp(14px, 1.35vw, 20px); line-height: 1.25; color: #f8fafc; text-transform: uppercase; letter-spacing: 0.04em; text-shadow: 0 0 12px rgba(255,255,255,0.35); animation: risque-conquest-line-flash 0.55s ease-in-out infinite; }" +
      ".risque-conquest-celebration-line--steady { animation: none; opacity: 1; }" +
      "@keyframes risque-conquest-line-flash { 0%, 100% { opacity: 1; } 50% { opacity: 0.28; } }" +
      ".risque-conquest-celebration-tv-hint { font-size: 12px; font-weight: 600; color: #94a3b8; max-width: 280px; }" +
      ".risque-conquest-celebration-btn { width: 100%; max-width: 280px; min-height: 38px; padding: 8px 12px; border: 0; border-radius: 8px; font-weight: 800; font-size: 13px; cursor: pointer; background: #e2e8f0; color: #0f172a; }" +
      ".risque-conquest-celebration-btn:hover { background: #cbd5e1; }";
    document.head.appendChild(st);
  }

  function persist(gs) {
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {
      /* ignore */
    }
    if (typeof window.risqueHostReplaceShellGameState === "function") {
      window.risqueHostReplaceShellGameState(gs);
    } else {
      window.gameState = gs;
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  }

  /**
   * Build / refresh celebration DOM from gameState (host + public TV).
   */
  function risqueConquerSyncCelebrationFromState(gs) {
    if (!gs) return;
    injectStyles();
    var ui = document.getElementById("ui-overlay");
    if (!ui || !window.risqueRuntimeHud) return;

    if (!gs.risqueConquestFlowActive) {
      var rhOff = document.getElementById("runtime-hud-root");
      if (rhOff) rhOff.classList.remove("runtime-hud-root--conquest-celebration");
      var vtOff = document.getElementById("control-voice-text");
      if (vtOff && vtOff.querySelector(".risque-conquest-celebration-root")) {
        vtOff.innerHTML = "";
      }
      delete gs.risquePublicConquestCelebrationHtml;
      return;
    }

    window.risqueRuntimeHud.ensure(ui);
    window.risqueRuntimeHud.setAttackChromeInteractive(false);
    window.risqueRuntimeHud.clearPhaseSlot();

    var rh = document.getElementById("runtime-hud-root");
    if (rh) rh.classList.add("runtime-hud-root--conquest-celebration");

    var line = gs.risqueConquestCelebrationLine != null ? String(gs.risqueConquestCelebrationLine) : "";
    var showBtn = !!gs.risqueConquestCelebrationShowButton;
    var defName = gs.defeatedPlayer != null ? String(gs.defeatedPlayer) : "";

    var html =
      '<div class="risque-conquest-celebration-root" role="region" aria-label="Elimination">' +
      '<div class="risque-conquest-celebration-line' +
      (showBtn ? " risque-conquest-celebration-line--steady" : "") +
      '">' +
      escapeHtml(line) +
      "</div>";

    if (window.risqueDisplayIsPublic) {
      html +=
        '<div class="risque-conquest-celebration-tv-hint" role="status">Host advances the next step on the private screen.</div>';
    } else if (showBtn) {
      html +=
        '<button type="button" id="risque-conquest-proceed-take-cards" class="risque-conquest-celebration-btn">' +
        escapeHtml("PROCEED TO TAKE " + (defName ? defName.toUpperCase() + "'S CARDS" : "DEFEATED CARDS")) +
        "</button>";
    }

    html += "</div>";

    var vt = document.getElementById("control-voice-text");
    var vr = document.getElementById("control-voice-report");
    if (!vt) return;
    vt.innerHTML = html;
    if (vr) {
      vr.textContent = "";
      vr.style.display = "none";
    }

    gs.risquePublicConquestCelebrationHtml = html;
    try {
      gs.risqueControlVoice = {
        primary: line,
        report: "",
        reportClass: ""
      };
    } catch (eCv) {
      /* ignore */
    }

    if (!window.risqueDisplayIsPublic && showBtn) {
      var btn = document.getElementById("risque-conquest-proceed-take-cards");
      if (btn && !btn.__risqueConquestWired) {
        btn.__risqueConquestWired = true;
        btn.addEventListener("click", risqueConquerOnProceedToTakeCards);
        btn.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            risqueConquerOnProceedToTakeCards();
          }
        });
      }
    }

    requestAnimationFrame(function () {
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
        window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  function risqueConquerOnProceedToTakeCards() {
    var gs = window.gameState;
    if (!gs || !gs.risqueConquestFlowActive) return;

    if (celebrationTimer != null) {
      clearTimeout(celebrationTimer);
      celebrationTimer = null;
    }

    gs.risqueConquestFlowActive = false;
    delete gs.risqueConquestCelebrationLine;
    gs.risqueConquestCelebrationShowButton = false;
    delete gs.risquePublicConquestCelebrationHtml;
    gs.risqueConquestElimReceiveCard = true;
    gs.phase = "receivecard";
    gs.risqueConquestChainActive = true;
    if (
      window.gameUtils &&
      typeof window.gameUtils.syncConquestPendingNewContinents === "function"
    ) {
      window.gameUtils.syncConquestPendingNewContinents(gs);
    }

    var rh = document.getElementById("runtime-hud-root");
    if (rh) rh.classList.remove("runtime-hud-root--conquest-celebration");
    var vtDone = document.getElementById("control-voice-text");
    if (vtDone) vtDone.innerHTML = "";

    persist(gs);

    var nav = "game.html?phase=receivecard&conquestElim=1";
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(nav);
    } else {
      window.location.href = nav;
    }
  }

  /**
   * Entry from attack.js after combat elimination (replaces modal + game.html?phase=conquer hop).
   */
  function risqueConquerStartEliminationFlow(attackerPlayer, defenderPlayer) {
    injectStyles();

    var gsPre = window.gameState;
    /* Match attack.js: only bail while deferred elimination troop transfer is active — not for
     * any stale pending_transfer snapshot (would skip celebration on a later elimination). */
    if (
      gsPre &&
      String(gsPre.phase || "") === "attack" &&
      String(gsPre.attackPhase || "") === "pending_transfer" &&
      gsPre.acquiredTerritory &&
      gsPre.attackingTerritory &&
      gsPre.risqueDeferConquerElimination
    ) {
      return;
    }

    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }

    var atkName = attackerPlayer && attackerPlayer.name ? String(attackerPlayer.name) : "";
    var defName = defenderPlayer && defenderPlayer.name ? String(defenderPlayer.name) : "";
    var gs = window.gameState;
    if (!gs) return;

    gs.risqueConquestChainActive = true;
    gs.risqueConquestFlowActive = true;
    gs.risqueConquestCelebrationLine = atkName + " has conquered " + defName;
    gs.risqueConquestCelebrationShowButton = false;
    delete gs.risquePublicEliminationBanner;
    delete gs.risqueControlVoice;

    /* Build HTML + gs.risquePublicConquestCelebrationHtml before persist so the public mirror includes it. */
    risqueConquerSyncCelebrationFromState(gs);
    persist(gs);

    if (celebrationTimer != null) {
      clearTimeout(celebrationTimer);
      celebrationTimer = null;
    }
    celebrationTimer = setTimeout(function () {
      celebrationTimer = null;
      var g2 = window.gameState;
      if (!g2 || !g2.risqueConquestFlowActive) return;
      g2.risqueConquestCelebrationShowButton = true;
      risqueConquerSyncCelebrationFromState(g2);
      persist(g2);
    }, CELEBRATION_FLASH_MS);
  }

  window.risqueConquerStartEliminationFlow = risqueConquerStartEliminationFlow;
  window.risqueConquerSyncCelebrationFromState = risqueConquerSyncCelebrationFromState;
})();
