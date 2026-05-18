// attack.js - Full refactored and cleaned attack phase logic
// Primary UI: game.html ?phase=attack — risquePhases.attack.mount (below) → initAttackPhase.
// Optional bookmarked URLs ending in /attack.html still call initAttackPhase below (same as game.html ?phase=attack).
// All functionality is preserved exactly, visuals remain pixel-perfect, code is now organized and maintainable

function risqueAttackDoc(name) {
  if (typeof window.risqueResolveDocUrl === "function") {
    return window.risqueResolveDocUrl(name);
  }
  return name === "win" ? "win.html" : name === "conquer" ? "game.html?phase=conquer" : "";
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

let attacker = null;
let defender = null;
let isPausableBlitzActive = false;
let isPausableBlitzPaused = false;
/** @deprecated use pausableBlitzGapTimer — kept clear for legacy cancelAttack paths */
let pausableBlitzInterval = null;
/** Between-round delay after dice reveal (matches single-roll spin cadence). */
let pausableBlitzGapTimer = null;
/** Reveal callback after {@link startDiceSpinForSnap} (must clear on pause/stop). */
let pausableBlitzRevealTimer = null;
/** Attacking-stack floor: COND blitz stops when troops on the attacking territory ≤ this value (stop-at number). */
let pausableBlitzCondThreshold = null;
/** Pending COND prep after "Confirmed" (Instant / COND or Pause / COND). */
let pendingConditionalThreshold = null;
/** Pausable blitz interval and PAUSE campaign combat-round cadence (public TV sync). */
const PAUSABLE_BLITZ_MS = 1000;
/** Dice “spin” duration before reveal in pausable blitz (matches desired TV/readability beat). */
const PAUSABLE_BLITZ_SPIN_MS = 1000;
/** Pause after reveal before the next pausable-blitz round (independent of spin length). */
const PAUSABLE_BLITZ_GAP_AFTER_REVEAL_MS = 1000;
/** Instant Blitz / Campaign Instant / Instant COND: ms between combat rounds (~4/sec) for troop-loss flash readability. */
const INSTANT_COMBAT_MS_PER_ROUND = 250;

function instantCombatRoundDelay() {
  return new Promise(function (resolve) {
    setTimeout(resolve, INSTANT_COMBAT_MS_PER_ROUND);
  });
}
/** Clears mirrored `risqueBattleLossFlashLabels` after one-shot territory halo */
let battleLossFlashClearTimer = null;
/** Single-roll UI: clear before a new roll or cancel so stale timeouts cannot desync dice vs outcome. */
let singleRollRevealTimer = null;

function clearSingleRollRevealTimer() {
  if (singleRollRevealTimer) {
    clearTimeout(singleRollRevealTimer);
    singleRollRevealTimer = null;
  }
}
/** PAUSE campaign: timed rounds like pausable blitz (shared cadence with PAUSABLE_BLITZ_MS). */
let pauseCampaignInterval = null;
let isPauseCampaignRunning = false;
let pauseCampaignHopI = 0;
let pauseCampaignOutcomes = [];
let pauseCampaignStopped = null;
/** Territory id for public TV "halted in …" / mirror (Campaign Step pause chain). */
let pauseCampaignMirrorStopLabel = null;
let pauseCampaignLeaveBehind = 1;
let pauseCampaignRoundsThisHop = 0;
/** After a capture, wait this long before the next hop's first roll (same as round cadence). */
let pauseCampaignBetweenHopsTimer = null;
/** User paused Campaign Step — round timer stopped until resume. */
let isPauseCampaignPaused = false;
/** Pause hit during between-hop delay — resume calls {@link pauseCampaignBeginNextHopOrFinish}. */
let pauseCampaignPausedBetweenHops = false;

window.risqueAttackStepControlsShouldStayActive = function risqueAttackStepControlsShouldStayActive() {
  return (
    Boolean(isPausableBlitzActive || isPausableBlitzPaused) ||
    Boolean(isPauseCampaignRunning || isPauseCampaignPaused)
  );
};

function risqueStartPostTransferDestinationPulse(destLabel, fromTroops, toTroops) {
  if (!window.gameState || !destLabel) return;
  window.gameState.risqueTransferPulse = {
    label: destLabel,
    fromTroops: fromTroops,
    toTroops: toTroops,
    startMs: Date.now(),
    durationMs: 1000
  };
  if (window.gameUtils && typeof window.gameUtils.risqueStartTransferPulseTicker === 'function') {
    window.gameUtils.risqueStartTransferPulseTicker();
  }
}

function risqueTransferPulseEnabledForCurrentMode(opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  if (opts.disableTransferPulse) return false;
  /* Keep transfer instant in Blitz Instant and Campaign Instant modes. */
  if (window.gameState && window.gameState.risqueInstantBlitzTransferUi) return false;
  if (campaignMode === 'path' && campaignType === 'instant') return false;
  return true;
}
let isAcquiring = false;
let troopsToTransfer = 0;
let minTroopsToTransfer = 0;
let maxTroopsToTransfer = 0;
let acquiredTerritory = null;
/** After eliminating a defender, defer conquer celebration until post-capture troop transfer CONFIRM. */
let risqueDeferredEliminationConquerPrompt = null;
let hasAttacked = false;
let attackerDice = 0;
let isAerialAttackEnabled = false;
let aerialBridge = null;

/** @returns {{ source: string, target: string } | null} */
function aerialBridgeFromGameState(gs) {
  if (!gs) return null;
  const p = gs.risqueAerialLinkPending;
  if (p && typeof p === 'object' && p.source && p.target) return p;
  const a = gs.aerialAttack;
  if (a && typeof a === 'object' && a.source && a.target) return a;
  return null;
}

/**
 * A committed (final) link for this turn — excludes `risqueAerialLinkPending` preview rows.
 * @returns {{ source: string, target: string } | null}
 */
function committedAerialLinkForThisTurn() {
  if (window.gameState && window.gameState.risqueAerialLinkPending) {
    return null;
  }
  const a = window.gameState && window.gameState.aerialAttack;
  if (a && typeof a === 'object' && a.source && a.target) {
    return { source: String(a.source), target: String(a.target) };
  }
  if (aerialBridge && aerialBridge.source && aerialBridge.target) {
    return { source: String(aerialBridge.source), target: String(aerialBridge.target) };
  }
  return null;
}
let isSelectingAerialSource = false;
let isSelectingAerialTarget = false;
/** After source+target are picked, the link is not final until the player hits Confirm. */
let isAwaitingAerialConfirm = false;
let aerialPendingPreview = null;
/** If a committed link existed in state when we opened the preview, restore it on Back. */
let aerialSnapshotBeforePreview = null;
let attackerInitialTroops = 0;
let transferCompleted = false;
/** Document capture listener so wheel works over the map, not only on #troops-input (reinforce-style). */
let attackTroopTransferWheelHandler = null;

/** Abort prior attack control listeners when game.html remounts attack (soft nav); avoids stacking handlers on document + toolbar. */
let __risqueAttackControlsAbort = null;

function teardownAttackPhaseControlListeners() {
  if (__risqueAttackControlsAbort) {
    try {
      __risqueAttackControlsAbort.abort();
    } catch (eAb) {
      /* ignore */
    }
    __risqueAttackControlsAbort = null;
  }
}

function teardownAttackTroopTransferWheel() {
  if (attackTroopTransferWheelHandler) {
    document.removeEventListener('wheel', attackTroopTransferWheelHandler, { capture: true });
    attackTroopTransferWheelHandler = null;
  }
}

function setupAttackTroopTransferWheel() {
  teardownAttackTroopTransferWheel();
  attackTroopTransferWheelHandler = function (e) {
    if (!window.gameState || window.gameState.attackPhase !== 'pending_transfer') return;
    const input = document.getElementById('troops-input');
    if (!input || input.disabled) return;
    const tMin = parseInt(input.getAttribute('min'), 10);
    const tMax = parseInt(input.getAttribute('max'), 10);
    if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return;
    e.preventDefault();
    const cur = parseInt(input.value, 10);
    const safeCur = Number.isFinite(cur) ? cur : tMin;
    const delta = e.deltaY < 0 ? 1 : -1;
    const v = Math.max(tMin, Math.min(tMax, safeCur + delta));
    if (v === safeCur) return;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.addEventListener('wheel', attackTroopTransferWheelHandler, { passive: false, capture: true });
}

/** null | 'start' | 'path' | 'armed' — campaign war-path planning / ready-to-run */
let campaignMode = null;
/** null | 'instant' | 'pause' | 'cond' */
let campaignType = null;
/** When {@link campaignType} is 'cond', true if started from Campaign Step row (vs Instant / COND). */
let campaignCondFromPauseRow = false;
/** Stop-at troop count on attacker for Campaign Step with conditions (mirrors Blitz Step Con). */
let campaignCondThreshold = null;
let campaignPath = [];
let campaignPendingStart = null;
/** Set when BEGIN runs; transfer UI pre-fills garrison until CLR / REINF */
let attackChainFromCampaign = false;
/** Leave this many troops on the attacking territory when confirming each capture (1 or 3) */
let campaignPreferredGarrison = 1;
/** Snapshot of path at COMMIT — used to run INSTANT campaign */
let campaignCommittedPath = [];
/** Last INSTANT run summary (for remounting voice UI without re-running combat) */
let campaignInstantLastOutcomes = [];
let campaignInstantLastStopped = null;
/** Troops to leave on the source territory after each capture in INSTANT campaign (1–99) */
let instantCampaignGarrison = 1;
/** Q CAMP dev shortcut: instant campaign planning + silent finish (leave 1, transfer all rest each hop). */
let campaignQDevMode = false;
/** @type {{ t: number, msg: string, data?: * }[]} */
window.risqueCampaignTroubleshootLog = window.risqueCampaignTroubleshootLog || [];

/**
 * Attack toolbar: two six-slot rows above control voice. Row 1 = roll/blitz/campaign/clear + stacked aerial or Q blitz;
 * row 2 = Q camp + cond threshold. Shared by runtime HUD and attack fallback mount.
 * @param {{ includeReinforceInStrip?: boolean }} opts
 */
function buildAttackToolbarStripButtonsInnerHtml(opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  const blitzDropdown =
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
    '</div>';
  const campaignDropdown =
    '<div class="attack-campaign-wrap">' +
    '<button id="campaign" class="attack-ctl-btn attack-ctl-campaign" type="button" title="Open campaign options" aria-expanded="false" aria-haspopup="true">CAMP ▾</button>' +
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
    '</div>';
  void opts;
  return (
    '<div class="attack-toolbar-row--6 attack-toolbar-row--primary">' +
    '<button id="roll" class="attack-ctl-btn attack-ctl-roll" type="button" title="Single roll">ROLL</button>' +
    blitzDropdown +
    campaignDropdown +
    '<button id="new-attack" class="attack-ctl-btn attack-ctl-new" type="button" title="Cancel all attacks">CLR</button>' +
    '<button id="aerial-attack" class="attack-ctl-btn attack-ctl-aerial" type="button" title="First aerial bridge (wildcard)">AERIAL1</button>' +
    '<button id="aerial-attack-2" class="attack-ctl-btn attack-ctl-aerial" type="button" title="Second aerial bridge (wildcard)">AERIAL2</button>' +
    '</div>'
  );
}
window.buildAttackToolbarStripButtonsInnerHtml = buildAttackToolbarStripButtonsInnerHtml;

function buildAttackDevRowInnerHtml() {
  return (
    '<div class="ucp-slot-strip-buttons attack-dev-row-buttons">' +
    '<button type="button" class="attack-ctl-btn attack-ctl-dev-label" id="attack-dev-row-label" disabled tabindex="-1" aria-disabled="true" title="Developer controls row">DEV ROW</button>' +
    '<button id="q-blitz-l3" class="attack-ctl-btn attack-ctl-qdev" type="button" title="Instant blitz, then leave 3 troops on the attacking territory" hidden aria-hidden="true">Q BLITZ L3</button>' +
    '<button id="q-blitz-t3" class="attack-ctl-btn attack-ctl-qdev" type="button" title="Instant blitz, then move up to 3 troops onto the capture" hidden aria-hidden="true">Q BLITZ T3</button>' +
    '<button id="q-camp" class="attack-ctl-btn attack-ctl-qdev" type="button" title="Plan campaign on map (leave 1 each capture), then Confirm to start">Q CAMP</button>' +
    '</div>' +
    '<div class="ucp-slot-strip-num-wrap attack-dev-row-cond">' +
    '<input id="cond-threshold" class="ucp-slot-strip-number" type="number" min="0" value="0" title="Stop blitz when your troops on the attacking territory reach this number (0 = default 5)" aria-label="Conditional blitz stop-at troop count on attacker" />' +
    '</div>'
  );
}
window.buildAttackDevRowInnerHtml = buildAttackDevRowInnerHtml;

const elements = {};

function cacheElements() {
  elements.playerName = document.getElementById('attack-player-name');
  elements.roll = document.getElementById('roll');
  elements.blitz = document.getElementById('blitz');
  elements.blitzDropdown = document.getElementById('blitz-dropdown');
  elements.blitzWrap = document.querySelector('.attack-blitz-wrap');
  elements.condThreshold = document.getElementById('cond-threshold');
  elements.pausableBlitz = document.getElementById('pausable-blitz');
  elements.pausableBlitzText = document.getElementById('pausable-blitz-text');
  elements.attackStepCtlWrap = document.getElementById('attack-step-ctl-wrap');
  elements.attackStepPauseBtn = document.getElementById('attack-step-pause-btn');
  elements.attackStepCancelBtn = document.getElementById('attack-step-cancel-btn');
  elements.campaign = document.getElementById('campaign');
  elements.campaignDropdown = document.getElementById('campaign-dropdown');
  elements.campaignWrap = document.querySelector('.attack-campaign-wrap');
  elements.newAttack = document.getElementById('new-attack');
  elements.qBlitzL3 = document.getElementById('q-blitz-l3');
  elements.qBlitzT3 = document.getElementById('q-blitz-t3');
  elements.qCamp = document.getElementById('q-camp');
  elements.reinforce = document.getElementById('reinforce');
  elements.aerialAttack = document.getElementById('aerial-attack');
  elements.aerialAttack2 = document.getElementById('aerial-attack-2');
  elements.logText = document.getElementById('log-text');
  elements.attackerPanelName = document.getElementById('attacker-panel-name');
  elements.defenderPanelName = document.getElementById('defender-panel-name');
  elements.aerialBridgeGroup = document.getElementById('aerial-bridge-group');
  elements.uiOverlay = document.getElementById('ui-overlay');

  for (let i = 0; i < 3; i++) {
    elements[`attackerDice${i}`] = document.getElementById(`attacker-dice-${i}`);
    elements[`attackerDiceText${i}`] = document.getElementById(`attacker-dice-text-${i}`);
  }
  for (let i = 0; i < 2; i++) {
    elements[`defenderDice${i}`] = document.getElementById(`defender-dice-${i}`);
    elements[`defenderDiceText${i}`] = document.getElementById(`defender-dice-text-${i}`);
  }
}

function closeBlitzDropdown() {
  const dd = elements.blitzDropdown || document.getElementById('blitz-dropdown');
  const btn = elements.blitz || document.getElementById('blitz');
  if (dd) {
    dd.hidden = true;
    dd.querySelectorAll('.attack-menu-row--open').forEach(r => r.classList.remove('attack-menu-row--open'));
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function closeCampaignDropdown() {
  const dd = elements.campaignDropdown || document.getElementById('campaign-dropdown');
  const btn = elements.campaign || document.getElementById('campaign');
  if (dd) {
    dd.hidden = true;
    dd.classList.remove('attack-campaign-dropdown--needs-choice');
    dd.querySelectorAll('.attack-menu-row--open').forEach(r => r.classList.remove('attack-menu-row--open'));
  }
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleBlitzDropdown(ev) {
  if (ev) ev.stopPropagation();
  const dd = elements.blitzDropdown;
  if (!dd) return;
  const opening = dd.hidden;
  dd.hidden = !opening;
  if (elements.blitz) elements.blitz.setAttribute('aria-expanded', opening ? 'true' : 'false');
}

function toggleCampaignDropdown(ev) {
  if (ev) ev.stopPropagation();
  const dd = elements.campaignDropdown;
  if (!dd) return;
  const opening = dd.hidden;
  dd.hidden = !opening;
  dd.classList.toggle('attack-campaign-dropdown--needs-choice', opening);
  if (elements.campaign) elements.campaign.setAttribute('aria-expanded', opening ? 'true' : 'false');
}

function updateAttackStepPauseButtonLabel() {
  if (!elements.attackStepPauseBtn) return;
  let showResume = false;
  if (isPauseCampaignRunning) {
    showResume = isPauseCampaignPaused;
  } else if (isPausableBlitzActive || isPausableBlitzPaused) {
    showResume = isPausableBlitzPaused;
  }
  elements.attackStepPauseBtn.textContent = showResume ? 'RESUME' : 'PAUSE';
  elements.attackStepPauseBtn.setAttribute('aria-label', showResume ? 'Resume step' : 'Pause step');
}

function syncAttackStepControlsVisibility() {
  if (elements.pausableBlitz) {
    elements.pausableBlitz.style.display = 'none';
  }
  const show =
    isPausableBlitzActive ||
    isPausableBlitzPaused ||
    isPauseCampaignRunning ||
    isPauseCampaignPaused;
  if (elements.attackStepCtlWrap) {
    if (show) {
      elements.attackStepCtlWrap.removeAttribute('hidden');
    } else {
      elements.attackStepCtlWrap.setAttribute('hidden', 'hidden');
    }
  }
  updateAttackStepPauseButtonLabel();
  if (
    show &&
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.repairAttackStepChromeButtons === 'function'
  ) {
    window.risqueRuntimeHud.repairAttackStepChromeButtons();
  }
}

function syncPausableBlitzButtonVisibility() {
  syncAttackStepControlsVisibility();
}

function attackStepPauseClick() {
  if (isPauseCampaignRunning) {
    toggleCampaignStepPause();
    return;
  }
  pausableBlitz();
  syncAttackStepControlsVisibility();
}

function clearBattleLossFlashNow() {
  if (battleLossFlashClearTimer) {
    clearTimeout(battleLossFlashClearTimer);
    battleLossFlashClearTimer = null;
  }
  const had = !!(window.gameState && window.gameState.risqueBattleLossFlashLabels);
  if (window.gameState && window.gameState.risqueBattleLossFlashLabels) {
    delete window.gameState.risqueBattleLossFlashLabels;
  }
  if (had && typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function scheduleBattleLossFlashClear() {
  if (battleLossFlashClearTimer) clearTimeout(battleLossFlashClearTimer);
  battleLossFlashClearTimer = setTimeout(() => {
    battleLossFlashClearTimer = null;
    clearBattleLossFlashNow();
    if (window.gameUtils && typeof window.gameUtils.renderTerritories === 'function') {
      window.gameUtils.renderTerritories(null, window.gameState);
    }
  }, 1200);
}

function clearPauseCampaignBetweenHopsTimer() {
  if (pauseCampaignBetweenHopsTimer) {
    clearTimeout(pauseCampaignBetweenHopsTimer);
    pauseCampaignBetweenHopsTimer = null;
  }
}

function stopPauseCampaignExecutionInternal() {
  clearSingleRollRevealTimer();
  clearPauseCampaignBetweenHopsTimer();
  if (pauseCampaignInterval) {
    clearInterval(pauseCampaignInterval);
    pauseCampaignInterval = null;
  }
  isPauseCampaignRunning = false;
  isPauseCampaignPaused = false;
  pauseCampaignPausedBetweenHops = false;
  if (window.gameState) {
    delete window.gameState.risquePublicCampaignStepPaused;
    delete window.gameState.risqueHostAttackStepStripActive;
  }
  clearConditionCountdownMirror();
  pushConditionCountdownRefresh();
}

/** Idle defaults for attack toolbar number fields (COND STOP, campaign leave). */
function resetAttackNumericInputs() {
  const cond = document.getElementById('cond-threshold');
  if (cond) cond.value = '0';
  const leave = document.getElementById('instant-campaign-leave-behind');
  if (leave) leave.value = '1';
}

function escapeBlitzVoiceHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strip tags for combat-log / TV mirror; keep line breaks between block elements (e.g. blitz fail). */
function promptMessageToMirrorPlain(htmlMessage) {
  let s = String(htmlMessage);
  s = s.replace(/<\/div>\s*/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/[ \t]+/g, ' ');
  return s
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .trim();
}

/** Instant + pausable blitz: attacker exhausted, defender still holds (not conditional blitz). */
function blitzUnsuccessfulPromptHtml(defenderOwner, defenderLabel) {
  const retain = escapeBlitzVoiceHtml(
    `${defenderOwner} retains ${prettyTerritoryName(defenderLabel)}.`
  );
  return (
    '<div class="attack-blitz-fail-head">Blitz unsuccessful.</div>' +
    '<div class="attack-blitz-retain-line">' +
    retain +
    '</div>'
  );
}

function updateBattlePanelReadout() {
  if (elements.attackerPanelName) {
    if (attacker) {
      elements.attackerPanelName.textContent = attacker.owner.toUpperCase();
      const p = window.gameState && window.gameState.players
        ? window.gameState.players.find(x => x.name === attacker.owner)
        : null;
      elements.attackerPanelName.style.color = p ? (window.gameUtils.colorMap[p.color] || '#ffffff') : '#ffffff';
    } else {
      elements.attackerPanelName.textContent = '—';
      elements.attackerPanelName.style.color = '#64748b';
    }
  }
  if (elements.defenderPanelName) {
    if (defender) {
      elements.defenderPanelName.textContent = defender.owner.toUpperCase();
      const dp = window.gameState && window.gameState.players
        ? window.gameState.players.find(x => x.name === defender.owner)
        : null;
      elements.defenderPanelName.style.color = dp ? (window.gameUtils.colorMap[dp.color] || '#ffffff') : '#ffffff';
    } else {
      elements.defenderPanelName.textContent = '—';
      elements.defenderPanelName.style.color = '#64748b';
    }
  }
  if (window.gameState) {
    if (attacker && defender) {
      window.gameState.risqueBattleHudReadout = {
        attackerOwner: attacker.owner,
        defenderOwner: defender.owner,
        attackerLabel: attacker.label,
        defenderLabel: defender.label,
        attackerTroops: attacker.troops,
        defenderTroops: defender.troops
      };
    } else {
      window.gameState.risqueBattleHudReadout = null;
      /* Keep last revealed rolls during post-capture transfer (attacker set, defender null). */
      if (!attacker && !defender) {
        window.gameState.risqueLastDiceDisplay = null;
      }
    }
  }
  if (typeof window.risqueSetSpectatorFocus === 'function') {
    const L = [];
    if (attacker && attacker.label) L.push(attacker.label);
    if (defender && defender.label) L.push(defender.label);
    window.risqueSetSpectatorFocus(L);
  }
  syncAttackPhaseActionLocks();
}

function wireConditionalInputGuards(signal) {
  if (!elements.condThreshold) return;
  const opts = signal ? { signal } : {};
  const stopBubble = (e) => e.stopPropagation();
  elements.condThreshold.addEventListener('click', stopBubble, opts);
  elements.condThreshold.addEventListener('mousedown', stopBubble, opts);
  elements.condThreshold.addEventListener('keydown', stopBubble, opts);
}

/** Clear dice visuals after a roll so transfer / idle state does not look like a new roll. */
function resetAttackDiceUI() {
  for (let i = 0; i < 3; i++) {
    const rect = elements[`attackerDice${i}`];
    const text = elements[`attackerDiceText${i}`];
    if (rect) {
      rect.classList.remove('dice-rolling', 'active-attacker');
    }
    if (text) {
      text.classList.remove('dice-text-hidden', 'dice-text-visible');
      text.textContent = '-';
    }
  }
  for (let i = 0; i < 2; i++) {
    const rect = elements[`defenderDice${i}`];
    const text = elements[`defenderDiceText${i}`];
    if (rect) {
      rect.classList.remove('dice-rolling', 'active-defender');
    }
    if (text) {
      text.classList.remove('dice-text-hidden', 'dice-text-visible');
      text.textContent = '-';
    }
  }
}

const RISQUE_ATTACK_GAME_LOGS_KEY = "gameLogs";
/** Match runtime shell idea: unbounded logs + large gameState (replay tape) exhaust localStorage and break campaign saves. */
const RISQUE_ATTACK_LOG_CAP = 200;
const RISQUE_ATTACK_LOG_DATA_MAX = 3500;

function trimAttackGameLogsInStorage(keepLast) {
  if (keepLast === 0) {
    try {
      localStorage.removeItem(RISQUE_ATTACK_GAME_LOGS_KEY);
    } catch (e0) {
      /* ignore */
    }
    return true;
  }
  const k = Number.isFinite(keepLast) && keepLast > 0 ? Math.floor(keepLast) : 80;
  try {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem(RISQUE_ATTACK_GAME_LOGS_KEY) || "[]");
    } catch (eParse) {
      logs = [];
    }
    if (!Array.isArray(logs)) logs = [];
    if (logs.length > k) logs = logs.slice(-k);
    localStorage.setItem(RISQUE_ATTACK_GAME_LOGS_KEY, JSON.stringify(logs));
    return true;
  } catch (e) {
    try {
      localStorage.removeItem(RISQUE_ATTACK_GAME_LOGS_KEY);
    } catch (e2) {
      /* ignore */
    }
    return false;
  }
}

/**
 * Append to gameLogs with a hard cap. Never throws (quota / private mode) so combat and campaign can continue.
 */
function logToStorage(message, data) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const logEntry = `[${timestamp}] [Attack] ${message}`;
  function pushAndWrite() {
    let logs = [];
    try {
      logs = JSON.parse(localStorage.getItem(RISQUE_ATTACK_GAME_LOGS_KEY) || "[]");
    } catch (eParse) {
      logs = [];
    }
    if (!Array.isArray(logs)) logs = [];
    logs.push(logEntry);
    if (data != null && data !== "") {
      let extra =
        typeof data === "string" ? data : JSON.stringify(data, null, 2);
      if (extra.length > RISQUE_ATTACK_LOG_DATA_MAX) {
        extra = extra.slice(0, RISQUE_ATTACK_LOG_DATA_MAX) + "…[truncated]";
      }
      logs.push(extra);
    }
    while (logs.length > RISQUE_ATTACK_LOG_CAP) {
      logs.shift();
    }
    localStorage.setItem(RISQUE_ATTACK_GAME_LOGS_KEY, JSON.stringify(logs));
  }
  try {
    pushAndWrite();
    console.log(logEntry, data || "");
  } catch (e) {
    try {
      trimAttackGameLogsInStorage(40);
      pushAndWrite();
      console.log(logEntry, data || "");
    } catch (e2) {
      try {
        trimAttackGameLogsInStorage(0);
        pushAndWrite();
        console.log(logEntry, data || "");
      } catch (e3) {
        console.warn("[Attack] logToStorage skipped (storage full or unavailable)", message, e3 || e2 || e);
      }
    }
  }
}

function risqueAttackScheduleMirrorPush() {
  if (typeof window.risqueScheduleMirrorPush === 'function') {
    window.risqueScheduleMirrorPush();
  } else if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function prependCombatLog(text, kind = 'battle') {
  const logEl = elements.logText || document.getElementById('log-text');
  if (!logEl) return;
  if (!elements.logText) elements.logText = logEl;
  const row = document.createElement('div');
  const k = kind === 'voice' ? 'voice' : kind;
  row.className = `attack-log-entry attack-log-${k}`;
  row.textContent = `> ${text}`;
  logEl.prepend(row);
  while (logEl.childElementCount > 120) {
    logEl.removeChild(logEl.lastElementChild);
  }
  if (window.gameState) {
    if (!Array.isArray(window.gameState.risqueCombatLogTail)) window.gameState.risqueCombatLogTail = [];
    window.gameState.risqueCombatLogTail.unshift({ text: String(text), kind: k });
    if (window.gameState.risqueCombatLogTail.length > 50) {
      window.gameState.risqueCombatLogTail.length = 50;
    }
  }
  risqueAttackScheduleMirrorPush();
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.clampCombatLogToCanvasBottom === 'function'
  ) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.clampCombatLogToCanvasBottom();
      });
    });
  }
}

window.risqueAppendGameLog = function (text, kind) {
  prependCombatLog(text, kind === undefined ? 'battle' : kind);
};

