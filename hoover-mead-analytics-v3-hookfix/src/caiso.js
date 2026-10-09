const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');

const PRIMARY_BASE = 'http://oasis.caiso.com/oasisapi/SingleZip';
const LEGACY_BASE = 'http://oasis.caiso.com/mrtu-oasis/SingleZip';

const ERROR_CODES = {
  '1000': 'No data returned for the specified selection (data may not be published yet).',
  '1001': 'Invalid parameters for the given report name.',
  '1002': 'Invalid date format.',
  '1003': 'Timed out waiting for query response.',
  '1004': 'Data can be requested for a period of 31 days only.',
  '1005': 'Report name does not exist.',
  '1014': 'Start date is beyond the allowed limit.',
  '1016': 'Invalid GROUPID.'
};

function httpGet(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects from CAISO'));
      return;
    }
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).toString();
        httpGet(nextUrl, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode} from CAISO`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function buildUrl(base, startDateStr, endDateStrExclusive, nodeId) {
  // endDateStrExclusive must be the day AFTER the last desired day — the 07:00-07:00 GMT
  // window is a true 24hr-per-day span, so requesting N days of data requires
  // enddatetime = startdatetime + N days, not startdatetime + 1 regardless of range size.
  const start = `${startDateStr}T07:00-0000`;
  const end = `${endDateStrExclusive}T07:00-0000`;

  const params = new URLSearchParams({
    resultformat: '6',
    queryname: 'PRC_LMP',
    version: '12',
    startdatetime: start,
    enddatetime: end,
    market_run_id: 'DAM',
    node: nodeId
  });
  return `${base}?${params.toString()}`;
}

function extractCsvFromZip(buffer) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const csvEntry = entries.find(e => e.entryName.toLowerCase().endsWith('.csv'));
  if (!csvEntry) {
    if (entries.length > 0) {
      const text = entries[0].getData().toString('utf8');
      const errMatch = text.match(/<ERR_CODE>(\d+)<\/ERR_CODE>/);
      if (errMatch) {
        const code = errMatch[1];
        throw new Error(`CAISO error ${code}: ${ERROR_CODES[code] || 'Unknown error'}`);
      }
      throw new Error('No CSV found in response. Raw content: ' + text.slice(0, 300));
    }
    throw new Error('Empty zip response from CAISO');
  }
  return csvEntry.getData().toString('utf8');
}

// Parses a multi-day PRC_LMP CSV into a map of dateStr(YYYYMMDD) -> {date, hours}
function parseCaisoCsvMultiDay(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV from CAISO has no data rows');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  const hrIdx = headers.indexOf('OPR_HR');
  const itemIdx = headers.indexOf('XML_DATA_ITEM');
  const mwIdx = headers.indexOf('MW');
  const dateIdx = headers.indexOf('OPR_DT'); // format M/D/YYYY (no leading zeros), e.g. "9/7/2026"
  if (hrIdx === -1 || itemIdx === -1 || mwIdx === -1 || dateIdx === -1) {
    throw new Error('Unexpected CAISO CSV format — headers: ' + headers.join(', '));
  }

  // CAISO has been observed returning OPR_DT in two different formats depending on
  // the query (M/D/YYYY e.g. "9/7/2026", or YYYY-MM-DD e.g. "2026-09-08"). Handle both.
  function normalizeDate(oprDate) {
    if (oprDate.indexOf('-') !== -1) {
      const parts = oprDate.split('-');
      if (parts.length !== 3) return null;
      const y = parts[0], m = parts[1].padStart(2,'0'), d = parts[2].padStart(2,'0');
      return { sortKey: `${y}-${m}-${d}`, display: `${m}/${d}/${y}` };
    }
    if (oprDate.indexOf('/') !== -1) {
      const parts = oprDate.split('/');
      if (parts.length !== 3) return null;
      const m = parts[0].padStart(2, '0');
      const d = parts[1].padStart(2, '0');
      const y = parts[2];
      return { sortKey: `${y}-${m}-${d}`, display: `${m}/${d}/${y}` };
    }
    return null;
  }

  const byDate = {}; // sortKey 'YYYY-MM-DD' -> { display, hours: {} }
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
    const item = cells[itemIdx];
    if (item !== 'LMP_PRC') continue;
    const oprDateRaw = cells[dateIdx];
    const norm = normalizeDate(oprDateRaw);
    if (!norm) continue;
    const hr = parseInt(cells[hrIdx], 10);
    const val = parseFloat(cells[mwIdx]);
    if (isNaN(hr) || hr < 1 || hr > 25) continue;
    if (!byDate[norm.sortKey]) byDate[norm.sortKey] = { display: norm.display, hours: {} };
    byDate[norm.sortKey].hours['HE' + String(hr).padStart(2, '0')] = isNaN(val) ? null : val;
  }

  const results = [];
  Object.keys(byDate).sort().forEach(sortKey => {
    results.push({ date: byDate[sortKey].display, hours: byDate[sortKey].hours });
  });
  if (results.length === 0) {
    throw new Error('No LMP_PRC rows found in CAISO response — format may have changed');
  }
  return results;
}

async function fetchCaisoDateRange(startDateStr, endDateStrInclusive, nodeId) {
  // Convert inclusive end date to exclusive (day after) for buildUrl's 24hr-window semantics
  const endDateStrExclusive = dateStrAddDays(endDateStrInclusive, 1);
  const url = buildUrl(PRIMARY_BASE, startDateStr, endDateStrExclusive, nodeId);
  console.log('[CAISO] Requesting:', url);
  const buffer = await httpGet(url);
  const csv = extractCsvFromZip(buffer);
  try {
    const results = parseCaisoCsvMultiDay(csv);
    console.log('[CAISO] Parsed', results.length, 'day(s):', results.map(r => r.date).join(', '));
    return results;
  } catch (e) {
    console.log('[CAISO] Parse failed. Raw CSV (first 2000 chars):', csv.slice(0, 2000));
    throw e;
  }
}

function dateStrAddDays(dateStr, days) {
  const d = new Date(`${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
}

// Splits a date range into chunks of at most 31 days (CAISO's hard limit, error 1004 otherwise),
// fetches each chunk as one request, with a delay between chunks to stay clear of rate limiting.
async function fetchCaisoRangeChunked(startDateStr, endDateStr, nodeId, onChunkDone) {
  const CHUNK_DAYS = 31;
  const allResults = [];
  let chunkStart = startDateStr;
  while (chunkStart <= endDateStr) {
    let chunkEnd = dateStrAddDays(chunkStart, CHUNK_DAYS - 1);
    if (chunkEnd > endDateStr) chunkEnd = endDateStr;

    try {
      const dayResults = await fetchCaisoDateRange(chunkStart, chunkEnd, nodeId);
      dayResults.forEach(d => allResults.push({ ok: true, data: d }));
      if (onChunkDone) onChunkDone({ chunkStart, chunkEnd, ok: true, count: dayResults.length });
    } catch (e) {
      if (onChunkDone) onChunkDone({ chunkStart, chunkEnd, ok: false, error: e.message });
    }

    chunkStart = dateStrAddDays(chunkEnd, 1);
    if (chunkStart <= endDateStr) {
      await new Promise(r => setTimeout(r, 4000)); // gap between chunk requests
    }
  }
  return allResults;
}

module.exports = { fetchCaisoDateRange, fetchCaisoRangeChunked, dateStrAddDays };