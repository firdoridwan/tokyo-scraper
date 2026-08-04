import { Link } from 'react-router-dom';
import { ExternalLink, Globe, PlayCircle } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { Badge } from '@/components/ui/badge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';

import { useSources } from '@/hooks/useSources.js';

/**
 * Registered directory websites.
 *
 * Renders straight from the registry, so this page documents the system's real
 * capabilities rather than a maintained-by-hand list.
 */
export function SourcesPage() {
  const { sources, isLoading, error, refetch } = useSources();

  return (
    <>
      <PageHeader
        title="Sources"
        description="Directory websites registered with the scraper engine."
        actions={
          <Button asChild size="sm">
            <Link to="/scrape">
              <PlayCircle />
              New Scrape
            </Link>
          </Button>
        }
      />

      {error ? <ErrorState error={error} onRetry={refetch} /> : null}

      {isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No sources registered"
          description="Add a descriptor under backend/src/scrapers/ and register it in registry.js."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {sources.map((source) => (
            <SectionCard
              key={source.id}
              title={source.name}
              description={source.description}
              actions={
                <Badge variant={source.implemented ? 'success' : 'warning'}>
                  {source.implemented ? 'Scraper ready' : 'Scraper pending'}
                </Badge>
              }
            >
              <div className="space-y-5">
                <a
                  href={source.baseUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
                >
                  {source.baseUrl}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Input parameters
                  </p>
                  <ul className="space-y-1.5">
                    {source.fields?.map((field) => (
                      <li key={field.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-foreground">{field.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {field.name}
                          {field.required ? '' : '?'}: {field.type}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Output columns
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {source.outputFields?.map((field) => (
                      <span
                        key={field}
                        className="rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </>
  );
}

export default SourcesPage;
