import Link from 'next/link';
import {
  ArrowRight, Eye, Footprints, Gauge, Layers, ListChecks, MessageSquareWarning, ShieldCheck, WifiOff,
} from 'lucide-react';
import { Logo } from './_components/Logo';
import { ThemeToggle } from './_components/ThemeToggle';
import { Reveal } from './_components/Reveal';
import { CountUp } from './_components/AnimatedNumber';
import { HeroPreview } from './_components/landing/HeroPreview';

/*
 * Every number on this page is measured, and quoted from the README's
 * "Measured behaviour" section. No customer logos, testimonials or pricing:
 * there are none to show.
 */

const FEATURES = [
  {
    Icon: Layers,
    title: 'Replans that touch as little as possible',
    body: 'A disruption is a local wound to close, not a reason to re-solve the week. Frozen, displaced and volunteered rings keep 98% of the board exactly where it was.',
  },
  {
    Icon: Eye,
    title: 'Preview before anything commits',
    body: 'Every replan is shown before it is applied: moved interviews in green, a dashed trace where each one used to sit, and the churn in one number.',
  },
  {
    Icon: Footprints,
    title: 'Conflicts before they happen',
    body: 'Back-to-back panels with no slack, students crossing blocks on a minimum turnaround, four-hour waits. Legal right now, one delay away from breaking.',
  },
  {
    Icon: ListChecks,
    title: 'Nothing fails silently',
    body: 'Every interview that did not fit has a reason in plain language, grouped by cause, company and day. Withdrawals are never counted as failures.',
  },
  {
    Icon: MessageSquareWarning,
    title: 'Hard calls go to a human',
    body: 'When the week will not bend further, the system stops and asks, with each option named and priced. It never quietly cuts a candidate.',
  },
  {
    Icon: WifiOff,
    title: 'Runs on a laptop, offline',
    body: 'No database, no network. A full rebuild of 800 students takes milliseconds, so preview and undo are just replays of the day.',
  },
];

const RINGS = [
  {
    tag: 'Ring 0',
    title: 'Frozen',
    body: 'Anything already started or inside the 30-minute notice window never moves. Telling a student at 10:55 that 11:00 moved is not a replan.',
  },
  {
    tag: 'Ring 1',
    title: 'Displaced',
    body: 'Interviews the disruption actually broke. They have no choice, so they are rebooked first, as close to their old time as possible.',
  },
  {
    tag: 'Ring 2',
    title: 'Volunteered',
    body: 'A capped handful of other interviews may shuffle to make room. Twelve by default: the answer to how much reshuffling is acceptable.',
  },
];

