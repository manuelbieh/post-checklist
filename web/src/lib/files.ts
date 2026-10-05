/**
 * Decodes an uploaded text file: UTF-8, or Windows-1252 (what older Excel
 * versions write) when the bytes are not valid UTF-8.
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export async function readTextFile(file: File): Promise<string> {
  return decodeText(new Uint8Array(await file.arrayBuffer()));
}

export function csvFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `post-check-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
}

/** 'needs-tap': the browser only opens the share sheet right after a tap, and too much time passed. */
export type SaveResult = 'saved' | 'canceled' | 'needs-tap';

/**
 * Hands a CSV file to the user: the share sheet on iPhone and iPad (where
 * "Save to Files" lives, and downloads are unreliable in home screen apps),
 * a regular download everywhere else.
 */
export async function saveCsvFile(csv: string, fileName: string): Promise<SaveResult> {
  const file = new File([csv], fileName, { type: 'text/csv' });
  if (isAppleTouchDevice() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'saved';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'canceled';
      if (error instanceof DOMException && error.name === 'NotAllowedError') return 'needs-tap';
      throw error;
    }
  }
  download(file);
  return 'saved';
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function isAppleTouchDevice(): boolean {
  // iPadOS reports itself as a Mac; touch support gives it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
