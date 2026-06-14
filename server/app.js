import cors from 'cors';
import express from 'express';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { PDFParse } from 'pdf-parse';
import xlsx from 'xlsx';
import { addDays, format, parseISO } from 'date-fns';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const dbPath = path.join(dataDir, 'db.json');

const app = express();
const upload = multer({ dest: uploadDir });

app.use(cors());
app.use(express.json());

const SYSTEM_OWNER_NAME = '孙立柱';
const ROLE_ADMIN = '管理员';
const ROLE_FINANCE = '财务';
const ROLE_USER = '普通用户';
const PERMISSION_GROUPS = [
  {
    value: 'supplierPayment',
    children: [
      'supplierPayment.ledger',
      'supplierPayment.upload',
      'supplierPayment.invoiceInventory',
      'supplierPayment.supplierManagement',
      'supplierPayment.reminders'
    ]
  },
  {
    value: 'qualityInspection',
    children: [
      'qualityInspection.inspectionNotice',
      'qualityInspection.inspectionSchedule',
      'qualityInspection.inspectionReportUpload',
      'qualityInspection.inspectionFeedback',
      'qualityInspection.inspectionReportQuery',
      'qualityInspection.inspectionSummary',
      'qualityInspection.inspectionInitialData'
    ]
  },
  {
    value: 'salesInventory',
    children: []
  },
  {
    value: 'systemManagement',
    children: ['systemManagement.permissionManagement']
  }
];
const PERMISSION_KEYS = PERMISSION_GROUPS.flatMap((group) => [group.value, ...group.children]);
const OWNER_PERMISSIONS = [...PERMISSION_KEYS];
const DEFAULT_PERMISSIONS = [];

function expandPermissionKey(permission) {
  if (permission === 'supplierPayment') return ['supplierPayment', 'supplierPayment.ledger', 'supplierPayment.upload', 'supplierPayment.reminders'];
  if (permission === 'invoiceInventory') return ['supplierPayment', 'supplierPayment.invoiceInventory'];
  if (permission === 'supplierManagement') return ['supplierPayment', 'supplierPayment.supplierManagement'];
  if (permission === 'qualityInspection') {
    const group = PERMISSION_GROUPS.find((item) => item.value === 'qualityInspection');
    return [group.value, ...group.children];
  }
  if (permission === 'permissionManagement') return ['systemManagement', 'systemManagement.permissionManagement'];
  if (permission === 'systemManagement') return ['systemManagement', 'systemManagement.permissionManagement'];
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
  return {
    ...user,
    id: user.id || crypto.randomUUID(),
    name,
    password: String(user.password || '123456'),
    role,
    permissions
  };
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    permissions: user.permissions || []
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
    isPaid: invoice.isPaid || '',
    status: invoice.status === '财务打款' ? '待财务打款' : invoice.status
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
  return db;
}

async function ensureDb() {
  await mkdir(uploadDir, { recursive: true });
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
  return ['管理员', '财务'].includes(role);
}

function resolveRequestUser(db, source = {}) {
  const name = String(source.user || source.name || '').trim();
  if (!name) return null;
  return db.users.find((item) => item.name === name) || null;
}

function canAccessRow(row, requestUser) {
  if (!requestUser) return false;
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

function hasUserPermission(user, permission) {
  if (!user) return false;
  if (user.name === SYSTEM_OWNER_NAME) return true;
  return Array.isArray(user.permissions) && user.permissions.includes(permission);
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
  if (String(invoice.oaProcessNo || '').trim()) return '待财务打款';
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
  const user = db.users.find((item) => item.name === req.body.name && item.password === req.body.password);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
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
    permissions: Array.isArray(req.body.permissions) ? req.body.permissions : DEFAULT_PERMISSIONS
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
  if (Object.prototype.hasOwnProperty.call(req.body, 'isPaid')) {
    invoice.isPaid = req.body.isPaid === '是' ? '是' : '';
  }
  if (!Object.prototype.hasOwnProperty.call(req.body, 'oaProcessNo') &&
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
  const requestUser = requirePermission(db, req, res, 'supplierPayment.invoiceInventory');
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
  if (!requirePermission(db, req, res, 'supplierPayment.supplierManagement')) return;
  const supplier = { id: crypto.randomUUID(), name: req.body.name, termDays: Number(req.body.termDays || 30) };
  db.suppliers.unshift(supplier);
  await saveDb(db);
  res.json(supplier);
});

app.post('/api/suppliers/import-terms', upload.single('file'), async (req, res) => {
  const db = await ensureDb();
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  if (!requirePermission(db, req, res, 'supplierPayment.supplierManagement')) {
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
  if (!requirePermission(db, req, res, 'supplierPayment.supplierManagement')) return;
  const owner = { id: crypto.randomUUID(), owner: req.body.owner, supplier: req.body.supplier };
  db.owners.unshift(owner);
  await saveDb(db);
  res.json(owner);
});

app.post('/api/owners/import', upload.single('file'), async (req, res) => {
  const db = await ensureDb();
  if (!req.file) return res.status(400).json({ error: 'missing file' });
  if (!requirePermission(db, req, res, 'supplierPayment.supplierManagement')) {
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

const distDir = path.join(rootDir, 'dist');
app.use(express.static(distDir));
app.get(/^\/(?!api|uploads|preview).*/, (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

const port = process.env.PORT || 4001;
app.listen(port, async () => {
  await ensureDb();
  startWeeklyPaymentEmailScheduler();
  console.log(`API running at http://localhost:${port}`);
});
