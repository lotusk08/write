/** Triggers a browser download for generated files. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text: string, filename: string, type = "text/plain"): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

/**
 * Hands a finished HTML document to the browser's own print engine, which is
 * where a PDF comes from.
 *
 * There is no PDF encoder here and there should not be: every browser already
 * carries one that lays out pages, breaks them, embeds the fonts and honours a
 * print stylesheet. A library doing it in JavaScript would be a few hundred
 * kilobytes to do it worse — the same reason WebP is left to the blog's build.
 * On a phone this opens the share sheet, where Save to Files is the PDF.
 *
 * The document arrives whole in `srcdoc`, so one load event means parsed and
 * laid out; its images are already data URIs by the time it gets here, so there
 * is nothing left to fetch. Resolves once printing has been asked for — the
 * dialog belongs to the browser and never says what was chosen.
 */
export function printDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    // Off-screen rather than `display:none`: a frame that does not lay out
    // prints blank.
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;";
    frame.srcdoc = html;

    frame.addEventListener(
      "load",
      () => {
        // Removing the frame while the dialog is open cancels the job, so it
        // outlives the call by a good margin.
        setTimeout(() => frame.remove(), 60_000);
        const view = frame.contentWindow;
        if (!view) {
          reject(new Error("Could not open a print view for the PDF."));
          return;
        }
        try {
          view.focus();
          view.print();
          resolve();
        } catch (error) {
          reject(error instanceof Error ? error : new Error("Printing failed."));
        }
      },
      { once: true },
    );

    document.body.append(frame);
  });
}
