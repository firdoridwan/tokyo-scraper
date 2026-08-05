import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CheckCircle2, Download, Globe, Info } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { SourceCard } from '@/components/scraper/SourceCard.jsx';
import { ScrapeForm } from '@/components/scraper/ScrapeForm.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';

import { resultsApi } from '@/api/services/results.api.js';
import { useSources } from '@/hooks/useSources.js';
import { useCreateJob } from '@/hooks/useJobs.js';

/**
 * New Scrape — source selection plus the dynamic parameter form.
 *
 * "Start Scraping" posts to `POST /api/v1/jobs`, which runs the scrape and
 * answers when it is finished. There is no progress to show because there is
 * nothing to poll: the response IS the completion, and it carries the company
 * count and the CSV the run wrote.
 */
export function ScrapePage() {
  const navigate = useNavigate();
  const { sources, isLoading, error, refetch } = useSources();

  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const [createdJob, setCreatedJob] = useState(null);

  // Pre-select the first source once the list arrives.
  useEffect(() => {
    if (!selectedSourceId && sources.length > 0) setSelectedSourceId(sources[0].id);
  }, [sources, selectedSourceId]);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;

  const createJob = useCreateJob({
    onSuccess: (job) => setCreatedJob(job),
  });

  const handleSubmit = async (payload) => {
    setCreatedJob(null);
    await createJob.mutate(payload);
  };

  return (
    <>
      <PageHeader
        title="New Scrape"
        description="Choose a directory source, set your parameters, and run an extraction."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/jobs">View jobs</Link>
          </Button>
        }
      />

      {error ? <ErrorState error={error} onRetry={refetch} /> : null}

      {createdJob ? (
        <Alert variant="success">
          <CheckCircle2 />
          <AlertTitle>Scrape complete</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{createdJob.message}</p>
            <p>
              Companies processed:{' '}
              <span className="font-mono text-foreground">{createdJob.resultCount}</span>
            </p>
            {createdJob.export?.files?.xlsx ? (
              <p>
                Excel file:{' '}
                <span className="font-mono text-xs text-foreground">
                  {createdJob.export.files.xlsx}
                </span>
              </p>
            ) : null}
            {createdJob.export?.fileName ? (
              <p>
                CSV file:{' '}
                <span className="font-mono text-xs text-foreground">
                  {createdJob.export.fileName}
                </span>
              </p>
            ) : null}
            {/* Plain links: the browser downloads the files itself. Excel leads;
                CSV sits under it as the secondary option. */}
            {createdJob.export?.files?.xlsx ? (
              <div>
                <Button asChild size="sm">
                  <a href={resultsApi.downloadUrl(createdJob.id, 'xlsx')} download>
                    <Download />
                    Download Excel
                  </a>
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              {createdJob.export?.fileName ? (
                <Button asChild size="sm" variant="outline">
                  <a href={resultsApi.downloadUrl(createdJob.id, 'csv')} download>
                    <Download />
                    Download CSV
                  </a>
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={() => navigate(`/jobs/${createdJob.id}`)}>
                Open job
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {createJob.error ? <ErrorState error={createJob.error} /> : null}

      <SectionCard
        title="Source"
        description="Websites currently registered with the scraper engine."
      >
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-40 w-full" />
            ))}
          </div>
        ) : sources.length === 0 ? (
          <EmptyState
            icon={Globe}
            title="No sources registered"
            description="Register a source module in backend/src/scrapers/registry.js."
          />
        ) : (
          <div role="radiogroup" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                isSelected={source.id === selectedSourceId}
                onSelect={setSelectedSourceId}
                disabled={createJob.isPending}
              />
            ))}
          </div>
        )}
      </SectionCard>

      {selectedSource && !selectedSource.implemented ? (
        <Alert variant="info">
          <Info />
          <AlertTitle>{selectedSource.name} scraper is not implemented yet</AlertTitle>
          <AlertDescription>
            You can still create jobs — they are validated, persisted, and queued through the real
            API. Execution begins once the source module is added under{' '}
            <code className="font-mono text-foreground">
              backend/src/scrapers/{selectedSource.id}/
            </code>
            .
          </AlertDescription>
        </Alert>
      ) : null}

      {selectedSource ? (
        <ScrapeForm
          source={selectedSource}
          onSubmit={handleSubmit}
          isSubmitting={createJob.isPending}
        />
      ) : null}

      {selectedSource ? (
        <SectionCard
          title="Output Columns"
          description={`Fields ${selectedSource.name} can produce for each business.`}
        >
          <div className="flex flex-wrap gap-2">
            {selectedSource.outputFields?.map((field) => (
              <span
                key={field}
                className="rounded-md border border-border bg-secondary px-2.5 py-1 font-mono text-xs text-muted-foreground"
              >
                {field}
              </span>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </>
  );
}

export default ScrapePage;
