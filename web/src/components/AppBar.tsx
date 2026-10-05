import type { SyncState, SyncStatus } from '../lib/sync';
import { t } from '../strings';
import { MoreIcon, SyncIcon, type SyncDisplay } from './Icons';

interface AppBarProps {
  sync: SyncState;
  pending: number;
  onSyncTap: () => void;
  onOpenMenu: () => void;
}

export function AppBar({ sync, pending, onSyncTap, onOpenMenu }: AppBarProps) {
  const display = syncDisplay(sync.status, pending);
  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <h1 className="app-title">{t.appName}</h1>
        <button
          type="button"
          className={`icon-button sync-button is-${display}`}
          aria-label={describeSync(sync, pending)}
          onClick={onSyncTap}
        >
          <SyncIcon status={display} />
          {display === 'offline' && pending > 0 && (
            <span className="sync-badge" aria-hidden="true">
              {pending > 99 ? '99+' : pending}
            </span>
          )}
        </button>
        <button type="button" className="icon-button" aria-label={t.menu} onClick={onOpenMenu}>
          <MoreIcon />
        </button>
      </div>
    </header>
  );
}

function syncDisplay(status: SyncStatus, pending: number): SyncDisplay {
  if (status === 'offline') return 'offline';
  if (status === 'error') return 'error';
  if (status === 'synced' && pending === 0) return 'synced';
  return 'syncing';
}

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' });

/** One sentence about the sync state, for the menu, the toast and screen readers. */
export function describeSync(sync: SyncState, pending: number): string {
  switch (syncDisplay(sync.status, pending)) {
    case 'offline':
      return t.offline(pending);
    case 'error':
      return t.syncFailed(sync.error ?? '');
    case 'syncing':
      return pending > 0 ? `${t.syncing} ${t.waiting(pending)}` : t.syncing;
    case 'synced':
      return sync.lastSyncedAt ? t.syncedAt(timeFormat.format(sync.lastSyncedAt)) : t.synced;
  }
}
