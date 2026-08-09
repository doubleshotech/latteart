/**
 * Saving a file to the user's disk — the one place the app builds a filename
 * and dispatches a download.
 *
 * Both halves were previously hand-rolled at each call site, and the two copies
 * had drifted into different sanitizers: a per-layer PNG stripped every
 * non-word character while a canvas export replaced only the path-hostile ones,
 * so the same name produced two different files depending on which button
 * saved it.
 */

/**
 * A user-supplied name as a filename.
 *
 * Only the characters that a path can't carry are replaced, rather than
 * stripping everything unfamiliar — a project called "Étude · no.2" should
 * arrive as itself, not as "tude no2". `fallback` covers a name that sanitizes
 * away to nothing, so the file can never be saved as a bare extension.
 */
export function safeFilename(name: string, extension: string, fallback: string): string {
  const base = name
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim()
    .slice(0, 80);
  return `${base || fallback}.${extension}`;
}

/** Save `href` (a `data:` or `blob:` URL) to disk as `filename`. */
export function download(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.click();
}

/**
 * Save a Blob to disk. The object URL is revoked on a timer rather than
 * immediately: the click above only *starts* the download, and the browser
 * reads the URL after this frame — revoking straight away races it.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
