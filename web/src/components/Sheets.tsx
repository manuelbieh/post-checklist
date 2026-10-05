import type { CsvEntry } from '../lib/csv';
import { t } from '../strings';
import { Sheet } from './Sheet';

export function RowSheet({ number, name, onDelete, onClose }: { number: number; name: string; onDelete: () => void; onClose: () => void }) {
  return (
    <Sheet title={t.rowTitle(number)} onClose={onClose}>
      {(close) => (
        <>
          <p className="sheet-lead">{name.trim() || t.unnamedVenue}</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                onDelete();
                close();
              }}
            >
              {t.deleteRow}
            </button>
            <button type="button" className="button" onClick={close}>
              {t.cancel}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
}

export function ConfirmSheet({ title, body, confirmLabel, cancelLabel = t.cancel, onConfirm, onClose }: ConfirmOptions & { onClose: () => void }) {
  return (
    <Sheet title={title} onClose={onClose}>
      {(close) => (
        <>
          <p className="sheet-text">{body}</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                close();
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
            <button type="button" className="button" onClick={close}>
              {cancelLabel}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

interface ImportSheetProps {
  fileName: string;
  entries: readonly CsvEntry[];
  onImport: (mode: 'append' | 'replace') => void;
  onClose: () => void;
}

export function ImportSheet({ fileName, entries, onImport, onClose }: ImportSheetProps) {
  return (
    <Sheet title={t.importCsv} onClose={onClose}>
      {(close) => (
        <>
          <p className="sheet-lead">{t.importFound(entries.length, fileName)}</p>
          <p className="sheet-text">{t.importReplaceWarning}</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                onImport('append');
                close();
              }}
            >
              {t.importAppend}
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                onImport('replace');
                close();
              }}
            >
              {t.importReplace}
            </button>
            <button type="button" className="button" onClick={close}>
              {t.cancel}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
