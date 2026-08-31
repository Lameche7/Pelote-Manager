export const ERREBOT_PDF_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  previewLines: 80,
} as const;

export type ErrebotPdfSelection = {
  name: string;
  size: number;
  type: string;
};

export type ErrebotExtractionPreview = {
  pageCount: number;
  characterCount: number;
  lineCount: number;
  excerpt: string;
  truncated: boolean;
};

export const validateErrebotPdfSelection = (
  file: ErrebotPdfSelection,
): string | null => {
  if (file.size <= 0) return "Le fichier PDF est vide.";
  if (file.size > ERREBOT_PDF_LIMITS.maxBytes) {
    return "Le fichier dépasse la limite de 20 Mo.";
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return "Sélectionnez un fichier PDF Errebot.";
  }
  if (file.type && file.type !== "application/pdf") {
    return "Le type du fichier sélectionné n’est pas un PDF.";
  }
  return null;
};

export const normalizeExtractedPdfText = (value: string) =>
  value
    .replace(/\u00a0/g, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

export const buildErrebotExtractionPreview = (
  value: string,
  pageCount: number,
): ErrebotExtractionPreview => {
  const normalized = normalizeExtractedPdfText(value);
  const lines = normalized ? normalized.split("\n") : [];
  const excerptLines = lines.slice(0, ERREBOT_PDF_LIMITS.previewLines);
  return {
    pageCount: Math.max(0, Math.floor(pageCount)),
    characterCount: normalized.length,
    lineCount: lines.length,
    excerpt: excerptLines.join("\n"),
    truncated: lines.length > excerptLines.length,
  };
};

export const formatErrebotFileSize = (size: number) => {
  if (size < 1024) return `${size} octets`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} Ko`;
  return `${(size / (1024 * 1024)).toFixed(1)} Mo`;
};
