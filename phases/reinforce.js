let reinforceCurrentPlayer = null;
let selectedSource = null;
let selectedDestination = null;
let sourceTerritory = null;
let destinationTerritory = null;
let troopsToMove = 1;
let moveMade = false;
let keyboardBuffer = '';
let reinforceWheelHandler = null;

/** Both directions: move troops over the committed wildcard aerial link during reinforce. */
function reinforceAerialConnects(gs, fromLabel, toLabel) {
  if (!gs || !gs.aerialAttack || typeof gs.aerialAttack !== "object") return false;
  if (!gs.aerialAttack.source || !gs.aerialAttack.target) return false;
  const a = gs.aerialAttack.source;
  const b = gs.aerialAttack.target;
  return (fromLabel === a && toLabel === b) || (fromLabel === b && toLabel === a);
}

function reinforceLog(message, data) {
  const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const logEntry = `[${timestamp}] [Reinforce] ${message}`;
  try {
    const logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
    logs.push(logEntry);
    if (data) logs.push(JSON.stringify(data, null, 2));
    localStorage.setItem("gameLogs", JSON.stringify(logs));
  } catch (e) {
    /* ignore */
  }
  console.log(logEntry, data || '');
}

function reinforceSaveState() {
  try {
    const raw = JSON.parse(JSON.stringify(window.gameState));
    delete raw.risqueReinforcePreview;
    localStorage.setItem('gameState', JSON.stringify(raw));
  } catch (e) {
    window.gameUtils.showError('Failed to save game state.');
  }
}

/**
 * Ephemeral mirror field: host + TV render troop counts as if the move happened, without committing troops.
 * Stripped from disk saves in game-shell (risqueMirrorPushGameState).
 */
function syncReinforcePreviewToGameState() {
  if (!window.gameState) return;
  if (moveMade || !selectedSource || !selectedDestination || troopsToMove < 1) {
    if (window.gameState.risqueReinforcePreview) {
      delete window.gameState.risqueReinforcePreview;
    }
    return;
  }
  window.gameState.risqueReinforcePreview = {
    source: selectedSource,
    destination: selectedDestination,
    amount: troopsToMove
  };
}

function renderReinforcePreview() {
  syncReinforcePreviewToGameState();
  window.gameUtils.renderTerritories(null, window.gameState);
  if (typeof window.risquePersistHostGameState === 'function') {
    window.risquePersistHostGameState();
  }
}

function getLiveCurrentPlayer() {
  return window.gameState && Array.isArray(window.gameState.players)
    ? window.gameState.players.find(p => p.name === window.gameState.currentPlayer)
    : null;
}

