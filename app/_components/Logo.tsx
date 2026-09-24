/**
 * The mark is a schedule row: three booked slots and one that has moved,
 * which is the product in a glyph.
 */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <span className="logo">
      <svg className="logo-mark" viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="9" className="logo-bg" />
        <rect x="7" y="9" width="8" height="5" rx="1.6" className="logo-slot" />
        <rect x="17" y="9" width="8" height="5" rx="1.6" className="logo-slot" opacity="0.55" />
        <rect x="7" y="18" width="8" height="5" rx="1.6" className="logo-slot" opacity="0.55" />
        <rect x="17" y="18" width="8" height="5" rx="1.6" className="logo-moved" />
      </svg>
      {withName && <span className="logo-name">Placement Week</span>}
    </span>
  );
}
