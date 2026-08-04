import { Link } from 'react-router-dom';
import {
  Activity,
  CheckCircle2,
  Database,
  ListChecks,
  PlayCircle,
  RefreshCw,
  Wrench,
} from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { StatCard } from '@/components/common/StatCard.jsx';
import { StatusBadge } from '@/components/common/StatusBadge.jsx';
import { DataTable } from '@/components/common/DataTable.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';

import { useStats } from '@/hooks/useSystemStatus.js';
import { useJobs } from '@/hooks/useJobs.js';
import { formatRelativeTime } from '@/lib/utils.js';

/** Columns for the "recent jobs" preview table. */
const RECENT_JOB_COLUMNS = [
  {
    key: 'sourceName',
    header: 'Source',
    render: (job) => (
      <span className="font-medium text-foreground">{job.sourceName ?? job.sourceId}</span>
    ),
  },
  {
    key: 'params',
    header: 'Parameters',
    render: (job) => (
      <span className="text-muted-foreground">
        {Object.entries(job.params ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ') || '—'}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (job) => <StatusBadge status={job.status} />,
  },
  {
    key: 'resultCount',
    header: 'Records',
    className: 'tabular text-right',
    render: (job) => job.resultCount ?? 0,
  },
  {
    key: 'createdAt',
    header: 'Created',
    className: 'text-right text-muted-foreground',
    render: (job) => formatRelativeTime(job.createdAt),
  },
];

export function DashboardPage() {
  const { stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useStats();
  const { jobs, isLoading: jobsLoading, error: jobsError, refetch: refetchJobs } = useJobs({
    page: 1,
    pageSize: 5,
  });

  const refreshAll = () => {
    refetchStats();
    refetchJobs();
  };

  const error = statsError ?? jobsError;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Extraction activity across every configured directory source."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refreshAll}>
              <RefreshCw />
              Refresh
            </Button>
            <Button asChild size="sm">
              <Link to="/scrape">
                <PlayCircle />
                New Scrape
              </Link>
            </Button>
          </>
        }
      />

      {error ? <ErrorState error={error} onRetry={refreshAll} /> : null}

      {/* Engine status — honest about what is and isn't built. */}
      {stats && !stats.engine?.available ? (
        <Alert variant="info">
          <Wrench />
          <AlertTitle>Scraping engine not implemented</AlertTitle>
          <AlertDescription>
            The application skeleton is complete: API, job queue, and persistence seam are wired
            end to end. Jobs you create are accepted and stored, but stay <em>queued</em> until a
            source scraper module is built.
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Jobs"
          value={stats?.jobs?.total ?? 0}
          icon={ListChecks}
          tone="primary"
          isLoading={statsLoading}
        />
        <StatCard
          label="Running"
          value={stats?.jobs?.running ?? 0}
          icon={Activity}
          tone="warning"
          hint={`${stats?.jobs?.queued ?? 0} queued`}
          isLoading={statsLoading}
        />
        <StatCard
          label="Completed"
          value={stats?.jobs?.completed ?? 0}
          icon={CheckCircle2}
          tone="success"
          hint={`${stats?.jobs?.failed ?? 0} failed`}
          isLoading={statsLoading}
        />
        <StatCard
          label="Records Extracted"
          value={stats?.results?.total ?? 0}
          icon={Database}
          tone="primary"
          isLoading={statsLoading}
        />
      </section>

      <SectionCard
        title="Recent Jobs"
        description="The five most recently created extraction jobs."
        noPadding
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/jobs">View all</Link>
          </Button>
        }
      >
        <DataTable
          columns={RECENT_JOB_COLUMNS}
          rows={jobs}
          isLoading={jobsLoading}
          emptyState={
            <EmptyState
              className="border-0"
              icon={ListChecks}
              title="No jobs yet"
              description="Configure a source and start your first extraction to see it here."
              action={
                <Button asChild size="sm">
                  <Link to="/scrape">
                    <PlayCircle />
                    Start Scraping
                  </Link>
                </Button>
              }
            />
          }
        />
      </SectionCard>
    </>
  );
}

export default DashboardPage;
