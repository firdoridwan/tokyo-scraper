import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Conditional class names with Tailwind conflict resolution.
 * `cn('px-2', condition && 'px-4')` yields `px-4`, not both.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/** @param {string|null|undefined} iso */
export function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** Compact relative time — "3m ago". Keeps job lists scannable. */
export function formatRelativeTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const units = [
    ['s', 60],
    ['m', 60],
    ['h', 24],
    ['d', 7],
  ];

  let value = seconds;
  for (const [suffix, size] of units) {
    if (Math.abs(value) < size) return `${Math.max(value, 0)}${suffix} ago`;
    value = Math.round(value / size);
  }
  return `${value}w ago`;
}

/** @param {number} value */
export function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

/** Turns "businessName" into "Business Name" for dynamic table headers. */
export function humanizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (char) => char.toUpperCase());
}

/** Truncates without cutting mid-word when avoidable. */
export function truncate(text, max = 60) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}
