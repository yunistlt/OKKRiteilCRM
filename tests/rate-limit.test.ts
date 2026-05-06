/**
 * Тесты критических путей: lib/rate-limit.ts
 *
 * Проверяем: sliding window, лимиты, сброс окна, изоляция по ключам
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getRateLimiter, getClientIp, checkRateLimit } from '@/lib/rate-limit';

// Каждый тест использует уникальное имя лимитера, чтобы не пересекаться
let testId = 0;
function newName() { return `test-rl-${++testId}`; }

describe('RateLimiter', () => {
    it('пропускает запросы в пределах лимита', () => {
        const rl = getRateLimiter(newName(), { limit: 3, windowMs: 60_000 });
        expect(rl.check('ip1').ok).toBe(true);
        expect(rl.check('ip1').ok).toBe(true);
        expect(rl.check('ip1').ok).toBe(true);
    });

    it('блокирует после превышения лимита', () => {
        const name = newName();
        const rl = getRateLimiter(name, { limit: 2, windowMs: 60_000 });
        rl.check('ip2');
        rl.check('ip2');
        const result = rl.check('ip2');
        expect(result.ok).toBe(false);
        expect(result.remaining).toBe(0);
        expect(result.resetMs).toBeGreaterThan(0);
    });

    it('изолирует разные IP', () => {
        const name = newName();
        const rl = getRateLimiter(name, { limit: 1, windowMs: 60_000 });
        expect(rl.check('ip-a').ok).toBe(true);
        expect(rl.check('ip-b').ok).toBe(true); // другой IP — свежий bucket
        expect(rl.check('ip-a').ok).toBe(false); // ip-a уже исчерпал
    });

    it('возвращает корректный remaining', () => {
        const name = newName();
        const rl = getRateLimiter(name, { limit: 5, windowMs: 60_000 });
        const r1 = rl.check('ip3');
        expect(r1.remaining).toBe(4);
        const r2 = rl.check('ip3');
        expect(r2.remaining).toBe(3);
    });

    it('пропускает запрос после истечения окна', async () => {
        const name = newName();
        const rl = getRateLimiter(name, { limit: 1, windowMs: 50 }); // 50ms окно
        rl.check('ip4'); // исчерпали
        expect(rl.check('ip4').ok).toBe(false);
        await new Promise(r => setTimeout(r, 60)); // ждём сброса окна
        expect(rl.check('ip4').ok).toBe(true);
    });
});

describe('getClientIp', () => {
    it('читает x-forwarded-for', () => {
        const req = new Request('http://localhost/', {
            headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
        });
        expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('читает x-real-ip если нет forwarded-for', () => {
        const req = new Request('http://localhost/', {
            headers: { 'x-real-ip': '9.9.9.9' },
        });
        expect(getClientIp(req)).toBe('9.9.9.9');
    });

    it('возвращает unknown если нет заголовков', () => {
        const req = new Request('http://localhost/');
        expect(getClientIp(req)).toBe('unknown');
    });
});

describe('checkRateLimit', () => {
    it('возвращает null если лимит не превышен', () => {
        const req = new Request('http://localhost/', {
            headers: { 'x-real-ip': '200.0.0.1' },
        });
        const resp = checkRateLimit(req, newName(), { limit: 10, windowMs: 60_000 });
        expect(resp).toBeNull();
    });

    it('возвращает Response 429 при превышении', () => {
        const name = newName();
        const ip = '201.0.0.1';
        const makeReq = () => new Request('http://localhost/', { headers: { 'x-real-ip': ip } });
        // Используем один и тот же лимитер
        checkRateLimit(makeReq(), name, { limit: 1, windowMs: 60_000 });
        const resp = checkRateLimit(makeReq(), name, { limit: 1, windowMs: 60_000 });
        expect(resp).not.toBeNull();
        expect(resp!.status).toBe(429);
    });

    it('возвращает заголовки CORS при 429', async () => {
        const name = newName();
        const ip = '202.0.0.1';
        const cors = { 'Access-Control-Allow-Origin': '*' };
        const makeReq = () => new Request('http://localhost/', { headers: { 'x-real-ip': ip } });
        checkRateLimit(makeReq(), name, { limit: 1, windowMs: 60_000 }, cors);
        const resp = checkRateLimit(makeReq(), name, { limit: 1, windowMs: 60_000 }, cors);
        expect(resp!.headers.get('Access-Control-Allow-Origin')).toBe('*');
        expect(resp!.headers.get('Retry-After')).toBeTruthy();
    });
});
