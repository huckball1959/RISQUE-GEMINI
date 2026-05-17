const fs = require('fs');
const p = 'phases/attack.js';
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('  const condThresholdWrap =');
const end = s.indexOf('window.buildAttackToolbarStripButtonsInnerHtml = buildAttackToolbarStripButtonsInnerHtml;');
if (start < 0 || end < 0) {
  console.error('markers not found', start, end);
  process.exit(1);
}
const replacement = `  void opts;
  return (
    '<motion class="attack-toolbar-row--6 attack-toolbar-row--primary">' +
    '<button id="roll" class="attack-ctl-btn attack-ctl-roll" type="button" title="Single roll">ROLL</button>' +
    blitzDropdown +
    campaignDropdown +
    '<button id="new-attack" class="attack-ctl-btn attack-ctl-new" type="button" title="Cancel all attacks">CLR</button>' +
    '<button id="aerial-attack" class="attack-ctl-btn attack-ctl-aerial" type="button" title="First aerial bridge (wildcard)">AERIAL1</button>' +
    '<button id="aerial-attack-2" class="attack-ctl-btn attack-ctl-aerial" type="button" title="Second aerial bridge (wildcard)">AERIAL2</button>' +
    '</div>'
  );
}

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
`;
const fixed = replacement.replace(
  `'<motion class="attack-toolbar-row--6 attack-toolbar-row--primary">' +`,
  `'<div class="attack-toolbar-row--6 attack-toolbar-row--primary">' +`
);
s = s.slice(0, start) + fixed + s.slice(end);
if (!s.includes('window.buildAttackDevRowInnerHtml = buildAttackDevRowInnerHtml;')) {
  s = s.replace(
    'window.buildAttackToolbarStripButtonsInnerHtml = buildAttackToolbarStripButtonsInnerHtml;',
    'window.buildAttackToolbarStripButtonsInnerHtml = buildAttackToolbarStripButtonsInnerHtml;\nwindow.buildAttackDevRowInnerHtml = buildAttackDevRowInnerHtml;'
  );
}
fs.writeFileSync(p, s);
console.log('patched');