function reinforcePrettyTerritory(id) {
  return String(id || '')
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function reinforceShowPrompt(message, buttons = [], options = null, report = '') {
  var useVoice =
    typeof window.risqueSharedShowPrompt === 'function' &&
    document.getElementById('control-voice-text');
  if (useVoice) {
    window.risqueSharedShowPrompt(message, buttons, options, report);
    return;
  }

  const existing = document.getElementById('prompt');
  if (existing) existing.remove();

  const prompt = document.createElement('div');
  prompt.id = 'prompt';
  prompt.className = 'prompt';
  prompt.innerHTML = `<div class="prompt-text">${message}</div>`;

  if (report) {
    prompt.innerHTML += `<div class="prompt-report">${report}</div>`;
  }

  if (options && options.troops) {
    const label = document.createElement('label');
    label.textContent = `Troops to Move (1-${options.troops.max}): `;
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'prompt-input';
    input.id = 'troops-input';
    input.min = 1;
    input.max = options.troops.max;
    input.value = troopsToMove;
    input.addEventListener('input', () => {
      let v = parseInt(input.value, 10);
      if (isNaN(v) || v < 1) v = 1;
      if (v > options.troops.max) v = options.troops.max;
      troopsToMove = v;
      input.value = String(v);
      renderReinforcePreview();
    });
    prompt.appendChild(label);
    prompt.appendChild(input);

    const allButOne = document.createElement('button');
    allButOne.className = 'prompt-button';
    allButOne.textContent = 'ALL BUT 1';
    allButOne.onclick = () => {
      const source = getLiveCurrentPlayer()?.territories.find(t => t.name === selectedSource);
      if (!source) return;
      troopsToMove = Math.max(1, Number(source.troops || 0) - 1);
      input.value = String(Math.min(troopsToMove, options.troops.max));
      input.dispatchEvent(new Event('input'));
    };
    prompt.appendChild(allButOne);

    const allButThree = document.createElement('button');
    allButThree.className = 'prompt-button';
    allButThree.textContent = 'ALL BUT 3';
    allButThree.onclick = () => {
      const source = getLiveCurrentPlayer()?.territories.find(t => t.name === selectedSource);
      if (!source) return;
      troopsToMove = Math.max(1, Number(source.troops || 0) - 3);
      input.value = String(Math.min(troopsToMove, options.troops.max));
      input.dispatchEvent(new Event('input'));
    };
    allButThree.disabled = options.troops.max < 3;
    prompt.appendChild(allButThree);
  }

  buttons.forEach(btn => {
    const button = document.createElement('button');
    button.className = 'prompt-button';
    button.textContent = btn.label;
    button.onclick = btn.onClick;
    prompt.appendChild(button);
  });

  const uiOverlay = document.getElementById('ui-overlay');
  if (uiOverlay) uiOverlay.appendChild(prompt);
}

function reinforceSyncPublicVoice() {
  if (window.risqueDisplayIsPublic || !reinforceCurrentPlayer || moveMade) return;
  const fromN = selectedSource ? reinforcePrettyTerritory(selectedSource) : '—';
  const toN = selectedDestination ? reinforcePrettyTerritory(selectedDestination) : '—';
  const line = `From: ${fromN} · To: ${toN} · Move: ${troopsToMove}`;
  if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === 'function') {
    window.risqueRuntimeHud.setControlVoiceText(
      `${reinforceCurrentPlayer.name.toUpperCase()} — REINFORCE`,
      line,
      { force: true }
    );
  }
}

function reinforceSetPickHintPulse(active) {
  const hint = document.getElementById('reinforce-pick-hint');
  const skipBt = document.getElementById('reinforce-btn-skip');
  if (hint) hint.classList.toggle('reinforce-pick-attention', !!active);
  if (skipBt) skipBt.classList.toggle('reinforce-pick-attention', !!active);
}

function refreshReinforceCompactHud() {
  const skip = document.getElementById('reinforce-btn-skip');
  if (!skip) return;
  const status = document.getElementById('reinforce-compact-status');
  const reset = document.getElementById('reinforce-btn-reset');
  const r1 = document.getElementById('reinforce-btn-r1third');
  const cm = document.getElementById('reinforce-btn-confirm-move');
  const a1 = document.getElementById('reinforce-btn-allbut1');
  const a3 = document.getElementById('reinforce-btn-allbut3');
  const troopPrompt = !!window.__risqueReinforceTroopPromptActive;
  if (moveMade) {
    if (status) {
      status.textContent = 'Reinforcement finished — continuing…';
    } else if (
      window.risqueRuntimeHud &&
      typeof window.risqueRuntimeHud.setControlVoiceText === 'function' &&
      reinforceCurrentPlayer
    ) {
      window.risqueRuntimeHud.setControlVoiceText(
        `${reinforceCurrentPlayer.name.toUpperCase()} — REINFORCE`,
        'Reinforcement finished — continuing…',
        { force: true }
      );
    }
    if (skip) skip.disabled = true;
    if (reset) reset.disabled = true;
    if (r1) r1.disabled = true;
    if (cm) cm.disabled = true;
    if (a1) a1.disabled = true;
    if (a3) a3.disabled = true;
    const prDone = document.getElementById('reinforce-row-pick-hint');
    if (prDone) prDone.hidden = true;
    reinforceSetPickHintPulse(false);
    return;
  }
  if (skip) skip.disabled = false;
  if (reset) reset.disabled = !(selectedSource || selectedDestination || troopPrompt);
  if (troopPrompt) {
    if (r1) r1.disabled = false;
    if (cm) cm.disabled = false;
  } else if (r1) {
    r1.disabled = !(selectedSource && selectedDestination);
  }

  const pickRow = document.getElementById('reinforce-row-pick-hint');
  const hintEl = document.getElementById('reinforce-pick-hint');
  if (pickRow && hintEl) {
    pickRow.hidden = false;
    if (troopPrompt) {
      reinforceSetPickHintPulse(false);
    } else if (!selectedSource) {
      reinforceSetPickHintPulse(true);
    } else if (!selectedDestination) {
      reinforceSetPickHintPulse(false);
    } else {
      reinforceSetPickHintPulse(false);
    }
  } else {
    reinforceSetPickHintPulse(false);
  }

  if (status) {
    const fromN = selectedSource ? reinforcePrettyTerritory(selectedSource) : '—';
    const toN = selectedDestination ? reinforcePrettyTerritory(selectedDestination) : '—';
    status.textContent =
      'FROM: ' +
      fromN +
      '\nTO: ' +
      toN +
      '\nMOVE: ' +
      String(troopsToMove) +
      ' (wheel adjusts when both territories selected)';
  }
  reinforceSyncPublicVoice();
}

