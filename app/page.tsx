'use client';

/**
 * The coordinator's console.
 *
 * Designed around one behaviour: a stressed person deciding whether to accept
 * a replan while a company representative stands next to her. That leads to
 * three rules the UI does not break.
 *
 *  1. Nothing commits without being previewed. Pressing the replan button
 *     shows the cost; a second, differently worded button accepts it. There is
 *     no path where a click silently rewrites 200 appointments.
 *  2. The cost is shown as a picture before it is shown as a list. The ghost
 *     traces on the grid are how much of the board gets redrawn. The list is
 *     for after she has decided.
 *  3. Anything the system refuses to decide is stated as a question with named
 *     options, not hidden in a log.
 */

import React, { useMemo, useState } from 'react';
import { runSession, SessionStep } from '../src/core/session';
import { Disruption } from '../src/core/replan';
import {
  SLOTS_PER_DAY, SLOT_MINUTES, DAY_START_MIN,
  slotToDay, slotWithinDay, globalSlot, formatSlot,
} from '../src/core/types';

const SEED = 42;
const NOTICE_SLOTS = 2;
const MAX_DISPLACEMENTS = 12;

type DraftKind = 'COMPANY_LATE' | 'PANEL_DROP' | 'STUDENT_WITHDRAW' | 'ROOM_UNAVAILABLE';

