export type ErrebotPdfTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
};

const ROW_TOLERANCE = 1.5;
const COLUMN_GAP = 12;

type Row = {
  y: number;
  items: ErrebotPdfTextItem[];
};

const cleanItemText = (value: string) =>
  value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const reconstructErrebotPdfRows = (
  sourceItems: ErrebotPdfTextItem[],
) => {
  const items = sourceItems
    .map((item) => ({
      ...item,
      text: cleanItemText(item.text),
      width: Math.max(0, item.width),
    }))
    .filter((item) => item.text)
    .sort((left, right) => right.y - left.y || left.x - right.x);

  const rows: Row[] = [];
  for (const item of items) {
    const current = rows.at(-1);
    if (!current || Math.abs(current.y - item.y) > ROW_TOLERANCE) {
      rows.push({ y: item.y, items: [item] });
    } else {
      current.items.push(item);
    }
  }

  return rows
    .map((row) => {
      const rowItems = [...row.items].sort((left, right) => left.x - right.x);
      let output = "";
      let previousEnd: number | null = null;

      for (const item of rowItems) {
        if (previousEnd === null) {
          output = item.text;
        } else {
          const gap = item.x - previousEnd;
          output += `${gap > COLUMN_GAP ? "\t" : " "}${item.text}`;
        }
        previousEnd = item.x + item.width;
      }
      return output.trim();
    })
    .filter(Boolean)
    .join("\n");
};
