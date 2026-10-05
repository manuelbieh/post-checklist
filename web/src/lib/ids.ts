type FillRandom = (buffer: Uint8Array<ArrayBuffer>) => void;

// getRandomValues also works on plain http (LAN testing), unlike crypto.randomUUID.
const cryptoFill: FillRandom = (buffer) => {
  crypto.getRandomValues(buffer);
};

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * Builds a random string from `alphabet`. Bytes that would make some
 * characters more likely than others are skipped (rejection sampling).
 */
export function randomString(length: number, alphabet: string, fill: FillRandom = cryptoFill): string {
  const limit = 256 - (256 % alphabet.length);
  const buffer = new Uint8Array(length * 2);
  let result = '';
  while (result.length < length) {
    fill(buffer);
    for (const byte of buffer) {
      if (byte >= limit) continue;
      result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  }
  return result;
}

/** A uniformly distributed integer in [0, size). */
export function randomIndex(size: number, fill: FillRandom = cryptoFill): number {
  const limit = 2 ** 32 - (2 ** 32 % size);
  const buffer = new Uint8Array(4);
  for (;;) {
    fill(buffer);
    const value = new DataView(buffer.buffer).getUint32(0);
    if (value < limit) return value % size;
  }
}

/** Row IDs are generated on the device, so rows can be created offline. */
export function newRowId(): string {
  return randomString(16, BASE62);
}

/** Identifies this page load inside clock timestamps. */
export function newNodeId(): string {
  return randomString(8, BASE36);
}
