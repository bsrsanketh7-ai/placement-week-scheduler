# Placement Week Scheduler

Scheduling and live replanning for a placement week: 35 companies, 800 students,
4 days, 20 rooms.

```bash
npm install
npm run dev      # the coordinator's console at localhost:3000
npm run demo     # generate a dataset and schedule it, print metrics
npm run disrupt  # run the "biggest recruiter is 3 hours late" scenario
npm run stress   # 450+ randomised replans, asserting invariants
npm run check    # typecheck + every test script below
```

No database and no network. The whole thing runs off a laptop, which is the
environment a placement week actually has.

---

## The finding that shapes everything else

The week is structurally infeasible, and that is not a bug in the data.

20 rooms x 4 days x 7.75 usable hours is about 1,240 interviews of 30 minutes
for the entire week. A realistic interview-stage demand is roughly 900 to 1,000
interviews, which fits in aggregate. It still does not schedule, because demand
is not spread evenly:

| Day | Demanded | Scheduled | Coverage | Panels wanted | Rooms |
|-----|---------:|----------:|---------:|--------------:|------:|
| 1   | 435      | 218       | 50%      | 33            | 20    |
| 2   | 170      | 142       | 84%      | 32            | 20    |
| 3   | 187      | 148       | 79%      | 33            | 20    |
| 4   | 125      | 125       | 100%     | 27            | 20    |

Day 1 is 48% oversubscribed while Day 4 has slack, and companies will not swap
days without approval, so the slack does not help. Overall coverage is 69%.

Reporting a single aggregate capacity number would have hidden this completely.
The system opens with the per-day breakdown for that reason.

---

## What counts as a good schedule

Reported in `metrics.ts` and shown on the dashboard:

- **Coverage** - interviews placed over interviews demanded. Withdrawn students
  are excluded from demand. A student who accepted an offer and went home is
  not an interview we failed to schedule, and counting them as one makes every
  replan look like a regression.
- **Student clashes, room double bookings, panel double bookings** - all must be
  zero. Recomputed from the raw assignment list rather than trusted from the
  engine, so an engine bug surfaces on the dashboard.
- **Room utilisation**.
- **Average and worst student wait** - the gap between a student's first and
  last interview of the day minus time actually spent interviewing. The number
  students complain about and that most schedulers never report.
- **Replan churn** - interviews moved as a percentage of interviews still ahead.
  The headline number for any disruption.

---

## Replanning

A replan is not a re-solve. Re-solving gives a better schedule on paper and a
catastrophe in the building, because 200 students get a new time for a
disruption that structurally affected 40.

Three rings:

- **Ring 0, untouched.** Anything already started or beginning within the notice
  window (default 30 minutes) is frozen. Telling a student at 10:55 that their
  11:00 interview moved is not a replan.
- **Ring 1, displaced.** Interviews the disruption actually invalidated. These
  have no choice.
- **Ring 2, volunteered.** Other interviews shuffled to make room for Ring 1,
  capped at `maxDisplacements` (default 12).

Handled disruptions: company arriving N hours late, panel dropping out, students
withdrawing, room becoming unavailable.

Every replan emits a diff: what moved and from where, what was lost, what was
freed, who needs to be told, and the churn numbers.

### Which constraint bends first

1. **Slack time.** Gaps get squeezed. Costless, so it goes first.
2. **Panel end time.** A panel runs up to 60 minutes past its stated departure,
   never past the end of its own day.
3. **Bounded displacement of other students**, capped at 12.
4. **Nothing else.** Interview duration never shrinks. CGPA cutoffs never bend,
   because they are the company's policy and not ours to trade away. A company's
   day never changes automatically.

Past step 4 the system stops and escalates. `diff.escalations` states the
question and names the options with their costs:

> 4 Onward Digital interviews have nowhere to go today.
> - Extend past 17:30 (needs company sign off)
> - Move the remainder to a later day (needs company and student sign off)
> - Cut 4 candidates from the list (needs company sign off)
> - Accept as unscheduled and notify

Every one of those trades goodwill with a company or a student. That is a
placement officer's decision, not a scheduler's. The system's job is to price
each option, not to pick one quietly.

The same logic governs freed capacity. When withdrawals hand back 70 slots while
283 students sit unscheduled, the system offers them rather than filling them.
It does not know who is still on campus.

---

## Measured behaviour

Live scenario, `npm run disrupt`: the biggest Day 1 recruiter arrives 3 hours
late, one of its panels drops, 15 students withdraw.

| | |
|---|---|
| Replan time | 19 ms |
| Frozen | 37 |
| Displaced by the disruption | 84 |
| **Actually moved** | **10, or 1.7% of remaining appointments** |
| Cancelled because the student left | 70 (capacity freed) |
| Cancelled because nowhere to put them | 4 |
| Notice violations | 0 |
| Untouched | 549 |

