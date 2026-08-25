/**
 * Initial schedule construction.
 *
 * Approach: greedy insertion with two ordering heuristics, then a bounded
 * repair pass. Not an exact solver, and that is a decision, not a shortcut.
 *
 * Why greedy and not ILP or CP-SAT: the coordinator replans a dozen times on
 * the day, under pressure, and needs the result in under a second with an
 * explanation she can read out loud. An exact solver gives a better first
 * schedule and a worse product, because its answer to "why did you move
 * Meghana" is a dual variable. Greedy insertion produces an audit trail for
 * free: every placement has a reason and every rejection has a reason.
 *
 * Ordering heuristics, in order of impact:
 *   H1  Companies by day, then by priority tier. Day 1 mass recruiters commit
 *       first because they hold the most panels and the most students.
 *   H2  Within a company, most constrained student first. A student on 7 lists
 *       has almost no free time left once the week fills; a student on 1 list
 *       can go anywhere. Placing the easy ones first is how you strand the
 *       strong students, which is the single worst outcome for the college.
 */

import { ScheduleEngine } from './engine';
import { Dataset, Schedule, Unscheduled } from './types';

export interface BuildOptions {
  /** Cap on repair attempts so a bad dataset cannot hang the UI. */
  maxRepairs?: number;
}

export function buildSchedule(
  dataset: Dataset,
  options: BuildOptions = {},
): { engine: ScheduleEngine; schedule: Schedule } {
  const engine = new ScheduleEngine(dataset);
  engine.allocateRooms();

  const unscheduled: Unscheduled[] = [];

  // H1: day, then priority, then bigger queues first inside a tier.
  const companies = [...dataset.companies].sort((a, b) => {
    if (a.preferredDay !== b.preferredDay) return a.preferredDay - b.preferredDay;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.interviewQueue.length - a.interviewQueue.length;
  });

  const load = new Map<string, number>();
  for (const s of dataset.students) load.set(s.id, s.interviewingWith.length);

  const deferred: Array<{ companyId: string; studentId: string }> = [];

  for (const company of companies) {
    // H2: most constrained student first.
    const queue = [...company.interviewQueue].sort(
      (a, b) => (load.get(b) ?? 0) - (load.get(a) ?? 0),
    );

    for (const studentId of queue) {
      const result = engine.findSlot(company.id, studentId);
      if (result.ok) {
        engine.place(company.id, studentId, result.candidate);
      } else if (result.reason === 'STUDENT_FULLY_BOOKED') {
        // Might become placeable once we try moving one of the student's other
        // interviews. Park it for the repair pass rather than failing now.
        deferred.push({ companyId: company.id, studentId });
      } else {
        unscheduled.push({
          companyId: company.id,
          studentId,
          reason: result.reason,
          detail: result.detail,
        });
      }
    }
  }

  /* ---------------- repair pass ---------------- */
  /**
   * One level displacement only. For a student who clashes with every free
   * slot, try relocating one of their existing interviews to free a window.
   * Depth is capped at 1 deliberately: deeper search buys a couple of points
   * of coverage and makes the change summary unreadable, which is the wrong
   * trade for a tool used live.
   */
  const maxRepairs = options.maxRepairs ?? 400;
  let repairs = 0;

  for (const { companyId, studentId } of deferred) {
    if (repairs >= maxRepairs) {
      unscheduled.push({
        companyId, studentId,
        reason: 'STUDENT_FULLY_BOOKED',
        detail: 'repair budget exhausted',
      });
      continue;
    }
    repairs++;

    let fixed = false;
    const existing = engine.assignmentsForStudent(studentId);

    for (const victim of existing) {
      if (victim.locked) continue;
      const saved = engine.remove(victim.id);
      if (!saved) continue;

      const retry = engine.findSlot(companyId, studentId);
      if (retry.ok) {
        engine.place(companyId, studentId, retry.candidate);
        // Now find a new home for the interview we displaced.
        const rehome = engine.findSlot(victim.companyId, victim.studentId, {
          anchor: victim.startSlot,
        });
        if (rehome.ok) {
          engine.place(victim.companyId, victim.studentId, rehome.candidate);
          fixed = true;
          break;
        }
        // Could not rehome the victim. Roll the whole thing back: we do not
        // trade one scheduled interview for another, that is churn with no gain.
        const placedId = engine.assignmentsForStudent(studentId)
          .find((a) => a.companyId === companyId)?.id;
        if (placedId) engine.remove(placedId);
      }

      engine.place(saved.companyId, saved.studentId, {
        panelId: saved.panelId,
        roomId: saved.roomId,
        startSlot: saved.startSlot,
        endSlot: saved.endSlot,
      });
    }

    if (!fixed) {
      const final = engine.findSlot(companyId, studentId);
      if (final.ok) {
        engine.place(companyId, studentId, final.candidate);
      } else {
        unscheduled.push({
          companyId, studentId,
          reason: final.ok ? 'STUDENT_FULLY_BOOKED' : final.reason,
          detail: final.ok ? '' : final.detail,
        });
      }
    }
  }

  const panelRooms: Record<string, string | null> = {};
  for (const p of engine.panels.values()) panelRooms[p.id] = p.roomId;

  return {
    engine,
    schedule: { assignments: engine.getAssignments(), unscheduled, panelRooms },
  };
}
