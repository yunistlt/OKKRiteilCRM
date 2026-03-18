-- Migration: Add admin user to managers table for messenger access
-- Run this in Supabase SQL editor
-- 2026-03-18

-- Step 1: Add admin to managers table with synthetic ID 999999
INSERT INTO public.managers (id, first_name, last_name)
VALUES (999999, 'Администратор', 'Системный')
ON CONFLICT (id) DO NOTHING;

-- Step 2: Update admin user(s) in users table to link to this manager record
UPDATE public.users
SET retail_crm_manager_id = 999999
WHERE role = 'admin' AND retail_crm_manager_id IS NULL;

-- Step 3: Verify
SELECT u.id, u.username, u.role, u.retail_crm_manager_id, m.first_name
FROM public.users u
LEFT JOIN public.managers m ON m.id = u.retail_crm_manager_id
WHERE u.role = 'admin';
