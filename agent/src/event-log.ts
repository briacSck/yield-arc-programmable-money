import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EventLogRecord } from '@yield/shared';

/**
 * Append-only JSONL event log — plan §16.2. The agent is the only writer; the dashboard reads
 * one API route backed by this file and nothing else. Mirrors the on-chain events.
 *
 * `seq` RESUMES from the existing file's tail on startup (Tier-1 uptime spans process restarts;
 * a rewound sequence would corrupt the dashboard's ordering).
 */
export class EventLog {
  private readonly filePath: string;
  private nextSeq: number;

  constructor(filePath: string) {
    this.filePath = filePath;
    mkdirSync(path.dirname(filePath), { recursive: true });
    this.nextSeq = this.readTailSeq() + 1;
  }

  /** Validates against the pinned schema, assigns the next seq, appends one JSONL line. */
  append(record: Omit<EventLogRecord, 'seq'>): EventLogRecord {
    const full = EventLogRecord.parse({ ...record, seq: this.nextSeq });
    // Fresh-line guard: if the previous append was torn (container killed mid-write), start on a
    // new line so ONLY the torn line is lost, not this record too.
    let prefix = '';
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, 'utf8');
      if (raw.length > 0 && !raw.endsWith('\n')) prefix = '\n';
    }
    appendFileSync(this.filePath, `${prefix}${JSON.stringify(full)}\n`, 'utf8');
    this.nextSeq += 1;
    return full;
  }

  /** All valid records (torn/corrupt lines skipped — a redeploy kill mid-append must not brick the reader). */
  readAll(): EventLogRecord[] {
    if (!existsSync(this.filePath)) return [];
    const records: EventLogRecord[] = [];
    for (const line of readFileSync(this.filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(EventLogRecord.parse(JSON.parse(trimmed)));
      } catch {
        continue;
      }
    }
    return records;
  }

  /** loggedAt of the most recent CONFIRMED money move (cooldown anchor), or null. */
  lastConfirmedMoveAt(): string | null {
    const records = this.readAll();
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i]!.status === 'CONFIRMED') return records[i]!.loggedAt;
    }
    return null;
  }

  private readTailSeq(): number {
    const records = this.readAll();
    const last = records[records.length - 1];
    return last ? last.seq : -1; // seq recovery counts VALID records only (eng review #9)
  }
}