function prettyTerritoryName(id) {
  return String(id || '')
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function pushPublicAttackMirror() {
  risqueAttackScheduleMirrorPush();
}

/** Public TV: clear post-transfer line and show who picked attack-from. */
function setPublicAttackFromSelection(owner, label) {
  if (!window.gameState) return;
  window.gameState.risquePublicAttackTransferSummary = '';
  window.gameState.risquePublicAttackSelectionLine = `${owner} is selecting ${prettyTerritoryName(label)} to attack from.`;
  pushPublicAttackMirror();
}

/** Public TV: defender locked in, before dice. */
function setPublicAttackTargetSelection(defenderLabel) {
  if (!window.gameState) return;
  const cp = window.gameState.currentPlayer;
  window.gameState.risquePublicAttackSelectionLine = `${cp} is attacking ${prettyTerritoryName(defenderLabel)}.`;
  pushPublicAttackMirror();
}

function clearPublicAttackSelectionLine() {
  if (!window.gameState) return;
  window.gameState.risquePublicAttackSelectionLine = '';
  pushPublicAttackMirror();
}

/** Dice-only combat log line (optional single-roll lead). Loss is logged separately. */
function formatDiceOnlyCombatLogLine(snap, lead) {
  if (!snap || !snap.attackerRolls || !snap.defenderRolls) return '';
  const atkName = snap.player && snap.player.name ? snap.player.name : 'Attacker';
  const defName = snap.opponent && snap.opponent.name ? snap.opponent.name : 'Defender';
  const core = `${atkName} rolls ${snap.attackerRolls.join(', ')}. ${defName} rolls ${snap.defenderRolls.join(', ')}.`;
  const L = lead != null && String(lead).trim() !== '' ? String(lead) : '';
  return L ? `${L}${core}` : core;
}

function formatBattleOutcomeFriendly(attackerOwner, defenderOwner, attackerLosses, defenderLosses) {
  const a = String(attackerOwner || 'Attacker');
  const d = String(defenderOwner || 'Defender');
  if (attackerLosses === 1 && defenderLosses === 1) return `${a} and ${d} each lose 1.`;
  if (attackerLosses === 2) return `${a} loses 2.`;
  if (attackerLosses === 1) return `${a} loses 1.`;
  if (defenderLosses === 2) return `${d} loses 2.`;
  if (defenderLosses === 1) return `${d} loses 1.`;
  return 'No losses.';
}

function saveGameState() {
  var gs = window.gameState;
  if (!gs) return;
  if (typeof window.risqueWriteGameStateLocalStorageLite === "function") {
    try {
      window.risqueWriteGameStateLocalStorageLite(gs);
    } catch (eLite) {
      /* fallback below */
    }
    if (typeof window.risqueReplayScheduleTapeSidecarPersist === "function") {
      try {
        window.risqueReplayScheduleTapeSidecarPersist(gs);
      } catch (eSide) {
        /* ignore */
      }
    }
    if (typeof window.risqueScheduleMirrorPush === "function") {
      window.risqueScheduleMirrorPush();
    } else if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
    return;
  }
  if (typeof window.risquePersistHostGameState === "function") {
    try {
      window.risquePersistHostGameState(gs);
      return;
    } catch (eFastPersist) {
      /* fallback below */
    }
  }
  function writeState() {
    localStorage.setItem("gameState", JSON.stringify(gs));
  }
  try {
    writeState();
  } catch (e) {
    const q = e && e.name === "QuotaExceededError";
    if (q) {
      trimAttackGameLogsInStorage(60);
      try {
        writeState();
        return;
      } catch (e2) {
        /* continue */
      }
      try {
        localStorage.removeItem(RISQUE_ATTACK_GAME_LOGS_KEY);
        writeState();
        return;
      } catch (e3) {
        /* continue */
      }
    }
    console.warn("[Attack] Failed to save game state:", e && e.message ? e.message : e);
  }
}

function updatePlayerTroopsTotal(player) {
  const total = player.territories.reduce((sum, t) => {
    const troops = t.troops || 0;
    if (troops < 0) {
      t.troops = 0;
    }
    return sum + troops;
  }, 0);
  if (player.troopsTotal !== total) {
    player.troopsTotal = total;
  }
  window.gameUtils.renderStats(window.gameState);
  return total;
}

function checkPlayerElimination(defenderPlayer) {
  updatePlayerTroopsTotal(defenderPlayer);
  // Risk rule: no controlled territories = eliminated. Do not also require troopsTotal<=0;
  // NaN/stale totals blocked elimination before.
  const noTerritories = !defenderPlayer.territories || defenderPlayer.territories.length === 0;
  if (!noTerritories) return false;
  const currentPlayer = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
  currentPlayer.cards = currentPlayer.cards || [];
  const transferredCards = defenderPlayer.cards || [];
  const risqueCardNameNorm = c => {
    const raw = typeof c === "string" ? c : c && c.name ? String(c.name) : "";
    if (!raw) return "";
    return raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
  };
  /* Receive-card conquest UI splits hand vs taken cards; survives if transferredCardCount is cleared later. */
  window.gameState.risqueConquestHandBeforeTakeover = currentPlayer.cards.map(risqueCardNameNorm);
  window.gameState.risqueConquestTakenCards = transferredCards.map(risqueCardNameNorm);
  currentPlayer.cards.push(...transferredCards);
  currentPlayer.cardCount = currentPlayer.cards.length;
  defenderPlayer.cards = [];
  defenderPlayer.cardCount = 0;
  window.gameState.transferredCardCount = transferredCards.length;
  window.gameState.cardEarnedViaAttack = true;
  requestAnimationFrame(function () {
    if (typeof window.risqueSyncHostAttackCardEarnedIndicator === 'function') {
      window.risqueSyncHostAttackCardEarnedIndicator();
    }
  });
  window.gameState.defeatedPlayer = defenderPlayer.name;
  if (
    window.gameUtils &&
    typeof window.gameUtils.syncConquestPendingNewContinents === 'function'
  ) {
    window.gameUtils.syncConquestPendingNewContinents(window.gameState);
  }
  const turnOrderBeforeElimination = Array.isArray(window.gameState.turnOrder)
    ? window.gameState.turnOrder.slice()
    : [];
  window.gameState.turnOrder = turnOrderBeforeElimination.filter(name => name !== defenderPlayer.name);
  if (
    turnOrderBeforeElimination.length >= 2 &&
    window.gameState.turnOrder.length === 1
  ) {
    try {
      window.gameState.risqueReplayGameWinDiskFlush = {
        turnOrderBefore: turnOrderBeforeElimination,
        roundAtElimination: Math.max(1, Number(window.gameState.round) || 1),
        conqueror: String(currentPlayer.name || '')
      };
    } catch (eMeta) {
      /* ignore */
    }
  }
  window.gameState.risquePublicEliminationBanner = `${currentPlayer.name} has conquered ${defenderPlayer.name}.`;
  if (typeof window.risqueReplayRecordElimination === 'function') {
    try {
      window.risqueReplayRecordElimination(window.gameState, currentPlayer.name, defenderPlayer.name);
    } catch (eRep) {
      /* ignore */
    }
  }
  logToStorage(`Player ${defenderPlayer.name} eliminated, ${transferredCards.length} cards transferred`);
  saveGameState();
  /* Win replay + disk autosave: defer to tryImmediateGameWinAfterElimination / checkWinCondition so the
   * final board (troop transfer, defender removed from players) is on tape before celebration UI. */
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  if (typeof window.risqueRefreshControlVoiceMirror === 'function') {
    window.risqueRefreshControlVoiceMirror(window.gameState);
  }
  return true;
}

/**
 * Full-screen confetti + flashing celebration when the game ends (host + public TV).
 * Idempotent per winner name so mirror refreshes do not stack duplicates.
 * After {@link RISQUE_GAME_WIN_OVERLAY_MS}, overlay is removed and the app opens postgame review (not login).
 */
(function risqueDefineImmediateGameWinOverlay() {
  const RISQUE_GAME_WIN_OVERLAY_MS = 5000;

  function risqueGameWinNavigateToPostgame() {
    try {
      if (window.gameState && typeof window.gameState === 'object') {
        delete window.gameState.risqueGameWinImmediate;
        window.gameState.phase = 'postgame';
        try {
          localStorage.setItem('gameState', JSON.stringify(window.gameState));
        } catch (eLs) {
          /* ignore */
        }
      }
    } catch (eGs) {
      /* ignore */
    }
    const dest =
      typeof window.risquePostgameUrl === 'function'
        ? window.risquePostgameUrl()
        : 'game.html?phase=postgame';
    if (typeof window.risqueNavigateWithFade === 'function') {
      window.risqueNavigateWithFade(dest);
    } else {
      window.location.href = dest;
    }
  }

  window.risqueMountImmediateGameWinOverlay = function (winnerName) {
    const w = winnerName != null && String(winnerName).trim() !== '' ? String(winnerName).trim() : 'Winner';
    if (window.__risqueGameWinOverlayMounted === w) return;
    window.__risqueGameWinOverlayMounted = w;
    const existing = document.getElementById('risque-immediate-game-win-root');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (window.__risqueGameWinOverlayTimer != null) {
      clearTimeout(window.__risqueGameWinOverlayTimer);
      window.__risqueGameWinOverlayTimer = null;
    }
    const root = document.createElement('div');
    root.id = 'risque-immediate-game-win-root';
    root.className = 'risque-immediate-game-win-root';
    root.setAttribute('role', 'status');
    const burst = document.createElement('div');
    burst.className = 'risque-immediate-game-win-confetti';
    for (let i = 0; i < 80; i += 1) {
      const p = document.createElement('div');
      p.className = 'risque-confetti-piece';
      p.style.setProperty('--risque-cx', `${Math.random() * 100}%`);
      p.style.setProperty('--risque-d', `${1.2 + Math.random() * 2}s`);
      p.style.setProperty('--risque-rot', `${Math.random() * 360}deg`);
      p.style.setProperty('--risque-h', String(Math.floor(Math.random() * 360)));
      burst.appendChild(p);
    }
    const flash = document.createElement('div');
    flash.className = 'risque-immediate-game-win-flash';
    const title = document.createElement('div');
    title.className = 'risque-immediate-game-win-title';
    title.textContent = `${w} wins the game!`;
    root.appendChild(burst);
    root.appendChild(flash);
    root.appendChild(title);
    document.body.appendChild(root);

    window.__risqueGameWinOverlayTimer = setTimeout(function () {
      window.__risqueGameWinOverlayTimer = null;
      try {
        const el = document.getElementById('risque-immediate-game-win-root');
        if (el && el.parentNode) el.parentNode.removeChild(el);
      } catch (eRm) {
        /* ignore */
      }
      delete window.__risqueGameWinOverlayMounted;
      /* Public TV only mirrors the host — never navigate or rewrite STORAGE_KEY from here. */
      if (window.risqueDisplayIsPublic) return;
      risqueGameWinNavigateToPostgame();
    }, RISQUE_GAME_WIN_OVERLAY_MS);
  };
})();

/**
 * Last opponent just lost their last territory: skip troop transfer & conquer — end the game immediately.
 * @param {boolean} postCampaignAutoTransferDone — true if {@link autoCompleteTroopTransferLeaveBehind} already ran.
 */
/** Hold final dice readout on screen before confetti (ms). */
const RISQUE_IMMEDIATE_WIN_AFTER_DICE_MS = 2200;

function scheduleImmediateGameWinAfterElimination(player, opponent, postCampaignAutoTransferDone) {
  setTimeout(function () {
    tryImmediateGameWinAfterElimination(player, opponent, postCampaignAutoTransferDone);
  }, RISQUE_IMMEDIATE_WIN_AFTER_DICE_MS);
}

function tryImmediateGameWinAfterElimination(player, opponent, postCampaignAutoTransferDone) {
  if (!window.gameState || window.gameState.turnOrder.length !== 1) return false;
  if (conquestCelebrationCtaTimer != null) {
    clearTimeout(conquestCelebrationCtaTimer);
    conquestCelebrationCtaTimer = null;
  }
  if (!postCampaignAutoTransferDone) {
    autoCompleteTroopTransferLeaveBehind(1, {});
  }
  isAcquiring = false;
  risqueDeferredEliminationConquerPrompt = null;
  delete window.gameState.risqueDeferConquerElimination;
  window.gameState.players = window.gameState.players.filter(p => p.name !== opponent.name);
  window.gameState.winner = player.name;
  window.gameState.risqueGameWinImmediate = true;
  window.gameState.phase = 'attack';
  delete window.gameState.risquePublicEliminationBanner;
  delete window.gameState.defeatedPlayer;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  try {
    dismissPrompt();
  } catch (eDismiss) {
    /* ignore */
  }
  teardownAttackTroopTransferWheel();
  saveGameState();
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  if (typeof window.risqueReplayEnsureLatestBoardFrame === 'function') {
    try {
      window.risqueReplayEnsureLatestBoardFrame(window.gameState);
    } catch (eLbWin) {
      /* ignore */
    }
  }
  var winSave =
    typeof window.risqueRoundAutosaveOnGameWin === 'function'
      ? window.risqueRoundAutosaveOnGameWin(window.gameState)
      : Promise.resolve();
  Promise.resolve(winSave)
    .catch(function () {
      /* non-fatal */
    })
    .then(function () {
      if (typeof window.risqueMountImmediateGameWinOverlay === 'function') {
        window.risqueMountImmediateGameWinOverlay(player.name);
      }
      if (window.gameUtils) {
        window.gameUtils.renderTerritories(null, window.gameState);
        window.gameUtils.renderStats(window.gameState);
      }
      logToStorage('Immediate game win — last opponent eliminated', { winner: player.name });
    });
  return true;
}

function checkWinCondition() {
  if (window.gameState.turnOrder.length === 1) {
    window.gameState.winner = window.gameState.currentPlayer;
    window.gameState.risqueGameWinImmediate = true;
    saveGameState();
    if (typeof window.risqueReplayEnsureLatestBoardFrame === 'function') {
      try {
        window.risqueReplayEnsureLatestBoardFrame(window.gameState);
      } catch (eLbCw) {
        /* ignore */
      }
    }
    var winSaveCw =
      typeof window.risqueRoundAutosaveOnGameWin === 'function'
        ? window.risqueRoundAutosaveOnGameWin(window.gameState)
        : Promise.resolve();
    Promise.resolve(winSaveCw)
      .catch(function () {
        /* non-fatal */
      })
      .then(function () {
        logToStorage('Win condition met');
        if (typeof window.risqueMirrorPushGameState === 'function') {
          window.risqueMirrorPushGameState();
        }
        if (typeof window.risqueMountImmediateGameWinOverlay === 'function') {
          window.risqueMountImmediateGameWinOverlay(window.gameState.winner);
        } else {
          setTimeout(() => {
            window.location.href = risqueAttackDoc('win');
          }, 1000);
        }
      });
  }
}

/**
 * Host: risquePhases.attack.mount creates #ui-svg + #aerial-bridge-group. Public TV follows mirror only and
 * never mounts attack — ensure the overlay layer exists so the dashed aerial line can draw.
 */
function ensureAerialBridgeOverlayDom() {
  const canvas = document.getElementById('canvas');
  if (!canvas) return false;
  let uiSvg = document.getElementById('ui-svg');
  if (!uiSvg) {
    uiSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    uiSvg.setAttribute('id', 'ui-svg');
    uiSvg.setAttribute('width', '1920');
    uiSvg.setAttribute('height', '1080');
    uiSvg.setAttribute('viewBox', '0 0 1920 1080');
    uiSvg.style.position = 'absolute';
    uiSvg.style.top = '0';
    uiSvg.style.left = '0';
    uiSvg.style.zIndex = '3';
    uiSvg.style.pointerEvents = 'none';
    const gWrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gWrap.setAttribute('pointer-events', 'none');
    const gBridge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gBridge.setAttribute('id', 'aerial-bridge-group');
    gWrap.appendChild(gBridge);
    uiSvg.appendChild(gWrap);
    canvas.appendChild(uiSvg);
  } else if (!document.getElementById('aerial-bridge-group')) {
    const gWrap = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gWrap.setAttribute('pointer-events', 'none');
    const gBridge = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    gBridge.setAttribute('id', 'aerial-bridge-group');
    gWrap.appendChild(gBridge);
    uiSvg.appendChild(gWrap);
  }
  return !!document.getElementById('aerial-bridge-group');
}

function renderAerialBridge(retryAttempt) {
  const attempt = retryAttempt != null && Number.isFinite(retryAttempt) ? Math.max(0, Math.floor(retryAttempt)) : 0;
  if (!elements.aerialBridgeGroup) {
    ensureAerialBridgeOverlayDom();
    cacheElements();
  }
  if (!elements.aerialBridgeGroup) return;
  elements.aerialBridgeGroup.innerHTML = '';
  if (!aerialBridge || !aerialBridge.source || !aerialBridge.target) return;

  const esc =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? (s) => CSS.escape(String(s))
      : (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const srcSel = `.territory-circle[data-label="${esc(aerialBridge.source)}"]`;
  const tgtSel = `.territory-circle[data-label="${esc(aerialBridge.target)}"]`;
  const sourceCircle = document.querySelector(srcSel);
  const targetCircle = document.querySelector(tgtSel);
  if (!sourceCircle || !targetCircle) {
    if (attempt < 12) {
      requestAnimationFrame(function () {
        renderAerialBridge(attempt + 1);
      });
    }
    return;
  }

  const uiSvgEl = document.getElementById('ui-svg');
  if (!uiSvgEl) {
    if (attempt < 12) {
      requestAnimationFrame(function () {
        renderAerialBridge(attempt + 1);
      });
    }
    return;
  }

  const sourceRect = sourceCircle.getBoundingClientRect();
  const targetRect = targetCircle.getBoundingClientRect();
  const svgRect = uiSvgEl.getBoundingClientRect();

  const x1 = (sourceRect.left + sourceRect.width / 2 - svgRect.left) * 1920 / svgRect.width;
  const y1 = (sourceRect.top + sourceRect.height / 2 - svgRect.top) * 1080 / svgRect.height;
  const x2 = (targetRect.left + targetRect.width / 2 - svgRect.left) * 1920 / svgRect.width;
  const y2 = (targetRect.top + targetRect.height / 2 - svgRect.top) * 1080 / svgRect.height;

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', x2);
  line.setAttribute('y2', y2);
  line.setAttribute('stroke', '#ff0000');
  line.setAttribute('stroke-width', '4');
  line.setAttribute('stroke-dasharray', '5,5');
  line.setAttribute('vector-effect', 'non-scaling-stroke');
  line.setAttribute('pointer-events', 'none');
  line.classList.add('aerial-bridge');
  elements.aerialBridgeGroup.appendChild(line);
  logToStorage('Rendered aerial bridge');
}

window.risqueRedrawAerialBridgeOverlay = function risqueRedrawAerialBridgeOverlay() {
  try {
    ensureAerialBridgeOverlayDom();
    cacheElements();
    aerialBridge = aerialBridgeFromGameState(window.gameState);
    renderAerialBridge();
  } catch (eRedrawBr) {
    /* ignore */
  }
};

/** Public TV: clear dashed aerial line when mirror has no active bridge. */
window.risqueClearAerialBridgeOverlay = function risqueClearAerialBridgeOverlay() {
  try {
    cacheElements();
    if (elements.aerialBridgeGroup) elements.aerialBridgeGroup.innerHTML = '';
  } catch (eClrAerial) {
    /* ignore */
  }
};

/**
 * End-of-reinforce / end-of-attack: clear the wildcard aerial link from state and the overlay.
 * The link persists from attack into reinforce; cleared when leaving reinforce (receive card) or equivalent.
 */
window.risqueEndAerialBridgeForTurn = function risqueEndAerialBridgeForTurn() {
  if (!window.gameState) return;
  window.gameState.aerialAttack = false;
  delete window.gameState.risqueAerialLinkPending;
  delete window.gameState.risqueAerialLinkLocked;
  aerialBridge = null;
  if (typeof window.risqueClearAerialBridgeOverlay === 'function') {
    window.risqueClearAerialBridgeOverlay();
  }
};

function risqueStopConfirmSlotFlash() {
  const strip = document.getElementById('ucp-slot-strip');
  if (strip) strip.classList.remove('risque-confirm-slot-strip-flash');
  for (let i = 0; i < 6; i += 1) {
    const b = document.getElementById(`control-btn-${i}`);
    if (b) {
      b.classList.remove('risque-confirm-slot-flash');
      b.classList.remove('risque-troop-transfer-allbut-selected', 'risque-troop-transfer-allbut-dim');
    }
  }
}

function risqueStartConfirmSlotFlash() {
  risqueStopConfirmSlotFlash();
  const strip = document.getElementById('ucp-slot-strip');
  if (strip) strip.classList.add('risque-confirm-slot-strip-flash');
}

/** After ALL BUT 1 / ALL BUT 3: stop strip flash; outline chosen shortcut; dim the other; pulse CONFIRM only. */
function risqueTroopTransferOnShortcutChosen(which) {
  const strip = document.getElementById('ucp-slot-strip');
  if (strip) strip.classList.remove('risque-confirm-slot-strip-flash');
  const b0 = document.getElementById('control-btn-0');
  const b1 = document.getElementById('control-btn-1');
  const b2 = document.getElementById('control-btn-2');
  let i;
  for (i = 0; i < 6; i += 1) {
    const b = document.getElementById(`control-btn-${i}`);
    if (b) b.classList.remove('risque-confirm-slot-flash');
  }
  if (b0) {
    b0.classList.remove('risque-troop-transfer-allbut-selected', 'risque-troop-transfer-allbut-dim');
  }
  if (b1) {
    b1.classList.remove('risque-troop-transfer-allbut-selected', 'risque-troop-transfer-allbut-dim');
  }
  if (which === 'all-but-one' && b0 && b1) {
    b0.classList.add('risque-troop-transfer-allbut-selected');
    b1.classList.add('risque-troop-transfer-allbut-dim');
  } else   if (which === 'all-but-three' && b0 && b1) {
    b1.classList.add('risque-troop-transfer-allbut-selected');
    b0.classList.add('risque-troop-transfer-allbut-dim');
  }
  if (b2) b2.classList.add('risque-confirm-slot-flash');
}

/**
 * Host attack phase: deck-card earned indicator under Continue to reinforcement (not slot buttons).
 */
function syncHostAttackCardEarnedIndicator() {
  const gs = window.gameState;
  const hostAttack =
    !window.risqueDisplayIsPublic && gs && String(gs.phase || '') === 'attack';
  const earned = !!(gs && (gs.cardEarnedViaAttack || gs.cardEarnedViaCardplay));
  const tip =
    earned
      ? 'You earned a territory deck card this turn (capture or territory won via cardplay).'
      : 'No deck card yet this turn — capture a territory or take one via cardplay to earn one.';

  const deckVis = document.getElementById('risque-host-deck-earned-visual');
  const deckLbl = document.getElementById('risque-host-deck-earned-label');
  if (!deckVis || !deckLbl) return;

  if (!hostAttack) {
    deckVis.hidden = true;
    deckVis.setAttribute('aria-hidden', 'true');
    deckLbl.textContent = '';
    deckLbl.removeAttribute('title');
    deckVis.removeAttribute('title');
    deckVis.classList.remove(
      'risque-host-deck-earned-visual--earned',
      'risque-host-deck-earned-visual--pending'
    );
    return;
  }

  deckVis.hidden = false;
  deckVis.setAttribute('aria-hidden', 'false');
  deckVis.classList.toggle('risque-host-deck-earned-visual--earned', earned);
  deckVis.classList.toggle('risque-host-deck-earned-visual--pending', !earned);
  deckLbl.textContent = earned ? 'CARD EARNED' : 'NO CARD EARNED YET';
  deckLbl.title = tip;
  deckVis.title = tip;
}

window.risqueSyncHostAttackCardEarnedIndicator = syncHostAttackCardEarnedIndicator;

function syncAttackPhaseActionLocks() {
  const gs = window.gameState;
  if (window.gameUtils && typeof window.gameUtils.normalizeAerialWildcardCounters === 'function') {
    try {
      window.gameUtils.normalizeAerialWildcardCounters(gs);
    } catch (eAerialNorm) {
      /* ignore */
    }
  }
  const pending = gs && String(gs.attackPhase || '') === 'pending_transfer';
  const hasPair = !!(attacker && defender);
  const rollEl = document.getElementById('roll');
  const blitzEl = document.getElementById('blitz');
  const campaignEl = document.getElementById('campaign');
  const aerialEl = document.getElementById('aerial-attack');
  const aerialEl2 = document.getElementById('aerial-attack-2');
  const reinforceEl = document.getElementById('reinforce');
  const guidedPromptActive =
    !!document.querySelector('.ucp-slot-ctl--pulse-attention') ||
    !!document.querySelector('.risque-confirm-slot-flash') ||
    !!document.querySelector('.risque-confirm-slot-strip-flash');
  if (rollEl) rollEl.disabled = !!pending || !hasPair;
  if (blitzEl) blitzEl.disabled = !!pending || !hasPair;
  if (campaignEl) campaignEl.disabled = !!pending;
  const qBlitzL3El = document.getElementById('q-blitz-l3');
  const qBlitzT3El = document.getElementById('q-blitz-t3');
  const qCampEl = document.getElementById('q-camp');
  const qCampPlanning =
    campaignQDevMode &&
    campaignType === 'instant' &&
    (campaignMode === 'instant_launch' || campaignMode === 'instant_extend');
  const qBlitzDisabled = !!pending || !hasPair || !!qCampPlanning;
  if (qBlitzL3El) qBlitzL3El.disabled = qBlitzDisabled;
  if (qBlitzT3El) qBlitzT3El.disabled = qBlitzDisabled;
  if (qCampEl) {
    qCampEl.disabled = !!pending;
    qCampEl.textContent = 'Q CAMP';
  }
  const uses =
    window.gameUtils && typeof window.gameUtils.getAerialAttackUsesRemaining === 'function'
      ? window.gameUtils.getAerialAttackUsesRemaining(gs)
      : gs && gs.aerialAttackEligible
        ? 1
        : 0;
  /* risqueAerialUnlockedAfterCombat is set after combat rolls and by init when uses>0 — early sync can run
   * before init runs, so wildcard aerial (uses>=1, no combat yet) must still clear the grey state. */
  const aerialUnlocked = !!(gs && gs.risqueAerialUnlockedAfterCombat);
  const aerialUnlockedForUi = aerialUnlocked || uses >= 1;
  const aerialBaseGrey =
    !aerialUnlockedForUi || isSelectingAerialSource || isSelectingAerialTarget || isAwaitingAerialConfirm;
  if (aerialEl) aerialEl.disabled = !!pending || aerialBaseGrey || uses < 1;
  if (aerialEl2) aerialEl2.disabled = !!pending || aerialBaseGrey || uses < 2;
  const showQBlitzInDevRow = !(aerialUnlockedForUi && uses >= 1);
  function setDevRowBtnVisible(el, show) {
    if (!el) return;
    if (show) {
      el.hidden = false;
      el.removeAttribute('hidden');
      el.setAttribute('aria-hidden', 'false');
    } else {
      el.hidden = true;
      el.setAttribute('hidden', 'hidden');
      el.setAttribute('aria-hidden', 'true');
    }
  }
  setDevRowBtnVisible(qBlitzL3El, showQBlitzInDevRow);
  setDevRowBtnVisible(qBlitzT3El, showQBlitzInDevRow);
  if (reinforceEl) reinforceEl.disabled = !!pending || guidedPromptActive;
}

/** Re-apply after {@link setAttackChromeInteractive}; HUD enablement must not override per-control locks. */
window.risqueSyncAttackPhaseActionLocks = syncAttackPhaseActionLocks;

function dismissPrompt(opts) {
  opts = opts || {};
  const keepInstantCampaignHud = !!opts.keepInstantCampaignHud;
  risqueStopConfirmSlotFlash();
  closeBlitzDropdown();
  closeCampaignDropdown();
  const legacy = document.getElementById('prompt');
  if (legacy) legacy.remove();

  if (
    !keepInstantCampaignHud &&
    typeof window.risqueIsAttackCampaignActive === 'function' &&
    window.risqueIsAttackCampaignActive()
  ) {
    clearAttackCampaignPlanningAfterRun();
  }

  clearControlVoiceSlotsAndExtras();

  if (!keepInstantCampaignHud) {
    const cv = document.getElementById('control-voice');
    if (cv) cv.classList.remove('ucp-control-voice--campaign-instant');

    const vt = document.getElementById('control-voice-text');
    if (vt) {
      vt.classList.remove('campaign-instant-voice');
      vt.innerHTML = '';
    }
  }

  const vr = document.getElementById('control-voice-report');
  if (vr) {
    vr.textContent = '';
    vr.style.display = 'none';
  }
  try {
    if (window.gameState && !keepInstantCampaignHud) {
      window.gameState.risqueControlVoice = { primary: '', report: '', reportClass: '' };
      risqueAttackScheduleMirrorPush();
    }
    if (document.body && window.gameState && String(window.gameState.phase) === "reinforce") {
      document.body.setAttribute("data-risque-reinforce-slot-mode", "main");
    }
  } catch (eDismissVoice) {
    /* ignore */
  }
}

/** Clears extras, troubleshoot node, slot row, troops input — used by dismissPrompt and INSTANT HUD paint. */
function clearControlVoiceSlotsAndExtras() {
  const extras = document.getElementById('control-voice-extras');
  if (extras) extras.innerHTML = '';

  const tsRoot = document.getElementById('campaign-troubleshoot-root');
  if (tsRoot && tsRoot.parentNode) tsRoot.parentNode.removeChild(tsRoot);

  const condTh = document.getElementById('cond-threshold');
  if (condTh) {
    condTh.classList.remove('ucp-slot-strip-number--pulse-attention');
    if (window.__risqueCondThresholdKeyHandler) {
      condTh.removeEventListener('keydown', window.__risqueCondThresholdKeyHandler);
      window.__risqueCondThresholdKeyHandler = null;
    }
  }

  for (let i = 0; i < 6; i += 1) {
    const b = document.getElementById(`control-btn-${i}`);
    if (b) {
      b.removeAttribute('hidden');
      b.textContent = '';
      b.title = '';
      b.onclick = null;
      b.disabled = true;
      b.classList.remove('ucp-slot-ctl--pulse-attention');
      b.classList.add('ucp-slot-empty');
    }
  }

  syncHostAttackCardEarnedIndicator();

  teardownAttackTroopTransferWheel();
  const ti = document.getElementById('troops-input');
  if (ti) {
    ti.oninput = null;
    ti.onwheel = null;
    ti.disabled = true;
    ti.value = '';
    ti.removeAttribute('min');
    ti.removeAttribute('max');
  }
  const slotStrip = document.getElementById('ucp-slot-strip');
  if (slotStrip) slotStrip.classList.remove('ucp-slot-strip-active');
  const numLabel = document.getElementById('ucp-voice-number-label');
  if (numLabel) numLabel.textContent = 'Amount';
}

window.risqueDismissAttackPrompt = dismissPrompt;

function showPrompt(message, buttons = [], selectOptions = null, report = '') {
  const voiceText = document.getElementById('control-voice-text');
  const voiceReport = document.getElementById('control-voice-report');
  const extras = document.getElementById('control-voice-extras');
  const cvRoot = document.getElementById('control-voice');
  const messagePlain = typeof message === 'string' && message.indexOf('<') === -1;
  const keepInstantCampaignHud =
    messagePlain &&
    cvRoot &&
    cvRoot.classList.contains('ucp-control-voice--campaign-instant');

  if (!elements.uiOverlay) {
    elements.uiOverlay = document.getElementById('ui-overlay');
  }

  if (!voiceText || !extras) {
    dismissPrompt();
    const prompt = document.createElement('div');
    prompt.id = 'prompt';
    prompt.className = 'prompt';
    prompt.innerHTML = `<div class="prompt-text">${message}</div>`;
    if (report) {
      prompt.innerHTML += `<div style="margin:10px 0;font-size:16px;font-weight:bold;">${report}</div>`;
    }
    buttons.forEach(btn => {
      const button = document.createElement('button');
      button.className = 'prompt-button';
      button.textContent = btn.label;
      button.disabled = btn.disabled || false;
      button.onclick = btn.onClick;
      prompt.appendChild(button);
    });
    const overlayEl = elements.uiOverlay || document.getElementById('ui-overlay');
    if (overlayEl) {
      overlayEl.appendChild(prompt);
    } else {
      console.error('[Attack] showPrompt: no ui-overlay for legacy prompt');
    }
    logToStorage(`Prompt shown: ${message}`);
    return;
  }

  dismissPrompt({ keepInstantCampaignHud });

  if (selectOptions && selectOptions.clearPublicAttackSelectionLine && window.gameState) {
    window.gameState.risquePublicAttackSelectionLine = '';
  }

  if (keepInstantCampaignHud) {
    const p1 = message != null ? String(message) : '';
    const p2 = report != null && String(report) !== '' ? String(report) : '';
    const hint = [p1, p2].filter(Boolean).join('\n\n');
    if (voiceReport) {
      voiceReport.className = 'ucp-voice-report' + (hint ? ' ucp-voice-report--instant' : '');
      voiceReport.textContent = hint;
      voiceReport.style.display = hint ? 'block' : 'none';
    }
  } else {
    voiceText.innerHTML = message;
    if (voiceReport) {
      if (report) {
        voiceReport.textContent = report;
        voiceReport.style.display = 'block';
        const cvmRc =
          selectOptions && selectOptions.controlVoiceMirror && selectOptions.controlVoiceMirror.reportClass;
        voiceReport.className = cvmRc ? String(cvmRc) : 'ucp-voice-report';
      } else {
        voiceReport.textContent = '';
        voiceReport.style.display = 'none';
        voiceReport.className = 'ucp-voice-report';
      }
    }
  }

  if (selectOptions?.promptSelect && Array.isArray(selectOptions.promptSelect.choices)) {
    const sel = document.createElement('select');
    sel.id = 'cardplay-voice-select';
    sel.className = 'prompt-select';
    sel.title = 'Choose option';
    selectOptions.promptSelect.choices.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label != null ? opt.label : opt.text != null ? opt.text : String(opt.value);
      sel.appendChild(o);
    });
    extras.appendChild(sel);
  }
  if (selectOptions?.promptNumber) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.id = 'cardplay-voice-num';
    inp.className = 'prompt-input';
    if (selectOptions.promptNumber.min != null) inp.min = String(selectOptions.promptNumber.min);
    if (selectOptions.promptNumber.value != null) inp.value = String(selectOptions.promptNumber.value);
    extras.appendChild(inp);
  }

  if (selectOptions?.attacker && selectOptions.attacker.length > 0) {
    const label = document.createElement('label');
    label.textContent = 'ATTACKER DICE';
    const select = document.createElement('select');
    select.className = 'prompt-select';
    selectOptions.attacker.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      select.appendChild(option);
    });
    select.value = selectOptions.attacker[selectOptions.attacker.length - 1].value;
    select.addEventListener('change', () => {
      attackerDice = parseInt(select.value, 10);
      for (let i = 0; i < 3; i++) {
        const rect = elements[`attackerDice${i}`];
        const text = elements[`attackerDiceText${i}`];
        if (rect && text) {
          if (i < attackerDice) {
            rect.classList.add('active-attacker');
            // Do not clear text here — showPrompt dispatches this after a roll and would
            // wipe revealed values; inactive slots below still reset to '-'.
          } else {
            rect.classList.remove('active-attacker');
            text.textContent = '-';
          }
        }
      }
    });
    extras.appendChild(label);
    extras.appendChild(select);
    select.dispatchEvent(new Event('change'));
  }

  if (selectOptions?.troops) {
    const slotStrip = document.getElementById('ucp-slot-strip');
    if (slotStrip) slotStrip.classList.add('ucp-slot-strip-active');
    const numLabel = document.getElementById('ucp-voice-number-label');
    const tMin = selectOptions.troops.min != null ? selectOptions.troops.min : 0;
    const tMax = selectOptions.troops.max;
    if (numLabel) {
      numLabel.textContent =
        tMin === 0
          ? `Troops to move (0–${tMax})`
          : `Troops to move (${tMin}–${tMax})`;
    }

    const input = document.getElementById('troops-input');
    if (input) {
      input.disabled = false;
      input.min = String(tMin);
      input.max = String(tMax);
      const initialVal =
        selectOptions.troops.initial != null ? selectOptions.troops.initial : tMin;
      input.value = String(Math.max(tMin, Math.min(tMax, initialVal)));
      const onAdjust = selectOptions.troops.onAdjust;
      input.oninput = function () {
        let v = parseInt(input.value, 10);
        if (isNaN(v)) v = tMin;
        v = Math.max(tMin, Math.min(v, tMax));
        input.value = String(v);
        if (typeof onAdjust === 'function') {
          onAdjust(v);
          return;
        }
        troopsToTransfer = v;
        const player = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
        const attacking = player.territories.find(t => t.name === window.gameState.attackingTerritory.name);
        const acquired = player.territories.find(t => t.name === window.gameState.acquiredTerritory.name);
        if (attacking && acquired) {
          attacking.troops = attackerInitialTroops - minTroopsToTransfer - troopsToTransfer;
          acquired.troops = minTroopsToTransfer + troopsToTransfer;
          window.gameState.attackingTerritory = { name: attacking.name, troops: attacking.troops };
          window.gameState.acquiredTerritory = { name: acquired.name, troops: acquired.troops };
          window.gameUtils.renderTerritories(attacking.name, window.gameState);
          window.gameUtils.renderTerritories(acquired.name, window.gameState);
          risqueAttackScheduleMirrorPush();
        }
      };
      /* Wheel is handled globally via setupAttackTroopTransferWheel while attackPhase === pending_transfer. */
      input.dispatchEvent(new Event('input'));
    }
  }

  if (selectOptions?.lossLimit) {
    const label = document.createElement('label');
    label.textContent = selectOptions.lossLimit.label || 'Loss limit';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'prompt-input';
    input.id = 'loss-limit-input';
    input.value = selectOptions.lossLimit.initial;
    input.min = String(selectOptions.lossLimit.min);
    extras.appendChild(label);
    extras.appendChild(input);
  }

  if (
    window.gameState &&
    String(window.gameState.phase) === "reinforce" &&
    typeof window.risqueReinforceHostApplyPrompt === "function"
  ) {
    window.risqueReinforceHostApplyPrompt(buttons);
  } else {
    for (let idx = 0; idx < 6; idx += 1) {
      const b = document.getElementById(`control-btn-${idx}`);
      if (!b) continue;
      const btn = buttons[idx];
      if (btn && (btn.label || btn.onClick)) {
        b.classList.remove('ucp-slot-empty');
        b.textContent = btn.label || '';
        b.title = btn.title != null && btn.title !== '' ? btn.title : (btn.label || '');
        if (btn.title != null && btn.title !== '') {
          b.setAttribute('aria-label', btn.title);
        } else {
          b.removeAttribute('aria-label');
        }
        b.disabled = !!btn.disabled;
        b.onclick = btn.disabled ? null : btn.onClick;
        const pulseSlots =
          selectOptions &&
          selectOptions.pulsePromptButtons &&
          !selectOptions.pulsePromptInputId &&
          btn &&
          btn.label &&
          !btn.disabled;
        if (pulseSlots) {
          b.classList.add('ucp-slot-ctl--pulse-attention');
        } else {
          b.classList.remove('ucp-slot-ctl--pulse-attention');
        }
      } else {
        b.classList.add('ucp-slot-empty');
        b.classList.remove('ucp-slot-ctl--pulse-attention');
        b.textContent = '';
        b.title = '';
        b.onclick = null;
        b.disabled = true;
      }
    }
    if (selectOptions && selectOptions.pulsePromptInputId) {
      const pin = document.getElementById(selectOptions.pulsePromptInputId);
      if (pin) {
        pin.classList.add('ucp-slot-strip-number--pulse-attention');
        try {
          pin.focus();
          if (typeof pin.select === 'function') pin.select();
        } catch (ePin) {
          /* ignore */
        }
        if (window.__risqueCondThresholdKeyHandler) {
          pin.removeEventListener('keydown', window.__risqueCondThresholdKeyHandler);
        }
        window.__risqueCondThresholdKeyHandler = function (e) {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const b0 = buttons[0];
          if (b0 && !b0.disabled && typeof b0.onClick === 'function') b0.onClick(e);
        };
        pin.addEventListener('keydown', window.__risqueCondThresholdKeyHandler);
      }
    }
  }

  syncHostAttackCardEarnedIndicator();

  try {
    if (document.body && window.gameState && String(window.gameState.phase) === "reinforce") {
      document.body.setAttribute(
        "data-risque-reinforce-slot-mode",
        buttons && buttons.length > 0 ? "prompt" : "main"
      );
    }
  } catch (eRfSlot) {
    /* ignore */
  }

  const plainForLog = promptMessageToMirrorPlain(message);
  logToStorage(`Prompt shown: ${plainForLog || message}`);

  if (window.gameState) {
    let primaryMirror = plainForLog.slice(0, 600);
    let reportMirror = report != null ? String(report).slice(0, 400) : '';
    let reportClassMirror = '';
    const cvm = selectOptions && selectOptions.controlVoiceMirror;
    if (cvm) {
      if (cvm.primary != null) primaryMirror = String(cvm.primary).slice(0, 600);
      if (cvm.report != null) reportMirror = String(cvm.report).slice(0, 400);
      reportClassMirror = cvm.reportClass != null ? String(cvm.reportClass) : '';
    } else if (String(message).indexOf('attack-blitz-fail-head') !== -1) {
      const lines = plainForLog.split('\n').map(l => l.trim()).filter(Boolean);
      primaryMirror = lines[0] || 'Blitz unsuccessful.';
      reportMirror = lines.slice(1).join(' ').trim();
      reportClassMirror = 'ucp-voice-report--public-blitz-fail';
    }
    window.gameState.risqueControlVoice = {
      primary: primaryMirror,
      report: reportMirror,
      reportClass: reportClassMirror
    };
    risqueAttackScheduleMirrorPush();
  }
}

