import { useRef, useState, type FormEvent } from 'react';
import { fetchListInfo } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { isValidListId, normalizeListId } from '../lib/listId';
import { t } from '../strings';
import { Sheet } from './Sheet';
import { useToast } from './Toast';

interface MenuSheetProps {
  listId: string;
  recentIds: readonly string[];
  syncText: string;
  exporting: boolean;
  /** Put the cursor into "Open a list by ID" right away. */
  focusOpenList: boolean;
  onClose: () => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
  onOpenList: (id: string) => void;
  onStartNewList: () => void;
}

export function MenuSheet(props: MenuSheetProps) {
  const { listId, recentIds, syncText, exporting, focusOpenList, onClose, onExport, onImportFile, onOpenList, onStartNewList } =
    props;
  const otherIds = recentIds.filter((id) => id !== listId);

  return (
    <Sheet title={t.menu} onClose={onClose}>
      {() => (
        <>
          <section className="sheet-section">
            <h3 className="section-title">{t.listId}</h3>
            <ListIdCard listId={listId} />
            <p className="section-help">{t.listIdHelp}</p>
          </section>

          <section className="sheet-section">
            <h3 className="section-title">{t.backup}</h3>
            <div className="button-row">
              <button type="button" className="button" onClick={onExport} disabled={exporting} aria-busy={exporting}>
                {exporting ? t.exporting : t.exportCsv}
              </button>
              <label className="button">
                {t.importCsv}
                <input
                  type="file"
                  className="sr-only"
                  accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) onImportFile(file);
                  }}
                />
              </label>
            </div>
          </section>

          <section className="sheet-section">
            <h3 className="section-title">{t.otherLists}</h3>
            <OpenListForm currentId={listId} recentIds={recentIds} autoFocus={focusOpenList} onOpen={onOpenList} />
            {otherIds.length > 0 && (
              <div className="recent-lists">
                <p className="section-help">{t.usedOnThisDevice}</p>
                <ul>
                  {otherIds.map((id) => (
                    <li key={id}>
                      <button type="button" className="chip" onClick={() => onOpenList(id)}>
                        {id}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <button type="button" className="button button-quiet" onClick={onStartNewList}>
              {t.startNewList}
            </button>
          </section>

          <p className="sheet-status">{syncText}</p>
        </>
      )}
    </Sheet>
  );
}

function ListIdCard({ listId }: { listId: string }) {
  const [copied, setCopied] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const link = `${location.origin}/#${listId}`;

  const copy = async () => {
    if (await copyText(listId, container.current ?? undefined)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } else {
      toast({ message: t.copyFailed });
    }
  };

  const share = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: t.shareTitle, url: link });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        // Sharing is not available in this context: copy the link instead.
      }
    }
    toast({ message: (await copyText(link, container.current ?? undefined)) ? t.linkCopied : t.copyFailed });
  };

  return (
    <div className="list-id" ref={container}>
      <output className="list-id-value">{listId}</output>
      <div className="button-row">
        <button type="button" className="button" onClick={copy}>
          {copied ? t.copied : t.copy}
        </button>
        <button type="button" className="button" onClick={share}>
          {t.shareLink}
        </button>
      </div>
    </div>
  );
}

interface OpenListFormProps {
  currentId: string;
  recentIds: readonly string[];
  autoFocus: boolean;
  onOpen: (id: string) => void;
}

function OpenListForm({ currentId, recentIds, autoFocus, onOpen }: OpenListFormProps) {
  const [value, setValue] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const id = normalizeListId(value);
    if (!isValidListId(id)) {
      setError(t.invalidListId);
      return;
    }
    // Lists this device already knows open offline too.
    if (id === currentId || recentIds.includes(id)) {
      onOpen(id);
      return;
    }
    if (!navigator.onLine) {
      setError(t.offlineCantOpen);
      return;
    }
    setChecking(true);
    setError('');
    try {
      const { found } = await fetchListInfo(id);
      if (found) onOpen(id);
      else setError(t.listNotFound);
    } catch {
      setError(navigator.onLine ? t.openFailed : t.offlineCantOpen);
    } finally {
      setChecking(false);
    }
  };

  return (
    <form className="open-list" onSubmit={submit} noValidate>
      <label htmlFor="open-list-id" className="field-label">
        {t.openListById}
      </label>
      <div className="field-row">
        <input
          id="open-list-id"
          className="field"
          type="text"
          value={value}
          placeholder={t.listIdPlaceholder}
          data-autofocus={autoFocus || undefined}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-invalid={error !== ''}
          aria-describedby="open-list-error"
          onChange={(event) => {
            setValue(event.target.value);
            setError('');
          }}
        />
        <button type="submit" className="button button-primary" disabled={checking || value.trim() === ''}>
          {checking ? t.checking : t.open}
        </button>
      </div>
      <p id="open-list-error" className="field-error" role="alert">
        {error}
      </p>
    </form>
  );
}
