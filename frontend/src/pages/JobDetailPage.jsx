import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Database, RefreshCw, Trash2 } from 'lucide-react';

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
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {Object.entries(job.params ?? {}).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-4 py-2">
                    <dt className="text-sm text-muted-foreground">{humanizeKey(key)}</dt>
                    <dd className="font-mono text-sm text-foreground">{String(value)}</dd>
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
            <EmptyState
              className="border-0"
              icon={Database}
              title="No records yet"
              description="Records appear here once the scraper engine runs this job."
            />
          }
        />
      </SectionCard>
    </>
  );
}

export default JobDetailPage;
