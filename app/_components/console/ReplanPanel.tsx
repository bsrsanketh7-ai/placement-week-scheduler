'use client';

import {
  Clock, DoorClosed, Eye, History, Plus, Undo2, UserMinus, UsersRound, X,
} from 'lucide-react';
import { Disruption } from '../../../src/core/replan';
import { SessionStep, SessionView } from '../../../src/core/session';
import { Company, Panel, Room, SLOTS_PER_DAY, formatSlot } from '../../../src/core/types';
import { describeDisruption, timeLabel } from '../../_lib/format';

export type DraftKind = 'COMPANY_LATE' | 'PANEL_DROP' | 'STUDENT_WITHDRAW' | 'ROOM_UNAVAILABLE';

const KINDS: Array<{ kind: DraftKind; title: string; sub: string; Icon: typeof Clock }> = [
  { kind: 'COMPANY_LATE', title: 'Company late', sub: 'Arrives after start', Icon: Clock },
  { kind: 'PANEL_DROP', title: 'Panel dropped', sub: 'Interviewer left', Icon: UserMinus },
  { kind: 'STUDENT_WITHDRAW', title: 'Students left', sub: 'Accepted offers', Icon: UsersRound },
  { kind: 'ROOM_UNAVAILABLE', title: 'Room lost', sub: 'Out of service', Icon: DoorClosed },
];

const DISRUPTION_ICON: Record<Disruption['type'], typeof Clock> = {
  COMPANY_LATE: Clock,
  PANEL_DROP: UserMinus,
  STUDENT_WITHDRAW: UsersRound,
  ROOM_UNAVAILABLE: DoorClosed,
};

const pct = (value: number, min: number, max: number) =>
  ({ '--pct': `${((value - min) / (max - min)) * 100}%` }) as React.CSSProperties;

