/**
 * The defense session rehearsal.
 * "The biggest Day 1 recruiter is 3 hours late, one of its panels dropped,
 *  and 15 students just withdrew."
 */
import { generateDataset } from '../src/core/generator';
import { buildSchedule } from '../src/core/scheduler';
import { computeMetrics } from '../src/core/metrics';
import { replan, Disruption } from '../src/core/replan';
import { globalSlot, formatSlot } from '../src/core/types';

const seed = Number(process.argv[2] ?? 42);
const dataset = generateDataset(seed);
const { engine, schedule } = buildSchedule(dataset);
const before = computeMetrics(dataset, schedule);

// Biggest Day 1 recruiter by interview demand.
const day1 = dataset.companies.filter((c) => c.preferredDay === 0);
const biggest = day1.sort((a, b) => b.interviewQueue.length - a.interviewQueue.length)[0];
const victimPanel = [...engine.panels.values()].find((p) => p.companyId === biggest.id && p.roomId);

// 15 students who still have future interviews.
const now = globalSlot(0, 10 * 60); // 10:00 on Day 1
const withdrawers = [...new Set(
  engine.getAssignments().filter((a) => a.startSlot > now + 2).map((a) => a.studentId),
)].slice(0, 15);

const disruptions: Disruption[] = [
  { type: 'COMPANY_LATE', companyId: biggest.id, delayMinutes: 180 },
  { type: 'PANEL_DROP', panelId: victimPanel!.id },
  { type: 'STUDENT_WITHDRAW', studentIds: withdrawers },
];

console.log('=== BEFORE ===');
console.log('now:', formatSlot(now), '| scheduled', before.scheduledInterviews,
  '| coverage', before.coveragePct.toFixed(1) + '%');
console.log('biggest Day 1 recruiter:', biggest.name,
  `(${biggest.interviewQueue.length} queued, ${biggest.panelCount} panels wanted)`);

const { schedule: after, diff } = replan(engine, schedule, disruptions, {
  now, noticeSlots: 2, maxDisplacements: 12, overtimeMinutes: 60,
});
const m = computeMetrics(dataset, after);

console.log('\n=== DISRUPTIONS ===');
diff.disruptions.forEach((d) => console.log(' -', d));

console.log('\n=== CHANGE SUMMARY ===');
console.log('replanned in', diff.computeMs, 'ms');
console.log('frozen (already started or inside notice window):', diff.frozen);
console.log('displaced by the disruption:', diff.churn.displacedCount);
console.log('actually moved:', diff.moved.length,
  `(${diff.churn.movedPctOfFuture.toFixed(1)}% of remaining appointments)`);
console.log('  of which volunteered to make room:', diff.churn.volunteeredCount);
console.log('room only changes:', diff.roomChanged.length);
const withdrawnCancels = diff.cancelled.filter((c) => c.kind === 'WITHDRAWN').length;
const unplaceable = diff.cancelled.filter((c) => c.kind === 'UNPLACEABLE').length;
console.log('cancelled because the student left:', withdrawnCancels, '(capacity freed, not a failure)');
console.log('cancelled because nowhere to put them:', unplaceable);
console.log('students to notify:', diff.churn.studentsAffected,
  '| companies to notify:', diff.churn.companiesAffected);
console.log('notice violations:', diff.churn.noticeViolations);
console.log('untouched:', diff.untouched);

console.log('\n=== SAMPLE MOVES ===');
diff.moved.slice(0, 6).forEach((mv) => console.log(
  ` ${mv.ring.padEnd(12)} ${mv.studentName} / ${mv.companyName}: ` +
  `${formatSlot(mv.fromSlot)} -> ${formatSlot(mv.toSlot)} (${mv.deltaMinutes > 0 ? '+' : ''}${mv.deltaMinutes} min), room ${mv.toRoom}`,
));

console.log('\n=== ESCALATIONS FOR THE COORDINATOR ===');
diff.escalations.slice(0, 4).forEach((e) => {
  console.log(' ?', e.question, `[affects ${e.affects}]`);
  e.options.forEach((o) => console.log('    -', o));
});

console.log('\n=== AFTER ===');
console.log('coverage', before.coveragePct.toFixed(1) + '% ->', m.coveragePct.toFixed(1) + '%');
console.log('student clashes', m.studentClashes,
  '| room double bookings', m.roomDoubleBookings,
  '| panel double bookings', m.panelDoubleBookings);

if (m.studentClashes || m.roomDoubleBookings || m.panelDoubleBookings) {
  console.error('\nINVARIANT VIOLATION after replan');
  process.exit(1);
}
console.log('\ninvariants hold after replan');
