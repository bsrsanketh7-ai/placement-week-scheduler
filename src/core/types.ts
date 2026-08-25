/**
 * Core domain model for the placement week scheduler.
 *
 * TIME MODEL
 * Time is discretised into SLOT_MINUTES buckets. A global slot index encodes
 * both day and time: slot = day * SLOTS_PER_DAY + slotWithinDay.
 * Every interview duration in the dataset is a multiple of SLOT_MINUTES, so a
 * schedule is exact, not approximate.
 */

export const SLOT_MINUTES = 15;
export const DAY_START_MIN = 9 * 60;      // 09:00
export const DAY_END_MIN = 17 * 60 + 30;  // 17:30
export const LUNCH_START_MIN = 13 * 60;   // 13:00
export const LUNCH_END_MIN = 13 * 60 + 45;
export const DAYS = 4;

export const SLOTS_PER_DAY = (DAY_END_MIN - DAY_START_MIN) / SLOT_MINUTES; // 34
export const TOTAL_SLOTS = SLOTS_PER_DAY * DAYS;

export type Branch = 'CSE' | 'ISE' | 'ECE' | 'EEE' | 'ME' | 'CIV';

/**
 * Tier drives almost every realistic behaviour: who gets Day 1, how many
 * panels they bring, how long they interview for, and who gets bumped when
 * the week does not fit.
 */
export type Tier =
  | 'DREAM'        // 40+ LPA, tiny shortlist, long interviews, very high cutoff
  | 'MASS'         // service companies, hundreds shortlisted, short interviews
  | 'CORE_PRODUCT' // solid product companies, mid shortlist, long interviews
  | 'MID'          // mid market IT and analytics
  | 'STARTUP';     // small, unpredictable, low panel count

export interface Room {
  id: string;
  name: string;
  /** Rooms live in blocks. Cross block movement costs a student more buffer. */
  block: 'A' | 'B' | 'C';
}

export interface Panel {
  id: string;
  companyId: string;
  label: string;
  /**
   * The day this panel belongs to, fixed at creation. Deliberately NOT derived
   * from availableFrom: a late arrival shifts the window, and deriving the day
   * from a shifted window silently migrates the panel to the next day and
   * corrupts room ownership. A panel's day only changes by explicit decision.
   */
  day: number;
  /** Assigned by the room allocator, null until then. */
  roomId: string | null;
  /** Global slot indices this panel can actually interview in. */
  availableFrom: number;
  availableTo: number; // exclusive
  dropped: boolean;
}

export interface Company {
  id: string;
  name: string;
  tier: Tier;
  /** Day the company insists on. Bending this needs coordinator approval. */
  preferredDay: number;
  /** Company arrival, in minutes past midnight, on its day. */
  arrivalMin: number;
  departureMin: number;
  interviewMinutes: number;
  cgpaCutoff: number;
  allowedBranches: Branch[];
  panelCount: number;
  /** Everyone the company shortlisted, including those who never reach an interview. */
  shortlisted: string[];
  /**
   * Students who cleared the pre interview stage (aptitude, GD, online test)
   * and therefore actually need a room and a panel. This is the real demand.
   */
  interviewQueue: string[];
  /** Lower number wins when two companies want the same scarce room. */
  priority: number;
}

export interface Student {
  id: string;
  usn: string;
  name: string;
  branch: Branch;
  cgpa: number;
  shortlistedBy: string[];
  interviewingWith: string[];
  /** Set during the day when a student accepts an offer and stops attending. */
  withdrawn: boolean;
  withdrawnAt?: number; // global slot
}

export interface Assignment {
  id: string;
  companyId: string;
  panelId: string;
  roomId: string;
  studentId: string;
  startSlot: number;
  endSlot: number; // exclusive
  /** true once the coordinator has marked it as done, used to protect history. */
  locked: boolean;
}

export type UnscheduledReason =
  | 'NO_PANEL_CAPACITY'
  | 'STUDENT_FULLY_BOOKED'
  | 'NO_ROOM_FOR_PANEL'
  | 'COMPANY_WINDOW_TOO_SHORT'
  | 'STUDENT_WITHDRAWN'
  | 'PANEL_DROPPED';

export interface Unscheduled {
  companyId: string;
  studentId: string;
  reason: UnscheduledReason;
  detail: string;
}

export interface Dataset {
  seed: number;
  rooms: Room[];
  companies: Company[];
  students: Student[];
  panels: Panel[];
}

export interface Schedule {
  assignments: Assignment[];
  unscheduled: Unscheduled[];
  /** Panel to room decisions, kept separate so a replan can revisit them. */
  panelRooms: Record<string, string | null>;
}

export interface DayFeasibility {
  day: number;
  demandMinutes: number;
  capacityMinutes: number;
  demandedInterviews: number;
  scheduledInterviews: number;
  coveragePct: number;
  panelsRequested: number;
  roomsAvailable: number;
  oversubscribedPct: number;
}

export interface Metrics {
  perDay: DayFeasibility[];
  demandedInterviews: number;
  scheduledInterviews: number;
  coveragePct: number;
  studentClashes: number;
  roomDoubleBookings: number;
  panelDoubleBookings: number;
  roomUtilisationPct: number;
  avgStudentIdleMinutes: number;
  maxStudentIdleMinutes: number;
  studentsWithZeroInterviews: number;
  demandMinutes: number;
  capacityMinutes: number;
  structuralShortfallPct: number;
}

/* ------------------------------------------------------------------ */
/* Time helpers                                                        */
/* ------------------------------------------------------------------ */

export function slotToDay(slot: number): number {
  return Math.floor(slot / SLOTS_PER_DAY);
}

export function slotWithinDay(slot: number): number {
  return slot % SLOTS_PER_DAY;
}

export function slotToMinuteOfDay(slot: number): number {
  return DAY_START_MIN + slotWithinDay(slot) * SLOT_MINUTES;
}

export function minuteOfDayToSlotInDay(min: number): number {
  return Math.ceil((min - DAY_START_MIN) / SLOT_MINUTES);
}

export function globalSlot(day: number, minuteOfDay: number): number {
  return day * SLOTS_PER_DAY + minuteOfDayToSlotInDay(minuteOfDay);
}

export function formatSlot(slot: number): string {
  const day = slotToDay(slot);
  const min = slotToMinuteOfDay(slot);
  const hh = String(Math.floor(min / 60)).padStart(2, '0');
  const mm = String(min % 60).padStart(2, '0');
  return `D${day + 1} ${hh}:${mm}`;
}

/** Slots that fall inside the lunch block, where no panel interviews. */
export function isLunchSlot(slot: number): boolean {
  const min = slotToMinuteOfDay(slot);
  return min >= LUNCH_START_MIN && min < LUNCH_END_MIN;
}

/** A booking must not straddle lunch and must stay inside the day. */
export function spanIsUsable(startSlot: number, lengthSlots: number): boolean {
  if (slotToDay(startSlot) !== slotToDay(startSlot + lengthSlots - 1)) return false;
  for (let s = startSlot; s < startSlot + lengthSlots; s++) {
    if (isLunchSlot(s)) return false;
  }
  return true;
}

export function durationToSlots(minutes: number): number {
  return Math.ceil(minutes / SLOT_MINUTES);
}

/**
 * Buffer a student needs between two interviews. Walking between blocks on a
 * crowded campus is not free, and pretending it is produces schedules that
 * look valid and fall apart in the corridor.
 */
export function travelSlots(fromBlock: string, toBlock: string): number {
  return fromBlock === toBlock ? 1 : 2; // 15 min vs 30 min
}
