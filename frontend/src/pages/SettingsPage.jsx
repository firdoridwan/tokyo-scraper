import { RefreshCw, Server, Wrench } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';

import { useApiHealth } from '@/hooks/useSystemStatus.js';
import { APP } from '@/lib/constants.js';

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{children}</span>
    </div>
  );
}

/**
 * Runtime configuration, read-only.
 *
 * Settings are environment-driven (`backend/.env`) rather than editable from
 * the UI — a scraper's concurrency and delays are operational parameters, and
 * making them clickable invites accidental rate-limit violations. This page
 * shows what the running process actually loaded.
 */
export function SettingsPage() {
  const { health, isLoading, error, refetch } = useApiHealth({ pollMs: 0 });

  return (
    <>
      <PageHeader
        title="Settings"
        description="Runtime configuration reported by the API process."
        actions={
          <Button variant="outline" size="sm" onClick={refetch}>
            <RefreshCw />
            Refresh
          </Button>
        }
      />

      {error ? <ErrorState error={error} onRetry={refetch} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="API" description="Backend process and version information.">
          {isLoading && !health ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div>
              <Row label="Service">{health?.service ?? '—'}</Row>
              <Row label="Version">{health?.version ?? '—'}</Row>
              <Row label="Environment">
                <Badge variant="neutral">{health?.environment ?? '—'}</Badge>
              </Row>
              <Row label="Uptime">
                <span className="tabular">{health?.uptimeSeconds ?? 0}s</span>
              </Row>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Subsystems" description="What is wired and what is still pending.">
          {isLoading && !health ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <div>
              <Row label="Persistence driver">
                <Badge variant="neutral">{health?.subsystems?.persistence?.driver ?? '—'}</Badge>
              </Row>
              <Row label="Scrape engine">
                <Badge variant={health?.subsystems?.scrapeEngine?.ready ? 'success' : 'warning'}>
                  {health?.subsystems?.scrapeEngine?.ready ? 'Ready' : 'Not implemented'}
                </Badge>
              </Row>
              <Row label="Sources registered">
                <span className="tabular">{health?.subsystems?.sources?.registered ?? 0}</span>
              </Row>
              <Row label="Sources implemented">
                <span className="tabular">{health?.subsystems?.sources?.implemented ?? 0}</span>
              </Row>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Application" description="Client build information.">
        <Row label="Name">{APP.name}</Row>
        <Row label="Version">{APP.version}</Row>
        <Row label="API base">
          <code className="font-mono text-xs">/api/v1</code>
        </Row>
      </SectionCard>

      <Alert variant="info">
        <Server />
        <AlertTitle>Configuration lives in the environment</AlertTitle>
        <AlertDescription>
          Scraper concurrency, request delays, timeouts, and the persistence driver are set in{' '}
          <code className="font-mono text-foreground">backend/.env</code> (see{' '}
          <code className="font-mono text-foreground">backend/.env.example</code>). Restart the API
          after changing them.
        </AlertDescription>
      </Alert>

      <Alert>
        <Wrench />
        <AlertTitle>Planned settings</AlertTitle>
        <AlertDescription>
          Editable proxy pools, per-source rate limits, and export destinations will land alongside
          the scraper engine.
        </AlertDescription>
      </Alert>
    </>
  );
}

export default SettingsPage;
