import initSqlJs from 'sql.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ARRAY_TABLES = {
  users: {
    table: 'users',
    columns: ['id', 'name', 'password', 'role', 'permissions', 'status'],
    defaults: {
      password: '123456',
      role: '普通用户',
      permissions: [],
      status: 'approved'
    },
    jsonColumns: ['permissions']
  },
  sessions: {
    table: 'sessions',
    columns: ['id', 'userId', 'userName', 'deviceId', 'token', 'userAgent', 'createdAt', 'lastSeenAt'],
    defaults: {
      userAgent: '',
      createdAt: () => new Date().toISOString(),
      lastSeenAt: () => new Date().toISOString()
    }
  },
  suppliers: {
    table: 'suppliers',
    columns: ['id', 'name', 'shortName', 'hasAnnualFrame', 'remark', 'termDays'],
    defaults: {
      shortName: '',
      hasAnnualFrame: '',
      remark: '',
      termDays: 30
    },
    numberColumns: ['termDays']
  },
  owners: {
    table: 'owners',
    columns: ['id', 'owner', 'supplier', 'email'],
    defaults: {
      email: ''
    }
  },
  invoices: {
    table: 'invoices',
    columns: [
      'id',
      'invoiceNo',
      'supplier',
      'owner',
      'amount',
      'issueDate',
      'dueDate',
      'status',
      'originalName',
      'fileName',
      'mimeType',
      'uploadedBy',
      'oaProcessNo',
      'isOaPrinted',
      'isPaid'
    ],
    defaults: {
      invoiceNo: '',
      supplier: '',
      owner: '',
      amount: 0,
      issueDate: '',
      dueDate: '',
      status: '',
      originalName: '',
      fileName: '',
      mimeType: '',
      uploadedBy: '',
      oaProcessNo: '',
      isOaPrinted: '',
      isPaid: ''
    },
    numberColumns: ['amount']
  },
  drafts: {
    table: 'drafts',
    columns: [
      'id',
      'invoiceNo',
      'supplier',
      'owner',
      'amount',
      'issueDate',
      'dueDate',
      'status',
      'originalName',
      'fileName',
      'mimeType',
      'uploadedBy',
      'extra'
    ],
    defaults: {
      invoiceNo: '',
      supplier: '',
      owner: '',
      amount: 0,
      issueDate: '',
      dueDate: '',
      status: '草稿',
      originalName: '',
      fileName: '',
      mimeType: '',
      uploadedBy: '',
      extra: {}
    },
    numberColumns: ['amount'],
    jsonColumns: ['extra'],
    extraColumn: 'extra'
  },
  reminders: {
    table: 'reminders',
    columns: ['id', 'createdAt', 'type', 'target', 'content'],
    defaults: {
      createdAt: () => new Date().toISOString(),
      type: '',
      target: '',
      content: ''
    }
  }
};

