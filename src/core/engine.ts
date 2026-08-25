/**
 * The scheduling engine.
 *
 * This is deliberately a stateful engine rather than a one shot solver,
 * because the replanner needs exactly the same occupancy checks the initial
 * build used. If replanning had its own copy of the constraint logic, the two
 * would drift and the system would start emitting schedules that look valid
 * and are not.
 *
 * Invariants the engine maintains at all times:
 *   I1  A panel never has two overlapping interviews.
 *   I2  A room never has two overlapping interviews (holds by construction:
 *       a panel owns its room for the day, so panel exclusivity implies room
 *       exclusivity). Verified independently in metrics.ts anyway.
 *   I3  A student is never in two interviews at once, and always has enough
 *       buffer to physically walk between rooms.
 *   I4  No interview straddles lunch, crosses midnight, or falls outside its
 *       company's arrival to departure window.
 */

import {
  Assignment, Company, Dataset, Panel, Room, Student, Unscheduled, UnscheduledReason,
  SLOTS_PER_DAY, TOTAL_SLOTS, durationToSlots, spanIsUsable, travelSlots,
  slotToDay, formatSlot,
} from './types';

interface StudentInterval {
  assignmentId: string;
  start: number;
  end: number;
  block: string;
}

export interface PlacementCandidate {
  panelId: string;
  roomId: string;
  startSlot: number;
  endSlot: number;
}

export type PlacementFailure = { ok: false; reason: UnscheduledReason; detail: string };
export type PlacementResult = { ok: true; candidate: PlacementCandidate } | PlacementFailure;

export interface FindOptions {
  /** Never place anything before this slot. Used on the day, mid disruption. */
  earliest?: number;
  /** Panels to ignore, for example a panel that just dropped. */
  excludePanels?: Set<string>;
  /** Prefer a start close to this slot rather than the earliest possible. */
  anchor?: number;
}

export class ScheduleEngine {
  readonly rooms: Map<string, Room>;
  readonly companies: Map<string, Company>;
  readonly students: Map<string, Student>;
  readonly panels: Map<string, Panel>;

  private assignments = new Map<string, Assignment>();
  /** panelId -> occupied global slots */
  private panelBusy = new Map<string, Set<number>>();
  /** roomId -> occupied global slots. Tracked separately from panelBusy
   *  because panels move between rooms and rooms outlive panels. */
  private roomBusy = new Map<string, Set<number>>();
  /** studentId -> intervals, kept sorted-ish; lists are tiny */
  private studentIntervals = new Map<string, StudentInterval[]>();
  /** day -> roomId -> panelId that owns it */
  private roomOwner: Array<Map<string, string>> = [];

  private idCounter = 0;

  constructor(dataset: Dataset) {
    this.rooms = new Map(dataset.rooms.map((r) => [r.id, r]));
    this.companies = new Map(dataset.companies.map((c) => [c.id, c]));
    this.students = new Map(dataset.students.map((s) => [s.id, s]));
    this.panels = new Map(dataset.panels.map((p) => [p.id, { ...p }]));
    for (const p of this.panels.values()) this.panelBusy.set(p.id, new Set());
    for (const r of this.rooms.values()) this.roomBusy.set(r.id, new Set());
    for (let d = 0; d < 4; d++) this.roomOwner.push(new Map());
  }

  /* ---------------------------------------------------------------- */
  /* Room allocation                                                   */
  /* ---------------------------------------------------------------- */