Fuzz testing, `npm run stress`: 457 replans across 120 seeds, four stacked
disruptions each. Zero invariant failures, worst churn 12.5%, slowest 16 ms.

The stress test found two real bugs that the happy path never touched:

1. A panel's day was derived from its availability window, so a late arrival
   that pushed the window past midnight migrated the panel to the next day and
   corrupted room ownership. Panels now carry an explicit immutable day.
2. Room exclusivity was argued "by construction" from the fact that a panel owns
   its room. That argument is false the moment a panel relocates: the room it
   vacates still holds an interview that is running, and a 60-minute interview
   starting at 09:15 runs past a 09:30 notice boundary. Rooms now track
   occupancy explicitly, exactly like panels.

---

## The dataset

`generator.ts`, seeded so any run is reproducible.

- CGPA is normal around 7.5, not uniform. Uniform makes an 8.5 cutoff look like
  it filters half the batch; in reality it filters about 12%, which is why dream
  companies have tiny shortlists and mass recruiters have enormous ones.
- Shortlisting is correlated, not independent. Every company scores on the same
  latent signal, so the same strong students land on many lists at once. That
  correlation is the entire source of clash pressure; independent sampling makes
  the problem schedule far too easily.
- Shortlist is not demand. Companies shortlist hundreds and cut most of them in
  an online test before anyone needs a room. `shortlisted` and `interviewQueue`
  are modelled separately.
- Students self select. Nobody attends nine drives; they keep the best offers on
  the table and skip the rest.
- Rooms sit in blocks. A student changing blocks between interviews gets 30
  minutes of buffer instead of 15. Schedules that assume teleportation validate
  cleanly and fall apart in the corridor.

---

## The console

Three things on screen: current state across the top, what is about to break in
the strip above the grid, and the grid itself.

**Upcoming conflicts** are forward looking on purpose. Clashes and double
bookings are zero by construction, so listing them would be a row that is always
empty. What actually collapses a placement day is a schedule that is legal right
now and one delay away from not being:

- a panel with seven back-to-back interviews and no slack, where one overrun
  pushes everyone behind it
- a student with exactly the minimum turnaround, crossing between blocks with no
  margin to absorb anything
- a student sitting on campus for four hours between two interviews
- a company with panel time left and students who never got a slot

Repetition is collapsed before ranking. Twenty students on a minimum turnaround
is one fact about the day, not twenty alerts, so each kind shows at most two
named cases plus a count of the rest. A panel that repeats the same sentence six
times trains the coordinator to stop reading it.

State is a pure fold over `(seed, ordered disruption log)`. Nothing is mutated
in place.

That is what makes preview and undo trivial: a preview is a replay with one
extra disruption appended, an undo is a replay with the last one popped. There
is no inverse operation to write and no undo stack to corrupt. A full rebuild on
800 students takes 67 ms, far cheaper than the bugs an undo stack would cost.
`scripts/session-check.ts` asserts that a preview and an applied change produce
byte-identical schedules.

Nothing commits without being previewed first. The grid shows moved interviews
in green and leaves a dashed struck-through trace where each one used to sit, so
the amount of board being redrawn is visible before the coordinator accepts it.
The change list is for after she has decided.

---

## Structure

```
src/core/
  types.ts      domain model, time discretisation, travel buffers
  rng.ts        seeded RNG
  generator.ts  realistic dataset
  engine.ts     occupancy, room allocation, placement search
  scheduler.ts  initial build, greedy insertion + bounded repair
  replan.ts     disruption handling, three rings, diff, escalations
  metrics.ts    metrics + independent invariant verification
  risks.ts      forward-looking conflict detection
  session.ts    deterministic replay for preview and undo
app/            coordinator console
scripts/        demo, disruption scenario, fuzz test, checks
```

## Known limits

- Greedy insertion, not an exact solver. An ILP would give a better first
  schedule and a worse product: its answer to "why did you move this student" is
  a dual variable, and the coordinator needs a reason she can read out loud.
- Ring 2 displacement is depth 1. Deeper search buys a few points of coverage
  and makes the change summary unreadable.
- Panels can drop but not merge. Merging two panels mid-day is a real thing that
  happens and is not implemented; it would need a rule for which panel's
  bookings survive.
- Replan is two clicks, not one: preview then apply. A tool that rewrites
  people's day should not commit on a single click.
- Single interview round per company. Multi-round drives would need dependencies
  between a student's slots on the same day.
- Companies are pinned to their preferred day. Moving a company across days is
  modelled as an escalation, not an automatic action.