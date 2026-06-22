import cors from 'cors';
import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { PDFParse } from 'pdf-parse';
import xlsx from 'xlsx';
import { addDays, format, parseISO } from 'date-fns';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const originalMaintenanceLibraryDir = path.join(dataDir, 'files', 'original', 'maintenance-library');
const kcfxFileDir = originalMaintenanceLibraryDir;
const legacyKcfxFileDir = path.join(dataDir, 'kcfx-files');
const kcfxRecordDir = path.join(dataDir, 'kcfx-records');
const kcfxTrendSummaryPath = path.join(dataDir, 'kcfx-trend-summary.json');
const kcfxReceiptSummaryPath = path.join(dataDir, 'kcfx-receipt-summary.json');
const kcfxTrendWorkerPath = path.join(__dirname, 'kcfx-trend-summary-worker.js');
const dbPath = path.join(dataDir, 'db.json');
const kcfxDir = path.join(rootDir, 'public', 'kcfx');
const serverStartedAt = new Date();

const app = express();
const upload = multer({
  dest: uploadDir,
  limits: {
    fieldSize: 200 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(gzipJsonResponses);

function gzipJsonResponses(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    const acceptsGzip = /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
    if (!acceptsGzip || res.getHeader('Content-Encoding')) {
      return originalJson(payload);
    }

    let body = '';
    try {
      body = JSON.stringify(payload);
    } catch {
      return originalJson(payload);
    }
    if (Buffer.byteLength(body) < 2048) {
      return originalJson(payload);
    }

    gzip(Buffer.from(body), (error, compressed) => {
      if (error) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', Buffer.byteLength(body));
        res.end(body);
        return;
      }
      const vary = String(res.getHeader('Vary') || '');
      if (!vary.toLowerCase().split(',').map((item) => item.trim()).includes('accept-encoding')) {
        res.setHeader('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', compressed.length);
      res.end(compressed);
    });
    return res;
  };
  next();
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'gongyingaixitong', time: new Date().toISOString() });
});

async function readFileMtime(filePath) {
  try {
    return (await stat(filePath)).mtime;
  } catch {
    return null;
  }
}

async function getAppRefreshTime() {
  const distIndexPath = path.join(rootDir, 'dist', 'index.html');
  const mtimes = await Promise.all([
    readFileMtime(distIndexPath),
    readFileMtime(path.join(rootDir, 'package.json')),
    readFileMtime(path.join(rootDir, 'server', 'app.js'))
  ]);
  const validTimes = mtimes.filter(Boolean).map((time) => time.getTime());
  if (!validTimes.length) return serverStartedAt;
  return new Date(Math.max(...validTimes));
}

app.get('/api/app-version', async (req, res) => {
  const refreshedAt = await getAppRefreshTime();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    service: 'gongyingaixitong',
    versionTime: format(refreshedAt, 'yyyy-MM-dd HH:mm'),
    refreshedAt: refreshedAt.toISOString()
  });
});

const SYSTEM_OWNER_NAME = '孙立柱';
const ROLE_ADMIN = '管理员';
const ROLE_FINANCE = '财务';
const ROLE_USER = '普通用户';
const USER_STATUS_APPROVED = 'approved';
const USER_STATUS_PENDING = 'pending';
const SALES_INVENTORY_PERMISSIONS = [
  'salesInventory.receiptSummary',
  'salesInventory.salesAnalysis',
  'salesInventory.comparison',
  'salesInventory.errors'
];
const MAINTENANCE_LIBRARY_PERMISSIONS = [
  'maintenanceLibrary.factLibrary',
  'maintenanceLibrary.salesLibrary',
  'maintenanceLibrary.fileLibrary',
  'maintenanceLibrary.supplierManagement'
];
const SYSTEM_FILE_LIBRARY_PERMISSIONS = [
  'systemFileLibrary.invoiceInventory',
  'systemFileLibrary.migrationPackage',
  'systemFileLibrary.invoiceUploads',
  'systemFileLibrary.salesInventoryFiles'
];
const SYSTEM_FILE_PACKAGES = [
  {
    id: 'migration-package',
    tabPermission: 'systemFileLibrary.migrationPackage',
    label: '迁移备份包',
    fileName: '系统迁移备份包.zip',
    description: '脱敏系统数据、发票原件、销售库存看板静态文件'
  },
  {
    id: 'invoice-uploads',
    tabPermission: 'systemFileLibrary.invoiceUploads',
    label: '发票原件库',
    fileName: '发票原件库.zip',
    description: '已上传发票原文件和发票索引'
  },
  {
    id: 'sales-inventory-files',
    tabPermission: 'systemFileLibrary.salesInventoryFiles',
    label: '销售库存看板文件',
    fileName: '销售库存看板文件.zip',
    description: '销售及库存看板嵌入页面的静态运行文件'
  }
];
const KC_LIBRARY_SLOT_IDS = new Set([
  'dim-product',
  'dim-warehouse',
  'dim-warehouse-material',
  'dim-store-name',
  'dim-customer-material',
  'dim-purchase-division',
  'dim-7',
  'dim-8',
  'fact-inventory',
  'fact-2',
  'fact-3',
  'fact-4',
  'fact-5',
  'fact-6',
  'fact-7',
  'fact-8',
  'sales-data'
]);
const KC_PRIORITY_PRELOAD_SLOT_IDS = new Set([
  'sales-data',
  'dim-product',
  'dim-warehouse',
  'dim-warehouse-material',
  'dim-store-name',
  'dim-customer-material'
]);
const PERMISSION_GROUPS = [
  {
    value: 'salesInventory',
    children: SALES_INVENTORY_PERMISSIONS
  },
  {
    value: 'maintenanceLibrary',
    children: MAINTENANCE_LIBRARY_PERMISSIONS
  },
  {
    value: 'systemFileLibrary',
    children: SYSTEM_FILE_LIBRARY_PERMISSIONS
  },
  {
    value: 'systemManagement',
    children: ['systemManagement.permissionManagement', 'systemManagement.reminders']
  }
];
const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((group) => [group.value, ...group.children]);
const OWNER_PERMISSIONS = [...PERMISSION_KEYS];
const DEFAULT_PERMISSIONS = [];

function expandPermissionKey(permission) {
  if (permission === 'supplierPayment.invoiceInventory' || permission === 'invoiceInventory') return ['systemFileLibrary', 'systemFileLibrary.invoiceInventory'];
  if (permission === 'supplierPayment.supplierManagement' || permission === 'supplierManagement') return ['maintenanceLibrary', 'maintenanceLibrary.supplierManagement'];
  if (permission === 'supplierPayment.reminders') return ['systemManagement', 'systemManagement.reminders'];
  if (permission === 'salesInventory') return ['salesInventory', ...SALES_INVENTORY_PERMISSIONS];
  if (permission === 'maintenanceLibrary') return ['maintenanceLibrary', ...MAINTENANCE_LIBRARY_PERMISSIONS];
  if (permission === 'salesInventory.factLibrary') return ['maintenanceLibrary', 'maintenanceLibrary.factLibrary'];
  if (permission === 'salesInventory.salesLibrary') return ['maintenanceLibrary', 'maintenanceLibrary.salesLibrary'];
  if (permission === 'salesInventory.fileLibrary') return ['maintenanceLibrary', 'maintenanceLibrary.fileLibrary'];
  if (permission === 'systemFileLibrary') return ['systemFileLibrary', ...SYSTEM_FILE_LIBRARY_PERMISSIONS];
  if (permission === 'permissionManagement') return ['systemManagement', 'systemManagement.permissionManagement'];
  if (permission === 'systemManagement') return ['systemManagement', 'systemManagement.permissionManagement', 'systemManagement.reminders'];
  const group = PERMISSION_GROUPS.find((item) => item.children.includes(permission));
  if (group) return [group.value, permission];
  return [permission];
}

function sanitizePermissions(permissions) {
  if (!Array.isArray(permissions)) return [...DEFAULT_PERMISSIONS];
  const expanded = permissions.flatMap(expandPermissionKey);
  return [...new Set(expanded.filter((item) => PERMISSION_KEYS.includes(item)))];
}

function sanitizeAssignablePermissions(permissions) {
  return sanitizePermissions(permissions).filter((item) => item !== 'systemManagement' && !item.startsWith('systemManagement.'));
}

function normalizeUser(user) {
  const name = String(user.name || '').trim();
  const isOwner = name === SYSTEM_OWNER_NAME;
  const role = isOwner ? ROLE_ADMIN : (user.role === ROLE_FINANCE ? ROLE_FINANCE : ROLE_USER);
  const permissions = isOwner ? [...OWNER_PERMISSIONS] : sanitizeAssignablePermissions(user.permissions);
  const status = isOwner || user.status !== USER_STATUS_PENDING ? USER_STATUS_APPROVED : USER_STATUS_PENDING;
  return {
    ...user,
    id: user.id || crypto.randomUUID(),
    name,
    password: String(user.password || '123456'),
    role,
    permissions,
    status
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    permissions: user.permissions || [],
    status: user.status || USER_STATUS_APPROVED
  };
}

function detectMime(buffer) {
  const header = buffer.subarray(0, 8).toString('latin1');
  if (header.startsWith('%PDF')) return 'application/pdf';
  if (header.startsWith('\x89PNG')) return 'image/png';
  if (header.startsWith('\xFF\xD8\xFF')) return 'image/jpeg';
  if (header.startsWith('GIF8')) return 'image/gif';
  if (header.startsWith('RIFF') && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

function zipTimestamp(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const nameBuffer = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || '');
    const { dosTime, dosDate } = zipTimestamp(file.date);
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endHeader = Buffer.alloc(22);
  endHeader.writeUInt32LE(0x06054b50, 0);
  endHeader.writeUInt16LE(0, 4);
  endHeader.writeUInt16LE(0, 6);
  endHeader.writeUInt16LE(files.length, 8);
  endHeader.writeUInt16LE(files.length, 10);
  endHeader.writeUInt32LE(centralSize, 12);
  endHeader.writeUInt32LE(offset, 16);
  endHeader.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, endHeader]);
}

function safeArchiveName(name) {
  return String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

async function collectFiles(baseDir, archivePrefix) {
  const files = [];
  async function walk(currentDir, relativeDir = '') {
    let entries = [];
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile()) {
        const data = await readFile(fullPath);
        const info = await stat(fullPath);
        files.push({
          name: safeArchiveName(path.join(archivePrefix, relativePath)),
          data,
          date: info.mtime
        });
      }
    }
  }
  await walk(baseDir);
  return files;
}

function redactDb(db) {
  return {
    ...db,
    settings: {
      ...(db.settings || {}),
      smtpPassword: db.settings?.smtpPassword ? '[已隐藏]' : ''
    },
    users: (db.users || []).map((user) => ({
      ...user,
      password: user.password ? '[已隐藏]' : ''
    }))
  };
}

function invoiceIndex(db) {
  return (db.invoices || []).map((invoice) => ({
    id: invoice.id,
    supplier: invoice.supplier,
    invoiceNo: invoice.invoiceNo,
    amount: invoice.amount,
    issueDate: invoice.issueDate,
    status: invoice.status,
    owner: invoice.owner,
    uploadedBy: invoice.uploadedBy,
    isOaPrinted: invoice.isOaPrinted,
    isPaid: invoice.isPaid,
    fileName: invoice.fileName,
    originalName: invoice.originalName,
    mimeType: invoice.mimeType
  }));
}

async function packageStats(packageId, db) {
  const files = await buildSystemPackageFiles(packageId, db, false);
  return files.reduce((result, file) => ({
    fileCount: result.fileCount + 1,
    size: result.size + (file.size ?? file.data?.length ?? 0)
  }), { fileCount: 0, size: 0 });
}

async function buildSystemPackageFiles(packageId, db, includeData = true) {
  const files = [];
  const pushJson = (name, value) => {
    const data = Buffer.from(JSON.stringify(value, null, 2), 'utf8');
    files.push(includeData ? { name, data } : { name, size: data.length });
  };
  const pushCollected = async (dir, prefix) => {
    const collected = await collectFiles(dir, prefix);
    files.push(...(includeData ? collected : collected.map((file) => ({ name: file.name, size: file.data.length }))));
  };

  if (packageId === 'migration-package') {
    pushJson('system-data/db.redacted.json', redactDb(db));
    pushJson('system-data/invoice-index.json', invoiceIndex(db));
    await pushCollected(uploadDir, 'invoice-uploads');
    await pushCollected(kcfxFileDir, 'kcfx-uploaded-files');
    await pushCollected(kcfxDir, 'kcfx');
  } else if (packageId === 'invoice-uploads') {
    pushJson('invoice-index.json', invoiceIndex(db));
    await pushCollected(uploadDir, 'invoice-uploads');
  } else if (packageId === 'sales-inventory-files') {
    await pushCollected(kcfxFileDir, 'kcfx-uploaded-files');
    await pushCollected(kcfxDir, 'kcfx');
  }
  return files;
}

async function sendUploadedFile(req, res) {
  const safeName = path.basename(req.params.fileName);
  const filePath = path.join(uploadDir, safeName);
  try {
    const buffer = await readFile(filePath);
    const mimeType = detectMime(buffer);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
    res.send(buffer);
  } catch {
    res.status(404).json({ error: 'file not found' });
  }
}

app.get('/uploads/:fileName', sendUploadedFile);
app.get('/preview/:fileName/:displayName', sendUploadedFile);

