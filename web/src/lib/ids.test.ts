import { describe, expect, test } from 'vitest';
import { newNodeId, newRowId, randomString } from './ids';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** A random source that hands out the given bytes in order. */
function bytes(...values: number[]) {
  let next = 0;
  return (buffer: Uint8Array) => {
    for (let i = 0; i < buffer.length; i++) buffer[i] = values[next++ % values.length]!;
  };
}

describe('randomString', () => {
  test('maps bytes onto the alphabet and skips bytes that would bias it', () => {
    // 62 * 4 = 248, so bytes from 248 upwards are rejected.
    expect(randomString(3, BASE62, bytes(250, 0, 61, 62))).toBe('0z0');
  });
});

describe('newRowId', () => {
  test('is 16 base62 characters', () => {
    expect(newRowId()).toMatch(/^[0-9A-Za-z]{16}$/);
  });

  test('differs between calls', () => {
    expect(newRowId()).not.toBe(newRowId());
  });
});

describe('newNodeId', () => {
  test('is 8 lowercase alphanumeric characters', () => {
    expect(newNodeId()).toMatch(/^[0-9a-z]{8}$/);
  });
});
