(function () {
  "use strict";

  var STYLE_ID = "risque-login-js-styles";

  function risqueLoginDoc(name) {
    if (typeof window.risqueResolveDocUrl === "function") {
      return window.risqueResolveDocUrl(name);
    }
    return name === "manual" ? "docs/manual.html" : name === "help" ? "docs/help.html" : "";
  }
  /** While phase is still login, mirror a flag so the public TV can fade to black in sync with the host login UI. */
  function pushPublicLoginFadeStartForMirror() {
    try {
      if (window.risqueDisplayIsPublic) return;
      if (window.gameState && String(window.gameState.phase || "") === "login") {
        window.gameState.risquePublicLoginHostFade = true;
        if (typeof window.risqueMirrorPushGameState === "function") {
          window.risqueMirrorPushGameState();
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  /** Before navigating away from login, push saved state without the fade flag so the TV can dissolve from black. */
  function mirrorPushGameStateBeforeLoginNavigate() {
    try {
      var raw = localStorage.getItem("gameState");
      if (!raw) return;
      var gsNav = JSON.parse(raw);
      delete gsNav.risquePublicLoginHostFade;
      window.gameState = gsNav;
      if (typeof window.risqueMirrorPushGameState === "function") {
        window.risqueMirrorPushGameState();
      }
    } catch (e) {
      /* ignore */
    }
  }

  function injectLegacyStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "#risque-login-overlay{position:fixed;inset:0;z-index:999999;margin:0;padding:0;background:#000;overflow:hidden;font-family:Arial,sans-serif;}" +
      "#risque-login-overlay *{box-sizing:border-box;}" +
      "#risque-login-overlay .risque-login-canvas{width:1920px;height:1080px;position:absolute;top:0;left:50%;transform-origin:top center;transform:translate(-50%,0);background:#000000;border:none;pointer-events:auto;opacity:1;display:block;will-change:transform;}" +
      "#risque-login-overlay .welcome-text{position:absolute;top:220px;left:960px;transform:translateX(-50%);font-size:48px;font-weight:bold;color:#00ff00;-webkit-text-stroke:1px #052e16;text-align:center;pointer-events:none;z-index:1;opacity:1;transition:opacity 2s ease;text-transform:uppercase;letter-spacing:.06em;}" +
      "#risque-login-overlay .welcome-text.fade-out{opacity:0;}" +
      "#risque-login-overlay .login-container{position:absolute;top:332px;left:960px;width:500px;transform:translateX(-50%);padding:10px;border:4px solid #000;background:#000;font-family:Arial,sans-serif;pointer-events:auto;z-index:2;opacity:1;transition:opacity 2s ease;}" +
      "#risque-login-overlay .login-container.fade-out{opacity:0;}" +
      "#risque-login-overlay .login-prompt{font-size:28px;font-weight:bold;color:#00ff00;text-align:center;margin-bottom:20px;text-transform:uppercase;letter-spacing:.05em;}" +
      "#risque-login-overlay .color-swatches{display:flex;justify-content:center;gap:5px;margin-bottom:10px;flex-wrap:wrap;padding:6px;box-sizing:border-box;border:1px solid #00ff00;border-radius:4px;background:#000000;}" +
      "#risque-login-overlay .color-swatch{width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;line-height:1.05;color:#fff;text-align:center;cursor:pointer;pointer-events:auto;border:none;border-radius:2px;padding:2px;box-sizing:border-box;}" +
      "#risque-login-overlay .color-swatch.active{filter:brightness(1.18);transform:scale(1.06);}" +
      "#risque-login-overlay .color-swatch.unavailable{opacity:0.3;cursor:default;pointer-events:none;}" +
      "#risque-login-overlay .color-swatch.blue{background:#87bfff;}" +
      "#risque-login-overlay .color-swatch.red{background:#ff0000;}" +
      "#risque-login-overlay .color-swatch.green{background:#008000;}" +
      "#risque-login-overlay .color-swatch.yellow{background:#ffff00;color:#000;}" +
      "#risque-login-overlay .color-swatch.black{background:#000000;color:#fff;border:1px solid #00ff00;}" +
      "#risque-login-overlay .color-swatch.pink{background:#ff69b4;color:#000;}" +
      "#risque-login-overlay .player-row{display:flex;align-items:center;margin-bottom:10px;}" +
      "#risque-login-overlay .player-row label{width:104px;color:#00ff00;font-size:16px;margin-right:10px;flex-shrink:0;font-weight:800;text-transform:uppercase;letter-spacing:.04em;text-align:center;white-space:nowrap;box-sizing:border-box;}" +
      "#risque-login-overlay .player-row input{flex:1;box-sizing:border-box;min-height:44px;height:44px;padding:2px 8px;font-size:22px;font-weight:800;line-height:1.05;letter-spacing:0.04em;text-transform:uppercase;border:1px solid #00ff00;border-radius:4px;background:#000000;color:#00ff00;caret-color:#00ff00;pointer-events:auto;min-width:0;}" +
      "#risque-login-overlay .color-field{width:40px;height:40px;margin-left:10px;border:1px solid #00ff00;border-radius:4px;background:#000000;cursor:pointer;pointer-events:auto;flex-shrink:0;box-sizing:border-box;}" +
      "#risque-login-overlay .login-button{display:block;width:200px;padding:10px;font-size:16px;font-weight:bold;border:2px solid #14532d;border-radius:4px;cursor:pointer;pointer-events:auto;z-index:3;background:#00ff00;color:#000;margin:10px auto 0;transition:opacity 2s ease;text-transform:uppercase;}" +
      "#risque-login-overlay .login-button:hover{background:#00cc00;border-color:#166534;}" +
      "#risque-login-overlay .load-button{display:block;width:200px;padding:10px;font-size:16px;font-weight:bold;border:2px solid #854d0e;border-radius:4px;cursor:pointer;pointer-events:auto;z-index:3;background:#eab308;color:#000;margin:10px auto 0;transition:opacity 2s ease;text-transform:uppercase;}" +
      "#risque-login-overlay .login-button.fade-out,#risque-login-overlay .load-button.fade-out,#risque-login-overlay .risque-login-random-order.fade-out,#risque-login-overlay .risque-login-preset-slot.fade-out{opacity:0;}" +
      "#risque-login-overlay .login-docs-row{display:flex;justify-content:center;gap:10px;margin-top:6px;margin-bottom:2px;flex-wrap:wrap;}" +
      "#risque-login-overlay .login-doc-button{flex:1;min-width:120px;max-width:200px;padding:8px 10px;font-size:13px;font-weight:bold;border:2px solid #14532d;border-radius:4px;cursor:pointer;pointer-events:auto;background:#00ff00;color:#000;transition:opacity 2s ease,background .15s;text-transform:uppercase;}" +
      "#risque-login-overlay .login-doc-button:hover{background:#00cc00;border-color:#166534;}" +
      "#risque-login-overlay .login-doc-button.fade-out{opacity:0;}" +
      ".risque-login-center-move{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1000001;min-width:360px;max-width:min(82vw,520px);padding:14px 16px;border:3px solid #facc15;border-radius:10px;background:#111827;color:#f8fafc;font-weight:900;font-size:18px;letter-spacing:.02em;text-transform:uppercase;cursor:pointer;box-shadow:0 0 0 2px rgba(0,0,0,.45),0 10px 28px rgba(0,0,0,.45);}" +
      ".risque-login-center-move:hover{background:#1f2937;border-color:#fde047;}" +
      "#risque-login-overlay #login-js-error{color:#ff6b6b;text-align:center;margin-top:8px;font-size:14px;min-height:20px;}" +
      "#risque-login-overlay #load-game-input-js{display:none;}" +
      "#risque-login-overlay .risque-login-preset-bar{display:grid;grid-template-columns:repeat(6,minmax(0,1fr)) minmax(0,min(140px,34%));gap:4px;width:100%;max-width:520px;margin:10px auto 0;align-items:stretch;box-sizing:border-box;}" +
      "#risque-login-overlay .risque-login-preset-slot{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:48px;padding:4px 2px;border:2px solid #14532d;border-radius:6px;cursor:pointer;background:#00ff00;color:#000;font-family:Arial,sans-serif;font-weight:900;text-transform:uppercase;transition:background .15s ease,border-color .15s ease;user-select:none;-webkit-user-select:none;touch-action:manipulation;}" +
      "#risque-login-overlay .risque-login-preset-slot:hover{background:#00cc00;border-color:#166534;}" +
      "#risque-login-overlay .risque-login-preset-slot-line{display:block;font-size:9px;letter-spacing:.04em;line-height:1.1;}" +
      "#risque-login-overlay .risque-login-preset-slot-num{display:block;font-size:14px;font-weight:900;line-height:1.1;margin-top:1px;}" +
      "#risque-login-overlay .risque-login-random-order--bar{display:flex;align-items:center;justify-content:center;min-height:48px;padding:4px 6px;border:2px solid #14532d;border-radius:6px;cursor:pointer;background:#00ff00;color:#000;font-family:Arial,sans-serif;font-weight:800;font-size:11px;line-height:1.15;text-align:center;text-transform:uppercase;transition:background .15s ease,border-color .15s ease;}" +
      "#risque-login-overlay .risque-login-random-order--bar:hover{background:#00cc00;border-color:#166534;}" +
      "#risque-login-overlay .risque-login-easy-hint{margin-top:10px;margin-bottom:0;font-size:12px;line-height:1.35;color:#94a3b8;text-align:center;max-width:100%;}";
    document.head.appendChild(s);
  }

  function shuffleArray(array) {
    var arr = array.slice();
    for (var i = arr.length - 1; i > 0; i -= 1) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function deckList() {
    return [
      "afghanistan", "alaska", "alberta", "argentina", "brazil", "central_america",
      "china", "congo", "east_africa", "eastern_australia", "eastern_united_states",
      "egypt", "great_britain", "greenland", "iceland", "india", "indonesia",
      "irkutsk", "japan", "kamchatka", "madagascar", "middle_east", "mongolia",
      "new_guinea", "north_africa", "northern_europe", "northwest_territory",
      "ontario", "peru", "quebec", "scandinavia", "siam", "siberia",
      "south_africa", "southern_europe", "ukraine", "ural", "venezuela",
      "western_australia", "western_europe", "western_united_states", "yakutsk",
      "wildcard1", "wildcard2"
    ];
  }

  function buildGameStateFromRows(filledRows) {
    var n = filledRows.length;
    return {
      phase: "playerSelect",
      setupComplete: false,
      risqueHostHudStatsColumnRetired: false,
      selectionPhase: "firstCard",
      players: filledRows.map(function (row, index) {
        return {
          name: row.name,
          color: row.color,
          playerOrder: index + 1,
          bookValue: 0,
          continentValues: {},
          bankValue: n === 2 ? 40 : n === 3 ? 35 : n === 4 ? 30 : n === 5 ? 25 : 20,
          cardCount: 0,
          cards: [],
          territories: [],
          troopsTotal: 0,
          confirmed: false
        };
      }),
      turnOrder: filledRows.map(function (r) { return r.name; }),
      currentPlayer: filledRows.length ? filledRows[0].name : null,
      round: 1,
      aerialAttack: false,
      aerialAttackEligible: false,
      aerialBridge: null,
      conquered: false,
      deck: shuffleArray(deckList()),
      isInitialDeploy: true,
      continents: {
        south_america: { bonus: 2 },
        north_america: { bonus: 5 },
        africa: { bonus: 3 },
        europe: { bonus: 5 },
        asia: { bonus: 7 },
        australia: { bonus: 2 }
      },
      continentCollectionCounts: {
        south_america: 0,
        north_america: 0,
        africa: 0,
        europe: 0,
        asia: 0,
        australia: 0
      },
      cardplayConquered: false,
      cardEarnedViaAttack: false,
      cardEarnedViaCardplay: false,
      cardAwardedThisTurn: false,
      lastCardDrawn: null,
      risquePlayedCardsGallery: [],
      risqueLuckyLedger: { byPlayer: {} },
      /* All player names for the session (survivors-only lists drop eliminated players postgame). */
      risqueLuckySessionRoster: filledRows.map(function (r) {
        return r.name;
      })
    };
  }

  var DEFAULT_IMPORT_PLAYER_COLORS = ["blue", "red", "yellow", "green", "pink", "black"];

  /**
   * Raw JSON may be wrapped ({ gameState: {...} }) or omit player.color / use a non-array territories.
   * Mutates the loaded object in place. Returns the gameState root or null if unusable.
   */
  function normalizeImportedGameState(parsed) {
    if (parsed == null || typeof parsed !== "object") return null;
    var gs = parsed;
    if (
      parsed.gameState &&
      typeof parsed.gameState === "object" &&
      !Array.isArray(parsed.gameState)
    ) {
      gs = parsed.gameState;
    }
    if (!gs.players || !Array.isArray(gs.players) || gs.players.length < 2) return null;
    var i;
    for (i = 0; i < gs.players.length; i++) {
      var p = gs.players[i];
      if (!p || typeof p !== "object") return null;
      if (!p.name || String(p.name).trim() === "") return null;
      if (!p.color || String(p.color).trim() === "") {
        p.color = DEFAULT_IMPORT_PLAYER_COLORS[i % DEFAULT_IMPORT_PLAYER_COLORS.length];
      }
      if (!Array.isArray(p.territories)) {
        p.territories = [];
      }
    }
    return gs;
  }

  function validateLoadedGameState(gameState) {
    if (
      !gameState ||
      !gameState.players ||
      !gameState.players.length ||
      !gameState.players.every(function (p) {
        return p.name && p.color && Array.isArray(p.territories);
      })
    ) {
      return false;
    }
    if (gameState.players.length >= 2) return true;
    /* Session finalize (game-final.json) often keeps only the winner; roster proves a multi-player game. */
    if (gameState.players.length === 1) {
      var ro = gameState.risqueLuckySessionRoster;
      if (Array.isArray(ro) && ro.length >= 2) return true;
      if (String(gameState.phase || "") === "postgame") return true;
    }
    return false;
  }

  function fixResumePhase(gameState, log) {
    if (gameState.phase === "getcard" || gameState.phase === "receivecard") {
      var currentIndex = gameState.turnOrder.indexOf(gameState.currentPlayer);
      if (currentIndex === -1) {
        if (log) log("Current player not in turn order");
        return false;
      }
      var nextIndex = (currentIndex + 1) % gameState.turnOrder.length;
      gameState.currentPlayer = gameState.turnOrder[nextIndex];
      if (window.gameUtils && typeof window.gameUtils.clearContinentalConquestRoutingOnTurnAdvance === "function") {
        window.gameUtils.clearContinentalConquestRoutingOnTurnAdvance(gameState);
      }
      if (nextIndex === 0) {
        gameState.round = (gameState.round || 1) + 1;
      }
      gameState.phase = "cardplay";
    }
    return true;
  }

  function logLogin(message, data) {
    var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var logEntry = "[" + ts + "] [LoginJS] " + message;
    console.log(logEntry, data || "");
    try {
      var logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
      if (!Array.isArray(logs)) logs = [];
      logs.push(logEntry);
      if (data) logs.push(JSON.stringify(data, null, 2));
      localStorage.setItem("gameLogs", JSON.stringify(logs));
    } catch (e) {
      console.warn("Login log write skipped", e);
    }
  }

  function wirePublicWindowMoveHelper(root, elError, onLog) {
    if (!root) return;
    var btns = root.querySelectorAll(".login-monitor-move-btn");
    if (!btns || !btns.length) return;
    if (window.risqueDisplayIsPublic) {
      Array.prototype.forEach.call(btns, function (b) {
        b.style.display = "none";
      });
      return;
    }
    Array.prototype.forEach.call(btns, function (monitorBtn) {
      monitorBtn.addEventListener("click", function () {
        try {
          if (typeof window.risqueOpenPublicDisplayWindow === "function") {
            window.risqueOpenPublicDisplayWindow();
          } else {
            var u = new URL("game.html", window.location.href);
            u.searchParams.set("display", "public");
            u.searchParams.set("tvBootstrap", "1");
            var pubW = window.open(u.href, "risquePublicBoard", "noopener,noreferrer");
            try {
              if (pubW && !pubW.closed) window.__risquePublicBoardWindow = pubW;
            } catch (ePubW) {}
          }
        } catch (eOpen) {
          /* ignore */
        }
        if (elError) {
          elError.textContent =
            "Public window helper: click the public window, then press Win+Shift+Right (or Win+Shift+Left).";
        }
        if (typeof onLog === "function") {
          onLog("Public window move helper shown");
        }
      });
    });
  }

  function resizeLoginCanvas(overlay) {
    if (!overlay) return;
    var wrap = overlay.querySelector(".risque-login-canvas");
    if (!wrap) return;
    var scale = Math.min(window.innerHeight / 1080, window.innerWidth / 1920);
    wrap.style.transform = "translate(-50%, 0) scale(" + scale + ")";
  }

  var LAST_LOGIN_NAMES_KEY = "risqueLoginLastNames";
  /** Car-radio user presets: { "0": [{name,color},...], ... } — merged with built-ins when absent. */
  var LOGIN_RADIO_PRESETS_KEY = "risqueLoginRadioPresetsV1";
  var userPresetsMapLoaded = false;
  var userPresetsMap = {};

  function ensureUserPresetsMapLoaded() {
    if (userPresetsMapLoaded) return;
    userPresetsMapLoaded = true;
    try {
      var raw = localStorage.getItem(LOGIN_RADIO_PRESETS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === "object" && !Array.isArray(p)) {
          userPresetsMap = p;
        }
      }
    } catch (e) {
      userPresetsMap = {};
    }
  }

  function persistUserPresetsMap() {
    try {
      localStorage.setItem(LOGIN_RADIO_PRESETS_KEY, JSON.stringify(userPresetsMap));
    } catch (e) {
      /* ignore quota */
    }
  }

  /** Current lineup from the form (name + color); only complete rows. */
  function readFilledPlayerRows(root) {
    var out = [];
    Array.prototype.forEach.call(root.querySelectorAll(".player-row"), function (row) {
      var input = row.querySelector("input");
      var colorField = row.querySelector(".color-field");
      if (!input || !colorField) return;
      var name = input.value.trim().toUpperCase();
      var color = colorField.dataset.color;
      if (name && color) out.push({ name: name, color: color });
    });
    return out;
  }

  function getPresetRowsEffective(index) {
    ensureUserPresetsMapLoaded();
    var custom = userPresetsMap[String(index)];
    if (custom && Array.isArray(custom) && custom.length > 0) {
      return custom.map(function (r) {
        return {
          name: String(r.name || "").toUpperCase(),
          color: String(r.color || "").trim()
        };
      });
    }
    return PRESET_PLAYERS_LIST[index] ? PRESET_PLAYERS_LIST[index].slice() : [];
  }

  function presetRowsSummary(rows) {
    return rows
      .map(function (r) {
        return r.name + " (" + r.color + ")";
      })
      .join(", ");
  }

  function presetSlotTitleText(presetIndex, rows) {
    var summary = presetRowsSummary(rows);
    var hint =
      "Click: load preset · Right-click (confirm) or hold 3s: save current lineup · ";
    return hint + (summary || "Built-in preset " + (presetIndex + 1));
  }

  function updatePresetButtonTitle(root, presetIndex) {
    var btn = root.querySelector(
      '.risque-login-preset-slot[data-preset-index="' + presetIndex + '"]'
    );
    if (!btn) return;
    var rows = getPresetRowsEffective(presetIndex);
    btn.setAttribute("title", presetSlotTitleText(presetIndex, rows));
  }

  function refreshAllPresetButtonTitles(root) {
    for (var p = 0; p < 6; p += 1) {
      updatePresetButtonTitle(root, p);
    }
  }

  function validateRowsForPresetSave(rows) {
    if (!rows.length) return "Add at least one player with name and color to save this preset.";
    var names = rows.map(function (x) {
      return x.name;
    });
    var colors = rows.map(function (x) {
      return x.color;
    });
    if (new Set(names).size !== names.length) return "Fix duplicate names before saving a preset.";
    if (new Set(colors).size !== colors.length)
      return "Each player needs a unique color to save a preset.";
    return "";
  }

  function trySavePresetToSlot(root, presetIndex, onLog, elError, how) {
    ensureUserPresetsMapLoaded();
    var rows = readFilledPlayerRows(root);
    var err = validateRowsForPresetSave(rows);
    if (err) {
      if (elError) elError.textContent = err;
      if (typeof onLog === "function") onLog("Preset save failed: " + err);
      return;
    }
    if (how === "menu") {
      if (
        !window.confirm(
          "Save the current " +
            rows.length +
            " player(s) as Preset " +
            (presetIndex + 1) +
            "?"
        )
      ) {
        return;
      }
    }
    userPresetsMap[String(presetIndex)] = rows.map(function (r) {
      return { name: r.name, color: r.color };
    });
    persistUserPresetsMap();
    updatePresetButtonTitle(root, presetIndex);
    if (elError) elError.textContent = "";
    var via = how === "hold" ? " (held 3s)" : how === "menu" ? " (right-click)" : "";
    if (typeof onLog === "function") {
      onLog("Saved preset " + (presetIndex + 1) + ": " + rows.length + " players" + via);
    }
  }

  function attachCarRadioPresetControls(root, onLog, elError, onAfterApplyPreset) {
    if (window.risqueDisplayIsPublic) return;
    var LONG_MS = 3000;
    Array.prototype.forEach.call(root.querySelectorAll(".risque-login-preset-slot"), function (btn) {
      var idx = parseInt(btn.getAttribute("data-preset-index"), 10);
      if (isNaN(idx) || idx < 0 || idx > 5) return;
      var longTimer = null;

      btn.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        trySavePresetToSlot(root, idx, onLog, elError, "menu");
      });

      function clearLong() {
        if (longTimer) {
          clearTimeout(longTimer);
          longTimer = null;
        }
      }

      function onPointerDown(e) {
        if (e.type === "mousedown" && e.button !== 0) return;
        clearLong();
        longTimer = setTimeout(function () {
          longTimer = null;
          trySavePresetToSlot(root, idx, onLog, elError, "hold");
          btn._risquePresetIgnoreClickUntil = Date.now() + 700;
        }, LONG_MS);
      }

      function onPointerUp() {
        clearLong();
      }

      btn.addEventListener("mousedown", onPointerDown);
      btn.addEventListener("touchstart", onPointerDown, { passive: true });
      btn.addEventListener("mouseup", onPointerUp);
      btn.addEventListener("mouseleave", onPointerUp);
      btn.addEventListener("touchend", onPointerUp);
      btn.addEventListener("touchcancel", onPointerUp);

      btn.addEventListener("click", function (e) {
        if (btn._risquePresetIgnoreClickUntil && Date.now() < btn._risquePresetIgnoreClickUntil) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (elError) elError.textContent = "";
        if (isNaN(idx) || idx < 0 || idx >= PRESET_PLAYERS_LIST.length) return;
        applyPresetSlot(root, idx, onLog);
        if (typeof onAfterApplyPreset === "function") onAfterApplyPreset();
      });
    });
  }

  /** Preset 1: four players; slots 5–6 empty. */
  var PRESET_ONE_PLAYERS = [
    { name: "Guido", color: "blue" },
    { name: "Mickey", color: "red" },
    { name: "Karl", color: "pink" },
    { name: "Nooch", color: "yellow" }
  ];

  /** Six roster shortcuts — index 0 = Preset 1 button, … index 5 = Preset 6. */
  var PRESET_PLAYERS_LIST = [
    PRESET_ONE_PLAYERS,
    [
      { name: "Ace", color: "blue" },
      { name: "Ben", color: "red" },
      { name: "Cal", color: "pink" },
      { name: "Don", color: "yellow" }
    ],
    [
      { name: "Eli", color: "blue" },
      { name: "Fay", color: "red" },
      { name: "Gus", color: "green" },
      { name: "Hal", color: "yellow" }
    ],
    [
      { name: "Ivy", color: "blue" },
      { name: "Jay", color: "red" },
      { name: "Kim", color: "pink" },
      { name: "Lee", color: "black" }
    ],
    [
      { name: "Mo", color: "blue" },
      { name: "Ned", color: "red" },
      { name: "Ola", color: "pink" },
      { name: "Pat", color: "yellow" }
    ],
    [
      { name: "Quin", color: "blue" },
      { name: "Rex", color: "red" },
      { name: "Sid", color: "yellow" },
      { name: "Tom", color: "green" },
      { name: "Uma", color: "pink" },
      { name: "Vic", color: "black" }
    ]
  ];

  function resetLoginFormState(root) {
    Array.prototype.forEach.call(root.querySelectorAll(".color-swatch"), function (sw) {
      sw.classList.add("active");
      sw.classList.remove("unavailable");
    });
    Array.prototype.forEach.call(root.querySelectorAll(".player-row"), function (row) {
      var input = row.querySelector("input");
      var cf = row.querySelector(".color-field");
      if (input) input.value = "";
      if (cf) {
        cf.style.background = "#000000";
        cf.dataset.color = "";
      }
    });
  }

  function applyFilledRowsInOrder(root, pairs, onLog, logMsg) {
    resetLoginFormState(root);
    var allRows = root.querySelectorAll(".player-row");
    for (var i = 0; i < pairs.length; i += 1) {
      var entry = pairs[i];
      if (i >= allRows.length) break;
      var row = allRows[i];
      var input = row.querySelector("input");
      var colorField = row.querySelector(".color-field");
      var swatch = root.querySelector('.color-swatch[data-color="' + entry.color + '"]');
      if (!input || !colorField || !swatch) continue;
      input.value = String(entry.name || "").toUpperCase();
      colorField.style.background = window.getComputedStyle(swatch).backgroundColor;
      colorField.dataset.color = entry.color;
      swatch.classList.remove("active");
      swatch.classList.add("unavailable");
    }
    if (typeof onLog === "function" && logMsg) {
      onLog(logMsg);
    }
  }

  function applyPlayerPreset(root, presetRows, onLog, logMsg) {
    applyFilledRowsInOrder(
      root,
      presetRows,
      onLog,
      logMsg != null ? logMsg : "Applied preset"
    );
  }

  function applyPresetSlot(root, presetIndex, onLog) {
    var rows = getPresetRowsEffective(presetIndex);
    if (!rows || !rows.length) return;
    applyPlayerPreset(
      root,
      rows,
      onLog,
      "Applied preset " + (presetIndex + 1) + " (" + rows.length + " players)"
    );
  }

  function buildLoginFormMirrorPayload(root) {
    var rows = [];
    var allRows = root.querySelectorAll(".player-row");
    for (var i = 0; i < allRows.length; i += 1) {
      var row = allRows[i];
      var input = row.querySelector("input");
      var colorField = row.querySelector(".color-field");
      rows.push({
        name: input ? String(input.value || "").trim().toUpperCase() : "",
        color: colorField && colorField.dataset.color ? String(colorField.dataset.color) : ""
      });
    }
    return { rows: rows, v: 1 };
  }

  function applyRowsToLoginHud(root, rows) {
    if (!root || !Array.isArray(rows)) return;
    resetLoginFormState(root);
    var allRows = root.querySelectorAll(".player-row");
    for (var i = 0; i < allRows.length; i += 1) {
      var row = allRows[i];
      var input = row.querySelector("input");
      var colorField = row.querySelector(".color-field");
      var entry = rows[i];
      if (!entry) {
        if (input) input.value = "";
        if (colorField) {
          colorField.style.background = "#000000";
          colorField.dataset.color = "";
        }
        continue;
      }
      var name = String(entry.name || "").trim().toUpperCase();
      var color = String(entry.color || "").trim();
      if (input) input.value = name;
      if (color && colorField) {
        var swatch = root.querySelector('.color-swatch[data-color="' + color + '"]');
        if (swatch) {
          colorField.style.background = window.getComputedStyle(swatch).backgroundColor;
          colorField.dataset.color = color;
          swatch.classList.remove("active");
          swatch.classList.add("unavailable");
        }
      } else if (colorField) {
        colorField.style.background = "#000000";
        colorField.dataset.color = "";
      }
    }
  }

  function applyPublicLoginFormMirror(gs) {
    if (!gs || !gs.risquePublicLoginFormMirror || !Array.isArray(gs.risquePublicLoginFormMirror.rows)) {
      return;
    }
    var root = document.getElementById("risque-login-hud-root");
    if (!root) return;
    applyRowsToLoginHud(root, gs.risquePublicLoginFormMirror.rows);
  }

  function configurePublicLoginHudSpectator(formRoot) {
    formRoot.classList.add("risque-login-hud--public-spectator");
    Array.prototype.forEach.call(formRoot.querySelectorAll(".player-row input"), function (inp) {
      inp.readOnly = true;
      inp.tabIndex = -1;
    });
    Array.prototype.forEach.call(formRoot.querySelectorAll(".color-swatch"), function (sw) {
      sw.style.pointerEvents = "none";
    });
    Array.prototype.forEach.call(formRoot.querySelectorAll(".color-field"), function (cf) {
      cf.style.pointerEvents = "none";
    });
    var loginBtn = formRoot.querySelector("#login-button-js");
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "LOG IN ON HOST";
      loginBtn.title = "Sign in using the host computer";
    }
    Array.prototype.forEach.call(formRoot.querySelectorAll(".risque-login-preset-slot"), function (presetBtn) {
      presetBtn.disabled = true;
      presetBtn.title = "Presets are applied on the host computer";
    });
    var randomOrderBtn = formRoot.querySelector("#risque-login-random-order");
    if (randomOrderBtn) {
      randomOrderBtn.disabled = true;
      randomOrderBtn.title = "Turn order is set on the host computer";
    }
  }

  function buildPlayerFormHtml() {
    var html = "";
    for (var i = 1; i <= 6; i += 1) {
      html +=
        "<div class=\"player-row\">" +
        "<label for=\"name-" + i + "\">Player " + i + ":</label>" +
        "<input type=\"text\" id=\"name-" + i + "\" name=\"risque-player-" + i + "\" " +
        "placeholder=\"Enter name\" aria-label=\"Player " + i + " name\" />" +
        "<div class=\"color-field\" id=\"color-field-" + i + "\" data-color=\"\"></div>" +
        "</div>";
    }
    return html;
  }

  function escapeHtmlAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function buildLoginPresetBarHtml() {
    ensureUserPresetsMapLoaded();
    var parts = [];
    for (var p = 0; p < 6; p += 1) {
      var rows = getPresetRowsEffective(p);
      var titleText = presetSlotTitleText(p, rows);
      parts.push(
        "<button type=\"button\" class=\"risque-login-preset-slot\" data-preset-index=\"" +
          p +
          "\" title=\"" +
          escapeHtmlAttr(titleText) +
          "\">" +
          "<span class=\"risque-login-preset-slot-line\">Preset</span>" +
          "<span class=\"risque-login-preset-slot-num\">" +
          (p + 1) +
          "</span>" +
          "</button>"
      );
    }
    parts.push(
      "<button type=\"button\" class=\"risque-login-random-order risque-login-random-order--bar\" id=\"risque-login-random-order\" title=\"Shuffle who goes first — names keep their colors. Click again for another order.\">" +
        "Random player turn" +
        "</button>"
    );
    return "<div class=\"risque-login-preset-bar\">" + parts.join("") + "</div>";
  }

  function restoreSavedPlayerNames(overlay) {
    try {
      var raw = localStorage.getItem(LAST_LOGIN_NAMES_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      for (var i = 0; i < arr.length && i < 6; i += 1) {
        var inp = overlay.querySelector("#name-" + (i + 1));
        if (inp && typeof arr[i] === "string" && arr[i]) {
          inp.value = String(arr[i]).toUpperCase();
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * game.html: map (stage.png) on the left; login form in runtime HUD phase slot on the right.
   */
  function mountLoginHud(uiOverlay, opts) {
    opts = opts || {};
    var legacyNext = opts.legacyNext || "game.html?phase=playerSelect&selectKind=firstCard";
    var loadRedirect =
      opts.loadRedirect || "game.html?phase=cardplay&legacyNext=income.html";
    var onLog = opts.onLog || logLogin;
    var onLoginSuccess = opts.onLoginSuccess;
    var onLoadSuccess = opts.onLoadSuccess;
    var skipPersist = !!opts.skipPersist;
    var skipFixResumePhase = !!opts.skipFixResumePhase;
    var redirectDelayMs = opts.loginRedirectDelayMs != null ? opts.loginRedirectDelayMs : 2000;
    var welcomeTextContent = opts.welcomeText != null ? opts.welcomeText : "WELCOME TO RISQUE";
    var loginPromptContent = opts.loginPrompt != null ? opts.loginPrompt : "INPUT PLAYER NAME AND CHOOSE COLOR";
    var manualUrl = opts.manualUrl != null ? opts.manualUrl : risqueLoginDoc("manual");
    var helpUrl = opts.helpUrl != null ? opts.helpUrl : risqueLoginDoc("help");

    var existing = document.getElementById("risque-login-overlay");
    if (existing) existing.remove();

    /* game-shell refreshVisuals defers ensureLogin in rAF; mount runs first — create HUD shell here */
    if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.ensureLogin === "function") {
      window.risqueRuntimeHud.ensureLogin(uiOverlay);
    }

    var slot = uiOverlay.querySelector("#risque-phase-content") || document.getElementById("risque-phase-content");
    if (!slot) {
      onLog("Login HUD: no phase slot");
      return;
    }

    slot.innerHTML =
      "<div id=\"risque-login-hud-root\" class=\"risque-login-compact-root\">" +
      "<div class=\"risque-login-compact-welcome\"></div>" +
      "<div class=\"risque-login-compact-prompt\"></div>" +
      "<div class=\"color-swatches\">" +
      "<div class=\"color-swatch blue active\" data-color=\"blue\">Bl</div>" +
      "<div class=\"color-swatch red active\" data-color=\"red\">Rd</div>" +
      "<div class=\"color-swatch yellow active\" data-color=\"yellow\">Yl</div>" +
      "<div class=\"color-swatch green active\" data-color=\"green\">Gr</div>" +
      "<div class=\"color-swatch pink active\" data-color=\"pink\">Pk</div>" +
      "<div class=\"color-swatch black active\" data-color=\"black\">Bk</div>" +
      "</div>" +
      "<div id=\"player-form-js\">" + buildPlayerFormHtml() + "</div>" +
      "<div id=\"login-js-error-hud\"></div>" +
      "<div class=\"risque-login-primary-footer\">" +
      "<button type=\"button\" class=\"login-button\" id=\"login-button-js\">LOG IN</button>" +
      buildLoginPresetBarHtml() +
      "</div>" +
      "</div>";

    var formRoot = document.getElementById("risque-login-hud-root");
    if (!formRoot) return;

    var welcomeTextEl = formRoot.querySelector(".risque-login-compact-welcome");
    var loginPromptEl = formRoot.querySelector(".risque-login-compact-prompt");
    if (welcomeTextEl) welcomeTextEl.textContent = welcomeTextContent;
    if (loginPromptEl) loginPromptEl.textContent = loginPromptContent;
    restoreSavedPlayerNames(formRoot);

    var initialLoginFormMirror = opts.initialLoginFormMirror;
    var loginMirrorSyncT = null;
    function scheduleLoginMirrorPush() {
      if (window.risqueDisplayIsPublic) return;
      if (loginMirrorSyncT) clearTimeout(loginMirrorSyncT);
      loginMirrorSyncT = setTimeout(function () {
        if (!window.gameState || String(window.gameState.phase || "") !== "login") return;
        window.gameState.risquePublicLoginFormMirror = buildLoginFormMirrorPayload(formRoot);
        if (typeof window.risqueMirrorPushGameState === "function") {
          window.risqueMirrorPushGameState();
        }
      }, 160);
    }

    function getTargetRow() {
      var rows = formRoot.querySelectorAll(".player-row");
      for (var r = 0; r < rows.length; r += 1) {
        var row = rows[r];
        var input = row.querySelector("input");
        var colorField = row.querySelector(".color-field");
        if (input.value.trim() !== "" && colorField.dataset.color === "") {
          return row;
        }
      }
      return null;
    }

    if (!window.risqueDisplayIsPublic) {
      Array.prototype.forEach.call(formRoot.querySelectorAll(".color-swatch"), function (swatch) {
        swatch.addEventListener("click", function () {
          if (!swatch.classList.contains("active")) {
            onLog("Color swatch " + swatch.dataset.color + " clicked but not active");
            return;
          }
          var row = getTargetRow();
          if (!row) {
            onLog("No valid row for color selection");
            return;
          }
          var color = swatch.dataset.color;
          var colorField = row.querySelector(".color-field");
          colorField.style.background = window.getComputedStyle(swatch).backgroundColor;
          colorField.dataset.color = color;
          swatch.classList.remove("active");
          swatch.classList.add("unavailable");
          onLog("Player color: " + color);
          scheduleLoginMirrorPush();
        });
      });

      Array.prototype.forEach.call(formRoot.querySelectorAll(".color-field"), function (field) {
        field.addEventListener("click", function () {
          var color = field.dataset.color;
          if (!color) return;
          var swatch = formRoot.querySelector(".color-swatch[data-color=\"" + color + "\"]");
          field.style.background = "#000000";
          field.dataset.color = "";
          if (swatch) {
            swatch.classList.remove("unavailable");
            swatch.classList.add("active");
          }
          onLog("Color cleared for row");
          scheduleLoginMirrorPush();
        });
      });

      Array.prototype.forEach.call(formRoot.querySelectorAll(".player-row input"), function (inp) {
        inp.addEventListener("input", scheduleLoginMirrorPush);
        inp.addEventListener("change", scheduleLoginMirrorPush);
      });
      requestAnimationFrame(function () {
        requestAnimationFrame(scheduleLoginMirrorPush);
      });
    } else {
      configurePublicLoginHudSpectator(formRoot);
      if (initialLoginFormMirror && Array.isArray(initialLoginFormMirror.rows)) {
        applyRowsToLoginHud(formRoot, initialLoginFormMirror.rows);
      }
    }

    function readFilledRows() {
      return readFilledPlayerRows(formRoot);
    }

    var elError = formRoot.querySelector("#login-js-error-hud");
    var welcomeText = formRoot.querySelector(".risque-login-compact-welcome");
    var loginButton = formRoot.querySelector("#login-button-js");
    if (opts.loginButtonLabel && loginButton) {
      loginButton.textContent = opts.loginButtonLabel;
    }

    function onResizeHud() {
      if (window.gameUtils && typeof window.gameUtils.resizeCanvas === "function") {
        window.gameUtils.resizeCanvas();
      }
      if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.syncPosition === "function") {
        window.risqueRuntimeHud.syncPosition();
      }
    }

    attachCarRadioPresetControls(formRoot, onLog, elError, scheduleLoginMirrorPush);

    var randomOrderBtn = formRoot.querySelector("#risque-login-random-order");
    if (randomOrderBtn && !window.risqueDisplayIsPublic) {
      randomOrderBtn.addEventListener("click", function () {
        if (elError) elError.textContent = "";
        var filled = readFilledRows();
        if (filled.length < 2) {
          if (elError) {
            elError.textContent = "Enter at least two players with names and colors to shuffle turn order.";
          }
          onLog("Random order: need 2+ filled rows");
          return;
        }
        var names = filled.map(function (x) { return x.name; });
        var colors = filled.map(function (x) { return x.color; });
        if (new Set(names).size !== names.length) {
          if (elError) elError.textContent = "Fix duplicate names before shuffling order.";
          return;
        }
        if (new Set(colors).size !== colors.length) {
          if (elError) elError.textContent = "Colors must be unique before shuffling order.";
          return;
        }
        var shuffled = shuffleArray(filled);
        applyFilledRowsInOrder(formRoot, shuffled, onLog, "Shuffled turn order (names kept with colors)");
        scheduleLoginMirrorPush();
      });
    }

    if (loginButton) {
      loginButton.addEventListener("click", function () {
        if (elError) elError.textContent = "";
        var filled = readFilledRows();
        if (filled.length < 2) {
          if (elError) elError.textContent = "At least two players with name and color required.";
          onLog("Login failed: need 2+ players");
          return;
        }
        var names = filled.map(function (x) { return x.name; });
        var colors = filled.map(function (x) { return x.color; });
        if (new Set(names).size !== names.length) {
          if (elError) elError.textContent = "Duplicate names.";
          onLog("Login failed: duplicate names");
          return;
        }
        if (new Set(colors).size !== colors.length) {
          if (elError) elError.textContent = "Colors must be unique.";
          onLog("Login failed: colors not unique");
          return;
        }
        pushPublicLoginFadeStartForMirror();
        var gs = buildGameStateFromRows(filled);
        if (typeof window.risqueReplayClearTapeSidecar === "function") {
          window.risqueReplayClearTapeSidecar();
        }
        if (typeof window.risqueSessionDiskInvalidateCache === "function") {
          window.risqueSessionDiskInvalidateCache();
        }
        if (typeof window.risqueClearStoredSessionForNewGame === "function") {
          window.risqueClearStoredSessionForNewGame();
        }
        if (!skipPersist) {
          try {
            localStorage.setItem("gameState", JSON.stringify(gs));
          } catch (eLs) {
            if (elError) {
              elError.textContent =
                "Could not save roster (browser storage full or blocked). Free space or clear site data, then try again.";
            }
            onLog("Login failed: localStorage " + (eLs && eLs.message ? eLs.message : String(eLs)));
            return;
          }
        }
        if (typeof window.risqueHostReplaceShellGameState === "function") {
          window.risqueHostReplaceShellGameState(gs);
        }
        persistLastPlayerNames(filled);
        onLog("Login OK, redirecting to " + legacyNext, { players: names });
        if (welcomeText) welcomeText.classList.add("fade-out");
        loginButton.classList.add("fade-out");
        Array.prototype.forEach.call(formRoot.querySelectorAll(".risque-login-preset-slot"), function (b) {
          b.classList.add("fade-out");
        });
        if (randomOrderBtn) randomOrderBtn.classList.add("fade-out");
        formRoot.classList.add("fade-out");
        window.removeEventListener("resize", onResizeHud);
        setTimeout(function () {
          if (typeof onLoginSuccess === "function") {
            mirrorPushGameStateBeforeLoginNavigate();
            onLoginSuccess(gs);
            return;
          }
          mirrorPushGameStateBeforeLoginNavigate();
          if (window.risqueNavigateWithFade) {
            window.risqueNavigateWithFade(legacyNext);
          } else {
            window.location.href = legacyNext;
          }
        }, redirectDelayMs);
      });
    }

    window.addEventListener("resize", onResizeHud);
    requestAnimationFrame(function () {
      onResizeHud();
      setTimeout(onResizeHud, 100);
    });
  }

  function persistLastPlayerNames(filledRows) {
    try {
      localStorage.setItem(LAST_LOGIN_NAMES_KEY, JSON.stringify(filledRows.map(function (r) { return r.name; })));
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Mock Game Maker: same login form as the overlay, but rendered inside a host element (HUD strip).
   * No full-screen canvas; no delayed redirect when onLoginSuccess / onLoadSuccess is provided.
   */
  function mountEmbeddedLogin(host, opts) {
    opts = opts || {};
    if (!host) return;
    injectLegacyStyles();
    var existing = document.getElementById("risque-login-overlay");
    if (existing) existing.remove();
    var legacyNext = opts.legacyNext || "game.html?phase=playerSelect&selectKind=firstCard";
    var loadRedirect =
      opts.loadRedirect || "game.html?phase=cardplay&legacyNext=income.html";
    var onLog = opts.onLog || logLogin;
    var onLoginSuccess = opts.onLoginSuccess;
    var onLoadSuccess = opts.onLoadSuccess;
    var skipPersist = !!opts.skipPersist;
    var skipFixResumePhase = !!opts.skipFixResumePhase;
    var manualUrl = opts.manualUrl != null ? opts.manualUrl : risqueLoginDoc("manual");
    var helpUrl = opts.helpUrl != null ? opts.helpUrl : risqueLoginDoc("help");

    host.innerHTML =
      '<div id="risque-login-embedded-root" class="risque-login-embedded-root">' +
      '<button type="button" class="risque-login-center-move login-monitor-move-btn" id="login-monitor-center-btn">MOVE PUBLIC WINDOW (WIN+SHIFT+ARROW)</button>' +
      '<div class="mgm-embedded-login-welcome"></div>' +
      '<div class="login-prompt"></div>' +
      '<div class="color-swatches">' +
      '<div class="color-swatch blue active" data-color="blue">Blue</div>' +
      '<div class="color-swatch red active" data-color="red">Red</div>' +
      '<div class="color-swatch yellow active" data-color="yellow">Yellow</div>' +
      '<div class="color-swatch green active" data-color="green">Green</div>' +
      '<div class="color-swatch pink active" data-color="pink">Pink</div>' +
      '<div class="color-swatch black active" data-color="black">Black</div>' +
      "</div>" +
      '<div id="player-form-js">' +
      buildPlayerFormHtml() +
      "</div>" +
      '<div class="login-docs-row">' +
      '<button type="button" class="login-doc-button" id="login-manual-btn">GAME MANUAL</button>' +
      '<button type="button" class="login-doc-button" id="login-help-btn">HELP</button>' +
      '<button type="button" class="login-doc-button login-doc-button--monitor login-monitor-move-btn" id="login-monitor-btn">MOVE PUBLIC WINDOW</button>' +
      "</div>" +
      '<button type="button" class="load-button login-monitor-move-btn" id="login-monitor-btn-main">MOVE PUBLIC WINDOW (WIN+SHIFT+ARROW)</button>' +
      '<button type="button" class="login-button" id="login-button-js">LOG IN</button>' +
      buildLoginPresetBarHtml() +
      '<button type="button" class="load-button" id="load-button-js">LOAD GAME</button>' +
      '<div id="login-js-error"></div>' +
      '<input type="file" id="load-game-input-js" accept=".json" style="display:none" />' +
      "</div>";

    var root = host.querySelector("#risque-login-embedded-root");
    if (!root) return;
    var welcomeTextEl = root.querySelector(".mgm-embedded-login-welcome");
    var loginPromptEl = root.querySelector(".login-prompt");
    if (welcomeTextEl) {
      welcomeTextEl.textContent = opts.welcomeText != null ? opts.welcomeText : "WELCOME TO RISQUE";
    }
    if (loginPromptEl) {
      loginPromptEl.textContent = opts.loginPrompt != null ? opts.loginPrompt : "INPUT PLAYER NAME AND CHOOSE COLOR";
    }
    restoreSavedPlayerNames(root);

    function getTargetRow() {
      var rows = root.querySelectorAll(".player-row");
      var r;
      for (r = 0; r < rows.length; r += 1) {
        var row = rows[r];
        var input = row.querySelector("input");
        var colorField = row.querySelector(".color-field");
        if (input && colorField && input.value.trim() !== "" && colorField.dataset.color === "") return row;
      }
      return null;
    }

    Array.prototype.forEach.call(root.querySelectorAll(".color-swatch"), function (swatch) {
      swatch.addEventListener("click", function () {
        if (!swatch.classList.contains("active")) {
          onLog("Color swatch " + swatch.dataset.color + " clicked but not active");
          return;
        }
        var row = getTargetRow();
        if (!row) {
          onLog("No valid row for color selection");
          return;
        }
        var color = swatch.dataset.color;
        var colorField = row.querySelector(".color-field");
        colorField.style.background = window.getComputedStyle(swatch).backgroundColor;
        colorField.dataset.color = color;
        swatch.classList.remove("active");
        swatch.classList.add("unavailable");
        onLog("Player color: " + color);
      });
    });

    Array.prototype.forEach.call(root.querySelectorAll(".color-field"), function (field) {
      field.addEventListener("click", function () {
        var color = field.dataset.color;
        if (!color) return;
        var swatch = root.querySelector('.color-swatch[data-color="' + color + '"]');
        field.style.background = "#000000";
        field.dataset.color = "";
        if (swatch) {
          swatch.classList.remove("unavailable");
          swatch.classList.add("active");
        }
        onLog("Color cleared for row");
      });
    });

    function readFilledRows() {
      return readFilledPlayerRows(root);
    }

    var elError = root.querySelector("#login-js-error");
    var loginButton = root.querySelector("#login-button-js");
    var loadButton = root.querySelector("#load-button-js");
    var loadInput = root.querySelector("#load-game-input-js");
    if (opts.loginButtonLabel && loginButton) loginButton.textContent = opts.loginButtonLabel;
    if (opts.hideLoadGame && loadButton) loadButton.style.display = "none";
    if (opts.loadButtonLabel && loadButton) loadButton.textContent = opts.loadButtonLabel;
    attachCarRadioPresetControls(root, onLog, elError, null);
    var randomOrderLegacy = root.querySelector("#risque-login-random-order");
    if (randomOrderLegacy) {
      randomOrderLegacy.addEventListener("click", function () {
        elError.textContent = "";
        var filled = readFilledRows();
        if (filled.length < 2) {
          elError.textContent = "Enter at least two players with names and colors to shuffle turn order.";
          onLog("Random order: need 2+ filled rows");
          return;
        }
        var names = filled.map(function (x) {
          return x.name;
        });
        var colors = filled.map(function (x) {
          return x.color;
        });
        if (new Set(names).size !== names.length) {
          elError.textContent = "Fix duplicate names before shuffling order.";
          return;
        }
        if (new Set(colors).size !== colors.length) {
          elError.textContent = "Colors must be unique before shuffling order.";
          return;
        }
        var shuffled = shuffleArray(filled);
        applyFilledRowsInOrder(root, shuffled, onLog, "Shuffled turn order (names kept with colors)");
      });
    }
    if (loadButton && !opts.hideLoadGame) {
      loadButton.style.display = "block";
      loadButton.style.opacity = "1";
      loadButton.style.visibility = "visible";
    }
    var docRow = root.querySelector(".login-docs-row");
    if (opts.hideDocButtons && docRow) {
      docRow.style.display = "none";
    } else {
      var manualBtn = root.querySelector("#login-manual-btn");
      var helpBtn = root.querySelector("#login-help-btn");
      if (manualBtn) {
        manualBtn.addEventListener("click", function () {
          window.open(manualUrl, "_blank", "noopener,noreferrer");
        });
      }
      if (helpBtn) {
        helpBtn.addEventListener("click", function () {
          window.open(helpUrl, "_blank", "noopener,noreferrer");
        });
      }
      wirePublicWindowMoveHelper(root, elError, onLog);
    }

    loginButton.addEventListener("click", function () {
      elError.textContent = "";
      var filled = readFilledRows();
      if (filled.length < 2) {
        elError.textContent = "At least two players with name and color required.";
        onLog("Login failed: need 2+ players");
        return;
      }
      var names = filled.map(function (x) {
        return x.name;
      });
      var colors = filled.map(function (x) {
        return x.color;
      });
      if (new Set(names).size !== names.length) {
        elError.textContent = "Duplicate names.";
        onLog("Login failed: duplicate names");
        return;
      }
      if (new Set(colors).size !== colors.length) {
        elError.textContent = "Colors must be unique.";
        onLog("Login failed: colors not unique");
        return;
      }
      var gs = buildGameStateFromRows(filled);
      if (typeof window.risqueReplayClearTapeSidecar === "function") {
        window.risqueReplayClearTapeSidecar();
      }
      if (typeof window.risqueSessionDiskInvalidateCache === "function") {
        window.risqueSessionDiskInvalidateCache();
      }
      if (typeof window.risqueClearStoredSessionForNewGame === "function") {
        window.risqueClearStoredSessionForNewGame();
      }
      if (!skipPersist) {
        try {
          localStorage.setItem("gameState", JSON.stringify(gs));
        } catch (eLsEmb) {
          elError.textContent =
            "Could not save roster (browser storage full or blocked). Free space or clear site data, then try again.";
          onLog("Login failed: localStorage " + (eLsEmb && eLsEmb.message ? eLsEmb.message : String(eLsEmb)));
          return;
        }
      }
      if (typeof window.risqueHostReplaceShellGameState === "function") {
        window.risqueHostReplaceShellGameState(gs);
      }
      persistLastPlayerNames(filled);
      onLog("Login OK (embedded)", { players: names });
      if (typeof onLoginSuccess === "function") {
        if (!skipPersist) mirrorPushGameStateBeforeLoginNavigate();
        host.innerHTML = "";
        onLoginSuccess(gs);
        return;
      }
      if (!skipPersist) mirrorPushGameStateBeforeLoginNavigate();
      if (window.risqueNavigateWithFade) window.risqueNavigateWithFade(legacyNext);
      else window.location.href = legacyNext;
    });

    loadButton.addEventListener("click", function () {
      loadInput.click();
    });

    loadInput.addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      elError.textContent = "";
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var parsed = JSON.parse(e.target.result);
          var gs = normalizeImportedGameState(parsed);
          if (!gs || !validateLoadedGameState(gs)) {
            elError.textContent = "Invalid save file.";
            onLog("Load failed: invalid state");
            if (window.RISQUE_MOCK_MAKER) {
              window.alert(
                "That file could not be loaded as a RISQUE save.\n\n" +
                  "• Pick the actual .json file (not a folder).\n" +
                  "• Need at least 2 players with names. A wrapped { \"gameState\": … } file is OK.\n" +
                  "• If nothing happens and you see no message, check the browser console (F12)."
              );
            }
            return;
          }
          if (!skipFixResumePhase && !fixResumePhase(gs, onLog)) {
            elError.textContent = "Invalid turn order in save.";
            return;
          }
          if (typeof window.risqueReplayClearTapeSidecar === "function") {
            window.risqueReplayClearTapeSidecar();
          }
          if (!skipPersist) {
            localStorage.setItem("gameState", JSON.stringify(gs));
          }
          onLog("Loaded (embedded), handing off to onLoadSuccess");
          if (typeof onLoadSuccess === "function") {
            host.innerHTML = "";
            onLoadSuccess(gs);
            return;
          }
          if (window.risqueNavigateWithFade) window.risqueNavigateWithFade(loadRedirect);
          else window.location.href = loadRedirect;
        } catch (err) {
          elError.textContent = "Could not read JSON.";
          onLog("Load error: " + err.message);
        }
        loadInput.value = "";
      };
      reader.readAsText(file);
    });
  }

  /**
   * Full-screen login variant (non-HUD), driven by JS.
   * Overlay is appended to document.body (covers entire window).
   */
  function mount(_container, opts) {
    opts = opts || {};
    if (opts.useHud === true && _container && _container.id === "ui-overlay") {
      mountLoginHud(_container, opts);
      return;
    }
    if (opts.embedHost && window.RISQUE_MOCK_MAKER) {
      mountEmbeddedLogin(opts.embedHost, opts);
      return;
    }
    var legacyNext = opts.legacyNext || "game.html?phase=playerSelect&selectKind=firstCard";
    var loadRedirect =
      opts.loadRedirect || "game.html?phase=cardplay&legacyNext=income.html";
    var onLog = opts.onLog || logLogin;
    var onLoginSuccess = opts.onLoginSuccess;
    var onLoadSuccess = opts.onLoadSuccess;
    var skipPersist = !!opts.skipPersist;
    var skipFixResumePhase = !!opts.skipFixResumePhase;
    var redirectDelayMs = opts.loginRedirectDelayMs != null ? opts.loginRedirectDelayMs : 2000;
    var welcomeTextContent = opts.welcomeText != null ? opts.welcomeText : "WELCOME TO RISQUE";
    var loginPromptContent = opts.loginPrompt != null ? opts.loginPrompt : "INPUT PLAYER NAME AND CHOOSE COLOR";
    var manualUrl = opts.manualUrl != null ? opts.manualUrl : risqueLoginDoc("manual");
    var helpUrl = opts.helpUrl != null ? opts.helpUrl : risqueLoginDoc("help");

    injectLegacyStyles();
    var existing = document.getElementById("risque-login-overlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "risque-login-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "RISQUE login");
    overlay.innerHTML =
      "<div class=\"risque-login-canvas\">" +
      "<button type=\"button\" class=\"risque-login-center-move login-monitor-move-btn\" id=\"login-monitor-center-btn\">MOVE PUBLIC WINDOW (WIN+SHIFT+ARROW)</button>" +
      "<div class=\"welcome-text\"></div>" +
      "<div class=\"login-container\">" +
      "<div class=\"login-prompt\"></div>" +
      "<div class=\"color-swatches\">" +
      "<div class=\"color-swatch blue active\" data-color=\"blue\">Blue</div>" +
      "<div class=\"color-swatch red active\" data-color=\"red\">Red</div>" +
      "<div class=\"color-swatch yellow active\" data-color=\"yellow\">Yellow</div>" +
      "<div class=\"color-swatch green active\" data-color=\"green\">Green</div>" +
      "<div class=\"color-swatch pink active\" data-color=\"pink\">Pink</div>" +
      "<div class=\"color-swatch black active\" data-color=\"black\">Black</div>" +
      "</div>" +
      "<div id=\"player-form-js\">" + buildPlayerFormHtml() + "</div>" +
      "<div class=\"login-docs-row\">" +
      "<button type=\"button\" class=\"login-doc-button\" id=\"login-manual-btn\">GAME MANUAL</button>" +
      "<button type=\"button\" class=\"login-doc-button\" id=\"login-help-btn\">HELP</button>" +
      "<button type=\"button\" class=\"login-doc-button login-doc-button--monitor login-monitor-move-btn\" id=\"login-monitor-btn\">MOVE PUBLIC WINDOW</button>" +
      "</div>" +
      "<button type=\"button\" class=\"load-button login-monitor-move-btn\" id=\"login-monitor-btn-main\">MOVE PUBLIC WINDOW (WIN+SHIFT+ARROW)</button>" +
      "<button type=\"button\" class=\"login-button\" id=\"login-button-js\">LOG IN</button>" +
      buildLoginPresetBarHtml() +
      "<button type=\"button\" class=\"load-button\" id=\"load-button-js\">LOAD GAME</button>" +
      "<p id=\"risque-login-easy-hint\" class=\"risque-login-easy-hint\" hidden></p>" +
      "<div id=\"login-js-error\"></div>" +
      "</div>" +
      "<input type=\"file\" id=\"load-game-input-js\" accept=\".json\" />" +
      "</div>";

    document.body.appendChild(overlay);
    var easyHint = document.getElementById("risque-login-easy-hint");
    if (easyHint) {
      if (window.location.protocol === "file:") {
        easyHint.hidden = false;
        easyHint.textContent =
          "Tip: open via scripts\\RISQUE.bat or localhost so rounds can autosave to one folder (file:// limits folder access).";
      } else if (typeof window.risqueFetchLauncherPathsJson === "function") {
        window.risqueFetchLauncherPathsJson().then(function (j) {
          if (!easyHint || !easyHint.isConnected) return;
          var saveRoot = j && (j.saveRoot || j.saveDir);
          var replayDir = j && j.replayDir;
          if (!saveRoot && !replayDir) return;
          easyHint.hidden = false;
          var bits = [];
          if (saveRoot) bits.push("SAVE " + saveRoot);
          if (replayDir) bits.push("REPLAY " + replayDir);
          easyHint.textContent = "Launcher folders (optional): " + bits.join(" · ") + ".";
        });
      }
    }
    var welcomeTextEl = overlay.querySelector(".welcome-text");
    var loginPromptEl = overlay.querySelector(".login-prompt");
    if (welcomeTextEl) welcomeTextEl.textContent = welcomeTextContent;
    if (loginPromptEl) loginPromptEl.textContent = loginPromptContent;
    restoreSavedPlayerNames(overlay);

    function getTargetRow() {
      var rows = overlay.querySelectorAll(".player-row");
      for (var r = 0; r < rows.length; r += 1) {
        var row = rows[r];
        var input = row.querySelector("input");
        var colorField = row.querySelector(".color-field");
        if (input.value.trim() !== "" && colorField.dataset.color === "") {
          return row;
        }
      }
      return null;
    }

    Array.prototype.forEach.call(overlay.querySelectorAll(".color-swatch"), function (swatch) {
      swatch.addEventListener("click", function () {
        if (!swatch.classList.contains("active")) {
          onLog("Color swatch " + swatch.dataset.color + " clicked but not active");
          return;
        }
        var row = getTargetRow();
        if (!row) {
          onLog("No valid row for color selection");
          return;
        }
        var color = swatch.dataset.color;
        var colorField = row.querySelector(".color-field");
        colorField.style.background = window.getComputedStyle(swatch).backgroundColor;
        colorField.dataset.color = color;
        swatch.classList.remove("active");
        swatch.classList.add("unavailable");
        onLog("Player color: " + color);
      });
    });

    Array.prototype.forEach.call(overlay.querySelectorAll(".color-field"), function (field) {
      field.addEventListener("click", function () {
        var color = field.dataset.color;
        if (!color) return;
        var swatch = overlay.querySelector(".color-swatch[data-color=\"" + color + "\"]");
        field.style.background = "#000000";
        field.dataset.color = "";
        if (swatch) {
          swatch.classList.remove("unavailable");
          swatch.classList.add("active");
        }
        onLog("Color cleared for row");
      });
    });

    function readFilledRows() {
      return readFilledPlayerRows(overlay);
    }

    var elError = overlay.querySelector("#login-js-error");
    var welcomeText = overlay.querySelector(".welcome-text");
    var loginContainer = overlay.querySelector(".login-container");
    var loginButton = overlay.querySelector("#login-button-js");
    var loadButton = overlay.querySelector("#load-button-js");
    var loadInput = overlay.querySelector("#load-game-input-js");
    if (opts.loginButtonLabel && loginButton) {
      loginButton.textContent = opts.loginButtonLabel;
    }
    if (opts.hideLoadGame && loadButton) {
      loadButton.style.display = "none";
    }
    if (opts.loadButtonLabel && loadButton) {
      loadButton.textContent = opts.loadButtonLabel;
    }
    attachCarRadioPresetControls(overlay, onLog, elError, null);
    var randomOrderLegacy = overlay.querySelector("#risque-login-random-order");
    if (randomOrderLegacy) {
      randomOrderLegacy.addEventListener("click", function () {
        elError.textContent = "";
        var filled = readFilledRows();
        if (filled.length < 2) {
          elError.textContent = "Enter at least two players with names and colors to shuffle turn order.";
          onLog("Random order: need 2+ filled rows");
          return;
        }
        var names = filled.map(function (x) { return x.name; });
        var colors = filled.map(function (x) { return x.color; });
        if (new Set(names).size !== names.length) {
          elError.textContent = "Fix duplicate names before shuffling order.";
          return;
        }
        if (new Set(colors).size !== colors.length) {
          elError.textContent = "Colors must be unique before shuffling order.";
          return;
        }
        var shuffled = shuffleArray(filled);
        applyFilledRowsInOrder(overlay, shuffled, onLog, "Shuffled turn order (names kept with colors)");
      });
    }

    if (loadButton && !opts.hideLoadGame) {
      // Force visibility in case external/global CSS interferes.
      loadButton.style.display = "block";
      loadButton.style.width = "200px";
      loadButton.style.margin = "10px auto 0";
      loadButton.style.background = "#ffd700";
      loadButton.style.color = "#000000";
      loadButton.style.opacity = "1";
      loadButton.style.visibility = "visible";
    }

    var docRow = overlay.querySelector(".login-docs-row");
    if (opts.hideDocButtons && docRow) {
      docRow.style.display = "none";
    } else {
      var manualBtn = overlay.querySelector("#login-manual-btn");
      var helpBtn = overlay.querySelector("#login-help-btn");
      if (manualBtn) {
        manualBtn.addEventListener("click", function () {
          window.open(manualUrl, "_blank", "noopener,noreferrer");
        });
      }
      if (helpBtn) {
        helpBtn.addEventListener("click", function () {
          window.open(helpUrl, "_blank", "noopener,noreferrer");
        });
      }
      wirePublicWindowMoveHelper(overlay, elError, onLog);
    }

    function onResize() {
      resizeLoginCanvas(overlay);
    }

    loginButton.addEventListener("click", function () {
      elError.textContent = "";
      var filled = readFilledRows();
      if (filled.length < 2) {
        elError.textContent = "At least two players with name and color required.";
        onLog("Login failed: need 2+ players");
        return;
      }
      var names = filled.map(function (x) { return x.name; });
      var colors = filled.map(function (x) { return x.color; });
      if (new Set(names).size !== names.length) {
        elError.textContent = "Duplicate names.";
        onLog("Login failed: duplicate names");
        return;
      }
      if (new Set(colors).size !== colors.length) {
        elError.textContent = "Colors must be unique.";
        onLog("Login failed: colors not unique");
        return;
      }
      pushPublicLoginFadeStartForMirror();
      var gs = buildGameStateFromRows(filled);
      if (typeof window.risqueReplayClearTapeSidecar === "function") {
        window.risqueReplayClearTapeSidecar();
      }
      if (typeof window.risqueSessionDiskInvalidateCache === "function") {
        window.risqueSessionDiskInvalidateCache();
      }
      if (typeof window.risqueClearStoredSessionForNewGame === "function") {
        window.risqueClearStoredSessionForNewGame();
      }
      if (!skipPersist) {
        try {
          localStorage.setItem("gameState", JSON.stringify(gs));
        } catch (eLsOv) {
          elError.textContent =
            "Could not save roster (browser storage full or blocked). Free space or clear site data, then try again.";
          onLog("Login failed: localStorage " + (eLsOv && eLsOv.message ? eLsOv.message : String(eLsOv)));
          return;
        }
      }
      if (typeof window.risqueHostReplaceShellGameState === "function") {
        window.risqueHostReplaceShellGameState(gs);
      }
      persistLastPlayerNames(filled);
      onLog("Login OK, redirecting to " + legacyNext, { players: names });
      welcomeText.classList.add("fade-out");
      loginButton.classList.add("fade-out");
      Array.prototype.forEach.call(overlay.querySelectorAll(".risque-login-preset-slot"), function (b) {
        b.classList.add("fade-out");
      });
      if (randomOrderLegacy) randomOrderLegacy.classList.add("fade-out");
      loadButton.classList.add("fade-out");
      Array.prototype.forEach.call(overlay.querySelectorAll(".login-doc-button"), function (b) {
        b.classList.add("fade-out");
      });
      loginContainer.classList.add("fade-out");
      window.removeEventListener("resize", onResize);
      setTimeout(function () {
        if (typeof onLoginSuccess === "function") {
          mirrorPushGameStateBeforeLoginNavigate();
          overlay.remove();
          onLoginSuccess(gs);
          return;
        }
        mirrorPushGameStateBeforeLoginNavigate();
        if (window.risqueNavigateWithFade) {
          window.risqueNavigateWithFade(legacyNext);
        } else {
          window.location.href = legacyNext;
        }
      }, redirectDelayMs);
    });

    loadButton.addEventListener("click", function () {
      loadInput.click();
    });

    loadInput.addEventListener("change", function (ev) {
      var file = ev.target.files && ev.target.files[0];
      elError.textContent = "";
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var parsed = JSON.parse(e.target.result);
          var gs = normalizeImportedGameState(parsed);
          if (!gs || !validateLoadedGameState(gs)) {
            elError.textContent = "Invalid save file.";
            onLog("Load failed: invalid state");
            if (window.RISQUE_MOCK_MAKER) {
              window.alert(
                "That file could not be loaded as a RISQUE save.\n\n" +
                  "• Pick the actual .json file (not a folder).\n" +
                  "• Need at least 2 players with names. A wrapped { \"gameState\": … } file is OK.\n" +
                  "• If nothing happens and you see no message, check the browser console (F12)."
              );
            }
            return;
          }
          if (!skipFixResumePhase && !fixResumePhase(gs, onLog)) {
            elError.textContent = "Invalid turn order in save.";
            return;
          }
          if (typeof window.risqueReplayClearTapeSidecar === "function") {
            window.risqueReplayClearTapeSidecar();
          }
          if (!skipPersist) {
            localStorage.setItem("gameState", JSON.stringify(gs));
          }
          onLog("Loaded, redirecting to " + loadRedirect);
          welcomeText.classList.add("fade-out");
          loginButton.classList.add("fade-out");
          Array.prototype.forEach.call(overlay.querySelectorAll(".risque-login-preset-slot"), function (b) {
            b.classList.add("fade-out");
          });
          if (randomOrderLegacy) randomOrderLegacy.classList.add("fade-out");
          loadButton.classList.add("fade-out");
          Array.prototype.forEach.call(overlay.querySelectorAll(".login-doc-button"), function (b) {
            b.classList.add("fade-out");
          });
          loginContainer.classList.add("fade-out");
          window.removeEventListener("resize", onResize);
          setTimeout(function () {
            if (typeof onLoadSuccess === "function") {
              overlay.remove();
              onLoadSuccess(gs);
              return;
            }
            if (window.risqueNavigateWithFade) {
              window.risqueNavigateWithFade(loadRedirect);
            } else {
              window.location.href = loadRedirect;
            }
          }, redirectDelayMs);
        } catch (err) {
          elError.textContent = "Could not read JSON.";
          onLog("Load error: " + err.message);
        }
        loadInput.value = "";
      };
      reader.readAsText(file);
    });

    window.addEventListener("resize", onResize);
    requestAnimationFrame(function () {
      resizeLoginCanvas(overlay);
      setTimeout(function () {
        resizeLoginCanvas(overlay);
      }, 100);
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.login = {
    mount: mount,
    applyPublicLoginFormMirror: applyPublicLoginFormMirror,
    buildGameStateFromRows: buildGameStateFromRows,
    normalizeImportedGameState: normalizeImportedGameState,
    validateLoadedGameState: validateLoadedGameState,
    fixResumePhase: fixResumePhase
  };
})();
