-- ============================================================
-- CFAC — per-provider sync lock. Serializes runSync() so an overlapping cron
-- tick + manual "Sync all" (or a long-running tick overlapping the next) can't
-- BOTH run the non-atomic metrics swap and leave two live metric sets for the
-- same data_source (which would double every figure on the dashboard).
--
-- Lease-based: a run claims the lock via a conditional UPDATE (atomic at the row
-- level in Postgres) setting sync_lock_until to now()+lease and a per-run
-- sync_lock_token; it releases by nulling them in a finally — but ONLY if the
-- token still matches (ownership check), so a run whose lease expired mid-flight
-- cannot null a newer run's live lease. The lease means a crashed run self-heals
-- once the window elapses instead of wedging the provider forever. RLS deny-all —
-- service-role only (inherited from the connections table).
-- ============================================================

alter table connections
  add column if not exists sync_lock_until timestamptz,
  add column if not exists sync_lock_token text;