function reinforceCompactSkip() {
  if (moveMade || !reinforceCurrentPlayer) return;
  moveMade = true;
  if (typeof window.risqueAppendGameLog === 'function') {
    window.risqueAppendGameLog(`${reinforceCurrentPlayer.name} skips reinforcement.`, 'battle');
  }
  if (window.gameState) {
    var nm = String(reinforceCurrentPlayer.name || 'Player');
    window.gameState.risqueControlVoice = {
      primary: nm.toUpperCase() + ' — SKIPPED REINFORCEMENT',
      report: 'Advancing…',
      reportClass: 'ucp-voice-report'
    };
    try {
      localStorage.setItem('gameState', JSON.stringify(window.gameState));
    } catch (eSk) {}
    if (typeof window.risqueMirrorPushGameState === 'function') {
      window.risqueMirrorPushGameState();
    }
  }
  if (typeof window.risqueDismissAttackPrompt === 'function') {
    window.risqueDismissAttackPrompt();
  }
  reinforceProceedAfterReinforce();
  refreshReinforceCompactHud();
}

function bindReinforceCompactHud() {
  const skip = document.getElementById('reinforce-btn-skip');
  const reset = document.getElementById('reinforce-btn-reset');
  const r1 = document.getElementById('reinforce-btn-r1third');
  if (!skip || !reset || !r1) return;
  skip.onclick = () => reinforceCompactSkip();
  reset.onclick = () => resetReinforceSelection();
  r1.onclick = () => confirmReinforceMove();
  refreshReinforceCompactHud();
}

/** Clear slot-strip echo buttons; host reinforce uses #reinforce-compact-grid only. */
function reinforceHostClearSlotStripButtons() {
  var i;
  for (i = 0; i < 6; i += 1) {
    var b = document.getElementById('control-btn-' + i);
    if (!b) continue;
    b.classList.add('ucp-slot-empty');
    b.textContent = '';
    b.title = '';
    b.onclick = null;
    b.disabled = true;
  }
}

function reinforceFindPromptButton(buttons, needle) {
  var n = String(needle || '')
    .toLowerCase()
    .trim();
  var j;
  for (j = 0; j < (buttons || []).length; j += 1) {
    var lab =
      buttons[j] && buttons[j].label != null
        ? String(buttons[j].label)
            .toLowerCase()
            .trim()
        : '';
    if (lab === n) return buttons[j];
  }
  return null;
}

/**
 * Host reinforce: map shared showPrompt buttons into the panel (slot strip unused).
 * Called from phases/attack.js instead of filling control-btn-0..5.
 */
