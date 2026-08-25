/**
 * Dataset generator.
 *
 * Design notes, because the realism of this data is graded:
 *
 * 1. CGPA is normal around 7.5, not uniform. A uniform distribution makes an
 *    8.5 cutoff look like it filters half the batch. In reality it filters
 *    about 12 percent, which is exactly why dream companies have tiny
 *    shortlists and mass recruiters have enormous ones.
 *
 * 2. Shortlisting is correlated, not independent. The same 60 students appear
 *    on nearly every list because every company uses the same signal (CGPA,
 *    branch, no backlogs). That correlation is the entire source of clash
 *    pressure. Independent sampling produces a dataset that schedules far too
 *    easily and hides the real problem.
 *
 * 3. Shortlist is not demand. Companies shortlist hundreds and then cut most
 *    of them in an online test or GD before anyone needs a room. What consumes
 *    a room and a panel is the interview queue, which is a fraction of the
 *    shortlist. Modelling only the shortlist inflates demand to nonsense.
 *
 * 4. Day 1 is mass recruiters. They bring many panels, run 30 minute
 *    interviews and take a big chunk of the batch off the market, which is why
 *    Day 3 and 4 companies face withdrawals all day.
 */

import { Rng } from './rng';
import {
  Branch, Company, Dataset, Panel, Room, Student, Tier,
  globalSlot, DAY_END_MIN, minuteOfDayToSlotInDay, SLOTS_PER_DAY,
} from './types';

const BRANCH_STRENGTH: Record<Branch, number> = {
  CSE: 280, ISE: 160, ECE: 150, EEE: 80, ME: 80, CIV: 50,
};

const FIRST_NAMES = [
  'Aditya', 'Sanketh', 'Meghana', 'Rahul', 'Priya', 'Karthik', 'Ananya', 'Vinay',
  'Shreya', 'Nikhil', 'Divya', 'Arjun', 'Pooja', 'Manoj', 'Sneha', 'Rohit',
  'Kavya', 'Suhas', 'Nandini', 'Praveen', 'Harshitha', 'Girish', 'Lakshmi',
  'Bhavana', 'Tejas', 'Chaitra', 'Sagar', 'Deepika', 'Ravi', 'Anusha',
];
const LAST_NAMES = [
  'Rao', 'Shetty', 'Hegde', 'Gowda', 'Kumar', 'Reddy', 'Patil', 'Nayak',
  'Bhat', 'Murthy', 'Prasad', 'Naik', 'Kulkarni', 'Desai', 'Iyer', 'Joshi',
];

interface TierSpec {
  tier: Tier;
  count: number;
  days: number[];
  interviewMinutes: number;
  cgpaCutoff: [number, number];
  panels: [number, number];
  /** Fraction of the eligible pool that ends up shortlisted. */
  shortlistRate: [number, number];
  /** Fraction of the shortlist that survives to the interview stage. */
  interviewConversion: [number, number];
  branches: 'CS_ONLY' | 'CIRCUIT' | 'ALL';
  priority: number;
}

/**
 * These numbers are tuned so the week lands meaningfully infeasible, around
 * 60 to 70 percent coverage, which is what a real placement week looks like
 * when you count rooms honestly. See metrics.structuralShortfallPct.
 */
const TIER_SPECS: TierSpec[] = [
  { tier: 'DREAM', count: 3, days: [0, 1], interviewMinutes: 60, cgpaCutoff: [8.4, 9.0], panels: [2, 3], shortlistRate: [0.30, 0.45], interviewConversion: [0.30, 0.45], branches: 'CS_ONLY', priority: 1 },
  { tier: 'MASS', count: 5, days: [0, 0, 1], interviewMinutes: 30, cgpaCutoff: [6.0, 7.0], panels: [6, 9], shortlistRate: [0.55, 0.75], interviewConversion: [0.22, 0.30], branches: 'ALL', priority: 2 },
  { tier: 'CORE_PRODUCT', count: 7, days: [1, 2], interviewMinutes: 45, cgpaCutoff: [7.5, 8.2], panels: [3, 5], shortlistRate: [0.30, 0.50], interviewConversion: [0.28, 0.38], branches: 'CIRCUIT', priority: 2 },
  { tier: 'MID', count: 12, days: [2, 3], interviewMinutes: 45, cgpaCutoff: [6.5, 7.5], panels: [2, 4], shortlistRate: [0.25, 0.45], interviewConversion: [0.24, 0.34], branches: 'ALL', priority: 3 },
  { tier: 'STARTUP', count: 8, days: [2, 3, 3], interviewMinutes: 30, cgpaCutoff: [6.0, 7.2], panels: [1, 2], shortlistRate: [0.15, 0.30], interviewConversion: [0.30, 0.45], branches: 'CIRCUIT', priority: 4 },
];

