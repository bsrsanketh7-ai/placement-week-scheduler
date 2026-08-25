/**
 * The replanner.
 *
 * This is the part of the system that matters. A scheduler that produces a
 * good Monday morning plan and then cannot absorb a 3 hour delay is a
 * whiteboard with extra steps.
 *
 * THE GOVERNING PRINCIPLE
 * A replan is not a re-solve. Re-solving from scratch produces a better
 * schedule on paper and a catastrophe in the building, because 200 students
 * get a new time for a delay that structurally affected 40. So the replanner
 * treats the existing schedule as the thing to preserve and the disruption as
 * a local wound to close.
 *
 * THE THREE RINGS
 *   Ring 0  Untouched. Never considered for movement. Anything already started
 *           or inside the notice window (see NOTICE_SLOTS) is frozen, full
 *           stop. Moving a student's 11:00 interview at 10:55 is not a replan,
 *           it is a broken promise.
 *   Ring 1  Displaced. Assignments the disruption actually invalidated. These
 *           must move; they have no choice.
 *   Ring 2  Volunteered. Movable assignments the replanner is allowed to
 *           shuffle to make room for Ring 1, capped at maxDisplacements.
 *           This cap is the answer to "how much reshuffling is acceptable".
 *
 * WHICH CONSTRAINT BENDS FIRST
 * Ordered, and the order is a policy decision, not a technical one:
 *   1. Slack time. Gaps get squeezed. Costless, so it goes first.
 *   2. Panel end time. A panel stays up to OVERTIME_MINUTES past departure.
 *      Costs the company goodwill, so it is capped and reported.
 *   3. Ring 2 displacement of other students, capped.
 *   4. Nothing else. Interview duration never shrinks, CGPA cutoffs never bend
 *      (they are the company's policy, not ours to trade away), and the day
 *      never changes automatically.
 * Past step 4 the system stops and hands the decision up. See the
 * `escalations` field: those are choices the coordinator makes, not the
 * scheduler. The scheduler's job is to present the cost of each option, not to
 * quietly pick one and hope nobody notices.
 */

import { ScheduleEngine } from './engine';
import {
  Assignment, Schedule, Unscheduled,
  SLOT_MINUTES, durationToSlots, formatSlot, slotToDay, globalSlot,
  SLOTS_PER_DAY, minuteOfDayToSlotInDay,
} from './types';

/* ------------------------------------------------------------------ */
/* Disruptions                                                         */
/* ------------------------------------------------------------------ */

export type Disruption =
  | { type: 'COMPANY_LATE'; companyId: string; delayMinutes: number }
  | { type: 'PANEL_DROP'; panelId: string }
  | { type: 'STUDENT_WITHDRAW'; studentIds: string[] }
  | { type: 'ROOM_UNAVAILABLE'; roomId: string };

export interface ReplanOptions {
  /** Current time as a global slot. Everything before this is history. */
  now: number;
  /** Minimum warning a student gets before their interview moves. */
  noticeSlots?: number;
  /** Ring 2 budget. The single most important knob in the system. */
  maxDisplacements?: number;
  /** How far a panel may run past its stated departure time. */
  overtimeMinutes?: number;
  /**
   * Whether to offer freed capacity to students who were never scheduled.
   * Default false: a withdrawal creating a slot is good news, but handing a
   * surprise interview to a student who went home is not the scheduler's call.
   */
  backfillUnscheduled?: boolean;
}

/* ------------------------------------------------------------------ */
/* Diff                                                                */
/* ------------------------------------------------------------------ */

export interface MovedEntry {
  studentId: string;
  studentName: string;
  companyId: string;
  companyName: string;
  fromSlot: number;
  toSlot: number;
  fromRoom: string;
  toRoom: string;
  ring: 'DISPLACED' | 'VOLUNTEERED';
  deltaMinutes: number;
}

export interface CancelledEntry {
  studentId: string;
  studentName: string;
  companyId: string;
  companyName: string;
  originalSlot: number | null;
  reason: string;
  /**
   * WITHDRAWN means the student left; the slot is freed, nobody failed.
   * UNPLACEABLE means the system could not find a home for an interview the
   * student still wants. Collapsing these two into one number is the single
   * easiest way to make a working replanner look broken on a dashboard.
   */
  kind: 'WITHDRAWN' | 'UNPLACEABLE';
}

export interface Escalation {
  question: string;
  options: string[];
  affects: number;
}