async function downloadUploadedFileByQuery(req, res) {
  const safeName = path.basename(String(req.query.fileName || ''));
  const requestedName = path.basename(String(req.query.downloadName || safeName));
  const filePath = path.join(uploadDir, safeName);
  try {
    const buffer = await readFile(filePath);
    const mimeType = detectMime(buffer);
    const asciiFallback = requestedName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || safeName;
    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(requestedName)}`
    );
    res.send(buffer);
  } catch {
    res.status(404).json({ error: 'file not found' });
  }
}

app.get('/download', downloadUploadedFileByQuery);

function normalizeDb(db) {
  db.settings = {
    senderEmail: '',
    smtpPassword: '',
    ...(db.settings || {})
  };
  db.users = (db.users || []).map(normalizeUser);
  if (!db.users.some((user) => user.name === SYSTEM_OWNER_NAME)) {
    db.users.unshift(normalizeUser({
      id: 'u-admin',
      name: SYSTEM_OWNER_NAME,
      password: '521sunlizhu',
      role: ROLE_ADMIN,
      permissions: OWNER_PERMISSIONS
    }));
  }
  db.suppliers = (db.suppliers || []).map((supplier) => ({
    ...supplier,
    shortName: supplier.shortName || supplier.name,
    hasAnnualFrame: supplier.hasAnnualFrame || '',
    remark: supplier.remark || ''
  }));
  db.invoices = (db.invoices || []).map((invoice) => ({
    ...invoice,
    oaProcessNo: invoice.oaProcessNo || '',
    isOaPrinted: invoice.isOaPrinted || (['财务打款', '待财务打款'].includes(invoice.status) ? '是' : ''),
    isPaid: invoice.isPaid || '',
    status: ['财务打款', '待财务打款'].includes(invoice.status) ? '待财务付款' : invoice.status
  }));
  db.owners = (db.owners || []).map((owner) => ({
    ...owner,
    email: owner.email || ''
  }));
  db.qualityInspection = {
    ...(db.qualityInspection || {}),
    initialData: {
      sheetName: '',
      columns: [],
      rows: [],
      updatedAt: '',
      ...(db.qualityInspection?.initialData || {})
    },
    notices: {
      rows: [],
      submittedAt: '',
      submittedBy: '',
      ...(db.qualityInspection?.notices || {})
    }
  };
  db.kcfxLibrary = {
    schemaVersion: 1,
    project: 'kcfx',
    savedAt: '',
    records: {},
    ...(db.kcfxLibrary || {})
  };
  db.kcfxLibrary.records = db.kcfxLibrary.records || {};
  return db;
}

async function ensureDb() {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(kcfxFileDir, { recursive: true });
  await mkdir(kcfxRecordDir, { recursive: true });
  try {
    return normalizeDb(JSON.parse(await readFile(dbPath, 'utf8')));
  } catch {
    const db = {
      settings: {
        senderEmail: '',
        smtpPassword: ''
      },
      users: [
        { id: 'u-admin', name: '孙立柱', password: '521sunlizhu', role: '管理员' },
        { id: 'u-buyer', name: '采购员', password: '123456', role: '普通用户' }
      ],
      suppliers: [
        { id: 's-1', name: '南京伴你行电子商务有限责任公司', termDays: 60 },
        { id: 's-2', name: '浙江迈德斯特医疗器械科技有限公司', termDays: 45 }
      ],
      owners: [
        { id: 'o-1', owner: '孙立柱', supplier: '南京伴你行电子商务有限责任公司' },
        { id: 'o-2', owner: '采购员', supplier: '浙江迈德斯特医疗器械科技有限公司' }
      ],
      drafts: [],
      invoices: [
        {
          id: 'i-1',
          invoiceNo: '26322000004468465801',
          supplier: '南京伴你行电子商务有限责任公司',
          owner: '孙立柱',
          amount: 63196,
          issueDate: '2026-06-03',
          dueDate: '2026-08-02',
          status: '待提交付款申请',
          originalName: '示例发票.png'
        }
      ],
      reminders: [
        {
          id: 'r-1',
          createdAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
          type: '付款申请提醒',
          target: '孙立柱',
          content: '南京伴你行电子商务有限责任公司发票 26322000004468465801 请在截止日前提交 OA 付款申请。'
        }
      ]
    };
    await saveDb(db);
    return db;
  }
}

async function saveDb(db) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dbPath, JSON.stringify(db, null, 2), 'utf8');
}

async function removeUploadedFile(fileName) {
  if (!fileName) return;
  try {
    await unlink(path.join(uploadDir, path.basename(fileName)));
  } catch {
    // The file may already be gone; duplicate filtering should still continue.
  }
}

function canSeeAll(role) {
  return canSeeAllRole(role);
}

function resolveRequestUser(db, source = {}) {
  const name = String(source.user || source.name || '').trim();
  if (!name) return null;
  return db.users.find((item) => item.name === name) || null;
}

function isUserApproved(user) {
  if (!user) return false;
  return user.name === SYSTEM_OWNER_NAME || user.status === USER_STATUS_APPROVED;
}

function canAccessRow(row, requestUser) {
  if (!requestUser) return false;
  if (!isUserApproved(requestUser)) return false;
  if (canSeeAllRole(requestUser.role)) return true;
  return row.owner === requestUser.name || row.uploadedBy === requestUser.name;
}

function visibleRows(rows, db, query) {
  const requestUser = resolveRequestUser(db, query);
  return rows.filter((row) => canAccessRow(row, requestUser));
}

function requireAdmin(db, req, res) {
  const requestUser = resolveRequestUser(db, { ...req.query, ...req.body });
  if (requestUser?.role !== '管理员') {
    res.status(403).json({ error: 'admin only' });
    return null;
  }
  return requestUser;
}

function requireMailSettingsOwner(db, req, res) {
  const requestUser = resolveRequestUser(db, { ...req.query, ...req.body });
  if (requestUser?.name !== '孙立柱') {
    res.status(403).json({ error: 'mail settings owner only' });
    return null;
  }
  return requestUser;
}

function requireInvoiceInventoryOwner(db, req, res) {
  const requestUser = resolveRequestUser(db, { ...req.query, ...req.body });
  if (requestUser?.name !== '孙立柱') {
    res.status(403).json({ error: 'invoice inventory owner only' });
    return null;
  }
  return requestUser;
}

function canSeeAllRole(role) {
  return [ROLE_ADMIN, ROLE_FINANCE].includes(role);
}

const LEGACY_PERMISSION_ALIASES = {
  'systemFileLibrary.invoiceInventory': ['supplierPayment.invoiceInventory', 'invoiceInventory'],
  'maintenanceLibrary.supplierManagement': ['supplierPayment.supplierManagement', 'supplierManagement'],
  'systemManagement.reminders': ['supplierPayment.reminders']
};

function hasUserPermission(user, permission) {
  if (!user) return false;
  if (user.name === SYSTEM_OWNER_NAME) return true;
  if (!isUserApproved(user)) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : [];
  return permissions.includes(permission) || (LEGACY_PERMISSION_ALIASES[permission] || []).some((item) => permissions.includes(item));
}

function requirePermission(db, req, res, permission) {
  const requestUser = resolveRequestUser(db, { ...req.query, ...req.body });
  if (!hasUserPermission(requestUser, permission)) {
    res.status(403).json({ error: 'permission denied' });
    return null;
  }
  return requestUser;
}

function requireSystemOwner(db, req, res) {
  const requestUser = resolveRequestUser(db, { ...req.query, ...req.body });
  if (requestUser?.name !== SYSTEM_OWNER_NAME) {
    res.status(403).json({ error: 'system owner only' });
    return null;
  }
  return requestUser;
}

function publicSettingsForUser(settings, requestUser) {
  if (requestUser?.name !== SYSTEM_OWNER_NAME) return {};
  return {
    ...settings,
    smtpPassword: undefined,
    smtpPasswordConfigured: Boolean(settings.smtpPassword || process.env.SMTP_PASS)
  };
}

function publicSettings(settings, requestUser) {
  const canSeeMailSettings = requestUser?.name === '孙立柱';
  if (!canSeeMailSettings) return {};
  return {
    ...settings,
    smtpPassword: undefined,
    smtpPasswordConfigured: Boolean(settings.smtpPassword || process.env.SMTP_PASS)
  };
}

function deriveInvoiceStatus(invoice) {
  if (invoice.isPaid === '是') return '完成';
  if (String(invoice.oaProcessNo || '').trim()) {
    return invoice.isOaPrinted === '是' ? '待财务付款' : '待打印OA单据';
  }
  return '待提交付款申请';
}

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function findOwner(db, supplier, fallback) {
  return db.owners.find((item) => item.supplier === supplier)?.owner || fallback || '未分配';
}

function calculateDueDate(db, supplier, issueDate) {
  const termDays = db.suppliers.find((item) => item.name === supplier)?.termDays || 30;
  return format(addDays(parseISO(issueDate), termDays), 'yyyy-MM-dd');
}

function findSupplierMeta(db, supplierName) {
  const normalizedName = normalizeName(supplierName);
  return db.suppliers.find((supplier) => normalizeName(supplier.name) === normalizedName);
}

function calculatePaymentDate(db, supplierName, issueDate) {
  const supplier = findSupplierMeta(db, supplierName);
  const termDays = Number(supplier?.termDays);
  if (!issueDate || !Number.isFinite(termDays)) return '';
  return format(addDays(parseISO(issueDate), termDays), 'yyyy-MM-dd');
}

function naturalWeek(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() + (day === 0 ? -6 : 1 - day));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

function isDateInRange(value, start, end) {
  if (!value) return false;
  const date = parseISO(value);
  return date >= start && date <= end;
}

function findOwnerRecordForSupplier(db, supplierName) {
  const normalizedName = normalizeName(supplierName);
  const exact = db.owners.find((owner) => normalizeName(owner.supplier) === normalizedName);
  if (exact) return exact;

  const matchedSupplier = db.suppliers.find((supplier) => {
    const shortName = normalizeName(supplier.shortName);
    return shortName && normalizedName.includes(shortName);
  });
  const shortName = normalizeName(matchedSupplier?.shortName);
  if (!shortName) return null;
  return db.owners.find((owner) => normalizeName(owner.supplier).includes(shortName)) || null;
}

function weeklyPaymentApplications(db, date = new Date()) {
  const { start, end } = naturalWeek(date);
  const rows = db.invoices
    .map((invoice) => ({
      ...invoice,
      paymentDate: calculatePaymentDate(db, invoice.supplier, invoice.issueDate),
      buyer: findOwnerRecordForSupplier(db, invoice.supplier)?.owner || invoice.owner || '未匹配'
    }))
    .filter((invoice) =>
      invoice.status === '待提交付款申请' &&
      isDateInRange(invoice.paymentDate, start, end)
    );
  return { start, end, rows };
}

function groupInvoicesByOwner(db, invoices) {
  const groups = new Map();
  invoices.forEach((invoice) => {
    const ownerRecord = findOwnerRecordForSupplier(db, invoice.supplier);
    const owner = ownerRecord?.owner || invoice.buyer || invoice.owner || '未匹配';
    const key = owner;
    if (!groups.has(key)) {
      groups.set(key, {
        owner,
        email: ownerRecord?.email || '',
        invoices: []
      });
    }
    groups.get(key).invoices.push(invoice);
  });
  return [...groups.values()];
}

function buildWeeklyPaymentMail(group, start, end) {
  const rangeText = `${format(start, 'yyyy-MM-dd')} 至 ${format(end, 'yyyy-MM-dd')}`;
  const rows = group.invoices.map((invoice) => (
    `<tr>
      <td>${invoice.invoiceNo}</td>
      <td>${invoice.supplier}</td>
      <td>${Number(invoice.amount || 0).toLocaleString()}</td>
      <td>${invoice.issueDate}</td>
      <td>${invoice.paymentDate}</td>
      <td>${invoice.status}</td>
    </tr>`
  )).join('');
  return {
    subject: `本周需提交付款申请提醒（${rangeText}）`,
    text: `${group.owner}，本周需提交付款申请 ${group.invoices.length} 条，请及时处理。\n\n` +
      group.invoices.map((invoice) =>
        `${invoice.invoiceNo} | ${invoice.supplier} | ${invoice.amount} | ${invoice.issueDate} | ${invoice.paymentDate}`
      ).join('\n'),
    html: `<p>${group.owner}，本周需提交付款申请 <strong>${group.invoices.length}</strong> 条，请及时处理。</p>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead><tr><th>发票号码</th><th>供应商</th><th>金额</th><th>开票日</th><th>付款日期</th><th>状态</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`
  };
}

function createMailTransporter(db) {
  const from = process.env.SMTP_USER || db.settings.senderEmail;
  const pass = process.env.SMTP_PASS || db.settings.smtpPassword;
  const host = process.env.SMTP_HOST || (from?.endsWith('@qq.com') ? 'smtp.qq.com' : '');
  const port = Number(process.env.SMTP_PORT || (from?.endsWith('@qq.com') ? 465 : 587));
  if (!from || !pass || !host) return null;
  return {
    from,
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user: from, pass }
    })
  };
}

function pushLog(db, type, target, content) {
  db.reminders.unshift({
    id: crypto.randomUUID(),
    createdAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    type,
    target,
    content
  });
}

async function sendWeeklyPaymentEmails(date = new Date()) {
  const db = await ensureDb();
  const { start, end, rows } = weeklyPaymentApplications(db, date);
  const weekKey = format(start, 'yyyy-MM-dd');
  if (db.settings.lastWeeklyPaymentEmailKey === weekKey ||
      db.settings.lastWeeklyPaymentEmailAttemptKey === weekKey) {
    return { skipped: true, reason: 'already sent', weekKey };
  }
  db.settings.lastWeeklyPaymentEmailAttemptKey = weekKey;

  const groups = groupInvoicesByOwner(db, rows);
  const mailer = createMailTransporter(db);
  let sentCount = 0;
  let skippedCount = 0;

  if (groups.length === 0) {
    pushLog(db, '定时邮件', '系统', `本周（${format(start, 'yyyy-MM-dd')} 至 ${format(end, 'yyyy-MM-dd')}）没有需要提交付款申请的发票。`);
    db.settings.lastWeeklyPaymentEmailKey = weekKey;
    await saveDb(db);
    return { sentCount, skippedCount, weekKey };
  }

  if (!mailer) {
    pushLog(db, '定时邮件失败', '系统', '未配置 SMTP_PASS/SMTP_HOST，无法发送本周付款申请提醒邮件。');
    await saveDb(db);
    return { sentCount, skippedCount: groups.length, weekKey, error: 'missing smtp config' };
  }

  for (const group of groups) {
    if (!group.email) {
      skippedCount += 1;
      pushLog(db, '定时邮件跳过', group.owner, `${group.owner} 未配置邮箱，跳过 ${group.invoices.length} 条本周付款申请提醒。`);
      continue;
    }
    const mail = buildWeeklyPaymentMail(group, start, end);
    await mailer.transporter.sendMail({
      from: mailer.from,
      to: group.email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    });
    sentCount += 1;
    pushLog(db, '定时邮件发送', group.owner, `已发送本周付款申请提醒到 ${group.email}，共 ${group.invoices.length} 条。`);
  }

  db.settings.lastWeeklyPaymentEmailKey = weekKey;
  await saveDb(db);
  return { sentCount, skippedCount, weekKey };
}

function startWeeklyPaymentEmailScheduler() {
  setInterval(() => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 9) {
      sendWeeklyPaymentEmails(now).catch((error) => {
        console.error('Weekly payment email failed:', error);
      });
    }
  }, 60 * 1000);
}

function parseSupplierTermWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const imported = [];
  const failed = [];

  rows.forEach((row, index) => {
    const supplier = String(row[0] || '').trim();
    const shortName = String(row[1] || '').trim();
    const termText = String(row[3] || '').trim();
    const hasAnnualFrame = String(row[4] || '').trim();
    const remark = String(row[5] || '').trim();
    const termMatch = termText.match(/\d+/);

    if (!supplier && !shortName && !termText && !hasAnnualFrame && !remark) return;
    const lowerSupplier = supplier.toLowerCase();
    const lowerShortName = shortName.toLowerCase();
    const lowerTerm = termText.toLowerCase();
    if (index === 0 && (
      supplier.includes('供应商') ||
      shortName.includes('简称') ||
      termText.includes('账期') ||
      lowerSupplier.includes('supplier') ||
      lowerShortName.includes('short') ||
      lowerTerm.includes('term')
    )) return;
    if (!supplier || !termMatch) {
      failed.push({
        rowNumber: index + 1,
        supplier,
        shortName,
        termText,
        hasAnnualFrame,
        remark,
        reason: 'A列供应商或D列账期缺失'
      });
      return;
    }

    imported.push({
      supplier,
      shortName: shortName || supplier,
      termDays: Number(termMatch[0]),
      hasAnnualFrame,
      remark,
      rowNumber: index + 1
    });
  });

  return { sheetName, imported, failed };
}

function parseOwnerWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.Sheets['产品线明细'] ? '产品线明细' : workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const imported = [];
  const failed = [];
  const emailColumnIndex = rows
    .slice(0, 10)
    .reduce((found, row) => {
      if (found >= 0) return found;
      const index = row.findIndex((cell) => /邮箱|邮件|email/i.test(String(cell || '')));
      return index >= 0 ? index : found;
    }, -1);

  rows.forEach((row, index) => {
    const owner = String(row[3] || '').trim();
    const supplier = String(row[7] || '').trim();
    const detectedEmail = emailColumnIndex >= 0 ? String(row[emailColumnIndex] || '').trim() : '';
    const fallbackEmail = String(row[4] || '').trim();
    const email = detectedEmail || (fallbackEmail.includes('@') ? fallbackEmail : '');

    if (!owner && !supplier && !email) return;
    if (index === 0 && (
      owner.includes('采购') ||
      supplier.includes('供应商') ||
      owner.toLowerCase().includes('buyer') ||
      supplier.toLowerCase().includes('supplier') ||
      email.toLowerCase().includes('email') ||
      email.includes('邮箱')
    )) return;
    if (!owner || !supplier) {
      failed.push({
        rowNumber: index + 1,
        owner,
        supplier,
        reason: 'D列采购人或H列供应商缺失'
      });
      return;
    }

    imported.push({
      owner,
      supplier,
      email,
      rowNumber: index + 1
    });
  });

  return { sheetName, imported, failed };
}

function uniqueColumnName(name, index, seen) {
  const baseName = String(name || '').trim() || `列${index + 1}`;
  let nextName = baseName;
  let suffix = 2;
  while (seen.has(nextName)) {
    nextName = `${baseName}_${suffix}`;
    suffix += 1;
  }
  seen.add(nextName);
  return nextName;
}

function parseGenericWorkbook(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
  const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell || '').trim()));
  if (headerIndex < 0) {
    return { sheetName, columns: [], rows: [], importedCount: 0 };
  }

  const seen = new Set();
  const columns = rows[headerIndex].map((cell, index) => uniqueColumnName(cell, index, seen));
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row, index) => {
      const item = { id: crypto.randomUUID(), rowNumber: headerIndex + index + 2 };
      columns.forEach((column, columnIndex) => {
        item[column] = String(row[columnIndex] || '').trim();
      });
      return item;
    });

  return { sheetName, columns, rows: dataRows, importedCount: dataRows.length };
}

async function extractPdfText(filePath) {
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text || '';
  } finally {
    await parser.destroy();
  }
}

function normalizeLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function parseInvoiceText(text) {
  const lines = normalizeLines(text);
  const invoiceNo = text.match(/\b\d{20}\b/)?.[0] || '';
  const dateMatch = text.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  const issueDate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
    : format(new Date(), 'yyyy-MM-dd');
  const dateIndex = lines.findIndex((line) => line.includes(dateMatch?.[0] || ''));
  const buyerName = dateIndex >= 0 ? lines[dateIndex + 1] || '' : '';
  const sellerName = dateIndex >= 0 ? lines[dateIndex + 3] || '' : '';
  const amounts = [...text.matchAll(/¥\s*([0-9]+(?:\.[0-9]{2})?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));

  return {
    invoiceNo,
    issueDate,
    buyerName,
    supplier: sellerName,
    amount: amounts.length ? Math.max(...amounts) : 0,
    rawText: text
  };
}

async function recognizeInvoice(file, db, user) {
  const filePath = path.join(uploadDir, file.filename);
  let parsed = {};
  if (file.mimetype === 'application/pdf' || detectMime(await readFile(filePath)) === 'application/pdf') {
    const text = await extractPdfText(filePath);
    parsed = parseInvoiceText(text);
  }

  const supplier = parsed.supplier || '未识别供应商';
  const issueDate = format(new Date(), 'yyyy-MM-dd');
  return {
    id: crypto.randomUUID(),
    supplier,
    invoiceNo: parsed.invoiceNo || `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    amount: parsed.amount || 0,
    issueDate: parsed.issueDate || issueDate,
    status: '待确认',
    owner: findOwner(db, supplier, user),
    uploadedBy: user,
    fileName: file.filename,
    mimeType: file.mimetype,
    originalName: file.originalname,
    recognitionSource: parsed.supplier ? 'pdf-text' : 'manual-review'
  };
}

