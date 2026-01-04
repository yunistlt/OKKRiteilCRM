-- 1. Archive Legacy Calls Table (Safest)
ALTER TABLE IF EXISTS public.calls RENAME TO calls_backup_2026;

-- 2. Archive Legacy History Table
ALTER TABLE IF EXISTS public.order_history RENAME TO order_history_backup_2026;

-- 3. Archive Legacy Matches Tables
ALTER TABLE IF EXISTS public.matches RENAME TO matches_backup_2026;
-- matches_deprecated is confirmed garbage/migrated mostly, but let's backup too
ALTER TABLE IF EXISTS public.matches_deprecated RENAME TO matches_deprecated_backup_2026;

-- 4. Archive Other Legacy Tables
ALTER TABLE IF EXISTS public.order_changes RENAME TO order_changes_backup_2026;
ALTER TABLE IF EXISTS public.manager_kpi RENAME TO manager_kpi_backup_2026;
ALTER TABLE IF EXISTS public.kpi_logs RENAME TO kpi_logs_backup_2026;

-- NOTE: Renaming preserves the data but breaks any hidden dependencies.
-- If nothing breaks in a week, you can run: DROP TABLE ..._backup_2026;
