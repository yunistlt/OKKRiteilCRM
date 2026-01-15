
-- Add a description column for AI context
ALTER TABLE statuses 
ADD COLUMN IF NOT EXISTS ai_description TEXT;

-- Comment on column
COMMENT ON COLUMN statuses.ai_description IS 'Description of the status meaning for AI routing logic';

-- Populate key status descriptions (Initial Seed)
UPDATE statuses 
SET ai_description = 'Используется, когда мы технически не можем произвести изделие, не наш профиль, нет оборудования или нет запрашиваемой номенклатуры.'
WHERE code = 'net-takikh-pozitsii';

UPDATE statuses 
SET ai_description = 'Используется, когда клиенту не подошли технические характеристики нашего стандартного изделия.'
WHERE code = 'tech-char';

UPDATE statuses 
SET ai_description = 'Используется, когда клиент прямо отказался, передумал, купил у конкурентов или пропала необходимость в закупке.'
WHERE code = 'otmenen-propala-neobkhodimost';

UPDATE statuses 
SET ai_description = 'Используется для возврата заказа в работу, если он новый и требует обработки.'
WHERE code = 'novyi-1';
