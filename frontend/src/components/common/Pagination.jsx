import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { formatNumber } from '@/lib/utils.js';

/**
 * Pagination footer driven by the API's `meta.pagination` block — the server
 * decides what "next page" means, the client just renders it.
 */
export function Pagination({ pagination, onPageChange, className }) {
  if (!pagination || pagination.total === 0) return null;

  const { page, pageSize, total, totalPages, hasNextPage, hasPreviousPage } = pagination;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className ?? ''}`}>
      <p className="tabular text-xs text-muted-foreground">
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!hasPreviousPage}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft />
          Previous
        </Button>

        <span className="tabular px-1 text-xs text-muted-foreground">
          Page {page} of {Math.max(totalPages, 1)}
        </span>

        <Button
          variant="outline"
          size="sm"
          disabled={!hasNextPage}
          onClick={() => onPageChange(page + 1)}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

export default Pagination;
