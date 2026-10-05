import { describe, expect, test } from 'vitest';
import { Clock } from './hlc';

describe('Clock', () => {
  test('formats wall time, counter and node as a fixed-width timestamp', () => {
    const clock = new Clock('node0001', () => 1790000000123);

    expect(clock.tick()).toBe('001790000000123:00000:node0001');
  });

  test('counts up within the same millisecond', () => {
    const clock = new Clock('node0001', () => 1000);

    expect([clock.tick(), clock.tick()]).toEqual([
      '000000000001000:00000:node0001',
      '000000000001000:00001:node0001',
    ]);
  });

  test('never goes backwards when the wall clock does', () => {
    let now = 2000;
    const clock = new Clock('node0001', () => now);
    clock.tick();
    now = 1000;

    expect(clock.tick()).toBe('000000000002000:00001:node0001');
  });

  test('ticks after an observed remote timestamp are newer than it', () => {
    const clock = new Clock('node0001', () => 1000);

    clock.observe('000000000005000:00007:zzzzzzzz');

    expect(clock.tick()).toBe('000000000005000:00008:node0001');
  });

  test('ignores observed timestamps older than its own', () => {
    const clock = new Clock('node0001', () => 5000);
    clock.tick();

    clock.observe('000000000001000:00009:zzzzzzzz');

    expect(clock.tick()).toBe('000000000005000:00001:node0001');
  });

  test('ignores malformed timestamps', () => {
    const clock = new Clock('node0001', () => 1000);

    clock.observe('not a timestamp');

    expect(clock.tick()).toBe('000000000001000:00000:node0001');
  });

  test('moves to the next millisecond when the counter is exhausted', () => {
    const clock = new Clock('node0001', () => 1000);
    let last = '';
    for (let i = 0; i <= 100_000; i++) last = clock.tick();

    expect(last).toBe('000000000001001:00000:node0001');
  });

  test('timestamps sort as strings in the order they were created', () => {
    let now = 999;
    const clock = new Clock('node0001', () => now);
    const early = clock.tick();
    now = 1000;
    const late = clock.tick();

    expect(early < late).toBe(true);
  });
});