window.risqueSharedDismissPrompt = dismissPrompt;
window.risqueSharedShowPrompt = showPrompt;

/** One attack roll using current attacker/defender and attackerDice preference. Does not mutate state. */
function simulateBattleRound() {
  if (!attacker || !defender) return null;

  const player = window.gameState.players.find(p => p.name === attacker.owner);
  const opponent = window.gameState.players.find(p => p.name === defender.owner);
  if (!player || !opponent) return null;
  const attackerTerritory = player.territories.find(t => t.name === attacker.label);
  const defenderTerritory = opponent.territories.find(t => t.name === defender.label);

  if (!attackerTerritory || !defenderTerritory) return null;

  const atkTroops = Math.max(0, Math.floor(Number(attackerTerritory.troops)));
  const defTroops = Math.max(0, Math.floor(Number(defenderTerritory.troops)));
  if (!Number.isFinite(atkTroops) || atkTroops < 2) return null;
  if (!Number.isFinite(defTroops) || defTroops < 1) return null;

  const maxAttackerDice = Math.min(atkTroops - 1, 3);
  const attackerDiceUsed = Math.min(attackerDice || maxAttackerDice, maxAttackerDice);
  const attackerRolls = Array.from({ length: attackerDiceUsed }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);
  const defenderDiceCount = Math.min(defTroops, 2);
  const defenderRolls = Array.from({ length: defenderDiceCount }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);

  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let i = 0; i < Math.min(attackerRolls.length, defenderRolls.length); i++) {
    if (attackerRolls[i] > defenderRolls[i]) defenderLosses++;
    else attackerLosses++;
  }

  return {
    player,
    opponent,
    attackerTerritory,
    defenderTerritory,
    maxAttackerDice,
    attackerDiceUsed,
    defenderDiceCount,
    attackerRolls,
    defenderRolls,
    attackerLosses,
    defenderLosses
  };
}

function startDiceSpinForSnap(snap) {
  const { attackerDiceUsed, defenderDiceCount } = snap;
  if (window.gameState) {
    window.gameState.risqueLastDiceDisplay = {
      spinning: true,
      attackerDiceUsed,
      defenderDiceCount
    };
  }
  for (let i = 0; i < 3; i++) {
    const rect = elements[`attackerDice${i}`];
    const text = elements[`attackerDiceText${i}`];
    if (rect && text) {
      rect.classList.remove('dice-rolling');
      text.classList.remove('dice-text-hidden', 'dice-text-visible');
      if (i < attackerDiceUsed) {
        rect.classList.add('dice-rolling');
        text.classList.add('dice-text-hidden');
        text.textContent = '';
      } else {
        text.textContent = '-';
      }
    }
  }
  for (let i = 0; i < 2; i++) {
    const rect = elements[`defenderDice${i}`];
    const text = elements[`defenderDiceText${i}`];
    if (rect && text) {
      rect.classList.remove('dice-rolling');
      text.classList.remove('dice-text-hidden', 'dice-text-visible');
      if (i < defenderDiceCount) {
        rect.classList.add('dice-rolling');
        text.classList.add('dice-text-hidden');
        text.textContent = '';
      } else {
        text.textContent = '-';
      }
    }
  }
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function revealDiceFromSnap(snap) {
  const { attackerRolls, defenderRolls, attackerDiceUsed, defenderDiceCount } = snap;
  for (let i = 0; i < 3; i++) {
    const rect = elements[`attackerDice${i}`];
    const text = elements[`attackerDiceText${i}`];
    if (rect && text) {
      rect.classList.remove('dice-rolling');
      if (i < attackerDiceUsed) {
        text.classList.remove('dice-text-hidden');
        text.classList.add('dice-text-visible');
        const v = attackerRolls[i];
        text.textContent = v != null ? String(v) : '—';
      } else {
        text.classList.remove('dice-text-hidden', 'dice-text-visible');
        text.textContent = '-';
      }
    }
  }
  for (let i = 0; i < 2; i++) {
    const rect = elements[`defenderDice${i}`];
    const text = elements[`defenderDiceText${i}`];
    if (rect && text) {
      rect.classList.remove('dice-rolling');
      if (i < defenderDiceCount) {
        text.classList.remove('dice-text-hidden');
        text.classList.add('dice-text-visible');
        const v = defenderRolls[i];
        text.textContent = v != null ? String(v) : '—';
      } else {
        text.classList.remove('dice-text-hidden', 'dice-text-visible');
        text.textContent = '-';
      }
    }
  }
  if (window.gameState && snap) {
    window.gameState.risqueLastDiceDisplay = {
      spinning: false,
      attackerRolls: attackerRolls.slice(),
      defenderRolls: defenderRolls.slice(),
      attackerDiceUsed: attackerDiceUsed,
      defenderDiceCount: defenderDiceCount
    };
  }
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

/**
 * Auto-finish transfer after capture (no slider UI). Same move math as initTroopTransfer / ALL BUT N.
 * @returns {{ ok: boolean, campaignHalted?: boolean }} campaignHalted: non-final campaign hop could not
 *   honor "leave N behind" (N>1) because only one troop remained on the source after the capture — caller
 *   should stop the campaign so multiple territories are not left with 1 by mistake.
 */
function autoCompleteTroopTransferLeaveBehind(leaveBehind, opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  const out = { ok: false, campaignHalted: false };
  const player = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
  if (!player || !window.gameState.attackingTerritory || !window.gameState.acquiredTerritory) return out;
  const attacking = player.territories.find(t => t.name === window.gameState.attackingTerritory.name);
  const acquired = player.territories.find(t => t.name === window.gameState.acquiredTerritory.name);
  if (!attacking || !acquired) return out;
  const minT = window.gameState.minTroopsToTransfer;
  let desired = Number(leaveBehind);
  if (!Number.isFinite(desired)) desired = 1;
  desired = Math.max(1, Math.floor(desired));
  const sourceTroopsSnapshot = attacking.troops;
  const maxAdd = Math.max(0, sourceTroopsSnapshot - 1);
  const effLeave = Math.min(desired, sourceTroopsSnapshot);
  const additional = Math.min(maxAdd, Math.max(0, sourceTroopsSnapshot - effLeave));
  const attackerInit = sourceTroopsSnapshot + minT;
  attacking.troops = attackerInit - minT - additional;
  acquired.troops = minT + additional;
  const totalToDest = minT + additional;

  const isLastCampaignHop = opts.isLastCampaignHop === true;
  const campaignAuto = !!opts.campaignAutoTransfer;
  if (campaignAuto && !isLastCampaignHop && desired > 1 && sourceTroopsSnapshot === 1) {
    out.campaignHalted = true;
  }

  if (risqueTransferPulseEnabledForCurrentMode(opts)) {
    risqueStartPostTransferDestinationPulse(acquired.name, minT, totalToDest);
  } else if (window.gameState && window.gameState.risqueTransferPulse) {
    delete window.gameState.risqueTransferPulse;
  }
  if (campaignAuto && campaignQDevMode) {
    prependCombatLog(
      `${player.name} moves ${totalToDest} troops after capture (leave ${attacking.troops} on source).`,
      'battle'
    );
    window.gameState.risquePublicAttackTransferSummary = `${player.name} transfers ${totalToDest} troops after capture.`;
  } else {
    prependCombatLog(
      `${player.name} moves ${totalToDest} troops into ${prettyTerritoryName(acquired.name)} (leave ${attacking.troops} on ${prettyTerritoryName(attacking.name)}).`,
      'battle'
    );
    window.gameState.risquePublicAttackTransferSummary = `${player.name} transfers ${totalToDest} troops from ${prettyTerritoryName(
      attacking.name
    )} to ${prettyTerritoryName(acquired.name)}.`;
  }
  if (typeof window.risqueReplayRecordBattle === 'function') {
    try {
      window.risqueReplayRecordBattle(window.gameState, {
        territoryCaptured: true,
        attackerName: player.name,
        defenderName:
          window.gameState.risqueCheapReplayLastDefender != null
            ? String(window.gameState.risqueCheapReplayLastDefender)
            : '',
        territoryName: acquired.name
      });
    } catch (eRep) {
      /* ignore */
    }
  }
  window.gameState.attackPhase = 'attack';
  window.gameState.attackingTerritory = null;
  window.gameState.acquiredTerritory = null;
  window.gameState.minTroopsToTransfer = 0;
  out.ok = true;
  return out;
}

/** Brief pause so the board/mirror can update before inline conquer.js celebration (flash + CTA). */
const RISQUE_CONQUEST_CELEBRATION_BEFORE_CTA_MS = 400;
let conquestCelebrationCtaTimer = null;

/**
 * After eliminating a defender from combat (and after post-capture troop transfer CONFIRM when
 * applicable): phases/conquer.js flashes celebration on host + TV, then host-only CTA → receivecard.
 */
function showAttackEliminatedProceedToConquerPrompt(attackerPlayer, defenderPlayer) {
  const gs0 = window.gameState;
  /* Only skip while the *deferred* elimination troop-transfer step is still open. A broad
   * pending_transfer check could fire after CONFIRM if state was stale/mirrored and would
   * swallow the celebration + card chain on later eliminations in the same session. */
  if (
    gs0 &&
    String(gs0.attackPhase || '') === 'pending_transfer' &&
    gs0.acquiredTerritory &&
    gs0.attackingTerritory &&
    gs0.risqueDeferConquerElimination
  ) {
    return;
  }
  if (typeof window.risqueConquerStartEliminationFlow === 'function') {
    window.risqueConquerStartEliminationFlow(attackerPlayer, defenderPlayer);
    return;
  }
  const atkName = attackerPlayer && attackerPlayer.name ? String(attackerPlayer.name) : '';
  const defName = defenderPlayer && defenderPlayer.name ? String(defenderPlayer.name) : '';
  if (window.gameState) {
    window.gameState.risqueConquestChainActive = true;
  }
  showPrompt(
    '<div class="attack-transfer-voice-line attack-transfer-voice-line--acquire">' +
      'Tap the flashing button to transfer ' +
      defName +
      "'s cards — then continue to card transfer.</div>",
    [
      {
        label: 'CONTINUE TO TRANSFER CARDS',
        title: 'Next: conquer step, then continental card transfer.',
        onClick: function () {
          dismissPrompt();
          if (window.gameState) {
            window.gameState.phase = 'conquer';
            window.gameState.risqueConquestChainActive = true;
            delete window.gameState.risquePublicEliminationBanner;
            delete window.gameState.risqueControlVoice;
            try {
              localStorage.setItem('gameState', JSON.stringify(window.gameState));
            } catch (eSave) {
              /* ignore */
            }
            if (typeof window.risqueMirrorPushGameState === 'function') {
              window.risqueMirrorPushGameState();
            }
          }
          window.location.href = risqueAttackDoc('conquer');
        }
      }
    ],
    {
      controlVoiceMirror: {
        primary:
          atkName +
          ' has conquered ' +
          defName +
          '.\nTap CONTINUE TO TRANSFER CARDS — ' +
          defName +
          "'s cards transfer next.",
        report: '',
        reportClass: 'ucp-voice-report ucp-voice-report--public-blitz-banner'
      },
      pulsePromptButtons: true
    },
    ''
  );
}

function scheduleAttackEliminatedProceedToConquerPrompt(attackerPlayer, defenderPlayer) {
  if (conquestCelebrationCtaTimer != null) {
    clearTimeout(conquestCelebrationCtaTimer);
    conquestCelebrationCtaTimer = null;
  }
  conquestCelebrationCtaTimer = setTimeout(function () {
    conquestCelebrationCtaTimer = null;
    showAttackEliminatedProceedToConquerPrompt(attackerPlayer, defenderPlayer);
  }, RISQUE_CONQUEST_CELEBRATION_BEFORE_CTA_MS);
}

/** Apply losses from snap and handle territory capture. Returns { conquered }. */
function applyBattleRoundAfterRoll(snap, opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  const skipBattleVoice = !!opts.skipBattleVoice;
  const skipLossFlash = !!opts.skipLossFlash;
  const instantBlitz = !!opts.instantBlitz;
  const combatLogLead = opts.combatLogLead != null ? String(opts.combatLogLead) : '';
  const {
    player,
    opponent,
    attackerTerritory,
    defenderTerritory,
    attackerDiceUsed,
    attackerLosses,
    defenderLosses
  } = snap;

  if (typeof window.risqueRecordAttackRoundLedger === "function") {
    try {
      window.risqueRecordAttackRoundLedger(window.gameState, snap);
    } catch (eLucky) {
      /* ignore */
    }
  }

  attackerDice = attackerDiceUsed;
  attackerTerritory.troops -= attackerLosses;
  defenderTerritory.troops -= defenderLosses;
  attacker.troops = attackerTerritory.troops;
  defender.troops = defenderTerritory.troops;
  if (window.gameState) {
    window.gameState.risqueAerialUnlockedAfterCombat = true;
  }

  if (window.gameState && !skipLossFlash) {
    if (battleLossFlashClearTimer) {
      clearTimeout(battleLossFlashClearTimer);
      battleLossFlashClearTimer = null;
    }
    const flash = [];
    if (attackerLosses > 0 && attackerTerritory.name) flash.push(attackerTerritory.name);
    if (defenderLosses > 0 && defenderTerritory.name) flash.push(defenderTerritory.name);
    if (flash.length) {
      window.gameState.risqueBattleLossFlashLabels = flash;
      scheduleBattleLossFlashClear();
      risqueAttackScheduleMirrorPush();
    } else {
      delete window.gameState.risqueBattleLossFlashLabels;
    }
  }

  updateBattlePanelReadout();
  const outcomeFriendly = formatBattleOutcomeFriendly(
    attacker.owner,
    defender.owner,
    attackerLosses,
    defenderLosses
  );
  const diceDetail = `${attacker.owner} rolled ${snap.attackerRolls.join(', ')}. ${defender.owner} rolled ${snap.defenderRolls.join(', ')}.`;
  const outcomeU = outcomeFriendly.toUpperCase();
  const diceDetailU = diceDetail.toUpperCase();
  if (window.gameState) {
    window.gameState.risquePublicAttackSelectionLine = '';
    /* Automated chains (campaign, instant COND rolls): never leave per-roll readout — public TV uses
     * useBattleReadout and would hide control voice (e.g. campaign success / unsuccessful lines). */
    if (!instantBlitz && !skipBattleVoice) {
      window.gameState.risqueAttackOutcomePrimary = outcomeU;
      window.gameState.risqueAttackOutcomeReport = diceDetailU;
    } else if (!instantBlitz && skipBattleVoice) {
      window.gameState.risqueAttackOutcomePrimary = '';
      window.gameState.risqueAttackOutcomeReport = '';
    }
    window.gameState.risqueAttackOutcomeAcquisition = '';
    const voiceThisRound =
      !instantBlitz && (!skipBattleVoice || defenderTerritory.troops <= 0);
    if (
      voiceThisRound &&
      window.risqueRuntimeHud &&
      typeof window.risqueRuntimeHud.setControlVoiceText === 'function'
    ) {
      window.risqueRuntimeHud.setControlVoiceText(outcomeU, diceDetailU, { force: true });
    }
  }
  const diceLogOnly = formatDiceOnlyCombatLogLine(snap, combatLogLead);
  if (diceLogOnly) prependCombatLog(diceLogOnly, 'battle');
  prependCombatLog(outcomeFriendly, 'battle');
  updatePlayerTroopsTotal(player);
  updatePlayerTroopsTotal(opponent);

  if (defenderTerritory.troops <= 0) {
    isAcquiring = true;
    minTroopsToTransfer = Math.min(attackerDiceUsed, 3);
    maxTroopsToTransfer = Math.max(0, attackerTerritory.troops - 1);
    attackerInitialTroops = attackerTerritory.troops + minTroopsToTransfer;
    attackerTerritory.troops -= minTroopsToTransfer;
    attacker.troops = attackerTerritory.troops;
    opponent.territories = opponent.territories.filter(t => t.name !== defenderTerritory.name);
    player.territories.push({ name: defenderTerritory.name, troops: minTroopsToTransfer });
    if (
      window.gameUtils &&
      typeof window.gameUtils.recordConquestTerritoryCapture === 'function'
    ) {
      window.gameUtils.recordConquestTerritoryCapture(window.gameState, defenderTerritory.name);
    }
    window.gameState.cardEarnedViaAttack = true;
    requestAnimationFrame(function () {
      if (typeof window.risqueSyncHostAttackCardEarnedIndicator === 'function') {
        window.risqueSyncHostAttackCardEarnedIndicator();
      }
    });
    window.gameState.conqueredThisTurn = true;
    try {
      window.gameState.risqueCheapReplayLastDefender = String(opponent.name || '');
    } catch (eDefCap) {
      /* ignore */
    }
    window.gameState.attackingTerritory = { name: attackerTerritory.name, troops: attackerTerritory.troops };
    window.gameState.acquiredTerritory = { name: defenderTerritory.name, troops: minTroopsToTransfer };
    window.gameState.minTroopsToTransfer = minTroopsToTransfer;
    prependCombatLog(
      `${player.name} captures ${prettyTerritoryName(defenderTerritory.name)}.`,
      'system'
    );
    const acqPretty = prettyTerritoryName(defenderTerritory.name);
    window.gameState.risqueAttackOutcomeAcquisition = `YOU HAVE ACQUIRED ${acqPretty.toUpperCase()}.`;

    if (instantBlitz) {
      window.gameState.risqueInstantBlitzTransferUi = true;
    }

    /* Tier 5 still: capture after troop transfer (not mid pending_transfer). Granular tape records here. */
    if (typeof window.risqueReplayRecordBattle === 'function') {
      try {
        window.risqueReplayRecordBattle(window.gameState, { skipIfPendingTransfer: true });
      } catch (eRep) {
        /* ignore */
      }
    }

    if (opts.campaignAutoTransfer) {
      const pathLen = opts.campaignPathLength;
      const hopIdx = opts.campaignHopIndex;
      const isLastCampaignHop =
        typeof pathLen === 'number' &&
        typeof hopIdx === 'number' &&
        pathLen >= 2 &&
        hopIdx === pathLen - 2;
      const leaveN =
        campaignQDevMode || opts.qDevTransferAllButOne
          ? 1
          : opts.campaignLeaveBehind != null
            ? opts.campaignLeaveBehind
            : campaignPreferredGarrison;
      const transferRes = autoCompleteTroopTransferLeaveBehind(leaveN, {
        campaignAutoTransfer: true,
        isLastCampaignHop,
        disableTransferPulse: campaignType === 'instant' || campaignQDevMode
      });
      isAcquiring = false;
      saveGameState();
      if (typeof window.risqueMirrorPushGameState === 'function') {
        window.risqueMirrorPushGameState();
      }
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
      /* Battle tape: capture frame above + autoCompleteTroopTransferLeaveBehind's record — avoid third duplicate here. */
      const eliminated = checkPlayerElimination(opponent);
      if (eliminated) {
        window.gameState.risqueCampaignInterruptedByElimination = true;
        if (window.gameState.turnOrder.length === 1) {
          scheduleImmediateGameWinAfterElimination(player, opponent, true);
          return { conquered: true, campaignHalted: false, campaignInterruptedByElimination: true };
        }
        scheduleAttackEliminatedProceedToConquerPrompt(player, opponent);
        return { conquered: true, campaignHalted: false, campaignInterruptedByElimination: true };
      } else {
        checkWinCondition();
      }
      return { conquered: true, campaignHalted: !!(transferRes && transferRes.campaignHalted) };
    }

    window.gameState.attackPhase = 'pending_transfer';
    saveGameState();
    window.gameUtils.renderTerritories(null, window.gameState);
    window.gameUtils.renderStats(window.gameState);
    const eliminated = checkPlayerElimination(opponent);
    if (eliminated) {
      window.gameState.risqueInstantBlitzTransferUi = false;
      isAcquiring = false;
      if (window.gameState.turnOrder.length === 1) {
        scheduleImmediateGameWinAfterElimination(player, opponent, false);
        return { conquered: true };
      }
      /* Elimination: finish the same post-capture troop UI as a normal capture, then run conquer
       * celebration (risqueDeferredEliminationConquerPrompt → scheduleAttackEliminated… on CONFIRM). */
      risqueDeferredEliminationConquerPrompt = {
        attackerName: player.name,
        defenderName: opponent.name
      };
      window.gameState.risqueDeferConquerElimination = {
        attackerName: player.name,
        defenderName: opponent.name
      };
      saveGameState();
      if (typeof window.risqueMirrorPushGameState === 'function') {
        window.risqueMirrorPushGameState();
      }
      initTroopTransfer();
      return { conquered: true };
    }
    initTroopTransfer();
    checkWinCondition();
    return { conquered: true };
  }

  if (typeof window.risqueReplayRecordBattle === 'function') {
    try {
      window.risqueReplayRecordBattle(window.gameState, {
        territoryCaptured: false,
        attackerName: player.name,
        defenderName: opponent.name,
        territoryName: defenderTerritory.name
      });
    } catch (eRep) {
      /* ignore */
    }
  }

  hasAttacked = true;
  saveGameState();
  window.gameUtils.renderTerritories(null, window.gameState);
  window.gameUtils.renderStats(window.gameState);
  return { conquered: false };
}

function clearPausableBlitzRoundTimers() {
  if (pausableBlitzInterval) {
    clearInterval(pausableBlitzInterval);
    pausableBlitzInterval = null;
  }
  if (pausableBlitzGapTimer) {
    clearTimeout(pausableBlitzGapTimer);
    pausableBlitzGapTimer = null;
  }
  if (pausableBlitzRevealTimer) {
    clearTimeout(pausableBlitzRevealTimer);
    pausableBlitzRevealTimer = null;
  }
}

function stopPausableBlitzInternal() {
  clearPausableBlitzRoundTimers();
  pausableBlitzCondThreshold = null;
  isPausableBlitzActive = false;
  isPausableBlitzPaused = false;
  if (window.gameState) {
    delete window.gameState.risquePublicPausableBlitzPaused;
    delete window.gameState.risqueHostAttackStepStripActive;
  }
  clearConditionCountdownMirror();
  if (elements.pausableBlitzText) elements.pausableBlitzText.textContent = 'PBLZ';
  syncPausableBlitzButtonVisibility();
  pushConditionCountdownRefresh();
}

function schedulePausableBlitzGap() {
  if (!isPausableBlitzActive || isPausableBlitzPaused) return;
  if (pausableBlitzGapTimer) clearTimeout(pausableBlitzGapTimer);
  pausableBlitzGapTimer = setTimeout(() => {
    pausableBlitzGapTimer = null;
    pausableBlitzTick();
  }, PAUSABLE_BLITZ_GAP_AFTER_REVEAL_MS);
}

/** While setting the stop-at number: pulse the numeric field only; clear TV selection line. */
const PROMPT_OPTS_COND_INPUT = { pulsePromptInputId: 'cond-threshold', clearPublicAttackSelectionLine: true };
/** After the number is set: pulse the Confirmed / Begin slot (same as other attack prompts). */
const PROMPT_OPTS_COND_ACTION = { pulsePromptButtons: true, clearPublicAttackSelectionLine: true };

function showConditionMetOkPrompt() {
  clearConditionCountdownMirror();
  if (window.gameState) {
    window.gameState.risquePublicAttackSelectionLine = '';
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
  }
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText('Condition has been met.', 'Blitz stopped.', { force: true });
  }
  showPrompt(
    'Condition has been met.',
    [
      {
        label: 'OK',
        onClick: () => {
          resetAttackNumericInputs();
          dismissPrompt();
        }
      }
    ],
    {
      ...PROMPT_OPTS_COND_ACTION,
      controlVoiceMirror: {
        primary: 'Condition has been met.',
        report: 'Blitz stopped.',
        reportClass: 'ucp-voice-report ucp-voice-report--public-campaign-end'
      }
    },
    'Blitz stopped.'
  );
}

function pausableConditionalStopMet() {
  const t = pausableBlitzCondThreshold;
  stopPausableBlitzInternal();
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  prependCombatLog(
    `${cur}: CONDITIONAL STOP — attacking stack ≤ ${t != null ? t : '?'}.`,
    'voice'
  );
  showConditionMetOkPrompt();
}

function rollDice() {
  if (window.gameState && String(window.gameState.attackPhase || '') === 'pending_transfer') {
    return { attackerLosses: 0, defenderLosses: 0 };
  }
  stopPauseCampaignExecutionInternal();
  const snap = simulateBattleRound();
  if (!snap) {
    showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
    return { attackerLosses: 0, defenderLosses: 0 };
  }

  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  const atkN = prettyTerritoryName(attacker.label);
  const defN = prettyTerritoryName(defender.label);
  const singleRollLogLead = `${cur}: single roll — ${atkN} attacks ${defN}. `;
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(
      String(cur).toUpperCase(),
      `Single roll: ${atkN} → ${defN}.`,
      { force: true }
    );
  }

  const { maxAttackerDice } = snap;
  startDiceSpinForSnap(snap);

  singleRollRevealTimer = setTimeout(() => {
    singleRollRevealTimer = null;
    revealDiceFromSnap(snap);
    const result = applyBattleRoundAfterRoll(snap, { combatLogLead: singleRollLogLead });
    if (!result.conquered) {
      const fp = (window.gameState && window.gameState.risqueAttackOutcomePrimary) || '';
      const fr = (window.gameState && window.gameState.risqueAttackOutcomeReport) || '';
      showPrompt(
        `<strong>${fp}</strong><br>Refer to the buttons above for attack choices.`,
        [{ label: 'Cancel', onClick: cancelAttack }],
        {
          attacker: Array.from({ length: maxAttackerDice }, (_, i) => ({
            value: i + 1,
            label: `${i + 1} Dice`
          }))
        },
        fr
      );
    }
  }, 500);

  return { attackerLosses: snap.attackerLosses, defenderLosses: snap.defenderLosses };
}