async function reprocessDraft(draft, db) {
  if (!draft.fileName) return draft;
  const filePath = path.join(uploadDir, draft.fileName);
  const buffer = await readFile(filePath);
  if (detectMime(buffer) !== 'application/pdf') return draft;
  const text = await extractPdfText(filePath);
  const parsed = parseInvoiceText(text);
  if (!parsed.supplier && !parsed.invoiceNo && !parsed.amount) return draft;
  draft.supplier = parsed.supplier || draft.supplier;
  draft.invoiceNo = parsed.invoiceNo || draft.invoiceNo;
  draft.amount = parsed.amount || draft.amount;
  draft.issueDate = parsed.issueDate || draft.issueDate;
  draft.owner = findOwner(db, draft.supplier, draft.uploadedBy);
  draft.mimeType = 'application/pdf';
  draft.recognitionSource = 'pdf-text';
  return draft;
}

app.post('/api/login', async (req, res) => {
  const db = await ensureDb();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  const user = db.users.find((item) => item.name === name && item.password === password);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  if (!isUserApproved(user)) return res.status(403).json({ error: 'pending approval' });
  res.json(publicUser(user));
});

app.post('/api/register', async (req, res) => {
  const db = await ensureDb();
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '').trim();
  if (!name || !password) return res.status(400).json({ error: 'missing name or password' });
  if (db.users.some((item) => item.name === name)) return res.status(409).json({ error: 'user exists' });

  const user = normalizeUser({
    id: crypto.randomUUID(),
    name,
    password,
    role: ROLE_USER,
    permissions: [],
    status: USER_STATUS_PENDING
  });
  db.users.push(user);
  pushLog(db, '注册申请', SYSTEM_OWNER_NAME, `${name} 申请注册，等待孙立柱审核。`, '系统管理', '权限管理');
  await saveDb(db);
  res.json(publicUser(user));
});

app.get('/api/users', async (req, res) => {
  const db = await ensureDb();
  if (!requireSystemOwner(db, req, res)) return;
  res.json(db.users.map(publicUser));
});

app.post('/api/users', async (req, res) => {
  const db = await ensureDb();
  if (!requireSystemOwner(db, req, res)) return;
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'missing name' });
  if (db.users.some((item) => item.name === name)) return res.status(409).json({ error: 'user exists' });
  const user = normalizeUser({
    id: crypto.randomUUID(),
    name,
    password: req.body.password || '123456',
    role: req.body.role || ROLE_USER,
    permissions: Array.isArray(req.body.permissions) ? req.body.permissions : DEFAULT_PERMISSIONS,
    status: USER_STATUS_APPROVED
  });
  db.users.push(user);
  await saveDb(db);
  res.json(publicUser(user));
});

app.patch('/api/users/:id', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) return;
  const target = db.users.find((item) => item.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });

  if (target.name !== SYSTEM_OWNER_NAME) {
    if (Object.prototype.hasOwnProperty.call(req.body, 'role')) {
      target.role = req.body.role === ROLE_FINANCE ? ROLE_FINANCE : ROLE_USER;
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'permissions')) {
      target.permissions = sanitizePermissions(req.body.permissions);
    }
    if (String(req.body.password || '').trim()) {
      target.password = String(req.body.password).trim();
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      target.status = req.body.status === USER_STATUS_PENDING ? USER_STATUS_PENDING : USER_STATUS_APPROVED;
    }
  }

  const normalized = normalizeUser(target);
  Object.assign(target, normalized);
  await saveDb(db);
  res.json(publicUser(target));
});

app.get('/api/invoices', async (req, res) => {
  const db = await ensureDb();
  res.json(visibleRows(db.invoices, db, req.query));
});

app.patch('/api/invoices/:id', async (req, res) => {
  const db = await ensureDb();
  const requestUser = resolveRequestUser(db, req.body);
  const invoice = db.invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'not found' });
  if (!canAccessRow(invoice, requestUser)) return res.status(403).json({ error: 'forbidden' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'oaProcessNo')) {
    invoice.oaProcessNo = String(req.body.oaProcessNo || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'isOaPrinted')) {
    invoice.isOaPrinted = req.body.isOaPrinted === '是' ? '是' : '否';
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'isPaid')) {
    invoice.isPaid = req.body.isPaid === '是' ? '是' : '';
  }
  if (!Object.prototype.hasOwnProperty.call(req.body, 'oaProcessNo') &&
      !Object.prototype.hasOwnProperty.call(req.body, 'isOaPrinted') &&
      !Object.prototype.hasOwnProperty.call(req.body, 'isPaid')) {
    invoice.status = req.body.status || invoice.status;
  } else {
    invoice.status = deriveInvoiceStatus(invoice);
  }
  db.reminders.unshift({
    id: crypto.randomUUID(),
    createdAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    type: '状态更新',
    target: invoice.owner,
    content: `${invoice.supplier} 发票 ${invoice.invoiceNo} 状态更新为：${invoice.status}`
  });
  await saveDb(db);
  res.json(invoice);
});

app.delete('/api/invoices/:id', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requirePermission(db, req, res, 'systemFileLibrary.invoiceInventory');
  if (!requestUser) return;
  const invoice = db.invoices.find((item) => item.id === req.params.id);
  if (!invoice) return res.status(404).json({ error: 'not found' });
  db.invoices = db.invoices.filter((item) => item.id !== req.params.id);
  await removeUploadedFile(invoice.fileName);
  db.reminders.unshift({
    id: crypto.randomUUID(),
    createdAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    type: '发票库存删除',
    target: requestUser.name,
    content: `${requestUser.name} 删除了 ${invoice.supplier} 发票 ${invoice.invoiceNo || invoice.id}。`
  });
  await saveDb(db);
  res.status(204).end();
});

app.get('/api/drafts', async (req, res) => {
  const db = await ensureDb();
  res.json(visibleRows(db.drafts, db, req.query));
});

app.post('/api/upload', upload.array('files'), async (req, res) => {
  const db = await ensureDb();
  const requestUser = resolveRequestUser(db, req.body);
  if (!requestUser) return res.status(401).json({ error: 'invalid user' });
  const user = requestUser.name;
  const recognized = await Promise.all(req.files.map((file) => recognizeInvoice(file, db, user)));
  const existingInvoiceNos = new Set(
    [...db.drafts, ...db.invoices]
      .map((item) => item.invoiceNo)
      .filter(Boolean)
  );
  const keptInvoiceNos = new Set();
  const drafts = [];
  const duplicates = [];

  for (const draft of recognized) {
    const invoiceNo = draft.invoiceNo;
    if (invoiceNo && (existingInvoiceNos.has(invoiceNo) || keptInvoiceNos.has(invoiceNo))) {
      duplicates.push({
        invoiceNo,
        supplier: draft.supplier,
        originalName: draft.originalName
      });
      await removeUploadedFile(draft.fileName);
      continue;
    }
    drafts.push(draft);
    if (invoiceNo) keptInvoiceNos.add(invoiceNo);
  }

  db.drafts.unshift(...drafts);
  drafts.forEach((draft) => db.reminders.unshift({
    id: crypto.randomUUID(),
    createdAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    type: 'OCR 核对提醒',
    target: draft.owner,
    content: `${draft.originalName} 已上传，请核对 OCR 识别结果。`
  }));
  await saveDb(db);
  res.json({ created: drafts, duplicates });
});

app.post('/api/drafts/reprocess', async (req, res) => {
  const db = await ensureDb();
  const results = [];
  for (const draft of db.drafts) {
    try {
      results.push(await reprocessDraft(draft, db));
    } catch {
      results.push(draft);
    }
  }
  await saveDb(db);
  res.json(results);
});

app.post('/api/drafts/:id/confirm', async (req, res) => {
  const db = await ensureDb();
  const requestUser = resolveRequestUser(db, req.body);
  const index = db.drafts.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'not found' });
  if (!canAccessRow(db.drafts[index], requestUser)) return res.status(403).json({ error: 'forbidden' });
  const draft = db.drafts.splice(index, 1)[0];
  const invoice = {
    ...draft,
    status: '待提交付款申请',
    dueDate: calculateDueDate(db, draft.supplier, draft.issueDate)
  };
  db.invoices.unshift(invoice);
  db.reminders.unshift({
    id: crypto.randomUUID(),
    createdAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    type: '付款申请提醒',
    target: invoice.owner,
    content: `${invoice.supplier} 发票 ${invoice.invoiceNo} 请在 ${invoice.dueDate} 前提交 OA 付款申请。`
  });
  await saveDb(db);
  res.json(invoice);
});

app.delete('/api/drafts/:id', async (req, res) => {
  const db = await ensureDb();
  const requestUser = resolveRequestUser(db, req.query);
  const draft = db.drafts.find((item) => item.id === req.params.id);
  if (!draft) return res.status(404).json({ error: 'not found' });
  if (!canAccessRow(draft, requestUser)) return res.status(403).json({ error: 'forbidden' });
  db.drafts = db.drafts.filter((item) => item.id !== req.params.id);
  await saveDb(db);
  res.status(204).end();
});

app.get('/api/suppliers', async (req, res) => {
  const db = await ensureDb();
  res.json(db.suppliers);
});

app.post('/api/suppliers', async (req, res) => {
  const db = await ensureDb();
  if (!requirePermission(db, req, res, 'maintenanceLibrary.supplierManagement')) return;
  const supplier = { id: crypto.randomUUID(), name: req.body.name, termDays: Number(req.body.termDays || 30) };
  db.suppliers.unshift(supplier);
  await saveDb(db);
  res.json(supplier);
});

app.post('/api/suppliers/import-terms', upload.single('file'), async (req, res) => {
  const db = await ensureDb();
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  if (!requirePermission(db, req, res, 'maintenanceLibrary.supplierManagement')) {
    await removeUploadedFile(req.file.filename);
    return;
  }

  try {
    const result = parseSupplierTermWorkbook(req.file.path);
    const byName = new Map();

    result.imported.forEach((item) => {
      byName.set(item.supplier, {
        id: crypto.randomUUID(),
        name: item.supplier,
        shortName: item.shortName,
        termDays: item.termDays,
        hasAnnualFrame: item.hasAnnualFrame,
        remark: item.remark
      });
    });

    db.suppliers = [...byName.values()];
    await saveDb(db);
    res.json({
      sheetName: result.sheetName,
      importedCount: result.imported.length,
      failedCount: result.failed.length,
      imported: result.imported,
      failed: result.failed,
      suppliers: db.suppliers
    });
  } finally {
    await removeUploadedFile(req.file.filename);
  }
});

app.get('/api/owners', async (req, res) => {
  const db = await ensureDb();
  res.json(db.owners);
});

