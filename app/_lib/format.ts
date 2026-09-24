import { Disruption } from '../../src/core/replan';
import { SessionView } from '../../src/core/session';
import { DAY_START_MIN, SLOT_MINUTES } from '../../src/core/types';

export function timeLabel(slotInDay: number): string {
  const min = DAY_START_MIN + slotInDay * SLOT_MINUTES;
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/** Reason codes are for the log. Coordinators get sentences. */
export function reasonText(code: string): string {
  switch (code) {
    case 'NO_PANEL_CAPACITY': return 'the company ran out of panel time in its window';
    case 'STUDENT_FULLY_BOOKED': return 'the student clashed with every free slot';
    case 'NO_ROOM_FOR_PANEL': return 'the company got no room for that panel';
    case 'COMPANY_WINDOW_TOO_SHORT': return 'the company was on site too briefly';
    case 'STUDENT_WITHDRAWN': return 'the student withdrew';
    case 'PANEL_DROPPED': return 'the panel dropped out';
    default: return code;
  }
}

export function describeDisruption(d: Disruption, view: SessionView): string {
  switch (d.type) {
    case 'COMPANY_LATE':
      return `${view.engine.companies.get(d.companyId)?.name ?? d.companyId} late ${d.delayMinutes}m`;
    case 'PANEL_DROP':
      return `${view.engine.panels.get(d.panelId)?.label ?? d.panelId} dropped`;
    case 'STUDENT_WITHDRAW':
      return `${d.studentIds.length} students left`;
    case 'ROOM_UNAVAILABLE':
      return `${view.engine.rooms.get(d.roomId)?.name ?? d.roomId} unavailable`;
  }
}
