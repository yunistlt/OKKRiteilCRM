-- 1. Total character count across all transcripts
SELECT SUM(LENGTH(transcript)) as total_characters, COUNT(*) as total_calls
FROM raw_telphin_calls
WHERE transcript IS NOT NULL;

-- 2. List of transcripts with dates and character counts
SELECT 
    started_at as "Дата", 
    duration_sec as "Длительность (сек)", 
    LENGTH(transcript) as "Знаков", 
    transcript as "Текст"
FROM raw_telphin_calls
WHERE transcript IS NOT NULL
ORDER BY started_at DESC;