export interface ReplanDiff {
  disruptions: string[];
  moved: MovedEntry[];
  roomChanged: Array<{ panelId: string; companyName: string; fromRoom: string; toRoom: string; affects: number }>;
  cancelled: CancelledEntry[];
  added: MovedEntry[];
  frozen: number;
  untouched: number;
  escalations: Escalation[];
  churn: {
    displacedCount: number;
    volunteeredCount: number;
    movedPctOfFuture: number;
    studentsAffected: number;
    companiesAffected: number;
    noticeViolations: number;
  };
  notifications: {
    students: Array<{ studentId: string; name: string; message: string }>;
    companies: Array<{ companyId: string; name: string; message: string }>;
  };
  computeMs: number;
}

/* ------------------------------------------------------------------ */
/* Replan                                                              */
/* ------------------------------------------------------------------ */

export function replan(
  engine: ScheduleEngine,
  schedule: Schedule,
  disruptions: Disruption[],
  options: ReplanOptions,
): { schedule: Schedule; diff: ReplanDiff } {
  const t0 = Date.now();
  const now = options.now;
  const notice = options.noticeSlots ?? 2;          // 30 minutes
  const maxDisplacements = options.maxDisplacements ?? 12;
  const overtime = options.overtimeMinutes ?? 60;
  const protectedUntil = now + notice;

  const diff: ReplanDiff = {
    disruptions: [],
    moved: [], roomChanged: [], cancelled: [], added: [],
    frozen: 0, untouched: 0, escalations: [],
    churn: {
      displacedCount: 0, volunteeredCount: 0, movedPctOfFuture: 0,
      studentsAffected: 0, companiesAffected: 0, noticeViolations: 0,
    },
    notifications: { students: [], companies: [] },
    computeMs: 0,
  };

  /* ---- Ring 0: freeze history and the notice window ---- */
  const allBefore = engine.getAssignments();
  for (const a of allBefore) {
    if (a.startSlot < protectedUntil) {
      a.locked = true;
      diff.frozen++;
    }
  }
  const futureCountBefore = allBefore.filter((a) => a.startSlot >= protectedUntil).length;

  /* ---- Apply the disruptions to the world ---- */
  const invalid = new Set<string>();
  const cancelReasons = new Map<string, string>();

  for (const d of disruptions) {
    switch (d.type) {
      case 'COMPANY_LATE': {
        const company = engine.companies.get(d.companyId)!;
        const delaySlots = Math.ceil(d.delayMinutes / SLOT_MINUTES);
        const newArrival = company.arrivalMin + d.delayMinutes;
        company.arrivalMin = newArrival;
        diff.disruptions.push(
          `${company.name} arriving ${d.delayMinutes} minutes late (now ${fmtMin(newArrival)})`,
        );

        for (const p of engine.panels.values()) {
          if (p.companyId !== d.companyId || p.dropped) continue;
          const dayEnd = (p.day + 1) * SLOTS_PER_DAY;
          // Constraint that bends #2: the panel stays late, up to the cap, but
          // never past the end of its own day. A company that arrives too late
          // to interview at all loses the day; it does not silently roll into
          // tomorrow, because moving a company's day is the coordinator's call.
          p.availableTo = Math.min(p.availableTo + Math.ceil(overtime / SLOT_MINUTES), dayEnd);
          p.availableFrom = Math.min(p.availableFrom + delaySlots, p.availableTo);
        }
        const dead = [...engine.panels.values()].filter(
          (p) => p.companyId === d.companyId && !p.dropped && p.availableFrom >= p.availableTo,
        );
        if (dead.length > 0) {
          diff.disruptions.push(
            `${company.name} arrives too late to use ${dead.length} panel(s) today`,
          );
        }
        for (const a of engine.assignmentsForCompany(d.companyId)) {
          const p = engine.panels.get(a.panelId)!;
          if (a.startSlot < p.availableFrom && !a.locked) {
            invalid.add(a.id);
            cancelReasons.set(a.id, `${company.name} not on site yet`);
          }
        }
        break;
      }

      case 'PANEL_DROP': {
        const panel = engine.panels.get(d.panelId)!;
        const company = engine.companies.get(panel.companyId)!;
        panel.dropped = true;
        engine.releasePanelRoom(d.panelId);
        diff.disruptions.push(`${panel.label} dropped out`);
        for (const a of engine.assignmentsForPanel(d.panelId)) {
          if (a.locked) continue;
          invalid.add(a.id);
          cancelReasons.set(a.id, `${company.name} panel withdrawn`);
        }
        break;
      }

      case 'STUDENT_WITHDRAW': {
        for (const sid of d.studentIds) {
          const s = engine.students.get(sid);
          if (!s) continue;
          s.withdrawn = true;
          s.withdrawnAt = now;
          for (const a of engine.assignmentsForStudent(sid)) {
            if (a.locked) continue;
            invalid.add(a.id);
            cancelReasons.set(a.id, `${s.name} withdrew after accepting an offer`);
          }
        }
        diff.disruptions.push(`${d.studentIds.length} student(s) withdrew`);
        break;
      }

      case 'ROOM_UNAVAILABLE': {
        const room = engine.rooms.get(d.roomId)!;
        diff.disruptions.push(`Room ${room.name} unavailable`);
        // A room dying does not have to move any student: if a spare room
        // exists, the panel relocates and only the venue changes. This is the
        // cheapest possible repair and the replanner should always reach for
        // it before touching a single time slot.
        for (const p of engine.panels.values()) {
          if (p.roomId !== d.roomId || p.dropped) continue;
          const spare = engine.findFreeRoom(p.day, Math.max(p.availableFrom, protectedUntil), p.availableTo);
          if (spare) {
            engine.releasePanelRoom(p.id);
            const relocated = engine.relocatePanel(p.id, spare.id, protectedUntil);
            diff.roomChanged.push({
              panelId: p.id,
              companyName: engine.companies.get(p.companyId)!.name,
              fromRoom: room.name,
              toRoom: spare.name,
              affects: relocated.length,
            });
          } else {
            engine.releasePanelRoom(p.id);
            p.dropped = true;
            for (const a of engine.assignmentsForPanel(p.id)) {
              if (a.locked) continue;
              invalid.add(a.id);
              cancelReasons.set(a.id, `Room ${room.name} lost, no spare available`);
            }
          }
        }
        // Take the room out of circulation entirely.
        engine.retireRoom(d.roomId);
        break;
      }
    }
  }

  /**
   * A dropped panel frees a room. Give it to a company that wanted a panel and
   * never got one. This only adds capacity, so it cannot increase churn, and
   * on a bad morning it is the difference between losing 40 interviews and
   * losing 15.
   */
  const reallocated = engine.allocateRooms();
  if (reallocated.length > 0) {
    diff.disruptions.push(`${reallocated.length} freed room(s) reallocated to waiting panels`);
  }

  /* ---- Ring 1: lift the displaced ---- */
  const displaced: Array<{ a: Assignment; reason: string }> = [];
  for (const id of invalid) {
    const a = engine.getAssignment(id);
    if (!a) continue;
    const removed = engine.remove(id);
    if (removed) displaced.push({ a: removed, reason: cancelReasons.get(id) ?? 'disrupted' });
  }
  diff.churn.displacedCount = displaced.length;

  // Withdrawn students never get rebooked, they have gone home.
  const toReplace = displaced.filter(({ a }) => !engine.students.get(a.studentId)!.withdrawn);
  for (const { a, reason } of displaced) {
    if (engine.students.get(a.studentId)!.withdrawn) {
      diff.cancelled.push({
        studentId: a.studentId,
        studentName: engine.students.get(a.studentId)!.name,
        companyId: a.companyId,
        companyName: engine.companies.get(a.companyId)!.name,
        originalSlot: a.startSlot,
        reason,
        kind: 'WITHDRAWN',
      });
    }
  }

  /**
   * Rebook earliest original time first. A student whose 09:30 slot vanished
   * has more of the day left to work with than one whose 16:00 slot vanished,
   * so serving them in original order keeps late slots available for the
   * people who actually need them.
   */
  toReplace.sort((x, y) => x.a.startSlot - y.a.startSlot);

  let volunteered = 0;
  const stillUnplaced: Array<{ a: Assignment; reason: string }> = [];

  /* ---- Phase 1: free capacity only, anchored near the original time ---- */
  for (const item of toReplace) {
    const { a } = item;
    const res = engine.findSlot(a.companyId, a.studentId, {
      earliest: protectedUntil,
      anchor: a.startSlot,
    });
    if (res.ok) {
      const placed = engine.place(a.companyId, a.studentId, res.candidate);
      recordMove(engine, diff, a, placed, 'DISPLACED');
    } else {
      stillUnplaced.push({ ...item, reason: res.reason === 'STUDENT_WITHDRAWN' ? item.reason : res.detail });
    }
  }

  /* ---- Phase 2: bounded Ring 2 displacement ---- */
  const leftover: Array<{ a: Assignment; reason: string }> = [];

  for (const item of stillUnplaced) {
    if (volunteered >= maxDisplacements) { leftover.push(item); continue; }
    const { a } = item;

    // Only the target company's own panels can host this interview, so the
    // volunteer has to come from those panels.
    const candidates = [...engine.panels.values()]
      .filter((p) => p.companyId === a.companyId && !p.dropped && p.roomId)
      .flatMap((p) => engine.assignmentsForPanel(p.id))
      .filter((v) => !v.locked && v.startSlot >= protectedUntil)
      .sort((x, y) => y.startSlot - x.startSlot); // move the latest, least settled

    let fixed = false;
    for (const victim of candidates) {
      const savedVictim = engine.remove(victim.id);
      if (!savedVictim) continue;

      const retry = engine.findSlot(a.companyId, a.studentId, {
        earliest: protectedUntil, anchor: a.startSlot,
      });
      if (retry.ok) {
        const placed = engine.place(a.companyId, a.studentId, retry.candidate);
        const rehome = engine.findSlot(savedVictim.companyId, savedVictim.studentId, {
          earliest: protectedUntil, anchor: savedVictim.startSlot,
        });
        if (rehome.ok) {
          const moved = engine.place(savedVictim.companyId, savedVictim.studentId, rehome.candidate);
          recordMove(engine, diff, a, placed, 'DISPLACED');
          recordMove(engine, diff, savedVictim, moved, 'VOLUNTEERED');
          volunteered++;
          fixed = true;
          break;
        }
        engine.remove(placed.id);
      }
      // Roll back. We never cancel a confirmed interview to save another one:
      // that is a lateral move that doubles the number of upset people.
      engine.place(savedVictim.companyId, savedVictim.studentId, {
        panelId: savedVictim.panelId, roomId: savedVictim.roomId,
        startSlot: savedVictim.startSlot, endSlot: savedVictim.endSlot,
      });
    }

    if (!fixed) leftover.push(item);
  }

  diff.churn.volunteeredCount = volunteered;

  for (const { a, reason } of leftover) {
    diff.cancelled.push({
      studentId: a.studentId,
      studentName: engine.students.get(a.studentId)!.name,
      companyId: a.companyId,
      companyName: engine.companies.get(a.companyId)!.name,
      originalSlot: a.startSlot,
      reason,
      kind: 'UNPLACEABLE',
    });
  }

  /* ---- Escalations: decisions the coordinator owns, not the scheduler ---- */
  if (leftover.length > 0) {
    const byCompany = new Map<string, number>();
    for (const { a } of leftover) {
      byCompany.set(a.companyId, (byCompany.get(a.companyId) ?? 0) + 1);
    }
    for (const [cid, count] of byCompany) {
      const c = engine.companies.get(cid)!;
      diff.escalations.push({
        question: `${count} ${c.name} interview(s) have nowhere to go today. How should this be resolved?`,
        options: [
          `Extend ${c.name} past ${fmtMin(c.departureMin)} (needs company sign off)`,
          `Move the remainder to a later day (needs company and student sign off)`,
          `Cut ${count} candidate(s) from the list (needs company sign off)`,
          `Accept as unscheduled and notify`,
        ],
        affects: count,
      });
    }
  }

  if (volunteered >= maxDisplacements && leftover.length > 0) {
    diff.escalations.push({
      question: `Reshuffle budget of ${maxDisplacements} exhausted with ${leftover.length} interview(s) still unplaced. Raise the budget?`,
      options: [
        `Keep the cap, leave ${leftover.length} unscheduled`,
        `Raise to ${maxDisplacements * 2} and rerun (more students get new times)`,
      ],
      affects: leftover.length,
    });
  }

  /**
   * Withdrawals hand back capacity. Surfacing that as an offer rather than
   * silently filling it keeps the coordinator in control: she knows which
   * students are still on campus and the scheduler does not.
   */
  const freedSlots = diff.cancelled.filter((c) => c.kind === 'WITHDRAWN').length;
  if (freedSlots > 0 && !options.backfillUnscheduled) {
    const waiting = schedule.unscheduled.filter(
      (u) => !engine.students.get(u.studentId)?.withdrawn,
    ).length;
    if (waiting > 0) {
      diff.escalations.push({
        question: `${freedSlots} slot(s) freed by withdrawals. ${waiting} student(s) are currently unscheduled. Offer the freed slots?`,
        options: [
          'Leave freed slots empty (panels finish early)',
          'Offer to unscheduled students still on campus (creates new appointments at short notice)',
        ],
        affects: freedSlots,
      });
    }
  }

  /* ---- Optional backfill ---- */
  if (options.backfillUnscheduled) {
    const remaining: Unscheduled[] = [];
    for (const u of schedule.unscheduled) {
      const s = engine.students.get(u.studentId);
      if (!s || s.withdrawn) { remaining.push(u); continue; }
      const res = engine.findSlot(u.companyId, u.studentId, { earliest: protectedUntil });
      if (res.ok) {
        const placed = engine.place(u.companyId, u.studentId, res.candidate);
        diff.added.push({
          studentId: u.studentId,
          studentName: s.name,
          companyId: u.companyId,
          companyName: engine.companies.get(u.companyId)!.name,
          fromSlot: -1, toSlot: placed.startSlot,
          fromRoom: '', toRoom: engine.rooms.get(placed.roomId)!.name,
          ring: 'DISPLACED', deltaMinutes: 0,
        });
      } else {
        remaining.push(u);
      }
    }
    schedule = { ...schedule, unscheduled: remaining };
  }

  /* ---- Churn accounting and notifications ---- */
  const touchedStudents = new Set<string>();
  const touchedCompanies = new Set<string>();
  for (const m of [...diff.moved, ...diff.added]) {
    touchedStudents.add(m.studentId);
    touchedCompanies.add(m.companyId);
  }
  for (const c of diff.cancelled) {
    touchedStudents.add(c.studentId);
    touchedCompanies.add(c.companyId);
  }
  for (const rc of diff.roomChanged) touchedCompanies.add(rc.panelId.split('-')[0]);

  diff.churn.studentsAffected = touchedStudents.size;
  diff.churn.companiesAffected = touchedCompanies.size;
  diff.churn.movedPctOfFuture = futureCountBefore
    ? (diff.moved.length / futureCountBefore) * 100 : 0;
  diff.churn.noticeViolations = diff.moved.filter((m) => m.toSlot < protectedUntil).length;

  for (const m of diff.moved) {
    diff.notifications.students.push({
      studentId: m.studentId,
      name: m.studentName,
      message: `Your ${m.companyName} interview moved from ${formatSlot(m.fromSlot)} to ${formatSlot(m.toSlot)}, room ${m.toRoom}.`,
    });
  }
  for (const rc of diff.roomChanged) {
    diff.notifications.companies.push({
      companyId: rc.panelId.split('-')[0],
      name: rc.companyName,
      message: `${rc.panelId} relocated from ${rc.fromRoom} to ${rc.toRoom}, ${rc.affects} interview(s) affected.`,
    });
  }
  for (const c of diff.cancelled) {
    diff.notifications.students.push({
      studentId: c.studentId,
      name: c.studentName,
      message: `Your ${c.companyName} interview could not be rescheduled today. Reason: ${c.reason}.`,
    });
  }

  const after = engine.getAssignments();
  diff.untouched = after.length - diff.moved.length - diff.added.length;
  diff.computeMs = Date.now() - t0;

  const panelRooms: Record<string, string | null> = {};
  for (const p of engine.panels.values()) panelRooms[p.id] = p.roomId;

  return {
    schedule: {
      assignments: after,
      unscheduled: [
        ...schedule.unscheduled,
        ...diff.cancelled.map((c) => ({
          companyId: c.companyId,
          studentId: c.studentId,
          reason: 'NO_PANEL_CAPACITY' as const,
          detail: c.reason,
        })),
      ],
      panelRooms,
    },
    diff,
  };
}

function recordMove(
  engine: ScheduleEngine,
  diff: ReplanDiff,
  before: Assignment,
  after: Assignment,
  ring: MovedEntry['ring'],
): void {
  if (before.startSlot === after.startSlot && before.roomId === after.roomId) return;
  diff.moved.push({
    studentId: after.studentId,
    studentName: engine.students.get(after.studentId)!.name,
    companyId: after.companyId,
    companyName: engine.companies.get(after.companyId)!.name,
    fromSlot: before.startSlot,
    toSlot: after.startSlot,
    fromRoom: engine.rooms.get(before.roomId)?.name ?? before.roomId,
    toRoom: engine.rooms.get(after.roomId)?.name ?? after.roomId,
    ring,
    deltaMinutes: (after.startSlot - before.startSlot) * SLOT_MINUTES,
  });
}

function fmtMin(min: number): string {
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