window.risqueReinforceHostApplyPrompt = function (buttons) {
  reinforceHostClearSlotStripButtons();
  var rowTroop = document.getElementById('reinforce-row-troop');
  var r1 = document.getElementById('reinforce-btn-r1third');
  var a1 = document.getElementById('reinforce-btn-allbut1');
  var a3 = document.getElementById('reinforce-btn-allbut3');
  var cm = document.getElementById('reinforce-btn-confirm-move');
  var holder = document.getElementById('reinforce-troops-holder');
  /* Must be #troops-input row — attack toolbar also has .ucp-slot-strip-num-wrap (#cond-threshold). */
  var nw = document.querySelector('#ucp-slot-strip .ucp-slot-strip-num-wrap');
  if (!r1) return;

  function wireTroopNumRow(intoHolder) {
    if (!holder || !nw) return;
    if (intoHolder) {
      if (nw.parentNode !== holder) holder.appendChild(nw);
      holder.removeAttribute('hidden');
      holder.setAttribute('aria-hidden', 'false');
      nw.classList.add('reinforce-troops-num-wrap--in-panel');
    } else {
      var strip = document.getElementById('ucp-slot-strip');
      var main = strip && strip.querySelector('.ucp-slot-strip-main');
      if (main && nw.parentNode === holder) main.appendChild(nw);
      holder.setAttribute('hidden', 'hidden');
      holder.setAttribute('aria-hidden', 'true');
      nw.classList.remove('reinforce-troops-num-wrap--in-panel');
    }
  }

  var L = buttons && Array.isArray(buttons) ? buttons.length : 0;
  window.__risqueReinforceTroopPromptActive = L === 4;

  if (L === 0) {
    if (rowTroop) {
      rowTroop.hidden = true;
      rowTroop.setAttribute('hidden', 'hidden');
    }
    r1.textContent = 'CONFIRM';
    r1.onclick = function () {
      confirmReinforceMove();
    };
    wireTroopNumRow(false);
    if (a1) {
      a1.onclick = null;
      a1.disabled = true;
    }
    if (a3) {
      a3.onclick = null;
      a3.disabled = true;
    }
    if (cm) {
      cm.onclick = null;
      cm.disabled = true;
    }
    refreshReinforceCompactHud();
    return;
  }

  if (L === 1) {
    if (rowTroop) {
      rowTroop.hidden = true;
      rowTroop.setAttribute('hidden', 'hidden');
    }
    var only = buttons[0];
    r1.textContent = String(only && only.label ? only.label : 'CANCEL').toUpperCase();
    r1.onclick = only && only.onClick ? only.onClick : null;
    r1.disabled = !!(only && only.disabled);
    wireTroopNumRow(false);
    refreshReinforceCompactHud();
    return;
  }

  if (L === 4) {
    if (rowTroop) {
      rowTroop.hidden = false;
      rowTroop.removeAttribute('hidden');
    }
    var bAll1 = reinforceFindPromptButton(buttons, 'ALL BUT 1');
    var bAll3 = reinforceFindPromptButton(buttons, 'ALL BUT 3');
    var bConf = reinforceFindPromptButton(buttons, 'confirm');
    var bCan = reinforceFindPromptButton(buttons, 'cancel');
    r1.textContent = 'CANCEL';
    r1.onclick = bCan && bCan.onClick ? bCan.onClick : () => resetReinforceSelection();
    r1.disabled = !!(bCan && bCan.disabled);
    if (a1) {
      a1.textContent = 'ALL BUT 1';
      a1.onclick = bAll1 && bAll1.onClick ? bAll1.onClick : null;
      a1.disabled = !!(bAll1 && bAll1.disabled);
    }
    if (a3) {
      a3.textContent = 'ALL BUT 3';
      a3.onclick = bAll3 && bAll3.onClick ? bAll3.onClick : null;
      a3.disabled = !!(bAll3 && bAll3.disabled);
    }
    if (cm) {
      cm.textContent = 'CONFIRM';
      cm.onclick = bConf && bConf.onClick ? bConf.onClick : () => confirmReinforceMove();
      cm.disabled = !!(bConf && bConf.disabled);
    }
    wireTroopNumRow(true);
    refreshReinforceCompactHud();
    return;
  }

  if (rowTroop) {
    rowTroop.hidden = true;
    rowTroop.setAttribute('hidden', 'hidden');
  }
  r1.textContent = 'OK';
  r1.onclick = buttons[0] && buttons[0].onClick ? buttons[0].onClick : null;
  wireTroopNumRow(false);
  refreshReinforceCompactHud();
};

function reinforceTroopVoiceOptions(maxTroops) {
  return {
    troops: {
      max: maxTroops,
      min: 1,
      initial: troopsToMove,
      onAdjust(v) {
        troopsToMove = v;
        renderReinforcePreview();
        refreshReinforceCompactHud();
      }
    }
  };
}

