import { describe, expect, test } from 'vitest';
import { exportCsv } from './export';

const rows = [{ name: 'Borchardt', ig: true, tt: false }];

describe('exportCsv', () => {
  test('syncs first and exports the rows as they are after the sync', async () => {
    let current = rows;
    const saved: string[] = [];

    const result = await exportCsv({
      sync: async () => {
        current = [...rows, { name: 'From the laptop', ig: false, tt: true }];
        return true;
      },
      getRows: () => current,
      save: async (csv) => {
        saved.push(csv);
      },
      timeoutMs: 1000,
    });

    expect(result).toEqual({ synced: true, count: 2 });
    expect(saved).toEqual(['﻿No,Venue,Instagram,TikTok\r\n1,Borchardt,y,n\r\n2,From the laptop,n,y\r\n']);
  });

  test('still writes the file when the sync fails', async () => {
    const saved: string[] = [];

    const result = await exportCsv({
      sync: async () => false,
      getRows: () => rows,
      save: async (csv) => {
        saved.push(csv);
      },
      timeoutMs: 1000,
    });

    expect(result).toEqual({ synced: false, count: 1 });
    expect(saved).toEqual(['﻿No,Venue,Instagram,TikTok\r\n1,Borchardt,y,n\r\n']);
  });

  test('still writes the file when the sync throws', async () => {
    const saved: string[] = [];

    const result = await exportCsv({
      sync: async () => {
        throw new Error('network down');
      },
      getRows: () => rows,
      save: async (csv) => {
        saved.push(csv);
      },
      timeoutMs: 1000,
    });

    expect(result).toEqual({ synced: false, count: 1 });
    expect(saved).toHaveLength(1);
  });

  test('does not wait for a slow sync longer than the timeout', async () => {
    const saved: string[] = [];
    const started = Date.now();

    const result = await exportCsv({
      sync: () => new Promise<boolean>(() => {}),
      getRows: () => rows,
      save: async (csv) => {
        saved.push(csv);
      },
      timeoutMs: 20,
    });

    expect(result).toEqual({ synced: false, count: 1 });
    expect(saved).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
