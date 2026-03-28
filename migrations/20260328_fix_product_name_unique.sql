-- Fix: Add UNIQUE constraint to 'name' column for upsert operations
ALTER TABLE product_knowledge ADD CONSTRAINT product_knowledge_name_unique UNIQUE (name);
