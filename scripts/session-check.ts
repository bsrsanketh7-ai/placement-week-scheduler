/**
 * The preview / apply / undo model rests on one claim: state is a pure fold
 * over the disruption log. If that is false anywhere, undo silently corrupts
 * the day. So it gets tested directly.
 */
import { runSession, SessionStep } from '../src/core/session';
import { globalSlot } from '../src/core/types';

const config = {
  seed: 42, noticeSlots: 2, maxDisplacements: 12,
  overtimeMinutes: 60, backfillUnscheduled: false,
};
const now = globalSlot(0, 10 * 60);

const fingerprint = (v: ReturnType<typeof runSession>) =>
  v.schedule.assignments
    .map((a) => `${a.studentId}|${a.companyId}|${a.startSlot}|${a.roomId}`)
    .sort().join(';');

const step: SessionStep = {
  at: now,
  disruptions: [
    { type: 'COMPANY_LATE', companyId: 'C06', delayMinutes: 180 },
    { type: 'STUDENT_WITHDRAW', studentIds: ['S001', 'S002', 'S003'] },
  ],
};

const base = runSession(config, []);
const baseAgain = runSession(config, []);
const previewed = runSession(config, [], step);
const applied = runSession(config, [step]);
const undone = runSession(config, []);

const checks: Array<[string, boolean]> = [
  ['rebuild is deterministic', fingerprint(base) === fingerprint(baseAgain)],
  ['preview matches what applying produces', fingerprint(previewed) === fingerprint(applied)],
  ['preview does not mutate the committed state', fingerprint(base) === fingerprint(undone)],
  ['undo returns exactly to the previous state', fingerprint(undone) === fingerprint(base)],
  ['preview carries a diff', previewed.lastDiff !== null],
  ['committed view carries no diff', applied.lastDiff === null],
  ['rebuild is fast enough to be interactive', base.rebuildMs < 500],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(pass ? ' ok  ' : ' FAIL', name);
  if (!pass) failed++;
}
console.log('\nrebuild time:', base.rebuildMs, 'ms');
if (failed) process.exit(1);
console.log('session model holds');
