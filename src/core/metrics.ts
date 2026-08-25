/**
 * Metrics, plus an independent verifier.
 *
 * The verifier does NOT trust the engine. It recomputes clashes and double
 * bookings from the raw assignment list. If the engine ever has a bug, the
 * metrics panel is where it surfaces, not on the day in a corridor.
 */

import {
  Assignment, Dataset, DayFeasibility, Metrics, Schedule,
  SLOT_MINUTES, LUNCH_START_MIN, LUNCH_END_MIN, DAY_START_MIN, DAY_END_MIN,
  slotToDay, slotToMinuteOfDay, durationToSlots,
} from './types';

const USABLE_MINUTES_PER_DAY =
  (DAY_END_MIN - DAY_START_MIN) - (LUNCH_END_MIN - LUNCH_START_MIN);

export function computeMetrics(dataset: Dataset, schedule: Schedule): Metrics {
  const { assignments } = schedule;

  /**
   * Live demand excludes withdrawn students. A student who accepted an offer
   * and went home is not an interview we failed to schedule, and counting them
   * as one makes every replan look like a regression. This distinction is the
   * difference between a metric the coordinator trusts and one she ignores.
   */
  const withdrawn = new Set(dataset.students.filter((s) => s.withdrawn).map((s) => s.id));
  const liveQueue = (c: typeof dataset.companies[number]) =>
    c.interviewQueue.filter((sid) => !withdrawn.has(sid));

  const demandedInterviews = dataset.companies.reduce((n, c) => n + liveQueue(c).length, 0);
  const demandMinutes = dataset.companies.reduce(
    (n, c) => n + liveQueue(c).length * c.interviewMinutes, 0,
  );
  const capacityMinutes = dataset.rooms.length * 4 * USABLE_MINUTES_PER_DAY;

  /* ---- invariant checks, recomputed from scratch ---- */
  let studentClashes = 0;
  const byStudent = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!byStudent.has(a.studentId)) byStudent.set(a.studentId, []);
    byStudent.get(a.studentId)!.push(a);
  }
  for (const list of byStudent.values()) {
    list.sort((x, y) => x.startSlot - y.startSlot);
    for (let i = 1; i < list.length; i++) {
      if (list[i].startSlot < list[i - 1].endSlot) studentClashes++;
    }
  }

  const overlapCount = (key: (a: Assignment) => string) => {
    const groups = new Map<string, Assignment[]>();
    for (const a of assignments) {
      const k = key(a);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(a);
    }
    let n = 0;
    for (const list of groups.values()) {
      list.sort((x, y) => x.startSlot - y.startSlot);
      for (let i = 1; i < list.length; i++) {
        if (list[i].startSlot < list[i - 1].endSlot) n++;
      }
    }
    return n;
  };

  const roomDoubleBookings = overlapCount((a) => a.roomId);
  const panelDoubleBookings = overlapCount((a) => a.panelId);

  /* ---- utilisation ---- */
  const usedMinutes = assignments.reduce(
    (n, a) => n + (a.endSlot - a.startSlot) * SLOT_MINUTES, 0,
  );
  const roomsInUse = new Set(assignments.map((a) => a.roomId)).size || 1;
  const daysInUse = new Set(assignments.map((a) => slotToDay(a.startSlot))).size || 1;
  const roomUtilisationPct = (usedMinutes / (roomsInUse * daysInUse * USABLE_MINUTES_PER_DAY)) * 100;

  /* ---- student experience ---- */
  /**
   * Idle time is the gap between a student's first and last interview on a day
   * minus the time actually spent interviewing. This is the number students
   * complain about and no scheduler optimises for. Reporting it is the point.
   */
  let idleTotal = 0;
  let idleMax = 0;
  let idleStudents = 0;
  for (const list of byStudent.values()) {
    const byDay = new Map<number, Assignment[]>();
    for (const a of list) {
      const d = slotToDay(a.startSlot);
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(a);
    }
    for (const dayList of byDay.values()) {
      if (dayList.length < 2) continue;
      dayList.sort((x, y) => x.startSlot - y.startSlot);
      const span = (dayList[dayList.length - 1].endSlot - dayList[0].startSlot) * SLOT_MINUTES;
      const busy = dayList.reduce((n, a) => n + (a.endSlot - a.startSlot) * SLOT_MINUTES, 0);
      const idle = span - busy;
      idleTotal += idle;
      idleMax = Math.max(idleMax, idle);
      idleStudents++;
    }
  }

  const studentsWithDemand = new Set(dataset.companies.flatMap((c) => liveQueue(c)));
  let zero = 0;
  for (const sid of studentsWithDemand) if (!byStudent.has(sid)) zero++;

  /**
   * Per day feasibility. Aggregate week capacity is the wrong number: it can
   * look comfortable while Day 1 is 60 percent oversubscribed and Day 4 sits
   * half empty. Companies will not move days without approval, so slack on
   * Day 4 does not help Day 1. Shortfall is therefore summed per day.
   */
  const perDay = [];
  let shortfallMinutes = 0;
  for (let d = 0; d < 4; d++) {
    const dayCompanies = dataset.companies.filter((c) => c.preferredDay === d);
    const dDemand = dayCompanies.reduce((n, c) => n + liveQueue(c).length * c.interviewMinutes, 0);
    const dCapacity = dataset.rooms.length * USABLE_MINUTES_PER_DAY;
    const dScheduled = assignments.filter((a) => slotToDay(a.startSlot) === d).length;
    const dDemanded = dayCompanies.reduce((n, c) => n + liveQueue(c).length, 0);
    const panelsRequested = dayCompanies.reduce((n, c) => n + c.panelCount, 0);
    shortfallMinutes += Math.max(0, dDemand - dCapacity);
    perDay.push({
      day: d + 1,
      demandMinutes: dDemand,
      capacityMinutes: dCapacity,
      demandedInterviews: dDemanded,
      scheduledInterviews: dScheduled,
      coveragePct: dDemanded ? (dScheduled / dDemanded) * 100 : 100,
      panelsRequested,
      roomsAvailable: dataset.rooms.length,
      oversubscribedPct: Math.max(0, (dDemand / dCapacity - 1) * 100),
    });
  }

  return {
    perDay,
    demandedInterviews,
    scheduledInterviews: assignments.length,
    coveragePct: demandedInterviews ? (assignments.length / demandedInterviews) * 100 : 0,
    studentClashes,
    roomDoubleBookings,
    panelDoubleBookings,
    roomUtilisationPct,
    avgStudentIdleMinutes: idleStudents ? idleTotal / idleStudents : 0,
    maxStudentIdleMinutes: idleMax,
    studentsWithZeroInterviews: zero,
    demandMinutes,
    capacityMinutes,
    structuralShortfallPct: demandMinutes ? (shortfallMinutes / demandMinutes) * 100 : 0,
  };
}

/**
 * Grouped explanation of everything that did not fit. The brief is explicit
 * that the system must never fail silently, so this is a first class output,
 * not a log line.
 */
export function explainUnscheduled(dataset: Dataset, schedule: Schedule) {
  const companies = new Map(dataset.companies.map((c) => [c.id, c]));
  const byReason = new Map<string, number>();
  const byCompany = new Map<string, number>();

  for (const u of schedule.unscheduled) {
    byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
    byCompany.set(u.companyId, (byCompany.get(u.companyId) ?? 0) + 1);
  }

  const worst = [...byCompany.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([cid, n]) => ({
      company: companies.get(cid)!.name,
      tier: companies.get(cid)!.tier,
      unscheduled: n,
      demanded: companies.get(cid)!.interviewQueue.length,
    }));

  return { byReason: Object.fromEntries(byReason), worstAffected: worst };
}
