-- Expanding product knowledge for business value (Elena's marketing lens)
ALTER TABLE product_knowledge 
ADD COLUMN IF NOT EXISTS use_cases TEXT[], -- Scenarios of usage
ADD COLUMN IF NOT EXISTS solved_tasks TEXT[], -- Specific tasks the product solves
ADD COLUMN IF NOT EXISTS pain_points TEXT[]; -- Customer pains addressed by the product

COMMENT ON COLUMN product_knowledge.use_cases IS 'Сценарии использования товара';
COMMENT ON COLUMN product_knowledge.solved_tasks IS 'Конкретные задачи, которые решает товар';
COMMENT ON COLUMN product_knowledge.pain_points IS 'Боли клиентов, которые закрывает этот товар';
