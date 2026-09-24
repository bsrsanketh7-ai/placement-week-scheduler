'use client';

import { ReactNode } from 'react';
import { CalendarCheck, Clock, DoorOpen, Hourglass, ShieldCheck, Users } from 'lucide-react';
import { Metrics } from '../../../src/core/types';
import { AnimatedNumber } from '../AnimatedNumber';

interface Baseline { metrics: Metrics; unplaced: number }

/**
 * A change chip, shown only while previewing. `better` says which direction
 * is good news for this number, so the colour is about the outcome, not the
 * sign: fewer unplaced students is green even though the number went down.
 */
function Delta({ now, before, better, decimals = 0, suffix = '' }: {
  now: number; before: number; better: 'up' | 'down'; decimals?: number; suffix?: string;
}) {
  const d = now - before;
  if (Math.abs(d) < Math.pow(10, -decimals) / 2) return <span className="delta flat">no change</span>;
  const good = better === 'up' ? d > 0 : d < 0;
  return (
    <span className={`delta ${good ? 'good' : 'bad'}`}>
      {d > 0 ? '+' : '−'}{Math.abs(d).toFixed(decimals)}{suffix}
    </span>
  );
}

function Kpi({ icon, label, children, tone, extra, index }: {
  icon: ReactNode; label: string; children: ReactNode; tone?: 'good' | 'bad'; extra?: ReactNode; index: number;
}) {
  return (
    <div className={`kpi card ${tone ?? ''}`} style={{ '--i': index } as React.CSSProperties}>
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{children}</div>
      {extra}
    </div>
  );
}

export function KpiCards({ metrics: m, unplaced, baseline, unplacedOpen, onToggleUnplaced }: {
  metrics: Metrics;
  unplaced: number;
  baseline: Baseline | null;
  unplacedOpen: boolean;
  onToggleUnplaced: () => void;
}) {
  const b = baseline?.metrics;
  const doubles = m.roomDoubleBookings + m.panelDoubleBookings;

  return (
    <section className="kpis" aria-label="Key numbers">
      <Kpi
        index={0}
        icon={<CalendarCheck size={15} />}
        label="interviews placed"
        extra={
          <>
            <div className="kpi-bar"><span style={{ width: `${Math.min(100, m.coveragePct)}%` }} /></div>
            {b && <Delta now={m.coveragePct} before={b.coveragePct} better="up" decimals={1} suffix=" pts" />}
          </>
        }
      >
        <AnimatedNumber value={m.coveragePct} decimals={1} suffix="%" />
      </Kpi>

      <Kpi index={1} icon={<ShieldCheck size={15} />} label="student clashes" tone={m.studentClashes ? 'bad' : 'good'}
        extra={b && <Delta now={m.studentClashes} before={b.studentClashes} better="down" />}>
        <AnimatedNumber value={m.studentClashes} />
      </Kpi>

      <Kpi index={2} icon={<DoorOpen size={15} />} label="double bookings" tone={doubles ? 'bad' : 'good'}
        extra={b && <Delta now={doubles} before={b.roomDoubleBookings + b.panelDoubleBookings} better="down" />}>
        <AnimatedNumber value={doubles} />
      </Kpi>

      <Kpi index={3} icon={<Clock size={15} />} label="room use"
        extra={b && <Delta now={m.roomUtilisationPct} before={b.roomUtilisationPct} better="up" suffix=" pts" />}>
        <AnimatedNumber value={m.roomUtilisationPct} suffix="%" />
      </Kpi>

      <Kpi index={4} icon={<Hourglass size={15} />} label="avg student wait"
        extra={b && <Delta now={m.avgStudentIdleMinutes} before={b.avgStudentIdleMinutes} better="down" suffix="m" />}>
        <AnimatedNumber value={Math.round(m.avgStudentIdleMinutes)} suffix="m" />
      </Kpi>

      {/* The one number a coordinator must be able to open. */}
      <button
        type="button"
        className={`kpi card statbtn ${unplacedOpen ? 'open' : ''}`}
        style={{ '--i': 5 } as React.CSSProperties}
        onClick={onToggleUnplaced}
        aria-haspopup="dialog"
        title="Show what did not fit and why"
      >
        <div className="kpi-top">
          <span className="kpi-icon"><Users size={15} /></span>
          <span className="stat-label">unplaced &middot; why?</span>
        </div>
        <div className="stat-value"><AnimatedNumber value={unplaced} /></div>
        {baseline && <Delta now={unplaced} before={baseline.unplaced} better="down" />}
      </button>
    </section>
  );
}
