export type ExtractedErrebotPdf = {
  pageCount: number;
  text: string;
};

export const sha256File = async (file: File) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

export const extractErrebotPdfText = async (
  file: File,
): Promise<ExtractedErrebotPdf> => {
  const [{ getDocument, GlobalWorkerOptions }, workerModule] =
    await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);

  GlobalWorkerOptions.workerSrc = workerModule.default;

  const loadingTask = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item ? [item.str] : []))
        .join(" ")
        .replace(/[\t ]+/g, " ")
        .trim();
      pages.push(text);
    }
  } finally {
    await loadingTask.destroy();
  }

  return {
    pageCount: pages.length,
    text: pages.join("\n"),
  };
};
