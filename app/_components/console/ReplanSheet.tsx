'use client';

import { useState } from 'react';
import { ArrowRight, Check, ChevronDown, CircleSlash, Gift, TriangleAlert, X } from 'lucide-react';
import { ReplanDiff } from '../../../src/core/replan';
import { formatSlot } from '../../../src/core/types';

/**
 * The cost of a replan, docked to the bottom of the screen. It slides up
 * rather than covering the page, so the grid with its ghost traces stays in
 * view while the coordinator reads the numbers. It collapses to its header
 * when she wants the whole board back.
 */
export function ReplanSheet({ diff, maxDisplacements, onApply, onDiscard }: {
  diff: ReplanDiff;
  maxDisplacements: number;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const churnPct = diff.churn.movedPctOfFuture;
  const churnClass = churnPct > 15 ? 'over' : churnPct > 7 ? 'hot' : '';
  const lost = diff.cancelled.filter((c) => c.kind === 'UNPLACEABLE');
  const freed = diff.cancelled.filter((c) => c.kind === 'WITHDRAWN').length;
  const stagger = (i: number) => ({ '--i': Math.min(i, 12) }) as React.CSSProperties;

  return (
    <section className={`sheet summary ${collapsed ? 'collapsed' : ''}`} aria-label="Cost of this replan">
      <div className="sheet-inner">
        <div className="summary-head">
          <button
            type="button"
            className="icon-btn sheet-collapse"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand the cost summary' : 'Collapse the cost summary'}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>

          <div className="summary-title">
            <div className="eyebrow">Cost of this replan</div>
            <div className="stat-value">
              {diff.moved.length} moved
              <span className="summary-of"> of {diff.churn.futureCount} ahead</span>
            </div>
          </div>

          <div className="churnbar">
            <div className="track2">
              <div className={`fill ${churnClass}`} style={{ width: `${Math.min(100, churnPct * 4)}%` }} />
            </div>
            <div className="cap num">
              churn {churnPct.toFixed(1)}% · {diff.churn.volunteeredCount}/{maxDisplacements} reshuffle budget used · {diff.computeMs}ms
            </div>
          </div>

          <div className="summary-stats">
            <div className="stat">
              <div className="stat-value">{diff.churn.studentsAffected}</div>
              <div className="stat-label">students to tell</div>
            </div>
            <div className="stat">
              <div className="stat-value">{diff.frozen}</div>
              <div className="stat-label">frozen, untouched</div>
            </div>
          </div>

          <div className="btnrow">
            <button type="button" className="btn success" onClick={onApply}>
              <Check size={16} aria-hidden="true" />
              Apply these changes
            </button>
            <button type="button" className="btn secondary" onClick={onDiscard}>
              <X size={15} aria-hidden="true" />
              Discard
            </button>
          </div>
        </div>

        <div className="sheet-body" aria-hidden={collapsed}>
          {diff.escalations.length > 0 && (
            <div className="escalations">
              <h4 className="escalations-title">
                <TriangleAlert size={13} aria-hidden="true" /> Your call, not the system&apos;s
              </h4>
              <div className="escalation-grid">
                {diff.escalations.map((e, i) => (
                  <div className="escalation" key={i} style={stagger(i)}>
                    <p>{e.question}</p>
                    <ul>{e.options.map((o, j) => <li key={j}>{o}</li>)}</ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="changelist">
            <div className="changecol">
              <h4><ArrowRight size={13} aria-hidden="true" /> Moved ({diff.moved.length})</h4>
              {diff.moved.length === 0
                ? <p className="empty">Nothing had to move.</p>
                : <ul>
                    {diff.moved.slice(0, 12).map((mv, i) => (
                      <li className="move" key={i} style={stagger(i)}>
                        <span className="li-main">{mv.studentName} · {mv.companyName}</span>
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
              <h4><CircleSlash size={13} aria-hidden="true" /> Lost ({lost.length})</h4>
              {lost.length === 0
                ? <p className="empty">Everyone who still wants an interview has one.</p>
                : <ul>
                    {lost.slice(0, 12).map((c, i) => (
                      <li className="cancel" key={i} style={stagger(i)}>
                        <span className="li-main">{c.studentName} · {c.companyName}</span>
                        <span className="when">{c.reason}</span>
                      </li>
                    ))}
                  </ul>}
            </div>

            <div className="changecol">
              <h4><Gift size={13} aria-hidden="true" /> Freed up</h4>
              <ul>
                <li className="info" style={stagger(0)}>
                  <span className="li-main">{freed} slots handed back by students who left</span>
                  <span className="when">not a scheduling failure</span>
                </li>
                {diff.roomChanged.map((rc, i) => (
                  <li className="info" key={i} style={stagger(i + 1)}>
                    <span className="li-main">{rc.companyName} moved room</span>
                    <span className="when">{rc.fromRoom} → {rc.toRoom} · {rc.affects} interviews, same times</span>
                  </li>
                ))}
                {diff.disruptions.map((d, i) => (
                  <li className="info" key={`d${i}`} style={stagger(i + 1 + diff.roomChanged.length)}>
                    <span className="li-main">{d}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
