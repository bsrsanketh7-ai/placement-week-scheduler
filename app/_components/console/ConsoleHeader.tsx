import Link from 'next/link';
import { ChevronRight, PanelLeft } from 'lucide-react';
import { formatSlot } from '../../../src/core/types';
import { Logo } from '../Logo';
import { ThemeToggle } from '../ThemeToggle';

export function ConsoleHeader({
  day, now, previewing, onTogglePanel,
}: { day: number; now: number; previewing: boolean; onTogglePanel: () => void }) {
  return (
    <header className="topnav">
      <div className="topnav-left">
        <button type="button" className="icon-btn panel-toggle" onClick={onTogglePanel} aria-label="Open the replan builder">
          <PanelLeft size={17} aria-hidden="true" />
        </button>
        <Link href="/" className="topnav-brand" aria-label="Placement Week home">
          <Logo />
        </Link>
        <nav className="crumbs" aria-label="Breadcrumb">
          <ChevronRight size={14} aria-hidden="true" />
          <span>Console</span>
          <ChevronRight size={14} aria-hidden="true" />
          <span className="crumb-current">Day {day + 1}</span>
        </nav>
      </div>

      <div className="topnav-right">
        {previewing
          ? <span className="badge amber"><span className="dot live" /> Previewing a replan</span>
          : <span className="badge green"><span className="dot live" /> Live</span>}
        <span className="badge clock-badge"><span className="num">{formatSlot(now)}</span></span>
        <ThemeToggle />
      </div>
    </header>
  );
}
