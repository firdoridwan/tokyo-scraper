import { Badge } from '@/components/ui/badge.jsx';
import { JOB_STATUS_META } from '@/lib/constants.js';
import { cn } from '@/lib/utils.js';

const DOT_TONE = {
  neutral: 'bg-muted-foreground',
  info: 'bg-primary',
  success: 'bg-success',
  error: 'bg-destructive',
  muted: 'bg-muted-foreground/60',
};

/**
 * Job status pill.
 *
 * Reads its label and tone from `JOB_STATUS_META`, so adding a status is a
 * constants change — no component edit, no switch statement.
 */
export function StatusBadge({ status, className }) {
  const meta = JOB_STATUS_META[status] ?? { label: status ?? 'Unknown', tone: 'muted' };

  return (
    <Badge variant={meta.tone} className={cn('capitalize', className)}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          DOT_TONE[meta.tone] ?? DOT_TONE.muted,
          meta.tone === 'info' && 'animate-pulse',
        )}
        aria-hidden="true"
      />
      {meta.label}
    </Badge>
  );
}

export default StatusBadge;
