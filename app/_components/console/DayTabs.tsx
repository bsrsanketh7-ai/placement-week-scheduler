import { DayFeasibility } from '../../../src/core/types';

/**
 * Four days as a segmented control. The highlight slides between them; each
 * day carries its own coverage so an oversubscribed day is visible before you
 * click it.
 */
export function DayTabs({ day, perDay, onChange }: {
  day: number; perDay: DayFeasibility[]; onChange: (d: number) => void;
}) {
  return (
    <div className="daytabs" role="tablist" aria-label="Day">
      <span
        className="daytabs-indicator"
        style={{ transform: `translateX(${day * 100}%)` }}
        aria-hidden="true"
      />
      {[0, 1, 2, 3].map((d) => {
        const f = perDay[d];
        const strained = f.oversubscribedPct > 0;
        return (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={day === d}
            className={`daytab ${strained ? 'strained' : ''}`}
            onClick={() => onChange(d)}
            title={strained ? `${f.oversubscribedPct.toFixed(0)}% oversubscribed` : 'Demand fits the rooms'}
          >
            <span className="daytab-name">Day {d + 1}</span>
            <span className="cov num">{f.coveragePct.toFixed(0)}%</span>
            <span className="daytab-bar" aria-hidden="true">
              <span style={{ width: `${Math.min(100, f.coveragePct)}%` }} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