const BENDS = [
  'Slack time between interviews',
  'Panel end time, up to 60 minutes',
  'A bounded shuffle of other students',
  'Nothing else: the coordinator decides',
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="lnav">
        <div className="lnav-inner">
          <Link href="/" className="lnav-brand" aria-label="Placement Week home"><Logo /></Link>
          <nav className="lnav-links" aria-label="Sections">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#numbers">Numbers</a>
          </nav>
          <div className="lnav-actions">
            <ThemeToggle />
            <Link href="/console" className="btn primary sm">
              Open console <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- hero ---------- */}
        <section className="hero">
          <div className="hero-bg" aria-hidden="true">
            <span className="blob b1" />
            <span className="blob b2" />
            <span className="blob b3" />
            <span className="hero-grid" />
          </div>

          <div className="hero-inner">
            <div className="hero-copy">
              <span className="badge accent hero-badge">
                <span className="dot live" /> Live replanning for campus placements
              </span>
              <h1 className="hero-title">
                Placement week goes wrong.
                <span className="hero-title-accent"> Your schedule shouldn&apos;t.</span>
              </h1>
              <p className="hero-lede">
                Schedule 35 companies, 800 students and 20 rooms, then absorb the late arrivals,
                dropped panels and withdrawals as they happen, moving as few people as possible.
              </p>
              <div className="hero-ctas">
                <Link href="/console" className="btn accent lg">
                  Open the console <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <a href="#how" className="btn secondary lg">See how it works</a>
              </div>
              <ul className="hero-points">
                <li><ShieldCheck size={15} aria-hidden="true" /> Zero clashes by construction</li>
                <li><Gauge size={15} aria-hidden="true" /> Replans in milliseconds</li>
                <li><WifiOff size={15} aria-hidden="true" /> Works offline</li>
              </ul>
            </div>
            <div className="hero-visual">
              <HeroPreview />
            </div>
          </div>
        </section>

        {/* ---------- numbers ---------- */}
        <section className="numbers" id="numbers" aria-label="Measured behaviour">
          <div className="numbers-inner">
            <Reveal className="number">
              <div className="number-value num"><CountUp to={19} suffix=" ms" /></div>
              <div className="number-label">to replan a 3-hour delay, a dropped panel and 15 withdrawals</div>
            </Reveal>
            <Reveal className="number" delay={80}>
              <div className="number-value num"><CountUp to={1.7} decimals={1} suffix="%" /></div>
              <div className="number-label">of remaining appointments actually moved</div>
            </Reveal>
            <Reveal className="number" delay={160}>
              <div className="number-value num"><CountUp to={457} /></div>
              <div className="number-label">randomised replans in the stress test, zero invariant failures</div>
            </Reveal>
            <Reveal className="number" delay={240}>
              <div className="number-value num"><CountUp to={800} /></div>
              <div className="number-label">students across 35 companies, 20 rooms and 4 days</div>
            </Reveal>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="section" id="features">
          <Reveal className="section-head">
            <span className="eyebrow">Features</span>
            <h2 className="section-h2">Built for the day itself, not the plan the week before</h2>
            <p className="section-lede">
              Most schedulers produce a good Monday morning and then fall apart at 10:15. This one is
              designed around the replan.
            </p>
          </Reveal>
          <div className="feature-grid">
            {FEATURES.map(({ Icon, title, body }, i) => (
              <Reveal key={title} className="feature" delay={(i % 3) * 90}>
                <span className="feature-icon"><Icon size={18} aria-hidden="true" /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="section how" id="how">
          <Reveal className="section-head">
            <span className="eyebrow">How it works</span>
            <h2 className="section-h2">A replan is not a re-solve</h2>
            <p className="section-lede">
              Re-solving gives a better schedule on paper and a catastrophe in the building. So every
              interview is sorted into one of three rings before anything moves.
            </p>
          </Reveal>

          <ol className="rings">
            {RINGS.map((r, i) => (
              <Reveal as="li" key={r.tag} className="ring" delay={i * 120}>
                <span className="ring-num num">{i}</span>
                <span className="ring-tag">{r.tag}</span>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
              </Reveal>
            ))}
          </ol>

          <Reveal className="bends card">
            <div className="bends-copy">
              <h3>Which constraint bends first</h3>
              <p>
                In a fixed order, and the order is policy rather than code. Interview length and CGPA
                cutoffs never bend, and a company&apos;s day never changes automatically.
              </p>
            </div>
            <ol className="bends-list">
              {BENDS.map((b, i) => (
                <li key={b} className={i === BENDS.length - 1 ? 'stop' : ''}>
                  <span className="num">{i + 1}</span>{b}
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        {/* ---------- call to action ---------- */}
        <section className="section">
          <Reveal className="cta">
            <div className="cta-glow" aria-hidden="true" />
            <h2>See a real week absorb a bad morning</h2>
            <p>
              The console opens on a generated placement week. Make a company three hours late and
              preview what it costs before you commit.
            </p>
            <Link href="/console" className="btn accent lg">
              Open the console <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="lfooter">
        <div className="lfooter-inner">
          <Logo />
          <span className="lfooter-note">Scheduling and live replanning for placement week.</span>
        </div>
      </footer>
    </div>
  );
}
