/** One venue visit. Every editable field carries the timestamp of its last change. */
export interface Row {
  id: string;
  /** Creation timestamp; rows are sorted by it. */
  pos: string;
  name: string;
  nameTs: string;
  ig: boolean;
  igTs: string;
  tt: boolean;
  ttTs: string;
  deleted: boolean;
  deletedTs: string;
}

/**
 * Merges two versions of the same row: per field, the newer timestamp wins.
 * Returns `local` itself when `remote` has nothing newer, so unchanged rows
 * keep their identity.
 */
export function mergeRow(local: Row, remote: Row): Row {
  const posEarlier = remote.pos < local.pos;
  const nameNewer = remote.nameTs > local.nameTs;
  const igNewer = remote.igTs > local.igTs;
  const ttNewer = remote.ttTs > local.ttTs;
  const deletedNewer = remote.deletedTs > local.deletedTs;
  if (!posEarlier && !nameNewer && !igNewer && !ttNewer && !deletedNewer) return local;

  return {
    id: local.id,
    pos: posEarlier ? remote.pos : local.pos,
    name: nameNewer ? remote.name : local.name,
    nameTs: nameNewer ? remote.nameTs : local.nameTs,
    ig: igNewer ? remote.ig : local.ig,
    igTs: igNewer ? remote.igTs : local.igTs,
    tt: ttNewer ? remote.tt : local.tt,
    ttTs: ttNewer ? remote.ttTs : local.ttTs,
    deleted: deletedNewer ? remote.deleted : local.deleted,
    deletedTs: deletedNewer ? remote.deletedTs : local.deletedTs,
  };
}

/** The newest timestamp in a row, including its creation. */
export function latestTimestamp(row: Row): string {
  let latest = row.pos;
  for (const ts of [row.nameTs, row.igTs, row.ttTs, row.deletedTs]) {
    if (ts > latest) latest = ts;
  }
  return latest;
}
