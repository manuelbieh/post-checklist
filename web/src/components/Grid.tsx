import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { newRowId } from '../lib/ids';
import type { ListStore } from '../lib/store';
import { useListSnapshot } from '../session';
import { t } from '../strings';
import { GridRow, type RowHandlers } from './GridRow';
import { InstagramIcon, TikTokIcon } from './Icons';
import type { HintKind } from './MarkButton';
import { useToast } from './Toast';

interface GridProps {
  store: ListStore;
  onOpenRow: (id: string) => void;
  onHint: (kind: HintKind) => void;
  /** Shown below the rows while the list is empty. */
  emptyNote: ReactNode;
}

/** The sheet: numbered rows, an empty line for the next venue, and ruled filler lines below. */
export function Grid({ store, onOpenRow, onHint, emptyNote }: GridProps) {
  const { rows } = useListSnapshot(store);
  // The id the next venue will get. Typing into the empty line creates a row with
  // exactly this id, so React keeps the focused input (and the phone keyboard).
  const [draftId, setDraftId] = useState(newRowId);
  const gridRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const toast = useToast();
  const fillerCount = useFillerCount(rows.length + 1);

  const handlers = useMemo<RowHandlers>(
    () => ({
      changeName(id, name) {
        if (store.getRow(id)) {
          store.setName(id, name);
        } else if (name !== '') {
          store.addRow(id, name);
          setDraftId(newRowId());
        }
      },
      leaveVenue(id, nameAtFocus) {
        const row = store.getRow(id);
        if (!row || row.deleted) return;
        const name = row.name.trim();
        if (name !== row.name) store.setName(id, name);
        if (name !== '' || row.ig || row.tt) return;
        store.deleteRow(id);
        if (nameAtFocus.trim() !== '') {
          toast({
            message: t.emptyRowRemoved,
            action: {
              label: t.undo,
              onAction: () => {
                store.restoreRow(id);
                store.setName(id, nameAtFocus);
              },
            },
          });
        }
      },
      setMark: (id, mark, value) => store.setMark(id, mark, value),
      openRow: onOpenRow,
      hint: onHint,
    }),
    [store, toast, onOpenRow, onHint],
  );

  const focusCell = (row: number, col: number) => {
    const target = gridRef.current?.querySelector<HTMLInputElement | HTMLButtonElement>(
      `[data-row="${row}"][data-col="${col}"]`,
    );
    if (!target || target.disabled) return;
    target.focus();
    if (target instanceof HTMLInputElement) target.setSelectionRange(target.value.length, target.value.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.dataset.row === undefined || target.dataset.col === undefined) return;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    const inInput = target instanceof HTMLInputElement;

    if (event.key === 'ArrowUp') focusCell(row - 1, col);
    else if (event.key === 'ArrowDown') focusCell(row + 1, col);
    else if (event.key === 'ArrowLeft' && !inInput) focusCell(row, col - 1);
    else if (event.key === 'ArrowRight' && !inInput) focusCell(row, col + 1);
    else if (event.key === 'Enter' && inInput && !event.nativeEvent.isComposing) focusCell(event.shiftKey ? row - 1 : row + 1, 0);
    else return;
    event.preventDefault();
  };

  const focusDraft = () => focusCell(rows.length, 0);

  return (
    <div className="grid" role="table" aria-label={t.appName} ref={gridRef} onKeyDown={onKeyDown}>
      <div className="grid-head" role="rowgroup">
        <div className="row row-head" role="row">
          <div role="columnheader" className="cell cell-no">
            <span aria-hidden="true">#</span>
            <span className="sr-only">{t.rowNumber}</span>
          </div>
          <div role="columnheader" className="cell cell-venue">
            {t.venue}
          </div>
          <div role="columnheader" className="cell cell-mark" title={t.instagram}>
            <InstagramIcon />
            <span className="sr-only">{t.instagram}</span>
          </div>
          <div role="columnheader" className="cell cell-mark" title={t.tiktok}>
            <TikTokIcon />
            <span className="sr-only">{t.tiktok}</span>
          </div>
        </div>
      </div>

      <div className="grid-body" role="rowgroup">
        {/* One array for rows and draft: React matches keys only within the same list, so the
            draft keeps its DOM node (and focus) when it becomes a row. */}
        {[
          ...rows.map((row, index) => (
            <GridRow key={row.id} id={row.id} row={row} index={index} hintId={hintId} handlers={handlers} />
          )),
          <GridRow key={draftId} id={draftId} row={undefined} index={rows.length} hintId={hintId} handlers={handlers} />,
        ]}
      </div>

      {rows.length === 0 && <div className="empty-note">{emptyNote}</div>}

      <div className="grid-fillers" aria-hidden="true" onClick={focusDraft}>
        {Array.from({ length: fillerCount }, (_, i) => (
          <div className="row row-filler" key={i}>
            <div className="cell cell-no">
              <span className="row-number">{rows.length + 2 + i}</span>
            </div>
            <div className="cell cell-venue" />
            <div className="cell cell-mark" />
            <div className="cell cell-mark" />
          </div>
        ))}
      </div>

      <p id={hintId} className="sr-only">
        {t.markHintTouch}. {t.markHintKeyboard}.
      </p>
    </div>
  );
}

/** Enough empty ruled lines to fill the screen below the rows, like a paper pad. */
function useFillerCount(usedRows: number): number {
  const [screenRows, setScreenRows] = useState(rowsOnScreen);
  useEffect(() => {
    const update = () => setScreenRows(rowsOnScreen());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return Math.max(3, screenRows - usedRows);
}

function rowsOnScreen(): number {
  const rowHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--row-h')) || 48;
  // Minus the app bar and the column header, roughly two rows.
  return Math.ceil(window.innerHeight / rowHeight) - 2;
}
