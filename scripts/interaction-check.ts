/**
 * Interaction test for the coordinator console.
 *
 * Rendering to a string proves the markup is valid. It does not prove that
 * clicking the replan button produces a change summary, which is the feature
 * the whole tool exists for. So this mounts the real component in a simulated
 * DOM and drives it the way a coordinator would: choose a company, add three
 * disruptions, press preview, then apply.
 *
 * Asserted along the way:
 *   - the summary panel does not exist until preview is pressed
 *   - previewing produces moves, ghosts, escalations and a churn figure
 *   - preview does not commit anything
 *   - applying commits, and the summary goes away
 */

import { JSDOM } from 'jsdom';
import React from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
});

/**
 * Node 22 exposes `navigator` as a getter-only global, so a plain assignment
 * throws. defineProperty works for every one of these uniformly.
 */
const g = globalThis as unknown as Record<string, unknown>;
const put = (key: string, value: unknown) =>
  Object.defineProperty(g, key, { value, writable: true, configurable: true });

put('window', dom.window);
put('document', dom.window.document);
put('navigator', dom.window.navigator);
put('HTMLElement', dom.window.HTMLElement);
put('HTMLSelectElement', dom.window.HTMLSelectElement);
put('Element', dom.window.Element);
put('Node', dom.window.Node);
put('Event', dom.window.Event);
put('MouseEvent', dom.window.MouseEvent);
put('getComputedStyle', dom.window.getComputedStyle);
put('requestAnimationFrame', (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0));
put('cancelAnimationFrame', (id: number) => clearTimeout(id));
put('IS_REACT_ACT_ENVIRONMENT', true);

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const Dashboard = (await import('../app/page')).default;

const container = dom.window.document.getElementById('root')!;
const root = createRoot(container);

await act(async () => { root.render(React.createElement(Dashboard)); });

const $ = (sel: string) => container.querySelector(sel);
const $$ = (sel: string) => [...container.querySelectorAll(sel)];
const text = () => container.textContent ?? '';

function byLabel(tag: string, label: string) {
  return $$(tag).find((el) => (el.textContent ?? '').trim().startsWith(label)) as
    HTMLElement | undefined;
}

async function click(el: Element | null | undefined, what: string) {
  if (!el) throw new Error(`could not find ${what}`);
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
}

async function setSelect(id: string, value: string) {
  const el = $(`#${id}`) as HTMLSelectElement | null;
  if (!el) throw new Error(`no select #${id}`);
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLSelectElement.prototype, 'value',
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}

const results: Array<[string, boolean, string?]> = [];
const check = (name: string, pass: boolean, detail?: string) =>
  results.push([name, pass, detail]);

/* ---------- initial state ---------- */
check('grid renders every room', $$('.roomlabel').length === 20);
check('interviews are on the board', $$('.block').length > 100);
check('the NOW label appears exactly once', $$('.nowline.labelled').length === 1);
check('no summary before previewing', $('.summary') === null);
check('no ghosts before previewing', $$('.ghost').length === 0);

/* ---------- upcoming conflicts ---------- */
// Requirement 4 asks for upcoming conflicts, not just current state. These are
// schedules that are legal right now and one delay away from not being.
check('the upcoming conflicts strip is present', $('.risks') !== null);
check('conflicts are listed', $$('.risk').length > 0, `${$$('.risk').length} risks`);
check('each conflict explains itself',
  $$('.risk').every((r) => (r.querySelector('.risk-detail')?.textContent ?? '').length > 20));
check('conflicts are severity ranked',
  $$('.risk').length === 0 || $$('.risk')[0].className.includes('high')
  || $$('.risk')[0].className.includes('medium'));

/* ---------- the unplaced breakdown ---------- */
// The brief is explicit that nothing may fail silently, so the unplaced count
// has to be openable and every entry has to carry a stated reason.
check('the room gutter names the company holding it',
  $$('.rl-company').some((el) => (el.textContent ?? '').length > 0));
