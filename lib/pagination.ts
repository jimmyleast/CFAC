// Pagination helpers shared across paginated list routes.
//
// Matches the contract first established by app/api/workspace/* in PR #40:
//   request:  ?limit=&offset=&count_only=1
//   response: { items, total, has_more }  |  { total }  (count_only)
//
// Each route picks its own DEFAULT_LIMIT based on UX (tables 50, card grids 24).
// MAX_LIMIT is shared so no caller can request an unbounded page.

export const PG_UNDEFINED_TABLE = '42P01'
export const MAX_LIMIT = 200

export type PaginatedResponse<T> = {
  items: T[]
  total: number
  has_more: boolean
}

export type PaginationParams = {
  limit: number
  offset: number
  countOnly: boolean
}

export function parsePaginationParams(
  searchParams: URLSearchParams,
  defaultLimit: number,
): PaginationParams {
  const countOnly = searchParams.get('count_only') === '1'
  const rawLimit = Number(searchParams.get('limit'))
  const rawOffset = Number(searchParams.get('offset'))
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : defaultLimit),
  )
  const offset = Math.max(0, Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0)
  return { limit, offset, countOnly }
}

export function paginatedJson<T>(
  items: T[],
  count: number | null | undefined,
  offset: number,
): PaginatedResponse<T> {
  const total = count ?? items.length
  return {
    items,
    total,
    has_more: offset + items.length < total,
  }
}
