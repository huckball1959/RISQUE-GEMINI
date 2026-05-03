/**
 * Attack phase runtime mount for game.html ?phase=attack.
 * Uses the existing phases/attack.js logic by creating the expected DOM structure.
 */
(function () {
  "use strict";

  /** Matches js/game-shell / core conquest-chain list — never stomp these with phase "attack". */
  function risquePhaseIsContinentalConquestChain(phase) {
    var ph = String(phase || "");
    return (
      ph === "conquer" ||
      ph === "con-cardtransfer" ||
      ph === "con-cardplay" ||
      ph === "con-income" ||
      ph === "con-deploy" ||
      ph === "con-transfertroops" ||
      ph === "con-receivecard"
    );
  }

  function buildAttackUiSvgMarkup() {
    return (
      '<g pointer-events="auto">' +
        '<g id="aerial-bridge-group"></g>' +
      '</g>'
    );
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    var uiOverlay = document.getElementById("ui-overlay");
    var canvas = document.getElementById("canvas");
    if (!uiOverlay || !canvas || !window.gameUtils) return;

    if (typeof window.risqueDismissAttackPrompt === "function") window.risqueDismissAttackPrompt();
    var stalePrompt = document.getElementById("prompt");
    if (stalePrompt && stalePrompt.parentNode) stalePrompt.parentNode.removeChild(stalePrompt);

    // Fresh init each mount; epoch drops stale async init callbacks from a previous mount.
    window.__risqueAttackMountEpoch = (window.__risqueAttackMountEpoch || 0) + 1;
    var attackMountEpoch = window.__risqueAttackMountEpoch;
    window.__risqueAttackInitialized = false;
    window.handleTerritoryClick = window.handleTerritoryClick || null;

    var oldUiSvg = document.getElementById("ui-svg");
    if (oldUiSvg && oldUiSvg.parentNode) oldUiSvg.parentNode.removeChild(oldUiSvg);

    var uiSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    uiSvg.setAttribute("id", "ui-svg");
    uiSvg.setAttribute("width", "1920");
    uiSvg.setAttribute("height", "1080");
    uiSvg.setAttribute("viewBox", "0 0 1920 1080");
    uiSvg.style.position = "absolute";
    uiSvg.style.top = "0";
    uiSvg.style.left = "0";
    uiSvg.style.zIndex = "3";
    uiSvg.style.pointerEvents = "none";
    uiSvg.innerHTML = buildAttackUiSvgMarkup();
    canvas.appendChild(uiSvg);

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(true);
      requestAnimationFrame(function () {
        if (typeof window.risqueSyncAttackPhaseActionLocks === "function") {
          try {
            window.risqueSyncAttackPhaseActionLocks();
          } catch (eAtkLock) {
            /* ignore */
          }
        }
      });
      if (window.gameState) {
        window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
        if (typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
          var cp = window.gameState.currentPlayer || "Player";
          window.risqueRuntimeHud.setControlVoiceText(
            String(cp).toUpperCase() + " — ATTACK",
            "Select a territory to attack from.",
            { force: true }
          );
        }
      }
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.syncPosition();
      });
    } else {
      uiOverlay.innerHTML =
        '<div class="attack-player-name" id="attack-player-name"></div>' +
        '<div class="attack-control-panel unified-attack-panel">' +
          '<div class="attack-dice-columns">' +
            '<div class="attack-dice-col attack-dice-col--attacker">' +
              '<div class="attack-dice-label-row">' +
              '<div class="attack-dice-row">' +
                '<div id="attacker-dice-0" class="attack-die attack-die-atk"><span id="attacker-dice-text-0">-</span></div>' +
                '<div id="attacker-dice-1" class="attack-die attack-die-atk"><span id="attacker-dice-text-1">-</span></div>' +
                '<div id="attacker-dice-2" class="attack-die attack-die-atk"><span id="attacker-dice-text-2">-</span></div>' +
              '</div>' +
              '<span class="attack-dice-column-label attack-dice-column-label--player" id="attacker-panel-name">—</span>' +
              '</div>' +
            '</div>' +
            '<div class="attack-dice-col attack-dice-col--defender">' +
              '<div class="attack-dice-label-row">' +
              '<div class="attack-dice-row">' +
                '<div id="defender-dice-0" class="attack-die attack-die-def"><span id="defender-dice-text-0">-</span></div>' +
                '<div id="defender-dice-1" class="attack-die attack-die-def"><span id="defender-dice-text-1">-</span></div>' +
              '</div>' +
              '<span class="attack-dice-column-label attack-dice-column-label--player" id="defender-panel-name">—</span>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="attack-toolbar-strip" class="ucp-slot-strip attack-toolbar-strip" aria-label="Attack controls">' +
            '<div class="ucp-slot-strip-main">' +
            '<div class="ucp-slot-strip-buttons">' +
            '<button id="roll" class="attack-ctl-btn attack-ctl-roll" type="button" title="Single roll">ROLL</button>' +
            '<div class="attack-blitz-wrap">' +
            '<button id="blitz" class="attack-ctl-btn attack-ctl-blitz" type="button" title="Open blitz options" aria-expanded="false" aria-haspopup="true">BLITZ ▾</button>' +
            '<div id="blitz-dropdown" class="attack-blitz-dropdown attack-blitz-dropdown--flyout" role="menu" hidden>' +
            '<div class="attack-menu-row attack-menu-row--tall">' +
            '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--instant" aria-haspopup="true" aria-expanded="false" title="Instant blitz options">INSTANT</button>' +
            '<div class="attack-menu-flyout" role="menu">' +
            '<button type="button" class="attack-menu-flyout-item" data-blitz-mode="instant-cond" role="menuitem">Instant / COND</button>' +
            '</div></div>' +
            '<div class="attack-menu-row attack-menu-row--tall">' +
            '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--pause" aria-haspopup="true" aria-expanded="false" title="Blitz Step">BLITZ STEP</button>' +
            '<div class="attack-menu-flyout" role="menu">' +
            '<button type="button" class="attack-menu-flyout-item" data-blitz-mode="pause-cond" role="menuitem">Blitz Step Con</button>' +
            '</div></div></div>' +
            '<button id="pausable-blitz" class="attack-ctl-btn attack-ctl-pausable" type="button" title="Legacy pause control" style="display:none" hidden aria-hidden="true"><span id="pausable-blitz-text">PBLZ</span></button>' +
            '</div>' +
            '<div class="attack-campaign-wrap">' +
            '<button id="campaign" class="attack-ctl-btn attack-ctl-campaign" type="button" title="Open campaign options" aria-expanded="false" aria-haspopup="true">CAMPAIGN ▾</button>' +
            '<div id="campaign-dropdown" class="attack-campaign-dropdown attack-campaign-dropdown--flyout" role="menu" hidden>' +
            '<div class="attack-menu-row attack-menu-row--tall">' +
            '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--instant" aria-haspopup="true" aria-expanded="false" title="Campaign instant options">INSTANT</button>' +
            '<div class="attack-menu-flyout attack-menu-flyout--campaign" role="menu">' +
            '<button type="button" class="attack-menu-flyout-item" data-campaign-mode="instant-cond" role="menuitem">Instant / COND</button>' +
            '</div></div>' +
            '<div class="attack-menu-row attack-menu-row--tall">' +
            '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--pause" aria-haspopup="true" aria-expanded="false" title="Campaign Step">CAMPAIGN STEP</button>' +
            '<div class="attack-menu-flyout attack-menu-flyout--campaign" role="menu">' +
            '<button type="button" class="attack-menu-flyout-item" data-campaign-mode="pause-cond" role="menuitem">Campaign Step with conditions</button>' +
            '</div></div></div>' +
            '</div>' +
            '<button id="new-attack" class="attack-ctl-btn attack-ctl-new" type="button" title="Cancel all attacks">CLEAR</button>' +
            '<button id="reinforce" class="attack-ctl-btn attack-ctl-reinforce" type="button" title="Reinforcement phase">REINFORCE</button>' +
            '<div id="aerial-attack-group">' +
              '<button id="aerial-attack" class="attack-ctl-btn attack-ctl-aerial" type="button" title="First aerial bridge (wildcard)">AERIAL</button>' +
              '<button id="aerial-attack-2" class="attack-ctl-btn attack-ctl-aerial" type="button" title="Second aerial bridge (wildcard)">AERIAL</button>' +
            '</div>' +
            '</div>' +
            '<div class="attack-step-ctl-wrap" id="attack-step-ctl-wrap" hidden aria-label="Blitz Step and Campaign Step">' +
            '<button type="button" id="attack-step-pause-btn" class="attack-ctl-btn attack-ctl-step-pause" title="Pause or resume">PAUSE</button>' +
            '<button type="button" id="attack-step-cancel-btn" class="attack-ctl-btn attack-ctl-step-cancel" title="Cancel and return to territory selection">CANCEL</button>' +
            '</div>' +
            '<div class="ucp-slot-strip-num-wrap">' +
            '<input id="cond-threshold" class="ucp-slot-strip-number" type="number" min="0" value="0" title="Stop blitz when your troops on the attacking territory reach this number (0 = default 5)" aria-label="Conditional blitz stop-at troop count on attacker" />' +
            '</div>' +
            '</div>' +
          '</div>' +
          '<div id="control-voice" class="ucp-terminal ucp-control-voice" aria-live="polite">' +
            '<div id="control-voice-extras"></div>' +
            '<div class="ucp-voice-body">' +
            '<div id="risque-condition-tally" class="risque-condition-tally risque-condition-tally--in-voice" hidden aria-live="off" aria-label="Conditional stop countdown">' +
            '<div class="risque-condition-tally__num" id="risque-condition-tally-num">0</div>' +
            '<div class="risque-condition-tally__label">until condition is met</div>' +
            '</div>' +
            '<div class="ucp-voice-messages">' +
            '<div id="control-voice-text" class="ucp-voice-text"></div>' +
            '<div id="control-voice-report" class="ucp-voice-report"></div>' +
            '</div>' +
            '</div>' +
          '</div>' +
          '<div id="ucp-slot-strip" class="ucp-slot-strip">' +
            '<div class="ucp-slot-strip-main">' +
            '<div class="ucp-slot-strip-buttons">' +
              '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-0" disabled title="" aria-label="Action slot 1"></button>' +
              '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-1" disabled title="" aria-label="Action slot 2"></button>' +
              '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-2" disabled title="" aria-label="Action slot 3"></button>' +
              '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-3" disabled title="" aria-label="Action slot 4"></button>' +
              '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-4" disabled title="" aria-label="Action slot 5"></button>' +
              '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-5" disabled title="" aria-label="Action slot 6"></button>' +
            '</div>' +
            '<div class="ucp-slot-strip-num-wrap">' +
              '<label id="ucp-voice-number-label" class="ucp-slot-strip-label" for="troops-input">Amount</label>' +
              '<input type="number" id="troops-input" class="ucp-slot-strip-number" disabled value="" title="Amount" />' +
            '</div>' +
            '</div>' +
          '</div>' +
          '<div id="log-text" class="ucp-terminal ucp-combat-log" aria-live="polite"></div>' +
        '</div>';
    }

    /* Host only: public TV shares localStorage; writing here overwrote the host save (e.g. conquer) while mirror lagged. */
    if (
      window.gameState &&
      !window.risqueDisplayIsPublic &&
      !risquePhaseIsContinentalConquestChain(window.gameState.phase)
    ) {
      window.gameState.phase = "attack";
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (e) {
        /* ignore */
      }
    }

    try {
      if (window.location.protocol !== "file:") {
        var params = new URLSearchParams(window.location.search);
        if (params.get("phase") !== "attack") {
          params.set("phase", "attack");
          var qs = params.toString();
          var newUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
          window.history.replaceState(null, "", newUrl);
        }
      }
    } catch (e) {
      /* ignore */
    }

    if (
      window.gameState &&
      !window.risqueDisplayIsPublic &&
      window.gameUtils &&
      typeof window.gameUtils.captureRisqueConquestAttackEntryContinentsIfNeeded === "function"
    ) {
      window.gameUtils.captureRisqueConquestAttackEntryContinentsIfNeeded(window.gameState);
    }

    if (typeof window.initAttackPhase === "function") {
      window.initAttackPhase(attackMountEpoch);
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.attack = { mount: mount };
})();

