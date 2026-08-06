import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Globe, Info } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { SourceCard } from '@/components/scraper/SourceCard.jsx';
import { ScrapeForm } from '@/components/scraper/ScrapeForm.jsx';
import { JobProgress } from '@/components/scraper/JobProgress.jsx';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';

import { useSources } from '@/hooks/useSources.js';
import { useActiveJobRecovery, useCreateJob, useJobPolling } from '@/hooks/useJobs.js';
import { isTerminalStatus } from '@/lib/constants.js';

/**
 * New Scrape — source selection, the dynamic parameter form, and the live run.
 *
 * "Start Scraping" posts to `POST /api/v1/jobs`, which answers immediately with
 * a queued job and runs the scrape in the background. The page keeps only the
 * job id; everything shown after that is re-read from
 * `GET /api/v1/jobs/:id` every two seconds until the job finishes.
 *
 * Holding the id rather than the job record is the point: the record is stale
 * the instant it arrives, so there is exactly one source of truth for the run's
 * state, and it is the server.
 *
 * Which is also why a refresh does not lose a run. The id lives in React state
 * and a reload discards it, but the run never belonged to the page — it belongs
 * to the backend, which is still scraping. On mount the page asks which job is
 * unfinished and picks the thread back up. Nothing is remembered on the client
 * to make that work.
 */
export function ScrapePage() {
  const navigate = useNavigate();
  const { sources, isLoading, error, refetch } = useSources();

  const [selectedSourceId, setSelectedSourceId] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);

  // Only until this session starts one of its own — after that the page's own
  // id is the truth and recovery has nothing to add.
  const [hasStartedHere, setHasStartedHere] = useState(false);
  const recovered = useActiveJobRecovery(!hasStartedHere);

  useEffect(() => {
    if (!hasStartedHere && recovered.jobId) setActiveJobId(recovered.jobId);
  }, [hasStartedHere, recovered.jobId]);

  // Pre-select the first source once the list arrives.
  useEffect(() => {
    if (!selectedSourceId && sources.length > 0) setSelectedSourceId(sources[0].id);
  }, [sources, selectedSourceId]);

  const selectedSource = sources.find((source) => source.id === selectedSourceId) ?? null;

  const createJob = useCreateJob({
    onSuccess: (job) => setActiveJobId(job?.id ?? null),
  });

  const { job, error: pollError } = useJobPolling(activeJobId);

  // Between the POST resolving and the first poll landing there is no job
  // record yet — the run is already accepted, so the form stays locked.
  const isJobActive = Boolean(activeJobId) && !isTerminalStatus(job?.status);
  const isBusy = createJob.isPending || isJobActive;

  const handleSubmit = async (payload) => {
    setHasStartedHere(true);
    setActiveJobId(null);
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

      {/* Accepted, but the first poll has not landed yet. */}
      {activeJobId && !job ? (
        <Alert variant="info">
          <AlertTitle>Waiting to start...</AlertTitle>
          <AlertDescription>
            <p className="font-mono text-xs">{activeJobId}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      <JobProgress job={job} error={pollError} />

      {job && isTerminalStatus(job.status) ? (
        <Button size="sm" variant="ghost" onClick={() => navigate(`/jobs/${job.id}`)}>
          Open job
        </Button>
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
                disabled={isBusy}
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

      {/* `isSubmitting` locks the form and the Start button. It now covers the
          whole run, not just the POST: the job is queued or running until it
          reaches a terminal state, and starting a second scrape on top of it
          would launch a second browser. */}
      {selectedSource ? (
        <ScrapeForm source={selectedSource} onSubmit={handleSubmit} isSubmitting={isBusy} />
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
