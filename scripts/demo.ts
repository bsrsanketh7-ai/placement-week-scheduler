import { generateDataset } from '../src/core/generator';
import { buildSchedule } from '../src/core/scheduler';
import { computeMetrics, explainUnscheduled } from '../src/core/metrics';
import { formatSlot } from '../src/core/types';

const seed = Number(process.argv[2] ?? 42);
const t0 = Date.now();
const dataset = generateDataset(seed);
const { engine, schedule } = buildSchedule(dataset);
const metrics = computeMetrics(dataset, schedule);
const ms = Date.now() - t0;

console.log('=== DATASET ===');
console.log('seed', seed, '| students', dataset.students.length,
  '| companies', dataset.companies.length,
  '| rooms', dataset.rooms.length,
  '| panels requested', dataset.panels.length);

const roomed = [...engine.panels.values()].filter((p) => p.roomId).length;
console.log('panels given a room:', roomed, 'of', dataset.panels.length);

const listCounts = dataset.students.map((s) => s.shortlistedBy.length);
const qCounts = dataset.students.map((s) => s.interviewingWith.length);
const avg = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2);
console.log('shortlists per student: avg', avg(listCounts), 'max', Math.max(...listCounts));
console.log('interviews per student: avg', avg(qCounts), 'max', Math.max(...qCounts));
console.log('students with 4+ interviews:', qCounts.filter((n) => n >= 4).length);

console.log('\n=== FEASIBILITY ===');
console.log('demand', metrics.demandMinutes, 'min | capacity', metrics.capacityMinutes,
  'min | structural shortfall', metrics.structuralShortfallPct.toFixed(1) + '%');

console.log('\n=== SCHEDULE ===');
console.log('built in', ms, 'ms');
console.log('scheduled', metrics.scheduledInterviews, 'of', metrics.demandedInterviews,
  '=', metrics.coveragePct.toFixed(1) + '%');
console.log('student clashes', metrics.studentClashes,
  '| room double bookings', metrics.roomDoubleBookings,
  '| panel double bookings', metrics.panelDoubleBookings);
console.log('room utilisation', metrics.roomUtilisationPct.toFixed(1) + '%');
console.log('avg student idle', metrics.avgStudentIdleMinutes.toFixed(0), 'min | max',
  metrics.maxStudentIdleMinutes, 'min');
console.log('students in a queue but with zero interviews:', metrics.studentsWithZeroInterviews);

console.log('\n=== WHY THINGS DID NOT FIT ===');
const ex = explainUnscheduled(dataset, schedule);
console.log(ex.byReason);
console.table(ex.worstAffected);

console.log('\n=== SAMPLE DAY 1 ===');
for (const a of schedule.assignments.filter((x) => x.startSlot < 34).slice(0, 8)) {
  console.log(' ', formatSlot(a.startSlot), engine.describe(a));
}

console.log('\n=== PER DAY FEASIBILITY ===');
console.table(computeMetrics(dataset, schedule).perDay.map((d) => ({
  day: d.day,
  demanded: d.demandedInterviews,
  scheduled: d.scheduledInterviews,
  coverage: d.coveragePct.toFixed(0) + '%',
  panelsWanted: d.panelsRequested,
  rooms: d.roomsAvailable,
  oversubscribed: d.oversubscribedPct.toFixed(0) + '%',
})));
