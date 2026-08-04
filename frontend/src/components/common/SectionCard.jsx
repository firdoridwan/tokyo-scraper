import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card.jsx';
import { cn } from '@/lib/utils.js';

/**
 * Card with a titled header and optional header actions — the standard
 * container for a page section. Use `noPadding` when the body is a table that
 * should reach the card edges.
 */
export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  noPadding = false,
}) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div className="space-y-1.5">
            {title ? <CardTitle>{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </CardHeader>
      )}

      <CardContent className={cn(noPadding && 'p-0', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

export default SectionCard;
