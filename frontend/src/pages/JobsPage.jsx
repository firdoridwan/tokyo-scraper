import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ListChecks, PlayCircle, RefreshCw } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { DataTable } from '@/components/common/DataTable.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { Pagination } from '@/components/common/Pagination.jsx';
import { StatusBadge } from '@/components/common/StatusBadge.jsx';
import { Button } from '@/components/ui/button.jsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.jsx';

import { useJobs } from '@/hooks/useJobs.js';
import { DEFAULT_PAGE_SIZE, JOB_STATUS_OPTIONS } from '@/lib/constants.js';
import { formatRelativeTime, truncate } from '@/lib/utils.js';

const ALL_STATUSES = 'all';

/** Job queue history with server-side filtering and pagination. */
export function JobsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(ALL_STATUSES);

  const { jobs, pagination, isLoading, error, refetch } = useJobs({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    status: status === ALL_STATUSES ? undefined : status,
  });

  const columns = [
    {
      key: 'id',
      header: 'Job',
      render: (job) => (
        <span className="font-mono text-xs text-muted-foreground">{truncate(job.id, 18)}</span>
      ),
    },
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
    { key: 'status', header: 'Status', render: (job) => <StatusBadge status={job.status} /> },
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

  const handleStatusChange = (next) => {
    setStatus(next);
    setPage(1); // A filter change invalidates the current page index.
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Every extraction job, newest first. Select a row to inspect its detail."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refetch}>
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

      {error ? <ErrorState error={error} onRetry={refetch} /> : null}

      <SectionCard
        title="Job Queue"
        noPadding
        actions={
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              {JOB_STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        <DataTable
          columns={columns}
          rows={jobs}
          isLoading={isLoading}
          onRowClick={(job) => navigate(`/jobs/${job.id}`)}
          emptyState={
            <EmptyState
              className="border-0"
              icon={ListChecks}
              title={status === ALL_STATUSES ? 'No jobs yet' : `No ${status} jobs`}
              description="Jobs appear here as soon as they are queued."
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

        {pagination ? (
          <div className="border-t border-border px-5 py-3">
            <Pagination pagination={pagination} onPageChange={setPage} />
          </div>
        ) : null}
      </SectionCard>
    </>
  );
}

export default JobsPage;