function reinforceMakeTroopPromptButtons(maxTroops) {
  const canAllButThree = maxTroops >= 3;
  return [
    {
      label: 'ALL BUT 1',
      onClick() {
        const source = getLiveCurrentPlayer()?.territories.find(t => t.name === selectedSource);
        if (!source) return;
        troopsToMove = Math.max(1, Math.min(maxTroops, Number(source.troops || 0) - 1));
        const input = document.getElementById('troops-input');
        if (input) {
          input.value = String(troopsToMove);
          input.dispatchEvent(new Event('input'));
        }
        refreshReinforceCompactHud();
      }
    },
    {
      label: 'ALL BUT 3',
      disabled: !canAllButThree,
      onClick() {
        if (!canAllButThree) return;
        const source = getLiveCurrentPlayer()?.territories.find(t => t.name === selectedSource);
        if (!source) return;
        troopsToMove = Math.max(1, Math.min(maxTroops, Number(source.troops || 0) - 3));
        const input = document.getElementById('troops-input');
        if (input) {
          input.value = String(troopsToMove);
          input.dispatchEvent(new Event('input'));
        }
        refreshReinforceCompactHud();
      }
    },
    { label: 'Confirm', onClick: () => confirmReinforceMove() },
    { label: 'Cancel', onClick: () => resetReinforceSelection() }
  ];
}

function updateReinforcePlayerName() {
  if (window.risqueRuntimeHud && document.getElementById('runtime-hud-root') && window.gameState) {
    window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
    return;
  }
  const el = document.getElementById('reinforce-player-name');
  if (!el) return;
  if (!reinforceCurrentPlayer) {
    el.textContent = 'No Player';
    el.style.color = '#000000';
    return;
  }
  el.textContent = `${reinforceCurrentPlayer.name} reinforces`;
  el.style.color = window.gameUtils.colorMap[reinforceCurrentPlayer.color] || '#000000';
}

/**
 * After reinforcement (move or skip): always go to receive-card so the current player
 * sees their hand and either draws a deck card (if they captured / earned one) or an
 * explicit “no new card” message. Turn advance + next-player handoff happen on Continue
 * in phases/receivecard.js — not here.
 */
function reinforceProceedAfterReinforce() {
  if (typeof window.risqueDismissAttackPrompt === 'function') {
    window.risqueDismissAttackPrompt();
  }
  if (typeof window.risqueClearSpectatorFocus === 'function') {
    window.risqueClearSpectatorFocus();
  } else if (window.gameState) {
    delete window.gameState.risqueSpectatorFocusLabels;
  }
  if (typeof window.risqueEndAerialBridgeForTurn === 'function') {
    try {
      window.risqueEndAerialBridgeForTurn();
    } catch (eAerialEnd) {
      /* ignore */
    }
  }
  var gs = window.gameState;
  if (!gs) return;
  var earned = !!(gs.cardEarnedViaAttack || gs.cardEarnedViaCardplay);
  var deckDrawStillOwed = earned && !gs.cardAwardedThisTurn;

  try {
    if (localStorage.getItem("risqueDebugReceiveCardVerbose") === "1") {
      var reinfSnap =
        typeof window.risqueDebugReceiveCard === "function"
          ? window.risqueDebugReceiveCard(gs)
          : null;
      console.info("[Reinforce] → receive-card (always)", {
        earned: earned,
        deckDrawStillOwed: deckDrawStillOwed,
        snapshot: reinfSnap
      });
    }
  } catch (eReinfDbg) {
    /* ignore */
  }

  gs.phase = 'receivecard';
  if (gs.risqueTransferPulse) {
    delete gs.risqueTransferPulse;
  }
  reinforceSaveState();
  if (typeof window.risqueMirrorPushGameState === "function") {
    try {
      window.risqueMirrorPushGameState();
    } catch (eMirror) {
      /* ignore */
    }
  }
  if (window.risqueNavigateWithFade) {
    window.risqueNavigateWithFade('game.html?phase=receivecard');
  } else {
    window.location.href = 'game.html?phase=receivecard';
  }
}

