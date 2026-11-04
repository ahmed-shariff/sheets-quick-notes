const MAX_ID_LENGTH = 128;
function bootstrap() {
  const props = PropertiesService.getUserProperties();
  let namespace = props.getProperty('sheetnote_namespace');
  if (!namespace) { namespace = Utilities.getUuid(); props.setProperty('sheetnote_namespace', namespace); }
  return { namespace: namespace };
}
const MAX_TAB_NAME_LENGTH = 100;
function validId_(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('Invalid spreadsheet ID.'); return value; }
function getSpreadsheet(id) {
  id = validId_(id); const ss = SpreadsheetApp.openById(id);
  return { id: ss.getId(), title: ss.getName(), tabs: ss.getSheets().map(s => ({ id: s.getSheetId(), title: s.getName() })) };
}
function readTable(id, tabId) {
  const sheet = sheet_(id, tabId), width = sheet.getLastColumn();
  if (!width) throw new Error('Headers must be nonblank and unique, with exactly one Timestamp.');
  const headers = sheet.getRange(1, 1, 1, width).getDisplayValues()[0];
  validateHeaders_(headers);
  const count = Math.max(0, Math.min(sheet.getLastRow() - 1, 1000));
  const rows = count ? sheet.getRange(2, 1, count, width).getDisplayValues() : [];
  return { headers, rows };
}
function appendEntry(id, tabId, expectedHeaders, values) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('Another save is in progress. Try again.');
  try {
  const sheet = sheet_(id, tabId);
  if (!Array.isArray(expectedHeaders) || expectedHeaders.length > 100 || !Array.isArray(values) || values.length !== expectedHeaders.length) throw new Error('Invalid entry data.');
  expectedHeaders.forEach(v => { if (typeof v !== 'string' || v.length > 500) throw new Error('Invalid headers.'); });
  values.forEach(v => { if (typeof v !== 'string' || v.length > 10000) throw new Error('Entry values must be text of at most 10000 characters.'); });
  const width = sheet.getLastColumn(), actual = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0] : [];
  validateHeaders_(actual);
  if (JSON.stringify(actual) !== JSON.stringify(expectedHeaders)) throw new Error('Sheet headers changed. Refresh before saving.');
  const timestamp = actual.findIndex(h => h.trim().toLowerCase() === 'timestamp');
  const row = values.map((v, i) => i === timestamp ? new Date().toISOString() : v);
    // Prefix every non-timestamp string; leading whitespace/control characters and apostrophes cannot bypass this text-entry escape.
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row.map((v, i) => i !== timestamp ? "'" + v : v)]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function sheet_(id, tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Invalid tab ID.');
  const sheet = SpreadsheetApp.openById(validId_(id)).getSheets().find(s => s.getSheetId() === tabId);
  if (!sheet) throw new Error('Tab not found.'); return sheet;
}
function validateHeaders_(h) {
  if (!h.length || h.length > 100 || h.some(x => !x.trim()) || new Set(h.map(x => x.trim().toLowerCase())).size !== h.length || h.filter(x => x.trim().toLowerCase() === 'timestamp').length !== 1) throw new Error('Headers must be nonblank and unique, with exactly one Timestamp.');
}
function doGet() { return HtmlService.createTemplateFromFile('Index').evaluate().setTitle('Sheetnote'); }
