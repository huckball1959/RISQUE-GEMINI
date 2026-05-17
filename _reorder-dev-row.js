const fs = require("fs");
const p = "phases/runtime-hud.js";
let c = fs.readFileSync(p, "utf8");
const d = "motion".replace("motion", "div");
const logLine =
  "      '<" + d + ' id="log-text" class="ucp-terminal ucp-combat-log" aria-live="polite"></' + d + ">' +";
const devBlock =
  "      '<" +
  d +
  ' id="attack-dev-row-strip" class="ucp-slot-strip attack-dev-row-strip" aria-label="Developer controls">' +\n' +
  "        '<" +
  d +
  ' class="ucp-slot-strip-main">' +\n' +
  "        (typeof window.buildAttackDevRowInnerHtml === \"function\"\n" +
  "          ? window.buildAttackDevRowInnerHtml()\n" +
  '          : "") +\n' +
  '        "</' +
  d +
  '>" +\n' +
  '      "</' +
  d +
  '>" +\n';
const re =
  /      '<div id="log-text" class="ucp-terminal ucp-combat-log" aria-live="polite"><\/div>' \+\n      '<div id="attack-dev-row-strip"[\s\S]*?      "<\/motion>" \+\n/;
const reFixed =
  /      '<div id="log-text" class="ucp-terminal ucp-combat-log" aria-live="polite"><\/div>' \+\n      '<motion id="attack-dev-row-strip"[\s\S]*?      "<\/motion>" \+\n/;
let m = c.match(re);
if (!m) m = c.match(reFixed);
if (!m) {
  const re2 =
    /      '<div id="log-text" class="ucp-terminal ucp-combat-log" aria-live="polite"><\/div>' \+\n      '<div id="attack-dev-row-strip"[\s\S]*?      "<\/div>" \+\n/;
  if (!re2.test(c)) {
    console.error("pattern not found");
    process.exit(1);
  }
  c = c.replace(re2, devBlock + logLine + "\n");
} else {
  c = c.replace(re, devBlock + logLine + "\n");
}
fs.writeFileSync(p, c);
console.log("reordered");
