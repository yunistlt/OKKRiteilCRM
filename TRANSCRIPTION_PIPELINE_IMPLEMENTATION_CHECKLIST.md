# Transcription Pipeline Implementation Checklist

Goal: fully decouple call transcription into an independent, lease-based pipeline with automatic stale recovery and clear operational controls.

## 0. Current Incident Stabilization
- [x] Confirm symptom pattern in production metrics (`completed` flat, `processing` growing, repeated `already being transcribed`).
- [x] Run one-time stale reset for old `processing` calls (without transcript) back to `pending`.
- [x] Reset queued `call_transcription` jobs with stale lock error (`already being transcribed`) to clean retry state.
- [x] Monitor 10-minute window after reset and capture before/after metrics snapshot.
- [x] **Root fix deployed**: added `processing` to `allowedStates` in `claimCallForTranscription` so timed-out runs are atomically re-claimed without a two-step reset (commit `33c531f`).

## 1. Queue Ownership Model (Single Source of Truth)
- [x] Remove dual-lock behavior between call row status and job state — `processing` now included in `allowedStates`, call row re-claimed atomically.
- [x] Make queue job lease the only ownership/lock mechanism — `claim_system_jobs` RPC is primary lock.
- [x] Keep call table status as a result marker only — removed dead `already being transcribed` throw path; status = result only.

## 2. Lease + Heartbeat + TTL
- [ ] Define lease columns and semantics for `call_transcription` jobs.
- [ ] Implement atomic claim with lease expiry.
- [ ] Implement heartbeat extension while worker is active.
- [ ] Implement automatic requeue on lease timeout.

## 3. Idempotency and Deduplication
- [x] Enforce one active transcription job per call id — `idempotency_key: call_transcription:{callId}` already prevents duplicate enqueue.
- [x] Guarantee idempotent completion if transcript already exists — route now checks `transcription_status=completed` before calling `transcribeCall`, returns `already_completed`.
- [x] Handle duplicate enqueue attempts by returning existing active job — handled by `upsert` on idempotency_key.

## 4. Pipeline Decoupling
- [x] Keep transcription worker independent from downstream scoring/insight workflows — downstream enqueue wrapped in `try/catch`, failures logged but do not fail the transcription job.
- [x] Trigger downstream processing from `transcript_completed` event only — unchanged, downstream only enqueued after successful `transcribeCall`.
- [x] Ensure downstream failures do not affect transcription completion state — `completeSystemJob` now called unconditionally after transcription succeeds.

## 5. Retry Strategy Hardening
- [x] Classify retryable vs terminal errors explicitly — terminal errors (not found, no URL, skipped) go to `failSystemJob` with delay=0 without retry.
- [x] Treat lock/race signals as soft retry class with short backoff — removed dead "already being transcribed" from `dependency_wait` classifier.
- [x] Cap retries and route terminal cases to dead-letter with reason — terminal path calls `failSystemJob` directly; max_attempts exhaustion routes to `dead_letter`.

## 6. Observability and Alerting
- [x] Add dashboard metrics: queue depth, running > TTL, completed/min, retry rate, top errors — new endpoint `/api/monitoring/transcription-pipeline` (commit `c317032`).
- [x] Add alerts for "running over TTL" and "no completed while queue > 0" — added `stale_processing_calls` and `transcription_worker_throughput` checks in `/api/monitoring/health` (commit `c317032`).
- [ ] Add an operational runbook for on-call actions.

## 7. Rollout Plan
- [x] Incremental fixes deployed via commits, no feature flag needed for correctness fixes.
- [x] Add monitoring endpoint `/api/monitoring/transcription-pipeline` for operational visibility.

## Execution Log
- 2026-05-04: Checklist created. Starting phase 0 stabilization.
- 2026-05-04: Emergency reset x3 (115 + 12 + 22 calls, 110 + 12 + 22 jobs reset). Root cause found: `processing` not in `allowedStates`. Fix deployed commit `33c531f`. Pipeline confirmed healthy: completed growing (+12 in 6 min), processing/lockErrQueued stable at ~4 (normal active work). Phase 0 complete.
- 2026-05-04: Phases 1/3/4/5 deployed in commit `1ca87e2`: (1) downstream enqueue isolated in try/catch — transcription always completes regardless of scoring/insight failures; (2) idempotency guard — already-completed calls skip without re-transcribing; (3) terminal errors (not found, no URL) skip retry and go straight to dead_letter; (4) removed dead "already being transcribed" dependency_wait classification.
- 2026-05-04: Phase 6 deployed commit `c317032`: new `/api/monitoring/transcription-pipeline` endpoint returns call row counts, stale processing sample, system_jobs state, top errors, worker heartbeat; `/api/monitoring/health` extended with `stale_processing_calls` and `transcription_worker_throughput` checks.