  /**
   * Rooms are the hard cap on the whole week: 20 rooms, and companies want far
   * more panels than that. Allocation is round robin by company priority
   * rather than first come first served, because giving one mass recruiter all
   * 20 rooms is technically optimal for throughput and politically fatal.
   * Every company that shows up gets at least one panel before anyone gets a
   * second.
   */
  allocateRooms(): { panelId: string; roomId: string }[] {
    const allocated: { panelId: string; roomId: string }[] = [];

    for (let day = 0; day < 4; day++) {
      const dayPanels = [...this.panels.values()].filter(
        (p) => !p.dropped && p.roomId === null && p.day === day && p.availableFrom < p.availableTo,
      );
      if (dayPanels.length === 0) continue;

      const byCompany = new Map<string, Panel[]>();
      for (const p of dayPanels) {
        if (!byCompany.has(p.companyId)) byCompany.set(p.companyId, []);
        byCompany.get(p.companyId)!.push(p);
      }

      const order = [...byCompany.keys()].sort((a, b) => {
        const ca = this.companies.get(a)!;
        const cb = this.companies.get(b)!;
        if (ca.priority !== cb.priority) return ca.priority - cb.priority;
        return cb.interviewQueue.length - ca.interviewQueue.length;
      });

      const dayStart = day * SLOTS_PER_DAY;
      const dayEnd = (day + 1) * SLOTS_PER_DAY;
      /**
       * Unowned rooms, cleanest first. A room that still holds a running
       * interview is not disqualified, only deprioritised: findSlot checks
       * room occupancy per booking, so a panel can safely take a room that is
       * busy until 11:00 and simply start after it. Requiring a whole clear day
       * throws away most of the capacity a dropped panel hands back.
       */
      const free = [...this.rooms.values()]
        .filter((r) => !this.roomOwner[day].has(r.id))
        .map((r) => ({ r, clean: this.roomFree(r.id, dayStart, dayEnd) ? 0 : 1 }))
        .sort((a, b) => a.clean - b.clean)
        .map((x) => x.r);
      let ri = 0;
      let round = 0;
      let placedThisRound = true;

      while (ri < free.length && placedThisRound) {
        placedThisRound = false;
        for (const cid of order) {
          const list = byCompany.get(cid)!;
          if (round >= list.length) continue;
          if (ri >= free.length) break;
          const panel = list[round];
          const room = free[ri++];
          panel.roomId = room.id;
          this.roomOwner[day].set(room.id, panel.id);
          allocated.push({ panelId: panel.id, roomId: room.id });
          placedThisRound = true;
        }
        round++;
      }
    }
    return allocated;
  }

  /** Drop a room out of service entirely. */
  retireRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /** Free a room, for example when a panel drops or a room goes offline. */
  releasePanelRoom(panelId: string): void {
    const panel = this.panels.get(panelId);
    if (!panel || panel.roomId === null) return;
    this.roomOwner[panel.day].delete(panel.roomId);
    panel.roomId = null;
  }

  /**
   * A room that is both unowned that day AND genuinely empty for the span we
   * need. "Unowned" alone is not enough: a room vacated by a dropped panel can
   * still hold an interview that is mid flight.
   */
  findFreeRoom(day: number, from: number, to: number): Room | null {
    for (const r of this.rooms.values()) {
      if (this.roomOwner[day].has(r.id)) continue;
      if (!this.roomFree(r.id, from, to)) continue;
      return r;
    }
    return null;
  }

  /**
   * Move a panel to a different room from `fromSlot` onward, rewriting its
   * bookings through the normal remove/place path so occupancy stays correct.
   * Mutating assignment.roomId directly is the obvious shortcut and it silently
   * desynchronises roomBusy, which is exactly how double bookings get in.
   */
  relocatePanel(panelId: string, newRoomId: string, fromSlot: number): Assignment[] {
    const panel = this.panels.get(panelId)!;
    const affected = this.assignmentsForPanel(panelId).filter((a) => a.startSlot >= fromSlot);
    const moved: Assignment[] = [];
    for (const a of affected) {
      const saved = this.remove(a.id);
      if (!saved) continue;
      if (this.roomFree(newRoomId, saved.startSlot, saved.endSlot)) {
        moved.push(this.place(saved.companyId, saved.studentId, {
          panelId: saved.panelId, roomId: newRoomId,
          startSlot: saved.startSlot, endSlot: saved.endSlot,
        }));
      } else {
        // Put it back where it was; the caller will treat it as displaced.
        this.place(saved.companyId, saved.studentId, {
          panelId: saved.panelId, roomId: saved.roomId,
          startSlot: saved.startSlot, endSlot: saved.endSlot,
        });
      }
    }
    panel.roomId = newRoomId;
    this.roomOwner[panel.day].set(newRoomId, panelId);
    return moved;
  }

