export type ImportMode = "detect" | "existing" | "none";
export type ExistingImportGroup = { id: number; name: string };
export type ImportRow = {
  rowNumber: number;
  kind: "group" | "activity" | "error";
  name: string;
  groupRow?: number | null;
  plannedStartDate?: string;
  plannedEndDate?: string;
  error?: string;
};
export type ImportGroup = { rowNumber: number; name: string; matches: ExistingImportGroup[] };

/** Imported groups follow first appearance in Excel; unrelated groups keep their slots. */
export function planImportedGroupOrder(
  groups: readonly { id: number; sortOrder: number }[], importedIds: readonly number[],
) {
  const ordered = [...groups].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const currentIds = new Set(ordered.map(group => group.id));
  const imported = [...new Set(importedIds)].filter(id => currentIds.has(id));
  if (imported.length < 2) return [];
  const selected = new Set(imported);
  let index = 0;
  return ordered.map(group => selected.has(group.id) ? imported[index++] : group.id)
    .map((id, sortOrder) => ({ id, sortOrder }))
    .filter(item => groups.find(group => group.id === item.id)?.sortOrder !== item.sortOrder);
}

export function normalizeImportGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

// Keep the date formats and ordering checks used by the original Excel importer.
export function parseExcelImportDate(val: string): string | null {
  const isoMatch = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarDate(y, m, d)) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const slashMatch = val.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
  if (slashMatch) {
    const d = Number(slashMatch[1]);
    const m = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    if (isValidCalendarDate(y, m, d)) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const num = Number(val);
  if (!isNaN(num) && num > 1 && num < 200000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(date.getTime())) return date.toISOString().split("T")[0];
  }
  return null;
}

export function planExcelActivityImport(
  rows: readonly (readonly unknown[])[],
  mode: ImportMode,
  existingGroups: readonly ExistingImportGroup[],
): { rows: ImportRow[]; groups: ImportGroup[]; counts: { activities: number; rejected: number } } {
  const result: ImportRow[] = [];
  const groups: ImportGroup[] = [];
  const header = rows[0] ?? [];
  const typeColumn = header.findIndex(cell => String(cell ?? "").trim() === "النوع");
  let currentGroup: number | null = null;

  for (let index = 1; index < rows.length; index++) {
    const row = rows[index] ?? [];
    if (row.every(cell => cell === null || cell === undefined || String(cell).trim() === "")) continue;
    const rowNumber = index + 1;
    const name = String(row[0] ?? "").trim();
    const startRaw = String(row[1] ?? "").trim();
    const endRaw = String(row[2] ?? "").trim();
    const explicitType = mode === "detect" && typeColumn >= 0
      ? String(row[typeColumn] ?? "").trim() : "";
    const otherFields = row.some((cell, column) =>
      column > 2 && column !== typeColumn && cell !== null && cell !== undefined && String(cell).trim() !== "");

    const reject = (error: string, resetGroup = false) => {
      result.push({ rowNumber, kind: "error", name, groupRow: mode === "detect" ? currentGroup : null, error });
      if (resetGroup) currentGroup = null;
    };

    if (explicitType && explicitType !== "مجموعة" && explicitType !== "نشاط") {
      reject(`صف ${rowNumber}: النوع يجب أن يكون مجموعة أو نشاط`, true);
      continue;
    }
    if (!name) {
      reject(`صف ${rowNumber}: اسم البند مطلوب`);
      continue;
    }

    if (mode === "detect" && (explicitType === "مجموعة" || (!explicitType && !startRaw && !endRaw && !otherFields))) {
      if (startRaw || endRaw || otherFields) {
        reject(`صف ${rowNumber}: صف المجموعة يجب أن يحتوي اسماً فقط دون تواريخ أو بيانات نشاط`, true);
        continue;
      }
      currentGroup = rowNumber;
      groups.push({
        rowNumber,
        name,
        matches: existingGroups.filter(group => normalizeImportGroupName(group.name) === normalizeImportGroupName(name)),
      });
      result.push({ rowNumber, kind: "group", name });
      continue;
    }

    if (!startRaw || !endRaw) {
      reject(!startRaw
        ? `صف ${rowNumber}: تاريخ البداية مطلوب${mode === "detect" ? "؛ صف ملتبس، لم يُنشأ كمجموعة" : ""}`
        : `صف ${rowNumber}: تاريخ النهاية مطلوب${mode === "detect" ? "؛ صف ملتبس، لم يُنشأ كمجموعة" : ""}`,
        mode === "detect");
      continue;
    }
    const plannedStartDate = parseExcelImportDate(startRaw);
    const plannedEndDate = parseExcelImportDate(endRaw);
    if (!plannedStartDate) {
      reject(`صف ${rowNumber}: تاريخ البداية غير صالح (${startRaw})`);
      continue;
    }
    if (!plannedEndDate) {
      reject(`صف ${rowNumber}: تاريخ النهاية غير صالح (${endRaw})`);
      continue;
    }
    if (plannedEndDate < plannedStartDate) {
      reject(`صف ${rowNumber}: تاريخ النهاية يجب أن يكون بعد تاريخ البداية`);
      continue;
    }
    result.push({
      rowNumber, kind: "activity", name, plannedStartDate, plannedEndDate,
      groupRow: mode === "detect" ? currentGroup : null,
    });
  }
  return {
    rows: result,
    groups,
    counts: {
      activities: result.filter(row => row.kind === "activity").length,
      rejected: result.filter(row => row.kind === "error").length,
    },
  };
}