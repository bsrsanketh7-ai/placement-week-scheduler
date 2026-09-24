/**
 * A miniature of the console, drawn in CSS. It plays the product's one idea
 * on a loop: a disruption hits, one interview moves, and a dashed trace stays
 * behind where it used to be. Purely decorative, so it is hidden from
 * assistive technology.
 */
const ROWS: Array<Array<{ at: number; len: number; tone?: 'done' | 'mover' }>> = [
  [{ at: 0, len: 2, tone: 'done' }, { at: 2, len: 2 }, { at: 5, len: 2 }, { at: 8, len: 2 }],
  [{ at: 0, len: 3, tone: 'done' }, { at: 4, len: 3 }, { at: 8, len: 3 }],
  [{ at: 1, len: 2, tone: 'done' }, { at: 3, len: 2, tone: 'mover' }, { at: 6, len: 2 }, { at: 10, len: 2 }],
  [{ at: 0, len: 2, tone: 'done' }, { at: 3, len: 2 }, { at: 7, len: 2 }],
  [{ at: 2, len: 3 }, { at: 6, len: 3 }, { at: 10, len: 2 }],
];
const NAMES = ['Meghana', 'Rahul', 'Priya', 'Karthik', 'Ananya', 'Vinay', 'Shreya', 'Nikhil', 'Divya', 'Arjun', 'Pooja', 'Sneha', 'Tejas', 'Kavya', 'Suhas', 'Ravi'];

export function HeroPreview() {
  let n = 0;
  return (
    <div className="hero-preview" aria-hidden="true">
      <div className="hp-chrome">
        <span className="hp-dots"><i /><i /><i /></span>
        <span className="hp-url">placement-week / console</span>
      </div>
      <div className="hp-body">
        <div className="hp-kpis">
          <div className="hp-kpi"><span>interviews placed</span><b>69.4%</b></div>
          <div className="hp-kpi"><span>student clashes</span><b className="ok">0</b></div>
          <div className="hp-kpi"><span>moved by replan</span><b className="moved">1</b></div>
        </div>
        <div className="hp-alert">
          <span className="hp-alert-dot" />
          Onward Digital arriving 3 hours late
        </div>
        <div className="hp-grid">
          <div className="hp-now" />
          {ROWS.map((row, r) => (
            <div className="hp-row" key={r}>
              <span className="hp-room">A-10{r + 1}</span>
              <div className="hp-track">
                {row.map((b, i) => {
                  const name = NAMES[n++ % NAMES.length];
                  const style = { left: `${(b.at / 12) * 100}%`, width: `calc(${(b.len / 12) * 100}% - 3px)` };
                  if (b.tone === 'mover') {
                    return (
                      <span key={i}>
                        <span className="hp-ghost" style={style} />
                        <span className="hp-block hp-mover" style={style}>{name}</span>
                      </span>
                    );
                  }
                  return (
                    <span key={i} className={`hp-block ${b.tone === 'done' ? 'hp-done' : ''}`} style={style}>
                      {name}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
