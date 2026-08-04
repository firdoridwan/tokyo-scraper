import { Link, useLocation } from 'react-router-dom';
import { Menu, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Separator } from '@/components/ui/separator.jsx';
import { ConnectionStatus } from './ConnectionStatus.jsx';
import { NAV_SECTIONS } from '@/routes/navigation.js';

const ALL_NAV_ITEMS = NAV_SECTIONS.flatMap((section) => section.items);

/** Resolves the current page's title from the nav model — no duplicated strings. */
function useCurrentPageLabel() {
  const { pathname } = useLocation();

  const match = ALL_NAV_ITEMS.filter((item) =>
    item.end ? pathname === item.to : pathname.startsWith(item.to),
  ).sort((a, b) => b.to.length - a.to.length)[0];

  return match?.label ?? 'Tokyo Scraper';
}

/**
 * Application top bar: menu toggle (mobile), page context, live API status,
 * and the primary action.
 */
export function Topbar({ onOpenSidebar }) {
  const pageLabel = useCurrentPageLabel();

  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6">
      <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar}>
        <Menu />
        <span className="sr-only">Open navigation</span>
      </Button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{pageLabel}</p>
      </div>

      <ConnectionStatus />

      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <Button asChild size="sm" className="hidden sm:inline-flex">
        <Link to="/scrape">
          <PlayCircle />
          New Scrape
        </Link>
      </Button>
    </header>
  );
}

export default Topbar;
