import { Footprints, Hourglass, Sparkles, Timer, TriangleAlert } from 'lucide-react';
import { Risk, RiskKind } from '../../../src/core/risks';

const ICON: Record<RiskKind, typeof Timer> = {
  CASCADE: Timer,
  TIGHT_TURNAROUND: Footprints,
  LONG_WAIT: Hourglass,
  IDLE_CAPACITY: Sparkles,
};

/**
 * Sits directly above the grid, because it is what a coordinator should read
 * before anything else. Severity is carried by the edge and the icon only; a
 * full red fill across every card would make "legal but fragile" look like a
 * fire.
 */
export function RiskStrip({ risks }: { risks: Risk[] }) {
  if (risks.length === 0) return null;
  return (
    <section className="risks card" aria-label="Upcoming conflicts">
      <div className="risks-title">
        <span className="risks-icon"><TriangleAlert size={15} /></span>
        <span className="section-title">What breaks next</span>
        <span className="risks-hint">legal right now, one delay from not being</span>
        <span className="badge">{risks.length}</span>
      </div>
      <div className="risks-row">
        {risks.map((r, i) => {
          const Icon = ICON[r.kind];
          return (
            <div
              key={r.id}
              className={`risk ${r.severity.toLowerCase()}`}
              title={r.detail}
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="risk-top">
                <Icon size={14} aria-hidden="true" />
                <span className="risk-sev">{r.severity.toLowerCase()}</span>
              </span>
              <span className="risk-head">{r.headline}</span>
              <span className="risk-detail">{r.detail}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
