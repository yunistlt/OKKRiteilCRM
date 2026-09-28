#!/usr/bin/env python3
"""
Внешний сторож конвейера ОКК. Живёт на VPS обратного прокси, а не на Vercel.

Почему снаружи. 25.09.2026 крон-роуты закрыли проверкой ключа, ключ на проде не
завели — планировщик Vercel получал 401, и три дня стояло всё: приём почты, очередь
работ, синхронизация заказов. Заявки просто перестали появляться. Любой сторож
внутри Vercel умер бы вместе с остальными кронами и промолчал бы точно так же.

Что делает: раз в N минут дёргает https://<хост>/api/monitoring/pipeline-pulse и,
если конвейер встал или сайт не отвечает, пишет владельцу в Telegram в личку.
Ничего не чинит и не запускает — только смотрит и зовёт человека.

Повтор тревоги — не чаще REPEAT_MINUTES (по умолчанию час), чтобы не превратиться
в спам. Когда всё чинится — присылает одно сообщение «конвейер ожил».

Настройки берутся из окружения (см. ops/watchdog/README.md):
  OKK_PULSE_URL        адрес пульса
  TELEGRAM_BOT_TOKEN   токен бота @okkzmk_bot
  OWNER_CHAT_ID        личка владельца
  STATE_FILE           где помнить, о чём уже сообщали (по умолчанию /var/lib/okk-watchdog/state.json)
  REPEAT_MINUTES       через сколько повторять тревогу (по умолчанию 60)
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

PULSE_URL = os.environ.get("OKK_PULSE_URL", "https://okk.zmksoft.com/api/monitoring/pipeline-pulse")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
OWNER_CHAT_ID = os.environ.get("OWNER_CHAT_ID", "")
STATE_FILE = os.environ.get("STATE_FILE", "/var/lib/okk-watchdog/state.json")
REPEAT_MINUTES = int(os.environ.get("REPEAT_MINUTES", "60"))
TIMEOUT_SECONDS = 45


def read_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {"failing": False, "last_alert_at": 0, "last_problems": []}


def write_state(state):
    try:
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE, "w", encoding="utf-8") as handle:
            json.dump(state, handle, ensure_ascii=False)
    except Exception as error:
        print(f"[watchdog] не смог сохранить состояние: {error}", file=sys.stderr)


def send_telegram(text):
    """Молча не падаем: даже если Telegram недоступен, сторож должен дожить до следующего захода."""
    if not BOT_TOKEN or not OWNER_CHAT_ID:
        print("[watchdog] нет TELEGRAM_BOT_TOKEN или OWNER_CHAT_ID — сообщение не отправлено", file=sys.stderr)
        return False

    payload = urllib.parse.urlencode(
        {"chat_id": OWNER_CHAT_ID, "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"}
    ).encode()
    request = urllib.request.Request(f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage", data=payload)

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return response.status == 200
    except Exception as error:
        print(f"[watchdog] Telegram не принял сообщение: {error}", file=sys.stderr)
        return False


def fetch_pulse():
    """Возвращает (problems, detail). Пустой список проблем — конвейер жив."""
    request = urllib.request.Request(PULSE_URL, headers={"User-Agent": "okk-watchdog/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = json.loads(response.read().decode("utf-8"))
            return body.get("problems", []), body
    except urllib.error.HTTPError as error:
        # 503 — это штатный ответ пульса «что-то встало», тело с подробностями есть.
        try:
            body = json.loads(error.read().decode("utf-8"))
            problems = body.get("problems", [])
            if problems:
                return problems, body
            return [f"Пульс ответил кодом {error.code}"], body
        except Exception:
            return [f"Пульс ответил кодом {error.code}"], None
    except Exception as error:
        # Сайт не отвечает вовсе — авария того же класса, что и вставший конвейер.
        return [f"Сайт не отвечает: {error}"], None


def main():
    problems, _detail = fetch_pulse()
    state = read_state()
    now = time.time()

    if problems:
        repeat_due = (now - float(state.get("last_alert_at", 0))) >= REPEAT_MINUTES * 60
        changed = problems != state.get("last_problems", [])

        if not state.get("failing") or changed or repeat_due:
            lines = ["🔴 <b>Конвейер ОКК встал</b>", ""]
            lines += [f"• {problem}" for problem in problems]
            lines += ["", "Заявки из почты и с сайта сейчас не создаются.", PULSE_URL]
            if send_telegram("\n".join(lines)):
                state["last_alert_at"] = now

        state["failing"] = True
        state["last_problems"] = problems
        write_state(state)
        print(f"[watchdog] проблемы: {'; '.join(problems)}")
        return 1

    if state.get("failing"):
        send_telegram("🟢 <b>Конвейер ОКК ожил</b>\n\nВсе проверки проходят, заявки снова создаются.")

    write_state({"failing": False, "last_alert_at": 0, "last_problems": []})
    print("[watchdog] конвейер жив")
    return 0


if __name__ == "__main__":
    sys.exit(main())
