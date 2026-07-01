import { randomUUID } from 'node:crypto';
import rateLimit from 'express-rate-limit';

const crypto = { randomUUID };

export default function registerAuthRoutes(app, db) {
  const {
    initDb,
    dataDir,
    upload,
    format,
    SYSTEM_OWNER_NAME,
    ROLE_ADMIN,
    ROLE_FINANCE,
    ROLE_USER,
    USER_STATUS_APPROVED,
    USER_STATUS_PENDING,
    DEFAULT_PERMISSIONS,
    SYSTEM_FILE_PACKAGES,
    KC_LIBRARY_SLOT_IDS,
    sanitizePermissions,
    normalizeUser,
    publicUser,
    publicSessionUser,
    createUserSession,
    findValidSession,
    isUserApproved,
    pushLog,
    requireSystemOwner,
    resolveRequestUser,
    visibleRows,
    canAccessRow,
    requirePermission,
    deriveInvoiceStatus,
    removeUploadedFile,
    recognizeInvoice,
    reprocessDraft,
    calculateDueDate,
    parseSupplierTermWorkbook,
    parseOwnerWorkbook,
    parseGenericWorkbook,
    weeklyPaymentApplications,
    groupInvoicesByOwner,
    canSeeAllRole,
    publicSettingsForUser,
    packageStats,
    buildSystemPackageFiles,
    makeZip,
    externalizeKcfxLibraryInlineRows,
    publicKcfxLibrary,
    normalizeKcfxIds,
    kcfxPreloadCache,
    kcfxPreloadPromise,
    kcfxPreloadCacheHasIds,
    filterKcfxPreloadCacheByIds,
    kcfxTargetIdsArePriority,
    scheduleKcfxPreloadRefresh,
    kcfxPreloadLoadingResponse,
    buildPreloadedKcfxLibrary,
    getKcfxReceiptSummaryResponse,
    getKcfxTrendSummaryResponse,
    recoverKcfxRecordFromRowsFile,
    ensureKcfxRecordRows,
    externalizeKcfxRecordRows,
    attachKcfxRecordRows,
    sanitizeKcfxLibraryRecord,
    removeKcfxStoredFile,
    removeKcfxRecordRows,
    normalizeUploadedFileName,
    parseKcfxSlotPayload,
    saveKcfxOriginalFile,
    parseKcfxClientRecordPayload,
    buildKcfxClientParsedFileRecord,
    preserveKcfxRowsMetadata,
    buildQueuedKcfxFileRecord,
    scheduleKcfxFileParse,
    scheduleKcfxReceiptSummaryRefresh,
    scheduleKcfxTrendSummaryRefresh
  } = app.locals.gongying;

const strictLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: '请求过于频繁，请15分钟后再试' } });

app.post('/api/login', strictLimiter, async (req, res) => {
  const db = await initDb(dataDir);
  const name = String(req.body.name || '').trim();
  const password = String(req.body.password || '');
  const deviceId = String(req.body.deviceId || '').trim();
  if (!deviceId) return res.status(400).json({ error: 'missing device id' });
  const user = db.users.find((item) => item.name === name && item.password === password);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  if (!isUserApproved(user)) return res.status(403).json({ error: 'pending approval' });
  const session = createUserSession(db, user, deviceId, req);
  await db.save();
  res.json(publicSessionUser(user, session));
});

app.post('/api/session/verify', async (req, res) => {
  const db = await initDb(dataDir);
  const result = findValidSession(db, req.body || {}, req);
  if (!result) return res.status(401).json({ error: 'invalid session' });
  result.session.lastSeenAt = new Date().toISOString();
  await db.save();
  res.json(publicSessionUser(result.user, result.session));
});

app.post('/api/logout', async (req, res) => {
  const db = await initDb(dataDir);
  const userId = String(req.body.userId || '').trim();
  const token = String(req.body.sessionToken || req.body.token || '').trim();
  const deviceId = String(req.body.deviceId || '').trim();
  db.sessions.remove((session) => session.userId === userId && session.token === token && session.deviceId === deviceId);
  await db.save();
  res.json({ ok: true });
});

app.post('/api/register', async (req, res) => {
  const db = await initDb(dataDir);
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
  await db.save();
  res.json(publicUser(user));
});
}