const CREATE_TABLE_SQL = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL DEFAULT '123456',
    role TEXT NOT NULL DEFAULT '普通用户',
    permissions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'approved'
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    userName TEXT NOT NULL,
    deviceId TEXT NOT NULL,
    token TEXT NOT NULL,
    userAgent TEXT DEFAULT '',
    createdAt TEXT NOT NULL,
    lastSeenAt TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    shortName TEXT DEFAULT '',
    hasAnnualFrame TEXT DEFAULT '',
    remark TEXT DEFAULT '',
    termDays INTEGER DEFAULT 30
  )`,
  `CREATE TABLE IF NOT EXISTS owners (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    supplier TEXT NOT NULL,
    email TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    invoiceNo TEXT DEFAULT '',
    supplier TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    issueDate TEXT DEFAULT '',
    dueDate TEXT DEFAULT '',
    status TEXT DEFAULT '',
    originalName TEXT DEFAULT '',
    fileName TEXT DEFAULT '',
    mimeType TEXT DEFAULT '',
    uploadedBy TEXT DEFAULT '',
    oaProcessNo TEXT DEFAULT '',
    isOaPrinted TEXT DEFAULT '',
    isPaid TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY,
    invoiceNo TEXT DEFAULT '',
    supplier TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    issueDate TEXT DEFAULT '',
    dueDate TEXT DEFAULT '',
    status TEXT DEFAULT '草稿',
    originalName TEXT DEFAULT '',
    fileName TEXT DEFAULT '',
    mimeType TEXT DEFAULT '',
    uploadedBy TEXT DEFAULT '',
    extra TEXT DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS quality_inspection (
    id TEXT PRIMARY KEY DEFAULT 'default',
    initial_data TEXT NOT NULL DEFAULT '{"sheetName":"","columns":[],"rows":[],"updatedAt":""}',
    notices TEXT NOT NULL DEFAULT '{"rows":[],"submittedAt":"","submittedBy":""}'
  )`,
  `CREATE TABLE IF NOT EXISTS kcfx_records (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS kcfx_meta (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  )`
];

export async function initDb(dataDir) {
  const resolvedDataDir = path.resolve(dataDir);
  const sqlitePath = path.join(resolvedDataDir, 'supply.db');
  const jsonPath = path.join(resolvedDataDir, 'db.json');
  await mkdir(resolvedDataDir, { recursive: true });

  const SQL = await initSqlJs();
  const sqliteExists = await fileExists(sqlitePath);
  const database = sqliteExists
    ? new SQL.Database(await readFile(sqlitePath))
    : new SQL.Database();

  createSchema(database);
  if (!sqliteExists && await fileExists(jsonPath)) {
    const legacyDb = JSON.parse(await readFile(jsonPath, 'utf8'));
    migrateJson(database, legacyDb);
    await saveDatabase(database, sqlitePath);
    await backupJson(jsonPath);
  } else {
    ensureQualityInspectionRow(database);
  }

  const context = { database, sqlitePath, arrayStores: [] };
  const db = {
    save: async () => {
      flushArrayStores(context);
      await saveDatabase(database, sqlitePath);
    }
  };

  for (const [name, config] of Object.entries(ARRAY_TABLES)) {
    db[name] = createArrayProxy(context, config);
  }
  db.settings = createSettingsProxy(context);
  db.qualityInspection = createQualityInspectionProxy(context);
  db.kcfxLibrary = createKcfxLibraryProxy(context);

  return db;
}

function createSchema(database) {
  database.run(CREATE_TABLE_SQL.join(';\n'));
  ensureQualityInspectionRow(database);
}

function ensureQualityInspectionRow(database) {
  database.run(
    `INSERT OR IGNORE INTO quality_inspection (id, initial_data, notices) VALUES (?, ?, ?)`,
    [
      'default',
      JSON.stringify({ sheetName: '', columns: [], rows: [], updatedAt: '' }),
      JSON.stringify({ rows: [], submittedAt: '', submittedBy: '' })
    ]
  );
}

function migrateJson(database, legacyDb = {}) {
  database.run('BEGIN TRANSACTION');
  try {
    for (const [name, config] of Object.entries(ARRAY_TABLES)) {
      const rows = Array.isArray(legacyDb[name]) ? legacyDb[name] : [];
      for (const row of rows) {
        upsertArrayRow(database, config, normalizeArrayItem(config, row));
      }
    }

    for (const [key, value] of Object.entries(legacyDb.settings || {})) {
      setKeyValue(database, 'settings', key, value);
    }

    upsertQualityInspection(database, {
      initialData: legacyDb.qualityInspection?.initialData,
      notices: legacyDb.qualityInspection?.notices
    });

    const kcfxLibrary = legacyDb.kcfxLibrary || {};
    for (const [id, record] of Object.entries(kcfxLibrary.records || {})) {
      setKcfxRecord(database, id, record);
    }
    setKeyValue(database, 'kcfx_meta', 'schemaVersion', kcfxLibrary.schemaVersion ?? 1);
    setKeyValue(database, 'kcfx_meta', 'project', kcfxLibrary.project ?? 'kcfx');
    setKeyValue(database, 'kcfx_meta', 'savedAt', kcfxLibrary.savedAt ?? '');

    database.run('COMMIT');
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

async function backupJson(jsonPath) {
  const backupPath = `${jsonPath}.bak`;
  if (await fileExists(backupPath)) return;
  await rename(jsonPath, backupPath);
}

function createArrayProxy(context, config) {
  const cache = loadArrayRows(context.database, config);
  context.arrayStores.push({ config, cache });
  const mutatingMethods = new Set(['push', 'splice', 'remove', 'update']);
  const readonlyMethods = new Set(['find', 'filter', 'map', 'some', 'findIndex', 'forEach', 'reduce', 'slice']);

  return new Proxy(cache, {
    get(target, prop) {
      if (prop === 'remove') {
        return (fn) => {
          const index = target.findIndex(fn);
          if (index < 0) return undefined;
          const [removed] = target.splice(index, 1);
          deleteArrayRow(context.database, config, removed.id);
          return removed;
        };
      }
      if (prop === 'update') {
        return (item) => {
          const normalized = normalizeArrayItem(config, item);
          const index = target.findIndex((row) => row.id === normalized.id);
          if (index >= 0) target[index] = normalized;
          else target.push(normalized);
          upsertArrayRow(context.database, config, normalized);
          return normalized;
        };
      }
      if (prop === 'push') {
        return (...items) => {
          for (const item of items) {
            const normalized = normalizeArrayItem(config, item);
            target.push(normalized);
            upsertArrayRow(context.database, config, normalized);
          }
          return target.length;
        };
      }
      if (prop === 'splice') {
        return (start, deleteCount, ...items) => {
          const normalizedItems = items.map((item) => normalizeArrayItem(config, item));
          const removed = deleteCount === undefined && !normalizedItems.length
            ? target.splice(start)
            : target.splice(start, deleteCount, ...normalizedItems);
          for (const item of removed) deleteArrayRow(context.database, config, item.id);
          for (const item of normalizedItems) upsertArrayRow(context.database, config, item);
          return removed;
        };
      }
      if (readonlyMethods.has(prop)) return target[prop].bind(target);
      if (mutatingMethods.has(prop)) return target[prop];
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      if (isArrayIndex(prop)) {
        upsertArrayRow(context.database, config, normalizeArrayItem(config, value));
      }
      return true;
    }
  });
}

function flushArrayStores(context) {
  context.database.run('BEGIN TRANSACTION');
  try {
    for (const { config, cache } of context.arrayStores) {
      context.database.run(`DELETE FROM ${config.table}`);
      for (const item of cache) {
        upsertArrayRow(context.database, config, item);
      }
    }
    context.database.run('COMMIT');
  } catch (error) {
    context.database.run('ROLLBACK');
    throw error;
  }
}

function loadArrayRows(database, config) {
  return selectAll(database, `SELECT * FROM ${config.table}`).map((row) => parseArrayRow(config, row));
}

function normalizeArrayItem(config, item = {}) {
  const row = { ...item };
  row.id = String(row.id || randomUUID());

  if (config.extraColumn) {
    const known = new Set(config.columns);
    const existingExtra = parseJson(row[config.extraColumn], {});
    const extra = { ...existingExtra };
    for (const key of Object.keys(row)) {
      if (!known.has(key)) {
        extra[key] = row[key];
        delete row[key];
      }
    }
    row[config.extraColumn] = extra;
  }

  for (const [key, defaultValue] of Object.entries(config.defaults || {})) {
    if (row[key] === undefined || row[key] === null) {
      row[key] = typeof defaultValue === 'function' ? defaultValue() : cloneJson(defaultValue);
    }
  }
  for (const column of config.columns) {
    if (row[column] === undefined || row[column] === null) row[column] = '';
  }
  for (const column of config.numberColumns || []) {
    row[column] = Number(row[column]) || 0;
  }
  return row;
}

function parseArrayRow(config, row) {
  const parsed = { ...row };
  for (const column of config.jsonColumns || []) {
    parsed[column] = parseJson(parsed[column], column === 'permissions' ? [] : {});
  }
  if (config.extraColumn) {
    const extra = parseJson(parsed[config.extraColumn], {});
    delete parsed[config.extraColumn];
    return { ...parsed, ...extra };
  }
  return parsed;
}

function upsertArrayRow(database, config, item) {
  const row = normalizeArrayItem(config, item);
  const columns = config.columns;
  const placeholders = columns.map(() => '?').join(', ');
  const updates = columns.filter((column) => column !== 'id').map((column) => `${column}=excluded.${column}`).join(', ');
  const values = columns.map((column) => serializeColumn(config, column, row[column]));
  database.run(
    `INSERT INTO ${config.table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`,
    values
  );
}

function deleteArrayRow(database, config, id) {
  database.run(`DELETE FROM ${config.table} WHERE id = ?`, [id]);
}

function serializeColumn(config, column, value) {
  if ((config.jsonColumns || []).includes(column)) return JSON.stringify(value ?? (column === 'permissions' ? [] : {}));
  return value ?? '';
}

function createSettingsProxy(context) {
  const cache = Object.fromEntries(selectAll(context.database, 'SELECT key, value FROM settings').map((row) => [row.key, row.value]));
  return new Proxy(cache, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      return target[prop] ?? '';
    },
    set(target, prop, value) {
      if (typeof prop !== 'string') return false;
      target[prop] = value;
      setKeyValue(context.database, 'settings', prop, value);
      return true;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      return { enumerable: true, configurable: true, value: target[prop] };
    }
  });
}

function createQualityInspectionProxy(context) {
  const row = selectOne(context.database, `SELECT * FROM quality_inspection WHERE id = ?`, ['default']) || {};
  const cache = {
    initialData: parseJson(row.initial_data, { sheetName: '', columns: [], rows: [], updatedAt: '' }),
    notices: parseJson(row.notices, { rows: [], submittedAt: '', submittedBy: '' })
  };
  const save = () => upsertQualityInspection(context.database, cache);
  return new Proxy(cache, {
    get(target, prop) {
      if (prop === 'initialData' || prop === 'notices') return createDeepJsonProxy(target[prop], save);
      return target[prop];
    },
    set(target, prop, value) {
      target[prop] = value;
      save();
      return true;
    }
  });
}

function upsertQualityInspection(database, value = {}) {
  const initialData = value.initialData || { sheetName: '', columns: [], rows: [], updatedAt: '' };
  const notices = value.notices || { rows: [], submittedAt: '', submittedBy: '' };
  database.run(
    `INSERT INTO quality_inspection (id, initial_data, notices) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET initial_data=excluded.initial_data, notices=excluded.notices`,
    ['default', JSON.stringify(initialData), JSON.stringify(notices)]
  );
}

function createKcfxLibraryProxy(context) {
  const recordsCache = Object.fromEntries(
    selectAll(context.database, 'SELECT id, data FROM kcfx_records').map((row) => [row.id, parseJson(row.data, {})])
  );
  const metaCache = Object.fromEntries(selectAll(context.database, 'SELECT key, value FROM kcfx_meta').map((row) => [row.key, row.value]));
  if (!metaCache.schemaVersion) metaCache.schemaVersion = '1';
  if (!metaCache.project) metaCache.project = 'kcfx';
  if (!metaCache.savedAt) metaCache.savedAt = '';

  const records = new Proxy(recordsCache, {
    get(target, prop) {
      if (typeof prop !== 'string') return target[prop];
      const value = target[prop];
      if (value && typeof value === 'object') return createDeepJsonProxy(value, () => setKcfxRecord(context.database, prop, value));
      return value;
    },
    set(target, prop, value) {
      if (typeof prop !== 'string') return false;
      target[prop] = value;
      setKcfxRecord(context.database, prop, value);
      return true;
    },
    deleteProperty(target, prop) {
      if (typeof prop !== 'string') return false;
      delete target[prop];
      context.database.run('DELETE FROM kcfx_records WHERE id = ?', [prop]);
      return true;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, prop) {
      return { enumerable: true, configurable: true, value: target[prop] };
    }
  });

  return new Proxy({ records }, {
    get(target, prop) {
      if (prop === 'records') return records;
      if (prop === 'schemaVersion') return Number(metaCache.schemaVersion || 1);
      if (prop === 'project') return metaCache.project || 'kcfx';
      if (prop === 'savedAt') return metaCache.savedAt || '';
      return target[prop];
    },
    set(target, prop, value) {
      if (prop === 'records') return false;
      metaCache[prop] = value;
      setKeyValue(context.database, 'kcfx_meta', prop, value);
      return true;
    }
  });
}

function setKcfxRecord(database, id, value) {
  database.run(
    `INSERT INTO kcfx_records (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
    [id, JSON.stringify(value ?? {})]
  );
}

function createDeepJsonProxy(value, onChange, seen = new WeakMap()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const proxy = new Proxy(value, {
    get(target, prop) {
      const next = target[prop];
      return next && typeof next === 'object' ? createDeepJsonProxy(next, onChange, seen) : next;
    },
    set(target, prop, next) {
      target[prop] = next;
      onChange();
      return true;
    },
    deleteProperty(target, prop) {
      delete target[prop];
      onChange();
      return true;
    }
  });
  seen.set(value, proxy);
  return proxy;
}

function setKeyValue(database, table, key, value) {
  database.run(
    `INSERT INTO ${table} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
    [key, serializeValue(value)]
  );
}

function selectAll(database, sql, params = []) {
  const statement = database.prepare(sql, params);
  const rows = [];
  try {
    while (statement.step()) rows.push(statement.getAsObject());
  } finally {
    statement.free();
  }
  return rows;
}

function selectOne(database, sql, params = []) {
  return selectAll(database, sql, params)[0] || null;
}

function parseJson(value, fallback) {
  if (value && typeof value === 'object') return cloneJson(value);
  try {
    return JSON.parse(value || '');
  } catch {
    return cloneJson(fallback);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function serializeValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isArrayIndex(prop) {
  if (typeof prop === 'symbol') return false;
  const value = Number(prop);
  return Number.isInteger(value) && value >= 0 && String(value) === String(prop);
}

async function saveDatabase(database, sqlitePath) {
  await mkdir(path.dirname(sqlitePath), { recursive: true });
  await writeFile(sqlitePath, Buffer.from(database.export()));
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