app.post('/api/owners', async (req, res) => {
  const db = await ensureDb();
  if (!requirePermission(db, req, res, 'maintenanceLibrary.supplierManagement')) return;
  const owner = { id: crypto.randomUUID(), owner: req.body.owner, supplier: req.body.supplier };
  db.owners.unshift(owner);
  await saveDb(db);
  res.json(owner);
});

app.post('/api/owners/import', upload.single('file'), async (req, res) => {
  const db = await ensureDb();
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  if (!requirePermission(db, req, res, 'maintenanceLibrary.supplierManagement')) {
    await removeUploadedFile(req.file.filename);
    return;
  }

  try {
    const result = parseOwnerWorkbook(req.file.path);
    const bySupplier = new Map();

    result.imported.forEach((item) => {
      bySupplier.set(item.supplier, {
        id: crypto.randomUUID(),
        owner: item.owner,
        supplier: item.supplier,
        email: item.email
      });
    });

    db.owners = [...bySupplier.values()];
    await saveDb(db);
    res.json({
      sheetName: result.sheetName,
      importedCount: result.imported.length,
      failedCount: result.failed.length,
      imported: result.imported,
      failed: result.failed,
      owners: db.owners
    });
  } finally {
    await removeUploadedFile(req.file.filename);
  }
});

app.get('/api/quality-inspection/initial-data', async (req, res) => {
  const db = await ensureDb();
  if (!requirePermission(db, req, res, 'qualityInspection.inspectionInitialData')) return;
  res.json(db.qualityInspection.initialData);
});

app.post('/api/quality-inspection/initial-data/import', upload.single('file'), async (req, res) => {
  const db = await ensureDb();
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  if (!requirePermission(db, req, res, 'qualityInspection.inspectionInitialData')) {
    await removeUploadedFile(req.file.filename);
    return;
  }

  try {
    const result = parseGenericWorkbook(req.file.path);
    db.qualityInspection.initialData = {
      sheetName: result.sheetName,
      columns: result.columns,
      rows: result.rows,
      updatedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss')
    };
    await saveDb(db);
    res.json({
      ...db.qualityInspection.initialData,
      importedCount: result.importedCount
    });
  } finally {
    await removeUploadedFile(req.file.filename);
  }
});

app.get('/api/quality-inspection/notices', async (req, res) => {
  const db = await ensureDb();
  if (!requirePermission(db, req, res, 'qualityInspection.inspectionNotice')) return;
  res.json(db.qualityInspection.notices);
});

app.post('/api/quality-inspection/notices', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requirePermission(db, req, res, 'qualityInspection.inspectionNotice');
  if (!requestUser) return;
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  db.qualityInspection.notices = {
    rows: rows.map((row, index) => ({
      id: row.id || crypto.randomUUID(),
      rowNumber: index + 1,
      ...row
    })),
    submittedAt: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    submittedBy: requestUser.name
  };
  pushLog(db, '验货通知提交', requestUser.name, `${requestUser.name} 提交验货通知 ${rows.length} 条。`);
  await saveDb(db);
  res.json(db.qualityInspection.notices);
});

app.get('/api/reminders', async (req, res) => {
  const db = await ensureDb();
  const requestUser = resolveRequestUser(db, req.query);
  if (canSeeAllRole(requestUser?.role)) return res.json(db.reminders);
  res.json(db.reminders.filter((item) => item.target === requestUser?.name));
});

app.get('/api/reminders/weekly-payment-preview', async (req, res) => {
  const db = await ensureDb();
  const { start, end, rows } = weeklyPaymentApplications(db, new Date());
  res.json({
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
    groups: groupInvoicesByOwner(db, rows).map((group) => ({
      owner: group.owner,
      email: group.email,
      count: group.invoices.length,
      invoices: group.invoices.map((invoice) => ({
        invoiceNo: invoice.invoiceNo,
        supplier: invoice.supplier,
        amount: invoice.amount,
        issueDate: invoice.issueDate,
        paymentDate: invoice.paymentDate,
        status: invoice.status
      }))
    }))
  });
});

app.get('/api/settings', async (req, res) => {
  const db = await ensureDb();
  const requestUser = resolveRequestUser(db, req.query);
  res.json(publicSettingsForUser(db.settings, requestUser));
});

app.patch('/api/settings', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) return;
  db.settings.senderEmail = String(req.body.senderEmail || '').trim();
  if (Object.prototype.hasOwnProperty.call(req.body, 'smtpPassword')) {
    const smtpPassword = String(req.body.smtpPassword || '').trim();
    if (smtpPassword) db.settings.smtpPassword = smtpPassword;
  }
  await saveDb(db);
  res.json(publicSettingsForUser(db.settings, requestUser));
});

function stripKcfxRecordRows(record = {}) {
  const { rows, ...metadata } = record || {};
  const rowCount = Array.isArray(rows) ? rows.length : Number(record.rowCount || 0);
  return {
    ...metadata,
    rowCount,
    hasRows: Array.isArray(rows) || Boolean(record.rowsPath) || rowCount > 0
  };
}

function safeKcfxRecordId(id) {
  return path.basename(String(id || '').trim()).replace(/[^a-z0-9_-]/gi, '');
}

function kcfxRecordRowsRelativePath(id) {
  const safeId = safeKcfxRecordId(id);
  if (!safeId) throw new Error('invalid record id');
  return safeArchiveName(path.join('kcfx-records', `${safeId}.json`));
}

function kcfxRecordRowsFullPath(recordOrId) {
  const rowsPath = typeof recordOrId === 'string'
    ? kcfxRecordRowsRelativePath(recordOrId)
    : recordOrId?.rowsPath || kcfxRecordRowsRelativePath(recordOrId?.id);
  return path.join(dataDir, safeArchiveName(rowsPath));
}

function preserveKcfxRowsMetadata(record = {}) {
  const metadata = {};
  if (record.rowsPath) metadata.rowsPath = record.rowsPath;
  if (record.rowsSavedAt) metadata.rowsSavedAt = record.rowsSavedAt;
  if (Number.isFinite(Number(record.rowCount))) metadata.rowCount = Number(record.rowCount);
  return metadata;
}

async function writeKcfxRecordRows(id, rows) {
  await mkdir(kcfxRecordDir, { recursive: true });
  const relativePath = kcfxRecordRowsRelativePath(id);
  const fullPath = path.join(dataDir, relativePath);
  const savedAt = new Date().toISOString();
  await writeFile(fullPath, JSON.stringify({
    id,
    savedAt,
    rowCount: rows.length,
    rows
  }), 'utf8');
  return {
    rowsPath: relativePath,
    rowsSavedAt: savedAt,
    rowCount: rows.length
  };
}

async function readKcfxRecordRows(record = {}) {
  if (Array.isArray(record.rows)) return record.rows;
  if (!record.rowsPath) return [];
  const payload = JSON.parse(await readFile(kcfxRecordRowsFullPath(record), 'utf8'));
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

async function readKcfxRecordRowsPayload(id) {
  const relativePath = kcfxRecordRowsRelativePath(id);
  const fullPath = path.join(dataDir, relativePath);
  const payload = JSON.parse(await readFile(fullPath, 'utf8'));
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return {
    rows,
    rowsPath: relativePath,
    rowsSavedAt: payload?.savedAt || '',
    rowCount: Number(payload?.rowCount || rows.length)
  };
}

function defaultKcfxSlotTitle(slotId) {
  const titles = {
    'dim-product': '商品分类维表',
    'dim-purchase-division': '采购分工明细'
  };
  return titles[slotId] || slotId;
}

async function recoverKcfxRecordFromRowsFile(id) {
  try {
    const payload = await readKcfxRecordRowsPayload(id);
    if (!payload.rows.length) return null;
    return {
      id,
      title: defaultKcfxSlotTitle(id),
      sheetHint: defaultKcfxSheetHint(id),
      sheetName: defaultKcfxSheetHint(id),
      savedAt: payload.rowsSavedAt,
      appliedAt: payload.rowsSavedAt,
      parseStatus: 'ready',
      parseSource: 'server-recovered',
      rowsPath: payload.rowsPath,
      rowsSavedAt: payload.rowsSavedAt,
      rowCount: payload.rowCount
    };
  } catch {
    return null;
  }
}

async function resolveKcfxStoredFilePath(record = {}) {
  const candidates = [];
  if (record.serverFilePath) {
    candidates.push(path.join(kcfxFileDir, safeArchiveName(record.serverFilePath)));
  }
  if (record.serverFileName && record.id) {
    candidates.push(path.join(legacyKcfxFileDir, path.basename(record.id), path.basename(record.serverFileName)));
  }
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch {
      // Try the next known storage location.
    }
  }
  return '';
}

async function ensureKcfxRecordRows(db, id, record = {}) {
  if (Array.isArray(record.rows) || record.rowsPath) return record;
  const originalFilePath = await resolveKcfxStoredFilePath({ ...record, id });
  if (!originalFilePath) return record;
  try {
    const slot = {
      id,
      type: record.type || '',
      title: record.title || defaultKcfxSlotTitle(id),
      expectedName: record.expectedName || '',
      sheetHint: record.sheetHint || defaultKcfxSheetHint(id),
      skipRows: Number.isInteger(Number(record.skipRows)) ? Number(record.skipRows) : undefined
    };
    const parsed = parseKcfxWorkbookFile(originalFilePath, slot);
    if (!parsed.rows.length) return record;
    const parsedRecord = await externalizeKcfxRecordRows({
      ...record,
      id,
      title: slot.title,
      sheetName: parsed.sheetName,
      parseStatus: 'ready',
      parseSource: 'server-on-demand',
      parseCompletedAt: new Date().toISOString(),
      parseDiagnostics: buildKcfxParseDiagnostics(parsed),
      rows: parsed.rows
    }, id);
    db.kcfxLibrary.records[id] = parsedRecord;
    db.kcfxLibrary.savedAt = new Date().toISOString();
    await saveDb(db);
    return parsedRecord;
  } catch (error) {
    return {
      ...record,
      parseStatus: record.parseStatus || 'failed',
      parseError: record.parseError || error?.message || 'parse failed'
    };
  }
}

async function externalizeKcfxRecordRows(record = {}, id = record.id) {
  if (!Array.isArray(record.rows)) {
    return {
      ...record,
      rowCount: Number(record.rowCount || 0)
    };
  }
  const rowsMetadata = await writeKcfxRecordRows(id, record.rows);
  const { rows, ...metadata } = record;
  return {
    ...metadata,
    ...rowsMetadata
  };
}

async function externalizeKcfxLibraryInlineRows(db) {
  let changed = false;
  const records = db.kcfxLibrary?.records || {};
  for (const [id, record] of Object.entries(records)) {
    if (!Array.isArray(record?.rows)) continue;
    records[id] = await externalizeKcfxRecordRows(record, id);
    changed = true;
  }
  if (changed) {
    db.kcfxLibrary.savedAt = new Date().toISOString();
    await saveDb(db);
  }
  return changed;
}

async function attachKcfxRecordRows(record = {}) {
  return {
    ...record,
    rows: await readKcfxRecordRows(record)
  };
}

async function removeKcfxRecordRows(record) {
  if (!record?.rowsPath && !record?.id) return;
  try {
    await unlink(kcfxRecordRowsFullPath(record));
  } catch {
    // Missing row files should not block deleting the library record.
  }
}

function publicKcfxLibrary(db, options = {}) {
  const includeRows = Boolean(options.includeRows);
  const records = db.kcfxLibrary?.records || {};
  return {
    schemaVersion: db.kcfxLibrary?.schemaVersion || 1,
    project: 'kcfx',
    savedAt: db.kcfxLibrary?.savedAt || '',
    records: Object.fromEntries(Object.entries(records).map(([id, record]) => [
      id,
      includeRows ? record : stripKcfxRecordRows(record)
    ]))
  };
}

let kcfxPreloadCache = {
  ok: false,
  status: 'idle',
  source: 'server-preload',
  startedAt: '',
  completedAt: '',
  error: '',
  schemaVersion: 1,
  project: 'kcfx',
  savedAt: '',
  records: {},
  recordCount: 0,
  rowCount: 0
};
let kcfxPreloadPromise = null;

const KCFX_TREND_MONTHS = [
  { id: 'fact-3', label: '1月' },
  { id: 'fact-4', label: '2月' },
  { id: 'fact-5', label: '3月' },
  { id: 'fact-6', label: '4月' },
  { id: 'fact-7', label: '5月' }
];
const KCFX_TREND_RECORD_IDS = new Set([
  ...KCFX_TREND_MONTHS.map((month) => month.id),
  'fact-2',
  'dim-product',
  'dim-warehouse',
  'dim-warehouse-material'
]);
const KCFX_TREND_UNCLASSIFIED_LIMIT = 1000;
let kcfxTrendSummaryCache = null;
let kcfxTrendSummaryPromise = null;

const KCFX_RECEIPT_RECORD_IDS = new Set([
  'fact-2',
  'dim-product',
  'dim-warehouse',
  'dim-warehouse-material',
  'fact-inventory'
]);
const KCFX_RECEIPT_AGE_BUCKETS = ['0-30天', '31-60天', '61-90天', '91-120天', '121-150天', '150天以上'];
const KCFX_RECEIPT_AGE_DEFINITIONS = [
  { label: '0-30天', candidates: ['0-30天数量', '0-30天库存数量', '0-30天结余库存数量', '0-30天库龄数量', '0-30天'] },
  { label: '31-60天', candidates: ['31-60天数量', '31-60天库存数量', '31-60天结余库存数量', '31-60天库龄数量', '31-60天'] },
  { label: '61-90天', candidates: ['61-90天数量', '61-90天库存数量', '61-90天结余库存数量', '61-90天库龄数量', '61-90天'] },
  { label: '91-120天', candidates: ['91-120天数量', '91-120天库存数量', '91-120天结余库存数量', '91-120天库龄数量', '91-120天'] },
  { label: '121-150天', candidates: ['121-150天数量', '121-150天库存数量', '121-150天结余库存数量', '121-150天库龄数量', '121-150数量', '121-150天', '121-150'] },
  { label: '150天以上', candidates: ['>150天', '＞150天', '>150天数量', '＞150天数量', '>150天库存数量', '＞150天库存数量', '>150天结余库存数量', '＞150天结余库存数量', '大于150天', '大于150天数量', '150天以上数量', '150天以上库存数量', '150天以上结余库存数量', '150天以上库龄数量', '150天及以上数量', '150天及以上库存数量', '150以上数量', '150天以上', '150天及以上', '150以上'] }
];
const KCFX_RECEIPT_SALEABLE_NEW_WAREHOUSE_TYPES = new Set(['销售出库仓', '销售供应商仓', '生产成品仓']);
const KCFX_RECEIPT_RAW_MATERIAL_WAREHOUSE_TYPES = new Set(['生产材料仓', '生成材料仓']);
const KCFX_RECEIPT_OTHER_UNSALEABLE_WAREHOUSE_TYPES = new Set(['系统集成仓', '销售海上在途仓', '销售售后配件仓', '样品/展厅仓', '样品展厅仓']);
const KCFX_RECEIPT_SALEABLE_RETURN_CATEGORIES = new Set(['二手商品-九大产品新', '二手商品-其他/成品', '全新换包装-九大产品线']);
const KCFX_RECEIPT_UNINSPECTED_RETURN_CATEGORIES = new Set(['全新品', '其他/成品']);
const KCFX_RECEIPT_OTHER_UNSALEABLE_RETURN_CATEGORIES = new Set(['健康办公', '其他/配件']);
let kcfxReceiptSummaryCache = null;
let kcfxReceiptSummaryPromise = null;
const KCFX_RECEIPT_SUMMARY_CACHE_VERSION = 2;

