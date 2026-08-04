import { cn } from '@/lib/utils.js';

/** Loading placeholder — subtle pulse, never a spinner-in-a-card. */
function Skeleton({ className, ...props }) {
  return <div className={cn('animate-pulse rounded-md bg-secondary', className)} {...props} />;
}

export { Skeleton };
