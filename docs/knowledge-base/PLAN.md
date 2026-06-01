# План внедрения Voice of Customer (VoC) и Базы Знаний

## 1. Исторический майнинг
- [ ] Написать скрипт scripts/voc_historical_mining.ts для выборки и AI-экстракции вопросов/болей
 - [ ] Логировать ошибки и сохранять неудачные кейсы
- [ ] Сохранить результаты в JSON/временную таблицу

## 2. Кластеризация
- [ ] Написать скрипт кластеризации вопросов (scripts/voc_clusterizer.ts)
 - [ ] Сгруппировать вопросы по интентам, посчитать частотность
- [ ] Сформировать файл top_customer_questions_clustered.json

(Full 7-step implementation plan with detailed checklists - see archive)
