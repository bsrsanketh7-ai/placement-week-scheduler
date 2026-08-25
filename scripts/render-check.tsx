/** Smoke test: the dashboard must render without throwing, on real data. */
import { renderToString } from 'react-dom/server';
import React from 'react';
import Dashboard from '../app/page';

const t0 = Date.now();
const html = renderToString(React.createElement(Dashboard));
const ms = Date.now() - t0;

const checks: Array<[string, boolean]> = [
  ['renders room labels', /A-101/.test(html)],
  ['renders the now marker', /nowline/.test(html)],
  ['renders day tabs', /Day\s*(<!-- -->)?4/.test(html)],
  ['renders the freeze band', /freeze/.test(html)],
  ['renders interview blocks', (html.match(/class="block/g) ?? []).length > 20],
  ['shows coverage', /interviews placed/.test(html)],
  ['no summary before preview', !/Cost of this replan/.test(html)],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(pass ? ' ok  ' : ' FAIL', name);
  if (!pass) failed++;
}
console.log(`\nrendered ${html.length} chars in ${ms}ms`);
console.log('interview blocks on screen:', (html.match(/class="block/g) ?? []).length);
if (failed) process.exit(1);
console.log('dashboard renders clean');
