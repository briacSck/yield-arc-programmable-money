import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ForecastResult } from '@yield/shared';

/**
 * Out-of-line forecast snapshots (`forecasts.jsonl`), keyed by decision id — the cone chart's
 * data source. Kept OUT of the event log so `EventLogRecord` stays unchanged and `/api/events`
 * payloads stay small (a 90-point series per row would be ~24 MB after four weeks).
 */
export interface ForecastSnapshot {
  decisionId: string;
  loggedAt: string;
  forecast: ForecastResult;
  /** The canonical BaselineInputs the forecast was computed from (receipt preimage, W2 explorer). */
  inputs?: unknown;
}

export class ForecastStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  append(snapshot: ForecastSnapshot): void {
    appendFileSync(this.filePath, `${JSON.stringify(snapshot)}\n`, 'utf8');
  }

  /** Latest valid snapshot; torn/corrupt lines are skipped defensively. */
  latest(): ForecastSnapshot | null {
    if (!existsSync(this.filePath)) return null;
    const lines = readFileSync(this.filePath, 'utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        return JSON.parse(line) as ForecastSnapshot;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Snapshot for one decision (W2 receipt explorer), or null. */
  byDecisionId(decisionId: string): ForecastSnapshot | null {
    if (!existsSync(this.filePath)) return null;
    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as ForecastSnapshot;
        if (parsed.decisionId === decisionId) return parsed;
      } catch {
        continue;
      }
    }
    return null;
  }
}