check('blocks carry student names, not repeated company names', (() => {
  const row = $$('.track')[2];
  const labels = [...row.querySelectorAll('.block')].map((b) => b.textContent);
  return new Set(labels).size > 1;
})(), 'a room row shows more than one distinct label');

await click($('.statbtn'), 'unplaced stat button');
check('the unplaced count opens a breakdown', $('.summary') !== null);
check('reasons are given in plain language', /ran out of panel time|clashed with every free slot/.test(text()));
check('worst affected companies are named', /could not be placed/.test(text()));
check('the per day shortfall is shown', /oversubscribed|fits/.test(text()));
await click(byLabel('button', 'Close'), 'close button');
check('the breakdown closes again', $('.summary') === null);

/* ---------- build a three part disruption ---------- */
// Onward Digital is the biggest Day 1 recruiter in seed 42.
const companySelect = $('#co') as HTMLSelectElement;
const onward = [...companySelect.options].find((o) => o.text.includes('Onward Digital'));
await setSelect('co', onward!.value);
await click(byLabel('button', 'Add to this replan'), 'add button');
check('a queued disruption appears', $$('.queued li').length === 1, text().slice(0, 0));

await setSelect('kind', 'PANEL_DROP');
const panelSelect = $('#pn') as HTMLSelectElement;
const onwardPanel = [...panelSelect.options].find((o) => o.text.includes('Onward Digital'));
await setSelect('pn', onwardPanel!.value);
await click(byLabel('button', 'Add to this replan'), 'add button');

await setSelect('kind', 'STUDENT_WITHDRAW');
await click(byLabel('button', 'Add to this replan'), 'add button');
check('three disruptions are queued', $$('.queued li').length === 3);
check('still nothing committed', $('.summary') === null);

/* ---------- preview ---------- */
await click(byLabel('button', 'Show me what this changes'), 'preview button');

const summary = $('.summary');
check('preview opens the summary panel', summary !== null);
check('the summary reports moves', /\d+ moved/.test(text()));
check('a churn percentage is shown', /churn \d/.test(text()));
check('ghost traces are drawn on the grid', $$('.ghost').length > 0,
  `${$$('.ghost').length} ghosts`);
check('moved interviews are highlighted', $$('.block.moved').length > 0,
  `${$$('.block.moved').length} moved blocks`);
check('escalations are surfaced', $$('.escalation').length > 0,
  `${$$('.escalation').length} escalations`);
check('escalations name their options', $$('.escalation li').length >= 4);
check('withdrawn students are not counted as failures',
  /handed back by students who left/.test(text()));
check('apply and discard are both offered',
  byLabel('button', 'Apply these changes') !== undefined
  && byLabel('button', 'Discard') !== undefined);
check('nothing was applied yet', $$('.queued li').length === 3);

const movedCount = $$('.changecol li.move').length;

/* ---------- apply ---------- */
await click(byLabel('button', 'Apply these changes'), 'apply button');
check('applying closes the summary', $('.summary') === null);
check('the draft is cleared', $$('.queued li').length === 1,
  'one entry remains, in the applied-today log');
check('the change is now committed', /Undo the last replan/.test(text()));
check('ghosts are gone once committed', $$('.ghost').length === 0);

/* ---------- undo ---------- */
await click(byLabel('button', 'Undo the last replan'), 'undo button');
check('undo removes the applied replan', !/Undo the last replan/.test(text()));

/* ---------- report ---------- */
let failed = 0;
for (const [name, pass, detail] of results) {
  console.log(pass ? ' ok  ' : ' FAIL', name, detail ? `(${detail})` : '');
  if (!pass) failed++;
}
console.log(`\nmoved rows listed in the summary: ${movedCount}`);
if (failed) {
  console.error(`${failed} interaction check(s) failed`);
  process.exit(1);
}
console.log('the console behaves correctly under real clicks');