/** Finish pending transfer after capture (additional troops beyond mandatory min). */
function completeTroopTransferFromPending(additional) {
  const player = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
  if (!player || !window.gameState.attackingTerritory || !window.gameState.acquiredTerritory) return false;
  const attacking = player.territories.find(t => t.name === window.gameState.attackingTerritory.name);
  const acquired = player.territories.find(t => t.name === window.gameState.acquiredTerritory.name);
  if (!attacking || !acquired) return false;
  const minT = window.gameState.minTroopsToTransfer;
  const add = Math.max(0, Math.floor(Number(additional)) || 0);
  const fromPulse = minT;
  const toPulse = minT + add;
  attacking.troops = attackerInitialTroops - minT - add;
  acquired.troops = toPulse;
  const totalToDest = toPulse;
  if (risqueTransferPulseEnabledForCurrentMode({})) {
    risqueStartPostTransferDestinationPulse(acquired.name, fromPulse, toPulse);
  } else if (window.gameState && window.gameState.risqueTransferPulse) {
    delete window.gameState.risqueTransferPulse;
  }
  transferCompleted = true;
  window.gameState.attackPhase = 'attack';
  window.gameState.attackingTerritory = null;
  window.gameState.acquiredTerritory = null;
  window.gameState.minTroopsToTransfer = 0;
  window.gameState.risqueInstantBlitzTransferUi = false;
  try {
    delete window.gameState.risquePublicTransferMirrorSeal;
  } catch (eRmSeal) {
    /* ignore */
  }
  saveGameState();
  prependCombatLog(
    `${player.name} transfers ${totalToDest} troops to ${prettyTerritoryName(acquired.name)}.`,
    'battle'
  );
  const deferredElimSnapshot =
    risqueDeferredEliminationConquerPrompt || window.gameState.risqueDeferConquerElimination || null;
  dismissPrompt();
  cancelAttack();
  window.gameState.risquePublicAttackTransferSummary = `${player.name} transfers ${totalToDest} troops from ${prettyTerritoryName(
    attacking.name
  )} to ${prettyTerritoryName(acquired.name)}.`;
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  saveGameState();
  if (typeof window.risqueReplayRecordBattle === 'function') {
    try {
      var defNm =
        deferredElimSnapshot && deferredElimSnapshot.defenderName
          ? String(deferredElimSnapshot.defenderName)
          : window.gameState.risqueCheapReplayLastDefender != null
            ? String(window.gameState.risqueCheapReplayLastDefender)
            : '';
      window.risqueReplayRecordBattle(window.gameState, {
        territoryCaptured: true,
        attackerName: player.name,
        defenderName: defNm,
        territoryName: acquired.name
      });
    } catch (eRep) {
      /* ignore */
    }
  }
  if (deferredElimSnapshot) {
    risqueDeferredEliminationConquerPrompt = null;
    delete window.gameState.risqueDeferConquerElimination;
    const atkP = window.gameState.players.find(p => p.name === deferredElimSnapshot.attackerName);
    let defP = window.gameState.players.find(p => p.name === deferredElimSnapshot.defenderName);
    if (!defP && deferredElimSnapshot.defenderName) {
      defP = {
        name: String(deferredElimSnapshot.defenderName),
        territories: [],
        cards: []
      };
    }
    if (atkP && defP) {
      scheduleAttackEliminatedProceedToConquerPrompt(atkP, defP);
    }
  }
  return true;
}

/** Q BLITZ shortcuts: extra troops to move onto capture after instant blitz (beyond minT). */
function qDevBlitzSourceTroopsSnapshot() {
  const player = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
  if (!player || !window.gameState.attackingTerritory) return 0;
  const attacking = player.territories.find(t => t.name === window.gameState.attackingTerritory.name);
  if (!attacking) return 0;
  const minT = window.gameState.minTroopsToTransfer;
  return Math.max(0, (attackerInitialTroops || attacking.troops + minT) - minT);
}

/** @param {'leave3'|'take3'} mode */
function qDevBlitzAdditionalTroopsForMode(mode) {
  const sourceTroopsSnapshot = qDevBlitzSourceTroopsSnapshot();
  const minT =
    window.gameState && window.gameState.minTroopsToTransfer != null
      ? window.gameState.minTroopsToTransfer
      : minTroopsToTransfer || 0;
  if (mode === 'take3') {
    /* Up to 3 troops on the capture total (mandatory minT already counts toward that cap). */
    const maxAdditional = Math.max(0, 3 - minT);
    return Math.min(maxAdditional, Math.max(0, sourceTroopsSnapshot));
  }
  if (mode === 'leave3') {
    return Math.max(0, sourceTroopsSnapshot - 3);
  }
  return Math.max(0, sourceTroopsSnapshot - 1);
}

async function executeQBlitzQuick(transferMode) {
  if (!attacker || !defender) {
    prependCombatLog('Q Blitz: select your territory, then a target to attack.', 'system');
    return;
  }
  if (window.gameState && String(window.gameState.attackPhase || '') === 'pending_transfer') {
    return;
  }
  closeBlitzDropdown();
  closeCampaignDropdown();
  dismissPrompt();
  if (window.gameState) {
    window.gameState.risqueQDevBlitzAutoTransfer = true;
    window.gameState.risqueQDevBlitzTransferMode = transferMode === 'take3' ? 'take3' : 'leave3';
  }
  try {
    await blitz();
  } finally {
    if (window.gameState) {
      delete window.gameState.risqueQDevBlitzAutoTransfer;
      delete window.gameState.risqueQDevBlitzTransferMode;
    }
  }
}

function startQDevCampaignPlanning() {
  campaignQDevMode = true;
  startInstantCampaignPlanning({ qDev: true });
}

function launchQDevCampaignRun() {
  if (!campaignQDevMode || !campaignPath || campaignPath.length < 2) {
    prependCombatLog('Q Camp: path needs launch + at least one enemy territory.', 'system');
    return;
  }
  dismissPrompt({ keepInstantCampaignHud: true });
  instantCampaignGarrison = 1;
  campaignPreferredGarrison = 1;
  performInstantCommitFromKeys();
  void runInstantCampaignExecution().catch(function (e) {
    try {
      console.error('[Attack] Q Camp run failed', e);
    } catch (e2) {
      /* ignore */
    }
  });
}

function showQDevCampaignConfirmPrompt() {
  if (!campaignQDevMode || campaignType !== 'instant') return;
  if (campaignMode !== 'instant_extend' || !campaignPath || campaignPath.length < 2) return;
  showPrompt(
    'Start Q Camp? Leaves 1 troop on the attacking territory after each capture.',
    [
      { label: 'CONFIRM', title: 'Start campaign (leave 1 on each capture)', onClick: launchQDevCampaignRun },
      {
        label: 'BACK',
        title: 'Keep editing path on the map',
        onClick: () => dismissPrompt({ keepInstantCampaignHud: true })
      }
    ]
  );
  risqueStartConfirmSlotFlash();
}

function finishQDevCampaignAfterRun() {
  campaignQDevMode = false;
  clearAttackCampaignPlanningAfterRun();
  dismissPrompt();
  if (window.gameState) {
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
    window.gameState.risqueAttackOutcomeAcquisition = '';
    window.gameState.risquePublicAttackTransferSummary = '';
  }
  showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
  syncAttackPhaseActionLocks();
  if (window.gameUtils && window.gameState) {
    window.gameUtils.renderTerritories(null, window.gameState);
    window.gameUtils.renderStats(window.gameState);
  }
}

function onQCampDevClick() {
  closeBlitzDropdown();
  closeCampaignDropdown();
  if (campaignQDevMode) {
    campaignQDevMode = false;
    dismissPrompt();
    resetInstantCampaignPlanning();
    return;
  }
  startQDevCampaignPlanning();
}

async function blitz() {
  if (window.gameState && String(window.gameState.attackPhase || '') === 'pending_transfer') {
    return;
  }
  stopPausableBlitzInternal();
  stopPauseCampaignExecutionInternal();
  clearBattleLossFlashNow();
  if (!attacker || !defender) return;

  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  publishPublicBattleBanner(`${cur} has initiated a Blitz · Instant`);
  prependCombatLog(
    `${cur}: INSTANT BLITZ — ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(defender.label)}.`,
    'voice'
  );
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Instant blitz running…', { force: true });
  }

  let roundCount = 0;
  let lastSnap = null;
  let conquered = false;

  while (attacker.troops > 1 && defender.troops > 0) {
    const snap = simulateBattleRound();
    if (!snap) return;
    lastSnap = snap;
    roundCount += 1;
    const result = applyBattleRoundAfterRoll(snap, {
      skipBattleVoice: true,
      skipLossFlash: false,
      instantBlitz: true
    });
    if (result.conquered) {
      conquered = true;
      break;
    }
    await instantCombatRoundDelay();
  }

  if (roundCount) {
    prependCombatLog(`Blitz completed (${roundCount} round${roundCount === 1 ? '' : 's'}).`, 'system');
  }
  logToStorage(`Blitz complete`, { rounds: roundCount, conquered });

  if (!lastSnap || conquered) return;

  if (window.gameState) {
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
  }

  resetAttackDiceUI();
  showPrompt(
    blitzUnsuccessfulPromptHtml(defender.owner, defender.label),
    [{ label: 'Cancel', onClick: cancelAttack }],
    null,
    ''
  );
}

function readCondThresholdFromInput() {
  const thresholdInput = document.getElementById('cond-threshold');
  let threshold = parseInt(thresholdInput && thresholdInput.value !== '' ? thresholdInput.value : 'NaN', 10);
  if (isNaN(threshold) || threshold < 1) threshold = 5;
  return threshold;
}

/**
 * Same strip field as Blitz Step Con ({@link readCondThresholdFromInput}) but no default —
 * returns null if empty or invalid so the host must enter a number.
 */
function readCondThresholdFromInputRequired() {
  const thresholdInput = document.getElementById('cond-threshold');
  const raw = thresholdInput && thresholdInput.value !== '' ? thresholdInput.value : '';
  const v = parseInt(raw, 10);
  if (raw === '' || isNaN(v) || v < 1) return null;
  return Math.max(1, Math.min(99, v));
}

function beginConditionalBlitzPrep(mode) {
  if (!attacker || !defender) return;
  stopPausableBlitzInternal();
  stopPauseCampaignExecutionInternal();
  clearBattleLossFlashNow();
  pendingConditionalThreshold = null;
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  prependCombatLog(`${cur}: conditional blitz (${mode}) — set condition.`, 'voice');
  showPrompt(
    'Set the condition.',
    [
      {
        label: 'Confirmed',
        onClick: () => {
          pendingConditionalThreshold = readCondThresholdFromInput();
          const condN = pendingConditionalThreshold;
          showPrompt(
            'Begin attack.',
            [
              {
                label: 'Begin attack',
                onClick: () => {
                  const t = pendingConditionalThreshold;
                  const curB = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
                  const kind = mode === 'instant' ? 'Instant COND' : 'Blitz Step Con';
                  publishPublicBattleBanner(`${curB} has initiated a Blitz · ${kind}`);
                  pendingConditionalThreshold = null;
                  dismissPrompt();
                  if (mode === 'instant') {
                    void executeInstantConditionalBlitz(t);
                  } else {
                    startPausableConditionalBlitz(t);
                  }
                }
              }
            ],
            {
              ...PROMPT_OPTS_COND_ACTION,
              controlVoiceMirror: {
                primary: 'The condition has been set.',
                report: String(condN),
                reportClass: 'ucp-voice-report--public-blitz-banner'
              }
            }
          );
        }
      }
    ],
    {
      ...PROMPT_OPTS_COND_INPUT,
      controlVoiceMirror: {
        primary:
          mode === 'pause'
            ? `${cur} is initializing Blitz Step with conditions.`
            : `${cur} is initializing Instant COND with conditions.`,
        report: '',
        reportClass: ''
      }
    }
  );
}

function startPausableConditionalBlitz(threshold) {
  if (!attacker || !defender) return;
  stopPausableBlitzInternal();
  stopPauseCampaignExecutionInternal();
  clearBattleLossFlashNow();
  pausableBlitzCondThreshold = threshold;
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  prependCombatLog(
    `${cur}: BLITZ STEP CON — stop when attacking stack ≤ ${threshold} — ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(defender.label)}.`,
    'voice'
  );
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(
      String(cur).toUpperCase(),
      `Blitz Step Con · stop at ≤ ${threshold} on attacker`,
      { force: true }
    );
  }
  isPausableBlitzActive = true;
  isPausableBlitzPaused = false;
  if (window.gameState) {
    window.gameState.risqueHostAttackStepStripActive = true;
  }
  if (elements.pausableBlitzText) elements.pausableBlitzText.textContent = 'II';
  syncConditionCountdownMirror();
  pausableBlitzTick();
  syncPausableBlitzButtonVisibility();
}

/** Instant / COND: resolve rolls after Begin attack at {@link INSTANT_COMBAT_MS_PER_ROUND} cadence (troop flash). */
async function executeInstantConditionalBlitz(threshold) {
  if (!attacker || !defender) return;

  stopPausableBlitzInternal();
  stopPauseCampaignExecutionInternal();
  clearBattleLossFlashNow();

  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  prependCombatLog(
    `${cur}: INSTANT COND — stop when attacking stack ≤ ${threshold} — ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(defender.label)}.`,
    'voice'
  );
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), `Instant COND · stop at ≤ ${threshold} on attacker`, {
      force: true
    });
  }

  if (attacker.troops <= threshold) {
    showConditionMetOkPrompt();
    return;
  }

  let rounds = 0;
  let lastSnap = null;
  let conquered = false;

  try {
    syncConditionCountdownMirror({ threshold });
    while (attacker.troops > 1 && defender.troops > 0 && attacker.troops > threshold) {
      const snap = simulateBattleRound();
      if (!snap) break;
      lastSnap = snap;
      rounds += 1;
      const result = applyBattleRoundAfterRoll(snap, {
        skipBattleVoice: true,
        skipLossFlash: false,
        instantBlitz: true
      });
      syncConditionCountdownMirror({ threshold });
      if (result.conquered) {
        conquered = true;
        break;
      }
      await instantCombatRoundDelay();
    }
  } finally {
    clearConditionCountdownMirror();
    pushConditionCountdownRefresh();
  }

  prependCombatLog(
    `Instant COND finished (${rounds} round${rounds === 1 ? '' : 's'}, threshold ${threshold}).`,
    'system'
  );
  logToStorage('Instant conditional blitz complete', { rounds, conquered, threshold });

  if (conquered) {
    resetAttackNumericInputs();
    return;
  }

  if (attacker.troops <= threshold) {
    showConditionMetOkPrompt();
    return;
  }

  if (!lastSnap) {
    showPrompt('Conditional blitz could not continue.', [
      {
        label: 'OK',
        onClick: () => {
          resetAttackNumericInputs();
          dismissPrompt();
        }
      }
    ]);
    return;
  }

  if (attacker && defender && lastSnap) {
    const friendly = formatBattleOutcomeFriendly(
      attacker.owner,
      defender.owner,
      lastSnap.attackerLosses,
      lastSnap.defenderLosses
    );
    const diceLine = `${attacker.owner} rolled ${lastSnap.attackerRolls.join(', ')}. ${defender.owner} rolled ${lastSnap.defenderRolls.join(', ')}.`;
    if (window.gameState) {
      window.gameState.risqueAttackOutcomePrimary = friendly;
      window.gameState.risqueAttackOutcomeReport = diceLine;
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(friendly, diceLine, { force: true });
    }
  }

  startDiceSpinForSnap(lastSnap);
  setTimeout(() => {
    revealDiceFromSnap(lastSnap);
    const fp = (window.gameState && window.gameState.risqueAttackOutcomePrimary) || '';
    const fr = (window.gameState && window.gameState.risqueAttackOutcomeReport) || '';
    showPrompt(
      `<strong>${fp}</strong><br>Conditional blitz stopped — OK to continue.`,
      [
        {
          label: 'OK',
          onClick: () => {
            resetAttackNumericInputs();
            dismissPrompt();
          }
        }
      ],
      null,
      fr
    );
  }, PAUSABLE_BLITZ_SPIN_MS);
}

/** Blitz Step (non-conditional): start timers, public “initiated” banner, first combat tick. */
function startPausableBlitzRun() {
  if (!attacker || !defender) return;
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  isPausableBlitzActive = true;
  isPausableBlitzPaused = false;
  if (window.gameState) {
    delete window.gameState.risquePublicPausableBlitzPaused;
    window.gameState.risqueHostAttackStepStripActive = true;
  }
  if (elements.pausableBlitzText) elements.pausableBlitzText.textContent = 'II';
  publishPublicBattleBanner(`${cur} has initiated a Blitz · Blitz Step`);
  prependCombatLog(
    `${cur}: BLITZ STEP started — ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(defender.label)}.`,
    'voice'
  );
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Blitz Step (timed rounds).', { force: true });
  }
  pausableBlitzTick();
  syncPausableBlitzButtonVisibility();
}

/**
 * Blitz menu: Instant — public “initiating” line, then flashing confirm before {@link blitz} runs.
 */
function beginInstantBlitzPrep() {
  if (!attacker || !defender) return;
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  showPrompt(
    'Confirm to start Instant Blitz — rolls resolve automatically until this battle stops.',
    [
      {
        label: 'Confirm',
        title: 'Begin Instant Blitz',
        onClick: () => {
          dismissPrompt();
          void blitz();
        }
      }
    ],
    {
      ...PROMPT_OPTS_COND_ACTION,
      controlVoiceMirror: {
        primary: `${cur} is initiating an Instant Blitz.`,
        report: '',
        reportClass: ''
      }
    },
    ''
  );
}

/**
 * From the Blitz menu: Blitz Step without conditional — wait for “Begin attack” before rolling.
 * If Blitz Step is already active, delegates to {@link pausableBlitz} (pause / resume).
 */
function beginBlitzStepPrep() {
  if (!attacker || !defender) return;
  if (isPausableBlitzActive) {
    pausableBlitz();
    return;
  }
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  showPrompt(
    'Begin Blitz Step when you are ready.',
    [
      {
        label: 'Begin attack',
        onClick: () => {
          dismissPrompt();
          startPausableBlitzRun();
        }
      }
    ],
    {
      ...PROMPT_OPTS_COND_ACTION,
      controlVoiceMirror: {
        primary: `${cur} has initialized Blitz Step. Waiting to begin the attack.`,
        report: '',
        reportClass: ''
      }
    },
    ''
  );
}

function pausableBlitzTick() {
  if (!isPausableBlitzActive || isPausableBlitzPaused) return;
  if (!attacker || !defender) {
    stopPausableBlitzInternal();
    return;
  }
  if (pausableBlitzCondThreshold != null && attacker.troops <= pausableBlitzCondThreshold) {
    pausableConditionalStopMet();
    return;
  }
  if (defender.troops <= 0) {
    stopPausableBlitzInternal();
    return;
  }
  if (pausableBlitzCondThreshold != null) {
    syncConditionCountdownMirror();
  }
  if (attacker.troops <= 1 && defender.troops > 0) {
    const dOwner = defender.owner;
    const dLabel = defender.label;
    stopPausableBlitzInternal();
    if (window.gameState) {
      window.gameState.risqueAttackOutcomePrimary = '';
      window.gameState.risqueAttackOutcomeReport = '';
    }
    resetAttackDiceUI();
    showPrompt(
      blitzUnsuccessfulPromptHtml(dOwner, dLabel),
      [{ label: 'Cancel', onClick: cancelAttack }],
      null,
      ''
    );
    return;
  }
  const snap = simulateBattleRound();
  if (!snap) {
    stopPausableBlitzInternal();
    return;
  }
  startDiceSpinForSnap(snap);
  if (pausableBlitzRevealTimer) clearTimeout(pausableBlitzRevealTimer);
  pausableBlitzRevealTimer = setTimeout(() => {
    pausableBlitzRevealTimer = null;
    if (!isPausableBlitzActive || isPausableBlitzPaused) return;
    revealDiceFromSnap(snap);
    const result = applyBattleRoundAfterRoll(snap, {
      skipBattleVoice: true,
      instantBlitz: true
    });
    if (pausableBlitzCondThreshold != null) {
      syncConditionCountdownMirror();
    }
    if (pausableBlitzCondThreshold != null && attacker && attacker.troops <= pausableBlitzCondThreshold) {
      pausableConditionalStopMet();
      return;
    }
    if (result.conquered) {
      stopPausableBlitzInternal();
      return;
    }
    if (!isPausableBlitzActive || isPausableBlitzPaused) return;
    schedulePausableBlitzGap();
  }, PAUSABLE_BLITZ_SPIN_MS);
}

function pausableBlitz() {
  if (!attacker || !defender) return;
  stopPauseCampaignExecutionInternal();

  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';

  if (isPausableBlitzActive && !isPausableBlitzPaused) {
    clearPausableBlitzRoundTimers();
    isPausableBlitzPaused = true;
    if (elements.pausableBlitzText) elements.pausableBlitzText.textContent = 'GO';
    prependCombatLog(`${cur}: Blitz Step PAUSED.`, 'voice');
    if (window.gameState) {
      window.gameState.risquePublicPausableBlitzPaused = `${String(cur).toUpperCase()} · Blitz Step paused`;
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Blitz Step paused.', { force: true });
    }
    if (attacker.troops > 1 && defender.troops > 0) {
      const maxAttackerDice = Math.min(attacker.troops - 1, 3);
      showPrompt('Blitz Step paused.', [{ label: 'Cancel', onClick: cancelAttack }], {
        attacker: Array.from({ length: maxAttackerDice }, (_, i) => ({ value: i + 1, label: `${i + 1} Dice` }))
      });
    }
    syncPausableBlitzButtonVisibility();
    if (typeof window.risqueMirrorPushGameState === 'function') {
      window.risqueMirrorPushGameState();
    }
    return;
  }

  if (isPausableBlitzActive && isPausableBlitzPaused) {
    isPausableBlitzPaused = false;
    if (elements.pausableBlitzText) elements.pausableBlitzText.textContent = 'II';
    prependCombatLog(`${cur}: Blitz Step RESUMED.`, 'voice');
    if (window.gameState) {
      delete window.gameState.risquePublicPausableBlitzPaused;
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Blitz Step resumed.', { force: true });
    }
    dismissPrompt();
    pausableBlitzTick();
    syncPausableBlitzButtonVisibility();
    if (typeof window.risqueMirrorPushGameState === 'function') {
      window.risqueMirrorPushGameState();
    }
    return;
  }

  /* Idle: non-conditional Blitz Step begins only from the menu → beginBlitzStepPrep → Begin attack. */
}

function clearInvalidAttackTransferState() {
  risqueDeferredEliminationConquerPrompt = null;
  if (window.gameState) delete window.gameState.risqueDeferConquerElimination;
  teardownAttackTroopTransferWheel();
  window.gameState.attackPhase = 'attack';
  window.gameState.attackingTerritory = null;
  window.gameState.acquiredTerritory = null;
  window.gameState.minTroopsToTransfer = 0;
  try {
    delete window.gameState.risquePublicTransferMirrorSeal;
  } catch (eClrSeal) {}
  saveGameState();
  logToStorage('Cleared invalid or stale attack transfer state');
  syncAttackPhaseActionLocks();
}