function normalizeKcfxIds(idsParam) {
  const ids = String(idsParam || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => KC_LIBRARY_SLOT_IDS.has(id));
  return ids.length ? new Set(ids) : null;
}

async function buildPreloadedKcfxLibrary(db = null, options = {}) {
  const database = db || await ensureDb();
  await externalizeKcfxLibraryInlineRows(database);
  const manifest = publicKcfxLibrary(database);
  const targetIds = options.targetIds || null;
  const records = {};
  let rowCount = 0;
  const entries = new Map(Object.entries(database.kcfxLibrary?.records || {}));
  if (targetIds) {
    for (const id of targetIds) {
      if (!entries.has(id)) {
        const recoveredRecord = await recoverKcfxRecordFromRowsFile(id);
        if (recoveredRecord) entries.set(id, recoveredRecord);
      }
    }
  }

  for (const [id, sourceRecord] of entries.entries()) {
    if (!KC_LIBRARY_SLOT_IDS.has(id)) continue;
    if (targetIds && !targetIds.has(id)) continue;
    try {
      const record = await ensureKcfxRecordRows(database, id, sourceRecord);
      const fullRecord = await attachKcfxRecordRows(record);
      records[id] = {
        ...fullRecord,
        id,
        libraryPath: `/api/kcfx-library/records/${encodeURIComponent(id)}`,
        libraryManifestPath: '/api/kcfx-library',
        sharedSavedAt: fullRecord.serverSavedAt || fullRecord.savedAt || manifest.savedAt || ''
      };
      rowCount += Array.isArray(fullRecord.rows) ? fullRecord.rows.length : Number(fullRecord.rowCount || 0);
    } catch (error) {
      records[id] = {
        ...stripKcfxRecordRows(record),
        id,
        preloadError: error?.message || String(error)
      };
    }
  }

  return {
    ok: true,
    status: 'ready',
    source: 'server-preload',
    schemaVersion: manifest.schemaVersion,
    project: 'kcfx',
    savedAt: manifest.savedAt || '',
    records,
    recordCount: Object.keys(records).length,
    rowCount,
    preloadedAt: new Date().toISOString()
  };
}

async function refreshKcfxPreloadCache(db = null) {
  if (kcfxPreloadPromise) return kcfxPreloadPromise;
  const startedAt = new Date().toISOString();
  kcfxPreloadCache = {
    ...kcfxPreloadCache,
    ok: false,
    status: 'loading',
    startedAt,
    completedAt: '',
    error: ''
  };
  kcfxPreloadPromise = buildPreloadedKcfxLibrary(db, { targetIds: KC_PRIORITY_PRELOAD_SLOT_IDS })
    .then((payload) => {
      kcfxPreloadCache = {
        ...payload,
        startedAt,
        completedAt: new Date().toISOString()
      };
      return kcfxPreloadCache;
    })
    .catch((error) => {
      kcfxPreloadCache = {
        ...kcfxPreloadCache,
        ok: false,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: error?.message || String(error)
      };
      throw error;
    })
    .finally(() => {
      kcfxPreloadPromise = null;
    });
  return kcfxPreloadPromise;
}

function scheduleKcfxPreloadRefresh(db = null) {
  refreshKcfxPreloadCache(db).catch((error) => {
    console.error('kcfx preload refresh failed', error);
  });
}

async function getKcfxTrendRecord(db, id) {
  const source = db.kcfxLibrary?.records?.[id] || await recoverKcfxRecordFromRowsFile(id);
  if (!source) return null;
  const record = await ensureKcfxRecordRows(db, id, source);
  return attachKcfxRecordRows(record);
}

function stripKcfxTrendRecord(record = null) {
  if (!record) return null;
  return stripKcfxRecordRows(record);
}

async function buildKcfxTrendSummary() {
  const db = await ensureDb();
  const records = {};
  for (const id of KCFX_TREND_RECORD_IDS) {
    records[id] = await getKcfxTrendRecord(db, id);
  }
  const maps = buildKcfxTrendDimensionMaps(records);
  const monthSummaries = KCFX_TREND_MONTHS.map((month) => summarizeKcfxTrendMonth(month, records[month.id], maps));
  return {
    ok: true,
    status: 'ready',
    source: 'server-trend-summary',
    savedAt: db.kcfxLibrary?.savedAt || '',
    generatedAt: new Date().toISOString(),
    monthSummaries,
    records: Object.fromEntries(Object.entries(records).map(([id, record]) => [id, stripKcfxTrendRecord(record)]))
  };
}

async function readKcfxTrendSummaryCache() {
  if (kcfxTrendSummaryCache?.ok) return kcfxTrendSummaryCache;
  try {
    return await readKcfxTrendSummaryCacheFromDisk();
  } catch {
    // Missing cache is expected before the first background build.
  }
  return null;
}

async function readKcfxTrendSummaryCacheFromDisk() {
  const payload = JSON.parse(await readFile(kcfxTrendSummaryPath, 'utf8'));
  if (payload?.ok && Array.isArray(payload.monthSummaries)) {
    kcfxTrendSummaryCache = payload;
    return payload;
  }
  return null;
}

async function writeKcfxTrendSummaryCache(payload) {
  await mkdir(path.dirname(kcfxTrendSummaryPath), { recursive: true });
  await writeFile(kcfxTrendSummaryPath, JSON.stringify(payload), 'utf8');
  kcfxTrendSummaryCache = payload;
  return payload;
}

function runKcfxTrendSummaryWorker() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [kcfxTrendWorkerPath, dataDir, kcfxTrendSummaryPath], {
      cwd: rootDir,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `trend summary worker exited ${code}`));
        return;
      }
      try {
        const payload = await readKcfxTrendSummaryCacheFromDisk();
        if (!payload?.ok) throw new Error(stdout || 'trend summary worker did not write a valid cache');
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function isKcfxTrendSummaryFresh(cache, db) {
  if (!cache?.ok) return false;
  if (!db?.kcfxLibrary?.savedAt) return true;
  return cache.savedAt === db.kcfxLibrary.savedAt;
}

async function refreshKcfxTrendSummaryCache() {
  if (kcfxTrendSummaryPromise) return kcfxTrendSummaryPromise;
  kcfxTrendSummaryPromise = runKcfxTrendSummaryWorker()
    .finally(() => {
      kcfxTrendSummaryPromise = null;
    });
  return kcfxTrendSummaryPromise;
}

function scheduleKcfxTrendSummaryRefresh() {
  refreshKcfxTrendSummaryCache().catch((error) => {
    console.error('kcfx trend summary refresh failed', error);
  });
}

async function getKcfxTrendSummaryResponse() {
  const db = await ensureDb();
  const cache = await readKcfxTrendSummaryCache();
  if (isKcfxTrendSummaryFresh(cache, db)) return cache;
  scheduleKcfxTrendSummaryRefresh();
  if (cache?.ok) {
    return {
      ...cache,
      refreshing: true,
      status: 'ready'
    };
  }
  return {
    ok: false,
    status: 'loading',
    source: 'server-trend-summary',
    message: '库存货值汇总正在服务器生成中，请稍后刷新'
  };
  try {
    return await Promise.race([
      refreshKcfxTrendSummaryCache(),
      new Promise((resolve) => setTimeout(() => resolve({
        ok: false,
        status: 'loading',
        source: 'server-trend-summary',
        message: '库存货值汇总正在服务器生成中，请稍后刷新'
      }), 5000))
    ]);
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      source: 'server-trend-summary',
      error: error?.message || String(error)
    };
  }
}

async function getKcfxReceiptRecord(db, id) {
  const source = db.kcfxLibrary?.records?.[id] || await recoverKcfxRecordFromRowsFile(id);
  if (!source) return null;
  const record = await ensureKcfxRecordRows(db, id, source);
  return attachKcfxRecordRows(record);
}

function stripKcfxReceiptRecord(record = null) {
  if (!record) return null;
  return stripKcfxRecordRows(record);
}

async function readKcfxReceiptSummaryCache() {
  if (kcfxReceiptSummaryCache?.ok) return kcfxReceiptSummaryCache;
  try {
    return await readKcfxReceiptSummaryCacheFromDisk();
  } catch {
    // Missing cache is expected before the first server-side summary build.
  }
  return null;
}

async function readKcfxReceiptSummaryCacheFromDisk() {
  const payload = JSON.parse(await readFile(kcfxReceiptSummaryPath, 'utf8'));
  if (payload?.ok && Array.isArray(payload.rows)) {
    kcfxReceiptSummaryCache = payload;
    return payload;
  }
  return null;
}

async function writeKcfxReceiptSummaryCache(payload) {
  await mkdir(path.dirname(kcfxReceiptSummaryPath), { recursive: true });
  await writeFile(kcfxReceiptSummaryPath, JSON.stringify(payload), 'utf8');
  kcfxReceiptSummaryCache = payload;
  return payload;
}

function isKcfxReceiptSummaryFresh(cache, db) {
  if (!cache?.ok) return false;
  if (cache.receiptSummaryVersion !== KCFX_RECEIPT_SUMMARY_CACHE_VERSION) return false;
  if (!db?.kcfxLibrary?.savedAt) return true;
  return cache.savedAt === db.kcfxLibrary.savedAt;
}

async function buildKcfxReceiptSummary(db = null) {
  const database = db || await ensureDb();
  await externalizeKcfxLibraryInlineRows(database);
  const records = {};
  for (const id of KCFX_RECEIPT_RECORD_IDS) {
    records[id] = await getKcfxReceiptRecord(database, id);
  }
  const maps = buildKcfxReceiptDimensionMaps(records);
  const diagnostics = { matched: 0, unmatched: 0, sample: '' };
  const rows = (records['fact-2']?.rows || []).map((row) => buildKcfxReceiptSummaryRow(row, maps, diagnostics));
  const closedInventory = summarizeKcfxClosedInventory(records['fact-inventory']);
  return {
    ok: true,
    status: 'ready',
    source: 'server-receipt-summary',
    receiptSummaryVersion: KCFX_RECEIPT_SUMMARY_CACHE_VERSION,
    schemaVersion: database.kcfxLibrary?.schemaVersion || 1,
    project: 'kcfx',
    savedAt: database.kcfxLibrary?.savedAt || '',
    generatedAt: new Date().toISOString(),
    records: Object.fromEntries(Object.entries(records).map(([id, record]) => [id, stripKcfxReceiptRecord(record)])),
    rows,
    rowCount: rows.length,
    diagnostics,
    closedInventory
  };
}

async function refreshKcfxReceiptSummaryCache(db = null) {
  if (kcfxReceiptSummaryPromise) return kcfxReceiptSummaryPromise;
  kcfxReceiptSummaryPromise = buildKcfxReceiptSummary(db)
    .then((payload) => writeKcfxReceiptSummaryCache(payload))
    .finally(() => {
      kcfxReceiptSummaryPromise = null;
    });
  return kcfxReceiptSummaryPromise;
}

function scheduleKcfxReceiptSummaryRefresh(db = null) {
  refreshKcfxReceiptSummaryCache(db).catch((error) => {
    console.error('kcfx receipt summary refresh failed', error);
  });
}

async function getKcfxReceiptSummaryResponse() {
  const db = await ensureDb();
  const cache = await readKcfxReceiptSummaryCache();
  if (isKcfxReceiptSummaryFresh(cache, db)) return cache;
  if (cache?.ok) {
    scheduleKcfxReceiptSummaryRefresh(db);
    return {
      ...cache,
      refreshing: true,
      status: 'ready'
    };
  }
  if (!kcfxReceiptSummaryPromise) scheduleKcfxReceiptSummaryRefresh(db);
  if (kcfxReceiptSummaryPromise) {
    const payload = await Promise.race([
      kcfxReceiptSummaryPromise,
      new Promise((resolve) => setTimeout(() => resolve(null), 12000))
    ]);
    if (payload?.ok) return payload;
  }
  return {
    ok: false,
    status: 'loading',
    source: 'server-receipt-summary',
    message: '库存分析汇总正在服务器生成中，请稍后刷新'
  };
}

function buildKcfxReceiptDimensionMaps(records) {
  return {
    productMap: mapKcfxReceiptProductsByMaterialCode(records['dim-product']?.rows || []),
    warehouseMap: mapKcfxReceiptWarehousesByName(records['dim-warehouse']?.rows || []),
    warehouseMaterialMaps: mapKcfxReceiptWarehouseMaterialDimensions(records['dim-warehouse-material']?.rows || [])
  };
}

function buildKcfxReceiptSummaryRow(row, { productMap, warehouseMap, warehouseMaterialMaps }, diagnostics) {
  const materialCode = getKcfxReceiptDetailMaterialCode(row);
  const warehouse = getKcfxReceiptDetailWarehouse(row);
  const organization = getKcfxReceiptDetailOrganization(row);
  const materialName = getKcfxReceiptDetailMaterialName(row);
  const endingQty = getKcfxReceiptDetailEndingQty(row);
  const inventoryDays = getKcfxReceiptDetailInventoryDays(row);
  const product = productMap.get(materialCode) || {};
  const settlementPrice = Number(product.settlementPrice) || 0;
  const ageQuantities = getKcfxReceiptAgeQuantities(row);
  const ageSettlementAmounts = Object.fromEntries(
    Object.entries(ageQuantities).map(([label, qty]) => [label, qty * settlementPrice])
  );
  const warehouseInfo = warehouseMap.get(warehouse) || {};
  const department = lookupKcfxReceiptDepartment(warehouseMaterialMaps, row) || getKcfxReceiptDetailDepartment(row);
  recordKcfxReceiptDepartmentMatch(diagnostics, department, row);
  const productCategory = product.productCategory || '';
  const warehouseType = warehouseInfo.warehouseType || '';
  return {
    materialCode,
    sku: product.sku || '',
    materialName,
    department,
    productCategory,
    productLine: product.productLine || '',
    series: product.series || '',
    warehouseType,
    saleStatus: classifyKcfxReceiptSaleStatus(warehouseType, productCategory),
    warehouseLocation: warehouseInfo.warehouseLocation || '',
    warehouse,
    organization,
    inventoryDays,
    pmcType: '',
    pmcBasis: '',
    pmcReason: '',
    ageQuantities,
    ageSettlementAmounts,
    ageQuantityTotal: sumKcfxObjectValues(ageQuantities),
    ageSettlementAmount: sumKcfxObjectValues(ageSettlementAmounts),
    inventoryTotal: sumKcfxObjectValues(ageQuantities),
    inventoryAmountTotal: sumKcfxObjectValues(ageSettlementAmounts),
    endingQty,
    settlementPrice,
    settlementAmount: endingQty * settlementPrice
  };
}

