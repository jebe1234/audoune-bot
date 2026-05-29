const SHEET_NAME = 'Sheet1';
const SHARED_SECRET = 'change-this-secret';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    if (SHARED_SECRET && body.secret !== SHARED_SECRET) {
      return json({ ok: false, error: 'unauthorized' });
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return json({ ok: false, error: 'sheet not found' });

    ensureHeader(sheet);

    const row = [
      body.profile_name || '',
      body.client_name || body.name || '',
      body.address || '',
      body.phone || '',
      body.status || '',
      body.wilaya || '',
      body.messenger_id || '',
      body.product || 'Great-Ears G19S',
      body.summary || '',
      body.language || '',
      body.last_message || '',
      body.created_at || new Date().toISOString(),
      body.source || 'messenger',
    ];

    const existingRow = findExistingLeadRow(sheet, body.phone, body.messenger_id);
    if (existingRow) {
      const oldValues = sheet.getRange(existingRow, 1, 1, row.length).getValues()[0];
      const merged = row.map((value, index) => value || oldValues[index] || '');
      merged[0] = body.created_at || new Date().toISOString();
      sheet.getRange(existingRow, 1, 1, merged.length).setValues([merged]);
      return json({ ok: true, action: 'updated', row: existingRow });
    }

    sheet.appendRow(row);
    return json({ ok: true, action: 'inserted' });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function ensureHeader(sheet) {
  const headers = [
    'profile_name',
    'client_name',
    'address',
    'phone',
    'status',
    'wilaya',
    'messenger_id',
    'product',
    'summary',
    'language',
    'last_message',
    'date',
    'source',
  ];
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  if (current[0] !== 'profile_name') sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
}

function findExistingLeadRow(sheet, phone, messengerId) {
  if (!phone && !messengerId) return null;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  for (let i = 0; i < values.length; i += 1) {
    const rowPhone = String(values[i][3] || '');
    const rowMessengerId = String(values[i][6] || '');
    if ((phone && rowPhone === phone) || (messengerId && rowMessengerId === messengerId)) {
      return i + 2;
    }
  }
  return null;
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
