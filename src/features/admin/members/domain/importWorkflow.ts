import type { ImportPreviewRow } from "./importPreview.js";
type WorkflowJson =
  | string
  | number
  | boolean
  | null
  | { [key: string]: WorkflowJson | undefined }
  | WorkflowJson[];
type ExecutionStatus = { status: "completed" | "failed" };
export function buildImportValidationPayload(
  rows: ImportPreviewRow[],
  originalRows: string[][],
): WorkflowJson[] {
  return rows.map((row) => ({
    lineNumber: row.lineNumber,
    original: originalRows[row.lineNumber - 1] ?? [],
    data: row.data,
    decision: {
      ignored: row.ignored,
      confirmedSensitive: row.confirmedSensitive,
      reactivate: row.reactivate,
      confirmDistinctIdentity: row.confirmedSensitive,
    },
  }));
}
export const importSucceeded = (result: ExecutionStatus) =>
  result.status === "completed";
export const canGoToNextPage = (
  page: number,
  pageSize: number,
  total: number,
) => page * pageSize < total;
