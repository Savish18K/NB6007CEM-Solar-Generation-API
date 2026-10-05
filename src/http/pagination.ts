import type { Request } from 'express';

// Collection body: { count, page, page_size, next, previous, results }.
// count is the total across all pages; next/previous keep the current filters and sort (null at the ends).
// The paging itself is done in SQL with LIMIT/OFFSET.
export interface Page<T> {
  count: number;
  page: number;
  page_size: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export function toPage<T>(req: Request, page: number, pageSize: number, count: number, results: T[]): Page<T> {
  const lastPage = Math.max(1, Math.ceil(count / pageSize));
  const link = (n: number) => {
    const url = new URL(req.originalUrl, 'http://placeholder');
    url.searchParams.set('page', String(n));
    url.searchParams.set('page-size', String(pageSize));
    return `${url.pathname}${url.search}`;
  };
  return {
    count,
    page,
    page_size: pageSize,
    next: page < lastPage ? link(page + 1) : null,
    previous: page > 1 ? link(Math.min(page - 1, lastPage)) : null,
    results,
  };
}

export function offsetOf(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
