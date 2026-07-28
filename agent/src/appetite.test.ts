import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  AppetiteStore,
  appetitePath,
  budgetUnderAppetite,
  isAppetite,
  scaleByAppetite,
} from './appetite.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), 'appetite-'));
  dirs.push(d);
  return d;
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('appetite — the semantic (liveGather budget scaling)', () => {
  it('scales the remaining daily budget: ×0.5 / ×0.75 / ×1.0', () => {
    assert.equal(scaleByAppetite(4_000_000n, 'conservative'), 2_000_000n);
    assert.equal(scaleByAppetite(4_000_000n, 'balanced'), 3_000_000n);
    assert.equal(scaleByAppetite(4_000_000n, 'opportunistic'), 4_000_000n);
  });

  it('rounds DOWN — never commits more than the appetite allows', () => {
    // 5 base units: 50% = 2.5 → 2, 75% = 3.75 → 3. Rounding up would exceed the scaled budget.
    assert.equal(scaleByAppetite(5n, 'conservative'), 2n);
    assert.equal(scaleByAppetite(5n, 'balanced'), 3n);
    assert.equal(scaleByAppetite(1n, 'conservative'), 0n);
  });

  it('opportunistic is EXACT identity — the default path is bit-for-bit today’s behaviour', () => {
    for (const v of [0n, 1n, 3n, 999_999n, 5_000_000n, 10n ** 18n]) {
      assert.equal(scaleByAppetite(v, 'opportunistic'), v);
    }
  });

  it('is monotonic: a more cautious appetite never yields a larger budget', () => {
    for (const v of [0n, 1n, 7n, 5_000_000n]) {
      const c = scaleByAppetite(v, 'conservative');
      const b = scaleByAppetite(v, 'balanced');
      const o = scaleByAppetite(v, 'opportunistic');
      assert.ok(c <= b && b <= o, `monotonicity broke at ${v}`);
    }
  });
});

describe('appetite — persistence (AppetiteStore)', () => {
  it('CRITICAL DEFAULT: no file present ⇒ opportunistic ⇒ the budget is untouched', () => {
    const store = new AppetiteStore(path.join(tmp(), 'appetite.json'));
    assert.equal(store.read(), 'opportunistic');
    const { appetite, budgetUsdc } = budgetUnderAppetite(4_000_000n, store);
    assert.equal(appetite, 'opportunistic');
    assert.equal(budgetUsdc, 4_000_000n, 'absent file must be byte-identical to today');
  });

  it('round-trips a written value across store instances (survives a restart)', () => {
    const file = path.join(tmp(), 'appetite.json');
    new AppetiteStore(file).write('conservative');
    assert.equal(new AppetiteStore(file).read(), 'conservative');
    // and the liveGather composition sees it: ×0.5, rounded down
    const { budgetUsdc } = budgetUnderAppetite(5_000_001n, new AppetiteStore(file));
    assert.equal(budgetUsdc, 2_500_000n);
  });

  it('overwrites atomically: the last write wins and no temp file is left behind', () => {
    const dir = tmp();
    const file = path.join(dir, 'appetite.json');
    const store = new AppetiteStore(file);
    store.write('balanced');
    store.write('conservative');
    store.write('opportunistic');
    assert.equal(store.read(), 'opportunistic');
    assert.deepEqual(readdirSync(dir), ['appetite.json'], 'temp files must be renamed away, not accumulated');
  });

  it('creates the parent directory if the volume path does not exist yet', () => {
    const file = path.join(tmp(), 'nested', 'deeper', 'appetite.json');
    new AppetiteStore(file).write('balanced');
    assert.ok(existsSync(file));
    assert.equal(new AppetiteStore(file).read(), 'balanced');
  });

  it('an unreadable file fails CAUTIOUS (conservative), never opportunistic', () => {
    // The owner set SOMETHING and it got mangled — the one direction this preference may fail in
    // is the more-cautious one. (Only an ABSENT file means "the owner never chose".)
    for (const garbage of ['not json', '{"appetite":"yolo"}', '{"appetite":42}', '{}', '']) {
      const file = path.join(tmp(), 'appetite.json');
      writeFileSync(file, garbage, 'utf8');
      assert.equal(new AppetiteStore(file).read(), 'conservative', `garbage=${JSON.stringify(garbage)}`);
    }
  });

  it('write refuses a non-appetite value outright', () => {
    const store = new AppetiteStore(path.join(tmp(), 'appetite.json'));
    assert.throws(() => store.write('aggressive' as never), /not an appetite/);
  });
});

describe('appetite — parsing and path resolution', () => {
  it('accepts exactly conservative|balanced|opportunistic and nothing else', () => {
    assert.ok(isAppetite('conservative') && isAppetite('balanced') && isAppetite('opportunistic'));
    for (const bad of ['Conservative', 'OPPORTUNISTIC', 'yolo', '', 42, null, undefined, ['balanced'], {}]) {
      assert.equal(isAppetite(bad), false, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  it('APPETITE_PATH wins; otherwise the file sits alongside EVENT_LOG_PATH', () => {
    const explicit = appetitePath({ APPETITE_PATH: '/data/pref.json' } as NodeJS.ProcessEnv);
    assert.equal(path.basename(explicit), 'pref.json');
    const derived = appetitePath({ EVENT_LOG_PATH: '/data/event-log.jsonl' } as NodeJS.ProcessEnv);
    assert.equal(derived, path.join(path.resolve('/data'), 'appetite.json'));
    // no env at all: still a concrete local path, never a throw
    assert.equal(path.basename(appetitePath({} as NodeJS.ProcessEnv)), 'appetite.json');
  });
});
