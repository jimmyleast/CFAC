'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Generic Load-more hook for endpoints that follow the workspace pattern:
//   request:  ?limit=&offset=&<custom filters>
//   response: { items, total, has_more }
//
// Usage:
//   const { items, total, hasMore, loading, loadingMore, error, loadMore, reload } =
//     usePaginatedFetch<Row>('/api/work-orders', { status, priority }, 50)
//
// Param values that are null, undefined, or empty string are skipped. The
// hook refetches the first page whenever any param changes. Pass a stable
// reference for `params` (e.g., from useMemo) to avoid extra refetches.

export type PaginatedPayload<T> = {
  items: T[]
  total: number
  has_more: boolean
}

type Params = Record<string, string | number | null | undefined>

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type UsePaginatedFetchOptions = {
  fetcher?: FetchFn
  enabled?: boolean
}

export function usePaginatedFetch<T>(
  endpoint: string,
  params: Params,
  pageSize: number,
  options: UsePaginatedFetchOptions = {},
) {
  const { fetcher, enabled = true } = options
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  const serializedParams = JSON.stringify(params)
  const itemsLenRef = useRef(0)
  itemsLenRef.current = items.length

  const buildQuery = useCallback(
    (offset: number) => {
      const sp = new URLSearchParams()
      for (const [k, v] of Object.entries(params)) {
        if (v === null || v === undefined) continue
        const s = String(v)
        if (s.length === 0) continue
        sp.set(k, s)
      }
      sp.set('limit', String(pageSize))
      sp.set('offset', String(offset))
      return sp.toString()
    },
    // params is captured via serialization above; eslint can't see through it
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageSize, serializedParams],
  )

  const runFetch = useCallback(
    async (offset: number, append: boolean) => {
      const doFetch = fetcher ?? fetch
      const res = await doFetch(`${endpoint}?${buildQuery(offset)}`)
      const payload = (await res.json().catch(() => null)) as PaginatedPayload<T> | { error?: string } | null
      if (!res.ok) {
        const message = (payload as { error?: string } | null)?.error || 'Unable to load.'
        setError(message)
        if (!append) {
          setItems([])
          setTotal(0)
          setHasMore(false)
        }
        return
      }
      const ok = payload as PaginatedPayload<T> | null
      const nextItems = ok?.items ?? []
      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems))
      setTotal(ok?.total ?? 0)
      setHasMore(Boolean(ok?.has_more))
      setError('')
    },
    [endpoint, buildQuery, fetcher],
  )

  const reload = useCallback(async () => {
    if (!enabled) return
    setLoading(true)
    try {
      await runFetch(0, false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load.')
    } finally {
      setLoading(false)
    }
  }, [enabled, runFetch])

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return
    setLoadingMore(true)
    try {
      await runFetch(itemsLenRef.current, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load more.')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, hasMore, runFetch])

  // Refetch first page whenever params or endpoint change.
  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint, serializedParams, enabled])

  return { items, total, hasMore, loading, loadingMore, error, loadMore, reload }
}
