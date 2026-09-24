'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { SessionView } from '../../../src/core/session';
import { reasonText } from '../../_lib/format';

/**
 * What did not fit, and why. A modal, because it is a question the
 * coordinator opens deliberately and closes when answered; the board behind
 * it does not need to stay interactive.
 */
export function UnplacedDialog({ view, onClose }: { view: SessionView; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reasons = Object.entries(view.unscheduledBreakdown.byReason) as Array<[string, number]>;
  const maxReason = Math.max(1, ...reasons.map(([, n]) => n));
  const stagger = (i: number) => ({ '--i': i }) as React.CSSProperties;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        className="dialog summary"
        role="dialog"
        aria-modal="true"
        aria-labelledby="unplaced-title"
        tabIndex={-1}
      >
        <div className="dialog-head">
          <div>
            <div className="eyebrow" id="unplaced-title">What did not fit, and why</div>
            <div className="stat-value dialog-number">
              {view.schedule.unscheduled.length} unplaced
              <span className="summary-of"> of {view.metrics.demandedInterviews} wanted</span>
            </div>
            <p className="dialog-lede">
              Not a crash and not a silent drop. Every interview below has a named reason. The week
              is oversubscribed by design, so the question is not whether something gets cut but who
              decides what.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="changelist dialog-body">
          <div className="changecol">
            <h4>By reason</h4>
            <ul>
              {reasons.map(([reason, n], i) => (
                <li className="cancel bar-li" key={reason} style={stagger(i)}>
                  <span className="li-main"><span className="num">{n}</span> · {reasonText(reason)}</span>
                  <span className="li-bar"><span style={{ width: `${(n / maxReason) * 100}%` }} /></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="changecol">
            <h4>Worst affected companies</h4>
            <ul>
              {view.unscheduledBreakdown.worstAffected.map((w, i) => (
                <li className="cancel" key={i} style={stagger(i)}>
                  <span className="li-main">{w.company}</span>
                  <span className="when">
                    {w.unscheduled} of {w.demanded} could not be placed · {w.tier.toLowerCase().replaceAll('_', ' ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="changecol">
            <h4>Where the shortfall is</h4>
            <ul>
              {view.metrics.perDay.map((f, i) => (
                <li className={`${f.oversubscribedPct > 0 ? 'cancel' : 'info'} bar-li`} key={f.day} style={stagger(i)}>
                  <span className="li-main">
                    Day {f.day} · <span className="num">{f.coveragePct.toFixed(0)}%</span> placed
                  </span>
                  <span className="li-bar"><span style={{ width: `${Math.min(100, f.coveragePct)}%` }} /></span>
                  <span className="when">
                    {f.panelsRequested} panels wanted, {f.roomsAvailable} rooms
                    {f.oversubscribedPct > 0 ? ` · ${f.oversubscribedPct.toFixed(0)}% oversubscribed` : ' · fits'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="dialog-foot">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