function initTroopTransfer() {
  const player = window.gameState.players.find(p => p.name === window.gameState.currentPlayer);
  if (!player || !window.gameState.attackingTerritory || !window.gameState.acquiredTerritory) {
    clearInvalidAttackTransferState();
    attacker = null;
    defender = null;
    updateBattlePanelReadout();
    showPrompt('Could not resume troop transfer (state was reset). Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
    window.gameUtils.renderTerritories(null, window.gameState);
    return;
  }
  const attacking = player.territories.find(t => t.name === window.gameState.attackingTerritory.name);
  const acquired = player.territories.find(t => t.name === window.gameState.acquiredTerritory.name);
  if (!attacking || !acquired) {
    clearInvalidAttackTransferState();
    attacker = null;
    defender = null;
    updateBattlePanelReadout();
    showPrompt('Could not resume troop transfer (state was reset). Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
    window.gameUtils.renderTerritories(null, window.gameState);
    return;
  }

  attacker = { label: attacking.name, owner: player.name, troops: attacking.troops };
  defender = null;
  updateBattlePanelReadout();
  acquiredTerritory = { name: acquired.name, troops: acquired.troops };
  attackerInitialTroops = attacking.troops + window.gameState.minTroopsToTransfer;
  minTroopsToTransfer = window.gameState.minTroopsToTransfer;
  maxTroopsToTransfer = Math.max(0, attacking.troops - 1);
  /* Must not use live attacking.troops in shortcuts — input preview mutates it. Use opening snapshot only. */
  const sourceTroopsSnapshot = Math.max(0, attackerInitialTroops - minTroopsToTransfer);

  if (window.gameState && window.gameState.risqueQDevBlitzAutoTransfer) {
    const qMode = window.gameState.risqueQDevBlitzTransferMode || 'leave3';
    window.gameState.risqueQDevBlitzAutoTransfer = false;
    delete window.gameState.risqueQDevBlitzTransferMode;
    window.gameState.risqueInstantBlitzTransferUi = false;
    teardownAttackTroopTransferWheel();
    completeTroopTransferFromPending(qDevBlitzAdditionalTroopsForMode(qMode));
    syncAttackPhaseActionLocks();
    return;
  }

  try {
    window.gameState.risquePublicTransferMirrorSeal = {
      sourceLabel: attacking.name,
      destLabel: acquired.name,
      sourceTroops: attacking.troops,
      destTroops: acquired.troops
    };
    if (typeof window.risqueMirrorPushGameState === 'function') {
      window.risqueMirrorPushGameState();
    }
  } catch (eSeal) {
    /* ignore */
  }

  const canAllButThree = sourceTroopsSnapshot >= 3;
  const transferButtons = [
    {
      label: 'ALL BUT 1',
      onClick: () => {
        troopsToTransfer = Math.max(0, sourceTroopsSnapshot - 1);
        const input = document.getElementById('troops-input');
        if (input) {
          input.value = String(troopsToTransfer);
          input.dispatchEvent(new Event('input'));
        }
        risqueTroopTransferOnShortcutChosen('all-but-one');
      }
    },
    {
      label: 'ALL BUT 3',
      disabled: !canAllButThree,
      onClick: () => {
        if (!canAllButThree) return;
        troopsToTransfer = Math.max(0, sourceTroopsSnapshot - 3);
        const input = document.getElementById('troops-input');
        if (input) {
          input.value = String(troopsToTransfer);
          input.dispatchEvent(new Event('input'));
        }
        risqueTroopTransferOnShortcutChosen('all-but-three');
      }
    },
    {
      label: 'CONFIRM',
      onClick: () => {
        risqueStopConfirmSlotFlash();
        const input = document.getElementById('troops-input');
        const additional = parseInt(input ? input.value : '0', 10) || 0;
        teardownAttackTroopTransferWheel();
        completeTroopTransferFromPending(additional);
      }
    }
  ];
  const acquiredPretty = prettyTerritoryName(acquired.name);
  const acquiredU = acquiredPretty.toUpperCase();
  const simpleBlitz =
    window.gameState && window.gameState.risqueInstantBlitzTransferUi === true;
  if (simpleBlitz && window.gameState) {
    window.gameState.risqueInstantBlitzTransferUi = false;
    /* So public TV uses controlVoiceMirror, not stale per-roll battle readout + acquisition stack */
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
    window.gameState.risqueAttackOutcomeAcquisition = '';
  }
  const oc = window.gameState.risqueAttackOutcomePrimary;
  const od = window.gameState.risqueAttackOutcomeReport;
  const lossLineHtml = simpleBlitz
    ? 'BLITZ SUCCESSFUL'
    : oc != null && String(oc).trim() !== ''
      ? String(oc).trim()
      : '';
  var deferElimHint =
    risqueDeferredEliminationConquerPrompt != null ||
    (window.gameState && window.gameState.risqueDeferConquerElimination);
  var acquireBlock = `<div class="attack-transfer-voice-line attack-transfer-voice-line--acquire">YOU HAVE ACQUIRED ${acquiredU}.</div>`;
  if (deferElimHint) {
    acquireBlock +=
      '<div class="attack-transfer-voice-line" style="font-size:15px;font-weight:700;opacity:.92;margin-top:10px;">' +
      'You eliminated a player — set extra troops if you want, then tap CONFIRM. The celebration step follows.</div>';
  }
  const voiceBlock =
    lossLineHtml !== ''
      ? `<div class="attack-transfer-voice-line">${lossLineHtml}</div>${acquireBlock}`
      : acquireBlock;
  const troopPromptOpts = { troops: { initial: 0, min: 0, max: maxTroopsToTransfer } };
  if (simpleBlitz) {
    troopPromptOpts.controlVoiceMirror = {
      primary: `BLITZ SUCCESSFUL\nYOU HAVE ACQUIRED ${acquiredU}.`,
      report: '',
      reportClass: 'ucp-voice-report ucp-voice-report--public-blitz-banner'
    };
  } else {
    const priMirror =
      lossLineHtml !== ''
        ? `${lossLineHtml}\nYOU HAVE ACQUIRED ${acquiredU}.`
        : `YOU HAVE ACQUIRED ${acquiredU}.`;
    troopPromptOpts.controlVoiceMirror = {
      primary: priMirror,
      report: od != null && String(od).trim() !== '' ? String(od).trim() : '',
      reportClass: 'ucp-voice-report ucp-voice-report--attack-transfer-dice'
    };
  }
  const reportDice = simpleBlitz ? '' : od != null && String(od).trim() !== '' ? String(od).trim() : '';
  showPrompt(voiceBlock, transferButtons, troopPromptOpts, reportDice);
  setupAttackTroopTransferWheel();
  syncAttackPhaseActionLocks();
  risqueStartConfirmSlotFlash();

  if (attackChainFromCampaign) {
    const lb = Math.max(1, Math.floor(Number(campaignPreferredGarrison)) || 1);
    requestAnimationFrame(() => {
      const input = document.getElementById('troops-input');
      const p2 = window.gameState.players.find(pl => pl.name === window.gameState.currentPlayer);
      const atk2 =
        p2 && window.gameState.attackingTerritory
          ? p2.territories.find(t => t.name === window.gameState.attackingTerritory.name)
          : null;
      if (!input || !atk2) return;
      const effectiveLeave = Math.min(lb, atk2.troops);
      const additional = Math.min(maxTroopsToTransfer, Math.max(0, atk2.troops - effectiveLeave));
      input.value = String(Math.max(0, additional));
      input.dispatchEvent(new Event('input'));
    });
  }
}

function cancelAttack() {
  if (isAwaitingAerialConfirm || (window.gameState && window.gameState.risqueAerialLinkPending)) {
    backFromAerialPreview();
    return;
  }
  /* A committed wildcard aerial link (source + target) stays on the map until attack phase
   * ends; Cancel / New attack only clear the in-progress from/to *attack* pick, not the link.
   * `risqueAerialLinkLocked` is set only when the player confirms the preview. */
  const aerialLink = committedAerialLinkForThisTurn();
  const keepAerialBridge =
    !!(window.gameState && window.gameState.risqueAerialLinkLocked) || aerialLink != null;
  if (keepAerialBridge && aerialLink && window.gameState) {
    window.gameState.aerialAttack = aerialLink;
    aerialBridge = aerialLink;
  } else if (keepAerialBridge && window.gameState && window.gameState.risqueAerialLinkLocked) {
    aerialBridge = aerialBridgeFromGameState(window.gameState);
  }
  /* CLR / New attack / Cancel while post-capture troop transfer is open leaves attackPhase ===
   * 'pending_transfer'. handleTerritoryClick returns immediately in that case — the map appears
   * idle ("Select territory to attack from") but clicks are ignored until this lock is cleared. */
  if (window.gameState && window.gameState.attackPhase === 'pending_transfer') {
    risqueDeferredEliminationConquerPrompt = null;
    delete window.gameState.risqueDeferConquerElimination;
    teardownAttackTroopTransferWheel();
    window.gameState.attackPhase = 'attack';
    window.gameState.attackingTerritory = null;
    window.gameState.acquiredTerritory = null;
    window.gameState.minTroopsToTransfer = 0;
  }
  try {
    delete window.gameState.risquePublicTransferMirrorSeal;
  } catch (eCanSeal) {}
  clearBattleLossFlashNow();
  clearSingleRollRevealTimer();
  stopPauseCampaignExecutionInternal();
  closeBlitzDropdown();
  closeCampaignDropdown();
  attackChainFromCampaign = false;
  instantCampaignGarrison = 1;
  campaignMode = null;
  campaignType = null;
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignInstantLastOutcomes = [];
  campaignInstantLastStopped = null;
  campaignCondThreshold = null;
  clearInstantCampaignWarpath();
  /* TV reads gameState.risquePublicCampaignWarpathLabels only — must mirror [] here or markers stay expanded. */
  syncCampaignWarpathMirror();
  attacker = null;
  defender = null;
  resetAttackDiceUI();
  isPausableBlitzActive = false;
  isPausableBlitzPaused = false;
  clearPausableBlitzRoundTimers();
  pausableBlitzCondThreshold = null;
  isAcquiring = false;
  if (!keepAerialBridge) {
    aerialBridge = null;
    isSelectingAerialSource = false;
    isSelectingAerialTarget = false;
    isAwaitingAerialConfirm = false;
    aerialPendingPreview = null;
    aerialSnapshotBeforePreview = null;
    if (window.gameState) {
      window.gameState.aerialAttack = false;
      delete window.gameState.risqueAerialLinkPending;
      delete window.gameState.risqueAerialLinkLocked;
    }
    if (elements.aerialBridgeGroup) elements.aerialBridgeGroup.innerHTML = '';
  } else {
    isSelectingAerialSource = false;
    isSelectingAerialTarget = false;
  }
  if (elements.pausableBlitzText) elements.pausableBlitzText.textContent = 'PBLZ';
  syncPausableBlitzButtonVisibility();
  updateBattlePanelReadout();
  document.querySelectorAll('.territory-circle.selected').forEach(c => c.classList.remove('selected'));
  window.gameUtils.renderTerritories(null, window.gameState);
  if (keepAerialBridge && typeof window.risqueRedrawAerialBridgeOverlay === 'function') {
    /* Match public TV: draw after map layout (double rAF). */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          window.risqueRedrawAerialBridgeOverlay();
        } catch (eRedraw) {
          /* ignore */
        }
      });
    });
  } else if (keepAerialBridge) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          aerialBridge = aerialBridgeFromGameState(window.gameState);
          renderAerialBridge();
        } catch (eR2) {
          /* ignore */
        }
      });
    });
  }
  showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
  if (typeof window.risqueClearSpectatorFocus === 'function') {
    window.risqueClearSpectatorFocus();
  }
  if (window.gameState) {
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
    window.gameState.risqueAttackOutcomeAcquisition = '';
    window.gameState.risquePublicEliminationBanner = '';
    window.gameState.risquePublicAttackTransferSummary = '';
    window.gameState.risquePublicAttackSelectionLine = '';
    window.gameState.risquePublicBlitzBanner = '';
    window.gameState.risquePublicBlitzBannerReport = '';
    delete window.gameState.risquePublicPausableBlitzPaused;
    delete window.gameState.risquePublicCampaignStepPaused;
    delete window.gameState.risqueHostAttackStepStripActive;
    window.gameState.risqueInstantBlitzTransferUi = false;
    clearPublicCampaignEndMirror();
    delete window.gameState.risqueAerialUnlockedAfterCombat;
    if (
      window.gameUtils &&
      typeof window.gameUtils.getAerialAttackUsesRemaining === 'function' &&
      window.gameUtils.getAerialAttackUsesRemaining(window.gameState) > 0
    ) {
      window.gameState.risqueAerialUnlockedAfterCombat = true;
    }
  }
  resetAttackNumericInputs();
  saveGameState();
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  syncAttackPhaseActionLocks();
}

function territorySnapshot(label) {
  const gs = window.gameState;
  if (!gs || !gs.players) return null;
  for (let i = 0; i < gs.players.length; i += 1) {
    const p = gs.players[i];
    const t = p.territories.find(x => x.name === label);
    if (t) {
      return { label, owner: p.name, troops: Number(t.troops) || 0 };
    }
  }
  return null;
}

/** Map taps are intentionally ignored in these modes; without feedback players assume the board is dead. */
let __risqueCampaignBlockedMapHintAtMs = 0;

function hintCampaignMapBlockedNoOp() {
  const now = Date.now();
  if (now - __risqueCampaignBlockedMapHintAtMs < 2800) return;
  __risqueCampaignBlockedMapHintAtMs = now;
  let msg = '';
  if (campaignMode === 'instant_committed') {
    msg =
      'Campaign path is locked — use Begin (or Reset / Exit) in the green campaign strip below; map picks stay off until then.';
  } else if (campaignMode === 'cond_await_condition') {
    msg =
      'Campaign is waiting on the condition flow — finish Confirmed / Begin attack in the prompts and strip; map picks are paused.';
  } else if (campaignMode === 'armed') {
    msg = 'Campaign path is armed — use BEGIN in the prompt (or Exit / Reset); map picks stay off until then.';
  }
  if (!msg) return;
  prependCombatLog(msg, 'system');
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    const cp = window.gameState && window.gameState.currentPlayer ? String(window.gameState.currentPlayer) : 'Player';
    window.risqueRuntimeHud.setControlVoiceText(String(cp).toUpperCase() + ' — CAMPAIGN', msg, { force: true });
  }
}

function scrollCampaignVoiceToTop() {
  const cv = document.querySelector('.ucp-control-voice');
  if (cv) cv.scrollTop = 0;
}

