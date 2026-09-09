# Российский reverse-proxy перед Vercel

Чинит «Подключение не защищено»/белый экран у менеджеров в РФ, вызванные
DPI-фильтрацией подсетей Vercel. Пользователи ходят на российский IP, nginx
проксирует трафик на Vercel.

## As-built (развёрнуто 2026-06-25)

- VPS: Timeweb Cloud «OKKRiteil», Москва, **IP `5.42.111.117`** (IPv6 `2a03:6f00:a::2:ae64`), Ubuntu 24.04.
- DNS `okk.zmksoft.com`: A-запись → `5.42.111.117` (раньше был CNAME на Vercel). Зона на Timeweb Hosting (аккаунт `cm56094`, NS `ns1/ns2.timeweb.ru`, `ns3/ns4.timeweb.org`).
- Сертификат Let's Encrypt: первый выпуск — DNS-01 (TXT `_acme-challenge.okk`, пока сайт ещё был на Vercel → ноль простоя), затем продление переключено на **webroot HTTP-01** (`/var/www/certbot`), авто через `certbot.timer` + deploy-hook `systemctl reload nginx`.
- Upstream: `proxy_pass https://76.76.21.21` (anycast Vercel), `Host: okk.zmksoft.com`, SNI = свой домен, `proxy_ssl_verify off`.
- Подтверждено: VPS→Vercel из ДЦ Timeweb не фильтруется (Plan A), Vercel отдаёт проект по Host-заголовку даже когда DNS на него не указывает.
- Доступ к VPS: ключ `~/.ssh/cexuspeh_vps` (привязан через Timeweb Cloud API). Токен API — см. `~/.config/timeweb-cloud/token`.

Plan B (туннель через зарубежный VPS) НЕ понадобился.

## Egress-прокси Т-Банк API (добавлено 2026-07-11)

Тот же VPS используется как **egress** для API Т-Банка: токен Т-Банка IP-локирован, а у
Vercel постоянного исходящего IP нет. В nginx добавлен `location /tbank-egress-<SECRET>/`
→ `proxy_pass https://business.tbank.ru/` — вызовы из Vercel выходят к банку с IP VPS
(`5.42.111.117`, внесён в whitelist токена). Vercel env:
`TBANK_API_BASE = https://okk.zmksoft.com/tbank-egress-<SECRET>/openapi/api`. Реальный
`<SECRET>` живёт только на VPS и в Vercel env (в репозиторий не коммитим). Подробнее —
`docs/payments/OVERVIEW.md` §13.

```
Менеджер (РФ) ──HTTPS──► VPS в РФ (nginx) ──HTTPS──► Vercel
```

## Что НЕ ломается
- **Vercel Cron** — дёргает деплой напрямую по `*.vercel.app`, мимо прокси.
- **Вебхуки RetailCRM/Telphin** — идут на `okk.zmksoft.com` → прокси → Vercel (работают).
- **Supabase/код приложения** — менять не нужно: домен для пользователя остаётся `okk.zmksoft.com`.

## Шаги установки

### 1. VPS в РФ
Минимум 1 vCPU / 1 ГБ (Selectel, Timeweb Cloud, Yandex Cloud, RuVDS). Открыть порты 80 и 443.

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
sudo mkdir -p /var/www/certbot
```

### 2. Vercel: оставить домен привязанным
В проекте Vercel домен `okk.zmksoft.com` должен остаться. Так как A-запись уедет на
VPS, Vercel пометит конфиг как «invalid», но продолжит роутить по Host-заголовку.
Чтобы привязка не слетала — добавить в DNS TXT-запись верификации, которую покажет
Vercel (вида `_vercel  TXT  vc-domain-verify=...`).

### 3. DNS
Сменить запись домена:

```
БЫЛО:  okk.zmksoft.com  CNAME  <...>.vercel-dns-017.com
СТАЛО: okk.zmksoft.com  A      <IP_VPS>
```

### 4. Сертификат + конфиг nginx
```bash
# скопировать okk.zmksoft.com.conf на VPS
sudo cp okk.zmksoft.com.conf /etc/nginx/sites-available/okk.zmksoft.com
sudo ln -s /etc/nginx/sites-available/okk.zmksoft.com /etc/nginx/sites-enabled/

# выпустить сертификат (DNS уже указывает на VPS); --nginx сам поднимет порядок
sudo certbot --nginx -d okk.zmksoft.com

sudo nginx -t && sudo systemctl reload nginx
```

### 5. Проверка
```bash
curl -I https://okk.zmksoft.com            # ожидаем 307 -> /login, server: Vercel
```
Открыть сайт с домашнего провайдера РФ (без VPN) — должен быть «замок» и логин.

## Plan B — если VPS->Vercel тоже режется
VPS в РФ → WireGuard-туннель → дешёвый зарубежный VPS → Vercel. На зарубежном VPS
второй nginx, который и ходит на Vercel; между VPS — WireGuard (UDP, DPI не видит).
В `proxy_pass` российского nginx тогда указывается внутренний IP туннеля.

## WireGuard для SIP из-за границы (добавлено 2026-09-03)

Телфин не пускает SIP-регистрацию с зарубежных IP — отвечает `403 Forbidden Ip`.
Софтфон менеджера, работающего не из РФ, регистрироваться не может. Тот же VPS
служит выходом в РФ для SIP-трафика.

- Интерфейс `wg0`, подсеть `10.8.0.0/24`, слушает **UDP 51820**.
- `net.ipv4.ip_forward=1` (`/etc/sysctl.d/99-wireguard.conf`), один MASQUERADE
  на `10.8.0.0/24` → `eth0`. Nginx и egress Т-Банка не затронуты.
- Пиры и ключи — `/etc/wireguard/wg0.conf`. Приватные ключи клиентов на сервере
  НЕ хранятся: генерим, отдаём в клиентский конфиг, затираем.
- Клиент (Мак Андрея, добавочный 108): конфиг `~/Documents/telphin-ru.conf`,
  приложение WireGuard из App Store.

**Заворачиваем только сети Телфина**, не весь трафик:
`AllowedIPs = 46.229.220.0/22, 79.175.8.0/22` — там и сигнализация (srvpbx2 =
corp.telphin.ru), и медиа (srvpbx3). Остальное идёт напрямую.

Проверка, что подмена IP работает — SIP OPTIONS в туннель: Телфин отвечает
`200 OK` и пишет `received=5.42.111.117`. Если увидели свой настоящий IP —
туннель не поднят либо маршрут мимо.

Выключить: `systemctl disable --now wg-quick@wg0`.

Подробнее про софтфон — `docs/softphone/OVERVIEW.md`.
