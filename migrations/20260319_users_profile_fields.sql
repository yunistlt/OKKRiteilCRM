-- Migration: Add profile fields to users table
-- 2026-03-19

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS first_name TEXT,
    ADD COLUMN IF NOT EXISTS last_name TEXT,
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;