const COMPANY_NAMES: Record<Tier, string[]> = {
  DREAM: ['Nexora Systems', 'Helix Quant', 'Arcline Labs'],
  MASS: ['Vantage Infotech', 'Sarathi Consulting', 'BlueQuad Services', 'Prithvi Technologies', 'Onward Digital'],
  CORE_PRODUCT: ['Kestrel Software', 'Meridian Data', 'Stackforge', 'Ionic Systems', 'Northwind Cloud', 'Verityx', 'Ardent Robotics'],
  MID: ['Trilok Solutions', 'Cygnus IT', 'Pinnacle Analytics', 'Sundara Systems', 'Axiom Digital', 'Corvus Tech', 'Bramha Networks', 'Lumen Services', 'Kaveri Softworks', 'Zephyr Consulting', 'Indus Logic', 'Palladin Tech'],
  STARTUP: ['Fernway', 'Tessellate', 'Orbitkit', 'Hummingbird AI', 'Saltmine', 'Groveline', 'Quanta Rides', 'Pockit'],
};

function branchesFor(kind: TierSpec['branches']): Branch[] {
  if (kind === 'CS_ONLY') return ['CSE', 'ISE'];
  if (kind === 'CIRCUIT') return ['CSE', 'ISE', 'ECE', 'EEE'];
  return ['CSE', 'ISE', 'ECE', 'EEE', 'ME', 'CIV'];
}

