import { toCsv, type CsvEntry } from './csv';

interface ExportOptions {
  /** Attempts a sync; resolves to whether it succeeded. */
  sync: () => Promise<boolean>;
  /** Reads the rows to export. Called after the sync attempt, so merged remote rows are included. */
  getRows: () => readonly CsvEntry[];
  /** Writes the file (download or share sheet). */
  save: (csv: string) => Promise<void>;
  /** How long to wait for the sync before exporting what is on this device. */
  timeoutMs: number;
}

/** Tries to sync, then always writes the CSV, whether the sync worked, failed or took too long. */
export async function exportCsv({ sync, getRows, save, timeoutMs }: ExportOptions): Promise<{ synced: boolean; count: number }> {
  const attempt = Promise.resolve()
    .then(sync)
    .catch(() => false);
  const synced = await withTimeout(attempt, timeoutMs, false);
  const rows = getRows();
  await save(toCsv(rows));
  return { synced, count: rows.length };
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
