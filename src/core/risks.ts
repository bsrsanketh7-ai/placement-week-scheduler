/**
 * Upcoming conflicts.
 *
 * The schedule being valid right now says nothing about whether it survives
 * the next two hours. A whiteboard collapses not because someone double booked
 * a room, but because an interview ran twelve minutes long at 11:00 and every
 * slot behind it was packed solid.
 *
 * So this looks forward rather than backward. Everything here is a schedule
 * that is currently legal and is one small delay away from not being. That is
 * the difference between a validator and something a coordinator can act on
 * before the phone starts ringing.
 *
 * Deliberately NOT included: anything already broken. Clashes and double
 * bookings are zero by construction and verified in metrics.ts. Listing them
 * here would pad the panel with rows that are always empty.
 */

import { ScheduleEngine } from './engine';
import {
  Assignment, Schedule,
  SLOT_MINUTES, formatSlot, slotToDay, travelSlots,
} from './types';

export type RiskKind = 'CASCADE' | 'TIGHT_TURNAROUND' | 'LONG_WAIT' | 'IDLE_CAPACITY';
export type Severity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Risk {
  id: string;
  kind: RiskKind;
  severity: Severity;
  headline: string;
  detail: string;
  /** When it would bite, used for ordering. */
  atSlot: number;
}

const SEVERITY_RANK: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export interface RiskOptions {
  /** Consecutive back-to-back interviews before a panel is called fragile. */
  cascadeThreshold?: number;
  /** Minutes of dead time before a student's day is called punishing. */
  longWaitMinutes?: number;
  maxRisks?: number;
}

