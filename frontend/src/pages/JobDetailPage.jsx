import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Database, Download, RefreshCw, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { DataTable } from '@/components/common/DataTable.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { StatusBadge } from '@/components/common/StatusBadge.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Progress } from '@/components/ui/progress.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';

import { useCancelJob, useDeleteJob, useJob } from '@/hooks/useJobs.js';
import { useResults } from '@/hooks/useResults.js';
import { resultsApi } from '@/api/services/results.api.js';
import { JOB_STATUS } from '@/lib/constants.js';
import { formatDateTime, humanizeKey } from '@/lib/utils.js';

/** Label/value row used by the job summary panel. */
function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="max-w-[60%] text-right text-sm text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The files a completed run wrote.
 *
 * These links used to exist in one place only — the success panel on the New
 * Scrape page — which is transient: refreshing the page or navigating away
 * dropped it, and with it the only route to a file that was sitting on disk the
 * whole time. A finished run lives here, so this is where its output belongs.
 *
 * Rendered only when the job actually wrote something. A cancelled or failed run
 * has no `export`, and offering a button that resolves to a 404 is worse than
 * offering none.
 *
 * @param {{ job: object }} props
 */
function ExportDownloads({ job }) {
  if (!job.export?.fileName) return null;

  const xlsx = job.export.files?.xlsx;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <p className="text-sm text-muted-foreground">Files</p>
        {xlsx ? <p className="mt-1 font-mono text-xs text-foreground">{xlsx}</p> : null}
        <p className="mt-1 font-mono text-xs text-foreground">{job.export.fileName}</p>
      </div>

      {/* Excel leads and CSV sits under it, matching the New Scrape panel so the
          same run offers the same two choices in the same order wherever it is
          looked at. */}
      <div className="flex flex-wrap gap-2">
        {xlsx ? (
          <Button asChild size="sm">
            <a href={resultsApi.downloadUrl(job.id, 'xlsx')} download>
              <Download />
              Download Excel
            </a>
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline">
          <a href={resultsApi.downloadUrl(job.id, 'csv')} download>
            <Download />
            Download CSV
          </a>
        </Button>
      </div>
    </div>
  );
}

export function JobDetailPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  const { job, isLoading, error, refetch } = useJob(jobId);
  const { results, isLoading: resultsLoading } = useResults({ jobId, page: 1, pageSize: 25 });

  const cancelJob = useCancelJob({ onSuccess: refetch });
  const deleteJob = useDeleteJob({ onSuccess: () => navigate('/jobs') });

  const isCancellable =
    job && [JOB_STATUS.QUEUED, JOB_STATUS.RUNNING].includes(job.status);

  if (error) {
    return (
      <>
        <PageHeader title="Job" />
        <ErrorState error={error} onRetry={refetch} />
        <Button asChild variant="outline" size="sm">
          <Link to="/jobs">
            <ArrowLeft />
            Back to jobs
          </Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={isLoading ? 'Loading job…' : (job?.sourceName ?? job?.sourceId ?? 'Job')}
        description={job ? <span className="font-mono text-xs">{job.id}</span> : undefined}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link to="/jobs">
                <ArrowLeft />
                Back
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw />
              Refresh
            </Button>
            {isCancellable ? (
              <Button
                variant="outline"
                size="sm"
                disabled={cancelJob.isPending}
                onClick={() => cancelJob.mutate(jobId)}
              >
                <Ban />
                Cancel
              </Button>
            ) : null}
            <Button
              variant="destructive"
              size="sm"
              disabled={deleteJob.isPending}
              onClick={() => deleteJob.mutate(jobId)}
            >
              <Trash2 />
              Delete
            </Button>
          </>
        }
      />

      {cancelJob.error ? <ErrorState error={cancelJob.error} /> : null}
      {deleteJob.error ? <ErrorState error={deleteJob.error} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <SectionCard title="Summary" className="lg:col-span-1">
          {isLoading || !job ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-6 w-full" />
              ))}
            </div>
          ) : (
            <>
              <dl className="divide-y divide-border">
                <DetailRow label="Status">
                  <StatusBadge status={job.status} />
                </DetailRow>
                <DetailRow label="Source">{job.sourceName ?? job.sourceId}</DetailRow>
                <DetailRow label="Records">
                  <span className="tabular">{job.resultCount ?? 0}</span>
                </DetailRow>
                <DetailRow label="Created">{formatDateTime(job.createdAt)}</DetailRow>
                <DetailRow label="Started">{formatDateTime(job.startedAt)}</DetailRow>
                <DetailRow label="Finished">{formatDateTime(job.finishedAt)}</DetailRow>
              </dl>

              <ExportDownloads job={job} />
            </>
          )}
        </SectionCard>

        <div className="space-y-6 lg:col-span-2">
          <SectionCard title="Progress">
            {isLoading || !job ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{job.message ?? 'No status yet.'}</span>
                  <span className="tabular font-medium text-foreground">{job.progress ?? 0}%</span>
                </div>
                <Progress value={job.progress ?? 0} />
                {job.error ? <p className="text-sm text-destructive">{job.error}</p> : null}
              </div>
            )}
          </SectionCard>

          <SectionCard title="Parameters">
            {isLoading || !job ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              /* Stacked, not side by side. A category URL is ~55 characters of
                 unbreakable text, which overflowed its half-width cell and
                 rendered on top of the next parameter's value. Giving each
                 parameter the full width and letting the value wrap is what
                 makes a long URL readable instead of overlapping. */
              <dl className="divide-y divide-border">
                {Object.entries(job.params ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-start justify-between gap-6 py-2">
                    <dt className="shrink-0 text-sm text-muted-foreground">{humanizeKey(key)}</dt>
                    <dd className="min-w-0 break-all text-right font-mono text-sm text-foreground">
                      {String(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Extracted Records" noPadding>
        <DataTable
          columns={[
            {
              key: 'businessName',
              header: 'Business',
              render: (row) => row.businessName ?? '—',
            },
            {
              key: 'data',
              header: 'Data',
              render: (row) => (
                <span className="font-mono text-xs text-muted-foreground">
                  {JSON.stringify(row.data ?? {})}
                </span>
              ),
            },
          ]}
          rows={results}
          isLoading={resultsLoading}
          emptyState={
            /* The old wording — "once the scraper engine runs this job" — read as
               a job still waiting to start, which on a completed run is simply
               untrue and invited the reader to think the run had done nothing.
               A run's output goes to the CSV and the workbook; individual rows
               are not kept in the job store. Saying so is the honest empty
               state, and it points at where the data actually is. */
            <EmptyState
              className="border-0"
              icon={Database}
              title="Rows are not stored per job"
              description={
                job?.export?.fileName
                  ? 'This run wrote its results to the CSV and Excel files listed under Summary — download them there.'
                  : 'A completed run writes its results to a CSV and an Excel file rather than to this table.'
              }
            />
          }
        />
      </SectionCard>
    </>
  );
}

export default JobDetailPage;
