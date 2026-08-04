import { AlertTriangle, RefreshCw, ServerCrash } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';
import { Button } from '@/components/ui/button.jsx';

/**
 * Renders an ApiError meaningfully.
 *
 * A dropped connection to a local backend is by far the most common failure in
 * this app, so it gets its own copy and a retry button rather than a generic
 * "something went wrong".
 */
export function ErrorState({ error, onRetry, className }) {
  if (!error) return null;

  const isNetwork = error.status === 0;
  const Icon = isNetwork ? ServerCrash : AlertTriangle;

  return (
    <Alert variant="destructive" className={className}>
      <Icon />
      <AlertTitle>{isNetwork ? 'API unreachable' : 'Request failed'}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{error.message}</p>

        {isNetwork ? (
          <p className="text-xs">
            Start the backend with <code className="font-mono text-foreground">npm run dev</code>{' '}
            from the project root.
          </p>
        ) : null}

        {error.code ? (
          <p className="font-mono text-xs text-muted-foreground">{error.code}</p>
        ) : null}

        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw />
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export default ErrorState;
