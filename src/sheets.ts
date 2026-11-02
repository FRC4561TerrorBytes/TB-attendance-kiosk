import { google } from "googleapis"; 
import { parse as csvParse } from "csv-parse/sync"; 

async function getSheetsClient() { 
  const sheetId = process.env.GOOGLE_SHEET_ID; 
  const creds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON; 

  if (!sheetId) throw new Error("GOOGLE_SHEET_ID environment variable is not set"); 
  if (!creds) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON environment variable is not set"); 

  let credentials;
  try {
    credentials = JSON.parse(creds);
  } catch (err) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: " + String(err));
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key"
    );
  }

  // Handle escaped newline characters safely in the private key
  credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth }); 

  return { sheets, sheetId };
}

async function ensureRawDataSheetExists(sheets: any, sheetId: string) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties.title",
  });
  const sheetsList = metadata.data.sheets || [];
  const rawDataSheet = sheetsList.find((sheet: any) => sheet.properties?.title === "rawData");

  if (!rawDataSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: "rawData",
              },
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: "rawData!A1:D1",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [["First Name", "Last Name", "Date", "Hours"]],
      },
    });
  }
}

function csvToValues(csv: string, stripHeader = false): any[][] {
  try {
    const records = csvParse(csv, { columns: false, skip_empty_lines: true });
    return stripHeader && records.length > 0 ? (records as any[][]).slice(1) : (records as any[][]);
  } catch (err) {
    const rows = csv
      .split("\n")
      .map((r) => r.split(","))
      .filter((row) => row.some((col) => col.trim() !== ""));
    return stripHeader && rows.length > 0 ? rows.slice(1) : rows;
  }
}

function normalizeSheetValue(value: unknown, columnIndex: number): string {
  const text = String(value ?? "").trim();

  if (text === "") return "";

  // Normalize names so minor casing differences don't cause duplicate uploads.
  if (columnIndex === 0 || columnIndex === 1) {
    return text.toLowerCase();
  }

  // Google Sheets may return actual dates as serial numbers when
  // UNFORMATTED_VALUE is requested, while CSV input uses YYYY-MM-DD.
  if (columnIndex === 2) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split("-").map(Number);
      const utcMillis = Date.UTC(year, month - 1, day);
      const parsed = new Date(utcMillis);

      // Only convert valid calendar dates.
      if (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
      ) {
        const serial = utcMillis / 86400000 + 25569;
        return `date:${serial}`;
      }
    }

    const numericDate = Number(text);
    if (Number.isFinite(numericDate)) {
      return `date:${numericDate}`;
    }

    return `date-text:${text}`;
  }

  // Normalize hours such as "1.20" and 1.2 to the same key.
  if (columnIndex === 3) {
    const numericHours = Number(text);
    if (Number.isFinite(numericHours)) {
      return `hours:${numericHours}`;
    }
  }

  return text;
}

function makeAttendanceKey(row: unknown[]): string {
  return [0, 1, 2, 3]
    .map((columnIndex) => normalizeSheetValue(row[columnIndex], columnIndex))
    .join("\x1F");
}

export async function uploadReportsToSheet(
  checkinInput: string | string[][]
) 
{
  const { sheets, sheetId } = await getSheetsClient();
  await ensureRawDataSheetExists(sheets, sheetId);

  if (!checkinInput) return;

  let values: any[][] = [];

  if (typeof checkinInput === "string") {
    if (checkinInput.trim().length === 0) return;
    values = csvToValues(checkinInput, true);
  } else {
    if (checkinInput.length === 0) return;

    const hasHeader =
      checkinInput[0] &&
      String(checkinInput[0][0]).toLowerCase().includes("first");

    values = hasHeader ? checkinInput.slice(1) : checkinInput;
  }

  // Ignore empty rows and require the four expected rawData columns.
  values = values.filter(
    (row) =>
      row.length >= 4 &&
      [0, 1, 2, 3].some(
        (columnIndex) => String(row[columnIndex] ?? "").trim() !== ""
      )
  );

  if (values.length === 0) return;

  // Read existing rawData rows. This lets us locate the checkpoint and
  // provides the complete duplicate-check fallback if it cannot be found.
  const existingResult = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "rawData!A2:D",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const existingRows = existingResult.data.values || [];

  // Locate the last non-empty row returned by Sheets.
  let lastExistingIndex = -1;

  for (let i = existingRows.length - 1; i >= 0; i--) {
    if (
      [0, 1, 2, 3].some(
        (columnIndex) =>
          String(existingRows[i][columnIndex] ?? "").trim() !== ""
      )
    ) {
      lastExistingIndex = i;
      break;
    }
  }

  let candidateRows: any[][] = [];
  let fallbackMode = false;

  if (lastExistingIndex === -1) {
    // The sheet has no attendance records yet: this is the initial sync.
    candidateRows = values;
  } else {
    const checkpointKey = makeAttendanceKey(
      existingRows[lastExistingIndex]
    );

    // Find the last sheet record in the incoming history.
    // Search backwards in case an identical row occurs more than once.
    let checkpointIndex = -1;

    for (let i = values.length - 1; i >= 0; i--) {
      if (makeAttendanceKey(values[i]) === checkpointKey) {
        checkpointIndex = i;
        break;
      }
    }

    if (checkpointIndex !== -1) {
      // Normal incremental path: only process records after the checkpoint.
      candidateRows = values.slice(checkpointIndex + 1);

      console.log(
        `Google Sheets checkpoint found at incoming row ${checkpointIndex + 1}.`
      );
    } else {
      // Safe fallback: never assume the whole incoming history is new.
      // Check it against existing sheet records before appending.
      fallbackMode = true;
      candidateRows = values;

      console.warn(
        "Google Sheets checkpoint was not found in incoming history. " +
        "Using full duplicate checking for this sync."
      );
    }
  }

  const existingKeys = fallbackMode
    ? new Set(existingRows.map((row: any[]) => makeAttendanceKey(row)))
    : new Set<string>();

  // Filter duplicates from the selected batch as well as duplicate rows
  // within that batch. Do not modify existing sheet rows.
  const newValues: any[][] = [];

  for (const row of candidateRows) {
    const key = makeAttendanceKey(row);

    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);
    newValues.push(row.slice(0, 4));
  }

  if (newValues.length === 0) {
    console.log("Google Sheets already contains all attendance data.");
    return;
  }

  // Append only. Never overwrite or clear previously synced attendance.
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "rawData!A1:D",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: newValues,
    },
  });

  console.log(
    `Google Sheets sync complete: ${newValues.length} new rows uploaded` +
    (fallbackMode ? " (fallback duplicate check)." : " (incremental sync).")
  );
}