/** Public TV one-shot lines (mirrored via {@link gameState.risquePublicBlitzBanner}). */
function publishPublicBattleBanner(primary, report) {
  if (!window.gameState) return;
  window.gameState.risquePublicBlitzBanner = primary != null ? String(primary) : '';
  window.gameState.risquePublicBlitzBannerReport = report != null ? String(report) : '';
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function clearConditionCountdownMirror() {
  if (!window.gameState) return;
  delete window.gameState.risqueConditionTallyActive;
  delete window.gameState.risqueConditionTallyRemaining;
  delete window.gameState.risquePublicConditionTallyShow;
  delete window.gameState.risquePublicConditionTallyNum;
  delete window.gameState.risquePublicConditionCountdownPrimary;
  delete window.gameState.risquePublicConditionCountdownReport;
}

function pushConditionCountdownRefresh() {
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  if (typeof window.risqueRefreshControlVoiceMirror === 'function') {
    try {
      window.risqueRefreshControlVoiceMirror(window.gameState);
    } catch (eCd) {
      /* ignore */
    }
  }
}

/**
 * Updates mirrored condition tally (troops until stop) for Blitz COND and Campaign COND (host + public).
 * @param {{ threshold?: number }} [opts] — optional override for instant flows without pausable flags
 */
function syncConditionCountdownMirror(opts) {
  opts = opts || {};
  if (!window.gameState) return;
  let threshold = opts.threshold;

  /* Pause Campaign COND: between hops `attacker` is null — must not infer threshold=null and clear. */
  if (
    attacker == null &&
    campaignCondThreshold != null &&
    campaignType === 'cond' &&
    campaignCondFromPauseRow &&
    isPauseCampaignRunning &&
    window.gameState.risqueConditionTallyActive === true &&
    window.gameState.risqueConditionTallyRemaining != null
  ) {
    pushConditionCountdownRefresh();
    return;
  }

  if (threshold == null) {
    const tb = pausableBlitzCondThreshold;
    const tc = campaignCondThreshold;
    if (tb != null && isPausableBlitzActive && attacker) {
      threshold = tb;
    } else if (tc != null && campaignType === 'cond' && isPauseCampaignRunning && attacker) {
      threshold = tc;
    }
  }

  if (threshold == null || typeof threshold !== 'number') {
    clearConditionCountdownMirror();
    pushConditionCountdownRefresh();
    return;
  }

  if (attacker == null) {
    clearConditionCountdownMirror();
    pushConditionCountdownRefresh();
    return;
  }

  const troops = Math.max(0, Number(attacker.troops) || 0);
  const remaining = Math.max(0, troops - threshold);
  window.gameState.risqueConditionTallyActive = true;
  window.gameState.risqueConditionTallyRemaining = remaining;
  /* Explicit public-TV mirror (same pattern as risquePublicBlitzBanner) — always present in LOCAL_MIRROR JSON */
  window.gameState.risquePublicConditionTallyShow = true;
  window.gameState.risquePublicConditionTallyNum = remaining;
  pushConditionCountdownRefresh();
}

/** Public TV: campaign run stopped before next hop — not enough troops on attacking territory. */
function publishPublicCampaignEndLackOfTroops() {
  if (!window.gameState) return;
  window.gameState.risquePublicCampaignEndPrimary = 'Campaign end';
  window.gameState.risquePublicCampaignEndReport = 'Lack of troops';
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

/**
 * Host + public mirror after campaign conditional stop.
 * @param {string} [stopAtTerritoryLabel] — territory id for "Campaign stopped in …" (pretty-printed).
 */
function showHostCampaignHaltedConditionMetVoice(stopAtTerritoryLabel) {
  if (window.risqueDisplayIsPublic) return;
  const terr = stopAtTerritoryLabel != null ? String(stopAtTerritoryLabel).trim() : '';
  const reportLine =
    terr !== '' ? `Campaign stopped in ${prettyTerritoryName(terr)}.` : 'Campaign stopped.';
  const reportHost = reportLine + '\n\nSelect a territory to attack from.';
  clearAttackCampaignPlanningAfterRun();
  if (window.gameState) {
    window.gameState.risquePublicCampaignEndPrimary = 'Condition has been met.';
    window.gameState.risquePublicCampaignEndReport = reportLine;
    window.gameState.risqueControlVoice = {
      primary: 'Condition has been met.',
      report: reportHost,
      reportClass: 'ucp-voice-report--public-campaign-end'
    };
  }
  showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText('Condition has been met.', reportHost, {
      force: true,
      reportClass: 'ucp-voice-report--public-campaign-end'
    });
  }
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
  updateBattlePanelReadout();
  renderAfterCampaignWarpathSync();
  try {
    saveGameState();
  } catch (eSave) {
    /* ignore */
  }
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function clearPublicCampaignEndMirror() {
  if (!window.gameState) return;
  delete window.gameState.risquePublicCampaignEndPrimary;
  delete window.gameState.risquePublicCampaignEndReport;
}

/**
 * Drops Commit/Begin campaign mode and the instant HUD shell so the host prompt matches the public mirror
 * and map clicks work again (risqueIsAttackCampaignActive must be false).
 */
function clearAttackCampaignPlanningAfterRun() {
  stopPauseCampaignExecutionInternal();
  closeBlitzDropdown();
  closeCampaignDropdown();
  attackChainFromCampaign = false;
  instantCampaignGarrison = 1;
  campaignMode = null;
  campaignType = null;
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignCondFromPauseRow = false;
  campaignCondThreshold = null;
  campaignInstantLastOutcomes = [];
  campaignInstantLastStopped = null;
  pauseCampaignMirrorStopLabel = null;
  isPauseCampaignRunning = false;
  campaignQDevMode = false;
  clearInstantCampaignWarpath();
  const cv = document.getElementById('control-voice');
  if (cv) cv.classList.remove('ucp-control-voice--campaign-instant');
  const vt = document.getElementById('control-voice-text');
  if (vt) {
    vt.classList.remove('campaign-instant-voice');
    vt.innerHTML = '';
  }
  try {
    syncCampaignWarpathMirror();
  } catch (eWarSync) {
    /* ignore */
  }
}

/**
 * Called from risquePhases.attack.mount on every attack mount (including next player after soft-nav).
 * Ensures stale campaign memory + DOM from the prior attacker cannot suppress voice updates or map routing.
 */
window.risquePrepareAttackPhaseShellMount = function (gs) {
  try {
    const state = gs || window.gameState;
    resetAttackInMemoryStateAfterShellPhaseRemount(state);
    clearAttackCampaignPlanningAfterRun();
  } catch (ePrep) {
    /* ignore */
  }
};

/**
 * Host control voice + mirror: same headlines as public TV, then idle attack prompt (Cancel).
 * Call after clearPublicCampaignEndMirror when the public one-shot fields are unused.
 */
function applyPostCampaignOutcomeAndIdlePrompt(primary, report, reportClass) {
  const p = primary != null ? String(primary) : '';
  const baseRep = report != null && String(report).trim() !== '' ? String(report) : '';
  const tail = '\n\nSelect a territory to attack from.';
  const reportWithIdle = baseRep ? baseRep + tail : 'Select a territory to attack from.';
  clearAttackCampaignPlanningAfterRun();
  showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(p, reportWithIdle, {
      force: true,
      reportClass: reportClass || ''
    });
  }
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
  updateBattlePanelReadout();
  renderAfterCampaignWarpathSync();
  try {
    saveGameState();
  } catch (eSave) {
    /* ignore */
  }
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function campaignTypeDisplayName() {
  if (campaignType === 'instant') return 'Campaign - Instant';
  if (campaignType === 'pause') return 'CAMPAIGN STEP';
  if (campaignType === 'cond') return campaignCondFromPauseRow ? 'CAMPAIGN STEP · COND' : 'INSTANT COND';
  return 'Campaign';
}

function formatCampaignPath() {
  if (!campaignPath.length) return '';
  return campaignPath.map(l => prettyTerritoryName(l)).join(' → ');
}

/** Q Camp: status without territory names (map markers show the path). */
function qDevCampaignPathStatusText() {
  const n = campaignPath ? campaignPath.length : 0;
  if (n >= 2) return `Path ready (${n} regions)`;
  if (n === 1) return 'Launch set — add enemy targets on the map';
  return 'Pick your launch territory on the map (2+ troops)';
}

function qDevCampaignPlanningMirrorOpts() {
  if (!campaignQDevMode || !window.gameState) return null;
  const cur = window.gameState.currentPlayer;
  if (!cur) return null;
  if (campaignMode === 'instant_launch') {
    return { mirrorPrimary: `${cur} · Q CAMP — pick path on map` };
  }
  if (campaignMode === 'instant_extend' && campaignPath && campaignPath.length >= 2) {
    return { mirrorPrimary: `${cur} · Q CAMP — path ready` };
  }
  if (campaignMode === 'instant_extend' && campaignPath && campaignPath.length === 1) {
    return { mirrorPrimary: `${cur} · Q CAMP — add targets` };
  }
  return null;
}

/** INSTANT, PAUSE, Campaign Step CON, and Instant COND share the same Commit / Begin / Reset map UI. */
function isCommitRunCampaignType() {
  return campaignType === 'instant' || campaignType === 'pause' || campaignType === 'cond';
}

function campaignTrace(msg, data) {
  const entry = { t: Date.now(), msg, data };
  if (!Array.isArray(window.risqueCampaignTroubleshootLog)) window.risqueCampaignTroubleshootLog = [];
  window.risqueCampaignTroubleshootLog.push(entry);
  if (window.risqueCampaignTroubleshootLog.length > 300) window.risqueCampaignTroubleshootLog.shift();
  console.log('[CampaignTrace]', msg, data !== undefined ? data : '');
  const tail =
    data !== undefined
      ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}`
      : '';
  prependCombatLog(`[Campaign trace] ${msg}${tail}`, 'system');
}

function buildQDevCampaignStaticVoiceHtml() {
  const pathLine = qDevCampaignPathStatusText();
  return (
    '<div class="campaign-instant-hud-static">' +
    '<div class="campaign-instant-framed">' +
    '<span class="campaign-voice-kicker">Q CAMP</span>' +
    '<div class="campaign-instant-hud-phase">Leave 1 on each capture</div>' +
    '<div class="campaign-instant-hud-phase" style="font-size:12px;opacity:.9;margin-top:6px;">' +
    pathLine +
    '</div>' +
    '<div class="campaign-instant-hud-phase" style="font-size:12px;opacity:.85;margin-top:8px;">Confirm below when the path is ready.</div>' +
    '</div>' +
    '</div>'
  );
}

function paintQDevCampaignHud(reportLine, mirrorOpts) {
  clearControlVoiceSlotsAndExtras();
  const vt = document.getElementById('control-voice-text');
  const vr = document.getElementById('control-voice-report');
  const cv = document.getElementById('control-voice');
  const opts = mirrorOpts != null && typeof mirrorOpts === 'object' ? mirrorOpts : null;
  if (vt) {
    vt.classList.add('campaign-instant-voice');
    vt.innerHTML = buildQDevCampaignStaticVoiceHtml();
  }
  if (vr) {
    const r = reportLine != null && String(reportLine) !== '' ? String(reportLine) : '';
    vr.textContent = r;
    vr.style.display = r ? 'block' : 'none';
    vr.className = 'ucp-voice-report' + (r ? ' ucp-voice-report--instant' : '');
  }
  if (cv) cv.classList.add('ucp-control-voice--campaign-instant');
  scrollCampaignVoiceToTop();
  try {
    if (window.gameState) {
      const r = reportLine != null && String(reportLine) !== '' ? String(reportLine) : '';
      const mp = opts && opts.mirrorPrimary != null && String(opts.mirrorPrimary).trim() !== '' ? String(opts.mirrorPrimary).trim() : null;
      let mirrorRep = r;
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'mirrorReport')) {
        mirrorRep = opts.mirrorReport == null ? '' : String(opts.mirrorReport);
      }
      window.gameState.risqueControlVoice = {
        primary: mp != null ? mp : 'Q CAMP',
        report: mirrorRep,
        reportClass: mirrorRep ? 'ucp-voice-report--instant' : ''
      };
      if (typeof window.risqueMirrorPushGameState === 'function') {
        window.risqueMirrorPushGameState();
      }
    }
  } catch (eQDevVoice) {
    /* ignore */
  }
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.clampCombatLogToCanvasBottom === 'function'
  ) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.clampCombatLogToCanvasBottom();
      });
    });
  }
}

function buildInstantStaticVoiceHtml() {
  const kicker = campaignTypeDisplayName();
  let phaseLine = '';
  if (isPauseCampaignRunning) {
    phaseLine = '<div class="campaign-instant-hud-phase">Running…</div>';
  } else if (campaignMode === 'cond_await_condition') {
    phaseLine = '<div class="campaign-instant-hud-phase">Set condition</div>';
  } else if (campaignMode === 'instant_committed') {
    phaseLine = '<div class="campaign-instant-hud-phase">Locked</div>';
  } else if (campaignMode === 'instant_results') {
    phaseLine = '<div class="campaign-instant-hud-phase">Done</div>';
  }
  const runInProgress = !!isPauseCampaignRunning;
  const commitDisabled =
    runInProgress ||
    campaignMode === 'instant_committed' ||
    campaignMode === 'cond_await_condition' ||
    campaignMode === 'instant_results'
      ? ' disabled'
      : '';
  /* Campaign Step CON & Instant COND: combat runs from the “Begin attack” prompt (Blitz Step Con style), not the map Begin button. */
  const runDisabled =
    runInProgress ||
    campaignType === 'cond' ||
    campaignMode !== 'instant_committed'
      ? ' disabled'
      : '';
  const leaveVal = Math.max(1, Math.min(99, instantCampaignGarrison));
  const leaveDisabled =
    campaignMode === 'instant_results' || campaignMode === 'cond_await_condition' || runInProgress ? ' disabled' : '';
  const resetDisabled = runInProgress ? ' disabled' : '';
  return (
    '<div class="campaign-instant-hud-static">' +
    '<div class="campaign-instant-framed">' +
    '<span class="campaign-voice-kicker">' +
    kicker +
    '</span>' +
    phaseLine +
    '<div class="campaign-instant-hud-actions" role="group" aria-label="Campaign actions">' +
    '<button type="button" class="campaign-instant-action-btn" data-instant-campaign-action="commit"' +
    commitDisabled +
    '>Commit</button>' +
    '<button type="button" class="campaign-instant-action-btn" data-instant-campaign-action="run"' +
    runDisabled +
    ' title="Begin committed campaign path">Begin</button>' +
    '<button type="button" class="campaign-instant-action-btn" data-instant-campaign-action="reset"' +
    resetDisabled +
    '>Reset</button>' +
    '</div>' +
    '<div class="campaign-instant-hud-leave-row">' +
    '<div class="campaign-instant-hud-leave">' +
    '<label class="campaign-instant-leave-label" for="instant-campaign-leave-behind" title="Troops to leave on source after each capture">Leave</label>' +
    '<div class="campaign-instant-leave-controls">' +
    '<button type="button" class="campaign-instant-action-btn campaign-instant-leave-preset" data-instant-leave-preset="1" title="Leave 1 on source after each capture"' +
    leaveDisabled +
    '>L1</button>' +
    '<button type="button" class="campaign-instant-action-btn campaign-instant-leave-preset" data-instant-leave-preset="3" title="Leave 3 on source after each capture"' +
    leaveDisabled +
    '>L3</button>' +
    '<input type="number" id="instant-campaign-leave-behind" class="campaign-instant-leave-input" ' +
    'min="1" max="99" step="1" value="' +
    leaveVal +
    '" title="Troops to leave on source after each capture" ' +
    'inputmode="numeric"' +
    leaveDisabled +
    ' />' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Minimal control voice for INSTANT / pause / check-con HUD (no slot prompts).
 * @param {string} [reportLine] — host-only hint under the HUD (e.g. validation message).
 * @param {{ mirrorPrimary?: string, mirrorReport?: string, mirrorReportClass?: string }|null} [mirrorOpts] — optional TV/public lines (defaults: kicker + reportLine). {@link mirrorReportClass} matches blitz (e.g. {@code ucp-voice-report--public-blitz-banner}).
 */
function paintInstantCampaignHud(reportLine, mirrorOpts) {
  if (campaignQDevMode) {
    paintQDevCampaignHud(reportLine, mirrorOpts);
    return;
  }
  clearControlVoiceSlotsAndExtras();
  const vt = document.getElementById('control-voice-text');
  const vr = document.getElementById('control-voice-report');
  const cv = document.getElementById('control-voice');
  const opts = mirrorOpts != null && typeof mirrorOpts === 'object' ? mirrorOpts : null;
  if (vt) {
    vt.classList.add('campaign-instant-voice');
    vt.innerHTML = buildInstantStaticVoiceHtml();
  }
  if (vr) {
    const r = reportLine != null && String(reportLine) !== '' ? String(reportLine) : '';
    vr.textContent = r;
    vr.style.display = r ? 'block' : 'none';
    vr.className = 'ucp-voice-report' + (r ? ' ucp-voice-report--instant' : '');
  }
  if (cv) cv.classList.add('ucp-control-voice--campaign-instant');
  scrollCampaignVoiceToTop();
  try {
    if (window.gameState) {
      const r = reportLine != null && String(reportLine) !== '' ? String(reportLine) : '';
      const mp = opts && opts.mirrorPrimary != null && String(opts.mirrorPrimary).trim() !== '' ? String(opts.mirrorPrimary).trim() : null;
      let mirrorRep = r;
      if (opts && Object.prototype.hasOwnProperty.call(opts, 'mirrorReport')) {
        mirrorRep = opts.mirrorReport == null ? '' : String(opts.mirrorReport);
      }
      const mirrorRc =
        opts && opts.mirrorReportClass != null && String(opts.mirrorReportClass).trim() !== ''
          ? String(opts.mirrorReportClass).trim()
          : null;
      window.gameState.risqueControlVoice = {
        primary: mp != null ? mp : campaignTypeDisplayName(),
        report: mirrorRep,
        reportClass:
          mirrorRep && mirrorRc
            ? mirrorRc
            : mirrorRep
              ? 'ucp-voice-report--instant'
              : ''
      };
      if (typeof window.risqueMirrorPushGameState === 'function') {
        window.risqueMirrorPushGameState();
      }
    }
  } catch (eCampVoice) {
    /* ignore */
  }
  wireInstantCampaignLeaveInput();
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.clampCombatLogToCanvasBottom === 'function'
  ) {
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.clampCombatLogToCanvasBottom();
      });
    });
  }
}

/** Public TV primary while on map, before first territory (instant_launch). */
function mirrorPrimaryCampaignInstantLaunch() {
  const cur =
    window.gameState && window.gameState.currentPlayer
      ? String(window.gameState.currentPlayer).trim()
      : '';
  if (!cur) return null;
  if (campaignType === 'instant') return `${cur} initializes campaign - Instant`;
  if (campaignType === 'pause') return `${cur} initializes campaign - Campaign Step`;
  if (campaignType === 'cond' && campaignCondFromPauseRow) {
    return `${cur} initializes campaign - Campaign Step with conditions`;
  }
  if (campaignType === 'cond') return `${cur} initializes campaign - Instant COND`;
  return null;
}

/**
 * Public TV headline while building a Commit/Begin campaign path (before Commit).
 * Same lines for Campaign - Instant, Campaign Step, Campaign Step CON, and Instant COND.
 */
function instantCampaignPlanningMirrorOpts() {
  if (campaignQDevMode) return qDevCampaignPlanningMirrorOpts();
  if (!window.gameState || !isCommitRunCampaignType()) return null;
  const cur = window.gameState.currentPlayer;
  if (!cur) return null;
  if (campaignMode === 'instant_launch') {
    const mp = mirrorPrimaryCampaignInstantLaunch();
    return mp ? { mirrorPrimary: mp } : null;
  }
  if (campaignMode !== 'instant_extend' || !campaignPath || campaignPath.length === 0) {
    return null;
  }
  if (campaignPath.length >= 2) {
    return { mirrorPrimary: `${cur} is selecting the war path` };
  }
  return { mirrorPrimary: `${cur} launches campaign from ${prettyTerritoryName(campaignPath[0])}` };
}

function syncInstantCampaignGarrisonFromUi() {
  const leaveIn = document.getElementById('instant-campaign-leave-behind');
  if (!leaveIn) return;
  let n = parseInt(leaveIn.value, 10);
  if (!Number.isFinite(n)) n = 1;
  instantCampaignGarrison = Math.max(1, Math.min(99, n));
  campaignPreferredGarrison = instantCampaignGarrison;
  leaveIn.value = String(instantCampaignGarrison);
}

function wireInstantCampaignLeaveInput() {
  const leaveIn = document.getElementById('instant-campaign-leave-behind');
  if (leaveIn) {
    leaveIn.value = String(Math.max(1, Math.min(99, instantCampaignGarrison)));
    campaignPreferredGarrison = instantCampaignGarrison;
    const sync = () => {
      syncInstantCampaignGarrisonFromUi();
    };
    leaveIn.addEventListener('change', sync);
    leaveIn.addEventListener('blur', sync);
    leaveIn.addEventListener('input', () => {
      const n = parseInt(leaveIn.value, 10);
      if (Number.isFinite(n)) {
        instantCampaignGarrison = Math.max(1, Math.min(99, n));
        campaignPreferredGarrison = instantCampaignGarrison;
      }
    });
  }
  document.querySelectorAll('.campaign-instant-leave-preset').forEach((btn) => {
    btn.onclick = function () {
      if (btn.disabled) return;
      const raw = btn.getAttribute('data-instant-leave-preset');
      const v = Math.max(1, Math.min(99, parseInt(raw, 10) || 1));
      instantCampaignGarrison = v;
      campaignPreferredGarrison = v;
      const inp = document.getElementById('instant-campaign-leave-behind');
      if (inp) {
        inp.value = String(v);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
  });
}

function instantCampaignTryCommit() {
  if (!isCommitRunCampaignType()) return;
  if (
    campaignMode === 'instant_committed' ||
    campaignMode === 'cond_await_condition' ||
    campaignMode === 'instant_results'
  ) {
    prependCombatLog('Campaign: Commit only while building path (before Begin).', 'system');
    return;
  }
  if (campaignPath.length < 2) {
    prependCombatLog('Campaign: need launch + at least one target before commit.', 'system');
    paintInstantCampaignHud('Need 2+ regions on path for commit.', instantCampaignPlanningMirrorOpts() || undefined);
    return;
  }
  syncInstantCampaignGarrisonFromUi();
  performInstantCommitFromKeys();
}

function instantCampaignTryRun() {
  if (!isCommitRunCampaignType()) return;
  if (campaignType === 'cond') {
    prependCombatLog(
      campaignCondFromPauseRow
        ? 'Campaign Step CON: after setting the condition, use Begin attack in the prompt (not the map Begin button yet).'
        : 'INSTANT COND: after setting the condition, use Begin attack in the prompt (not the map Begin button yet).',
      'system'
    );
    return;
  }
  if (campaignMode !== 'instant_committed') {
    prependCombatLog('Campaign: Begin — path not committed yet (click Commit first).', 'system');
    return;
  }
  syncInstantCampaignGarrisonFromUi();
  if (campaignType === 'pause') {
    runPauseCampaignExecution();
  } else {
    void runInstantCampaignExecution().catch(function (e) {
      try {
        console.error('[Attack] instant campaign run failed', e);
      } catch (e2) {
        /* ignore */
      }
    });
  }
}

function onControlVoiceInstantCampaignClick(e) {
  const btn = e.target.closest('[data-instant-campaign-action]');
  if (!btn || !isCommitRunCampaignType()) return;
  const action = btn.getAttribute('data-instant-campaign-action');
  if (!action) return;
  e.preventDefault();
  e.stopPropagation();
  if (action === 'commit') instantCampaignTryCommit();
  else if (action === 'run') instantCampaignTryRun();
  else if (action === 'reset') resetInstantCampaignPlanningKeys();
}

function clearInstantCampaignWarpath() {
  window.__risqueCampaignWarpathLabels = [];
}

function syncInstantCampaignWarpath() {
  if (!isCommitRunCampaignType()) {
    clearInstantCampaignWarpath();
    return;
  }
  const show =
    campaignMode === 'instant_launch' ||
    campaignMode === 'instant_extend' ||
    campaignMode === 'instant_committed' ||
    campaignMode === 'cond_await_condition' ||
    campaignMode === 'instant_results';
  if (show && campaignPath.length) {
    window.__risqueCampaignWarpathLabels = campaignPath.slice();
  } else if (show && campaignCommittedPath.length) {
    window.__risqueCampaignWarpathLabels = campaignCommittedPath.slice();
  } else {
    clearInstantCampaignWarpath();
  }
}

/**
 * Keeps window.__risqueCampaignWarpathLabels in sync for the host map, mirrors the same list into
 * gameState.risquePublicCampaignWarpathLabels for the public/TV tab (localStorage mirror), and pushes.
 */
function syncCampaignWarpathMirror() {
  if (isCommitRunCampaignType()) {
    syncInstantCampaignWarpath();
  } else {
    clearInstantCampaignWarpath();
  }
  if (window.gameState) {
    /* Always assign an array so mirror + STORAGE JSON clear reliably (omit/delete confused some TV paths). */
    window.gameState.risquePublicCampaignWarpathLabels =
      window.__risqueCampaignWarpathLabels && window.__risqueCampaignWarpathLabels.length
        ? window.__risqueCampaignWarpathLabels.slice()
        : [];
    if (typeof window.risqueMirrorPushGameState === 'function') {
      window.risqueMirrorPushGameState();
    }
  }
}

function renderAfterCampaignWarpathSync() {
  syncCampaignWarpathMirror();
  if (window.gameUtils && window.gameState) {
    window.gameUtils.renderTerritories(null, window.gameState);
  }
}

/** After Commit on Instant COND: same strip prompts as Blitz Step Con, then Begin attack → instant chain. */
function startInstantCondConditionFlow() {
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  const condEl = document.getElementById('cond-threshold');
  if (condEl) condEl.value = '';
  showPrompt(
    'Set the condition.',
    [
      {
        label: 'Confirmed',
        onClick: () => {
          const req = readCondThresholdFromInputRequired();
          if (req == null) {
            prependCombatLog('INSTANT COND: enter a condition (1–99) in the strip, then Confirmed.', 'system');
            return;
          }
          campaignCondThreshold = req;
          const condN = campaignCondThreshold;
          showPrompt(
            'Begin attack.',
            [
              {
                label: 'Begin attack',
                onClick: () => {
                  campaignMode = 'instant_committed';
                  dismissPrompt();
                  prependCombatLog(`${cur}: INSTANT COND — stop when attacking stack ≤ ${condN}.`, 'voice');
                  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
                    window.risqueRuntimeHud.setControlVoiceText(
                      String(cur).toUpperCase(),
                      `Instant COND · stop at ≤ ${condN} on attacker`,
                      { force: true }
                    );
                  }
                  publishPublicBattleBanner(`${cur} has started Campaign · Instant COND (condition set)`);
                  void runInstantCampaignExecution().catch(function (e) {
                    try {
                      console.error('[Attack] instant COND campaign run failed', e);
                    } catch (e2) {
                      /* ignore */
                    }
                  });
                }
              }
            ],
            {
              ...PROMPT_OPTS_COND_ACTION,
              controlVoiceMirror: {
                primary: 'The condition has been set.',
                report: String(condN),
                reportClass: 'ucp-voice-report--public-blitz-banner'
              }
            }
          );
        }
      }
    ],
    {
      ...PROMPT_OPTS_COND_INPUT,
      controlVoiceMirror: {
        primary: `${cur} is initializing Instant COND with conditions.`,
        report: '',
        reportClass: ''
      }
    }
  );
}

/** After Commit on Campaign Step CON: Blitz-style condition prompt, then Begin attack → pause chain. */
function startCampaignCheckConConditionFlow() {
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  showPrompt(
    'Set the condition.',
    [
      {
        label: 'Confirmed',
        onClick: () => {
          campaignCondThreshold = readCondThresholdFromInput();
          const condN = campaignCondThreshold;
          showPrompt(
            'Begin attack.',
            [
              {
                label: 'Begin attack',
                onClick: () => {
                  campaignMode = 'instant_committed';
                  dismissPrompt();
                  prependCombatLog(
                    `${cur}: Campaign Step CON — stop when attacking stack ≤ ${condN}.`,
                    'voice'
                  );
                  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
                    window.risqueRuntimeHud.setControlVoiceText(
                      String(cur).toUpperCase(),
                      `Campaign Step Con · stop at ≤ ${condN} on attacker`,
                      { force: true }
                    );
                  }
                  publishPublicBattleBanner(`${cur} has started Campaign Step · with conditions`);
                  runPauseCampaignExecution();
                }
              }
            ],
            {
              ...PROMPT_OPTS_COND_ACTION,
              controlVoiceMirror: {
                primary: 'The condition has been set.',
                report: String(condN),
                reportClass: 'ucp-voice-report--public-blitz-banner'
              }
            }
          );
        }
      }
    ],
    {
      ...PROMPT_OPTS_COND_INPUT,
      controlVoiceMirror: {
        primary: `${cur} is setting Campaign Step condition (chain stops when attacker ≤ threshold).`,
        report: '',
        reportClass: ''
      }
    }
  );
}

function performInstantCommitFromKeys() {
  if (!isCommitRunCampaignType() || !campaignPath || campaignPath.length < 2) {
    campaignTrace('instant:commit_blocked', { len: campaignPath ? campaignPath.length : 0 });
    paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
    return;
  }
  if (campaignQDevMode) {
    instantCampaignGarrison = 1;
    campaignPreferredGarrison = 1;
  } else {
    syncInstantCampaignGarrisonFromUi();
  }
  campaignCommittedPath = campaignPath.slice();
  const pathLine = formatCampaignPath();
  campaignTrace('instant:committed', { path: campaignCommittedPath.slice() });

  if (campaignType === 'cond' && campaignCondFromPauseRow) {
    campaignMode = 'cond_await_condition';
    prependCombatLog(`Campaign Step CON: path locked (${pathLine}). Set condition (strip), then Confirm.`, 'system');
    const curAwait = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
    paintInstantCampaignHud('Use the pulsing number in the strip, then Confirm below.', {
      mirrorPrimary: curAwait ? `${curAwait} is setting the Campaign Step condition` : campaignTypeDisplayName(),
      mirrorReport: 'Stop when attacker troops reach the chosen number or below'
    });
    startCampaignCheckConConditionFlow();
    renderAfterCampaignWarpathSync();
    return;
  }

  if (campaignType === 'cond' && !campaignCondFromPauseRow) {
    campaignMode = 'cond_await_condition';
    campaignCondThreshold = null;
    prependCombatLog(
      `INSTANT COND: path locked (${pathLine}). Set condition (strip) → Confirmed → Begin attack.`,
      'system'
    );
    const curAwait = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
    paintInstantCampaignHud('Use the pulsing number in the strip, then Confirmed, then Begin attack below.', {
      mirrorPrimary: curAwait ? `${curAwait} is setting the Instant COND condition` : campaignTypeDisplayName(),
      mirrorReport: 'Stop when attacker troops reach the chosen number or below'
    });
    startInstantCondConditionFlow();
    renderAfterCampaignWarpathSync();
    return;
  }

  campaignMode = 'instant_committed';
  if (campaignQDevMode) {
    prependCombatLog('Q Camp: starting — leave 1 on each capture.', 'system');
    renderAfterCampaignWarpathSync();
    return;
  }
  prependCombatLog(`Campaign: path committed (${pathLine}). Click Begin to execute.`, 'system');
  const curCommit = window.gameState && window.gameState.currentPlayer;
  if ((campaignType === 'instant' || campaignType === 'pause') && curCommit) {
    paintInstantCampaignHud('', { mirrorPrimary: `${curCommit} has committed the war path` });
  } else {
    paintInstantCampaignHud('');
  }
  renderAfterCampaignWarpathSync();
}

/**
 * Host instant campaign mutates state and yields between combat rounds so the board + mirror can paint;
 * {@link instantCombatRoundDelay} paces Instant rounds (~4/sec).
 */
function risqueYieldInstantCampaignPaint() {
  if (window.risqueDisplayIsPublic) return Promise.resolve();
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });
}

async function runInstantCampaignExecution() {
  if (campaignType !== 'instant' && !(campaignType === 'cond' && !campaignCondFromPauseRow)) return;
  if (campaignMode !== 'instant_committed' || !campaignCommittedPath || campaignCommittedPath.length < 2) {
    campaignTrace('instant:run_blocked', {
      mode: campaignMode,
      len: campaignCommittedPath ? campaignCommittedPath.length : 0
    });
    return;
  }
  if (campaignQDevMode) {
    instantCampaignGarrison = 1;
    campaignPreferredGarrison = 1;
  } else {
    syncInstantCampaignGarrisonFromUi();
  }
  const leaveBehind = campaignQDevMode ? 1 : instantCampaignGarrison;
  const qDevRun = campaignQDevMode;
  const qDevHopTotal = campaignCommittedPath ? campaignCommittedPath.length - 1 : 0;
  clearBattleLossFlashNow();
  const cp = campaignCommittedPath;
  const current = window.gameState.currentPlayer;
  const condInstant = campaignType === 'cond' && !campaignCondFromPauseRow;
  const condT = condInstant && campaignCondThreshold != null ? campaignCondThreshold : null;
  campaignTrace('instant:run_start', { path: cp.slice(), leaveBehind, condThreshold: condT });
  if (window.gameState) {
    try {
      delete window.gameState.risqueCampaignInterruptedByElimination;
    } catch (eClrCampInt) {
      /* ignore */
    }
  }
  attackChainFromCampaign = false;
  const outcomes = [];
  let stopped = null;
  /** Territory key for public TV "stopped at …" line (instant campaign only). */
  let instantMirrorStopAt = null;
  /** Territory where the attacking stack sits for INSTANT COND conditional-stop voice ("Campaign stopped in …"). */
  let instantCondCampaignStopTerritory = null;

  for (let i = 0; i < cp.length - 1; i++) {
    const from = cp[i];
    const to = cp[i + 1];
    const fromSnap = territorySnapshot(from);
    const toSnap = territorySnapshot(to);
    if (!fromSnap || fromSnap.owner !== current) {
      stopped = qDevRun
        ? `Q Camp: stopped (hop ${i + 1}/${qDevHopTotal}) — source not yours or missing.`
        : `Stopped before ${prettyTerritoryName(to)}: ${prettyTerritoryName(from)} is not yours or missing.`;
      instantMirrorStopAt = from;
      campaignTrace('instant:hop_abort', { from, to, reason: 'bad_from' });
      break;
    }
    const minTroopsForNextHop = Math.max(2, leaveBehind * 2);
    if (fromSnap.troops < minTroopsForNextHop) {
      stopped = qDevRun
        ? `Q Camp: stopped (hop ${i + 1}/${qDevHopTotal}) — not enough troops to keep leaving ${leaveBehind} (${fromSnap.troops} on source, need ${minTroopsForNextHop}).`
        : `Stopped before ${prettyTerritoryName(to)}: only ${fromSnap.troops} troop(s) on ${prettyTerritoryName(
            from
          )}; need at least ${minTroopsForNextHop} to keep leaving ${leaveBehind}.`;
      instantMirrorStopAt = from;
      publishPublicCampaignEndLackOfTroops();
      campaignTrace('instant:hop_abort', {
        from,
        to,
        reason: 'low_troops_for_leave_behind',
        leaveBehind,
        minTroopsForNextHop
      });
      break;
    }
    if (!toSnap) {
      stopped = qDevRun
        ? `Q Camp: stopped (hop ${i + 1}/${qDevHopTotal}) — target not found.`
        : `Stopped: ${prettyTerritoryName(to)} not found.`;
      instantMirrorStopAt = from;
      break;
    }
    if (toSnap.owner === current) {
      outcomes.push(
        qDevRun
          ? `Q Camp: hop ${i + 1}/${qDevHopTotal} skipped — already yours.`
          : `${prettyTerritoryName(to)} was already yours — hop skipped.`
      );
      campaignTrace('instant:hop_skip_owned', { from, to });
      continue;
    }
    const adj = window.gameUtils.getAdjacencies(from);
    const adjRev = window.gameUtils.getAdjacencies(to);
    const isAerial = aerialBridge && aerialBridge.source === from && aerialBridge.target === to;
    if (!isAerial && !adj.includes(to) && !adjRev.includes(from)) {
      stopped = qDevRun
        ? `Q Camp: stopped (hop ${i + 1}/${qDevHopTotal}) — target not adjacent to source.`
        : `${prettyTerritoryName(to)} is not adjacent to ${prettyTerritoryName(from)}.`;
      instantMirrorStopAt = from;
      campaignTrace('instant:hop_abort', { from, to, reason: 'not_adjacent' });
      break;
    }

    attacker = { label: from, owner: fromSnap.owner, troops: fromSnap.troops };
    defender = { label: to, owner: toSnap.owner, troops: toSnap.troops };
    attackerDice = Math.min(attacker.troops - 1, 3);
    updateBattlePanelReadout();

    if (condInstant && condT != null) {
      syncConditionCountdownMirror({ threshold: condT });
    }

    if (condInstant && condT != null && attacker.troops <= condT) {
      stopped = `INSTANT COND: CONDITIONAL STOP — attacking stack ≤ ${condT} before ${prettyTerritoryName(to)}.`;
      instantMirrorStopAt = from;
      instantCondCampaignStopTerritory = from;
      campaignTrace('instant:cond_stop', { threshold: condT, hop: 'before_battle', stopTerritory: from });
      break;
    }

    let rounds = 0;
    let conquered = false;
    let instantCondStopThisHop = false;
    let instantHaltWeakGarrison = false;
    let instantInterruptedByElimination = false;
    while (attacker.troops > 1 && defender.troops > 0) {
      if (condInstant && condT != null && attacker.troops <= condT) {
        stopped = `INSTANT COND: CONDITIONAL STOP — attacking stack ≤ ${condT}.`;
        instantMirrorStopAt = from;
        instantCondCampaignStopTerritory = from;
        campaignTrace('instant:cond_stop', { threshold: condT, hop: 'during_battle', stopTerritory: from });
        instantCondStopThisHop = true;
        break;
      }
      const minTroopsToSafelyConquerAndLeave = Math.max(2, leaveBehind * 2);
      if (attacker.troops < minTroopsToSafelyConquerAndLeave) {
        stopped = qDevRun
          ? `Q Camp: halted (hop ${i + 1}/${qDevHopTotal}) — not enough troops on source for next roll (need ${minTroopsToSafelyConquerAndLeave}, have ${attacker.troops}).`
          : `Campaign halted before next roll: ${prettyTerritoryName(from)} has ${attacker.troops} troop(s), need at least ${minTroopsToSafelyConquerAndLeave} to keep leaving ${leaveBehind}.`;
        instantMirrorStopAt = from;
        campaignTrace('instant:campaign_halt_prevent_low_garrison', {
          from,
          to,
          leaveBehind,
          attackerTroops: attacker.troops,
          minTroopsToSafelyConquerAndLeave
        });
        instantHaltWeakGarrison = true;
        break;
      }
      const snap = simulateBattleRound();
      if (!snap) break;
      rounds++;
      const res = applyBattleRoundAfterRoll(snap, {
        campaignAutoTransfer: true,
        campaignLeaveBehind: leaveBehind,
        campaignHopIndex: i,
        campaignPathLength: cp.length,
        skipBattleVoice: true,
        skipLossFlash: false
      });
      if (condInstant && condT != null) {
        syncConditionCountdownMirror({ threshold: condT });
      }
      if (res.conquered) {
        conquered = true;
        if (
          window.gameState &&
          (window.gameState.risqueCampaignInterruptedByElimination === true ||
            risqueDeferredEliminationConquerPrompt ||
            window.gameState.risqueDeferConquerElimination)
        ) {
          stopped = qDevRun
            ? 'Q Camp: interrupted — player eliminated; resolving conquer/cards.'
            : `Campaign interrupted: ${prettyTerritoryName(to)} eliminated a player. ` +
              'Resolving conquer/cards now; resume attacks afterward.';
          instantMirrorStopAt = to;
          campaignTrace('instant:campaign_interrupt_elimination', { from, to, via: 'deferred-flag' });
          instantInterruptedByElimination = true;
          await risqueYieldInstantCampaignPaint();
          break;
        }
        if (res.campaignInterruptedByElimination) {
          stopped = qDevRun
            ? 'Q Camp: interrupted — player eliminated; resolving conquer/cards.'
            : `Campaign interrupted: ${prettyTerritoryName(to)} eliminated a player. ` +
              'Resolving conquer/cards now; resume attacks afterward.';
          instantMirrorStopAt = to;
          campaignTrace('instant:campaign_interrupt_elimination', { from, to });
          instantInterruptedByElimination = true;
          await risqueYieldInstantCampaignPaint();
          break;
        }
        if (res.campaignHalted) {
          instantHaltWeakGarrison = true;
          stopped = qDevRun
            ? `Q Camp: halted (hop ${i + 1}/${qDevHopTotal}) — cannot keep leaving ${leaveBehind} after capture; continue manually.`
            : `Campaign halted: only 1 troop remained on ${prettyTerritoryName(
                from
              )} after capturing ${prettyTerritoryName(to)} — cannot keep leaving ${leaveBehind} on each territory. Continue manually from here.`;
          instantMirrorStopAt = from;
          campaignTrace('instant:campaign_halt_weak_garrison', { from, to, leaveBehind });
        }
        await risqueYieldInstantCampaignPaint();
        break;
      }
      await instantCombatRoundDelay();
      await risqueYieldInstantCampaignPaint();
    }

    if (instantCondStopThisHop) {
      break;
    }

    if (instantInterruptedByElimination) {
      outcomes.push(
        qDevRun
          ? `Q Camp: hop ${i + 1}/${qDevHopTotal} won in ${rounds} combat round(s).`
          : `Won ${prettyTerritoryName(from)} → ${prettyTerritoryName(to)} in ${rounds} combat round(s).`
      );
      outcomes.push('Campaign interrupted by elimination — conquer/cards flow takes over.');
      break;
    }

    if (instantHaltWeakGarrison) {
      outcomes.push(
        qDevRun
          ? `Q Camp: hop ${i + 1}/${qDevHopTotal} won in ${rounds} combat round(s).`
          : `Won ${prettyTerritoryName(from)} → ${prettyTerritoryName(to)} in ${rounds} combat round(s).`
      );
      outcomes.push(
        `Halted — cannot keep leaving ${leaveBehind} on each territory after this capture; continue manually.`
      );
      break;
    }

    if (!conquered) {
      stopped = qDevRun
        ? `Q Camp: hop ${i + 1}/${qDevHopTotal} failed (${rounds} round(s)); defender held.`
        : `Battle failed: ${prettyTerritoryName(from)} → ${prettyTerritoryName(to)} (${rounds} round(s)); defender held.`;
      instantMirrorStopAt = from;
      campaignTrace('instant:hop_fail', { from, to, rounds });
      break;
    }
    outcomes.push(
      qDevRun
        ? `Q Camp: hop ${i + 1}/${qDevHopTotal} won in ${rounds} combat round(s).`
        : `Won ${prettyTerritoryName(from)} → ${prettyTerritoryName(to)} in ${rounds} combat round(s).`
    );
    campaignTrace('instant:hop_ok', { from, to, rounds });
    await risqueYieldInstantCampaignPaint();
  }

  clearConditionCountdownMirror();
  pushConditionCountdownRefresh();
  attacker = null;
  defender = null;
  updateBattlePanelReadout();

  campaignInstantLastOutcomes = outcomes.slice();
  campaignInstantLastStopped = stopped;
  outcomes.forEach(o => prependCombatLog(`Campaign: ${o}`, 'system'));
  if (stopped) prependCombatLog(`Campaign: ${stopped}`, 'system');
  prependCombatLog(
    qDevRun
      ? 'Q Camp: run complete — see log above.'
      : (condInstant ? 'INSTANT COND' : 'Campaign INSTANT') +
        ': run complete — see log above. Reset for a new plan · CLEAR idle.',
    'system'
  );
  if (window.gameState) {
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
    window.gameState.risqueAttackOutcomeAcquisition = '';
    /* Last hop's auto-transfer sets this; public TV prefers it over risqueControlVoice (game-shell atkXfer branch). */
    window.gameState.risquePublicAttackTransferSummary = '';
    window.gameState.risquePublicAttackSelectionLine = '';
  }
  clearPublicCampaignEndMirror();
  if (campaignQDevMode) {
    finishQDevCampaignAfterRun();
    campaignTrace('instant:run_done', { outcomes: outcomes.length, stopped: stopped || null, qDev: true });
    if (!window.risqueDisplayIsPublic && typeof window.risqueReplayEnsureLatestBoardFrame === 'function') {
      try {
        window.risqueReplayEnsureLatestBoardFrame(window.gameState);
      } catch (eEnsureCamp) {
        /* ignore */
      }
    }
    return;
  }
  const condCampaignHalt = !!(condInstant && stopped && /CONDITIONAL STOP/.test(String(stopped)));
  if (condCampaignHalt) {
    showHostCampaignHaltedConditionMetVoice(instantCondCampaignStopTerritory);
  } else if (!stopped) {
    const finalLabel = cp[cp.length - 1];
    const fs = territorySnapshot(finalLabel);
    const t = fs && Number.isFinite(fs.troops) ? fs.troops : '?';
    applyPostCampaignOutcomeAndIdlePrompt(
      'Campaign successful.',
      `${current} arrives in ${prettyTerritoryName(finalLabel)} with ${t} troops.`,
      'ucp-voice-report ucp-voice-report--public-blitz-banner'
    );
  } else if (instantMirrorStopAt) {
    const terr = prettyTerritoryName(instantMirrorStopAt);
    const detail = `${current}'s troops stopped in ${terr}.`;
    applyPostCampaignOutcomeAndIdlePrompt(
      'Campaign unsuccessful.',
      detail,
      'ucp-voice-report--public-blitz-fail'
    );
  } else {
    applyPostCampaignOutcomeAndIdlePrompt(
      'Campaign unsuccessful.',
      String(stopped || 'Campaign failed.').slice(0, 280),
      'ucp-voice-report--public-blitz-fail'
    );
  }
  campaignTrace('instant:run_done', { outcomes: outcomes.length, stopped: stopped || null });
  if (!window.risqueDisplayIsPublic && typeof window.risqueReplayEnsureLatestBoardFrame === 'function') {
    try {
      window.risqueReplayEnsureLatestBoardFrame(window.gameState);
    } catch (eEnsureCamp) {
      /* ignore */
    }
  }
}

function pauseCampaignFinalize() {
  stopPauseCampaignExecutionInternal();
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  campaignInstantLastOutcomes = pauseCampaignOutcomes.slice();
  campaignInstantLastStopped = pauseCampaignStopped || null;
  pauseCampaignOutcomes.forEach(o => prependCombatLog(`Campaign: ${o}`, 'system'));
  if (pauseCampaignStopped) prependCombatLog(`Campaign: ${pauseCampaignStopped}`, 'system');
  prependCombatLog(
    campaignType === 'cond' && campaignCondFromPauseRow
      ? 'Campaign Step CON: run complete — see log above. Reset for a new plan · CLEAR idle.'
      : 'Campaign Step: run complete — see log above. Reset for a new plan · CLEAR idle.',
    'system'
  );
  campaignTrace('pause:run_done', { outcomes: pauseCampaignOutcomes.length, stopped: pauseCampaignStopped || null });
  const current = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  const cp = campaignCommittedPath;
  const haltLabel = pauseCampaignMirrorStopLabel;
  pauseCampaignMirrorStopLabel = null;
  /* Public TV: risquePublicApplyVoiceAndLogMirror prefers battle readout over risqueControlVoice — clear like runInstantCampaignExecution. */
  if (window.gameState) {
    window.gameState.risqueAttackOutcomePrimary = '';
    window.gameState.risqueAttackOutcomeReport = '';
    window.gameState.risqueAttackOutcomeAcquisition = '';
    window.gameState.risquePublicAttackTransferSummary = '';
    window.gameState.risquePublicAttackSelectionLine = '';
  }
  if (!pauseCampaignStopped) {
    clearPublicCampaignEndMirror();
    const finalLabel = cp && cp.length ? cp[cp.length - 1] : null;
    const fs = finalLabel ? territorySnapshot(finalLabel) : null;
    const t = fs && Number.isFinite(fs.troops) ? fs.troops : '?';
    applyPostCampaignOutcomeAndIdlePrompt(
      'Campaign successful.',
      finalLabel
        ? `${current} arrives in ${prettyTerritoryName(finalLabel)} with ${t} troops.`
        : '',
      'ucp-voice-report ucp-voice-report--public-blitz-banner'
    );
  } else {
    clearPublicCampaignEndMirror();
    const condMetPause =
      pauseCampaignStopped &&
      /^Campaign Step CON: CONDITIONAL STOP/i.test(String(pauseCampaignStopped));
    if (condMetPause && haltLabel) {
      showHostCampaignHaltedConditionMetVoice(haltLabel);
    } else if (haltLabel && current) {
      applyPostCampaignOutcomeAndIdlePrompt(
        'Campaign unsuccessful.',
        `${current} halted in ${prettyTerritoryName(haltLabel)}.`,
        'ucp-voice-report--public-blitz-fail'
      );
    } else {
      applyPostCampaignOutcomeAndIdlePrompt(
        'Campaign unsuccessful.',
        String(pauseCampaignStopped).slice(0, 280),
        'ucp-voice-report--public-blitz-fail'
      );
    }
  }
  if (!window.risqueDisplayIsPublic && typeof window.risqueReplayEnsureLatestBoardFrame === 'function') {
    try {
      window.risqueReplayEnsureLatestBoardFrame(window.gameState);
    } catch (eEnsurePause) {
      /* ignore */
    }
  }
  syncAttackStepControlsVisibility();
}

function pauseCampaignBeginNextHopOrFinish() {
  if (pauseCampaignInterval) {
    clearInterval(pauseCampaignInterval);
    pauseCampaignInterval = null;
  }
  const cp = campaignCommittedPath;
  if (!cp || cp.length < 2 || !window.gameState) {
    pauseCampaignFinalize();
    return;
  }
  const current = window.gameState.currentPlayer;

  while (pauseCampaignHopI < cp.length - 1) {
    const from = cp[pauseCampaignHopI];
    const to = cp[pauseCampaignHopI + 1];
    const fromSnap = territorySnapshot(from);
    const toSnap = territorySnapshot(to);

    if (!fromSnap || fromSnap.owner !== current) {
      pauseCampaignMirrorStopLabel = from;
      pauseCampaignStopped = `Stopped before ${prettyTerritoryName(to)}: ${prettyTerritoryName(from)} is not yours or missing.`;
      campaignTrace('pause:hop_abort', { from, to, reason: 'bad_from' });
      pauseCampaignFinalize();
      return;
    }
    const minTroopsForNextHop = Math.max(2, pauseCampaignLeaveBehind * 2);
    if (fromSnap.troops < minTroopsForNextHop) {
      pauseCampaignMirrorStopLabel = from;
      pauseCampaignStopped = `Stopped before ${prettyTerritoryName(to)}: only ${fromSnap.troops} troop(s) on ${prettyTerritoryName(
        from
      )}; need at least ${minTroopsForNextHop} to keep leaving ${pauseCampaignLeaveBehind}.`;
      publishPublicCampaignEndLackOfTroops();
      campaignTrace('pause:hop_abort', {
        from,
        to,
        reason: 'low_troops_for_leave_behind',
        leaveBehind: pauseCampaignLeaveBehind,
        minTroopsForNextHop
      });
      pauseCampaignFinalize();
      return;
    }
    if (!toSnap) {
      pauseCampaignMirrorStopLabel = to;
      pauseCampaignStopped = `Stopped: ${prettyTerritoryName(to)} not found.`;
      pauseCampaignFinalize();
      return;
    }
    if (toSnap.owner === current) {
      pauseCampaignOutcomes.push(`${prettyTerritoryName(to)} was already yours — hop skipped.`);
      campaignTrace('pause:hop_skip_owned', { from, to });
      pauseCampaignHopI += 1;
      continue;
    }
    const adj = window.gameUtils.getAdjacencies(from);
    const adjRev = window.gameUtils.getAdjacencies(to);
    const isAerial = aerialBridge && aerialBridge.source === from && aerialBridge.target === to;
    if (!isAerial && !adj.includes(to) && !adjRev.includes(from)) {
      pauseCampaignMirrorStopLabel = from;
      pauseCampaignStopped = `${prettyTerritoryName(to)} is not adjacent to ${prettyTerritoryName(from)}.`;
      campaignTrace('pause:hop_abort', { from, to, reason: 'not_adjacent' });
      pauseCampaignFinalize();
      return;
    }

    attacker = { label: from, owner: fromSnap.owner, troops: fromSnap.troops };
    defender = { label: to, owner: toSnap.owner, troops: toSnap.troops };
    attackerDice = Math.min(attacker.troops - 1, 3);
    pauseCampaignRoundsThisHop = 0;
    updateBattlePanelReadout();
    saveGameState();
    window.gameUtils.renderTerritories(null, window.gameState);

    pauseCampaignRoundTick();
    pauseCampaignInterval = setInterval(pauseCampaignRoundTick, PAUSABLE_BLITZ_MS);
    return;
  }

  pauseCampaignFinalize();
}

