import { NavLink } from 'react-router-dom';
import { X } from 'lucide-react';
import { NAV_SECTIONS } from '@/routes/navigation.js';
import { APP } from '@/lib/constants.js';
import { Button } from '@/components/ui/button.jsx';
import { cn } from '@/lib/utils.js';

/**
 * Primary navigation.
 *
 * Fixed rail on desktop, slide-over drawer below `lg` — one component, two
 * behaviours, so nav links exist in exactly one place.
 */
export function Sidebar({ isOpen, onClose }) {
  return (
    <>
      {/* Mobile scrim */}
      <div
        className={cn(
          'fixed inset-0 z-30 bg-background/80 backdrop-blur-sm transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 lg:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Main navigation"
      >
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              TS
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-foreground">{APP.name}</p>
              <p className="text-[11px] text-muted-foreground">{APP.tagline}</p>
            </div>
          </div>

          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose}>
            <X />
            <span className="sr-only">Close navigation</span>
          </Button>
        </div>

        {/* Links */}
        <nav className="scrollbar-slim flex-1 overflow-y-auto p-3">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="mb-6 last:mb-0">
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {section.label}
              </p>

              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary/15 text-accent'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )
                      }
                    >
                      <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground">Version {APP.version}</p>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
