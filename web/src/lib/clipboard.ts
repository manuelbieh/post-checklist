/**
 * Copies text to the clipboard. Falls back to a selected textarea where the
 * Clipboard API is missing (plain http on the local network). The textarea is
 * placed in `container` because a modal dialog makes the rest of the page inert.
 */
export async function copyText(text: string, container: HTMLElement = document.body): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    container.append(area);
    area.select();
    try {
      return document.execCommand('copy');
    } finally {
      area.remove();
    }
  }
}
