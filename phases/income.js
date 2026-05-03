/**
 * Income phase — mounted on game.html when ?phase=income (canonical).
 * Standalone pages income.html / in-come.html removed; use this module only.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-income-styles-v2";

  function loginRecoveryHref() {
    return window.risqueLoginRecoveryViaPrivacyUrl();
  }

  function injectStyles() {
    var legacy = document.getElementById("risque-income-styles");
    if (legacy) legacy.remove();
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      ".income-player-name{font-family:Arial,sans-serif;font-size:20px;font-weight:900;text-transform:uppercase;" +
      "letter-spacing:.5px;text-shadow:2px 2px 2px rgba(0,0,0,.7);position:absolute;left:1110px;top:250px;" +
      "z-index:10;pointer-events:none;}" +
      ".income-table-container{position:absolute;top:309px;left:1120px;width:760px;z-index:10;visibility:visible;color:#0f172a;" +
      "opacity:0;transition:opacity 1s ease-in-out;}" +
      ".income-table-container.visible{opacity:1;}" +
      ".income-table{border-collapse:collapse;width:100%;color:#0f172a;}" +
      ".income-table th,.income-table td{border:2px solid #000;padding:8px;text-align:center;font-family:Arial,sans-serif;" +
      "font-size:12.5px;font-weight:bold;color:#0f172a;}" +
      ".income-table th{background-color:#94a3b8;color:#0f172a;}" +
      ".income-table td{background-color:#f8fafc;color:#0f172a;}" +
      ".income-button{width:258px;height:36px;margin:10px auto 0;position:relative;background:#000;color:#fff;" +
      "font-family:Arial,sans-serif;font-size:16px;font-weight:bold;text-align:center;border:none;border-radius:4px;" +
      "cursor:pointer;z-index:10;visibility:visible;opacity:0;transition:opacity 1s ease-in-out;display:block;}" +
      ".income-button.visible{opacity:1;}" +
      ".income-button:hover:not(:disabled){background:#1a1a1a;color:#fff;}" +
      ".income-button:active:not(:disabled){transform:scale(.95);}" +
      ".income-button:disabled{background:#000;color:#fff;opacity:.5;cursor:not-allowed;}";
    document.head.appendChild(s);
  }

  function mount(host, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    // Default next step: stay inside JS runtime.
    var legacyNext = opts.legacyNext != null ? opts.legacyNext : "game.html?phase=deploy&kind=turn";

    function logToStorage(message, data) {
      var ts = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
      var logEntry = "[" + ts + "] [Income] " + message;
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
      if (typeof onLog === "function") onLog(logEntry, data);
    }

    function sanitizeGameState(gameState) {
      logToStorage("Sanitized game state before save", {
        players: gameState.players.map(function (p) {
          return { name: p.name, bookValue: p.bookValue };
        }),
        bookPlayedThisTurn: gameState.bookPlayedThisTurn
      });
      return gameState;
    }

    function ensureContinentCollectionCounts(gameState) {
      if (!gameState.continentCollectionCounts) {
        gameState.continentCollectionCounts = {
          south_america: 0,
          north_america: 0,
          africa: 0,
          europe: 0,
          asia: 0,
          australia: 0
        };
      }
    }

    function applyRoundOneCardCap(gameState) {
      if (gameState.round === 1) {
        gameState.players.forEach(function (player) {
          if (player.cardCount > 1) {
            logToStorage("Corrected invalid card count", {
              player: player.name,
              oldCount: player.cardCount,
              newCount: 1
            });
            player.cardCount = 1;
            player.cards = player.cards.slice(0, 1);
          }
        });
      }
    }

    /**
     * Plain-language income breakdown for control voice (mirrored text; host/TV also use risquePublicIncomeBreakdown grid).
     * HUD phase slot shows the legacy spreadsheet table + Continue. Omit books/continents when +0.
     */
    function buildIncomeVoiceNarrative(
      currentPlayer,
      gameState,
      territoryCount,
      territoryBonus,
      bookCount,
      bookBonus,
      continentBonus,
      total,
      ownedContinents
    ) {
      var lines = [];
      lines.push(territoryCount + " territories — bonus equals " + territoryBonus);
      if (gameState.bookPlayedThisTurn && bookBonus > 0) {
        lines.push(
          "Books: " +
            bookCount +
            " book card" +
            (bookCount === 1 ? "" : "s") +
            " played — +" +
            bookBonus
        );
      }
      if (continentBonus > 0 && ownedContinents.length) {
        var parts = [];
        ownedContinents.forEach(function (c) {
          var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
            return window.gameUtils.continentDisplayNames[k] === c;
          });
          var v = window.gameUtils.getNextContinentValue(
            key,
            gameState.continentCollectionCounts[key] || 0
          );
          if (v > 0) {
            parts.push(c + ": +" + v);
          }
        });
        if (parts.length) {
          lines.push("Continents held: " + parts.join("; ") + ".");
        }
      }
      var primary = lines.join("\n").toUpperCase();
      var report = ("Total income: " + total).toUpperCase();
      if (primary.length > 1800) {
        primary = primary.slice(0, 1797) + "…";
      }
      return {
        primary: primary,
        report: report
      };
    }

    function incomeInit() {
      console.log("[Income] Initializing income phase");
      try {
        var uiOverlay = document.getElementById("ui-overlay");
        if (!uiOverlay) {
          console.error("[Income] UI overlay not found");
          window.gameUtils.showError("UI overlay not found");
          return;
        }
        var gameState = window.gameState;
        if (!gameState || !gameState.players || !gameState.currentPlayer) {
          console.error("[Income] Invalid game state");
          window.gameUtils.showError("Invalid game state");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 2000);
          return;
        }
        ensureContinentCollectionCounts(gameState);
        var currentPlayer = gameState.players.find(function (p) {
          return p.name === gameState.currentPlayer;
        });
        if (!currentPlayer) {
          console.error("[Income] Current player not found");
          window.gameUtils.showError("Current player not found");
          setTimeout(function () {
            window.location.href = loginRecoveryHref();
          }, 2000);
          return;
        }
        logToStorage("Checking bookValue for current player", {
          player: currentPlayer.name,
          bookValue: currentPlayer.bookValue,
          bookPlayedThisTurn: gameState.bookPlayedThisTurn
        });
        var playerColor = window.gameUtils.colorMap[currentPlayer.color] || "#ffffff";
        var territoryCount = currentPlayer.territories.length;
        var territoryBonus = Math.max(Math.floor(territoryCount / 3), 3);
        var bookCount = gameState.bookPlayedThisTurn ? currentPlayer.bookValue || 0 : 0;
        var bookBonus = bookCount * 10;
        var continentBonus = 0;
        var ownedContinents = window.gameUtils.getPlayerContinents(currentPlayer);
        continentBonus = ownedContinents.reduce(function (sum, continent) {
          var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
            return window.gameUtils.continentDisplayNames[k] === continent;
          });
          var collectionCount = gameState.continentCollectionCounts[key] || 0;
          return sum + window.gameUtils.getNextContinentValue(key, collectionCount);
        }, 0);
        var total = territoryBonus + bookBonus + continentBonus;
        var continentRowsForMirror = [];
        ownedContinents.forEach(function (c) {
          var cKey = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
            return window.gameUtils.continentDisplayNames[k] === c;
          });
          var cVal =
            cKey != null
              ? window.gameUtils.getNextContinentValue(cKey, gameState.continentCollectionCounts[cKey] || 0)
              : 0;
          if (cVal > 0) {
            continentRowsForMirror.push({
              name: c
                .replace("South America", "S. America")
                .replace("North America", "N. America"),
              bonus: cVal
            });
          }
        });
        gameState.risquePublicIncomeBreakdown = {
          territoryCount: territoryCount,
          territoryBonus: territoryBonus,
          continentRows: continentRowsForMirror,
          showBook: !!(gameState.bookPlayedThisTurn && bookBonus > 0),
          bookCount: bookCount,
          bookBonus: bookBonus,
          total: total
        };
        var useHud = !!window.risqueRuntimeHud;
        var incomeDoneButtonLabel = useHud ? "Continue" : "Confirm";
        var btnClass =
          "income-button visible" +
          (useHud ? " income-button--hud income-button--hud-solo" : "");
        var confirmBtnHtml =
          '<button type="button" class="' +
          btnClass +
          '">' +
          incomeDoneButtonLabel +
          "</button>";
        var incomeTableBlock = "";
        if (!useHud) {
          var scale = window.innerWidth / 1920;
          var theadHtml =
            "<thead><tr>" +
            '<th style="width:' +
            200 * scale +
            'px">Label</th>' +
            '<th style="width:' +
            385.3203125 * scale +
            'px">Details</th>' +
            '<th style="width:' +
            200 * scale +
            'px">Value</th>' +
            "</tr></thead>";
          var tbodyHtml =
            "<tbody>" +
            "<tr><td>TERRITORY BONUS</td><td>TERRITORY COUNT: " +
            territoryCount +
            "</td><td>BONUS: " +
            territoryBonus +
            "</td></tr>" +
            "<tr><td>BOOKS</td><td>BOOK COUNT: " +
            (bookCount === 0 ? "NONE" : bookCount) +
            "</td><td>BOOK: " +
            bookBonus +
            "</td></tr>" +
            "<tr><td>CONTINENTS</td><td>" +
            (ownedContinents.length
              ? ownedContinents
                  .map(function (c) {
                    var key = Object.keys(window.gameUtils.continentDisplayNames).find(function (k) {
                      return window.gameUtils.continentDisplayNames[k] === c;
                    });
                    return (
                      c.replace("South America", "S. America").replace("North America", "N. America") +
                      "=" +
                      window.gameUtils.getNextContinentValue(
                        key,
                        gameState.continentCollectionCounts[key] || 0
                      )
                    );
                  })
                  .join(", ")
              : "NONE") +
            "</td><td>CONTINENTS: " +
            continentBonus +
            "</td></tr>" +
            "<tr><td></td><td>TOTAL</td><td>" +
            total +
            "</td></tr>" +
            "</tbody>";
          var tableHtml =
            "<table class=\"income-table\">" + theadHtml + tbodyHtml + "</table>";
          incomeTableBlock =
            '<div class="income-table-container visible">' + tableHtml + confirmBtnHtml + "</div>";
        }
        if (window.risqueRuntimeHud) {
          window.risqueRuntimeHud.ensure(uiOverlay);
          window.risqueRuntimeHud.clearPhaseSlot();
          window.risqueRuntimeHud.setAttackChromeInteractive(false);
          window.risqueRuntimeHud.updateTurnBannerFromState(gameState);
          var voice = buildIncomeVoiceNarrative(
            currentPlayer,
            gameState,
            territoryCount,
            territoryBonus,
            bookCount,
            bookBonus,
            continentBonus,
            total,
            ownedContinents
          );
          try {
            window.gameState.risqueControlVoice = {
              primary: voice.primary,
              report: voice.report,
              reportClass: "ucp-voice-report ucp-voice-report--public-income"
            };
          } catch (eCv) {
            /* ignore */
          }
          if (typeof window.risqueMirrorPushGameState === "function") {
            window.risqueMirrorPushGameState();
          }
          function applyHostIncomeVoiceDom() {
            var gs = window.gameState || gameState;
            if (!gs || !gs.risquePublicIncomeBreakdown) return;
            if (typeof window.risqueHostApplyIncomeBreakdownVoice === "function") {
              window.risqueHostApplyIncomeBreakdownVoice(gs);
            } else if (typeof window.risqueBuildIncomeBreakdownDom === "function") {
              var vt0 = document.getElementById("control-voice-text");
              var vr0 = document.getElementById("control-voice-report");
              if (vt0) {
                vt0.classList.add("ucp-voice-text--public-income-stack");
                vt0.innerHTML = "";
                vt0.appendChild(window.risqueBuildIncomeBreakdownDom(gs.risquePublicIncomeBreakdown, gs));
              }
              if (vr0) {
                vr0.textContent = "";
                vr0.style.display = "none";
                vr0.className = "ucp-voice-report";
              }
            } else if (typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
              window.risqueRuntimeHud.setControlVoiceText(voice.primary, voice.report, {
                force: true,
                reportClass: "ucp-voice-report ucp-voice-report--public-income"
              });
            }
          }
          applyHostIncomeVoiceDom();
          requestAnimationFrame(function () {
            applyHostIncomeVoiceDom();
            if (typeof window.risqueMirrorPushGameState === "function") {
              window.risqueMirrorPushGameState();
            }
          });
          setTimeout(function () {
            applyHostIncomeVoiceDom();
            if (typeof window.risqueMirrorPushGameState === "function") {
              window.risqueMirrorPushGameState();
            }
          }, 120);
          if (typeof window.risqueClearSpectatorFocus === "function") {
            window.risqueClearSpectatorFocus();
          }
          var incSlot = document.getElementById("risque-phase-content");
          if (incSlot) {
            incSlot.innerHTML = "";
            var incStack = document.createElement("div");
            incStack.className = "income-hud-phase-stack";
            var incBtn = document.createElement("button");
            incBtn.type = "button";
            incBtn.className = btnClass;
            incBtn.textContent = incomeDoneButtonLabel;
            incStack.appendChild(incBtn);
            incSlot.appendChild(incStack);
          }
          /* Do not re-apply .runtime-hud-root--cardplay-panel-only during host income: that class hides
           * #hud-main-panel, which contains #control-voice-text where the mirrored income grid is painted
           * (same as public TV). Conquest-after-deploy keeps risqueConquestChainActive true here. */
          requestAnimationFrame(function () {
            if (window.risqueRuntimeHud) window.risqueRuntimeHud.syncPosition();
          });
        } else {
          uiOverlay.innerHTML =
            '<div class="income-player-name" style="color: ' +
            playerColor +
            '">' +
            currentPlayer.name +
            "'s Income</div>" +
            incomeTableBlock;
        }
        uiOverlay.classList.add("visible");
        logToStorage(useHud ? "UI overlay updated (income — HUD slot = public income grid + breakdown voice)" : "UI overlay updated with income table", {
          territoryBonus: territoryBonus,
          bookBonus: bookBonus,
          continentBonus: continentBonus,
          total: total,
          bookPlayedThisTurn: gameState.bookPlayedThisTurn
        });
        var confirmButton = document.querySelector(".income-button");
        var PUBLIC_INCOME_GATE_KEY = "risquePublicIncomeGateAck";
        var incomeGateToken = gameState.risquePublicIncomeGateToken;
        function incomeGateAckMatches() {
          if (!incomeGateToken || window.risqueDisplayIsPublic) return true;
          try {
            var raw = localStorage.getItem(PUBLIC_INCOME_GATE_KEY);
            var ack = raw ? JSON.parse(raw) : null;
            return !!(ack && ack.token === incomeGateToken);
          } catch (eAck) {
            return false;
          }
        }
        var incomeGatePoll = null;
        if (confirmButton) {
          logToStorage("Confirm button bound");
          if (incomeGateToken && !window.risqueDisplayIsPublic && !incomeGateAckMatches()) {
            confirmButton.disabled = true;
            confirmButton.textContent = "Waiting for public display…";
            incomeGatePoll = setInterval(function () {
              if (incomeGateAckMatches()) {
                confirmButton.disabled = false;
                confirmButton.textContent = incomeDoneButtonLabel;
                if (incomeGatePoll) {
                  clearInterval(incomeGatePoll);
                  incomeGatePoll = null;
                }
              }
            }, 250);
            window.addEventListener("storage", function incomeGateStorage(ev) {
              if (ev.key !== PUBLIC_INCOME_GATE_KEY) return;
              if (incomeGateAckMatches() && confirmButton) {
                confirmButton.disabled = false;
                confirmButton.textContent = incomeDoneButtonLabel;
                if (incomeGatePoll) {
                  clearInterval(incomeGatePoll);
                  incomeGatePoll = null;
                }
              }
            });
            setTimeout(function () {
              if (!confirmButton || !incomeGateToken) return;
              if (incomeGateAckMatches()) return;
              logToStorage("Income gate: long timeout — enabling confirm without TV ack", {});
              confirmButton.disabled = false;
              confirmButton.textContent = incomeDoneButtonLabel;
              if (incomeGatePoll) {
                clearInterval(incomeGatePoll);
                incomeGatePoll = null;
              }
            }, 120000);
          }
          var handleConfirm = function () {
            logToStorage("Confirm button clicked");
            if (incomeGateToken && !window.risqueDisplayIsPublic && !incomeGateAckMatches()) {
              return;
            }
            if (typeof window.risqueClearCardplayPublicSpectatorForMirror === "function") {
              window.risqueClearCardplayPublicSpectatorForMirror();
            }
            if (
              window.risqueRuntimeHud &&
              typeof window.risqueRuntimeHud.setControlVoiceText === "function"
            ) {
              window.risqueRuntimeHud.setControlVoiceText(
                "CONFIRMED. +" + total + " TO BANK. NEXT: DEPLOYMENT.",
                "",
                { force: true }
              );
            }
            try {
              delete gameState.risquePublicIncomeBreakdown;
            } catch (eRmInc) {
              /* ignore */
            }
            currentPlayer.bankValue = total;
            var standardIncomeContinentKeys = [];
            for (var continent in window.gameUtils.continents) {
              if (
                Object.prototype.hasOwnProperty.call(window.gameUtils.continents, continent)
              ) {
                var territories = window.gameUtils.continents[continent];
                if (
                  territories.every(function (t) {
                    return currentPlayer.territories.some(function (pt) {
                      return pt.name === t;
                    });
                  })
                ) {
                  gameState.continentCollectionCounts[continent] =
                    (gameState.continentCollectionCounts[continent] || 0) + 1;
                  standardIncomeContinentKeys.push(continent);
                }
              }
            }
            try {
              gameState.risqueConquestStandardIncomeContinentKeysMeta = {
                round: gameState.round,
                player: gameState.currentPlayer,
                keys: standardIncomeContinentKeys
              };
            } catch (eStdMeta) {
              /* ignore */
            }
            try {
              delete gameState.risqueConquestAttackEntryTurnKey;
              delete gameState.risqueConquestAttackEntryContinents;
              if (window.gameUtils && typeof window.gameUtils.clearRisqueConquestAttackStartSession === "function") {
                window.gameUtils.clearRisqueConquestAttackStartSession();
              }
            } catch (eAtkClr) {
              /* ignore */
            }
            gameState.bookPlayedThisTurn = false;
            currentPlayer.bookValue = 0;
            localStorage.setItem("gameState", JSON.stringify(sanitizeGameState(gameState)));
            logToStorage("Game state updated after income", {
              bankValue: currentPlayer.bankValue,
              phase: gameState.phase,
              bookPlayedThisTurn: gameState.bookPlayedThisTurn,
              bookValue: currentPlayer.bookValue
            });
            if (uiOverlay) uiOverlay.classList.remove("fade-out");
            setTimeout(function () {
              var dest = legacyNext;
              // Convert old legacy destination into runtime URL if needed.
              /* Old continental / saved URLs pointed at deploy2.html; canonical deploy is game.html?phase=deploy&kind=turn */
              if (typeof dest === "string" && dest.indexOf("deploy2.html") !== -1) {
                dest = "game.html?phase=deploy&kind=turn";
              }
              if (window.risqueNavigateWithFade) {
                window.risqueNavigateWithFade(dest);
              } else {
                window.location.href = dest;
              }
            }, 0);
          };
          confirmButton.addEventListener("click", handleConfirm);
          confirmButton.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") handleConfirm();
          });
        } else {
          console.error("[Income] Confirm button not found");
          window.gameUtils.showError("Confirm button not found");
        }
        console.log("[Income] Income UI rendering completed");
        window.gameUtils.initGameView();
        window.gameUtils.renderTerritories(null, gameState);
        window.gameUtils.renderStats(gameState);
      } catch (e) {
        console.error("[Income] Failed to initialize:", e.message);
        window.gameUtils.showError("Failed to initialize income phase");
        setTimeout(function () {
          window.location.href = loginRecoveryHref();
        }, 2000);
      }
    }

    injectStyles();

    if (!window.gameUtils) {
      console.error("[Income] gameUtils missing");
      return;
    }

    var gameState = window.gameState;
    if (!gameState || !window.gameUtils.validateGameState(gameState)) {
      logToStorage("Invalid game state at income mount");
      window.gameUtils.showError("Invalid game state");
      setTimeout(function () {
        window.location.href = loginRecoveryHref();
      }, 2000);
      return;
    }

    ensureContinentCollectionCounts(gameState);
    applyRoundOneCardCap(gameState);
    logToStorage("Player card counts on load", {
      players: gameState.players.map(function (p) {
        return { name: p.name, cardCount: p.cardCount, cards: p.cards };
      })
    });
    try {
      localStorage.setItem("gameState", JSON.stringify(sanitizeGameState(gameState)));
    } catch (e2) {
      /* ignore */
    }

    gameState.phase = "income";
    try {
      localStorage.setItem("gameState", JSON.stringify(gameState));
    } catch (e3) {
      /* ignore */
    }

    incomeInit();
    if (window.gameUtils && window.gameUtils.resizeCanvas) {
      requestAnimationFrame(function () {
        window.gameUtils.resizeCanvas();
      });
    }
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.income = { mount: mount };
})();
