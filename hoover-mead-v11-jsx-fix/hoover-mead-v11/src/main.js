const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('./db');
const { fetchCaisoDateRange, fetchCaisoRangeChunked, dateStrAddDays } = require('./caiso');

const CONFIG_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

let mainWindow;
let db = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch (e) {
    console.error('Config load failed:', e);
  }
  return {};
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

async function initDbAt(dbPath) {
  if (db) db.close();
  db = new Database(dbPath);
  await db.whenReady();
  return db;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC Handlers ----

ipcMain.handle('config:get', () => loadConfig());

ipcMain.handle('config:pickDbPath', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Choose database file location (can be a network path)',
    defaultPath: 'mead_prices.db',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['createDirectory']
  });
  if (result.canceled || !result.filePath) return null;
  const cfg = loadConfig();
  cfg.dbPath = result.filePath;
  saveConfig(cfg);
  await initDbAt(cfg.dbPath);
  return cfg.dbPath;
});

ipcMain.handle('db:init', async () => {
  const cfg = loadConfig();
  if (!cfg.dbPath) return { ok: false, error: 'No DB path configured' };
  try {
    if (!db) await initDbAt(cfg.dbPath);
    return { ok: true, path: cfg.dbPath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db:getAllDays', () => {
  if (!db) return [];
  return db.getAllDays();
});

ipcMain.handle('db:upsertDay', (event, record, overwrite) => {
  if (!db) throw new Error('DB not initialized');
  return db.upsertDay(record, overwrite);
});

ipcMain.handle('db:checkExists', (event, dateKey) => {
  if (!db) return false;
  return db.dayExists(dateKey);
});

ipcMain.handle('file:readCsv', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf8');
});

ipcMain.handle('caiso:fetchDay', async (event, dateStr, nodeId) => {
  try {
    // fetchCaisoDateRange takes an inclusive end date and handles the GMT-window
    // conversion internally — pass dateStr for both start and end for a single day.
    const results = await fetchCaisoDateRange(dateStr, dateStr, nodeId);
    if (results.length === 0) {
      return { ok: false, error: 'No data returned for this date' };
    }
    const requested = dateStr.slice(0,4)+'-'+dateStr.slice(4,6)+'-'+dateStr.slice(6,8);
    const matching = results.find(r => { const p=r.date.split('/'); return p[2]+'-'+p[0].padStart(2,'0')+'-'+p[1].padStart(2,'0') === requested; });
    if (!matching) return {ok:false,error:'CAISO returned no prices for the requested operating date '+requested};
    return { ok: true, data: matching };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('caiso:fetchRange', async (event, startDateStr, endDateStr, nodeId) => {
  const dayResults = await fetchCaisoRangeChunked(startDateStr, endDateStr, nodeId, (progress) => {
    mainWindow.webContents.send('caiso:fetchProgress', progress);
  });
  return dayResults; // array of { ok: true, data: {date, hours} } for each day found across all chunks
});