function toggleCampaignStepPause() {
  if (!isPauseCampaignRunning) return;
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  if (!isPauseCampaignPaused) {
    isPauseCampaignPaused = true;
    if (pauseCampaignInterval) {
      clearInterval(pauseCampaignInterval);
      pauseCampaignInterval = null;
    }
    if (pauseCampaignBetweenHopsTimer) {
      clearTimeout(pauseCampaignBetweenHopsTimer);
      pauseCampaignBetweenHopsTimer = null;
      pauseCampaignPausedBetweenHops = true;
    }
    prependCombatLog(`${cur}: Campaign Step PAUSED.`, 'voice');
    if (window.gameState) {
      window.gameState.risquePublicCampaignStepPaused = `${String(cur).toUpperCase()} · Campaign Step paused`;
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Campaign Step paused.', { force: true });
    }
    if (attacker && defender && attacker.troops > 1 && defender.troops > 0) {
      const maxAttackerDice = Math.min(attacker.troops - 1, 3);
      showPrompt('Campaign Step paused.', [{ label: 'Cancel', onClick: cancelAttack }], {
        attacker: Array.from({ length: maxAttackerDice }, (_, i) => ({ value: i + 1, label: `${i + 1} Dice` }))
      });
    } else {
      dismissPrompt();
    }
  } else {
    isPauseCampaignPaused = false;
    if (window.gameState) {
      delete window.gameState.risquePublicCampaignStepPaused;
    }
    if (pauseCampaignPausedBetweenHops) {
      pauseCampaignPausedBetweenHops = false;
      pauseCampaignBeginNextHopOrFinish();
    } else {
      pauseCampaignRoundTick();
      pauseCampaignInterval = setInterval(pauseCampaignRoundTick, PAUSABLE_BLITZ_MS);
    }
    prependCombatLog(`${cur}: Campaign Step RESUMED.`, 'voice');
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Campaign Step resumed.', { force: true });
    }
    dismissPrompt();
  }
  syncAttackStepControlsVisibility();
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
}

function pauseCampaignRoundTick() {
  if (!isPauseCampaignRunning) return;
  if (isPauseCampaignPaused) return;
  if (!attacker || !defender) return;

  if (campaignType === 'cond' && campaignCondFromPauseRow && campaignCondThreshold != null) {
    syncConditionCountdownMirror();
  }

  if (
    campaignType === 'cond' &&
    campaignCondFromPauseRow &&
    campaignCondThreshold != null &&
    attacker.troops <= campaignCondThreshold
  ) {
    if (pauseCampaignInterval) {
      clearInterval(pauseCampaignInterval);
      pauseCampaignInterval = null;
    }
    /* Stack is still on the attacking territory (from), not the hop target (defender). */
    pauseCampaignMirrorStopLabel = attacker.label;
    pauseCampaignStopped = `Campaign Step CON: CONDITIONAL STOP — attacking stack ≤ ${campaignCondThreshold}.`;
    campaignTrace('pause:cond_stop', { threshold: campaignCondThreshold, stopTerritory: attacker.label });
    pauseCampaignFinalize();
    return;
  }

  if (attacker.troops <= 1 || defender.troops <= 0) {
    if (attacker.troops <= 1 && defender.troops > 0) {
      if (pauseCampaignInterval) {
        clearInterval(pauseCampaignInterval);
        pauseCampaignInterval = null;
      }
      pauseCampaignMirrorStopLabel = attacker.label;
      pauseCampaignStopped = `Battle failed: ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(
        defender.label
      )} (${pauseCampaignRoundsThisHop} round(s)); defender held.`;
      campaignTrace('pause:hop_fail', { from: attacker.label, to: defender.label, rounds: pauseCampaignRoundsThisHop });
      pauseCampaignFinalize();
    }
    return;
  }

  const minTroopsToSafelyConquerAndLeave = Math.max(2, pauseCampaignLeaveBehind * 2);
  if (attacker.troops < minTroopsToSafelyConquerAndLeave) {
    if (pauseCampaignInterval) {
      clearInterval(pauseCampaignInterval);
      pauseCampaignInterval = null;
    }
    pauseCampaignMirrorStopLabel = attacker.label;
    pauseCampaignStopped = `Campaign halted before next roll: ${prettyTerritoryName(attacker.label)} has ${attacker.troops} troop(s), need at least ${minTroopsToSafelyConquerAndLeave} to keep leaving ${pauseCampaignLeaveBehind}.`;
    campaignTrace('pause:campaign_halt_prevent_low_garrison', {
      from: attacker.label,
      to: defender.label,
      leaveBehind: pauseCampaignLeaveBehind,
      attackerTroops: attacker.troops,
      minTroopsToSafelyConquerAndLeave
    });
    pauseCampaignFinalize();
    return;
  }

  pauseCampaignRoundsThisHop += 1;
  const snap = simulateBattleRound();
  if (!snap) {
    if (pauseCampaignInterval) {
      clearInterval(pauseCampaignInterval);
      pauseCampaignInterval = null;
    }
    pauseCampaignMirrorStopLabel = attacker && attacker.label ? attacker.label : null;
    pauseCampaignStopped = 'Campaign Step: battle simulation failed.';
    pauseCampaignFinalize();
    return;
  }
  revealDiceFromSnap(snap);
  const cpPause = campaignCommittedPath;
  const res = applyBattleRoundAfterRoll(snap, {
    campaignAutoTransfer: true,
    campaignLeaveBehind: pauseCampaignLeaveBehind,
    campaignHopIndex: pauseCampaignHopI,
    campaignPathLength: cpPause && cpPause.length ? cpPause.length : undefined,
    skipBattleVoice: true,
    skipLossFlash: false
  });
  if (campaignType === 'cond' && campaignCondFromPauseRow && campaignCondThreshold != null) {
    syncConditionCountdownMirror();
  }
  if (res.conquered) {
    if (pauseCampaignInterval) {
      clearInterval(pauseCampaignInterval);
      pauseCampaignInterval = null;
    }
    if (
      window.gameState &&
      (window.gameState.risqueCampaignInterruptedByElimination === true ||
        risqueDeferredEliminationConquerPrompt ||
        window.gameState.risqueDeferConquerElimination)
    ) {
      pauseCampaignMirrorStopLabel = defender && defender.label ? defender.label : null;
      pauseCampaignStopped =
        `Campaign interrupted: ${prettyTerritoryName(defender.label)} eliminated a player. ` +
        'Resolving conquer/cards now; resume attacks afterward.';
      campaignTrace('pause:campaign_interrupt_elimination', {
        from: attacker && attacker.label ? attacker.label : '',
        to: defender && defender.label ? defender.label : '',
        via: 'deferred-flag'
      });
      pauseCampaignFinalize();
      return;
    }
    if (res.campaignInterruptedByElimination) {
      pauseCampaignMirrorStopLabel = defender && defender.label ? defender.label : null;
      pauseCampaignStopped =
        `Campaign interrupted: ${prettyTerritoryName(defender.label)} eliminated a player. ` +
        'Resolving conquer/cards now; resume attacks afterward.';
      campaignTrace('pause:campaign_interrupt_elimination', {
        from: attacker && attacker.label ? attacker.label : '',
        to: defender && defender.label ? defender.label : ''
      });
      pauseCampaignFinalize();
      return;
    }
    pauseCampaignOutcomes.push(
      `Won ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(defender.label)} in ${pauseCampaignRoundsThisHop} combat round(s).`
    );
    campaignTrace('pause:hop_ok', { from: attacker.label, to: defender.label, rounds: pauseCampaignRoundsThisHop });
    const fromL = attacker.label;
    const toL = defender.label;
    pauseCampaignHopI += 1;
    attacker = null;
    defender = null;
    updateBattlePanelReadout();
    if (res.campaignHalted) {
      pauseCampaignMirrorStopLabel = fromL;
      pauseCampaignStopped = `Campaign halted: only 1 troop remained on ${prettyTerritoryName(
        fromL
      )} after capturing ${prettyTerritoryName(toL)} — cannot keep leaving ${pauseCampaignLeaveBehind} on each territory. Continue manually from here.`;
      campaignTrace('pause:campaign_halt_weak_garrison', { from: fromL, to: toL, leaveBehind: pauseCampaignLeaveBehind });
      pauseCampaignFinalize();
      return;
    }
    clearPauseCampaignBetweenHopsTimer();
    pauseCampaignBetweenHopsTimer = setTimeout(() => {
      pauseCampaignBetweenHopsTimer = null;
      pauseCampaignBeginNextHopOrFinish();
    }, PAUSABLE_BLITZ_MS);
    return;
  }
  if (attacker.troops <= 1 && defender.troops > 0) {
    if (pauseCampaignInterval) {
      clearInterval(pauseCampaignInterval);
      pauseCampaignInterval = null;
    }
    pauseCampaignMirrorStopLabel = attacker.label;
    pauseCampaignStopped = `Battle failed: ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(
      defender.label
    )} (${pauseCampaignRoundsThisHop} round(s)); defender held.`;
    campaignTrace('pause:hop_fail', { from: attacker.label, to: defender.label, rounds: pauseCampaignRoundsThisHop });
    pauseCampaignFinalize();
  }
}

function runPauseCampaignExecution() {
  if (campaignType !== 'pause' && !(campaignType === 'cond' && campaignCondFromPauseRow)) return;
  if (campaignMode !== 'instant_committed' || !campaignCommittedPath || campaignCommittedPath.length < 2) {
    campaignTrace('pause:run_blocked', {
      mode: campaignMode,
      len: campaignCommittedPath ? campaignCommittedPath.length : 0
    });
    return;
  }
  syncInstantCampaignGarrisonFromUi();
  stopPausableBlitzInternal();
  stopPauseCampaignExecutionInternal();
  clearBattleLossFlashNow();
  pauseCampaignLeaveBehind = instantCampaignGarrison;
  pauseCampaignHopI = 0;
  pauseCampaignOutcomes = [];
  pauseCampaignStopped = null;
  pauseCampaignMirrorStopLabel = null;
  if (window.gameState) {
    try {
      delete window.gameState.risqueCampaignInterruptedByElimination;
    } catch (eClrCampInt2) {
      /* ignore */
    }
  }
  attackChainFromCampaign = false;
  isPauseCampaignRunning = true;
  campaignTrace('pause:run_start', { path: campaignCommittedPath.slice(), leaveBehind: pauseCampaignLeaveBehind });
  const curRun = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  const checkConRun = campaignType === 'cond' && campaignCondFromPauseRow;
  paintInstantCampaignHud('', {
    mirrorPrimary: checkConRun
      ? `${curRun} is running Campaign Step (conditional)`
      : `${curRun} is running Campaign Step`,
    mirrorReport: 'Timed combat rounds — follow the dice on screen'
  });
  if (window.gameState) {
    window.gameState.risqueHostAttackStepStripActive = true;
  }
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function') {
    window.risqueRuntimeHud.setAttackChromeInteractive(false);
  }
  pauseCampaignBeginNextHopOrFinish();
  syncAttackStepControlsVisibility();
}

function resetInstantCampaignPlanningKeys() {
  if (!isCommitRunCampaignType()) return;
  dismissPrompt();
  stopPauseCampaignExecutionInternal();
  clearPublicCampaignEndMirror();
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  instantCampaignGarrison = 1;
  campaignPath = [];
  campaignCommittedPath = [];
  campaignMode = 'instant_launch';
  campaignInstantLastOutcomes = [];
  campaignInstantLastStopped = null;
  campaignCondThreshold = null;
  pauseCampaignMirrorStopLabel = null;
  campaignTrace('instant:reset', {});
  prependCombatLog(`Campaign ${campaignTypeDisplayName()}: reset.`, 'system');
  paintInstantCampaignHud('');
  renderAfterCampaignWarpathSync();
}

function resetInstantCampaignPlanning() {
  resetInstantCampaignPlanningKeys();
}

function startInstantCampaignPlanning(opts) {
  opts = opts && typeof opts === 'object' ? opts : {};
  closeBlitzDropdown();
  closeCampaignDropdown();
  dismissPrompt();
  clearPublicCampaignEndMirror();
  attackChainFromCampaign = false;
  isSelectingAerialSource = false;
  isSelectingAerialTarget = false;
  isAwaitingAerialConfirm = false;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  document.querySelectorAll('.territory-circle.selected').forEach(c => c.classList.remove('selected'));
  campaignType = 'instant';
  campaignMode = 'instant_launch';
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignPreferredGarrison = 1;
  instantCampaignGarrison = 1;
  const g = document.getElementById('campaign-garrison-pick');
  if (g && g.parentNode) g.parentNode.removeChild(g);
  clearInstantCampaignWarpath();
  prependCombatLog(
    opts.qDev
      ? 'Q Camp: pick launch and targets on the map, then Confirm (leaves 1 on each capture).'
      : 'Campaign INSTANT: map picks — Commit, Begin, Reset; set troops to leave on source (default 1).',
    'system'
  );
  campaignTrace(opts.qDev ? 'qCamp:start' : 'instant:start', {});
  {
    const mp = opts.qDev ? null : mirrorPrimaryCampaignInstantLaunch();
    paintInstantCampaignHud('', mp ? { mirrorPrimary: mp } : undefined);
  }
  renderAfterCampaignWarpathSync();
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
}

function startInstantCondCampaignPlanning() {
  closeBlitzDropdown();
  closeCampaignDropdown();
  dismissPrompt();
  clearPublicCampaignEndMirror();
  attackChainFromCampaign = false;
  isSelectingAerialSource = false;
  isSelectingAerialTarget = false;
  isAwaitingAerialConfirm = false;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  document.querySelectorAll('.territory-circle.selected').forEach(c => c.classList.remove('selected'));
  campaignType = 'cond';
  campaignCondFromPauseRow = false;
  campaignCondThreshold = null;
  campaignMode = 'instant_launch';
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignPreferredGarrison = 1;
  instantCampaignGarrison = 1;
  const g = document.getElementById('campaign-garrison-pick');
  if (g && g.parentNode) g.parentNode.removeChild(g);
  clearInstantCampaignWarpath();
  prependCombatLog(
    'INSTANT COND: same map flow as Campaign Instant — Commit, then set condition in the strip (Confirmed → Begin attack); Leave = garrison (default 1).',
    'system'
  );
  campaignTrace('instantCond:start', {});
  paintInstantCampaignHud('');
  renderAfterCampaignWarpathSync();
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
}

function startPauseCampaignPlanning() {
  closeBlitzDropdown();
  closeCampaignDropdown();
  dismissPrompt();
  clearPublicCampaignEndMirror();
  attackChainFromCampaign = false;
  isSelectingAerialSource = false;
  isSelectingAerialTarget = false;
  isAwaitingAerialConfirm = false;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  document.querySelectorAll('.territory-circle.selected').forEach(c => c.classList.remove('selected'));
  campaignType = 'pause';
  campaignMode = 'instant_launch';
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignPreferredGarrison = 1;
  instantCampaignGarrison = 1;
  const g = document.getElementById('campaign-garrison-pick');
  if (g && g.parentNode) g.parentNode.removeChild(g);
  clearInstantCampaignWarpath();
  prependCombatLog(
    'Campaign Step: same map flow as INSTANT — Commit, Begin (timed rounds + loss flash), Reset; set troops to leave on source.',
    'system'
  );
  campaignTrace('pause:start', {});
  paintInstantCampaignHud('');
  renderAfterCampaignWarpathSync();
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
}

function handleInstantCampaignTerritoryClick(label) {
  const gs = window.gameState;
  const current = gs && gs.currentPlayer;
  const snap = territorySnapshot(label);

  if (campaignMode === 'instant_launch') {
    if (!snap) {
      campaignTrace('instant:click_invalid', { label, reason: 'no_territory' });
      prependCombatLog('Campaign: that territory is not on the board.', 'system');
      paintInstantCampaignHud('');
      return true;
    }
    if (snap.owner !== current) {
      campaignTrace('instant:click_invalid', { label, reason: 'not_yours' });
      prependCombatLog(
        campaignQDevMode
          ? 'Q Camp: that region is not yours.'
          : `Campaign: ${prettyTerritoryName(label)} is not yours — you are ${current}.`,
        'system'
      );
      paintInstantCampaignHud('');
      return true;
    }
    if (snap.troops < 2) {
      campaignTrace('instant:click_invalid', { label, reason: 'low_troops' });
      prependCombatLog('Campaign: that territory needs at least 2 troops to attack from.', 'system');
      paintInstantCampaignHud('');
      return true;
    }
    campaignPath = [label];
    campaignMode = 'instant_extend';
    campaignTrace('instant:launch_picked', { label });
    prependCombatLog(
      campaignQDevMode
        ? `Q Camp: launch set (${snap.troops} troops on source).`
        : `Campaign: launch ${prettyTerritoryName(label)} (${snap.troops} troops).`,
      'system'
    );
    paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
    renderAfterCampaignWarpathSync();
    if (campaignQDevMode) {
      dismissPrompt({ keepInstantCampaignHud: true });
      syncAttackPhaseActionLocks();
    }
    return true;
  }

  if (campaignMode === 'instant_extend') {
    const last = campaignPath[campaignPath.length - 1];
    if (label === last) {
      campaignPath.pop();
      campaignTrace('instant:undo_step', { path: campaignPath.slice() });
      if (campaignPath.length === 0) {
        campaignMode = 'instant_launch';
        prependCombatLog('Campaign: cleared launch — pick a new start.', 'system');
      } else {
        prependCombatLog(
          campaignQDevMode
            ? `Q Camp: undo — ${qDevCampaignPathStatusText()}.`
            : `Campaign: undo — path now ${formatCampaignPath()}.`,
          'system'
        );
      }
      paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
      renderAfterCampaignWarpathSync();
      if (campaignQDevMode) {
        if (campaignPath.length < 2) dismissPrompt({ keepInstantCampaignHud: true });
        else showQDevCampaignConfirmPrompt();
        syncAttackPhaseActionLocks();
      }
      return true;
    }
    const adj = window.gameUtils.getAdjacencies(last);
    const isAerial = aerialBridge && aerialBridge.source === last && aerialBridge.target === label;
    if (!isAerial && !adj.includes(label)) {
      campaignTrace('instant:click_invalid', { label, last, reason: 'not_adjacent' });
      prependCombatLog('Campaign: next step must be adjacent (or your aerial bridge).', 'system');
      paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
      return true;
    }
    if (!snap) {
      paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
      return true;
    }
    if (snap.owner === current) {
      campaignTrace('instant:click_invalid', { label, reason: 'enemy_required' });
      prependCombatLog('Campaign: pick an enemy territory to attack.', 'system');
      paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
      return true;
    }
    campaignPath.push(label);
    campaignTrace('instant:target_picked', { label, path: campaignPath.slice() });
    prependCombatLog(
      campaignQDevMode
        ? `Q Camp: target added (${campaignPath.length} regions on path).`
        : `Campaign: + ${prettyTerritoryName(label)} → ${formatCampaignPath()}`,
      'system'
    );
    paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
    renderAfterCampaignWarpathSync();
    if (campaignQDevMode) {
      showQDevCampaignConfirmPrompt();
      syncAttackPhaseActionLocks();
    }
    return true;
  }

  return false;
}

function campaignControlButtons(extra) {
  return [
    { label: 'RESET', title: 'Reset campaign — clear path and restart planning', onClick: () => resetCampaignPlanning() },
    { label: 'EXIT', title: 'Cancel campaign — return to normal attack', onClick: () => exitCampaignMode() },
    ...(extra || [])
  ];
}

function resetCampaignPlanning() {
  if (!campaignType) return;
  clearPublicCampaignEndMirror();
  if (campaignType === 'instant' || campaignType === 'pause' || campaignType === 'cond') {
    resetInstantCampaignPlanning();
    return;
  }
  campaignPath = [];
  campaignPendingStart = null;
  campaignMode = 'start';
  showCampaignStartPrompt();
  renderAfterCampaignWarpathSync();
}

function exitCampaignMode() {
  stopPauseCampaignExecutionInternal();
  clearPublicCampaignEndMirror();
  campaignQDevMode = false;
  campaignMode = null;
  campaignType = null;
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignInstantLastOutcomes = [];
  campaignInstantLastStopped = null;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  document.querySelectorAll('.territory-circle.selected').forEach(c => c.classList.remove('selected'));
  syncCampaignWarpathMirror();
  showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
  window.gameUtils.renderTerritories(null, window.gameState);
}

/** First hop of a locked campaign path — same UI as picking attacker + defender manually. */
function beginCampaignFromPath() {
  if (!campaignPath || campaignPath.length < 2) return;
  const fromLabel = campaignPath[0];
  const toLabel = campaignPath[1];
  const current = window.gameState && window.gameState.currentPlayer;
  const fromSnap = territorySnapshot(fromLabel);
  const toSnap = territorySnapshot(toLabel);
  const typeName = campaignTypeDisplayName();
  const pathLine = formatCampaignPath();
  const plannedTail =
    campaignPath.length > 2 ? campaignPath.slice(2).map(l => prettyTerritoryName(l)).join(' → ') : '';

  if (!fromSnap || !toSnap || !current) {
    prependCombatLog('Campaign BEGIN: board state is invalid for the first hop.', 'system');
    exitCampaignMode();
    return;
  }
  if (fromSnap.owner !== current) {
    prependCombatLog(
      `Campaign BEGIN: ${prettyTerritoryName(fromLabel)} is not yours — you are ${current}.`,
      'system'
    );
    exitCampaignMode();
    return;
  }
  if (fromSnap.troops < 2) {
    prependCombatLog(
      `Campaign BEGIN: ${prettyTerritoryName(fromLabel)} needs at least 2 troops to attack from.`,
      'system'
    );
    exitCampaignMode();
    return;
  }
  if (toSnap.owner === current) {
    prependCombatLog(`Campaign BEGIN: ${prettyTerritoryName(toLabel)} is yours — not a valid target.`, 'system');
    exitCampaignMode();
    return;
  }
  const adj = window.gameUtils.getAdjacencies(fromLabel);
  const adjRev = window.gameUtils.getAdjacencies(toLabel);
  const isAdjacent = adj.includes(toLabel) || adjRev.includes(fromLabel);
  const isAerial = aerialBridge && aerialBridge.source === fromLabel && aerialBridge.target === toLabel;
  if (!isAerial && !isAdjacent) {
    prependCombatLog(
      'Campaign BEGIN: first hop is not adjacent (and no aerial bridge matches this hop).',
      'system'
    );
    exitCampaignMode();
    return;
  }

  attackChainFromCampaign = true;

  campaignMode = null;
  campaignType = null;
  campaignPath = [];
  campaignPendingStart = null;
  syncCampaignWarpathMirror();

  attacker = { label: fromSnap.label, owner: fromSnap.owner, troops: fromSnap.troops };
  defender = { label: toSnap.label, owner: toSnap.owner, troops: toSnap.troops };
  updateBattlePanelReadout();

  document.querySelectorAll('.territory-circle').forEach(c =>
    c.classList.toggle('selected', c.dataset.label === fromLabel || c.dataset.label === toLabel)
  );

  prependCombatLog(
    `Campaign (${typeName}) — first battle: ${prettyTerritoryName(fromLabel)} → ${prettyTerritoryName(toLabel)}.` +
      (plannedTail ? ` Remaining plan: ${plannedTail}.` : '') +
      ` Full path was: ${pathLine}.`,
    'system'
  );

  dismissPrompt();
  const maxAttackerDice = Math.min(attacker.troops - 1, 3);
  attackerDice = maxAttackerDice;
  showPrompt('Refer to the buttons above for attack choices.', [{ label: 'Cancel', onClick: cancelAttack }], {
    attacker: Array.from({ length: maxAttackerDice }, (_, i) => ({ value: i + 1, label: `${i + 1} Dice` }))
  });
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
  window.gameUtils.renderTerritories(null, window.gameState);
}

function showCampaignStartPrompt() {
  const typeName = campaignTypeDisplayName();
  const cur = window.gameState && window.gameState.currentPlayer;
  let statusBlock = '';
  if (campaignPendingStart) {
    statusBlock =
      '<div class="campaign-voice-status">' +
      `Starting territory: <strong>${prettyTerritoryName(campaignPendingStart.label)}</strong> — ` +
      `<strong>${campaignPendingStart.troops}</strong> troops. ` +
      'Tap <strong>CONFIRM</strong> in the slot row below.</div>';
  } else {
    statusBlock =
      '<div class="campaign-voice-hint">' +
      (cur
        ? `You are <strong>${cur}</strong>. Click one of <em>your</em> territories on the map (2+ troops).`
        : 'Click one of your territories on the map (2+ troops).') +
      '</div>';
  }
  const msg =
    `<strong>Campaign (${typeName})</strong><br>` +
    'Pick your launch territory on the map, then confirm below.' +
    statusBlock;
  const campaignInitMirror =
    campaignType === 'cond' && cur
      ? {
          controlVoiceMirror: {
            primary: campaignCondFromPauseRow
              ? `${cur} is initializing Campaign Step with conditions.`
              : `${cur} is initializing Instant COND with conditions.`,
            report: '',
            reportClass: ''
          }
        }
      : null;
  showPrompt(msg, campaignControlButtons([
    {
      label: 'CONFIRM',
      title: 'Confirm starting territory',
      disabled: !campaignPendingStart || campaignPendingStart.troops < 2,
      onClick: () => confirmCampaignStart()
    }
  ]), campaignInitMirror, '');
  scrollCampaignVoiceToTop();
}

function confirmCampaignStart() {
  if (!campaignPendingStart || campaignPendingStart.troops < 2) return;
  campaignPath = [campaignPendingStart.label];
  campaignPendingStart = null;
  campaignMode = 'path';
  showCampaignPathPrompt();
  renderAfterCampaignWarpathSync();
}

function showCampaignPathPrompt() {
  const typeName = campaignTypeDisplayName();
  const pathLine = formatCampaignPath();
  const needMore = campaignPath.length < 2;
  const statusBlock =
    '<div class="campaign-voice-status">' +
    `<strong>Path (${campaignPath.length})</strong><br>${pathLine || '—'}</div>` +
    (needMore
      ? '<div class="campaign-voice-hint">Add at least one <em>enemy</em> territory adjacent to the previous step.</div>'
      : '<div class="campaign-voice-hint">Click the <em>last</em> map territory again to undo one step. Tap <strong>DONE</strong> when the path is complete.</div>');
  const msg =
    `<strong>Campaign (${typeName})</strong><br>` +
    'Build the attack chain on the map — each hop must be legally adjacent to the prior territory.' +
    statusBlock;
  showPrompt(msg, campaignControlButtons([
    {
      label: 'DONE',
      title: 'Confirm path — ready to begin campaign',
      disabled: needMore,
      onClick: () => armCampaignRun()
    }
  ]), null, '');
  scrollCampaignVoiceToTop();
}

function armCampaignRun() {
  if (campaignPath.length < 2) return;
  campaignMode = 'armed';
  const typeName = campaignTypeDisplayName();
  const pathLine = formatCampaignPath();
  const msg =
    `<strong>Campaign (${typeName})</strong><br>` +
    'Path is locked in. Run it when you are ready.' +
    `<div class="campaign-voice-status"><strong>Path</strong><br>${pathLine}</div>` +
    '<div class="campaign-voice-hint">Tap <strong>BEGIN</strong> to open the <em>first</em> battle (ROLL / BLITZ). Further hops you plan after that win.</div>';
  showPrompt(msg, campaignControlButtons([
    {
      label: 'BEGIN',
      title: 'Begin first battle in this path',
      onClick: () => beginCampaignFromPath()
    }
  ]), null, '');
  scrollCampaignVoiceToTop();
  mountCampaignGarrisonPicker();
  renderAfterCampaignWarpathSync();
}

/** Troops to leave on source after each capture while campaign chain is active (BEGIN → … until CLR). */
function mountCampaignGarrisonPicker() {
  const extras = document.getElementById('control-voice-extras');
  if (!extras) return;
  const existing = document.getElementById('campaign-garrison-pick');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  const wrap = document.createElement('div');
  wrap.className = 'campaign-garrison-wrap';
  wrap.id = 'campaign-garrison-pick';
  const lab = document.createElement('div');
  lab.className = 'campaign-garrison-label';
  lab.textContent = 'Garrison on source after each capture';
  const row = document.createElement('div');
  row.className = 'campaign-garrison-leave-row';
  const setLeave = (v) => {
    campaignPreferredGarrison = Math.max(1, Math.min(99, Math.floor(Number(v)) || 1));
    const numEl = document.getElementById('campaign-garrison-num');
    if (numEl) numEl.value = String(campaignPreferredGarrison);
  };
  [1, 3].forEach((v) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'attack-ctl-btn campaign-garrison-preset-btn';
    b.textContent = 'LEAVE ' + v;
    b.addEventListener('click', () => setLeave(v));
    row.appendChild(b);
  });
  const num = document.createElement('input');
  num.type = 'number';
  num.id = 'campaign-garrison-num';
  num.min = '1';
  num.max = '99';
  num.className = 'ucp-slot-strip-number campaign-garrison-num';
  num.title = 'Troops to leave on the territory you attacked from when you confirm each transfer';
  num.value = String(Math.max(1, Math.min(99, Math.floor(Number(campaignPreferredGarrison)) || 1)));
  num.addEventListener('change', () => setLeave(num.value));
  num.addEventListener('blur', () => setLeave(num.value));
  num.addEventListener('input', () => {
    const n = parseInt(num.value, 10);
    if (Number.isFinite(n)) campaignPreferredGarrison = Math.max(1, Math.min(99, n));
  });
  row.appendChild(num);
  wrap.appendChild(lab);
  wrap.appendChild(row);
  extras.appendChild(wrap);
}

function startCampaignPlanning(type, condFromPauseRow) {
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  if (type === 'instant') {
    campaignCondFromPauseRow = false;
    publishPublicBattleBanner(`${cur} has initiated Campaign - Instant`);
    startInstantCampaignPlanning();
    return;
  }
  if (type === 'pause') {
    campaignCondFromPauseRow = false;
    publishPublicBattleBanner(`${cur} has initiated a Campaign · Campaign Step`);
    startPauseCampaignPlanning();
    return;
  }
  if (type === 'cond' && condFromPauseRow) {
    campaignCondFromPauseRow = true;
    publishPublicBattleBanner(`${cur} has initiated Campaign · Campaign Step with conditions`);
    startCampaignCheckConPlanning();
    return;
  }
  if (type === 'cond' && !condFromPauseRow) {
    campaignCondFromPauseRow = false;
    publishPublicBattleBanner(`${cur} has initiated Campaign · Instant COND`);
    startInstantCondCampaignPlanning();
    return;
  }
}

function startCampaignCheckConPlanning() {
  closeBlitzDropdown();
  closeCampaignDropdown();
  dismissPrompt();
  clearPublicCampaignEndMirror();
  attackChainFromCampaign = false;
  isSelectingAerialSource = false;
  isSelectingAerialTarget = false;
  isAwaitingAerialConfirm = false;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  document.querySelectorAll('.territory-circle.selected').forEach(c => c.classList.remove('selected'));
  campaignType = 'cond';
  campaignCondFromPauseRow = true;
  campaignCondThreshold = null;
  campaignMode = 'instant_launch';
  campaignPath = [];
  campaignCommittedPath = [];
  campaignPendingStart = null;
  campaignPreferredGarrison = 1;
  instantCampaignGarrison = 1;
  const g = document.getElementById('campaign-garrison-pick');
  if (g && g.parentNode) g.parentNode.removeChild(g);
  clearInstantCampaignWarpath();
  prependCombatLog(
    'Campaign Step CON: build path on the map — Commit, set condition (strip), Confirm, then Begin attack.',
    'system'
  );
  campaignTrace('campCheckCon:start', {});
  paintInstantCampaignHud('');
  renderAfterCampaignWarpathSync();
  if (
    window.risqueRuntimeHud &&
    typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
  ) {
    window.risqueRuntimeHud.setAttackChromeInteractive(true);
  }
}

