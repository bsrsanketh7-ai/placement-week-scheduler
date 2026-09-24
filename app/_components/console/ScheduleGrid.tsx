'use client';

import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import { SessionView } from '../../../src/core/session';
import { Assignment, Room, SLOTS_PER_DAY, formatSlot, slotToDay, slotWithinDay } from '../../../src/core/types';
import { timeLabel } from '../../_lib/format';

export interface Ghost { room: string; start: number; length: number; student: string }

interface TipData { student: string; company: string; time: string; room: string; status: string; tone: string }
interface TipHandle { show: (d: TipData, x: number, y: number) => void; hide: () => void }

/**
 * One floating tooltip for the whole grid. It owns its own state, so moving
 * the mouse across two hundred blocks re-renders one small box rather than
 * the entire board. It is portalled to <body> because the card around the
 * grid animates in with a transform, and a transformed ancestor would become
 * the reference box for a fixed-position child.
 */
const GridTooltip = forwardRef<TipHandle>(function GridTooltip(_, ref) {
  const [tip, setTip] = useState<(TipData & { x: number; y: number }) | null>(null);
  useImperativeHandle(ref, () => ({
    show: (d, x, y) => setTip({ ...d, x, y }),
    hide: () => setTip(null),
  }), []);
  if (!tip) return null;
  return createPortal(
    <div className="grid-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="grid-tip-head">
        <span className={`dot ${tip.tone}`} />
        <strong>{tip.student}</strong>
      </div>
      <div className="grid-tip-row">{tip.company}</div>
      <div className="grid-tip-row num">{tip.time} · {tip.room}</div>
      <div className={`grid-tip-status ${tip.tone}`}>{tip.status}</div>
    </div>,
    document.body,
  );
});

/** Keep the centred tooltip on screen for blocks near either edge. */
function clampX(x: number): number {
  const half = 150;
  return Math.min(Math.max(x, half), window.innerWidth - half);
}

export function ScheduleGrid({
  day, now, nowSlotInDay, noticeSlots, rooms, liveRoomIds, view, ghosts, movedIds, addedIds,
}: {
  day: number;
  now: number;
  nowSlotInDay: number;
  noticeSlots: number;
  rooms: Room[];
  liveRoomIds: Set<string>;
  view: SessionView;
  ghosts: Ghost[];
  movedIds: Set<string>;
  addedIds: Set<string>;
}) {
  const tipRef = useRef<TipHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const assignments = view.schedule.assignments.filter((a) => slotToDay(a.startSlot) === day);
  const byRoom = new Map<string, Assignment[]>();
  for (const a of assignments) {
    if (!byRoom.has(a.roomId)) byRoom.set(a.roomId, []);
    byRoom.get(a.roomId)!.push(a);
  }

  /**
   * A room hosts one panel for the whole day, so the company name belongs in
   * the gutter once rather than stamped on every block in the row. That frees
   * the block itself to carry the thing that actually varies: who is being
   * interviewed.
   */
  const panelByRoom = new Map<string, string>();
  for (const p of view.engine.panels.values()) {
    if (p.day !== day || p.dropped || !p.roomId) continue;
    panelByRoom.set(p.roomId, view.engine.companies.get(p.companyId)?.name ?? '');
  }

  const ghostsByRoom = new Map<string, Ghost[]>();
  for (const g of ghosts) {
    const room = rooms.find((r) => r.name === g.room || r.id === g.room);
    const key = room ? room.id : g.room;
    if (!ghostsByRoom.has(key)) ghostsByRoom.set(key, []);
    ghostsByRoom.get(key)!.push(g);
  }

  function onOver(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('.block');
    if (!el || !wrapRef.current) { tipRef.current?.hide(); return; }
    const box = el.getBoundingClientRect();
    const d = el.dataset;
    tipRef.current?.show({
      student: d.student ?? '',
      company: d.company ?? '',
      time: d.time ?? '',
      room: d.room ?? '',
      status: d.status ?? '',
      tone: d.tone ?? 'blue',
    }, clampX(box.left + box.width / 2), box.top);
  }

  const frozenSlots = Math.min(nowSlotInDay + noticeSlots, SLOTS_PER_DAY);

  return (
    <section className="grid-card card" aria-label="Schedule grid">
      <div className="grid-card-head">
        <div className="grid-card-title">
          <span className="grid-card-icon"><CalendarDays size={15} /></span>
          <span className="section-title">Day {day + 1} board</span>
          <span className="badge num">{assignments.length} interviews</span>
        </div>
        <div className="legend">
          <span><i className="swatch booked" /> booked</span>
          <span><i className="swatch moved" /> moved by this replan</span>
          <span><i className="swatch done" /> already done</span>
          <span><i className="swatch was" /> where it used to be</span>
        </div>
      </div>

      <div
        className="gridwrap"
        ref={wrapRef}
        onMouseOver={onOver}
        onMouseLeave={() => tipRef.current?.hide()}
        onScroll={() => tipRef.current?.hide()}
      >
        <div className="timeline" key={day}>
          <div className="ruler-corner">Room</div>
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
            const rowStyle = { '--row': Math.min(roomIndex, 14) } as React.CSSProperties;
            return (
              <React.Fragment key={room.id}>
                <div className={`roomlabel ${retired ? 'retired' : ''}`} style={rowStyle}>
                  <span className="rl-room">{room.name}</span>
                  <span className="rl-company">{panelByRoom.get(room.id) ?? ''}</span>
                </div>
                <div className="track" style={{ ...rowStyle, width: `calc(var(--slot-w) * ${SLOTS_PER_DAY})` }}>
                  <div className="freeze" style={{ width: `calc(var(--slot-w) * ${frozenSlots})` }} />
                  {gs.map((g, i) => (
                    <div
                      key={`g${i}`}
                      className="ghost"
                      title={`${g.student} was here before this replan`}
                      style={{
                        left: `calc(var(--slot-w) * ${slotWithinDay(g.start)})`,
                        width: `calc(var(--slot-w) * ${g.length} - 3px)`,
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
                    const status = cls === 'added' ? 'Added by this replan'
                      : cls === 'moved' ? 'Moved by this replan'
                      : cls === 'locked' ? 'Already started or done'
                      : 'Booked';
                    const tone = cls === 'added' || cls === 'moved' ? 'green' : cls === 'locked' ? 'grey' : 'blue';
                    return (
                      <div
                        key={a.id}
                        className={`block ${cls}`}
                        data-student={student?.name}
                        data-company={company?.name}
                        data-time={`${formatSlot(a.startSlot)}–${timeLabel(slotWithinDay(a.endSlot - 1) + 1)}`}
                        data-room={room.name}
                        data-status={status}
                        data-tone={tone}
                        aria-label={`${student?.name} · ${company?.name} · ${formatSlot(a.startSlot)} · ${room.name}`}
                        style={{
                          left: `calc(var(--slot-w) * ${slotWithinDay(a.startSlot)})`,
                          width: `calc(var(--slot-w) * ${a.endSlot - a.startSlot} - 3px)`,
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

      <GridTooltip ref={tipRef} />
    </section>
  );
}
