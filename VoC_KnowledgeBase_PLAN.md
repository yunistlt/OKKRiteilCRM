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
    bottom: 50px; 
    left: 50px; /* Перенесли налево, подальше от CarrotQuest! */
    width: 400px; 
    height: 600px; /* Сделали окно огромным */
    background: #fff; 
    border: 5px solid red; /* Толстая красная рамка */
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(255,0,0,0.6); /* Красная тень */
    display: flex; flex-direction: column;
    font-family: Arial, sans-serif;
    z-index: 2147483647; /* Максимально возможный z-index в CSS */
    overflow: hidden;
    transition: transform 0.3s ease;
  }
  #okk-chat-widget.minimized { 
    transform: translateY(540px); /* Чтобы прятался вниз, оставляя красную шапку */
  }
  #okk-chat-header {
    background: red; /* Ярко-красная шапка */
    color: #fff;
    padding: 20px; 
    cursor: pointer;
    font-weight: bold; 
    font-size: 18px;
    display: flex;
    justify-content: space-between;
  }
  #okk-chat-messages {
    flex: 1; padding: 15px; overflow-y: auto; background: #f5f7fa;
  }
  .okk-msg { margin-bottom: 10px; padding: 12px; border-radius: 8px; max-width: 80%; line-height: 1.4; font-size: 16px;}
  .okk-msg.user { background: #d1e3ff; margin-left: auto; }
  .okk-msg.ai { background: #fff; border: 1px solid #e1e1e1; margin-right: auto; }
  #okk-chat-input-area { display: flex; border-top: 1px solid #eee; background: #fff; }
  #okk-chat-input { flex: 1; border: none; padding: 15px; outline: none; font-size: 16px;}
  #okk-chat-send { background: none; border: none; padding: 0 15px; color: red; cursor: pointer; font-weight: bold; font-size: 16px;}
</style>

<!-- Убрали класс minimized, теперь он сразу открыт на пол-экрана! -->
<div id="okk-chat-widget" class="">
  <div id="okk-chat-header">
    <span>🔴 ОКК ТЕСТ</span>
    <span id="okk-chat-toggle">▼</span>
  </div>
  <div id="okk-chat-messages">
    <div class="okk-msg ai">Если вы видите это окно, значит код на сайт встал успешно!</div>
  </div>
  <div id="okk-chat-input-area">
    <input type="text" id="okk-chat-input" placeholder="Введите сообщение...">
    <button id="okk-chat-send">Отправить</button>
  </div>
</div>

<script>
  (function() {
    const widget = document.getElementById('okk-chat-widget');
    const header = document.getElementById('okk-chat-header');
    const toggle = document.getElementById('okk-chat-toggle');
    const messagesContainer = document.getElementById('okk-chat-messages');
    const input = document.getElementById('okk-chat-input');
    const sendBtn = document.getElementById('okk-chat-send');
    
    let sessionId = localStorage.getItem('okk_chat_session') || null;

    header.addEventListener('click', () => {
      widget.classList.toggle('minimized');
      toggle.innerText = widget.classList.contains('minimized') ? '▲' : '▼';
    });

    function addMessage(text, sender) {
      const msgEl = document.createElement('div');
      msgEl.className = 'okk-msg ' + sender;
      msgEl.innerText = text;
      messagesContainer.appendChild(msgEl);
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    async function sendMessage() {
      const text = input.value.trim();
      if (!text) return;

      addMessage(text, 'user');
      input.value = '';

      try {
        const response = await fetch('https://okk.zmksoft.com/api/widget/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, sessionId: sessionId })
        });

        const data = await response.json();
        
        if (data.sessionId && !sessionId) {
          sessionId = data.sessionId;
          localStorage.setItem('okk_chat_session', sessionId);
        }

        addMessage(data.reply || data.error || 'Ошибка ответа', 'ai');
      } catch (err) {
        console.error(err);
        addMessage('Извините, произошла ошибка подключения к серверу.', 'ai');
      }
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
  })();
</script>
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
