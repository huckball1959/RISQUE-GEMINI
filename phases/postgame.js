/**
 * Postgame reflection: after win celebration, host stays on the map with full HUD
 * (stats, lucky, combat log, cards played) until they exit to the menu.
 */
(function () {
  "use strict";

  var REVIEW_TOP_ID = "risque-postgame-review-topbar";

  function removeStaleTopbarReview() {
    var old = document.getElementById(REVIEW_TOP_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
  }

  function mount(stageHost, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    var uiOverlay = document.getElementById("ui-overlay");
    if (!uiOverlay || !window.gameUtils) return;

    var stalePrompt = document.getElementById("prompt");
    if (stalePrompt && stalePrompt.parentNode) stalePrompt.parentNode.removeChild(stalePrompt);
    if (typeof window.risqueDismissAttackPrompt === "function") {
      window.risqueDismissAttackPrompt();
    }

    window.handleTerritoryClick = window.handleTerritoryClick || null;

    var wname =
      window.gameState && window.gameState.winner ? String(window.gameState.winner) : "Winner";

    uiOverlay.classList.add("visible");
    uiOverlay.classList.remove("fade-out");

    if (window.gameState) {
      window.gameState.phase = "postgame";
      try {
        localStorage.setItem("gameState", JSON.stringify(window.gameState));
      } catch (e) {
        /* ignore */
      }
    }

    if (window.risqueRuntimeHud) {
      window.risqueRuntimeHud.ensure(uiOverlay);
      window.risqueRuntimeHud.clearPhaseSlot();
      window.risqueRuntimeHud.setAttackChromeInteractive(false);
      if (window.gameState) {
        window.risqueRuntimeHud.updateTurnBannerFromState(window.gameState);
      }

      if (typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
        window.risqueRuntimeHud.setControlVoiceText(
          String(wname).toUpperCase() + " WINS — POSTGAME REVIEW",
          "STATS, LUCKY, and CARDS PLAYED stay available here. Full match replay (deal through end) opens in Wayback — auto-starts once after the win screen when your browser allows pop-ups.",
          {
            force: true
          }
        );
      }

      removeStaleTopbarReview();

      var rSlot = document.getElementById("risque-phase-content");
      if (rSlot) {
        rSlot.innerHTML =
          '<div class="postgame-compact-root">' +
          '<p class="postgame-compact-title">POSTGAME</p>' +
          '<p class="postgame-compact-copy">' +
          "Map and statistics are frozen here. Wayback plays the full animated replay (including the deal). Exit clears this session." +
          "</p>" +
          '<div class="postgame-compact-actions">' +
          (!window.risqueDisplayIsPublic
            ? '<button type="button" class="postgame-btn postgame-btn--secondary" id="risque-postgame-watch-replay" title="Opens Wayback with this match’s tape and starts playback (same as board REPLAY, plus auto-play)">' +
              "WATCH FULL REPLAY" +
              "</button>" +
              '<button type="button" class="postgame-btn postgame-btn--secondary" id="risque-postgame-archive-replay" title="Writes one full-session replay JSON into your save folder (Wayback-ready)">' +
              "ARCHIVE GAME REPLAY" +
              "</button>"
            : "") +
          '<button type="button" class="postgame-btn postgame-btn--primary" id="risque-postgame-exit">' +
          "EXIT TO MENU" +
          "</button>" +
          "</div>" +
          "</div>";
      }

      requestAnimationFrame(function () {
        try {
          var main = document.getElementById("hud-main-panel");
          var strip = document.getElementById("ucp-slot-strip");
          var root = document.querySelector("#risque-phase-content .postgame-compact-root");
          if (root && main && strip && root.parentNode) {
            main.insertBefore(root, strip);
          }
        } catch (eMove) {
          /* ignore */
        }
        var watchBtn = document.getElementById("risque-postgame-watch-replay");
        if (watchBtn) {
          watchBtn.addEventListener("click", function () {
            if (window.risqueDisplayIsPublic) return;
            if (typeof window.risqueOpenReplayMachineFromHost === "function") {
              window.risqueOpenReplayMachineFromHost({ replayAutoplay: true });
            }
          });
        }
        var archBtn = document.getElementById("risque-postgame-archive-replay");
        if (archBtn) {
          archBtn.addEventListener("click", function () {
            if (window.risqueDisplayIsPublic) return;
            archBtn.disabled = true;
            var p =
              typeof window.risqueArchivePostgameReplay === "function"
                ? window.risqueArchivePostgameReplay(window.gameState)
                : Promise.resolve({ ok: false, reason: "missing api" });
            Promise.resolve(p).then(function (r) {
              archBtn.disabled = false;
              var msg;
              if (r && r.ok && r.path && !r.downloaded) {
                msg =
                  "Saved " +
                  r.path +
                  " in your save folder. Open it in Wayback (replay-machine). Default launcher uses a flat folder (e.g. C:\\risque\\save).";
              } else if (r && r.ok && r.downloaded) {
                msg =
                  "Replay JSON downloaded (no connected SAVE folder). Connect SAVE once in round autosave to write straight into your save folder next time.";
              } else if (r && r.reason === "no tape") {
                msg = "No replay tape found — nothing to archive.";
              } else if (r && r.reason === "empty tape") {
                msg = "Replay tape is empty.";
              } else {
                msg = "Could not write archive. Try again or use REPLAY from the board.";
              }
              if (window.risqueRuntimeHud && typeof window.risqueRuntimeHud.setControlVoiceText === "function") {
                window.risqueRuntimeHud.setControlVoiceText("ARCHIVE", msg, { force: true });
              }
              if (typeof onLog === "function") {
                onLog("Archive game replay", r || {});
              }
            });
          });
        }
        var exitBtn = document.getElementById("risque-postgame-exit");
        if (exitBtn) {
          exitBtn.addEventListener("click", function () {
            var dest =
              typeof window.risqueLoginRecoveryUrl === "function"
                ? window.risqueLoginRecoveryUrl()
                : "game.html?phase=login";
            try {
              localStorage.removeItem("gameState");
            } catch (eLs) {
              /* ignore */
            }
            if (typeof window.risqueNavigateWithFade === "function") {
              window.risqueNavigateWithFade(dest);
            } else {
              window.location.href = dest;
            }
          });
        }
        if (!window.risqueDisplayIsPublic && typeof window.risqueOpenReplayMachineFromHost === "function") {
          try {
            var sk =
              window.gameState && window.gameState.risqueReplayTapeSessionKey
                ? String(window.gameState.risqueReplayTapeSessionKey)
                : "";
            var autoFlagKey = sk ? "risquePgReplayAuto:" + sk : "risquePgReplayAuto:anon";
            if (!sessionStorage.getItem(autoFlagKey)) {
              sessionStorage.setItem(autoFlagKey, "1");
              window.setTimeout(function () {
                try {
                  if (
                    window.gameState &&
                    String(window.gameState.phase || "") === "postgame" &&
                    typeof window.risqueOpenReplayMachineFromHost === "function"
                  ) {
                    window.risqueOpenReplayMachineFromHost({ replayAutoplay: true });
                  }
                } catch (eAutoReplay) {
                  /* ignore */
                }
              }, 1800);
            }
          } catch (eSsAuto) {
            /* ignore */
          }
        }
        window.risqueRuntimeHud.syncPosition();
      });
    }

    requestAnimationFrame(function () {
      window.gameUtils.resizeCanvas();
      window.gameUtils.renderTerritories(null, window.gameState);
      window.gameUtils.renderStats(window.gameState);
    });

    if (typeof onLog === "function") {
      onLog("Postgame mounted", { winner: wname });
    }
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.postgame = { mount: mount, removeStaleTopbarReview: removeStaleTopbarReview };
})();
