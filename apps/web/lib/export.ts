import type { AdRecord } from "./types";
import { download } from "./utils";
export async function exportRecordsCsv(records: AdRecord[]) {
  const [{ default: Papa }, { csvSafe }] = await Promise.all([
    import("papaparse"),
    import("../../../packages/core/src/index"),
  ]);
  const rows = records.map(({ raw, creative, breakdown, metrics, ...record }) =>
    Object.fromEntries(
      Object.entries({
        ...record,
        ...breakdown,
        ...metrics,
        ...Object.fromEntries(
          Object.entries(creative ?? {}).map(([k, v]) => [`creative_${k}`, v]),
        ),
      }).map(([k, v]) => [k, csvSafe(v)]),
    ),
  );
  download(
    Papa.unparse(rows, {
      columns: [...new Set(rows.flatMap((row) => Object.keys(row)))],
    }),
    "meta-observations.csv",
    "text/csv;charset=utf-8",
  );
}
