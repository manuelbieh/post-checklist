import { memo, useRef } from 'react';
import { MAX_NAME_LENGTH } from '../lib/csv';
import type { Row } from '../lib/rows';
import type { Mark } from '../lib/store';
import { t } from '../strings';
import { MarkButton, type HintKind } from './MarkButton';

export interface RowHandlers {
  /** Sets the venue name; creates the row when it doesn't exist yet (the draft row). */
  changeName: (id: string, name: string) => void;
  /** Called when the venue input loses focus, with the name it had when it gained focus. */
  leaveVenue: (id: string, nameAtFocus: string) => void;
  setMark: (id: string, mark: Mark, value: boolean) => void;
  openRow: (id: string) => void;
  hint: (kind: HintKind) => void;
}

interface GridRowProps {
  id: string;
  /** Undefined for the draft row: the empty line below the list where new venues are typed. */
  row: Row | undefined;
  index: number;
  hintId: string;
  handlers: RowHandlers;
}

export const GridRow = memo(function GridRow({ id, row, index, hintId, handlers }: GridRowProps) {
  const nameAtFocus = useRef('');
  const number = index + 1;
  const name = row?.name ?? '';
  const venueLabel = name.trim() || t.unnamedVenue;

  return (
    <div role="row" className={row ? 'row' : 'row row-draft'}>
      <div role="cell" className="cell cell-no">
        {row ? (
          <button type="button" className="row-number" aria-label={t.rowActions(number)} onClick={() => handlers.openRow(id)}>
            {number}
          </button>
        ) : (
          <span className="row-number" aria-hidden="true">
            {number}
          </span>
        )}
      </div>
      <div role="cell" className="cell cell-venue">
        <input
          className="venue-input"
          type="text"
          value={name}
          aria-label={`${t.venue}, ${t.rowTitle(number)}`}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          autoCapitalize="sentences"
          spellCheck={false}
          enterKeyHint="next"
          data-row={index}
          data-col={0}
          onFocus={() => {
            nameAtFocus.current = name;
          }}
          onChange={(event) => handlers.changeName(id, event.target.value)}
          onBlur={() => handlers.leaveVenue(id, nameAtFocus.current)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') handlers.changeName(id, nameAtFocus.current);
          }}
        />
      </div>
      <div role="cell" className="cell cell-mark">
        <MarkButton
          checked={row?.ig ?? false}
          disabled={!row}
          label={t.markLabel(t.instagram, venueLabel)}
          row={index}
          col={1}
          hintId={hintId}
          onChange={(value) => handlers.setMark(id, 'ig', value)}
          onHint={handlers.hint}
        />
      </div>
      <div role="cell" className="cell cell-mark">
        <MarkButton
          checked={row?.tt ?? false}
          disabled={!row}
          label={t.markLabel(t.tiktok, venueLabel)}
          row={index}
          col={2}
          hintId={hintId}
          onChange={(value) => handlers.setMark(id, 'tt', value)}
          onHint={handlers.hint}
        />
      </div>
    </div>
  );
});
