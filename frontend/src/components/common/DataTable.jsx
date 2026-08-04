import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.jsx';
import { Skeleton } from '@/components/ui/skeleton.jsx';
import { EmptyState } from './EmptyState.jsx';
import { cn } from '@/lib/utils.js';

/**
 * Column-driven table.
 *
 * Columns are `{ key, header, render?, className?, width? }`. Because rendering
 * is data-driven, the Results page can build its columns at runtime from a
 * source's `outputFields` — no per-site table component required.
 *
 * Owns the three states every list needs: loading, empty, populated.
 */
export function DataTable({
  columns,
  rows,
  isLoading,
  emptyState,
  getRowId = (row, index) => row?.id ?? index,
  onRowClick,
  className,
}) {
  if (isLoading) {
    return (
      <div className="space-y-2 p-1">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return emptyState ?? <EmptyState title="Nothing to show yet" />;
  }

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => (
            <TableHead key={column.key} className={column.className} style={column.width ? { width: column.width } : undefined}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>

      <TableBody>
        {rows.map((row, index) => (
          <TableRow
            key={getRowId(row, index)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(onRowClick && 'cursor-pointer')}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={column.className}>
                {column.render ? column.render(row, index) : (row[column.key] ?? '—')}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default DataTable;