export function upcomingRisks(
  engine: ScheduleEngine,
  schedule: Schedule,
  now: number,
  options: RiskOptions = {},
): Risk[] {
  const cascadeThreshold = options.cascadeThreshold ?? 4;
  const longWaitMinutes = options.longWaitMinutes ?? 150;
  const maxRisks = options.maxRisks ?? 6;
  const day = slotToDay(now);

  const risks: Risk[] = [];
  const future = engine.getAssignments()
    .filter((a) => slotToDay(a.startSlot) === day && a.endSlot > now);

  /* ---- 1. Cascade risk: a panel with no slack left ---- */
  /**
   * A run of back-to-back interviews has no absorption. One overrun pushes
   * every person behind it, and the students at the end of the run are the
   * ones who miss their next company entirely. This is the single most common
   * way a placement day unravels.
   */
  const byPanel = new Map<string, Assignment[]>();
  for (const a of future) {
    if (!byPanel.has(a.panelId)) byPanel.set(a.panelId, []);
    byPanel.get(a.panelId)!.push(a);
  }

  for (const [panelId, list] of byPanel) {
    list.sort((x, y) => x.startSlot - y.startSlot);
    let runStart = 0;
    let best = { length: 1, from: 0, to: 0 };
    for (let i = 1; i <= list.length; i++) {
      const contiguous = i < list.length && list[i].startSlot === list[i - 1].endSlot;
      if (!contiguous) {
        const length = i - runStart;
        if (length > best.length) {
          best = { length, from: list[runStart].startSlot, to: list[i - 1].endSlot };
        }
        runStart = i;
      }
    }
    if (best.length < cascadeThreshold) continue;

    const panel = engine.panels.get(panelId)!;
    const company = engine.companies.get(panel.companyId)!;
    const room = panel.roomId ? engine.rooms.get(panel.roomId) : undefined;
    risks.push({
      id: `cascade:${panelId}`,
      kind: 'CASCADE',
      severity: best.length >= cascadeThreshold + 2 ? 'HIGH' : 'MEDIUM',
      headline: `${company.name} has ${best.length} back-to-back in ${room?.name ?? 'its room'}`,
      detail: `${formatSlot(best.from)} to ${formatSlot(best.to)} with no gap. One interview running long pushes all ${best.length - 1} behind it.`,
      atSlot: best.from,
    });
  }

  /* ---- 2. Tight turnaround: a student with only the minimum buffer ---- */
  /**
   * These are legal by construction, because the scheduler enforces the walk
   * time. Legal is not the same as safe: a student on the exact minimum has
   * zero margin, and if they are crossing between blocks they are running.
   */
  const byStudent = new Map<string, Assignment[]>();
  for (const a of future) {
    if (!byStudent.has(a.studentId)) byStudent.set(a.studentId, []);
    byStudent.get(a.studentId)!.push(a);
  }

  for (const [studentId, list] of byStudent) {
    if (list.length < 2) continue;
    list.sort((x, y) => x.startSlot - y.startSlot);
    const student = engine.students.get(studentId)!;

    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const next = list[i];
      const fromBlock = engine.rooms.get(prev.roomId)?.block ?? '';
      const toBlock = engine.rooms.get(next.roomId)?.block ?? '';
      const gap = next.startSlot - prev.endSlot;
      const needed = travelSlots(fromBlock, toBlock);
      if (gap > needed) continue;

      const crossBlock = fromBlock !== toBlock;
      risks.push({
        id: `tight:${studentId}:${next.startSlot}`,
        kind: 'TIGHT_TURNAROUND',
        severity: crossBlock ? 'HIGH' : 'MEDIUM',
        headline: `${student.name} has ${gap * SLOT_MINUTES} min between interviews`,
        detail: crossBlock
          ? `${engine.companies.get(prev.companyId)?.name} in block ${fromBlock} then ${engine.companies.get(next.companyId)?.name} in block ${toBlock} at ${formatSlot(next.startSlot)}. Crossing blocks with no margin.`
          : `${engine.companies.get(prev.companyId)?.name} then ${engine.companies.get(next.companyId)?.name} at ${formatSlot(next.startSlot)}. Same block, but no margin.`,
        atSlot: next.startSlot,
      });
    }
  }

  /* ---- 3. Long wait: a student stuck on campus all day ---- */
  for (const [studentId, list] of byStudent) {
    if (list.length < 2) continue;
    list.sort((x, y) => x.startSlot - y.startSlot);
    const span = (list[list.length - 1].endSlot - list[0].startSlot) * SLOT_MINUTES;
    const busy = list.reduce((n, a) => n + (a.endSlot - a.startSlot) * SLOT_MINUTES, 0);
    const idle = span - busy;
    if (idle < longWaitMinutes) continue;
    const student = engine.students.get(studentId)!;
    risks.push({
      id: `wait:${studentId}`,
      kind: 'LONG_WAIT',
      severity: idle >= longWaitMinutes * 1.6 ? 'MEDIUM' : 'LOW',
      headline: `${student.name} waits ${Math.round(idle / 60 * 10) / 10} hours between interviews`,
      detail: `${list.length} interviews from ${formatSlot(list[0].startSlot)} to ${formatSlot(list[list.length - 1].endSlot)}. Mostly spent sitting in a corridor.`,
      atSlot: list[0].startSlot,
    });
  }

  /* ---- 4. Idle capacity beside unmet demand ---- */
  /**
   * An opportunity rather than a hazard, but it belongs in the same panel: a
   * coordinator who can see that a company has free panel time this afternoon
   * and students who never got a slot can act on it. The system will not fill
   * these itself, because it does not know who is still on campus.
   */
  const unplacedByCompany = new Map<string, number>();
  for (const u of schedule.unscheduled) {
    const c = engine.companies.get(u.companyId);
    if (!c || c.preferredDay !== day) continue;
    if (engine.students.get(u.studentId)?.withdrawn) continue;
    unplacedByCompany.set(u.companyId, (unplacedByCompany.get(u.companyId) ?? 0) + 1);
  }

  for (const [companyId, count] of unplacedByCompany) {
    const company = engine.companies.get(companyId)!;
    let freeSlots = 0;
    for (const panel of engine.panels.values()) {
      if (panel.companyId !== companyId || panel.dropped || !panel.roomId) continue;
      const booked = new Set<number>();
      for (const a of engine.assignmentsForPanel(panel.id)) {
        for (let s = a.startSlot; s < a.endSlot; s++) booked.add(s);
      }
      for (let s = Math.max(panel.availableFrom, now); s < panel.availableTo; s++) {
        if (!booked.has(s)) freeSlots++;
      }
    }
    const capacity = Math.floor(freeSlots * SLOT_MINUTES / company.interviewMinutes);
    if (capacity < 2) continue;
    risks.push({
      id: `idle:${companyId}`,
      kind: 'IDLE_CAPACITY',
      severity: 'LOW',
      headline: `${company.name} could still see ~${Math.min(capacity, count)} more today`,
      detail: `${count} of its shortlist never got a slot, and its panels have room left. Needs the coordinator to confirm who is still on campus.`,
      atSlot: now,
    });
  }

  /**
   * Collapse repetition before ranking. Twenty students on a minimum
   * turnaround is one fact about the day, not twenty separate alerts, and a
   * panel showing the same sentence six times trains the coordinator to stop
   * reading it. Each kind gets at most two named cards plus a count of the
   * rest, so the strip always shows a range of what can go wrong rather than
   * whichever category happens to be most numerous.
   */
  const grouped: Risk[] = [];
  const kinds: RiskKind[] = ['CASCADE', 'TIGHT_TURNAROUND', 'LONG_WAIT', 'IDLE_CAPACITY'];

  for (const kind of kinds) {
    const of = risks
      .filter((r) => r.kind === kind)
      .sort((a, b) => {
        const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        return s !== 0 ? s : a.atSlot - b.atSlot;
      });
    if (of.length === 0) continue;

    grouped.push(...of.slice(0, 2));
    const rest = of.length - 2;
    if (rest > 0) {
      grouped.push({
        id: `more:${kind}`,
        kind,
        severity: 'LOW',
        headline: `${rest} more ${LABEL[kind]}`,
        detail: `Same pattern as above, affecting ${rest} other ${rest === 1 ? 'case' : 'cases'} later today.`,
        atSlot: of[2].atSlot,
      });
    }
  }

  grouped.sort((a, b) => {
    const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return s !== 0 ? s : a.atSlot - b.atSlot;
  });
  return grouped.slice(0, maxRisks);
}

const LABEL: Record<RiskKind, string> = {
  CASCADE: 'panels with no slack',
  TIGHT_TURNAROUND: 'students on a minimum turnaround',
  LONG_WAIT: 'students waiting most of the day',
  IDLE_CAPACITY: 'companies with room to spare',
};