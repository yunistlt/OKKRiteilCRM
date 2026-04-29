# План внедрения Voice of Customer (VoC) и Базы Знаний

## 1. Исторический майнинг
- [ ] Написать скрипт scripts/voc_historical_mining.ts для выборки и AI-экстракции вопросов/болей
 - [ ] Логировать ошибки и сохранять неудачные кейсы
- [ ] Сохранить результаты в JSON/временную таблицу

## 2. Кластеризация
- [ ] Написать скрипт кластеризации вопросов (scripts/voc_clusterizer.ts)
 - [ ] Сгруппировать вопросы по интентам, посчитать частотность
- [ ] Сформировать файл top_customer_questions_clustered.json
## 0. Ограничения и {literal}
<style>
  #okk-chat-widget {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 380px;
    height: 700px;
    background: #ffffff;
    border-radius: 24px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.15);
    display: flex;
    flex-direction: column;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    z-index: 2147483647;
    overflow: hidden;
    transition: all 0.5s cubic-bezier(0.19, 1, 0.22, 1);
    border: 1px solid rgba(0, 0, 0, 0.05);
  }

  #okk-chat-widget.minimized {
    height: 64px;
    width: 64px;
    border-radius: 32px;
    bottom: 30px;
    cursor: pointer;
  }

  #okk-chat-header {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: #fff;
    padding: 16px 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
  }

  #okk-chat-widget.minimized #okk-chat-header {
    padding: 0; width: 100%; height: 100%; justify-content: center; background: #10b981;
  }

  .agent-info { display: flex; align-items: center; gap: 12px; }
  .agent-avatar { width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(255, 255, 255, 0.2); object-fit: cover; }
  #okk-chat-widget.minimized .agent-avatar { width: 64px; height: 64px; border: none; }
  .agent-status { font-size: 11px; opacity: 0.8; font-weight: 400; }

  #okk-chat-messages {
    flex: 1; padding: 20px; overflow-y: auto; background: #f9fafb; display: flex; flex-direction: column; gap: 12px;
  }

  .okk-msg { max-width: 85%; padding: 12px 16px; border-radius: 18px; font-size: 14px; line-height: 1.5; animation: okkFadeIn 0.3s ease-out; }
  @keyframes okkFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .okk-msg.ai { background: #ffffff; color: #1f2937; align-self: flex-start; border-bottom-left-radius: 4px; border: 1px solid #f3f4f6; }
  .okk-msg.user { background: #10b981; color: #ffffff; align-self: flex-end; border-bottom-right-radius: 4px; }

  #okk-chat-input-area { padding: 16px; background: #fff; border-top: 1px solid #f3f4f6; display: flex; align-items: center; gap: 10px; }
  #okk-chat-input { flex: 1; border: 1px solid #e5e7eb; border-radius: 20px; padding: 10px 16px; outline: none; font-size: 14px; }
  #okk-chat-send { background: none; border: none; color: #10b981; cursor: pointer; }

  #okk-chat-preview {
    position: fixed; bottom: 100px; right: 20px; background: #fff; padding: 12px 16px; border-radius: 20px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12); font-size: 13px; display: none; z-index: 2147483646;
  }
  #okk-chat-preview.active { display: block; }
</style>

<div id="okk-chat-widget" class="minimized">
  <div id="okk-chat-header">
    <div class="agent-info">
      <img src="/images/agents/elena.png" alt="Елена" class="agent-avatar">
      <div>
        <div>Елена (ЗМК)</div>
        <div class="agent-status">В сети • Продуктолог</div>
      </div>
    </div>
    <span id="okk-chat-toggle">▲</span>
  </div>
  <div id="okk-chat-messages"></div>
  <div id="okk-chat-input-area">
    <input type="text" id="okk-chat-input" placeholder="Введите ваш вопрос...">
    <button id="okk-chat-send">▶</button>
  </div>
</div>

<script src="/widget/okk-chat.js"></script>
{/literal}
безопасность
 - [ ] Добавить лимиты на количество запросов к OpenAI (batch-size, max-total)
 - [ ] Добавить защиту от зацикливания (ограничение итераций, логика выхода)

## 3. Схема данных Базы Знаний
 - [x] Создать миграцию для knowledge_base_qa (Supabase)
 - [x] Добавить поля created_at, updated_at, is_deleted
 - [ ] Написать сидер scripts/seed_knowledge_base.ts

## 3a. Типы сущностей и теги
 - [x] Добавить поле type (question/claim/remark) и tags (jsonb) в knowledge_base_qa
 - [ ] Обновить процесс сбора: сохранять тип и теги для каждой записи

## 4. API и Frontend
 - [x] Реализовать GET /api/faq/top с фильтрацией и сортировкой
 - [x] Реализовать компонент <FAQAccordion /> с поддержкой категорий
 - [ ] Добавить пагинацию/фильтрацию (опционально)

## 4a. Интерфейс контроля прогресса наполнения базы
 - [x] Реализовать административный интерфейс для контроля наполнения базы знаний (статистика, прогресс, статус модерации) (реализован компонент FAQStats)
 - [x] Добавить визуализацию количества вопросов, ответов, претензий и замечаний

## 5. Интеграция в ИИ-консультанта
 - [ ] Добавить product_faq в intent routing (lib/okk-consultant.ts) (заглушка добавлена)
 - [ ] Реализовать knowledge retrieval (RAG/exact match)
 - [ ] Добавить регрессионные тесты (scripts/okk_consultant_regression.ts)
 - [ ] Описать fallback-логику

## 6. Near-realtime процесс
 - [ ] Обновить воркеры для извлечения вопросов/болей
 - [ ] Расширить order_metrics/full_order_context
 - [ ] Реализовать агрегацию и алерты в Telegram
 - [ ] Добавить метрики качества извлечения

## 7. Документация и поддержка
 - [x] Описать процесс ручной модерации кластеров и вопросов
 - [x] Описать процесс обновления базы знаний без даунтайма
