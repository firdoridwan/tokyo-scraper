import { useApiHealth } from '@/hooks/useSystemStatus.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip.jsx';
import { cn } from '@/lib/utils.js';

/**
 * Live API connectivity pill.
 *
 * A desktop-style tool should never silently look broken because a local
 * process died — this makes backend state visible at all times.
 */
export function ConnectionStatus() {
  const { health, isOnline, isLoading } = useApiHealth();

  const state = isLoading && !health ? 'checking' : isOnline ? 'online' : 'offline';

  const STATE = {
    checking: { dot: 'bg-muted-foreground', label: 'Checking…', text: 'text-muted-foreground' },
    online: { dot: 'bg-success', label: 'API online', text: 'text-muted-foreground' },
    offline: { dot: 'bg-destructive', label: 'API offline', text: 'text-destructive' },
  }[state];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              STATE.dot,
              state === 'online' && 'animate-pulse',
            )}
            aria-hidden="true"
          />
          <span className={cn('hidden text-xs font-medium sm:inline', STATE.text)}>
            {STATE.label}
          </span>
        </div>
      </TooltipTrigger>

      <TooltipContent>
        {health ? (
          <div className="space-y-0.5">
            <p>
              Environment: <span className="text-foreground">{health.environment}</span>
            </p>
            <p>
              Persistence:{' '}
              <span className="text-foreground">{health.subsystems?.persistence?.driver}</span>
            </p>
            <p>
              Scrape engine:{' '}
              <span className="text-foreground">
                {health.subsystems?.scrapeEngine?.ready ? 'ready' : 'not implemented'}
              </span>
            </p>
          </div>
        ) : (
          <p>Backend not reachable on /api/v1</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default ConnectionStatus;
