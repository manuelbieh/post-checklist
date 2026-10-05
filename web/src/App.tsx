import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppBar, describeSync } from './components/AppBar';
import { Grid } from './components/Grid';
import type { HintKind } from './components/MarkButton';
import { MenuSheet } from './components/MenuSheet';
import { ConfirmSheet, ImportSheet, RowSheet, type ConfirmOptions } from './components/Sheets';
import { ToastProvider, useToast } from './components/Toast';
import { csvToEntries, type CsvEntry } from './lib/csv';
import { exportCsv } from './lib/export';
import { csvFileName, readTextFile, saveCsvFile, type SaveResult } from './lib/files';
import { generateListId, isValidListId, normalizeListId } from './lib/listId';
import { currentListId, forgetList, openList, recentListIds } from './lib/session';
import type { KeyValueStorage } from './lib/storage';
import type { ListStore } from './lib/store';
import { createSession, useListSnapshot, useSyncState, type ListSession } from './session';
import { t } from './strings';

/** How long an export waits for the sync before writing what this device has. */
const EXPORT_SYNC_TIMEOUT_MS = 3000;
const HINT_INTERVAL_MS = 2500;

interface AppProps {
  storage: KeyValueStorage;
  /** False when the browser blocks localStorage and data only lives in memory. */
  persistent: boolean;
}

export function App({ storage, persistent }: AppProps) {
  const [listId, setListId] = useState(() => currentListId(storage, normalizeListId(location.hash.slice(1))));
  const session = useMemo(() => createSession(listId, storage), [listId, storage]);

  useEffect(() => session.start(), [session]);

  // Installing the app (Add to Home Screen) then starts it on this list; see server/manifest.go.
  useEffect(() => {
    document.querySelector('link[rel="manifest"]')?.setAttribute('href', `/manifest.webmanifest?list=${listId}`);
  }, [listId]);

  const switchList = useCallback(
    (id: string) => {
      // A list that was never used (typically the one created on first launch) isn't worth remembering.
      if (!session.store.hasRows()) forgetList(storage, session.store.listId);
      openList(storage, id);
      // Before the new list renders: its useListAddress must find its own ID in the address.
      showListInAddress(id);
      setListId(id);
    },
    [session, storage],
  );

  return (
    <ToastProvider>
      <ListScreen key={listId} session={session} storage={storage} persistent={persistent} onSwitchList={switchList} />
    </ToastProvider>
  );
}

type SheetState =
  | { kind: 'menu'; focusOpenList: boolean }
  | { kind: 'row'; id: string }
  | { kind: 'import'; fileName: string; entries: CsvEntry[] }
  | ({ kind: 'confirm' } & ConfirmOptions)
  | null;

interface ListScreenProps {
  session: ListSession;
  storage: KeyValueStorage;
  persistent: boolean;
  onSwitchList: (id: string) => void;
}