  assignPanelToRoom(panelId: string, roomId: string): void {
    const panel = this.panels.get(panelId)!;
    panel.roomId = roomId;
    this.roomOwner[panel.day].set(roomId, panelId);
  }

  /* ---------------------------------------------------------------- */
  /* Occupancy                                                         */
  /* ---------------------------------------------------------------- */

  private panelFree(panelId: string, start: number, end: number): boolean {
    const busy = this.panelBusy.get(panelId)!;
    for (let s = start; s < end; s++) if (busy.has(s)) return false;
    return true;
  }

  private roomFree(roomId: string, start: number, end: number): boolean {
    const busy = this.roomBusy.get(roomId);
    if (!busy) return true;
    for (let s = start; s < end; s++) if (busy.has(s)) return false;
    return true;
  }

  /**
   * A student is free for [start, end) only if every existing interview is
   * separated by enough slots to walk there. Buffer depends on whether the two
   * rooms are in the same block.
   */
  private studentFree(studentId: string, start: number, end: number, block: string): boolean {
    const intervals = this.studentIntervals.get(studentId);
    if (!intervals) return true;
    for (const iv of intervals) {
      const gap = travelSlots(iv.block, block);
      if (start < iv.end + gap && iv.start < end + gap) return false;
    }
    return true;
  }

  studentBusySlots(studentId: string): StudentInterval[] {
    return this.studentIntervals.get(studentId) ?? [];
  }

  /* ---------------------------------------------------------------- */
  /* Search                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Find a place for one interview. Returns a precise reason on failure,
   * because "could not schedule" with no explanation is exactly the silent
   * failure the coordinator already gets from the whiteboard.
   */
  findSlot(companyId: string, studentId: string, opts: FindOptions = {}): PlacementResult {
    const company = this.companies.get(companyId)!;
    const student = this.students.get(studentId)!;
    if (student.withdrawn) {
      return { ok: false, reason: 'STUDENT_WITHDRAWN', detail: `${student.name} has withdrawn` };
    }

    const length = durationToSlots(company.interviewMinutes);
    const panels = [...this.panels.values()].filter(
      (p) => p.companyId === companyId && !p.dropped && p.roomId !== null
        // A room can be taken out of service mid day; a panel still pointing at
        // one is unusable until it is relocated.
        && this.rooms.has(p.roomId)
        && p.availableFrom < p.availableTo
        && !(opts.excludePanels?.has(p.id)),
    );

    if (panels.length === 0) {
      return {
        ok: false,
        reason: 'NO_ROOM_FOR_PANEL',
        detail: `${company.name} has no panel with a room allocated`,
      };
    }

    let sawFreePanelSlot = false;
    let best: PlacementCandidate | null = null;
    let bestCost = Infinity;

    for (const panel of panels) {
      const room = this.rooms.get(panel.roomId!)!;
      const from = Math.max(panel.availableFrom, opts.earliest ?? 0);
      for (let start = from; start + length <= panel.availableTo; start++) {
        if (!spanIsUsable(start, length)) continue;
        const end = start + length;
        if (!this.panelFree(panel.id, start, end)) continue;
        if (!this.roomFree(room.id, start, end)) continue;
        sawFreePanelSlot = true;
        if (!this.studentFree(studentId, start, end, room.block)) continue;

        // Cost: distance from the anchor if replanning, otherwise earliest wins.
        // The small panel index tiebreak keeps panels filling evenly instead of
        // stacking everything on Panel 1 and leaving Panel 4 idle.
        const cost = opts.anchor !== undefined
          ? Math.abs(start - opts.anchor) * 10 + this.panelBusy.get(panel.id)!.size
          : start * 10 + this.panelBusy.get(panel.id)!.size;

        if (cost < bestCost) {
          bestCost = cost;
          best = { panelId: panel.id, roomId: room.id, startSlot: start, endSlot: end };
        }
        if (opts.anchor === undefined) break; // earliest on this panel, move on
      }
    }

    if (best) return { ok: true, candidate: best };

    if (!sawFreePanelSlot) {
      return {
        ok: false,
        reason: 'NO_PANEL_CAPACITY',
        detail: `${company.name} panels are fully booked for its window`,
      };
    }
    return {
      ok: false,
      reason: 'STUDENT_FULLY_BOOKED',
      detail: `${student.name} clashes with every free ${company.name} slot`,
    };
  }

