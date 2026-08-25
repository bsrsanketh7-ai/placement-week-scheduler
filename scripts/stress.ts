/**
 * Stress test. Randomised disruptions across many seeds, asserting the four
 * invariants after every replan.
 *
 * The point is not coverage. The point is that no sequence of disruptions can
 * ever produce a schedule that double books a room or puts a student in two
 * places at once. If that can happen even once in 500 runs, it will happen on
 * the day, in front of a company.
 */

import { generateDataset } from '../src/core/generator';
import { buildSchedule } from '../src/core/scheduler';
import { computeMetrics } from '../src/core/metrics';
import { replan, Disruption } from '../src/core/replan';
import { Rng } from '../src/core/rng';
import { globalSlot } from '../src/core/types';

const SEEDS = Number(process.argv[2] ?? 25);
const ROUNDS_PER_SEED = 4; // disruptions land on top of each other, like a real day

let runs = 0;
let failures = 0;
let totalMoved = 0;
let totalDisplaced = 0;
let worstChurn = 0;
let slowest = 0;
const coverageDrops: number[] = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const rng = new Rng(seed * 7919);
  const dataset = generateDataset(seed);
  const built = buildSchedule(dataset);
  const engine = built.engine;
  let schedule = built.schedule;
  const startCoverage = computeMetrics(dataset, schedule).coveragePct;

  for (let round = 0; round < ROUNDS_PER_SEED; round++) {
    const day = rng.int(0, 3);
    const now = globalSlot(day, 9 * 60 + rng.int(0, 12) * 30);

    const dayCompanies = dataset.companies.filter((c) => c.preferredDay === day);
    if (dayCompanies.length === 0) continue;
    const company = rng.pick(dayCompanies);
    const panels = [...engine.panels.values()].filter((p) => !p.dropped && p.roomId);
    if (panels.length === 0) break;

    const future = engine.getAssignments().filter((a) => a.startSlot > now + 2);
    const studentPool = [...new Set(future.map((a) => a.studentId))];

    const disruptions: Disruption[] = [];
    if (rng.bool(0.7)) {
      disruptions.push({ type: 'COMPANY_LATE', companyId: company.id, delayMinutes: rng.int(1, 6) * 30 });
    }
    if (rng.bool(0.6)) {
      disruptions.push({ type: 'PANEL_DROP', panelId: rng.pick(panels).id });
    }
    if (rng.bool(0.6) && studentPool.length > 0) {
      disruptions.push({
        type: 'STUDENT_WITHDRAW',
        studentIds: rng.shuffle(studentPool).slice(0, rng.int(1, 20)),
      });
    }
    if (rng.bool(0.4) && engine.rooms.size > 5) {
      disruptions.push({ type: 'ROOM_UNAVAILABLE', roomId: rng.pick([...engine.rooms.keys()]) });
    }
    if (disruptions.length === 0) continue;

    const result = replan(engine, schedule, disruptions, {
      now,
      noticeSlots: 2,
      maxDisplacements: 12,
      overtimeMinutes: 60,
      backfillUnscheduled: rng.bool(0.3),
    });
    schedule = result.schedule;
    const diff = result.diff;
    runs++;
    totalMoved += diff.moved.length;
    totalDisplaced += diff.churn.displacedCount;
    worstChurn = Math.max(worstChurn, diff.churn.movedPctOfFuture);
    slowest = Math.max(slowest, diff.computeMs);

    const m = computeMetrics(dataset, schedule);
    const problems: string[] = [];
    if (m.studentClashes) problems.push(`${m.studentClashes} student clashes`);
    if (m.roomDoubleBookings) problems.push(`${m.roomDoubleBookings} room double bookings`);
    if (m.panelDoubleBookings) problems.push(`${m.panelDoubleBookings} panel double bookings`);
    if (diff.churn.noticeViolations) problems.push(`${diff.churn.noticeViolations} notice violations`);

    // Nothing frozen may ever move.
    for (const mv of diff.moved) {
      if (mv.fromSlot < now) problems.push(`moved a past interview (${mv.studentName})`);
    }

    if (problems.length) {
      failures++;
      console.error(`FAIL seed ${seed} round ${round}:`, problems.join(', '));
      console.error('  disruptions:', JSON.stringify(disruptions));
    }
  }

  coverageDrops.push(startCoverage - computeMetrics(dataset, schedule).coveragePct);
}

const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

console.log(`\nran ${runs} replans across ${SEEDS} seeds`);
console.log('invariant failures:', failures);
console.log('avg displaced per replan:', (totalDisplaced / runs).toFixed(1));
console.log('avg moved per replan:', (totalMoved / runs).toFixed(1));
console.log('worst churn seen:', worstChurn.toFixed(1) + '% of remaining appointments');
console.log('slowest replan:', slowest, 'ms');
console.log('avg coverage change after 4 disruption rounds:', avg(coverageDrops).toFixed(1) + ' points');

if (failures > 0) process.exit(1);
console.log('\nall invariants held');
