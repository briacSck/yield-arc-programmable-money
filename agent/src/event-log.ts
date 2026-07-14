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
    appendFileSync(this.filePath, `${JSON.stringify(full)}\n`, 'utf8');
    this.nextSeq += 1;
    return full;
  }

  private readTailSeq(): number {
    if (!existsSync(this.filePath)) return -1;
    const lines = readFileSync(this.filePath, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const last = lines[lines.length - 1];
    if (!last) return -1;
    try {
      const parsed = EventLogRecord.parse(JSON.parse(last));
      return parsed.seq;
    } catch {
      return lines.length - 1; // corrupt tail: fall back to line count so seq still moves forward
    }
  }
}
