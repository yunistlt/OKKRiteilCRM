# ТЗ: устойчивость STT-воркера (перезапуск + защита от падений)

Дополнение к `STT_WORKER_SPEC.md`. Проблема: в ночь 15→16.06 воркер хорошо работал ~5 часов
(20:00–01:00, ~60 звонков/час), затем **молча заглох** (2–6/час), хотя в очереди оставались
звонки с живым аудио. Нужно: (1) перезапустить, (2) сделать так, чтобы он не падал/не зависал
тихо в дальнейшем, а если упал — сам поднимался, и мы об этом узнавали.

> На стороне ОКК уже есть подстраховка: взятый звонок лизуется на **30 минут**. Если воркер упал,
> не вернув результат, звонок автоматически переотдаётся другим/перезапущенным воркером. Поэтому
> после перезапуска **ничего вручную чистить не нужно** — он просто продолжит с того же места.

---

## Шаг 0 — немедленный перезапуск

```bash
systemctl restart stt-worker      # если уже под systemd
# или, если запускался вручную/в screen — убить процесс и запустить заново
```
После рестарта проверить, что пошли claim'ы (в логах — строки `claim → N calls`, `done <id>`).

---

## Шаг 1 — найти причину остановки (по логам ~01:00–02:00)

Посмотреть, что было в момент падения темпа:
```bash
journalctl -u stt-worker --since "2026-06-16 00:30" --until "2026-06-16 03:00"
dmesg | grep -i -E "oom|killed|out of memory"   # не убил ли OOM-killer
df -h ; free -h                                  # диск/память
```
Типичные причины:
- **OOM** — модель `large-v3` + утечка/накопление памяти → ядро убивает процесс. Самое вероятное.
- **Необработанное исключение** в цикле (битый аудио-файл, ошибка декода, сетевой сбой к нашему API)
  → процесс упал и не перезапустился.
- **Перезагрузка/обслуживание сервера** ночью.
- **Зависшее сетевое соединение** (повис на скачивании записи или на POST без таймаута).

---

## Шаг 2 — требования к устойчивости (обязательно)

### 2.1 Автоперезапуск через systemd
Воркер должен работать как сервис с безусловным перезапуском:
```ini
# /etc/systemd/system/stt-worker.service
[Unit]
Description=OKK STT worker (pull claim->whisper->result)
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/stt-worker/worker.py
Restart=always
RestartSec=5
# подстелить от OOM: при желании ограничить память и дать рестартиться
# MemoryMax=12G
Environment=STT_WORKER_TOKEN=...
WatchdogSec=120          # см. п.2.4 (sd_notify heartbeat)

[Install]
WantedBy=multi-user.target
```
`Restart=always` → даже если процесс упадёт (OOM, исключение) — поднимется за 5 сек.

### 2.2 Цикл не должен умирать от одной ошибки
Главный `while True` обернуть так, чтобы **любая** ошибка на одном звонке логировалась и цикл
продолжался, а не валил процесс:
- ошибка claim/сети к нашему API → лог + `sleep` + continue (НЕ падать);
- ошибка скачивания записи → `POST result {status:"error"}` + continue;
- ошибка транскрибации (битый файл, декод) → `POST result {status:"error"}` + continue;
- любое прочее исключение в итерации → лог + continue.

### 2.3 Таймауты на ВСЕ сетевые операции
Чтобы воркер не «повисал» навсегда:
- `requests.get(claim, timeout=15)`, `requests.post(result, timeout=30)`;
- скачивание записи — `timeout=(10, 120)` (connect, read);
- транскрибация — разумный потолок по времени (если файл аномально длинный/битый — прервать,
  отдать `error`).

### 2.4 Heartbeat + watchdog (чтобы зависание ловилось)
Зависание (процесс жив, но не работает) `Restart=always` НЕ ловит. Нужен heartbeat:
- **Вариант А (systemd watchdog):** в начале каждой итерации цикла слать `sd_notify("WATCHDOG=1")`
  (пакет `systemd-python`). Если за `WatchdogSec=120` не пришло — systemd убьёт и перезапустит.
