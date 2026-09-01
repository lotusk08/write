export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text: string, filename: string, type = "text/plain"): void {
  downloadBlob(new Blob([text], { type: `${type};charset=utf-8` }), filename);
}

export function printDocument(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;";
    frame.srcdoc = html;

    frame.addEventListener(
      "load",
      () => {
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