function summarizeKcfxClosedInventory(record) {
  const rows = record?.rows || [];
  let qty = 0;
  let value = 0;
  for (const row of rows) {
    const rowQty = kcfxReceiptFirstNumber([kcfxNthValue(row, 7)]);
    const trueCost = kcfxReceiptFirstNumber([kcfxNthValue(row, 8)]);
    qty += rowQty;
    value += rowQty * trueCost;
  }
  return {
    qty,
    value,
    rowCount: rows.length,
    record: stripKcfxReceiptRecord(record)
  };
}

function mapKcfxReceiptProductsByMaterialCode(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeKcfxMaterialCode(kcfxReceiptFirstText([kcfxReceiptFirstValue(row, ['物料编码']), kcfxNthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      sku: kcfxReceiptFirstText([kcfxReceiptFirstValue(row, ['SKU', 'sku']), kcfxNthValue(row, 3)]),
      productCategory: kcfxReceiptFirstText([kcfxReceiptFirstValue(row, ['销售产品分类', '产品分类', '销售产品类别', '产品类别', '品类'])]),
      productLine: kcfxReceiptFirstText([kcfxReceiptFirstValue(row, ['销售产品线', '产品线']), kcfxNthValue(row, 7)]),
      series: kcfxReceiptFirstText([kcfxReceiptFirstValue(row, ['销售系列', '系列']), kcfxNthValue(row, 8)]),
      settlementPrice: kcfxReceiptFirstNumber([
        kcfxReceiptFirstValue(row, ['结算价(含税)', '结算价（含税）', '结算价含税', '结算价', '内部结算价', '26年内部结算价', '2026年内部结算价']),
        kcfxReceiptFirstValueByHeaderIncludes(row, ['结算价']),
        kcfxNthValue(row, 9)
      ])
    });
  }
  return map;
}

function mapKcfxReceiptWarehousesByName(rows) {
  const map = new Map();
  for (const row of rows) {
    const warehouse = normalizeKcfxText(kcfxNthValue(row, 2));
    if (!warehouse || map.has(warehouse)) continue;
    map.set(warehouse, {
      warehouseType: normalizeKcfxText(kcfxReceiptFirstValue(row, ['一级仓库分类'])),
      warehouseLocation: kcfxReceiptFirstText([kcfxReceiptFirstValue(row, ['二级仓库分类', '仓库位置', '位置']), kcfxNthValue(row, 8)])
    });
  }
  return map;
}

function mapKcfxReceiptWarehouseMaterialDimensions(rows) {
  const departmentByFactKey = new Map();
  for (const row of rows) {
    const factStyleKey = normalizeKcfxReceiptDepartmentKey(kcfxNthValue(row, 6));
    const department = normalizeKcfxText(kcfxNthValue(row, 7) || kcfxReceiptFirstValue(row, ['事业部']));
    if (factStyleKey && department && !departmentByFactKey.has(factStyleKey)) departmentByFactKey.set(factStyleKey, department);
  }
  return { departmentByFactKey };
}

function lookupKcfxReceiptDepartment(maps, row) {
  for (const key of makeKcfxReceiptDepartmentLookupKeys(row)) {
    const department = maps.departmentByFactKey.get(key);
    if (department) return department;
  }
  return '';
}

function makeKcfxReceiptDepartmentLookupKeys(row) {
  return [...new Set([
    [kcfxNthValue(row, 4), kcfxNthValue(row, 3), kcfxNthValue(row, 1)].join(''),
    [
      kcfxReceiptFirstValue(row, ['库存组织', '使用组织', '组织']),
      kcfxReceiptFirstValue(row, ['仓库名称', '仓库', '金蝶仓库', '库存仓库']),
      kcfxReceiptFirstValue(row, ['物料编码', '货品编码', '商品编码', 'SKU'])
    ].join(''),
    [kcfxNthValue(row, 3), kcfxNthValue(row, 4), kcfxNthValue(row, 1)].join('')
  ].map(normalizeKcfxReceiptDepartmentKey).filter(Boolean))];
}

function normalizeKcfxReceiptDepartmentKey(value) {
  return normalizeKcfxMaterialCode(value).replace(/&/g, '').toLowerCase();
}

function recordKcfxReceiptDepartmentMatch(diagnostics, department, row) {
  if (department) {
    diagnostics.matched += 1;
    return;
  }
  diagnostics.unmatched += 1;
  if (!diagnostics.sample) {
    diagnostics.sample = `D&C&A=${escapeKcfxReceiptStatusText([kcfxNthValue(row, 4), kcfxNthValue(row, 3), kcfxNthValue(row, 1)].join('&'))}`;
  }
}

function escapeKcfxReceiptStatusText(value) {
  const text = normalizeKcfxText(value);
  return text.length > 24 ? `${text.slice(0, 24)}...` : text || '-';
}

function getKcfxReceiptDetailMaterialCode(row) {
  return normalizeKcfxMaterialCode(kcfxNthValue(row, 1) || kcfxReceiptFirstValue(row, ['物料编码', '货品编码', '商品编码', 'SKU']));
}

function getKcfxReceiptDetailWarehouse(row) {
  return normalizeKcfxText(kcfxReceiptFirstText([
    kcfxNthValue(row, 3),
    kcfxReceiptFirstValue(row, ['仓库', '仓库名称', '金蝶仓库', '库存仓库']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['仓库'])
  ]));
}

function getKcfxReceiptDetailOrganization(row) {
  return normalizeKcfxText(kcfxReceiptFirstText([
    kcfxNthValue(row, 4),
    kcfxReceiptFirstValue(row, ['使用组织', '库存组织', '组织']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['组织'])
  ]));
}

function getKcfxReceiptDetailMaterialName(row) {
  return normalizeKcfxText(kcfxReceiptFirstValue(row, ['物料名称', '货品名称', '商品名称', '金蝶名称']));
}

function getKcfxReceiptDetailEndingQty(row) {
  return kcfxReceiptFirstNumber([
    kcfxReceiptFirstValue(row, ['合计库存数量', '合计数量', '合计']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['合计', '库存', '数量']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['合计', '数量']),
    kcfxReceiptFirstValue(row, ['0430结余库存数量', '4月30日结余库存数量', '结余库存数量']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['0430', '结余', '库存', '数量']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['结余', '库存', '数量'])
  ]);
}

function getKcfxReceiptDetailInventoryDays(row) {
  return kcfxReceiptFirstOptionalNumber([
    kcfxReceiptFirstValue(row, ['库存天数', '库龄', '库龄天数', '在库天数', '库存周转天数']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['库存', '天数']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['库龄']),
    kcfxReceiptFirstValueByHeaderIncludes(row, ['在库', '天数'])
  ]);
}

function getKcfxReceiptDetailDepartment(row) {
  return normalizeKcfxText(kcfxReceiptFirstText([
    kcfxNthValue(row, 21),
    kcfxReceiptFirstValue(row, ['事业部'])
  ]));
}

function getKcfxReceiptAgeQuantities(row) {
  return Object.fromEntries(KCFX_RECEIPT_AGE_DEFINITIONS.map((definition) => [
    definition.label,
    getKcfxReceiptAgeQuantity(row, definition)
  ]));
}

function getKcfxReceiptAgeQuantity(row, definition) {
  return kcfxReceiptFirstOptionalNumber([
    ...definition.candidates.map((name) => kcfxReceiptFirstValue(row, [name])),
    kcfxReceiptFirstValueByHeaderIncludes(row, [definition.label, '数量'])
  ]) || 0;
}

function classifyKcfxReceiptSaleStatus(warehouseType, productCategory) {
  const type = normalizeKcfxText(warehouseType);
  const category = normalizeKcfxText(productCategory);
  if (KCFX_RECEIPT_SALEABLE_NEW_WAREHOUSE_TYPES.has(type)) return '可售-全新品';
  if (KCFX_RECEIPT_RAW_MATERIAL_WAREHOUSE_TYPES.has(type)) return '不可售-原材料';
  if (KCFX_RECEIPT_OTHER_UNSALEABLE_WAREHOUSE_TYPES.has(type)) return '不可售-集成/在途/配件等';
  if (type.includes('销售退货拆检仓')) {
    if (KCFX_RECEIPT_SALEABLE_RETURN_CATEGORIES.has(category)) return '可售-已拆检';
    if (KCFX_RECEIPT_UNINSPECTED_RETURN_CATEGORIES.has(category)) return '不可售-未拆检';
    if (KCFX_RECEIPT_OTHER_UNSALEABLE_RETURN_CATEGORIES.has(category)) return '不可售-集成/在途/配件等';
  }
  return '';
}

function kcfxReceiptFirstText(candidates) {
  for (const candidate of candidates) {
    const text = normalizeKcfxText(candidate);
    if (text) return text;
  }
  return '';
}

function kcfxReceiptFirstNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeKcfxText(candidate);
    const value = kcfxReceiptToNumber(candidate);
    if (value !== 0 || text === '0') return value;
  }
  return 0;
}

function kcfxReceiptFirstOptionalNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeKcfxText(candidate);
    if (!text) continue;
    const value = kcfxReceiptToNumber(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function kcfxReceiptToNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = normalizeKcfxText(value);
  if (!text || text.startsWith('#')) return 0;
  const parsed = Number(text.replace(/[,，\s￥¥元]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function kcfxReceiptFirstValue(row, names = []) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row || {}, name)) return row[name];
  }
  const normalizedNames = names.map(normalizeKcfxHeaderName);
  for (const [key, value] of Object.entries(row || {})) {
    if (key === '__cells') continue;
    if (normalizedNames.includes(normalizeKcfxHeaderName(key))) return value;
  }
  return '';
}

function kcfxReceiptFirstValueByHeaderIncludes(row, requiredParts = []) {
  const parts = requiredParts.map(normalizeKcfxHeaderName).filter(Boolean);
  if (!parts.length) return '';
  for (const [key, value] of Object.entries(row || {})) {
    if (key === '__cells') continue;
    const header = normalizeKcfxHeaderName(key);
    if (parts.every((part) => header.includes(part))) return value;
  }
  return '';
}

function sumKcfxObjectValues(object) {
  return Object.values(object || {}).reduce((total, value) => total + (Number(value) || 0), 0);
}

function summarizeKcfxTrendMonth(month, record, maps) {
  const sourceRows = record?.rows || [];
  const rows = sourceRows.length ? sourceRows.slice(0, -1) : [];
  const qtyAccessor = makeKcfxTrendQtyAccessor(sourceRows[0]);
  const priceAccessor = makeKcfxTrendPriceAccessor(sourceRows[0]);
  const groupedItems = new Map();
  const summary = {
    ...month,
    record: stripKcfxTrendRecord(record),
    totalRows: sourceRows.length,
    skippedSummaryRows: sourceRows.length ? 1 : 0,
    usedRows: 0,
    totalQty: 0,
    totalValue: 0,
    pricedRows: 0,
    directPricedRows: 0,
    fallbackPricedRows: 0,
    items: [],
    unclassifiedRows: [],
    unclassifiedTruncated: false
  };

  for (const row of rows) {
    const materialA = normalizeKcfxMaterialCode(kcfxNthValue(row, 1));
    const materialB = normalizeKcfxMaterialCode(kcfxNthValue(row, 2));
    const materialName = normalizeKcfxText(kcfxNthValue(row, 3));
    const warehouse = normalizeKcfxText(kcfxNthValue(row, 4));
    const qty = kcfxTrendToNumber(qtyAccessor(row));
    if (!qty) continue;
    const directSettlementPrice = kcfxTrendToNumber(priceAccessor(row));
    const fallbackSettlementPrice = maps.settlementPriceByMaterial.get(materialB) || 0;
    const settlementPrice = directSettlementPrice || fallbackSettlementPrice;
    const value = qty * settlementPrice;

    const department = maps.departmentByKey.get(makeKcfxTrendDepartmentKey(materialA, warehouse, materialB)) || '';
    const productLine = maps.productLineByMaterial.get(materialB) || '';
    const productSeries = maps.productSeriesByMaterial.get(materialB) || '';
    const warehouseType = maps.warehouseTypeByName.get(normalizeKcfxText(warehouse)) || '';
    const warehouseLocation = maps.warehouseLocationByName.get(normalizeKcfxText(warehouse)) || '';
    const item = {
      qty,
      value,
      warehouseType: warehouseType || '未分类仓库类型',
      department: department || '未匹配事业部',
      productLine: productLine || '未分类产品线',
      productSeries: productSeries || '未分类销售系列',
      warehouseLocation: warehouseLocation || '未分类仓库位置'
    };
    const groupKey = [
      item.warehouseType,
      item.department,
      item.productLine,
      item.productSeries,
      item.warehouseLocation
    ].join('\u001f');
    const grouped = groupedItems.get(groupKey) || { ...item, qty: 0, value: 0 };
    grouped.qty += qty;
    grouped.value += value;
    groupedItems.set(groupKey, grouped);

    summary.usedRows += 1;
    summary.totalQty += qty;
    summary.totalValue += value;
    if (settlementPrice) summary.pricedRows += 1;
    if (directSettlementPrice) summary.directPricedRows += 1;
    else if (fallbackSettlementPrice) summary.fallbackPricedRows += 1;

    const missingReasons = [
      department ? '' : '未区分事业部',
      productLine ? '' : '未区分产品线',
      warehouseLocation ? '' : '未分类仓库位置'
    ].filter(Boolean);
    if (missingReasons.length) {
      if (summary.unclassifiedRows.length < KCFX_TREND_UNCLASSIFIED_LIMIT) {
        summary.unclassifiedRows.push({
          month: month.label,
          reason: missingReasons.join('、'),
          materialA,
          materialCode: materialB,
          materialName,
          warehouse,
          qty,
          department,
          productLine,
          warehouseLocation
        });
      } else {
        summary.unclassifiedTruncated = true;
      }
    }
  }

  summary.items = [...groupedItems.values()];
  return summary;
}