function handleCampaignTerritoryClick(label) {
  if (campaignType === 'instant' || campaignType === 'pause' || campaignType === 'cond') {
    return handleInstantCampaignTerritoryClick(label);
  }

  const gs = window.gameState;
  const current = gs && gs.currentPlayer;
  const snap = territorySnapshot(label);

  if (campaignMode === 'start') {
    if (!snap) {
      prependCombatLog('Campaign: that territory is not on the board.', 'system');
      showCampaignStartPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    if (snap.owner !== current) {
      prependCombatLog(
        `Campaign: ${prettyTerritoryName(label)} is not yours — you are ${current}. Pick your own territory.`,
        'system'
      );
      showCampaignStartPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    if (snap.troops < 2) {
      prependCombatLog('Campaign: that territory needs at least 2 troops to attack from.', 'system');
      showCampaignStartPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    campaignPendingStart = snap;
    showCampaignStartPrompt();
    renderAfterCampaignWarpathSync();
    return true;
  }
  if (campaignMode === 'path') {
    const last = campaignPath[campaignPath.length - 1];
    if (label === last && campaignPath.length > 1) {
      campaignPath.pop();
      showCampaignPathPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    const adj = window.gameUtils.getAdjacencies(last);
    const isAerial = aerialBridge && aerialBridge.source === last && aerialBridge.target === label;
    if (!isAerial && !adj.includes(label)) {
      prependCombatLog('Campaign: next step must be adjacent (or your aerial bridge).', 'system');
      showCampaignPathPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    if (!snap) {
      showCampaignPathPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    if (snap.owner === current) {
      prependCombatLog('Campaign: pick an enemy territory to attack.', 'system');
      showCampaignPathPrompt();
      renderAfterCampaignWarpathSync();
      return true;
    }
    campaignPath.push(label);
    showCampaignPathPrompt();
    renderAfterCampaignWarpathSync();
    return true;
  }
  return false;
}

function goToReinforce() {
  attackChainFromCampaign = false;
  if (window.gameState) {
    if (window.gameUtils && typeof window.gameUtils.setAerialAttackUsesRemaining === 'function') {
      window.gameUtils.setAerialAttackUsesRemaining(window.gameState, 0);
    } else {
      window.gameState.aerialAttackEligible = false;
    }
    /* Wildcard aerial *uses* are spent; the drawn link stays for reinforce moves until receive-card. */
    delete window.gameState.risqueAerialLinkPending;
  }
  window.gameState.phase = 'reinforce';
  saveGameState();
  setTimeout(() => {
    navigateGameHtmlPreferSoft('game.html?phase=reinforce');
  }, 1000);
}

function backFromAerialPreview() {
  isAwaitingAerialConfirm = false;
  const restore = aerialSnapshotBeforePreview;
  aerialSnapshotBeforePreview = null;
  aerialPendingPreview = null;
  if (window.gameState) {
    delete window.gameState.risqueAerialLinkPending;
    if (restore && restore.source && restore.target) {
      window.gameState.aerialAttack = { source: String(restore.source), target: String(restore.target) };
    } else {
      window.gameState.aerialAttack = false;
      delete window.gameState.risqueAerialLinkLocked;
    }
  }
  aerialBridge = aerialBridgeFromGameState(window.gameState);
  if (elements.aerialBridgeGroup) elements.aerialBridgeGroup.innerHTML = '';
  if (aerialBridge) {
    renderAerialBridge();
  }
  isSelectingAerialSource = true;
  isSelectingAerialTarget = false;
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Aerial attack: select source.', {
      force: true
    });
  }
  showPrompt('Select source territory for aerial attack.', [{ label: 'Cancel', onClick: cancelAttack }]);
  saveGameState();
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  syncAttackPhaseActionLocks();
}

function confirmAerialBridgeCommit() {
  if (!aerialPendingPreview || !aerialPendingPreview.source || !aerialPendingPreview.target) {
    isAwaitingAerialConfirm = false;
    return;
  }
  isAwaitingAerialConfirm = false;
  const link = {
    source: String(aerialPendingPreview.source),
    target: String(aerialPendingPreview.target)
  };
  aerialPendingPreview = null;
  aerialSnapshotBeforePreview = null;
  if (window.gameState) {
    delete window.gameState.risqueAerialLinkPending;
    window.gameState.aerialAttack = link;
    window.gameState.risqueAerialLinkLocked = true;
  }
  aerialBridge = link;
  if (window.gameUtils && typeof window.gameUtils.addAerialAttackUses === 'function') {
    window.gameUtils.addAerialAttackUses(window.gameState, -1);
  } else {
    window.gameState.aerialAttackEligible = false;
  }
  renderAerialBridge();
  dismissPrompt();
  prependCombatLog(
    `${window.gameState.currentPlayer}: aerial bridge set ${prettyTerritoryName(link.source)} ↔ ${prettyTerritoryName(
      link.target
    )}.`,
    'voice'
  );
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(
      String(window.gameState.currentPlayer).toUpperCase(),
      `Aerial link: ${prettyTerritoryName(link.source)} → ${prettyTerritoryName(link.target)}.`,
      { force: true }
    );
  }
  attacker = null;
  defender = null;
  updateBattlePanelReadout();
  saveGameState();
  syncAttackPhaseActionLocks();
  if (typeof window.risqueMirrorPushGameState === 'function') {
    window.risqueMirrorPushGameState();
  }
  showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
}

function startAerialAttack() {
  isAwaitingAerialConfirm = false;
  aerialPendingPreview = null;
  aerialSnapshotBeforePreview = null;
  if (window.gameState) {
    delete window.gameState.risqueAerialLinkPending;
  }
  isSelectingAerialSource = true;
  const cur = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : '';
  prependCombatLog(`${cur}: AIR — pick source territory (2+ troops).`, 'voice');
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(String(cur).toUpperCase(), 'Aerial attack: select source.', {
      force: true
    });
  }
  showPrompt('Select source territory for aerial attack.', [{ label: 'Cancel', onClick: cancelAttack }]);
  syncAttackPhaseActionLocks();
}

function risqueAttackPhaseTerritoryClick(label, owner, troops) {
  if (window.gameState.attackPhase === 'pending_transfer') return;
  if (isAwaitingAerialConfirm) return;

  if (
    campaignMode === 'armed' ||
    campaignMode === 'instant_committed' ||
    campaignMode === 'cond_await_condition'
  ) {
    hintCampaignMapBlockedNoOp();
    return;
  }

  const campaignPlanning =
    campaignMode === 'start' ||
    campaignMode === 'path' ||
    campaignMode === 'instant_launch' ||
    campaignMode === 'instant_extend';
  if (campaignPlanning && handleCampaignTerritoryClick(label)) {
    return;
  }

  // Defensive resync: after long rounds/phase churn, stale attacker/defender can linger.
  const currentPlayerName = window.gameState.currentPlayer;
  if (attacker && (attacker.owner !== currentPlayerName || attacker.troops < 2)) {
    attacker = null;
    defender = null;
    updateBattlePanelReadout();
    clearPublicAttackSelectionLine();
  }
  if (defender && attacker) {
    const adj = window.gameUtils.getAdjacencies(attacker.label);
    const isAerialSel = aerialBridge && aerialBridge.source === attacker.label && aerialBridge.target === defender.label;
    if (defender.owner === currentPlayerName || (!isAerialSel && !adj.includes(defender.label))) {
      defender = null;
      updateBattlePanelReadout();
      setPublicAttackFromSelection(attacker.owner, attacker.label);
    }
  }

  if (isSelectingAerialSource) {
    if (owner !== window.gameState.currentPlayer || troops < 2) return;
    attacker = { label, owner, troops };
    updateBattlePanelReadout();
    isSelectingAerialSource = false;
    isSelectingAerialTarget = true;
    prependCombatLog(`${owner}: aerial bridge — source ${prettyTerritoryName(label)}.`, 'voice');
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(
        String(owner).toUpperCase(),
        `Aerial: picked source ${prettyTerritoryName(label)} — now pick target.`,
        { force: true }
      );
    }
    showPrompt('Select target territory for aerial attack.', [{ label: 'Cancel', onClick: cancelAttack }]);
    syncAttackPhaseActionLocks();
    return;
  }

  if (isSelectingAerialTarget) {
    if (owner === window.gameState.currentPlayer) return;
    isSelectingAerialTarget = false;
    isAwaitingAerialConfirm = true;
    if (window.gameState.risqueAerialLinkLocked && window.gameState.aerialAttack) {
      aerialSnapshotBeforePreview = {
        source: String(window.gameState.aerialAttack.source),
        target: String(window.gameState.aerialAttack.target)
      };
    } else {
      aerialSnapshotBeforePreview = null;
    }
    const pending = { source: attacker.label, target: label };
    aerialPendingPreview = pending;
    if (window.gameState) {
      window.gameState.risqueAerialLinkPending = pending;
    }
    aerialBridge = pending;
    updateBattlePanelReadout();
    renderAerialBridge();
    saveGameState();
    risqueAttackScheduleMirrorPush();
    const srcN = prettyTerritoryName(pending.source);
    const tgtN = prettyTerritoryName(pending.target);
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      const curN = String(window.gameState.currentPlayer).toUpperCase();
      window.risqueRuntimeHud.setControlVoiceText(
        curN,
        `Confirm: ${srcN} → ${tgtN} (aerial).`,
        { force: true }
      );
    }
    showPrompt(
      `Confirm <strong>wildcard aerial link</strong><br><br>${srcN} &rarr; ${tgtN}`,
      [
        { label: 'Confirm', onClick: confirmAerialBridgeCommit },
        { label: 'Back', onClick: backFromAerialPreview }
      ]
    );
    syncAttackPhaseActionLocks();
    return;
  }

  if (!attacker) {
    if (owner !== window.gameState.currentPlayer) {
      showPrompt('Select one of your territories with 2+ troops to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
      return;
    }
    if (troops < 2) {
      showPrompt('That territory needs at least 2 troops to attack.', [{ label: 'Cancel', onClick: cancelAttack }]);
      return;
    }
    attacker = { label, owner, troops };
    updateBattlePanelReadout();
    setPublicAttackFromSelection(owner, label);
    prependCombatLog(`${owner}: attacking from ${prettyTerritoryName(label)} (${troops} troops).`, 'voice');
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(
        String(owner).toUpperCase(),
        `From: ${prettyTerritoryName(label)} — pick a territory to attack.`,
        { force: true }
      );
    }
    showPrompt('Select territory to attack.', [{ label: 'Cancel', onClick: cancelAttack }]);
  } else if (attacker.label === label) {
    attacker = null;
    defender = null;
    updateBattlePanelReadout();
    clearPublicAttackSelectionLine();
    prependCombatLog(`${window.gameState.currentPlayer}: cleared attack-from selection.`, 'voice');
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(
        String(window.gameState.currentPlayer).toUpperCase(),
        'Select a territory to attack from.',
        { force: true }
      );
    }
    showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
  } else if (!defender) {
    const adjacencies = window.gameUtils.getAdjacencies(attacker.label);
    const isAerial = aerialBridge && aerialBridge.source === attacker.label && aerialBridge.target === label;
    if (owner === window.gameState.currentPlayer) {
      showPrompt('Pick an enemy territory to attack.', [{ label: 'Cancel', onClick: cancelAttack }]);
      return;
    }
    if (!isAerial && !adjacencies.includes(label)) {
      showPrompt('Target must be adjacent (or linked by aerial bridge).', [{ label: 'Cancel', onClick: cancelAttack }]);
      return;
    }
    defender = { label, owner, troops };
    updateBattlePanelReadout();
    setPublicAttackTargetSelection(label);
    dismissPrompt();
    document.querySelectorAll('.territory-circle').forEach(c => c.classList.toggle('selected', c.dataset.label === label || c.dataset.label === attacker.label));
    const maxAttackerDice = Math.min(attacker.troops - 1, 3);
    attackerDice = maxAttackerDice;
    prependCombatLog(
      `${window.gameState.currentPlayer}: attack ${prettyTerritoryName(attacker.label)} → ${prettyTerritoryName(label)} (${defender.owner} defends).`,
      'voice'
    );
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
      window.risqueRuntimeHud.setControlVoiceText(
        String(window.gameState.currentPlayer).toUpperCase(),
        `Into: ${prettyTerritoryName(label)} · ROLL / BLITZ / CAMPAIGN.`,
        { force: true }
      );
    }
    showPrompt('Refer to the buttons above for attack choices.', [{ label: 'Cancel', onClick: cancelAttack }], {
      attacker: Array.from({ length: maxAttackerDice }, (_, i) => ({ value: i + 1, label: `${i + 1} Dice` }))
    });
  }
}

window.risqueAttackPhaseTerritoryClick = risqueAttackPhaseTerritoryClick;
window.handleTerritoryClick = risqueAttackPhaseTerritoryClick;

/**
 * Full reload resets attack.js `let` state; soft navigation does not. Stale campaign / blitz / aerial-pick
 * flags make handleTerritoryClick no-op (e.g. armed | instant_committed | cond_await_condition returns early).
 */
function resetAttackInMemoryStateAfterShellPhaseRemount(gs) {
  stopPauseCampaignExecutionInternal();
  stopPausableBlitzInternal();
  clearPausableBlitzRoundTimers();
  pausableBlitzCondThreshold = null;
  pendingConditionalThreshold = null;
  isPausableBlitzActive = false;
  isPausableBlitzPaused = false;

  campaignMode = null;
  campaignType = null;
  campaignCondFromPauseRow = false;
  campaignCondThreshold = null;
  campaignPath = [];
  campaignPendingStart = null;
  attackChainFromCampaign = false;
  campaignPreferredGarrison = 1;
  campaignCommittedPath = [];
  campaignInstantLastOutcomes = [];
  campaignInstantLastStopped = null;
  instantCampaignGarrison = 1;

  clearInstantCampaignWarpath();
  syncCampaignWarpathMirror();

  attacker = null;
  defender = null;
  isAwaitingAerialConfirm = false;
  isSelectingAerialSource = false;
  isSelectingAerialTarget = false;
  aerialPendingPreview = null;
  aerialSnapshotBeforePreview = null;
  isAcquiring = false;

  if (gs) {
    try {
      delete gs.risqueAerialLinkPending;
    } catch (eAp) {
      /* ignore */
    }
  }
}

/** Matches attack mount helper risquePhaseIsContinentalConquestChain — never coerce continental elimination chain steps to "attack". */
function risquePhaseIsContinentalConquestChainForAttackMount(phase) {
  const ph = String(phase || '');
  return (
    ph === 'conquer' ||
    ph === 'con-cardtransfer' ||
    ph === 'con-cardplay' ||
    ph === 'con-income' ||
    ph === 'con-deploy' ||
    ph === 'con-transfertroops' ||
    ph === 'con-receivecard'
  );
}

/**
 * Attack mount sets phase attack then persists; loadGameState here can still read stale storage
 * (failed persist, quota, race). core.renderTerritories treats non-attack phase as non-attack UI and
 * wires the wrong click handler — map taps appear dead.
 */
function risqueAttackMountCoerceHostPhaseForGameHtml(gs) {
  if (!gs || window.risqueDisplayIsPublic) return false;
  if (risquePhaseIsContinentalConquestChainForAttackMount(gs.phase)) return false;
  try {
    document.body.setAttribute('data-risque-phase', 'attack');
  } catch (eBody) {
    /* ignore */
  }
  if (String(gs.phase || '') === 'attack') return false;
  gs.phase = 'attack';
  return true;
}

function initAttackPhase(mountEpoch) {
  if (window.__risqueAttackInitialized) return true;

  cacheElements();
  if (
    !elements.playerName ||
    !elements.roll ||
    !elements.blitz ||
    !elements.blitzDropdown ||
    !elements.newAttack ||
    !elements.reinforce ||
    !elements.aerialAttack ||
    !elements.logText ||
    !elements.aerialBridgeGroup ||
    !elements.uiOverlay
  ) {
    return false;
  }

  const hasCampaignMenu = !!document.getElementById('campaign-dropdown');
  if (hasCampaignMenu && (!elements.campaign || !elements.campaignDropdown || !elements.campaignWrap)) {
    return false;
  }

  window.gameUtils.loadGameState(gameState => {
    if (mountEpoch != null && mountEpoch !== window.__risqueAttackMountEpoch) return;
    if (!gameState) {
      window.gameUtils.showError('Could not load game state for attack.');
      return;
    }
    teardownAttackPhaseControlListeners();
    __risqueAttackControlsAbort = new AbortController();
    const acSig = __risqueAttackControlsAbort.signal;

    window.gameState = gameState;

    window.handleTerritoryClick = risqueAttackPhaseTerritoryClick;

    const phaseCoercedToAttack = risqueAttackMountCoerceHostPhaseForGameHtml(gameState);

    resetAttackInMemoryStateAfterShellPhaseRemount(gameState);

    let aerialStateMigrated = false;
    if (gameState.aerialAttack === true) {
      /* Legacy boolean only: preserve a use if the save already marked aerial eligible — do not grant from a bare `true` (corrupt / coerced flags). */
      const hadLegacyEligible = !!gameState.aerialAttackEligible;
      gameState.aerialAttack = false;
      if (window.gameUtils && typeof window.gameUtils.setAerialAttackUsesRemaining === 'function') {
        if (
          hadLegacyEligible &&
          window.gameUtils.getAerialAttackUsesRemaining &&
          window.gameUtils.getAerialAttackUsesRemaining(gameState) < 1
        ) {
          window.gameUtils.setAerialAttackUsesRemaining(gameState, 1);
        }
      } else if (!gameState.aerialAttackEligible) {
        gameState.aerialAttackEligible = true;
      }
      aerialStateMigrated = true;
    } else if (gameState.aerialAttack != null && typeof gameState.aerialAttack !== 'object') {
      gameState.aerialAttack = false;
      aerialStateMigrated = true;
    }
    if (gameState.risqueAerialLinkPending) {
      delete gameState.risqueAerialLinkPending;
      aerialStateMigrated = true;
    }
    const oa = gameState.aerialAttack;
    if (oa && typeof oa === 'object' && oa.source && oa.target && !gameState.risqueAerialLinkLocked) {
      gameState.risqueAerialLinkLocked = true;
      aerialStateMigrated = true;
    }

    const currentPlayer = gameState.players.find(p => p.name === gameState.currentPlayer);
    if (!currentPlayer) {
      window.gameUtils.showError('Invalid current player in save.');
      return;
    }
    if (window.risqueRuntimeHud && document.getElementById('runtime-hud-root')) {
      window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
    } else if (elements.playerName) {
      elements.playerName.textContent = `${gameState.currentPlayer} Attacks`;
      elements.playerName.style.color = window.gameUtils.colorMap[currentPlayer.color] || '#ffffff';
    }
    updateBattlePanelReadout();
    wireConditionalInputGuards(acSig);

    if (aerialStateMigrated || phaseCoercedToAttack) {
      saveGameState();
      if (typeof window.risqueMirrorPushGameState === 'function') {
        window.risqueMirrorPushGameState();
      }
    }

    if (String(gameState.attackPhase || '') !== 'pending_transfer') {
      delete gameState.risqueAerialUnlockedAfterCombat;
    }
    var aerialUsesInit =
      window.gameUtils && typeof window.gameUtils.getAerialAttackUsesRemaining === 'function'
        ? window.gameUtils.getAerialAttackUsesRemaining(gameState)
        : gameState.aerialAttackEligible
          ? 1
          : 0;
    if (aerialUsesInit > 0) {
      gameState.risqueAerialUnlockedAfterCombat = true;
    }

    aerialBridge = aerialBridgeFromGameState(gameState);
    isAerialAttackEnabled = !!aerialBridge || aerialUsesInit > 0;

    elements.roll.addEventListener('click', () => rollDice(), { signal: acSig });
    if (elements.qBlitzL3) {
      elements.qBlitzL3.addEventListener(
        'click',
        () => {
          void executeQBlitzQuick('leave3');
        },
        { signal: acSig }
      );
    }
    if (elements.qBlitzT3) {
      elements.qBlitzT3.addEventListener(
        'click',
        () => {
          void executeQBlitzQuick('take3');
        },
        { signal: acSig }
      );
    }
    if (elements.qCamp) {
      elements.qCamp.addEventListener('click', onQCampDevClick, { signal: acSig });
    }
    elements.blitz.addEventListener(
      'click',
      (e) => {
        e.stopPropagation();
        closeCampaignDropdown();
        toggleBlitzDropdown(e);
      },
      { signal: acSig }
    );
    elements.blitzDropdown.addEventListener(
      'click',
      e => {
      const sub = e.target.closest('[data-blitz-mode]');
      if (sub) {
        e.stopPropagation();
        const mode = sub.getAttribute('data-blitz-mode');
        closeBlitzDropdown();
        elements.blitzDropdown.querySelectorAll('.attack-menu-row--open').forEach(r => r.classList.remove('attack-menu-row--open'));
        if (mode === 'instant-cond') {
          beginConditionalBlitzPrep('instant');
        } else if (mode === 'pause-cond') {
          beginConditionalBlitzPrep('pause');
        }
        return;
      }
      const tile = e.target.closest('.attack-blitz-dropdown .attack-menu-tile');
      if (tile && !e.target.closest('.attack-menu-flyout')) {
        e.stopPropagation();
        closeBlitzDropdown();
        elements.blitzDropdown.querySelectorAll('.attack-menu-row--open').forEach(r => r.classList.remove('attack-menu-row--open'));
        if (tile.classList.contains('attack-menu-tile--instant')) {
          beginInstantBlitzPrep();
        } else if (tile.classList.contains('attack-menu-tile--pause')) {
          if (!isPausableBlitzActive && !isPausableBlitzPaused) beginBlitzStepPrep();
        }
      }
    },
      { signal: acSig }
    );
    if (elements.pausableBlitz) {
      elements.pausableBlitz.addEventListener('click', pausableBlitz, { signal: acSig });
    }
    if (elements.attackStepPauseBtn) {
      elements.attackStepPauseBtn.addEventListener('click', attackStepPauseClick, { signal: acSig });
    }
    if (elements.attackStepCancelBtn) {
      elements.attackStepCancelBtn.addEventListener('click', () => cancelAttack(), { signal: acSig });
    }
    if (elements.campaignDropdown) {
      elements.campaignDropdown.addEventListener(
        'click',
        e => {
        const sub = e.target.closest('[data-campaign-mode]');
        if (sub) {
          e.stopPropagation();
          const mode = sub.getAttribute('data-campaign-mode');
          closeCampaignDropdown();
          elements.campaignDropdown.querySelectorAll('.attack-menu-row--open').forEach(r => r.classList.remove('attack-menu-row--open'));
          if (mode === 'instant-cond') {
            startCampaignPlanning('cond', false);
          } else if (mode === 'pause-cond') {
            startCampaignPlanning('cond', true);
          }
          return;
        }
        const tile = e.target.closest('.attack-campaign-dropdown .attack-menu-tile');
        if (tile && !e.target.closest('.attack-menu-flyout')) {
          e.stopPropagation();
          closeCampaignDropdown();
          elements.campaignDropdown.querySelectorAll('.attack-menu-row--open').forEach(r => r.classList.remove('attack-menu-row--open'));
          if (tile.classList.contains('attack-menu-tile--instant')) {
            startCampaignPlanning('instant');
          } else if (tile.classList.contains('attack-menu-tile--pause')) {
            startCampaignPlanning('pause');
          }
        }
      },
        { signal: acSig }
      );
    }

    if (elements.campaign && elements.campaignDropdown) {
      elements.campaign.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          closeBlitzDropdown();
          toggleCampaignDropdown(e);
        },
        { signal: acSig }
      );
    } else if (elements.campaign) {
      elements.campaign.addEventListener(
        'click',
        () => {
          prependCombatLog('Campaign: reserved — details to follow.', 'system');
        },
        { signal: acSig }
      );
    }

    const onDocClickCloseAttackMenus = (ev) => {
      const bdd = elements.blitzDropdown;
      if (bdd && !bdd.hidden) {
        const wrap = elements.blitzWrap;
        if (!wrap || !wrap.contains(ev.target)) closeBlitzDropdown();
      }
      const cdd = elements.campaignDropdown;
      if (cdd && !cdd.hidden) {
        const cwrap = elements.campaignWrap;
        if (!cwrap || !cwrap.contains(ev.target)) closeCampaignDropdown();
      }
    };
    const onKeyEscapeCloseAttackMenus = (ev) => {
      if (ev.key !== 'Escape') return;
      closeBlitzDropdown();
      closeCampaignDropdown();
    };
    /* Bubble (not capture): closing menus must run *after* territory hit-testing so map taps still register
     * while BLITZ/CAMPAIGN flyouts are open (capture-first was eating/clobbering the interaction on some setups). */
    document.addEventListener('click', onDocClickCloseAttackMenus, { capture: false, signal: acSig });
    document.addEventListener('keydown', onKeyEscapeCloseAttackMenus, { capture: true, signal: acSig });
    if (!window.__risqueInstantCampaignClickBound) {
      window.__risqueInstantCampaignClickBound = true;
      document.addEventListener('click', function risqueInstantCampaignDocumentClick(e) {
        if (!e.target.closest('#control-voice')) return;
        onControlVoiceInstantCampaignClick(e);
      });
    }
    elements.newAttack.addEventListener('click', cancelAttack, { signal: acSig });
    elements.reinforce.addEventListener('click', goToReinforce, { signal: acSig });
    elements.aerialAttack.addEventListener('click', startAerialAttack, { signal: acSig });
    if (elements.aerialAttack2) {
      elements.aerialAttack2.addEventListener('click', startAerialAttack, { signal: acSig });
    }

    if (window.gameState.attackPhase === 'pending_transfer') {
      if (window.gameState.risqueDeferConquerElimination && !risqueDeferredEliminationConquerPrompt) {
        risqueDeferredEliminationConquerPrompt = window.gameState.risqueDeferConquerElimination;
      }
      initTroopTransfer();
    } else if (campaignMode === 'instant_launch' || campaignMode === 'instant_extend') {
      paintInstantCampaignHud('', instantCampaignPlanningMirrorOpts() || undefined);
    } else if (campaignMode === 'instant_committed') {
      paintInstantCampaignHud('');
    } else if (campaignMode === 'cond_await_condition') {
      paintInstantCampaignHud('');
    } else if (campaignMode === 'instant_results') {
      clearAttackCampaignPlanningAfterRun();
      const cpIdle = window.gameState && window.gameState.currentPlayer ? window.gameState.currentPlayer : 'Player';
      showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
        window.risqueRuntimeHud.setControlVoiceText(
          String(cpIdle).toUpperCase() + ' — ATTACK',
          'Select a territory to attack from.',
          { force: true }
        );
      }
      if (
        window.risqueRuntimeHud &&
        typeof window.risqueRuntimeHud.setAttackChromeInteractive === 'function'
      ) {
        window.risqueRuntimeHud.setAttackChromeInteractive(true);
      }
      renderAfterCampaignWarpathSync();
    } else if (campaignMode === 'start') {
      showCampaignStartPrompt();
    } else if (campaignMode === 'path') {
      showCampaignPathPrompt();
    } else if (campaignMode === 'armed') {
      armCampaignRun();
    } else if (!attacker && !defender) {
      showPrompt('Select territory to attack from.', [{ label: 'Cancel', onClick: cancelAttack }]);
    }

    window.gameUtils.renderTerritories(null, window.gameState);
    renderAerialBridge();
    syncAttackPhaseActionLocks();
    syncHostAttackCardEarnedIndicator();
    requestAnimationFrame(function () {
      syncAttackPhaseActionLocks();
      syncHostAttackCardEarnedIndicator();
    });
    window.__risqueAttackInitialized = true;
  });

  return true;
}

window.initAttackPhase = initAttackPhase;

/**
 * Attack phase runtime mount for game.html ?phase=attack (game-shell calls risquePhases.attack.mount).
 * Builds #ui-svg + HUD or legacy overlay, then runs initAttackPhase.
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
    /* Bridge art only — never steal clicks from #canvas .svg-overlay (z-index stacks ui-svg above markers). */
    return (
      '<g pointer-events="none">' +
        '<g id="aerial-bridge-group" pointer-events="none"></g>' +
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

    /* Full prepare wipes campaign DOM + attack.js memory — correct when entering attack from deploy/etc.,
     * but same-document attack→attack remounts (duplicate soft-nav) would destroy an in-progress campaign.
     * game-shell sets __risqueAttackMountFromPhase only for soft-nav; undefined ⇒ run prepare (fresh load…). */
    var skipCampaignPrepare = window.__risqueAttackMountFromPhase === "attack";
    try {
      delete window.__risqueAttackMountFromPhase;
    } catch (eDelApm) {
      /* ignore */
    }
    if (!skipCampaignPrepare && typeof window.risquePrepareAttackPhaseShellMount === "function") {
      try {
        window.risquePrepareAttackPhaseShellMount(window.gameState);
      } catch (ePrep) {
        /* ignore */
      }
    }

    // Fresh init each mount; epoch drops stale async init callbacks from a previous mount.
    window.__risqueAttackMountEpoch = (window.__risqueAttackMountEpoch || 0) + 1;
    var attackMountEpoch = window.__risqueAttackMountEpoch;
    window.__risqueAttackInitialized = false;
    /* Reinforce (and other phases) overwrite window.handleTerritoryClick; restore attack routing every mount. */
    window.handleTerritoryClick =
      typeof window.risqueAttackPhaseTerritoryClick === "function"
        ? window.risqueAttackPhaseTerritoryClick
        : window.handleTerritoryClick || null;

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
            buildAttackToolbarStripButtonsInnerHtml({ includeReinforceInStrip: true }) +
            '</div>' +
            '<div class="attack-step-ctl-wrap" id="attack-step-ctl-wrap" hidden aria-label="Blitz Step and Campaign Step">' +
            '<button type="button" id="attack-step-pause-btn" class="attack-ctl-btn attack-ctl-step-pause" title="Pause or resume">PAUSE</button>' +
            '<button type="button" id="attack-step-cancel-btn" class="attack-ctl-btn attack-ctl-step-cancel" title="Cancel and return to territory selection">CANCEL</button>' +
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
            '</div>' +
            '<div class="ucp-slot-strip-num-wrap">' +
              '<label id="ucp-voice-number-label" class="ucp-slot-strip-label" for="troops-input">Amount</label>' +
              '<input type="number" id="troops-input" class="ucp-slot-strip-number" disabled value="" title="Amount" />' +
            '</div>' +
            '</div>' +
          '</div>' +
          '<div id="attack-dev-row-strip" class="ucp-slot-strip attack-dev-row-strip" aria-label="Developer controls">' +
            '<div class="ucp-slot-strip-main">' +
            (typeof buildAttackDevRowInnerHtml === 'function' ? buildAttackDevRowInnerHtml() : '') +
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
      if (typeof window.risquePersistHostGameState === "function") {
        window.risquePersistHostGameState(window.gameState);
      } else {
        try {
          localStorage.setItem("gameState", JSON.stringify(window.gameState));
        } catch (e) {
          /* ignore */
        }
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

/** True while campaign path planning is active (attack.js). Used by runtime HUD to avoid clobbering innerHTML voice. */
window.risqueIsAttackCampaignActive = function () {
  return campaignMode != null;
};

document.addEventListener('DOMContentLoaded', () => {
  /* game.html uses risquePhases.attack.mount → initAttackPhase; attack.html bookmark calls initAttackPhase directly */
  var path = ((window.location.pathname || '').replace(/\\/g, '/')).toLowerCase();
  if (path.endsWith('/attack.html')) {
    initAttackPhase();
  }
});

window.addEventListener('resize', () => {
  requestAnimationFrame(() => {
    window.gameUtils.resizeCanvas();
    renderAerialBridge();
  });
});