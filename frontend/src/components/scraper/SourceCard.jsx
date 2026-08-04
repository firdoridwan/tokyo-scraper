import { Check, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge.jsx';
import { cn } from '@/lib/utils.js';

/**
 * Selectable source tile.
 *
 * Rendered as a radio-style button so keyboard users get proper selection
 * semantics rather than a clickable div.
 */
export function SourceCard({ source, isSelected, onSelect, disabled }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      disabled={disabled}
      onClick={() => onSelect(source.id)}
      className={cn(
        'group relative w-full rounded-xl border p-4 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-60',
        isSelected
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card hover:border-primary/40 hover:bg-secondary/50',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground">{source.name}</p>
            <Badge variant="outline">{source.country}</Badge>
          </div>

          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            {source.baseUrl?.replace(/^https?:\/\//, '')}
          </p>
        </div>

        {isSelected ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary">
            <Check className="h-3 w-3 text-primary-foreground" aria-hidden="true" />
          </span>
        ) : null}
      </div>

      <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{source.description}</p>

      <div className="mt-3 flex items-center gap-2">
        <Badge variant={source.implemented ? 'success' : 'warning'}>
          {source.implemented ? 'Scraper ready' : 'Scraper pending'}
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          {source.outputFields?.length ?? 0} fields
        </span>
      </div>
    </button>
  );
}

export default SourceCard;
