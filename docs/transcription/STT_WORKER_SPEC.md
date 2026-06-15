# ТЗ: STT-воркер (pull-режим) для расшифровки звонков ОКК

## Контекст и зачем

ОКК-CRM крутится на Vercel (зарубежная инфраструктура). STT-сервер (faster-whisper `large-v3`)
стоит на Timeweb в РФ. Прямой заход **Vercel → сервер в РФ режется** (геоблок входящего трафика,
`fetch failed`). Поэтому направление развёрнуто: **STT-сервер сам забирает задачи у ОКК и
возвращает результат** (исходящие из РФ в облако работают).

Диаризация ролей (Менеджер/Клиент) и определение автоответчика делаются **на стороне ОКК** —
воркеру это не нужно, он отдаёт сырой текст. (OpenAI блокирует РФ-IP, поэтому эти шаги нельзя
выполнять на сервере.)

Задача разработчика: поднять на STT-сервере **бесконечный цикл** `claim → транскрибируем → result`.

---

## База

| | |
|---|---|
| **Base URL** | `https://okk.zmksoft.com` |
| **Авторизация** | заголовок `X-Worker-Token: <STT_WORKER_TOKEN>` на ОБОИХ эндпоинтах. Секрет общий, выдаётся отдельно. Неверный/отсутствует → `401`. |
| **Формат** | JSON. Запросы и ответы в UTF-8. |

---

## Эндпоинт 1 — взять задачи: `GET /api/stt/claim`

Запрос:
```
GET /api/stt/claim?limit=1
X-Worker-Token: <STT_WORKER_TOKEN>
```
- `limit` (опц., 1..20, по умолч. 1) — сколько звонков забрать за раз.

Ответ `200`:
```json
{
  "calls": [
    { "call_id": "6CA9ECAF59DD4BB089EFDA6B64892457",
      "recording_url": "https://storage.telphin.ru/....",
      "duration_sec": 76,
      "language": "ru" }
  ]
}
```
- Пустая очередь → `{ "calls": [] }` (подождать 3–5 сек и повторить).
- Выданные звонки **лизуются на 30 минут**: повторно не выдаются, пока воркер не вернёт результат
  ИЛИ не истекут 30 мин (тогда звонок переотдаётся — на случай, если воркер упал).

**Важно:** верни результат (`done` или `error`) по каждому `call_id` **в пределах 30 минут**.
Иначе звонок переотдадут и он может расшифроваться повторно (не страшно — у нас перезапись,
но это лишняя работа).

---

## Эндпоинт 2 — вернуть результат: `POST /api/stt/result`

Успех:
```
POST /api/stt/result
X-Worker-Token: <STT_WORKER_TOKEN>
Content-Type: application/json

{
  "call_id": "6CA9ECAF59DD4BB089EFDA6B64892457",
  "status": "done",
  "text": "Алло, добрый день, компания ...",
  "segments": [ { "start": 0.0, "end": 3.2, "text": "..." } ]
}
```
- `text` — **сырой** текст расшифровки (без разметки ролей — это сделает ОКК).
- `segments` — опционально (можно не присылать).

Ошибка (не скачалось / не расшифровалось):
```json
{ "call_id": "6CA9ECAF59DD4BB089EFDA6B64892457", "status": "error", "error": "download 404 (запись протухла)" }
```

Ответ `200`:
```json
{ "ok": true, "call_id": "...", "state": "completed" }   // или "failed" при status=error
```
Коды: `400` — нет `call_id` / битый JSON · `401` — авторизация · `500` — ошибка на нашей стороне
(можно повторить POST — он идемпотентен).

---

## Алгоритм воркера

```
повторять бесконечно:
  1) GET /api/stt/claim?limit=1
        если 401 → стоп, проверить токен
        если calls пусто → sleep(3–5s); continue
  2) для каждого call в calls:
        a) скачать recording_url → mp3 (Telphin в РФ — доступен)
              если не скачалось → POST result {status:"error", error:"..."}; continue
        b) транскрибировать локально (large-v3, language="ru") → text (+segments опц.)
              если упало → POST result {status:"error", error:"..."}; continue
        c) POST /api/stt/result {status:"done", text, segments}
              при сетевой ошибке POST → повторить POST с backoff (идемпотентно)
  3) loop
```

### Требования и крайние случаи
- **Последовательность.** Сервер один, обрабатывай по одному (или `limit=K` и последовательно
  внутри). Лиз защищает от двойной выдачи между параллельными воркерами.
- **Сбой воркера.** Если упал, не вернув результат — звонок переотдадут через 30 мин. Потери нет.
- **Идемпотентность result.** Повторный POST для одного `call_id` безопасен (перезапись). При
  сетевой ошибке POST — ретрай с экспоненциальным backoff.
- **Протухшее аудио.** В бэклоге много старых звонков, чьи записи Telphin уже удалил → скачивание
  даст 404/ошибку. Это нормально: шли `status:"error"`, мы пометим `failed` и пойдём дальше.
- **Таймауты HTTP** к нашему API: claim ~15с, result ~30с. На скачивание аудио — свой таймаут.
- **Нагрузка.** Бэклог большой; за ночь воркер его прожуёт (свежие звонки выдаются первыми,
  бэклог следом). Можно держать `limit=1` и крутить плотно.

---

## Референс-реализация (Python)

```python
import os, time, tempfile, requests

BASE  = "https://okk.zmksoft.com"
TOKEN = os.environ["STT_WORKER_TOKEN"]
HDR   = {"X-Worker-Token": TOKEN}

# from faster_whisper import WhisperModel
# model = WhisperModel("large-v3", device="cpu", compute_type="int8")

def transcribe(path: str):
    segments, info = model.transcribe(path, language="ru")
    segs = [{"start": s.start, "end": s.end, "text": s.text} for s in segments]
    text = "".join(s["text"] for s in segs).strip()
    return text, segs

def post_result(body: dict):
    for attempt in range(5):
        try:
            r = requests.post(f"{BASE}/api/stt/result", json=body, headers=HDR, timeout=30)
            if r.status_code < 500:
                return
        except requests.RequestException:
            pass
        time.sleep(2 ** attempt)

def loop():
    while True:
        try:
            r = requests.get(f"{BASE}/api/stt/claim", params={"limit": 1}, headers=HDR, timeout=15)
            r.raise_for_status()
            calls = r.json().get("calls", [])
        except requests.RequestException as e:
            print("claim error:", e); time.sleep(5); continue

        if not calls:
            time.sleep(4); continue

        for c in calls:
            cid = c["call_id"]
            try:
                audio = requests.get(c["recording_url"], timeout=60)
                audio.raise_for_status()
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=True) as f:
                    f.write(audio.content); f.flush()
                    text, segs = transcribe(f.name)
                post_result({"call_id": cid, "status": "done", "text": text, "segments": segs})
                print("done", cid, len(text), "chars")
            except Exception as e:
                post_result({"call_id": cid, "status": "error", "error": str(e)[:200]})
                print("error", cid, e)

if __name__ == "__main__":
    loop()
```

Запускать как сервис (systemd) с автоперезапуском. `STT_WORKER_TOKEN` — из окружения, тот же, что
задан в Vercel.
