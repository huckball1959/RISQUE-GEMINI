/**
 * Persistent right-column HUD: full game panel (stats, control voice, combat log, phase slot).
 * Setup phases use .runtime-hud-root--setup (attack row, slot strip, combat log, and voice report hidden via CSS).
 */
(function () {
  "use strict";

  function buildHudTitleStackHtml() {
    return (
      '<div id="hud-title-stack" class="hud-title-stack">' +
      '<div class="hud-title-stack__brand-row">' +
      '<div class="hud-title-stack__stats-slot" aria-hidden="true"></div>' +
      '<div class="hud-title-stack__host-top-buttons">' +
      '<button type="button" id="risque-private-stats-toggle" class="risque-private-stats-toggle risque-host-topbar-btn" role="switch" aria-checked="false" aria-label="Toggle large stats in control panel" title="STATS — enlarge table in panel">STATS</button>' +
      '<button type="button" id="risque-host-cards-played-toggle" class="risque-host-cards-played-toggle risque-host-topbar-btn" role="switch" aria-checked="false" aria-label="Toggle cards played gallery in control panel" title="Cards played — territory cards cashed in this game">CARDS PLAYED</button>' +
      '<button type="button" id="risque-host-lucky-toggle" class="risque-host-lucky-toggle risque-host-topbar-btn" role="switch" aria-checked="false" aria-label="Toggle lucky dice and battle stats in control panel" title="Lucky — six rate and battle round win rates">LUCKY</button>' +
      '<button type="button" id="risque-host-cards-in-hand-toggle" class="risque-host-cards-in-hand-toggle risque-host-topbar-btn" role="switch" aria-checked="false" aria-label="Show current player cards in hand" title="Cards in hand — current player\'s territory cards">CARDS IN HAND</button>' +
      "</div>" +
      '<div id="hud-banner-game-title" class="hud-banner-game-title-main">RISQUE</div>' +
      "</div>" +
      "</div>"
    );
  }

  function buildHudPhaseLineBelowStatsHtml() {
    return (
      '<div id="hud-phase-player-row" class="hud-phase-player-row">' +
      '<div id="attack-player-name" class="hud-turn-banner hud-turn-banner--player-phase"></div>' +
      "</div>"
    );
  }

  function buildPanelInnerHtml() {
    return (
      '<div id="hud-attack-chrome" class="hud-attack-chrome">' +
        '<div class="attack-dice-columns">' +
          '<div class="attack-dice-col attack-dice-col--attacker">' +
            '<div class="attack-dice-label-row">' +
            '<div class="attack-dice-row">' +
              '<div id="attacker-dice-0" class="attack-die attack-die-atk"><span id="attacker-dice-text-0">-</span></div>' +
              '<div id="attacker-dice-1" class="attack-die attack-die-atk"><span id="attacker-dice-text-1">-</span></div>' +
              '<div id="attacker-dice-2" class="attack-die attack-die-atk"><span id="attacker-dice-text-2">-</span></div>' +
            "</div>" +
            '<span class="attack-dice-column-label attack-dice-column-label--player" id="attacker-panel-name">—</span>' +
            "</div>" +
          "</div>" +
          '<div class="attack-dice-col attack-dice-col--defender">' +
            '<div class="attack-dice-label-row">' +
            '<div class="attack-dice-row">' +
              '<div id="defender-dice-0" class="attack-die attack-die-def"><span id="defender-dice-text-0">-</span></div>' +
              '<div id="defender-dice-1" class="attack-die attack-die-def"><span id="defender-dice-text-1">-</span></div>' +
            "</div>" +
            '<span class="attack-dice-column-label attack-dice-column-label--player" id="defender-panel-name">—</span>' +
            "</div>" +
          "</div>" +
        "</div>" +
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
          "</div></div>" +
          '<div class="attack-menu-row attack-menu-row--tall">' +
          '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--pause" aria-haspopup="true" aria-expanded="false" title="Blitz Step">BLITZ STEP</button>' +
          '<div class="attack-menu-flyout" role="menu">' +
          '<button type="button" class="attack-menu-flyout-item" data-blitz-mode="pause-cond" role="menuitem">Blitz Step Con</button>' +
          "</div></div></div>" +
          '<button id="pausable-blitz" class="attack-ctl-btn attack-ctl-pausable" type="button" title="Legacy pause control" style="display:none" hidden aria-hidden="true"><span id="pausable-blitz-text">PBLZ</span></button>' +
          "</div>" +
          '<div class="attack-campaign-wrap">' +
          '<button id="campaign" class="attack-ctl-btn attack-ctl-campaign" type="button" title="Open campaign options" aria-expanded="false" aria-haspopup="true">CAMPAIGN ▾</button>' +
          '<div id="campaign-dropdown" class="attack-campaign-dropdown attack-campaign-dropdown--flyout" role="menu" hidden>' +
          '<div class="attack-menu-row attack-menu-row--tall">' +
          '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--instant" aria-haspopup="true" aria-expanded="false" title="Campaign instant options">INSTANT</button>' +
          '<div class="attack-menu-flyout attack-menu-flyout--campaign" role="menu">' +
          '<button type="button" class="attack-menu-flyout-item" data-campaign-mode="instant-cond" role="menuitem">Instant / COND</button>' +
          "</div></div>" +
          '<div class="attack-menu-row attack-menu-row--tall">' +
          '<button type="button" class="attack-blitz-dropdown-item attack-menu-tile attack-menu-tile--pause" aria-haspopup="true" aria-expanded="false" title="Campaign Step">CAMPAIGN STEP</button>' +
          '<div class="attack-menu-flyout attack-menu-flyout--campaign" role="menu">' +
          '<button type="button" class="attack-menu-flyout-item" data-campaign-mode="pause-cond" role="menuitem">Campaign Step with conditions</button>' +
          "</div></div></div>" +
          "</div>" +
          '<button id="new-attack" class="attack-ctl-btn attack-ctl-new" type="button" title="Cancel all attacks">CLEAR</button>' +
          '<div id="aerial-attack-group">' +
            '<button id="aerial-attack" class="attack-ctl-btn attack-ctl-aerial" type="button" title="First aerial bridge (wildcard)">AERIAL</button>' +
            '<button id="aerial-attack-2" class="attack-ctl-btn attack-ctl-aerial" type="button" title="Second aerial bridge (wildcard)">AERIAL</button>' +
          "</div>" +
          "</div>" +
          '<div class="attack-step-ctl-wrap" id="attack-step-ctl-wrap" hidden aria-label="Blitz Step and Campaign Step">' +
          '<button type="button" id="attack-step-pause-btn" class="attack-ctl-btn attack-ctl-step-pause" title="Pause or resume">PAUSE</button>' +
          '<button type="button" id="attack-step-cancel-btn" class="attack-ctl-btn attack-ctl-step-cancel" title="Cancel and return to territory selection">CANCEL</button>' +
          "</div>" +
          '<div class="ucp-slot-strip-num-wrap">' +
          '<input id="cond-threshold" class="ucp-slot-strip-number" type="number" min="0" value="0" title="Stop blitz when your troops on the attacking territory reach this number (0 = default 5)" aria-label="Conditional blitz stop-at troop count on attacker" />' +
          "</div>" +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div id="hud-public-cardplay-strip" class="hud-public-cardplay-strip" hidden aria-label="Committed cards"></div>' +
      '<div id="control-voice" class="ucp-terminal ucp-control-voice" aria-live="polite">' +
        '<div id="control-voice-extras"></div>' +
        '<div class="ucp-voice-body">' +
        '<div id="risque-condition-tally" class="risque-condition-tally risque-condition-tally--in-voice" hidden aria-live="off" aria-label="Conditional stop countdown">' +
        '<div class="risque-condition-tally__num" id="risque-condition-tally-num">0</div>' +
        '<div class="risque-condition-tally__label">until condition is met</div>' +
        "</div>" +
        '<div class="ucp-voice-messages">' +
        '<div id="control-voice-text" class="ucp-voice-text"></div>' +
        '<div id="control-voice-report" class="ucp-voice-report"></div>' +
        "</div>" +
        "</div>" +
      "</div>" +
      '<div id="ucp-slot-strip" class="ucp-slot-strip">' +
        '<div class="ucp-slot-strip-main">' +
        '<div class="ucp-slot-strip-buttons">' +
          '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-0" disabled title="" aria-label="Action slot 1"></button>' +
          '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-1" disabled title="" aria-label="Action slot 2"></button>' +
          '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-2" disabled title="" aria-label="Action slot 3"></button>' +
          '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-3" disabled title="" aria-label="Action slot 4"></button>' +
          '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-4" disabled title="" aria-label="Action slot 5"></button>' +
          '<button type="button" class="ucp-slot-ctl ucp-slot-empty" id="control-btn-5" disabled title="" aria-label="Action slot 6"></button>' +
        "</div>" +
        '<div class="ucp-slot-strip-num-wrap">' +
          '<label id="ucp-voice-number-label" class="ucp-slot-strip-label" for="troops-input">Amount</label>' +
          '<input type="number" id="troops-input" class="ucp-slot-strip-number" disabled value="" title="Amount" />' +
        "</div>" +
        "</div>" +
      "</div>" +
      '<div id="log-text" class="ucp-terminal ucp-combat-log" aria-live="polite"></div>' +
      '<div class="attack-reinforce-footer" role="group" aria-label="Reinforcement phase">' +
      '<button id="reinforce" class="attack-ctl-btn attack-ctl-reinforce" type="button" title="Reinforcement phase">REINFORCE</button>' +
      "</div>"
    );
  }

  function buildFullHudRootHtml(extraRootClass) {
    var rc = "runtime-hud-root" + (extraRootClass ? " " + extraRootClass : "");
    return (
      '<div id="runtime-hud-root" class="' +
      rc +
      '">' +
      buildHudTitleStackHtml() +
      '<div id="hud-stats-panel" class="hud-stats-panel" aria-label="Game statistics"></div>' +
      '<div id="risque-host-cards-played-panel" class="risque-host-cards-played-panel" hidden aria-hidden="true"></div>' +
      '<div id="risque-host-lucky-panel" class="risque-host-lucky-panel" hidden aria-hidden="true"></div>' +
      '<div id="risque-host-cards-in-hand-panel" class="risque-host-cards-in-hand-panel" hidden aria-hidden="true"></div>' +
      buildHudPhaseLineBelowStatsHtml() +
      '<div class="attack-control-panel unified-attack-panel" id="hud-main-panel">' +
      '<div id="risque-main-panel-body" class="risque-main-panel-body">' +
      buildPanelInnerHtml() +
      "</div></div>" +
      '<div id="risque-phase-content" class="risque-phase-content"></div>' +
      '<div id="risque-grace-host-overlay" class="risque-grace-host-overlay" hidden aria-hidden="true">' +
      '<div class="risque-grace-host-overlay-inner">' +
      '<div id="risque-grace-host-screen-kidding" class="risque-grace-host-screen" hidden>' +
      '<p id="risque-grace-host-kidding-text" class="risque-grace-host-kidding-text"></p>' +
      '<button type="button" class="risque-grace-host-btn" id="risque-grace-host-kidding-close">Close</button>' +
      "</div>" +
      '<div id="risque-grace-host-screen-pick" class="risque-grace-host-screen" hidden>' +
      '<p class="risque-grace-host-title">Grace rollback</p>' +
      '<p class="risque-grace-host-desc">Return to the start of <strong>private cardplay</strong> for the current or previous player.</p>' +
      '<p id="risque-grace-host-pick-warn" class="risque-grace-host-pick-warn" hidden></p>' +
      '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--primary" id="risque-grace-host-opt-current" disabled>This player\'s turn (cardplay start)</button>' +
      '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--primary" id="risque-grace-host-opt-previous" disabled>Previous player\'s turn (cardplay start)</button>' +
      '<button type="button" class="risque-grace-host-btn" id="risque-grace-host-pick-cancel">Cancel</button>' +
      "</div>" +
      '<div id="risque-grace-host-screen-confirm" class="risque-grace-host-screen" hidden>' +
      '<p class="risque-grace-host-title">Are you sure?</p>' +
      '<p id="risque-grace-host-confirm-detail" class="risque-grace-host-desc"></p>' +
      '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--danger" id="risque-grace-host-confirm-yes">Confirm rollback</button>' +
      '<button type="button" class="risque-grace-host-btn" id="risque-grace-host-confirm-no">Back</button>' +
      "</div>" +
      "</div></div>" +
      "</div>"
    );
  }

  /**
   * @param {string|null|undefined} primary
   * @param {string|null|undefined} report - second line under primary (scrolls with voice box)
   * @param {{ reportClass?: string }=} opts - e.g. { reportClass: "ucp-voice-report--warn" }
   */
  function setControlVoiceText(primary, report, opts) {
    opts = opts || {};
    var cvEl = document.getElementById("control-voice");
    var instantCampaignHud =
      cvEl && cvEl.classList.contains("ucp-control-voice--campaign-instant");
    /* Attack campaign UI uses innerHTML on #control-voice-text; textContent here would strip it. */
    if (
      !opts.force &&
      typeof window.risqueIsAttackCampaignActive === "function" &&
      window.risqueIsAttackCampaignActive()
    ) {
      return;
    }
    if (
      opts.force &&
      instantCampaignHud &&
      typeof window.risqueIsAttackCampaignActive === "function" &&
      window.risqueIsAttackCampaignActive()
    ) {
      return;
    }
    var vt = document.getElementById("control-voice-text");
    var vr = document.getElementById("control-voice-report");
    if (vt) vt.textContent = primary != null ? primary : "";
    if (vr && report !== undefined) {
      var rt = report != null ? String(report) : "";
      vr.textContent = rt;
      vr.style.display = rt ? "block" : "none";
      vr.className =
        "ucp-voice-report" + (rt && opts.reportClass ? " " + opts.reportClass : "");
    }
    try {
      if (window.gameState) {
        var rp = primary != null ? String(primary) : "";
        var rr = report !== undefined && report != null ? String(report) : "";
        window.gameState.risqueControlVoice = {
          primary: rp,
          report: rr,
          reportClass: opts && opts.reportClass ? String(opts.reportClass) : ""
        };
      }
    } catch (ePersist) {
      /* ignore */
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  }

  /**
   * Full game HUD shell (stats, control panel, voice, log). Replaces login or setup shells only.
   */
  function ensure(uiOverlay) {
    if (!uiOverlay) return;
    var existingRoot = document.getElementById("runtime-hud-root");
    if (
      existingRoot &&
      !existingRoot.classList.contains("runtime-hud-root--login") &&
      !existingRoot.classList.contains("runtime-hud-root--setup")
    ) {
      return;
    }
    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    uiOverlay.innerHTML = buildFullHudRootHtml("");
  }

  /**
   * Setup flow: same panel as in-game (stats + control voice + combat log) but attack chrome / slot strip hidden via CSS.
   * Phase-specific UI mounts in #risque-phase-content below the control voice.
   */
  function ensureSetupUnifiedHud(uiOverlay, bannerText, opts) {
    opts = opts || {};
    if (!uiOverlay) return;
    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    uiOverlay.classList.remove("risque-deploy1-ui");

    if (opts.force) {
      uiOverlay.innerHTML = buildFullHudRootHtml("runtime-hud-root--setup");
      applyStandaloneBannerText(bannerText);
      setAttackChromeInteractive(false);
      setControlVoiceText("", "");
      return;
    }

    var existing = document.getElementById("runtime-hud-root");
    var isLoginMinimal = existing && existing.classList.contains("runtime-hud-root--login");
    var isSetupFull = existing && existing.classList.contains("runtime-hud-root--setup");

    if (existing && !isLoginMinimal && !isSetupFull) {
      applyStandaloneBannerText(bannerText);
      return;
    }

    if (isSetupFull) {
      applyStandaloneBannerText(bannerText);
      var slot = document.getElementById("risque-phase-content");
      if (slot) slot.innerHTML = "";
      setAttackChromeInteractive(false);
      return;
    }

    uiOverlay.innerHTML = buildFullHudRootHtml("runtime-hud-root--setup");
    applyStandaloneBannerText(bannerText);
    setAttackChromeInteractive(false);
    setControlVoiceText("", "");
  }

  function clearPhaseSlot() {
    var slot = document.getElementById("risque-phase-content");
    if (slot) slot.innerHTML = "";
    var rh = document.getElementById("runtime-hud-root");
    if (rh) {
      rh.classList.remove("runtime-hud-root--cardplay-tight");
      rh.classList.remove("runtime-hud-root--cardplay-panel-only");
    }
  }

  /**
   * Stats + banner + empty phase slot (no attack chrome). Used for login and pre-game setup.
   */
  function ensureMinimalColumnHud(uiOverlay, bannerText) {
    if (!uiOverlay) return;
    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");
    var existing = document.getElementById("runtime-hud-root");
    if (existing) {
      applyStandaloneBannerText(bannerText);
      return;
    }
    uiOverlay.innerHTML =
      '<div id="runtime-hud-root" class="runtime-hud-root runtime-hud-root--login">' +
      buildHudTitleStackHtml() +
      '<div id="hud-stats-panel" class="hud-stats-panel" aria-label="Game statistics"></div>' +
      '<div id="risque-host-cards-played-panel" class="risque-host-cards-played-panel" hidden aria-hidden="true"></div>' +
      '<div id="risque-host-lucky-panel" class="risque-host-lucky-panel" hidden aria-hidden="true"></div>' +
      '<div id="risque-host-cards-in-hand-panel" class="risque-host-cards-in-hand-panel" hidden aria-hidden="true"></div>' +
      buildHudPhaseLineBelowStatsHtml() +
      '<div id="risque-phase-content" class="risque-phase-content"></div>' +
      "</div>";
    applyStandaloneBannerText(bannerText);
  }

  function ensureLogin(uiOverlay) {
    if (!uiOverlay) return;
    if (document.getElementById("runtime-hud-root")) return;
    ensureMinimalColumnHud(uiOverlay, "RISQUE · Sign in");
  }

  /** Setup phases: full control panel + voice (attack row hidden); content goes in #risque-phase-content. */
  function ensureSetupHud(uiOverlay, bannerText) {
    ensureSetupUnifiedHud(uiOverlay, bannerText != null && String(bannerText) !== "" ? bannerText : "SETUP");
  }

  function attackStepStripShouldStayClickable() {
    var gs = window.gameState;
    return (
      (typeof window.risqueAttackStepControlsShouldStayActive === "function" &&
        window.risqueAttackStepControlsShouldStayActive()) ||
      !!(gs && gs.risqueHostAttackStepStripActive)
    );
  }

  /** Re-enable PAUSE/CANCEL after any code path re-disables chrome while Blitz/Campaign Step is active. */
  function repairAttackStepChromeButtons() {
    var chrome = document.getElementById("hud-attack-chrome");
    if (!chrome || !chrome.classList.contains("hud-chrome-disabled")) return;
    if (!attackStepStripShouldStayClickable()) return;
    var sp = document.getElementById("attack-step-pause-btn");
    var sc = document.getElementById("attack-step-cancel-btn");
    if (sp) {
      sp.disabled = false;
      sp.removeAttribute("disabled");
    }
    if (sc) {
      sc.disabled = false;
      sc.removeAttribute("disabled");
    }
  }

  function setAttackChromeInteractive(on) {
    var chrome = document.getElementById("hud-attack-chrome");
    if (!chrome) return;
    chrome.classList.toggle("hud-chrome-disabled", !on);
    var shouldKeepStep = !on && attackStepStripShouldStayClickable();
    var buttons = chrome.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i += 1) {
      var btn = buttons[i];
      var bid = btn.id;
      if (shouldKeepStep && (bid === "attack-step-pause-btn" || bid === "attack-step-cancel-btn")) {
        btn.disabled = false;
        btn.removeAttribute("disabled");
      } else {
        btn.disabled = !on;
      }
    }
    var cond = document.getElementById("cond-threshold");
    if (cond) cond.disabled = !on;
    if (on && typeof window.risqueSyncAttackPhaseActionLocks === "function") {
      window.risqueSyncAttackPhaseActionLocks();
    }
    if (!on) {
      requestAnimationFrame(function () {
        repairAttackStepChromeButtons();
      });
    }
  }

  /**
   * Keep #log-text bottom inside the 1920×1080 board overlay with 20px logical px buffer; may shrink + scroll.
   */
  function clampCombatLogToCanvasBottom() {
    var logText = document.getElementById("log-text");
    var overlay = document.querySelector(".ui-overlay");
    var root = document.getElementById("runtime-hud-root");
    if (!logText || !overlay) return;
    if (
      root &&
      (root.classList.contains("runtime-hud-root--login") ||
        root.classList.contains("runtime-hud-root--setup"))
    ) {
      logText.style.maxHeight = "";
      return;
    }
    var ob = overlay.getBoundingClientRect();
    if (ob.height < 8) return;
    var lb = logText.getBoundingClientRect();
    var pad = (20 * ob.height) / 1080;
    var maxPx = Math.max(40, ob.bottom - lb.top - pad);
    logText.style.maxHeight = Math.floor(maxPx) + "px";
  }

  function syncPosition() {
    var root = document.getElementById("runtime-hud-root");
    if (!root) return;
    var svg = document.querySelector(".svg-overlay");
    var topPx = 220;
    if (svg) {
      var sg = svg.querySelector("#stats-group");
      if (sg) {
        try {
          var b = sg.getBBox();
          if (b && typeof b.y === "number") {
            // Align column with top of stats; stats table is mirrored in HUD (SVG copy hidden).
            topPx = Math.max(8, Math.round(b.y));
          }
        } catch (e1) {
          /* ignore */
        }
      }
    }
    /* Nudge whole column down so title + control stack sit comfortably in the reserved strip */
    topPx += 23;
    root.style.top = topPx + "px";
    if (root.classList.contains("runtime-hud-root--login")) {
      /* Same as setup: let the column grow with content — no column scrollbar (login + preset fit in normal viewports). */
      root.style.maxHeight = "none";
      root.style.overflowY = "visible";
      root.style.overflowX = "hidden";
    } else if (root.classList.contains("runtime-hud-root--setup")) {
      /* No column scrollbar — selection UI fits under voice without inner scroll */
      root.style.maxHeight = "none";
      root.style.overflowY = "visible";
      root.style.overflowX = "hidden";
    } else if (root.classList.contains("runtime-hud-root--cardplay-panel-only")) {
      root.style.maxHeight = "none";
      /* Shorthand: overflow-x hidden + overflow-y visible computes visible→auto (scrollbar). */
      root.style.overflow = "visible";
    } else {
      root.style.maxHeight = "";
      root.style.overflow = "";
      root.style.overflowY = "";
      root.style.overflowX = "";
      requestAnimationFrame(function () {
        requestAnimationFrame(clampCombatLogToCanvasBottom);
      });
    }
  }

  function escapeHtmlBanner(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Setup / login: optional "TITLE · subtitle" splits across game title + player line. */
  function applyStandaloneBannerText(bannerText) {
    if (bannerText == null || String(bannerText) === "") return;
    var b = document.getElementById("attack-player-name");
    var t = document.getElementById("hud-banner-game-title");
    var full = String(bannerText);
    var dot = full.indexOf("·");
    if (t && b && dot !== -1) {
      t.textContent = full.slice(0, dot).trim();
      b.textContent = full.slice(dot + 1).trim();
    } else if (b) {
      if (t) t.textContent = "RISQUE";
      b.textContent = full;
    }
  }

  /** Dark / saturated blues need a light outline on black TV backgrounds. */
  function bannerPhaseLineNeedsLightOutline(hex) {
    var h = String(hex || "").trim();
    if (h.charAt(0) === "#") h = h.slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6 || /[^0-9a-f]/i.test(h)) return false;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    /* Red-dominant player colors read clearly on black — no white halo (same idea as deploy banner). */
    if (r >= 120 && r > g + 30 && r > b + 30) return false;
    var lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum >= 0.62) return false;
    var blueish = b > 100 && b > r + 25 && b > g + 15;
    /* Saturated blues: rely on banner CSS text-shadow — white stroke reads as a harsh halo (e.g. “Guido”). */
    if (blueish && lum < 0.58) return false;
    if (lum < 0.42) return true;
    return false;
  }

  function phaseToBannerSuffix(phase) {
    var p = String(phase || "");
    if (p === "cardplay" || p === "con-cardplay") return "CardPlay";
    if (p === "income" || p === "con-income") return "Income";
    if (p === "deploy1" || p === "deploy2" || p === "deploy" || p === "con-deploy") return "Deployment";
    if (p === "attack") return "Attack";
    if (p === "reinforce") return "Reinforcement";
    if (p === "receivecard" || p === "getcard") return "ReceiveCard";
    if (p === "conquer") return "Conquer";
    if (p === "con-cardtransfer") return "CardTransfer";
    if (p === "privacyGate" || p === "privacy-gate") return "Privacy";
    if (!p) return "Phase";
    return p.charAt(0).toUpperCase() + p.slice(1).replace(/_([a-z])/g, function (_, c) {
      return c.toUpperCase();
    });
  }

  function updateTurnBannerFromState(gs) {
    var el = document.getElementById("attack-player-name");
    if (!el || !gs || !window.gameUtils) {
      var rootEarly = document.getElementById("runtime-hud-root");
      if (rootEarly) rootEarly.classList.remove("runtime-hud-root--public-cardplay-processing-title");
      var titleEarly = document.getElementById("hud-banner-game-title");
      if (titleEarly) titleEarly.textContent = "RISQUE";
      return;
    }
    var titleEl = document.getElementById("hud-banner-game-title");
    var rootEl = document.getElementById("runtime-hud-root");
    var bookPh = "idle";
    var recapSteps = false;
    if (window.risqueDisplayIsPublic) {
      bookPh =
        typeof window.risquePublicBookSequencePhase === "function"
          ? window.risquePublicBookSequencePhase()
          : "idle";
      recapSteps = !!(
        gs.risquePublicBookProcessing &&
        Array.isArray(gs.risquePublicBookProcessing.steps) &&
        gs.risquePublicBookProcessing.steps.length > 0
      );
    }
    var pubCardProc = !!(window.risqueDisplayIsPublic && recapSteps && (bookPh === "summary" || bookPh === "step"));
    if (rootEl) {
      rootEl.classList.toggle("runtime-hud-root--public-cardplay-processing-title", pubCardProc);
    }
    if (titleEl) {
      if (pubCardProc) {
        var procPlayer = gs.players
          ? gs.players.find(function (x) {
              return x && x.name === gs.currentPlayer;
            })
          : null;
        var procNameU = procPlayer && procPlayer.name ? String(procPlayer.name).toUpperCase() : "PLAYER";
        var procColor = procPlayer ? window.gameUtils.colorMap[procPlayer.color] || "#ffffff" : "#ffffff";
        titleEl.innerHTML =
          '<span style="color:' +
          escapeHtmlBanner(procColor) +
          '">' +
          escapeHtmlBanner(procNameU) +
          '</span>-CARD PROCESSING';
      } else {
        titleEl.textContent = "RISQUE";
      }
    }
    var phase = gs.phase || "";
    /* Public TV: mirror phase may be "income" while the committed-cardplay recap still runs — banner stays CardPlay until the book finishes. */
    if (window.risqueDisplayIsPublic && recapSteps && (bookPh === "summary" || bookPh === "step")) {
      phase = "cardplay";
    }
    if (phase === "login") {
      el.classList.remove("hud-turn-banner--cardplay");
      el.classList.add("hud-turn-banner--player-phase");
      el.style.color = "";
      el.innerHTML =
        '<span class="hud-banner-player-phase-line" style="color:#00ff00">' +
        escapeHtmlBanner("SIGN IN") +
        "</span>";
      return;
    }
    if (phase === "postgame") {
      el.classList.remove("hud-turn-banner--cardplay");
      el.classList.add("hud-turn-banner--player-phase");
      el.style.color = "";
      var winPost = gs.winner ? String(gs.winner).toUpperCase() : "GAME OVER";
      el.innerHTML =
        '<span class="hud-banner-player-phase-line" style="color:#fbbf24">' +
        escapeHtmlBanner(winPost + " — POSTGAME") +
        "</span>";
      return;
    }
    /* Match refreshSetupStageChrome banners — not CURRENTPLAYER-DEAL on TV or host during setup draws */
    if (phase === "deal") {
      el.classList.remove("hud-turn-banner--cardplay");
      el.classList.add("hud-turn-banner--player-phase");
      el.style.color = "";
      el.innerHTML =
        '<span class="hud-banner-player-phase-line" style="color:#00ff00">' +
        escapeHtmlBanner("DEAL") +
        "</span>";
      return;
    }
    if (phase === "playerSelect") {
      var sk = String(gs.selectionPhase || gs.risquePublicUiSelectKind || "");
      var fk =
        gs.risquePublicPlayerSelectFlash && gs.risquePublicPlayerSelectFlash.selectKind
          ? String(gs.risquePublicPlayerSelectFlash.selectKind)
          : "";
      if (!sk && fk) sk = fk;
      var sub = "SELECT";
      if (sk === "firstCard") sub = "FIRST CARD";
      else if (sk === "deployOrder") sub = "DEPLOY ORDER";
      else if (sk === "cardPlay") sub = "SELECTING PLAYER ONE";
      el.classList.remove("hud-turn-banner--cardplay");
      el.classList.add("hud-turn-banner--player-phase");
      el.style.color = "";
      el.innerHTML =
        '<span class="hud-banner-player-phase-line" style="color:#00ff00">' +
        escapeHtmlBanner(sub) +
        "</span>";
      return;
    }
    var p = gs.players
      ? gs.players.find(function (x) {
          return x.name === gs.currentPlayer;
        })
      : null;
    if (!p) {
      el.textContent = "";
      el.innerHTML = "";
      return;
    }
    var color = window.gameUtils.colorMap[p.color] || "#ffffff";
    var suffix = phaseToBannerSuffix(phase);
    var nameU = String(p.name || "").toUpperCase();
    var suffixU = String(suffix || "").toUpperCase();
    el.classList.remove("hud-turn-banner--cardplay");
    el.classList.add("hud-turn-banner--player-phase");
    el.style.color = "";
    /* Deploy / attack: player color on black — no white stroke (readability from size + shadow in CSS) */
    /* Host income: smaller banner via CSS; omit outline so the name has no stroke */
    var outlineClass =
      phase === "deploy" ||
      phase === "attack" ||
      phase === "cardplay" ||
      phase === "con-cardplay" ||
      ((phase === "income" || phase === "con-income") && window.risqueDisplayIsPublic !== true)
        ? ""
        : bannerPhaseLineNeedsLightOutline(color)
          ? " hud-banner-player-phase-line--light-outline"
          : "";
    el.innerHTML =
      '<span class="hud-banner-player-phase-line' +
      outlineClass +
      '" style="color:' +
      escapeHtmlBanner(color) +
      '">' +
      escapeHtmlBanner(nameU) +
      "-" +
      escapeHtmlBanner(suffixU) +
      "</span>";
  }

  window.risqueRuntimeHud = {
    ensure: ensure,
    ensureLogin: ensureLogin,
    ensureSetupHud: ensureSetupHud,
    ensureSetupUnifiedHud: ensureSetupUnifiedHud,
    setControlVoiceText: setControlVoiceText,
    clearPhaseSlot: clearPhaseSlot,
    setAttackChromeInteractive: setAttackChromeInteractive,
    repairAttackStepChromeButtons: repairAttackStepChromeButtons,
    clampCombatLogToCanvasBottom: clampCombatLogToCanvasBottom,
    syncPosition: syncPosition,
    updateTurnBannerFromState: updateTurnBannerFromState,
    isPostSetupPhase: function (phase) {
      var p = String(phase || "");
      return (
        p === "cardplay" ||
        p === "con-cardplay" ||
        p === "income" ||
        p === "con-income" ||
        p === "deploy1" ||
        p === "deploy2" ||
        p === "deploy" ||
        p === "con-deploy" ||
        p === "attack" ||
        p === "reinforce" ||
        p === "receivecard" ||
        p === "getcard" ||
        p === "conquer" ||
        p === "con-cardtransfer" ||
        p === "postgame"
      );
    }
  };
})();
