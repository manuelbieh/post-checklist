import { useCallback, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from '../strings';
import { CloseIcon } from './Icons';

interface SheetProps {
  title: string;
  onClose: () => void;
  /** Receives a function that closes the sheet (with the browser's focus handling). */
  children: (close: () => void) => ReactNode;
}

/**
 * A modal dialog: a bottom sheet on phones, a centered panel on larger
 * screens. Open while mounted; every way of closing it ends in onClose.
 * onClose can also arrive after the parent unmounted the sheet, so it must
 * only close this particular sheet.
 */
export function Sheet({ title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    // showModal() focuses the first button, and touch browsers draw a focus ring on it.
    // Focus the sheet itself instead, or the field marked with data-autofocus.
    // (React's autoFocus runs before the dialog opens, when nothing inside can take focus.)
    (dialog.querySelector<HTMLElement>('[data-autofocus]') ?? dialog).focus();
    // Closing (rather than just removing) the dialog lets the browser restore focus.
    return () => dialog.close();
  }, []);

  const close = useCallback(() => ref.current?.close(), []);

  return (
    <dialog
      ref={ref}
      className="sheet"
      tabIndex={-1}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dialog element itself is a click on the backdrop.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="sheet-body">
        <header className="sheet-header">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="icon-button" aria-label={t.close} onClick={close}>
            <CloseIcon />
          </button>
        </header>
        {children(close)}
      </div>
    </dialog>
  );
}
