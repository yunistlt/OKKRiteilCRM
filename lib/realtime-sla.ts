export type RealtimeSlaStatus = 'ok' | 'warning' | 'error';

export interface RealtimeSlaThreshold {
  label: string;
  targetSeconds: number;
  warningSeconds: number;
  criticalSeconds: number;
}

export const REALTIME_SLA_THRESHOLDS = {
  orderFreshness: {
    label: 'Order freshness in OKK',
    targetSeconds: 2 * 60,
    warningSeconds: 90,
    criticalSeconds: 3 * 60,
  },
  transcriptionReady: {
    label: 'Recording ready to transcript',
    targetSeconds: 7 * 60,
    warningSeconds: 5 * 60,
    criticalSeconds: 7 * 60,
  },
  scoreRefresh: {
    label: 'Order event to score refresh',
    targetSeconds: 3 * 60,
    warningSeconds: 2 * 60,
    criticalSeconds: 3 * 60,
  },
} satisfies Record<string, RealtimeSlaThreshold>;

export function getRealtimeSlaStatus(valueSeconds: number | null, threshold: RealtimeSlaThreshold): RealtimeSlaStatus {
  if (valueSeconds === null) {
    return 'warning';
  }

  if (valueSeconds > threshold.criticalSeconds) {
    return 'error';
  }

  if (valueSeconds > threshold.warningSeconds) {
    return 'warning';
  }

  return 'ok';
}

export function getOrderFreshnessIndicatorSeconds(params: {
  retailcrmCursorLagSeconds: number | null;
  orderEventToScoreP95Seconds: number | null;
}) {
  const values = [params.retailcrmCursorLagSeconds, params.orderEventToScoreP95Seconds]
    .filter((value): value is number => typeof value === 'number');

  if (!values.length) {
    return null;
  }

  return Math.max(...values);
}