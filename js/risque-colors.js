/**
 * Canonical player color registry used across login, map markers, stats, and phase UIs.
 * Change values here to update colors everywhere.
 */
(function () {
  "use strict";

  var BASE = {
    blue: "#87bfff",
    red: "#ff0000",
    yellow: "#ffff00",
    green: "#ff9800",
    pink: "#ff69b4",
    white: "#f8fafc"
  };

  /** Backward compatibility: old saves may still store "black". */
  var ALIASES = {
    black: "white"
  };

  var ORDER = ["blue", "red", "yellow", "green", "pink", "white"];

  function normalizeName(name) {
    var k = name != null ? String(name).trim().toLowerCase() : "";
    if (ALIASES[k]) return ALIASES[k];
    return Object.prototype.hasOwnProperty.call(BASE, k) ? k : "";
  }

  function hex(name) {
    var k = normalizeName(name);
    return (k && BASE[k]) || "#808080";
  }

  function statsUseLightText(name) {
    var k = normalizeName(name);
    return k === "red" || k === "pink";
  }

  /**
   * Center fill for owned territory markers (ring still uses player color).
   * Keep this here so marker center tint is a one-file change.
   */
  function markerOwnedCenterFill() {
    return "#000000";
  }

  /** Inner separator on the color ring to split ring from marker center/fluid. */
  function markerRingInnerStroke() {
    return { color: "#000000", width: 2 };
  }

  /** Map/render saturation multiplier (1 = unchanged). */
  function mapSaturation() {
    return 0.40625;
  }

  function applyCssVars() {
    if (!document || !document.documentElement || !document.documentElement.style) return;
    var st = document.documentElement.style;
    ORDER.forEach(function (k) {
      st.setProperty("--risque-color-" + k, BASE[k]);
    });
  }

  window.risquePlayerColors = {
    base: Object.assign({}, BASE),
    aliases: Object.assign({}, ALIASES),
    order: ORDER.slice(),
    normalizeName: normalizeName,
    hex: hex,
    statsUseLightText: statsUseLightText,
    markerOwnedCenterFill: markerOwnedCenterFill,
    markerRingInnerStroke: markerRingInnerStroke,
    mapSaturation: mapSaturation,
    applyCssVars: applyCssVars
  };

  /* Convenience APIs for legacy call sites. */
  window.risqueColorHex = hex;
  window.risqueColorNormalizeName = normalizeName;
  window.risqueStatsUseLightText = statsUseLightText;
  window.risqueMarkerOwnedCenterFill = markerOwnedCenterFill;
  window.risqueMarkerRingInnerStroke = markerRingInnerStroke;
  window.risqueMapSaturation = mapSaturation;

  try {
    applyCssVars();
  } catch (e) {
    /* ignore */
  }
})();