export function ReplanPanel(props: {
  open: boolean;
  onClose: () => void;
  now: number;
  nowSlotInDay: number;
  onNowChange: (v: number) => void;
  noticeSlots: number;
  kind: DraftKind;
  onKindChange: (k: DraftKind) => void;
  companies: Company[];
  companyId: string;
  onCompanyChange: (id: string) => void;
  delay: number;
  onDelayChange: (v: number) => void;
  panels: Panel[];
  panelId: string;
  onPanelChange: (id: string) => void;
  rooms: Room[];
  roomId: string;
  onRoomChange: (id: string) => void;
  withdrawCount: number;
  maxWithdraw: number;
  onWithdrawCountChange: (v: number) => void;
  onAdd: () => void;
  draft: Disruption[];
  committed: SessionView;
  onRemove: (i: number) => void;
  previewing: boolean;
  onPreview: () => void;
  history: SessionStep[];
  onUndo: () => void;
}) {
  const p = props;

  return (
    <>
      <div
        className={`panel-backdrop ${p.open ? 'open' : ''}`}
        onClick={p.onClose}
        aria-hidden="true"
      />
      <aside className={`panel ${p.open ? 'open' : ''}`} aria-label="Replan builder">
        <div className="panel-head">
          <div>
            <div className="section-title">Replan builder</div>
            <div className="panel-sub">Queue what went wrong, then preview the cost.</div>
          </div>
          <button type="button" className="icon-btn panel-close" onClick={p.onClose} aria-label="Close the replan builder">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* ---------- clock ---------- */}
        <section className="panel-section">
          <div className="eyebrow">Clock</div>
          <div className="field clock-field">
            <label htmlFor="now">
              <span>Now</span>
              <span className="num clock-value">{formatSlot(p.now)}</span>
            </label>
            <input
              id="now"
              type="range"
              min={0}
              max={SLOTS_PER_DAY - 1}
              value={p.nowSlotInDay}
              style={pct(p.nowSlotInDay, 0, SLOTS_PER_DAY - 1)}
              onChange={(e) => p.onNowChange(Number(e.target.value))}
            />
            <div className="hint">
              Interviews starting before <span className="num">{timeLabel(p.nowSlotInDay + p.noticeSlots)}</span> are
              frozen and will not be moved.
            </div>
          </div>
        </section>

        {/* ---------- what went wrong ---------- */}
        <section className="panel-section">
          <div className="eyebrow">What went wrong</div>
          <div className="kind-grid" role="radiogroup" aria-label="Type of disruption">
            {KINDS.map(({ kind, title, sub, Icon }) => (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={p.kind === kind}
                data-kind={kind}
                className="kind-tile"
                onClick={() => p.onKindChange(kind)}
              >
                <span className="kind-icon"><Icon size={16} aria-hidden="true" /></span>
                <span className="kind-title">{title}</span>
                <span className="kind-sub">{sub}</span>
              </button>
            ))}
          </div>

          <div className="kind-fields" key={p.kind}>
            {p.kind === 'COMPANY_LATE' && (
              <>
                <div className="field">
                  <label htmlFor="co">Company</label>
                  <select id="co" value={p.companyId} onChange={(e) => p.onCompanyChange(e.target.value)}>
                    <option value="">Choose a company</option>
                    {p.companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.interviewQueue.length} queued)
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="delay">
                    <span>Arriving late by</span>
                    <span className="num">{p.delay} min</span>
                  </label>
                  <input
                    id="delay" type="range" min={30} max={360} step={30}
                    value={p.delay}
                    style={pct(p.delay, 30, 360)}
                    onChange={(e) => p.onDelayChange(Number(e.target.value))}
                  />
                </div>
              </>
            )}

            {p.kind === 'PANEL_DROP' && (
              <div className="field">
                <label htmlFor="pn">Panel</label>
                <select id="pn" value={p.panelId} onChange={(e) => p.onPanelChange(e.target.value)}>
                  <option value="">Choose a panel</option>
                  {p.panels.map((panel) => (
                    <option key={panel.id} value={panel.id}>{panel.label}</option>
                  ))}
                </select>
              </div>
            )}

            {p.kind === 'ROOM_UNAVAILABLE' && (
              <div className="field">
                <label htmlFor="rm">Room</label>
                <select id="rm" value={p.roomId} onChange={(e) => p.onRoomChange(e.target.value)}>
                  <option value="">Choose a room</option>
                  {p.rooms.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}

            {p.kind === 'STUDENT_WITHDRAW' && (
              <div className="field">
                <label htmlFor="wd">How many students left</label>
                <input
                  id="wd" type="number" min={1} max={p.maxWithdraw}
                  value={p.withdrawCount}
                  onChange={(e) => p.onWithdrawCountChange(Number(e.target.value))}
                />
              </div>
            )}
          </div>

          <button type="button" className="btn secondary wide" onClick={p.onAdd}>
            <Plus size={16} aria-hidden="true" />
            Add to this replan
          </button>
        </section>

        {/* ---------- draft ---------- */}
        <section className="panel-section">
          <div className="section-row">
            <span className="eyebrow">This replan</span>
            {p.draft.length > 0 && <span className="badge accent">{p.draft.length}</span>}
          </div>

          {p.draft.length === 0 ? (
            <div className="empty-state">Nothing queued yet. Pick what went wrong above.</div>
          ) : (
            <>
              <ul className="queued">
                {p.draft.map((d, i) => {
                  const Icon = DISRUPTION_ICON[d.type];
                  return (
                    <li key={`${d.type}-${i}`}>
                      <span className="queued-icon"><Icon size={14} aria-hidden="true" /></span>
                      <span className="queued-text">{describeDisruption(d, p.committed)}</span>
                      <button
                        type="button"
                        className="queued-remove"
                        onClick={() => p.onRemove(i)}
                        aria-label={`Remove ${describeDisruption(d, p.committed)}`}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                className="btn accent wide preview-btn"
                onClick={p.onPreview}
                disabled={p.previewing}
              >
                <Eye size={16} aria-hidden="true" />
                {p.previewing ? 'Showing the cost below' : 'Show me what this changes'}
              </button>
            </>
          )}
        </section>

        {/* ---------- history ---------- */}
        {p.history.length > 0 && (
          <section className="panel-section">
            <div className="section-row">
              <span className="eyebrow"><History size={12} aria-hidden="true" /> Applied today</span>
            </div>
            <ul className="queued history">
              {p.history.map((h, i) => (
                <li key={i}>
                  <span className="timeline-dot" aria-hidden="true" />
                  <span className="num timeline-time">{formatSlot(h.at)}</span>
                  <span className="timeline-text">
                    {h.disruptions.length} change{h.disruptions.length === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="btn quiet wide" onClick={p.onUndo}>
              <Undo2 size={15} aria-hidden="true" />
              Undo the last replan
            </button>
          </section>
        )}
      </aside>
    </>
  );
}