function buildKcfxTrendDimensionMaps(records) {
  const departmentByKey = new Map();
  for (const row of records['dim-warehouse-material']?.rows || []) {
    const key = normalizeKcfxTrendDepartmentKey(kcfxNthValue(row, 6));
    const department = normalizeKcfxText(kcfxNthValue(row, 7));
    if (key && department && !departmentByKey.has(key)) departmentByKey.set(key, department);
  }

  const warehouseTypeByName = new Map();
  const warehouseLocationByName = new Map();
  for (const row of records['dim-warehouse']?.rows || []) {
    const warehouseName = normalizeKcfxText(kcfxNthValue(row, 2));
    const warehouseType = normalizeKcfxText(kcfxNthValue(row, 7));
    const warehouseLocation = normalizeKcfxText(kcfxNthValue(row, 8));
    if (warehouseName && warehouseType && !warehouseTypeByName.has(warehouseName)) warehouseTypeByName.set(warehouseName, warehouseType);
    if (warehouseName && warehouseLocation && !warehouseLocationByName.has(warehouseName)) warehouseLocationByName.set(warehouseName, warehouseLocation);
  }

  const productLineByMaterial = new Map();
  const productSeriesByMaterial = new Map();
  const settlementPriceByMaterial = new Map();
  for (const row of records['dim-product']?.rows || []) {
    const materialCode = normalizeKcfxMaterialCode(kcfxNthValue(row, 1));
    const productLine = normalizeKcfxText(kcfxNthValue(row, 7));
    const productSeries = normalizeKcfxText(kcfxNthValue(row, 8));
    if (materialCode && productLine && !productLineByMaterial.has(materialCode)) productLineByMaterial.set(materialCode, productLine);
    if (materialCode && productSeries && !productSeriesByMaterial.has(materialCode)) productSeriesByMaterial.set(materialCode, productSeries);
    const price = kcfxTrendToNumber(kcfxNthValue(row, 10));
    if (materialCode && price && !settlementPriceByMaterial.has(materialCode)) settlementPriceByMaterial.set(materialCode, price);
  }

  const inventoryMonthRows = records['fact-2']?.rows || [];
  const monthPriceAccessor = makeKcfxTrendPriceAccessor(inventoryMonthRows[0]);
  for (const row of inventoryMonthRows) {
    const materialCode = normalizeKcfxMaterialCode(kcfxNthValue(row, 1));
    const price = kcfxTrendToNumber(monthPriceAccessor(row));
    if (materialCode && price) settlementPriceByMaterial.set(materialCode, price);
  }

  return { departmentByKey, warehouseTypeByName, warehouseLocationByName, productLineByMaterial, productSeriesByMaterial, settlementPriceByMaterial };
}

function makeKcfxTrendDepartmentKey(materialA, warehouse, materialB) {
  return normalizeKcfxTrendDepartmentKey(`${materialA}${warehouse}${materialB}`);
}

function normalizeKcfxTrendDepartmentKey(value) {
  return normalizeKcfxMaterialCode(value).replace(/&/g, '').toLowerCase();
}

function normalizeKcfxMaterialCode(value) {
  return normalizeKcfxText(value).replace(/\s+/g, '');
}

function makeKcfxTrendPriceAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeKcfxTrendHeaderText(key) }));
  const preferred = normalized.find(({ text }) => text.includes('结算价') && text.includes('含税'))
    || normalized.find(({ text }) => text.includes('结算价'))
    || normalized.find(({ text }) => text.includes('含税') && text.includes('价'));
  return preferred ? (row) => row?.[preferred.key] : (row) => kcfxNthValue(row, 16);
}

function makeKcfxTrendQtyAccessor(sampleRow) {
  const keys = Object.keys(sampleRow || {});
  const normalized = keys.map((key) => ({ key, text: normalizeKcfxTrendHeaderText(key) }));
  const preferred = normalized.find(({ text }) => text.includes('结余库存数量'))
    || normalized.find(({ text }) => text.includes('结存') && text.includes('数量'))
    || normalized.find(({ text }) => text.includes('库存数量') && !text.includes('占比'))
    || normalized.find(({ text }) => text === '数量');
  return preferred ? (row) => row?.[preferred.key] : (row) => kcfxNthValue(row, 11);
}

function normalizeKcfxTrendHeaderText(value) {
  return normalizeKcfxText(value)
    .replace(/[()\[\]（）【】\s_：:、]/g, '')
    .toLowerCase();
}

function kcfxTrendToNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = normalizeKcfxText(value);
  if (!text || text.startsWith('#')) return 0;
  const parsed = Number(text.replace(/[,，\s￥¥元]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function filterKcfxPreloadCacheByIds(payload, idsParam) {
  const idSet = normalizeKcfxIds(idsParam);
  if (!idSet) return payload;
  const records = Object.fromEntries(
    Object.entries(payload.records || {}).filter(([id]) => idSet.has(id))
  );
  const rowCount = Object.values(records).reduce((total, record) => {
    if (Array.isArray(record?.rows)) return total + record.rows.length;
    return total + Number(record?.rowCount || 0);
  }, 0);
  return {
    ...payload,
    records,
    recordCount: Object.keys(records).length,
    rowCount
  };
}

function kcfxPreloadCacheHasIds(payload, targetIds) {
  if (!payload || payload.status !== 'ready') return false;
  return [...targetIds].every((id) => Array.isArray(payload.records?.[id]?.rows));
}

function kcfxTargetIdsArePriority(targetIds) {
  return [...targetIds].every((id) => KC_PRIORITY_PRELOAD_SLOT_IDS.has(id));
}

function kcfxPreloadLoadingResponse(targetIds) {
  return {
    ok: false,
    status: 'loading',
    source: 'server-preload',
    schemaVersion: 1,
    project: 'kcfx',
    savedAt: kcfxPreloadCache.savedAt || '',
    records: Object.fromEntries([...targetIds].map((id) => [id, kcfxPreloadCache.records?.[id] || { id }])),
    recordCount: 0,
    rowCount: 0,
    message: '文件库预热数据正在服务器生成中'
  };
}

function sanitizeKcfxLibraryRecord(id, record = {}) {
  const sanitized = {
    ...record,
    id,
    savedAt: record.savedAt || new Date().toISOString(),
    appliedAt: record.appliedAt || record.savedAt || new Date().toISOString()
  };
  if (Array.isArray(record.rows)) sanitized.rows = record.rows;
  return sanitized;
}

function normalizeKcfxText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function normalizeKcfxHeaderName(value) {
  return normalizeKcfxText(value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeKcfxHeaderCell(value, index) {
  const text = normalizeKcfxText(value);
  return text || `__EMPTY_${index + 1}`;
}

function normalizeKcfxCellValue(value, rawValue = value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  if (typeof value === 'string' && value.startsWith('#')) return '';
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && !Number.isInteger(rawValue)) return rawValue;
  return value;
}

function kcfxRowFromHeaderValues(headers, values, rawValues = []) {
  const normalizedValues = values.map((value, index) => normalizeKcfxCellValue(value, rawValues[index]));
  const row = { __cells: normalizedValues };
  headers.forEach((header, index) => {
    row[header] = normalizedValues[index];
  });
  return row;
}

function kcfxHeaderKeywordsForSlot(slot = {}) {
  const common = ['物料', '编码', '数量', '库存', '仓库', '组织', '结存', '结余'];
  if (slot.id === 'fact-inventory') {
    return [...common, '结存数量', '真实成本', '真实成本单价', '货品'];
  }
  if (slot.id === 'fact-2') {
    return [...common, '0430', '结余库存数量', '结算价', '库龄', '销售产品线', '销售系列'];
  }
  if (/^fact-[3-8]$/.test(slot.id || '')) {
    return [...common, '结算价', '含税', '库存数量', '期末', '收发'];
  }
  return common;
}

function scoreKcfxHeaderCandidate(headers, rows, headerIndex, slot = {}) {
  const normalizedHeaders = headers.map(normalizeKcfxHeaderName);
  const nonEmptyHeaders = normalizedHeaders.filter((header) => header && !header.startsWith('__empty_'));
  const headerText = normalizedHeaders.join('|');
  const keywordScore = kcfxHeaderKeywordsForSlot(slot)
    .reduce((score, keyword) => score + (headerText.includes(normalizeKcfxHeaderName(keyword)) ? 1 : 0), 0);
  const configured = Number.isInteger(slot.skipRows) ? slot.skipRows : 0;
  const configuredBonus = headerIndex === configured ? 6 : 0;
  const firstRowBonus = headerIndex === 0 ? 2 : 0;
  const rowsScore = Math.min(rows.length, 20) / 2;
  const emptyHeaderPenalty = Math.max(0, headers.length - nonEmptyHeaders.length) / 2;
  const numericHeaderPenalty = nonEmptyHeaders.filter((header) => /^-?\d+(\.\d+)?$/.test(header)).length * 3;
  return keywordScore * 20 + nonEmptyHeaders.length * 2 + rowsScore + configuredBonus + firstRowBonus - emptyHeaderPenalty - numericHeaderPenalty;
}

function kcfxHeaderRowCandidates(slot = {}, matrixLength = 0) {
  const configured = Number.isInteger(slot.skipRows) ? slot.skipRows : 0;
  const maxIndex = Math.max(0, Math.min(matrixLength - 1, 9));
  const candidates = [configured, 0, 3];
  for (let index = 0; index <= maxIndex; index += 1) candidates.push(index);
  return [...new Set(candidates)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < Math.max(matrixLength, 1));
}

function parseKcfxRowsFromHeaderIndex(matrix, headerIndex, slot = {}) {
  const headerValues = matrix[headerIndex] || [];
  const headers = headerValues.map((value, index) => normalizeKcfxHeaderCell(value, index));
  const rows = matrix.slice(headerIndex + 1)
    .filter((values) => Array.isArray(values) && values.some((value) => normalizeKcfxText(value) !== ''))
    .map((values) => kcfxRowFromHeaderValues(headers, values));
  return {
    headerRowIndex: headerIndex,
    headerRowNumber: headerIndex + 1,
    parseNote: `${headerIndex + 1} 行作为表头`,
    headers,
    rows,
    score: scoreKcfxHeaderCandidate(headers, rows, headerIndex, slot)
  };
}

function chooseKcfxHeaderCandidate(candidates) {
  if (!candidates.length) {
    return {
      headerRowIndex: 0,
      headerRowNumber: 1,
      parseNote: '未找到可解析表头',
      headers: [],
      rows: [],
      score: 0
    };
  }
  return [...candidates].sort((a, b) => b.score - a.score || a.headerRowIndex - b.headerRowIndex)[0];
}

function pickKcfxSheetName(workbook, slot = {}) {
  const sheetNames = workbook.SheetNames || [];
  const hint = normalizeKcfxHeaderName(slot.sheetHint || '');
  if (hint) {
    const matched = sheetNames.find((name) => normalizeKcfxHeaderName(name) === hint)
      || sheetNames.find((name) => normalizeKcfxHeaderName(name).includes(hint) || hint.includes(normalizeKcfxHeaderName(name)));
    if (matched) return matched;
  }
  return sheetNames[0];
}

function parseKcfxWorkbookRows(workbook, slot) {
  const sheetName = pickKcfxSheetName(workbook, slot);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('missing sheet');
  const matrix = xlsx.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: true,
    range: 0
  });
  const candidates = kcfxHeaderRowCandidates(slot, matrix.length)
    .map((rowIndex) => parseKcfxRowsFromHeaderIndex(matrix, rowIndex, slot))
    .filter(Boolean);
  const selected = chooseKcfxHeaderCandidate(candidates);
  return {
    sheetName,
    headerRowNumber: selected.headerRowNumber,
    parseNote: selected.parseNote,
    attemptedHeaderRows: candidates.map((candidate) => ({
      headerRowNumber: candidate.headerRowNumber,
      rowCount: candidate.rows.length,
      score: candidate.score,
      headerFirst6: candidate.headers.slice(0, 6)
    })),
    headers: selected.headers,
    rows: selected.rows
  };
}

function kcfxNthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) return row.__cells[index] ?? '';
  return Object.entries(row || {})
    .filter(([key]) => key !== '__cells')
    .map(([, value]) => value)[index] ?? '';
}

function buildKcfxParseDiagnostics(parsed) {
  const rows = parsed.rows || [];
  const headers = parsed.headers || Object.keys(rows[0] || {});
  return {
    sheetName: parsed.sheetName || '',
    headerRowNumber: parsed.headerRowNumber || 1,
    parseNote: parsed.parseNote || '',
    attemptedHeaderRows: parsed.attemptedHeaderRows || [],
    headerFirst12: headers.slice(0, 12),
    gHeader: headers[6] || '',
    hHeader: headers[7] || '',
    adHeader: headers[29] || '',
    gSamples: rows.slice(0, 3).map((row) => kcfxNthValue(row, 7)),
    hSamples: rows.slice(0, 3).map((row) => kcfxNthValue(row, 8)),
    adSamples: rows.slice(0, 3).map((row) => kcfxNthValue(row, 30))
  };
}

function defaultKcfxSheetHint(slotId) {
  if (slotId === 'dim-purchase-division') return '产品线明细';
  if (slotId === 'dim-product') return 'Dim-YL医疗器械商品分类';
  return '';
}

function parseKcfxSlotPayload(slotId, payload) {
  let slot = {};
  try {
    slot = payload ? JSON.parse(payload) : {};
  } catch {
    slot = {};
  }
  return {
    id: slotId,
    type: String(slot.type || ''),
    title: String(slot.title || slotId),
    expectedName: String(slot.expectedName || ''),
    sheetHint: String(slot.sheetHint || defaultKcfxSheetHint(slotId)),
    skipRows: Number.isInteger(Number(slot.skipRows)) ? Number(slot.skipRows) : undefined
  };
}