function ListScreen({ session, storage, persistent, onSwitchList }: ListScreenProps) {
  const { store, engine } = session;
  const { rows, pending } = useListSnapshot(store);
  const sync = useSyncState(engine);
  const toast = useToast();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [exporting, setExporting] = useState(false);
  const lastHint = useRef(0);

  const closeSheet = useCallback((kind: NonNullable<SheetState>['kind']) => {
    setSheet((current) => (current?.kind === kind ? null : current));
  }, []);

  useEffect(() => {
    if (!persistent) toast({ message: t.storageUnavailable, duration: 10_000 });
  }, [persistent, toast]);

  useListAddress(store, onSwitchList, setSheet);
  useUpdateNotice();

  const openRow = useCallback((id: string) => setSheet({ kind: 'row', id }), []);

  const showHint = useCallback(
    (kind: HintKind) => {
      const now = Date.now();
      if (now - lastHint.current < HINT_INTERVAL_MS) return;
      lastHint.current = now;
      toast({ message: kind === 'keyboard' ? t.markHintKeyboard : t.markHintTouch });
    },
    [toast],
  );

  const deleteRow = (id: string) => {
    const name = store.getRow(id)?.name.trim() ?? '';
    store.deleteRow(id);
    toast({ message: t.deleted(name), action: { label: t.undo, onAction: () => store.restoreRow(id) } });
  };

  const showSyncStatus = () => {
    toast({ message: describeSync(engine.getState(), store.getSnapshot().pending) });
    void engine.sync().then(() => toast({ message: describeSync(engine.getState(), store.getSnapshot().pending) }));
  };

  const exportList = async () => {
    setExporting(true);
    const fileName = csvFileName(new Date());
    let csvText = '';
    let saved = 'saved' as SaveResult;
    try {
      const { synced, count } = await exportCsv({
        sync: () => engine.sync(),
        getRows: () => store.getSnapshot().rows,
        save: async (csv) => {
          csvText = csv;
          saved = await saveCsvFile(csv, fileName);
        },
        timeoutMs: EXPORT_SYNC_TIMEOUT_MS,
      });
      closeSheet('menu');
      if (saved === 'canceled') return;
      if (saved === 'needs-tap') {
        toast({
          message: t.exportReady,
          duration: Infinity,
          action: {
            label: t.saveFile,
            onAction: () => void saveCsvFile(csvText, fileName).catch(() => toast({ message: t.exportFailed })),
          },
        });
        return;
      }
      toast({ message: synced ? t.exported(count) : t.exportedUnsynced(count), duration: synced ? undefined : 8000 });
    } catch (error) {
      console.error('Post Check: export failed', error);
      toast({ message: t.exportFailed });
    } finally {
      setExporting(false);
    }
  };

  const importFile = async (file: File) => {
    closeSheet('menu');
    let entries: CsvEntry[];
    try {
      entries = csvToEntries(await readTextFile(file));
    } catch (error) {
      console.error('Post Check: import failed', error);
      toast({ message: t.importFailed(file.name) });
      return;
    }
    if (entries.length === 0) {
      toast({ message: t.importEmpty(file.name) });
    } else if (store.getSnapshot().rows.length === 0) {
      toast({ message: t.imported(store.importEntries(entries, 'append')) });
    } else {
      setSheet({ kind: 'import', fileName: file.name, entries });
    }
  };

  const openOtherList = (id: string) => {
    closeSheet('menu');
    if (id !== store.listId) onSwitchList(id);
  };

  const startNewList = () =>
    setSheet({
      kind: 'confirm',
      title: t.startNewList,
      body: t.newListConfirm(store.listId),
      confirmLabel: t.startNewList,
      onConfirm: () => onSwitchList(generateListId()),
    });

  const rowIndex = sheet?.kind === 'row' ? rows.findIndex((row) => row.id === sheet.id) : -1;

  return (
    <div className="app">
      <AppBar sync={sync} pending={pending} onSyncTap={showSyncStatus} onOpenMenu={() => setSheet({ kind: 'menu', focusOpenList: false })} />
      <main className="sheet-area">
        <Grid
          store={store}
          onOpenRow={openRow}
          onHint={showHint}
          emptyNote={
            <>
              <p>
                <strong>{t.emptyTitle}</strong> {t.emptyBody}
              </p>
              <p>
                {t.emptyJoinQuestion}{' '}
                <button type="button" className="link-button" onClick={() => setSheet({ kind: 'menu', focusOpenList: true })}>
                  {t.emptyJoinAction}
                </button>
              </p>
            </>
          }
        />
      </main>

      {sheet?.kind === 'menu' && (
        <MenuSheet
          listId={store.listId}
          recentIds={recentListIds(storage)}
          syncText={describeSync(sync, pending)}
          exporting={exporting}
          focusOpenList={sheet.focusOpenList}
          onClose={() => closeSheet('menu')}
          onExport={exportList}
          onImportFile={importFile}
          onOpenList={openOtherList}
          onStartNewList={startNewList}
        />
      )}
      {sheet?.kind === 'row' && rowIndex >= 0 && (
        <RowSheet
          number={rowIndex + 1}
          name={rows[rowIndex]!.name}
          onDelete={() => deleteRow(sheet.id)}
          onClose={() => closeSheet('row')}
        />
      )}
      {sheet?.kind === 'import' && (
        <ImportSheet
          fileName={sheet.fileName}
          entries={sheet.entries}
          onImport={(mode) => toast({ message: t.imported(store.importEntries(sheet.entries, mode)) })}
          onClose={() => closeSheet('import')}
        />
      )}
      {sheet?.kind === 'confirm' && <ConfirmSheet {...sheet} onClose={() => closeSheet('confirm')} />}
    </div>
  );
}

/**
 * The address names the current list (/#brave-otter-harbor), so bookmarks and home screen
 * apps open that list. On iOS that matters: a home screen app starts with its own, empty
 * storage. The same address is the share link.
 */
function showListInAddress(id: string) {
  if (location.hash !== `#${id}`) history.replaceState(history.state, '', `#${id}`);
}

/**
 * Keeps the address in line with the list, and handles share links and edits to the
 * address: a device that hasn't used its own list yet switches right away, otherwise it
 * asks first.
 */
function useListAddress(store: ListStore, onSwitchList: (id: string) => void, setSheet: (sheet: SheetState) => void) {
  useEffect(() => {
    const handle = () => {
      const id = normalizeListId(location.hash.slice(1));
      if (id === store.listId) return;
      // The address keeps naming this list until a switch happens.
      showListInAddress(store.listId);
      if (!isValidListId(id)) return;
      if (!store.hasRows()) {
        onSwitchList(id);
        return;
      }
      setSheet({
        kind: 'confirm',
        title: t.sharedListTitle(id),
        body: t.sharedListBody,
        confirmLabel: t.open,
        cancelLabel: t.stayHere,
        onConfirm: () => onSwitchList(id),
      });
    };
    handle();
    window.addEventListener('hashchange', handle);
    return () => window.removeEventListener('hashchange', handle);
  }, [store, onSwitchList, setSheet]);
}

/** Offers a reload when a new version of the app was installed in the background. */
function useUpdateNotice() {
  const toast = useToast();
  useEffect(() => {
    const serviceWorker = navigator.serviceWorker;
    // Without a controller this is the first install, not an update.
    if (!serviceWorker?.controller) return;
    const onChange = () =>
      toast({ message: t.updateReady, duration: Infinity, action: { label: t.reload, onAction: () => location.reload() } });
    serviceWorker.addEventListener('controllerchange', onChange);
    return () => serviceWorker.removeEventListener('controllerchange', onChange);
  }, [toast]);
}
