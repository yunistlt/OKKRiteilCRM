-- Update okk_rules_entity_type_check to support 'stage' entity type
ALTER TABLE public.okk_rules DROP CONSTRAINT IF EXISTS okk_rules_entity_type_check;

ALTER TABLE public.okk_rules 
ADD CONSTRAINT okk_rules_entity_type_check 
CHECK (entity_type = ANY (ARRAY['call'::text, 'order'::text, 'event'::text, 'stage'::text]));

COMMENT ON CONSTRAINT okk_rules_entity_type_check ON public.okk_rules IS 'Allows call, order, event, and the new stage-based audits';