function scoreReadableFileName(name) {
  const text = String(name || '');
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const replacement = (text.match(/\uFFFD/g) || []).length;
  const mojibake = (text.match(/[ÃÂÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) || []).length;
  return chinese * 4 - replacement * 6 - mojibake;
}

function normalizeUploadedFileName(name) {
  const originalName = String(name || '');
  if (!originalName) return originalName;
  const decoded = Buffer.from(originalName, 'latin1').toString('utf8');
  return scoreReadableFileName(decoded) > scoreReadableFileName(originalName) ? decoded : originalName;
}

function buildKcfxFileRecord(file, storedFile, slot, parsed) {
  const completedAt = new Date().toISOString();
  const fileName = normalizeUploadedFileName(file.originalname);
  return {
    id: slot.id,
    type: slot.type,
    title: slot.title,
    expectedName: slot.expectedName,
    fileName,
    size: file.size,
    lastModified: Date.now(),
    savedAt: completedAt,
    appliedAt: completedAt,
    sheetName: parsed.sheetName,
    serverFileName: storedFile.fileName,
    serverFilePath: storedFile.relativePath,
    serverFileCategory: 'original',
    serverFileLibrary: 'maintenance-library',
    parseStatus: 'ready',
    parseCompletedAt: completedAt,
    parseDiagnostics: {
      ...buildKcfxParseDiagnostics(parsed),
      readMode: 'server',
      fallbackAttempts: []
    },
    rows: parsed.rows
  };
}

function buildQueuedKcfxFileRecord(file, storedFile, slot, previousRecord, requestUserName) {
  const queuedAt = new Date().toISOString();
  const fileName = normalizeUploadedFileName(file.originalname);
  const { rows, ...previousMetadata } = previousRecord || {};
  return {
    ...previousMetadata,
    ...preserveKcfxRowsMetadata(previousRecord),
    id: slot.id,
    type: slot.type,
    title: slot.title,
    expectedName: slot.expectedName,
    fileName,
    size: file.size,
    lastModified: Date.now(),
    savedAt: queuedAt,
    appliedAt: previousRecord?.appliedAt || queuedAt,
    serverFileName: storedFile.fileName,
    serverFilePath: storedFile.relativePath,
    serverFileCategory: 'original',
    serverFileLibrary: 'maintenance-library',
    serverSavedAt: queuedAt,
    serverSavedBy: requestUserName,
    parseStatus: 'queued',
    parseQueuedAt: queuedAt,
    parseStartedAt: '',
    parseCompletedAt: '',
    parseFailedAt: '',
    parseError: ''
  };
}

function parseKcfxClientRecordPayload(payload) {
  if (!payload) return null;
  try {
    const record = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (!Array.isArray(record?.rows)) return null;
    return record;
  } catch {
    return null;
  }
}

function buildKcfxClientParsedFileRecord(file, storedFile, slot, clientRecord) {
  const completedAt = new Date().toISOString();
  const diagnostics = clientRecord.parseDiagnostics || {};
  const fileName = normalizeUploadedFileName(file.originalname);
  return {
    id: slot.id,
    type: slot.type,
    title: slot.title,
    expectedName: slot.expectedName,
    fileName,
    size: file.size,
    lastModified: Number(clientRecord.lastModified || Date.now()),
    savedAt: completedAt,
    appliedAt: completedAt,
    sheetName: clientRecord.sheetName || diagnostics.sheetName || '',
    serverFileName: storedFile.fileName,
    serverFilePath: storedFile.relativePath,
    serverFileCategory: 'original',
    serverFileLibrary: 'maintenance-library',
    parseStatus: 'ready',
    parseCompletedAt: completedAt,
    parseSource: 'browser',
    parseDiagnostics: {
      ...diagnostics,
      readMode: diagnostics.readMode || 'browser',
      fallbackAttempts: Array.isArray(diagnostics.fallbackAttempts) ? diagnostics.fallbackAttempts : []
    },
    rows: clientRecord.rows
  };
}

async function saveKcfxOriginalFile(slotId, file) {
  const savedAt = new Date();
  const year = format(savedAt, 'yyyy');
  const month = format(savedAt, 'MM');
  const safeSlotId = path.basename(slotId);
  const slotDir = path.join(kcfxFileDir, year, month, safeSlotId);
  await mkdir(slotDir, { recursive: true });
  const ext = path.extname(file.originalname || '').slice(0, 16);
  const fileName = `${safeSlotId}-${format(savedAt, 'yyyyMMdd-HHmmss')}-${randomUUID()}${ext}`;
  const fullPath = path.join(slotDir, fileName);
  await rename(file.path, fullPath);
  return {
    fullPath,
    fileName,
    relativePath: safeArchiveName(path.join(year, month, safeSlotId, fileName))
  };
}

async function removeKcfxStoredFile(record) {
  if (!record?.serverFileName || !record?.id) return;
  const relativePath = record.serverFilePath
    ? safeArchiveName(record.serverFilePath)
    : safeArchiveName(path.join(path.basename(record.id), path.basename(record.serverFileName)));
  const candidates = [
    path.join(kcfxFileDir, relativePath),
    path.join(legacyKcfxFileDir, path.basename(record.id), path.basename(record.serverFileName))
  ];
  for (const candidate of candidates) {
    try {
      await unlink(candidate);
      return;
    } catch {
      // Keep current request successful if an old file has already been removed.
    }
  }
}

function parseKcfxWorkbookFile(filePath, slot) {
  const workbook = xlsx.readFile(filePath, {
    cellDates: true,
    dense: true,
    cellHTML: false,
    cellNF: false,
    cellStyles: false
  });
  return parseKcfxWorkbookRows(workbook, slot);
}

function scheduleKcfxFileParse(job) {
  setTimeout(() => {
    parseKcfxStoredFile(job).catch((error) => {
      console.error('kcfx background parse failed', error);
    });
  }, 0);
}

async function parseKcfxStoredFile({ id, slot, file, storedFile, previousRecord, requestUserName }) {
  const parseStartedAt = new Date().toISOString();
  let db = await ensureDb();
  const currentRecord = db.kcfxLibrary.records[id];
  if (!currentRecord || currentRecord.serverFilePath !== storedFile.relativePath) return;
  db.kcfxLibrary.records[id] = {
    ...currentRecord,
    parseStatus: 'parsing',
    parseStartedAt,
    parseError: ''
  };
  db.kcfxLibrary.savedAt = parseStartedAt;
  await saveDb(db);

  try {
    const parsed = parseKcfxWorkbookFile(storedFile.fullPath, slot);
    if (!parsed.rows.length) throw new Error('file parsed no valid rows');
    const record = await externalizeKcfxRecordRows(buildKcfxFileRecord(file, storedFile, slot, parsed), id);
    db = await ensureDb();
    const latestRecord = db.kcfxLibrary.records[id];
    if (!latestRecord || latestRecord.serverFilePath !== storedFile.relativePath) return;
    db.kcfxLibrary.records[id] = {
      ...record,
      serverSavedAt: latestRecord.serverSavedAt || record.savedAt,
      serverSavedBy: requestUserName,
      parseQueuedAt: latestRecord.parseQueuedAt || record.savedAt,
      parseStartedAt
    };
    db.kcfxLibrary.savedAt = new Date().toISOString();
    await removeKcfxStoredFile(previousRecord);
    pushLog(db, 'kcfx file library parsed', requestUserName, `${requestUserName} uploaded and parsed ${record.title || id}`);
    await saveDb(db);
    scheduleKcfxPreloadRefresh(db);
    scheduleKcfxReceiptSummaryRefresh(db);
    scheduleKcfxTrendSummaryRefresh();
  } catch (error) {
    db = await ensureDb();
    const latestRecord = db.kcfxLibrary.records[id];
    if (!latestRecord || latestRecord.serverFilePath !== storedFile.relativePath) return;
    db.kcfxLibrary.records[id] = {
      ...latestRecord,
      ...preserveKcfxRowsMetadata(previousRecord),
      parseStatus: 'failed',
      parseFailedAt: new Date().toISOString(),
      parseError: error?.message || 'parse failed'
    };
    db.kcfxLibrary.savedAt = new Date().toISOString();
    pushLog(db, 'kcfx file library parse failed', requestUserName, `${requestUserName} uploaded ${latestRecord.title || id}, background parse failed`);
    await saveDb(db);
    scheduleKcfxPreloadRefresh(db);
    scheduleKcfxReceiptSummaryRefresh(db);
    scheduleKcfxTrendSummaryRefresh();
  }
}

app.get('/api/kcfx-library', async (req, res) => {
  const db = await ensureDb();
  await externalizeKcfxLibraryInlineRows(db);
  res.json(publicKcfxLibrary(db, { includeRows: req.query.includeRows === '1' }));
});

app.get('/api/kcfx-library/preloaded', async (req, res) => {
  try {
    const targetIds = normalizeKcfxIds(req.query.ids);
    res.setHeader('Cache-Control', 'no-store');
    if (targetIds) {
      if (kcfxPreloadCacheHasIds(kcfxPreloadCache, targetIds)) {
        return res.json(filterKcfxPreloadCacheByIds(kcfxPreloadCache, [...targetIds].join(',')));
      }
      if (kcfxTargetIdsArePriority(targetIds)) {
        if (!kcfxPreloadPromise) scheduleKcfxPreloadRefresh();
        if (kcfxPreloadPromise) {
          const cachedPayload = await Promise.race([
            kcfxPreloadPromise.then(() => (
              kcfxPreloadCacheHasIds(kcfxPreloadCache, targetIds)
                ? filterKcfxPreloadCacheByIds(kcfxPreloadCache, [...targetIds].join(','))
                : null
            )),
            new Promise((resolve) => setTimeout(() => resolve(null), 1500))
          ]);
          if (cachedPayload) return res.json(cachedPayload);
        }
        return res.json(kcfxPreloadLoadingResponse(targetIds));
      }
      const payload = await buildPreloadedKcfxLibrary(null, { targetIds });
      return res.json(payload);
    }
    if (req.query.refresh === '1' || kcfxPreloadCache.status === 'idle' || kcfxPreloadCache.status === 'failed') {
      scheduleKcfxPreloadRefresh();
    }
    res.json(filterKcfxPreloadCacheByIds(kcfxPreloadCache, req.query.ids));
  } catch (error) {
    res.status(500).json({
      ...kcfxPreloadCache,
      ok: false,
      status: 'failed',
      error: error?.message || String(error)
    });
  }
});

app.get('/api/kcfx-library/receipt-summary', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getKcfxReceiptSummaryResponse());
  } catch (error) {
    res.status(500).json({
      ok: false,
      status: 'failed',
      source: 'server-receipt-summary',
      error: error?.message || String(error)
    });
  }
});

app.get('/api/kcfx-library/trend-summary', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await getKcfxTrendSummaryResponse());
  } catch (error) {
    res.status(500).json({
      ok: false,
      status: 'failed',
      error: error?.message || String(error)
    });
  }
});

app.get('/api/kcfx-library/records/:id', async (req, res) => {
  const db = await ensureDb();
  const id = String(req.params.id || '').trim();
  let record = db.kcfxLibrary.records[id] || await recoverKcfxRecordFromRowsFile(id);
  if (!record) return res.status(404).json({ error: 'record not found' });
  record = await ensureKcfxRecordRows(db, id, record);
  if (Array.isArray(record.rows)) {
    record = await externalizeKcfxRecordRows(record, id);
    db.kcfxLibrary.records[id] = record;
    db.kcfxLibrary.savedAt = new Date().toISOString();
    await saveDb(db);
  }
  res.json({ ok: true, record: await attachKcfxRecordRows(record) });
});

app.post('/api/kcfx-library/records/:id/upload', upload.single('file'), async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) {
    if (req.file) await removeUploadedFile(req.file.filename);
    return;
  }
  const id = String(req.params.id || '').trim();
  if (!KC_LIBRARY_SLOT_IDS.has(id)) {
    if (req.file) await removeUploadedFile(req.file.filename);
    return res.status(400).json({ error: 'invalid slot' });
  }
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  req.file.originalname = normalizeUploadedFileName(req.file.originalname);
  if (!/\.(xlsx|xlsm|xls|csv)$/i.test(req.file.originalname || '')) {
    await removeUploadedFile(req.file.filename);
    return res.status(400).json({ error: 'unsupported file type' });
  }

  const previousRecord = db.kcfxLibrary.records[id];
  let storedFile = null;
  try {
    const slot = parseKcfxSlotPayload(id, req.body.slot);
    storedFile = await saveKcfxOriginalFile(id, req.file);
    const clientRecord = parseKcfxClientRecordPayload(req.body.record);
    if (clientRecord) {
      const record = await externalizeKcfxRecordRows(buildKcfxClientParsedFileRecord(req.file, storedFile, slot, clientRecord), id);
      db.kcfxLibrary.records[id] = {
        ...record,
        serverSavedAt: new Date().toISOString(),
        serverSavedBy: requestUser.name
      };
      db.kcfxLibrary.savedAt = new Date().toISOString();
      await removeKcfxStoredFile(previousRecord);
      pushLog(db, 'kcfx file library uploaded', requestUser.name, `${requestUser.name} uploaded browser-parsed ${record.title || id}`);
      await saveDb(db);
      scheduleKcfxPreloadRefresh(db);
      scheduleKcfxReceiptSummaryRefresh(db);
      scheduleKcfxTrendSummaryRefresh();
      return res.json({ ok: true, parsedOnClient: true, library: publicKcfxLibrary(db), record: db.kcfxLibrary.records[id] });
    }
    const queuedRecord = buildQueuedKcfxFileRecord(req.file, storedFile, slot, previousRecord, requestUser.name);
    db.kcfxLibrary.records[id] = queuedRecord;
    db.kcfxLibrary.savedAt = new Date().toISOString();
    pushLog(db, 'kcfx file library uploaded', requestUser.name, `${requestUser.name} uploaded ${queuedRecord.title || id}, background parse queued`);
    await saveDb(db);
    res.status(202).json({ ok: true, queued: true, library: publicKcfxLibrary(db), record: db.kcfxLibrary.records[id] });
    scheduleKcfxFileParse({
      id,
      slot,
      file: {
        originalname: req.file.originalname,
        size: req.file.size
      },
      storedFile,
      previousRecord,
      requestUserName: requestUser.name
    });
    return;
  } catch (error) {
    if (storedFile?.fullPath) {
      try {
        await unlink(storedFile.fullPath);
      } catch {}
    } else if (req.file) {
      await removeUploadedFile(req.file.filename);
    }
    res.status(400).json({ error: error?.message || 'parse failed' });
  }
});

app.put('/api/kcfx-library/records/:id', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) return;
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'missing id' });
  const record = await externalizeKcfxRecordRows(sanitizeKcfxLibraryRecord(id, req.body.record || req.body), id);
  db.kcfxLibrary.records[id] = {
    ...record,
    serverSavedAt: new Date().toISOString(),
    serverSavedBy: requestUser.name
  };
  db.kcfxLibrary.savedAt = new Date().toISOString();
  pushLog(db, '文件库更新', requestUser.name, `${requestUser.name} 更新销售及库存看板文件库：${record.title || id}`);
  await saveDb(db);
  scheduleKcfxPreloadRefresh(db);
  scheduleKcfxReceiptSummaryRefresh(db);
  scheduleKcfxTrendSummaryRefresh();
  res.json({ ok: true, library: publicKcfxLibrary(db), record: db.kcfxLibrary.records[id] });
});

app.delete('/api/kcfx-library/records/:id', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) return;
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'missing id' });
  await removeKcfxStoredFile(db.kcfxLibrary.records[id]);
  await removeKcfxRecordRows(db.kcfxLibrary.records[id] || { id });
  delete db.kcfxLibrary.records[id];
  db.kcfxLibrary.savedAt = new Date().toISOString();
  pushLog(db, '文件库删除', requestUser.name, `${requestUser.name} 删除销售及库存看板文件库：${id}`);
  await saveDb(db);
  scheduleKcfxPreloadRefresh(db);
  scheduleKcfxReceiptSummaryRefresh(db);
  scheduleKcfxTrendSummaryRefresh();
  res.status(204).end();
});

app.get('/api/system-file-library', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) return;
  const packages = await Promise.all(SYSTEM_FILE_PACKAGES.map(async (item) => ({
    ...item,
    ...(await packageStats(item.id, db))
  })));
  res.json(packages);
});

app.get('/api/system-file-library/:id/download', async (req, res) => {
  const db = await ensureDb();
  const requestUser = requireSystemOwner(db, req, res);
  if (!requestUser) return;
  const packageInfo = SYSTEM_FILE_PACKAGES.find((item) => item.id === req.params.id);
  if (!packageInfo) return res.status(404).json({ error: 'package not found' });
  const files = await buildSystemPackageFiles(packageInfo.id, db, true);
  const buffer = makeZip(files);
  const asciiFallback = packageInfo.fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(packageInfo.fileName)}`
  );
  res.send(buffer);
});

const distDir = path.join(rootDir, 'dist');
app.use(express.static(distDir));
app.get(/^\/(?!api|uploads|preview|download).*/, (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = process.env.PORT || 4001;
app.listen(port, async () => {
  const db = await ensureDb();
  scheduleKcfxPreloadRefresh(db);
  scheduleKcfxReceiptSummaryRefresh(db);
  scheduleKcfxTrendSummaryRefresh();
  startWeeklyPaymentEmailScheduler();
  console.log(`API running at http://localhost:${port}`);
});