function timeLabel(slotInDay: number): string {
  const min = DAY_START_MIN + slotInDay * SLOT_MINUTES;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export default function Dashboard() {
  const [day, setDay] = useState(0);
  const [nowSlotInDay, setNowSlotInDay] = useState(4); // 10:00
  const [history, setHistory] = useState<SessionStep[]>([]);
  const [draft, setDraft] = useState<Disruption[]>([]);
  const [kind, setKind] = useState<DraftKind>('COMPANY_LATE');
  const [companyId, setCompanyId] = useState('');
  const [panelId, setPanelId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [delay, setDelay] = useState(180);
  const [withdrawCount, setWithdrawCount] = useState(15);
  const [previewing, setPreviewing] = useState(false);
  const [showUnplaced, setShowUnplaced] = useState(false);

  const now = globalSlot(day, DAY_START_MIN + nowSlotInDay * SLOT_MINUTES);

  const config = {
    seed: SEED,
    noticeSlots: NOTICE_SLOTS,
    maxDisplacements: MAX_DISPLACEMENTS,
    overtimeMinutes: 60,
    backfillUnscheduled: false,
  };

  // Committed state. Recomputed from the disruption log, never mutated.
  const committed = useMemo(() => runSession(config, history, undefined, now), [history, now]);

  // Preview state: the same log with the draft appended. Both exist at once,
  // which is what lets the grid show before and after together.
  const preview = useMemo(() => {
    if (!previewing || draft.length === 0) return null;
    return runSession(config, history, { disruptions: draft, at: now }, now);
  }, [previewing, draft, history, now]);

  const view = preview ?? committed;
  const diff = preview?.lastDiff ?? null;

  const dayCompanies = committed.dataset.companies.filter((c) => c.preferredDay === day);
  const dayPanels = [...committed.engine.panels.values()].filter(
    (p) => p.day === day && !p.dropped && p.roomId,
  );

  /* Where a moved interview used to sit, keyed by room and slot. */
  const ghosts = useMemo(() => {
    if (!diff) return [];
    return diff.moved
      .filter((m) => slotToDay(m.fromSlot) === day)
      .map((m) => ({ room: m.fromRoom, start: m.fromSlot, student: m.studentName }));
  }, [diff, day]);

  const movedIds = useMemo(
    () => new Set(diff ? diff.moved.map((m) => `${m.studentId}:${m.companyId}`) : []),
    [diff],
  );
  const addedIds = useMemo(
    () => new Set(diff ? diff.added.map((m) => `${m.studentId}:${m.companyId}`) : []),
    [diff],
  );

  const rooms = committed.dataset.rooms;
  const liveRoomIds = new Set([...view.engine.rooms.keys()]);
  const assignments = view.schedule.assignments.filter((a) => slotToDay(a.startSlot) === day);
  const byRoom = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (!byRoom.has(a.roomId)) byRoom.set(a.roomId, []);
    byRoom.get(a.roomId)!.push(a);
  }
  /**
   * A room hosts one panel for the whole day, so the company name belongs in
   * the gutter once rather than stamped on all fourteen blocks in the row.
   * That frees the block itself to carry the thing that actually varies: who
   * is being interviewed.
   */
  const panelByRoom = new Map<string, string>();
  for (const p of view.engine.panels.values()) {
    if (p.day !== day || p.dropped || !p.roomId) continue;
    panelByRoom.set(p.roomId, view.engine.companies.get(p.companyId)?.name ?? '');
  }

  const ghostsByRoom = new Map<string, typeof ghosts>();
  for (const g of ghosts) {
    const room = rooms.find((r) => r.name === g.room || r.id === g.room);
    const key = room ? room.id : g.room;
    if (!ghostsByRoom.has(key)) ghostsByRoom.set(key, []);
    ghostsByRoom.get(key)!.push(g);
  }

  function addToDraft() {
    let d: Disruption | null = null;
    if (kind === 'COMPANY_LATE' && companyId) {
      d = { type: 'COMPANY_LATE', companyId, delayMinutes: delay };
    } else if (kind === 'PANEL_DROP' && panelId) {
      d = { type: 'PANEL_DROP', panelId };
    } else if (kind === 'ROOM_UNAVAILABLE' && roomId) {
      d = { type: 'ROOM_UNAVAILABLE', roomId };
    } else if (kind === 'STUDENT_WITHDRAW') {
      // Students who still have something ahead of them today.
      const ids = [...new Set(
        committed.schedule.assignments
          .filter((a) => a.startSlot > now + NOTICE_SLOTS)
          .map((a) => a.studentId),
      )].slice(0, withdrawCount);
      if (ids.length) d = { type: 'STUDENT_WITHDRAW', studentIds: ids };
    }
    if (!d) return;
    setDraft((prev) => [...prev, d!]);
    setPreviewing(false);
  }

  function commit() {
    setHistory((prev) => [...prev, { disruptions: draft, at: now }]);
    setDraft([]);
    setPreviewing(false);
  }

  function discard() {
    setDraft([]);
    setPreviewing(false);
  }

  const m = view.metrics;
  const churnPct = diff ? diff.churn.movedPctOfFuture : 0;
  const churnClass = churnPct > 15 ? 'over' : churnPct > 7 ? 'hot' : '';

  return (
    <div className="shell">
      <header className="topbar">
        <div className="wordmark">Placement Week <span>/ coordinator</span></div>
        <div className="stat">
          <div className="stat-value">{m.coveragePct.toFixed(1)}%</div>
          <div className="stat-label">interviews placed</div>
        </div>
        <div className={`stat ${m.studentClashes ? 'bad' : 'good'}`}>
          <div className="stat-value">{m.studentClashes}</div>
          <div className="stat-label">student clashes</div>
        </div>
        <div className={`stat ${m.roomDoubleBookings + m.panelDoubleBookings ? 'bad' : 'good'}`}>
          <div className="stat-value">{m.roomDoubleBookings + m.panelDoubleBookings}</div>
          <div className="stat-label">double bookings</div>
        </div>
        <div className="stat">
          <div className="stat-value">{m.roomUtilisationPct.toFixed(0)}%</div>
          <div className="stat-label">room use</div>
        </div>
        <div className="stat">
          <div className="stat-value">{Math.round(m.avgStudentIdleMinutes)}m</div>
          <div className="stat-label">avg student wait</div>
        </div>
        <button
          className={`stat statbtn ${showUnplaced ? 'open' : ''}`}
          onClick={() => setShowUnplaced((v) => !v)}
          title="Show what did not fit and why"
        >
          <div className="stat-value">{view.schedule.unscheduled.length}</div>
          <div className="stat-label">unplaced &middot; why?</div>
        </button>
      </header>

      <div className="main">
        <aside className="rail">
          <div className="eyebrow">Clock</div>
          <div className="field" style={{ marginTop: 6 }}>
            <label htmlFor="now">
              Now: <span className="num">{formatSlot(now)}</span>
            </label>
            <input
              id="now"
              type="range"
              min={0}
              max={SLOTS_PER_DAY - 1}
              value={nowSlotInDay}
              onChange={(e) => setNowSlotInDay(Number(e.target.value))}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-faint)', marginTop: 4 }}>
              Interviews starting before <span className="num">{timeLabel(nowSlotInDay + NOTICE_SLOTS)}</span> are frozen and will not be moved.
            </div>
          </div>

          <div className="divider" />
          <div className="eyebrow">What went wrong</div>

          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="kind">Type</label>
            <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as DraftKind)}>
              <option value="COMPANY_LATE">Company running late</option>
              <option value="PANEL_DROP">Panel dropped out</option>
              <option value="STUDENT_WITHDRAW">Students accepted offers and left</option>
              <option value="ROOM_UNAVAILABLE">Room unavailable</option>
            </select>
          </div>

          {kind === 'COMPANY_LATE' && (
            <>
              <div className="field">
                <label htmlFor="co">Company</label>
                <select id="co" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                  <option value="">Choose a company</option>
                  {dayCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.interviewQueue.length} queued)
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="delay">Arriving late by <span className="num">{delay} min</span></label>
                <input
                  id="delay" type="range" min={30} max={360} step={30}
                  value={delay} onChange={(e) => setDelay(Number(e.target.value))}
                />
              </div>
            </>
          )}

          {kind === 'PANEL_DROP' && (
            <div className="field">
              <label htmlFor="pn">Panel</label>
              <select id="pn" value={panelId} onChange={(e) => setPanelId(e.target.value)}>
                <option value="">Choose a panel</option>
                {dayPanels.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          {kind === 'ROOM_UNAVAILABLE' && (
            <div className="field">
              <label htmlFor="rm">Room</label>
              <select id="rm" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Choose a room</option>
                {rooms.filter((r) => liveRoomIds.has(r.id)).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          {kind === 'STUDENT_WITHDRAW' && (
            <div className="field">
              <label htmlFor="wd">How many students left</label>
              <input
                id="wd" type="number" min={1} max={80}
                value={withdrawCount} onChange={(e) => setWithdrawCount(Number(e.target.value))}
              />
            </div>
          )}

          <button className="btn secondary" onClick={addToDraft}>Add to this replan</button>

          {draft.length > 0 && (
            <>
              <ul className="queued">
                {draft.map((d, i) => (
                  <li key={i}>
                    <span>{describeDisruption(d, committed)}</span>
                    <button onClick={() => setDraft(draft.filter((_, j) => j !== i))}>remove</button>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  onClick={() => setPreviewing(true)}
                  disabled={previewing}
                >
                  {previewing ? 'Showing the cost below' : 'Show me what this changes'}
                </button>
              </div>
            </>
          )}

          {history.length > 0 && (
            <>
              <div className="divider" />
              <div className="eyebrow">Applied today</div>
              <ul className="queued" style={{ marginTop: 8 }}>
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="num" style={{ fontSize: 11 }}>{formatSlot(h.at)}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>
                      {h.disruptions.length} change{h.disruptions.length === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                className="btn secondary"
                style={{ marginTop: 8 }}
                onClick={() => setHistory(history.slice(0, -1))}
              >
                Undo the last replan
              </button>
            </>
          )}
        </aside>

        <section className="stage">
          <div className="daytabs" role="tablist">
            {[0, 1, 2, 3].map((d) => {
              const f = view.metrics.perDay[d];
              return (
                <button
                  key={d}
                  role="tab"
                  aria-selected={day === d}
                  className={`daytab ${f.oversubscribedPct > 0 ? 'strained' : ''}`}
                  onClick={() => setDay(d)}
                >
                  Day {d + 1}
                  <span className="cov">
                    {f.coveragePct.toFixed(0)}%
                    {f.oversubscribedPct > 0 ? ` · +${f.oversubscribedPct.toFixed(0)}% over` : ''}
                  </span>
                </button>
              );
            })}
          </div>

          {view.risks.length > 0 && (
            <div className="risks">
              <div className="eyebrow risks-title">
                What breaks next
                <span className="risks-hint">legal right now, one delay from not being</span>
              </div>
              <div className="risks-row">
                {view.risks.map((r) => (
                  <div key={r.id} className={`risk ${r.severity.toLowerCase()}`} title={r.detail}>
                    <span className="risk-head">{r.headline}</span>
                    <span className="risk-detail">{r.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="gridwrap">
            <div className="timeline">
              <div />
              <div className="ruler">
                {Array.from({ length: SLOTS_PER_DAY }, (_, i) => (
                  <div key={i} className={`ruler-cell ${i % 4 === 0 ? 'hour' : ''}`}>
                    {i % 4 === 0 ? timeLabel(i) : ''}
                  </div>
                ))}
              </div>

              {rooms.map((room, roomIndex) => {
                const retired = !liveRoomIds.has(room.id);
                const items = byRoom.get(room.id) ?? [];
                const gs = ghostsByRoom.get(room.id) ?? [];
                return (
                  <React.Fragment key={room.id}>
                    <div className={`roomlabel ${retired ? 'retired' : ''}`}>
                      <span className="rl-room">{room.name}</span>
                      <span className="rl-company">{panelByRoom.get(room.id) ?? ''}</span>
                    </div>
                    <div className="track" style={{ width: `calc(var(--slot-w) * ${SLOTS_PER_DAY})` }}>
                      <div
                        className="freeze"
                        style={{
                          left: 0,
                          width: `calc(var(--slot-w) * ${Math.min(nowSlotInDay + NOTICE_SLOTS, SLOTS_PER_DAY)})`,
                        }}
                      />
                      {gs.map((g, i) => (
                        <div
                          key={`g${i}`}
                          className="ghost"
                          title={`${g.student} was here before this replan`}
                          style={{
                            left: `calc(var(--slot-w) * ${slotWithinDay(g.start)})`,
                            width: `calc(var(--slot-w) * 2)`,
                          }}
                        />
                      ))}
                      {items.map((a) => {
                        const key = `${a.studentId}:${a.companyId}`;
                        const cls = addedIds.has(key) ? 'added'
                          : movedIds.has(key) ? 'moved'
                          : a.startSlot < now ? 'locked' : '';
                        const company = view.engine.companies.get(a.companyId);
                        const student = view.engine.students.get(a.studentId);
                        return (
                          <div
                            key={a.id}
                            className={`block ${cls}`}
                            title={`${student?.name} · ${company?.name} · ${formatSlot(a.startSlot)} · ${room.name}`}
                            style={{
                              left: `calc(var(--slot-w) * ${slotWithinDay(a.startSlot)})`,
                              width: `calc(var(--slot-w) * ${a.endSlot - a.startSlot} - 2px)`,
                            }}
                          >
                            {student?.name.split(' ')[0]}
                          </div>
                        );
                      })}
                      <div
                        className={`nowline ${roomIndex === 0 ? 'labelled' : ''}`}
                        style={{ left: `calc(var(--slot-w) * ${nowSlotInDay})` }}
                      />
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="legend">
            <span><i className="swatch" style={{ background: 'var(--blue-wash)', borderLeftColor: 'var(--blue)' }} /> booked</span>
            <span><i className="swatch" style={{ background: 'var(--green-wash)', borderLeftColor: 'var(--green)' }} /> moved by this replan</span>
            <span><i className="swatch" style={{ background: 'var(--panel-sunk)', borderLeftColor: 'var(--rule-strong)' }} /> already done</span>
            <span><i className="swatch" style={{ borderLeftColor: 'var(--red)', border: '1px dashed var(--red)' }} /> where it used to be</span>
          </div>
        </section>
      </div>

      {showUnplaced && !diff && (
        <div className="summary">
          <div className="summary-head">
            <div>
              <div className="eyebrow">What did not fit, and why</div>
              <div className="stat-value" style={{ marginTop: 4 }}>
                {view.schedule.unscheduled.length} unplaced
                <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
                  {' '}of {view.metrics.demandedInterviews} wanted
                </span>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 220, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
              Not a crash and not a silent drop. Every interview below has a named
              reason. The week is oversubscribed by design, so the question is not
              whether something gets cut but who decides what.
            </div>
            <div className="btnrow" style={{ minWidth: 120 }}>
              <button className="btn secondary" onClick={() => setShowUnplaced(false)}>Close</button>
            </div>
          </div>

          <div className="changelist">
            <div className="changecol">
              <h4>By reason</h4>
              <ul>
                {Object.entries(view.unscheduledBreakdown.byReason).map(([reason, n]) => (
                  <li className="cancel" key={reason}>
                    <span className="num">{n as number}</span> &middot; {reasonText(reason)}
                  </li>
                ))}
              </ul>
            </div>

            <div className="changecol">
              <h4>Worst affected companies</h4>
              <ul>
                {view.unscheduledBreakdown.worstAffected.map((w, i) => (
                  <li className="cancel" key={i}>
                    {w.company}<br />
                    <span className="when">
                      {w.unscheduled} of {w.demanded} could not be placed &middot; {w.tier.toLowerCase().replace('_', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="changecol">
              <h4>Where the shortfall is</h4>
              <ul>
                {view.metrics.perDay.map((f) => (
                  <li className={f.oversubscribedPct > 0 ? 'cancel' : 'info'} key={f.day}>
                    Day {f.day} &middot; <span className="num">{f.coveragePct.toFixed(0)}%</span> placed
                    <br />
                    <span className="when">
                      {f.panelsRequested} panels wanted, {f.roomsAvailable} rooms
                      {f.oversubscribedPct > 0
                        ? ` · ${f.oversubscribedPct.toFixed(0)}% oversubscribed`
                        : ' · fits'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {diff && (
        <div className="summary">
          <div className="summary-head">
            <div>
              <div className="eyebrow">Cost of this replan</div>
              <div className="stat-value" style={{ marginTop: 4 }}>
                {diff.moved.length} moved
                <span style={{ fontSize: 13, color: 'var(--ink-faint)' }}>
                  {' '}of {Math.round(diff.moved.length / Math.max(churnPct, 0.01) * 100) || 0} ahead
                </span>
              </div>
            </div>

            <div className="churnbar">
              <div className="track2">
                <div
                  className={`fill ${churnClass}`}
                  style={{ width: `${Math.min(100, churnPct * 4)}%` }}
                />
              </div>
              <div className="cap">
                churn {churnPct.toFixed(1)}% · {diff.churn.volunteeredCount}/{MAX_DISPLACEMENTS} reshuffle budget used · {diff.computeMs}ms
              </div>
            </div>

            <div className="stat">
              <div className="stat-value">{diff.churn.studentsAffected}</div>
              <div className="stat-label">students to tell</div>
            </div>
            <div className="stat">
              <div className="stat-value">{diff.frozen}</div>
              <div className="stat-label">frozen, untouched</div>
            </div>

            <div className="btnrow" style={{ minWidth: 240 }}>
              <button className="btn commit" onClick={commit}>Apply these changes</button>
              <button className="btn secondary" onClick={discard}>Discard</button>
            </div>
          </div>

          {diff.escalations.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <h4 style={{ margin: '0 0 7px', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--amber)' }}>
                Your call, not the system's
              </h4>
              {diff.escalations.map((e, i) => (
                <div className="escalation" key={i}>
                  <p>{e.question}</p>
                  <ul>{e.options.map((o, j) => <li key={j}>{o}</li>)}</ul>
                </div>
              ))}
            </div>
          )}

          <div className="changelist">
            <div className="changecol">
              <h4>Moved ({diff.moved.length})</h4>
              {diff.moved.length === 0
                ? <p className="empty">Nothing had to move.</p>
                : <ul>
                    {diff.moved.slice(0, 12).map((mv, i) => (
                      <li className="move" key={i}>
                        {mv.studentName} · {mv.companyName}<br />
                        <span className="when">
                          {formatSlot(mv.fromSlot)} → {formatSlot(mv.toSlot)} · {mv.toRoom}
                          {mv.ring === 'VOLUNTEERED' ? ' · moved to make room' : ''}
                        </span>
                      </li>
                    ))}
                    {diff.moved.length > 12 && <li className="info">and {diff.moved.length - 12} more</li>}
                  </ul>}
            </div>

            <div className="changecol">
              <h4>Lost ({diff.cancelled.filter((c) => c.kind === 'UNPLACEABLE').length})</h4>
              {diff.cancelled.filter((c) => c.kind === 'UNPLACEABLE').length === 0
                ? <p className="empty">Everyone who still wants an interview has one.</p>
                : <ul>
                    {diff.cancelled.filter((c) => c.kind === 'UNPLACEABLE').slice(0, 12).map((c, i) => (
                      <li className="cancel" key={i}>
                        {c.studentName} · {c.companyName}<br />
                        <span className="when">{c.reason}</span>
                      </li>
                    ))}
                  </ul>}
            </div>

            <div className="changecol">
              <h4>Freed up</h4>
              <ul>
                <li className="info">
                  {diff.cancelled.filter((c) => c.kind === 'WITHDRAWN').length} slots handed back by students who left
                  <br /><span className="when">not a scheduling failure</span>
                </li>
                {diff.roomChanged.map((rc, i) => (
                  <li className="info" key={i}>
                    {rc.companyName} moved room<br />
                    <span className="when">{rc.fromRoom} → {rc.toRoom} · {rc.affects} interviews, same times</span>
                  </li>
                ))}
                {diff.disruptions.map((d, i) => (
                  <li className="info" key={`d${i}`}>{d}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Reason codes are for the log. Coordinators get sentences. */
function reasonText(code: string): string {
  switch (code) {
    case 'NO_PANEL_CAPACITY': return 'the company ran out of panel time in its window';
    case 'STUDENT_FULLY_BOOKED': return 'the student clashed with every free slot';
    case 'NO_ROOM_FOR_PANEL': return 'the company got no room for that panel';
    case 'COMPANY_WINDOW_TOO_SHORT': return 'the company was on site too briefly';
    case 'STUDENT_WITHDRAWN': return 'the student withdrew';
    case 'PANEL_DROPPED': return 'the panel dropped out';
    default: return code;
  }
}

function describeDisruption(d: Disruption, view: ReturnType<typeof runSession>): string {
  switch (d.type) {
    case 'COMPANY_LATE':
      return `${view.engine.companies.get(d.companyId)?.name ?? d.companyId} late ${d.delayMinutes}m`;
    case 'PANEL_DROP':
      return `${view.engine.panels.get(d.panelId)?.label ?? d.panelId} dropped`;
    case 'STUDENT_WITHDRAW':
      return `${d.studentIds.length} students left`;
    case 'ROOM_UNAVAILABLE':
      return `${view.engine.rooms.get(d.roomId)?.name ?? d.roomId} unavailable`;
  }
}