- **Вариант Б (внешний watchdog):** systemd-timer раз в 5 мин проверяет «свежесть» файла
  `/var/run/stt-worker.heartbeat` (воркер обновляет его каждую итерацию); если старше N минут —
  `systemctl restart stt-worker`.

### 2.5 Память: модель грузить ОДИН раз, следить за ростом
- `WhisperModel(...)` создаётся **один раз при старте**, не на каждый звонок.
- Освобождать аудио-буферы/временные файлы после каждого звонка (`with tempfile...`, удалять).
- Профилактический recycle: если RSS процесса перевалил порог (напр. >10–12 ГБ) — корректно
  завершиться (systemd поднимет заново). Это дёшево страхует от утечек.

### 2.6 Идемпотентность (уже поддержано нашей стороной)
- Лиз 30 мин: если не успел вернуть результат — звонок переотдадут. Повторная обработка безопасна
  (наш `result` перезаписывает). Бэкофф на `POST result` при 5xx/сетевых — с ретраями.

---

## Шаг 3 — чтобы МЫ узнавали о простое (мониторинг)

Минимум: воркер пишет в лог темп (раз в минуту — сколько обработано). Плюс одно из:
- алерт от watchdog (п.2.4) при рестарте;
- простой пинг в Telegram/почту при старте и при N подряд пустых/ошибочных claim.

На стороне ОКК отдельно прикинем алерт «нет активности claim > 20 мин» (по `stt_submitted_at`),
чтобы простой воркера был виден и нам. Это уже наша задача.

---

## Приложение — устойчивый каркас цикла (Python)

```python
import os, time, tempfile, requests, traceback

BASE  = "https://okk.zmksoft.com"
HDR   = {"X-Worker-Token": os.environ["STT_WORKER_TOKEN"]}
HEARTBEAT = "/var/run/stt-worker.heartbeat"

def beat():
    try:
        with open(HEARTBEAT, "w") as f: f.write(str(time.time()))
    except Exception: pass

def post_result(body):
    for a in range(5):
        try:
            r = requests.post(f"{BASE}/api/stt/result", json=body, headers=HDR, timeout=30)
            if r.status_code < 500: return
        except requests.RequestException:
            pass
        time.sleep(2 ** a)

def loop():
    while True:
        beat()                                   # heartbeat каждую итерацию
        try:
            r = requests.get(f"{BASE}/api/stt/claim", params={"limit": 1}, headers=HDR, timeout=15)
            r.raise_for_status()
            calls = r.json().get("calls", [])
        except Exception as e:
            print("claim error:", e); time.sleep(5); continue   # НЕ падаем

        if not calls:
            time.sleep(4); continue

        for c in calls:
            cid = c["call_id"]
            try:
                au = requests.get(c["recording_url"], timeout=(10, 120))
                au.raise_for_status()
                with tempfile.NamedTemporaryFile(suffix=".mp3") as f:
                    f.write(au.content); f.flush()
                    text, segs = transcribe(f.name)     # своя функция, тоже в try
                post_result({"call_id": cid, "status": "done", "text": text, "segments": segs})
            except Exception as e:
                print("call error", cid, e); traceback.print_exc()
                post_result({"call_id": cid, "status": "error", "error": str(e)[:200]})
                # цикл продолжается — одна ошибка не валит воркер

if __name__ == "__main__":
    while True:                                  # внешняя страховка поверх systemd
        try:
            loop()
        except Exception as e:
            print("FATAL loop crash, restart in 5s:", e); traceback.print_exc()
            time.sleep(5)
```

**Главное:** `Restart=always` (падения) + heartbeat/watchdog (зависания) + try/except в цикле
(одна ошибка не валит всё) + таймауты на сеть + контроль памяти. Этого достаточно, чтобы воркер
работал сутками без ручного вмешательства.
