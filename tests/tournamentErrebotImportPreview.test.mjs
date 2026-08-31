import assert from "node:assert/strict";
import test from "node:test";
import {
  buildErrebotExtractionPreview,
  normalizeExtractedPdfText,
  validateErrebotPdfSelection,
} from "../.test-dist/src/features/admin/tournaments/domain/errebotImportPreview.js";

test("la selection Errebot accepte uniquement un PDF raisonnable", () => {
  assert.equal(
    validateErrebotPdfSelection({
      name: "tournoi-errebot.pdf",
      size: 1_024,
      type: "application/pdf",
    }),
    null,
  );
  assert.match(
    validateErrebotPdfSelection({
      name: "tournoi.txt",
      size: 1_024,
      type: "text/plain",
    }),
    /PDF/,
  );
  assert.match(
    validateErrebotPdfSelection({
      name: "tournoi.pdf",
      size: 21 * 1024 * 1024,
      type: "application/pdf",
    }),
    /20 Mo/,
  );
});

test("la previsualisation nettoie le texte sans inventer de donnees", () => {
  const source = "  Tournoi test  \n\nPoule A\t  Équipe 1\n Équipe 2  ";
  assert.equal(
    normalizeExtractedPdfText(source),
    "Tournoi test\nPoule A Équipe 1\nÉquipe 2",
  );
  assert.deepEqual(buildErrebotExtractionPreview(source, 2), {
    pageCount: 2,
    characterCount: 38,
    lineCount: 3,
    excerpt: "Tournoi test\nPoule A Équipe 1\nÉquipe 2",
    truncated: false,
  });
});
