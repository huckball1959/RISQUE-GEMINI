/**
 * Conquer celebration / elimination interstitial — mounted on game.html ?phase=conquer.
 * Replaces standalone conquer.html; next step for conquer chain remains con-cardtransfer.html.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-conquer-phase-runtime-v1";
  var CONFETTI_SRC =
    "https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "#risque-conquer-confetti-canvas{position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;pointer-events:none;}" +
      ".risque-conquer-player-name{font-family:Arial,sans-serif;font-size:28px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:.5px;text-shadow:2px 2px 2px rgba(0,0,0,.7);position:absolute;left:1500px;top:250px;transform:translateX(-50%);" +
      "z-index:10;pointer-events:none;text-align:center;}" +
      ".risque-conquer-message{font-family:Arial,sans-serif;font-size:48px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:1px;text-shadow:3px 3px 3px rgba(0,0,0,.7);color:#fff;position:absolute;left:1500px;top:409px;" +
      "transform:translateX(-50%);z-index:10;pointer-events:none;text-align:center;animation:risque-conquer-flash .5s ease-in-out infinite;}" +
      ".risque-conquer-win-message{font-family:Arial,sans-serif;font-size:60px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:2px;text-shadow:4px 4px 4px rgba(0,0,0,.8);color:#ffd700;position:absolute;left:960px;top:540px;" +
      "transform:translate(-50%,-50%);z-index:15;pointer-events:none;text-align:center;" +
      "animation:risque-conquer-winFlash .7s ease-in-out infinite,risque-conquer-gradient 6s ease-in-out infinite;" +
      "background:linear-gradient(45deg,#f00,#0f0,#00f,#ff0);background-size:400%;-webkit-background-clip:text;" +
      "-webkit-text-fill-color:transparent;}" +
      "@keyframes risque-conquer-flash{0%,100%{opacity:1}50%{opacity:.3}}" +
      "@keyframes risque-conquer-winFlash{0%,100%{opacity:1;transform:translate(-50%,-50%) scale(1)}" +
      "50%{opacity:.5;transform:translate(-50%,-50%) scale(1.05)}}" +
      "@keyframes risque-conquer-gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}" +
      ".risque-conquer-message.static{animation:none;opacity:1;}" +
      ".risque-conquer-button-wrap{position:absolute;top:700px;left:1500px;transform:translateX(-50%);display:flex;" +
      "flex-direction:column;align-items:center;width:258px;z-index:10;}" +
      ".risque-conquer-btn{width:258px;height:36px;margin:10px 0;background:#000;color:#fff;font-family:Arial,sans-serif;" +
      "font-size:16px;font-weight:bold;text-align:center;border:none;border-radius:4px;cursor:pointer;z-index:10;" +
      "display:none;opacity:0;transition:opacity 1s ease-in-out;}" +
      ".risque-conquer-btn.visible{display:block;opacity:1;}" +
      ".risque-conquer-btn:hover:not(:disabled){background:#1a1a1a;color:#fff;}" +
      ".risque-conquer-btn:active:not(:disabled){transform:scale(.95);}" +
      ".risque-conquer-btn:disabled{opacity:.5;cursor:not-allowed;}";
    document.head.appendChild(s);
  }

  function logToStorage(message, data) {
    var timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    var logEntry = "[" + timestamp + "] [Conquer] " + message;
    try {
      var logs = JSON.parse(localStorage.getItem("gameLogs") || "[]");
      if (!Array.isArray(logs)) logs = [];
      logs.push(logEntry);
      if (data) logs.push(JSON.stringify(data, null, 2));
      localStorage.setItem("gameLogs", JSON.stringify(logs));
    } catch (e) {
      /* ignore */
    }
    console.log(logEntry, data || "");
  }

  function computeOwnedContinents(player) {
    var owned = [];
    var continents = window.gameState && window.gameState.continents;
    if (!continents || !player || !player.territories) return owned;
    for (var cont in continents) {
      if (!Object.prototype.hasOwnProperty.call(continents, cont)) continue;
      var data = continents[cont];
      if (
        data &&
        data.territories &&
        data.territories.every(function (t) {
          return player.territories.some(function (pt) {
            return pt.name === t;
          });
        })
      ) {
        owned.push(cont);
      }
    }
    return owned;
  }

  function applyContinentSnapshot(gs) {
    var currentPlayer = gs.players.find(function (p) {
      return p.name === gs.currentPlayer;
    });
    if (!currentPlayer) return;
    var snapshot = gs.continentsSnapshot || {};
    var snapshotOwned = Object.keys(snapshot);
    var currentOwned = computeOwnedContinents(currentPlayer);
    var newContinents = currentOwned.filter(function (cont) {
      return snapshotOwned.indexOf(cont) === -1;
    });
    gs.pendingNewContinents = newContinents;
    gs.phase = "conquer";
    delete gs.risquePublicEliminationBanner;
    delete gs.risqueControlVoice;
    gs.risquePublicConCardTransferPrimary = "";
    gs.risquePublicConCardTransferReport = "";
    try {
      localStorage.setItem("gameState", JSON.stringify(gs));
    } catch (e) {
      /* ignore */
    }
    logToStorage("Post-elimination continent update", {
      snapshotOwned: snapshotOwned,
      currentOwned: currentOwned,
      newContinents: newContinents,
      pending: gs.pendingNewContinents
    });
  }

  function removeConfettiCanvas() {
    var c = document.getElementById("risque-conquer-confetti-canvas");
    if (c && c.parentNode) c.parentNode.removeChild(c);
  }

  function loadConfettiScript(done) {
    if (window.confetti && typeof window.confetti.create === "function") {
      done();
      return;
    }
    var existing = document.querySelector('script[data-risque-confetti="1"]');
    if (existing) {
      existing.addEventListener("load", done);
      return;
    }
    var s = document.createElement("script");
    s.src = CONFETTI_SRC;
    s.setAttribute("data-risque-confetti", "1");
    s.onload = done;
    s.onerror = function () {
      done();
    };
    document.head.appendChild(s);
  }

  function startConfetti() {
    loadConfettiScript(function () {
      var wrapper = document.getElementById("canvas");
      if (!wrapper || !window.confetti || typeof window.confetti.create !== "function") return;
      removeConfettiCanvas();
      var canvas = document.createElement("canvas");
      canvas.id = "risque-conquer-confetti-canvas";
      var ui = document.getElementById("ui-overlay");
      if (ui && ui.parentNode === wrapper) {
        wrapper.insertBefore(canvas, ui);
      } else {
        wrapper.appendChild(canvas);
      }
      var confettiApi = window.confetti.create(canvas, { resize: true });
      var duration = 15 * 1000;
      var animationEnd = Date.now() + duration;
      var colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff69b4"];
      function randomInRange(min, max) {
        return Math.random() * (max - min) + min;
      }
      function shoot() {
        var timeLeft = animationEnd - Date.now();
        if (timeLeft <= 0) return;
        confettiApi({
          particleCount: 100,
          angle: randomInRange(55, 125),
          spread: randomInRange(50, 70),
          origin: { x: Math.random(), y: Math.random() - 0.2 },
          colors: colors,
          zIndex: 5
        });
        setTimeout(shoot, randomInRange(200, 400));
      }
      shoot();
      setTimeout(function () {
        var btn = document.getElementById("risque-conquer-proceed");
        if (btn) btn.classList.add("visible");
      }, duration);
    });
  }

  function navigateTo(url) {
    if (window.risqueNavigateWithFade) {
      window.risqueNavigateWithFade(url);
    } else {
      window.location.href = url;
    }
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    injectStyles();
    var onLog = opts.onLog || function () {};

    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    var stalePrompt = document.getElementById("prompt");
    if (stalePrompt && stalePrompt.parentNode) stalePrompt.parentNode.removeChild(stalePrompt);
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }

    removeConfettiCanvas();

    var gs = window.gameState;
    if (!gs) {
      window.gameUtils.showError("No game state.");
      setTimeout(function () {
        navigateTo("index.html");
      }, 2000);
      return;
    }

    applyContinentSnapshot(gs);
    gs = window.gameState;

    if (!gs.players || !gs.currentPlayer || !gs.defeatedPlayer) {
      window.gameUtils.showError("Invalid conquer state. Returning to launcher.");
      onLog("Conquer mount: missing defeatedPlayer");
      setTimeout(function () {
        navigateTo("index.html");
      }, 2000);
      return;
    }

    var currentPlayer = gs.players.find(function (p) {
      return p.name === gs.currentPlayer;
    });
    var defeatedPlayer = gs.players.find(function (p) {
      return p.name === gs.defeatedPlayer;
    });
    if (!currentPlayer || !defeatedPlayer) {
      window.gameUtils.showError("Players not found. Returning to launcher.");
      setTimeout(function () {
        navigateTo("index.html");
      }, 2000);
      return;
    }

    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      if (gs) {
        window.risqueRuntimeHud.updateTurnBannerFromState(gs);
      }
    }

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");

    var playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
    var isGameWon = gs.turnOrder.length === 1;
    var html;

    if (isGameWon) {
      gs.winner = currentPlayer.name;
      try {
        localStorage.setItem("gameState", JSON.stringify(gs));
      } catch (e1) {
        /* ignore */
      }
      html =
        '<div class="risque-conquer-player-name" style="color:' +
        playerColor +
        '">' +
        currentPlayer.name +
        "'s Victory!</div>" +
        '<div class="risque-conquer-win-message">' +
        currentPlayer.name +
        " WON THE GAME!</div>" +
        '<div class="risque-conquer-button-wrap">' +
        '<button type="button" id="risque-conquer-proceed" class="risque-conquer-btn">Return to main menu</button>' +
        "</div>";
      logToStorage("Game won by player", { winner: currentPlayer.name });
    } else {
      html =
        '<div class="risque-conquer-player-name" style="color:' +
        playerColor +
        '">' +
        currentPlayer.name +
        "'s Conquer Phase</div>" +
        '<div class="risque-conquer-message">' +
        currentPlayer.name +
        " has conquered " +
        defeatedPlayer.name +
        "!</div>" +
        '<div class="risque-conquer-button-wrap">' +
        '<button type="button" id="risque-conquer-proceed" class="risque-conquer-btn">Proceed to card transfer</button>' +
        "</div>";
      logToStorage("Conquer phase initialized", {
        currentPlayer: currentPlayer.name,
        defeatedPlayer: defeatedPlayer.name
      });
    }

    uiOverlay.innerHTML = html;

    var proceed = document.getElementById("risque-conquer-proceed");
    var msgEl = uiOverlay.querySelector(
      isGameWon ? ".risque-conquer-win-message" : ".risque-conquer-message"
    );

    function proceedAction() {
      if (isGameWon) {
        try {
          localStorage.removeItem("gameState");
          localStorage.removeItem("gameLogs");
        } catch (e2) {
          /* ignore */
        }
        logToStorage("Navigating to index (game over)");
        navigateTo("index.html");
        return;
      }
      gs.phase = "con-cardtransfer";
      delete gs.risquePublicEliminationBanner;
      try {
        localStorage.setItem("gameState", JSON.stringify(gs));
      } catch (e3) {
        /* ignore */
      }
      logToStorage("Navigating to con-cardtransfer.html");
      uiOverlay.classList.add("fade-out");
      setTimeout(function () {
        navigateTo("con-cardtransfer.html");
      }, 2000);
    }

    if (isGameWon) {
      startConfetti();
    } else if (proceed && msgEl) {
      setTimeout(function () {
        msgEl.classList.add("static");
        proceed.classList.add("visible");
      }, 3000);
    }

    if (proceed) {
      proceed.addEventListener("click", proceedAction);
      proceed.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") proceedAction();
      });
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      if (window.gameUtils.initGameView) {
        window.gameUtils.initGameView();
      }
      window.gameUtils.renderTerritories(null, gs);
      window.gameUtils.renderStats(gs);
    });
    onLog("Conquer phase mounted");
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.conquer = { mount: mount };
})();