function resetReinforceSelection() {
  if (moveMade) return;
  selectedSource = null;
  selectedDestination = null;
  sourceTerritory = null;
  destinationTerritory = null;
  troopsToMove = 1;
  keyboardBuffer = '';
  if (typeof window.risqueClearSpectatorFocus === 'function') {
    window.risqueClearSpectatorFocus();
  }
  const voiceLead = reinforceCurrentPlayer
    ? `<strong>${reinforceCurrentPlayer.name.toUpperCase()}</strong> — REINFORCE` +
      '<div class="reinforce-voice-pick-cta"><strong>CHOOSE FROM AND TO TERRITORIES</strong> on the panel — pick on the map — <strong>OR</strong> tap <strong>SKIP</strong>.</div>'
    : 'REINFORCE';
  /* Slot-strip Skip duplicated #reinforce-btn-skip in phase row; compact HUD is the only action row. */
  reinforceShowPrompt(voiceLead, []);
  /*
   * Legacy reinforceShowPrompt (no #control-voice-text) never calls risqueReinforceHostApplyPrompt —
   * compact grid can stay on the troop row. Voice path already applied L===0 once; do not call again
   * or wireTroopNumRow runs twice and can confuse the HUD.
   */
  if (
    typeof window.risqueReinforceHostApplyPrompt === 'function' &&
    !document.getElementById('control-voice-text')
  ) {
    window.__risqueReinforceTroopPromptActive = false;
    window.risqueReinforceHostApplyPrompt([]);
  }
  var sk = document.getElementById('reinforce-btn-skip');
  var rs = document.getElementById('reinforce-btn-reset');
  if (sk) sk.onclick = function () { reinforceCompactSkip(); };
  if (rs) rs.onclick = function () { resetReinforceSelection(); };
  if (window.gameState && window.gameState.risqueReinforcePreview) {
    delete window.gameState.risqueReinforcePreview;
  }
  window.gameUtils.renderTerritories(null, window.gameState);
  if (typeof window.risquePersistHostGameState === 'function') {
    window.risquePersistHostGameState();
  }
  refreshReinforceCompactHud();
}

function confirmReinforceMove() {
  if (!selectedSource || !selectedDestination) return;
  if (window.gameState && window.gameState.risqueReinforcePreview) {
    delete window.gameState.risqueReinforcePreview;
  }
  const livePlayer = getLiveCurrentPlayer();
  if (!livePlayer) return;
  const liveSource = livePlayer.territories.find(t => t.name === selectedSource);
  const liveDestination = livePlayer.territories.find(t => t.name === selectedDestination);
  if (!liveSource || !liveDestination) return;
  const max = liveSource.troops - 1;
  if (troopsToMove < 1 || troopsToMove > max) {
    reinforceShowPrompt(
      `Adjust troops to move from ${selectedSource.replace(/_/g, ' ')} to ${selectedDestination.replace(/_/g, ' ')}.`,
      reinforceMakeTroopPromptButtons(max),
      reinforceTroopVoiceOptions(max),
      `Must move 1 to ${max} troops.`
    );
    return;
  }

  const destTroopBefore = Number(liveDestination.troops || 0);
  liveSource.troops = Number(liveSource.troops || 0) - Number(troopsToMove || 0);
  liveDestination.troops = destTroopBefore + Number(troopsToMove || 0);
  livePlayer.troopsTotal = livePlayer.territories.reduce((sum, t) => sum + Number(t.troops || 0), 0);
  reinforceCurrentPlayer = livePlayer;
  window.gameState.phase = 'reinforce';
  const fromName = selectedSource;
  const toName = selectedDestination;
  moveMade = true;
  selectedSource = null;
  selectedDestination = null;
  sourceTerritory = null;
  destinationTerritory = null;
  reinforceSaveState();
  reinforceLog('Reinforcement confirmed', {
    source: fromName,
    destination: toName,
    moved: troopsToMove,
    sourceNow: liveSource.troops,
    destinationNow: liveDestination.troops
  });
  if (typeof window.risqueAppendGameLog === 'function') {
    window.risqueAppendGameLog(
      `${livePlayer.name} transfers ${troopsToMove} troops to ${reinforcePrettyTerritory(toName)}.`,
      'battle'
    );
  }
  var REINF_PULSE_MS = 1000;
  if (window.gameState) {
    window.gameState.risqueTransferPulse = {
      label: toName,
      fromTroops: destTroopBefore,
      toTroops: liveDestination.troops,
      startMs: Date.now(),
      durationMs: REINF_PULSE_MS
    };
    if (typeof window.risqueOnHostTransferPulseComplete === 'function') {
      window.risqueOnHostTransferPulseComplete = null;
    }
    window.risqueOnHostTransferPulseComplete = function () {
      reinforceProceedAfterReinforce();
    };
    if (window.gameUtils && typeof window.gameUtils.risqueStartTransferPulseTicker === 'function') {
      window.gameUtils.risqueStartTransferPulseTicker();
    }
    window.setTimeout(function () {
      if (typeof window.risqueOnHostTransferPulseComplete !== 'function') return;
      var late = window.risqueOnHostTransferPulseComplete;
      window.risqueOnHostTransferPulseComplete = null;
      try {
        late();
      } catch (eFb) {
        /* ignore */
      }
    }, REINF_PULSE_MS + 400);
  }
  window.gameUtils.renderTerritories(null, window.gameState);
  window.gameUtils.renderStats(window.gameState);
  if (typeof window.risqueReplayRecordReinforce === "function") {
    window.risqueReplayRecordReinforce(window.gameState);
  }
  refreshReinforceCompactHud();
  /* Host: primary handoff runs from core risqueOnHostTransferPulseComplete when the pulse ends;
   * fallback timer above covers throttled rAF / edge cases. */
}

