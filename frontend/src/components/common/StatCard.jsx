import { Card, CardContent } from '@/components/ui/card.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { cn, formatNumber } from '@/lib/utils.js';

const TONE_STYLES = {
  default: 'bg-secondary text-muted-foreground',
  primary: 'bg-primary/15 text-accent',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  error: 'bg-destructive/15 text-destructive',
};

/**
 * KPI tile for the dashboard.
 *
 * Icon tone is the only colour in the tile — the number itself stays in the
 * default foreground so a row of tiles reads as one system rather than five
 * competing highlights.
 */
export function StatCard({ label, value, icon: Icon, tone = 'default', hint, isLoading }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>

          {isLoading ? (
            <Skeleton className="h-8 w-16" />
          ) : (
            <p className="tabular text-2xl font-semibold text-foreground">
              {typeof value === 'number' ? formatNumber(value) : (value ?? '—')}
            </p>
          )}

          {hint ? <p className="truncate text-xs text-muted-foreground">{hint}</p> : null}
        </div>

        {Icon ? (
          <div className={cn('rounded-lg p-2.5', TONE_STYLES[tone] ?? TONE_STYLES.default)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default StatCard;
