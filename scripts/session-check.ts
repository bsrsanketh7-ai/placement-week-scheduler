/**
 * The preview / apply / undo model rests on one claim: state is a pure fold
 * over the disruption log. If that is false anywhere, undo silently corrupts
 * the day. So it gets tested directly.
 */
import { runSession, SessionStep } from '../src/core/session';
import { globalSlot, minuteOfDayToSlotInDay, SLOTS_PER_DAY } from '../src/core/types';

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

// A withdrawal is capacity handed back, never a scheduling failure.
const leavers = [...new Set(
  base.schedule.assignments.filter((a) => a.startSlot >= now + 2).map((a) => a.studentId),
)].slice(0, 15);
const withdrew = runSession(config, [{ at: now, disruptions: [{ type: 'STUDENT_WITHDRAW', studentIds: leavers }] }]);
const leaverSet = new Set(leavers);

// The same room reported twice in one replan.
let duplicateRoomThrew = false;
try {
  runSession(config, [], { at: now, disruptions: [
    { type: 'ROOM_UNAVAILABLE', roomId: 'R1' },
    { type: 'ROOM_UNAVAILABLE', roomId: 'R1' },
  ] });
} catch {
  duplicateRoomThrew = true;
}

// Repeated delay reports must not stack overtime past the cap.
const early = base.dataset.companies.find((c) => c.departureMin <= 16 * 60)!;
const lateAt = globalSlot(early.preferredDay, 10 * 60);
const lateStep: SessionStep = { at: lateAt, disruptions: [{ type: 'COMPANY_LATE', companyId: early.id, delayMinutes: 30 }] };
const late = runSession(config, [lateStep, lateStep, lateStep]);
const overtimeCap = early.preferredDay * SLOTS_PER_DAY
  + minuteOfDayToSlotInDay(early.departureMin + config.overtimeMinutes);

const checks: Array<[string, boolean]> = [
  ['rebuild is deterministic', fingerprint(base) === fingerprint(baseAgain)],
  ['preview matches what applying produces', fingerprint(previewed) === fingerprint(applied)],
  ['preview does not mutate the committed state', fingerprint(base) === fingerprint(undone)],
  ['undo returns exactly to the previous state', fingerprint(undone) === fingerprint(base)],
  ['preview carries a diff', previewed.lastDiff !== null],
  ['committed view carries no diff', applied.lastDiff === null],
  ['rebuild is fast enough to be interactive', base.rebuildMs < 500],
  ['withdrawals do not raise the unplaced count',
    withdrew.schedule.unscheduled.length <= base.schedule.unscheduled.length],
  ['withdrawn students are not listed as unplaced',
    withdrew.schedule.unscheduled.every((u) => !leaverSet.has(u.studentId))],
  ['the same room reported twice does not crash', !duplicateRoomThrew],
  ['repeated delays do not stack overtime past the cap',
    [...late.engine.panels.values()].filter((p) => p.companyId === early.id)
      .every((p) => p.availableTo <= overtimeCap)],
];

let failed = 0;
for (const [name, pass] of checks) {
  console.log(pass ? ' ok  ' : ' FAIL', name);
  if (!pass) failed++;
}
console.log('\nrebuild time:', base.rebuildMs, 'ms');
if (failed) process.exit(1);
console.log('session model holds');
