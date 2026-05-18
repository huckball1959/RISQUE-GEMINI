(function () {
  "use strict";

  var STORAGE_KEY = "gameState";
  /** Host Grace: serialized [{ player, json }] cardplay turn starts; survives page reload. */
  var GRACE_SNAPSHOTS_STORAGE_KEY = "risqueGraceCardplaySnapshots";
  /** TV tab follows this payload (frozen board during private cardplay draft). Host keeps full state in STORAGE_KEY. */
  var PUBLIC_MIRROR_KEY = "risquePublicMirrorState";
  /** Public TV page public-conquest-bridge.html sets this; host advances to conquer / card transfer. */
  var PUBLIC_CONQUEST_CONTINUE_REQ_KEY = "risquePublicConquestContinueRequest";
  /** Host pointer position (normalized to #canvas rect) for duplicate cursor on public TV. */
  var PUBLIC_CURSOR_MIRROR_KEY = "risquePublicCursorMirror";
  var LOG_KEY = "gameLogs";
  var LEDGER_KEY = "risqueTransitionLedger";
  var ROUND_AUTOSAVE_KEY = "risqueRoundAutosaves";
  var ROUND_AUTOSAVE_PROMPT_SEEN_KEY = "risqueRoundAutosavePromptSeen";
  var ROUND_AUTOSAVE_SESSION_COUNT_KEY = "risqueRoundAutosaveSessionCount";
  var __risqueRoundAutosaveSawNonFirstPlayerThisSession = false;
  var __risqueRoundAutosaveSkippedInitialFirstPlayerCycle = false;
  /** Host runtime refreshVisuals skips cardplay.mount — detect phase transition into cardplay for replay-deal flush. */
  var __risquePrevPhaseForReplayCardplayHook = "";
  var MAX_LOG_ENTRIES = 250;
  var MAX_LEDGER_ENTRIES = 300;
  var MAX_PLAYED_CARDS_GALLERY_ENTRIES = 180;
  var PUBLIC_MIRROR_POLL_MS = 100;
  var MAX_ROUND_AUTOSAVES = 10;
  var SIDECAR_INDEX_KEY = "risqueSidecarIndexV1";
  /** Survives refresh: skip duplicate round-complete / game-win exports for the same session. */
  var AUTOSAVE_FP_ROUND_KEY = "risqueAutosaveFpRoundCompleteV1";
  var AUTOSAVE_FP_WIN_KEY = "risqueAutosaveFpGameWinV1";
  /** In-memory only: cleared on every reload / hard refresh; round JSON writes use File System Access API. */
  var __risqueRoundAutosaveDirHandle = null;
  /** Host: periodic call to risqueSessionDiskCleanupStaleCheckpoints (no-op; session files are never auto-deleted). */
  var __risqueStaleCkptCleanupTimer = null;
  var RISQUE_STALE_CKPT_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
  /**
   * Resolves after launcher disk bootstrap + IndexedDB save-folder restore (if any).
   * Round autosave must await this or it often picks "browser-download" before the handle exists.
   */
  var __risqueAutosaveFolderBootPromise = Promise.resolve();

  function waitForAutosaveFolderBoot() {
    return Promise.resolve(__risqueAutosaveFolderBootPromise).catch(function () {
      return null;
    });
  }

  /** Session disk turn checkpoints must await this or launcher disk probe can still be false (writes skipped). */
  window.risqueWaitForAutosaveFolderBoot = waitForAutosaveFolderBoot;

  function risqueTryScheduleStaleCheckpointCleanup() {
    if (window.risqueDisplayIsPublic) return;
    var hasTarget =
      (typeof window.risqueHostSaveFolderGet === "function" && window.risqueHostSaveFolderGet()) ||
      (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive());
    if (!hasTarget) return;
    if (typeof window.risqueSessionDiskCleanupStaleCheckpoints !== "function") return;
    if (__risqueStaleCkptCleanupTimer != null) return;
    function runCleanup() {
      var g = window.gameState;
      if (!g || window.risqueDisplayIsPublic) return;
      window.risqueSessionDiskCleanupStaleCheckpoints(g).then(function (n) {
        if (n > 0) {
          try {
            logEvent("Save folder: removed stale turn checkpoint files", { count: n });
          } catch (eLog) {
            /* ignore */
          }
        }
      });
    }
    __risqueStaleCkptCleanupTimer = window.setInterval(runCleanup, RISQUE_STALE_CKPT_CLEANUP_INTERVAL_MS);
    window.setTimeout(runCleanup, 90000);
  }

  function risqueTryScheduleReplayResumeTidy() {}

  window.risqueHostSaveFolderGet = function () {
    return __risqueRoundAutosaveDirHandle;
  };
  var __risqueRoundAutosavePickerBusy = false;
  /** Tab session: user skipped folder picker (use browser downloads for round exports). */
  var ROUND_AUTOSAVE_FOLDER_PROMPT_SESSION_KEY = "risqueAutosaveFolderPromptDismissedTab";
  /** Documented Windows layout; browsers cannot bind this path without one folder pick. */
  var RISQUE_DEFAULT_WINDOWS_SAVE_FOLDER = "C:\\risque\\save";

  function sidecarIndexRead() {
    var o = tryParse(localStorage.getItem(SIDECAR_INDEX_KEY) || "{}");
    return o && typeof o === "object" ? o : {};
  }

  function sidecarIndexWrite(idx) {
    try {
      localStorage.setItem(SIDECAR_INDEX_KEY, JSON.stringify(idx && typeof idx === "object" ? idx : {}));
    } catch (e) {
      /* ignore */
    }
  }

  function clearAllRisqueSidecars() {
    try {
      var idx = sidecarIndexRead();
      Object.keys(idx).forEach(function (type) {
        var arr = idx[type];
        if (!Array.isArray(arr)) return;
        var i;
        for (i = 0; i < arr.length; i++) {
          var r = arr[i];
          var id = r && r.id != null ? String(r.id) : "";
          if (!id) continue;
          localStorage.removeItem("risqueSidecar:" + String(type) + ":" + id);
        }
      });
      localStorage.removeItem(SIDECAR_INDEX_KEY);
    } catch (eSc) {
      /* ignore */
    }
  }

  function sidecarPut(type, payload, meta) {
    if (!type) return null;
    var id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "rsq-sc-" + String(Date.now()) + "-" + String(Math.floor(Math.random() * 1e9));
    var key = "risqueSidecar:" + String(type) + ":" + id;
    var row = {
      type: String(type),
      at: Date.now(),
      payload: payload != null ? String(payload) : "",
      meta: meta && typeof meta === "object" ? meta : {}
    };
    if (!risqueTryWriteLocalStorageWithQuotaFallback(key, JSON.stringify(row))) {
      return null;
    }
    var idx = sidecarIndexRead();
    if (!Array.isArray(idx[type])) idx[type] = [];
    idx[type].push({ id: id, at: row.at });
    sidecarIndexWrite(idx);
    return id;
  }

  function sidecarGet(type, id) {
    if (!type || !id) return null;
    var key = "risqueSidecar:" + String(type) + ":" + String(id);
    var row = tryParse(localStorage.getItem(key) || "null");
    if (!row || typeof row !== "object") return null;
    return row.payload != null ? String(row.payload) : "";
  }

  function sidecarPrune(type, keepN, keepIdsMap) {
    if (!type) return;
    var idx = sidecarIndexRead();
    var arr = Array.isArray(idx[type]) ? idx[type] : [];
    var keep = Number(keepN) || 0;
    if (arr.length <= keep) return;
    var retained = arr.slice(arr.length - keep);
    var retainedMap = {};
    retained.forEach(function (r) {
      if (r && r.id) retainedMap[String(r.id)] = true;
    });
    var stickyMap = keepIdsMap && typeof keepIdsMap === "object" ? keepIdsMap : {};
    arr.forEach(function (r) {
      var id = r && r.id ? String(r.id) : "";
      if (!id) return;
      if (retainedMap[id] || stickyMap[id]) return;
      try {
        localStorage.removeItem("risqueSidecar:" + String(type) + ":" + id);
      } catch (eRm) {
        /* ignore */
      }
    });
    idx[type] = retained;
    sidecarIndexWrite(idx);
  }
  var appEl = document.getElementById("app");
  var phaseLabelEl = document.getElementById("phaseLabel");
  var stageHost = document.querySelector(".runtime-stage-host");
  function risqueLocationSearchParams() {
    try {
      return new URL(window.location.href).searchParams;
    } catch (eSp) {
      return new URLSearchParams(window.location.search || "");
    }
  }
  var query = risqueLocationSearchParams();
  var displayParam = String(query.get("display") || "").toLowerCase();
  if (displayParam === "public") {
    window.risqueDisplayIsPublic = true;
    window.risqueDisplayMode = "public";
    try {
      document.documentElement.classList.remove("risque-view-host");
      document.documentElement.classList.add("risque-view-public");
      if (document.body) {
        document.body.classList.remove("risque-view-host");
        document.body.classList.add("risque-view-public");
      }
    } catch (eCls) {
      /* ignore */
    }
  }
  if (displayParam !== "public") {
    try {
      var pLegacy = query.get("phase");
      if (pLegacy === "deploy1" || pLegacy === "deploy2") {
        var uLegacy = new URL(window.location.href);
        uLegacy.searchParams.set("phase", "deploy");
        uLegacy.searchParams.set("kind", pLegacy === "deploy1" ? "setup" : "turn");
        var qsLegacy = uLegacy.searchParams.toString();
        history.replaceState(null, "", uLegacy.pathname + (qsLegacy ? "?" + qsLegacy : "") + uLegacy.hash);
        query = new URLSearchParams(uLegacy.search);
      }
    } catch (eLegDep) {}
  }
  /**
   * TV bootstrap: login-style placeholder until the host mirror arrives.
   * Without tvBootstrap=1 (or when it is omitted), code used to fall through to loadState() and show the
   * host's saved phase from localStorage — same as a second host tab (e.g. ?display=public only).
   * Omitted tvBootstrap now defaults to on; pass tvBootstrap=0 to skip.
   */
  var publicTvBootstrap =
    window.risqueDisplayIsPublic && String(query.get("tvBootstrap") || "1") !== "0";
  var forcedPhase = query.get("phase");
  var deployKindQuery = (query.get("kind") || "").trim().toLowerCase();
  /** Set after receive-card tablet handoff so cardplay mount does not show a second handoff. */
  var skipCardplayEntryHandoff = String(query.get("postReceive") || "") === "1";
  var POST_RECEIVE_CARDPLAY_BLACKOUT_KEY = "risquePostReceiveCardplayBlackout";
  var POST_RECEIVE_BLACKOUT_STYLE_ID = "risque-post-receive-blackout-style";
  var OUTGOING_NAV_BLACKOUT_ID = "risque-outgoing-nav-blackout";
  var VT_SUPPRESS_ONE_SHOT_ID = "risque-vt-suppress-one-shot";

  function injectPostReceiveBlackoutStylesOnce() {
    if (document.getElementById(POST_RECEIVE_BLACKOUT_STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = POST_RECEIVE_BLACKOUT_STYLE_ID;
    s.textContent =
      "#risque-post-receive-blackout{position:fixed;inset:0;z-index:9999999;margin:0;padding:0;" +
      "background:#000000;pointer-events:none;}";
    document.head.appendChild(s);
  }

  function showPostReceiveCardplayBlackout() {
    injectPostReceiveBlackoutStylesOnce();
    var el = document.getElementById("risque-post-receive-blackout");
    if (!el) {
      el = document.createElement("div");
      el.id = "risque-post-receive-blackout";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    return function hidePostReceiveCardplayBlackout() {
      var x = document.getElementById("risque-post-receive-blackout");
      if (x && x.parentNode) {
        x.parentNode.removeChild(x);
      }
    };
  }

  window.risqueMarkPostReceiveCardplayBlackout = function () {
    try {
      sessionStorage.setItem(POST_RECEIVE_CARDPLAY_BLACKOUT_KEY, "1");
    } catch (eMark) {
      /* ignore */
    }
    /*
     * Outgoing page: cross-document view transitions (game.css) snapshot the old document until
     * the new one paints — that snapshot was briefly showing receive-card. Force black + opt out
     * of VT for this navigation so the handoff never leaks private UI.
     */
    try {
      if (window.risqueDisplayIsPublic) return;
      if (!document.getElementById(VT_SUPPRESS_ONE_SHOT_ID)) {
        var vt = document.createElement("style");
        vt.id = VT_SUPPRESS_ONE_SHOT_ID;
        vt.textContent = "@view-transition { navigation: none !important; }";
        document.head.appendChild(vt);
      }
      if (!document.getElementById(OUTGOING_NAV_BLACKOUT_ID) && document.body) {
        var os = document.createElement("style");
        os.setAttribute("data-risque-outgoing-nav-blackout", "1");
        os.textContent =
          "#" +
          OUTGOING_NAV_BLACKOUT_ID +
          "{position:fixed;inset:0;z-index:2147483647;margin:0;padding:0;background:#000!important;pointer-events:none;}";
        document.head.appendChild(os);
        var od = document.createElement("div");
        od.id = OUTGOING_NAV_BLACKOUT_ID;
        od.setAttribute("aria-hidden", "true");
        document.body.appendChild(od);
        void od.offsetHeight;
      }
    } catch (eOut) {
      /* ignore */
    }
  };

  function maybeStartPostReceiveBlackoutFromSession() {
    if (window.risqueDisplayIsPublic) return;
    if (!skipCardplayEntryHandoff) return;
    try {
      if (sessionStorage.getItem(POST_RECEIVE_CARDPLAY_BLACKOUT_KEY) !== "1") return;
      sessionStorage.removeItem(POST_RECEIVE_CARDPLAY_BLACKOUT_KEY);
    } catch (eRead) {
      return;
    }
    if (document.getElementById("risque-post-receive-blackout")) {
      window.__risquePostReceiveBlackoutHide = function hidePostReceiveCardplayBlackoutEarly() {
        var x = document.getElementById("risque-post-receive-blackout");
        if (x && x.parentNode) {
          x.parentNode.removeChild(x);
        }
        var stEarly = document.getElementById("risque-post-receive-blackout-early-inline");
        if (stEarly && stEarly.parentNode) {
          stEarly.parentNode.removeChild(stEarly);
        }
      };
    } else {
      window.__risquePostReceiveBlackoutHide = showPostReceiveCardplayBlackout();
    }
  }

  /**
   * Tear down post-receive → cardplay navigation chrome (black overlays, VT suppression).
   * Safe to call multiple times. Exposed for recovery if cardplay mount fails mid-flight.
   */
  function clearPostReceiveNavigationArtifacts(reason) {
    try {
      if (typeof window.__risquePostReceiveBlackoutHide === "function") {
        var h = window.__risquePostReceiveBlackoutHide;
        window.__risquePostReceiveBlackoutHide = null;
        try {
          h();
        } catch (eH) {
          /* ignore */
        }
      }
    } catch (e0) {
      /* ignore */
    }
    try {
      var bl = document.getElementById("risque-post-receive-blackout");
      if (bl && bl.parentNode) bl.parentNode.removeChild(bl);
    } catch (e1) {
      /* ignore */
    }
    try {
      var og = document.getElementById(OUTGOING_NAV_BLACKOUT_ID);
      if (og && og.parentNode) og.parentNode.removeChild(og);
      var styles = document.querySelectorAll("style[data-risque-outgoing-nav-blackout]");
      for (var si = 0; si < styles.length; si += 1) {
        var st = styles[si];
        if (st && st.parentNode) st.parentNode.removeChild(st);
      }
    } catch (e2) {
      /* ignore */
    }
    try {
      var vt = document.getElementById(VT_SUPPRESS_ONE_SHOT_ID);
      if (vt && vt.parentNode) vt.parentNode.removeChild(vt);
    } catch (e3) {
      /* ignore */
    }
    try {
      var early = document.getElementById("risque-post-receive-blackout-early-inline");
      if (early && early.parentNode) early.parentNode.removeChild(early);
    } catch (e4) {
      /* ignore */
    }
    try {
      sessionStorage.removeItem(POST_RECEIVE_CARDPLAY_BLACKOUT_KEY);
    } catch (e5) {
      /* ignore */
    }
    try {
      if (reason && typeof console !== "undefined" && console.warn) {
        console.warn("[RISQUE] clearPostReceiveNavigationArtifacts:", reason);
      }
    } catch (eL) {
      /* ignore */
    }
  }
  window.risqueClearPostReceiveNavigationArtifacts = clearPostReceiveNavigationArtifacts;

  /**
   * Host map recovery: cardplay→income freeze, soft-nav, or slow paint can leave #canvas hidden or
   * a body-level clone covering markers. Idempotent — safe on every phase change / refreshVisuals.
   */
  function risqueRestoreHostMapCanvasFromPhaseArtifacts() {
    if (window.risqueDisplayIsPublic) return;
    try {
      var holds = document.querySelectorAll(
        "#risque-income-transition-hold, [data-risque-transition-freeze='1']"
      );
      for (var hi = 0; hi < holds.length; hi += 1) {
        var hEl = holds[hi];
        if (hEl && hEl.parentNode) hEl.parentNode.removeChild(hEl);
      }
    } catch (eHold) {
      /* ignore */
    }
    var canvas = document.getElementById("canvas");
    if (!canvas) return;
    try {
      canvas.style.visibility = "";
      canvas.style.opacity = "";
      canvas.style.transition = "";
      canvas.removeAttribute("aria-hidden");
      canvas.classList.add("visible");
      var stageImage = canvas.querySelector(".stage-image");
      var svgOverlay = canvas.querySelector(".svg-overlay");
      if (stageImage) stageImage.classList.add("visible");
      if (svgOverlay) svgOverlay.classList.add("visible");
    } catch (eCv) {
      /* ignore */
    }
    try {
      var uiOv = document.querySelector(".ui-overlay");
      if (uiOv) uiOv.classList.add("visible");
    } catch (eUi) {
      /* ignore */
    }
  }
  window.risqueRestoreHostMapCanvasFromPhaseArtifacts = risqueRestoreHostMapCanvasFromPhaseArtifacts;

  /** Host-only: restore canvas chrome then paint territories (double rAF for slow GPUs / dual-head). */
  function risqueRepaintHostMapSoon(gs) {
    if (window.risqueDisplayIsPublic || !gs || !window.gameUtils) return;
    risqueRestoreHostMapCanvasFromPhaseArtifacts();
    function paintOnce() {
      try {
        if (typeof window.gameUtils.validateGameState === "function" && !window.gameUtils.validateGameState(gs)) {
          return;
        }
        window.gameUtils.initGameView();
        if (typeof resizeRuntimeCanvas === "function") {
          resizeRuntimeCanvas();
        } else if (typeof window.gameUtils.resizeCanvas === "function") {
          window.gameUtils.resizeCanvas();
        }
        window.gameUtils.renderTerritories(null, gs);
        window.gameUtils.renderStats(gs);
      } catch (ePaint) {
        /* ignore */
      }
    }
    paintOnce();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        risqueRestoreHostMapCanvasFromPhaseArtifacts();
        paintOnce();
      });
    });
  }
  window.risqueRepaintHostMapSoon = risqueRepaintHostMapSoon;

  /*
   * Public board must follow mirrored gameState.phase only. A stale ?phase=attack (or any host URL
   * copied into this tab) would mount the wrong UI (e.g. attack while state is deploy).
   */
  if (window.risqueDisplayIsPublic) {
    forcedPhase = null;
    if (window.location.protocol !== "file:") {
      try {
        var pubStrip = new URL(window.location.href);
        var pubStripChanged = false;
        if (pubStrip.searchParams.has("phase")) {
          pubStrip.searchParams.delete("phase");
          pubStripChanged = true;
        }
        if (pubStrip.searchParams.has("tvBootstrap")) {
          pubStrip.searchParams.delete("tvBootstrap");
          pubStripChanged = true;
        }
        if (pubStripChanged) {
          var pubQs = pubStrip.searchParams.toString();
          window.history.replaceState(
            null,
            "",
            pubStrip.pathname + (pubQs ? "?" + pubQs : "") + pubStrip.hash
          );
        }
      } catch (ePubStrip) {
        /* ignore */
      }
    }
  }
  if (!window.risqueDisplayIsPublic) {
    try {
      var opRef = window.opener;
      if (
        opRef &&
        !opRef.closed &&
        opRef.__risquePublicBoardWindow &&
        !opRef.__risquePublicBoardWindow.closed
      ) {
        window.__risquePublicBoardWindow = opRef.__risquePublicBoardWindow;
      }
    } catch (ePubRef) {
      /* ignore */
    }
  }
  var legacyNext = query.get("legacyNext");
  var selectKind = query.get("selectKind");
  var loginLegacyNext =
    query.get("loginLegacyNext") || "game.html?phase=playerSelect&selectKind=firstCard";
  var DEFAULT_LOAD_AFTER_LOGIN = "game.html?phase=cardplay&legacyNext=income.html";
  var loginLoadRedirect = query.get("loginLoadRedirect") || DEFAULT_LOAD_AFTER_LOGIN;
  var loginMounted = false;
  /** Auto-remove the green Wayback folder badge after SHOW_WAYBACK_GREEN_BADGE_MS; cleared when leaving login or when not connected. */
  var __risqueWaybackGreenBadgeHideTimer = null;
  /** After green badge auto-hides, skip re-creating it on every refreshVisuals until login ends or folder reads disconnected. */
  var __risqueWaybackGreenLoginBadgeConsumed = false;
  var SHOW_WAYBACK_GREEN_BADGE_MS = 2000;
  var boardCornerToolsWired = false;
  /** So the public tab can reload into deploy1 vs deploy2 (URL may have no ?phase=). */
  var MIRROR_DEPLOY_ROUTE_KEY = "risqueMirrorDeployRoute";
  /** Public tab: last mirrored phase (storage handler + polling). */
  var publicMirrorLastPhase = null;
  /** TV login dissolve: track fade-to-black start so dissolve-out can wait for opacity transition (game.css 2s + slack). */
  var risquePublicLoginFadeInAtMs = 0;
  var risquePublicLoginFadeOutDeferT = null;
  var RISQUE_PUBLIC_LOGIN_FADEIN_MS = 2000;
  var RISQUE_PUBLIC_LOGIN_FADE_SLACK_MS = 400;
  var PUBLIC_INCOME_GATE_ACK_KEY = "risquePublicIncomeGateAck";
  /** Avoid replaying the same committed-cardplay recap after reload (sessionStorage). */
  var RISQUE_SESSION_RECAP_SEQ_KEY = "risquePublicCardplayRecapDoneSeq";
  var PUBLIC_AERIAL_COUNTER_DECISION_KEY = "risquePublicAerialCounterDecision";
  var PUBLIC_AERIAL_DECISION_READY_KEY = "risquePublicAerialDecisionReady";
  var PUBLIC_CARDPLAY_PROCESSING_STATE_KEY = "risquePublicCardplayProcessingState";
  /** Same entry URL as index.html when it sends you to the game login (fresh Live Server open). */
  var RISQUE_FRESH_START_URL =
    typeof window.risqueLoginRecoveryUrl === "function"
      ? window.risqueLoginRecoveryUrl()
      : "game.html?phase=login&loginLegacyNext=game.html%3Fphase%3DplayerSelect%26selectKind%3DfirstCard&loginLoadRedirect=game.html%3Fphase%3Dcardplay%26legacyNext%3Dincome.html";
  var BOARD_CORNER_TOOLS_VERSION = "25";
  /** Default + last-used autosave policy for new sessions (localStorage). */
  var RISQUE_AUTOSAVE_TIER_PREF_KEY = "risqueAutosaveTierPreference";
  var RISQUE_AUTOSAVE_TIERS = { safe_fun: 1, safe_lean: 1, safe_no_replay: 1, manual: 1, battle_stills: 1 };

  /** Monotonic per-session index for emergency saves and turn checkpoints (stored on gameState). */
  function risquePeekSimpleAutosaveSeq(gs) {
    if (!gs || typeof gs !== "object") return 0;
    var n = Math.floor(Number(gs.risqueSimpleAutosaveSeq));
    return n > 0 && isFinite(n) ? n : 0;
  }
  function risqueAllocSimpleAutosaveSeq(gs) {
    if (!gs || typeof gs !== "object") return 1;
    var next = risquePeekSimpleAutosaveSeq(gs) + 1;
    try {
      gs.risqueSimpleAutosaveSeq = next;
    } catch (eA) {
      /* ignore */
    }
    return next;
  }
  window.risqueAllocSimpleAutosaveSeq = risqueAllocSimpleAutosaveSeq;

  function risqueDoc(name) {
    if (typeof window.risqueResolveDocUrl === "function") {
      return window.risqueResolveDocUrl(name);
    }
    var fb = {
      index: "index.html",
      manual: "docs/manual.html",
      help: "docs/help.html",
      game: "game.html",
      replayMachine: "replay-machine.html"
    };
    return fb[name] || "";
  }

  /**
   * Per-round replay tapes for Wayback merge (…-replay.json, replayN.json, legacy risque-replay-1.json), excluding full snapshot, RQGS game snapshots, and checkpoints.
   * Order does not follow the numeric suffix — files are merged by filesystem modified time (oldest first).
   */
  function risqueIsWaybackMergeReplayTapeFilename(name) {
    var lower = String(name).toLowerCase().replace(/\\/g, "/");
    if (!lower.endsWith(".json")) return false;
    var leafOnly = lower.indexOf("/") >= 0 ? lower.replace(/^.*\//, "") : lower;
    if (/^dd\.json$/i.test(leafOnly)) return true;
    if (/^r\d+p\d+game\.json$/i.test(leafOnly)) return false;
    if (/^r\d+p\d+\.json$/i.test(leafOnly)) return true;
    if (/^replay-discard\//.test(lower)) return false;
    if (/^rqdiscard-/i.test(leafOnly)) return false;
    if (/^rqwb-full-replay\.json$/i.test(name)) return false;
    if (/^risque-full-replay\.json$/i.test(name)) return false;
    if (/^replay-full\.json$/i.test(name)) return false;
    if (/^rqck-/i.test(name)) return false;
    if (/^risque-ckpt-/i.test(name) || /^game-ckpt-/i.test(name) || /^replay-ckpt-/i.test(name)) return false;
    if (/^risque-emergency-/i.test(name) || /^game-emergency-/i.test(name) || /^replay-emergency-/i.test(name))
      return false;
    if (
      lower === "replay-final.json" ||
      lower === "risque-replay-final.json" ||
      lower === "game-final.json" ||
      lower === "risque-game-final.json"
    ) {
      return false;
    }
    if (/^game\d+\.json$/i.test(lower)) return false;
    if (/^rqgs-/i.test(name) && !/-replay\.json$/i.test(lower)) return false;
    if (/^replay\d+\.json$/i.test(lower)) return true;
    if (/^risque-replay-\d+\.json$/i.test(lower)) return true;
    if (/^rqrp/i.test(name)) return true;
    if (lower.indexOf("replay") !== -1) return true;
    return false;
  }

  /**
   * Read replay tapes from the save-folder root, REPLAY/RQSESS-* (and legacy root/RQSESS-*), excluding full snapshot.
   * When sessionKeyOpt is set, drops packs whose sessionKey disagrees (still accepts packs with no sessionKey).
   */
  function collectReplayPacksFromDirExcludeRqwb(dirHandle, sessionKeyOpt) {
    return (async function () {
      var packs = [];
      var packRows = [];
      if (!dirHandle || typeof dirHandle.entries !== "function") return packs;
      var skOriginal =
        sessionKeyOpt != null && String(sessionKeyOpt) !== "" ? String(sessionKeyOpt) : null;
      function tryPushRaw(raw, skWant, mtimeMs) {
        if (!raw || raw.format !== "risque-replay-v1" || !raw.tape || !Array.isArray(raw.tape.events)) return;
        var tv = raw.tape.v;
        if (tv !== 1 && tv !== 2) return;
        if (!raw.tape.events.length) return;
        if (skWant) {
          var pk = raw.sessionKey != null ? String(raw.sessionKey) : "";
          if (pk && pk !== skWant) return;
        }
        packRows.push({ raw: raw, t: mtimeMs != null && isFinite(mtimeMs) ? mtimeMs : 0 });
      }
      async function scanDirectory(dh, depth, skWant) {
        try {
          var iter = dh.entries();
          for await (var step of iter) {
            var name = step[0];
            var h = step[1];
            if (!h) continue;
            if (h.kind === "file") {
              if (!risqueIsWaybackMergeReplayTapeFilename(name)) continue;
              try {
                var f = await h.getFile();
                var text = await f.text();
                var raw = JSON.parse(text);
                tryPushRaw(raw, skWant, f.lastModified || 0);
              } catch (eFile) {
                /* skip corrupt or non-JSON */
              }
              continue;
            }
            if (h.kind === "directory" && depth < 1 && /^rqsess-/i.test(String(name))) {
              var sub = await dh.getDirectoryHandle(name);
              await scanDirectory(sub, depth + 1, skWant);
            }
          }
        } catch (eCollect) {
          /* ignore */
        }
      }
      async function collectWithSk(skWant) {
        packs = [];
        packRows = [];
        await scanDirectory(dirHandle, 0, skWant);
        try {
          var replayRootUpper = await dirHandle.getDirectoryHandle("REPLAY", { create: false });
          await scanDirectory(replayRootUpper, 0, skWant);
        } catch (eReplayScan) {
          try {
            var replayRootLower = await dirHandle.getDirectoryHandle("replay", { create: false });
            await scanDirectory(replayRootLower, 0, skWant);
          } catch (eReplayScanLower) {
            /* Legacy saves: replay JSON under save root or root/RQSESS-*. */
          }
        }
        packRows.sort(function (a, b) {
          return a.t - b.t;
        });
        packs = packRows.map(function (r) {
          return r.raw;
        });
      }
      await collectWithSk(skOriginal);
      /* After reload / new session key, every on-disk *-replay.json can disagree — strict filter yields []. */
      if (!packs.length && skOriginal) {
        await collectWithSk(null);
      }
      return packs;
    })().catch(function () {
      return [];
    });
  }

  /** Same rules as collectReplayPacksFromDirExcludeRqwb, via risque-disk-server (no folder picker). */
  function collectReplayPacksViaLocalApi(sessionKeyOpt) {
    if (
      typeof window.risqueLocalDiskListDir !== "function" ||
      typeof window.risqueLocalDiskRead !== "function"
    ) {
      return Promise.resolve([]);
    }
    var packs = [];
    var packRows = [];
    var skOriginal =
      sessionKeyOpt != null && String(sessionKeyOpt) !== "" ? String(sessionKeyOpt) : null;
    function tryPushRaw(raw, skWant, mtimeMs) {
      if (!raw || raw.format !== "risque-replay-v1" || !raw.tape || !Array.isArray(raw.tape.events))
        return;
      var tv = raw.tape.v;
      if (tv !== 1 && tv !== 2) return;
      if (!raw.tape.events.length) return;
      if (skWant) {
        var pk = raw.sessionKey != null ? String(raw.sessionKey) : "";
        if (pk && pk !== skWant) return;
      }
      packRows.push({ raw: raw, t: mtimeMs != null && isFinite(mtimeMs) ? mtimeMs : 0 });
    }
    function scanRelDir(relDir, depth, skWant) {
      return window.risqueLocalDiskListDir(relDir).then(function (j) {
        if (!j || !j.ok || !Array.isArray(j.entries)) return;
        var list = j.entries;
        return list.reduce(function (seq, ent) {
          return seq.then(function () {
            var name = ent && ent.name ? String(ent.name) : "";
            var kind = ent && ent.kind ? String(ent.kind) : "";
            if (!name) return;
            var childRel = relDir ? relDir + "/" + name : name;
            if (kind === "directory") {
              if (depth < 1 && /^rqsess-/i.test(name)) {
                return scanRelDir(childRel, depth + 1, skWant);
              }
              return;
            }
            if (kind !== "file") return;
            if (!risqueIsWaybackMergeReplayTapeFilename(name)) return;
            var mtime =
              ent && typeof ent.mtimeMs === "number" && isFinite(ent.mtimeMs) ? ent.mtimeMs : 0;
            return window.risqueLocalDiskRead(childRel).then(function (rj) {
              if (!rj || !rj.ok || rj.content == null) return;
              try {
                tryPushRaw(JSON.parse(String(rj.content)), skWant, mtime);
              } catch (eParse) {
                /* ignore */
              }
            });
          });
        }, Promise.resolve());
      });
    }
    function runCollect(skWant) {
      packs = [];
      packRows = [];
      return scanRelDir("", 0, skWant)
        .then(function () {
          return scanRelDir("REPLAY", 0, skWant);
        })
        .then(function () {
          return scanRelDir("replay", 0, skWant);
        });
    }
    return runCollect(skOriginal)
      .then(function () {
        if (!packRows.length && skOriginal) return runCollect(null);
      })
      .then(function () {
        packRows.sort(function (a, b) {
          return a.t - b.t;
        });
        packs = packRows.map(function (r) {
          return r.raw;
        });
        return packs;
      })
      .catch(function () {
        return [];
      });
  }

  var RISQUE_WAYBACK_BOOTSTRAP_LS_KEY = "risqueWaybackBootstrapPack";

  /** Memory-only replay JSON for Wayback bootstrap when merged disk build fails or quota bites. */
  function risqueSnapshotWaybackBootstrapJson(gs) {
    if (!gs || window.risqueDisplayIsPublic) return null;
    try {
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        window.risqueReplayEnsureLatestBoardFrame(gs);
      }
      var p =
        typeof window.risqueBuildSessionReplayExport === "function"
          ? window.risqueBuildSessionReplayExport(gs)
          : null;
      if (
        !p ||
        p.format !== "risque-replay-v1" ||
        !p.tape ||
        !Array.isArray(p.tape.events) ||
        !p.tape.events.length
      ) {
        return null;
      }
      return JSON.stringify(p);
    } catch (eSnap) {
      return null;
    }
  }

  function risquePackEventCountForWayback(p) {
    return p && p.tape && Array.isArray(p.tape.events) ? p.tape.events.length : 0;
  }

  function risquePackHasDealFramesForWayback(p) {
    var evs = p && p.tape && p.tape.events;
    if (!Array.isArray(evs)) return false;
    var j;
    for (j = 0; j < evs.length; j++) {
      var e = evs[j];
      if (e && e.type === "board" && e.segment === "deal") return true;
    }
    return false;
  }

  /**
   * Per-round merge can be empty or one-round after sessionKey drift; on-disk full snapshot may still hold the full tape.
   */
  function risquePickRicherDiskMergedForWayback(diskMerged, fullReplayPack) {
    if (
      !fullReplayPack ||
      fullReplayPack.format !== "risque-replay-v1" ||
      !fullReplayPack.tape ||
      !Array.isArray(fullReplayPack.tape.events) ||
      !fullReplayPack.tape.events.length
    ) {
      return diskMerged;
    }
    var dmc = risquePackEventCountForWayback(diskMerged);
    var fc = fullReplayPack.tape.events.length;
    var fullDeal = risquePackHasDealFramesForWayback(fullReplayPack);
    var dmDeal = risquePackHasDealFramesForWayback(diskMerged);
    if (!dmc) return fullReplayPack;
    if (fullDeal && !dmDeal) return fullReplayPack;
    if (fc > dmc + 50) return fullReplayPack;
    return diskMerged;
  }

  function risqueTryReadFullReplayPackFromAutosaveDir(dirHandle) {
    if (!dirHandle || typeof dirHandle.getFileHandle !== "function") {
      return Promise.resolve(null);
    }
    function tryName(fname) {
      return dirHandle
        .getFileHandle(fname, { create: false })
        .then(function (fh) {
          return fh.getFile();
        })
        .then(function (f) {
          return f.text();
        })
        .then(function (text) {
          return JSON.parse(String(text || ""));
        })
        .catch(function () {
          return null;
        });
    }
    return tryName("replay-full.json")
      .then(function (raw) {
        if (raw && raw.format === "risque-replay-v1" && raw.tape) return raw;
        return tryName("risque-full-replay.json");
      })
      .then(function (raw) {
        if (raw && raw.format === "risque-replay-v1" && raw.tape) return raw;
        return tryName("rqwb-full-replay.json");
      });
  }

  function risqueTryReadFullReplayPackVirtualOrLocal() {
    if (typeof window.risqueLocalDiskRead !== "function") return Promise.resolve(null);
    var paths = [
      "replay-full.json",
      "REPLAY/replay-full.json",
      "replay/replay-full.json",
      "risque-full-replay.json",
      "REPLAY/risque-full-replay.json",
      "replay/risque-full-replay.json",
      "rqwb-full-replay.json"
    ];
    function tryPath(i) {
      if (i >= paths.length) return Promise.resolve(null);
      return window.risqueLocalDiskRead(paths[i]).then(function (rj) {
        if (rj && rj.ok && rj.content != null) {
          try {
            var raw = JSON.parse(String(rj.content));
            if (raw && raw.format === "risque-replay-v1" && raw.tape) return raw;
          } catch (eParse) {
            /* ignore */
          }
        }
        return tryPath(i + 1);
      });
    }
    return tryPath(0).catch(function () {
      return null;
    });
  }

  /**
   * Raw JSON text of replay-full.json (legacy: risque-full-replay.json) from disk.
   * Used to refresh Wayback localStorage bootstrap after write — memory snapshot after reload can be tiny.
   */
  function risqueWaybackReadFullReplayRawJsonFromDisk(gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(null);
    if (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()) {
      if (typeof window.risqueLocalDiskRead !== "function") return Promise.resolve(null);
      var paths = [
        "replay-full.json",
        "REPLAY/replay-full.json",
        "replay/replay-full.json",
        "risque-full-replay.json",
        "REPLAY/risque-full-replay.json",
        "replay/risque-full-replay.json"
      ];
      function tryPath(i) {
        if (i >= paths.length) return Promise.resolve(null);
        return window.risqueLocalDiskRead(paths[i]).then(function (rj) {
          if (rj && rj.ok && rj.content != null && String(rj.content).length > 80) {
            return String(rj.content);
          }
          return tryPath(i + 1);
        });
      }
      return tryPath(0).catch(function () {
        return null;
      });
    }
    if (typeof window.risqueSessionDiskEnsureReplayDirHandle !== "function") {
      return Promise.resolve(null);
    }
    return window.risqueSessionDiskEnsureReplayDirHandle(gs).then(function (dir) {
      if (!dir || typeof dir.getFileHandle !== "function") return null;
      function tryFh(name) {
        return dir
          .getFileHandle(name, { create: false })
          .then(function (fh) {
            return fh.getFile();
          })
          .then(function (f) {
            return f.text();
          });
      }
      return tryFh("replay-full.json")
        .catch(function () {
          return tryFh("risque-full-replay.json");
        })
        .catch(function () {
          return null;
        });
    });
  }

  function risqueReplayPackLooksRichForBootstrap(obj) {
    if (!obj || !obj.tape || !Array.isArray(obj.tape.events) || !obj.tape.events.length) return false;
    var evs = obj.tape.events;
    var i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (e && e.type === "board" && e.segment === "deal") return true;
    }
    return evs.length > 120;
  }

  /**
   * True when tape has a usable opening for Wayback bootstrap / anti-stomp checks.
   * Per-territory deal often has no separate init frame (see docs/replay.txt) — init+deal OR deal+deploy OR many deal steps.
   */
  function risqueReplayPackHasOpeningForBootstrap(pack) {
    if (!pack || !pack.tape || !Array.isArray(pack.tape.events)) return false;
    var evs = pack.tape.events;
    var hi = false;
    var dealN = 0;
    var depN = 0;
    var i;
    for (i = 0; i < evs.length; i++) {
      var e = evs[i];
      if (!e) continue;
      if (e.type === "init") hi = true;
      if (e.type === "board" && e.segment === "deal") dealN++;
      if (e.type === "board" && e.segment === "deploy") depN++;
    }
    if (hi && dealN) return true;
    if (dealN >= 8) return true;
    if (dealN >= 1 && depN >= 1) return true;
    return false;
  }

  /**
   * Wayback REPLAY bootstrap: prefer full in-memory session tape (same browser) so a bad merged replay-full.json
   * on disk cannot replace a good live pack (symptom: only R2 chip, snapshot, no deal).
   */
  function risqueTryBuildWaybackBootstrapSessionJson(gs) {
    if (!gs || window.risqueDisplayIsPublic) return null;
    var live = gs;
    try {
      if (
        typeof window.gameState === "object" &&
        window.gameState &&
        Array.isArray(window.gameState.players) &&
        window.gameState.players.length
      ) {
        var skG = gs.risqueReplayTapeSessionKey != null ? String(gs.risqueReplayTapeSessionKey) : "";
        var skL =
          window.gameState.risqueReplayTapeSessionKey != null
            ? String(window.gameState.risqueReplayTapeSessionKey)
            : "";
        if (!skG || !skL || skG === skL) {
          live = window.gameState;
        }
      }
    } catch (eLive) {}
    try {
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        window.risqueReplayEnsureLatestBoardFrame(live);
      }
    } catch (eEns) {}
    try {
      if (typeof window.risqueCheapReplayDetachFromGameState === "function") {
        window.risqueCheapReplayDetachFromGameState(live);
      }
    } catch (eCrBoot) {
      /* ignore */
    }
    try {
      var tierBoot =
        live.risqueAutosaveTier != null ? String(live.risqueAutosaveTier).trim() : "";
      if (
        (tierBoot === "battle_stills" || tierBoot === "host_ultra") &&
        typeof window.risqueBuildBudgetReplayPackFromCheapStills === "function"
      ) {
        var budgetBoot = window.risqueBuildBudgetReplayPackFromCheapStills(live);
        if (
          budgetBoot &&
          budgetBoot.format === "risque-replay-v1" &&
          budgetBoot.tape &&
          Array.isArray(budgetBoot.tape.events) &&
          budgetBoot.tape.events.length >= 2
        ) {
          return JSON.stringify(budgetBoot);
        }
      }
    } catch (eBudgetBoot) {
      /* fall through */
    }
    try {
      if (typeof window.risqueBuildSessionReplayExport !== "function") return null;
      var sp = window.risqueBuildSessionReplayExport(live);
      if (!sp || sp.format !== "risque-replay-v1" || !sp.tape || !Array.isArray(sp.tape.events) || !sp.tape.events.length) {
        return null;
      }
      /* Always bootstrap from live memory when the tape has events — postgame autoreplay must work with zero
       * on-disk replay files (safe_no_replay / manual). Opening quality is validated at playback, not here. */
      return JSON.stringify(sp);
    } catch (eSess) {
      return null;
    }
  }

  /** Prefer on-disk full replay for LS bootstrap when it clearly beats the in-memory JSON string. */
  function risqueWaybackPickRicherBootstrapJson(gs, memoryJson) {
    return risqueWaybackReadFullReplayRawJsonFromDisk(gs).then(function (diskText) {
      if (!diskText) return memoryJson;
      try {
        var diskPack = JSON.parse(diskText);
        if (!diskPack || diskPack.format !== "risque-replay-v1" || !diskPack.tape) return memoryJson;
        var memPack = null;
        if (memoryJson) {
          try {
            memPack = JSON.parse(memoryJson);
          } catch (eMem) {
            memPack = null;
          }
        }
        /* Live session already has a proper opening — never let a longer/stale replay-full.json stomp it. */
        if (risqueReplayPackHasOpeningForBootstrap(memPack)) {
          return memoryJson;
        }
        var dn = diskPack.tape.events ? diskPack.tape.events.length : 0;
        var mn = memPack && memPack.tape && memPack.tape.events ? memPack.tape.events.length : 0;
        var diskRich = risqueReplayPackLooksRichForBootstrap(diskPack);
        var memRich = risqueReplayPackLooksRichForBootstrap(memPack);
        if (!memoryJson) return diskText;
        if (diskRich && !memRich) return diskText;
        /* Longer on-disk replay-full.json is often a stale merge; it must not override live memory that
         * already includes deal + tape (e.g. last battle missing in Wayback after R2P1). */
        if (memRich) return memoryJson;
        if (dn > mn + 40) return diskText;
        if (dn > mn + 10 && diskRich) return diskText;
      } catch (eC) {
        /* ignore */
      }
      return memoryJson;
    });
  }

  /**
   * Compact JSON for Wayback (disk + optional folder merge + RAM tail). Same payload written to RQWB-full-replay.json.
   */
  function risqueBuildWaybackPackJsonString(gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve(null);
    var srcGs = gs;
    try {
      var liveG =
        typeof window.gameState === "object" && window.gameState && Array.isArray(window.gameState.players)
          ? window.gameState
          : null;
      if (
        liveG &&
        liveG.players.length &&
        (!gs.risqueReplayTapeSessionKey ||
          !liveG.risqueReplayTapeSessionKey ||
          String(gs.risqueReplayTapeSessionKey) === String(liveG.risqueReplayTapeSessionKey))
      ) {
        srcGs = liveG;
      }
    } catch (eSrc) {}
    var dir = __risqueRoundAutosaveDirHandle;
    var sk =
      srcGs.risqueReplayTapeSessionKey != null ? String(srcGs.risqueReplayTapeSessionKey) : null;
    var chain = Promise.resolve([]);
    if (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()) {
      chain = collectReplayPacksViaLocalApi(sk).catch(function () {
        return [];
      });
    } else if (dir && typeof dir.getFileHandle === "function") {
      chain = collectReplayPacksFromDirExcludeRqwb(dir, sk).catch(function () {
        return [];
      });
    }
    return chain
      .then(function (packs) {
        var diskMerged = null;
        if (packs && packs.length && typeof window.risqueMergeReplayV1Packs === "function") {
          try {
            diskMerged = window.risqueMergeReplayV1Packs(packs);
          } catch (eM) {
            diskMerged = null;
          }
        }
        var fullP =
          typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()
            ? risqueTryReadFullReplayPackVirtualOrLocal()
            : risqueTryReadFullReplayPackFromAutosaveDir(dir);
        return fullP.then(function (fullSnap) {
          diskMerged = risquePickRicherDiskMergedForWayback(diskMerged, fullSnap);
          var pack = null;
          try {
            pack =
              typeof window.risqueBuildWaybackTapePack === "function"
                ? window.risqueBuildWaybackTapePack(srcGs, diskMerged)
                : typeof window.risqueBuildSessionReplayExport === "function"
                  ? window.risqueBuildSessionReplayExport(srcGs)
                  : null;
          } catch (ePack) {
            pack = null;
          }
          if (!pack || pack.format !== "risque-replay-v1") return null;
          try {
            return JSON.stringify(pack);
          } catch (eJ) {
            return null;
          }
        });
      })
      .catch(function () {
        return null;
      });
  }

  /**
   * Legacy hook: used to write replay-full.json. Disabled — Wayback replay on disk is DD.json + rNpM.json only.
   * @returns {Promise<boolean>} always false (no write)
   */
  window.risqueWriteWaybackFullReplayToDisk = function (gs) {
    void gs;
    return Promise.resolve(false);
  };

  /**
   * Mount Wayback inline in the host control panel (no separate replay window). After prep, tape bootstrap
   * is in localStorage; playback mirrors to `risquePublicMirrorState` for **game.html?display=public**.
   * @param {{ replayAutoplay?: boolean }} [opts] Start playback once after the pack loads (postgame flow).
   */
  function risqueOpenReplayMachineFromHost(opts) {
    opts = opts || {};
    var prep = Promise.resolve();
    if (!window.risqueDisplayIsPublic) {
      var gsReplay = getActiveGameStateSnapshot();
      if (gsReplay && Array.isArray(gsReplay.players) && gsReplay.players.length) {
        prep = prep
          .then(function () {
            return bootRestoreAutosaveFolder(gsReplay);
          })
          .then(function () {
            try {
              if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
                window.risqueReplayEnsureLatestBoardFrame(gsReplay);
              }
            } catch (eStamp) {
              /* ignore */
            }
            return new Promise(function (resolve) {
              window.setTimeout(function () {
                try {
                  if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
                    window.risqueReplayEnsureLatestBoardFrame(gsReplay);
                  }
                } catch (eStamp2) {
                  /* ignore */
                }
                resolve();
              }, 0);
            });
          })
          .then(function () {
            if (typeof window.risquePersistHostGameState === "function") {
              window.risquePersistHostGameState();
            }
            if (typeof window.risqueCheapReplayDetachFromGameState === "function") {
              try {
                window.risqueCheapReplayDetachFromGameState(gsReplay);
              } catch (eCrWb) {
                /* ignore */
              }
            }
            var sessionBoot = risqueTryBuildWaybackBootstrapSessionJson(gsReplay);
            return (sessionBoot
              ? Promise.resolve(sessionBoot)
              : risqueBuildWaybackPackJsonString(gsReplay)
            ).then(function (json) {
              var toStore = json || risqueSnapshotWaybackBootstrapJson(gsReplay);
              if (
                !toStore &&
                typeof window.risqueBuildSessionReplayExport === "function"
              ) {
                try {
                  var pRetry = window.risqueBuildSessionReplayExport(gsReplay);
                  if (pRetry && pRetry.tape && pRetry.tape.events && pRetry.tape.events.length) {
                    toStore = JSON.stringify(pRetry);
                  }
                } catch (eRetry) {
                  /* ignore */
                }
              }
              if (toStore) {
                try {
                  window.__risqueWaybackBootstrapPackMemory = toStore;
                } catch (eMemBoot) {
                  /* ignore */
                }
                try {
                  localStorage.setItem(RISQUE_WAYBACK_BOOTSTRAP_LS_KEY, toStore);
                } catch (eLs) {
                  logEvent("Wayback: bootstrap localStorage failed (quota?)", {
                    message: eLs && eLs.message ? eLs.message : String(eLs)
                  });
                  try {
                    setBoardCornerMsg(
                      "Replay: pack too large for browser storage (quota). Clear site data for this origin or connect a SAVE folder (DD.json + rNpM.json) — Wayback may open empty."
                    );
                  } catch (eCornerLs) {
                    /* ignore */
                  }
                }
              } else {
                try {
                  setBoardCornerMsg(
                    "Replay: no tape yet — finish the initial deal and deployment, then try REPLAY again."
                  );
                } catch (eCorner) {
                  /* ignore */
                }
              }
              var diskFollow = Promise.resolve();
              if (typeof window.risqueWriteWaybackFullReplayToDisk === "function") {
                diskFollow = window.risqueWriteWaybackFullReplayToDisk(gsReplay).catch(function () {
                  return false;
                });
              }
              return diskFollow.then(function () {
                return risqueWaybackPickRicherBootstrapJson(gsReplay, toStore).then(function (chosen) {
                  if (chosen && chosen !== toStore) {
                    try {
                      window.__risqueWaybackBootstrapPackMemory = chosen;
                    } catch (eMemRich) {
                      /* ignore */
                    }
                    try {
                      localStorage.setItem(RISQUE_WAYBACK_BOOTSTRAP_LS_KEY, chosen);
                    } catch (eRich) {
                      /* ignore */
                    }
                  }
                });
              });
            });
          })
          .catch(function () {
            try {
              var mem = risqueSnapshotWaybackBootstrapJson(gsReplay);
              if (mem) {
                window.__risqueWaybackBootstrapPackMemory = mem;
                localStorage.setItem(RISQUE_WAYBACK_BOOTSTRAP_LS_KEY, mem);
              }
            } catch (eFall) {
              /* ignore */
            }
          });
      }
    }
    prep.then(function () {
      try {
        if (typeof window.risqueReplayMachineMountInline === "function") {
          window.risqueReplayMachineMountInline({ replayAutoplay: !!opts.replayAutoplay });
        } else {
          setBoardCornerMsg("Replay UI not loaded — ensure js/replay-machine.js is included on game.html.");
        }
      } catch (eMt) {
        try {
          setBoardCornerMsg(
            "Wayback: " + (eMt && eMt.message ? eMt.message : String(eMt))
          );
        } catch (eC) {
          /* ignore */
        }
      }
    });
  }

  window.risqueOpenReplayMachineFromHost = risqueOpenReplayMachineFromHost;

  function clearStoredSessionForNewGame() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PUBLIC_MIRROR_KEY);
      localStorage.removeItem(PUBLIC_CURSOR_MIRROR_KEY);
      localStorage.removeItem(MIRROR_DEPLOY_ROUTE_KEY);
      localStorage.removeItem(PUBLIC_INCOME_GATE_ACK_KEY);
      localStorage.removeItem(PUBLIC_CONQUEST_CONTINUE_REQ_KEY);
      localStorage.removeItem(LEDGER_KEY);
      localStorage.removeItem(LOG_KEY);
      localStorage.removeItem(GRACE_SNAPSHOTS_STORAGE_KEY);
      localStorage.removeItem(ROUND_AUTOSAVE_KEY);
      localStorage.removeItem("risqueReplayTapeSidecar");
      localStorage.removeItem(RISQUE_WAYBACK_BOOTSTRAP_LS_KEY);
      localStorage.removeItem(AUTOSAVE_FP_ROUND_KEY);
      localStorage.removeItem(AUTOSAVE_FP_WIN_KEY);
      localStorage.removeItem("risquePublicCardplayRecapAck");
      localStorage.removeItem("risquePublicAerialCounterDecision");
      localStorage.removeItem("risquePublicAerialDecisionReady");
      localStorage.removeItem("risquePublicCardplayProcessingState");
      clearAllRisqueSidecars();
    } catch (eClr) {
      /* ignore */
    }
    if (typeof window.risqueSessionDiskInvalidateCache === "function") {
      try {
        window.risqueSessionDiskInvalidateCache();
      } catch (eInv) {
        /* ignore */
      }
    }
    try {
      sessionStorage.removeItem(RISQUE_SESSION_RECAP_SEQ_KEY);
      sessionStorage.removeItem(POST_RECEIVE_CARDPLAY_BLACKOUT_KEY);
      sessionStorage.removeItem(ROUND_AUTOSAVE_SESSION_COUNT_KEY);
      sessionStorage.removeItem("risqueConquestAttackStartBaseline");
    } catch (eSs) {
      /* ignore */
    }
  }

  window.risqueClearStoredSessionForNewGame = clearStoredSessionForNewGame;

  window.risqueSetMirrorDeployRoute = function (route) {
    try {
      if (route) localStorage.setItem(MIRROR_DEPLOY_ROUTE_KEY, String(route));
      else localStorage.removeItem(MIRROR_DEPLOY_ROUTE_KEY);
    } catch (eM) {
      /* ignore */
    }
  };

  function resolveDeployKindForHost() {
    if (deployKindQuery === "setup" || deployKindQuery === "turn") {
      return deployKindQuery;
    }
    if (forcedPhase !== "deploy") {
      return "turn";
    }
    try {
      var dr0 = localStorage.getItem(MIRROR_DEPLOY_ROUTE_KEY);
      if (dr0 === "deploy1" || dr0 === "setup") {
        return "setup";
      }
      if (dr0 === "deploy2" || dr0 === "turn") {
        return "turn";
      }
    } catch (eDr) {}
    return "turn";
  }

  var lastAutoReport = "";
  var HAND_CARD_POSITIONS = [
    { x: 1409, y: 263, width: 150, height: 200 },
    { x: 1566, y: 263, width: 150, height: 200 },
    { x: 1725, y: 263, width: 150, height: 200 },
    { x: 1409, y: 468, width: 150, height: 200 },
    { x: 1566, y: 468, width: 150, height: 200 },
    { x: 1725, y: 468, width: 150, height: 200 },
    { x: 1409, y: 673, width: 150, height: 200 },
    { x: 1566, y: 673, width: 150, height: 200 },
    { x: 1725, y: 673, width: 150, height: 200 }
  ];
  var CARD_NAMES = [
    "afghanistan", "alaska", "alberta", "argentina", "brazil", "central_america", "china",
    "congo", "east_africa", "eastern_australia", "eastern_united_states", "egypt", "great_britain",
    "greenland", "iceland", "india", "indonesia", "irkutsk", "japan", "kamchatka", "madagascar",
    "middle_east", "mongolia", "new_guinea", "north_africa", "northern_europe", "northwest_territory",
    "ontario", "peru", "quebec", "scandinavia", "siam", "siberia", "south_africa", "southern_europe",
    "ukraine", "ural", "venezuela", "western_australia", "western_europe", "western_united_states",
    "yakutsk", "wildcard1", "wildcard2"
  ];

  /** Initial “committed card play” headline (+ card strip) on public TV — dwell before step processing. */
  var BOOK_PUBLIC_SUMMARY_MS = 4000;
  /** Same dwell before step-through when animating host-confirmed recap (runtime cardplay). */
  var BOOK_PUBLIC_RECAP_SUMMARY_MS = 3000;
  /** After showing card + text, pause before territory highlight and troop count animation (public recap). */
  var BOOK_PUBLIC_RECAP_READ_MS = 1200;
  /** Troop count tick animation length on map */
  var BOOK_PUBLIC_COUNT_MS = 700;
  /** Public TV: marker grows in first, then halo + troop tween together */
  var BOOK_PUBLIC_MAP_SWELL_MS = 210;
  /** Time each map step stays readable after counts settle (territory highlight) */
  var BOOK_PUBLIC_HOLD_MS = 2250;
  /**
   * Voice-only steps (e.g. continental book) — not host-confirmed runtime recap.
   */
  var BOOK_PUBLIC_VOICE_ONLY_HOLD_MS = 3500;
  /** Host-confirmed cardplay recap: wildcard / voice-only steps (~2s each). */
  var BOOK_PUBLIC_RECAP_VOICE_ONLY_HOLD_MS = 2000;
  /** Dedicated dwell per wildcard aerial step (recap path). */
  var BOOK_PUBLIC_RECAP_AERIAL_HOLD_MS = 2000;
  /**
   * Blank beat between back-to-back aerial recap steps so the TV does not read as one long wildcard.
   */
  var BOOK_PUBLIC_RECAP_AERIAL_GAP_MS = 220;
  /** Brief pause before each recap step paints (shorter for voice-only = snappier wildcard flash). */
  var BOOK_PUBLIC_RECAP_VOICE_READ_MS = 280;

  /** JSON / storage can coerce booleans; treat any truthy recap flag as recap mode for TV timing + copy. */
  function risquePublicProcRecapAnimation(proc) {
    return !!(
      proc &&
      (proc.recapAnimation === true || proc.recapAnimation === "true" || proc.recapAnimation === 1)
    );
  }

  function risquePublicBookStepHoldMs(step) {
    if (!step) return BOOK_PUBLIC_HOLD_MS;
    var proc0 = _pubBook.proc;
    if (step.effect === "aerial_attack" && risquePublicProcRecapAnimation(proc0)) {
      return BOOK_PUBLIC_RECAP_AERIAL_HOLD_MS;
    }
    if (!step.mapTerritory && !step.animateTroops) {
      if (risquePublicProcRecapAnimation(proc0)) {
        return BOOK_PUBLIC_RECAP_VOICE_ONLY_HOLD_MS;
      }
      return BOOK_PUBLIC_VOICE_ONLY_HOLD_MS;
    }
    return BOOK_PUBLIC_HOLD_MS;
  }
  var _pubBook = {
    seq: null,
    phase: "idle",
    stepIndex: 0,
    proc: null,
    summaryTimer: null,
    stepTimer: null,
    rafId: 0,
    focusLabel: null,
    countAnimating: false,
    skipTerritoryRedraw: false,
    /** Shallow troop/owner map while TV recap runs — starts at pre-cardplay baseline, advances each step. */
    displayTroopMap: null,
    /** Raw PUBLIC_MIRROR_KEY JSON when host went to income mid-sequence; applied after animation ends. */
    deferredIncomeMirrorPayload: null,
    /** Fingerprint of the in-flight committed recap — mirror JSON may resend with a new proc.seq (e.g. Date.now) without being a new play. */
    committalSig: null,
    /** When hand-preview dwell ends (for recovery if timer dropped). */
    summaryDeadlineMs: null,
    /** Lower shelf staged cluster: "book:2" / "singles" — avoids redundant rebuilds. */
    shelfStagingKey: null,
    /** Host shelf aerial confirm/counter UI: interval id for enable/disable sync. */
    hostShelfAerialUiPoll: null
  };

  /**
   * Stable id for “same committed hand / same step list” — intentionally ignores proc.seq so mirror
   * polling does not reset the hand-preview timer when only seq churns.
   */
  function risquePublicBookCommittalSig(proc, gs) {
    if (!proc || !Array.isArray(proc.steps)) return "";
    var cardPart = "";
    if (gs && Array.isArray(gs.risquePublicCardplayBookCards)) {
      cardPart = gs.risquePublicCardplayBookCards
        .map(String)
        .slice()
        .sort()
        .join(",");
    }
    var parts = [];
    var i;
    for (i = 0; i < proc.steps.length; i++) {
      var st = proc.steps[i];
      if (!st) continue;
      parts.push(
        String(st.effect || "") +
          ":" +
          String(st.mapTerritory || "") +
          ":" +
          String(st.rawTerritoryToken || "") +
          ":" +
          String(st.playedCardKey || "") +
          ":" +
          String(st.troopsFrom != null ? st.troopsFrom : "") +
          ":" +
          String(st.troopsTo != null ? st.troopsTo : "")
      );
    }
    var recapFlag = risquePublicProcRecapAnimation(proc) ? "1" : "0";
    return recapFlag + "|" + cardPart + "|" + String(proc.playerName || "") + "|" + parts.join(";");
  }

  /** Normal turn income and conquer-mode (con-income) chain income — same breakdown in control voice (host + public). */
  function risquePhaseIsIncomeVoiceMirror(phase) {
    var p = String(phase || "");
    return p === "income" || p === "con-income";
  }

  /** True while public TV is running the committed-cardplay recap (summary, steps, troop count). */
  function risquePublicBookAnimBlockingPhaseChange() {
    if (_pubBook.phase === "done" || _pubBook.phase === "idle") return false;
    if (_pubBook.summaryTimer != null || _pubBook.stepTimer != null) return true;
    if (_pubBook.countAnimating) return true;
    if (_pubBook.phase === "summary" || _pubBook.phase === "step") return true;
    return false;
  }

  function risquePublicFlushDeferredIncomeTransition() {
    if (!_pubBook.deferredIncomeMirrorPayload) return;
    var payload = _pubBook.deferredIncomeMirrorPayload;
    _pubBook.deferredIncomeMirrorPayload = null;
    try {
      var gsFix = tryParse(payload);
      if (gsFix && typeof risquePublicMirrorGameState === "function") {
        risquePublicMirrorGameState(gsFix);
      }
    } catch (eRel) {
      /* ignore */
    }
  }

  /**
   * Public TV: defer income only while the recap is actively in summary or step. Do not use broad
   * "blocking" checks — they can strand mirrors or hide card art; idle/done always accepts income.
   */
  function risquePublicMirrorShouldHoldIncomeApply(gs) {
    if (!gs) return false;
    var ph = String(gs.phase || "");
    if (ph !== "income" && ph !== "con-income") return false;
    return _pubBook.phase === "summary" || _pubBook.phase === "step";
  }

  /** Host waits for this ack (see phases/income.js) before confirming to deployment. */
  var PUBLIC_INCOME_GATE_HOLD_MS = 5000;
  var _pubIncomeGateTimer = null;
  var _pubIncomeGateReleasedForToken = null;

  function risquePublicTryScheduleIncomeGateRelease(gs) {
    if (!window.risqueDisplayIsPublic || !gs) return;
    if (!risquePhaseIsIncomeVoiceMirror(gs.phase)) return;
    var tok = gs.risquePublicIncomeGateToken;
    if (!tok) return;
    if (_pubIncomeGateReleasedForToken === tok) return;
    var proc = gs.risquePublicBookProcessing;
    var hasSteps = proc && Array.isArray(proc.steps) && proc.steps.length > 0;
    if (hasSteps && _pubBook.phase !== "done") return;
    _pubIncomeGateReleasedForToken = tok;
    if (_pubIncomeGateTimer) clearTimeout(_pubIncomeGateTimer);
    _pubIncomeGateTimer = setTimeout(function () {
      _pubIncomeGateTimer = null;
      try {
        localStorage.setItem(
          PUBLIC_INCOME_GATE_ACK_KEY,
          JSON.stringify({ token: tok, at: Date.now() })
        );
      } catch (eIg) {
        /* ignore */
      }
    }, PUBLIC_INCOME_GATE_HOLD_MS);
  }

  window.risquePublicBookSequencePhase = function () {
    return _pubBook.phase;
  };

  /** Income mirror can arrive while the committed cardplay book animation still runs — suppress income grid until done. */
  function risqueIncomePhaseBookRecapActive(gs) {
    if (!gs) return false;
    if (!risquePhaseIsIncomeVoiceMirror(gs.phase)) return false;
    var pubBookPhase = _pubBook.phase;
    if (pubBookPhase === "done" || pubBookPhase === "idle") return false;
    var proc = gs.risquePublicBookProcessing;
    return !!(proc && Array.isArray(proc.steps) && proc.steps.length > 0);
  }

  /**
   * Same-origin phase navigation. Cross-dissolve comes from the View Transitions API (see game.css);
   * we avoid fading the shell to black (that fights a true dissolve).
   */
  window.risqueNavigateWithFade = function (url) {
    if (!url) return;
    if (!window.risqueDisplayIsPublic && typeof window.risqueFlushMirrorPush === "function") {
      try {
        window.risqueFlushMirrorPush();
      } catch (eNavMir) {
        /* ignore */
      }
    }
    try {
      if (
        !window.risqueDisplayIsPublic &&
        typeof window.risqueNavigateGameHtmlSoft === "function" &&
        window.risqueNavigateGameHtmlSoft(url)
      ) {
        return;
      }
    } catch (eSoftFade) {
      /* ignore */
    }
    window.location.href = url;
  };

  /** Public TV during post-capture transfer: show frozen troop counts until host confirms (host state unchanged). */
  function risqueApplyTransferSealToMirrorPayload(mpl, gs) {
    var seal = gs && gs.risquePublicTransferMirrorSeal;
    if (!seal || !seal.sourceLabel || !seal.destLabel) return mpl;
    var cp = gs.currentPlayer;
    var out = JSON.parse(JSON.stringify(mpl));
    out.players.forEach(function (p) {
      if (!p || p.name !== cp) return;
      (p.territories || []).forEach(function (t) {
        if (!t || !t.name) return;
        if (t.name === seal.sourceLabel) {
          t.troops = Number(seal.sourceTroops) || 0;
        }
        if (t.name === seal.destLabel) {
          t.troops = Number(seal.destTroops) || 0;
        }
      });
    });
    return out;
  }

  /** After quota pressure, always omit replay blobs from STORAGE_KEY for the rest of this tab. */
  window.__risqueQuotaPressureLite = false;

  function risqueReleaseLocalStorageQuotaPressure() {
    var keysToDrop = [
      LOG_KEY,
      "risqueReplayTapeSidecar",
      SIDECAR_INDEX_KEY,
      ROUND_AUTOSAVE_KEY
    ];
    var ki;
    for (ki = 0; ki < keysToDrop.length; ki += 1) {
      try {
        localStorage.removeItem(keysToDrop[ki]);
      } catch (eDrop) {
        /* ignore */
      }
    }
    try {
      var rawGrace = localStorage.getItem(GRACE_SNAPSHOTS_STORAGE_KEY);
      var graceArr = tryParse(rawGrace || "[]");
      if (Array.isArray(graceArr) && graceArr.length > 8) {
        localStorage.setItem(GRACE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(graceArr.slice(-8)));
      }
    } catch (eGrace) {
      try {
        localStorage.removeItem(GRACE_SNAPSHOTS_STORAGE_KEY);
      } catch (eGraceRm) {
        /* ignore */
      }
    }
    try {
      var led = tryParse(localStorage.getItem(LEDGER_KEY) || "[]");
      if (Array.isArray(led) && led.length > 80) {
        localStorage.setItem(LEDGER_KEY, JSON.stringify(led.slice(-80)));
      }
    } catch (eLed) {
      /* ignore */
    }
    try {
      var mir = localStorage.getItem(PUBLIC_MIRROR_KEY);
      if (mir && mir.length > 450000) {
        localStorage.removeItem(PUBLIC_MIRROR_KEY);
      }
    } catch (eMir) {
      /* ignore */
    }
    window.__risqueQuotaPressureLite = true;
  }

  function risqueShrinkGameStateJsonForStorage(key, value) {
    if (key !== STORAGE_KEY || typeof value !== "string") return value;
    try {
      var parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== "object") return value;
      if (typeof window.risqueReplayPruneOldestRoundBuckets === "function") {
        window.risqueReplayPruneOldestRoundBuckets(parsed, 2);
      }
      var slim =
        typeof window.risqueStripReplayFromGameStateClone === "function"
          ? window.risqueStripReplayFromGameStateClone(parsed)
          : risqueBuildEmergencyStorageState(parsed);
      risqueApplyLsReplayLiteToPayload(slim);
      return typeof window.risqueJsonStringifyGameStateForStorage === "function"
        ? window.risqueJsonStringifyGameStateForStorage(slim)
        : JSON.stringify(slim);
    } catch (eShr) {
      return value;
    }
  }

  function risqueTryWriteLocalStorageWithQuotaFallback(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      if (!(err && (err.name === "QuotaExceededError" || err.code === 22))) return false;
    }
    risqueReleaseLocalStorageQuotaPressure();
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (errRetry) {
      if (!(errRetry && (errRetry.name === "QuotaExceededError" || errRetry.code === 22))) return false;
    }
    if (key === STORAGE_KEY) {
      var shrunk = risqueShrinkGameStateJsonForStorage(key, value);
      if (shrunk !== value) {
        try {
          localStorage.setItem(key, shrunk);
          try {
            console.warn(
              "[RISQUE] localStorage full — saved lean gameState (replay omitted from disk; still in memory)."
            );
          } catch (eWarn) {
            /* ignore */
          }
          return true;
        } catch (errSlim) {
          if (!(errSlim && (errSlim.name === "QuotaExceededError" || errSlim.code === 22))) return false;
        }
      }
    }
    return false;
  }
  window.risqueTryWriteLocalStorageWithQuotaFallback = risqueTryWriteLocalStorageWithQuotaFallback;

  function risqueBuildEmergencyStorageState(forDisk) {
    var lite = JSON.parse(JSON.stringify(forDisk || {}));
    /* Emergency quota fallback: keep live game, drop replay/history blobs first. */
    delete lite.risqueReplayTape;
    delete lite.risqueReplayByRound;
    delete lite.risqueReplayPlayerColors;
    delete lite.risqueCheapReplayStills;
    delete lite.risqueCheapReplayBattleSeq;
    delete lite.risqueCheapReplayFrameSeq;
    delete lite.risqueCombatLogTail;
    return lite;
  }

  /**
   * Lean localStorage (opt-in via `risqueLsReplayLiteEffective` in replay-tape.js): omit replay blobs from
   * persisted gameState; live `window.gameState` still holds the tape. Enable: `?lsReplayLite=1` or
   * `risqueLsReplayLite=1`; disable explicit opt-out: `?lsReplayLite=0`. Mirror disk payload uses the same
   * replay strip keys as `REPLAY_STRIP_KEYS` in replay-tape.js when lite is on.
   */
  var RISQUE_LS_REPLAY_LITE_KEYS = [
    "risqueReplayTape",
    "risqueReplayPlayerColors",
    "risqueReplayByRound",
    "risqueReplayPlaybackActive",
    "risqueReplayHudRound",
    "risqueReplayBattleFlashLabels",
    "risquePublicReplayRound",
    "risquePublicReplayEliminationSplash",
    "phaseReplayIndex"
  ];
  var __risqueLoggedLsReplayLite = false;
  function risqueLocalStorageReplayLiteEnabled() {
    if (window.__risqueQuotaPressureLite) return true;
    if (typeof window.risqueLsReplayLiteEffective === "function") {
      return window.risqueLsReplayLiteEffective();
    }
    return false;
  }
  window.risqueLocalStorageReplayLiteEnabled = risqueLocalStorageReplayLiteEnabled;
  function risqueApplyLsReplayLiteToPayload(obj) {
    if (!obj || typeof obj !== "object") return;
    var i;
    for (i = 0; i < RISQUE_LS_REPLAY_LITE_KEYS.length; i += 1) {
      delete obj[RISQUE_LS_REPLAY_LITE_KEYS[i]];
    }
  }
  function risqueMaybeLogLsReplayLiteOnce() {
    if (__risqueLoggedLsReplayLite || !risqueLocalStorageReplayLiteEnabled()) return;
    __risqueLoggedLsReplayLite = true;
    try {
      console.info(
        "[RISQUE] Lean localStorage: replay omitted from persisted gameState (lsReplayLite on). " +
          "Full replay stays in memory until reload; use SAVE for a file with tape. Opt out: ?lsReplayLite=0"
      );
    } catch (eLog) {
      /* ignore */
    }
  }

  function risqueBuildEmergencyMirrorPayload(mirrorPayload) {
    var lite = JSON.parse(JSON.stringify(mirrorPayload || {}));
    /* TV needs map + phase sync; trim bulky recap/log payloads under quota pressure. */
    delete lite.risqueCombatLogTail;
    /* MUST keep risquePublicBookProcessing + risquePublicCardplayRecap during cardplay: without them the
     * public tab never runs book steps, so risquePublicAerialDecisionReady / recap ack never arrive and
     * the host aerial-confirm gate deadlocks (worse as STORAGE_KEY grows toward quota). */
    delete lite.risquePublicLoginFormMirror;
    delete lite.risqueReplayTape;
    delete lite.risqueReplayByRound;
    return lite;
  }

  /**
   * Host only: persist full gameState to STORAGE_KEY, then write PUBLIC_MIRROR_KEY (frozen board during
   * private cardplay draft so the TV tab is not overwritten by host saves).
   */
  var __risqueMirrorPushCoalesceRaf = null;
  var risqueMirrorPushGameStateSync = function () {
    if (__risqueMirrorPushCoalesceRaf != null) {
      cancelAnimationFrame(__risqueMirrorPushCoalesceRaf);
      __risqueMirrorPushCoalesceRaf = null;
    }
    if (window.risqueDisplayIsPublic) return;
    if (!window.gameState) return;
    try {
      var gs = window.gameState;
      /* Ephemeral TV-only fields (e.g. name roulette) must not bloat host saves */
      var tierMir =
        gs && gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
      if (typeof window.risqueCheapReplayDetachFromGameState === "function") {
        try {
          window.risqueCheapReplayDetachFromGameState(gs);
        } catch (eCrMir) {
          /* ignore */
        }
      }
      var forDisk;
      if (risqueLocalStorageReplayLiteEnabled() || tierMir === "battle_stills" || tierMir === "host_ultra") {
        risqueMaybeLogLsReplayLiteOnce();
        forDisk =
          typeof window.risqueCloneGameStateOmitReplayKeys === "function"
            ? window.risqueCloneGameStateOmitReplayKeys(gs)
            : null;
        if (!forDisk) {
          forDisk = JSON.parse(JSON.stringify(gs));
          risqueApplyLsReplayLiteToPayload(forDisk);
        }
      } else {
        forDisk = JSON.parse(JSON.stringify(gs));
      }
      try {
        delete forDisk.risqueCheapReplayStills;
        delete forDisk.risqueCheapReplayBattleSeq;
        delete forDisk.risqueCheapReplayFrameSeq;
      } catch (eChp) {
        /* ignore */
      }
      delete forDisk.risqueReplayPlaybackActive;
      delete forDisk.phaseReplayIndex;
      delete forDisk.risquePublicPlayerSelectFlash;
      delete forDisk.risquePublicUiSelectKind;
      delete forDisk.risquePublicMirrorSeq;
      delete forDisk.risquePublicLoginFormMirror;
      delete forDisk.risquePublicDealPopTerritory;
      delete forDisk.risqueReinforcePreview;
      delete forDisk.risqueTransferPulse;
      delete forDisk.risqueHostAttackStepStripActive;
      delete forDisk.risquePublicLoginHostFade;
      delete forDisk.risquePublicLoginTvBlackout;
      delete forDisk.risquePublicReplayEliminationSplash;
      /* Host STORAGE_KEY keeps replay tape for session resume; TV mirror payload still omits it below. */
      /* Keep risquePublicCampaignWarpathLabels on disk so STORAGE_KEY matches mirror map highlights (refreshVisuals / seq edge cases). */
      /* Keep cardplay TV recap + gate flags on disk so the host can show “Continue to Income” after save/reload. */
      if (String(gs.phase || "") !== "cardplay" && String(gs.phase || "") !== "con-cardplay") {
        delete forDisk.risquePublicCardplayRecap;
        delete forDisk.risquePublicCardplayRecapAckRequiredSeq;
        delete forDisk.risquePublicCardplayAerialSkipHostDecisionSeq;
        delete forDisk.risquePublicCardplayRecapSeq;
        delete forDisk.risqueCardplayTvRecapPublished;
        delete forDisk.risqueCardplaySuppressPublicSpectator;
        delete forDisk.risquePublicCardplaySpectatorHandCount;
        delete forDisk.risquePublicCardplaySpectatorPlayer;
      }
      var forDiskJson = JSON.stringify(forDisk);
      if (!risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, forDiskJson)) {
        var emergencyDisk = risqueBuildEmergencyStorageState(forDisk);
        var emergencyDiskJson = JSON.stringify(emergencyDisk);
        risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, emergencyDiskJson);
      }
      var out = gs;
      var snap = gs.risqueCardplayPublicMirrorSnapshot;
      if (
        (String(gs.phase || "") === "cardplay" || String(gs.phase || "") === "con-cardplay") &&
        gs.risqueCardplayUseFrozenPublicMirror === true &&
        !gs.risqueReplayPlaybackActive &&
        snap &&
        snap.players &&
        Array.isArray(snap.players)
      ) {
        out =
          typeof window.risqueCloneGameStateOmitReplayKeys === "function"
            ? window.risqueCloneGameStateOmitReplayKeys(gs)
            : null;
        if (!out) {
          out = JSON.parse(JSON.stringify(gs));
        }
        out.players = JSON.parse(JSON.stringify(snap.players));
        out.aerialAttack = !!snap.aerialAttack;
        out.bookPlayedThisTurn = !!snap.bookPlayedThisTurn;
        out.conqueredThisTurn = !!snap.conqueredThisTurn;
        out.cardEarnedViaCardplay = !!snap.cardEarnedViaCardplay;
        var fe = snap.risquePublicEliminationBanner != null ? String(snap.risquePublicEliminationBanner).trim() : "";
        if (fe) {
          out.risquePublicEliminationBanner = fe;
        } else {
          delete out.risquePublicEliminationBanner;
        }
        /* TV still sees live board focus/highlight from the host; voice + combat tail stay gated. */
        if (Array.isArray(out.risqueCombatLogTail)) {
          out.risqueCombatLogTail = [];
        }
        delete out.risqueControlVoice;
      }
      if (String(out.phase || "") === "deploy") {
        var depDraft = window.deployedTroops || {};
        var deltasCopy = {};
        Object.keys(depDraft).forEach(function (k) {
          var dv = Number(depDraft[k]);
          if (Number.isFinite(dv)) deltasCopy[k] = dv;
        });
        out.risqueDeployMirrorDraft = {
          deltas: deltasCopy,
          selected:
            window.selectedTerritory != null && String(window.selectedTerritory) !== ""
              ? String(window.selectedTerritory)
              : null
        };
      } else {
        delete out.risqueDeployMirrorDraft;
      }
      /* Unique payload every push so the TV tab always sees a change (storage events + polling). */
      var mirrorPayload;
      if (String(out.phase || "") === "login") {
        var formMir = null;
        try {
          if (out.risquePublicLoginFormMirror) {
            formMir = JSON.parse(JSON.stringify(out.risquePublicLoginFormMirror));
          }
        } catch (eLF) {
          formMir = null;
        }
        mirrorPayload = visualStateForLoginScreen(out);
        /* TV dissolve: explicit mirror-only flag (not persisted on host disk) so the public tab never
         * misses the fade — truthy checks only; phase+fade alone failed in some timing/shape cases. */
        if (out.risquePublicLoginHostFade) {
          mirrorPayload.risquePublicLoginHostFade = true;
          mirrorPayload.risquePublicLoginTvBlackout = 1;
        }
        if (formMir) {
          mirrorPayload.risquePublicLoginFormMirror = formMir;
        } else {
          delete mirrorPayload.risquePublicLoginFormMirror;
        }
      } else {
        mirrorPayload =
          typeof window.risqueCloneGameStateOmitReplayKeys === "function"
            ? window.risqueCloneGameStateOmitReplayKeys(out)
            : null;
        if (!mirrorPayload) {
          mirrorPayload = JSON.parse(JSON.stringify(out));
        }
      }
      if (
        String(gs.phase || "") === "attack" &&
        String(gs.attackPhase || "") === "pending_transfer" &&
        gs.risquePublicTransferMirrorSeal &&
        mirrorPayload &&
        Array.isArray(mirrorPayload.players)
      ) {
        mirrorPayload = risqueApplyTransferSealToMirrorPayload(mirrorPayload, gs);
      }
      mirrorPayload.risquePublicMirrorSeq =
        (Number(window.__risquePublicMirrorSeqCounter) || 0) + 1;
      window.__risquePublicMirrorSeqCounter = mirrorPayload.risquePublicMirrorSeq;
      if (mirrorPayload && typeof mirrorPayload === "object") {
        delete mirrorPayload.risquePlayedCardsGallery;
        delete mirrorPayload.risqueLuckyLedger;
        /* TV needs this flag to bypass cardplay book map during host battle replay. */
        delete mirrorPayload.phaseReplayIndex;
        /* Full tape can exceed localStorage quota; TV only needs current frame + playback flag. */
        delete mirrorPayload.risqueReplayTape;
        delete mirrorPayload.risqueReplayByRound;
        delete mirrorPayload.risquePublicReplayRound;
      }
      var mirrorJson = JSON.stringify(mirrorPayload);
      if (!risqueTryWriteLocalStorageWithQuotaFallback(PUBLIC_MIRROR_KEY, mirrorJson)) {
        var emergencyMirror = risqueBuildEmergencyMirrorPayload(mirrorPayload);
        var emergencyMirrorJson = JSON.stringify(emergencyMirror);
        risqueTryWriteLocalStorageWithQuotaFallback(PUBLIC_MIRROR_KEY, emergencyMirrorJson);
      }
      /* Host: TV applies income spreadsheet via risquePublicMirrorGameStateApply; host never did — paint here. */
      if (gs && risquePhaseIsIncomeVoiceMirror(gs.phase)) {
        try {
          risquePublicApplyVoiceAndLogMirror(gs);
        } catch (eIncomeVoice) {
          /* ignore */
        }
      }
      /* Disk session layout: create GAME/RQSESS-* and REPLAY/RQSESS-* on first persist (picker folder or launcher disk API).
       * Boot reattach can race before IndexedDB restores the handle; deal/replay still calls mirror push — this catches that. */
      var canPrimeSessionDirs =
        (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()) ||
        (window.location.protocol !== "file:" &&
          typeof window.risqueHostSaveFolderGet === "function" &&
          window.risqueHostSaveFolderGet());
      if (canPrimeSessionDirs && typeof window.risqueSessionDiskEnsureGameDirHandle === "function") {
        try {
          window.risqueSessionDiskEnsureGameDirHandle(gs).then(function (dh) {
            if (dh && gs && gs.risqueAutosaveSessionDir && typeof saveState === "function") {
              try {
                /*
                 * Login replaces window.gameState synchronously after this push (build roster + clear LS).
                 * A late dir-handle resolve must not resurrect that pre-login snapshot into localStorage.
                 */
                if (window.gameState !== gs) return;
                saveState(gs);
              } catch (eSess) {
                /* ignore */
              }
            }
          });
        } catch (ePrime) {
          /* ignore */
        }
      }
    } catch (eMir) {
      /* ignore */
    }
  };

  window.risqueMirrorPushGameState = risqueMirrorPushGameStateSync;

  window.risqueScheduleMirrorPush = function () {
    if (window.risqueDisplayIsPublic) return;
    if (!window.gameState) return;
    if (__risqueMirrorPushCoalesceRaf != null) return;
    __risqueMirrorPushCoalesceRaf = requestAnimationFrame(function () {
      __risqueMirrorPushCoalesceRaf = null;
      risqueMirrorPushGameStateSync();
    });
  };
  window.risqueFlushMirrorPush = function () {
    if (__risqueMirrorPushCoalesceRaf != null) {
      cancelAnimationFrame(__risqueMirrorPushCoalesceRaf);
      __risqueMirrorPushCoalesceRaf = null;
    }
    risqueMirrorPushGameStateSync();
  };

  /**
   * Hard refresh / tab close: flush replay sidecar + gameState so option 3 (tape in RAM only) survives reload.
   * Sidecar alone is not enough — reload must also rehydrate gameState (phase, board, session key).
   */
  function risquePersistReplayAndGameStateBeforeUnload() {
    if (window.risqueDisplayIsPublic) return;
    var gs = window.gameState;
    if (!gs || typeof gs !== "object") return;
    var ph = gs.phase != null ? String(gs.phase) : "";
    if (!ph || ph === "login") return;
    try {
      if (typeof window.risqueReplayPersistTapeSidecarImmediate === "function") {
        window.risqueReplayPersistTapeSidecarImmediate(gs);
      } else if (typeof window.risqueReplayFlushTapeSidecarSchedule === "function") {
        window.risqueReplayFlushTapeSidecarSchedule();
      }
    } catch (eSide) {
      /* ignore */
    }
    try {
      saveState(gs);
    } catch (eSv) {
      /* ignore */
    }
    if (typeof window.risqueFlushMirrorPush === "function") {
      try {
        window.risqueFlushMirrorPush();
      } catch (ePH) {
        /* ignore */
      }
    }
  }

  if (!window.__risqueUnloadPersistWired) {
    window.__risqueUnloadPersistWired = true;
    window.addEventListener("pagehide", risquePersistReplayAndGameStateBeforeUnload);
    window.addEventListener("beforeunload", risquePersistReplayAndGameStateBeforeUnload);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        risquePersistReplayAndGameStateBeforeUnload();
      }
    });
  }

  /**
   * Frequent phase updates (deal steps, deploy wheel): persist stripped gameState only — no replay
   * sidecar, no TV mirror. Keeps localStorage under quota while the tape grows in RAM.
   */
  window.risqueWriteGameStateLocalStorageLite = function (stateOpt) {
    if (window.risqueDisplayIsPublic) return false;
    var gs = stateOpt && typeof stateOpt === "object" ? stateOpt : window.gameState;
    if (!gs) return false;
    var payload = gs;
    try {
      if (
        risqueLocalStorageReplayLiteEnabled() &&
        typeof window.risqueStripReplayFromGameStateClone === "function"
      ) {
        payload = window.risqueStripReplayFromGameStateClone(gs);
      }
      var diskJson =
        typeof window.risqueJsonStringifyGameStateForStorage === "function"
          ? window.risqueJsonStringifyGameStateForStorage(payload)
          : JSON.stringify(payload);
      if (!risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, diskJson)) {
        var emergency = risqueBuildEmergencyStorageState(payload);
        var emergencyJson =
          typeof window.risqueJsonStringifyGameStateForStorage === "function"
            ? window.risqueJsonStringifyGameStateForStorage(emergency)
            : JSON.stringify(emergency);
        return risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, emergencyJson);
      }
      return true;
    } catch (eLite) {
      return false;
    }
  };

  /** Host phases should call this after mutating state (save + TV mirror). */
  window.risquePersistHostGameState = function (stateOpt) {
    var gs = stateOpt && typeof stateOpt === "object" ? stateOpt : window.gameState;
    if (!window.risqueDisplayIsPublic && gs && typeof saveState === "function") {
      try {
        saveState(gs);
      } catch (eSv) {
        /* ignore */
      }
    }
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  };

  /**
   * After login builds the real session, sync both shell `state` and window.gameState.
   * Otherwise refreshVisuals() does window.gameState = state and deferred login mirror pushes can
   * overwrite localStorage with stale login-phase data.
   */
  window.risqueHostReplaceShellGameState = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return;
    state = gs;
    window.gameState = gs;
  };

  var __risqueSpectatorFocusPrevPaint = [];

  /**
   * Highlight territory markers (scaled on board) for spectators; stored in gameState for mirror.
   * @param {string|string[]|null} labels - territory ids, or null/[] to clear
   */
  window.risqueSetSpectatorFocus = function (labels) {
    if (!window.gameState) return;
    var raw = labels == null ? [] : Array.isArray(labels) ? labels : [labels];
    var L = [];
    var i;
    for (i = 0; i < raw.length; i += 1) {
      if (raw[i]) L.push(String(raw[i]));
    }
    var prev = __risqueSpectatorFocusPrevPaint;
    var paintSet = {};
    for (i = 0; i < prev.length; i += 1) {
      paintSet[prev[i]] = true;
    }
    for (i = 0; i < L.length; i += 1) {
      paintSet[L[i]] = true;
    }
    var toRedraw = Object.keys(paintSet);
    __risqueSpectatorFocusPrevPaint = L.slice();

    window.gameState.risqueSpectatorFocusLabels = L;
    if (typeof window.risqueScheduleMirrorPush === "function") {
      window.risqueScheduleMirrorPush();
    } else if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
    if (!window.risqueDisplayIsPublic && window.gameUtils && typeof window.gameUtils.renderTerritories === "function") {
      requestAnimationFrame(function () {
        var gs = window.gameState;
        var dep = window.deployedTroops || {};
        if (!gs) return;
        if (toRedraw.length === 0) {
          window.gameUtils.renderTerritories(null, gs, dep);
        } else {
          for (i = 0; i < toRedraw.length; i += 1) {
            window.gameUtils.renderTerritories(toRedraw[i], gs, dep);
          }
        }
      });
    }
  };

  window.risqueClearSpectatorFocus = function () {
    window.risqueSetSpectatorFocus([]);
  };

  function tryParse(json) {
    try {
      return JSON.parse(json);
    } catch (err) {
      return null;
    }
  }

  var __risqueCursorMirrorSeq = 0;
  var __risqueCursorMirrorRaf = null;
  var __risqueCursorMirrorPending = null;

  function risquePublicApplyCursorMirror() {
    if (!window.risqueDisplayIsPublic) return;
    var el = document.getElementById("risque-public-cursor-mirror");
    if (!el) return;
    var hidePrivate = document.body.getAttribute("data-risque-public-hide-cursor") === "1";
    var raw;
    try {
      raw = localStorage.getItem(PUBLIC_CURSOR_MIRROR_KEY);
    } catch (e) {
      return;
    }
    if (!raw) {
      el.classList.remove("risque-public-cursor-mirror--visible");
      return;
    }
    var o = tryParse(raw);
    if (!o || (o.v !== 1 && o.v !== 2)) {
      el.classList.remove("risque-public-cursor-mirror--visible");
      return;
    }
    if (hidePrivate || o.in === false) {
      el.classList.remove("risque-public-cursor-mirror--visible");
      return;
    }
    var nx = Number(o.nx);
    var ny = Number(o.ny);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      el.classList.remove("risque-public-cursor-mirror--visible");
      return;
    }
    var x;
    var y;
    if (o.v === 2) {
      var boardEl = document.getElementById("canvas");
      if (!boardEl) {
        el.classList.remove("risque-public-cursor-mirror--visible");
        return;
      }
      var br = boardEl.getBoundingClientRect();
      if (br.width < 1 || br.height < 1) {
        el.classList.remove("risque-public-cursor-mirror--visible");
        return;
      }
      x = br.left + nx * br.width;
      y = br.top + ny * br.height;
    } else {
      var iw = window.innerWidth;
      var ih = window.innerHeight;
      if (iw < 2 || ih < 2) {
        el.classList.remove("risque-public-cursor-mirror--visible");
        return;
      }
      x = nx * iw;
      y = ny * ih;
    }
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.classList.add("risque-public-cursor-mirror--visible");
  }

  function installRisquePublicCursorMirrorTracking() {
    if (window.risqueDisplayIsPublic) {
      var el = document.createElement("div");
      el.id = "risque-public-cursor-mirror";
      el.className = "risque-public-cursor-mirror";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
      window.addEventListener("storage", function (ev) {
        if (ev.key === PUBLIC_CURSOR_MIRROR_KEY) {
          risquePublicApplyCursorMirror();
        }
      });
      window.addEventListener("resize", function () {
        risquePublicApplyCursorMirror();
      });
      setInterval(risquePublicApplyCursorMirror, 25);
      requestAnimationFrame(risquePublicApplyCursorMirror);
      return;
    }

    document.addEventListener(
      "mousemove",
      function (ev) {
        __risqueCursorMirrorPending = { clientX: ev.clientX, clientY: ev.clientY };
        if (__risqueCursorMirrorRaf) return;
        __risqueCursorMirrorRaf = requestAnimationFrame(function () {
          __risqueCursorMirrorRaf = null;
          if (!__risqueCursorMirrorPending) return;
          var cx = __risqueCursorMirrorPending.clientX;
          var cy = __risqueCursorMirrorPending.clientY;
          __risqueCursorMirrorPending = null;
          var hudRoot = document.getElementById("runtime-hud-root");
          var overHud = false;
          if (hudRoot) {
            var hr = hudRoot.getBoundingClientRect();
            overHud =
              hr.width > 0 &&
              hr.height > 0 &&
              cx >= hr.left &&
              cx <= hr.right &&
              cy >= hr.top &&
              cy <= hr.bottom;
          }
          var boardEl = document.getElementById("canvas");
          var nx = 0;
          var ny = 0;
          var ver = 2;
          if (boardEl) {
            var br = boardEl.getBoundingClientRect();
            if (br.width > 0 && br.height > 0) {
              nx = (cx - br.left) / br.width;
              ny = (cy - br.top) / br.height;
            } else {
              ver = 1;
              var iw = window.innerWidth;
              var ih = window.innerHeight;
              if (iw < 2 || ih < 2) return;
              nx = cx / iw;
              ny = cy / ih;
            }
          } else {
            ver = 1;
            var iwF = window.innerWidth;
            var ihF = window.innerHeight;
            if (iwF < 2 || ihF < 2) return;
            nx = cx / iwF;
            ny = cy / ihF;
          }
          /* v2: normalized to #canvas so public TV matches the map regardless of HUD width or window size. */
          var payload = {
            v: ver,
            seq: (++__risqueCursorMirrorSeq) % 10000000,
            in: !overHud,
            nx: nx,
            ny: ny
          };
          try {
            localStorage.setItem(PUBLIC_CURSOR_MIRROR_KEY, JSON.stringify(payload));
          } catch (eSet) {
            /* ignore */
          }
        });
      },
      true
    );

    document.addEventListener(
      "mouseleave",
      function (ev) {
        if (ev.target !== document.documentElement && ev.target !== document.body) return;
        try {
          localStorage.setItem(
            PUBLIC_CURSOR_MIRROR_KEY,
            JSON.stringify({ v: 1, seq: (++__risqueCursorMirrorSeq) % 10000000, in: false })
          );
        } catch (eLv) {
          /* ignore */
        }
      },
      true
    );
  }

  /**
   * Mouse thumb buttons (browser Back/Forward) often leave the page or reload history and feel like a "reset".
   * We capture button 3 / 4 and preventDefault; optionally trap history back; optional in-game menu.
   * Override before load: window.risqueSideMouseShowMenu = false (silent); window.risquePreventHistoryBackTrap = false (allow browser back).
   * Custom static menus: window.risqueSideMouseMenu = { button3: [...], button4: [...] };
   * Dynamic contextual menu (e.g. deploy): window.risqueGetAuxMouseMenu = function (ctx) {
   *   return { title, hint, actions: [{ label, action }], anchor: true };
   * }; ctx = { button: 3|4, clientX, clientY }. Return null to use static/default.
   */
  function installRisqueAuxMouseAndHistoryGuard() {
    if (window.__risqueAuxMouseGuard) return;
    window.__risqueAuxMouseGuard = true;

    var sideOverlay = null;
    var lastSideMenuAt = 0;

    function closeSideMouseMenu() {
      if (sideOverlay && sideOverlay.parentNode) {
        sideOverlay.parentNode.removeChild(sideOverlay);
      }
      sideOverlay = null;
    }
    window.risqueCloseSideMouseMenu = closeSideMouseMenu;

    function openSideMouseMenu(whichButton, clientX, clientY) {
      if (window.risqueSideMouseShowMenu === false) return;
      if (sideOverlay && document.body.contains(sideOverlay)) return;
      var now = Date.now();
      if (now - lastSideMenuAt < 200) return;
      lastSideMenuAt = now;

      var fromPhase = null;
      if (typeof window.risqueGetAuxMouseMenu === "function") {
        try {
          fromPhase = window.risqueGetAuxMouseMenu({
            button: whichButton,
            clientX: clientX,
            clientY: clientY
          });
        } catch (ePhase) {
          fromPhase = null;
        }
      }

      var actions = null;
      var titleText = null;
      var hintText = null;
      var useAnchor = false;

      if (fromPhase && Array.isArray(fromPhase.actions) && fromPhase.actions.length > 0) {
        actions = fromPhase.actions;
        titleText = fromPhase.title != null ? String(fromPhase.title) : "Quick actions";
        hintText = fromPhase.hint != null ? String(fromPhase.hint) : "";
        useAnchor =
          fromPhase.anchor !== false &&
          typeof clientX === "number" &&
          typeof clientY === "number" &&
          !isNaN(clientX) &&
          !isNaN(clientY);
      } else {
        var custom = window.risqueSideMouseMenu;
        if (custom && typeof custom === "object" && custom !== null) {
          if (whichButton === 3 && Array.isArray(custom.button3)) {
            actions = custom.button3;
          } else if (whichButton === 4 && Array.isArray(custom.button4)) {
            actions = custom.button4;
          } else if (Array.isArray(custom.actions)) {
            actions = custom.actions;
          }
        }
        if (!actions || actions.length === 0) {
          actions = [
            {
              label: "Continue playing",
              action: function () {}
            },
            {
              label: "Open manual (new tab)",
              action: function () {
                try {
                  window.open(risqueDoc("manual"), "_blank", "noopener,noreferrer");
                } catch (eM) {
                  /* ignore */
                }
              }
            },
            {
              label: "Open help (new tab)",
              action: function () {
                try {
                  window.open(risqueDoc("help"), "_blank", "noopener,noreferrer");
                } catch (eH) {
                  /* ignore */
                }
              }
            }
          ];
        }
        titleText =
          whichButton === 3 ? "Thumb button — Back" : whichButton === 4 ? "Thumb button — Forward" : "Extra mouse button";
        hintText =
          "This button normally moves the browser Back or Forward. That is blocked here so the session is not lost by accident.";
        useAnchor = false;
      }

      closeSideMouseMenu();
      sideOverlay = document.createElement("div");
      sideOverlay.id = "risque-side-mouse-overlay";
      sideOverlay.className =
        "risque-side-mouse-overlay" + (useAnchor ? " risque-side-mouse-overlay--at-cursor" : "");
      sideOverlay.setAttribute("role", "dialog");
      sideOverlay.setAttribute("aria-modal", "true");
      sideOverlay.innerHTML =
        '<div class="risque-side-mouse-dialog">' +
        '<p class="risque-side-mouse-title"></p>' +
        '<p class="risque-side-mouse-hint"></p>' +
        '<div class="risque-side-mouse-actions"></div>' +
        "</div>";

      var titleEl = sideOverlay.querySelector(".risque-side-mouse-title");
      if (titleEl) {
        titleEl.textContent = titleText || "";
      }
      var hintEl = sideOverlay.querySelector(".risque-side-mouse-hint");
      if (hintEl) {
        if (!hintText) {
          hintEl.style.display = "none";
        } else {
          hintEl.style.display = "";
          hintEl.textContent = hintText;
        }
      }

      var actHost = sideOverlay.querySelector(".risque-side-mouse-actions");
      actions.forEach(function (entry) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "risque-side-mouse-action-btn";
        btn.textContent = entry.label || "Action";
        btn.addEventListener("click", function () {
          try {
            if (typeof entry.action === "function") {
              entry.action();
            }
          } catch (eAct) {
            /* ignore */
          }
          closeSideMouseMenu();
        });
        actHost.appendChild(btn);
      });

      sideOverlay.addEventListener("click", function (ev) {
        if (ev.target === sideOverlay) {
          closeSideMouseMenu();
        }
      });

      document.body.appendChild(sideOverlay);

      if (useAnchor) {
        var dlg = sideOverlay.querySelector(".risque-side-mouse-dialog");
        if (dlg) {
          requestAnimationFrame(function () {
            try {
              var rect = dlg.getBoundingClientRect();
              var w = rect.width;
              var h = rect.height;
              var pad = 8;
              var x = Math.min(Math.max(pad, clientX), window.innerWidth - w - pad);
              var y = Math.min(Math.max(pad, clientY + 6), window.innerHeight - h - pad);
              dlg.style.left = x + "px";
              dlg.style.top = y + "px";
            } catch (ePos) {
              /* ignore */
            }
          });
        }
      }
    }

    function swallowAuxMouse(ev) {
      if (ev.button !== 3 && ev.button !== 4) return;
      ev.preventDefault();
      ev.stopPropagation();
      openSideMouseMenu(ev.button, ev.clientX, ev.clientY);
    }

    document.addEventListener("mousedown", swallowAuxMouse, true);
    document.addEventListener("auxclick", swallowAuxMouse, true);
    document.addEventListener(
      "pointerdown",
      function (ev) {
        if (ev.pointerType === "mouse" && (ev.button === 3 || ev.button === 4)) {
          swallowAuxMouse(ev);
        }
      },
      true
    );

    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Escape" && sideOverlay) {
          closeSideMouseMenu();
        }
      },
      true
    );

    if (window.risquePreventHistoryBackTrap !== false) {
      try {
        history.pushState({ risqueHistGuard: 1 }, "", location.href);
        window.addEventListener("popstate", function () {
          try {
            history.pushState({ risqueHistGuard: 1 }, "", location.href);
          } catch (ePs) {
            /* ignore */
          }
        });
      } catch (eHist) {
        /* file:// or restricted contexts */
      }
    }
  }

  function syncHostHudStatsColumnRetiredClass(gs) {
    try {
      var rh = document.getElementById("runtime-hud-root");
      if (window.risqueDisplayIsPublic) {
        if (rh) rh.classList.remove("runtime-hud-root--host-stats-column-retired");
        return;
      }
      if (!rh) return;
      if (gs && typeof gs === "object") {
        var flipped = risqueApplyHostHudStatsColumnRetiredFromPhase(gs);
        if (flipped) {
          saveState(gs);
        }
        rh.classList.toggle("runtime-hud-root--host-stats-column-retired", gs.risqueHostHudStatsColumnRetired === true);
      } else {
        rh.classList.remove("runtime-hud-root--host-stats-column-retired");
      }
    } catch (eRet) {
      /* ignore */
    }
  }

  function syncPhaseDataAttr(gs) {
    try {
      if (!document.body) return;
      document.body.setAttribute("data-risque-phase", gs && gs.phase ? String(gs.phase) : "");
      if (!gs || String(gs.phase || "") !== "reinforce") {
        document.body.removeAttribute("data-risque-reinforce-slot-mode");
      }
      if (window.risqueDisplayIsPublic) {
        /* Public TV: show mirrored dice during attack (see risquePublicApplyDiceAndBattleReadout). */
        var phPub = gs && gs.phase ? String(gs.phase) : "";
        document.body.setAttribute(
          "data-risque-show-public-dice",
          phPub === "attack" ? "1" : "0"
        );
        /* Duplicate cursor is hidden when the host points at the control column (payload in:false), not by phase. */
        document.body.removeAttribute("data-risque-public-hide-cursor");
        risquePublicApplyCursorMirror();
      } else {
        document.body.removeAttribute("data-risque-show-public-dice");
        document.body.removeAttribute("data-risque-public-hide-cursor");
      }
      syncHostHudStatsColumnRetiredClass(gs);
    } catch (eAttr) {
      /* ignore */
    }
  }

  function risqueHostCloseLuckyPanelView(rh, main, luckyPanel) {
    if (!rh || !main || !luckyPanel) return;
    if (!rh.classList.contains("runtime-hud-root--host-panel-lucky-focus")) return;
    rh.classList.remove("runtime-hud-root--host-panel-lucky-focus");
    var brandL = document.getElementById("risque-host-lucky-focus-brand");
    if (brandL && brandL.parentNode) {
      brandL.parentNode.removeChild(brandL);
    }
    var rL = window.__risqueHudLuckyDockRestore;
    if (rL && rL.parent && luckyPanel.parentNode === main) {
      rL.parent.insertBefore(luckyPanel, rL.next);
    }
    luckyPanel.setAttribute("hidden", "");
    luckyPanel.setAttribute("aria-hidden", "true");
    var luckyBtn = document.getElementById("risque-host-lucky-toggle");
    if (luckyBtn) luckyBtn.setAttribute("aria-checked", "false");
  }

  function risqueHostCloseCardsPlayedPanelView(rh, main, cardsPanel, body) {
    if (!rh || !main || !cardsPanel) return;
    if (!rh.classList.contains("runtime-hud-root--host-panel-cards-focus")) return;
    rh.classList.remove("runtime-hud-root--host-panel-cards-focus");
    var brandCards = document.getElementById("risque-host-cards-focus-brand");
    if (brandCards && brandCards.parentNode) {
      brandCards.parentNode.removeChild(brandCards);
    }
    var rCards = window.__risqueHudCardsPlayedDockRestore;
    if (rCards && rCards.parent && cardsPanel.parentNode === main) {
      rCards.parent.insertBefore(cardsPanel, rCards.next);
    }
    cardsPanel.setAttribute("hidden", "");
    cardsPanel.setAttribute("aria-hidden", "true");
    var cardsBtn = document.getElementById("risque-host-cards-played-toggle");
    if (cardsBtn) cardsBtn.setAttribute("aria-checked", "false");
  }

  function risqueHostCloseCardsInHandPanelView(rh, main, handPanel, body) {
    if (!rh || !main || !handPanel) return;
    if (!rh.classList.contains("runtime-hud-root--host-panel-hand-focus")) return;
    rh.classList.remove("runtime-hud-root--host-panel-hand-focus");
    var brandH = document.getElementById("risque-host-hand-focus-brand");
    if (brandH && brandH.parentNode) {
      brandH.parentNode.removeChild(brandH);
    }
    var rH = window.__risqueHudHandDockRestore;
    if (rH && rH.parent && handPanel.parentNode === main) {
      rH.parent.insertBefore(handPanel, rH.next);
    }
    handPanel.setAttribute("hidden", "");
    handPanel.setAttribute("aria-hidden", "true");
    var handBtn = document.getElementById("risque-host-cards-in-hand-toggle");
    if (handBtn) handBtn.setAttribute("aria-checked", "false");
  }

  function risqueHostCloseStatsPanelView(rh, main, stats, body) {
    if (!rh || !main || !stats) return;
    if (!rh.classList.contains("runtime-hud-root--host-panel-stats-focus")) return;
    rh.classList.remove("runtime-hud-root--host-panel-stats-focus");
    var brandRm = document.getElementById("risque-host-stats-focus-brand");
    if (brandRm && brandRm.parentNode) {
      brandRm.parentNode.removeChild(brandRm);
    }
    var r = window.__risqueHudStatsDockRestore;
    if (r && r.parent && stats.parentNode === main) {
      r.parent.insertBefore(stats, r.next);
    }
    var stBtn = document.getElementById("risque-private-stats-toggle");
    if (stBtn) stBtn.setAttribute("aria-checked", "false");
  }

  function risqueAppendCommittedCardplayToGallery(gs, entries) {
    if (!gs || !Array.isArray(entries) || !entries.length) return;
    if (!Array.isArray(gs.risquePlayedCardsGallery)) gs.risquePlayedCardsGallery = [];
    var names = window.gameUtils && Array.isArray(window.gameUtils.cardNames) ? window.gameUtils.cardNames : null;
    entries.forEach(function (pc) {
      var cards = pc && pc.cards;
      if (!Array.isArray(cards)) return;
      cards.forEach(function (c) {
        var raw = c && (c.card != null ? c.card : c.name);
        var n = raw != null ? String(raw) : "";
        if (!n || !names || names.indexOf(n) === -1) return;
        gs.risquePlayedCardsGallery.push({ name: n });
      });
    });
    if (gs.risquePlayedCardsGallery.length > MAX_PLAYED_CARDS_GALLERY_ENTRIES) {
      gs.risquePlayedCardsGallery = gs.risquePlayedCardsGallery.slice(
        gs.risquePlayedCardsGallery.length - MAX_PLAYED_CARDS_GALLERY_ENTRIES
      );
    }
  }

  function risqueRenderHostCardsPlayedPanel(gs) {
    var el = document.getElementById("risque-host-cards-played-panel");
    if (!el) return;
    var list = gs && Array.isArray(gs.risquePlayedCardsGallery) ? gs.risquePlayedCardsGallery : [];
    var names = [];
    var i;
    for (i = 0; i < list.length; i++) {
      var name = list[i] && list[i].name != null ? String(list[i].name) : "";
      if (name) names.push(name);
    }
    var html;
    if (!names.length) {
      html =
        '<div class="risque-host-cards-played-scroll risque-host-cards-played-scroll--empty">' +
        '<p class="risque-host-cards-played-empty">No territory cards have been played in this game yet.</p>' +
        "</div>";
    } else {
      html = '<div class="risque-host-cards-played-scroll"><div class="risque-host-cards-played-grid">';
      for (i = 0; i < names.length; i++) {
        var cn = names[i];
        var alt = cn.replace(/_/g, " ");
        html +=
          '<img class="risque-host-cards-played-thumb" src="assets/images/Cards/' +
          String(cn || "").toUpperCase() +
          '.webp" alt="' +
          alt +
          '" loading="lazy" />';
      }
      html += "</div></div>";
    }
    el.innerHTML = html;
  }

  function risqueRenderHostCardsInHandPanel(gs) {
    var el = document.getElementById("risque-host-cards-in-hand-panel");
    if (!el) return;
    var cp = gs && gs.currentPlayer ? String(gs.currentPlayer) : "";
    var player =
      gs &&
      gs.players &&
      gs.players.find(function (p) {
        return p && p.name === cp;
      });
    var cards = player && player.cards ? player.cards : [];
    var names = [];
    var i;
    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      var cn = typeof c === "string" ? c : c && c.name != null ? String(c.name) : "";
      if (cn) names.push(cn);
    }
    var html;
    if (!cp) {
      html =
        '<div class="risque-host-cards-played-scroll risque-host-cards-played-scroll--empty">' +
        '<p class="risque-host-cards-played-empty">No current player.</p>' +
        "</div>";
    } else if (!names.length) {
      html =
        '<div class="risque-host-cards-played-scroll risque-host-cards-played-scroll--empty">' +
        '<p class="risque-host-cards-played-empty">' +
        escapeHtmlLucky(cp) +
        " has no cards in hand.</p>" +
        "</div>";
    } else {
      html =
        '<p class="risque-host-hand-lead">' +
        escapeHtmlLucky(cp) +
        " — " +
        names.length +
        " card" +
        (names.length === 1 ? "" : "s") +
        " in hand</p>" +
        '<div class="risque-host-cards-played-scroll"><div class="risque-host-cards-played-grid">';
      for (i = 0; i < names.length; i++) {
        var cn2 = names[i];
        var alt = cn2.replace(/_/g, " ");
        html +=
          '<img class="risque-host-cards-played-thumb" src="assets/images/Cards/' +
          String(cn2 || "").toUpperCase() +
          '.webp" alt="' +
          escapeHtmlLucky(alt) +
          '" loading="lazy" />';
      }
      html += "</div></div>";
    }
    el.innerHTML = html;
  }

  window.risqueAppendCommittedCardplayToGallery = risqueAppendCommittedCardplayToGallery;
  window.risqueRenderHostCardsPlayedPanel = risqueRenderHostCardsPlayedPanel;
  window.risqueRenderHostCardsInHandPanel = risqueRenderHostCardsInHandPanel;

  function ensureLuckyLedger(gs) {
    if (!gs || typeof gs !== "object") return;
    if (!gs.risqueLuckyLedger || typeof gs.risqueLuckyLedger !== "object") {
      gs.risqueLuckyLedger = { byPlayer: {} };
    }
    var by = gs.risqueLuckyLedger.byPlayer;
    if (typeof by !== "object" || by === null) {
      gs.risqueLuckyLedger.byPlayer = {};
      by = gs.risqueLuckyLedger.byPlayer;
    }
    (gs.players || []).forEach(function (p) {
      var n = p && p.name ? String(p.name) : "";
      if (!n) return;
      if (!by[n]) {
        by[n] = { dice: 0, sixes: 0, roundWins: 0, roundLosses: 0, roundTies: 0 };
      }
    });
    var roster = Array.isArray(gs.risqueLuckySessionRoster) ? gs.risqueLuckySessionRoster : [];
    roster.forEach(function (nm0) {
      var n = nm0 != null ? String(nm0) : "";
      if (!n) return;
      if (!by[n]) {
        by[n] = { dice: 0, sixes: 0, roundWins: 0, roundLosses: 0, roundTies: 0 };
      }
    });
  }

  function risqueRecordAttackRoundLedger(gs, snap) {
    if (!gs || !snap || window.risqueDisplayIsPublic) return;
    ensureLuckyLedger(gs);
    var atkName = snap.player && snap.player.name ? String(snap.player.name) : "";
    var defName = snap.opponent && snap.opponent.name ? String(snap.opponent.name) : "";
    if (!atkName || !defName) return;
    var L = gs.risqueLuckyLedger.byPlayer;
    if (!L[atkName]) {
      L[atkName] = { dice: 0, sixes: 0, roundWins: 0, roundLosses: 0, roundTies: 0 };
    }
    if (!L[defName]) {
      L[defName] = { dice: 0, sixes: 0, roundWins: 0, roundLosses: 0, roundTies: 0 };
    }
    var ar = snap.attackerRolls || [];
    var dr = snap.defenderRolls || [];
    var i;
    for (i = 0; i < ar.length; i++) {
      L[atkName].dice++;
      if (Number(ar[i]) === 6) L[atkName].sixes++;
    }
    for (i = 0; i < dr.length; i++) {
      L[defName].dice++;
      if (Number(dr[i]) === 6) L[defName].sixes++;
    }
    var al = Number(snap.attackerLosses) || 0;
    var dl = Number(snap.defenderLosses) || 0;
    if (dl > al) {
      L[atkName].roundWins++;
      L[defName].roundLosses++;
    } else if (al > dl) {
      L[defName].roundWins++;
      L[atkName].roundLosses++;
    } else {
      L[atkName].roundTies++;
      L[defName].roundTies++;
    }
  }

  function escapeHtmlLucky(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function risqueRenderHostLuckyPanel(gs) {
    var el = document.getElementById("risque-host-lucky-panel");
    if (!el) return;
    ensureLuckyLedger(gs);
    var by = (gs && gs.risqueLuckyLedger && gs.risqueLuckyLedger.byPlayer) || {};
    /* Session roster lists everyone who started; turnOrder/players shrink post-elimination/postgame. */
    var order = [];
    var seen = {};
    var ai;
    function pushLuckyOrder(nm) {
      if (!nm || seen[nm]) return;
      seen[nm] = true;
      order.push(nm);
      if (!by[nm]) {
        by[nm] = { dice: 0, sixes: 0, roundWins: 0, roundLosses: 0, roundTies: 0 };
      }
    }
    var roster = gs && Array.isArray(gs.risqueLuckySessionRoster) ? gs.risqueLuckySessionRoster : [];
    for (ai = 0; ai < roster.length; ai++) {
      var rn = roster[ai];
      if (rn) pushLuckyOrder(String(rn));
    }
    var keys = Object.keys(by);
    for (ai = 0; ai < keys.length; ai++) {
      pushLuckyOrder(keys[ai]);
    }
    if (gs && Array.isArray(gs.turnOrder)) {
      for (ai = 0; ai < gs.turnOrder.length; ai++) {
        pushLuckyOrder(gs.turnOrder[ai]);
      }
    }
    if (gs && Array.isArray(gs.players)) {
      for (ai = 0; ai < gs.players.length; ai++) {
        pushLuckyOrder(gs.players[ai] && gs.players[ai].name);
      }
    }
    var sortable = [];
    var j;
    for (j = 0; j < order.length; j++) {
      var pname0 = order[j];
      var row0 = by[pname0] || { dice: 0, sixes: 0, roundWins: 0, roundLosses: 0, roundTies: 0 };
      var d0 = Number(row0.dice) || 0;
      var s0 = Number(row0.sixes) || 0;
      var w0 = Number(row0.roundWins) || 0;
      var l0 = Number(row0.roundLosses) || 0;
      var dec0 = w0 + l0;
      var sixRate0 = d0 > 0 ? s0 / d0 : -1;
      var winRate0 = dec0 > 0 ? w0 / dec0 : -1;
      sortable.push({ pname: pname0, row: row0, sixRate: sixRate0, winRate: winRate0 });
    }
    sortable.sort(function (a, b) {
      if (b.sixRate !== a.sixRate) return b.sixRate - a.sixRate;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      return String(a.pname).localeCompare(String(b.pname));
    });
    var postgameBlock = "";
    var isPostgame = gs && String(gs.phase || "") === "postgame";
    if (isPostgame && sortable.length >= 1) {
      var maxSixesVal = -1;
      var maxSixesNames = [];
      var maxWinsVal = -1;
      var maxWinsNames = [];
      var jh;
      for (jh = 0; jh < sortable.length; jh++) {
        var rH = sortable[jh].row;
        var sH = Number(rH.sixes) || 0;
        var wH = Number(rH.roundWins) || 0;
        var pH = sortable[jh].pname;
        if (sH > maxSixesVal) {
          maxSixesVal = sH;
          maxSixesNames = [pH];
        } else if (sH === maxSixesVal && sH > 0) {
          maxSixesNames.push(pH);
        }
        if (wH > maxWinsVal) {
          maxWinsVal = wH;
          maxWinsNames = [pH];
        } else if (wH === maxWinsVal) {
          maxWinsNames.push(pH);
        }
      }
      var pgParts = [];
      pgParts.push(
        '<p class="risque-host-lucky-postgame-title">Game over — luck summary</p>'
      );
      if (maxSixesVal > 0 && maxSixesNames.length) {
        pgParts.push(
          '<p class="risque-host-lucky-postgame-line">Most <strong>sixes</strong> (total): ' +
            maxSixesNames
              .map(function (n) {
                return "<strong>" + escapeHtmlLucky(n) + "</strong>";
              })
              .join(", ") +
            " — " +
            maxSixesVal +
            "</p>"
        );
      }
      if (maxWinsVal >= 0 && maxWinsNames.length) {
        pgParts.push(
          '<p class="risque-host-lucky-postgame-line">Most <strong>wins</strong> (rounds): ' +
            maxWinsNames
              .map(function (n) {
                return "<strong>" + escapeHtmlLucky(n) + "</strong>";
              })
              .join(", ") +
            " — " +
            maxWinsVal +
            "</p>"
        );
      }
      if (pgParts.length > 1) {
        postgameBlock =
          '<div class="risque-host-lucky-postgame" role="status">' + pgParts.join("") + "</div>";
      }
    }
    var maxSixes = -1;
    var maxWins = -1;
    var mostSixesNames = [];
    var mostWinsNames = [];
    for (j = 0; j < sortable.length; j++) {
      var pnm = sortable[j].pname;
      var r0 = sortable[j].row || {};
      var sixTotal = Number(r0.sixes) || 0;
      var winTotal = Number(r0.roundWins) || 0;
      if (sixTotal > maxSixes) {
        maxSixes = sixTotal;
        mostSixesNames = [pnm];
      } else if (sixTotal === maxSixes) {
        mostSixesNames.push(pnm);
      }
      if (winTotal > maxWins) {
        maxWins = winTotal;
        mostWinsNames = [pnm];
      } else if (winTotal === maxWins) {
        mostWinsNames.push(pnm);
      }
    }
    var mostSixesLine = mostSixesNames.length
      ? mostSixesNames.map(function (n) { return "<strong>" + escapeHtmlLucky(n) + "</strong>"; }).join(", ")
      : "—";
    var mostWinsLine = mostWinsNames.length
      ? mostWinsNames.map(function (n) { return "<strong>" + escapeHtmlLucky(n) + "</strong>"; }).join(", ")
      : "—";
    var rowsHtml = "";
    for (j = 0; j < sortable.length; j++) {
      var ent = sortable[j];
      var rr = ent.row || {};
      var d = Number(rr.dice) || 0;
      var s = Number(rr.sixes) || 0;
      var w = Number(rr.roundWins) || 0;
      var l = Number(rr.roundLosses) || 0;
      var t = Number(rr.roundTies) || 0;
      var expectedSixes = d / 6;
      var decisions = w + l;
      var winRatePct = decisions > 0 ? (w / decisions) * 100 : 0;
      rowsHtml +=
        "<tr>" +
        "<td>" + escapeHtmlLucky(ent.pname) + "</td>" +
        "<td>" + String(s) + "</td>" +
        "<td>" + expectedSixes.toFixed(2) + "</td>" +
        "<td>" + String(w) + "-" + String(l) + "-" + String(t) + "</td>" +
        "<td>" + (decisions > 0 ? winRatePct.toFixed(1) + "%" : "—") + "</td>" +
        "</tr>";
    }
    el.innerHTML =
      '<div class="risque-host-lucky-inner hud-stats-inner">' +
      '<p class="risque-host-lucky-lead">Attack dice only. Includes all players from session start (even eliminated).</p>' +
      '<p class="risque-host-lucky-postgame-line">Most <strong>sixes</strong>: ' + mostSixesLine + " — " + (maxSixes > -1 ? String(maxSixes) : "0") + "</p>" +
      '<p class="risque-host-lucky-postgame-line">Most <strong>wins</strong>: ' + mostWinsLine + " — " + (maxWins > -1 ? String(maxWins) : "0") + "</p>" +
      '<table class="hud-stats-table risque-host-lucky-table" aria-label="Lucky results by player">' +
      "<thead><tr><th>Player</th><th>6s</th><th>Avg 6s</th><th>W-L-T</th><th>Avg Wins</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody>" +
      "</table>" +
      postgameBlock +
      "</div>";
  }

  window.risqueRecordAttackRoundLedger = risqueRecordAttackRoundLedger;
  window.risqueRenderHostLuckyPanel = risqueRenderHostLuckyPanel;

  function wireHostPrivateStatsToggleOnce() {
    if (window.risqueDisplayIsPublic || window.__risqueHostStatsToggleWired) return;
    window.__risqueHostStatsToggleWired = true;
    document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var btn = t.closest("#risque-private-stats-toggle");
        if (!btn) return;
        var rh = document.getElementById("runtime-hud-root");
        var main = document.getElementById("hud-main-panel");
        var stats = document.getElementById("hud-stats-panel");
        var body = document.getElementById("risque-main-panel-body");
        var cardsPanel = document.getElementById("risque-host-cards-played-panel");
        var luckyPanel = document.getElementById("risque-host-lucky-panel");
        var handPanel = document.getElementById("risque-host-cards-in-hand-panel");
        if (!rh || !main || !stats || !body) return;
        var turningOn = !rh.classList.contains("runtime-hud-root--host-panel-stats-focus");
        if (turningOn) {
          if (luckyPanel) {
            risqueHostCloseLuckyPanelView(rh, main, luckyPanel);
          }
          if (cardsPanel) {
            risqueHostCloseCardsPlayedPanelView(rh, main, cardsPanel, body);
          }
          if (handPanel) {
            risqueHostCloseCardsInHandPanelView(rh, main, handPanel, body);
          }
          if (!window.__risqueHudStatsDockRestore) {
            window.__risqueHudStatsDockRestore = {
              parent: stats.parentNode,
              next: stats.nextSibling
            };
          }
          var brandEl = document.getElementById("risque-host-stats-focus-brand");
          if (!brandEl) {
            brandEl = document.createElement("div");
            brandEl.id = "risque-host-stats-focus-brand";
            brandEl.className = "risque-host-stats-focus-brand";
            brandEl.textContent = "RISQUE";
          }
          main.insertBefore(stats, body);
          main.insertBefore(brandEl, stats);
          rh.classList.add("runtime-hud-root--host-panel-stats-focus");
          btn.setAttribute("aria-checked", "true");
        } else {
          risqueHostCloseStatsPanelView(rh, main, stats, body);
          btn.setAttribute("aria-checked", "false");
        }
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
          requestAnimationFrame(function () {
            try {
              window.risqueRuntimeHud.syncPosition();
            } catch (eSync) {
              /* ignore */
            }
          });
        }
      },
      true
    );
  }

  function wireHostPrivateCardsPlayedToggleOnce() {
    if (window.risqueDisplayIsPublic || window.__risqueHostCardsPlayedToggleWired) return;
    window.__risqueHostCardsPlayedToggleWired = true;
    document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var btn = t.closest("#risque-host-cards-played-toggle");
        if (!btn) return;
        var rh = document.getElementById("runtime-hud-root");
        var main = document.getElementById("hud-main-panel");
        var stats = document.getElementById("hud-stats-panel");
        var body = document.getElementById("risque-main-panel-body");
        var cardsPanel = document.getElementById("risque-host-cards-played-panel");
        var luckyPanel = document.getElementById("risque-host-lucky-panel");
        var handPanel = document.getElementById("risque-host-cards-in-hand-panel");
        if (!rh || !main || !cardsPanel || !body) return;
        var turningOn = !rh.classList.contains("runtime-hud-root--host-panel-cards-focus");
        if (turningOn) {
          if (luckyPanel) {
            risqueHostCloseLuckyPanelView(rh, main, luckyPanel);
          }
          if (stats) {
            risqueHostCloseStatsPanelView(rh, main, stats, body);
          }
          if (handPanel) {
            risqueHostCloseCardsInHandPanelView(rh, main, handPanel, body);
          }
          if (!window.__risqueHudCardsPlayedDockRestore) {
            window.__risqueHudCardsPlayedDockRestore = {
              parent: cardsPanel.parentNode,
              next: cardsPanel.nextSibling
            };
          }
          var brandEl = document.getElementById("risque-host-cards-focus-brand");
          if (!brandEl) {
            brandEl = document.createElement("div");
            brandEl.id = "risque-host-cards-focus-brand";
            brandEl.className = "risque-host-stats-focus-brand";
            brandEl.textContent = "RISQUE";
          }
          main.insertBefore(cardsPanel, body);
          main.insertBefore(brandEl, cardsPanel);
          rh.classList.add("runtime-hud-root--host-panel-cards-focus");
          cardsPanel.removeAttribute("hidden");
          cardsPanel.setAttribute("aria-hidden", "false");
          btn.setAttribute("aria-checked", "true");
          risqueRenderHostCardsPlayedPanel(window.gameState);
        } else {
          risqueHostCloseCardsPlayedPanelView(rh, main, cardsPanel, body);
          btn.setAttribute("aria-checked", "false");
        }
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
          requestAnimationFrame(function () {
            try {
              window.risqueRuntimeHud.syncPosition();
            } catch (eSync2) {
              /* ignore */
            }
          });
        }
      },
      true
    );
  }

  function wireHostPrivateLuckyToggleOnce() {
    if (window.risqueDisplayIsPublic || window.__risqueHostLuckyToggleWired) return;
    window.__risqueHostLuckyToggleWired = true;
    document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var btn = t.closest("#risque-host-lucky-toggle");
        if (!btn) return;
        var rh = document.getElementById("runtime-hud-root");
        var main = document.getElementById("hud-main-panel");
        var stats = document.getElementById("hud-stats-panel");
        var body = document.getElementById("risque-main-panel-body");
        var cardsPanel = document.getElementById("risque-host-cards-played-panel");
        var luckyPanel = document.getElementById("risque-host-lucky-panel");
        var handPanel = document.getElementById("risque-host-cards-in-hand-panel");
        if (!rh || !main || !luckyPanel || !body) return;
        var turningOn = !rh.classList.contains("runtime-hud-root--host-panel-lucky-focus");
        if (turningOn) {
          if (stats) {
            risqueHostCloseStatsPanelView(rh, main, stats, body);
          }
          if (cardsPanel) {
            risqueHostCloseCardsPlayedPanelView(rh, main, cardsPanel, body);
          }
          if (handPanel) {
            risqueHostCloseCardsInHandPanelView(rh, main, handPanel, body);
          }
          if (!window.__risqueHudLuckyDockRestore) {
            window.__risqueHudLuckyDockRestore = {
              parent: luckyPanel.parentNode,
              next: luckyPanel.nextSibling
            };
          }
          var brandEl = document.getElementById("risque-host-lucky-focus-brand");
          if (!brandEl) {
            brandEl = document.createElement("div");
            brandEl.id = "risque-host-lucky-focus-brand";
            brandEl.className = "risque-host-stats-focus-brand";
            brandEl.textContent = "RISQUE";
          }
          main.insertBefore(luckyPanel, body);
          main.insertBefore(brandEl, luckyPanel);
          rh.classList.add("runtime-hud-root--host-panel-lucky-focus");
          luckyPanel.removeAttribute("hidden");
          luckyPanel.setAttribute("aria-hidden", "false");
          btn.setAttribute("aria-checked", "true");
          risqueRenderHostLuckyPanel(window.gameState);
        } else {
          risqueHostCloseLuckyPanelView(rh, main, luckyPanel);
          btn.setAttribute("aria-checked", "false");
        }
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
          requestAnimationFrame(function () {
            try {
              window.risqueRuntimeHud.syncPosition();
            } catch (eLk) {
              /* ignore */
            }
          });
        }
      },
      true
    );
  }

  function wireHostPrivateCardsInHandToggleOnce() {
    if (window.risqueDisplayIsPublic || window.__risqueHostCardsInHandToggleWired) return;
    window.__risqueHostCardsInHandToggleWired = true;
    document.addEventListener(
      "click",
      function (ev) {
        var t = ev.target;
        if (!t || !t.closest) return;
        var btn = t.closest("#risque-host-cards-in-hand-toggle");
        if (!btn) return;
        var rh = document.getElementById("runtime-hud-root");
        var main = document.getElementById("hud-main-panel");
        var stats = document.getElementById("hud-stats-panel");
        var body = document.getElementById("risque-main-panel-body");
        var cardsPanel = document.getElementById("risque-host-cards-played-panel");
        var luckyPanel = document.getElementById("risque-host-lucky-panel");
        var handPanel = document.getElementById("risque-host-cards-in-hand-panel");
        if (!rh || !main || !handPanel || !body) return;
        var turningOn = !rh.classList.contains("runtime-hud-root--host-panel-hand-focus");
        if (turningOn) {
          if (stats) {
            risqueHostCloseStatsPanelView(rh, main, stats, body);
          }
          if (cardsPanel) {
            risqueHostCloseCardsPlayedPanelView(rh, main, cardsPanel, body);
          }
          if (luckyPanel) {
            risqueHostCloseLuckyPanelView(rh, main, luckyPanel);
          }
          if (!window.__risqueHudHandDockRestore) {
            window.__risqueHudHandDockRestore = {
              parent: handPanel.parentNode,
              next: handPanel.nextSibling
            };
          }
          var brandEl = document.getElementById("risque-host-hand-focus-brand");
          if (!brandEl) {
            brandEl = document.createElement("div");
            brandEl.id = "risque-host-hand-focus-brand";
            brandEl.className = "risque-host-stats-focus-brand";
            brandEl.textContent = "RISQUE";
          }
          main.insertBefore(handPanel, body);
          main.insertBefore(brandEl, handPanel);
          rh.classList.add("runtime-hud-root--host-panel-hand-focus");
          handPanel.removeAttribute("hidden");
          handPanel.setAttribute("aria-hidden", "false");
          btn.setAttribute("aria-checked", "true");
          risqueRenderHostCardsInHandPanel(window.gameState);
        } else {
          risqueHostCloseCardsInHandPanelView(rh, main, handPanel, body);
          btn.setAttribute("aria-checked", "false");
        }
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
          requestAnimationFrame(function () {
            try {
              window.risqueRuntimeHud.syncPosition();
            } catch (eHand) {
              /* ignore */
            }
          });
        }
      },
      true
    );
  }

  function risquePublicApplyDiceAndBattleReadout(gs) {
    var m = gs && gs.risqueLastDiceDisplay;
    var i;
    if (m && m.spinning === true && m.attackerDiceUsed != null) {
      var aus = Number(m.attackerDiceUsed) || 0;
      var dcs = Number(m.defenderDiceCount) || 0;
      for (i = 0; i < 3; i += 1) {
        var ts = document.getElementById("attacker-dice-text-" + i);
        var bs = document.getElementById("attacker-dice-" + i);
        if (ts) {
          ts.classList.remove("dice-text-visible");
          if (i < aus) {
            ts.classList.add("dice-text-hidden");
            ts.textContent = "";
          } else {
            ts.classList.remove("dice-text-hidden");
            ts.textContent = "-";
          }
        }
        if (bs) {
          bs.classList.remove("dice-rolling");
          if (i < aus) bs.classList.add("dice-rolling");
        }
      }
      for (i = 0; i < 2; i += 1) {
        var t2s = document.getElementById("defender-dice-text-" + i);
        var b2s = document.getElementById("defender-dice-" + i);
        if (t2s) {
          t2s.classList.remove("dice-text-visible");
          if (i < dcs) {
            t2s.classList.add("dice-text-hidden");
            t2s.textContent = "";
          } else {
            t2s.classList.remove("dice-text-hidden");
            t2s.textContent = "-";
          }
        }
        if (b2s) {
          b2s.classList.remove("dice-rolling");
          if (i < dcs) b2s.classList.add("dice-rolling");
        }
      }
    } else if (m && m.attackerDiceUsed != null) {
      var ar = m.attackerRolls || [];
      var dr = m.defenderRolls || [];
      var au = Number(m.attackerDiceUsed) || 0;
      var dc = Number(m.defenderDiceCount) || 0;
      for (i = 0; i < 3; i += 1) {
        var t = document.getElementById("attacker-dice-text-" + i);
        var box = document.getElementById("attacker-dice-" + i);
        if (t) {
          t.classList.remove("dice-text-hidden", "dice-text-visible");
          if (i < au) {
            t.classList.add("dice-text-visible");
            t.textContent = ar[i] != null && ar[i] !== "" ? String(ar[i]) : "—";
          } else {
            t.textContent = "-";
          }
        }
        if (box) box.classList.remove("dice-rolling");
      }
      for (i = 0; i < 2; i += 1) {
        var t2 = document.getElementById("defender-dice-text-" + i);
        var box2 = document.getElementById("defender-dice-" + i);
        if (t2) {
          t2.classList.remove("dice-text-hidden", "dice-text-visible");
          if (i < dc) {
            t2.classList.add("dice-text-visible");
            t2.textContent = dr[i] != null && dr[i] !== "" ? String(dr[i]) : "—";
          } else {
            t2.textContent = "-";
          }
        }
        if (box2) box2.classList.remove("dice-rolling");
      }
    } else {
      for (i = 0; i < 3; i += 1) {
        var ta = document.getElementById("attacker-dice-text-" + i);
        var ba = document.getElementById("attacker-dice-" + i);
        if (ta) {
          ta.classList.remove("dice-text-hidden", "dice-text-visible");
          ta.textContent = "-";
        }
        if (ba) ba.classList.remove("dice-rolling");
      }
      for (i = 0; i < 2; i += 1) {
        var td = document.getElementById("defender-dice-text-" + i);
        var bd = document.getElementById("defender-dice-" + i);
        if (td) {
          td.classList.remove("dice-text-hidden", "dice-text-visible");
          td.textContent = "-";
        }
        if (bd) bd.classList.remove("dice-rolling");
      }
    }
    var br = gs && gs.risqueBattleHudReadout;
    var apn = document.getElementById("attacker-panel-name");
    var dpn = document.getElementById("defender-panel-name");
    if (br && apn && dpn && window.gameUtils && window.gameUtils.colorMap) {
      apn.textContent = String(br.attackerOwner || "").toUpperCase();
      dpn.textContent = String(br.defenderOwner || "").toUpperCase();
      var pa = gs.players && gs.players.find(function (x) { return x.name === br.attackerOwner; });
      var pd = gs.players && gs.players.find(function (x) { return x.name === br.defenderOwner; });
      apn.style.color = pa ? window.gameUtils.colorMap[pa.color] || "#ffffff" : "#ffffff";
      dpn.style.color = pd ? window.gameUtils.colorMap[pd.color] || "#ffffff" : "#ffffff";
    } else if (apn && dpn) {
      apn.textContent = "—";
      dpn.textContent = "—";
      apn.style.color = "#64748b";
      dpn.style.color = "#64748b";
    }
  }

  function risquePublicSanitizeCardImageId(raw) {
    var s = String(raw || "")
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "");
    if (!s) return null;
    if (CARD_NAMES.indexOf(s) !== -1) return s;
    return null;
  }

  window.risqueSanitizeCardImageId = risquePublicSanitizeCardImageId;

  function risqueIsPublicBookMapTerritory(name) {
    var n = String(name || "").toLowerCase();
    return n && n !== "wildcard1" && n !== "wildcard2";
  }

  function risqueTroopSnapshotForPublicBook(gs) {
    var m = {};
    if (!gs || !gs.players) return m;
    gs.players.forEach(function (p) {
      (p.territories || []).forEach(function (t) {
        if (t && t.name) m[t.name] = { owner: p.name, troops: Number(t.troops) || 0 };
      });
    });
    return m;
  }

  function risquePublicCloneTroopMap(map) {
    var out = {};
    if (!map) return out;
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      if (v && v.owner != null) {
        out[k] = { owner: String(v.owner), troops: Number(v.troops) || 0 };
      }
    });
    return out;
  }

  /** Rebuild players[].territories from a label → { owner, troops } map (for public recap rendering only). */
  function risquePublicGameStateWithTroopMap(sourceGs, troopMap) {
    var out = JSON.parse(JSON.stringify(sourceGs));
    if (!out.players || !troopMap) return out;
    out.players.forEach(function (p) {
      p.territories = [];
    });
    Object.keys(troopMap).forEach(function (label) {
      var info = troopMap[label];
      if (!info || info.owner == null || info.owner === "") return;
      var pl = out.players.find(function (x) {
        return x.name === info.owner;
      });
      if (!pl) return;
      pl.territories.push({ name: label, troops: Number(info.troops) || 0 });
    });
    return out;
  }

  function risquePublicApplyStepForwardToTroopMap(map, step, actingPlayerName) {
    if (!map || !step) return;
    var mapT = step.mapTerritory;
    var eff = step.effect;
    if (eff === "aerial_attack") return;
    if (!mapT) return;
    if (eff === "acquire") {
      map[mapT] = { owner: String(actingPlayerName || ""), troops: Number(step.troopsTo) || 0 };
      return;
    }
    if (!map[mapT]) return;
    if (eff === "add_troops" || eff === "remove_troops") {
      map[mapT] = { owner: map[mapT].owner, troops: Number(step.troopsTo) || 0 };
      return;
    }
    if (eff === "declined" || eff === "no_effect") {
      map[mapT] = { owner: map[mapT].owner, troops: Number(step.troopsTo) || map[mapT].troops };
    }
  }

  function risquePublicRenderMapForBook(gs) {
    if (!window.gameUtils || !gs) return;
    if (
      !_pubBook.displayTroopMap ||
      (_pubBook.phase !== "summary" && _pubBook.phase !== "step")
    ) {
      window.gameUtils.renderTerritories(null, gs);
      return;
    }
    var mg = risquePublicGameStateWithTroopMap(gs, _pubBook.displayTroopMap);
    if (Array.isArray(gs.risquePublicCardplayHighlightLabels)) {
      mg.risquePublicCardplayHighlightLabels = gs.risquePublicCardplayHighlightLabels.slice();
    } else {
      delete mg.risquePublicCardplayHighlightLabels;
    }
    if (Array.isArray(gs.risquePublicCampaignWarpathLabels)) {
      mg.risquePublicCampaignWarpathLabels = gs.risquePublicCampaignWarpathLabels.slice();
    } else {
      delete mg.risquePublicCampaignWarpathLabels;
    }
    window.gameUtils.renderTerritories(null, mg);
  }

  function risqueTerritoryVoiceUpperForPublicBook(name) {
    if (window.gameUtils && typeof window.gameUtils.formatTerritoryDisplayName === "function") {
      return String(window.gameUtils.formatTerritoryDisplayName(name || "")).toUpperCase();
    }
    return String(name || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
  }

  function risquePrettyCardplayVoiceToken(tid) {
    var s = String(tid || "").toLowerCase();
    if (s === "wildcard1" || s === "wildcard2") {
      return s === "wildcard1" ? "WILDCARD 1" : "WILDCARD 2";
    }
    return risqueTerritoryVoiceUpperForPublicBook(tid);
  }

  /**
   * Build ordered steps for public TV cardplay (reverse-walk effects from final board for troop from/to).
   * Same shape as runtime con-cardplay phase buildPublicBookProcessingPayload; supports aerial_attack voice-only steps.
   */
  window.risqueBuildPublicBookProcessingPayload = function (bookAction, playerName, gs) {
    if (!bookAction || bookAction.action !== "book" || !gs) return null;
    var TN = String(playerName || gs.currentPlayer || "Player").toUpperCase();
    var effects = bookAction.effects || [];
    var m = risqueTroopSnapshotForPublicBook(gs);
    var steps = [];
    var i;
    for (i = effects.length - 1; i >= 0; i--) {
      var e = effects[i];
      var tid = e.territory;
      var mapTid = risqueIsPublicBookMapTerritory(tid) ? tid : null;
      var step = {
        effect: e.action,
        mapTerritory: mapTid,
        /** Original effect territory (e.g. wildcard id) when not a map label — for public prose. */
        rawTerritoryToken: tid != null ? tid : null,
        voice: "",
        troopsFrom: 0,
        troopsTo: 0,
        animateTroops: false,
        playedCardKey:
          e.card != null && typeof risquePublicSanitizeCardImageId === "function"
            ? risquePublicSanitizeCardImageId(e.card)
            : null
      };
      if (e.action === "aerial_attack") {
        step.mapTerritory = null;
        step.voice = TN + " — WILDCARD: AERIAL ATTACK";
        step.animateTroops = false;
        steps.unshift(step);
        continue;
      }
      if (e.action === "add_troops") {
        if (!mapTid || !m[mapTid]) continue;
        var toAdd = m[mapTid].troops;
        m[mapTid].troops = Math.max(0, toAdd - 2);
        var fromAdd = m[mapTid].troops;
        step.troopsFrom = fromAdd;
        step.troopsTo = toAdd;
        step.animateTroops = fromAdd !== toAdd;
        step.voice = TN + " ADDS 2 TROOPS TO " + risqueTerritoryVoiceUpperForPublicBook(mapTid);
      } else if (e.action === "remove_troops") {
        if (!mapTid || !m[mapTid]) continue;
        var toRm = m[mapTid].troops;
        m[mapTid].troops = toRm + 2;
        var fromRm = m[mapTid].troops;
        step.troopsFrom = fromRm;
        step.troopsTo = toRm;
        step.animateTroops = fromRm !== toRm;
        step.voice = TN + " REMOVES 2 TROOPS FROM " + risqueTerritoryVoiceUpperForPublicBook(mapTid);
      } else if (e.action === "acquire") {
        if (!mapTid || !m[mapTid]) continue;
        var toAcq = m[mapTid].troops;
        var defTroops = Number(e.troops) || 1;
        m[mapTid] = { owner: e.owner, troops: defTroops };
        step.troopsFrom = defTroops;
        step.troopsTo = toAcq;
        step.animateTroops = defTroops !== toAcq;
        step.voice = TN + " ACQUIRED " + risqueTerritoryVoiceUpperForPublicBook(mapTid);
      } else if (e.action === "declined") {
        var labD = mapTid
          ? risqueTerritoryVoiceUpperForPublicBook(mapTid)
          : risquePrettyCardplayVoiceToken(tid);
        step.voice = TN + " DECLINED TO PROCESS " + labD;
        if (mapTid && m[mapTid]) {
          var td = m[mapTid].troops;
          step.troopsFrom = step.troopsTo = td;
        }
      } else if (e.action === "no_effect") {
        var labN = mapTid
          ? risqueTerritoryVoiceUpperForPublicBook(mapTid)
          : risquePrettyCardplayVoiceToken(tid);
        step.voice = TN + " — NO EFFECT FOR " + labN;
        if (mapTid && m[mapTid]) {
          var tn0 = m[mapTid].troops;
          step.troopsFrom = step.troopsTo = tn0;
        }
      } else {
        continue;
      }
      steps.unshift(step);
    }
    if (!steps.length) return null;
    var territoryBaseline = {};
    Object.keys(m).forEach(function (k) {
      territoryBaseline[k] = { owner: m[k].owner, troops: m[k].troops };
    });
    return {
      seq: Date.now(),
      playerName: String(playerName || gs.currentPlayer || "Player"),
      steps: steps,
      territoryBaseline: territoryBaseline
    };
  };

  /**
   * One book-style effect unwound from final board (mutates m); pushes one step to steps (unshift order).
   * Mirrors the inner loop of risqueBuildPublicBookProcessingPayload.
   */
  function risqueUnwindPublicBookEffectIntoSteps(steps, m, e, TN, recapMeta) {
    if (!e || !e.action || !steps || !m) return;
    var tid = e.territory;
    var mapTid = risqueIsPublicBookMapTerritory(tid) ? tid : null;
    var step = {
      effect: e.action,
      mapTerritory: mapTid,
      rawTerritoryToken: tid != null ? tid : null,
      voice: "",
      troopsFrom: 0,
      troopsTo: 0,
      animateTroops: false,
      playedCardKey:
        e.card != null && typeof risquePublicSanitizeCardImageId === "function"
          ? risquePublicSanitizeCardImageId(e.card)
          : null
    };
    if (recapMeta && typeof recapMeta === "object") {
      var rk;
      for (rk in recapMeta) {
        if (Object.prototype.hasOwnProperty.call(recapMeta, rk)) {
          step[rk] = recapMeta[rk];
        }
      }
    }
    if (e.action === "aerial_attack") {
      step.mapTerritory = null;
      step.voice = TN + " — WILDCARD: AERIAL ATTACK";
      step.animateTroops = false;
      steps.unshift(step);
      return;
    }
    if (e.action === "add_troops") {
      if (!mapTid || !m[mapTid]) return;
      var toAdd = m[mapTid].troops;
      m[mapTid].troops = Math.max(0, toAdd - 2);
      var fromAdd = m[mapTid].troops;
      step.troopsFrom = fromAdd;
      step.troopsTo = toAdd;
      step.animateTroops = fromAdd !== toAdd;
      step.voice = TN + " ADDS 2 TROOPS TO " + risqueTerritoryVoiceUpperForPublicBook(mapTid);
    } else if (e.action === "remove_troops") {
      if (!mapTid || !m[mapTid]) return;
      var toRm = m[mapTid].troops;
      m[mapTid].troops = toRm + 2;
      var fromRm = m[mapTid].troops;
      step.troopsFrom = fromRm;
      step.troopsTo = toRm;
      step.animateTroops = fromRm !== toRm;
      step.voice = TN + " REMOVES 2 TROOPS FROM " + risqueTerritoryVoiceUpperForPublicBook(mapTid);
    } else if (e.action === "acquire") {
      if (!mapTid || !m[mapTid]) return;
      var toAcq = m[mapTid].troops;
      var defTroops = Number(e.troops) || 1;
      m[mapTid] = { owner: e.owner, troops: defTroops };
      step.troopsFrom = defTroops;
      step.troopsTo = toAcq;
      step.animateTroops = defTroops !== toAcq;
      step.voice = TN + " ACQUIRED " + risqueTerritoryVoiceUpperForPublicBook(mapTid);
    } else if (e.action === "declined") {
      var labD = mapTid
        ? risqueTerritoryVoiceUpperForPublicBook(mapTid)
        : risquePrettyCardplayVoiceToken(tid);
      step.voice = TN + " DECLINED TO PROCESS " + labD;
      if (mapTid && m[mapTid]) {
        var td = m[mapTid].troops;
        step.troopsFrom = step.troopsTo = td;
      }
    } else if (e.action === "no_effect") {
      var labN = mapTid
        ? risqueTerritoryVoiceUpperForPublicBook(mapTid)
        : risquePrettyCardplayVoiceToken(tid);
      step.voice = TN + " — NO EFFECT FOR " + labN;
      if (mapTid && m[mapTid]) {
        var tn0 = m[mapTid].troops;
        step.troopsFrom = step.troopsTo = tn0;
      }
    } else {
      return;
    }
    steps.unshift(step);
  }

  /**
   * After host CONFIRM on runtime cardplay: TV animates the whole turn (books + singles) using the same
   * step engine as continental book processing. Caller sets gameState.risquePublicBookProcessing from this.
   */
  window.risqueBuildPublicCardplayRecapProcessingPayload = function (playedCards, gs) {
    if (!gs || !Array.isArray(playedCards) || playedCards.length === 0) return null;
    var TN = String(gs.currentPlayer || "Player").toUpperCase();
    var m = risqueTroopSnapshotForPublicBook(gs);
    var steps = [];
    var turnBookTotal = risquePublicRecapCountTurnBooks(playedCards);
    var pi;
    for (pi = playedCards.length - 1; pi >= 0; pi--) {
      var pc = playedCards[pi];
      if (!pc || !pc.cards || !pc.cards.length) continue;
      if (pc.action === "book") {
        var effects = pc.effects || [];
        var turnOrd = risquePublicRecapTurnBookOrdinalAtIndex(playedCards, pi);
        var ej;
        for (ej = effects.length - 1; ej >= 0; ej--) {
          var e = effects[ej];
          var effObj = {
            action: e.action,
            territory: e.territory,
            card: e && e.card != null ? e.card : pc.cards[ej] && pc.cards[ej].card,
            owner: e.owner,
            troops: e.troops
          };
          risqueUnwindPublicBookEffectIntoSteps(steps, m, effObj, TN, {
            recapInBook: true,
            recapBookOrdinal: ej + 1,
            recapBookTotal: effects.length,
            recapTurnBookOrdinal: turnOrd,
            recapTurnBookTotal: turnBookTotal
          });
        }
      } else if (pc.action === "aerial_attack") {
        risqueUnwindPublicBookEffectIntoSteps(
          steps,
          m,
          { action: "aerial_attack", territory: null, card: pc.cards[0] && pc.cards[0].card },
          TN,
          { recapInBook: false }
        );
      } else {
        risqueUnwindPublicBookEffectIntoSteps(
          steps,
          m,
          {
            action: pc.action,
            territory: pc.territory,
            card: pc.cards[0] && pc.cards[0].card,
            owner: pc.owner,
            troops: pc.troops
          },
          TN,
          { recapInBook: false }
        );
      }
    }
    if (!steps.length) return null;
    var territoryBaseline = {};
    Object.keys(m).forEach(function (k) {
      territoryBaseline[k] = { owner: m[k].owner, troops: m[k].troops };
    });
    return {
      seq: Date.now(),
      playerName: String(gs.currentPlayer || "Player"),
      steps: steps,
      territoryBaseline: territoryBaseline,
      recapAnimation: true
    };
  };

  /**
   * Public TV: committed cards render only in the control-voice prompt (not here), so we never duplicate
   * the strip under stats vs the voice panel.
   */
  function risquePublicSyncCardplayStrip(gs) {
    var strip = document.getElementById("hud-public-cardplay-strip");
    if (!strip || !window.risqueDisplayIsPublic) return;
    strip.innerHTML = "";
    strip.setAttribute("hidden", "");
  }

  /** Appends title + row of card images (public TV, con-cardplay book confirm). Returns true if any image shown. */
  function risquePublicAppendBookVoice(container, titleText, rawCardIds) {
    if (!container || !Array.isArray(rawCardIds)) return false;
    var ids = [];
    var ri;
    for (ri = 0; ri < rawCardIds.length; ri += 1) {
      var sid = risquePublicSanitizeCardImageId(rawCardIds[ri]);
      if (sid) ids.push(sid);
    }
    if (!ids.length) return false;
    var wrap = document.createElement("div");
    wrap.className = "risque-public-book-voice";
    var titleEl = document.createElement("div");
    titleEl.className = "risque-public-book-voice-title";
    titleEl.textContent = titleText != null ? String(titleText) : "";
    wrap.appendChild(titleEl);
    var row = document.createElement("div");
    row.className = "risque-public-book-voice-cards";
    var ii;
    for (ii = 0; ii < ids.length; ii += 1) {
      var img = document.createElement("img");
      img.className = "risque-public-book-voice-card-img risque-public-book-voice-card-img--intro";
      img.src = "assets/images/Cards/" + String(ids[ii] || "").toUpperCase() + ".webp";
      img.alt = "";
      img.setAttribute("loading", "lazy");
      row.appendChild(img);
    }
    var nIntro = Math.min(9, Math.max(1, ids.length));
    row.setAttribute("data-risque-card-count", String(nIntro));
    wrap.appendChild(row);
    container.appendChild(wrap);
    return true;
  }

  /** Host + public TV income: territory → books → indented continents → total (label | number). */
  function risquePublicBuildIncomeBreakdownDom(breakdown, gs) {
    var wrap = document.createElement("div");
    wrap.className = "risque-public-income-voice";

    var grid = document.createElement("div");
    grid.className = "risque-public-income-voice__grid";

    function addRow(labelText, valueText, extraClass) {
      var row = document.createElement("div");
      row.className = "risque-public-income-voice__row" + (extraClass ? " " + extraClass : "");
      var lab = document.createElement("span");
      lab.className = "risque-public-income-voice__label";
      lab.textContent = labelText;
      var val = document.createElement("span");
      val.className = "risque-public-income-voice__value";
      val.textContent = valueText;
      row.appendChild(lab);
      row.appendChild(val);
      grid.appendChild(row);
    }

    if (!breakdown.skipTerritoryRow) {
      var tc = breakdown.territoryCount != null ? Number(breakdown.territoryCount) : 0;
      var tb = breakdown.territoryBonus != null ? Number(breakdown.territoryBonus) : 0;
      addRow(
        tc + " territor" + (tc === 1 ? "y" : "ies") + " — bonus",
        String(tb),
        "risque-public-income-voice__row--territory"
      );
    }

    if (breakdown.showBook && (Number(breakdown.bookBonus) || 0) > 0) {
      var bc = breakdown.bookCount != null ? Number(breakdown.bookCount) : 0;
      addRow(
        bc + " book card" + (bc === 1 ? "" : "s") + " — bonus",
        String(Number(breakdown.bookBonus)),
        "risque-public-income-voice__row--book"
      );
    }

    var conts =
      breakdown.continentRows && Array.isArray(breakdown.continentRows) ? breakdown.continentRows : [];
    if (conts.length) {
      var sub = document.createElement("div");
      sub.className = "risque-public-income-voice__subhead risque-public-income-voice__subhead--continents";
      sub.textContent = breakdown.continentSubhead || "Continents held";
      grid.appendChild(sub);
      var ci;
      for (ci = 0; ci < conts.length; ci += 1) {
        var cr = conts[ci];
        var nm = cr && cr.name != null ? String(cr.name).toUpperCase() : "";
        var b = cr && cr.bonus != null ? Number(cr.bonus) : 0;
        addRow(nm, String(b), "risque-public-income-voice__row--continent");
      }
    }

    var tot = breakdown.total != null ? Number(breakdown.total) : 0;
    addRow("TOTAL INCOME", String(tot), "risque-public-income-voice__row--total");

    wrap.appendChild(grid);
    return wrap;
  }

  window.risqueBuildIncomeBreakdownDom = risquePublicBuildIncomeBreakdownDom;

  /**
   * Host/private laptop: paint the same income grid in #control-voice-text as the public TV (mirrored breakdown).
   * Call after income phase sets gameState.risquePublicIncomeBreakdown; safe to call again after refreshVisuals.
   */
  window.risqueHostApplyIncomeBreakdownVoice = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return;
    var ph = String(gs.phase || "");
    if (ph !== "income" && ph !== "con-income") return;
    if (!gs.risquePublicIncomeBreakdown || typeof gs.risquePublicIncomeBreakdown !== "object") return;
    var vt = document.getElementById("control-voice-text");
    var vr = document.getElementById("control-voice-report");
    if (!vt) return;
    try {
      vt.classList.add("ucp-voice-text--public-income-stack");
      vt.innerHTML = "";
      vt.appendChild(risquePublicBuildIncomeBreakdownDom(gs.risquePublicIncomeBreakdown, gs));
      if (vr) {
        vr.textContent = "";
        vr.style.display = "none";
        vr.className = "ucp-voice-report";
      }
    } catch (eHostInc) {
      /* ignore */
    }
  };

  /** Host control panel has attack slots / buttons; public TV does not — strip those hints from mirrored voice. */
  function risquePublicSanitizeControlVoicePrimary(primary) {
    if (primary == null) return "";
    var t = String(primary);
    t = t.replace(/\bRefer to the buttons above[^.!?]*[.!?]?/gi, " ");
    t = t.replace(/\bTap\s+CONFIRM\s+in\s+the\s+slot\s+row\s+below\.?/gi, " ");
    t = t.replace(/,?\s*then\s+confirm\s+below\.?/gi, " ");
    t = t.replace(/\bSelect territory to attack from\.?\s*/gi, " ");
    /* Do not collapse newlines — deploy/income use multi-line primary; /\s+/ was flattening TV to one line. */
    t = t
      .split("\n")
      .map(function (line) {
        return line.replace(/[ \t]+/g, " ").replace(/^\s+|\s+$/g, "");
      })
      .join("\n");
    return t.replace(/^\s+|\s+$/g, "");
  }

  /** Dedicated strip below combat log: large number + static “until condition is met” (host + public). */
  function risqueApplyConditionTally(gs) {
    var box = document.getElementById("risque-condition-tally");
    var numEl = document.getElementById("risque-condition-tally-num");
    if (!box || !numEl) return;
    var atk =
      gs &&
      !risqueGamePhaseIsContinentalConquestChain(gs.phase) &&
      (String(gs.phase || "") === "attack" || String(gs.attackPhase || "") === "pending_transfer");
    /* Prefer explicit TV mirror fields (always written into PUBLIC_MIRROR_KEY); fall back to host-only keys */
    var show =
      atk &&
      (gs.risquePublicConditionTallyShow === true || gs.risqueConditionTallyActive === true);
    var raw =
      gs.risquePublicConditionTallyNum != null ? gs.risquePublicConditionTallyNum : gs.risqueConditionTallyRemaining;
    if (!show || raw == null) {
      box.hidden = true;
      return;
    }
    var n = Number(raw);
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.floor(n));
    numEl.textContent = String(n);
    box.hidden = false;
  }

  function risquePublicApplyVoiceAndLogMirror(gs) {
    var cv = gs && gs.risqueControlVoice;
    var vt = document.getElementById("control-voice-text");
    var vr = document.getElementById("control-voice-report");
    var op =
      gs && gs.risqueAttackOutcomePrimary != null ? String(gs.risqueAttackOutcomePrimary).trim() : "";
    var od =
      gs && gs.risqueAttackOutcomeReport != null ? String(gs.risqueAttackOutcomeReport).trim() : "";
    var oa =
      gs && gs.risqueAttackOutcomeAcquisition != null
        ? String(gs.risqueAttackOutcomeAcquisition).trim()
        : "";
    var attackVoiceContext =
      gs &&
      !risqueGamePhaseIsContinentalConquestChain(gs.phase) &&
      (String(gs.phase || "") === "attack" || String(gs.attackPhase || "") === "pending_transfer");
    var useBattleReadout = op !== "" && od !== "" && attackVoiceContext;
    var elBan =
      gs && gs.risquePublicEliminationBanner != null
        ? String(gs.risquePublicEliminationBanner).trim()
        : "";
    var ctf =
      gs && gs.risquePublicConCardTransferPrimary != null
        ? String(gs.risquePublicConCardTransferPrimary).trim()
        : "";
    var ctr =
      gs && gs.risquePublicConCardTransferReport != null
        ? String(gs.risquePublicConCardTransferReport).trim()
        : "";
    var cpPhase =
      gs &&
      (String(gs.phase || "") === "cardplay" || String(gs.phase || "") === "con-cardplay");
    var cpPubRaw =
      gs && gs.risquePublicCardplayPrimary != null ? String(gs.risquePublicCardplayPrimary).trim() : "";
    var cpRepRaw =
      gs && gs.risquePublicCardplayReport != null ? String(gs.risquePublicCardplayReport).trim() : "";
    var cpPub = cpPhase && cpPubRaw ? cpPubRaw : "";
    var cpRep = cpPhase && cpRepRaw ? cpRepRaw : "";
    var cpBookCardsAll =
      gs && Array.isArray(gs.risquePublicCardplayBookCards) ? gs.risquePublicCardplayBookCards : [];
    /** True once host has pushed recap payload (even before risqueCardplayTvRecapPublished flips on the next line). */
    var hasCardplayTvRecapContent =
      gs &&
      gs.risquePublicCardplayRecap &&
      Array.isArray(gs.risquePublicCardplayRecap.lines) &&
      gs.risquePublicCardplayRecap.lines.length > 0;
    /** Public TV: host draft mirrors control voice — hide processing until recap exists or gate flag is set. */
    var cardplayTvAwaitingRecap =
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "cardplay" &&
      !gs.risqueCardplayTvRecapPublished &&
      !hasCardplayTvRecapContent;
    var pubBookPhase = window.risquePublicBookSequencePhase();
    var cvRootEarly = document.getElementById("control-voice");
    if (cvRootEarly && pubBookPhase !== "step") {
      cvRootEarly.classList.remove("ucp-control-voice--public-book-processing");
    }
    /**
     * Mirror phase is "income" while the TV runs the committed-cardplay recap — suppress mirrored "INCOME"
     * control voice until the book finishes (even if host already pushed income narrative).
     */
    var incomePhaseBookRecapActive = risqueIncomePhaseBookRecapActive(gs);
    var renderIncomeBreakdownGridPublic =
      window.risqueDisplayIsPublic &&
      gs &&
      risquePhaseIsIncomeVoiceMirror(gs.phase) &&
      gs.risquePublicIncomeBreakdown &&
      typeof gs.risquePublicIncomeBreakdown === "object" &&
      !incomePhaseBookRecapActive;
    var renderIncomeBreakdownGridHost =
      !window.risqueDisplayIsPublic &&
      gs &&
      risquePhaseIsIncomeVoiceMirror(gs.phase) &&
      gs.risquePublicIncomeBreakdown &&
      typeof gs.risquePublicIncomeBreakdown === "object" &&
      !incomePhaseBookRecapActive;
    var renderIncomeBreakdownGrid =
      renderIncomeBreakdownGridPublic || renderIncomeBreakdownGridHost;
    var useCpBookImages =
      !cardplayTvAwaitingRecap &&
      cpBookCardsAll.length > 0 &&
      pubBookPhase !== "step" &&
      pubBookPhase !== "done" &&
      (cpPhase || incomePhaseBookRecapActive);
    var atkXfer =
      gs &&
      String(gs.phase || "") === "attack" &&
      gs.risquePublicAttackTransferSummary != null
        ? String(gs.risquePublicAttackTransferSummary).trim()
        : "";
    var atkSel =
      gs &&
      String(gs.phase || "") === "attack" &&
      gs.risquePublicAttackSelectionLine != null
        ? String(gs.risquePublicAttackSelectionLine).trim()
        : "";
    var atkBlitzBanner =
      gs &&
      String(gs.phase || "") === "attack" &&
      gs.risquePublicBlitzBanner != null
        ? String(gs.risquePublicBlitzBanner).trim()
        : "";
    var atkBlitzBannerRep =
      gs && gs.risquePublicBlitzBannerReport != null
        ? String(gs.risquePublicBlitzBannerReport).trim()
        : "";
    var atkPhase = gs && String(gs.phase || "") === "attack";

    var psFlash = gs && gs.risquePublicPlayerSelectFlash;
    var playerSelectFlashActive =
      window.risqueDisplayIsPublic &&
      gs &&
      String(gs.phase || "") === "playerSelect" &&
      psFlash &&
      String(psFlash.name || "").trim() !== "";

    var basePrimary = "";
    var reportText = "";
    var reportClassName = "ucp-voice-report";
    var renderPlayerSelectFlash = false;

    if (playerSelectFlashActive) {
      var cvPs = gs.risqueControlVoice || {};
      basePrimary = risquePublicSanitizeControlVoicePrimary(cvPs.primary);
      if (!basePrimary && cvPs.primary != null) basePrimary = String(cvPs.primary);
      renderPlayerSelectFlash = true;
    } else if (
      window.risqueDisplayIsPublic &&
      gs &&
      gs.risquePublicNextPlayerHandoffPrimary != null &&
      String(gs.risquePublicNextPlayerHandoffPrimary).trim() !== ""
    ) {
      basePrimary = String(gs.risquePublicNextPlayerHandoffPrimary).trim();
      reportText =
        gs.risquePublicNextPlayerHandoffReport != null
          ? String(gs.risquePublicNextPlayerHandoffReport).trim()
          : "";
      reportClassName = "ucp-voice-report ucp-voice-report--public-next-player-handoff";
    } else if (
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "deploy" &&
      gs.risquePublicDeployBanner != null &&
      String(gs.risquePublicDeployBanner).trim() !== ""
    ) {
      basePrimary = String(gs.risquePublicDeployBanner).trim();
      reportText = cv && cv.report != null ? String(cv.report).trim() : "";
      reportClassName = "ucp-voice-report ucp-voice-report--public-deploy";
    } else if (ctf !== "") {
      basePrimary = ctf;
      reportText = ctr;
      reportClassName = "ucp-voice-report ucp-voice-report--public-card-transfer";
    } else if (cardplayTvAwaitingRecap) {
      basePrimary =
        gs && gs.currentPlayer
          ? String(gs.currentPlayer).toUpperCase() + " · CARD PLAY"
          : "CARD PLAY";
      reportText = "";
      reportClassName = "ucp-voice-report ucp-voice-report--public-cardplay";
    } else if (
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "cardplay" &&
      hasCardplayTvRecapContent
    ) {
      basePrimary =
        gs && gs.currentPlayer
          ? String(gs.currentPlayer).toUpperCase() + " · CARD PLAY"
          : "CARD PLAY";
      reportText = "";
      reportClassName = "ucp-voice-report ucp-voice-report--public-cardplay";
    } else if (cpPub !== "" || incomePhaseBookRecapActive) {
      if (pubBookPhase === "done") {
        basePrimary = "";
        reportText = "";
      } else {
        basePrimary =
          cpPubRaw ||
          (gs && gs.currentPlayer ? String(gs.currentPlayer).toUpperCase() + " · CARD PLAY" : "CARD PLAY");
        reportText = cpRepRaw;
      }
      reportClassName = "ucp-voice-report ucp-voice-report--public-cardplay";
    } else if (
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "attack" &&
      ((gs.risquePublicPausableBlitzPaused != null && String(gs.risquePublicPausableBlitzPaused).trim() !== "") ||
        (gs.risquePublicCampaignStepPaused != null && String(gs.risquePublicCampaignStepPaused).trim() !== ""))
    ) {
      basePrimary =
        gs.risquePublicPausableBlitzPaused != null && String(gs.risquePublicPausableBlitzPaused).trim() !== ""
          ? String(gs.risquePublicPausableBlitzPaused).trim()
          : String(gs.risquePublicCampaignStepPaused).trim();
      reportText = "";
      reportClassName = "ucp-voice-report ucp-voice-report--public-blitz-pause";
    } else if (
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "attack" &&
      gs.risquePublicCampaignEndPrimary != null &&
      String(gs.risquePublicCampaignEndPrimary).trim() !== ""
    ) {
      basePrimary = String(gs.risquePublicCampaignEndPrimary).trim();
      reportText =
        gs.risquePublicCampaignEndReport != null ? String(gs.risquePublicCampaignEndReport).trim() : "";
      reportClassName = "ucp-voice-report ucp-voice-report--public-campaign-end";
    } else if (useBattleReadout) {
      basePrimary = oa !== "" ? op + "\n" + oa : op;
      reportText = od;
      reportClassName = "ucp-voice-report";
    } else if (atkSel !== "") {
      basePrimary = atkSel;
      reportText = "";
      reportClassName = "ucp-voice-report";
    } else if (atkXfer !== "") {
      basePrimary = atkXfer;
      reportText = "";
      reportClassName = "ucp-voice-report";
    } else {
      var cvPriRaw = cv && cv.primary != null ? String(cv.primary).trim() : "";
      if (cvPriRaw !== "") {
        basePrimary = risquePublicSanitizeControlVoicePrimary(cv.primary);
      } else if (atkPhase && atkBlitzBanner !== "") {
        basePrimary = atkBlitzBanner;
        reportText = atkBlitzBannerRep;
        reportClassName = "ucp-voice-report ucp-voice-report--public-blitz-banner";
      }
      if (cv && cv.report && cvPriRaw !== "") {
        reportText = cv.report;
        reportClassName = "ucp-voice-report" + (cv.reportClass ? " " + cv.reportClass : "");
        if (window.risqueDisplayIsPublic && risquePhaseIsIncomeVoiceMirror(gs.phase)) {
          reportClassName = "ucp-voice-report ucp-voice-report--public-income";
        }
      }
    }

    /* Public TV: do not reveal which card was drawn — headline + hand size only (no card names). */
    if (
      window.risqueDisplayIsPublic &&
      gs &&
      /^(receivecard|getcard|con-receivecard)$/i.test(String(gs.phase || ""))
    ) {
      var pubRcPlayer = gs.currentPlayer ? String(gs.currentPlayer).trim() : "";
      if (pubRcPlayer) {
        basePrimary = pubRcPlayer.toUpperCase() + " RECEIVES CARD";
      }
      var pubRcN = 0;
      try {
        var pubRcPl = (gs.players || []).find(function (p) {
          return p && p.name === pubRcPlayer;
        });
        pubRcN = pubRcPl && pubRcPl.cards ? pubRcPl.cards.length : 0;
      } catch (ePubRc) {
        pubRcN = 0;
      }
      reportText = "TOTAL CARDS IN HAND = " + pubRcN;
      reportClassName = "ucp-voice-report ucp-voice-report--public-receivecard";
    }

    /* Book + card art: headline only in voice; effect lines live in #log-text (risqueCombatLogTail). */
    if (useCpBookImages) {
      reportText = "";
    }

    var skipVoiceForBookStep = pubBookPhase === "step";

    var publicBlitzPauseMirror =
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "attack" &&
      ((gs.risquePublicPausableBlitzPaused != null && String(gs.risquePublicPausableBlitzPaused).trim() !== "") ||
        (gs.risquePublicCampaignStepPaused != null && String(gs.risquePublicCampaignStepPaused).trim() !== ""));

    /* Host: attack.js showPrompt builds troop-transfer HTML in control-voice. Mirror re-apply was
     * clobbering it with the elimination banner / plain readout while attackPhase === pending_transfer. */
    var skipHostVoiceMirrorForAttackXfer =
      !window.risqueDisplayIsPublic &&
      gs &&
      String(gs.phase || "") === "attack" &&
      String(gs.attackPhase || "") === "pending_transfer" &&
      gs.acquiredTerritory &&
      String(gs.acquiredTerritory.name || "").trim() !== "" &&
      gs.attackingTerritory &&
      String(gs.attackingTerritory.name || "").trim() !== "";

    var skipHostVoiceMirrorForConquestCeleb =
      !window.risqueDisplayIsPublic &&
      gs &&
      String(gs.phase || "") === "attack" &&
      !!gs.risqueConquestFlowActive;

    var skipHostVoiceMirrorClobber =
      skipHostVoiceMirrorForAttackXfer || skipHostVoiceMirrorForConquestCeleb;

    var conquestCelebHtml =
      gs &&
      gs.risqueConquestFlowActive &&
      gs.risquePublicConquestCelebrationHtml != null
        ? String(gs.risquePublicConquestCelebrationHtml)
        : "";
    /* Fallback if an older mirror beat the host payload without the HTML blob (should be rare after persist order fix). */
    if (
      !conquestCelebHtml &&
      window.risqueDisplayIsPublic &&
      gs &&
      gs.risqueConquestFlowActive &&
      gs.risqueConquestCelebrationLine != null
    ) {
      var lnRaw = String(gs.risqueConquestCelebrationLine);
      var lnEsc = lnRaw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
      conquestCelebHtml =
        '<div class="risque-conquest-celebration-root" role="region" aria-label="Elimination">' +
        '<div class="risque-conquest-celebration-line">' +
        lnEsc +
        "</div>" +
        '<div class="risque-conquest-celebration-tv-hint" role="status">Host advances the next step on the private screen.</div>' +
        "</div>";
    }

    if (vt && !skipVoiceForBookStep) {
      if (window.risqueDisplayIsPublic && conquestCelebHtml) {
        if (vt.classList) {
          vt.classList.remove("ucp-voice-text--public-income-stack");
          vt.classList.remove("ucp-voice-text--public-blitz-pause");
        }
        vt.innerHTML = conquestCelebHtml;
      } else if (skipHostVoiceMirrorClobber) {
        /* keep host troop-transfer or conquest-celebration DOM intact */
      } else if (vt.classList) {
        vt.classList.remove("ucp-voice-text--public-income-stack");
        if (publicBlitzPauseMirror) {
          vt.classList.add("ucp-voice-text--public-blitz-pause");
        } else {
          vt.classList.remove("ucp-voice-text--public-blitz-pause");
        }
      }
      var bookVoiceShown = false;
      if (skipHostVoiceMirrorClobber) {
        /* no-op */
      } else if (renderPlayerSelectFlash) {
        vt.innerHTML = "";
        var insPub = document.createElement("div");
        insPub.className = "player-select-voice-instruction";
        insPub.textContent = String(basePrimary || "")
          .replace(/\n/g, " ")
          .trim();
        var cycPub = document.createElement("div");
        cycPub.className = "player-select-cycle-name player-select-cycle-name--hud-primary";
        var fl = gs.risquePublicPlayerSelectFlash;
        cycPub.textContent = String(fl && fl.name ? fl.name : "").toUpperCase();
        var colPub = fl && fl.color != null ? String(fl.color) : "";
        cycPub.style.color =
          window.gameUtils && window.gameUtils.colorMap && window.gameUtils.colorMap[colPub]
            ? window.gameUtils.colorMap[colPub]
            : "#ffffff";
        vt.appendChild(insPub);
        vt.appendChild(cycPub);
      } else if (
        elBan !== "" &&
        String(gs.phase || "") === "attack" &&
        String(gs.attackPhase || "") !== "pending_transfer"
      ) {
        vt.innerHTML = "";
        var banEl2 = document.createElement("div");
        banEl2.className = "ucp-voice-public-elimination-banner";
        banEl2.textContent = elBan;
        vt.appendChild(banEl2);
        var elimHint = document.createElement("div");
        elimHint.className = "ucp-voice-public-elimination-hint";
        elimHint.style.cssText = "font-size:15px;font-weight:600;opacity:0.9;margin-top:10px;";
        elimHint.textContent = window.risqueDisplayIsPublic
          ? "Host: use the flashing button on the private screen to continue."
          : "A flashing button appears here in a moment to continue.";
        vt.appendChild(elimHint);
        if (useCpBookImages) {
          bookVoiceShown = risquePublicAppendBookVoice(vt, basePrimary, cpBookCardsAll);
        }
        if (!bookVoiceShown && basePrimary !== "") {
          var restEl2 = document.createElement("div");
          restEl2.className = "ucp-voice-text-public-rest";
          restEl2.textContent = basePrimary;
          vt.appendChild(restEl2);
        }
      } else if (renderIncomeBreakdownGrid && gs.risquePublicIncomeBreakdown) {
        vt.innerHTML = "";
        vt.classList.add("ucp-voice-text--public-income-stack");
        vt.appendChild(risquePublicBuildIncomeBreakdownDom(gs.risquePublicIncomeBreakdown, gs));
      } else if (useCpBookImages) {
        vt.innerHTML = "";
        if (!risquePublicAppendBookVoice(vt, basePrimary, cpBookCardsAll)) {
          vt.textContent = basePrimary;
        }
      } else {
        vt.textContent = basePrimary;
      }
    }
    if (vr && !skipVoiceForBookStep) {
      if (window.risqueDisplayIsPublic && conquestCelebHtml) {
        vr.textContent = "";
        vr.style.display = "none";
        vr.className = "ucp-voice-report";
      } else if (skipHostVoiceMirrorClobber) {
        /* keep host report row as set by troop-transfer / conquest celebration */
      } else if (renderPlayerSelectFlash) {
        vr.textContent = "";
        vr.style.display = "none";
        vr.className = "ucp-voice-report";
      } else if (renderIncomeBreakdownGrid) {
        vr.textContent = "";
        vr.style.display = "none";
        vr.className = "ucp-voice-report";
      } else if (reportText) {
        vr.textContent = reportText;
        vr.style.display = "block";
        if (ctf !== "" || cpPub !== "" || incomePhaseBookRecapActive) {
          vr.className = reportClassName;
        } else if (useBattleReadout) {
          vr.className = "ucp-voice-report ucp-voice-report--public-battle-detail";
        } else {
          vr.className = reportClassName;
        }
      } else {
        vr.textContent = "";
        vr.style.display = "none";
        vr.className = "ucp-voice-report";
      }
    }
    var logEl = document.getElementById("log-text");
    var tail = gs && Array.isArray(gs.risqueCombatLogTail) ? gs.risqueCombatLogTail : [];
    if (cardplayTvAwaitingRecap) {
      tail = [];
    }
    if (logEl) {
      logEl.innerHTML = "";
      var idx;
      for (idx = tail.length - 1; idx >= 0; idx -= 1) {
        var row = document.createElement("div");
        var k = tail[idx].kind || "battle";
        row.className = "attack-log-entry attack-log-" + k;
        row.textContent = "> " + (tail[idx].text != null ? tail[idx].text : "");
        logEl.insertBefore(row, logEl.firstChild);
      }
    }
    risqueApplyConditionTally(gs);
  }

  window.risqueRefreshControlVoiceMirror = function (gs) {
    try {
      risquePublicApplyVoiceAndLogMirror(gs || window.gameState);
    } catch (eRV) {}
  };

  function clearPublicBookAnimTimers() {
    if (_pubBook.summaryTimer) clearTimeout(_pubBook.summaryTimer);
    if (_pubBook.stepTimer) clearTimeout(_pubBook.stepTimer);
    if (_pubBook.aerialReadyTimer) clearTimeout(_pubBook.aerialReadyTimer);
    if (_pubBook.rafId) cancelAnimationFrame(_pubBook.rafId);
    _pubBook.summaryTimer = null;
    _pubBook.stepTimer = null;
    _pubBook.aerialReadyTimer = null;
    _pubBook.rafId = 0;
  }

  function resetPublicBookSequence() {
    clearPublicBookAnimTimers();
    _pubBook.seq = null;
    _pubBook.phase = "idle";
    _pubBook.stepIndex = 0;
    _pubBook.proc = null;
    _pubBook.focusLabel = null;
    _pubBook.countAnimating = false;
    _pubBook.skipTerritoryRedraw = false;
    _pubBook.displayTroopMap = null;
    _pubBook.committalSig = null;
    _pubBook.summaryDeadlineMs = null;
    _pubBook.shelfStagingKey = null;
  }

  /** Drop stale cardplay book proc / override when entering live map phases (reinforce, attack, …). */
  function risqueStripStaleCardplayBookForMapPhase(gs) {
    if (!gs) return;
    var ph = String(gs.phase || "");
    if (
      ph === "reinforce" ||
      ph === "attack" ||
      ph === "receivecard" ||
      ph === "deploy" ||
      ph === "deploy1" ||
      ph === "deploy2" ||
      ph === "income" ||
      ph === "con-income" ||
      ph === "conquer" ||
      ph === "con-deploy" ||
      ph === "con-transfertroops" ||
      ph === "con-receivecard"
    ) {
      if (gs.risquePublicBookProcessing) {
        try {
          delete gs.risquePublicBookProcessing;
        } catch (eProc) {
          /* ignore */
        }
      }
      if (
        _pubBook.displayTroopMap ||
        _pubBook.skipTerritoryRedraw ||
        _pubBook.seq != null ||
        _pubBook.phase !== "idle"
      ) {
        resetPublicBookSequence();
      }
    }
  }

  /** Clears delayed ack for static (non–book-step) cardplay recap on TV — host button stays grey until this fires or book anim ends. */
  function risquePublicClearStaticRecapAckTimer() {
    if (window.__risqueStaticRecapAckT) {
      clearTimeout(window.__risqueStaticRecapAckT);
      window.__risqueStaticRecapAckT = null;
    }
  }

  function risquePublicBookSequenceOnIncomingState(gs) {
    if (!gs) return;
    risqueStripStaleCardplayBookForMapPhase(gs);
    /* Wayback / replay-machine mirrors board frames with risqueReplayPlaybackActive — skip TV cardplay book engine. */
    if (gs.risqueReplayPlaybackActive) {
      if (
        _pubBook.seq != null &&
        (_pubBook.phase === "summary" || _pubBook.phase === "step" || _pubBook.phase === "done")
      ) {
        resetPublicBookSequence();
      }
      return;
    }
    var procEarly = gs.risquePublicBookProcessing;
    if (procEarly && Array.isArray(procEarly.steps) && procEarly.steps.length > 0) {
      risquePublicClearStaticRecapAckTimer();
    }
    var pubHasRecap =
      gs.risquePublicCardplayRecap &&
      Array.isArray(gs.risquePublicCardplayRecap.lines) &&
      gs.risquePublicCardplayRecap.lines.length > 0;
    if (
      window.risqueDisplayIsPublic &&
      String(gs.phase || "") === "cardplay" &&
      !gs.risqueCardplayTvRecapPublished &&
      !pubHasRecap
    ) {
      if (_pubBook.seq != null) {
        resetPublicBookSequence();
      }
      return;
    }
    var proc = gs.risquePublicBookProcessing;
    if (!proc || !proc.seq || !Array.isArray(proc.steps) || !proc.steps.length) {
      if (_pubBook.seq != null && !risquePublicBookAnimBlockingPhaseChange()) {
        resetPublicBookSequence();
      }
      return;
    }
    var committalSig = risquePublicBookCommittalSig(proc, gs);
    var sameCommittedPlay =
      !!(_pubBook.committalSig && committalSig && committalSig === _pubBook.committalSig) &&
      (_pubBook.phase === "summary" || _pubBook.phase === "step");
    /* Mirror polls constantly; proc.seq often changes every frame (e.g. Date.now()). Same play = refresh proc only. */
    if (sameCommittedPlay) {
      _pubBook.seq = proc.seq;
      _pubBook.proc = proc;
      if (_pubBook.phase === "summary" && !_pubBook.summaryTimer && _pubBook.summaryDeadlineMs != null) {
        var remain = _pubBook.summaryDeadlineMs - Date.now();
        if (remain > 0) {
          _pubBook.summaryTimer = setTimeout(function () {
            _pubBook.summaryTimer = null;
            _pubBook.summaryDeadlineMs = null;
            _pubBook.phase = "step";
            _pubBook.stepIndex = 0;
            risquePublicBookRunStep(0);
          }, remain);
        }
      }
    } else if (_pubBook.seq !== proc.seq || _pubBook.committalSig !== committalSig) {
      var skipReplay = false;
      try {
        skipReplay =
          typeof sessionStorage !== "undefined" &&
          sessionStorage.getItem(RISQUE_SESSION_RECAP_SEQ_KEY) === String(proc.seq);
      } catch (eSk) {}
      /* Do not skip host cardplay TV recap — sessionStorage would jump to "done" with no card art. */
      if (skipReplay && !risquePublicProcRecapAnimation(proc)) {
        clearPublicBookAnimTimers();
        _pubBook.seq = proc.seq;
        _pubBook.proc = proc;
        _pubBook.phase = "done";
        _pubBook.stepIndex = 0;
        _pubBook.focusLabel = null;
        _pubBook.countAnimating = false;
        _pubBook.skipTerritoryRedraw = false;
        _pubBook.displayTroopMap = null;
        _pubBook.committalSig = null;
        _pubBook.summaryDeadlineMs = null;
        _pubBook.shelfStagingKey = null;
      } else {
        clearPublicBookAnimTimers();
        _pubBook.seq = proc.seq;
        _pubBook.proc = proc;
        _pubBook.committalSig = committalSig;
        _pubBook.phase = "summary";
        _pubBook.stepIndex = 0;
        _pubBook.focusLabel = null;
        _pubBook.displayTroopMap = risquePublicCloneTroopMap(
          proc.territoryBaseline && Object.keys(proc.territoryBaseline).length
            ? proc.territoryBaseline
            : risqueTroopSnapshotForPublicBook(gs)
        );
        var summaryMs = risquePublicProcRecapAnimation(_pubBook.proc)
          ? BOOK_PUBLIC_RECAP_SUMMARY_MS
          : BOOK_PUBLIC_SUMMARY_MS;
        _pubBook.summaryDeadlineMs = Date.now() + summaryMs;
        _pubBook.summaryTimer = setTimeout(function () {
          _pubBook.summaryTimer = null;
          _pubBook.summaryDeadlineMs = null;
          _pubBook.phase = "step";
          _pubBook.stepIndex = 0;
          risquePublicBookRunStep(0);
        }, summaryMs);
      }
    }
    if (_pubBook.phase === "step" && _pubBook.focusLabel) {
      gs.risquePublicCardplayHighlightLabels = [_pubBook.focusLabel];
    }
  }

  function risquePublicBookTerritoryReadableLabel(mapId) {
    if (window.gameUtils && typeof window.gameUtils.formatTerritoryDisplayName === "function") {
      return String(window.gameUtils.formatTerritoryDisplayName(mapId || "")).trim() || "that territory";
    }
    var s = String(mapId || "").replace(/_/g, " ").trim();
    return s || "that territory";
  }

  function risquePublicBookTokenReadableLabel(token) {
    var s = String(token || "").toLowerCase();
    if (s === "wildcard1") return "Wildcard 1";
    if (s === "wildcard2") return "Wildcard 2";
    return risquePublicBookTerritoryReadableLabel(token);
  }

  function risquePublicRecapSentenceName(nm) {
    var s = String(nm || "").trim();
    if (!s) return "Player";
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  function risquePublicRecapBookGroupCountFromGs(gs) {
    var cg = gs && gs.risquePublicCardplayRecap && gs.risquePublicCardplayRecap.cardGroups;
    if (!Array.isArray(cg)) return 1;
    var n = 0;
    var gi;
    for (gi = 0; gi < cg.length; gi++) {
      if (cg[gi] && risquePublicRecapGroupKind(cg[gi]) === "book") n++;
    }
    return n > 0 ? n : 1;
  }

  /** Sentence-case prompts for public TV recap animation (card line + map beat). */
  function risquePublicRecapStepFriendlyLines(proc, step, optStepIdx, optGs) {
    if (!step) return { primary: "", report: "" };
    var who = risquePublicRecapSentenceName(proc && proc.playerName);
    var tok = step.mapTerritory != null ? step.mapTerritory : step.rawTerritoryToken;
    var T =
      step.mapTerritory && risqueIsPublicBookMapTerritory(step.mapTerritory)
        ? risquePublicBookTerritoryReadableLabel(step.mapTerritory)
        : tok != null
          ? risquePublicBookTokenReadableLabel(tok)
          : "";
    var primary = "";
    if (step.recapInBook === true && step.recapBookOrdinal != null && step.recapBookTotal != null) {
      var gsRef = optGs != null ? optGs : typeof window !== "undefined" ? window.gameState : null;
      var bt = step.recapTurnBookTotal != null ? Number(step.recapTurnBookTotal) : NaN;
      var bo = step.recapTurnBookOrdinal != null ? Number(step.recapTurnBookOrdinal) : NaN;
      if (!Number.isFinite(bt) || bt < 1) {
        bt = risquePublicRecapBookGroupCountFromGs(gsRef);
      }
      var idxUse =
        typeof optStepIdx === "number" && optStepIdx >= 0
          ? optStepIdx
          : _pubBook && typeof _pubBook.stepIndex === "number"
            ? _pubBook.stepIndex
            : 0;
      if (!Number.isFinite(bo) || bo < 1) {
        var books = risquePublicRecapExtractBookGroups(
          gsRef && gsRef.risquePublicCardplayRecap && gsRef.risquePublicCardplayRecap.cardGroups
        );
        bo = risquePublicShelfResolveTurnBookOrdinal(proc, idxUse, step, books);
      }
      bt = Math.max(1, Math.floor(bt));
      bo = Math.min(Math.max(1, Math.floor(bo)), bt);
      primary =
        who +
        " is turning in book " +
        bo +
        " of " +
        bt +
        " — card " +
        step.recapBookOrdinal +
        " of " +
        step.recapBookTotal;
    } else if (step.effect === "aerial_attack") {
      var wkA = step.playedCardKey;
      var wShort =
        wkA === "wildcard1"
          ? "WILDCARD 1"
          : wkA === "wildcard2"
            ? "WILDCARD 2"
            : "a wildcard";
      primary = who + " plays " + wShort + " — aerial attack";
    } else if (T) {
      primary = who + " plays " + T;
    } else {
      primary = who + " plays a card";
    }
    var eff = step.effect;
    var report = "";
    if (eff === "add_troops" && T) {
      report = "Adds two troops to " + T + ".";
    } else if (eff === "remove_troops" && T) {
      report = "Removes two troops from " + T + ".";
    } else if (eff === "acquire" && T) {
      report = who + " acquires " + T + ".";
    } else if (eff === "declined") {
      report = "Declined.";
    } else if (eff === "no_effect") {
      report = "No effect.";
    } else if (eff === "aerial_attack") {
      var wkR = step.playedCardKey;
      report =
        wkR === "wildcard1" || wkR === "wildcard2"
          ? "Aerial attack enabled — " + (wkR === "wildcard1" ? "WILDCARD 1" : "WILDCARD 2") + "."
          : "Aerial attack is enabled.";
    }
    return { primary: primary, report: report };
  }

  /**
   * One or two short lines for #control-voice-report (public TV): "PLAYER PLAYS NAME — OUTCOME", all caps.
   */
  function risquePublicBookDescribeStep(gs, step) {
    var proc = _pubBook.proc;
    var rawName = (gs && gs.currentPlayer) || (proc && proc.playerName) || "Player";
    var whoU = String(rawName).trim().toUpperCase() || "PLAYER";
    function namePlayed(label) {
      var L = String(label || "").trim();
      if (!L || L.toLowerCase() === "that territory") {
        L = "CARD";
      }
      return whoU + " PLAYS " + L.toUpperCase();
    }
    if (!step || !step.effect) {
      return whoU + " PLAYS — RESOLVING";
    }
    var eff = step.effect;
    var mapT = step.mapTerritory;
    var place = mapT ? risquePublicBookTerritoryReadableLabel(mapT) : "";
    var token = step.rawTerritoryToken != null ? step.rawTerritoryToken : mapT;
    var tokenLabel = token != null ? risquePublicBookTokenReadableLabel(token) : "";

    if (eff === "aerial_attack") {
      var wKey = step.playedCardKey;
      var wLab =
        wKey === "wildcard1"
          ? "WILDCARD 1"
          : wKey === "wildcard2"
            ? "WILDCARD 2"
            : "WILDCARD";
      return namePlayed(wLab) + " — AERIAL ATTACK";
    }
    if (eff === "add_troops") {
      return namePlayed(place) + " — ADDED 2 TROOPS";
    }
    if (eff === "remove_troops") {
      return namePlayed(place) + " — REMOVED 2 TROOPS";
    }
    if (eff === "acquire") {
      return namePlayed(place) + " — ACQUIRED TERRITORY";
    }
    if (eff === "declined") {
      if (place && place !== "that territory") {
        return namePlayed(place) + " — DECLINED";
      }
      return namePlayed(tokenLabel) + " — DECLINED";
    }
    if (eff === "no_effect") {
      if (place && place !== "that territory") {
        return namePlayed(place) + " — NO EFFECT";
      }
      return namePlayed(tokenLabel || "TARGET") + " — NO EFFECT";
    }
    return whoU + " PLAYS — RESOLVED";
  }

  /** Second line under wildcard-as-territory name: same at-a-glance meaning as +2 / −2 / ACQUIRED on normal territory cards. */
  function risquePublicBookWildTerritoryEffectSubline(step) {
    if (!step) return null;
    var eff = step.effect;
    if (eff === "add_troops") return { text: "+2", suffix: "add" };
    if (eff === "remove_troops") return { text: "\u22122", suffix: "remove" };
    if (eff === "acquire") return { text: "ACQUIRED", suffix: "acquired" };
    if (eff === "declined") return { text: "DECLINED", suffix: "declined" };
    if (eff === "no_effect") return { text: "NO EFFECT", suffix: "neutral" };
    return null;
  }

  function risquePublicBookAppendEffectBadgeEl(parent, badge) {
    if (!badge || !parent) return;
    if (badge.subtext) {
      var stack = document.createElement("div");
      stack.className = "risque-public-book-voice-recap-badge-stack";
      var main = document.createElement("span");
      main.className = badge.className;
      main.textContent = badge.text;
      stack.appendChild(main);
      var sub = document.createElement("div");
      sub.className =
        "risque-public-book-voice-effect-sub risque-public-book-voice-effect-sub--" +
        String(badge.subtextClassSuffix || "neutral");
      sub.textContent = badge.subtext;
      stack.appendChild(sub);
      parent.appendChild(stack);
    } else {
      var sp = document.createElement("span");
      sp.className = badge.className;
      sp.textContent = badge.text;
      parent.appendChild(sp);
    }
  }

  /**
   * Public TV: large +2 / −2 / ACQUIRED beside the card image for the current processing step only.
   * Wildcard as territory: large territory name with a subline (+2 / −2 / ACQUIRED / …).
   */
  function risquePublicBookVoiceEffectBadgeForStep(step) {
    if (!step || !step.effect) return null;
    var wk = step.playedCardKey;
    var isWild = wk === "wildcard1" || wk === "wildcard2";
    if (step.effect === "aerial_attack") {
      return {
        text: "AERIAL ATTACK",
        className:
          "risque-public-book-voice-effect-badge risque-public-book-voice-effect-badge--aerial-attack"
      };
    }
    if (isWild) {
      var place = step.mapTerritory
        ? risqueTerritoryVoiceUpperForPublicBook(step.mapTerritory)
        : step.rawTerritoryToken != null
          ? risquePrettyCardplayVoiceToken(step.rawTerritoryToken)
          : "";
      if (place) {
        var subline = risquePublicBookWildTerritoryEffectSubline(step);
        return {
          text: place,
          className:
            "risque-public-book-voice-effect-badge risque-public-book-voice-effect-badge--wild-territory",
          subtext: subline ? subline.text : null,
          subtextClassSuffix: subline ? subline.suffix : null
        };
      }
    }
    if (step.effect === "add_troops") {
      return {
        text: "+2",
        className: "risque-public-book-voice-effect-badge risque-public-book-voice-effect-badge--add"
      };
    }
    if (step.effect === "remove_troops") {
      return {
        text: "\u22122",
        className: "risque-public-book-voice-effect-badge risque-public-book-voice-effect-badge--remove"
      };
    }
    if (step.effect === "acquire") {
      return {
        text: "ACQUIRED",
        className: "risque-public-book-voice-effect-badge risque-public-book-voice-effect-badge--acquired"
      };
    }
    return null;
  }

  /**
   * During map-processing steps, keep the card row under the CARD PLAY title; highlight the card tied to
   * this step (when known), dim finished cards, soften upcoming ones.
   */
  function risquePublicBookSetVoiceProcessing(gs, step, stepIdx, onAerialPicked) {
    var vt = document.getElementById("control-voice-text");
    var vr = document.getElementById("control-voice-report");
    var cv = document.getElementById("control-voice");
    if (cv) {
      cv.classList.add("ucp-control-voice--public-book-processing");
    }
    var proc = _pubBook.proc;
    var useRecapCopy = !!(proc && step && risquePublicProcRecapAnimation(proc));
    if (vr) {
      if (useRecapCopy || (step && step.effect === "aerial_attack")) {
        vr.textContent = "";
        vr.style.display = "none";
        vr.className = "ucp-voice-report";
      } else {
        vr.textContent = risquePublicBookDescribeStep(gs, step);
        vr.style.display = "block";
        vr.className = "ucp-voice-report ucp-voice-report--public-book-step";
      }
    }
    if (!vt) return;
    vt.innerHTML = "";
    var rawIds =
      gs && Array.isArray(gs.risquePublicCardplayBookCards) ? gs.risquePublicCardplayBookCards : [];
    var sanitizedIds = [];
    var zi;
    for (zi = 0; zi < rawIds.length; zi += 1) {
      var s0 = risquePublicSanitizeCardImageId(rawIds[zi]);
      if (s0) sanitizedIds.push(s0);
    }
    var titlePrimary =
      gs && gs.risquePublicCardplayPrimary != null ? String(gs.risquePublicCardplayPrimary) : "";
    if (!titlePrimary && gs && gs.currentPlayer) {
      titlePrimary = String(gs.currentPlayer).toUpperCase() + " · CARD PLAY";
    }
    if (useRecapCopy) {
      var friendly = risquePublicRecapStepFriendlyLines(proc, step, stepIdx, gs);
      titlePrimary = friendly.primary;
    } else if (step && step.effect === "aerial_attack") {
      var friendlyA = risquePublicRecapStepFriendlyLines(proc, step, stepIdx, gs);
      titlePrimary = friendlyA.primary;
    }
    var useAerialRecapLayout = useRecapCopy || (step && step.effect === "aerial_attack");
    var wrap = document.createElement("div");
    wrap.className =
      "risque-public-book-voice risque-public-book-voice--with-step-line" +
      (useAerialRecapLayout ? " risque-public-book-voice--recap-narrative" : "");
    if (step && step.effect === "aerial_attack") {
      wrap.classList.add("risque-public-book-voice--recap-wild-flash");
    }
    var titleEl = document.createElement("div");
    titleEl.className = "risque-public-book-voice-title";
    titleEl.textContent = titlePrimary;
    wrap.appendChild(titleEl);
    if (useRecapCopy || (step && step.effect === "aerial_attack")) {
      var det = risquePublicRecapStepFriendlyLines(proc, step, stepIdx, gs);
      if (det.report) {
        var repEl = document.createElement("div");
        repEl.className = "risque-public-book-voice-recap-detail";
        repEl.textContent = det.report;
        wrap.appendChild(repEl);
      }
    }
    if (sanitizedIds.length > 0) {
      var row = document.createElement("div");
      row.className = "risque-public-book-voice-cards";
      if (useRecapCopy || (step && step.effect === "aerial_attack")) {
        var oneKey =
          step && step.playedCardKey
            ? step.playedCardKey
            : stepIdx >= 0 && sanitizedIds[stepIdx]
              ? sanitizedIds[stepIdx]
              : null;
        if (oneKey) {
          var cluster = document.createElement("div");
          cluster.className = "risque-public-book-voice-recap-single";
          var cardRow = document.createElement("div");
          cardRow.className = "risque-public-book-voice-recap-card-row";
          var img1 = document.createElement("img");
          img1.className = "risque-public-book-voice-card-img risque-public-book-voice-card-img--active";
          img1.src = "assets/images/Cards/" + String(oneKey || "").toUpperCase() + ".webp";
          img1.alt = "";
          img1.setAttribute("loading", "lazy");
          cardRow.appendChild(img1);
          var recapBadge = risquePublicBookVoiceEffectBadgeForStep(step);
          if (recapBadge) {
            risquePublicBookAppendEffectBadgeEl(cardRow, recapBadge);
          }
          cluster.appendChild(cardRow);
          if ((oneKey === "wildcard1" || oneKey === "wildcard2") && !recapBadge) {
            var wb = document.createElement("div");
            wb.className = "risque-public-book-voice-wild-badge";
            wb.textContent = oneKey === "wildcard1" ? "WILDCARD 1" : "WILDCARD 2";
            cluster.appendChild(wb);
          }
          row.appendChild(cluster);
        }
        row.classList.add("risque-public-book-voice-cards--recap-step");
      } else {
        var completed = [];
        var activeKey = null;
        var alignByIndex =
          sanitizedIds.length > 0 && proc && proc.steps && sanitizedIds.length === proc.steps.length;
        if (proc && proc.steps && stepIdx >= 0 && stepIdx < proc.steps.length) {
          activeKey = proc.steps[stepIdx].playedCardKey || null;
          if (!activeKey && alignByIndex) {
            activeKey = sanitizedIds[stepIdx];
          }
          var sj;
          for (sj = 0; sj < stepIdx; sj += 1) {
            var pk = proc.steps[sj].playedCardKey || null;
            if (!pk && alignByIndex) {
              pk = sanitizedIds[sj];
            }
            if (pk && completed.indexOf(pk) === -1) completed.push(pk);
          }
        }
        var ii;
        for (ii = 0; ii < sanitizedIds.length; ii += 1) {
          var sid = sanitizedIds[ii];
          var img = document.createElement("img");
          img.className = "risque-public-book-voice-card-img";
          if (completed.indexOf(sid) !== -1) {
            img.classList.add("risque-public-book-voice-card-img--done");
          } else if (activeKey && sid === activeKey) {
            img.classList.add("risque-public-book-voice-card-img--active");
          } else {
            img.classList.add("risque-public-book-voice-card-img--pending");
          }
          img.src = "assets/images/Cards/" + String(sid || "").toUpperCase() + ".webp";
          img.alt = "";
          img.setAttribute("loading", "lazy");
          var stepBadge = null;
          if (activeKey && sid === activeKey) {
            stepBadge = risquePublicBookVoiceEffectBadgeForStep(step);
          }
          if (stepBadge) {
            var pair = document.createElement("div");
            pair.className = "risque-public-book-voice-card-pair";
            pair.appendChild(img);
            risquePublicBookAppendEffectBadgeEl(pair, stepBadge);
            row.appendChild(pair);
          } else {
            row.appendChild(img);
          }
        }
        var nStrip = Math.min(9, Math.max(1, sanitizedIds.length));
        row.setAttribute("data-risque-card-count", String(nStrip));
      }
      wrap.appendChild(row);
    }
    vt.appendChild(wrap);
  }

  /** Two-pane shelf (#risque-public-cardplay-recap-overlay): lower → upper crossfade; dwell matches user test flow. */
  var SHELF_CROSSFADE_MS = 500;
  var SHELF_UPPER_CLEAR_MS = 400;

  function risquePublicShelfOverlayHasShelfPanel() {
    var o = document.getElementById("risque-public-cardplay-recap-overlay");
    return !!(o && o.querySelector(".risque-public-cardplay-recap-panel--shelf"));
  }

  /** Book row, singles cluster, or flat strip — any committed recap thumbnails in the lower shelf. */
  function risquePublicShelfLowerHasCardSlots() {
    var o = document.getElementById("risque-public-cardplay-recap-overlay");
    return !!(o && o.querySelector(".risque-public-cp-shelf-lower .risque-public-cp-shelf-card-slot"));
  }

  /** Milliseconds after runStep starts before map highlight (recap + shelf): crossfade(s) + read beat. */
  function risquePublicShelfRecapLeadMs(stepIdx) {
    if (!risquePublicShelfOverlayHasShelfPanel()) return 0;
    return stepIdx > 0 ? SHELF_UPPER_CLEAR_MS + SHELF_CROSSFADE_MS : SHELF_CROSSFADE_MS;
  }

  function risqueHostShelfClearAerialUiPoll() {
    if (_pubBook.hostShelfAerialUiPoll) {
      clearInterval(_pubBook.hostShelfAerialUiPoll);
      _pubBook.hostShelfAerialUiPoll = null;
    }
  }

  /** Matches phases/cardplay.js cardplayIsAerialDecisionReady — income-gate is hidden during host shelf recap. */
  function risqueHostAerialDecisionReadyForSeq(seq) {
    if (seq == null || seq === "") return false;
    try {
      var rawState = localStorage.getItem(PUBLIC_CARDPLAY_PROCESSING_STATE_KEY);
      if (!rawState) return false;
      var st = JSON.parse(rawState);
      if (!(st && Number(st.seq) === Number(seq) && String(st.state || "") === "aerial_decision")) {
        return false;
      }
      var raw = localStorage.getItem(PUBLIC_AERIAL_DECISION_READY_KEY);
      if (!raw) return false;
      var d = JSON.parse(raw);
      return !!(d && d.ready === true && Number(d.seq) === Number(seq));
    } catch (eR) {
      return false;
    }
  }

  function risqueHostOpposingPlayerNames(gs) {
    if (!gs || !Array.isArray(gs.players)) return [];
    var cur = String(gs.currentPlayer || "");
    var out = [];
    var i;
    for (i = 0; i < gs.players.length; i++) {
      var p = gs.players[i];
      if (p && String(p.name || "") !== cur) out.push(String(p.name || ""));
    }
    return out;
  }

  function risqueHostPlayerHasWildcard(gs, playerName, wantLower) {
    var want = String(wantLower || "").toLowerCase();
    if (!gs || !Array.isArray(gs.players) || !want) return false;
    var j;
    for (j = 0; j < gs.players.length; j++) {
      var p = gs.players[j];
      if (!p || String(p.name || "") !== String(playerName || "")) continue;
      if (!Array.isArray(p.cards)) return false;
      var k;
      for (k = 0; k < p.cards.length; k++) {
        var c = p.cards[k];
        if (c && c.name && String(c.name).toLowerCase() === want) return true;
      }
      return false;
    }
    return false;
  }

  function risqueHostRequiredCounterForPlayedKey(pk) {
    var s = String(pk || "").toLowerCase();
    if (s === "wildcard1") return "wildcard2";
    if (s === "wildcard2") return "wildcard1";
    return "";
  }

  /**
   * Host only: #risque-phase-content is hidden during shelf recap — duplicate aerial confirm/counter here.
   * Uses the same localStorage keys as phases/cardplay.js (risquePublicAerialCounterDecision).
   */
  function risqueHostShelfAppendAerialDecisionUi(wrapEl, gs, step, proc) {
    if (window.risqueDisplayIsPublic || !wrapEl || !step || step.effect !== "aerial_attack" || !proc) return;
    var decSeq = Number(proc.seq) || 0;
    if (!decSeq && gs && gs.risquePublicCardplayRecapAckRequiredSeq != null) {
      decSeq = Number(gs.risquePublicCardplayRecapAckRequiredSeq) || 0;
    }
    if (!decSeq) return;

    if (Number(gs.risquePublicCardplayAerialSkipHostDecisionSeq) === Number(decSeq)) {
      return;
    }

    var box = document.createElement("div");
    box.className = "risque-public-cp-shelf-aerial-host";
    if (!wrapEl.classList || !wrapEl.classList.contains("risque-public-cp-shelf-aerial-beside")) {
      box.classList.add("risque-public-cp-shelf-aerial-host--standalone");
    }

    var row = document.createElement("div");
    row.className = "risque-public-cp-shelf-aerial-btn-stack";
    var bConf = document.createElement("button");
    bConf.type = "button";
    bConf.className = "risque-public-cp-shelf-aerial-btn";
    bConf.textContent = "CONFIRM";
    var bCnt = document.createElement("button");
    bCnt.type = "button";
    bCnt.className = "risque-public-cp-shelf-aerial-btn";
    bCnt.textContent = "COUNTER";
    row.appendChild(bConf);
    row.appendChild(bCnt);
    box.appendChild(row);

    var counterRow = document.createElement("div");
    counterRow.className = "risque-public-cp-shelf-aerial-counter-row";
    counterRow.hidden = true;
    var sel = document.createElement("select");
    sel.className = "risque-public-cp-shelf-aerial-select risque-public-cp-shelf-aerial-select--compact";
    counterRow.appendChild(sel);
    box.appendChild(counterRow);

    var msg = document.createElement("div");
    msg.className = "risque-host-shelf-aerial-inline-msg";
    msg.setAttribute("role", "status");
    box.appendChild(msg);

    wrapEl.appendChild(box);

    var playedKey = step.playedCardKey ? String(step.playedCardKey).toLowerCase() : "";
    var needWC = risqueHostRequiredCounterForPlayedKey(playedKey);

    function fillPlayerOptions() {
      sel.innerHTML = "";
      var o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = "Choose countering player";
      sel.appendChild(o0);
      var names = risqueHostOpposingPlayerNames(gs);
      var ni;
      for (ni = 0; ni < names.length; ni++) {
        var op = document.createElement("option");
        op.value = names[ni];
        op.textContent = names[ni];
        sel.appendChild(op);
      }
    }
    fillPlayerOptions();

    function syncButtonsEnabled() {
      try {
        var rawDec = localStorage.getItem(PUBLIC_AERIAL_COUNTER_DECISION_KEY);
        if (rawDec) {
          var d = JSON.parse(rawDec);
          if (
            d &&
            Number(d.seq) === Number(decSeq) &&
            (String(d.choice || "") === "confirmed" || String(d.choice || "") === "countered")
          ) {
            bConf.disabled = true;
            bCnt.disabled = true;
            sel.disabled = true;
            msg.textContent = String(d.choice || "") === "confirmed" ? "Confirmed." : "Counter recorded.";
            return true;
          }
        }
      } catch (eSync) {
        /* ignore */
      }
      var ready = risqueHostAerialDecisionReadyForSeq(decSeq);
      bConf.disabled = !ready;
      bCnt.disabled = !ready;
      if (!ready) {
        bConf.title = "Waiting for this recap step to be ready.";
        bCnt.title = "Waiting for this recap step to be ready.";
      } else {
        bConf.title = "Confirm aerial attack processing.";
        bCnt.title = "Choose this if someone calls a valid counter.";
      }
      return false;
    }

    bConf.addEventListener("click", function () {
      if (bConf.disabled) return;
      try {
        localStorage.setItem(
          PUBLIC_AERIAL_COUNTER_DECISION_KEY,
          JSON.stringify({ seq: Number(decSeq), choice: "confirmed", phase: "cardplay", at: Date.now() })
        );
      } catch (eC) {
        /* ignore */
      }
      syncButtonsEnabled();
    });

    bCnt.addEventListener("click", function () {
      if (bCnt.disabled) return;
      counterRow.hidden = false;
      msg.textContent = "Select the countering player.";
      fillPlayerOptions();
    });

    sel.addEventListener("change", function () {
      var picked = String(sel.value || "");
      if (!picked) {
        msg.textContent = "Choose a player to verify counter.";
        return;
      }
      if (!risqueHostPlayerHasWildcard(gs, picked, needWC)) {
        msg.textContent = picked + " does not have the required counter wildcard.";
        return;
      }
      try {
        localStorage.setItem(
          PUBLIC_AERIAL_COUNTER_DECISION_KEY,
          JSON.stringify({
            seq: Number(decSeq),
            choice: "countered",
            counterPlayer: picked,
            phase: "cardplay",
            holdUntilMs: Date.now() + 5200,
            at: Date.now()
          })
        );
      } catch (eAp) {
        /* ignore */
      }
      msg.textContent = "Counter validated for " + picked + ".";
      syncButtonsEnabled();
    });

    syncButtonsEnabled();
    risqueHostShelfClearAerialUiPoll();
    _pubBook.hostShelfAerialUiPoll = setInterval(function () {
      if (!document.getElementById("risque-public-cardplay-recap-overlay")) {
        risqueHostShelfClearAerialUiPoll();
        return;
      }
      if (syncButtonsEnabled()) {
        risqueHostShelfClearAerialUiPoll();
      }
    }, 200);
  }


  function risquePublicShowAerialCancelledForStep(step, done) {
    risqueHostShelfClearAerialUiPoll();
    var host = document.getElementById("risque-public-cp-shelf-upper-content");
    if (!host) {
      if (typeof done === "function") done();
      return;
    }
    var cardKey = step && step.playedCardKey ? String(step.playedCardKey).toLowerCase() : "";
    if (!cardKey) {
      if (typeof done === "function") done();
      return;
    }
    host.innerHTML = "";
    var wrap = document.createElement("div");
    wrap.className = "risque-public-aerial-cancel-wrap";
    var cardWrap = document.createElement("div");
    cardWrap.className = "risque-public-aerial-cancel-card-wrap";
    var img = document.createElement("img");
    img.className = "risque-public-aerial-cancel-card";
    img.src = "assets/images/Cards/" + cardKey.toUpperCase() + ".webp";
    img.alt = "";
    var slash = document.createElement("div");
    slash.className = "risque-public-aerial-cancel-slash";
    var ring = document.createElement("div");
    ring.className = "risque-public-aerial-cancel-ring";
    cardWrap.appendChild(img);
    cardWrap.appendChild(ring);
    cardWrap.appendChild(slash);
    var text = document.createElement("div");
    text.className = "risque-public-aerial-cancel-text";
    text.textContent = "CANCELLED";
    wrap.appendChild(cardWrap);
    wrap.appendChild(text);
    host.appendChild(wrap);
    setTimeout(function () {
      if (typeof done === "function") done();
    }, 3000);
  }

  /**
   * Public TV shelf: large card + recap lines + effect badge in upper pane; current card fades out of the lower shelf.
   * stepIdx === 0: crossfade only. stepIdx > 0: fade upper clear first, then crossfade next card up.
   */
  function risquePublicShelfRunBookStepAnimation(gs, step, stepIdx, onAerialPicked) {
    var overlay = document.getElementById("risque-public-cardplay-recap-overlay");
    var upperInner = document.getElementById("risque-public-cp-shelf-upper-content");
    var proc = _pubBook.proc;
    if (!overlay || !upperInner || !step || !proc) return;

    var lowerVisualIdx = risquePublicShelfLowerVisualStepIndex(proc, stepIdx);

    function fillUpperProcessingUi() {
      risqueHostShelfClearAerialUiPoll();
      upperInner.style.transition = "opacity " + SHELF_CROSSFADE_MS + "ms ease";
      upperInner.innerHTML = "";
      var wrap = document.createElement("div");
      wrap.className =
        "risque-public-cp-shelf-upper-processing risque-public-book-voice risque-public-book-voice--recap-narrative";
      var friendly = risquePublicRecapStepFriendlyLines(proc, step, stepIdx, gs);
      var tit = document.createElement("div");
      tit.className = "risque-public-book-voice-title risque-public-cp-shelf-upper-title";
      tit.textContent = friendly.primary;
      wrap.appendChild(tit);
      if (friendly.report) {
        var rep = document.createElement("div");
        rep.className = "risque-public-book-voice-recap-detail risque-public-cp-shelf-upper-report";
        rep.textContent = friendly.report;
        wrap.appendChild(rep);
      }
      var pk = step.playedCardKey || "";
      if (pk) {
        var cluster = document.createElement("div");
        cluster.className = "risque-public-book-voice-recap-single";
        var cardRow = document.createElement("div");
        cardRow.className = "risque-public-book-voice-recap-card-row risque-public-cp-shelf-upper-card-row";
        var bigImg = document.createElement("img");
        bigImg.className = "risque-public-book-voice-card-img risque-public-book-voice-card-img--active";
        bigImg.src = "assets/images/Cards/" + String(pk).toUpperCase() + ".webp";
        bigImg.alt = "";
        bigImg.setAttribute("loading", "lazy");
        cardRow.appendChild(bigImg);
        var badge = risquePublicBookVoiceEffectBadgeForStep(step);
        var hostAerialBeside =
          !window.risqueDisplayIsPublic && step.effect === "aerial_attack" && badge;
        if (hostAerialBeside) {
          cardRow.classList.add("risque-public-cp-shelf-upper-card-row--host-aerial");
          var beside = document.createElement("div");
          beside.className = "risque-public-cp-shelf-aerial-beside";
          risquePublicBookAppendEffectBadgeEl(beside, badge);
          risqueHostShelfAppendAerialDecisionUi(beside, gs, step, proc);
          cardRow.appendChild(beside);
        } else if (badge) {
          risquePublicBookAppendEffectBadgeEl(cardRow, badge);
        } else if (pk === "wildcard1" || pk === "wildcard2") {
          var wb = document.createElement("div");
          wb.className = "risque-public-book-voice-wild-badge";
          wb.textContent = pk === "wildcard1" ? "WILDCARD 1" : "WILDCARD 2";
          cardRow.appendChild(wb);
        }
        cluster.appendChild(cardRow);
        wrap.appendChild(cluster);
      }
      if (!window.risqueDisplayIsPublic && step.effect === "aerial_attack" && !pk) {
        risqueHostShelfAppendAerialDecisionUi(wrap, gs, step, proc);
      }
      upperInner.appendChild(wrap);
      upperInner.style.opacity = "0";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          upperInner.style.opacity = "1";
        });
      });
    }

    function updateLowerSlotsForStep() {
      var liveSlots = overlay.querySelectorAll(".risque-public-cp-shelf-lower .risque-public-cp-shelf-card-slot");
      var n = liveSlots.length;
      var vidx = Number(lowerVisualIdx);
      if (!Number.isFinite(vidx)) vidx = 0;
      if (n > 0) {
        if (vidx < 0) vidx = 0;
        if (vidx >= n) vidx = n - 1;
      }
      var si;
      for (si = 0; si < liveSlots.length; si++) {
        var sl = liveSlots[si];
        var img = sl.querySelector("img");
        if (!img) continue;
        img.style.transition = "opacity " + SHELF_CROSSFADE_MS + "ms ease";
        sl.classList.remove("risque-public-cp-shelf-card-slot--done");
        if (si < vidx) {
          sl.classList.add("risque-public-cp-shelf-card-slot--done");
          img.style.opacity = "0.35";
        } else if (si === vidx) {
          img.style.opacity = "0";
        } else {
          img.style.opacity = "1";
        }
      }
    }

    if (stepIdx > 0) {
      upperInner.style.transition = "opacity " + SHELF_UPPER_CLEAR_MS + "ms ease";
      upperInner.style.opacity = "0";
      setTimeout(function () {
        upperInner.innerHTML = "";
        updateLowerSlotsForStep();
        fillUpperProcessingUi();
      }, SHELF_UPPER_CLEAR_MS);
    } else {
      updateLowerSlotsForStep();
      fillUpperProcessingUi();
    }
  }

  /**
   * After the last recap step: fade the upper processing UI out and restore every card in the lower shelf
   * to the dimmed “processed” state (matches earlier steps). Then caller sets phase done + recap ack.
   */
  function risquePublicShelfFinalizeBookRecap(done) {
    risqueHostShelfClearAerialUiPoll();
    var overlay = document.getElementById("risque-public-cardplay-recap-overlay");
    var upperInner = document.getElementById("risque-public-cp-shelf-upper-content");
    var slots = overlay ? overlay.querySelectorAll(".risque-public-cp-shelf-lower .risque-public-cp-shelf-card-slot") : [];
    if (!upperInner || !slots.length) {
      if (typeof done === "function") done();
      return;
    }
    upperInner.style.transition = "opacity " + SHELF_CROSSFADE_MS + "ms ease";
    upperInner.style.opacity = "0";
    var si;
    for (si = 0; si < slots.length; si++) {
      var sl = slots[si];
      var img = sl && sl.querySelector("img");
      if (!img) continue;
      img.style.transition = "opacity " + SHELF_CROSSFADE_MS + "ms ease";
      sl.classList.add("risque-public-cp-shelf-card-slot--done");
      img.style.opacity = "0.35";
    }
    setTimeout(function () {
      upperInner.innerHTML = "";
      upperInner.style.opacity = "1";
      if (typeof done === "function") done();
    }, SHELF_CROSSFADE_MS);
  }

  function risquePublicBookAnimateTroops(label, from, to, ms, done) {
    if (from === to) {
      if (typeof done === "function") done();
      return;
    }
    _pubBook.countAnimating = true;
    _pubBook.skipTerritoryRedraw = true;
    var start = typeof performance !== "undefined" ? performance.now() : Date.now();
    function tick(now) {
      var t0 = now != null ? now : Date.now();
      var elapsed = t0 - start;
      var u = ms > 0 ? Math.min(1, elapsed / ms) : 1;
      var val = Math.round(from + (to - from) * u);
      var host = document.querySelector('#canvas .svg-overlay .territory-number[data-label="' + label + '"]');
      if (host) {
        var pad = String(val).padStart(3, "0");
        if (host.tagName && host.tagName.toLowerCase() === "text") host.textContent = pad;
        else host.querySelectorAll("text").forEach(function (t) { t.textContent = pad; });
      }
      if (u < 1) {
        _pubBook.rafId = requestAnimationFrame(tick);
      } else {
        _pubBook.countAnimating = false;
        _pubBook.skipTerritoryRedraw = false;
        if (host) {
          var padTo = String(to).padStart(3, "0");
          if (host.tagName && host.tagName.toLowerCase() === "text") host.textContent = padTo;
          else host.querySelectorAll("text").forEach(function (t) { t.textContent = padTo; });
        }
        if (typeof done === "function") done();
      }
    }
    _pubBook.rafId = requestAnimationFrame(tick);
  }

  function risquePublicBookRunStep(idx) {
    var proc = _pubBook.proc;
    var gs = window.gameState;
    if (!window.gameUtils || !gs) return;
    if (!proc || !proc.steps || idx >= proc.steps.length) {
      function risquePublicBookRunStepDoneFinale() {
        _pubBook.phase = "done";
        _pubBook.focusLabel = null;
        _pubBook.countAnimating = false;
        _pubBook.skipTerritoryRedraw = false;
        if (_pubBook.seq != null) {
          try {
            if (typeof sessionStorage !== "undefined") {
              sessionStorage.setItem(RISQUE_SESSION_RECAP_SEQ_KEY, String(_pubBook.seq));
            }
          } catch (eSeq) {
            /* ignore */
          }
        }
        _pubBook.displayTroopMap = null;
        delete gs.risquePublicCardplayHighlightLabels;
        delete gs.risquePublicCardplayHighlightMode;
        window.gameUtils.renderTerritories(null, gs);
        risquePublicApplyVoiceAndLogMirror(gs);
        risquePublicSyncCardplayStrip(gs);
        risquePublicFlushDeferredIncomeTransition();
        if (
          gs &&
          gs.risquePublicCardplayRecapAckRequiredSeq != null &&
          String(gs.phase || "") === "cardplay"
        ) {
          try {
            localStorage.setItem(
              "risquePublicCardplayRecapAck",
              JSON.stringify({
                seq: Number(gs.risquePublicCardplayRecapAckRequiredSeq),
                at: Date.now()
              })
            );
          } catch (eTvAck) {
            /* ignore */
          }
          try {
            localStorage.setItem(
              PUBLIC_CARDPLAY_PROCESSING_STATE_KEY,
              JSON.stringify({
                seq: Number(gs.risquePublicCardplayRecapAckRequiredSeq) || 0,
                state: "done",
                at: Date.now()
              })
            );
          } catch (eDone) {
            /* ignore */
          }
        }
      }
      var shelfFinalizeBook =
        proc &&
        proc.steps &&
        proc.steps.length > 0 &&
        idx >= proc.steps.length &&
        risquePublicShelfOverlayHasShelfPanel() &&
        risquePublicProcRecapAnimation(proc) &&
        risquePublicShelfLowerHasCardSlots();
      if (shelfFinalizeBook) {
        risquePublicShelfFinalizeBookRecap(risquePublicBookRunStepDoneFinale);
        return;
      }
      risquePublicBookRunStepDoneFinale();
      return;
    }
    var step = proc.steps[idx];
    var actingPlayer = String((proc.playerName || gs.currentPlayer || "") + "");
    _pubBook.stepIndex = idx;
    var useShelfRecap =
      risquePublicShelfOverlayHasShelfPanel() &&
      risquePublicProcRecapAnimation(proc) &&
      risquePublicShelfLowerHasCardSlots();
    var needsAerialDecision =
      risquePublicProcRecapAnimation(proc) && step && step.effect === "aerial_attack";
    function handleAerialChoice(choice) {
      step.risqueAerialDecision = String(choice || "");
      if (choice === "countered") {
        step.voice = "AERIAL ATTACK COUNTERED";
      }
      try {
        localStorage.removeItem(PUBLIC_AERIAL_DECISION_READY_KEY);
      } catch (eReadyClr) {
        /* ignore */
      }
      if (_pubBook.aerialReadyTimer) {
        clearTimeout(_pubBook.aerialReadyTimer);
        _pubBook.aerialReadyTimer = null;
      }
      if (choice === "countered") {
        risquePublicShowAerialCancelledForStep(step, function () {
          risquePublicBookRunStepMapPart(idx, actingPlayer);
        });
      } else {
        risquePublicBookRunStepMapPart(idx, actingPlayer);
      }
    }
    function readHostAerialDecisionForSeq(seq) {
      try {
        var raw = localStorage.getItem(PUBLIC_AERIAL_COUNTER_DECISION_KEY);
        if (!raw) return null;
        var d = JSON.parse(raw);
        if (!d || Number(d.seq) !== Number(seq)) return null;
        var c = String(d.choice || "");
        if (c !== "confirmed" && c !== "countered") return null;
        return c;
      } catch (eDec) {
        return null;
      }
    }
    if (useShelfRecap) {
      risquePublicShelfSyncLowerStagingForStep(gs, step, idx);
      var cv0 = document.getElementById("control-voice");
      if (cv0) cv0.classList.add("ucp-control-voice--public-book-processing");
      var vt0 = document.getElementById("control-voice-text");
      if (vt0) vt0.innerHTML = "";
      var vr0 = document.getElementById("control-voice-report");
      if (vr0) {
        vr0.textContent = "";
        vr0.style.display = "none";
      }
      risquePublicShelfRunBookStepAnimation(gs, step, idx, function (choice) {
        handleAerialChoice(choice);
      });
    } else {
      risquePublicBookSetVoiceProcessing(gs, step, idx, handleAerialChoice);
    }

    if (risquePublicProcRecapAnimation(proc)) {
      if (needsAerialDecision) {
        if (Number(gs.risquePublicCardplayAerialSkipHostDecisionSeq) === Number(proc.seq)) {
          handleAerialChoice("confirmed");
          return;
        }
        try {
          localStorage.setItem(
            PUBLIC_CARDPLAY_PROCESSING_STATE_KEY,
            JSON.stringify({
              seq: Number(proc.seq) || 0,
              state: "aerial_decision",
              at: Date.now()
            })
          );
        } catch (eStepStateAerial) {
          /* ignore */
        }
        var aerialReadyDelayMs = useShelfRecap
          ? Math.max(120, (Number(risquePublicShelfRecapLeadMs(idx)) || 0) + 140)
          : 220;
        if (_pubBook.aerialReadyTimer) {
          clearTimeout(_pubBook.aerialReadyTimer);
          _pubBook.aerialReadyTimer = null;
        }
        _pubBook.aerialReadyTimer = setTimeout(function () {
          _pubBook.aerialReadyTimer = null;
          try {
            localStorage.setItem(
              PUBLIC_AERIAL_DECISION_READY_KEY,
              JSON.stringify({ seq: Number(proc.seq) || 0, ready: true, at: Date.now() })
            );
          } catch (eReadySet) {
            /* ignore */
          }
        }, aerialReadyDelayMs);
        var decisionChoice = readHostAerialDecisionForSeq(proc.seq);
        if (decisionChoice) {
          handleAerialChoice(decisionChoice);
          return;
        }
        if (_pubBook.stepTimer) {
          clearTimeout(_pubBook.stepTimer);
          _pubBook.stepTimer = null;
        }
        _pubBook.stepTimer = setTimeout(function waitHostAerialDecision() {
          _pubBook.stepTimer = null;
          var choiceNow = readHostAerialDecisionForSeq(proc.seq);
          if (!choiceNow) {
            _pubBook.stepTimer = setTimeout(waitHostAerialDecision, 160);
            return;
          }
          handleAerialChoice(choiceNow);
        }, 160);
        return;
      }
      if (_pubBook.stepTimer) {
        clearTimeout(_pubBook.stepTimer);
        _pubBook.stepTimer = null;
      }
      try {
        localStorage.setItem(
          PUBLIC_CARDPLAY_PROCESSING_STATE_KEY,
          JSON.stringify({
            seq: Number(proc.seq) || 0,
            state: "processing",
            stepIndex: Number(idx) || 0,
            at: Date.now()
          })
        );
      } catch (eStepState) {
        /* ignore */
      }
      _pubBook.focusLabel = null;
      delete gs.risquePublicCardplayHighlightLabels;
      delete gs.risquePublicCardplayHighlightMode;
      risquePublicRenderMapForBook(gs);
      var readMs = BOOK_PUBLIC_RECAP_READ_MS;
      if (step && !step.mapTerritory && !step.animateTroops) {
        readMs = BOOK_PUBLIC_RECAP_VOICE_READ_MS;
      }
      var shelfLead = useShelfRecap ? risquePublicShelfRecapLeadMs(idx) : 0;
      _pubBook.stepTimer = setTimeout(function () {
        _pubBook.stepTimer = null;
        risquePublicBookRunStepMapPart(idx, actingPlayer);
      }, readMs + shelfLead);
      return;
    }

    risquePublicBookRunStepMapPart(idx, actingPlayer);
  }

  /** Short blank beat between two aerial recap steps on the public TV (distinct beats vs one long hold). */
  function risquePublicBookClearControlVoiceBrieflyThen(done) {
    var vt = document.getElementById("control-voice-text");
    if (vt) vt.innerHTML = "";
    var vr = document.getElementById("control-voice-report");
    if (vr) {
      vr.textContent = "";
      vr.style.display = "none";
    }
    setTimeout(done, BOOK_PUBLIC_RECAP_AERIAL_GAP_MS);
  }

  function risquePublicBookScheduleAdvanceFromStep(idx, step, stepHold) {
    var proc = _pubBook.proc;
    var nextSt = proc && proc.steps && idx + 1 < proc.steps.length ? proc.steps[idx + 1] : null;
    var needAerialGap =
      proc &&
      risquePublicProcRecapAnimation(proc) &&
      step &&
      step.effect === "aerial_attack" &&
      nextSt &&
      nextSt.effect === "aerial_attack";
    _pubBook.stepTimer = setTimeout(function () {
      _pubBook.stepTimer = null;
      _pubBook.focusLabel = null;
      if (window.gameState) {
        delete window.gameState.risquePublicCardplayHighlightLabels;
        delete window.gameState.risquePublicCardplayHighlightMode;
        risquePublicRenderMapForBook(window.gameState);
      }
      function runNext() {
        risquePublicBookRunStep(idx + 1);
      }
      if (needAerialGap) {
        risquePublicBookClearControlVoiceBrieflyThen(runNext);
      } else {
        runNext();
      }
    }, stepHold);
  }

  function risquePublicBookRunStepMapPart(idx, actingPlayer) {
    var proc = _pubBook.proc;
    var gs = window.gameState;
    if (!window.gameUtils || !gs || !proc || !proc.steps || idx < 0 || idx >= proc.steps.length) {
      return;
    }
    var step = proc.steps[idx];
    actingPlayer =
      actingPlayer != null && String(actingPlayer).length
        ? String(actingPlayer)
        : String((proc.playerName || gs.currentPlayer || "") + "");

    _pubBook.focusLabel = step.mapTerritory || null;
    var mapT = step.mapTerritory;
    var stepHold = risquePublicBookStepHoldMs(step);
    var usePublicSwell = !!mapT && risquePublicProcRecapAnimation(proc);

    function clearFocusThenScheduleNext() {
      if (window.gameState) {
        risquePublicApplyStepForwardToTroopMap(_pubBook.displayTroopMap, step, actingPlayer);
        risquePublicRenderMapForBook(window.gameState);
      }
      risquePublicBookScheduleAdvanceFromStep(idx, step, stepHold);
    }

    function runTroopOrHoldAfterHighlight() {
      if (mapT && step.animateTroops && step.troopsFrom !== step.troopsTo) {
        var host0 = document.querySelector('#canvas .svg-overlay .territory-number[data-label="' + mapT + '"]');
        if (host0) {
          var pad0 = String(step.troopsFrom).padStart(3, "0");
          if (host0.tagName && host0.tagName.toLowerCase() === "text") host0.textContent = pad0;
          else host0.querySelectorAll("text").forEach(function (t) { t.textContent = pad0; });
        }
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            risquePublicBookAnimateTroops(mapT, step.troopsFrom, step.troopsTo, BOOK_PUBLIC_COUNT_MS, clearFocusThenScheduleNext);
          });
        });
      } else {
        risquePublicApplyStepForwardToTroopMap(_pubBook.displayTroopMap, step, actingPlayer);
        risquePublicRenderMapForBook(gs);
        risquePublicBookScheduleAdvanceFromStep(idx, step, stepHold);
      }
    }

    if (_pubBook.focusLabel) {
      gs.risquePublicCardplayHighlightLabels = [_pubBook.focusLabel];
    } else {
      delete gs.risquePublicCardplayHighlightLabels;
      delete gs.risquePublicCardplayHighlightMode;
      risquePublicRenderMapForBook(gs);
      runTroopOrHoldAfterHighlight();
      return;
    }

    if (usePublicSwell) {
      gs.risquePublicCardplayHighlightMode = "swell";
      risquePublicRenderMapForBook(gs);
      if (_pubBook.stepTimer) {
        clearTimeout(_pubBook.stepTimer);
        _pubBook.stepTimer = null;
      }
      _pubBook.stepTimer = setTimeout(function () {
        _pubBook.stepTimer = null;
        delete gs.risquePublicCardplayHighlightMode;
        risquePublicRenderMapForBook(gs);
        runTroopOrHoldAfterHighlight();
      }, BOOK_PUBLIC_MAP_SWELL_MS);
      return;
    }

    delete gs.risquePublicCardplayHighlightMode;
    risquePublicRenderMapForBook(gs);
    runTroopOrHoldAfterHighlight();
  }

  /** Bump when public recap DOM/logic changes so TV rebuilds after hard refresh (seq alone is not enough). */
  var RISQUE_PUBLIC_CARDPLAY_RECAP_RENDER_VER = "18";

  function risquePublicRecapCountTurnBooks(playedCards) {
    var n = 0;
    if (!Array.isArray(playedCards)) return n;
    var pi;
    for (pi = 0; pi < playedCards.length; pi++) {
      if (playedCards[pi] && playedCards[pi].action === "book") n++;
    }
    return n;
  }

  function risquePublicRecapTurnBookOrdinalAtIndex(playedCards, pi) {
    var pc = playedCards && playedCards[pi];
    if (!pc || pc.action !== "book") return null;
    var ord = 0;
    var i;
    for (i = 0; i <= pi; i++) {
      if (playedCards[i] && playedCards[i].action === "book") ord++;
    }
    return ord;
  }

  function risquePublicRecapGroupKind(g) {
    return String(g && g.kind != null ? g.kind : "").trim().toLowerCase();
  }

  function risquePublicRecapExtractBookGroups(cardGroups) {
    var books = [];
    if (!Array.isArray(cardGroups)) return books;
    var gi;
    for (gi = 0; gi < cardGroups.length; gi++) {
      var g = cardGroups[gi];
      if (g && risquePublicRecapGroupKind(g) === "book") books.push(g);
    }
    return books;
  }

  function risquePublicRecapExtractSingleGroups(cardGroups) {
    var singles = [];
    if (!Array.isArray(cardGroups)) return singles;
    var gi;
    for (gi = 0; gi < cardGroups.length; gi++) {
      var g = cardGroups[gi];
      if (g && risquePublicRecapGroupKind(g) === "single") singles.push(g);
    }
    return singles;
  }

  /** How many committed books this recap proc runs (host mirror may omit per-book cardGroups). */
  function risquePublicInferTurnBookCountFromProc(proc) {
    if (!proc || !Array.isArray(proc.steps) || proc.steps.length === 0) return 1;
    var maxO = 1;
    var i;
    for (i = 0; i < proc.steps.length; i++) {
      var s = proc.steps[i];
      if (!s || s.recapInBook !== true) continue;
      if (s.recapTurnBookOrdinal != null) {
        var to = Number(s.recapTurnBookOrdinal);
        if (Number.isFinite(to) && to > maxO) maxO = to;
      }
      if (s.recapTurnBookTotal != null) {
        var tt = Number(s.recapTurnBookTotal);
        if (Number.isFinite(tt) && tt > maxO) maxO = tt;
      }
    }
    if (maxO > 1) return maxO;
    var seg = 1;
    for (i = 0; i < proc.steps.length - 1; i++) {
      var p = proc.steps[i];
      var n = proc.steps[i + 1];
      if (
        p &&
        n &&
        p.recapInBook === true &&
        n.recapInBook === true &&
        Number(n.recapBookOrdinal) === 1 &&
        Number(p.recapBookOrdinal) !== 1
      ) {
        seg++;
      }
    }
    return Math.max(1, seg);
  }

  /**
   * Lower shelf book list: public uses recap.cardGroups as-is.
   * Host only: if recap has one book entry but proc implies N books and ids length ≥ 3N, split into N triples.
   */
  function risquePublicShelfBookGroupsForStaging(gs) {
    var recap = gs && gs.risquePublicCardplayRecap;
    var cg = recap && Array.isArray(recap.cardGroups) ? recap.cardGroups : [];
    var rawBooks = risquePublicRecapExtractBookGroups(cg);
    if (window.risqueDisplayIsPublic) return rawBooks;
    var proc = gs && gs.risquePublicBookProcessing;
    var procAnim = !!(proc && risquePublicProcRecapAnimation(proc));
    var idslHost = recap && Array.isArray(recap.cardIds) ? recap.cardIds : [];
    var nBkFlat = procAnim ? risquePublicInferTurnBookCountFromProc(proc) : 0;
    var inferredTripleBooks =
      !procAnim && idslHost.length > 3 && idslHost.length % 3 === 0 ? idslHost.length / 3 : 0;
    var nFromFlat = Math.max(nBkFlat, inferredTripleBooks);
    if (cg.length === 0 && nFromFlat > 1 && idslHost.length >= nFromFlat * 3) {
      rawBooks = [];
      var biH;
      for (biH = 0; biH < nFromFlat; biH++) {
        rawBooks.push({
          kind: "book",
          ids: idslHost.slice(biH * 3, biH * 3 + 3),
          labels: []
        });
      }
    }
    if (!proc || !risquePublicProcRecapAnimation(proc)) return rawBooks;
    var need = risquePublicInferTurnBookCountFromProc(proc);
    if (need <= 1 || rawBooks.length !== 1) return rawBooks;
    var g0 = rawBooks[0];
    if (!g0 || !Array.isArray(g0.ids) || g0.ids.length < need * 3) return rawBooks;
    var ids = g0.ids;
    var labels = Array.isArray(g0.labels) ? g0.labels : [];
    var syn = [];
    var b;
    for (b = 0; b < need; b++) {
      syn.push({
        kind: "book",
        ids: ids.slice(b * 3, b * 3 + 3),
        labels: labels.slice(b * 3, b * 3 + 3)
      });
    }
    return syn;
  }

  /** Replace lower shelf staging row (one book at a time, then singles). */
  function risquePublicShelfRebuildLowerContent(gs, lowerSpec) {
    var overlay = document.getElementById("risque-public-cardplay-recap-overlay");
    if (!overlay || !gs || !lowerSpec) return;
    var shelfLower = overlay.querySelector(".risque-public-cp-shelf-lower");
    if (!shelfLower) return;
    var existingRow = shelfLower.querySelector(".risque-public-cp-shelf-lower__cards");
    if (existingRow) existingRow.remove();

    function appendCardToSlot(parent, rawId) {
      if (!parent) return;
      var sid =
        typeof risquePublicSanitizeCardImageId === "function"
          ? risquePublicSanitizeCardImageId(rawId)
          : String(rawId || "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "");
      if (!sid) return;
      var img = document.createElement("img");
      img.className = "risque-public-cp-shelf-card";
      img.src = "assets/images/Cards/" + String(sid || "").toUpperCase() + ".webp";
      img.alt = "";
      img.setAttribute("loading", "lazy");
      parent.appendChild(img);
    }

    var row = document.createElement("div");
    row.className = "risque-public-cardplay-recap-cards risque-public-cp-shelf-lower__cards";

    if (lowerSpec.mode === "book") {
      var wrap = document.createElement("div");
      wrap.className = "risque-public-cardplay-recap-book-group risque-public-cp-shelf-lower__book";
      var bookHead = document.createElement("div");
      bookHead.className = "risque-public-cardplay-recap-book-heading";
      var bt = Number(lowerSpec.bookTotal) || 1;
      var bo = Number(lowerSpec.bookOrdinal) || 1;
      bookHead.textContent = bt <= 1 ? "BOOK" : "BOOK " + bo + " OF " + bt;
      wrap.appendChild(bookHead);
      var cardHost = document.createElement("div");
      cardHost.className = "risque-public-cardplay-recap-book-row";
      wrap.appendChild(cardHost);
      var g = lowerSpec.group;
      if (g && Array.isArray(g.ids)) {
        var zi;
        for (zi = 0; zi < g.ids.length; zi++) {
          var col = document.createElement("div");
          col.className = "risque-public-cp-shelf-card-slot";
          appendCardToSlot(col, g.ids[zi]);
          cardHost.appendChild(col);
        }
      }
      row.appendChild(wrap);
    } else if (lowerSpec.mode === "singles" && Array.isArray(lowerSpec.groups)) {
      var si;
      for (si = 0; si < lowerSpec.groups.length; si++) {
        var sg = lowerSpec.groups[si];
        if (!sg || !Array.isArray(sg.ids)) continue;
        var swrap = document.createElement("div");
        swrap.className = "risque-public-cardplay-recap-single-cluster risque-public-cp-shelf-lower__singles";
        var sj;
        for (sj = 0; sj < sg.ids.length; sj++) {
          var scol = document.createElement("div");
          scol.className = "risque-public-cp-shelf-card-slot";
          appendCardToSlot(scol, sg.ids[sj]);
          swrap.appendChild(scol);
        }
        row.appendChild(swrap);
      }
    } else if (lowerSpec.mode === "flat" && Array.isArray(lowerSpec.ids)) {
      var ii;
      for (ii = 0; ii < lowerSpec.ids.length; ii++) {
        var slot0 = document.createElement("div");
        slot0.className = "risque-public-cp-shelf-card-slot";
        appendCardToSlot(slot0, lowerSpec.ids[ii]);
        row.appendChild(slot0);
      }
    }

    if (row.childNodes.length) shelfLower.appendChild(row);
  }

  /**
   * Which committed turn book (1-based) this step belongs to — mirror JSON often drops recapTurnBookOrdinal,
   * so we match playedCardKey against recap cardGroups, then infer from recapBookOrdinal boundaries.
   */
  function risquePublicShelfInferTurnBookOrdinalFromSteps(proc, stepIdx, booksLen) {
    if (!proc || !Array.isArray(proc.steps) || booksLen <= 1 || stepIdx < 0 || stepIdx >= proc.steps.length) {
      return 1;
    }
    var bookNum = 1;
    var i;
    for (i = 0; i < stepIdx; i++) {
      var p = proc.steps[i];
      var n = proc.steps[i + 1];
      if (
        p &&
        n &&
        p.recapInBook === true &&
        n.recapInBook === true &&
        Number(n.recapBookOrdinal) === 1 &&
        Number(p.recapBookOrdinal) !== 1
      ) {
        bookNum++;
      }
    }
    return Math.min(Math.max(1, bookNum), booksLen);
  }

  function risquePublicShelfResolveTurnBookOrdinal(proc, stepIdx, step, books) {
    var bl = Array.isArray(books) ? books.length : 0;
    if (bl <= 1) return 1;
    var pk =
      step && step.playedCardKey
        ? typeof risquePublicSanitizeCardImageId === "function"
          ? risquePublicSanitizeCardImageId(step.playedCardKey)
          : String(step.playedCardKey || "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "")
        : "";
    if (pk) {
      var bi;
      for (bi = 0; bi < bl; bi++) {
        var ids = books[bi] && Array.isArray(books[bi].ids) ? books[bi].ids : [];
        var ki;
        for (ki = 0; ki < ids.length; ki++) {
          var sid =
            typeof risquePublicSanitizeCardImageId === "function"
              ? risquePublicSanitizeCardImageId(ids[ki])
              : String(ids[ki] || "")
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, "");
          if (sid && sid === pk) return bi + 1;
        }
      }
    }
    var inferred = risquePublicShelfInferTurnBookOrdinalFromSteps(proc, stepIdx, bl);
    if (Number.isFinite(inferred) && inferred >= 1 && inferred <= bl) return inferred;
    var om = step && step.recapTurnBookOrdinal != null ? Number(step.recapTurnBookOrdinal) : NaN;
    if (Number.isFinite(om) && om >= 1 && om <= bl) return om;
    return 1;
  }

  function risquePublicShelfSyncLowerStagingForStep(gs, step, stepIdx) {
    if (!risquePublicShelfOverlayHasShelfPanel() || !gs || !gs.risquePublicCardplayRecap) return;
    var recap = gs.risquePublicCardplayRecap;
    var groupsRaw = recap.cardGroups;
    var books = risquePublicShelfBookGroupsForStaging(gs);
    var singles = risquePublicRecapExtractSingleGroups(Array.isArray(groupsRaw) ? groupsRaw : []);
    var key;
    var spec = null;
    var onBookStep = !!(step && step.recapInBook === true && books.length > 0);
    if (onBookStep) {
      var procRef = _pubBook.proc || gs.risquePublicBookProcessing;
      var idxUse = typeof stepIdx === "number" && stepIdx >= 0 ? stepIdx : _pubBook.stepIndex || 0;
      var ord = risquePublicShelfResolveTurnBookOrdinal(procRef, idxUse, step, books);
      var grp = books[ord - 1];
      if (!grp) return;
      key = "book:" + ord;
      spec = { mode: "book", bookOrdinal: ord, bookTotal: books.length, group: grp };
    } else if (!onBookStep && singles.length > 0) {
      /* Never swap to singles while a book step is resolving — avoids wiping the 3-card row mid-turn. */
      key = "singles";
      spec = { mode: "singles", groups: singles };
    }
    if (!spec || !key) return;
    if (_pubBook.shelfStagingKey === key) return;
    _pubBook.shelfStagingKey = key;
    risquePublicShelfRebuildLowerContent(gs, spec);
  }

  /** Map recap step → lower shelf slot index (book: recapBookOrdinal − 1; singles: count prior non-book steps). */
  function risquePublicShelfLowerVisualStepIndex(proc, stepIdx) {
    if (!proc || !proc.steps || stepIdx < 0 || stepIdx >= proc.steps.length) return stepIdx;
    var st = proc.steps[stepIdx];
    if (st && st.recapInBook === true) {
      var cardOrd = st.recapBookOrdinal != null ? Number(st.recapBookOrdinal) : NaN;
      if (Number.isFinite(cardOrd) && cardOrd >= 1) {
        return Math.max(0, Math.floor(cardOrd - 1));
      }
      var turnOrd = st.recapTurnBookOrdinal != null ? Number(st.recapTurnBookOrdinal) : NaN;
      if (Number.isFinite(turnOrd)) {
        var local = 0;
        var i;
        for (i = 0; i < stepIdx; i++) {
          var p = proc.steps[i];
          if (p && p.recapInBook === true && Number(p.recapTurnBookOrdinal) === turnOrd) local++;
        }
        return local;
      }
    }
    var locS = 0;
    var j;
    for (j = 0; j < stepIdx; j++) {
      var q = proc.steps[j];
      if (!q || q.recapInBook !== true) locS++;
    }
    return locS;
  }

  /** Public recap: troop removal shows “-2” (minus + number) in red, not the word “negative”. */
  function risquePublicRecapCaptionDeltaText(Lc) {
    if (!Lc) return "";
    var raw =
      Lc.combined != null
        ? String(Lc.combined).trim()
        : Lc.value != null
          ? String(Lc.value).trim()
          : "";
    if (Lc.tone === "neg" && (raw === "-2" || raw === "−2")) {
      return "-2";
    }
    return raw;
  }

  /**
   * Older saved games store pre-change bullet strings (e.g. "TERR : +2"). Normalize at paint time.
   */
  function risquePublicNormalizeRecapBulletText(line) {
    var s = String(line || "").trim();
    if (!s) return s;
    if (/^BOOK\s*:/i.test(s)) return s;
    var m = s.match(/^(.+?)\s*:\s*\+2(?:\s+TROOPS)?/i);
    if (m) return m[1].trim();
    m = s.match(/^(.+?)\s*:\s*-2(?:\s+TROOPS)?/i);
    if (m) return m[1].trim();
    m = s.match(/^(.+?)\s*:\s*ACQUIRED\s*$/i);
    if (m) return m[1].trim();
    m = s.match(/^(.+?)\s*:\s*NO\s+EFFECT\s*$/i);
    if (m) return m[1].trim();
    if (s === "AERIAL ATTACK" || /^AERIAL\s*ATTACK\s*$/i.test(s)) return "WILDCARD";
    if (/^WILDCARD\s*:\s*/i.test(s)) return "WILDCARD";
    return s;
  }

  /** Older cardGroups used title (e.g. N.W.) + value (+2); show delta only under the card. */
  function risquePublicNormalizeRecapLabel(L) {
    if (!L) return {};
    if (L.wildSideLabel) return L;
    if (L.skipCaption) return L;
    if (L.combined) return L;
    var val = L.value != null ? String(L.value).trim() : "";
    var tit = L.title != null ? String(L.title).trim() : "";
    if (tit && (val === "+2" || val === "-2")) {
      return {
        combined: val,
        tone: val === "-2" ? "neg" : "pos",
        skipCaption: false,
        isAerial: !!L.isAerial,
        acquireStrokeColor: L.acquireStrokeColor || null
      };
    }
    return L;
  }

  /**
   * TV: read-only summary after host CONFIRM — embedded in #hud-main-panel so the map stays visible;
   * full-screen fallback only if the panel is missing.
   */
  function risquePublicEnsureCardplayRecapPanel(gs) {
    if (!gs) return;
    var ph = String(gs.phase || "");
    var overlayId = "risque-public-cardplay-recap-overlay";
    function removeRecapOverlay() {
      risquePublicClearStaticRecapAckTimer();
      var el = document.getElementById(overlayId);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      window.__risquePublicCardplayRecapDomSeq = null;
      var rhRm = document.getElementById("runtime-hud-root");
      if (rhRm) {
        rhRm.classList.remove("runtime-hud-root--public-cardplay-recap");
        rhRm.classList.remove("runtime-hud-root--host-cardplay-recap");
      }
    }
    if (ph !== "cardplay" && ph !== "con-cardplay") {
      removeRecapOverlay();
      return;
    }
    var recap = gs.risquePublicCardplayRecap;
    if (!recap || !Array.isArray(recap.lines) || recap.lines.length === 0) {
      removeRecapOverlay();
      return;
    }
    var seq = Number(recap.seq) || 0;
    var existing = document.getElementById(overlayId);
    if (
      existing &&
      Number(existing.getAttribute("data-recap-seq")) === seq &&
      String(existing.getAttribute("data-recap-render-v") || "") === RISQUE_PUBLIC_CARDPLAY_RECAP_RENDER_VER
    ) {
      /* Host only: heal stale lower shelves (multi-book rows or wide strips). Public path unchanged. */
      if (!window.risqueDisplayIsPublic) {
        var booksInDomHeal = existing.querySelectorAll(".risque-public-cp-shelf-lower__book").length;
        var slotHealCt = existing.querySelectorAll(".risque-public-cp-shelf-lower .risque-public-cp-shelf-card-slot")
          .length;
        var cgHealHost = Array.isArray(recap.cardGroups) ? recap.cardGroups : [];
        var bookGsHeal = risquePublicShelfBookGroupsForStaging(gs);
        var singleGsHeal = risquePublicRecapExtractSingleGroups(cgHealHost);
        var procHealHost = gs.risquePublicBookProcessing;
        var animHealHost = !!(procHealHost && risquePublicProcRecapAnimation(procHealHost));
        var flatHealHost = Array.isArray(recap.cardIds) ? recap.cardIds.length : 0;
        var expectStagedOneBookHost =
          bookGsHeal.length > 1 ||
          (animHealHost && bookGsHeal.length >= 1 && singleGsHeal.length > 0) ||
          flatHealHost > 3;
        var domStagedOneBookOkHost =
          booksInDomHeal === 1 && slotHealCt >= 1 && slotHealCt <= 3;
        if ((expectStagedOneBookHost && !domStagedOneBookOkHost) || slotHealCt > 3) {
          removeRecapOverlay();
          existing = document.getElementById(overlayId);
        } else {
          return;
        }
      } else {
        return;
      }
    }
    if (existing) removeRecapOverlay();
    window.__risquePublicCardplayRecapDomSeq = seq;
    var overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.className = "risque-public-cardplay-recap-overlay";
    overlay.setAttribute("data-recap-seq", String(seq));
    overlay.setAttribute("data-recap-render-v", RISQUE_PUBLIC_CARDPLAY_RECAP_RENDER_VER);
    overlay.setAttribute("role", "dialog");
    var panel = document.createElement("div");
    panel.className = "risque-public-cardplay-recap-panel risque-public-cardplay-recap-panel--shelf";
    var shelfUpper = document.createElement("div");
    shelfUpper.className = "risque-public-cp-shelf-upper";
    shelfUpper.setAttribute("role", "region");
    shelfUpper.setAttribute("aria-label", "Display area");
    var shelfUpperContent = document.createElement("div");
    shelfUpperContent.id = "risque-public-cp-shelf-upper-content";
    shelfUpperContent.className = "risque-public-cp-shelf-upper-content";
    shelfUpperContent.setAttribute("aria-live", "polite");
    shelfUpper.appendChild(shelfUpperContent);
    var shelfLower = document.createElement("div");
    shelfLower.className = "risque-public-cp-shelf-lower";
    shelfLower.setAttribute("role", "region");
    shelfLower.setAttribute("aria-label", "Cards played this turn");
    panel.appendChild(shelfUpper);
    panel.appendChild(shelfLower);
    var recapPopIdx = 0;
    /** Public shelf (design pass): image only — no effect captions, wild side badges, or step labels. */
    function shelfLowerAppendCardImageOnly(parent, rawId) {
      if (!parent) return;
      var sid =
        typeof risquePublicSanitizeCardImageId === "function"
          ? risquePublicSanitizeCardImageId(rawId)
          : String(rawId || "")
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "");
      if (!sid) return;
      var img = document.createElement("img");
      img.className = "risque-public-cp-shelf-card";
      img.src = "assets/images/Cards/" + String(sid || "").toUpperCase() + ".webp";
      img.alt = "";
      img.setAttribute("loading", "lazy");
      parent.appendChild(img);
      recapPopIdx += 1;
    }
    var groups = Array.isArray(recap.cardGroups) && recap.cardGroups.length ? recap.cardGroups : null;
    if (!groups && !window.risqueDisplayIsPublic) {
      var stagingFallback = risquePublicShelfBookGroupsForStaging(gs);
      if (stagingFallback.length > 1) groups = stagingFallback;
    }
    if (groups) {
      var row = document.createElement("div");
      row.className = "risque-public-cardplay-recap-cards risque-public-cp-shelf-lower__cards";
      var procEff = gs.risquePublicBookProcessing;
      var animRecap = !!(procEff && risquePublicProcRecapAnimation(procEff));
      var bookGs = risquePublicShelfBookGroupsForStaging(gs);
      var singleGs = risquePublicRecapExtractSingleGroups(groups);

      function appendGroupToRow(g, bookHeadingText) {
        if (!g || !Array.isArray(g.ids)) return;
        var gKind = risquePublicRecapGroupKind(g);
        var wrap = document.createElement("div");
        wrap.className =
          gKind === "book"
            ? "risque-public-cardplay-recap-book-group risque-public-cp-shelf-lower__book"
            : "risque-public-cardplay-recap-single-cluster risque-public-cp-shelf-lower__singles";
        var cardHost = wrap;
        if (gKind === "book") {
          var bookHead = document.createElement("div");
          bookHead.className = "risque-public-cardplay-recap-book-heading";
          bookHead.textContent =
            bookHeadingText != null ? String(bookHeadingText) : "BOOK";
          wrap.appendChild(bookHead);
          cardHost = document.createElement("div");
          cardHost.className = "risque-public-cardplay-recap-book-row";
          wrap.appendChild(cardHost);
        }
        var zi;
        for (zi = 0; zi < g.ids.length; zi++) {
          var col = document.createElement("div");
          col.className = "risque-public-cp-shelf-card-slot";
          shelfLowerAppendCardImageOnly(col, g.ids[zi]);
          cardHost.appendChild(col);
        }
        if (wrap.childNodes.length) row.appendChild(wrap);
      }

      /* Multi-book: always one book in the lower shelf (host + public). Book+singles: same once recap animation runs. */
      var stagedBooksOnly =
        bookGs.length > 1 ||
        (animRecap && bookGs.length >= 1 && singleGs.length > 0);
      if (stagedBooksOnly) {
        _pubBook.shelfStagingKey = "book:1";
        var head0 =
          bookGs.length <= 1 ? "BOOK" : "BOOK 1 OF " + bookGs.length;
        appendGroupToRow(bookGs[0], head0);
      } else {
        _pubBook.shelfStagingKey =
          animRecap && bookGs.length === 1 && singleGs.length === 0 ? "book:1" : null;
        var gi;
        for (gi = 0; gi < groups.length; gi++) {
          appendGroupToRow(groups[gi], null);
        }
      }
      if (row.childNodes.length) shelfLower.appendChild(row);
    } else {
      _pubBook.shelfStagingKey = null;
      var rawIds = Array.isArray(recap.cardIds) ? recap.cardIds : [];
      if (rawIds.length > 0) {
        var rowFlat = document.createElement("div");
        rowFlat.className = "risque-public-cardplay-recap-cards risque-public-cp-shelf-lower__cards";
        var ii;
        for (ii = 0; ii < rawIds.length; ii++) {
          var slot0 = document.createElement("div");
          slot0.className = "risque-public-cp-shelf-card-slot";
          shelfLowerAppendCardImageOnly(slot0, rawIds[ii]);
          rowFlat.appendChild(slot0);
        }
        if (rowFlat.childNodes.length) shelfLower.appendChild(rowFlat);
      }
    }
    overlay.appendChild(panel);
    function finalizePublicRecapAttachment() {
      try {
        maybeEnsureRuntimeHud(gs);
      } catch (eHud) {
        /* ignore */
      }
      var mainPanel = document.getElementById("hud-main-panel");
      var rh = document.getElementById("runtime-hud-root");
      if (mainPanel) {
        overlay.classList.add("risque-public-cardplay-recap-overlay--in-panel");
        mainPanel.appendChild(overlay);
        if (rh) {
          rh.classList.add(
            window.risqueDisplayIsPublic
              ? "runtime-hud-root--public-cardplay-recap"
              : "runtime-hud-root--host-cardplay-recap"
          );
        }
      } else {
        document.body.appendChild(overlay);
      }
    }
    finalizePublicRecapAttachment();
    /* First paint may run before runtime HUD mounts; re-attach into #hud-main-panel next frame if needed. */
    if (overlay.parentNode === document.body) {
      requestAnimationFrame(function () {
        if (!overlay.parentNode) return;
        overlay.parentNode.removeChild(overlay);
        overlay.classList.remove("risque-public-cardplay-recap-overlay--in-panel");
        var rh0 = document.getElementById("runtime-hud-root");
        if (rh0) {
          rh0.classList.remove("runtime-hud-root--public-cardplay-recap");
          rh0.classList.remove("runtime-hud-root--host-cardplay-recap");
        }
        finalizePublicRecapAttachment();
      });
    }
    risquePublicClearStaticRecapAckTimer();
    var staticReadMs = Math.max(BOOK_PUBLIC_SUMMARY_MS, 900 + recapPopIdx * 55);
    if (gs.risquePublicCardplayRecapAckRequiredSeq != null && String(gs.phase || "") === "cardplay") {
      var ackSeqStatic = Number(gs.risquePublicCardplayRecapAckRequiredSeq);
      window.__risqueStaticRecapAckT = setTimeout(function () {
        window.__risqueStaticRecapAckT = null;
        try {
          localStorage.setItem(
            "risquePublicCardplayRecapAck",
            JSON.stringify({ seq: ackSeqStatic, at: Date.now() })
          );
        } catch (eAckStatic) {
          /* ignore */
        }
      }, staticReadMs);
    }
  }

  /** Public TV: one line for current player’s hand size (mirrored from host, no card names). */
  function risquePublicFormatCardplaySpectatorHandLine(gs) {
    if (!gs) return "";
    var n = gs.risquePublicCardplaySpectatorHandCount;
    var disp = gs.risquePublicCardplaySpectatorPlayer != null ? String(gs.risquePublicCardplaySpectatorPlayer).trim() : "";
    if (!disp && gs.currentPlayer) {
      var nm = String(gs.currentPlayer);
      disp = nm.charAt(0).toUpperCase() + nm.slice(1);
    }
    if (!disp) disp = "Player";
    if (typeof n !== "number" || !Number.isFinite(n)) {
      var cp = gs.currentPlayer;
      var pl =
        gs.players && Array.isArray(gs.players)
          ? gs.players.find(function (p) {
              return p && p.name === cp;
            })
          : null;
      n = pl && Array.isArray(pl.cards) ? pl.cards.length : pl && pl.cardCount != null ? Number(pl.cardCount) : 0;
      if (!Number.isFinite(n)) n = 0;
    }
    n = Math.max(0, Math.floor(n));
    return disp + " has " + n + " card" + (n === 1 ? "" : "s") + " in hand.";
  }
  window.risquePublicFormatCardplaySpectatorHandLine = risquePublicFormatCardplaySpectatorHandLine;

  /**
   * TV: show “CARD PLAY IS PRIVATE” + hand count under the turn banner during draft cardplay; mirror updates
   * often skip cardplay.mount(), so inject here. Hide during committed-book recap (summary/step).
   */
  function risquePublicEnsureCardplayPrivateHint(gs) {
    if (!window.risqueDisplayIsPublic || !gs) return;
    var ph = String(gs.phase || "");
    var slot = document.getElementById("risque-phase-content");
    /* Cardplay injects this hint; mirror updates do not always replace #risque-phase-content — clear it when leaving cardplay (e.g. income reveal). */
    if (ph !== "cardplay" && ph !== "con-cardplay") {
      if (slot) {
        var staleHint = slot.querySelector(".risque-public-private-hint");
        if (staleHint) staleHint.remove();
      }
      return;
    }
    if (!slot) return;
    if (document.getElementById("risque-public-cardplay-recap-overlay")) {
      return;
    }
    var bookPhase =
      typeof window.risquePublicBookSequencePhase === "function"
        ? String(window.risquePublicBookSequencePhase() || "")
        : "idle";
    var pubRecapLines =
      gs.risquePublicCardplayRecap &&
      Array.isArray(gs.risquePublicCardplayRecap.lines) &&
      gs.risquePublicCardplayRecap.lines.length > 0;
    var cardplayDraftBlocksBookAnim =
      String(gs.phase || "") === "cardplay" &&
      !gs.risqueCardplayTvRecapPublished &&
      !pubRecapLines;
    var inBookAnim =
      !cardplayDraftBlocksBookAnim &&
      gs.risquePublicBookProcessing &&
      Array.isArray(gs.risquePublicBookProcessing.steps) &&
      gs.risquePublicBookProcessing.steps.length > 0 &&
      (bookPhase === "summary" || bookPhase === "step");
    if (inBookAnim) {
      if (slot.querySelector(".risque-public-private-hint")) {
        slot.innerHTML = "";
      }
      return;
    }
    var countText = risquePublicFormatCardplaySpectatorHandLine(gs);
    var countEl = document.getElementById("risque-public-cardplay-hand-count");
    if (!slot.querySelector(".risque-public-private-hint")) {
      slot.innerHTML =
        '<div class="risque-public-private-hint" role="status">' +
        '<p class="risque-public-private-hint__lead">Card play is private — use the host screen to play cards.</p>' +
        '<p id="risque-public-cardplay-hand-count" class="risque-public-private-hint__count" aria-live="polite"></p>' +
        "</div>";
      countEl = document.getElementById("risque-public-cardplay-hand-count");
    }
    if (countEl) {
      countEl.textContent = countText;
    }
  }

  function risquePublicSyncLoginFadeOverlay(gs) {
    if (!window.risqueDisplayIsPublic || !gs) return;
    var id = "risque-public-login-fade-overlay";
    var el = document.getElementById(id);
    var wantBlack =
      Number(gs.risquePublicLoginTvBlackout) === 1 ||
      (String(gs.phase || "") === "login" && !!gs.risquePublicLoginHostFade);
    if (wantBlack) {
      if (risquePublicLoginFadeOutDeferT) {
        clearTimeout(risquePublicLoginFadeOutDeferT);
        risquePublicLoginFadeOutDeferT = null;
      }
      risquePublicLoginFadeInAtMs = Date.now();
      if (!el) {
        el = document.createElement("div");
        el.id = id;
        el.className = "risque-public-login-fade-overlay";
        el.setAttribute("aria-hidden", "true");
        document.body.appendChild(el);
      }
      if (el) {
        void el.offsetHeight;
      }
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (el && document.body.contains(el)) {
            el.classList.add("risque-public-login-fade-overlay--visible");
          }
        });
      });
      return;
    }
    if (el && el.classList.contains("risque-public-login-fade-overlay--visible")) {
      if (risquePublicLoginFadeOutDeferT) {
        clearTimeout(risquePublicLoginFadeOutDeferT);
        risquePublicLoginFadeOutDeferT = null;
      }
      var removeEl = function () {
        if (el && el.parentNode) {
          el.parentNode.removeChild(el);
        }
        risquePublicLoginFadeInAtMs = 0;
      };
      var startDissolveOut = function () {
        el.classList.remove("risque-public-login-fade-overlay--visible");
        el.addEventListener("transitionend", function onEnd() {
          el.removeEventListener("transitionend", onEnd);
          removeEl();
        });
        setTimeout(removeEl, RISQUE_PUBLIC_LOGIN_FADEIN_MS + 200);
      };
      var minAt =
        risquePublicLoginFadeInAtMs +
        RISQUE_PUBLIC_LOGIN_FADEIN_MS +
        RISQUE_PUBLIC_LOGIN_FADE_SLACK_MS;
      var waitMs =
        risquePublicLoginFadeInAtMs > 0 ? Math.max(0, minAt - Date.now()) : 0;
      if (waitMs > 0) {
        risquePublicLoginFadeOutDeferT = setTimeout(function () {
          risquePublicLoginFadeOutDeferT = null;
          startDissolveOut();
        }, waitMs);
        return;
      }
      startDissolveOut();
    }
  }

  /** Public TV: full-screen elimination splash during Wayback (replay-machine mirrors risquePublicReplayEliminationSplash). */
  function risquePublicSyncReplayEliminationSplash(gs) {
    if (!window.risqueDisplayIsPublic) return;
    try {
      var active = !!(gs && gs.risqueReplayPlaybackActive);
      if (!active) {
        var elOff = document.getElementById("risque-replay-splash");
        if (elOff && elOff.parentNode) elOff.parentNode.removeChild(elOff);
        return;
      }
      var sp = gs && gs.risquePublicReplayEliminationSplash;
      if (!sp || sp.conqueror == null || sp.defeated == null) {
        var el0 = document.getElementById("risque-replay-splash");
        if (el0 && el0.parentNode) el0.parentNode.removeChild(el0);
        return;
      }
      var sig =
        String(sp.conqueror || "") +
        "|" +
        String(sp.defeated || "") +
        "|" +
        String(sp.at != null ? sp.at : "");
      var existing = document.getElementById("risque-replay-splash");
      if (existing && existing.getAttribute("data-risque-elim-sig") === sig) return;
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      var conq = String(sp.conqueror || "").trim() || "?";
      var def = String(sp.defeated || "").trim() || "?";
      var root = document.createElement("div");
      root.id = "risque-replay-splash";
      root.setAttribute("data-risque-elim-sig", sig);
      root.className = "risque-replay-splash risque-replay-splash--elimination";
      root.setAttribute("role", "status");
      root.setAttribute("aria-live", "assertive");
      var line = document.createElement("div");
      line.className = "risque-replay-splash-line risque-replay-splash-line--elimination";
      line.textContent = conq + " has conquered " + def;
      root.appendChild(line);
      document.body.appendChild(root);
    } catch (eElimPub) {
      /* ignore */
    }
  }

  /** Public TV: when Wayback mirrors frames, show round + strip stats/attack chrome (see game.css). */
  function risquePublicSyncWaybackMirrorChrome(gs) {
    if (!window.risqueDisplayIsPublic) return;
    try {
      var head = document.getElementById("risque-public-wayback-head");
      var numEl = document.getElementById("risque-public-wayback-round-num");
      var active = !!(gs && gs.risqueReplayPlaybackActive);
      if (active) {
        document.documentElement.classList.add("risque-public-wayback-mirror");
        if (head) {
          head.removeAttribute("hidden");
          head.setAttribute("aria-hidden", "false");
        }
        if (numEl && gs) {
          if (String(gs.risqueReplayMachineHudPhase || "") === "deal") {
            numEl.textContent = "Dealing";
          } else {
            var rRaw = gs.risqueReplayHudRound != null ? gs.risqueReplayHudRound : gs.round;
            var n = typeof rRaw === "number" ? rRaw : parseInt(String(rRaw), 10);
            if (!isFinite(n) || n < 1) n = 1;
            numEl.textContent = String(n);
          }
        }
      } else {
        document.documentElement.classList.remove("risque-public-wayback-mirror");
        if (head) {
          head.setAttribute("hidden", "");
          head.setAttribute("aria-hidden", "true");
        }
      }
    } catch (eWb) {
      /* ignore */
    }
  }

  function risquePublicMirrorGameStateApply(gs) {
    if (!gs) return;
    risquePublicBookSequenceOnIncomingState(gs);
    if (window.risqueDisplayIsPublic) {
      /* Host-only fallback; public render ignores this for warpath (uses gameState.risquePublicCampaignWarpathLabels). */
      window.__risqueCampaignWarpathLabels = Array.isArray(gs.risquePublicCampaignWarpathLabels)
        ? gs.risquePublicCampaignWarpathLabels.slice()
        : [];
    }
    window.gameState = gs;
    /* Keep boot `state` in sync so a late refreshVisuals() rAF cannot wipe mirror-only fields (e.g. name-roulette flash). */
    if (window.risqueDisplayIsPublic) {
      state = gs;
    }
    syncPhaseDataAttr(gs);
    if (window.risqueDisplayIsPublic) {
      ensurePublicHostlikeRoundIndicatorStrip();
      syncMapRoundIndicatorFromState(gs);
      risquePublicSyncLoginFadeOverlay(gs);
      risquePublicSyncWaybackMirrorChrome(gs);
      risquePublicSyncReplayEliminationSplash(gs);
    }
    if (!window.gameUtils) {
      if (window.risqueDisplayIsPublic) {
        try {
          window.__risquePublicMirrorAppliedRaw = localStorage.getItem(PUBLIC_MIRROR_KEY);
        } catch (eSync) {
          /* ignore */
        }
        if (gs && gs.phase != null) {
          publicMirrorLastPhase = String(gs.phase);
        }
        if (
          String(gs.phase || "") === "login" &&
          window.risquePhases &&
          window.risquePhases.login &&
          typeof window.risquePhases.login.applyPublicLoginFormMirror === "function"
        ) {
          try {
            window.risquePhases.login.applyPublicLoginFormMirror(gs);
          } catch (eLM) {
            /* ignore */
          }
        }
        try {
          risqueApplyConditionTally(gs);
        } catch (eTallyEarly) {
          /* ignore */
        }
      }
      return;
    }
    try {
      maybeEnsureRuntimeHud(gs);
      if (!_pubBook.skipTerritoryRedraw) {
        if (window.risqueDisplayIsPublic) {
          var dealPopTv = "";
          if (String(gs.phase || "") === "deal" && gs.risquePublicDealPopTerritory != null) {
            dealPopTv = String(gs.risquePublicDealPopTerritory).trim();
          }
          if (dealPopTv) {
            var dealSeqTv = Number(gs.risquePublicMirrorSeq) || 0;
            var dealKeyTv = dealSeqTv + "|" + dealPopTv;
            if (dealKeyTv !== window.__risquePublicDealPopAppliedKey) {
              window.__risquePublicDealPopAppliedKey = dealKeyTv;
              window.gameUtils.renderTerritories(dealPopTv, gs, {}, { popIn: true });
            }
            /* Same mirror JSON on storage poll — do not full redraw; it would interrupt the r transition. */
          } else {
            risquePublicRenderMapForBook(gs);
          }
        } else if (_pubBook.displayTroopMap && (_pubBook.phase === "summary" || _pubBook.phase === "step")) {
          risquePublicRenderMapForBook(gs);
        } else {
          window.gameUtils.renderTerritories(null, gs);
        }
      }
      window.gameUtils.renderStats(gs);
    } catch (eR) {
      /* ignore */
    }
    if (
      window.risqueDisplayIsPublic &&
      gs &&
      gs.risqueTransferPulse &&
      window.gameUtils &&
      typeof window.gameUtils.risqueStartTransferPulseTicker === "function"
    ) {
      var rtpPub = gs.risqueTransferPulse;
      var rtpDur = Number.isFinite(rtpPub.durationMs) ? rtpPub.durationMs : 1000;
      if (Date.now() - rtpPub.startMs < rtpDur) {
        window.gameUtils.risqueStartTransferPulseTicker();
      }
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
      try {
        window.risqueRuntimeHud.updateTurnBannerFromState(gs);
      } catch (eB) {
        /* ignore */
      }
    }
    if (!window.risqueDisplayIsPublic) {
      risquePublicApplyDiceAndBattleReadout(gs);
    } else if (String(gs.phase || "") === "attack") {
      risquePublicApplyDiceAndBattleReadout(gs);
    }
    risquePublicApplyVoiceAndLogMirror(gs);
    /* Host runs this from refreshVisuals; public only mirrors — show the same win celebration on TV. */
    if (
      window.risqueDisplayIsPublic &&
      gs &&
      gs.risqueGameWinImmediate &&
      gs.winner &&
      typeof window.risqueMountImmediateGameWinOverlay === "function"
    ) {
      try {
        window.risqueMountImmediateGameWinOverlay(gs.winner);
      } catch (eWinOvPub) {
        /* ignore */
      }
    }
    risquePublicSyncCardplayStrip(gs);
    risquePublicEnsureCardplayRecapPanel(gs);
    if (window.risqueDisplayIsPublic) {
      risquePublicEnsureCardplayPrivateHint(gs);
      risquePublicTryScheduleIncomeGateRelease(gs);
    }
    if (typeof window.risqueConquerSyncCelebrationFromState === "function") {
      try {
        window.risqueConquerSyncCelebrationFromState(gs);
      } catch (eCqSync) {
        /* ignore */
      }
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.syncPosition();
      });
    }
    /* Map phases after reinforce (e.g. receivecard): must run clear when aerial is gone, not only attack/reinforce. */
    if (window.risqueDisplayIsPublic) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            (function () {
              var ap =
                gs &&
                gs.risqueAerialLinkPending &&
                typeof gs.risqueAerialLinkPending === "object" &&
                gs.risqueAerialLinkPending.source &&
                gs.risqueAerialLinkPending.target
                  ? gs.risqueAerialLinkPending
                  : null;
              var ad =
                gs && gs.aerialAttack && typeof gs.aerialAttack === "object" && gs.aerialAttack.source && gs.aerialAttack.target
                  ? gs.aerialAttack
                  : null;
              var al = ap || ad;
              if (al && typeof window.risqueRedrawAerialBridgeOverlay === "function") {
                window.risqueRedrawAerialBridgeOverlay();
              } else if (typeof window.risqueClearAerialBridgeOverlay === "function") {
                window.risqueClearAerialBridgeOverlay();
              }
            })();
          } catch (eAerialPub) {
            /* ignore */
          }
        });
      });
    }
    if (window.risqueDisplayIsPublic) {
      try {
        window.__risquePublicMirrorAppliedRaw = localStorage.getItem(PUBLIC_MIRROR_KEY);
      } catch (eSync) {
        /* ignore */
      }
      if (gs && gs.phase != null) {
        publicMirrorLastPhase = String(gs.phase);
      }
      if (
        String(gs.phase || "") === "login" &&
        window.risquePhases &&
        window.risquePhases.login &&
        typeof window.risquePhases.login.applyPublicLoginFormMirror === "function"
      ) {
        try {
          window.risquePhases.login.applyPublicLoginFormMirror(gs);
        } catch (eLM) {
          /* ignore */
        }
      }
    }
  }

  function risquePublicMirrorGameState(gs) {
    if (!gs || !window.risqueDisplayIsPublic) return;
    if (risquePublicMirrorShouldHoldIncomeApply(gs)) {
      try {
        _pubBook.deferredIncomeMirrorPayload = JSON.stringify(gs);
      } catch (eHold) {
        _pubBook.deferredIncomeMirrorPayload = null;
      }
      return;
    }
    /* Immediate apply (no 2s #ui-overlay gate) so name-roulette and phase updates stay in sync.
     * Login fade overlay must run even if gameUtils is not ready yet on first paint. */
    risquePublicMirrorGameStateApply(gs);
  }

  window.risquePublicMirrorGameState = risquePublicMirrorGameState;

  /**
   * Host: after CONFIRM publishes recap + risquePublicBookProcessing, build the shelf DOM and start the
   * same book sequence the public tab gets from mirror apply (host does not apply the mirror to itself).
   */
  window.risqueHostSyncCardplayTvRecapUi = function (gs) {
    if (window.risqueDisplayIsPublic || !gs) return;
    try {
      maybeEnsureRuntimeHud(gs);
      risquePublicEnsureCardplayRecapPanel(gs);
      risquePublicBookSequenceOnIncomingState(gs);
    } catch (eSync) {
      /* ignore */
    }
    try {
      if (window.gameUtils && typeof window.gameUtils.renderTerritories === "function") {
        if (!_pubBook.skipTerritoryRedraw) {
          if (_pubBook.displayTroopMap && (_pubBook.phase === "summary" || _pubBook.phase === "step")) {
            risquePublicRenderMapForBook(gs);
          } else {
            window.gameUtils.renderTerritories(null, gs);
          }
        }
      }
      if (window.gameUtils && typeof window.gameUtils.renderStats === "function") {
        window.gameUtils.renderStats(gs);
      }
    } catch (eMap) {
      /* ignore */
    }
    try {
      risquePublicApplyVoiceAndLogMirror(gs);
    } catch (eVoice) {
      /* ignore */
    }
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
      requestAnimationFrame(function () {
        try {
          window.risqueRuntimeHud.syncPosition();
        } catch (ePos) {
          /* ignore */
        }
      });
    }
  };

  function timestamp() {
    return new Date().toISOString();
  }

  function logEvent(message, data) {
    var logs = tryParse(localStorage.getItem(LOG_KEY) || "[]");
    if (!Array.isArray(logs)) logs = [];
    logs.push("[" + timestamp() + "] [Runtime] " + message + (data ? " " + JSON.stringify(data) : ""));
    if (logs.length > MAX_LOG_ENTRIES) {
      logs = logs.slice(logs.length - MAX_LOG_ENTRIES);
    }
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(logs));
    } catch (err) {
      console.warn("Log write skipped:", err);
    }
  }

  function getLedger() {
    var entries = tryParse(localStorage.getItem(LEDGER_KEY) || "[]");
    return Array.isArray(entries) ? entries : [];
  }

  function saveLedger(entries) {
    var safe = Array.isArray(entries) ? entries : [];
    if (safe.length > MAX_LEDGER_ENTRIES) {
      safe = safe.slice(safe.length - MAX_LEDGER_ENTRIES);
    }
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(safe));
    } catch (err) {
      console.warn("Ledger write skipped:", err);
    }
  }

  function resizeRuntimeCanvas() {
    var canvas = document.getElementById("canvas");
    if (!canvas) return;
    var w = window.innerWidth;
    var h = window.innerHeight;
    if (stageHost) {
      var rect = stageHost.getBoundingClientRect();
      if (rect.width > 0) w = rect.width;
      if (rect.height > 0) h = rect.height;
    }
    var scale = Math.min(h / 1080, w / 1920);
    canvas.style.transform = "translate(-50%, 0) scale(" + scale + ")";
    canvas.classList.add("visible");
    var stageImage = canvas.querySelector(".stage-image");
    var svgOverlay = canvas.querySelector(".svg-overlay");
    var uiOverlay = document.querySelector(".ui-overlay");
    if (stageImage) stageImage.classList.add("visible");
    if (svgOverlay) svgOverlay.classList.add("visible");
    if (uiOverlay) uiOverlay.classList.add("visible");
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
      requestAnimationFrame(function () {
        window.risqueRuntimeHud.syncPosition();
      });
    }
  }

  if (window.gameUtils && stageHost) {
    window.gameUtils.resizeCanvas = resizeRuntimeCanvas;
  }

  function appendLedgerEntry(fromPhase, action, toPhase, result, blocked) {
    var entries = getLedger();
    entries.push({
      t: timestamp(),
      fromPhase: fromPhase || "unknown",
      action: action || "unknown",
      toPhase: toPhase || "unknown",
      currentPlayer: state.currentPlayer || null,
      round: Number(state.round) || 1,
      blocked: !!blocked,
      result: result || ""
    });
    saveLedger(entries);
  }

  function makeId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function ensureArray(value, fallback) {
    return Array.isArray(value) ? value : fallback;
  }

  /** True during continental elimination chain steps (phase !== attack but attackPhase may stay pending_transfer). */
  function risqueGamePhaseIsContinentalConquestChain(phase) {
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

  /**
   * Host/private: docked stats under the title row retire after the first in-game CardPlay (and stay retired).
   * Old saves without the flag migrate when phase is clearly post–first-cardplay (not setup deploy).
   */
  function risqueApplyHostHudStatsColumnRetiredFromPhase(s) {
    if (!s || typeof s !== "object") return false;
    if (s.risqueHostHudStatsColumnRetired === true) return false;
    var phRet = String(s.phase || "");
    if (phRet === "cardplay" || phRet === "con-cardplay") {
      s.risqueHostHudStatsColumnRetired = true;
      return true;
    }
    if (
      (s.risqueHostHudStatsColumnRetired === undefined || s.risqueHostHudStatsColumnRetired === null) &&
      s.setupComplete === true
    ) {
      var migrateRetiredPh = {
        income: 1,
        "con-income": 1,
        attack: 1,
        reinforce: 1,
        receivecard: 1,
        getcard: 1,
        conquer: 1,
        "con-cardtransfer": 1,
        "con-deploy": 1,
        "con-receivecard": 1,
        "con-transfertroops": 1
      };
      if (migrateRetiredPh[phRet]) {
        s.risqueHostHudStatsColumnRetired = true;
        return true;
      }
    }
    return false;
  }

  function normalizeState(state) {
    var s = state && typeof state === "object" ? state : {};
    s.players = ensureArray(s.players, []);
    s.turnOrder = ensureArray(s.turnOrder, []);
    s.round = Number(s.round) || 1;
    s.phase = s.phase || "cardplay";
    s.cardEarnedViaAttack = !!s.cardEarnedViaAttack;
    s.cardEarnedViaCardplay = !!s.cardEarnedViaCardplay;
    s.cardAwardedThisTurn = !!s.cardAwardedThisTurn;
    s.lastCardDrawn = s.lastCardDrawn || null;

    if (s.setupComplete !== true) {
      var ph = String(s.phase || "");
      if (
        ph === "cardplay" ||
        ph === "income" ||
        ph === "deploy1" ||
        ph === "deploy2" ||
        ph === "deploy" ||
        ph === "attack" ||
        ph === "reinforce" ||
        ph === "receivecard" ||
        ph === "conquer"
      ) {
        s.setupComplete = true;
      }
    }

    s.players.forEach(function (player) {
      player.territories = ensureArray(player.territories, []);
      player.cards = ensureArray(player.cards, []);
      player.cards = player.cards.map(function (card) {
        if (typeof card === "string") return { name: card, id: makeId() };
        if (card && card.name) return { name: card.name, id: card.id || makeId() };
        return null;
      }).filter(Boolean);
      player.cardCount = player.cards.length;
    });

    if (!s.turnOrder.length && s.players.length) {
      s.turnOrder = s.players.map(function (p) { return p.name; }).filter(Boolean);
    }
    if (!s.currentPlayer && s.turnOrder.length) {
      s.currentPlayer = s.turnOrder[0];
    }
    if (!Array.isArray(s.deck)) {
      s.deck = [];
    }
    if (!Array.isArray(s.discardPile)) {
      s.discardPile = [];
    }
    if (!Array.isArray(s.risquePlayedCardsGallery)) {
      s.risquePlayedCardsGallery = [];
    } else {
      s.risquePlayedCardsGallery = s.risquePlayedCardsGallery.filter(function (entry) {
        return entry && typeof entry.name === "string" && entry.name.length > 0;
      });
      if (s.risquePlayedCardsGallery.length > MAX_PLAYED_CARDS_GALLERY_ENTRIES) {
        s.risquePlayedCardsGallery = s.risquePlayedCardsGallery.slice(
          s.risquePlayedCardsGallery.length - MAX_PLAYED_CARDS_GALLERY_ENTRIES
        );
      }
    }
    if (!s.risqueLuckyLedger || typeof s.risqueLuckyLedger !== "object") {
      s.risqueLuckyLedger = { byPlayer: {} };
    }
    if (typeof s.risqueLuckyLedger.byPlayer !== "object" || s.risqueLuckyLedger.byPlayer === null) {
      s.risqueLuckyLedger.byPlayer = {};
    }
    s.players.forEach(function (p) {
      var nm = p && p.name ? String(p.name) : "";
      if (!nm) return;
      if (!s.risqueLuckyLedger.byPlayer[nm]) {
        s.risqueLuckyLedger.byPlayer[nm] = {
          dice: 0,
          sixes: 0,
          roundWins: 0,
          roundLosses: 0,
          roundTies: 0
        };
      }
    });
    if (!Array.isArray(s.risqueLuckySessionRoster)) {
      s.risqueLuckySessionRoster = [];
    }
    if (
      window.gameUtils &&
      typeof window.gameUtils.clearStaleConquestCardplayFieldsUnlessChain === "function"
    ) {
      window.gameUtils.clearStaleConquestCardplayFieldsUnlessChain(s);
    }
    /* Old saves: rebuild roster from turn order, current players, and ledger (eliminated names). */
    if (!s.risqueLuckySessionRoster.length) {
      var seenRo = {};
      var rosterOut = [];
      function pushRosterName(nm) {
        if (!nm || seenRo[nm]) return;
        seenRo[nm] = true;
        rosterOut.push(nm);
      }
      var ri;
      for (ri = 0; ri < (s.turnOrder || []).length; ri++) {
        if (s.turnOrder[ri]) pushRosterName(String(s.turnOrder[ri]));
      }
      for (ri = 0; ri < (s.players || []).length; ri++) {
        var pr = s.players[ri] && s.players[ri].name;
        if (pr) pushRosterName(String(pr));
      }
      var byRo = (s.risqueLuckyLedger && s.risqueLuckyLedger.byPlayer) || {};
      Object.keys(byRo).forEach(function (k) {
        if (k) pushRosterName(String(k));
      });
      if (rosterOut.length) {
        s.risqueLuckySessionRoster = rosterOut;
      }
    }
    var postSetupPhases = {
      cardplay: 1,
      income: 1,
      deploy2: 1,
      deploy1: 1,
      deploy: 1,
      attack: 1,
      reinforce: 1,
      receivecard: 1,
      conquer: 1
    };
    if (s.setupComplete !== true && postSetupPhases[s.phase]) {
      s.setupComplete = true;
    }
    /* Default: no continuous DD/rNpM disk chips during play (folder stays tidy); use SAVE + REPLAY for full export. */
    if (typeof s.risqueReplayDiskSaveDisabled !== "boolean") {
      s.risqueReplayDiskSaveDisabled = true;
    }
    if (typeof s.risqueReplayGranularDiskWritesEnabled !== "boolean") {
      s.risqueReplayGranularDiskWritesEnabled = false;
    }
    var tierRaw = s.risqueAutosaveTier != null ? String(s.risqueAutosaveTier).trim() : "";
    if (tierRaw === "host_ultra") tierRaw = "battle_stills";
    if (!RISQUE_AUTOSAVE_TIERS[tierRaw]) {
      try {
        tierRaw = localStorage.getItem(RISQUE_AUTOSAVE_TIER_PREF_KEY) || "";
      } catch (eTierLs) {
        tierRaw = "";
      }
      if (!RISQUE_AUTOSAVE_TIERS[tierRaw]) tierRaw = "safe_lean";
      s.risqueAutosaveTier = tierRaw;
    } else {
      s.risqueAutosaveTier = tierRaw;
    }
    if (s.risqueAutosaveTier === "safe_fun") {
      s.risqueReplayGranularDiskWritesEnabled = true;
    } else if (
      s.risqueAutosaveTier === "safe_no_replay" ||
      s.risqueAutosaveTier === "manual" ||
      s.risqueAutosaveTier === "battle_stills"
    ) {
      s.risqueReplayGranularDiskWritesEnabled = false;
    }
    if (typeof window.risqueReplayRestoreFromSidecar === "function") {
      try {
        var hadTapeBefore =
          (s.risqueReplayByRound && Object.keys(s.risqueReplayByRound).length > 0) ||
          (s.risqueReplayTape &&
            Array.isArray(s.risqueReplayTape.events) &&
            s.risqueReplayTape.events.length > 0);
        var restored = window.risqueReplayRestoreFromSidecar(s);
        if (
          !hadTapeBefore &&
          restored &&
          s.risqueAutosaveTier === "safe_no_replay" &&
          typeof window.risqueReplayTapeEventCount === "function" &&
          window.risqueReplayTapeEventCount(s) > 0
        ) {
          try {
            window.__risqueTier3ReplayRestoredFromSidecar = true;
          } catch (eFlag) {
            /* ignore */
          }
        }
      } catch (eRstReplay) {
        /* ignore */
      }
    }
    risqueApplyHostHudStatsColumnRetiredFromPhase(s);
    return s;
  }

  function loadState() {
    var raw = localStorage.getItem(STORAGE_KEY);
    var parsed = raw ? tryParse(raw) : null;
    var normalized = normalizeState(parsed || {});
    if (!normalized.players.length) {
      normalized.players = [
        { name: "Player 1", color: "blue", territories: [], cards: [], cardCount: 0 },
        { name: "Player 2", color: "red", territories: [], cards: [], cardCount: 0 }
      ];
      normalized.turnOrder = ["Player 1", "Player 2"];
      normalized.currentPlayer = "Player 1";
    }
    if (window.gameUtils && typeof window.gameUtils.sanitizeTransientState === "function") {
      var sanitizedLoad = window.gameUtils.sanitizeTransientState(normalized);
      normalized = sanitizedLoad.state;
    }
    return normalized;
  }

  var GRACE_PHASE_START_MAX = 220;
  /** Session-only copy of last gameState JSON before each persist — survives reload in this tab so Grace “Undo” works after refresh. */
  var GRACE_LAST_UNDO_SESSION_KEY = "risqueGraceLastUndoJson";

  function persistGraceLastUndoSession(rawPrevJson) {
    if (!rawPrevJson || typeof rawPrevJson !== "string") return;
    try {
      sessionStorage.setItem(GRACE_LAST_UNDO_SESSION_KEY, rawPrevJson);
    } catch (eS) {
      /* ignore quota */
    }
  }

  function restoreGraceLastUndoFromSession() {
    try {
      var j = sessionStorage.getItem(GRACE_LAST_UNDO_SESSION_KEY);
      if (j && typeof j === "string") {
        window.__risqueGraceLastUndoJson = j;
      }
    } catch (eR) {
      /* ignore */
    }
  }

  function clearGraceLastUndoSession() {
    try {
      sessionStorage.removeItem(GRACE_LAST_UNDO_SESSION_KEY);
    } catch (eC) {
      /* ignore */
    }
    window.__risqueGraceLastUndoJson = null;
  }

  function restoreGraceCardplaySnapshotsFromStorage() {
    if (window.risqueDisplayIsPublic) return;
    try {
      var raw = localStorage.getItem(GRACE_SNAPSHOTS_STORAGE_KEY);
      if (!raw) {
        window.__risqueGraceCardplayStarts = [];
        return;
      }
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        window.__risqueGraceCardplayStarts = [];
        return;
      }
      var out = [];
      var i;
      for (i = 0; i < parsed.length; i++) {
        var e = parsed[i];
        if (!e || typeof e.json !== "string") continue;
        var g = tryParse(e.json);
        if (!g) continue;
        var ph = String(g.phase || "");
        if (!ph || ph === "login") continue;
        out.push({
          kind: typeof e.kind === "string" ? e.kind : "phase",
          player: typeof e.player === "string" ? e.player : String(g.currentPlayer || ""),
          phase: typeof e.phase === "string" && e.phase ? e.phase : ph,
          json: e.json
        });
      }
      window.__risqueGraceCardplayStarts = out;
    } catch (eR) {
      window.__risqueGraceCardplayStarts = [];
    }
    restoreGraceLastUndoFromSession();
  }

  function persistGracePhaseSnapshotsToStorage(arr) {
    if (window.risqueDisplayIsPublic || !Array.isArray(arr)) return;
    try {
      localStorage.setItem(GRACE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(arr));
    } catch (eQuota) {
      if (eQuota && (eQuota.name === "QuotaExceededError" || eQuota.code === 22)) {
        var a = arr.slice();
        while (a.length > 2) {
          a.shift();
          try {
            localStorage.setItem(GRACE_SNAPSHOTS_STORAGE_KEY, JSON.stringify(a));
            window.__risqueGraceCardplayStarts = a;
            return;
          } catch (e2) {
            /* keep shrinking */
          }
        }
      }
    }
  }

  /**
   * Host: when the table enters a new phase, remember that full state
   * (beginning of that phase) for Grace rollback.
   * @param {string|null} rawPrevJson — localStorage gameState *before* this write (phases often setItem directly).
   */
  function recordGracePhaseStartWithPrev(rawPrevJson, nextGs) {
    if (window.risqueDisplayIsPublic || !nextGs || typeof nextGs !== "object") return;
    if (window.__risqueGraceRollbackActive) return;
    try {
      var prev = rawPrevJson ? tryParse(rawPrevJson) : null;
      /* Replay playback rapidly writes many intermediate states (highlights/warpath/selection flashes).
       * Grace history should track live host play only, not replay transport states. */
      if (
        (nextGs && nextGs.risqueReplayPlaybackActive) ||
        (prev && prev.risqueReplayPlaybackActive) ||
        window.RISQUE_REPLAY_MACHINE
      ) {
        return;
      }
      if (rawPrevJson && typeof rawPrevJson === "string") {
        /* UNDO = previous committed save — persist per-tab so reload does not erase it. */
        window.__risqueGraceLastUndoJson = rawPrevJson;
        persistGraceLastUndoSession(rawPrevJson);
      }
      var prevPh = prev && prev.phase != null ? String(prev.phase) : "";
      var nextPh = nextGs.phase != null ? String(nextGs.phase) : "";
      var enteringPhase = !!nextPh && nextPh !== "login" && prevPh !== nextPh;
      var cp = String(nextGs.currentPlayer || "");
      var prevCp = prev && prev.currentPlayer != null ? String(prev.currentPlayer) : "";
      var arr = window.__risqueGraceCardplayStarts;
      if (!Array.isArray(arr)) {
        window.__risqueGraceCardplayStarts = arr = [];
      }
      function pushGraceSnapshot(gsSnap, ph, pl, kind) {
        if (!gsSnap || !ph || ph === "login") return;
        var json;
        try {
          json = JSON.stringify(JSON.parse(JSON.stringify(gsSnap)));
        } catch (eJ) {
          return;
        }
        if (!json) return;
        var last = arr.length ? arr[arr.length - 1] : null;
        if (last && last.json === json) return;
        arr.push({ kind: kind || "phase", player: pl || "", phase: ph, json: json });
      }
      if (!enteringPhase) {
        return;
      }
      /* Phase rollback should restore the exact board *before* the next phase started
       * (e.g. attack -> reinforce keeps completed attacks). */
      if (prev && prevPh) {
        pushGraceSnapshot(prev, prevPh, prevCp || cp, "phase");
      }
      /* Keep phase-entry snapshots too so repeated Grace can continue walking back cleanly. */
      pushGraceSnapshot(nextGs, nextPh, cp, "phase");
      while (arr.length > GRACE_PHASE_START_MAX) {
        arr.shift();
      }
      persistGracePhaseSnapshotsToStorage(arr);
    } catch (eGrace) {
      /* ignore */
    }
  }

  function recordGracePhaseStartIfNeeded(nextGs) {
    var rawPrev = null;
    try {
      rawPrev = localStorage.getItem(STORAGE_KEY);
    } catch (eRead) {
      /* ignore */
    }
    recordGracePhaseStartWithPrev(rawPrev, nextGs);
  }

  (function installGraceGameStatePersistHook() {
    if (typeof Storage === "undefined" || !Storage.prototype || window.__risqueGraceGameStateSetItemHooked) return;
    window.__risqueGraceGameStateSetItemHooked = true;
    var origSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, val) {
      var rawPrev = null;
      if (key === STORAGE_KEY && !window.risqueDisplayIsPublic) {
        try {
          rawPrev = this.getItem(key);
        } catch (e0) {
          /* ignore */
        }
      }
      try {
        origSetItem.apply(this, arguments);
      } catch (eSet) {
        if (key === STORAGE_KEY && eSet && (eSet.name === "QuotaExceededError" || eSet.code === 22)) {
          var valRetry = typeof val === "string" ? val : String(val);
          if (risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, valRetry)) {
            if (!window.risqueDisplayIsPublic) {
              try {
                var nextGsRec = typeof val === "string" ? JSON.parse(val) : val;
                recordGracePhaseStartWithPrev(rawPrev, nextGsRec);
              } catch (eRec) {
                /* ignore */
              }
            }
          } else {
            console.warn("[RISQUE] gameState localStorage write failed after quota recovery");
          }
          return;
        }
        throw eSet;
      }
      if (key === STORAGE_KEY && !window.risqueDisplayIsPublic) {
        try {
          var nextGs = typeof val === "string" ? JSON.parse(val) : val;
          recordGracePhaseStartWithPrev(rawPrev, nextGs);
        } catch (e1) {
          /* ignore */
        }
      }
    };
  })();

  /**
   * Last bookmark for this phase + player (moment you entered this phase). Use to rewind
   * reinforce / attack clicks without leaving the phase.
   */
  function graceFindCurrentPhaseStartSnapshot(gs) {
    var arr = window.__risqueGraceCardplayStarts;
    if (!Array.isArray(arr) || !arr.length || !gs) return null;
    var curPh = String(gs.phase || "");
    var curPlayer = String(gs.currentPlayer || "");
    if (!curPh || curPh === "login") return null;
    var i;
    for (i = arr.length - 1; i >= 0; i--) {
      var e = arr[i];
      if (!e || typeof e.json !== "string") continue;
      if (String(e.phase || "") === curPh && String(e.player || "") === curPlayer) {
        return { index: i, entry: e };
      }
    }
    return null;
  }

  /** Board state at end of the previous phase (before you entered the current phase). */
  function graceFindPreviousPhaseSnapshot(gs) {
    var arr = window.__risqueGraceCardplayStarts;
    if (!Array.isArray(arr) || !arr.length || !gs) return null;
    var curPh = String(gs.phase || "");
    var curPlayer = String(gs.currentPlayer || "");
    var i;
    for (i = arr.length - 1; i >= 0; i--) {
      var e = arr[i];
      if (!e || typeof e.json !== "string") continue;
      var ph = String(e.phase || "");
      var pl = String(e.player || "");
      /* Skip “start of current phase” rows; next different row is end of prior phase. */
      if (ph === curPh && pl === curPlayer) continue;
      return { index: i, entry: e };
    }
    return null;
  }

  function graceFindUndoSnapshot(gs) {
    if (!gs) return null;
    var j = window.__risqueGraceLastUndoJson;
    if (!j || typeof j !== "string") return null;
    return { index: -1, entry: { json: j } };
  }

  function graceFindPlayerCycleSnapshot(gs) {
    var arr = window.__risqueGraceCardplayStarts;
    if (!Array.isArray(arr) || !arr.length || !gs) return null;
    var cp = String(gs.currentPlayer || "");
    if (!cp) return null;
    var i;
    for (i = arr.length - 1; i >= 0; i--) {
      var e = arr[i];
      if (!e || typeof e.json !== "string") continue;
      var ep = String(e.player || "");
      var ph = String(e.phase || "");
      if (ep !== cp) continue;
      if (ph === "cardplay" || ph === "con-cardplay") {
        return { index: i, entry: e };
      }
    }
    return null;
  }

  function getLastRoundAutosaveNumber() {
    try {
      var arr = tryParse(localStorage.getItem(ROUND_AUTOSAVE_KEY) || "[]");
      if (!Array.isArray(arr) || !arr.length) return 0;
      var last = arr[arr.length - 1] || {};
      return Number(last.round) || 0;
    } catch (e) {
      return 0;
    }
  }

  function getRoundAutosaveSessionCount() {
    try {
      var n = Number(sessionStorage.getItem(ROUND_AUTOSAVE_SESSION_COUNT_KEY) || "0");
      return n > 0 ? n : 0;
    } catch (e) {
      return 0;
    }
  }

  function setRoundAutosaveSessionCount(n) {
    try {
      var safe = Number(n) || 0;
      sessionStorage.setItem(ROUND_AUTOSAVE_SESSION_COUNT_KEY, String(safe));
    } catch (e) {
      /* ignore */
    }
  }

  function readAutosaveFpRound() {
    try {
      var o = tryParse(localStorage.getItem(AUTOSAVE_FP_ROUND_KEY) || "null");
      return o && typeof o === "object" ? o : null;
    } catch (eR) {
      return null;
    }
  }

  function persistAutosaveFpRound(sessionKey, completedRound) {
    try {
      localStorage.setItem(
        AUTOSAVE_FP_ROUND_KEY,
        JSON.stringify({
          sessionKey: String(sessionKey || ""),
          round: Math.max(0, Number(completedRound) || 0),
          at: Date.now()
        })
      );
    } catch (eP) {
      /* ignore */
    }
  }

  function readAutosaveFpWin() {
    try {
      var o = tryParse(localStorage.getItem(AUTOSAVE_FP_WIN_KEY) || "null");
      return o && typeof o === "object" ? o : null;
    } catch (eW) {
      return null;
    }
  }

  function persistAutosaveFpWin(sessionKey, winRound) {
    try {
      localStorage.setItem(
        AUTOSAVE_FP_WIN_KEY,
        JSON.stringify({
          sessionKey: String(sessionKey || ""),
          round: Math.max(1, Number(winRound) || 1),
          at: Date.now()
        })
      );
    } catch (ePw) {
      /* ignore */
    }
  }

  function maybeAutosaveOnTurnCycle(prevState, nextState) {
    /* Disabled: explicit receivecard round-boundary hook is authoritative. */
    return;
  }

  function startRoundAutosaveWatcher() {
    /* Disabled: explicit receivecard round-boundary hook is authoritative. */
    return;
  }

  function saveState(state) {
    function write() {
      if (typeof window.risqueCheapReplayDetachFromGameState === "function") {
        try {
          window.risqueCheapReplayDetachFromGameState(state);
        } catch (eCrSv) {
          /* ignore */
        }
      }
      var tierSave =
        state && state.risqueAutosaveTier != null ? String(state.risqueAutosaveTier).trim() : "";
      var skipSidecar = tierSave === "battle_stills" || tierSave === "host_ultra";
      /* Debounce replay sidecar — sync stringify of a long tape blocked the UI (round 3+ campaign). */
      if (!skipSidecar) {
        try {
          if (typeof window.risqueReplayScheduleTapeSidecarPersist === "function") {
            window.risqueReplayScheduleTapeSidecarPersist(state);
          } else if (typeof window.risqueReplayPersistTapeSidecar === "function") {
            window.risqueReplayPersistTapeSidecar(state);
          }
        } catch (eReplaySidecar) {
          /* ignore */
        }
      }
      var payload = state;
      if (
        (skipSidecar || risqueLocalStorageReplayLiteEnabled()) &&
        typeof window.risqueStripReplayFromGameStateClone === "function"
      ) {
        payload = window.risqueStripReplayFromGameStateClone(state);
        if (!skipSidecar) risqueMaybeLogLsReplayLiteOnce();
      }
      var diskJson =
        typeof window.risqueJsonStringifyGameStateForStorage === "function"
          ? window.risqueJsonStringifyGameStateForStorage(payload)
          : JSON.stringify(payload);
      if (!risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, diskJson)) {
        var emergency = risqueBuildEmergencyStorageState(payload);
        var emergencyJson =
          typeof window.risqueJsonStringifyGameStateForStorage === "function"
            ? window.risqueJsonStringifyGameStateForStorage(emergency)
            : JSON.stringify(emergency);
        if (!risqueTryWriteLocalStorageWithQuotaFallback(STORAGE_KEY, emergencyJson)) {
          throw new Error("QuotaExceededError");
        }
      }
    }
    function notifyStaging(s) {
      try {
        if (typeof window.risqueStagingNotifyPersistedState === "function") {
          window.risqueStagingNotifyPersistedState(s);
        }
      } catch (eStg) {
        /* ignore */
      }
    }
    try {
      write();
      notifyStaging(state);
      return true;
    } catch (err) {
      if (err && err.name === "QuotaExceededError") {
        try {
          var rawLogs = localStorage.getItem(LOG_KEY);
          var logsArr = tryParse(rawLogs || "[]");
          if (Array.isArray(logsArr) && logsArr.length > 60) {
            logsArr = logsArr.slice(-60);
            localStorage.setItem(LOG_KEY, JSON.stringify(logsArr));
          } else {
            localStorage.removeItem(LOG_KEY);
          }
        } catch (eTrim) {
          try {
            localStorage.removeItem(LOG_KEY);
          } catch (eRm) {
            /* ignore */
          }
        }
        try {
          write();
          notifyStaging(state);
          return true;
        } catch (err2) {
          try {
            if (typeof window.risqueReplayPruneOldestRoundBuckets === "function") {
              var pruned = window.risqueReplayPruneOldestRoundBuckets(state, 3);
              if (pruned > 0) {
                write();
                notifyStaging(state);
                return true;
              }
            }
          } catch (ePrune) {
            /* ignore */
          }
          /* fall through */
        }
      }
      console.error("Unable to save gameState:", err);
      try {
        if (typeof window.gameUtils !== "undefined" && window.gameUtils.showError) {
          window.gameUtils.showError(
            "Browser storage is full — game continues in memory. Clear site data for this page or use SAVE to disk, then reload."
          );
        }
      } catch (eToast) {
        /* ignore */
      }
      return false;
    }
  }
  window.risqueSaveGameState = saveState;

  /** Persist host state for phase navigation; never throws (income/deploy must advance even if disk is full). */
  window.risquePersistGameStateForNavigation = function (gs) {
    if (!gs || typeof gs !== "object") return false;
    window.gameState = gs;
    try {
      return !!saveState(gs);
    } catch (eNav) {
      console.warn("[RISQUE] risquePersistGameStateForNavigation:", eNav);
      return false;
    }
  };

  /** Turn on DD.json / rNpM.json disk tapes when the host has a real save target (folder or launcher disk). */
  function risqueReplayEnableDiskTapeExportsForWritableSaveRoot(optGameState) {
    if (window.risqueDisplayIsPublic) return;
    var g = optGameState || window.gameState;
    if (!g || typeof g !== "object") return;
    g.risqueReplayDiskSaveDisabled = false;
    try {
      saveState(g);
    } catch (eSav) {
      /* ignore */
    }
  }

  /**
   * Short-lived granular replay disk writes (rNpM.json segments): enable only around Save / game-win,
   * then disable again — avoids churn all match after one Replay open.
   */
  function risqueReplayEnableGranularDiskWrites(reason, optGameState) {
    if (window.risqueDisplayIsPublic) return;
    var g = optGameState || window.gameState;
    if (!g || typeof g !== "object") return;
    if (g.risqueAutosaveTier === "safe_no_replay" || g.risqueAutosaveTier === "manual" || g.risqueAutosaveTier === "battle_stills")
      return;
    if (g.risqueReplayGranularDiskWritesEnabled === true) return;
    g.risqueReplayGranularDiskWritesEnabled = true;
    try {
      saveState(g);
    } catch (eSavG) {
      /* ignore */
    }
    try {
      if (typeof logEvent === "function") {
        logEvent("Replay disk: granular writes enabled", { reason: reason || "unspecified" });
      }
    } catch (eLogG) {
      /* ignore */
    }
  }

  function risqueReplayDisableGranularDiskWrites(reason, optGameState) {
    if (window.risqueDisplayIsPublic) return;
    var g = optGameState || window.gameState;
    if (!g || typeof g !== "object") return;
    if (g.risqueAutosaveTier === "safe_fun") return;
    if (g.risqueReplayGranularDiskWritesEnabled !== true) return;
    g.risqueReplayGranularDiskWritesEnabled = false;
    try {
      saveState(g);
    } catch (eDis) {
      /* ignore */
    }
    try {
      if (typeof logEvent === "function") {
        logEvent("Replay disk: granular writes disabled", { reason: reason || "unspecified" });
      }
    } catch (eLogD) {
      /* ignore */
    }
  }

  /**
   * Wire a File System Access directory handle to round autosave + session disk (same as the round-autosave picker).
   * Wayback "Connect saved folder" must call this or mid-game replay files never land on disk.
   */
  function risqueHostSaveFolderAdoptDirectoryHandle(dirHandle, optGameState) {
    if (!dirHandle || window.risqueDisplayIsPublic) return;
    if (typeof dirHandle.getDirectoryHandle !== "function") return;
    __risqueRoundAutosaveDirHandle = dirHandle;
    try {
      if (typeof window.risqueSessionDiskInvalidateCache === "function") {
        window.risqueSessionDiskInvalidateCache();
      }
    } catch (eInv) {
      /* ignore */
    }
    risqueReplayEnableDiskTapeExportsForWritableSaveRoot(optGameState);
  }
  window.risqueHostSaveFolderAdoptDirectoryHandle = risqueHostSaveFolderAdoptDirectoryHandle;
  window.risqueReplayEnableDiskTapeExportsForWritableSaveRoot = risqueReplayEnableDiskTapeExportsForWritableSaveRoot;
  window.risqueReplayEnableGranularDiskWrites = risqueReplayEnableGranularDiskWrites;
  window.risqueReplayDisableGranularDiskWrites = risqueReplayDisableGranularDiskWrites;

  function saveRoundAutosaveSnapshot(gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve();
    return waitForAutosaveFolderBoot().then(function () {
      return saveRoundAutosaveSnapshotInner(gs);
    });
  }

  function saveRoundAutosaveSnapshotInner(gs) {
    var targetMode = hasRoundAutosaveDiskTarget() ? "disk-folder" : "browser-download";
    var row = null;
    var snapshotJson = "";
    try {
      var forSave = gs;
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forSave = window.risqueStripReplayFromGameStateClone(gs);
        }
      } catch (eStripRound) {
        forSave = gs;
      }
      snapshotJson = JSON.stringify(forSave);
      row = {
        at: Date.now(),
        round: Number(gs.round) || 1,
        phase: String(gs.phase || ""),
        currentPlayer: String(gs.currentPlayer || ""),
        stateRef: null,
        stateBytes: snapshotJson.length || 0,
        mode: targetMode
      };
      row.stateRef = sidecarPut("roundAutosaveState", snapshotJson, {
        round: row.round,
        phase: row.phase,
        currentPlayer: row.currentPlayer
      });
      row.simpleSeq =
        typeof risqueAllocSimpleAutosaveSeq === "function" ? risqueAllocSimpleAutosaveSeq(gs) : 1;
      var arr = tryParse(localStorage.getItem(ROUND_AUTOSAVE_KEY) || "[]");
      if (!Array.isArray(arr)) arr = [];
      arr.push(row);
      if (arr.length > MAX_ROUND_AUTOSAVES) {
        arr = arr.slice(arr.length - MAX_ROUND_AUTOSAVES);
      }
      localStorage.setItem(ROUND_AUTOSAVE_KEY, JSON.stringify(arr));
      var keepRefs = {};
      arr.forEach(function (r) {
        if (r && r.stateRef) keepRefs[String(r.stateRef)] = true;
      });
      sidecarPrune("roundAutosaveState", MAX_ROUND_AUTOSAVES + 2, keepRefs);
      setRoundAutosaveStatus(Number(row.round) || 1, row.at, row.mode);
      setRoundAutosaveSessionCount(Number(row.round) || 0);
    } catch (eAuto) {
      try {
        var fallback = tryParse(localStorage.getItem(ROUND_AUTOSAVE_KEY) || "[]");
        if (!Array.isArray(fallback)) fallback = [];
        fallback = fallback.slice(-3);
        localStorage.setItem(ROUND_AUTOSAVE_KEY, JSON.stringify(fallback));
      } catch (eAuto2) {
        /* ignore */
      }
    }
    if (targetMode === "disk-folder") {
      return Promise.resolve(writeRoundAutosaveToDisk(gs));
    }
    return Promise.resolve();
  }

  /**
   * After many rounds, one Chromium tab + a large in-memory replay tape (tier 1 especially) can stress the
   * browser until markers/WebGL desync. Nudge SAVE + REPLAY and a clean restart before that happens.
   */
  function risqueMaybeHostLongSessionStaminaNotice(gs, completedRound) {
    if (!gs || window.risqueDisplayIsPublic) return;
    var tier = gs.risqueAutosaveTier != null ? String(gs.risqueAutosaveTier).trim() : "";
    if (tier !== "safe_fun" && tier !== "safe_lean" && tier !== "safe_no_replay") return;
    var r = Math.max(0, Math.floor(Number(completedRound)) || 0);
    if (r < 10) return;
    var milestone = r === 10 || r === 12 || r === 15 || r === 18 || r === 20 || (r >= 25 && r % 5 === 0);
    if (!milestone) return;
    var key = "risqueLongSessionStaminaNotices";
    var arr = [];
    try {
      arr = JSON.parse(sessionStorage.getItem(key) || "[]");
      if (!Array.isArray(arr)) arr = [];
    } catch (eParse) {
      arr = [];
    }
    if (arr.indexOf(r) !== -1) return;
    arr.push(r);
    try {
      sessionStorage.setItem(key, JSON.stringify(arr));
    } catch (eSs) {
      /* ignore */
    }
    var tierNote = tier === "safe_fun" ? " Tier 1 logs every turn (highest RAM use)." : "";
    setBoardCornerMsg(
      "Round " +
        r +
        ": if the map or markers glitch, use SAVE + REPLAY, then restart the browser." +
        tierNote,
      14000
    );
    try {
      logEvent("Long session stamina notice", { round: r, tier: tier });
    } catch (eLog) {
      /* ignore */
    }
  }

  /**
   * Explicit round-boundary hook called by receivecard phase when turn wraps to player 1.
   * completedRound is the round that just ended (before gameState.round increments).
   */
  window.risqueRoundAutosaveOnRoundComplete = function (gs, completedRound) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve();
    if (gs.risqueAutosaveTier === "manual" || gs.risqueAutosaveTier === "battle_stills") return Promise.resolve();
    if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
      try {
        window.risqueReplayEnsureTapeSessionKey(gs);
      } catch (eSk) {
        /* ignore */
      }
    }
    var n = Number(completedRound) || 0;
    var fromState = (Number(gs.round) || 0) - 1;
    if (fromState > 0) {
      n = fromState;
    }
    if (n < 1) return Promise.resolve();
    var sk = gs.risqueReplayTapeSessionKey ? String(gs.risqueReplayTapeSessionKey) : "";
    var fpR = readAutosaveFpRound();
    if (sk && fpR && String(fpR.sessionKey) === sk && Number(fpR.round) === n) {
      if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
        window.risqueStagingClearAfterRoundCommit();
      }
      return Promise.resolve();
    }
    var saveGs = gs;
    try {
      saveGs = JSON.parse(JSON.stringify(gs));
      saveGs.round = n;
    } catch (eCloneRoundSave) {
      /* keep original reference fallback */
    }
    return saveRoundAutosaveSnapshot(saveGs).then(function () {
      if (sk) persistAutosaveFpRound(sk, n);
      if (typeof window.risqueReplayReleaseCompletedRoundAfterAutosave === "function") {
        try {
          window.risqueReplayReleaseCompletedRoundAfterAutosave(gs, n);
        } catch (eMemRel) {
          /* ignore */
        }
      }
      if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
        window.risqueStagingClearAfterRoundCommit();
      }
      risqueMaybeHostLongSessionStaminaNotice(gs, n);
    });
  };

  /** Immediate end-of-game autosave (host only) so final round + replay are always captured. */
  window.risqueRoundAutosaveOnGameWin = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) return Promise.resolve();
    if (gs.risqueAutosaveTier === "battle_stills") {
      if (gs.risqueGameWinAutosaved) return Promise.resolve();
      if (typeof window.risqueCheapReplayDetachFromGameState === "function") {
        try {
          window.risqueCheapReplayDetachFromGameState(gs);
        } catch (eCrWin) {
          /* ignore */
        }
      }
      if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
        try {
          window.risqueReplayEnsureTapeSessionKey(gs);
        } catch (eSkBs) {
          /* ignore */
        }
      }
      var flushBs =
        typeof window.risqueCheapReplayFlushToDisk === "function"
          ? Promise.resolve(window.risqueCheapReplayFlushToDisk(gs)).catch(function () {
              return false;
            })
          : Promise.resolve(false);
      return flushBs.then(function (okBs) {
        try {
          gs.risqueGameWinAutosaved = true;
        } catch (eFlBs) {
          /* ignore */
        }
        if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
          try {
            window.risqueStagingClearAfterRoundCommit();
          } catch (eStBs) {
            /* ignore */
          }
        }
        try {
          logEvent("Battle stills: flushed rqwb frames to REPLAY folder", { ok: !!okBs });
        } catch (eLogBs) {
          /* ignore */
        }
      });
    }
    if (gs.risqueAutosaveTier === "safe_no_replay") {
      if (gs.risqueGameWinAutosaved) return Promise.resolve();
      var winR3 = Math.max(1, Number(gs.round) || 1);
      var skW3 = gs.risqueReplayTapeSessionKey ? String(gs.risqueReplayTapeSessionKey) : "";
      var fpW3 = readAutosaveFpWin();
      if (skW3 && fpW3 && String(fpW3.sessionKey) === skW3 && Number(fpW3.round) === winR3) {
        try {
          gs.risqueGameWinAutosaved = true;
        } catch (eFl3Dup) {
          /* ignore */
        }
        if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
          window.risqueStagingClearAfterRoundCommit();
        }
        return Promise.resolve();
      }
      if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
        try {
          window.risqueReplayEnsureTapeSessionKey(gs);
        } catch (eSk3) {
          /* ignore */
        }
      }
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        try {
          window.risqueReplayEnsureLatestBoardFrame(gs);
        } catch (eLf3) {
          /* ignore */
        }
      }
      return risqueTier3WriteCompleteSessionReplay(gs).then(function (wr) {
        try {
          gs.risqueGameWinAutosaved = true;
        } catch (eFl3) {
          /* ignore */
        }
        if (skW3) persistAutosaveFpWin(skW3, winR3);
        if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
          window.risqueStagingClearAfterRoundCommit();
        }
        if (wr && wr.ok) {
          try {
            logEvent("Tier 3: endgame full session replay", { file: wr.path || wr.downloaded });
          } catch (eLog3) {
            /* ignore */
          }
        }
      });
    }
    if (gs.risqueAutosaveTier === "manual") {
      if (gs.risqueGameWinAutosaved) return Promise.resolve();
      if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
        try {
          window.risqueReplayEnsureTapeSessionKey(gs);
        } catch (eSkM) {
          /* ignore */
        }
      }
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        try {
          window.risqueReplayEnsureLatestBoardFrame(gs);
        } catch (eLfM) {
          /* ignore */
        }
      }
      var forSaveM = gs;
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forSaveM = window.risqueStripReplayFromGameStateClone(gs);
        }
      } catch (eStripM) {
        forSaveM = gs;
      }
      var payloadM;
      try {
        payloadM = JSON.stringify(forSaveM, null, 2);
      } catch (ePayM) {
        try {
          gs.risqueGameWinAutosaved = true;
        } catch (eFlM) {
          /* ignore */
        }
        return Promise.resolve();
      }
      var replayPackM = buildSplitSessionReplayPackForHost(gs);
      var baseM = defaultRisqueSaveBasename() + " postgame";
      return tryWriteSplitSaveToAutosaveFolder(gs, payloadM, replayPackM, baseM).then(function (fr) {
        try {
          gs.risqueGameWinAutosaved = true;
        } catch (eDoneM) {
          /* ignore */
        }
        if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
          window.risqueStagingClearAfterRoundCommit();
        }
        if (fr && fr.ok) {
          try {
            logEvent("Manual tier: auto-wrote endgame game + full session replay", {});
          } catch (eLogM) {
            /* ignore */
          }
        } else {
          try {
            logEvent("Manual tier: endgame folder write skipped (no folder or write failed)", {});
          } catch (eLogM2) {
            /* ignore */
          }
        }
      });
    }
    if (gs.risqueGameWinAutosaved) return Promise.resolve();
    if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
      try {
        window.risqueReplayEnsureTapeSessionKey(gs);
      } catch (eSk2) {
        /* ignore */
      }
    }
    var winR = Math.max(1, Number(gs.round) || 1);
    var skW = gs.risqueReplayTapeSessionKey ? String(gs.risqueReplayTapeSessionKey) : "";
    var fpW = readAutosaveFpWin();
    if (skW && fpW && String(fpW.sessionKey) === skW && Number(fpW.round) === winR) {
      try {
        gs.risqueGameWinAutosaved = true;
      } catch (eFl2) {
        /* ignore */
      }
      if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
        window.risqueStagingClearAfterRoundCommit();
      }
      return Promise.resolve();
    }
    /* Granular rNpM + rNpMgame: last winning attack never hits receivecard — flush using pre-shrink turnOrder. */
    var flushWin =
      typeof window.risqueSessionDiskFlushReplayAfterGameWin === "function"
        ? Promise.resolve(window.risqueSessionDiskFlushReplayAfterGameWin(gs)).catch(function () {
            return false;
          })
        : Promise.resolve(false);
    return flushWin.then(function () {
      /* Flush final board to tape so the last battle is not missing from session / round exports. */
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        try {
          window.risqueReplayEnsureLatestBoardFrame(gs);
        } catch (eLfWin) {
          /* ignore */
        }
      }
      try {
        gs.risqueGameWinAutosaved = true;
      } catch (eFlag) {
        /* ignore */
      }
      return saveRoundAutosaveSnapshot(gs).then(function () {
        if (skW) persistAutosaveFpWin(skW, winR);
        if (typeof window.risqueStagingClearAfterRoundCommit === "function") {
          window.risqueStagingClearAfterRoundCommit();
        }
      });
    });
  };

  function risqueAutosaveDateCompact(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
  }

  function risqueAutosaveTimeCompact(d) {
    return pad2(d.getHours()) + pad2(d.getMinutes());
  }

  function risqueAutosaveBase(prefix, roundNum, whenDate) {
    var d = whenDate instanceof Date ? whenDate : new Date();
    var r = Math.max(1, Number(roundNum) || 1);
    return (
      String(prefix || "RQGS") +
      "-r" +
      String(r) +
      "-" +
      risqueAutosaveDateCompact(d) +
      "-" +
      risqueAutosaveTimeCompact(d)
    );
  }

  /** Per-round tape filename in REPLAY (latest end-of-round write wins for that round). */
  function risqueRoundReplayFilename(roundNum) {
    var r = Math.max(1, Math.floor(Number(roundNum)) || 1);
    return "replay" + String(r) + ".json";
  }

  function exportBrowserRoundReplayPackJson(row, replayPack, replayFnameOpt) {
    if (!row || !replayPack || replayPack.format !== "risque-replay-v1") return;
    var rnd = Math.max(1, Math.floor(Number(row && row.round != null ? row.round : 1)) || 1);
    var fname =
      replayFnameOpt && String(replayFnameOpt).trim()
        ? String(replayFnameOpt).trim()
        : risqueRoundReplayFilename(rnd);
    var json;
    try {
      json = JSON.stringify(replayPack);
    } catch (eS) {
      return;
    }
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    logEvent("Round autosave: exported replay pack JSON", { file: fname });
  }

  function exportBrowserRoundAutosaveJson(row, stateJsonOpt, replayPackOpt) {
    if (!row) return;
    var stateJson =
      stateJsonOpt != null && stateJsonOpt !== ""
        ? String(stateJsonOpt)
        : row.stateRef
          ? sidecarGet("roundAutosaveState", row.stateRef)
          : row.state != null
            ? String(row.state)
            : "";
    if (!stateJson) return;
    var when = new Date();
    var rnd = Math.max(1, Math.floor(Number(row.round != null ? row.round : 1)) || 1);
    var base = risqueAutosaveBase("RQGS", rnd, when);
    var fname = base + ".json";
    var blob = new Blob([stateJson], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    setBoardCornerMsg("Round autosave: exported game JSON (+ replay tape if recorded).");
    logEvent("Round autosave: exported browser backup JSON", { file: fname });
    if (replayPackOpt && replayPackOpt.format === "risque-replay-v1") {
      /* Chrome may block a second <a download> in the same tick; spacing helps both land in SAVE. */
      setTimeout(function () {
        exportBrowserRoundReplayPackJson(row, replayPackOpt, risqueRoundReplayFilename(rnd));
      }, 1000);
    }
  }

  function removeRoundAutosaveSetupOverlay() {
    var el = document.getElementById("risque-round-autosave-setup");
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function removeAutosaveConfigOverlay() {
    var el = document.getElementById("risque-autosave-config-setup");
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function injectAutosaveConfigStylesOnce() {
    var sid = "risque-autosave-config-setup-style";
    if (document.getElementById(sid)) return;
    var s = document.createElement("style");
    s.id = sid;
    s.textContent =
      "#risque-autosave-config-setup{position:fixed;inset:0;z-index:1000001;margin:0;padding:24px;" +
      "display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);" +
      "font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;}" +
      "#risque-autosave-config-setup *{box-sizing:border-box;}" +
      "#risque-autosave-config-setup .risque-ras-card{max-width:560px;width:100%;background:#111827;" +
      "color:#e5e7eb;border:1px solid #334155;border-radius:12px;padding:20px 22px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,0.45);max-height:90vh;overflow-y:auto;}" +
      "#risque-autosave-config-setup .risque-ras-title{font-size:20px;font-weight:bold;margin:0 0 8px;color:#fff;}" +
      "#risque-autosave-config-setup .risque-ras-body{font-size:14px;line-height:1.45;margin:0 0 14px;color:#cbd5e1;}" +
      "#risque-autosave-config-setup .risque-ac-opt-list{margin:0 0 16px;padding:0;list-style:none;}" +
      "#risque-autosave-config-setup .risque-ac-opt{display:flex;gap:10px;align-items:flex-start;margin:0 0 8px;" +
      "padding:10px 12px;border:1px solid #334155;border-radius:8px;background:#0f172a;cursor:pointer;}" +
      "#risque-autosave-config-setup .risque-ac-opt:hover{background:#1e293b;}" +
      "#risque-autosave-config-setup .risque-ac-opt input{flex:0 0 auto;margin-top:3px;}" +
      "#risque-autosave-config-setup .risque-ac-opt-text{flex:1;min-width:0;}" +
      "#risque-autosave-config-setup .risque-ac-opt-title{display:block;font-weight:bold;margin:0 0 4px;color:#fff;}" +
      "#risque-autosave-config-setup .risque-ac-opt-desc{margin:0;font-size:13px;line-height:1.4;color:#94a3b8;}" +
      "#risque-autosave-config-setup .risque-ras-actions{display:flex;flex-wrap:wrap;gap:10px;}" +
      "#risque-autosave-config-setup button{font-size:15px;font-weight:bold;border-radius:8px;padding:10px 16px;" +
      "cursor:pointer;border:none;}" +
      "#risque-autosave-config-setup .risque-ras-primary{background:#2563eb;color:#fff;}" +
      "#risque-autosave-config-setup .risque-ras-primary:hover{background:#1d4ed8;}" +
      "#risque-autosave-config-setup .risque-ras-secondary{background:#374151;color:#e5e7eb;}" +
      "#risque-autosave-config-setup .risque-ras-secondary:hover{background:#4b5563;}";
    document.head.appendChild(s);
  }

  /**
   * Host-facing autosave policy (per-turn disk, replay segments, round chain) + link to folder picker.
   */
  function mountAutosaveConfigOverlay() {
    if (window.risqueDisplayIsPublic) return false;
    removeAutosaveConfigOverlay();
    injectAutosaveConfigStylesOnce();
    var cur = window.gameState && window.gameState.risqueAutosaveTier;
    cur = cur && RISQUE_AUTOSAVE_TIERS[cur] ? String(cur) : "";
    if (!cur) {
      try {
        cur = localStorage.getItem(RISQUE_AUTOSAVE_TIER_PREF_KEY) || "";
      } catch (eCurLs) {
        cur = "";
      }
    }
    if (!RISQUE_AUTOSAVE_TIERS[cur]) cur = "safe_lean";
    function chk(val) {
      return cur === val ? " checked" : "";
    }
    var ov = document.createElement("div");
    ov.id = "risque-autosave-config-setup";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Autosave and replay policy");
    ov.innerHTML =
      '<div class="risque-ras-card">' +
      '<p class="risque-ras-title">Autosave &amp; replay</p>' +
      '<p class="risque-ras-body">Choose how often the host writes checkpoints to your connected save folder. ' +
      "Manual <strong>SAVE</strong> / <strong>SAVE + REPLAY</strong> always writes the current game JSON plus a separate <strong>session replay</strong> JSON (deal through now): <strong>full</strong> granular tape on tiers 1–4, <strong>phase-budget</strong> tape on Battle stills (tier 5).</p>" +
      '<ul class="risque-ac-opt-list">' +
      '<li><label class="risque-ac-opt">' +
      '<input type="radio" name="risque-autosave-tier" value="safe_fun"' +
      chk("safe_fun") +
      ">" +
      '<span class="risque-ac-opt-text"><span class="risque-ac-opt-title">1 · Safe &amp; fun (full replay)</span>' +
      "<span class=\"risque-ac-opt-desc\">Every player turn: game checkpoint plus replay segment on disk (DD.json + rNpM). Granular replay stays on — best for Wayback.</span></span>" +
      "</label></li>" +
      '<li><label class="risque-ac-opt">' +
      '<input type="radio" name="risque-autosave-tier" value="safe_lean"' +
      chk("safe_lean") +
      ">" +
      '<span class="risque-ac-opt-text"><span class="risque-ac-opt-title">2 · Safe with lean fun</span>' +
      "<span class=\"risque-ac-opt-desc\">Turn game files every cycle; replay segments only when the host turns granular on (save, game win, Wayback). Fewer rNpM files between exports.</span></span>" +
      "</label></li>" +
      '<li><label class="risque-ac-opt">' +
      '<input type="radio" name="risque-autosave-tier" value="safe_no_replay"' +
      chk("safe_no_replay") +
      ">" +
      '<span class="risque-ac-opt-text"><span class="risque-ac-opt-title">3 · Safe, no replay disk</span>' +
      "<span class=\"risque-ac-opt-desc\">Turn checkpoints for game state only (rNpMgame.json) during play — no DD/rNpM on disk. " +
      "At <strong>game win</strong>, one <code>replay-complete-…json</code> (deal→last battle) is written automatically. " +
      "<strong>SAVE + REPLAY</strong> mid-game still writes game + replay for later; finishing merges that file with memory when needed.</span></span>" +
      "</label></li>" +
      '<li><label class="risque-ac-opt">' +
      '<input type="radio" name="risque-autosave-tier" value="manual"' +
      chk("manual") +
      ">" +
      '<span class="risque-ac-opt-text"><span class="risque-ac-opt-title">4 · Manual (minimal disk)</span>' +
      "<span class=\"risque-ac-opt-desc\">" +
        "Writes <code>DD.json</code> once after deal/deploy, then <strong>no</strong> per-turn replay/checkpoint files. " +
        "<strong>SAVE + REPLAY</strong> writes stripped game + full-session replay; with a connected folder, both files go straight to disk (no dialogs). " +
        "At <strong>game end</strong>, the same pair is written automatically when a folder is connected. Full tape stays in memory during play.</span></span>" +
      "</label></li>" +
      '<li><label class="risque-ac-opt">' +
      '<input type="radio" name="risque-autosave-tier" value="battle_stills"' +
      chk("battle_stills") +
      ">" +
      '<span class="risque-ac-opt-text"><span class="risque-ac-opt-title">5 · Battle stills (lean replay)</span>' +
      "<span class=\"risque-ac-opt-desc\">" +
        "<strong>No</strong> per-round game JSON or granular replay tape during play. Replay is a <strong>map slideshow</strong>: one frame after deal, then one frame per <strong>battle outcome</strong> (colors + troop counts, captions like “Nooch conquers Mickey”). " +
        "<strong>SAVE + REPLAY</strong> writes game JSON plus budget <code>*-replay.json</code>. At <strong>game end</strong>, stills flush to <strong>REPLAY</strong> (<code>rqwb-still-*.json</code> + manifest). Public Wayback advances ~1 second per frame — no dice animation.</span></span>" +
      "</label></li>" +
      "</ul>" +
      '<div class="risque-ras-actions">' +
      '<button type="button" class="risque-ras-primary" id="risque-ac-apply">Apply</button>' +
      '<button type="button" class="risque-ras-secondary" id="risque-ac-folder">Choose save folder…</button>' +
      '<button type="button" class="risque-ras-secondary" id="risque-ac-close">Close</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(ov);
    function readSelectedTier() {
      var r = ov.querySelector('input[name="risque-autosave-tier"]:checked');
      var t = r && r.value ? String(r.value) : "safe_lean";
      return RISQUE_AUTOSAVE_TIERS[t] ? t : "safe_lean";
    }
    function applyTierToState(tier) {
      try {
        localStorage.setItem(RISQUE_AUTOSAVE_TIER_PREF_KEY, tier);
      } catch (eLs) {
        /* ignore */
      }
      var gs = window.gameState;
      if (gs && typeof gs === "object") {
        gs.risqueAutosaveTier = tier;
        if (tier === "safe_fun") {
          gs.risqueReplayGranularDiskWritesEnabled = true;
          gs.risqueReplayDiskSaveDisabled = false;
        } else {
          gs.risqueReplayGranularDiskWritesEnabled = false;
        }
        try {
          saveState(gs);
        } catch (eSv) {
          /* ignore */
        }
      }
      syncRoundAutosaveStatusFromStorage();
    }
    var applyBtn = document.getElementById("risque-ac-apply");
    var folderBtn = document.getElementById("risque-ac-folder");
    var closeBtn = document.getElementById("risque-ac-close");
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        var tier = readSelectedTier();
        applyTierToState(tier);
        removeAutosaveConfigOverlay();
        setBoardCornerMsg("Autosave policy updated.");
        try {
          logEvent("Autosave tier", { tier: tier });
        } catch (eLog) {
          /* ignore */
        }
      });
    }
    if (folderBtn) {
      folderBtn.addEventListener("click", function () {
        removeAutosaveConfigOverlay();
        mountRoundAutosaveSetupOverlay({ force: true, minimal: true });
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        removeAutosaveConfigOverlay();
      });
    }
    ov.addEventListener("click", function (ev) {
      if (ev.target === ov) {
        removeAutosaveConfigOverlay();
      }
    });
    return true;
  }

  function markRoundAutosavePromptSeen() {
    try {
      sessionStorage.setItem(ROUND_AUTOSAVE_PROMPT_SEEN_KEY, "1");
    } catch (e) {
      /* ignore */
    }
  }

  function hasSeenRoundAutosavePromptThisTab() {
    try {
      return sessionStorage.getItem(ROUND_AUTOSAVE_PROMPT_SEEN_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function injectRoundAutosaveSetupStylesOnce() {
    var sid = "risque-round-autosave-setup-style";
    if (document.getElementById(sid)) return;
    var s = document.createElement("style");
    s.id = sid;
    s.textContent =
      "#risque-round-autosave-setup{position:fixed;inset:0;z-index:1000000;margin:0;padding:24px;" +
      "display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.72);" +
      "font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;}" +
      "#risque-round-autosave-setup *{box-sizing:border-box;}" +
      "#risque-round-autosave-setup .risque-ras-card{max-width:520px;width:100%;background:#111827;" +
      "color:#e5e7eb;border:1px solid #334155;border-radius:12px;padding:20px 22px;" +
      "box-shadow:0 12px 40px rgba(0,0,0,0.45);}" +
      "#risque-round-autosave-setup .risque-ras-title{font-size:20px;font-weight:bold;margin:0 0 10px;color:#fff;}" +
      "#risque-round-autosave-setup .risque-ras-body{font-size:14px;line-height:1.45;margin:0 0 18px;color:#cbd5e1;}" +
      "#risque-round-autosave-setup .risque-ras-actions{display:flex;flex-wrap:wrap;gap:10px;}" +
      "#risque-round-autosave-setup button{font-size:15px;font-weight:bold;border-radius:8px;padding:10px 16px;" +
      "cursor:pointer;border:none;}" +
      "#risque-round-autosave-setup .risque-ras-primary{background:#2563eb;color:#fff;}" +
      "#risque-round-autosave-setup .risque-ras-primary:hover{background:#1d4ed8;}" +
      "#risque-round-autosave-setup .risque-ras-secondary{background:#374151;color:#e5e7eb;}" +
      "#risque-round-autosave-setup .risque-ras-secondary:hover{background:#4b5563;}" +
      "#risque-round-autosave-setup .risque-ras-hint{margin:0 0 16px;font-size:13px;line-height:1.45;color:#94a3b8;}" +
      "#risque-round-autosave-setup .risque-ras-hint code{font-size:12px;color:#cbd5e1;}";
    document.head.appendChild(s);
  }

  function shouldOfferRoundAutosaveSetup(opts) {
    opts = opts || {};
    if (window.risqueDisplayIsPublic) return false;
    if (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()) {
      return false;
    }
    /* force: explicit setup (e.g. click ROUND AUTOSAVE status). file:// shows local-file explanation. */
    if (opts.force) return true;
    /* Boot reminder (unused by default; no blocking modal on startup). */
    if (opts.intro) return true;
    if (typeof window.showDirectoryPicker !== "function") return false;
    /* file:// often blocks directory picker; HTTPS / localhost is the supported path */
    if (window.location.protocol === "file:") return false;
    if (forcedPhase === "login" && (!state.players || !state.players.length)) {
      return false;
    }
    return true;
  }

  function mountRoundAutosaveSetupOverlay(opts) {
    if (!shouldOfferRoundAutosaveSetup(opts)) return false;
    var isFileMode = window.location.protocol === "file:";
    var pickerSupported = typeof window.showDirectoryPicker === "function" && !isFileMode;
    removeRoundAutosaveSetupOverlay();
    injectRoundAutosaveSetupStylesOnce();
    var ov = document.createElement("div");
    ov.id = "risque-round-autosave-setup";
    ov.setAttribute("role", "dialog");
    ov.setAttribute("aria-modal", "true");
    ov.setAttribute("aria-label", "Round autosave folder");
    if (isFileMode) {
      ov.innerHTML =
        '<div class="risque-ras-card">' +
        '<p class="risque-ras-title">Round autosave uses Downloads in local mode</p>' +
        '<p class="risque-ras-body">You opened RISQUE from local files. Autosave will export JSON backups to your browser download folder after each completed round. ' +
        "To save directly into a chosen folder, run RISQUE from localhost/https instead. " +
        "<strong>Every reload or hard refresh (Ctrl+F5)</strong> asks again for this session.</p>" +
        '<p class="risque-ras-hint">Tip: run <code>RISQUE.bat</code> from the repo folder so downloads default to <code>C:\\risque\\save</code>, then use <strong>Choose folder</strong> once for silent checkpoints.</p>' +
        '<div class="risque-ras-actions">' +
        '<button type="button" class="risque-ras-primary" id="risque-ras-local-continue">Continue</button>' +
        "</div>" +
        "</div>";
    } else {
      var minimal = opts && opts.minimal;
      var title = minimal ? "Save folder (one time)" : "Set up round autosave folder";
      var body = minimal
        ? "Your save folder is expected at <strong>" +
          RISQUE_DEFAULT_WINDOWS_SAVE_FOLDER +
          "</strong> (Windows default). Click <strong>Choose folder</strong> and select it once — the browser cannot grant disk access without this step. The launcher sets Chromium downloads there too. Each turn writes <code>rNpMgame.json</code> (game) and <code>rNpM.json</code> (replay); <code>DD.json</code> once after deploy. No end-of-round <code>RQGS-…</code> file."
        : "After each full round, RISQUE saves game and replay JSON into the folder you choose. " +
          "Browsers only allow this after you pick the folder once; we remember it on this device.";
      ov.innerHTML =
        '<div class="risque-ras-card">' +
        '<p class="risque-ras-title">' +
        title +
        "</p>" +
        '<p class="risque-ras-body">' +
        body +
        "</p>" +
        '<p class="risque-ras-hint" id="risque-ras-path-hint" aria-live="polite"></p>' +
        '<div class="risque-ras-actions">' +
        '<button type="button" class="risque-ras-primary" id="risque-ras-choose">Choose folder</button>' +
        '<button type="button" class="risque-ras-secondary" id="risque-ras-skip-downloads">Use Downloads this session</button>' +
        "</div>" +
        "</div>";
    }
    document.body.appendChild(ov);
    if (!isFileMode && typeof window.risqueFetchLauncherPathsJson === "function") {
      var hintEl = document.getElementById("risque-ras-path-hint");
      if (hintEl) {
        window.risqueFetchLauncherPathsJson().then(function (j) {
          if (!hintEl || !hintEl.isConnected) return;
          var saveRoot = j && (j.saveRoot || j.saveDir);
          var replayDir = j && j.replayDir;
          if (!saveRoot && !replayDir) return;
          var parts = [];
          if (saveRoot) parts.push("SAVE: " + saveRoot);
          if (replayDir) parts.push("REPLAY: " + replayDir);
          hintEl.textContent =
            "Launcher paths: " +
            parts.join(" · ") +
            ". Default without launcher: pick " +
            RISQUE_DEFAULT_WINDOWS_SAVE_FOLDER +
            ".";
        });
      }
    }
    var choose = document.getElementById("risque-ras-choose");
    var skipDl = document.getElementById("risque-ras-skip-downloads");
    var localContinue = document.getElementById("risque-ras-local-continue");
    if (choose) {
      choose.addEventListener("click", function () {
        if (pickerSupported) {
          if (__risqueRoundAutosavePickerBusy) return;
          __risqueRoundAutosavePickerBusy = true;
          var pick =
            typeof window.showDirectoryPicker === "function"
              ? window.showDirectoryPicker({ id: "risque-save-root", mode: "readwrite" })
              : Promise.reject(new Error("no picker"));
          pick
            .then(function (dir) {
              risqueHostSaveFolderAdoptDirectoryHandle(dir, window.gameState);
              var persist =
                typeof window.risqueSaveFolderIdbPut === "function"
                  ? window.risqueSaveFolderIdbPut(dir)
                  : Promise.resolve();
              return persist.then(function () {
                markRoundAutosavePromptSeen();
                removeRoundAutosaveSetupOverlay();
                setBoardCornerMsg("Autosave folder saved. Rounds write here automatically.");
                logEvent("Round autosave: folder selected and persisted");
                risqueTryScheduleStaleCheckpointCleanup();
                risqueTryScheduleReplayResumeTidy(window.gameState);
                if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function" && window.gameState) {
                  try {
                    window.risqueReplayTryWriteDdJsonAfterSetupDeploy(window.gameState);
                  } catch (eDdPick) {
                    /* ignore */
                  }
                }
                if (
                  window.gameState &&
                  typeof window.risqueSessionDiskEnsureGameDirHandle === "function"
                ) {
                  window.risqueSessionDiskEnsureGameDirHandle(window.gameState).then(function (dh) {
                    if (
                      dh &&
                      window.gameState &&
                      window.gameState.risqueAutosaveSessionDir &&
                      typeof saveState === "function"
                    ) {
                      try {
                        saveState(window.gameState);
                      } catch (eSessPick) {
                        /* ignore */
                      }
                    }
                  });
                }
              });
            })
            .catch(function (e) {
              if (e && e.name === "AbortError") {
                setBoardCornerMsg("Autosave: cancelled folder picker.");
              } else {
                setBoardCornerMsg(
                  "Autosave: folder picker failed (" + (e && e.message ? e.message : "error") + ")."
                );
              }
            })
            .finally(function () {
              __risqueRoundAutosavePickerBusy = false;
            });
        }
      });
    }
    if (skipDl) {
      skipDl.addEventListener("click", function () {
        try {
          sessionStorage.setItem(ROUND_AUTOSAVE_FOLDER_PROMPT_SESSION_KEY, "1");
        } catch (eSk) {
          /* ignore */
        }
        markRoundAutosavePromptSeen();
        removeRoundAutosaveSetupOverlay();
        setBoardCornerMsg("Autosave: using browser Downloads this session.");
        logEvent("Round autosave: user chose downloads for session");
      });
    }
    if (localContinue) {
      localContinue.addEventListener("click", function () {
        markRoundAutosavePromptSeen();
        removeRoundAutosaveSetupOverlay();
        setBoardCornerMsg("Round autosave: local mode will export JSON backups to downloads.");
        logEvent("Round autosave: local mode confirmed (downloads)");
      });
    }
    return true;
  }

  function bootRestoreAutosaveFolder(gameStateForSession) {
    if (window.risqueDisplayIsPublic) return Promise.resolve();
    var gsAttach = gameStateForSession || window.gameState;
    var diskChain =
      typeof window.risqueLocalDiskBootstrap === "function"
        ? window.risqueLocalDiskBootstrap()
        : Promise.resolve(false);
    return diskChain
      .then(function () {
        var checkpointP =
          typeof window.risqueLocalDiskTryApplyPeriodicRestartCheckpoint === "function"
            ? window.risqueLocalDiskTryApplyPeriodicRestartCheckpoint()
            : Promise.resolve(false);
        return checkpointP.then(function (didNav) {
          if (didNav) return null;
        if (typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive()) {
          try {
            setBoardCornerMsg("Autosave: launcher paths → flat folder (default C:\\risque\\save).");
          } catch (eMsgL) {
            /* ignore */
          }
          if (gsAttach && typeof window.risqueSessionDiskReattachFromGameState === "function") {
            return window.risqueSessionDiskReattachFromGameState(gsAttach).then(function () {
              try {
                if (gsAttach.risqueAutosaveSessionDir && typeof saveState === "function") {
                  saveState(gsAttach);
                }
              } catch (eSessPersist) {
                /* ignore */
              }
              risqueReplayEnableDiskTapeExportsForWritableSaveRoot(gsAttach);
              risqueTryScheduleStaleCheckpointCleanup();
              risqueTryScheduleReplayResumeTidy(gsAttach);
              if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function") {
                try {
                  window.risqueReplayTryWriteDdJsonAfterSetupDeploy(gsAttach);
                } catch (eDdBoot) {
                  /* ignore */
                }
              }
              return null;
            });
          }
          risqueReplayEnableDiskTapeExportsForWritableSaveRoot(gsAttach);
          risqueTryScheduleStaleCheckpointCleanup();
          risqueTryScheduleReplayResumeTidy(gsAttach);
          return Promise.resolve(null);
        }
        /* file:// can still restore the picked SAVE folder from IndexedDB (same as http origin for many setups). */
        if (typeof window.risqueSaveFolderIdbGet !== "function") return Promise.resolve(null);
        if (typeof window.risqueSaveFolderEnsureWritable !== "function") return Promise.resolve(null);
        return window
          .risqueSaveFolderIdbGet()
          .then(function (h) {
            if (!h) return null;
            return window.risqueSaveFolderEnsureWritable(h);
          })
          .then(function (h) {
            if (h) {
              risqueHostSaveFolderAdoptDirectoryHandle(h, gsAttach);
              try {
                setBoardCornerMsg("Autosave: writing rounds to your chosen folder (no download prompts).");
              } catch (eMsg) {
                /* ignore */
              }
            }
            if (
              h &&
              gsAttach &&
              typeof window.risqueSessionDiskReattachFromGameState === "function"
            ) {
              return window.risqueSessionDiskReattachFromGameState(gsAttach).then(function () {
                try {
                  if (gsAttach.risqueAutosaveSessionDir && typeof saveState === "function") {
                    saveState(gsAttach);
                  }
                } catch (eSessPersist2) {
                  /* ignore */
                }
                risqueTryScheduleStaleCheckpointCleanup();
                risqueTryScheduleReplayResumeTidy(gsAttach);
                if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function") {
                  try {
                    window.risqueReplayTryWriteDdJsonAfterSetupDeploy(gsAttach);
                  } catch (eDdIdb) {
                    /* ignore */
                  }
                }
                return h;
              });
            }
            if (h) {
              risqueTryScheduleStaleCheckpointCleanup();
              risqueTryScheduleReplayResumeTidy(gsAttach);
            }
            return h;
          });
        });
      })
      .catch(function () {
        return null;
      });
  }

  function writeRoundAutosaveToDisk(gs) {
    if (!gs) return Promise.resolve(false);
    /* RQGS end-of-round game JSON disabled — per-turn rNpMgame + rNpM only; in-tab round history still uses saveRoundAutosaveSnapshotInner localStorage. */
    try {
      if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
        window.risqueReplayEnsureLatestBoardFrame(gs);
      }
    } catch (eBoard) {
      /* ignore */
    }
    if (typeof window.risqueReplayTryWriteDdJsonAfterSetupDeploy === "function") {
      try {
        window.risqueReplayTryWriteDdJsonAfterSetupDeploy(gs);
      } catch (eDdRa) {
        /* ignore */
      }
    }
    return Promise.resolve(true).then(function () {
      /* Do not delete rNpMgame / legacy game-ckpt here: without RQGS they are the durable per-turn game saves; old logic removed them after each "round save". */
      if (
        gs.risqueGameWinAutosaved &&
        !gs.risqueSessionDiskFinalized &&
        typeof window.risqueSessionDiskFinalizeGameWin === "function"
      ) {
        risqueReplayEnableGranularDiskWrites("game-win", gs);
        return window
          .risqueSessionDiskFinalizeGameWin(gs)
          .then(function (fin) {
            if (fin) {
              try {
                gs.risqueSessionDiskFinalized = true;
              } catch (eFin) {
                /* ignore */
              }
            }
            return true;
          })
          .then(function () {
            risqueReplayDisableGranularDiskWrites("game-win-done", gs);
          })
          .catch(function () {
            risqueReplayDisableGranularDiskWrites("game-win-done", gs);
          });
      }
      return true;
    });
  }

  function exportBrowserEmergencyReplayPack(row, replayPack) {
    if (!row || !replayPack || replayPack.format !== "risque-replay-v1") return;
    var seq =
      row.emergencySeq != null ? Math.max(1, Math.floor(Number(row.emergencySeq)) || 1) : 1;
    var fname = "replay-emergency-" + seq + ".json";
    var json;
    try {
      json = JSON.stringify(replayPack);
    } catch (eS) {
      return;
    }
    var blob = new Blob([json], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    logEvent("Emergency save: exported replay pack JSON", { file: fname });
  }

  function exportBrowserEmergencyAutosaveJson(stateJson, replayPackOpt, row) {
    if (!stateJson) return;
    var seq =
      row && row.emergencySeq != null
        ? Math.max(1, Math.floor(Number(row.emergencySeq)) || 1)
        : 1;
    var fname = "game-emergency-" + seq + ".json";
    var blob = new Blob([String(stateJson)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = fname;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    logEvent("Emergency save: exported game JSON", { file: fname });
    if (replayPackOpt && replayPackOpt.format === "risque-replay-v1") {
      setTimeout(function () {
        exportBrowserEmergencyReplayPack(row || { at: Date.now(), round: 1 }, replayPackOpt);
      }, 400);
    }
  }

  function writeEmergencyAutosaveToDisk(gs) {
    if (!gs) return Promise.resolve(false);
    var gameP =
      typeof window.risqueSessionDiskEnsureGameDirHandle === "function"
        ? window.risqueSessionDiskEnsureGameDirHandle(gs)
        : Promise.resolve(__risqueRoundAutosaveDirHandle);
    var replayP =
      typeof window.risqueSessionDiskEnsureReplayDirHandle === "function"
        ? window.risqueSessionDiskEnsureReplayDirHandle(gs)
        : Promise.resolve(__risqueRoundAutosaveDirHandle);
    return Promise.all([gameP, replayP]).then(function (dirs) {
      var gameDir = dirs[0];
      var replayDir = dirs[1];
      if (!gameDir || !replayDir || !gs) return false;
      var canDisk =
        (gameDir.__risqueVirtualDir && replayDir.__risqueVirtualDir) ||
        (typeof gameDir.getFileHandle === "function" && typeof replayDir.getFileHandle === "function");
      if (!canDisk) return false;
      var seq = Math.max(1, Math.floor(Number(gs.risqueSimpleAutosaveSeq)) || 1);
      var fname = "game-emergency-" + seq + ".json";
      var forDisk = gs;
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forDisk = window.risqueStripReplayFromGameStateClone(gs);
        }
      } catch (eStripDisk) {
        forDisk = gs;
      }
      var payload = JSON.stringify(forDisk, null, 2);
      var replayPack = null;
      try {
        replayPack =
          typeof window.risqueBuildSessionReplayExport === "function"
            ? window.risqueBuildSessionReplayExport(gs)
            : typeof window.risqueBuildRoundReplayExport === "function"
              ? window.risqueBuildRoundReplayExport(gs, Number(gs.round) || 1)
              : null;
      } catch (eRp) {
        replayPack = null;
      }
      var writeFn =
        typeof window.risqueSessionDiskWriteTextFile === "function"
          ? window.risqueSessionDiskWriteTextFile
          : null;
      if (!writeFn) return false;
      return writeFn(gameDir, fname, payload)
        .then(function (okG) {
          if (!okG) throw new Error("game write failed");
          logEvent("Emergency save: wrote game file", { file: fname });
          if (!replayPack || replayPack.format !== "risque-replay-v1") {
            return true;
          }
          var rfname = "replay-emergency-" + seq + ".json";
          var rjson;
          try {
            rjson = JSON.stringify(replayPack, null, 2);
          } catch (eJ) {
            return true;
          }
          return writeFn(replayDir, rfname, rjson).then(function (okR) {
            if (!okR) throw new Error("replay write failed");
            logEvent("Emergency save: wrote replay file", { file: rfname });
            return true;
          });
        })
        .catch(function (err) {
          logEvent("Emergency save: disk write failed", {
            message: err && err.message ? err.message : String(err)
          });
          return false;
        });
    });
  }

  function saveEmergencyAutosaveSnapshot(gs) {
    if (!gs || window.risqueDisplayIsPublic) return;
    if (typeof window.risqueReplayEnsureTapeSessionKey === "function") {
      try {
        window.risqueReplayEnsureTapeSessionKey(gs);
      } catch (eSk) {
        /* ignore */
      }
    }
    try {
      saveState(gs);
    } catch (eSv) {
      /* ignore */
    }
    var forSave = gs;
    try {
      if (typeof window.risqueStripReplayFromGameStateClone === "function") {
        forSave = window.risqueStripReplayFromGameStateClone(gs);
      }
    } catch (eStrip) {
      forSave = gs;
    }
    var snapshotJson = JSON.stringify(forSave);
    var replayPack = null;
    try {
      replayPack =
        typeof window.risqueBuildSessionReplayExport === "function"
          ? window.risqueBuildSessionReplayExport(gs)
          : typeof window.risqueBuildRoundReplayExport === "function"
            ? window.risqueBuildRoundReplayExport(gs, Number(gs.round) || 1)
            : null;
    } catch (eRep) {
      replayPack = null;
    }
    var emSeq = typeof risqueAllocSimpleAutosaveSeq === "function" ? risqueAllocSimpleAutosaveSeq(gs) : 1;
    var row = {
      at: Date.now(),
      round: Number(gs.round) || 1,
      phase: String(gs.phase || ""),
      currentPlayer: String(gs.currentPlayer || ""),
      emergencySeq: emSeq
    };
    waitForAutosaveFolderBoot().then(function () {
      var targetMode = hasRoundAutosaveDiskTarget() ? "disk-folder" : "browser-download";
      if (targetMode === "disk-folder") {
        Promise.resolve(writeEmergencyAutosaveToDisk(gs))
          .then(function (ok) {
            if (ok) {
              setBoardCornerMsg(
                "Emergency save: game + replay written to your save folder (game-emergency-*, replay-emergency-*)."
              );
              return;
            }
            exportBrowserEmergencyAutosaveJson(snapshotJson, replayPack, row);
            setBoardCornerMsg("Emergency save: downloaded game + replay (disk write failed).");
          })
          .catch(function () {
            exportBrowserEmergencyAutosaveJson(snapshotJson, replayPack, row);
            setBoardCornerMsg("Emergency save: downloaded game + replay (disk error).");
          });
        return;
      }
      try {
        exportBrowserEmergencyAutosaveJson(snapshotJson, replayPack, row);
        setBoardCornerMsg("Emergency save: downloaded game + replay JSON (game-emergency-*, replay-emergency-*).");
      } catch (eEx) {
        setBoardCornerMsg("Emergency save failed.");
      }
    });
  }

  function triggerEmergencyHostSnapshot() {
    if (window.risqueDisplayIsPublic) return;
    var snap = getActiveGameStateSnapshot();
    if (!snap || !snap.players || !snap.players.length) {
      setBoardCornerMsg("Emergency save: no active game.");
      return;
    }
    var ph = String(snap.phase || "");
    if (ph === "login") {
      setBoardCornerMsg("Emergency save: not available on login.");
      return;
    }
    saveEmergencyAutosaveSnapshot(snap);
  }

  function text(value) {
    return String(value == null ? "" : value);
  }

  function currentPlayer(state) {
    return state.players.find(function (p) { return p.name === state.currentPlayer; }) || null;
  }

  function getHandSize(state) {
    var player = currentPlayer(state);
    if (!player) return 0;
    player.cards = ensureArray(player.cards, []);
    player.cardCount = player.cards.length;
    return player.cards.length;
  }

  function discardOldestCard(state) {
    var player = currentPlayer(state);
    if (!player) return "No active player";
    player.cards = ensureArray(player.cards, []);
    if (!player.cards.length) {
      player.cardCount = 0;
      return "No cards to discard";
    }
    var removed = player.cards.shift();
    player.cardCount = player.cards.length;
    var removedName = removed && removed.name ? removed.name : "unknown";
    if (
      removedName &&
      removedName !== "unknown" &&
      window.gameUtils &&
      typeof window.gameUtils.risqueDiscardCardNames === "function"
    ) {
      window.gameUtils.risqueDiscardCardNames(state, [removedName]);
    }
    return "Discarded: " + removedName;
  }

  function trimHandToFour(state) {
    var messages = [];
    while (getHandSize(state) > 4) {
      messages.push(discardOldestCard(state));
    }
    return messages.length ? messages.join(" | ") : "Hand already 4 or fewer";
  }

  function ensureDeck(state) {
    if (window.gameUtils && typeof window.gameUtils.risqueEnsureDiscardPile === "function") {
      window.gameUtils.risqueEnsureDiscardPile(state);
    } else if (!Array.isArray(state.discardPile)) {
      state.discardPile = [];
    }
    var used = {};
    state.players.forEach(function (p) {
      p.cards.forEach(function (c) {
        var name = typeof c === "string" ? c : c.name;
        if (name) used[name] = true;
      });
    });
    var discardSet = {};
    (state.discardPile || []).forEach(function (n) {
      if (n) discardSet[n] = true;
    });
    state.deck = ensureArray(state.deck, []).filter(function (name) {
      return CARD_NAMES.indexOf(name) !== -1 && !used[name] && !discardSet[name];
    });
    if (
      state.deck.length === 0 &&
      window.gameUtils &&
      typeof window.gameUtils.risqueMaybeReshuffleDiscardIntoDeck === "function"
    ) {
      window.gameUtils.risqueMaybeReshuffleDiscardIntoDeck(state);
      discardSet = {};
      (state.discardPile || []).forEach(function (n) {
        if (n) discardSet[n] = true;
      });
    }
    state.deck = ensureArray(state.deck, []).filter(function (name) {
      return CARD_NAMES.indexOf(name) !== -1 && !used[name] && !discardSet[name];
    });
  }

  function shuffle(array) {
    var copy = array.slice();
    for (var i = copy.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = copy[i];
      copy[i] = copy[j];
      copy[j] = t;
    }
    return copy;
  }

  function maybeAwardCard(state) {
    var player = currentPlayer(state);
    if (!player) return "No active player";
    if (!(state.cardEarnedViaAttack || state.cardEarnedViaCardplay)) {
      state.cardAwardedThisTurn = true;
      state.lastCardDrawn = null;
      return "No card earned this turn";
    }
    if (state.cardAwardedThisTurn) {
      return state.lastCardDrawn ? "Card already awarded: " + state.lastCardDrawn : "Card already processed";
    }
    ensureDeck(state);
    if (!state.deck.length) {
      state.cardAwardedThisTurn = true;
      state.lastCardDrawn = null;
      return "No available card in deck";
    }
    var idx = Math.floor(Math.random() * state.deck.length);
    var cardName = state.deck.splice(idx, 1)[0];
    player.cards.push({ name: cardName, id: makeId() });
    player.cardCount = player.cards.length;
    state.lastCardDrawn = cardName;
    state.cardAwardedThisTurn = true;
    return "Awarded card: " + cardName;
  }

  function advanceTurn(state) {
    if (!state.turnOrder.length) return false;
    var tor =
      typeof window.risqueReplayResolveTurnOrderIndex === "function"
        ? window.risqueReplayResolveTurnOrderIndex(state.turnOrder, state.currentPlayer)
        : null;
    var currentIndex =
      tor && typeof tor.index === "number" && tor.index >= 0
        ? tor.index
        : state.turnOrder.indexOf(state.currentPlayer);
    if (currentIndex < 0) {
      try {
        console.warn(
          "[RISQUE] advanceTurn: currentPlayer not found in turnOrder (granular replay flush would mis-attribute)",
          state.currentPlayer,
          state.turnOrder
        );
      } catch (eW) {
        /* ignore */
      }
      return false;
    }
    var prevPlayerJustFinished = state.turnOrder[currentIndex];
    var nextIndex = (currentIndex + 1) % state.turnOrder.length;
    state.currentPlayer = state.turnOrder[nextIndex];
    if (
      typeof window !== "undefined" &&
      window.gameUtils &&
      typeof window.gameUtils.clearContinentalConquestRoutingOnTurnAdvance === "function"
    ) {
      window.gameUtils.clearContinentalConquestRoutingOnTurnAdvance(state);
    }
    if (nextIndex === 0) {
      var completedRoundAdv = Number(state.round) || 1;
      state.round = completedRoundAdv + 1;
      if (typeof window.risqueRoundAutosaveOnRoundComplete === "function") {
        window.risqueRoundAutosaveOnRoundComplete(state, completedRoundAdv);
      }
    }
    state.phase = "cardplay";
    state.cardEarnedViaAttack = false;
    state.cardEarnedViaCardplay = false;
    state.cardAwardedThisTurn = false;
    state.lastCardDrawn = null;
    if (typeof window.risqueReplayOnHostEnterCardplay === "function" && !window.risqueDisplayIsPublic) {
      window.risqueReplayOnHostEnterCardplay(state);
    }
    if (
      typeof window.risqueSessionDiskScheduleTurnCheckpoint === "function" &&
      !window.risqueDisplayIsPublic
    ) {
      try {
        return window.risqueSessionDiskScheduleTurnCheckpoint(state, prevPlayerJustFinished);
      } catch (eAdvDisk) {
        return typeof window.risqueSessionDiskAwaitTurnWriteQueue === "function"
          ? window.risqueSessionDiskAwaitTurnWriteQueue()
          : undefined;
      }
    }
    return undefined;
  }

  function renderCardplay(state) {
    if (window.risquePhases && window.risquePhases.cardplay && typeof window.risquePhases.cardplay.render === "function") {
      return window.risquePhases.cardplay.render(state, {
        text: text,
        currentPlayer: currentPlayer,
        legacyNext: legacyNext
      });
    }
    var player = currentPlayer(state);
    var cards = player ? player.cards.map(function (c) { return c.name; }) : [];
    var overLimit = cards.length > 4;
    return (
      "<p><strong>Player:</strong> " + text(state.currentPlayer) + "</p>" +
      "<p><strong>Cards in hand:</strong> " + text(cards.length) + "</p>" +
      "<p class='muted'>Fallback inline cardplay renderer (module not loaded).</p>" +
      (overLimit ? "<p style='color:#fca5a5;'><strong>Rule:</strong> Hand is over 4. Reduce cards before continuing.</p>" : "") +
      "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;'>" +
      "<button data-action='earned-attack'>Mark Earned via Attack</button>" +
      "<button data-action='earned-cardplay'>Mark Earned via Cardplay</button>" +
      "<button data-action='discard-one'>Discard Oldest Card</button>" +
      "<button data-action='trim-four'>Auto-Trim Hand To 4</button>" +
      "<button data-action='finish-cardplay' style='background:#00ff00;color:#0b1220;'>Finish Cardplay</button>" +
      "</div>"
    );
  }

  function renderReceiveCard(state) {
    var player = currentPlayer(state);
    var cards = player ? player.cards.map(function (c) { return c.name; }) : [];
    return (
      "<p><strong>Player:</strong> " + text(state.currentPlayer) + "</p>" +
      "<p><strong>Cards in hand:</strong> " + text(cards.length) + "</p>" +
      "<p><strong>Last draw:</strong> " + (state.lastCardDrawn || "none") + "</p>" +
      "<p class='muted'>Awards card at most once, then advances to next player in <code>cardplay</code>.</p>" +
      "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;'>" +
      "<button data-action='award-now'>Process Card Award</button>" +
      "<button data-action='end-turn' style='background:#00ff00;color:#0b1220;'>End Turn</button>" +
      "</div>"
    );
  }

  function renderUnknown(state) {
    return (
      "<p><strong>Current phase:</strong> " + text(state.phase) + "</p>" +
      "<p class='muted'>This M2 runtime currently handles only <code>cardplay</code> and <code>receivecard</code>.</p>" +
      "<div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;'>" +
      "<button data-action='force-cardplay'>Force Phase: cardplay</button>" +
      "</div>"
    );
  }

  function renderHandCardsOnBoard(state) {
    var ui = document.getElementById("ui-overlay");
    if (!ui) return;
    var existing = ui.querySelectorAll(".runtime-hand-card");
    for (var i = 0; i < existing.length; i += 1) {
      existing[i].parentNode.removeChild(existing[i]);
    }
    // Keep card rendering phase-owned (cardplay / receivecard). Avoid shell ghost cards.
    return;
  }

  function updateDiagnostics(note) {
    var el = document.getElementById("viz-diagnostics");
    if (!el) return;
    var canvasDiag = document.getElementById("canvas");
    var stage = canvasDiag ? canvasDiag.querySelector(".stage-image") : null;
    var svg = canvasDiag ? canvasDiag.querySelector(".svg-overlay") : null;
    var circles = svg ? svg.querySelectorAll("circle.territory-circle").length : 0;
    var handCount = document.querySelectorAll("#ui-overlay .runtime-hand-card").length;
    var stageLine = "Stage: not loaded";
    if (stage) {
      if (stage.complete && stage.naturalWidth > 0) {
        stageLine = "Stage: OK " + stage.naturalWidth + "×" + stage.naturalHeight;
      } else {
        stageLine = "Stage: loading or broken (check assets/images/stage.png)";
      }
    }
    var valid = window.gameUtils && window.gameUtils.validateGameState(state);
    var lines = [
      stageLine,
      "Territory circles: " + circles,
      "Hand sprites on board: " + handCount,
      "validateGameState: " + !!valid,
      "Phase: " + text(state.phase) + " | Player: " + text(state.currentPlayer)
    ];
    if (note) lines.push("Note: " + note);
    el.innerHTML = "<pre>" + lines.join("\n") + "</pre>";
  }

  /** Map + stats only: empty board and no roster names until players sign in. */
  function visualStateForLoginScreen(gs) {
    try {
      var s = JSON.parse(JSON.stringify(gs));
      s.phase = "login";
      s.currentPlayer = "";
      s.turnOrder = [];
      s.players = [];
      return s;
    } catch (e) {
      return gs;
    }
  }

  function maybeEnsureRuntimeHud(gs) {
    if (!gs || gs.phase === "login") return;
    var canvas = document.getElementById("canvas");
    /* Public TV: first mirror frame can run before resize marks #canvas visible — voice panel would never mount. */
    if (
      window.risqueDisplayIsPublic &&
      canvas &&
      !canvas.classList.contains("visible") &&
      window.gameUtils &&
      typeof window.gameUtils.resizeCanvas === "function"
    ) {
      try {
        window.gameUtils.resizeCanvas();
      } catch (eResizeHud) {
        /* ignore */
      }
    }
    canvas = document.getElementById("canvas");
    if (!canvas || !canvas.classList.contains("visible")) return;
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || uiOverlay.classList.contains("risque-deploy1-ui")) return;
    /* Public TV: host runs refreshSetupStageChrome on setup URLs; the mirror only gets state pushes — swap login minimal column for full setup (stats + voice + log) as soon as phase leaves login. */
    if (window.risqueDisplayIsPublic && window.risqueRuntimeHud && typeof window.risqueRuntimeHud.ensureSetupHud === "function") {
      var setupPh = String(gs.phase || "");
      if (
        setupPh === "playerSelect" ||
        setupPh === "deal" ||
        setupPh === "deploy1" ||
        setupPh === "deploy" ||
        setupPh === "privacyGate" ||
        setupPh === "privacy-gate"
      ) {
        window.risqueRuntimeHud.ensureSetupHud(uiOverlay, "SETUP");
        if (typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
          window.risqueRuntimeHud.updateTurnBannerFromState(gs);
        }
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
            window.risqueRuntimeHud.syncPosition();
          }
        });
        return;
      }
    }
    /* Canonical phase "deploy": deploy.js builds .runtime-hud-root--setup via ensureSetupUnifiedHud.
       Do not call ensure() here — it would replace the shell with the post-setup column.
       Private host still needs the STATS document listener (otherwise it is never wired if deploy
       is the first post-login phase that hits this path, e.g. setup deploy after deal). */
    if (String(gs.phase || "") === "deploy") {
      if (!window.risqueDisplayIsPublic) {
        wireHostPrivateStatsToggleOnce();
        wireHostPrivateCardsPlayedToggleOnce();
        wireHostPrivateLuckyToggleOnce();
        wireHostPrivateCardsInHandToggleOnce();
        ensureGraceHostOverlayInDom();
        wireGraceHostOverlayOnce();
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
            window.risqueRuntimeHud.syncPosition();
          }
        });
      }
      return;
    }
    if (!window.risqueRuntimeHud || typeof window.risqueRuntimeHud.ensure !== "function") return;
    if (!window.risqueRuntimeHud.isPostSetupPhase(gs.phase)) return;
    if (!window.gameUtils || !window.gameUtils.validateGameState(gs)) return;
    window.risqueRuntimeHud.ensure(uiOverlay);
    if (typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
      window.risqueRuntimeHud.updateTurnBannerFromState(gs);
    }
    wireHostPrivateStatsToggleOnce();
    wireHostPrivateCardsPlayedToggleOnce();
    wireHostPrivateLuckyToggleOnce();
    wireHostPrivateCardsInHandToggleOnce();
    if (!window.risqueDisplayIsPublic) {
      ensureGraceHostOverlayInDom();
      wireGraceHostOverlayOnce();
    }
    requestAnimationFrame(function () {
      if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
        window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  var RISQUE_PHASE_ENTRY_VEIL_KEY = "risquePhaseEntryVeil";

  /** Host: black veil across cardplay→income navigation until first income/con-income map paint finishes (sessionStorage set in cardplay.js). */
  function risqueEnsurePhaseIncomeEntryVeilFromStorage(st) {
    if (window.risqueDisplayIsPublic) return;
    if (!st || typeof st !== "object") return;
    var ph = String(st.phase || "");
    if (ph !== "income" && ph !== "con-income") return;
    try {
      if (sessionStorage.getItem(RISQUE_PHASE_ENTRY_VEIL_KEY) !== "1") return;
    } catch (eV) {
      return;
    }
    if (document.getElementById("risque-phase-entry-veil")) return;
    var v = document.createElement("div");
    v.id = "risque-phase-entry-veil";
    v.setAttribute("aria-hidden", "true");
    v.style.cssText =
      "position:fixed;inset:0;background:#000000;z-index:2147483644;pointer-events:none;";
    document.body.appendChild(v);
  }

  function risqueClearPhaseIncomeEntryVeilAfterPaint() {
    if (window.risqueDisplayIsPublic) return;
    try {
      if (sessionStorage.getItem(RISQUE_PHASE_ENTRY_VEIL_KEY) !== "1") return;
    } catch (e0) {
      return;
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        try {
          var el = document.getElementById("risque-phase-entry-veil");
          if (el && el.parentNode) el.parentNode.removeChild(el);
          sessionStorage.removeItem(RISQUE_PHASE_ENTRY_VEIL_KEY);
        } catch (e1) {}
      });
    });
  }

  function refreshVisuals(note) {
    /* TV: storage/poll may apply a newer mirror before this rAF — do not clobber risquePublicPlayerSelectFlash etc. */
    if (window.risqueDisplayIsPublic && window.gameState && typeof window.gameState === "object") {
      var seqMirror = Number(window.gameState.risquePublicMirrorSeq) || 0;
      var seqBoot = Number(state.risquePublicMirrorSeq) || 0;
      if (seqMirror >= seqBoot) {
        state = window.gameState;
      }
    }
    /* Host inline Wayback: when replay runs to completion, shell `state` still matches mount-time host JSON.
     * refreshVisuals() would then do window.gameState = state and rewind the map (e.g. one cycle before
     * the last battle / winner board). Pull state forward from the final tape frame instead. */
    if (
      !window.risqueDisplayIsPublic &&
      window.__risqueInlineWaybackActive &&
      window.__risqueReplayEnded &&
      window.gameState &&
      typeof window.gameState === "object"
    ) {
      try {
        state = window.gameState;
      } catch (eWbRs) {
        /* ignore */
      }
    }
    if (typeof window.risqueCheapReplayDetachFromGameState === "function") {
      try {
        if (window.gameState) window.risqueCheapReplayDetachFromGameState(window.gameState);
        if (state) window.risqueCheapReplayDetachFromGameState(state);
      } catch (eCrDet) {
        /* ignore */
      }
    }
    window.gameState = state;
    if (typeof window.risqueCheapReplayDetachFromGameState === "function" && window.gameState) {
      try {
        window.risqueCheapReplayDetachFromGameState(window.gameState);
      } catch (eCrDet2) {
        /* ignore */
      }
    }
    risqueEnsurePhaseIncomeEntryVeilFromStorage(state);
    if (
      !window.risqueDisplayIsPublic &&
      state &&
      typeof state === "object" &&
      String(state.phase || "") !== "login"
    ) {
      risqueRestoreHostMapCanvasFromPhaseArtifacts();
    }
    if (!window.risqueDisplayIsPublic && state && typeof state === "object") {
      var phClear = String(state.phase || "");
      if (
        phClear !== "attack" &&
        !risqueGamePhaseIsContinentalConquestChain(phClear)
      ) {
        try {
          delete state.risqueBattleHudReadout;
          delete state.risqueLastDiceDisplay;
          delete state.risqueAttackOutcomePrimary;
          delete state.risqueAttackOutcomeReport;
          delete state.risqueAttackOutcomeAcquisition;
          delete state.risquePublicAttackTransferSummary;
          delete state.risquePublicAttackSelectionLine;
          delete state.risquePublicBlitzBanner;
          delete state.risquePublicBlitzBannerReport;
          if (state.attackPhase) delete state.attackPhase;
          delete state.risquePublicTransferMirrorSeal;
        } catch (eAtkClr) {
          /* ignore */
        }
      }
    }
    /* Host: mark #canvas visible before the deferred rAF paint so the board does not sit at opacity 0
     * for an extra frame (slate body + long opacity fade read as a grey screen during scene changes). */
    if (
      !window.risqueDisplayIsPublic &&
      state &&
      String(state.phase || "") !== "login" &&
      typeof resizeRuntimeCanvas === "function"
    ) {
      try {
        resizeRuntimeCanvas();
      } catch (eHostCanvasVis) {
        /* ignore */
      }
    }
    syncPhaseDataAttr(state);
    /* Login-only Wayback folder badge: render() used to be the only caller of syncWaybackConnectedLoginFlag.
     * Phase changes after sign-in often call refreshVisuals() without render(), so the green badge must sync here too. */
    syncWaybackConnectedLoginFlag(state);
    requestAnimationFrame(function () {
      ensureBoardCornerTools();
      ensurePublicHostlikeRoundIndicatorStrip();
      syncMapRoundIndicatorFromState(state);
      if (state.phase === "login") {
        if (stageHost) stageHost.style.visibility = "";
        if (!window.gameUtils) {
          updateDiagnostics(note || "core.js not loaded");
          return;
        }
        window.gameUtils.initGameView();
        var loginVisual = visualStateForLoginScreen(state);
        try {
          window.gameUtils.renderTerritories(null, loginVisual);
        } catch (e0) {
          /* ignore */
        }
        var uio = document.getElementById("ui-overlay");
        if (uio && window.risqueRuntimeHud && typeof window.risqueRuntimeHud.ensureLogin === "function") {
          window.risqueRuntimeHud.ensureLogin(uio);
        }
        try {
          window.gameUtils.renderStats(loginVisual);
        } catch (e1) {
          /* ignore */
        }
        if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.updateTurnBannerFromState === "function") {
          try {
            window.risqueRuntimeHud.updateTurnBannerFromState(loginVisual);
          } catch (eBanner) {
            /* ignore */
          }
        }
        resizeRuntimeCanvas();
        requestAnimationFrame(function () {
          if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
            window.risqueRuntimeHud.syncPosition();
          }
        });
        updateDiagnostics(note || "Login — board visible; sign in via HUD on the right.");
        return;
      }
      if (stageHost) stageHost.style.visibility = "";
      if (!window.gameUtils) {
        updateDiagnostics("core.js not loaded");
        return;
      }
      if (!window.gameUtils.validateGameState(state)) {
        updateDiagnostics("Invalid gameState — open Legacy or load a save");
        try {
          window.gameUtils.renderTerritories(null, state);
          window.gameUtils.renderStats(state);
        } catch (e1) {
          updateDiagnostics(e1.message || String(e1));
        }
        renderHandCardsOnBoard(state);
        resizeRuntimeCanvas();
        if (!window.risqueDisplayIsPublic) {
          risquePublicApplyDiceAndBattleReadout(state);
        }
        risquePublicApplyVoiceAndLogMirror(state);
        risqueClearPhaseIncomeEntryVeilAfterPaint();
        return;
      }
      try {
        maybeEnsureRuntimeHud(state);
        risquePublicEnsureCardplayRecapPanel(state);
        if (!window.risqueDisplayIsPublic) {
          risquePublicBookSequenceOnIncomingState(state);
        }
        if (!window.risqueDisplayIsPublic && _pubBook.skipTerritoryRedraw) {
          /* cardplay book tween holds map — same as public mirror path */
        } else if (
          !window.risqueDisplayIsPublic &&
          _pubBook.displayTroopMap &&
          (_pubBook.phase === "summary" || _pubBook.phase === "step")
        ) {
          risquePublicRenderMapForBook(state);
        } else {
          window.gameUtils.renderTerritories(null, state);
        }
        window.gameUtils.renderStats(state);
        renderHandCardsOnBoard(state);
        resizeRuntimeCanvas();
        maybeEnsureRuntimeHud(state);
        updateDiagnostics(note);
        if (!window.risqueDisplayIsPublic) {
          risquePublicApplyDiceAndBattleReadout(state);
          var rhHost = document.getElementById("runtime-hud-root");
          if (rhHost) {
            if (rhHost.classList.contains("runtime-hud-root--host-panel-cards-focus")) {
              risqueRenderHostCardsPlayedPanel(state);
            }
            if (rhHost.classList.contains("runtime-hud-root--host-panel-hand-focus")) {
              risqueRenderHostCardsInHandPanel(state);
            }
            if (rhHost.classList.contains("runtime-hud-root--host-panel-lucky-focus")) {
              risqueRenderHostLuckyPanel(state);
            }
          }
        }
        risquePublicApplyVoiceAndLogMirror(state);
        if (
          !window.risqueDisplayIsPublic &&
          state &&
          risquePhaseIsIncomeVoiceMirror(state.phase) &&
          state.risquePublicIncomeBreakdown &&
          !risqueIncomePhaseBookRecapActive(state) &&
          typeof window.risqueHostApplyIncomeBreakdownVoice === "function"
        ) {
          try {
            window.risqueHostApplyIncomeBreakdownVoice(state);
          } catch (eIncHost) {
            /* ignore */
          }
        }
        (function () {
          var ap =
            state.risqueAerialLinkPending &&
            typeof state.risqueAerialLinkPending === "object" &&
            state.risqueAerialLinkPending.source &&
            state.risqueAerialLinkPending.target
              ? state.risqueAerialLinkPending
              : null;
          var ad =
            state &&
            state.aerialAttack &&
            typeof state.aerialAttack === "object" &&
            state.aerialAttack.source &&
            state.aerialAttack.target
              ? state.aerialAttack
              : null;
          var al = ap || ad;
          if (al && typeof window.risqueRedrawAerialBridgeOverlay === "function") {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                try {
                  window.risqueRedrawAerialBridgeOverlay();
                } catch (eBr) {
                  /* ignore */
                }
              });
            });
          } else if (!al && typeof window.risqueClearAerialBridgeOverlay === "function") {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                try {
                  window.risqueClearAerialBridgeOverlay();
                } catch (eClrH) {
                  /* ignore */
                }
              });
            });
          }
        })();
        if (
          !window.risqueDisplayIsPublic &&
          state &&
          String(state.phase || "") === "attack" &&
          typeof window.risqueSyncAttackPhaseActionLocks === "function"
        ) {
          requestAnimationFrame(function () {
            try {
              window.risqueSyncAttackPhaseActionLocks();
            } catch (eAtkChrome) {
              /* ignore */
            }
          });
        }
        if (state && state.risqueGameWinImmediate && state.winner) {
          if (typeof window.risqueMountImmediateGameWinOverlay === "function") {
            try {
              window.risqueMountImmediateGameWinOverlay(state.winner);
            } catch (eWinOv) {
              /* ignore */
            }
          }
        }
        if (
          window.risqueDisplayIsPublic &&
          state &&
          state.risqueTransferPulse &&
          window.gameUtils &&
          typeof window.gameUtils.risqueStartTransferPulseTicker === "function"
        ) {
          var rtpRv = state.risqueTransferPulse;
          var rtpRvDur = Number.isFinite(rtpRv.durationMs) ? rtpRv.durationMs : 1000;
          if (Date.now() - rtpRv.startMs < rtpRvDur) {
            window.gameUtils.risqueStartTransferPulseTicker();
          }
        }
        if (typeof window.risqueConquerSyncCelebrationFromState === "function") {
          try {
            window.risqueConquerSyncCelebrationFromState(state);
          } catch (eCqRv) {
            /* ignore */
          }
        }
        var phReplay = state && String(state.phase || "");
        if (
          !window.risqueDisplayIsPublic &&
          phReplay === "cardplay" &&
          __risquePrevPhaseForReplayCardplayHook !== "cardplay" &&
          typeof window.risqueReplayOnHostEnterCardplay === "function"
        ) {
          try {
            window.risqueReplayOnHostEnterCardplay(state);
          } catch (eRpCp) {
            /* ignore */
          }
        }
        __risquePrevPhaseForReplayCardplayHook = phReplay;
        risqueClearPhaseIncomeEntryVeilAfterPaint();
      } catch (e2) {
        updateDiagnostics(e2.message || String(e2));
        risqueClearPhaseIncomeEntryVeilAfterPaint();
      }
    });
  }

  /** Shared with boot-time cardplay branch — same-document navigate calls this too. */
  function mountCardplayAfterOptionalHandoff(opts) {
    opts = opts || {};
    var stripPostReceive =
      !!opts.stripPostReceive &&
      skipCardplayEntryHandoff &&
      !window.risqueDisplayIsPublic;
    var lnCardplay = legacyNext;
    if (Object.prototype.hasOwnProperty.call(opts, "cardplayLegacyNext")) {
      lnCardplay = opts.cardplayLegacyNext;
    }
    try {
      window.risquePhases.cardplay.mount(stageHost, {
        legacyNext: lnCardplay,
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
    } catch (eMount) {
      clearPostReceiveNavigationArtifacts("cardplay.mount threw");
      try {
        logEvent("Card play mount failed", { message: eMount && eMount.message ? eMount.message : String(eMount) });
      } catch (eLog) {
        /* ignore */
      }
      try {
        setBoardCornerMsg(
          "Card play failed to open. Reload; if stuck on black, open the browser console and run: risqueClearPostReceiveNavigationArtifacts()"
        );
      } catch (eMsg) {
        /* ignore */
      }
      console.error("[RISQUE] cardplay.mount failed", eMount);
      return;
    }
    try {
      refreshVisuals("Card play mounted");
    } catch (eVis) {
      clearPostReceiveNavigationArtifacts("refreshVisuals after cardplay");
      try {
        logEvent("Card play refresh failed", { message: eVis && eVis.message ? eVis.message : String(eVis) });
      } catch (eLog2) {
        /* ignore */
      }
      try {
        setBoardCornerMsg("Map refresh failed after card play. Try reloading the page.");
      } catch (eMsg2) {
        /* ignore */
      }
      console.error("[RISQUE] refreshVisuals after cardplay failed", eVis);
      return;
    }
    if (stripPostReceive) {
      try {
        var uPostOk = new URL(window.location.href);
        if (uPostOk.searchParams.has("postReceive")) {
          uPostOk.searchParams.delete("postReceive");
          var postQsOk = uPostOk.searchParams.toString();
          window.history.replaceState(
            null,
            "",
            uPostOk.pathname + (postQsOk ? "?" + postQsOk : "") + uPostOk.hash
          );
        }
      } catch (ePostOk) {
        /* ignore */
      }
    }
    if (typeof window.__risquePostReceiveBlackoutHide === "function") {
      var hideBlk = window.__risquePostReceiveBlackoutHide;
      window.__risquePostReceiveBlackoutHide = null;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try {
            hideBlk();
          } catch (eBlk) {
            /* ignore */
          }
          clearPostReceiveNavigationArtifacts("after post-receive blackout hide");
        });
      });
    } else {
      clearPostReceiveNavigationArtifacts("no blackout hide fn after cardplay");
    }
  }

  /** Mirrors boot cardplay branch (receive-card → cardplay uses postReceive=1 = skip second handoff). */
  function risqueMountCardplayShellSameDocument(shellOpts) {
    shellOpts = shellOpts || {};
    var handoffLn = Object.prototype.hasOwnProperty.call(shellOpts, "cardplayLegacyNext")
      ? shellOpts.cardplayLegacyNext
      : legacyNext;
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: card play";
    appEl.innerHTML = "<p class=\"muted\">Card play — use the map overlay.</p>";
    window.gameState = state;
    if (skipCardplayEntryHandoff && !window.risqueDisplayIsPublic) {
      mountCardplayAfterOptionalHandoff({
        stripPostReceive: true,
        cardplayLegacyNext: handoffLn
      });
    } else if (
      !window.risqueDisplayIsPublic &&
      window.risquePhases &&
      window.risquePhases.privacyGate &&
      typeof window.risquePhases.privacyGate.mountHostTabletHandoff === "function"
    ) {
      var hostName = (state.currentPlayer || "the current player").toString();
      var cardHandoffMsg =
        "Card play\n\nHand the tablet to " +
        hostName +
        ".\n\nOnly this player should tap Continue.";
      window.risquePhases.privacyGate.mountHostTabletHandoff({
        message: cardHandoffMsg,
        onContinue: function () {
          mountCardplayAfterOptionalHandoff({
            stripPostReceive: false,
            cardplayLegacyNext: handoffLn
          });
        },
        onLog: function (line) {
          logEvent(line);
        }
      });
    } else {
      mountCardplayAfterOptionalHandoff({
        stripPostReceive: false,
        cardplayLegacyNext: handoffLn
      });
    }
  }

  /** Continental conquer (?phase=con-cardplay): runtime cardplay HUD; income target follows active chain. */
  function risqueBootMountRuntimeCardplayContinental() {
    var gsBoot = window.gameState;
    if (
      gsBoot &&
      window.gameUtils &&
      typeof window.gameUtils.clearStaleConquestCardplayFieldsUnlessChain === "function"
    ) {
      window.gameUtils.clearStaleConquestCardplayFieldsUnlessChain(gsBoot);
    }
    var defaultCardplayNext = "game.html?phase=income";
    if (
      gsBoot &&
      window.gameUtils &&
      typeof window.gameUtils.isRisqueConquestIncomeChain === "function" &&
      window.gameUtils.isRisqueConquestIncomeChain(gsBoot)
    ) {
      defaultCardplayNext = "game.html?phase=con-income";
    }
    var ln =
      legacyNext != null && String(legacyNext).trim() !== ""
        ? legacyNext
        : defaultCardplayNext;
    risqueMountCardplayShellSameDocument({ cardplayLegacyNext: ln });
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  }

  /**
   * Same-document phase change on game.html (no full reload).
   * Handles phase=income, con-income, cardplay (receive-card → cardplay handoff Continue),
   * phase=playerSelect (login → setup picks), phase=deal (player-select → deal cards),
   * phase=deploy (player-select → setup deploy / income → turn deploy),
   * phase=attack (deploy → attack), phase=reinforce (attack → reinforce),
   * phase=receivecard (reinforce → receive card / conquer elimination card receive),
   * and continental chain phases: conquer, con-cardtransfer, con-cardplay, con-deploy, con-transfertroops.
   */
  function risqueNavigateGameHtmlSoft(nextUrl) {
    if (!nextUrl || window.risqueDisplayIsPublic) return false;
    var parsed;
    try {
      parsed = new URL(nextUrl, window.location.href);
    } catch (e0) {
      return false;
    }
    var curBase = String(window.location.pathname || "").replace(/^.*[/\\]/, "") || "";
    var nextBase = String(parsed.pathname || "").replace(/^.*[/\\]/, "") || "";
    if (!nextBase || nextBase !== curBase) return false;
    var ph = String(parsed.searchParams.get("phase") || "").trim();
    if (
      ph !== "income" &&
      ph !== "con-income" &&
      ph !== "cardplay" &&
      ph !== "playerSelect" &&
      ph !== "deal" &&
      ph !== "deploy" &&
      ph !== "attack" &&
      ph !== "reinforce" &&
      ph !== "receivecard" &&
      ph !== "conquer" &&
      ph !== "con-cardtransfer" &&
      ph !== "con-cardplay" &&
      ph !== "con-deploy" &&
      ph !== "con-transfertroops"
    ) {
      return false;
    }
    if (ph === "playerSelect") {
      var skPre = String(parsed.searchParams.get("selectKind") || "").trim();
      if (!skPre) return false;
    }
    if (ph === "deploy") {
      if (
        !window.risquePhases ||
        !window.risquePhases.deploy ||
        typeof window.risquePhases.deploy.runSetup !== "function" ||
        typeof window.risquePhases.deploy.runTurn !== "function"
      ) {
        return false;
      }
    }
    if (ph === "attack") {
      if (
        !window.risquePhases ||
        !window.risquePhases.attack ||
        typeof window.risquePhases.attack.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "reinforce") {
      if (
        !window.risquePhases ||
        !window.risquePhases.reinforce ||
        typeof window.risquePhases.reinforce.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "receivecard") {
      if (
        !window.risquePhases ||
        !window.risquePhases.receivecard ||
        typeof window.risquePhases.receivecard.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "conquer") {
      if (
        !window.risquePhases ||
        !window.risquePhases.conquer ||
        typeof window.risquePhases.conquer.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "con-cardtransfer") {
      if (
        !window.risquePhases ||
        !window.risquePhases.conCardtransfer ||
        typeof window.risquePhases.conCardtransfer.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "con-cardplay") {
      if (
        !window.risquePhases ||
        !window.risquePhases.cardplay ||
        typeof window.risquePhases.cardplay.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "con-deploy") {
      if (
        !window.risquePhases ||
        !window.risquePhases.deploy ||
        typeof window.risquePhases.deploy.runContinentalDeploy !== "function"
      ) {
        return false;
      }
    }
    if (ph === "con-transfertroops") {
      if (
        !window.risquePhases ||
        !window.risquePhases.conTransfertroops ||
        typeof window.risquePhases.conTransfertroops.mount !== "function"
      ) {
        return false;
      }
    }
    if (ph === "con-income") {
      if (
        !window.risquePhases ||
        !window.risquePhases.income ||
        typeof window.risquePhases.income.runConquerIncome !== "function"
      ) {
        return false;
      }
    }

    try {
      if (typeof window.risqueFlushMirrorPush === "function") {
        window.risqueFlushMirrorPush();
      }
    } catch (eM) {}

    try {
      history.replaceState(null, "", parsed.pathname + parsed.search + parsed.hash);
    } catch (eH) {
      return false;
    }

    /* Attack mount uses this to skip wiping campaign memory on redundant attack→attack soft-nav remounts. */
    var prevShellPhaseForAttackMount = forcedPhase;

    query = new URLSearchParams(parsed.search);
    forcedPhase = ph;
    if (ph === "attack") {
      try {
        window.__risqueAttackMountFromPhase = prevShellPhaseForAttackMount;
      } catch (eApm) {}
    } else {
      try {
        delete window.__risqueAttackMountFromPhase;
      } catch (eApm2) {}
    }
    legacyNext = query.get("legacyNext");
    skipCardplayEntryHandoff = String(query.get("postReceive") || "") === "1";
    selectKind = query.get("selectKind");
    deployKindQuery = (query.get("kind") || "").trim().toLowerCase();

    state = loadState();
    window.gameState = state;
    syncPhaseDataAttr(state);

    try {
      delete window.__risqueSuppressHostMapRedraw;
    } catch (eS) {}

    risqueRestoreHostMapCanvasFromPhaseArtifacts();

    try {
      clearPostReceiveNavigationArtifacts("risqueNavigateGameHtmlSoft");
    } catch (eCl) {}

    document.body.classList.add("risque-setup-fullstage");

    if (ph === "cardplay") {
      risqueMountCardplayShellSameDocument();
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMp) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eL) {}
      return true;
    }

    if (ph === "playerSelect") {
      loginMounted = false;
      try {
        document.body.classList.remove("risque-public-login-active");
      } catch (ePubL) {}
      var loPs = document.getElementById("risque-login-overlay");
      if (loPs && loPs.parentNode) loPs.parentNode.removeChild(loPs);
      var embPs = document.getElementById("risque-login-embedded-root");
      if (embPs && embPs.parentNode) embPs.parentNode.removeChild(embPs);
      phaseLabelEl.textContent = "Phase: player select (" + selectKind + ")";
      appEl.innerHTML = "";
      var psBanner =
        selectKind === "firstCard"
          ? "FIRST CARD"
          : selectKind === "deployOrder"
            ? "DEPLOY ORDER"
            : "SELECTING PLAYER ONE";
      refreshSetupStageChrome(psBanner, function () {
        if (
          window.risquePhases &&
          window.risquePhases.playerSelect &&
          typeof window.risquePhases.playerSelect.mount === "function"
        ) {
          window.risquePhases.playerSelect.mount(stageHost, {
            selectKind: selectKind,
            log: function (line) {
              logEvent(line);
            }
          });
        }
      });
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpPs) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLPs) {}
      return true;
    }

    if (ph === "deal") {
      var psDeal = document.getElementById("risque-player-select-root");
      if (psDeal && psDeal.parentNode) psDeal.parentNode.removeChild(psDeal);
      phaseLabelEl.textContent = "Phase: deal";
      appEl.innerHTML = "";
      refreshSetupStageChrome("DEAL", function () {
        if (
          window.risquePhases &&
          window.risquePhases.deal &&
          typeof window.risquePhases.deal.run === "function"
        ) {
          window.risquePhases.deal.run(stageHost, {
            log: function (line) {
              logEvent(line);
            }
          });
        }
      });
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpDeal) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLDeal) {}
      return true;
    }

    if (ph === "deploy") {
      var dkSoft = resolveDeployKindForHost();
      appEl.innerHTML = "";
      if (dkSoft === "setup") {
        phaseLabelEl.textContent = "Phase: deployment (setup)";
        refreshSetupStageChrome("FIRST DEPLOYMENT", function () {
          if (
            window.risquePhases &&
            window.risquePhases.deploy &&
            typeof window.risquePhases.deploy.runSetup === "function"
          ) {
            window.risquePhases.deploy.runSetup(stageHost, {
              log: function (line) {
                logEvent(line);
              }
            });
          }
        });
      } else {
        phaseLabelEl.textContent = "Phase: deployment";
        window.gameState = state;
        if (
          window.risquePhases &&
          window.risquePhases.deploy &&
          typeof window.risquePhases.deploy.runTurn === "function"
        ) {
          window.risquePhases.deploy.runTurn(stageHost, {
            onLog: function (msg, data) {
              logEvent(msg, data);
            },
            conquestAfterDeploy: query.get("conquestAfterDeploy") === "1"
          });
        }
        refreshVisuals("Deploy (turn) mounted (same-document)");
      }
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpDep) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLDep) {}
      return true;
    }

    if (ph === "attack") {
      phaseLabelEl.textContent = "Phase: attack";
      appEl.innerHTML = "";
      window.gameState = state;
      window.risquePhases.attack.mount(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Attack mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpAtk) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLAtk) {}
      return true;
    }

    if (ph === "reinforce") {
      phaseLabelEl.textContent = "Phase: reinforce";
      appEl.innerHTML = "";
      window.gameState = state;
      window.risquePhases.reinforce.mount(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Reinforce mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpRf) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLRf) {}
      return true;
    }

    if (ph === "receivecard") {
      phaseLabelEl.textContent = "Phase: receive card";
      appEl.innerHTML = "";
      window.gameState = state;
      window.risquePhases.receivecard.mount(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Receive card mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpRc) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLRc) {}
      return true;
    }

    if (ph === "conquer") {
      phaseLabelEl.textContent = "Phase: conquer";
      appEl.innerHTML = "";
      window.gameState = state;
      window.risquePhases.conquer.mount(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Conquer mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpCq) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLCq) {}
      return true;
    }

    if (ph === "con-cardtransfer") {
      phaseLabelEl.textContent = "Phase: con-cardtransfer";
      appEl.innerHTML = "";
      window.gameState = state;
      window.risquePhases.conCardtransfer.mount(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Con-cardtransfer mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpCct) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLCct) {}
      return true;
    }

    if (ph === "con-cardplay") {
      var lnSoft =
        legacyNext != null && String(legacyNext).trim() !== ""
          ? legacyNext
          : "game.html?phase=con-income";
      risqueMountCardplayShellSameDocument({ cardplayLegacyNext: lnSoft });
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpCcp) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLCcp) {}
      return true;
    }

    if (ph === "con-deploy") {
      phaseLabelEl.textContent = "Phase: con-deploy";
      appEl.innerHTML = '<p class="muted">Deployment — use the map overlay.</p>';
      window.gameState = state;
      window.risquePhases.deploy.runContinentalDeploy(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Con-deploy mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpCd) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLCd) {}
      return true;
    }

    if (ph === "con-transfertroops") {
      phaseLabelEl.textContent = "Phase: con-transfertroops";
      appEl.innerHTML = "";
      window.gameState = state;
      window.risquePhases.conTransfertroops.mount(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        }
      });
      refreshVisuals("Con-transfertroops mounted (same-document)");
      if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
        try {
          window.risqueMirrorPushGameState();
        } catch (eMpCtt) {}
      }
      try {
        logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
      } catch (eLCtt) {}
      return true;
    }

    if (ph === "con-income") {
      phaseLabelEl.textContent = "Phase: con-income";
      appEl.innerHTML = '<p class="muted">Continental income — use the map overlay.</p>';
      window.gameState = state;
      if (
        window.risquePhases &&
        window.risquePhases.income &&
        typeof window.risquePhases.income.runConquerIncome === "function"
      ) {
        window.risquePhases.income.runConquerIncome(stageHost, {
          onLog: function (msg, data) {
            logEvent(msg, data);
          }
        });
      }
      refreshVisuals("Con-income mounted (same-document)");
    } else if (ph === "income") {
      phaseLabelEl.textContent = "Phase: income";
      appEl.innerHTML = '<p class="muted">Income — use the map overlay.</p>';
      window.gameState = state;
      if (
        window.risquePhases &&
        window.risquePhases.income &&
        typeof window.risquePhases.income.mount === "function"
      ) {
        window.risquePhases.income.mount(stageHost, {
          legacyNext: query.get("legacyNext") || "game.html?phase=deploy&kind=turn",
          onLog: function (msg, data) {
            logEvent(msg, data);
          }
        });
      }
      refreshVisuals("Income mounted (same-document)");
    }

    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      try {
        window.risqueMirrorPushGameState();
      } catch (eMp2) {}
    }

    try {
      logEvent("Soft navigate (same document)", { phase: ph, url: nextUrl });
    } catch (eL2) {}
    return true;
  }

  window.risqueNavigateGameHtmlSoft = risqueNavigateGameHtmlSoft;

  /**
   * risqueAutoPublic=1: popup blockers reject window.open from timers.
   * Strip the flag and open TV on first real click (user activation).
   */
  function scheduleRisqueAutoPublicFromQueryOnce() {
    if (window.risqueDisplayIsPublic) return;
    if (window.__risqueAutoPublicArmed) return;
    try {
      var q = risqueLocationSearchParams();
      if (q.get("risqueAutoPublic") !== "1") return;
      window.__risqueAutoPublicArmed = true;
      q.delete("risqueAutoPublic");
      var next =
        window.location.pathname + (q.toString() ? "?" + q.toString() : "") + window.location.hash;
      history.replaceState(null, "", next);
    } catch (eAutoPub) {
      return;
    }
    var hint = document.createElement("div");
    hint.id = "risque-auto-public-hint";
    hint.setAttribute("role", "status");
    hint.textContent = "Click anywhere to open the TV / public window (browser blocks auto-popups).";
    hint.style.cssText =
      "position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483646;" +
      "max-width:min(520px,92vw);background:#14532d;color:#ecfdf5;padding:12px 18px;" +
      "border-radius:10px;font:600 14px Arial,Helvetica,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45);" +
      "text-align:center;pointer-events:none";
    document.body.appendChild(hint);
    function onFirstPointer() {
      document.removeEventListener("pointerdown", onFirstPointer, true);
      try {
        if (hint.parentNode) hint.parentNode.removeChild(hint);
      } catch (eH) {
        /* ignore */
      }
      if (typeof window.risqueOpenPublicDisplayWindow === "function") {
        try {
          window.risqueOpenPublicDisplayWindow();
        } catch (eOpen) {
          /* ignore */
        }
      }
    }
    document.addEventListener("pointerdown", onFirstPointer, true);
  }

  function risqueClearWaybackGreenBadgeHideTimer() {
    if (__risqueWaybackGreenBadgeHideTimer != null) {
      window.clearTimeout(__risqueWaybackGreenBadgeHideTimer);
      __risqueWaybackGreenBadgeHideTimer = null;
    }
  }

  /** One shot per green badge element: repeated sync calls must not reset the 2s timer. */
  function risqueScheduleWaybackGreenBadgeHideOnce(flag) {
    if (!flag || flag.getAttribute("data-risque-green-hide-pending") === "1") return;
    flag.setAttribute("data-risque-green-hide-pending", "1");
    risqueClearWaybackGreenBadgeHideTimer();
    __risqueWaybackGreenBadgeHideTimer = window.setTimeout(function () {
      __risqueWaybackGreenBadgeHideTimer = null;
      __risqueWaybackGreenLoginBadgeConsumed = true;
      try {
        flag.removeAttribute("data-risque-green-hide-pending");
      } catch (eAttr) {
        /* ignore */
      }
      try {
        if (flag && flag.parentNode) flag.parentNode.removeChild(flag);
      } catch (eRm) {
        try {
          flag.remove();
        } catch (eRm2) {
          /* ignore */
        }
      }
    }, SHOW_WAYBACK_GREEN_BADGE_MS);
  }

  function syncWaybackConnectedLoginFlag(gs) {
    function applyWaybackConnFlag(el, connected, reason) {
      if (!el) return;
      if (connected) {
        el.textContent = "SAVE FOLDER CONNECTED TO WAYBACK (" + reason + ")";
        el.style.background = "#14532d";
        el.style.color = "#ecfdf5";
        el.style.border = "1px solid #22c55e";
        risqueScheduleWaybackGreenBadgeHideOnce(el);
      } else {
        risqueClearWaybackGreenBadgeHideTimer();
        __risqueWaybackGreenLoginBadgeConsumed = false;
        try {
          el.removeAttribute("data-risque-green-hide-pending");
        } catch (eP) {
          /* ignore */
        }
        el.textContent = "SAVE FOLDER NOT CONNECTED (" + reason + ")";
        el.style.background = "#713f12";
        el.style.color = "#fffbeb";
        el.style.border = "1px solid #f59e0b";
      }
    }
    if (!window.__risqueWaybackConnLauncherHintTried) {
      window.__risqueWaybackConnLauncherHintTried = true;
      var launcherFetch =
        typeof window.risqueFetchLauncherPathsJson === "function"
          ? window.risqueFetchLauncherPathsJson()
          : fetch("risque-launcher-paths.json", { cache: "no-store" }).then(function (r) {
              if (!r || !r.ok) return null;
              return r.json();
            });
      if (launcherFetch && typeof launcherFetch.then === "function") {
        Promise.resolve(launcherFetch)
          .then(function (j) {
            try {
              var base = j && j.diskApiBase ? String(j.diskApiBase).trim() : "";
              window.__risqueWaybackConnLauncherHint = !!base;
            } catch (eHint) {
              window.__risqueWaybackConnLauncherHint = false;
            }
          })
          .catch(function () {
            window.__risqueWaybackConnLauncherHint = false;
          });
      }
    }
    var id = "risque-wayback-connected-flag";
    var old = document.getElementById(id);
    var isHost = !window.risqueDisplayIsPublic;
    /* Soft-nav setup URLs (?phase=playerSelect|deal|deploy…) skip refreshVisuals — never keep the login badge. */
    var urlPhase = "";
    try {
      urlPhase = String(new URL(window.location.href).searchParams.get("phase") || "").trim();
    } catch (eUrlPh) {
      /* ignore */
    }
    if (isHost && urlPhase && urlPhase !== "login") {
      risqueClearWaybackGreenBadgeHideTimer();
      __risqueWaybackGreenLoginBadgeConsumed = false;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return;
    }
    var isLogin = gs && String(gs.phase || "") === "login";
    if (
      isHost &&
      isLogin &&
      !window.__risqueWaybackDirectProbeBusy &&
      window.__risqueWaybackDirectProbeOk == null
    ) {
      window.__risqueWaybackDirectProbeBusy = true;
      fetch("http://127.0.0.1:5599/api/health", { cache: "no-store" })
        .then(function (r) {
          if (!r || !r.ok) return null;
          return r.json();
        })
        .then(function (j) {
          window.__risqueWaybackDirectProbeOk = !!(j && j.ok);
        })
        .catch(function () {
          window.__risqueWaybackDirectProbeOk = false;
        })
        .finally(function () {
          window.__risqueWaybackDirectProbeBusy = false;
          var badge = document.getElementById(id);
          if (!badge) return;
          if (!(window.gameState && String(window.gameState.phase || "") === "login")) return;
          if (window.__risqueWaybackDirectProbeOk) {
            applyWaybackConnFlag(badge, true, "API ACTIVE (DIRECT)");
          } else if (badge.textContent.indexOf("NO HINT") >= 0) {
            applyWaybackConnFlag(badge, false, "API DOWN (DIRECT)");
          }
        });
    }
    if (
      isHost &&
      isLogin &&
      !window.__risqueWaybackConnBootstrapTried &&
      typeof window.risqueLocalDiskBootstrap === "function"
    ) {
      window.__risqueWaybackConnBootstrapTried = true;
      window
        .risqueLocalDiskBootstrap()
        .then(function (okBoot) {
          window.__risqueWaybackConnProbeOk = !!okBoot;
        })
        .catch(function () {
          window.__risqueWaybackConnProbeOk = false;
        });
    }
    if (
      isHost &&
      isLogin &&
      !window.__risqueWaybackConnProbeBusy &&
      typeof window.risqueLocalDiskProbe === "function"
    ) {
      window.__risqueWaybackConnProbeBusy = true;
      window
        .risqueLocalDiskProbe()
        .then(function (ok) {
          window.__risqueWaybackConnProbeOk = !!ok;
        })
        .catch(function () {
          window.__risqueWaybackConnProbeOk = false;
        })
        .finally(function () {
          window.__risqueWaybackConnProbeBusy = false;
        });
    }
    var connected = false;
    var connReason = "NO HINT";
    if (isHost && isLogin) {
      try {
        var hasApiFns =
          typeof window.risqueLocalDiskIsActive === "function" &&
          typeof window.risqueLocalDiskIsConfigured === "function" &&
          typeof window.risqueLocalDiskProbe === "function";
        if (!hasApiFns) {
          connReason = "API FN MISSING";
        }
        connected =
          (hasApiFns && window.risqueLocalDiskIsActive()) ||
          (hasApiFns && window.risqueLocalDiskIsConfigured()) ||
          !!window.__risqueWaybackDirectProbeOk ||
          !!window.__risqueWaybackConnLauncherHint ||
          !!(
            __risqueRoundAutosaveDirHandle &&
            typeof __risqueRoundAutosaveDirHandle.getFileHandle === "function"
          );
        if (hasApiFns && window.risqueLocalDiskIsActive()) {
          connReason = "API ACTIVE";
        } else if (window.__risqueWaybackDirectProbeOk) {
          connReason = "API ACTIVE (DIRECT)";
        } else if (hasApiFns && window.risqueLocalDiskIsConfigured()) {
          connReason = window.__risqueWaybackConnProbeOk === false ? "API DOWN" : "API CONFIGURED";
        } else if (window.__risqueWaybackConnLauncherHint) {
          connReason = "LAUNCHER HINT";
        } else if (
          __risqueRoundAutosaveDirHandle &&
          typeof __risqueRoundAutosaveDirHandle.getFileHandle === "function"
        ) {
          connReason = "FOLDER HANDLE";
        }
      } catch (eConn) {
        connected = false;
        connReason = "CHECK ERROR";
      }
    }
    if (!isHost || !isLogin) {
      risqueClearWaybackGreenBadgeHideTimer();
      __risqueWaybackGreenLoginBadgeConsumed = false;
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return;
    }
    if (connected && __risqueWaybackGreenLoginBadgeConsumed) {
      risqueClearWaybackGreenBadgeHideTimer();
      if (old && old.parentNode) old.parentNode.removeChild(old);
      return;
    }
    var flag = old || document.createElement("div");
    if (!old) {
      flag.id = id;
      flag.setAttribute("role", "status");
      flag.style.cssText =
        "position:fixed;left:325px;bottom:76px;z-index:2147483646;pointer-events:none;" +
        "border-radius:8px;padding:8px 12px;font:700 12px Arial,Helvetica,sans-serif;letter-spacing:.3px;" +
        "box-shadow:0 6px 18px rgba(0,0,0,.4);text-transform:uppercase;";
      document.body.appendChild(flag);
    }
    applyWaybackConnFlag(flag, connected, connReason);
  }

  function render(state, notice) {
    phaseLabelEl.textContent = "Phase: " + (state.phase || "unknown");
    syncPhaseDataAttr(state);
    syncWaybackConnectedLoginFlag(state);
    if (state.phase === "login") {
      document.body.classList.add("risque-public-login-active");
    } else {
      document.body.classList.remove("risque-public-login-active");
    }
    if (state.phase === "login") {
      refreshVisuals(notice);
      if (!loginMounted && window.risquePhases && window.risquePhases.login && typeof window.risquePhases.login.mount === "function") {
        loginMounted = true;
        appEl.innerHTML = "";
        if (notice) {
          logEvent("Runtime boot notice", { notice: notice });
        }
        var uioLogin = document.getElementById("ui-overlay");
        if (uioLogin) {
          window.risquePhases.login.mount(uioLogin, {
            useHud: true,
            legacyNext: loginLegacyNext,
            loadRedirect: loginLoadRedirect,
            initialLoginFormMirror: state.risquePublicLoginFormMirror,
            onLog: function (msg, data) {
              logEvent(msg, data);
            }
          });
        } else {
          logEvent("Login: no ui-overlay; using full-screen overlay");
          window.risquePhases.login.mount(document.body, {
            legacyNext: loginLegacyNext,
            loadRedirect: loginLoadRedirect,
            onLog: function (msg, data) {
              logEvent(msg, data);
            }
          });
        }
        if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () {
              window.risqueMirrorPushGameState();
            });
          });
        }
        scheduleRisqueAutoPublicFromQueryOnce();
      }
      return;
    }
    loginMounted = false;
    var body = "";
    if (state.phase === "cardplay") {
      body = renderCardplay(state);
    } else if (state.phase === "receivecard") {
      body = renderReceiveCard(state);
    } else {
      body = renderUnknown(state);
    }
    appEl.innerHTML =
      (notice ? "<p style='color:#00ff00;'><strong>Status:</strong> " + notice + "</p>" : "") +
      "<p><strong>Round:</strong> " + text(state.round) + "</p>" +
      "<p><strong>Turn Order:</strong> " + (state.turnOrder.length ? state.turnOrder.join(" -> ") : "none") + "</p>" +
      body +
      (lastAutoReport
        ? "<div style='margin-top:14px;padding:10px;border:1px solid #334155;border-radius:8px;background:#0b1220;'>" +
            "<p><strong>Auto Cycle Report</strong></p>" +
            "<pre style='white-space:pre-wrap;margin:0;color:#cbd5e1;'>" + lastAutoReport + "</pre>" +
          "</div>"
        : "");
    refreshVisuals(notice);
  }

  function triggerJsonFileDownload(payloadString, filename) {
    var safe =
      filename == null || !String(filename).trim()
        ? "RISQUE-state-snapshot.json"
        : String(filename).trim();
    if (!/\.json$/i.test(safe)) safe += ".json";
    var blob = new Blob([payloadString], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = safe;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /**
   * Postgame: one risque-replay-v1 JSON built from the full in-memory session tape (same idea as replay-full),
   * written flat in the save root — ready for replay-machine.html. Requires host save path or falls back to download.
   */
  window.risqueArchivePostgameReplay = function (gs) {
    if (!gs || window.risqueDisplayIsPublic) {
      return Promise.resolve({ ok: false, reason: "host only" });
    }
    if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
      try {
        window.risqueReplayEnsureLatestBoardFrame(gs);
      } catch (eLf) {
        /* ignore */
      }
    }
    var packPromise =
      gs && String(gs.risqueAutosaveTier || "") === "safe_no_replay"
        ? buildTier3FullSessionReplayPack(gs)
        : Promise.resolve(
            typeof window.risqueBuildSessionReplayExport === "function"
              ? window.risqueBuildSessionReplayExport(gs)
              : buildSplitSessionReplayPackForHost(gs)
          );
    return Promise.resolve(packPromise).then(function (pack) {
      if (!pack || pack.format !== "risque-replay-v1" || !pack.tape || !Array.isArray(pack.tape.events)) {
        return { ok: false, reason: "no tape" };
      }
      if (!pack.tape.events.length) {
        return { ok: false, reason: "empty tape" };
      }
      var json;
      try {
        json = JSON.stringify(pack, null, 2);
      } catch (eJ) {
        return { ok: false, reason: "stringify failed" };
      }
      var winSlug = "game";
      try {
        if (gs.winner != null && String(gs.winner).trim()) {
          winSlug = String(gs.winner)
            .trim()
            .replace(/[^\w\-\s]/g, "")
            .replace(/\s+/g, "_")
            .slice(0, 28);
        }
      } catch (eW) {
        winSlug = "game";
      }
      var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      var fname = "replay-archive-" + winSlug + "-" + stamp + ".json";
      var relPath = fname;

      function tryDownloadFallback() {
        try {
          triggerJsonFileDownload(json, fname);
          logEvent("Postgame archive replay downloaded (fallback)", { file: fname });
        } catch (eDl) {
          /* ignore */
        }
      }

      if (
        typeof window.risqueSessionDiskEnsureGameDirHandle !== "function" ||
        typeof window.risqueSessionDiskWriteTextFile !== "function"
      ) {
        tryDownloadFallback();
        return { ok: true, downloaded: true, path: fname };
      }
      return window.risqueSessionDiskEnsureGameDirHandle(gs).then(function (dh) {
        if (!dh) {
          tryDownloadFallback();
          return { ok: true, downloaded: true, path: fname };
        }
        return window.risqueSessionDiskWriteTextFile(dh, relPath, json).then(function (okW) {
          if (okW) {
            logEvent("Postgame archive replay written", { path: relPath });
            return { ok: true, path: relPath };
          }
          tryDownloadFallback();
          return { ok: true, downloaded: true, path: fname };
        });
      });
    });
  };

  function downloadSnapshot(state) {
    triggerJsonFileDownload(JSON.stringify(state, null, 2), "RISQUE-state-snapshot.json");
  }

  /** Strip characters invalid on common filesystems; returns null if unusable. */
  function sanitizeRisqueSaveBasename(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    /* Colon is illegal on Windows paths; keep display as 8:11AM then map to 8-11AM for the file. */
    s = s.replace(/:/g, "-");
    s = s.replace(/[<>"/\\|?*\u0000-\u001f]/g, "");
    s = s.replace(/[\t\n\r]+/g, " ");
    s = s.trim();
    if (!s) return null;
    if (s.length > 120) s = s.substring(0, 120);
    if (/\.json$/i.test(s)) s = s.slice(0, -5);
    s = s.replace(/\.+$/g, "").trim();
    return s || null;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** 12-hour clock like 8:11AM / 12:35PM (colon is normalized to "-" when writing the file on Windows). */
  function formatRisque12HourAmPm(d) {
    var h24 = d.getHours();
    var mi = d.getMinutes();
    var ampm = h24 >= 12 ? "PM" : "AM";
    var h12 = h24 % 12;
    if (h12 === 0) {
      h12 = 12;
    }
    var minStr = mi < 10 ? "0" + mi : String(mi);
    return String(h12) + ":" + minStr + ampm;
  }

  /** Same as default label but ":" → "-" for OS save / download attribute (Windows). */
  function risqueSaveBasenameForFilename(label) {
    return String(label || "").replace(/:/g, "-");
  }

  /** Default: "RISQUE  YYYY-MM-DD  8:11AM" (two spaces between words; local date/time). */
  function defaultRisqueSaveBasename() {
    try {
      var d = new Date();
      var datePart = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
      return "RISQUE  " + datePart + "  " + formatRisque12HourAmPm(d);
    } catch (eDef) {
      return "RISQUE  save";
    }
  }

  function replayPackEventCount(pack) {
    if (!pack || !pack.tape || !Array.isArray(pack.tape.events)) return 0;
    return pack.tape.events.length;
  }

  function replayPackHasOpening(pack) {
    if (!pack || !pack.tape || !Array.isArray(pack.tape.events)) return false;
    if (typeof window.risqueTapeHasUsableReplayOpening === "function") {
      return window.risqueTapeHasUsableReplayOpening(pack.tape.events);
    }
    return pack.tape.events.some(function (e) {
      return e && e.type === "board" && e.segment === "deal";
    });
  }

  function mergeTier3CheckpointReplayWithMemory(diskPack, memPack) {
    if (!memPack || memPack.format !== "risque-replay-v1") return diskPack;
    if (!diskPack || diskPack.format !== "risque-replay-v1") return memPack;
    var mN = replayPackEventCount(memPack);
    var dN = replayPackEventCount(diskPack);
    var memOpen = replayPackHasOpening(memPack);
    var diskOpen = replayPackHasOpening(diskPack);
    if (memOpen && mN >= dN - 8) {
      return memPack;
    }
    if (typeof window.risqueMergeReplayV1Packs === "function") {
      var merged = window.risqueMergeReplayV1Packs([diskPack, memPack]);
      if (merged && merged.tape && Array.isArray(merged.tape.events) && merged.tape.events.length) {
        if (!merged.__mergeWarnings) merged.__mergeWarnings = [];
        merged.__mergeWarnings.push(
          "Tier 3: merged mid-game SAVE + REPLAY file with conclusion recorded in memory."
        );
        return merged;
      }
    }
    return mN >= dN ? memPack : diskPack;
  }

  function readTier3CheckpointReplayPackFromDisk(gs) {
    var fname =
      gs && gs.risqueSessionCheckpointReplayFile != null
        ? String(gs.risqueSessionCheckpointReplayFile).trim()
        : "";
    if (!fname || !hasRoundAutosaveDiskTarget()) return Promise.resolve(null);
    if (typeof window.risqueSessionDiskEnsureGameDirHandle !== "function") {
      return Promise.resolve(null);
    }
    return window.risqueSessionDiskEnsureGameDirHandle(gs).then(function (dh) {
      if (!dh || typeof window.risqueSessionDiskReadTextFile !== "function") return null;
      return window.risqueSessionDiskReadTextFile(dh, fname).then(function (text) {
        if (!text) return null;
        try {
          var parsed = JSON.parse(String(text));
          if (
            parsed &&
            parsed.format === "risque-replay-v1" &&
            parsed.tape &&
            Array.isArray(parsed.tape.events) &&
            parsed.tape.events.length
          ) {
            return parsed;
          }
        } catch (eParse) {
          /* ignore */
        }
        return null;
      });
    });
  }

  /** Tier 3 endgame: memory session tape, optionally merged with mid-game *-replay.json from SAVE + REPLAY. */
  function buildTier3FullSessionReplayPack(gs) {
    var memPack = buildSplitSessionReplayPackForHost(gs);
    if (!memPack || memPack.format !== "risque-replay-v1" || !replayPackEventCount(memPack)) {
      return Promise.resolve(null);
    }
    return readTier3CheckpointReplayPackFromDisk(gs).then(function (diskPack) {
      if (!diskPack) return memPack;
      return mergeTier3CheckpointReplayWithMemory(diskPack, memPack);
    });
  }

  function risqueTier3CompleteReplayFilename(gs) {
    var winSlug = "game";
    try {
      if (gs && gs.winner != null && String(gs.winner).trim()) {
        winSlug = String(gs.winner)
          .trim()
          .replace(/[^\w\-\s]/g, "")
          .replace(/\s+/g, "_")
          .slice(0, 28);
      }
    } catch (eW) {
      winSlug = "game";
    }
    var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return "replay-complete-" + winSlug + "-" + stamp + ".json";
  }

  function risqueTier3WriteCompleteSessionReplay(gs) {
    return buildTier3FullSessionReplayPack(gs).then(function (pack) {
      if (!pack || !replayPackEventCount(pack)) {
        try {
          setBoardCornerMsg("Game over — no replay tape in memory to export.");
        } catch (eMsg0) {
          /* ignore */
        }
        return { ok: false, reason: "no tape" };
      }
      var json;
      try {
        json = JSON.stringify(pack, null, 2);
      } catch (eJ) {
        return { ok: false, reason: "stringify failed" };
      }
      var fname = risqueTier3CompleteReplayFilename(gs);
      if (!hasRoundAutosaveDiskTarget()) {
        try {
          triggerJsonFileDownload(json, fname);
          setBoardCornerMsg("Downloaded " + fname + " (connect save folder to write there).");
        } catch (eDl) {
          /* ignore */
        }
        return { ok: true, downloaded: true, path: fname };
      }
      if (
        typeof window.risqueSessionDiskEnsureGameDirHandle !== "function" ||
        typeof window.risqueSessionDiskWriteTextFile !== "function"
      ) {
        return { ok: false, reason: "no writer" };
      }
      return window.risqueSessionDiskEnsureGameDirHandle(gs).then(function (dh) {
        if (!dh) {
          try {
            triggerJsonFileDownload(json, fname);
            setBoardCornerMsg("Downloaded " + fname + ".");
          } catch (eDl2) {
            /* ignore */
          }
          return { ok: true, downloaded: true, path: fname };
        }
        return window.risqueSessionDiskWriteTextFile(dh, fname, json).then(function (okW) {
          if (okW) {
            try {
              setBoardCornerMsg("Wrote " + fname + " (full replay, deal → end).");
            } catch (eMsgOk) {
              /* ignore */
            }
            return { ok: true, path: fname, merged: !!gs.risqueSessionCheckpointReplayFile };
          }
          return { ok: false, reason: "write failed" };
        });
      });
    });
  }

  /** Full-session replay pack for SAVE + REPLAY / manual endgame export (deal → now in memory). */
  function buildSplitSessionReplayPackForHost(gameStateObj) {
    var replayPack = null;
    function buildSessionPackFromSource(src) {
      if (!src || typeof src !== "object") return null;
      try {
        if (typeof window.risqueReplayEnsureLatestBoardFrame === "function") {
          window.risqueReplayEnsureLatestBoardFrame(src);
        }
      } catch (eLfSrc) {
        /* ignore */
      }
      try {
        return typeof window.risqueBuildSessionReplayExport === "function"
          ? window.risqueBuildSessionReplayExport(src)
          : null;
      } catch (eSessSrc) {
        return null;
      }
    }
    function sessionPackEventCount(pack) {
      if (!pack || !pack.tape || !Array.isArray(pack.tape.events)) return 0;
      return pack.tape.events.length;
    }
    try {
      replayPack = buildSessionPackFromSource(gameStateObj);
      var liveGs = typeof window.gameState === "object" && window.gameState ? window.gameState : null;
      if (liveGs && liveGs !== gameStateObj) {
        var livePack = buildSessionPackFromSource(liveGs);
        if (sessionPackEventCount(livePack) > sessionPackEventCount(replayPack)) {
          replayPack = livePack;
        }
      }
      if (
        sessionPackEventCount(replayPack) < 8 &&
        typeof window.risqueReplayRestoreFromSidecar === "function" &&
        gameStateObj &&
        typeof gameStateObj === "object"
      ) {
        try {
          window.risqueReplayRestoreFromSidecar(gameStateObj);
        } catch (eSide) {
          /* ignore */
        }
        var sidePack = buildSessionPackFromSource(gameStateObj);
        if (sessionPackEventCount(sidePack) > sessionPackEventCount(replayPack)) {
          replayPack = sidePack;
        }
      }
    } catch (eSess) {
      replayPack = null;
    }
    if (
      !replayPack ||
      replayPack.format !== "risque-replay-v1" ||
      !replayPack.tape ||
      !Array.isArray(replayPack.tape.events) ||
      !replayPack.tape.events.length
    ) {
      replayPack = null;
    }
    if (!replayPack) {
      try {
        var bootRaw = localStorage.getItem("risqueWaybackBootstrapPack");
        var bootParsed = bootRaw ? JSON.parse(String(bootRaw)) : null;
        if (
          bootParsed &&
          bootParsed.format === "risque-replay-v1" &&
          bootParsed.tape &&
          Array.isArray(bootParsed.tape.events) &&
          bootParsed.tape.events.length
        ) {
          replayPack = bootParsed;
        }
      } catch (eBoot) {
        /* ignore */
      }
    }
    /* Battle stills (tier 5): no granular tape — build a budget risque-replay-v1 from phase-end stills for SAVE + REPLAY. */
    if (
      gameStateObj &&
      typeof gameStateObj === "object" &&
      (gameStateObj.risqueAutosaveTier === "battle_stills" || gameStateObj.risqueAutosaveTier === "host_ultra") &&
      typeof window.risqueBuildBudgetReplayPackFromCheapStills === "function"
    ) {
      try {
        var budgetPack = window.risqueBuildBudgetReplayPackFromCheapStills(gameStateObj);
        if (
          budgetPack &&
          budgetPack.format === "risque-replay-v1" &&
          budgetPack.tape &&
          Array.isArray(budgetPack.tape.events) &&
          budgetPack.tape.events.length >= 2
        ) {
          replayPack = budgetPack;
        }
      } catch (eBudget) {
        /* ignore */
      }
    }
    return replayPack;
  }

  /**
   * When a save folder is connected, write stripped game JSON + full replay next to it (no Save dialog).
   * Returns { ok, usedPicker, replayWritten } or null if not attempted / not possible.
   */
  function tryWriteSplitSaveToAutosaveFolder(gameStateObj, payload, replayPack, defaultBase) {
    if (!replayPack || replayPack.format !== "risque-replay-v1") {
      return Promise.resolve(null);
    }
    if (!hasRoundAutosaveDiskTarget()) return Promise.resolve(null);
    var wf = typeof window.risqueSessionDiskWriteTextFile === "function" ? window.risqueSessionDiskWriteTextFile : null;
    if (!wf || typeof window.risqueSessionDiskEnsureGameDirHandle !== "function") {
      return Promise.resolve(null);
    }
    var replayJson;
    try {
      replayJson = JSON.stringify(replayPack, null, 2);
    } catch (eJ) {
      return Promise.resolve(null);
    }
    return Promise.all([
      window.risqueSessionDiskEnsureGameDirHandle(gameStateObj),
      window.risqueSessionDiskEnsureReplayDirHandle(gameStateObj)
    ]).then(function (pair) {
      if (!pair[0] || !pair[1]) return null;
      var base = risqueSaveBasenameForFilename(defaultBase);
      var gameF = base + ".json";
      var repF = base + "-replay.json";
      return wf(pair[0], gameF, payload).then(function (ok1) {
        if (!ok1) return null;
        return wf(pair[1], repF, replayJson).then(function (ok2) {
          if (!ok2) return null;
          try {
            gameStateObj.risqueSessionCheckpointReplayFile = repF;
            if (typeof saveState === "function") {
              saveState(gameStateObj);
            }
          } catch (eCk) {
            /* ignore */
          }
          try {
            setBoardCornerMsg("Wrote " + gameF + " + " + repF + " to your save folder.");
          } catch (eMsgF) {
            /* ignore */
          }
          try {
            logEvent("Save folder: game + session replay", { game: gameF, replay: repF });
          } catch (eLogF) {
            /* ignore */
          }
          return { ok: true, usedPicker: false, replayWritten: true, replayFile: repF };
        });
      });
    });
  }

  /**
   * Host save to disk: native Save dialog when showSaveFilePicker exists (e.g. localhost / https).
   * If the host already granted a save folder (round autosave / Wayback Connect), startIn uses that
   * directory handle so the dialog opens there (e.g. C:\risque\save); otherwise starts in Downloads.
   * Browsers cannot bind an arbitrary path without a prior directory-picker grant.
   * @param {object} gameStateObj
   * @param {{ includeReplayInMainJson?: boolean, splitSessionReplayFiles?: boolean }} [opts] — includeReplayInMainJson: one fat JSON. splitSessionReplayFiles: stripped game + full session replay sidecar (deal→now), no prior disk replay required.
   */
  function saveGameSnapshotToFile(gameStateObj, opts) {
    opts = opts || {};
    var includeReplayInMainJson = !!opts.includeReplayInMainJson && !opts.splitSessionReplayFiles;
    var splitSessionReplayFiles = !!opts.splitSessionReplayFiles;
    var forSave = gameStateObj;
    if (includeReplayInMainJson) {
      try {
        forSave = JSON.parse(JSON.stringify(gameStateObj));
      } catch (eFull) {
        forSave = gameStateObj;
      }
    } else {
      try {
        if (typeof window.risqueStripReplayFromGameStateClone === "function") {
          forSave = window.risqueStripReplayFromGameStateClone(gameStateObj);
        }
      } catch (eFs) {
        forSave = gameStateObj;
      }
    }
    var payload = JSON.stringify(forSave, null, 2);
    var replayPack = null;
    if (splitSessionReplayFiles) {
      replayPack = buildSplitSessionReplayPackForHost(gameStateObj);
    } else if (!includeReplayInMainJson) {
      try {
        replayPack =
          typeof window.risqueBuildRoundReplayExport === "function"
            ? window.risqueBuildRoundReplayExport(
                gameStateObj,
                Number(gameStateObj && gameStateObj.round) || 1
              )
            : null;
      } catch (eRp) {
        replayPack = null;
      }
    }
    var defaultBase = defaultRisqueSaveBasename();
    var suggestedFile = risqueSaveBasenameForFilename(defaultBase) + ".json";
    var replaySuggestedName = splitSessionReplayFiles
      ? risqueSaveBasenameForFilename(defaultBase) + "-replay.json"
      : risqueRoundReplayFilename(Number(gameStateObj && gameStateObj.round) || 1);

    function maybeDownloadReplayPack() {
      if (!replayPack || replayPack.format !== "risque-replay-v1") return;
      try {
        triggerJsonFileDownload(JSON.stringify(replayPack, null, 2), replaySuggestedName);
      } catch (eRdl) {
        /* ignore */
      }
    }

    function promptThenDownload() {
      return new Promise(function (resolve) {
        var entered = window.prompt(
          "Save game — file name only (no path). Invalid characters are removed; .json is added.\n\n" +
            "Default folder is usually your Downloads folder. With http://localhost or HTTPS, the Save dialog can open in Downloads and let you pick another folder.",
          defaultBase
        );
        if (entered === null) {
          resolve({ ok: false, aborted: true });
          return;
        }
        var clean = sanitizeRisqueSaveBasename(entered);
        if (!clean) {
          window.alert("Please enter a valid file name.");
          resolve({ ok: false });
          return;
        }
        try {
          triggerJsonFileDownload(payload, clean + ".json");
          maybeDownloadReplayPack();
          resolve({
            ok: true,
            usedPicker: false,
            replayWritten: !!(replayPack && replayPack.format === "risque-replay-v1")
          });
        } catch (eDl) {
          resolve({ ok: false });
        }
      });
    }

    if (typeof window.showSaveFilePicker !== "function") {
      return promptThenDownload();
    }

    function savePickerStartIn() {
      try {
        var dh =
          typeof window.risqueHostSaveFolderGet === "function"
            ? window.risqueHostSaveFolderGet()
            : null;
        if (
          dh &&
          typeof dh.getFileHandle === "function" &&
          !dh.__risqueVirtualDir
        ) {
          return dh;
        }
      } catch (eStart) {
        /* ignore */
      }
      return "downloads";
    }

    var _pickerStart = savePickerStartIn();

    function runShowSavePickerSplit() {
      return window
        .showSaveFilePicker({
          suggestedName: suggestedFile,
          startIn: _pickerStart,
          types: [
            {
              description: "RISQUE saved game",
              accept: { "application/json": [".json"] }
            }
          ]
        })
        .then(function (handle) {
          return handle.createWritable().then(function (writable) {
            var w = writable.write(payload);
            return Promise.resolve(w).then(function () {
              return writable.close();
            });
          });
        })
        .then(function () {
          if (includeReplayInMainJson) {
            return { ok: true, usedPicker: true, replayWritten: true };
          }
          if (!replayPack || replayPack.format !== "risque-replay-v1") {
            return { ok: true, usedPicker: true, replayWritten: false };
          }
          return window
            .showSaveFilePicker({
              suggestedName: replaySuggestedName,
              startIn: _pickerStart,
              types: [
                {
                  description: "RISQUE replay tape",
                  accept: { "application/json": [".json"] }
                }
              ]
            })
            .then(function (h2) {
              return h2.createWritable().then(function (writable2) {
                var w2 = writable2.write(JSON.stringify(replayPack, null, 2));
                return Promise.resolve(w2).then(function () {
                  return writable2.close();
                });
              });
            })
            .then(function () {
              return { ok: true, usedPicker: true, replayWritten: true };
            })
            .catch(function () {
              return { ok: true, usedPicker: true, replayWritten: false };
            });
        })
        .catch(function (ePick) {
          if (ePick && ePick.name === "AbortError") {
            return { ok: false, aborted: true };
          }
          return promptThenDownload();
        });
    }

    if (splitSessionReplayFiles && hasRoundAutosaveDiskTarget()) {
      return tryWriteSplitSaveToAutosaveFolder(gameStateObj, payload, replayPack, defaultBase).then(function (fr) {
        if (fr && fr.ok) return fr;
        return runShowSavePickerSplit();
      });
    }
    return runShowSavePickerSplit();
  }

  function downloadLedger() {
    var payload = JSON.stringify(getLedger(), null, 2);
    var blob = new Blob([payload], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "RISQUE-transition-ledger.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function getActiveGameStateSnapshot() {
    try {
      if (
        window.__risqueInlineWaybackActive &&
        window.__risqueReplayInlineBackupGameState &&
        Array.isArray(window.__risqueReplayInlineBackupGameState.players) &&
        window.__risqueReplayInlineBackupGameState.players.length
      ) {
        /* During transport, quick-save / folder boot use pre-Wayback snapshot. After replay END, gameState
         * is the final frame and must not be replaced by stale backup. */
        if (!window.__risqueReplayEnded) {
          return window.__risqueReplayInlineBackupGameState;
        }
      }
    } catch (eBkSnap) {
      /* ignore */
    }
    try {
      if (window.gameState && window.gameState.players && Array.isArray(window.gameState.players)) {
        return window.gameState;
      }
    } catch (e0) {
      /* ignore */
    }
    return state;
  }

  function triggerHostQuickSave(sourceLabel) {
    if (window.risqueDisplayIsPublic) return;
    var snap;
    try {
      snap = getActiveGameStateSnapshot();
      saveState(snap);
    } catch (eSnap) {
      if (sourceLabel === "keyboard") {
        setBoardCornerMsg("Save failed.");
      }
      return;
    }
    saveGameSnapshotToFile(snap, { splitSessionReplayFiles: true })
      .then(function (res) {
        if (!res) return;
        if (sourceLabel === "keyboard") {
          if (res.aborted) {
            setBoardCornerMsg("Save canceled.");
          } else if (res.ok) {
            if (res.replayWritten) {
              setBoardCornerMsg(
                res.usedPicker
                  ? "Saved game JSON + full session replay (deal→now)."
                  : "Saved game + session replay to your connected save folder (no Save dialogs)."
              );
            } else {
              setBoardCornerMsg(
                res.usedPicker
                  ? "Game saved — no session replay (tape empty or replay save canceled)."
                  : "Game saved — session replay missing or not written."
              );
            }
          } else {
            setBoardCornerMsg("Save failed.");
          }
        }
        if (res.ok) {
          logEvent("Save snapshot + session replay (" + sourceLabel + ")", {
            usedPicker: !!res.usedPicker,
            replayWritten: !!res.replayWritten
          });
        }
      })
      .catch(function () {
        if (sourceLabel === "keyboard") {
          setBoardCornerMsg("Save failed.");
        }
      });
  }

  /** Same as SAVE GAME: stripped game JSON + full session replay sidecar (deal→now). */
  function triggerHostSaveGameAndReplay(sourceLabel) {
    if (window.risqueDisplayIsPublic) return;
    var snap;
    try {
      snap = getActiveGameStateSnapshot();
      saveState(snap);
    } catch (eSnap) {
      setBoardCornerMsg("Save failed.");
      return;
    }
    saveGameSnapshotToFile(snap, { splitSessionReplayFiles: true })
      .then(function (res) {
        if (!res) return;
        if (res.aborted) {
          setBoardCornerMsg("Save canceled.");
        } else if (res.ok) {
          if (res.replayWritten) {
            setBoardCornerMsg(
              res.usedPicker
                ? "Saved game JSON + full session replay (deal→now)."
                : "Saved game + session replay to your connected save folder (no Save dialogs)."
            );
          } else {
            setBoardCornerMsg(
              "Game saved — session replay missing (tape empty or second save canceled)."
            );
          }
        } else {
          setBoardCornerMsg("Save failed.");
        }
        if (res.ok) {
          logEvent("Save game + session replay (" + sourceLabel + ")", {
            usedPicker: !!res.usedPicker,
            replayWritten: !!res.replayWritten
          });
        }
      })
      .catch(function () {
        setBoardCornerMsg("Save failed.");
      });
  }

  var cornerMsgTimer = null;
  function setBoardCornerMsg(text, displayMs) {
    var el = document.getElementById("risque-board-corner-msg");
    if (!el) return;
    el.textContent = text || "";
    if (cornerMsgTimer) clearTimeout(cornerMsgTimer);
    if (text) {
      var ms =
        displayMs != null && isFinite(Number(displayMs))
          ? Math.max(1500, Math.floor(Number(displayMs)))
          : 7000;
      cornerMsgTimer = setTimeout(function () {
        el.textContent = "";
        cornerMsgTimer = null;
      }, ms);
    }
  }

  function formatRoundAutosaveStatusTime(atMs) {
    if (!atMs) return "";
    var d = new Date(Number(atMs) || 0);
    if (!d || isNaN(d.getTime())) return "";
    var datePart = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    return datePart + " " + formatRisque12HourAmPm(d);
  }

  function hasRoundAutosaveDiskTarget() {
    if (
      __risqueRoundAutosaveDirHandle &&
      typeof __risqueRoundAutosaveDirHandle.getFileHandle === "function"
    ) {
      return true;
    }
    return !!(typeof window.risqueLocalDiskIsActive === "function" && window.risqueLocalDiskIsActive());
  }

  var BOARD_AUTOSAVE_CONFIG_LABEL = "Autosave Config";

  function risqueAutosaveTierCornerLabel(tier) {
    switch (tier) {
      case "safe_fun":
        return "Autosave · Full replay";
      case "safe_lean":
        return "Autosave · Lean fun";
      case "safe_no_replay":
        return "Autosave · Game only";
      case "manual":
        return "Autosave · Minimal disk";
      case "battle_stills":
        return "Autosave · Battle stills";
      default:
        return BOARD_AUTOSAVE_CONFIG_LABEL;
    }
  }

  function setRoundAutosaveStatus(round, atMs, mode) {
    var el = document.getElementById("risque-board-round-save-status");
    if (!el) return;
    var g = typeof window !== "undefined" && window.gameState ? window.gameState : null;
    var tier = g && g.risqueAutosaveTier ? String(g.risqueAutosaveTier) : "";
    var base = risqueAutosaveTierCornerLabel(tier);
    var n = Number(round) || 0;
    el.textContent = n > 0 ? base + " · R" + n : base;
    if (n > 0) {
      var when = formatRoundAutosaveStatusTime(atMs);
      var m = String(mode || "");
      var tail =
        m === "disk-folder"
          ? "saved to folder"
          : m === "browser-download"
            ? "saved to downloads"
            : hasRoundAutosaveDiskTarget()
              ? "saved to folder"
              : "saved to downloads";
      var detail = when ? "Round " + n + ", " + when + " — " + tail : "Round " + n + " — " + tail;
      el.title = detail + " — click for autosave policy and save folder.";
      try {
        el.setAttribute("aria-label", base + ". Last round save: " + detail);
      } catch (eAria) {
        /* ignore */
      }
      return;
    }
    el.title = "Autosave policy and save folder — click to configure";
    try {
      el.setAttribute("aria-label", base + " — configure autosave");
    } catch (eAria2) {
      /* ignore */
    }
  }

  function syncRoundAutosaveStatusFromStorage() {
    try {
      if (getRoundAutosaveSessionCount() < 1) {
        setRoundAutosaveStatus(0, 0, "");
        return;
      }
      var arr = tryParse(localStorage.getItem(ROUND_AUTOSAVE_KEY) || "[]");
      if (!Array.isArray(arr) || !arr.length) {
        setRoundAutosaveStatus(0, 0, "");
        return;
      }
      var last = arr[arr.length - 1] || null;
      setRoundAutosaveStatus(last && last.round, last && last.at, last && last.mode);
    } catch (eRoundStatus) {
      setRoundAutosaveStatus(0, 0, "");
    }
  }

  /** Load game stays visible on the host map in every phase (public TV has no corner tools). */
  function syncBoardCornerLoadVisibility() {
    var loadBtn = document.getElementById("risque-board-load");
    if (!loadBtn) return;
    loadBtn.style.display = "";
    loadBtn.setAttribute("aria-hidden", "false");
    loadBtn.tabIndex = 0;
  }

  var __risqueGracePickJsonPrevPhase = null;
  var __risqueGracePickIndexPrevPhase = -1;
  var __risqueGracePickJsonPhaseStart = null;
  var __risqueGracePickIndexPhaseStart = -1;
  var __risqueGracePickJsonUndo = null;
  var __risqueGracePickIndexUndo = -1;
  var __risqueGracePickJsonCycle = null;
  var __risqueGracePickIndexCycle = -1;
  var __risqueGraceLastUndoJson = null;
  var __risqueGracePendingJson = null;
  var __risqueGracePendingIndex = -1;

  var GRACE_HOST_OVERLAY_HTML_FRAGMENT =
    '<div id="risque-grace-host-overlay" class="risque-grace-host-overlay" hidden aria-hidden="true">' +
    '<div class="risque-grace-host-overlay-inner">' +
    '<div id="risque-grace-host-screen-kidding" class="risque-grace-host-screen" hidden>' +
    '<p id="risque-grace-host-kidding-text" class="risque-grace-host-kidding-text"></p>' +
    '<button type="button" class="risque-grace-host-btn" id="risque-grace-host-kidding-close">Close</button>' +
    "</div>" +
    '<div id="risque-grace-host-screen-pick" class="risque-grace-host-screen" hidden>' +
    '<p class="risque-grace-host-title">Grace rollback</p>' +
    '<p class="risque-grace-host-desc">Rewind to a saved bookmark from this session. Undo uses the last write before your latest change (same tab).</p>' +
    '<p id="risque-grace-host-pick-warn" class="risque-grace-host-pick-warn" hidden></p>' +
    '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--primary" id="risque-grace-host-opt-undo" disabled>1) Undo last save</button>' +
    '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--primary" id="risque-grace-host-opt-phase-start" disabled>2) Start of this phase</button>' +
    '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--primary" id="risque-grace-host-opt-prev-phase" disabled>3) End of previous phase</button>' +
    '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--primary" id="risque-grace-host-opt-cycle" disabled>4) Start of turn (cardplay)</button>' +
    '<button type="button" class="risque-grace-host-btn" id="risque-grace-host-pick-cancel">Cancel</button>' +
    "</div>" +
    '<div id="risque-grace-host-screen-confirm" class="risque-grace-host-screen" hidden>' +
    '<p class="risque-grace-host-title">Are you sure?</p>' +
    '<p id="risque-grace-host-confirm-detail" class="risque-grace-host-desc"></p>' +
    '<button type="button" class="risque-grace-host-btn risque-grace-host-btn--danger" id="risque-grace-host-confirm-yes">Confirm rollback</button>' +
    '<button type="button" class="risque-grace-host-btn" id="risque-grace-host-confirm-no">Back</button>' +
    "</div>" +
    "</div></div>";

  function ensureGraceHostOverlayInDom() {
    var root = document.getElementById("runtime-hud-root");
    if (!root) return;
    var existing = document.getElementById("risque-grace-host-overlay");
    if (
      existing &&
      (!document.getElementById("risque-grace-host-pick-warn") ||
        !document.getElementById("risque-grace-host-opt-undo") ||
        !document.getElementById("risque-grace-host-opt-phase-start") ||
        !document.getElementById("risque-grace-host-opt-prev-phase") ||
        !document.getElementById("risque-grace-host-opt-cycle"))
    ) {
      existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (document.getElementById("risque-grace-host-overlay")) return;
    root.insertAdjacentHTML("beforeend", GRACE_HOST_OVERLAY_HTML_FRAGMENT);
  }

  function hideAllGraceScreens() {
    ["risque-grace-host-screen-kidding", "risque-grace-host-screen-pick", "risque-grace-host-screen-confirm"].forEach(
      function (id) {
        var el = document.getElementById(id);
        if (el) el.hidden = true;
      }
    );
  }

  function closeGraceHostRollbackFlow() {
    var ov = document.getElementById("risque-grace-host-overlay");
    if (!ov) return;
    ov.setAttribute("hidden", "");
    ov.setAttribute("aria-hidden", "true");
    hideAllGraceScreens();
    __risqueGracePendingJson = null;
    __risqueGracePendingIndex = -1;
  }

  function graceUpdatePickScreenButtonsAndWarn() {
    var b0 = document.getElementById("risque-grace-host-opt-undo");
    var b1 = document.getElementById("risque-grace-host-opt-phase-start");
    var b2 = document.getElementById("risque-grace-host-opt-prev-phase");
    var b3 = document.getElementById("risque-grace-host-opt-cycle");
    var warn = document.getElementById("risque-grace-host-pick-warn");
    if (b0) b0.disabled = !__risqueGracePickJsonUndo;
    if (b1) b1.disabled = !__risqueGracePickJsonPhaseStart;
    if (b2) b2.disabled = !__risqueGracePickJsonPrevPhase;
    if (b3) b3.disabled = !__risqueGracePickJsonCycle;
    if (warn) {
      var arr = window.__risqueGraceCardplayStarts;
      var noArr = !Array.isArray(arr) || !arr.length;
      var noSnap =
        !__risqueGracePickJsonUndo &&
        !__risqueGracePickJsonPhaseStart &&
        !__risqueGracePickJsonPrevPhase &&
        !__risqueGracePickJsonCycle;
      if (noArr || noSnap) {
        warn.textContent =
          "No Grace bookmarks yet for this session — play a few moments, or reload may clear Undo until the next save.";
        warn.hidden = false;
      } else {
        warn.textContent = "";
        warn.hidden = true;
      }
    }
  }

  function openGraceHostRollbackFlow() {
    if (window.risqueDisplayIsPublic) return;
    ensureGraceHostOverlayInDom();
    wireGraceHostOverlayOnce();
    var ov = document.getElementById("risque-grace-host-overlay");
    if (!ov) {
      setBoardCornerMsg("Grace: control panel not ready.");
      return;
    }
    __risqueGracePendingJson = null;
    __risqueGracePendingIndex = -1;
    hideAllGraceScreens();
    ov.removeAttribute("hidden");
    ov.setAttribute("aria-hidden", "false");
    var arr = window.__risqueGraceCardplayStarts;
    if (!Array.isArray(arr)) {
      window.__risqueGraceCardplayStarts = arr = [];
    }
    var gs = getActiveGameStateSnapshot();
    var undoSnap = graceFindUndoSnapshot(gs);
    var phaseStartSnap = graceFindCurrentPhaseStartSnapshot(gs);
    var prevSnap = graceFindPreviousPhaseSnapshot(gs);
    var cycleSnap = graceFindPlayerCycleSnapshot(gs);
    var j0 = undoSnap && undoSnap.entry && typeof undoSnap.entry.json === "string" ? undoSnap.entry.json : null;
    var jPs =
      phaseStartSnap && phaseStartSnap.entry && typeof phaseStartSnap.entry.json === "string"
        ? phaseStartSnap.entry.json
        : null;
    var jPrev =
      prevSnap && prevSnap.entry && typeof prevSnap.entry.json === "string" ? prevSnap.entry.json : null;
    var j3 = cycleSnap && cycleSnap.entry && typeof cycleSnap.entry.json === "string" ? cycleSnap.entry.json : null;
    __risqueGracePickJsonUndo = j0;
    __risqueGracePickIndexUndo = undoSnap && Number.isInteger(undoSnap.index) ? undoSnap.index : -1;
    __risqueGracePickJsonPhaseStart = jPs;
    __risqueGracePickIndexPhaseStart = phaseStartSnap && Number.isInteger(phaseStartSnap.index) ? phaseStartSnap.index : -1;
    __risqueGracePickJsonPrevPhase = jPrev;
    __risqueGracePickIndexPrevPhase = prevSnap && Number.isInteger(prevSnap.index) ? prevSnap.index : -1;
    __risqueGracePickJsonCycle = j3;
    __risqueGracePickIndexCycle = cycleSnap && Number.isInteger(cycleSnap.index) ? cycleSnap.index : -1;
    var pick = document.getElementById("risque-grace-host-screen-pick");
    if (pick) pick.hidden = false;
    graceUpdatePickScreenButtonsAndWarn();
    if (!arr.length || (!j0 && !jPs && !jPrev && !j3)) {
      logEvent("Grace: opened panel (no usable snapshots)");
    } else {
      logEvent("Grace: opened rollback options panel");
    }
    requestAnimationFrame(function () {
      if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
        window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  function graceShowConfirmScreen(detailText, jsonStr, snapIndex) {
    __risqueGracePendingJson = jsonStr;
    __risqueGracePendingIndex = Number.isInteger(snapIndex) ? snapIndex : -1;
    hideAllGraceScreens();
    var cf = document.getElementById("risque-grace-host-screen-confirm");
    var dt = document.getElementById("risque-grace-host-confirm-detail");
    if (dt) dt.textContent = detailText || "";
    if (cf) cf.hidden = false;
  }

  function graceShowPickAgain() {
    __risqueGracePendingJson = null;
    hideAllGraceScreens();
    var pick = document.getElementById("risque-grace-host-screen-pick");
    if (pick) pick.hidden = false;
    graceUpdatePickScreenButtonsAndWarn();
  }

  function graceExecuteRollback(jsonStr, snapIndex) {
    if (!jsonStr) return;
    var gs = tryParse(jsonStr);
    var L = window.risquePhases && window.risquePhases.login;
    if (!gs || !L || typeof L.validateLoadedGameState !== "function" || !L.validateLoadedGameState(gs)) {
      setBoardCornerMsg("Grace: invalid snapshot.");
      closeGraceHostRollbackFlow();
      return;
    }
    if (typeof L.fixResumePhase === "function" && !L.fixResumePhase(gs, logEvent)) {
      setBoardCornerMsg("Grace: invalid turn order.");
      closeGraceHostRollbackFlow();
      return;
    }
    var normalized = normalizeState(gs);
    var out = JSON.stringify(normalized);
    try {
      window.__risqueGraceRollbackActive = true;
      localStorage.setItem(STORAGE_KEY, out);
    } catch (e1) {
      setBoardCornerMsg("Grace: could not save.");
      return;
    } finally {
      window.__risqueGraceRollbackActive = false;
    }
    var arr = window.__risqueGraceCardplayStarts;
    if (Array.isArray(arr)) {
      var keepN = Number.isInteger(snapIndex) && snapIndex >= 0 ? snapIndex + 1 : arr.length;
      if (keepN < arr.length) {
        window.__risqueGraceCardplayStarts = arr.slice(0, Math.max(0, keepN));
        persistGracePhaseSnapshotsToStorage(window.__risqueGraceCardplayStarts);
      }
    }
    clearGraceLastUndoSession();
    window.gameState = normalized;
    state = normalized;
    __risqueGracePendingJson = null;
    closeGraceHostRollbackFlow();
    if (typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
    logEvent("Grace rollback committed", { phase: normalized.phase, currentPlayer: normalized.currentPlayer });
    var dest = "game.html?phase=" + encodeURIComponent(String(normalized.phase || "cardplay"));
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(dest);
    } else {
      window.location.href = dest;
    }
  }

  function wireGraceHostOverlayOnce() {
    if (window.risqueDisplayIsPublic) return;
    ensureGraceHostOverlayInDom();
    var rootOv = document.getElementById("risque-grace-host-overlay");
    if (!rootOv || rootOv.getAttribute("data-risque-grace-wired") === "1") return;
    rootOv.setAttribute("data-risque-grace-wired", "1");
    rootOv.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest("button");
      if (!btn || !btn.id) return;
      var id = btn.id;
      if (id === "risque-grace-host-kidding-close" || id === "risque-grace-host-pick-cancel") {
        closeGraceHostRollbackFlow();
        return;
      }
      if (id === "risque-grace-host-opt-undo") {
        if (t.disabled) return;
        if (!__risqueGracePickJsonUndo) return;
        graceShowConfirmScreen(
          "Restore the game to one save ago — the last point before your most recent automatic save (same as one Undo step).",
          __risqueGracePickJsonUndo,
          __risqueGracePickIndexUndo
        );
        return;
      }
      if (id === "risque-grace-host-opt-phase-start") {
        if (t.disabled) return;
        if (!__risqueGracePickJsonPhaseStart) return;
        graceShowConfirmScreen(
          "Rewind to the start of the current phase for this player (for example, undo reinforcement moves without leaving reinforce).",
          __risqueGracePickJsonPhaseStart,
          __risqueGracePickIndexPhaseStart
        );
        return;
      }
      if (id === "risque-grace-host-opt-prev-phase") {
        if (t.disabled) return;
        if (!__risqueGracePickJsonPrevPhase) return;
        graceShowConfirmScreen(
          "Jump back to the end of the previous phase — the board state from before you entered this phase (e.g. after attack, before reinforce).",
          __risqueGracePickJsonPrevPhase,
          __risqueGracePickIndexPrevPhase
        );
        return;
      }
      if (id === "risque-grace-host-opt-cycle") {
        if (t.disabled) return;
        if (!__risqueGracePickJsonCycle) return;
        graceShowConfirmScreen(
          "Go back to the beginning of this player's turn at card play (same player, start of their cycle).",
          __risqueGracePickJsonCycle,
          __risqueGracePickIndexCycle
        );
        return;
      }
      if (id === "risque-grace-host-confirm-no") {
        graceShowPickAgain();
        return;
      }
      if (id === "risque-grace-host-confirm-yes") {
        graceExecuteRollback(__risqueGracePendingJson, __risqueGracePendingIndex);
      }
    });
  }

  /**
   * Public TV: round badge in the same bottom-left slot as host (ghost placeholders for MANUAL… + autosave + EMERGENCY).
   * Host #risque-board-corner-tools stays hidden on public; this strip is the only visible corner chrome.
   */
  function ensurePublicHostlikeRoundIndicatorStrip() {
    if (!window.risqueDisplayIsPublic) return;
    var canvas = document.getElementById("canvas");
    if (!canvas) return;
    var legacy = document.querySelector("#risque-map-round-indicator-public.risque-map-round-indicator--public-float");
    if (legacy) {
      try {
        legacy.remove();
      } catch (eL) {
        /* ignore */
      }
    }
    var bar = document.getElementById("risque-public-hostlike-round-bar");
    if (bar) {
      if (bar.parentNode !== canvas) {
        try {
          canvas.appendChild(bar);
        } catch (eRe) {
          /* ignore */
        }
      }
      return;
    }
    bar = document.createElement("div");
    bar.id = "risque-public-hostlike-round-bar";
    bar.className = "risque-board-corner-bottom risque-board-corner-bottom--public-hostlike";
    bar.innerHTML =
      '<div class="risque-board-op-btn risque-public-corner-ghost">MANUAL</div>' +
      '<div class="risque-board-op-btn risque-public-corner-ghost">HELP</div>' +
      '<div class="risque-board-op-btn risque-public-corner-ghost">REPLAY</div>' +
      '<div class="risque-board-op-btn risque-public-corner-ghost risque-public-ghost-replay-save">SAVE + REPLAY</div>' +
      '<div class="risque-board-round-save-cluster">' +
      '<div class="risque-board-round-save-status risque-board-op-btn risque-public-corner-ghost">Autosave Config</div>' +
      '<div class="risque-board-emergency-save-btn risque-public-corner-ghost" role="presentation">EMERGENCY</div>' +
      '<div id="risque-map-round-indicator-public" class="risque-map-round-indicator risque-map-round-indicator--host" role="status" aria-live="polite" aria-label="Current round">' +
      '<div class="risque-map-round-indicator__label">ROUND</div>' +
      '<div class="risque-map-round-indicator__badge">' +
      '<span id="risque-map-round-indicator-public-num" class="risque-map-round-indicator__num">1</span>' +
      "</div></div></div>";
    try {
      canvas.appendChild(bar);
    } catch (eApp) {
      /* ignore */
    }
  }

  function syncMapRoundIndicatorFromState(gs) {
    var src = gs;
    if (!src || typeof src !== "object") {
      src = typeof window.gameState === "object" && window.gameState ? window.gameState : null;
    }
    if (!src || typeof src !== "object") {
      try {
        src = state;
      } catch (eSt) {
        src = null;
      }
    }
    var txt = "1";
    try {
      if (src && typeof src === "object") {
        if (window.risqueDisplayIsPublic && src.risqueReplayPlaybackActive) {
          if (String(src.risqueReplayMachineHudPhase || "") === "deal") {
            txt = "—";
          } else {
            var rRaw = src.risqueReplayHudRound != null ? src.risqueReplayHudRound : src.round;
            var n = typeof rRaw === "number" ? rRaw : parseInt(String(rRaw), 10);
            if (!isFinite(n) || n < 1) n = 1;
            txt = String(n);
          }
        } else if (String(src.phase || "") === "login") {
          txt = "—";
        } else {
          txt = String(Math.max(1, Math.floor(Number(src.round) || 1)));
        }
      }
    } catch (eTxt) {
      txt = "1";
    }
    var hNum = document.getElementById("risque-map-round-indicator-host-num");
    var pNum = document.getElementById("risque-map-round-indicator-public-num");
    if (hNum) hNum.textContent = txt;
    if (pNum) pNum.textContent = txt;
  }

  /** Save / load / manual / help — fixed to map (inside #canvas). Host only. */
  function ensureBoardCornerTools() {
    if (window.risqueDisplayIsPublic) return;
    var canvas = document.getElementById("canvas");
    if (!canvas) return;
    var wrap = document.getElementById("risque-board-corner-tools");
    var cornerInner =
      '<div class="risque-board-corner-stack">' +
      '<div class="risque-board-corner-top" role="toolbar" aria-label="Game file and display controls">' +
      '<button type="button" id="risque-board-new-game" class="risque-board-op-btn risque-board-op-btn--collapsible-row">NEW GAME</button>' +
      '<button type="button" id="risque-board-load" class="risque-board-op-btn risque-board-op-btn--collapsible-row">LOAD GAME</button>' +
      '<button type="button" id="risque-board-save" class="risque-board-op-btn risque-board-op-btn--collapsible-row" title="Two saves: game state JSON (replay stripped) + full session replay JSON (deal through now) — no prior disk replay required.">SAVE GAME</button>' +
      '<button type="button" id="risque-board-grace" class="risque-board-op-btn risque-board-op-btn--collapsible-row" title="Host: undo last action, roll back one phase, or restart player cycle (control panel)">GRACE</button>' +
      '<button type="button" id="risque-board-open-public" class="risque-board-op-btn risque-board-op-btn--collapsible-row risque-board-open-public" title="Open the public / TV board in a new window">PUBLIC</button>' +
      '<button type="button" id="risque-board-hide-top-row" class="risque-board-op-btn risque-board-hide-top-row-btn" title="Hide or show the other controls on this row" aria-pressed="false">HIDE BUTTONS</button>' +
      "</div>" +
      '<div id="risque-board-corner-msg" class="risque-board-corner-msg" aria-live="polite"></div>' +
      "</div>" +
      '<div class="risque-board-corner-bottom" role="navigation" aria-label="Documentation, replay, autosave">' +
      '<button type="button" id="risque-board-manual" class="risque-board-op-btn">MANUAL</button>' +
      '<button type="button" id="risque-board-help" class="risque-board-op-btn">HELP</button>' +
      '<button type="button" id="risque-board-replay-machine" class="risque-board-op-btn risque-board-op-btn--hide-with-top" title="Open Wayback in the control panel (no pop-up). Uses in-memory tape + connected save folder (default C:\\risque\\save).">REPLAY</button>' +
      '<button type="button" id="risque-board-save-with-replay" class="risque-board-op-btn risque-board-op-btn--hide-with-top" title="Same as SAVE GAME: game JSON + full session replay sidecar.">SAVE + REPLAY</button>' +
      '<div class="risque-board-round-save-cluster">' +
      '<div id="risque-board-round-save-status" class="risque-board-round-save-status risque-board-op-btn" aria-live="polite" aria-label="Autosave — configure policy and save folder" title="Autosave policy and save folder — click to configure">Autosave Config</div>' +
      '<button type="button" id="risque-board-emergency-save" class="risque-board-emergency-save-btn" title="Force immediate game + replay snapshot (mid-round). Writes game-emergency-* and replay-emergency-* files to SAVE or Downloads.">EMERGENCY</button>' +
      '<div id="risque-map-round-indicator-host" class="risque-map-round-indicator risque-map-round-indicator--host" role="status" aria-live="polite" aria-label="Current round">' +
      '<div class="risque-map-round-indicator__label">ROUND</div>' +
      '<div class="risque-map-round-indicator__badge">' +
      '<span id="risque-map-round-indicator-host-num" class="risque-map-round-indicator__num">1</span>' +
      "</div></div>" +
      "</div></div>" +
      '<input type="file" id="risque-board-load-input" accept=".json,.JSON" style="display:none" />';
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "risque-board-corner-tools";
      wrap.className = "risque-board-corner-tools";
      wrap.setAttribute("data-risque-corner-v", BOARD_CORNER_TOOLS_VERSION);
      wrap.setAttribute(
        "aria-label",
        "New game, load game, save game, grace rollback, public board, hide row; manual, help, replay, save with replay, round autosave, emergency save"
      );
      wrap.innerHTML = cornerInner;
      canvas.appendChild(wrap);
    } else if (wrap.getAttribute("data-risque-corner-v") !== BOARD_CORNER_TOOLS_VERSION) {
      wrap.setAttribute("data-risque-corner-v", BOARD_CORNER_TOOLS_VERSION);
      wrap.setAttribute(
        "aria-label",
        "New game, load game, save game, grace rollback, public board, hide row; manual, help, replay, save with replay, round autosave, emergency save"
      );
      wrap.innerHTML = cornerInner;
      boardCornerToolsWired = false;
    }
    if (wrap.parentNode === canvas) {
      canvas.appendChild(wrap);
    }
    syncBoardCornerLoadVisibility();
    syncRoundAutosaveStatusFromStorage();
    if (boardCornerToolsWired) return;
    boardCornerToolsWired = true;

    var saveBtn = document.getElementById("risque-board-save");
    var loadBtn = document.getElementById("risque-board-load");
    var newGameBtn = document.getElementById("risque-board-new-game");
    var manualBtn = document.getElementById("risque-board-manual");
    var helpBtn = document.getElementById("risque-board-help");
    var loadInput = document.getElementById("risque-board-load-input");

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        triggerHostQuickSave("map corner");
      });
    }
    if (loadBtn && loadInput) {
      loadBtn.addEventListener("click", function () {
        setBoardCornerMsg("");
        loadInput.click();
      });
      loadInput.addEventListener("change", function (ev) {
        var file = ev.target.files && ev.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var rawParsed = JSON.parse(e.target.result);
            var L = window.risquePhases && window.risquePhases.login;
            if (!L || typeof L.validateLoadedGameState !== "function") {
              setBoardCornerMsg("Load module not ready.");
              loadInput.value = "";
              return;
            }
            var gs =
              typeof L.normalizeImportedGameState === "function"
                ? L.normalizeImportedGameState(rawParsed)
                : rawParsed;
            if (!L.validateLoadedGameState(gs)) {
              setBoardCornerMsg("Invalid save file.");
              loadInput.value = "";
              return;
            }
            if (typeof L.fixResumePhase === "function" && !L.fixResumePhase(gs, logEvent)) {
              setBoardCornerMsg("Invalid turn order.");
              loadInput.value = "";
              return;
            }
            var normalized = normalizeState(gs);
            try {
              localStorage.removeItem(GRACE_SNAPSHOTS_STORAGE_KEY);
            } catch (eGr) {
              /* ignore */
            }
            window.__risqueGraceCardplayStarts = [];
            if (typeof window.risqueClearStoredSessionForNewGame === "function") {
              try {
                window.risqueClearStoredSessionForNewGame();
              } catch (eClrLoad) {
                /* ignore */
              }
            }
            saveState(normalized);
            try {
              if (typeof window.risqueReplayPersistTapeSidecar === "function") {
                window.risqueReplayPersistTapeSidecar(normalized);
              }
            } catch (eSideLoad) {
              /* ignore */
            }
            if (typeof window.risqueHostReplaceShellGameState === "function") {
              try {
                window.risqueHostReplaceShellGameState(normalized);
              } catch (eRepLoad) {
                /* ignore */
              }
            }
            logEvent("Loaded game from file", { phase: normalized.phase });
            var ph = normalized.phase || "cardplay";
            var dest = "game.html?phase=" + encodeURIComponent(ph);
            function navigateAfterLoad() {
              window.risqueNavigateWithFade(dest);
            }
            /* Stitch/tidy replay folder on disk before unload — timers from this page are dropped on navigation. */
            if (
              typeof window.risqueSessionDiskStitchAndTidyReplayFolder === "function" &&
              typeof window.risqueSessionDiskHasWritableSaveTarget === "function" &&
              window.risqueSessionDiskHasWritableSaveTarget()
            ) {
              Promise.resolve(window.risqueSessionDiskStitchAndTidyReplayFolder(normalized))
                .catch(function () {
                  /* non-fatal */
                })
                .then(navigateAfterLoad);
            } else {
              navigateAfterLoad();
            }
          } catch (err) {
            setBoardCornerMsg("Could not read JSON.");
            logEvent("Corner load error", { message: err.message });
          }
          loadInput.value = "";
        };
        reader.readAsText(file);
      });
    }
    if (newGameBtn) {
      newGameBtn.addEventListener("click", function () {
        if (
          !window.confirm(
            "Confirm restart?\n\nThis clears the saved session and returns to the login screen."
          )
        ) {
          return;
        }
        clearStoredSessionForNewGame();
        logEvent("Start new game (corner) — cleared storage, navigating to login");
        try {
          window.location.href = RISQUE_FRESH_START_URL;
        } catch (eNav) {
          window.location.assign(RISQUE_FRESH_START_URL);
        }
      });
    }
    if (manualBtn) {
      manualBtn.addEventListener("click", function () {
        window.open(risqueDoc("manual"), "_blank", "noopener,noreferrer");
      });
    }
    if (helpBtn) {
      helpBtn.addEventListener("click", function () {
        window.open(risqueDoc("help"), "_blank", "noopener,noreferrer");
      });
    }
    var replayMachineBtn = document.getElementById("risque-board-replay-machine");
    if (replayMachineBtn) {
      replayMachineBtn.addEventListener("click", function () {
        try {
          risqueOpenReplayMachineFromHost();
        } catch (eRm) {
          /* ignore */
        }
      });
    }
    var saveWithReplayBtn = document.getElementById("risque-board-save-with-replay");
    if (saveWithReplayBtn) {
      saveWithReplayBtn.addEventListener("click", function () {
        triggerHostSaveGameAndReplay("map corner");
      });
    }
    var roundSaveStatusEl = document.getElementById("risque-board-round-save-status");
    if (roundSaveStatusEl && !roundSaveStatusEl.dataset.risqueSaveFolderClick) {
      roundSaveStatusEl.dataset.risqueSaveFolderClick = "1";
      roundSaveStatusEl.title =
        "Autosave policy and save folder — click to configure. (Launcher EMERGENCY*.json watcher is separate from the red EMERGENCY button.)";
      roundSaveStatusEl.addEventListener("click", function () {
        mountAutosaveConfigOverlay();
      });
    }
    var emergencySaveBtn = document.getElementById("risque-board-emergency-save");
    if (emergencySaveBtn) {
      emergencySaveBtn.addEventListener("click", function () {
        triggerEmergencyHostSnapshot();
      });
    }
    var graceBtn = document.getElementById("risque-board-grace");
    if (graceBtn) {
      graceBtn.addEventListener("click", function () {
        if (window.risqueDisplayIsPublic) return;
        openGraceHostRollbackFlow();
      });
    }
    var openPublicCorner = document.getElementById("risque-board-open-public");
    if (openPublicCorner) {
      openPublicCorner.addEventListener("click", function () {
        if (typeof window.risqueOpenPublicDisplayWindow === "function") {
          window.risqueOpenPublicDisplayWindow();
        }
      });
    }
    var hideTopRowBtn = document.getElementById("risque-board-hide-top-row");
    if (hideTopRowBtn && wrap) {
      hideTopRowBtn.addEventListener("click", function () {
        var collapsed = wrap.classList.toggle("risque-board-corner-tools--host-top-collapsed");
        hideTopRowBtn.setAttribute("aria-pressed", collapsed ? "true" : "false");
        hideTopRowBtn.textContent = collapsed ? "SHOW BUTTONS" : "HIDE BUTTONS";
      });
    }
  }

  /** After player select / deal / deploy1: corner tools, map, HUD stats, unified setup column; optional onDone after DOM is ready */
  function refreshSetupStageChrome(bannerText, onDone) {
    requestAnimationFrame(function () {
      ensureBoardCornerTools();
      var gs = getActiveGameStateSnapshot();
      window.gameState = gs;
      /* Setup flows use this path instead of refreshVisuals — hide login-only Wayback folder badge here too. */
      syncWaybackConnectedLoginFlag(gs);
      var uio = document.getElementById("ui-overlay");
      if (uio && window.risqueRuntimeHud && typeof window.risqueRuntimeHud.ensureSetupHud === "function") {
        window.risqueRuntimeHud.ensureSetupHud(uio, bannerText != null ? bannerText : "SETUP");
      }
      if (window.gameUtils && gs) {
        try {
          window.gameUtils.initGameView();
          window.gameUtils.renderTerritories(null, gs);
          window.gameUtils.renderStats(gs);
        } catch (e1) {
          /* ignore */
        }
        resizeRuntimeCanvas();
      }
      if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
        window.risqueRuntimeHud.syncPosition();
      }
      if (typeof onDone === "function") {
        try {
          onDone();
        } catch (eCb) {
          /* ignore */
        }
      }
    });
  }

  function refreshBoardCornerOnly() {
    requestAnimationFrame(function () {
      ensureBoardCornerTools();
      resizeRuntimeCanvas();
      if (window.risqueRuntimeHud && window.risqueRuntimeHud.syncPosition) {
        var root = document.getElementById("runtime-hud-root");
        if (root) window.risqueRuntimeHud.syncPosition();
      }
    });
  }

  function runAutoCycleTest(state, turnCount) {
    var lines = [];
    var turns = Number(turnCount) || 10;
    for (var i = 1; i <= turns; i += 1) {
      if (state.phase !== "cardplay") {
        state.phase = "cardplay";
      }
      var actor = state.currentPlayer;
      var handBefore = getHandSize(state);
      var trimNote = "";
      if (handBefore > 4) {
        trimNote = trimHandToFour(state);
        handBefore = getHandSize(state);
      }
      state.cardEarnedViaAttack = true;
      state.phase = "receivecard";
      var awardResult = maybeAwardCard(state);
      var handAfterAward = getHandSize(state);
      advanceTurn(state);
      lines.push(
        "Turn " + i +
        " | Player: " + actor +
        " | Hand before: " + handBefore +
        (trimNote ? " | Trim: " + trimNote : "") +
        " | " + awardResult +
        " | Hand after award: " + handAfterAward +
        " | Next: " + state.currentPlayer +
        " | Round: " + state.round
      );
    }
    return {
      summary: "Auto cycle complete: " + turns + " turns",
      report: lines.join("\n")
    };
  }

  var state;
  if (window.risqueDisplayIsPublic) {
    var rawMirror = localStorage.getItem(PUBLIC_MIRROR_KEY);
    var parsedMirror = rawMirror ? tryParse(rawMirror) : null;
    if (publicTvBootstrap) {
      state = normalizeState(visualStateForLoginScreen(loadState()));
    } else if (parsedMirror && String(parsedMirror.phase || "") === "login") {
      state = normalizeState(parsedMirror);
    } else if (
      parsedMirror &&
      parsedMirror.players &&
      Array.isArray(parsedMirror.players) &&
      parsedMirror.players.length
    ) {
      state = normalizeState(parsedMirror);
    } else {
      state = loadState();
    }
  } else {
    state = loadState();
  }
  if (!window.risqueDisplayIsPublic) {
    restoreGraceCardplaySnapshotsFromStorage();
  }
  if (!window.risqueDisplayIsPublic && state && typeof window.risqueReplayFlattenEvents === "function") {
    try {
      window.risqueReplayFlattenEvents(state);
    } catch (eMigReplay) {
      /* ignore */
    }
  }
  if (forcedPhase === "login") {
    loginMounted = false;
    state.phase = "login";
  } else {
    if (
      forcedPhase &&
      forcedPhase !== "playerSelect" &&
      forcedPhase !== "deal" &&
      forcedPhase !== "deploy1" &&
      forcedPhase !== "deploy2" &&
      forcedPhase !== "deploy" &&
      forcedPhase !== "attack" &&
      forcedPhase !== "privacyGate"
    ) {
      state.phase = forcedPhase;
      saveState(state);
    }
  }
  logEvent("Runtime boot", { phase: state.phase, currentPlayer: state.currentPlayer, round: state.round });
  if (forcedPhase === "login" || state.phase === "login") {
    setRoundAutosaveSessionCount(0);
    __risqueRoundAutosaveSawNonFirstPlayerThisSession = false;
    __risqueRoundAutosaveSkippedInitialFirstPlayerCycle = false;
  }

  publicMirrorLastPhase = window.risqueDisplayIsPublic ? state.phase : null;
  syncPhaseDataAttr(state);
  maybeStartPostReceiveBlackoutFromSession();
  startRoundAutosaveWatcher();
  __risqueAutosaveFolderBootPromise = bootRestoreAutosaveFolder(state);

  if (forcedPhase === "playerSelect" && selectKind && window.risquePhases && window.risquePhases.playerSelect) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: player select (" + selectKind + ")";
    appEl.innerHTML = "";
    var psBanner =
      selectKind === "firstCard"
        ? "FIRST CARD"
        : selectKind === "deployOrder"
          ? "DEPLOY ORDER"
          : "SELECTING PLAYER ONE";
    refreshSetupStageChrome(psBanner, function () {
      window.risquePhases.playerSelect.mount(stageHost, {
        selectKind: selectKind,
        log: function (line) {
          logEvent(line);
        }
      });
    });
  } else if (forcedPhase === "deal" && window.risquePhases && window.risquePhases.deal) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: deal";
    appEl.innerHTML = "";
    refreshSetupStageChrome("DEAL", function () {
      window.risquePhases.deal.run(stageHost, {
        log: function (line) {
          logEvent(line);
        }
      });
    });
  } else if (
    forcedPhase === "deploy" &&
    window.risquePhases &&
    window.risquePhases.deploy &&
    typeof window.risquePhases.deploy.runSetup === "function" &&
    typeof window.risquePhases.deploy.runTurn === "function"
  ) {
    var dkHost = resolveDeployKindForHost();
    document.body.classList.add("risque-setup-fullstage");
    appEl.innerHTML = "";
    if (dkHost === "setup") {
      phaseLabelEl.textContent = "Phase: deployment (setup)";
      refreshSetupStageChrome("FIRST DEPLOYMENT", function () {
        window.risquePhases.deploy.runSetup(stageHost, {
          log: function (line) {
            logEvent(line);
          }
        });
      });
    } else {
      phaseLabelEl.textContent = "Phase: deployment";
      window.gameState = state;
      window.risquePhases.deploy.runTurn(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        },
        conquestAfterDeploy: query.get("conquestAfterDeploy") === "1"
      });
      refreshVisuals("Deploy (turn) mounted");
    }
  } else if (forcedPhase === "privacyGate" && window.risquePhases && window.risquePhases.privacyGate) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: privacy gate";
    appEl.innerHTML = "";
    var privacyNext =
      query.get("next") || "game.html?phase=cardplay&legacyNext=income.html";
    window.risquePhases.privacyGate.mount(document.body, {
      navigateTo: privacyNext,
      onLog: function (msg) {
        logEvent(msg);
      }
    });
  } else if (forcedPhase === "attack" && window.risquePhases && window.risquePhases.attack) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: attack";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.attack.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Attack mounted");
  } else if (
    state.phase === "attack" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.attack &&
    typeof window.risquePhases.attack.mount === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: attack";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.attack.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Attack mounted (from saved phase)");
  } else if (forcedPhase === "reinforce" && window.risquePhases && window.risquePhases.reinforce) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: reinforce";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.reinforce.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Reinforce mounted");
  } else if (
    state.phase === "reinforce" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    window.risquePhases &&
    window.risquePhases.reinforce &&
    typeof window.risquePhases.reinforce.mount === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: reinforce";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.reinforce.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Reinforce mounted");
  } else if (forcedPhase === "receivecard" && window.risquePhases && window.risquePhases.receivecard) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: receive card";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.receivecard.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Receive card mounted");
  } else if (forcedPhase === "postgame" && window.risquePhases && window.risquePhases.postgame) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: postgame";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.postgame.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Postgame mounted");
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  } else if (
    state.phase === "postgame" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.postgame &&
    typeof window.risquePhases.postgame.mount === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: postgame";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.postgame.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Postgame mounted (from saved phase)");
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  } else if (
    state.phase === "receivecard" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "conquer" &&
    window.risquePhases &&
    window.risquePhases.receivecard &&
    typeof window.risquePhases.receivecard.mount === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: receive card";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.receivecard.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Receive card mounted (from saved phase)");
  } else if (forcedPhase === "conquer" && window.risquePhases && window.risquePhases.conquer) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: conquer";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.conquer.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Conquer mounted");
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  } else if (
    forcedPhase === "con-cardplay" &&
    window.risquePhases &&
    window.risquePhases.cardplay &&
    typeof window.risquePhases.cardplay.mount === "function"
  ) {
    risqueBootMountRuntimeCardplayContinental();
  } else if (
    state.phase === "conquer" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.conquer &&
    typeof window.risquePhases.conquer.mount === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: conquer";
    appEl.innerHTML = "";
    window.gameState = state;
    window.risquePhases.conquer.mount(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Conquer mounted (from saved phase)");
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  } else if (
    state.phase === "con-cardplay" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.cardplay &&
    typeof window.risquePhases.cardplay.mount === "function"
  ) {
    risqueBootMountRuntimeCardplayContinental();
  } else if (
    state.phase === "cardplay" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.cardplay &&
    typeof window.risquePhases.cardplay.mount === "function"
  ) {
    risqueMountCardplayShellSameDocument({});
  } else if (
    forcedPhase === "con-income" &&
    window.risquePhases &&
    window.risquePhases.income &&
    typeof window.risquePhases.income.runConquerIncome === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: con-income";
    appEl.innerHTML = "<p class=\"muted\">Continental income — use the map overlay.</p>";
    window.gameState = state;
    window.risquePhases.income.runConquerIncome(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Con-income mounted");
    if (window.risqueDisplayIsPublic && typeof risquePublicMirrorGameState === "function") {
      requestAnimationFrame(function () {
        risquePublicMirrorGameState(window.gameState);
      });
    }
  } else if (
    state.phase === "con-income" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    window.risquePhases &&
    window.risquePhases.income &&
    typeof window.risquePhases.income.runConquerIncome === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: con-income";
    appEl.innerHTML = "<p class=\"muted\">Continental income — use the map overlay.</p>";
    window.gameState = state;
    window.risquePhases.income.runConquerIncome(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Con-income mounted (from saved phase)");
    if (window.risqueDisplayIsPublic && typeof risquePublicMirrorGameState === "function") {
      requestAnimationFrame(function () {
        risquePublicMirrorGameState(window.gameState);
      });
    }
  } else if (
    forcedPhase === "con-deploy" &&
    window.risquePhases &&
    window.risquePhases.deploy &&
    typeof window.risquePhases.deploy.runContinentalDeploy === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: con-deploy";
    appEl.innerHTML = '<p class="muted">Deployment — use the map overlay.</p>';
    window.gameState = state;
    window.risquePhases.deploy.runContinentalDeploy(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Con-deploy mounted");
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  } else if (
    state.phase === "con-deploy" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.deploy &&
    typeof window.risquePhases.deploy.runContinentalDeploy === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: con-deploy";
    appEl.innerHTML = '<p class="muted">Deployment — use the map overlay.</p>';
    window.gameState = state;
    window.risquePhases.deploy.runContinentalDeploy(stageHost, {
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Con-deploy mounted (from saved phase)");
    if (!window.risqueDisplayIsPublic && typeof window.risqueMirrorPushGameState === "function") {
      window.risqueMirrorPushGameState();
    }
  } else if (
    state.phase === "income" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "con-income" &&
    window.risquePhases &&
    window.risquePhases.income &&
    typeof window.risquePhases.income.mount === "function"
  ) {
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: income";
    appEl.innerHTML = "<p class=\"muted\">Income — use the map overlay.</p>";
    window.gameState = state;
    window.risquePhases.income.mount(stageHost, {
      legacyNext: query.get("legacyNext") || "game.html?phase=deploy&kind=turn",
      onLog: function (msg, data) {
        logEvent(msg, data);
      }
    });
    refreshVisuals("Income mounted");
    if (window.risqueDisplayIsPublic && typeof risquePublicMirrorGameState === "function") {
      requestAnimationFrame(function () {
        risquePublicMirrorGameState(window.gameState);
      });
    }
  } else if (
    state.phase === "deploy" &&
    forcedPhase !== "login" &&
    forcedPhase !== "playerSelect" &&
    forcedPhase !== "deal" &&
    forcedPhase !== "deploy1" &&
    forcedPhase !== "deploy2" &&
    forcedPhase !== "deploy" &&
    forcedPhase !== "attack" &&
    forcedPhase !== "privacyGate" &&
    forcedPhase !== "reinforce" &&
    forcedPhase !== "receivecard" &&
    forcedPhase !== "conquer" &&
    forcedPhase !== "cardplay" &&
    forcedPhase !== "income" &&
    forcedPhase !== "con-income"
  ) {
    /* Resume with no ?phase= in URL: mirror key picks setup vs turn deploy. */
    var depRoute = null;
    try {
      depRoute = localStorage.getItem(MIRROR_DEPLOY_ROUTE_KEY);
    } catch (eDep) {
      /* ignore */
    }
    document.body.classList.add("risque-setup-fullstage");
    phaseLabelEl.textContent = "Phase: deployment";
    appEl.innerHTML = "";
    window.gameState = state;
    var depSetup =
      depRoute === "deploy1" ||
      depRoute === "setup";
    if (
      depSetup &&
      window.risquePhases &&
      window.risquePhases.deploy &&
      typeof window.risquePhases.deploy.runSetup === "function"
    ) {
      phaseLabelEl.textContent = "Phase: deployment (setup)";
      refreshSetupStageChrome("FIRST DEPLOYMENT", function () {
        window.risquePhases.deploy.runSetup(stageHost, {
          log: function (line) {
            logEvent(line);
          }
        });
      });
      refreshVisuals("Deploy setup mounted (resume)");
    } else if (
      window.risquePhases &&
      window.risquePhases.deploy &&
      typeof window.risquePhases.deploy.runTurn === "function"
    ) {
      phaseLabelEl.textContent = "Phase: deployment";
      window.risquePhases.deploy.runTurn(stageHost, {
        onLog: function (msg, data) {
          logEvent(msg, data);
        },
        conquestAfterDeploy: query.get("conquestAfterDeploy") === "1"
      });
      refreshVisuals("Deploy turn mounted (resume)");
    } else {
      render(state, "Runtime booted");
    }
  } else {
    render(state, "Runtime booted");
  }

  window.addEventListener("resize", function () {
    requestAnimationFrame(resizeRuntimeCanvas);
  });

  appEl.addEventListener("click", function (event) {
    var target = event.target;
    var action = target && target.getAttribute("data-action");
    if (!action) return;

    var notice = "";
    var fromPhase = state.phase || "unknown";
    var blocked = false;
    if (action === "earned-attack") {
      state.cardEarnedViaAttack = true;
      notice = "Marked card earned via attack";
    } else if (action === "earned-cardplay") {
      state.cardEarnedViaCardplay = true;
      notice = "Marked card earned via cardplay";
    } else if (action === "discard-one") {
      if (state.phase !== "cardplay") {
        notice = "Blocked: discard is only valid in cardplay";
        blocked = true;
      } else {
        notice = discardOldestCard(state);
      }
    } else if (action === "trim-four") {
      if (state.phase !== "cardplay") {
        notice = "Blocked: hand trim is only valid in cardplay";
        blocked = true;
      } else {
        notice = trimHandToFour(state);
      }
    } else if (action === "auto-cycle") {
      if (state.phase !== "cardplay") {
        state.phase = "cardplay";
      }
      var result = runAutoCycleTest(state, 10);
      lastAutoReport = result.report;
      notice = result.summary;
    } else if (action === "to-receive" || action === "finish-cardplay") {
      if (state.phase !== "cardplay") {
        notice = "Blocked: only cardplay can transition to receivecard";
        blocked = true;
      } else if (getHandSize(state) > 4) {
        notice = "Blocked: hand is over 4 cards. Reduce hand before leaving cardplay";
        blocked = true;
      } else if (legacyNext) {
        state.phase = "income";
        notice = "Cardplay complete. Routing to legacy " + legacyNext;
        saveState(state);
        logEvent("Bridge to legacy page", { next: legacyNext, phase: state.phase });
        appendLedgerEntry(fromPhase, action, state.phase || "unknown", notice, false);
        render(state, notice);
        setTimeout(function () {
          var dest =
            !legacyNext || legacyNext === "income.html" || legacyNext === "in-come.html"
              ? "game.html?phase=income"
              : legacyNext;
          window.risqueNavigateWithFade(dest);
        }, 250);
        return;
      } else {
        state.phase = "receivecard";
        notice = "Transitioned to receivecard";
      }
    } else if (action === "award-now") {
      if (state.phase !== "receivecard") {
        notice = "Blocked: award is only valid in receivecard";
        blocked = true;
      } else {
        notice = maybeAwardCard(state);
      }
    } else if (action === "end-turn") {
      if (state.phase !== "receivecard") {
        notice = "Blocked: end turn is only valid in receivecard";
        blocked = true;
      } else if (window.__risqueShellReceiveCardEndTurnBusy) {
        notice = "Still saving this turn to disk — wait for it to finish.";
        blocked = true;
      } else {
        var awardResultSh = maybeAwardCard(state);
        var turnDiskShell = advanceTurn(state);
        if (turnDiskShell === false) {
          notice = awardResultSh + " | Turn did not advance (check turn order).";
          blocked = true;
        } else {
          window.__risqueShellReceiveCardEndTurnBusy = true;
          var noticeShell = awardResultSh + " | Turn advanced to " + state.currentPlayer;
          var dShell =
            turnDiskShell && typeof turnDiskShell.then === "function"
              ? turnDiskShell
              : typeof window.risqueSessionDiskAwaitTurnWriteQueue === "function"
                ? window.risqueSessionDiskAwaitTurnWriteQueue()
                : Promise.resolve(true);
          dShell.finally(function () {
            try {
              window.__risqueShellReceiveCardEndTurnBusy = false;
            } catch (eShBusy) {
              /* ignore */
            }
          });
          dShell.then(
            function () {
              saveState(state);
              logEvent("Action", { action: action, phase: state.phase || "unknown", currentPlayer: state.currentPlayer });
              appendLedgerEntry(fromPhase, action, state.phase || "unknown", noticeShell, false);
              render(state, noticeShell);
            },
            function () {
              var noticeFail = noticeShell + " — disk save failed.";
              saveState(state);
              logEvent("Action", { action: action, phase: state.phase || "unknown", currentPlayer: state.currentPlayer });
              appendLedgerEntry(fromPhase, action, state.phase || "unknown", noticeFail, true);
              render(state, noticeFail);
            }
          );
          return;
        }
      }
    } else if (action === "force-cardplay") {
      state.phase = "cardplay";
      notice = "Forced phase to cardplay";
    }

    saveState(state);
    logEvent("Action", { action: action, phase: state.phase, currentPlayer: state.currentPlayer });
    appendLedgerEntry(fromPhase, action, state.phase || "unknown", notice, blocked);
    render(state, notice);
  });

  document.getElementById("btnLauncher").addEventListener("click", function () {
    window.location.href = risqueDoc("index");
  });

  document.getElementById("btnLegacy").addEventListener("click", function () {
    window.location.href = risqueDoc("index");
  });

  var btnMovePublic = document.getElementById("btnMovePublic");
  if (btnMovePublic) {
    if (window.risqueDisplayIsPublic) {
      btnMovePublic.hidden = true;
    } else {
      btnMovePublic.addEventListener("click", function () {
        try {
          if (typeof window.risqueOpenPublicDisplayWindow === "function") {
            window.risqueOpenPublicDisplayWindow();
          }
        } catch (eMovePub) {
          /* ignore */
        }
        render(
          state,
          "Click the public window, then press Win+Shift+Right (or Win+Shift+Left)."
        );
      });
    }
  }

  document.getElementById("btnSave").addEventListener("click", function () {
    triggerHostQuickSave("devtools");
  });

  document.addEventListener(
    "keydown",
    function (e) {
      if (window.risqueDisplayIsPublic) return;
      if (!(e.ctrlKey || e.metaKey || e.altKey)) return;
      if (e.repeat) return;
      var key = String(e.key || "").toLowerCase();
      if (key !== "s") return;
      var t = e.target;
      var tag = t && t.tagName ? String(t.tagName).toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || (t && t.isContentEditable)) return;
      e.preventDefault();
      e.stopPropagation();
      triggerHostQuickSave("keyboard");
    },
    true
  );

  var btnReload = document.getElementById("btnReload");
  if (btnReload) {
    if (window.risqueDisplayIsPublic) {
      btnReload.hidden = true;
    } else {
      btnReload.addEventListener("click", function () {
        window.location.reload();
      });
    }
  }

  document.getElementById("btnExportLedger").addEventListener("click", function () {
    downloadLedger();
    logEvent("Ledger exported");
    render(state, "Exported transition ledger");
  });

  document.getElementById("btnClearLedger").addEventListener("click", function () {
    saveLedger([]);
    logEvent("Ledger cleared");
    render(state, "Cleared transition ledger");
  });

  function buildPublicDisplayUrl() {
    var u = new URL(window.location.href);
    u.searchParams.set("display", "public");
    u.searchParams.delete("phase");
    u.searchParams.delete("legacyNext");
    u.searchParams.delete("selectKind");
    u.searchParams.delete("loginLegacyNext");
    u.searchParams.delete("loginLoadRedirect");
    u.searchParams.delete("next");
    u.searchParams.delete("tvBootstrap");
    /* file://: pathname+search breaks window.open (Chrome may treat ? as path / block). Use full href. */
    return u.href;
  }

  function popupFeaturesForBounds(bounds) {
    var L = Math.floor(bounds.left);
    var T = Math.floor(bounds.top);
    var W = Math.max(400, Math.floor(bounds.width));
    var H = Math.max(320, Math.floor(bounds.height));
    return (
      "left=" +
      L +
      ",top=" +
      T +
      ",width=" +
      W +
      ",height=" +
      H +
      ",menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes,status=no"
    );
  }

  function currentScreenBoundsFallback() {
    var left = typeof screen.availLeft === "number" ? screen.availLeft : typeof window.screenX === "number" ? window.screenX : 0;
    var top = typeof screen.availTop === "number" ? screen.availTop : typeof window.screenY === "number" ? window.screenY : 0;
    var width = screen.availWidth || screen.width || 1280;
    var height = screen.availHeight || screen.height || 720;
    return { left: left, top: top, width: width, height: height };
  }

  window.risqueOpenPublicDisplayWindow = function () {
    try {
      var url = buildPublicDisplayUrl();
      var baseBounds = currentScreenBoundsFallback();
      var popup = window.open(url, "risquePublicBoard", popupFeaturesForBounds(baseBounds));
      if (!popup) {
        window.alert("Popup blocked. Allow popups for this site, then click Public again.");
        return;
      }
      try {
        window.__risquePublicBoardWindow = popup;
      } catch (eRef) {
        /* ignore */
      }
      try {
        popup.focus();
      } catch (eFocus) {
        /* ignore */
      }

      if (!("getScreenDetails" in window)) return;
      window
        .getScreenDetails()
        .then(function (sd) {
          if (!sd || !Array.isArray(sd.screens) || sd.screens.length < 2) return;
          var cur = sd.currentScreen || null;
          var target = null;
          for (var i = 0; i < sd.screens.length; i++) {
            var s = sd.screens[i];
            var same =
              cur &&
              s &&
              s.left === cur.left &&
              s.top === cur.top &&
              s.width === cur.width &&
              s.height === cur.height;
            if (!same) {
              target = s;
              break;
            }
          }
          if (!target) return;
          var left = typeof target.availLeft === "number" ? target.availLeft : target.left;
          var top = typeof target.availTop === "number" ? target.availTop : target.top;
          var width = typeof target.availWidth === "number" ? target.availWidth : target.width;
          var height = typeof target.availHeight === "number" ? target.availHeight : target.height;
          try {
            popup.moveTo(left, top);
            popup.resizeTo(width, height);
            popup.focus();
          } catch (eMove) {
            /* ignore */
          }
        })
        .catch(function () {
          /* ignore */
        });
    } catch (e1) {
      console.warn("risqueOpenPublicDisplayWindow:", e1);
    }
  };

  window.risqueOpenPublicConquestBridge = function () {
    try {
      var u = new URL("public-conquest-bridge.html", window.location.href);
      window.open(u.href, "risquePublicConquestBridge", "noopener,noreferrer");
    } catch (eBridge) {
      console.warn("risqueOpenPublicConquestBridge:", eBridge);
    }
  };

  if (!window.risqueDisplayIsPublic) {
    var lastConquestContinueTs = 0;
    function tryHostAdvanceFromPublicConquestBridge() {
      try {
        var raw = localStorage.getItem(PUBLIC_CONQUEST_CONTINUE_REQ_KEY);
        if (raw == null) return;
        var ts = parseInt(raw, 10);
        if (isNaN(ts) || ts <= lastConquestContinueTs) return;
        var gs = window.gameState;
        if (!gs) return;
        if (String(gs.phase || "") !== "attack") return;
        var banner =
          gs.risquePublicEliminationBanner != null ? String(gs.risquePublicEliminationBanner).trim() : "";
        var def = gs.defeatedPlayer != null ? String(gs.defeatedPlayer).trim() : "";
        if (!banner && !def) return;
        lastConquestContinueTs = ts;
        gs.phase = "conquer";
        gs.risqueConquestChainActive = true;
        gs.risqueRuntimeCardplayIncomeMode = "conquer";
        delete gs.risquePublicEliminationBanner;
        delete gs.risqueControlVoice;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(gs));
        } catch (eSave) {
          /* ignore */
        }
        if (typeof window.risqueMirrorPushGameState === "function") {
          window.risqueMirrorPushGameState();
        }
        var nav = "game.html?phase=conquer";
        if (window.risqueNavigateWithFade) {
          window.risqueNavigateWithFade(nav);
        } else {
          window.location.href = nav;
        }
      } catch (e) {
        /* ignore */
      }
    }
    window.addEventListener("storage", function (ev) {
      if (ev.key === PUBLIC_CONQUEST_CONTINUE_REQ_KEY && ev.newValue != null) {
        tryHostAdvanceFromPublicConquestBridge();
      }
    });
    setInterval(tryHostAdvanceFromPublicConquestBridge, 500);
  }

  if (window.risqueDisplayIsPublic) {
    var mirrorPublicT = null;
    window.addEventListener("storage", function (ev) {
      if (ev.key !== PUBLIC_MIRROR_KEY || ev.newValue == null) return;
      var gs = tryParse(ev.newValue);
      if (!gs) return;
      var nameRoulette =
        String(gs.phase || "") === "playerSelect" &&
        gs.risquePublicPlayerSelectFlash &&
        String(gs.risquePublicPlayerSelectFlash.name || "").trim() !== "";
      if (nameRoulette) {
        if (mirrorPublicT) clearTimeout(mirrorPublicT);
        mirrorPublicT = null;
        risquePublicMirrorGameState(gs);
        return;
      }
      if (mirrorPublicT) clearTimeout(mirrorPublicT);
      mirrorPublicT = setTimeout(function () {
        mirrorPublicT = null;
        risquePublicMirrorGameState(gs);
      }, 16);
    });
    /* storage events do not fire in the writing tab and can be flaky; poll mirror JSON for any change */
    setInterval(function () {
      var raw;
      try {
        raw = localStorage.getItem(PUBLIC_MIRROR_KEY);
      } catch (ePoll) {
        return;
      }
      if (!raw || raw === window.__risquePublicMirrorAppliedRaw) return;
      var gsPoll = tryParse(raw);
      if (!gsPoll) return;
      risquePublicMirrorGameState(gsPoll);
    }, PUBLIC_MIRROR_POLL_MS);
  }

  installRisquePublicCursorMirrorTracking();
  installRisqueAuxMouseAndHistoryGuard();
})();
