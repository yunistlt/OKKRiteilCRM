import { describe, it, expect } from 'vitest';
import {
    resolveTranscriptionStatus,
    NO_ANSWER_STATUS,
    NO_RECORDING_STATUS,
    READY_STATUS,
} from '@/lib/telphin-call-outcome';

const answeredLeg = { result: 'answered', record_uuid: 'uuid-1' };
const answeredNoRecord = { result: 'answered' };
const failedLeg = { result: 'failed' };

describe('resolveTranscriptionStatus', () => {
    it('недозвон без записи — «не дозвонились»', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [failedLeg] }, currentStatus: 'pending',
        })).toBe(NO_ANSWER_STATUS);
    });

    it('соединение было, записи нет — «без записи»', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [answeredNoRecord] }, currentStatus: 'pending',
        })).toBe(NO_RECORDING_STATUS);
    });

    it('запись есть и звонок ждёт очереди — не трогаем', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [answeredLeg] }, currentStatus: 'pending',
        })).toBeNull();
    });

    // Главный случай: 6–7 октября 2026 так потерялось 43 разговора.
    it('запись появилась после приговора «не дозвонились» — возвращаем в очередь', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [answeredLeg] },
            recordingUrl: 'https://rec/1.mp3',
            currentStatus: NO_ANSWER_STATUS,
        })).toBe(READY_STATUS);
    });

    it('запись появилась после приговора «без записи» — возвращаем в очередь', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [answeredLeg] },
            recordingUrl: 'https://rec/2.mp3',
            currentStatus: NO_RECORDING_STATUS,
        })).toBe(READY_STATUS);
    });

    it('записи так и нет — приговор остаётся, в очередь не возвращаем', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [failedLeg] }, currentStatus: NO_ANSWER_STATUS,
        })).toBeNull();
    });

    it('расшифровка уже есть — не трогаем даже при записи', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [answeredLeg] },
            recordingUrl: 'https://rec/3.mp3',
            currentStatus: NO_ANSWER_STATUS,
            hasTranscript: true,
        })).toBeNull();
    });

    it('работа уже идёт — приговор не перебивает processing', () => {
        expect(resolveTranscriptionStatus({
            rawPayload: { cdr: [failedLeg] }, currentStatus: 'processing',
        })).toBeNull();
    });
});