  place(companyId: string, studentId: string, c: PlacementCandidate): Assignment {
    const a: Assignment = {
      id: `A${++this.idCounter}`,
      companyId,
      panelId: c.panelId,
      roomId: c.roomId,
      studentId,
      startSlot: c.startSlot,
      endSlot: c.endSlot,
      locked: false,
    };
    this.assignments.set(a.id, a);
    const busy = this.panelBusy.get(c.panelId)!;
    for (let s = c.startSlot; s < c.endSlot; s++) busy.add(s);
    if (!this.roomBusy.has(c.roomId)) this.roomBusy.set(c.roomId, new Set());
    const rbusy = this.roomBusy.get(c.roomId)!;
    for (let s = c.startSlot; s < c.endSlot; s++) rbusy.add(s);
    if (!this.studentIntervals.has(studentId)) this.studentIntervals.set(studentId, []);
    this.studentIntervals.get(studentId)!.push({
      assignmentId: a.id,
      start: c.startSlot,
      end: c.endSlot,
      block: this.rooms.get(c.roomId)!.block,
    });
    return a;
  }

  remove(assignmentId: string): Assignment | null {
    const a = this.assignments.get(assignmentId);
    if (!a) return null;
    this.assignments.delete(assignmentId);
    const busy = this.panelBusy.get(a.panelId);
    if (busy) for (let s = a.startSlot; s < a.endSlot; s++) busy.delete(s);
    const rbusy = this.roomBusy.get(a.roomId);
    if (rbusy) for (let s = a.startSlot; s < a.endSlot; s++) rbusy.delete(s);
    const list = this.studentIntervals.get(a.studentId);
    if (list) {
      this.studentIntervals.set(a.studentId, list.filter((iv) => iv.assignmentId !== assignmentId));
    }
    return a;
  }

  getAssignments(): Assignment[] {
    return [...this.assignments.values()].sort((a, b) => a.startSlot - b.startSlot);
  }

  getAssignment(id: string): Assignment | undefined {
    return this.assignments.get(id);
  }

  assignmentsForPanel(panelId: string): Assignment[] {
    return this.getAssignments().filter((a) => a.panelId === panelId);
  }

  assignmentsForRoom(roomId: string): Assignment[] {
    return this.getAssignments().filter((a) => a.roomId === roomId);
  }

  assignmentsForStudent(studentId: string): Assignment[] {
    return this.getAssignments().filter((a) => a.studentId === studentId);
  }

  assignmentsForCompany(companyId: string): Assignment[] {
    return this.getAssignments().filter((a) => a.companyId === companyId);
  }

  describe(a: Assignment): string {
    const c = this.companies.get(a.companyId)!;
    const s = this.students.get(a.studentId)!;
    const r = this.rooms.get(a.roomId)!;
    return `${s.name} (${s.usn}) with ${c.name} at ${formatSlot(a.startSlot)} in ${r.name}`;
  }
}
