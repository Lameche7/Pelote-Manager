import readExcelFile from "read-excel-file/browser";
import {
  parseErrebotAvailabilityWorkbook,
  type ErrebotAvailabilityImportParseResult,
  type ErrebotAvailabilityWorkbookSheet,
} from "@/features/admin/tournaments/domain/errebotAvailabilityImport";

export const errebotAvailabilityWorkbookService = {
  async parse(
    file: File,
    slotDurationMinutes: number,
    finalsRequired: boolean,
  ): Promise<ErrebotAvailabilityImportParseResult> {
    const workbook = await readExcelFile(file);
    const sheets: ErrebotAvailabilityWorkbookSheet[] = workbook.map((sheet) => ({
      sheet: sheet.sheet,
      data: sheet.data as unknown[][],
    }));

    return parseErrebotAvailabilityWorkbook(
      sheets,
      slotDurationMinutes,
      finalsRequired,
    );
  },
};
