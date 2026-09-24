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
 *
 * This file owns all state and every rule about what may be queued. The
 * components under _components/console only draw it.
 */

import React, { useMemo, useState } from 'react';
import { runSession, SessionStep } from '../../src/core/session';
import { Disruption } from '../../src/core/replan';
import { upcomingRisks } from '../../src/core/risks';
import {
  SLOT_MINUTES, DAY_START_MIN, slotToDay, globalSlot, durationToSlots,
} from '../../src/core/types';
import { ConsoleHeader } from '../_components/console/ConsoleHeader';
import { KpiCards } from '../_components/console/KpiCards';
import { ReplanPanel, DraftKind } from '../_components/console/ReplanPanel';
import { DayTabs } from '../_components/console/DayTabs';
import { RiskStrip } from '../_components/console/RiskStrip';
import { ScheduleGrid, Ghost } from '../_components/console/ScheduleGrid';
import { ReplanSheet } from '../_components/console/ReplanSheet';
import { UnplacedDialog } from '../_components/console/UnplacedDialog';
import { Toasts, Toast } from '../_components/console/Toasts';

const SEED = 42;
const NOTICE_SLOTS = 2;
const MAX_DISPLACEMENTS = 12;
const MAX_WITHDRAW = 80;

const CONFIG = {
  seed: SEED,
  noticeSlots: NOTICE_SLOTS,
  maxDisplacements: MAX_DISPLACEMENTS,
  overtimeMinutes: 60,
  backfillUnscheduled: false,
};

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
  const [panelOpen, setPanelOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const now = globalSlot(day, DAY_START_MIN + nowSlotInDay * SLOT_MINUTES);

  // Committed state. Recomputed from the disruption log, never mutated. Each
  // step carries its own time, so moving the clock does not need a rebuild;
  // only the forward-looking risks depend on it, and those are computed below.
  const committed = useMemo(() => runSession(CONFIG, history), [history]);

  // Preview state: the same log with the draft appended. Both exist at once,
  // which is what lets the grid show before and after together.
  const preview = useMemo(() => {
    if (!previewing || draft.length === 0) return null;
    return runSession(CONFIG, history, { disruptions: draft, at: now }, now);
  }, [previewing, draft, history, now]);

  const view = preview ?? committed;
  const diff = preview?.lastDiff ?? null;
  const risks = useMemo(() => upcomingRisks(view.engine, view.schedule, now), [view, now]);

  const dayCompanies = committed.dataset.companies.filter((c) => c.preferredDay === day);
  const dayPanels = [...committed.engine.panels.values()].filter(
    (p) => p.day === day && !p.dropped && p.roomId,
  );
  const rooms = committed.dataset.rooms;
  const liveRoomIds = new Set([...view.engine.rooms.keys()]);

  /* Where a moved interview used to sit. */
  const ghosts = useMemo<Ghost[]>(() => {
    if (!diff) return [];
    return diff.moved
      .filter((m) => slotToDay(m.fromSlot) === day)
      .map((m) => ({
        room: m.fromRoom,
        start: m.fromSlot,
        length: durationToSlots(view.engine.companies.get(m.companyId)?.interviewMinutes ?? 30),
        student: m.studentName,
      }));
  }, [diff, day, view]);

  const movedIds = useMemo(
    () => new Set(diff ? diff.moved.map((m) => `${m.studentId}:${m.companyId}`) : []),
    [diff],
  );
  const addedIds = useMemo(
    () => new Set(diff ? diff.added.map((m) => `${m.studentId}:${m.companyId}`) : []),
    [diff],
  );

  function notify(t: Omit<Toast, 'id'>) {
    setToasts((prev) => [...prev.slice(-2), { ...t, id: Date.now() + Math.random() }]);
  }

  function changeDay(d: number) {
    // Company and panel pickers only list the viewed day, so a selection made
    // on another tab would otherwise be queued invisibly.
    setDay(d);
    setCompanyId('');
    setPanelId('');
  }

  function addToDraft() {
    // One entry per company, panel and room. Reporting the same room twice
    // would try to retire it twice, and a repeated delay would stack.
    const drafted = (pred: (x: Disruption) => boolean) => draft.some(pred);
    let d: Disruption | null = null;
    if (kind === 'COMPANY_LATE' && dayCompanies.some((c) => c.id === companyId)) {
      if (drafted((x) => x.type === 'COMPANY_LATE' && x.companyId === companyId)) return;
      d = { type: 'COMPANY_LATE', companyId, delayMinutes: delay };
    } else if (kind === 'PANEL_DROP' && dayPanels.some((p) => p.id === panelId)) {
      if (drafted((x) => x.type === 'PANEL_DROP' && x.panelId === panelId)) return;
      d = { type: 'PANEL_DROP', panelId };
    } else if (kind === 'ROOM_UNAVAILABLE' && liveRoomIds.has(roomId)) {
      if (drafted((x) => x.type === 'ROOM_UNAVAILABLE' && x.roomId === roomId)) return;
      d = { type: 'ROOM_UNAVAILABLE', roomId };
    } else if (kind === 'STUDENT_WITHDRAW') {
      // Students who still have a movable interview ahead of them today, and
      // who are not already leaving in this draft.
      const leaving = new Set(draft.flatMap((x) => (x.type === 'STUDENT_WITHDRAW' ? x.studentIds : [])));
      const count = Math.max(1, Math.min(MAX_WITHDRAW, Math.floor(withdrawCount) || 1));
      const ids = [...new Set(
        committed.schedule.assignments
          .filter((a) => slotToDay(a.startSlot) === day && a.startSlot >= now + NOTICE_SLOTS)
          .map((a) => a.studentId),
      )].filter((id) => !leaving.has(id)).slice(0, count);
      if (ids.length) d = { type: 'STUDENT_WITHDRAW', studentIds: ids };
    }
    if (!d) return;
    setDraft((prev) => [...prev, d!]);
    setPreviewing(false);
  }

  function removeFromDraft(i: number) {
    setDraft((prev) => prev.filter((_, j) => j !== i));
  }

  function commit() {
    const moved = diff?.moved.length ?? 0;
    setHistory((prev) => [...prev, { disruptions: draft, at: now }]);
    setDraft([]);
    setPreviewing(false);
    notify({
      tone: 'success',
      title: 'Replan applied',
      body: `${moved} interview${moved === 1 ? '' : 's'} moved. Students to be notified.`,
      action: { label: 'Undo', run: undo },
    });
  }

  function discard() {
    setDraft([]);
    setPreviewing(false);
  }

  function undo() {
    setHistory((prev) => prev.slice(0, -1));
    notify({ tone: 'info', title: 'Last replan undone', body: 'The schedule is back to how it was.' });
  }

  function startPreview() {
    setPreviewing(true);
    setPanelOpen(false);
  }

  return (
    <div className={`app ${diff ? 'has-sheet' : ''}`}>
      <ConsoleHeader
        day={day}
        now={now}
        previewing={!!diff}
        onTogglePanel={() => setPanelOpen((v) => !v)}
      />

      <div className="app-body">
        <ReplanPanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          now={now}
          nowSlotInDay={nowSlotInDay}
          onNowChange={setNowSlotInDay}
          noticeSlots={NOTICE_SLOTS}
          kind={kind}
          onKindChange={setKind}
          companies={dayCompanies}
          companyId={companyId}
          onCompanyChange={setCompanyId}
          delay={delay}
          onDelayChange={setDelay}
          panels={dayPanels}
          panelId={panelId}
          onPanelChange={setPanelId}
          rooms={rooms.filter((r) => liveRoomIds.has(r.id))}
          roomId={roomId}
          onRoomChange={setRoomId}
          withdrawCount={withdrawCount}
          maxWithdraw={MAX_WITHDRAW}
          onWithdrawCountChange={setWithdrawCount}
          onAdd={addToDraft}
          draft={draft}
          committed={committed}
          onRemove={removeFromDraft}
          previewing={previewing}
          onPreview={startPreview}
          history={history}
          onUndo={undo}
        />

        <main className="workspace">
          <div className="workspace-head">
            <div>
              <h1 className="page-title">Schedule</h1>
              <p className="page-sub">
                {committed.dataset.students.length} students · {committed.dataset.companies.length} companies ·{' '}
                {rooms.length} rooms · seed {SEED}
              </p>
            </div>
            <DayTabs day={day} perDay={view.metrics.perDay} onChange={changeDay} />
          </div>

          <KpiCards
            metrics={view.metrics}
            unplaced={view.schedule.unscheduled.length}
            baseline={diff ? { metrics: committed.metrics, unplaced: committed.schedule.unscheduled.length } : null}
            unplacedOpen={showUnplaced}
            onToggleUnplaced={() => setShowUnplaced((v) => !v)}
          />

          <RiskStrip risks={risks} />

          <ScheduleGrid
            day={day}
            now={now}
            nowSlotInDay={nowSlotInDay}
            noticeSlots={NOTICE_SLOTS}
            rooms={rooms}
            liveRoomIds={liveRoomIds}
            view={view}
            ghosts={ghosts}
            movedIds={movedIds}
            addedIds={addedIds}
          />
        </main>
      </div>

      {showUnplaced && !diff && (
        <UnplacedDialog view={view} onClose={() => setShowUnplaced(false)} />
      )}

      {diff && (
        <ReplanSheet
          diff={diff}
          maxDisplacements={MAX_DISPLACEMENTS}
          onApply={commit}
          onDiscard={discard}
        />
      )}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />
    </div>
  );
}
