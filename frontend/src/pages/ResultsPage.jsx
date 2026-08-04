import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Database, Download, PlayCircle, RefreshCw, Search } from 'lucide-react';

import { PageHeader } from '@/components/common/PageHeader.jsx';
import { SectionCard } from '@/components/common/SectionCard.jsx';
import { DataTable } from '@/components/common/DataTable.jsx';
import { EmptyState } from '@/components/common/EmptyState.jsx';
import { ErrorState } from '@/components/common/ErrorState.jsx';
import { Pagination } from '@/components/common/Pagination.jsx';
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.jsx';

import { useResults } from '@/hooks/useResults.js';
import { useDebouncedValue } from '@/hooks/useDebouncedValue.js';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants.js';
import { formatRelativeTime, humanizeKey } from '@/lib/utils.js';

/**
 * Extracted records across all jobs.
 *
 * Columns are derived from the rows themselves rather than hardcoded, so any
 * future source's field set renders correctly without a code change here.
 */
function buildColumns(rows) {
  const dataKeys = new Set();
  for (const row of rows.slice(0, 25)) {
    for (const key of Object.keys(row.data ?? {})) dataKeys.add(key);
  }

  return [
    {
      key: 'businessName',
      header: 'Business',
      render: (row) => (
        <span className="font-medium text-foreground">{row.businessName ?? '—'}</span>
      ),
    },
    ...[...dataKeys].map((key) => ({
      key,
      header: humanizeKey(key),
      render: (row) => row.data?.[key] ?? '—',
    })),
    {
      key: 'createdAt',
      header: 'Extracted',
      className: 'text-right text-muted-foreground',
      render: (row) => formatRelativeTime(row.createdAt),
    },
  ];
}

export function ResultsPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const search = useDebouncedValue(searchInput, 350);

  const { results, pagination, isLoading, error, refetch } = useResults({
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    search: search || undefined,
  });

  const [exportNotice, setExportNotice] = useState(null);

  return (
    <>
      <PageHeader
        title="Results"
        description="Every business record extracted across all jobs."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setExportNotice(
                  'CSV export is not implemented yet — the endpoint is reserved at GET /api/v1/results/export.',
                )
              }
            >
              <Download />
              Export CSV
            </Button>
          </>
        }
      />

      {exportNotice ? (
        <Alert variant="info">
          <Download />
          <AlertTitle>Export not available yet</AlertTitle>
          <AlertDescription>{exportNotice}</AlertDescription>
        </Alert>
      ) : null}

      {error ? <ErrorState error={error} onRetry={refetch} /> : null}

      <SectionCard
        title="Extracted Records"
        noPadding
        actions={
          <div className="relative w-[220px]">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Search records…"
              className="pl-9"
              aria-label="Search records"
            />
          </div>
        }
      >
        <DataTable
          columns={buildColumns(results)}
          rows={results}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              className="border-0"
              icon={Database}
              title={search ? 'No matching records' : 'No records yet'}
              description={
                search
                  ? 'Try a different search term.'
                  : 'Records appear here once a scrape job completes.'
              }
              action={
                search ? null : (
                  <Button asChild size="sm">
                    <Link to="/scrape">
                      <PlayCircle />
                      Start Scraping
                    </Link>
                  </Button>
                )
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

export default ResultsPage;
