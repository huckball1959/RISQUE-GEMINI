/**
 * Reusable "private area" interstitial (legacy cardplay.html) as JS overlay.
 * Mount full-screen on document.body (or another host). Continue navigates or runs onContinue.
 */
(function () {
  "use strict";

  var STYLE_ID = "risque-privacy-gate-styles";

  /** Default target after user acknowledges (runtime cardplay shell). */
  var DEFAULT_NAVIGATE_TO = "game.html?phase=cardplay&legacyNext=income.html";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent =
      "#risque-privacy-overlay{position:fixed;inset:0;z-index:2147483646;margin:0;padding:0;" +
      "display:flex;flex-direction:column;justify-content:center;align-items:center;" +
      "background:#000000;font-family:Arial,sans-serif;box-sizing:border-box;}" +
      "#risque-privacy-overlay *{box-sizing:border-box;}" +
      "#risque-privacy-overlay .risque-privacy-message{font-size:32px;font-weight:bold;color:#fff;" +
      "text-align:center;margin:0 24px 20px;max-width:90vw;line-height:1.2;white-space:pre-line;}" +
      "#risque-privacy-overlay .risque-privacy-continue{width:200px;height:50px;background:#280b0b;" +
      "color:#fff;font-size:18px;font-weight:bold;border:none;border-radius:5px;cursor:pointer;}" +
      "#risque-privacy-overlay .risque-privacy-continue:hover{background:#3c1212;}" +
      "#risque-privacy-overlay .risque-privacy-continue:active{transform:scale(0.95);}";
    document.head.appendChild(s);
  }

  /**
   * Build a game shell URL that shows this gate then continues to `nextUrl`.
   * @param {string} [nextUrl] - defaults to cardplay + legacyNext income
   */
  function buildGateUrl(nextUrl) {
    var target = nextUrl || DEFAULT_NAVIGATE_TO;
    return "game.html?phase=privacyGate&next=" + encodeURIComponent(target);
  }

  function withHostSaveReminder(message) {
    var base = message != null ? String(message) : "";
    if (!base) return "Emergency save: Ctrl+S or Alt+S.";
    if (/ctrl\+s|alt\+s/i.test(base)) return base;
    return base + "\n\nEmergency save: Ctrl+S or Alt+S.";
  }

  /**
   * @param {HTMLElement} [parent] - default document.body
   * @param {object} [opts]
   * @param {string} [opts.message]
   * @param {string} [opts.buttonLabel]
   * @param {string} [opts.navigateTo] - if set, assignment location after Continue (after onContinue unless it returns false)
   * @param {function():boolean|void} [opts.onContinue] - optional; return false to cancel navigation
   * @param {function(string)=} [opts.onLog]
   * @param {number} [opts.autoContinueAfterMs] - if positive, auto-clicks Continue after this delay (tablet handoff / restart banner)
   * @param {boolean} [opts.retainOverlayAfterContinue] - if true (and no navigateTo), keep the overlay after Continue (e.g. async browser restart — avoids revealing underlying UI).
   */
  function mount(parent, opts) {
    opts = opts || {};
    var onLog = opts.onLog;
    var message = opts.message || "You are about to enter a private page";
    var buttonLabel = opts.buttonLabel || "Continue";
    var navigateTo = opts.navigateTo;
    var onContinue = opts.onContinue;
    var retainOverlay = !!opts.retainOverlayAfterContinue;

    injectStyles();
    var existing = document.getElementById("risque-privacy-overlay");
    if (existing) existing.remove();

    var overlay = document.createElement("div");
    overlay.id = "risque-privacy-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Private area notice");
    overlay.innerHTML =
      '<p class="risque-privacy-message"></p>' +
      '<button type="button" class="risque-privacy-continue"></button>';
    overlay.querySelector(".risque-privacy-message").textContent = message;
    var btn = overlay.querySelector(".risque-privacy-continue");
    btn.textContent = buttonLabel;

    (parent || document.body).appendChild(overlay);

    var autoMs = opts.autoContinueAfterMs;
    if (typeof autoMs === "number" && autoMs > 0 && btn) {
      window.setTimeout(function () {
        try {
          if (document.getElementById("risque-privacy-overlay") === overlay && overlay.isConnected) {
            btn.click();
          }
        } catch (eAuto) {
          /* ignore */
        }
      }, autoMs);
    }

    function log(msg) {
      if (typeof onLog === "function") onLog(msg);
    }

    btn.addEventListener("click", function () {
      log("Privacy gate: Continue");
      var contOk = true;
      if (typeof onContinue === "function") {
        try {
          if (onContinue() === false) contOk = false;
        } catch (e) {
          console.error(e);
          /* In-place handoff (no navigateTo): do not leave a full-screen gate if the callback threw
           * (e.g. localStorage quota) — user would be stuck with no working Continue. */
          if (!navigateTo) {
            try {
              overlay.remove();
            } catch (eRm) {
              /* ignore */
            }
          }
          return;
        }
      }
      if (!contOk) return;
      if (navigateTo) {
        if (window.risqueNavigateWithFade) {
          window.risqueNavigateWithFade(navigateTo);
        } else {
          window.location.href = navigateTo;
        }
        overlay.remove();
      } else if (retainOverlay) {
        try {
          btn.disabled = true;
          btn.setAttribute("aria-hidden", "true");
          btn.style.visibility = "hidden";
        } catch (eRet) {
          /* ignore */
        }
      } else {
        /* In-place handoff: let the next frame(s) paint under the overlay so removing it does not flash. */
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            try {
              overlay.remove();
            } catch (eRm) {
              /* ignore */
            }
          });
        });
      }
    });
  }

  function unmount() {
    var el = document.getElementById("risque-privacy-overlay");
    if (el) el.remove();
  }

  /**
   * Hot-seat / stream: same full-screen shell as setup deploy handoff.
   * Skipped on public TV; if the gate is unavailable, runs onContinue immediately.
   */
  function mountHostTabletHandoff(opts) {
    opts = opts || {};
    var onContinue = opts.onContinue;
    var logFn = opts.onLog;
    if (typeof onContinue !== "function") return;
    if (window.risqueDisplayIsPublic) {
      onContinue();
      return;
    }
    mount(document.body, {
      message: withHostSaveReminder(opts.message || "Continue"),
      buttonLabel: opts.buttonLabel || "Continue",
      onContinue: onContinue,
      onLog: logFn,
      autoContinueAfterMs:
        typeof opts.autoContinueAfterMs === "number" && opts.autoContinueAfterMs > 0 ? opts.autoContinueAfterMs : 0,
      retainOverlayAfterContinue: !!opts.retainOverlayAfterContinue
    });
  }

  window.risquePhases = window.risquePhases || {};
  window.risquePhases.privacyGate = {
    mount: mount,
    unmount: unmount,
    buildGateUrl: buildGateUrl,
    defaultNavigateTo: DEFAULT_NAVIGATE_TO,
    mountHostTabletHandoff: mountHostTabletHandoff
  };
})();
