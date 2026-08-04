import { Link, useRouteError } from 'react-router-dom';
import { AlertTriangle, LayoutDashboard, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button.jsx';
import { Card, CardContent } from '@/components/ui/card.jsx';

/**
 * Router-level error boundary.
 *
 * Catches render-time crashes so a bug in one page shows a recoverable screen
 * instead of a blank document. React Router calls this via `errorElement`.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-destructive/15 p-2.5">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">
                The page failed to render. The error is logged in the browser console.
              </p>
            </div>
          </div>

          {error?.message ? (
            <pre className="scrollbar-slim max-h-40 overflow-auto rounded-lg border border-border bg-secondary p-3 font-mono text-xs text-muted-foreground">
              {String(error.message)}
            </pre>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>
              <RotateCcw />
              Reload
            </Button>
            <Button asChild variant="outline">
              <Link to="/">
                <LayoutDashboard />
                Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default RouteErrorBoundary;