function handleReinforceTerritoryClick(label, owner, troops) {
  if (moveMade || !reinforceCurrentPlayer || !window.gameState) return;

  if (!selectedSource) {
    if (owner !== window.gameState.currentPlayer) {
      reinforceShowPrompt('Select territory to reinforce from.', [{ label: 'Cancel', onClick: resetReinforceSelection }], null, 'You do not own this territory.');
      return;
    }
    if (troops < 2) {
      reinforceShowPrompt('Select territory to reinforce from.', [{ label: 'Cancel', onClick: resetReinforceSelection }], null, 'Need at least 2 troops.');
      return;
    }
    selectedSource = label;
    sourceTerritory = reinforceCurrentPlayer.territories.find(t => t.name === label);
    troopsToMove = 1;
    if (typeof window.risqueAppendGameLog === 'function') {
      window.risqueAppendGameLog(
        `${reinforceCurrentPlayer.name}: reinforcing from ${reinforcePrettyTerritory(label)}.`,
        'voice'
      );
    }
    if (typeof window.risqueSetSpectatorFocus === 'function') {
      window.risqueSetSpectatorFocus([label]);
    }
    reinforceShowPrompt('Select adjacent territory to reinforce to.', [{ label: 'Cancel', onClick: resetReinforceSelection }]);
    syncReinforcePreviewToGameState();
    window.gameUtils.renderTerritories(selectedSource, window.gameState);
    if (typeof window.risquePersistHostGameState === 'function') {
      window.risquePersistHostGameState();
    }
    refreshReinforceCompactHud();
    return;
  }

  if (!selectedDestination && label !== selectedSource) {
    if (owner !== window.gameState.currentPlayer) {
      reinforceShowPrompt('Select adjacent territory to reinforce to.', [{ label: 'Cancel', onClick: resetReinforceSelection }], null, 'You do not own this territory.');
      return;
    }
    const adj = window.gameUtils.getAdjacencies(selectedSource).includes(label);
    const byAerial = reinforceAerialConnects(window.gameState, selectedSource, label);
    if (!adj && !byAerial) {
      reinforceShowPrompt('Select adjacent territory to reinforce to.', [{ label: 'Cancel', onClick: resetReinforceSelection }], null, 'Territory must be adjacent (or at the other end of your aerial link).');
      return;
    }
    selectedDestination = label;
    destinationTerritory = reinforceCurrentPlayer.territories.find(t => t.name === label);
    if (typeof window.risqueAppendGameLog === 'function') {
      window.risqueAppendGameLog(
        `${reinforceCurrentPlayer.name}: reinforcing into ${reinforcePrettyTerritory(label)} (wheel adjusts amount).`,
        'voice'
      );
    }
    if (typeof window.risqueSetSpectatorFocus === 'function') {
      window.risqueSetSpectatorFocus([selectedSource, label]);
    }
    const maxMove = sourceTerritory.troops - 1;
    reinforceShowPrompt(
      `Adjust troops to move from ${selectedSource.replace(/_/g, ' ')} to ${selectedDestination.replace(/_/g, ' ')}.`,
      reinforceMakeTroopPromptButtons(maxMove),
      reinforceTroopVoiceOptions(maxMove)
    );
    renderReinforcePreview();
    refreshReinforceCompactHud();
  }
}

