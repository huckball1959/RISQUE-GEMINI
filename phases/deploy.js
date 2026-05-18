/**
 * Deployment — one module, all deploy behaviors.
 *
 * URL: game.html?phase=deploy&kind=setup — first deployment (all players, starting armies).
 * URL: game.html?phase=deploy&kind=turn — income deploy, then attack.
 * URL: game.html?phase=con-deploy — continental conquer deploy after con-income (opts.continentalDeploy).
 * Legacy ?phase=deploy1|deploy2 is rewritten to the above by game-shell.js.
 */
(function () {
  "use strict";

  /** Cardplay-style protection level (matches reinforce PROTECT). */
  var RISQUE_DEPLOY_PROTECT_TROOPS = 3;
  var DEPLOY_PROTECT_ALL_EXHAUSTED_MSG =
    "EXHOSTED ALL TROOPS, FAILED TO PROTECT ALL TERRITORIES";

  var STYLE_ID_DEPLOY_TURN = "risque-deploy2-styles-v1";

  /** Setup/turn deploy: do not stringify the full replay tape into localStorage on every wheel click. */
  function persistGameStateLite(gs) {
    var target = gs && typeof gs === "object" ? gs : window.gameState;
    if (!target) return;
    if (typeof window.risqueWriteGameStateLocalStorageLite === "function") {
      window.risqueWriteGameStateLocalStorageLite(target);
      return;
    }
    try {
      localStorage.setItem("gameState", JSON.stringify(target));
    } catch (err) {
      console.warn("[Deploy] Failed to save game state.");
    }
  }

  function deployContinentDisplayName(contKey) {
    var gu = window.gameUtils;
    if (gu && gu.continentDisplayNames && gu.continentDisplayNames[contKey]) {
      return gu.continentDisplayNames[contKey];
    }
    return String(contKey || "").replace(/_/g, " ");
  }

  function deployTerritoryOwnedInContinent(gameState, territoryName, contKey) {
    var gu = window.gameUtils;
    if (!gu || !contKey) return false;
    var ids = gu.getContinentTerritoryIdsForBoard(gameState, contKey);
    return ids.indexOf(String(territoryName || "")) >= 0;
  }

  /** Continent keys where the player holds at least one territory (alphabetical). */
  function deployListContinentKeysWithPlayerPresence(gameState, player) {
    var gu = window.gameUtils;
    if (!gu || !gameState || !player || !Array.isArray(player.territories)) {
      return [];
    }
    var out = [];
    Object.keys(gu.continents || {}).forEach(function (contKey) {
      var hasAny = player.territories.some(function (pt) {
        return pt && deployTerritoryOwnedInContinent(gameState, pt.name, contKey);
      });
      if (hasAny) out.push(contKey);
    });
    out.sort(function (a, b) {
      return deployContinentDisplayName(a).localeCompare(deployContinentDisplayName(b));
    });
    return out;
  }

  /** Continents the player fully controls (all territories in the continent). */
  function deployListPlayerFullyOwnedContinentKeys(gameState, player) {
    var gu = window.gameUtils;
    if (!gu || !gameState || !player) {
      return [];
    }
    var keys = [];
    if (typeof gu.listFullyHeldContinentKeysForPlayer === "function") {
      keys = gu.listFullyHeldContinentKeysForPlayer(gameState, player);
    }
    keys.sort(function (a, b) {
      return deployContinentDisplayName(a).localeCompare(deployContinentDisplayName(b));
    });
    return keys;
  }

  function deployCollectProtectTargets(territories) {
    return (territories || [])
      .map(function (t) {
        var current = Math.max(0, Math.floor(Number(t.troops) || 0));
        if (current >= RISQUE_DEPLOY_PROTECT_TROOPS) {
          return null;
        }
        return {
          territory: t,
          name: t.name,
          current: current,
          needed: RISQUE_DEPLOY_PROTECT_TROOPS - current
        };
      })
      .filter(Boolean)
      .sort(function (a, b) {
        if (a.current !== b.current) {
          return a.current - b.current;
        }
        return String(a.name).localeCompare(String(b.name));
      });
  }

  /** scopeContinentKey: null / "all" = every owned continent (alphabetical), else one continent key. */
  function deployCollectProtectTargetsOrdered(gameState, player, scopeContinentKey) {
    if (!player || !Array.isArray(player.territories)) {
      return [];
    }
    var scope = scopeContinentKey == null ? "all" : String(scopeContinentKey);
    if (scope !== "all") {
      var oneBatch = player.territories.filter(function (t) {
        return t && deployTerritoryOwnedInContinent(gameState, t.name, scope);
      });
      return deployCollectProtectTargets(oneBatch);
    }
    var ordered = [];
    deployListContinentKeysWithPlayerPresence(gameState, player).forEach(function (contKey) {
      var batch = player.territories.filter(function (t) {
        return t && deployTerritoryOwnedInContinent(gameState, t.name, contKey);
      });
      ordered = ordered.concat(deployCollectProtectTargets(batch));
    });
    return ordered;
  }

  function deployBuildProtectAllControlHtml(ids) {
    ids = ids || {};
    var btnId = ids.button || "deploy-protect-all";
    var menuId = ids.menu || "deploy-protect-all-menu";
    return (
      '<div class="deploy-protect-all-wrap">' +
      '<button type="button" id="' +
      btnId +
      '" class="deploy1-action-btn deploy1-action-btn-protect-all" aria-expanded="false" aria-haspopup="true" aria-controls="' +
      menuId +
      '" title="From bank: bring each owned territory below ' +
      RISQUE_DEPLOY_PROTECT_TROOPS +
      ' up to ' +
      RISQUE_DEPLOY_PROTECT_TROOPS +
      ' (all continents, alphabetical)">PROTECT ALL</button>' +
      '<div id="' +
      menuId +
      '" class="deploy-protect-all-menu" role="menu" hidden></div>' +
      "</div>"
    );
  }

  function deployProtectAllMenuItemHtml(scopeKey, label, gameState, player) {
    var targets = deployCollectProtectTargetsOrdered(gameState, player, scopeKey);
    var inactive = targets.length === 0;
    return (
      '<button type="button" class="deploy-protect-all-menu-item' +
      (inactive ? " deploy-protect-all-menu-item--inactive" : "") +
      '" data-protect-scope="' +
      scopeKey +
      '" role="menuitem"' +
      (inactive ? ' disabled aria-disabled="true"' : "") +
      ">" +
      label +
      "</button>"
    );
  }

  function deployRefreshProtectAllMenu(menuEl, gameState, player) {
    if (!menuEl) return;
    var html = deployProtectAllMenuItemHtml("all", "ALL", gameState, player);
    if (gameState && player) {
      deployListPlayerFullyOwnedContinentKeys(gameState, player).forEach(function (ck) {
        html += deployProtectAllMenuItemHtml(
          ck,
          deployContinentDisplayName(ck).toUpperCase(),
          gameState,
          player
        );
      });
    }
    menuEl.innerHTML = html;
  }

  function deployProtectAllHasAnyTargets(gameState, player) {
    return (
      deployCollectProtectTargetsOrdered(gameState, player, "all").length > 0
    );
  }

  function deployClearProtectAllMenuPosition(menu) {
    if (!menu) return;
    menu.style.position = "";
    menu.style.top = "";
    menu.style.left = "";
    menu.style.width = "";
    menu.style.zIndex = "";
    menu.classList.remove("deploy-protect-all-menu--fixed");
  }

  function deployPositionProtectAllMenu(menu, btn) {
    if (!menu || !btn) return;
    var rect = btn.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.top = Math.round(rect.bottom + 4) + "px";
    menu.style.left = Math.round(rect.left) + "px";
    menu.style.width = Math.max(Math.round(rect.width), 120) + "px";
    menu.style.zIndex = "100003";
    menu.classList.add("deploy-protect-all-menu--fixed");
  }

  function deployCloseProtectAllMenu(wrap) {
    if (!wrap) return;
    var menu =
      wrap.querySelector(".deploy-protect-all-menu") ||
      document.getElementById("deploy-protect-all-menu");
    var btn = wrap.querySelector(".deploy1-action-btn-protect-all");
    if (menu) {
      menu.hidden = true;
      deployClearProtectAllMenuPosition(menu);
      if (menu.__risqueProtectAllHome && menu.parentNode !== menu.__risqueProtectAllHome) {
        menu.__risqueProtectAllHome.appendChild(menu);
      }
    }
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function deployOpenProtectAllMenu(wrap, menu, btn) {
    if (!menu || !btn) return;
    if (!menu.__risqueProtectAllHome) {
      menu.__risqueProtectAllHome = menu.parentNode;
    }
    document.body.appendChild(menu);
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    deployPositionProtectAllMenu(menu, btn);
  }

  function deployToggleProtectAllMenu(wrap) {
    var menu =
      (wrap && wrap.querySelector(".deploy-protect-all-menu")) ||
      document.getElementById("deploy-protect-all-menu");
    var btn = wrap && wrap.querySelector(".deploy1-action-btn-protect-all");
    if (!menu || !btn) return;
    if (menu.hidden) {
      deployOpenProtectAllMenu(wrap, menu, btn);
    } else {
      deployCloseProtectAllMenu(wrap);
    }
  }

  function deployWireProtectAllControl(cfg) {
    cfg = cfg || {};
    var wrap = document.querySelector(cfg.wrapSelector || ".deploy-protect-all-wrap");
    var btn = document.getElementById(cfg.buttonId);
    var menu = document.getElementById(cfg.menuId);
    if (!wrap || !btn || !menu || typeof cfg.applyScope !== "function") {
      return;
    }
    function refreshMenu() {
      deployRefreshProtectAllMenu(menu, cfg.getGameState(), cfg.getPlayer());
    }
    refreshMenu();
    if (wrap.__risqueProtectAllWired) {
      wrap.__risqueProtectAllRefreshMenu = refreshMenu;
      return;
    }
    wrap.__risqueProtectAllWired = true;
    wrap.__risqueProtectAllRefreshMenu = refreshMenu;
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      refreshMenu();
      deployToggleProtectAllMenu(wrap);
    });
    menu.addEventListener("click", function (e) {
      var item = e.target && e.target.closest("[data-protect-scope]");
      if (!item || item.disabled || item.getAttribute("aria-disabled") === "true") {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      var scopeKey = item.getAttribute("data-protect-scope") || "all";
      deployCloseProtectAllMenu(wrap);
      cfg.applyScope(scopeKey);
    });
    if (!wrap.__risqueProtectAllDocCloseWired) {
      wrap.__risqueProtectAllDocCloseWired = true;
      document.addEventListener("click", function (e) {
        var menuEl = document.getElementById(cfg.menuId);
        if (
          wrap.contains(e.target) ||
          (menuEl && menuEl.contains(e.target)) ||
          (btn && btn === e.target)
        ) {
          return;
        }
        deployCloseProtectAllMenu(wrap);
      });
    }
  }

  function deployProtectAllFailedToComplete(result, hadTargets) {
    if (!hadTargets || !result) return false;
    return (Number(result.untouched) || 0) > 0 || (Number(result.partialCount) || 0) > 0;
  }

  function deployApplyProtectAllFromBank(targets, bank, applyAdd) {
    var remaining = Math.max(0, Math.floor(Number(bank) || 0));
    var totalDeployed = 0;
    var fullyProtected = 0;
    var partialCount = 0;
    var untouched = 0;
    for (var i = 0; i < targets.length; i++) {
      if (remaining <= 0) {
        untouched = targets.length - i;
        break;
      }
      var entry = targets[i];
      var add = Math.min(entry.needed, remaining);
      if (add > 0) {
        applyAdd(entry.territory, add);
        remaining -= add;
        totalDeployed += add;
        if (add >= entry.needed) {
          fullyProtected += 1;
        } else {
          partialCount += 1;
        }
      }
    }
    return {
      totalDeployed: totalDeployed,
      fullyProtected: fullyProtected,
      partialCount: partialCount,
      untouched: untouched
    };
  }

  function deployProtectAllVoiceMessage(result, hadTargets) {
    if (!hadTargets) {
      return (
        "Every owned territory already has at least " +
        RISQUE_DEPLOY_PROTECT_TROOPS +
        " troops."
      );
    }
    if (result.totalDeployed <= 0) {
      return "No troops left in bank.";
    }
    var msg =
      "Protect all: deployed " +
      result.totalDeployed +
      " troop" +
      (result.totalDeployed === 1 ? "" : "s") +
      " (target " +
      RISQUE_DEPLOY_PROTECT_TROOPS +
      " per territory, lowest first).";
    if (result.fullyProtected > 0) {
      msg +=
        " " +
        result.fullyProtected +
        " territor" +
        (result.fullyProtected === 1 ? "y" : "ies") +
        " now at " +
        RISQUE_DEPLOY_PROTECT_TROOPS +
        ".";
    }
    if (result.partialCount > 0 || result.untouched > 0) {
      msg += " Bank exhausted before all territories reached " + RISQUE_DEPLOY_PROTECT_TROOPS + ".";
    }
    return msg;
  }

  function refreshDeployProtectAllButton(btn, player, gameState) {
    var wrap = document.querySelector(".deploy-protect-all-wrap");
    if (wrap && typeof wrap.__risqueProtectAllRefreshMenu === "function") {
      wrap.__risqueProtectAllRefreshMenu();
    }
    if (!btn) {
      return;
    }
    var gs = gameState || window.gameState;
    var hasTargets = deployProtectAllHasAnyTargets(gs, player);
    var bank = player ? Math.max(0, Number(player.bankValue) || 0) : 0;
    var disabled = !player || bank <= 0 || !hasTargets;
    btn.disabled = disabled;
    if (disabled) {
      deployCloseProtectAllMenu(wrap);
    }
    btn.title = !hasTargets
      ? "All owned territories already have " + RISQUE_DEPLOY_PROTECT_TROOPS + "+ troops"
      : bank <= 0
        ? "No troops left in bank"
        : "Open menu: ALL protects every owned territory below " +
          RISQUE_DEPLOY_PROTECT_TROOPS +
          " (continents A→Z); or pick one fully owned continent";
  }

  function loginRecoveryHref() {
    return window.risqueLoginRecoveryViaPrivacyUrl();
  }

  /** Prefer same-document game.html navigation (no full reload); fallback fade or location. */
  function navigateGameHtmlPreferSoft(url) {
    try {
      if (typeof window.risqueNavigateGameHtmlSoft === "function" && window.risqueNavigateGameHtmlSoft(url)) {
        return;
      }
    } catch (eNav) {
      /* ignore */
    }
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(url);
    } else {
      window.location.href = url;
    }
  }

  /**
   * Full-screen handoff before setup deploy UI is shown (streaming / hot-seat).
   * @param {string} playerName
   * @param {"first"|"next"} kind
   * @param {function()} onContinue
   * @param {function(string)=} logFn
   */
  function mountSetupDeployHandoff(playerName, kind, onContinue, logFn) {
    var label = (playerName || "the next player").toString();
    var msg =
      kind === "first"
        ? "Setup deployment\n\nHand the tablet to " +
          label +
          ".\n\nOnly this player should tap Continue."
        : "Hand the tablet to " +
          label +
          " for deployment.\n\nOnly this player should tap Continue.";
    if (
      !window.risquePhases ||
      !window.risquePhases.privacyGate ||
      typeof window.risquePhases.privacyGate.mount !== "function"
    ) {
      if (typeof logFn === "function") {
        logFn("[DeploySetup] Privacy gate unavailable; skipping handoff overlay.");
      }
      if (typeof onContinue === "function") onContinue();
      return;
    }
    window.risquePhases.privacyGate.mount(document.body, {
      message: msg,
      buttonLabel: "Continue",
      onContinue: function () {
        if (typeof onContinue === "function") onContinue();
      },
      onLog: logFn
    });
  }

  function injectDeployTurnStyles() {
    if (document.getElementById(STYLE_ID_DEPLOY_TURN)) return;

    var s = document.createElement("style");
    s.id = STYLE_ID_DEPLOY_TURN;
    s.textContent =
      ".deploy-player-name{font-family:Arial,sans-serif;font-size:58px;font-weight:bold;line-height:1.05;text-align:center;position:absolute;left:1152px;top:500px;width:704px;height:110px;z-index:10;pointer-events:none;" +
      "-webkit-text-stroke:2px #000000;text-shadow:-2px -2px 0 rgba(0,0,0,0.85),2px -2px 0 rgba(0,0,0,0.85),-2px 2px 0 rgba(0,0,0,0.85),2px 2px 0 rgba(0,0,0,0.85);}" +
      ".deploy-subline{display:block;font-size:44px;line-height:1.05;}" +
      ".bank-label,.bank-number{font-family:Arial,sans-serif;font-size:38px;font-weight:bold;text-align:center;position:absolute;z-index:10;pointer-events:none;color:#ffffff;" +
      "-webkit-text-stroke:2px #000000;text-shadow:-2px -2px 0 rgba(0,0,0,0.85),2px -2px 0 rgba(0,0,0,0.85),-2px 2px 0 rgba(0,0,0,0.85),2px 2px 0 rgba(0,0,0,0.85);}" +
      ".bank-label{left:1328px;top:666px;width:220px;height:72px;}" +
      ".bank-number{left:1548px;top:666px;width:144px;height:72px;}" +
      ".deploy-button{position:absolute;background:#dcdcdc;border:2px solid #000000;border-radius:4px;color:#000000;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;text-align:center;cursor:pointer;transition:background 0.2s,transform 0.1s;pointer-events:all;z-index:10;}" +
      ".deploy-button:hover:not(:disabled){background:#c0c0c0;}" +
      ".deploy-button:active:not(:disabled){transform:scale(0.95);}" +
      ".deploy-button:disabled{background:#e0e0e0;border-color:#999999;color:#999999;cursor:not-allowed;}";
    document.head.appendChild(s);
  }

  function logLineSetup(message, logFn) {
    var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var line = "[" + ts + "] [DeploySetup] " + message;
    console.log(line);
    if (typeof logFn === "function") logFn(line);
    try {
      var logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
      if (!Array.isArray(logs)) logs = [];
      logs.push(line);
      localStorage.setItem("gameLogs", JSON.stringify(logs));
    } catch (e) {
      /* ignore */
    }
  }

  /** Initial setup: cycle players until all starting banks empty → card-play order. */
  function runSetupDeploy(stageHost, opts) {
    opts = opts || {};
    var logFn = opts.log;
    window.risqueDeploy1Active = true;
    window.viewTroopsActive = false;
    if (typeof window.risqueSetMirrorDeployRoute === "function") {
      window.risqueSetMirrorDeployRoute("setup");
    }

    var canvas = document.getElementById("canvas");
    var uiOverlay = document.getElementById("ui-overlay");
    if (!canvas || !uiOverlay || !window.gameUtils) {
      logLineSetup("Missing canvas, ui-overlay, or gameUtils", logFn);
      return;
    }

    var phaseSlot = document.getElementById("risque-phase-content");
    if (!phaseSlot) {
      logLineSetup("Missing #risque-phase-content (setup HUD not ready)", logFn);
      return;
    }

    var psFromSelect = document.getElementById("risque-player-select-root");
    if (psFromSelect && psFromSelect.parentNode) psFromSelect.parentNode.removeChild(psFromSelect);

    uiOverlay.className = "ui-overlay visible";
    uiOverlay.classList.remove("fade-out");

    phaseSlot.innerHTML =
      '<div class="deploy2-compact-root">' +
      '<div class="deploy2-bank-row">' +
      '<span class="deploy2-bank-label">Bank</span>' +
      '<span id="deploy1-bank-number" class="deploy2-bank-number">000</span>' +
      "</div>" +
      '<p class="deploy2-hint">Select a territory. Scroll the wheel or type a number and press Enter. Use − for removals.</p>' +
      '<div class="deploy2-actions deploy1-deploy-actions deploy1-deploy-actions--hud-row">' +
      '<button type="button" id="deploy1-reset" class="deploy1-action-btn">RESET</button>' +
      '<button type="button" id="deploy1-add-2" class="deploy1-action-btn">+2</button>' +
      '<button type="button" id="deploy1-add-5" class="deploy1-action-btn">+5</button>' +
      '<button type="button" id="deploy1-add-10" class="deploy1-action-btn">+10</button>' +
      '<button type="button" id="deploy1-add-all" class="deploy1-action-btn">ALL</button>' +
      '<button type="button" id="deploy1-confirm" class="deploy1-action-btn">CONFIRM</button>' +
      "</div>" +
      "</div>";

    var bankNumber = document.getElementById("deploy1-bank-number");
    var confirmButton = document.getElementById("deploy1-confirm");
    var resetButton = document.getElementById("deploy1-reset");

    var gameState = null;
    var deploymentOrder = [];
    var currentPlayerIndex = 0;
    var initialBankValues = {};
    var deploymentInitialized = false;
    var keyboardBuffer = "";
    var negativeInput = false;
    var deployedTroops = {};

    function renderMap(changedLabel) {
      window.gameState = gameState;
      window.deployedTroops = deployedTroops[gameState.currentPlayer] || {};
      window.gameUtils.renderAll(gameState, changedLabel, window.deployedTroops);
      if (typeof window.risquePersistHostGameState === "function") {
        window.risquePersistHostGameState();
      }
    }

    /** Drop deploy-only UI (bumps, white “bank” fill, +N satellites, mirror draft) and redraw — call after phase leaves deploy. */
    function clearDeployChromeThenRedraw() {
      window.gameState = gameState;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      window.deployedTroops = {};
      if (gameState.risqueDeployMirrorDraft) {
        delete gameState.risqueDeployMirrorDraft;
      }
      if (gameState.risqueDeployTransientPrimary) {
        delete gameState.risqueDeployTransientPrimary;
      }
      if (typeof window.risqueSetSpectatorFocus === "function") {
        window.risqueSetSpectatorFocus([]);
      }
      window.gameUtils.renderTerritories(null, gameState, {});
      window.gameUtils.renderStats(gameState);
    }

    function persistGameStateForPublicMirror() {
      try {
        if (window.gameState && !window.risqueDisplayIsPublic) {
          persistGameStateLite(window.gameState);
        }
      } catch (e0) {
        /* ignore */
      }
    }

    function updateDeployVoice(warnMessage) {
      if (!window.risqueRuntimeHud || typeof window.risqueRuntimeHud.setControlVoiceText !== "function") {
        return;
      }
      if (!gameState) return;
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var primary = player.name.toUpperCase() + "\nDEPLOY ALL TROOPS FROM YOUR BANK";
      if (warnMessage) {
        try {
          gameState.risquePublicDeployBanner =
            player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + String(warnMessage);
        } catch (eBanner0) {}
        window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + String(warnMessage), "");
        persistGameStateForPublicMirror();
        return;
      }
      if (typeof window.risqueRefreshDeployNarration === "function") {
        window.risqueRefreshDeployNarration(gameState);
        persistGameStateForPublicMirror();
        return;
      }
      var bank = Math.max(0, Number(player.bankValue) || 0);
      var r =
        bank === 0
          ? "0 troops remaining in bank — confirm when finished"
          : bank === 1
            ? "1 troop remaining in bank"
            : bank + " troops remaining in bank";
      try {
        gameState.risquePublicDeployBanner =
          player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + r;
      } catch (eBanner1) {}
      window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + r, "");
      persistGameStateForPublicMirror();
    }

    function updateBankDisplay() {
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      bankNumber.textContent = player ? player.bankValue.toString().padStart(3, "0") : "000";
      updateDeployVoice();
    }

    function onWheel(e) {
      if (!gameState || !window.selectedTerritory) return;
      e.preventDefault();
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      var territory = player && player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      var delta = e.deltaY > 0 ? -1 : 1;
      var newTroops = territory.troops + delta;
      if (newTroops < 1) {
        return;
      }
      if (delta > 0 && player.bankValue === 0) {
        window.gameUtils.showError("");
        updateDeployVoice("No troops left in bank.");
        return;
      }
      territory.troops = newTroops;
      player.bankValue -= delta;
      player.troopsTotal += delta;
      deployedTroops[player.name][territory.name] = territory.troops - 1;
      renderMap(window.selectedTerritory);
      updateBankDisplay();
      window.gameUtils.showError("");
      if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
        window.risqueSetSpectatorFocus([window.selectedTerritory]);
      }
      try {
        persistGameStateLite(gameState);
      } catch (err) {
        console.warn("[Deploy] Failed to save game state.");
      }
    }

    /** Move bank to selected territory until `leaveInBank` troops remain (wheel shortcut). */
    function applyBulkDeploySetup(leaveInBank) {
      leaveInBank = Math.max(0, Math.floor(Number(leaveInBank) || 0));
      if (!gameState || !window.selectedTerritory) {
        return;
      }
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var territory = player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      var bank = Math.max(0, Number(player.bankValue) || 0);
      var toAdd = bank - leaveInBank;
      if (toAdd <= 0) {
        window.gameUtils.showError("");
        updateDeployVoice(
          bank <= leaveInBank
            ? "Not enough in bank to leave " + leaveInBank + " behind on this territory."
            : ""
        );
        return;
      }
      territory.troops += toAdd;
      player.bankValue -= toAdd;
      player.troopsTotal += toAdd;
      deployedTroops[player.name][territory.name] = territory.troops - 1;
      renderMap(window.selectedTerritory);
      updateBankDisplay();
      window.gameUtils.showError("");
      if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
        window.risqueSetSpectatorFocus([window.selectedTerritory]);
      }
      try {
        persistGameStateLite(gameState);
      } catch (err) {
        console.warn("[Deploy] Failed to save game state.");
      }
    }

    function applyDeployFromBankSetup(troopChange) {
      troopChange = Math.floor(Number(troopChange) || 0);
      if (troopChange <= 0 || !gameState) return;
      if (!window.selectedTerritory) {
        return;
      }
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var territory = player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      var newTroops = territory.troops + troopChange;
      if (newTroops < 1) {
        return;
      }
      if (troopChange > player.bankValue) {
        window.gameUtils.showError("");
        updateDeployVoice(
          "Only " +
            player.bankValue +
            " troop" +
            (player.bankValue === 1 ? "" : "s") +
            " left in bank."
        );
        return;
      }
      territory.troops = newTroops;
      player.bankValue -= troopChange;
      player.troopsTotal += troopChange;
      deployedTroops[player.name][territory.name] = territory.troops - 1;
      renderMap(window.selectedTerritory);
      updateBankDisplay();
      window.gameUtils.showError("");
      if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
        window.risqueSetSpectatorFocus([window.selectedTerritory]);
      }
      try {
        persistGameStateLite(gameState);
      } catch (err) {
        console.warn("[Deploy] Failed to save game state.");
      }
    }

    function installDeploySetupAuxMenu() {
      window.risqueGetAuxMouseMenu = function () {
        if (!window.risqueDeploy1Active || !gameState) {
          return null;
        }
        return {
          title: "Deployment",
          hint: window.selectedTerritory
            ? "Thumb-button menu — or keep using the wheel on the map."
            : "Select a territory on the map first.",
          anchor: true,
          actions: [
            {
              label: "Confirm",
              action: function () {
                if (confirmButton) confirmButton.click();
              }
            },
            { label: "Cancel", action: function () {} },
            {
              label: "Put all but 1 in bank on territory",
              action: function () {
                applyBulkDeploySetup(1);
              }
            },
            {
              label: "Put all but 3 in bank on territory",
              action: function () {
                applyBulkDeploySetup(3);
              }
            },
            {
              label: "Reset",
              action: function () {
                if (resetButton) resetButton.click();
              }
            }
          ]
        };
      };
    }

    function onKeyDown(e) {
      if (!gameState || !window.selectedTerritory) return;
      var player = gameState.players && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      var territory = player && player.territories.find(function (t) {
        return t.name === window.selectedTerritory;
      });
      if (!territory) return;
      if (e.key === "Enter") {
        if (keyboardBuffer === "") return;
        var troops = parseInt(keyboardBuffer, 10);
        if (isNaN(troops)) {
          keyboardBuffer = "";
          negativeInput = false;
          return;
        }
        var troopChange = negativeInput ? -troops : troops;
        var newTroops2 = territory.troops + troopChange;
        if (newTroops2 < 1) {
          keyboardBuffer = "";
          negativeInput = false;
          return;
        }
        if (troopChange > player.bankValue) {
          window.gameUtils.showError("");
          updateDeployVoice(
            "Only " + player.bankValue + " troop" + (player.bankValue === 1 ? "" : "s") + " left in bank."
          );
          keyboardBuffer = "";
          negativeInput = false;
          return;
        }
        territory.troops = newTroops2;
        player.bankValue -= troopChange;
        player.troopsTotal += troopChange;
        deployedTroops[player.name][territory.name] = territory.troops - 1;
        keyboardBuffer = "";
        negativeInput = false;
        var prettyT1 =
          window.gameUtils && window.gameUtils.formatTerritoryDisplayName
            ? window.gameUtils.formatTerritoryDisplayName(territory.name)
            : territory.name.replace(/_/g, " ");
        if (troopChange > 0 && typeof window.risqueDeployTroopCountToWord === "function") {
          gameState.risqueDeployTransientPrimary =
            player.name +
            " has deployed " +
            window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
            " troops to " +
            prettyT1 +
            ".";
        } else if (troopChange < 0 && typeof window.risqueDeployTroopCountToWord === "function") {
          gameState.risqueDeployTransientPrimary =
            player.name +
            " has removed " +
            window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
            " troops from " +
            prettyT1 +
            ".";
        }
        window.selectedTerritory = null;
        window.gameUtils.showError("");
        renderMap(null);
        updateBankDisplay();
        try {
          persistGameStateLite(gameState);
        } catch (err2) {
          console.warn("[Deploy] Failed to save game state.");
        }
      } else if (e.key === "-") {
        negativeInput = true;
        keyboardBuffer = "";
      } else if (e.key >= "0" && e.key <= "9") {
        keyboardBuffer += e.key;
        if (keyboardBuffer.length > 3) {
          keyboardBuffer = keyboardBuffer.slice(0, -1);
        }
      }
    }

    function initializeDeployment() {
      if (deploymentInitialized) return;
      window.gameUtils.loadGameState(function (loadedGameState) {
        if (!loadedGameState) {
          console.warn("[Deploy] Invalid game state. Redirecting.");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 1000);
          return;
        }
        gameState = loadedGameState;
        var invalidPlayer = gameState.players.find(function (p) {
          return !p.territories || p.territories.length === 0;
        });
        if (invalidPlayer) {
          console.warn("[Deploy] Invalid: player has no territories.");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 1000);
          return;
        }
        if (!gameState.currentPlayer || gameState.turnOrder.indexOf(gameState.currentPlayer) === -1) {
          console.warn("[Deploy] Invalid current player.");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 1000);
          return;
        }
        deploymentOrder = gameState.turnOrder.slice();
        currentPlayerIndex = deploymentOrder.indexOf(gameState.currentPlayer);
        gameState.phase = "deploy";
        gameState.players.forEach(function (player) {
          initialBankValues[player.name] = player.bankValue || 0;
          deployedTroops[player.name] = {};
          player.territories.forEach(function (t) {
            deployedTroops[player.name][t.name] = t.troops - 1;
          });
        });
        deploymentInitialized = true;
        logLineSetup("Initialized: currentPlayer=" + gameState.currentPlayer, logFn);
        window.viewTroopsActive = false;
        window.gameState = gameState;
        installDeploySetupAuxMenu();
        function revealSetupDeployAfterHandoff() {
          renderMap(null);
          updateBankDisplay();
          if (typeof window.risqueReplaySeedOpening === "function") {
            window.risqueReplaySeedOpening(gameState);
          }
          if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
            window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
          }
          if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
            requestAnimationFrame(function () {
              window.risqueRuntimeHud.syncPosition();
            });
          }
        }
        mountSetupDeployHandoff(gameState.currentPlayer, "first", revealSetupDeployAfterHandoff, logFn);
      });
    }

    resetButton.addEventListener("click", function () {
      var player = gameState && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) {
        console.warn("[Deploy] No current player.");
        return;
      }
      player.bankValue = initialBankValues[player.name] || 0;
      player.territories.forEach(function (t) {
        t.troops = 1;
        deployedTroops[player.name][t.name] = 0;
      });
      player.troopsTotal = player.territories.length;
      keyboardBuffer = "";
      negativeInput = false;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      window.gameUtils.showError("");
      renderMap(null);
      updateBankDisplay();
      try {
        persistGameStateLite(gameState);
      } catch (e) {
        console.warn("[Deploy] Failed to save game state.");
      }
    });

    confirmButton.addEventListener("click", function () {
      var player = gameState && gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) {
        console.warn("[Deploy] No current player.");
        return;
      }
      if (player.bankValue > 0) {
        window.gameUtils.showError("");
        updateDeployVoice("Deploy every troop from your bank before confirming.");
        return;
      }
      if (gameState.players.every(function (p) {
        return p.bankValue === 0;
      })) {
        try {
          /* Next URL is playerSelect&selectKind=cardPlay — not cardplay yet; mirror/TV need phase playerSelect for name roulette. */
          gameState.phase = "playerSelect";
          clearDeployChromeThenRedraw();
          if (typeof window.risqueReplayRecordDeploy === "function") {
            window.risqueReplayRecordDeploy(gameState);
          }
          if (typeof window.risqueCheapReplayCapturePostSetupDeploy === "function") {
            try {
              window.risqueCheapReplayCapturePostSetupDeploy(gameState);
            } catch (eCheapPd) {
              /* ignore */
            }
          }
          if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function") {
            window.risqueReplayTryWriteDdJsonAfterSetupDeploy(gameState, { sealAfterWrite: true });
          }
          if (typeof window.risqueReplayPersistTapeSidecarImmediate === "function") {
            try {
              window.risqueReplayPersistTapeSidecarImmediate(gameState);
            } catch (eSideDep) {
              /* ignore */
            }
          }
          if (typeof window.risquePersistHostGameState === "function") {
            window.risquePersistHostGameState(gameState);
          } else {
            persistGameStateLite(gameState);
          }
          if (uiOverlay) uiOverlay.classList.remove("fade-out");
          setTimeout(function () {
            if (typeof window.risqueSetMirrorDeployRoute === "function") {
              window.risqueSetMirrorDeployRoute(null);
            }
            window.risqueDeploy1Active = false;
            navigateGameHtmlPreferSoft("game.html?phase=playerSelect&selectKind=cardPlay");
          }, 0);
        } catch (e) {
          console.warn("[Deploy] Failed to save game state.");
        }
        return;
      }
      currentPlayerIndex = (currentPlayerIndex + 1) % deploymentOrder.length;
      gameState.currentPlayer = deploymentOrder[currentPlayerIndex];
      keyboardBuffer = "";
      negativeInput = false;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      if (gameState.risqueDeployTransientPrimary) {
        delete gameState.risqueDeployTransientPrimary;
      }
      window.gameUtils.showError("");
      try {
        persistGameStateLite(gameState);
      } catch (e2) {
        console.warn("[Deploy] Failed to save game state.");
      }
      if (typeof window.risqueReplayRecordDeploy === "function") {
        window.risqueReplayRecordDeploy(gameState);
      }
      /* Handoff before the next deployer sees the map (streaming / hot-seat). */
      mountSetupDeployHandoff(gameState.currentPlayer, "next", function () {
        /* Redraw + mirror push BEFORE spectator focus: risqueSetSpectatorFocus pushes gameState and must see the new deployer’s window.deployedTroops (not the previous player’s). */
        renderMap(null);
        if (typeof window.risqueSetSpectatorFocus === "function") {
          window.risqueSetSpectatorFocus([]);
        }
        updateBankDisplay();
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
          window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        }
        if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
          requestAnimationFrame(function () {
            window.risqueRuntimeHud.syncPosition();
          });
        }
      }, logFn);
    });

    var deploy1Add2 = document.getElementById("deploy1-add-2");
    var deploy1Add5 = document.getElementById("deploy1-add-5");
    var deploy1Add10 = document.getElementById("deploy1-add-10");
    var deploy1AddAll = document.getElementById("deploy1-add-all");
    if (deploy1Add2) {
      deploy1Add2.addEventListener("click", function () {
        applyDeployFromBankSetup(2);
      });
    }
    if (deploy1Add5) {
      deploy1Add5.addEventListener("click", function () {
        applyDeployFromBankSetup(5);
      });
    }
    if (deploy1Add10) {
      deploy1Add10.addEventListener("click", function () {
        applyDeployFromBankSetup(10);
      });
    }
    if (deploy1AddAll) {
      deploy1AddAll.addEventListener("click", function () {
        applyBulkDeploySetup(0);
      });
    }
    var canvasWheel = document.getElementById("canvas");
    var svg = canvasWheel ? canvasWheel.querySelector(".svg-overlay") : null;
    if (svg) svg.addEventListener("wheel", onWheel, { passive: false });

    document.addEventListener("keydown", onKeyDown);

    window.gameUtils.initGameView();
    initializeDeployment();
    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
    });
  }

  /** Turn deploy: single player, then attack (classic or continental con-deploy when opts.continentalDeploy). */
  function mountTurnDeploy(host, opts) {
    opts = opts || {};
    var continentalDeploy = !!opts.continentalDeploy;
    var attackUrl = opts.attackUrl || "game.html?phase=attack";
    var conquestAfterDeployQuery = !!opts.conquestAfterDeploy || continentalDeploy;
    try {
      if (new URLSearchParams(window.location.search || "").get("conquestAfterDeploy") === "1") {
        conquestAfterDeployQuery = true;
      }
    } catch (eCq) {
      /* ignore */
    }

    injectDeployTurnStyles();

    if (!window.gameUtils) {
      console.error("[DeployTurn] gameUtils missing");
      return;
    }

    if (typeof window.risqueSetMirrorDeployRoute === "function") {
      window.risqueSetMirrorDeployRoute("turn");
    }

    var uiOverlay = document.getElementById("ui-overlay");
    var canvasDeploy = document.getElementById("canvas");
    var stageSvg = canvasDeploy ? canvasDeploy.querySelector(".svg-overlay") : null;
    if (!uiOverlay || !stageSvg) {
      console.warn("[Deploy] Missing ui overlay or svg overlay.");
      return;
    }

    var gameState = window.gameState;
    if (!gameState || !gameState.players || !gameState.currentPlayer) {
      console.warn("[Deploy] Invalid game state for deploy (turn).");
      setTimeout(function () {
        window.location.href = loginRecoveryHref();
      }, 2000);
      return;
    }

    if (continentalDeploy) {
      try {
        document.body.classList.remove("risque-con-cardplay-mounted");
        document.body.classList.remove("risque-con-income-mounted");
      } catch (eCl) {
        /* ignore */
      }
      try {
        document.body.classList.add("risque-con-deploy-mounted");
      } catch (eCd) {
        /* ignore */
      }
      if (gameState.phase === "con-income") {
        gameState.phase = "con-deploy";
        try {
          persistGameStateLite(gameState);
        } catch (ePh) {
          /* ignore */
        }
      }
      try {
        if (window.location.protocol !== "file:") {
          var paramsCd = new URLSearchParams(window.location.search);
          if (paramsCd.get("phase") !== "con-deploy") {
            paramsCd.set("phase", "con-deploy");
            var qsCd = paramsCd.toString();
            window.history.replaceState(
              null,
              "",
              window.location.pathname + (qsCd ? "?" + qsCd : "") + window.location.hash
            );
          }
        }
      } catch (eHcd) {
        /* ignore */
      }
    }

    if (!continentalDeploy && gameState.round === 1) {
      gameState.players.forEach(function (player) {
        if (player.cardCount > 1) {
          player.cardCount = 1;
          player.cards = player.cards.slice(0, 1);
        }
      });
    }

    /**
     * Classic turn deploy (income → deploy with no conquestAfterDeploy) must drop conquer-mode-only
     * cardplay/income flags. Otherwise stale risqueRuntimeCardplayIncomeMode + risqueConquestChainActive
     * from an old elimination/conquest session force con-income (books + “new” continents only) on the
     * next cardplay even during normal Risk turns.
     * Conquest deploy always uses ?conquestAfterDeploy=1 (see phases/income.js conquer income); keep flags until
     * con-transfertroops → attack or a later classic deploy clears them.
     */
    if (!conquestAfterDeployQuery && !window.risqueDisplayIsPublic) {
      var clearedConquestIncome = false;
      if (
        gameState.risqueRuntimeCardplayIncomeMode === "conquer" ||
        gameState.risqueRuntimeCardplayIncomeMode === "continental"
      ) {
        delete gameState.risqueRuntimeCardplayIncomeMode;
        clearedConquestIncome = true;
      }
      if (gameState.risqueConquestChainActive) {
        delete gameState.risqueConquestChainActive;
        clearedConquestIncome = true;
      }
      if (gameState.risqueConquestChainPaidContinents) {
        delete gameState.risqueConquestChainPaidContinents;
        clearedConquestIncome = true;
      }
      if (gameState.risqueConquestAttackEntryTurnKey != null || gameState.risqueConquestAttackEntryContinents) {
        delete gameState.risqueConquestAttackEntryTurnKey;
        delete gameState.risqueConquestAttackEntryContinents;
        if (window.gameUtils && typeof window.gameUtils.clearRisqueConquestAttackStartSession === "function") {
          window.gameUtils.clearRisqueConquestAttackStartSession();
        }
        delete gameState.risqueConquestStandardIncomeContinentKeysMeta;
        clearedConquestIncome = true;
      }
      if (clearedConquestIncome) {
        try {
          persistGameStateLite(gameState);
        } catch (eSavClr) {
          /* ignore */
        }
        if (typeof window.risqueHostReplaceShellGameState === "function") {
          window.risqueHostReplaceShellGameState(gameState);
        }
        if (typeof window.risquePersistHostGameState === "function") {
          window.risquePersistHostGameState();
        }
      }
    }

    var initialBankValues = {};
    var keyboardBuffer = "";
    var deployedTroops = {};
    var deploymentInitialized = false;

    function persistGameStateForPublicMirror() {
      try {
        if (window.gameState && !window.risqueDisplayIsPublic) {
          persistGameStateLite(window.gameState);
        }
      } catch (e0) {
        /* ignore */
      }
    }

    function pushDeployMirror() {
      if (typeof window.risquePersistHostGameState === "function") {
        window.risquePersistHostGameState();
      }
    }

    function updateDeployVoice(warnMessage) {
      if (!window.risqueRuntimeHud || typeof window.risqueRuntimeHud.setControlVoiceText !== "function") {
        return;
      }
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) return;
      var primary = player.name.toUpperCase() + "\nDEPLOY ALL TROOPS FROM YOUR BANK";
      if (warnMessage) {
        try {
          gameState.risquePublicDeployBanner =
            player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + String(warnMessage);
        } catch (eBanner1) {}
        window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + String(warnMessage), "");
        persistGameStateForPublicMirror();
        return;
      }
      if (typeof window.risqueRefreshDeployNarration === "function") {
        window.risqueRefreshDeployNarration(gameState);
        persistGameStateForPublicMirror();
        return;
      }
      var bank = Math.max(0, Number(player.bankValue) || 0);
      var r =
        bank === 0
          ? "0 troops remaining in bank — confirm when finished"
          : bank === 1
            ? "1 troop remaining in bank"
            : bank + " troops remaining in bank";
      try {
        gameState.risquePublicDeployBanner =
          player.name.toUpperCase() + " IS DEPLOYING TROOPS.\n\n" + r;
      } catch (eBanner2) {}
      window.risqueRuntimeHud.setControlVoiceText(primary + "\n\n" + r, "");
      persistGameStateForPublicMirror();
    }

    function updateBankDisplay() {
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      var bankNumber = document.getElementById("bank-number");
      if (bankNumber) {
        var v = player ? Number(player.bankValue) : 0;
        bankNumber.textContent = (v || 0).toString().padStart(3, "0");
      }
      refreshDeployProtectAllButton(
        document.getElementById("deploy-protect-all"),
        player,
        gameState
      );
      updateDeployVoice();
    }

    function updatePlayerNameDisplay() {
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (window.risqueRuntimeHud && document.getElementById("runtime-hud-root")) {
        window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        return;
      }
      var playerNameText = document.getElementById("player-name");
      if (playerNameText) {
        if (player) {
          playerNameText.innerHTML =
            player.name + '<span class="deploy-subline">is deploying</span>';
          playerNameText.style.color = window.gameUtils.colorMap[player.color] || "#000000";
        } else {
          playerNameText.textContent = "No Player";
          playerNameText.style.color = "#000000";
        }
      }
    }

    function initializeDeployment() {
      if (deploymentInitialized) return;

      var invalidPlayer = gameState.players.find(function (p) {
        return !p.territories || p.territories.length === 0;
      });
      if (invalidPlayer) {
        console.warn("[Deploy] Invalid game state: player has no territories.");
        setTimeout(function () {
          window.location.href = loginRecoveryHref();
        }, 2000);
        return;
      }

      var currentPlayer = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!currentPlayer) {
        console.warn("[Deploy] Current player not found.");
        setTimeout(function () {
          window.location.href = loginRecoveryHref();
        }, 2000);
        return;
      }

      initialBankValues = {};
      gameState.players.forEach(function (player) {
        initialBankValues[player.name] = Number(player.bankValue) || 0;
        var territoryTroops = (player.territories || []).reduce(function (sum, t) {
          return sum + (Number(t.troops) || 0);
        }, 0);
        player.troopsTotal = territoryTroops + (Number(player.bankValue) || 0);
      });

      deployedTroops = {};
      currentPlayer.territories.forEach(function (t) {
        deployedTroops[t.name] = 0;
      });

      window.deployedTroops = deployedTroops;
      window.viewTroopsActive = false;
      deploymentInitialized = true;

      gameState.phase = continentalDeploy ? "con-deploy" : "deploy";
      try {
        persistGameStateLite(gameState);
      } catch (e2) {
        /* ignore */
      }

      window.gameState = gameState;
      window.gameUtils.renderAll(gameState, null, deployedTroops);
      updatePlayerNameDisplay();
      updateBankDisplay();
      pushDeployMirror();
    }

    function rerender(changedLabel) {
      /* Match setup deploy (renderMap): full map + stats; never toggle viewTroopsActive — markers use deploy bump + satellite. */
      window.gameState = gameState;
      window.deployedTroops = deployedTroops;
      window.gameUtils.renderAll(gameState, changedLabel, deployedTroops);
      updateBankDisplay();
      pushDeployMirror();
    }

    /** Same idea as setup deploy: after phase leaves deploy, one redraw without bumps / satellites / white fill. */
    function clearTurnDeployChromeThenRedraw() {
      try {
        document.body.classList.remove("risque-con-deploy-mounted");
      } catch (eRmDep) {
        /* ignore */
      }
      window.gameState = gameState;
      window.selectedTerritory = null;
      window.viewTroopsActive = false;
      deployedTroops = {};
      window.deployedTroops = {};
      if (gameState.risqueDeployMirrorDraft) {
        delete gameState.risqueDeployMirrorDraft;
      }
      if (gameState.risqueDeployTransientPrimary) {
        delete gameState.risqueDeployTransientPrimary;
      }
      if (typeof window.risqueSetSpectatorFocus === "function") {
        window.risqueSetSpectatorFocus([]);
      }
      window.gameUtils.renderTerritories(null, gameState, {});
      window.gameUtils.renderStats(gameState);
    }

    function bindWheelAndKeyboardHandlers() {
      stageSvg.addEventListener(
        "wheel",
        function (e) {
          if (!window.selectedTerritory) {
            return;
          }

          e.preventDefault();

          var player = gameState.players.find(function (p) {
            return p.name === gameState.currentPlayer;
          });
          if (!player) return;

          var territory = player.territories.find(function (t) {
            return t.name === window.selectedTerritory;
          });
          if (!territory) {
            return;
          }

          var delta = e.deltaY > 0 ? -1 : 1;
          var newTroops = territory.troops + delta;
          var newDeployedTroops =
            (deployedTroops[territory.name] || 0) + delta;

          if (newTroops < 1) {
            return;
          }
          if (delta < 0 && newDeployedTroops < 0) {
            return;
          }
          if (delta > 0 && player.bankValue === 0) {
            window.gameUtils.showError("");
            updateDeployVoice("No troops left in bank.");
            return;
          }

          territory.troops = newTroops;
          player.bankValue -= delta;
          player.troopsTotal =
            player.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + Number(player.bankValue);

          deployedTroops[territory.name] = newDeployedTroops;
          window.deployedTroops = deployedTroops;
          keyboardBuffer = "";

          window.gameUtils.showError("");
          requestAnimationFrame(function () {
            rerender(window.selectedTerritory);
            if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
              window.risqueSetSpectatorFocus([window.selectedTerritory]);
            }
          });

          try {
            persistGameStateLite(gameState);
          } catch (e2) {
            /* ignore */
          }
        },
        { passive: false }
      );

      document.addEventListener("keydown", function (e) {
        if (!window.selectedTerritory) {
          return;
        }

        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) return;

        var territory = player.territories.find(function (t) {
          return t.name === window.selectedTerritory;
        });
        if (!territory) {
          return;
        }

        if (e.key === "Enter") {
          if (keyboardBuffer === "") return;

          var troops = parseInt(keyboardBuffer, 10);
          if (isNaN(troops) || troops === 0) {
            keyboardBuffer = "";
            return;
          }

          var troopChange = troops;
          var newTroops = territory.troops + troopChange;
          var newDeployedTroops =
            (deployedTroops[territory.name] || 0) + troopChange;

          if (newTroops < 1) {
            keyboardBuffer = "";
            return;
          }
          if (troopChange < 0 && newDeployedTroops < 0) {
            keyboardBuffer = "";
            return;
          }
          if (troopChange > player.bankValue) {
            window.gameUtils.showError("");
            updateDeployVoice(
              "Only " + player.bankValue + " troop" + (player.bankValue === 1 ? "" : "s") + " left in bank."
            );
            keyboardBuffer = "";
            return;
          }

          territory.troops = newTroops;
          player.bankValue -= troopChange;
          player.troopsTotal =
            player.territories.reduce(function (sum, t) {
              return sum + (Number(t.troops) || 0);
            }, 0) + Number(player.bankValue);

          deployedTroops[territory.name] = newDeployedTroops;
          window.deployedTroops = deployedTroops;
          var prettyT =
            window.gameUtils && window.gameUtils.formatTerritoryDisplayName
              ? window.gameUtils.formatTerritoryDisplayName(territory.name)
              : territory.name.replace(/_/g, " ");
          if (troopChange > 0) {
            gameState.risqueDeployTransientPrimary =
              player.name +
              " has deployed " +
              window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
              " troops to " +
              prettyT +
              ".";
          } else if (troopChange < 0) {
            gameState.risqueDeployTransientPrimary =
              player.name +
              " has removed " +
              window.risqueDeployTroopCountToWord(Math.abs(troopChange)) +
              " troops from " +
              prettyT +
              ".";
          }
          window.selectedTerritory = null;
          keyboardBuffer = "";
          window.gameUtils.showError("");

          requestAnimationFrame(function () {
            rerender(territory.name);
          });

          try {
            persistGameStateLite(gameState);
          } catch (e2) {
            /* ignore */
          }
        } else if (e.key >= "0" && e.key <= "9") {
          keyboardBuffer += e.key;
          if (keyboardBuffer.length > 3) {
            keyboardBuffer = keyboardBuffer.slice(0, -1);
          }
        }
      });
    }

    function deployInit() {
      var player = gameState.players.find(function (p) {
        return p.name === gameState.currentPlayer;
      });
      if (!player) {
        console.warn("[Deploy] Current player not found.");
        return;
      }

      var playerColor = window.gameUtils.colorMap[player.color] || "#000000";

      var useHud = !!window.risqueRuntimeHud;
      var deploySlotHtml = useHud
        ? '<div class="deploy2-compact-root">' +
          '<div class="deploy2-bank-row">' +
          '<span id="bank-label" class="deploy2-bank-label">Bank</span>' +
          '<span id="bank-number" class="deploy2-bank-number">000</span>' +
          "</div>" +
          '<p class="deploy2-hint">Select a territory. Scroll the wheel or type a number and press Enter. Use − for removals.</p>' +
          '<div class="deploy2-actions deploy1-deploy-actions deploy1-deploy-actions--hud-row">' +
          '<button type="button" id="reset" class="deploy1-action-btn" aria-label="Reset deployment">RESET</button>' +
          '<button type="button" id="deploy-add-2" class="deploy1-action-btn" aria-label="Add two troops from bank">+2</button>' +
          '<button type="button" id="deploy-add-5" class="deploy1-action-btn" aria-label="Add five troops from bank">+5</button>' +
          '<button type="button" id="deploy-add-10" class="deploy1-action-btn" aria-label="Add ten troops from bank">+10</button>' +
          '<button type="button" id="deploy-add-all" class="deploy1-action-btn" aria-label="Deploy all troops from bank to territory">ALL</button>' +
          deployBuildProtectAllControlHtml({
            button: "deploy-protect-all",
            menu: "deploy-protect-all-menu"
          }) +
          '<button type="button" id="confirm" class="deploy1-action-btn" aria-label="Confirm deployment">CONFIRM</button>' +
          "</div>" +
          "</div>"
        : '<div id="bank-label" class="bank-label">Bank</div>' +
          '<div id="bank-number" class="bank-number">000</div>' +
          '<button type="button" id="reset" class="deploy-button" style="left: 1152px; top: 768px; width: 704px; height: 64px;">Reset</button>' +
          '<button type="button" id="confirm" class="deploy-button" style="left: 1152px; top: 864px; width: 704px; height: 64px;">Confirm</button>';
      if (window.risqueRuntimeHud) {
        if (typeof window.risqueRuntimeHud.ensureSetupUnifiedHud === "function") {
          window.risqueRuntimeHud.ensureSetupUnifiedHud(uiOverlay, "", { force: true });
        } else {
          window.risqueRuntimeHud.ensure(uiOverlay);
        }
        window.risqueRuntimeHud.clearPhaseSlot();
        window.risqueRuntimeHud.setAttackChromeInteractive(false);
        window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
        var dSlot = document.getElementById("risque-phase-content");
        if (dSlot) dSlot.innerHTML = deploySlotHtml;
        if (gameState.risqueConquestChainActive || continentalDeploy) {
          var rhDep = document.getElementById("runtime-hud-root");
          if (rhDep) rhDep.classList.add("runtime-hud-root--cardplay-panel-only");
        }
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud) window.risqueRuntimeHud.syncPosition();
        });
      } else {
        uiOverlay.innerHTML =
          '<div id="player-name" class="deploy-player-name" style="color: ' +
          playerColor +
          '">' +
          player.name +
          '<span class="deploy-subline">is deploying</span>' +
          "</div>" +
          deploySlotHtml;
      }

      uiOverlay.classList.add("visible");
      uiOverlay.classList.remove("fade-out");

      if (!window.gameUtils.validateGameState(gameState)) {
        console.warn("[Deploy] Invalid game state.");
        return;
      }

      if (typeof window.risqueReplaySeedOpening === "function") {
        window.risqueReplaySeedOpening(gameState);
      }

      if (continentalDeploy && (player.bankValue || 0) === 0) {
        console.warn("[Deploy] Continental deploy: no troops in bank; routing to attack or transfer.");
        setTimeout(function () {
          var gs0 = window.gameState;
          if (gs0) delete gs0.risqueConquestIncomeBaselineLocked;
          if (gs0 && typeof window.gameUtils.ensureContinentsSnapshotBaseline === "function") {
            window.gameUtils.ensureContinentsSnapshotBaseline(gs0);
          }
          var needsT =
            gs0 &&
            gs0.conqueredThisTurn === true &&
            gs0.attackingTerritory &&
            gs0.acquiredTerritory &&
            (gs0.attackPhase === "pending_transfer" || gs0.risqueConquestChainActive === true);
          if (needsT) {
            gs0.phase = "con-transfertroops";
            gs0.risqueConquestTransferProceedTo = "attack";
            try {
              persistGameStateLite(gs0);
            } catch (e0) {
              /* ignore */
            }
            navigateGameHtmlPreferSoft("game.html?phase=con-transfertroops");
            return;
          }
          try {
            if (gs0) persistGameStateLite(gs0);
          } catch (e0b) {
            /* ignore */
          }
          navigateGameHtmlPreferSoft("game.html?phase=attack");
        }, 2000);
        return;
      }

      initializeDeployment();
      bindWheelAndKeyboardHandlers();

      var confirmButton = document.getElementById("confirm");
      var resetButton = document.getElementById("reset");

      if (!confirmButton || !resetButton) {
        console.warn("[Deploy] Missing critical DOM elements.");
        return;
      }

      resetButton.addEventListener("click", function () {
        var p = gameState.players.find(function (x) {
          return x.name === gameState.currentPlayer;
        });
        if (!p) return;

        p.bankValue = initialBankValues[p.name] || 0;
        p.territories.forEach(function (t) {
          var initialTroops = t.troops - (deployedTroops[t.name] || 0);
          t.troops = initialTroops > 0 ? initialTroops : 1;
        });
        p.troopsTotal =
          p.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(p.bankValue);

        deployedTroops = {};
        window.deployedTroops = deployedTroops;
        p.territories.forEach(function (t) {
          deployedTroops[t.name] = 0;
        });

        window.selectedTerritory = null;
        window.viewTroopsActive = false;
        keyboardBuffer = "";
        window.gameUtils.showError("");

        requestAnimationFrame(function () {
          window.gameState = gameState;
          window.deployedTroops = deployedTroops;
          window.gameUtils.renderAll(gameState, null, deployedTroops);
          updateBankDisplay();
        });

        try {
          persistGameStateLite(gameState);
        } catch (e2) {
          /* ignore */
        }
        pushDeployMirror();
      });

      function applyBulkDeployTurn(leaveInBank) {
        leaveInBank = Math.max(0, Math.floor(Number(leaveInBank) || 0));
        if (!gameState || !window.selectedTerritory) {
          return;
        }
        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) return;
        var territory = player.territories.find(function (t) {
          return t.name === window.selectedTerritory;
        });
        if (!territory) return;
        var bank = Math.max(0, Number(player.bankValue) || 0);
        var toAdd = bank - leaveInBank;
        if (toAdd <= 0) {
          window.gameUtils.showError("");
          updateDeployVoice(
            bank <= leaveInBank
              ? "Not enough in bank to leave " + leaveInBank + " behind."
              : ""
          );
          return;
        }
        var newTroops = territory.troops + toAdd;
        var newDeployedTroops = (deployedTroops[territory.name] || 0) + toAdd;
        if (newTroops < 1) {
          return;
        }
        var destBeforeBulk = Number(territory.troops || 0);
        territory.troops = newTroops;
        player.bankValue -= toAdd;
        player.troopsTotal =
          player.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(player.bankValue);
        deployedTroops[territory.name] = newDeployedTroops;
        window.deployedTroops = deployedTroops;
        keyboardBuffer = "";
        window.gameUtils.showError("");
        requestAnimationFrame(function () {
          rerender(window.selectedTerritory);
          if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
            window.risqueSetSpectatorFocus([window.selectedTerritory]);
          }
        });
        try {
          persistGameStateLite(gameState);
        } catch (e2) {
          /* ignore */
        }
        try {
          gameState.risqueTransferPulse = {
            label: territory.name,
            fromTroops: destBeforeBulk,
            toTroops: newTroops,
            startMs: Date.now(),
            durationMs: 1000
          };
          if (window.gameUtils && typeof window.gameUtils.risqueStartTransferPulseTicker === "function") {
            window.gameUtils.risqueStartTransferPulseTicker();
          }
        } catch (ePulseBulk) {
          /* ignore */
        }
        pushDeployMirror();
      }

      function applyProtectAllTurn(scopeContinentKey) {
        if (!gameState) {
          return;
        }
        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) {
          return;
        }
        var targets = deployCollectProtectTargetsOrdered(gameState, player, scopeContinentKey);
        var hadTargets = targets.length > 0;
        if (!hadTargets) {
          window.gameUtils.showError("");
          updateDeployVoice(deployProtectAllVoiceMessage({ totalDeployed: 0 }, false));
          return;
        }
        var bankBefore = Math.max(0, Number(player.bankValue) || 0);
        if (bankBefore <= 0) {
          window.gameUtils.showError("");
          updateDeployVoice("No troops left in bank.");
          return;
        }
        var result = deployApplyProtectAllFromBank(targets, bankBefore, function (territory, add) {
          territory.troops += add;
          player.bankValue -= add;
          deployedTroops[territory.name] = (deployedTroops[territory.name] || 0) + add;
        });
        if (result.totalDeployed <= 0) {
          window.gameUtils.showError("");
          updateDeployVoice("No troops left in bank.");
          return;
        }
        if (deployProtectAllFailedToComplete(result, hadTargets)) {
          window.gameUtils.showError(DEPLOY_PROTECT_ALL_EXHAUSTED_MSG);
        } else {
          window.gameUtils.showError("");
        }
        player.troopsTotal =
          player.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(player.bankValue);
        window.deployedTroops = deployedTroops;
        var voiceMsg = deployProtectAllVoiceMessage(result, true);
        if (deployProtectAllFailedToComplete(result, hadTargets)) {
          voiceMsg = DEPLOY_PROTECT_ALL_EXHAUSTED_MSG;
        }
        console.log("[DeployTurn] PROTECT ALL: " + voiceMsg);
        try {
          gameState.risqueDeployTransientPrimary =
            player.name +
            " deployed troops to protect owned territories (target " +
            RISQUE_DEPLOY_PROTECT_TROOPS +
            " each).";
        } catch (eTr2) {
          /* ignore */
        }
        window.selectedTerritory = null;
        keyboardBuffer = "";
        if (!deployProtectAllFailedToComplete(result, hadTargets)) {
          window.gameUtils.showError("");
        }
        try {
          persistGameStateLite(gameState);
        } catch (ePa) {
          /* ignore */
        }
        pushDeployMirror();
        requestAnimationFrame(function () {
          rerender(null);
          if (typeof window.risqueSetSpectatorFocus === "function") {
            window.risqueSetSpectatorFocus([]);
          }
          updateDeployVoice(voiceMsg);
        });
      }

      /** Add N troops from bank to selected territory (host HUD +2 / +5 / +10). */
      function applyDeployFromBank(troopChange) {
        troopChange = Math.floor(Number(troopChange) || 0);
        if (troopChange <= 0) return;
        if (!window.selectedTerritory) {
          return;
        }
        var player = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!player) return;
        var territory = player.territories.find(function (t) {
          return t.name === window.selectedTerritory;
        });
        if (!territory) {
          return;
        }
        var newTroops = territory.troops + troopChange;
        var newDeployedTroops = (deployedTroops[territory.name] || 0) + troopChange;
        if (newTroops < 1) {
          return;
        }
        if (troopChange > player.bankValue) {
          window.gameUtils.showError("");
          updateDeployVoice(
            "Only " +
              player.bankValue +
              " troop" +
              (player.bankValue === 1 ? "" : "s") +
              " left in bank."
          );
          return;
        }
        var destBeforeDeploy = Number(territory.troops || 0);
        territory.troops = newTroops;
        player.bankValue -= troopChange;
        player.troopsTotal =
          player.territories.reduce(function (sum, t) {
            return sum + (Number(t.troops) || 0);
          }, 0) + Number(player.bankValue);
        deployedTroops[territory.name] = newDeployedTroops;
        window.deployedTroops = deployedTroops;
        keyboardBuffer = "";
        window.gameUtils.showError("");
        var prettyT =
          window.gameUtils && window.gameUtils.formatTerritoryDisplayName
            ? window.gameUtils.formatTerritoryDisplayName(territory.name)
            : territory.name.replace(/_/g, " ");
        gameState.risqueDeployTransientPrimary =
          player.name +
          " has deployed " +
          window.risqueDeployTroopCountToWord(troopChange) +
          " troops to " +
          prettyT +
          ".";
        requestAnimationFrame(function () {
          rerender(window.selectedTerritory);
          if (typeof window.risqueSetSpectatorFocus === "function" && window.selectedTerritory) {
            window.risqueSetSpectatorFocus([window.selectedTerritory]);
          }
        });
        try {
          persistGameStateLite(gameState);
        } catch (e2) {
          /* ignore */
        }
        try {
          gameState.risqueTransferPulse = {
            label: territory.name,
            fromTroops: destBeforeDeploy,
            toTroops: newTroops,
            startMs: Date.now(),
            durationMs: 1000
          };
          if (window.gameUtils && typeof window.gameUtils.risqueStartTransferPulseTicker === "function") {
            window.gameUtils.risqueStartTransferPulseTicker();
          }
        } catch (ePulseDep) {
          /* ignore */
        }
        pushDeployMirror();
      }

      var deployAdd2 = document.getElementById("deploy-add-2");
      var deployAdd5 = document.getElementById("deploy-add-5");
      var deployAdd10 = document.getElementById("deploy-add-10");
      var deployAddAll = document.getElementById("deploy-add-all");
      if (deployAdd2) {
        deployAdd2.addEventListener("click", function () {
          applyDeployFromBank(2);
        });
      }
      if (deployAdd5) {
        deployAdd5.addEventListener("click", function () {
          applyDeployFromBank(5);
        });
      }
      if (deployAdd10) {
        deployAdd10.addEventListener("click", function () {
          applyDeployFromBank(10);
        });
      }
      if (deployAddAll) {
        deployAddAll.addEventListener("click", function () {
          applyBulkDeployTurn(0);
        });
      }
      deployWireProtectAllControl({
        wrapSelector: ".deploy-protect-all-wrap",
        buttonId: "deploy-protect-all",
        menuId: "deploy-protect-all-menu",
        getGameState: function () {
          return gameState;
        },
        getPlayer: function () {
          return gameState.players.find(function (p) {
            return p.name === gameState.currentPlayer;
          });
        },
        applyScope: function (scopeKey) {
          applyProtectAllTurn(scopeKey);
        }
      });

      window.risqueGetAuxMouseMenu = function () {
        var phDep = String(gameState.phase || "");
        if (
          window.risqueDeploy1Active ||
          (phDep !== "deploy" && phDep !== "con-deploy")
        ) {
          return null;
        }
        return {
          title: "Deployment",
          hint: window.selectedTerritory
            ? "Thumb-button menu — or keep using the wheel on the map."
            : "Select a territory on the map first.",
          anchor: true,
          actions: [
            {
              label: "Confirm",
              action: function () {
                confirmButton.click();
              }
            },
            { label: "Cancel", action: function () {} },
            {
              label: "Put all but 1 in bank on territory",
              action: function () {
                applyBulkDeployTurn(1);
              }
            },
            {
              label: "Put all but 3 in bank on territory",
              action: function () {
                applyBulkDeployTurn(3);
              }
            },
            {
              label: "Protect all territories (to 3)",
              action: function () {
                applyProtectAllTurn("all");
              }
            },
            {
              label: "Reset",
              action: function () {
                resetButton.click();
              }
            }
          ]
        };
      };

      confirmButton.addEventListener("click", function () {
        var p = gameState.players.find(function (x) {
          return x.name === gameState.currentPlayer;
        });
        if (!p) return;
        if (p.bankValue > 0) {
          window.gameUtils.showError("");
          updateDeployVoice("Deploy every troop from your bank before confirming.");
          return;
        }

        if (continentalDeploy) {
          delete gameState.risqueConquestIncomeBaselineLocked;
          if (typeof window.gameUtils.ensureContinentsSnapshotBaseline === "function") {
            window.gameUtils.ensureContinentsSnapshotBaseline(gameState);
          }
        }

        p.troopsTotal = p.territories.reduce(function (sum, t) {
          return sum + (Number(t.troops) || 0);
        }, 0);

        var needsFinishConquestTransfer =
          (conquestAfterDeployQuery || gameState.risqueConquestChainActive) &&
          gameState.conqueredThisTurn === true &&
          gameState.attackingTerritory &&
          gameState.acquiredTerritory &&
          (gameState.attackPhase === "pending_transfer" || gameState.risqueConquestChainActive === true);

        if (needsFinishConquestTransfer) {
          try {
            gameState.phase = "con-transfertroops";
            gameState.risqueConquestTransferProceedTo = "attack";
            clearTurnDeployChromeThenRedraw();
            if (typeof window.risqueReplayRecordDeploy === "function") {
              window.risqueReplayRecordDeploy(gameState);
            }
            persistGameStateLite(gameState);
            pushDeployMirror();
            if (typeof window.risqueHostReplaceShellGameState === "function") {
              window.risqueHostReplaceShellGameState(gameState);
            }
            if (uiOverlay) uiOverlay.classList.remove("fade-out");
            setTimeout(function () {
              if (typeof window.risqueSetMirrorDeployRoute === "function") {
                window.risqueSetMirrorDeployRoute(null);
              }
              var destT = "game.html?phase=con-transfertroops";
              if (window.risqueNavigateWithFade) {
                window.risqueNavigateWithFade(destT);
              } else {
                window.location.href = destT;
              }
            }, 0);
          } catch (eCt) {
            console.warn("[Deploy] Failed to save game state.");
          }
          return;
        }

        try {
          gameState.phase = "attack";
          clearTurnDeployChromeThenRedraw();
          if (typeof window.risqueReplayRecordDeploy === "function") {
            window.risqueReplayRecordDeploy(gameState);
          }
          if (typeof window.risqueCheapReplayCaptureTurnDeployDone === "function") {
            try {
              window.risqueCheapReplayCaptureTurnDeployDone(gameState);
            } catch (eTdd) {
              /* ignore */
            }
          }
          persistGameStateLite(gameState);
          pushDeployMirror();
          if (typeof window.risqueHostReplaceShellGameState === "function") {
            window.risqueHostReplaceShellGameState(gameState);
          }
          if (uiOverlay) uiOverlay.classList.remove("fade-out");
          setTimeout(function () {
            if (typeof window.risqueSetMirrorDeployRoute === "function") {
              window.risqueSetMirrorDeployRoute(null);
            }
            var dest = attackUrl;
            /* Old bookmarked attack.html; attack phase is game.html?phase=attack */
            if (typeof dest === "string" && dest.indexOf("attack.html") !== -1) {
              dest = "game.html?phase=attack";
            }
            navigateGameHtmlPreferSoft(dest);
          }, 0);
        } catch (e) {
          console.warn("[Deploy] Failed to save game state.");
        }
      });
    }

    deployInit();
    try {
      if (typeof opts.onLog === "function") {
        opts.onLog("Deploy turn mount complete", {
          phase: gameState && gameState.phase,
          continentalDeploy: continentalDeploy
        });
      }
    } catch (eLm) {
      /* ignore */
    }
    requestAnimationFrame(function () {
      if (window.gameUtils && window.gameUtils.resizeCanvas) {
        window.gameUtils.resizeCanvas();
      }
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.deploy1 = { run: runSetupDeploy };
  window.risquePhases.deploy2 = { mount: mountTurnDeploy };
  window.risquePhases.deploy = {
    runSetup: runSetupDeploy,
    runTurn: mountTurnDeploy,
    /** Continental conquer chain after con-income (?phase=con-deploy). */
    runContinentalDeploy: function (host, opts) {
      opts = opts || {};
      opts.continentalDeploy = true;
      opts.conquestAfterDeploy = true;
      mountTurnDeploy(host, opts);
    },
    deployKindFromPhase: function (ph) {
      var s = String(ph || "").trim();
      if (s === "deploy1") return "setup";
      if (s === "deploy2") return "turn";
      return null;
    }
  };
})();
