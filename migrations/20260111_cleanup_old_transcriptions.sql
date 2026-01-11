-- Скрипт для очистки очереди транскрибации
-- Переводит все старые звонки (>30 дней) из статуса 'pending' в 'skipped'

DO $$ 
DECLARE 
    updated_count INTEGER;
BEGIN
    UPDATE public.raw_telphin_calls
    SET transcription_status = 'skipped'
    WHERE transcription_status = 'pending'
      AND (started_at < NOW() - INTERVAL '30 days' OR started_at IS NULL);
      
    GET DIAGNOSTICS updated_count = ROW_COUNT;
    RAISE NOTICE 'Успешно обновлено звонков: %', updated_count;
END $$;

-- Проверка остатка в очереди
SELECT transcription_status, COUNT(*) 
FROM public.raw_telphin_calls 
GROUP BY transcription_status;