function initReinforcePhase() {
  if (window.__risqueReinforceInitialized) return true;
  if (!window.gameUtils) return false;

  function runReinforceInitCore() {
    var gameState = window.gameState;
    if (!gameState) {
      window.gameUtils.showError('Could not load game state for reinforcement.');
      return;
    }
    gameState.phase = 'reinforce';
    moveMade = false;
    selectedSource = null;
    selectedDestination = null;
    sourceTerritory = null;
    destinationTerritory = null;
    troopsToMove = 1;
    reinforceCurrentPlayer = gameState.players.find(p => p.name === gameState.currentPlayer);
    if (!reinforceCurrentPlayer) {
      window.gameUtils.showError('No current player. Redirecting to login.');
      setTimeout(function () {
        var u =
          typeof window.risqueLoginRecoveryUrl === "function"
            ? window.risqueLoginRecoveryUrl()
            : "game.html?phase=login&loginLegacyNext=game.html%3Fphase%3DplayerSelect%26selectKind%3DfirstCard&loginLoadRedirect=game.html%3Fphase%3Dcardplay%26legacyNext%3Dincome.html";
        window.location.href = u;
      }, 1200);
      return;
    }

    updateReinforcePlayerName();
    bindReinforceCompactHud();
    window.handleTerritoryClick = handleReinforceTerritoryClick;
    window.gameUtils.renderTerritories(null, window.gameState);
    window.gameUtils.renderStats(window.gameState);
    if (reinforceWheelHandler) {
      document.removeEventListener('wheel', reinforceWheelHandler, { capture: true });
    }
    reinforceWheelHandler = function (e) {
      if (!selectedSource || !selectedDestination || moveMade) return;
      const source = getLiveCurrentPlayer()?.territories.find(t => t.name === selectedSource);
      if (!source) return;
      const max = Math.max(1, Number(source.troops || 0) - 1);
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      troopsToMove = Math.max(1, Math.min(max, Number(troopsToMove || 1) + delta));
      const input = document.getElementById('troops-input');
      if (input) input.value = String(troopsToMove);
      renderReinforcePreview();
      refreshReinforceCompactHud();
    };
    document.addEventListener('wheel', reinforceWheelHandler, { passive: false, capture: true });
    resetReinforceSelection();
    reinforceSaveState();
    window.__risqueReinforceInitialized = true;
    reinforceLog('Reinforcement initialized', { player: window.gameState.currentPlayer });
    if (typeof window.risqueRedrawAerialBridgeOverlay === "function") {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            window.risqueRedrawAerialBridgeOverlay();
          } catch (eBr) {
            /* ignore */
          }
        });
      });
    }
  }

  /* game.html shell already set window.gameState — async loadGameState deferred markers for ~1 frame. */
  var gs0 = window.gameState;
  if (
    gs0 &&
    typeof window.gameUtils.validateGameState === 'function' &&
    window.gameUtils.validateGameState(gs0) &&
    String(gs0.phase || '') === 'reinforce'
  ) {
    runReinforceInitCore();
    return true;
  }

  window.gameUtils.loadGameState(function (gameState) {
    if (!gameState) {
      window.gameUtils.showError('Could not load game state for reinforcement.');
      return;
    }
    window.gameState = gameState;
    window.gameState.phase = 'reinforce';
    runReinforceInitCore();
  });

  return true;
}

window.initReinforcePhase = initReinforcePhase;

document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname.includes('reinforce.html')) {
    initReinforcePhase();
  }
});