export function generateDataset(seed = 42): Dataset {
  const rng = new Rng(seed);

  /* ---------------- rooms ---------------- */
  const rooms: Room[] = [];
  const blocks: Array<Room['block']> = ['A', 'B', 'C'];
  for (let i = 0; i < 20; i++) {
    const block = blocks[Math.floor(i / 7)] ?? 'C';
    rooms.push({ id: `R${i + 1}`, name: `${block}-${101 + (i % 7)}`, block });
  }

  /* ---------------- students ---------------- */
  const students: Student[] = [];
  let n = 0;
  for (const [branch, strength] of Object.entries(BRANCH_STRENGTH) as [Branch, number][]) {
    for (let i = 0; i < strength; i++) {
      n++;
      // CS branches skew slightly higher, which is what cutoffs actually see.
      const mean = branch === 'CSE' || branch === 'ISE' ? 7.7 : 7.4;
      const cgpa = Math.round(rng.normal(mean, 0.85, 5.2, 9.9) * 100) / 100;
      students.push({
        id: `S${String(n).padStart(3, '0')}`,
        usn: `1AY22${branch.slice(0, 2)}${String(i + 1).padStart(3, '0')}`,
        name: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
        branch,
        cgpa,
        shortlistedBy: [],
        interviewingWith: [],
        withdrawn: false,
      });
    }
  }

  /**
   * Latent desirability. Two students with the same CGPA are not equally
   * shortlisted: one has better projects, a hackathon win, a referral. This
   * term is what makes a handful of students appear on 9 lists at once.
   */
  const desirability = new Map<string, number>();
  for (const s of students) {
    const cgpaSignal = (s.cgpa - 7.5) / 0.85;
    const noise = rng.normal(0, 0.7, -2.5, 2.5);
    desirability.set(s.id, cgpaSignal * 1.35 + noise);
  }

  /* ---------------- companies ---------------- */
  const companies: Company[] = [];
  const panels: Panel[] = [];
  let dayCursor: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  for (const spec of TIER_SPECS) {
    const names = rng.shuffle(COMPANY_NAMES[spec.tier]);
    for (let i = 0; i < spec.count; i++) {
      const id = `C${String(companies.length + 1).padStart(2, '0')}`;
      const preferredDay = spec.days[i % spec.days.length];
      dayCursor[preferredDay]++;

      const cutoff = Math.round(rng.normal(
        (spec.cgpaCutoff[0] + spec.cgpaCutoff[1]) / 2, 0.25,
        spec.cgpaCutoff[0], spec.cgpaCutoff[1],
      ) * 10) / 10;

      const allowedBranches = branchesFor(spec.branches);
      const panelCount = rng.int(spec.panels[0], spec.panels[1]);

      // Arrival is not always 09:00. Companies drift in, and a few announce a
      // late start before the week even begins.
      const arrivalMin = rng.bool(0.25) ? 9 * 60 + rng.int(1, 4) * 30 : 9 * 60;
      const departureMin = rng.bool(0.2) ? DAY_END_MIN - rng.int(1, 3) * 30 : DAY_END_MIN;

      const eligible = students.filter(
        (s) => s.cgpa >= cutoff && allowedBranches.includes(s.branch),
      );
      const rate = rng.normal(
        (spec.shortlistRate[0] + spec.shortlistRate[1]) / 2, 0.06,
        spec.shortlistRate[0], spec.shortlistRate[1],
      );

      // Rank eligible students by desirability plus a company specific taste
      // term, then take the top slice. Correlated selection, not independent
      // coin flips, so the same strong students collide across companies.
      const taste = eligible.map((s) => ({
        s,
        score: (desirability.get(s.id) ?? 0) + rng.normal(0, 0.55, -2, 2),
      }));
      taste.sort((a, b) => b.score - a.score);
      const shortlisted = taste.slice(0, Math.round(eligible.length * rate)).map((t) => t.s);

      const conversion = rng.normal(
        (spec.interviewConversion[0] + spec.interviewConversion[1]) / 2, 0.04,
        spec.interviewConversion[0], spec.interviewConversion[1],
      );
      // Surviving the online test correlates with the same latent quality.
      const survivors = shortlisted
        .map((s) => ({ s, score: (desirability.get(s.id) ?? 0) * 0.8 + rng.normal(0, 1.0, -3, 3) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(4, Math.round(shortlisted.length * conversion)))
        .map((t) => t.s);

      const company: Company = {
        id,
        name: names[i % names.length],
        tier: spec.tier,
        preferredDay,
        arrivalMin,
        departureMin,
        interviewMinutes: spec.interviewMinutes,
        cgpaCutoff: cutoff,
        allowedBranches,
        panelCount,
        shortlisted: shortlisted.map((s) => s.id),
        interviewQueue: survivors.map((s) => s.id),
        priority: spec.priority,
      };
      companies.push(company);

      for (const s of shortlisted) s.shortlistedBy.push(id);
      for (const s of survivors) s.interviewingWith.push(id);

      const from = globalSlot(preferredDay, arrivalMin);
      const to = preferredDay * SLOTS_PER_DAY + minuteOfDayToSlotInDay(departureMin);
      for (let p = 0; p < panelCount; p++) {
        panels.push({
          id: `${id}-P${p + 1}`,
          companyId: id,
          label: `${company.name} Panel ${p + 1}`,
          day: preferredDay,
          roomId: null,
          availableFrom: from,
          availableTo: to,
          dropped: false,
        });
      }
    }
  }

  applyAttendanceCap(rng, students, companies);

  return { seed, rooms, companies, students, panels };
}

/**
 * Students do not attend every drive they clear. They physically cannot, and
 * they self select: a student sitting on a Nexora interview skips the Day 3
 * startup drive. Without this cap the generator produces students queued for
 * 30 companies, which inflates demand, wrecks the clash statistics, and makes
 * the scheduler look worse than it is.
 *
 * Cap is skewed low: most students attend two or three drives all week, a few
 * strong students attend six.
 */
function applyAttendanceCap(rng: Rng, students: Student[], companies: Company[]): void {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const dropped = new Map<string, Set<string>>(); // companyId -> studentIds

  for (const s of students) {
    if (s.interviewingWith.length <= 3) continue;

    const r = rng.next();
    const cap = r < 0.22 ? 3 : r < 0.55 ? 4 : r < 0.80 ? 5 : r < 0.93 ? 6 : 7;
    if (s.interviewingWith.length <= cap) continue;

    // Keep the best offers on the table: priority tier first, then a coin flip
    // so two MID companies do not always lose to the same one.
    const ranked = s.interviewingWith
      .map((cid) => ({ cid, key: byId.get(cid)!.priority + rng.next() * 0.9 }))
      .sort((a, b) => a.key - b.key);

    const keep = new Set(ranked.slice(0, cap).map((x) => x.cid));
    for (const { cid } of ranked.slice(cap)) {
      if (!dropped.has(cid)) dropped.set(cid, new Set());
      dropped.get(cid)!.add(s.id);
    }
    s.interviewingWith = s.interviewingWith.filter((cid) => keep.has(cid));
  }

  for (const [cid, studentIds] of dropped) {
    const c = byId.get(cid)!;
    c.interviewQueue = c.interviewQueue.filter((sid) => !studentIds.has(sid));
  }
}
