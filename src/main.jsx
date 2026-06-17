import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import './styles.css';

const API = import.meta.env.DEV ? 'http://localhost:4001' : '';

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const INSPECTION_NOTICE_FIELDS = [
  { key: 'inspectionApplicant', label: '验货填写人', readonly: true },
  { key: 'inspectionFillTime', label: '验货填写时间', inputType: 'date' },
  { key: 'supplierFinishTime', label: '供应商完工时间', inputType: 'date' },
  { key: 'shipmentTime', label: '发货时间', inputType: 'date' },
  { key: 'kingdeeOrderNo', label: '金蝶采购订单' },
  { key: 'supplierShortName', label: '供应商简称', select: true },
  { key: 'supplierAddress', label: '供应商地址', readonly: true },
  { key: 'businessDepartments', label: '事业部', multiSelect: true },
  { key: 'operation', label: '运营' },
  { key: 'firstInspection', label: '是否首批验货', select: true, options: ['是', '否'], placeholder: '选择' },
  { key: 'salesProductLine', label: '产品线', select: true, placeholder: '选择产品线' },
  { key: 'series', label: '系列', select: true, placeholder: '选择系列' },
  { key: 'totalQuantity', label: '合计数量' },
  { key: 'skuQuantity', label: 'SKU及数量', multiline: true },
  { key: 'remark', label: '备注', multiline: true }
];

const INSPECTION_DEPARTMENT_OPTIONS = ['海外事业部一部', '海外事业二部', '国内事业部', '全球招商部', '其他部门'];
const INSPECTION_LIBRARY_RECORD_IDS = ['dim-purchase-division', 'dim-product'];
const PURCHASE_DIVISION_SUPPLIER_COLUMN = 9;
const PURCHASE_DIVISION_ADDRESS_COLUMN = 12;
const PRODUCT_LINE_COLUMN = 7;
const PRODUCT_SERIES_COLUMN = 8;
const KCFX_INDEXED_DB_NAME = 'kcfx-inventory-analysis-file-library';
const KCFX_INDEXED_DB_STORE = 'files';

const SALES_INVENTORY_PAGES = [
  { tab: 'salesInventoryReceiptSummary', key: 'receiptSummary', label: '供应链库存分析', sourceFile: 'receipt-summary.html' },
  { tab: 'salesInventorySalesAnalysis', key: 'salesAnalysis', label: '销售数据分析', sourceFile: 'sales-analysis.html' },
  { tab: 'salesInventoryComparison', key: 'comparison', label: '表格对比分析', sourceFile: 'comparison.html' },
  { tab: 'salesInventoryErrors', key: 'errors', label: '报错信息提示', sourceFile: 'errors.html' }
];

const MAINTENANCE_LIBRARY_PAGES = [
  { tab: 'maintenanceFactLibrary', key: 'factLibrary', label: '库存数据文件', sourceFile: 'fact-library.html' },
  { tab: 'maintenanceSalesLibrary', key: 'salesLibrary', label: '销售数据文件', sourceFile: 'sales-library.html' },
  { tab: 'maintenanceFileLibrary', key: 'fileLibrary', label: '维度表文件库', sourceFile: 'file-library.html' }
];

const EMBEDDED_KCFX_PAGES = [...SALES_INVENTORY_PAGES, ...MAINTENANCE_LIBRARY_PAGES];
const PRIORITY_KCFX_PRELOAD_TABS = new Set(['salesInventoryReceiptSummary', 'salesInventorySalesAnalysis']);

const SYSTEM_FILE_LIBRARY_PAGES = [
  { tab: 'systemMigrationPackage', key: 'migrationPackage', label: '迁移备份包' },
  { tab: 'systemInvoiceUploads', key: 'invoiceUploads', label: '发票原件库' },
  { tab: 'systemSalesInventoryFiles', key: 'salesInventoryFiles', label: '销售库存看板文件' }
];

const MAINTENANCE_LIBRARY_MENU_PAGES = [
  ...MAINTENANCE_LIBRARY_PAGES,
  { tab: 'suppliers', key: 'supplierManagement', label: '供应商管理维度表' }
];
const MAINTENANCE_LIBRARY_TABS = new Set(MAINTENANCE_LIBRARY_MENU_PAGES.map((page) => page.tab));

const SYSTEM_FILE_LIBRARY_MENU_PAGES = [
  { tab: 'invoiceInventory', key: 'invoiceInventory', label: '发票信息库存查看' },
  ...SYSTEM_FILE_LIBRARY_PAGES
];

function createInspectionNoticeRow(values = {}) {
  return INSPECTION_NOTICE_FIELDS.reduce((row, field) => ({
    ...row,
    [field.key]: field.multiSelect
      ? (Array.isArray(values[field.key])
          ? values[field.key]
          : String(values[field.key] || '').split(/[、,，]/).map((item) => item.trim()).filter(Boolean))
      : values[field.key] || ''
  }), {
    id: values.id || createClientId()
  });
}

function normalizeOptionText(value) {
  return String(value ?? '').trim();
}

function readPhysicalColumn(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) return normalizeOptionText(row.__cells[index]);
  const values = Object.entries(row || {})
    .filter(([key]) => key !== '__cells' && !key.startsWith('__'))
    .map(([, value]) => value);
  return normalizeOptionText(values[index]);
}

function uniqueOptionValues(values) {
  const seen = new Set();
  return values
    .map(normalizeOptionText)
    .filter(Boolean)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function recordTime(record) {
  return Math.max(
    Date.parse(record?.savedAt || 0) || 0,
    Number(record?.lastModified || 0) || 0,
    Date.parse(record?.appliedAt || 0) || 0,
    Date.parse(record?.sharedSavedAt || 0) || 0
  );
}

function latestInspectionLibraryRecord(record) {
  if (!record || record.deletedAt) return null;
  const current = { ...record };
  delete current.pending;
  const pending = record.pending && !record.pending.deletedAt ? record.pending : null;
  const latest = pending && recordTime(pending) >= recordTime(current) ? pending : current;
  return Array.isArray(latest?.rows) && latest.rows.length ? latest : null;
}

function readInspectionIndexedDbRecord(id) {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(KCFX_INDEXED_DB_NAME, 1);
    request.onerror = () => resolve(null);
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      resolve(null);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KCFX_INDEXED_DB_STORE)) {
        db.close();
        resolve(null);
        return;
      }
      const tx = db.transaction(KCFX_INDEXED_DB_STORE, 'readonly');
      const storeRequest = tx.objectStore(KCFX_INDEXED_DB_STORE).get(id);
      storeRequest.onsuccess = () => resolve(latestInspectionLibraryRecord(storeRequest.result));
      storeRequest.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        resolve(null);
      };
    };
  });
}

function App() {
  const [activeTab, setActiveTab] = useState('ledger');
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('invoiceUser') || 'null'));
  const [authMode, setAuthMode] = useState('login');
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [registerName, setRegisterName] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [owners, setOwners] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [previewFile, setPreviewFile] = useState(null);
  const [senderEmail, setSenderEmail] = useState('');
  const [senderEmailInput, setSenderEmailInput] = useState('');
  const [smtpPasswordInput, setSmtpPasswordInput] = useState('');
  const [smtpPasswordConfigured, setSmtpPasswordConfigured] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [paymentWeekFilter, setPaymentWeekFilter] = useState([]);
  const [paymentMonthFilter, setPaymentMonthFilter] = useState([]);
  const [oaSubmitWeekFilter, setOaSubmitWeekFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState('');
  const [expandedMenuGroups, setExpandedMenuGroups] = useState(() => new Set(['supplierPayment']));
  const [embeddedFrameReady, setEmbeddedFrameReady] = useState({});
  const [embeddedSwitchingTab, setEmbeddedSwitchingTab] = useState('');
  const [embeddedLoadProgress, setEmbeddedLoadProgress] = useState({});
  const [mountedKcfxTabs, setMountedKcfxTabs] = useState(() => new Set());
  const [supplierImportResult, setSupplierImportResult] = useState(null);
  const [ownerImportResult, setOwnerImportResult] = useState(null);
  const [inspectionInitialData, setInspectionInitialData] = useState({ sheetName: '', columns: [], rows: [], updatedAt: '' });
  const [inspectionInitialImportResult, setInspectionInitialImportResult] = useState(null);
  const [inspectionNoticeSubmission, setInspectionNoticeSubmission] = useState({ rows: [], submittedAt: '', submittedBy: '' });
  const [inspectionNoticeRows, setInspectionNoticeRows] = useState(() => [createInspectionNoticeRow()]);
  const [inspectionLibraryRecords, setInspectionLibraryRecords] = useState({});
  const [dimensionShortNameFilter, setDimensionShortNameFilter] = useState([]);
  const [dimensionOwnerFilter, setDimensionOwnerFilter] = useState([]);
  const [dimensionAnnualFilter, setDimensionAnnualFilter] = useState([]);
  const [logSecondPageFilter, setLogSecondPageFilter] = useState([]);
  const [logThirdPageFilter, setLogThirdPageFilter] = useState([]);
  const [logStartDate, setLogStartDate] = useState('');
  const [logEndDate, setLogEndDate] = useState('');
  const [managedUsers, setManagedUsers] = useState([]);
  const [systemFilePackages, setSystemFilePackages] = useState([]);
  const [appVersionTime, setAppVersionTime] = useState('读取中...');
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('123456');
  const [passwordResets, setPasswordResets] = useState({});
  const systemOwnerName = '孙立柱';
  const permissionGroups = [
    {
      value: 'supplierPayment',
      label: '供应商付款提醒',
      children: [
        { value: 'supplierPayment.ledger', tab: 'ledger', label: '供应商付款看板' },
        { value: 'supplierPayment.upload', tab: 'upload', label: '发票上传' }
      ]
    },
    {
      value: 'qualityInspection',
      label: '品质验货',
      children: [
        { value: 'qualityInspection.inspectionNotice', tab: 'inspectionNotice', label: '验货通知' },
        { value: 'qualityInspection.inspectionSchedule', tab: 'inspectionSchedule', label: '验货安排' },
        { value: 'qualityInspection.inspectionReportUpload', tab: 'inspectionReportUpload', label: '检验报告单回传' },
        { value: 'qualityInspection.inspectionFeedback', tab: 'inspectionFeedback', label: '验货反馈' },
        { value: 'qualityInspection.inspectionReportQuery', tab: 'inspectionReportQuery', label: '检验报告单查询' },
        { value: 'qualityInspection.inspectionSummary', tab: 'inspectionSummary', label: '验货信息汇总表' },
        { value: 'qualityInspection.inspectionInitialData', tab: 'inspectionInitialData', label: '验货信息初始数据' }
      ]
    },
    {
      value: 'salesInventory',
      label: '销售及库存看板',
      children: SALES_INVENTORY_PAGES.map((page) => ({
        value: `salesInventory.${page.key}`,
        tab: page.tab,
        label: page.label
      }))
    },
    {
      value: 'maintenanceLibrary',
      label: '维护文件库',
      fixedOwnerOnly: true,
      children: MAINTENANCE_LIBRARY_MENU_PAGES.map((page) => ({
        value: `maintenanceLibrary.${page.key}`,
        tab: page.tab,
        label: page.label
      }))
    },
    {
      value: 'systemManagement',
      label: '系统管理',
      fixedOwnerOnly: true,
      children: [
        { value: 'systemManagement.permissionManagement', tab: 'permissionManagement', label: '权限管理' },
        { value: 'systemManagement.reminders', tab: 'reminders', label: '操作日志' }
      ]
    },
    {
      value: 'systemFileLibrary',
      label: '系统文件库',
      fixedOwnerOnly: true,
      children: SYSTEM_FILE_LIBRARY_MENU_PAGES.map((page) => ({
        value: `systemFileLibrary.${page.key}`,
        tab: page.tab,
        label: page.label
      }))
    }
  ];
  const tabPermissionMap = Object.fromEntries(
    permissionGroups.flatMap((group) => group.children.map((item) => [item.tab, item.value]))
  );
  const legacyPermissionMap = {
    'supplierPayment.ledger': ['supplierPayment'],
    'supplierPayment.upload': ['supplierPayment'],
    'qualityInspection.inspectionNotice': ['qualityInspection'],
    'qualityInspection.inspectionSchedule': ['qualityInspection'],
    'qualityInspection.inspectionReportUpload': ['qualityInspection'],
    'qualityInspection.inspectionFeedback': ['qualityInspection'],
    'qualityInspection.inspectionReportQuery': ['qualityInspection'],
    'qualityInspection.inspectionSummary': ['qualityInspection'],
    'qualityInspection.inspectionInitialData': ['qualityInspection'],
    ...Object.fromEntries(SALES_INVENTORY_PAGES.map((page) => [`salesInventory.${page.key}`, ['salesInventory']])),
    'maintenanceLibrary.factLibrary': ['maintenanceLibrary', 'salesInventory', 'salesInventory.factLibrary'],
    'maintenanceLibrary.salesLibrary': ['maintenanceLibrary', 'salesInventory', 'salesInventory.salesLibrary'],
    'maintenanceLibrary.fileLibrary': ['maintenanceLibrary', 'salesInventory', 'salesInventory.fileLibrary'],
    'maintenanceLibrary.supplierManagement': ['maintenanceLibrary', 'supplierManagement', 'supplierPayment.supplierManagement'],
    'systemManagement.permissionManagement': ['permissionManagement'],
    'systemManagement.reminders': ['systemManagement', 'supplierPayment.reminders'],
    'systemFileLibrary.invoiceInventory': ['systemFileLibrary', 'invoiceInventory', 'supplierPayment.invoiceInventory'],
    ...Object.fromEntries(SYSTEM_FILE_LIBRARY_PAGES.map((page) => [`systemFileLibrary.${page.key}`, ['systemFileLibrary']]))
  };
  function hasPermission(permission) {
    if (user?.name === systemOwnerName) return true;
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    if (permissions.includes(permission)) return true;
    return (legacyPermissionMap[permission] || []).some((item) => permissions.includes(item));
  }
  function canAccessTab(tab) {
    if (tab === 'permissionManagement') return canManagePermissions;
    if (MAINTENANCE_LIBRARY_TABS.has(tab)) return user?.name === systemOwnerName;
    const permission = tabPermissionMap[tab];
    return permission ? hasPermission(permission) : false;
  }
  function canAccessGroup(groupValue) {
    const group = permissionGroups.find((item) => item.value === groupValue);
    if (!group) return false;
    return hasPermission(group.value) || group.children.some((item) => canAccessTab(item.tab));
  }
  const canManageMailSettings = user?.name === systemOwnerName;
  const canManagePermissions = user?.name === systemOwnerName;
  const canManageSystemFiles = user?.name === systemOwnerName;
  const canManageMaintenanceLibrary = user?.name === systemOwnerName;
  const canAccessSupplierPayment = canAccessGroup('supplierPayment');
  const canAccessQualityInspection = canAccessGroup('qualityInspection');
  const canAccessSalesInventory = canAccessGroup('salesInventory');
  const canAccessMaintenanceLibrary = canManageMaintenanceLibrary;
  const canAccessSystemFileLibrary = canAccessGroup('systemFileLibrary');
  const qualityInspectionPages = {
    inspectionNotice: '验货通知',
    inspectionSchedule: '验货安排',
    inspectionReportUpload: '检验报告单回传',
    inspectionFeedback: '验货反馈',
    inspectionReportQuery: '检验报告单查询',
    inspectionSummary: '验货信息汇总表',
    inspectionInitialData: '验货信息初始数据'
  };
  const embeddedKcfxPageMap = Object.fromEntries(EMBEDDED_KCFX_PAGES.map((page) => [page.tab, page]));
  const activeEmbeddedKcfxPage = embeddedKcfxPageMap[activeTab] && canAccessTab(activeTab)
    ? embeddedKcfxPageMap[activeTab]
    : null;
  const accessibleEmbeddedKcfxPages = EMBEDDED_KCFX_PAGES.filter((page) => canAccessTab(page.tab));
  const mountedEmbeddedKcfxPages = accessibleEmbeddedKcfxPages.filter((page) => (
    mountedKcfxTabs.has(page.tab) || activeTab === page.tab
  ));
  const activeEmbeddedKcfxFrameReady = activeEmbeddedKcfxPage
    ? Boolean(embeddedFrameReady[activeEmbeddedKcfxPage.tab])
    : false;
  const activeEmbeddedKcfxLoading = Boolean(
    activeEmbeddedKcfxPage && (!activeEmbeddedKcfxFrameReady || embeddedSwitchingTab === activeTab)
  );
  const activeEmbeddedKcfxProgress = activeEmbeddedKcfxPage
    ? embeddedLoadProgress[activeEmbeddedKcfxPage.tab] || 0
    : 0;

  function openMenuTab(tab, group) {
    setExpandedMenuGroups((current) => {
      if (current.has(group)) return current;
      return new Set([...current, group]);
    });
    if (embeddedKcfxPageMap[tab]) {
      setMountedKcfxTabs((current) => {
        if (current.has(tab)) return current;
        return new Set([...current, tab]);
      });
      setEmbeddedSwitchingTab(tab);
      setEmbeddedLoadProgress((current) => ({ ...current, [tab]: embeddedFrameReady[tab] ? 82 : 8 }));
    } else {
      setEmbeddedSwitchingTab('');
    }
    setActiveTab(tab);
  }

  function toggleMenuGroup(group) {
    setExpandedMenuGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  }

  function isMenuGroupExpanded(group) {
    return expandedMenuGroups.has(group);
  }

  function markEmbeddedFrameReady(tab) {
    setEmbeddedFrameReady((current) => {
      if (current[tab]) return current;
      return { ...current, [tab]: true };
    });
    setEmbeddedLoadProgress((current) => ({ ...current, [tab]: 100 }));
  }

  function waitForEmbeddedFramePaint(iframe, tab, attempt = 0) {
    window.setTimeout(() => {
      try {
        const documentRef = iframe.contentDocument;
        const body = documentRef?.body;
        const hasRenderedContent = Boolean(
          body && (body.children.length > 0 || body.textContent.trim().length > 0)
        );
        const documentReady = documentRef?.readyState === 'interactive' || documentRef?.readyState === 'complete';
        if ((documentReady && hasRenderedContent) || attempt >= 30) {
          markEmbeddedFrameReady(tab);
          return;
        }
        waitForEmbeddedFramePaint(iframe, tab, attempt + 1);
      } catch {
        markEmbeddedFrameReady(tab);
      }
    }, attempt === 0 ? 80 : 120);
  }

  function applyEmbeddedDashboardChrome(event, tab) {
    const iframe = event.currentTarget;
    try {
      iframe.contentDocument?.documentElement?.classList.add('embedded-host-root');
      iframe.contentDocument?.body?.classList.add('embedded-host');
    } catch {
      // The embedded dashboard is served from the same app; ignore if the browser blocks access.
    } finally {
      iframe.classList.add('is-ready');
      waitForEmbeddedFramePaint(iframe, tab);
    }
  }

  function embeddedKcfxSrc(page) {
    return `/kcfx/${page.sourceFile}?embed=1&v=20260616l`;
  }

  function preloadKcfxSrc() {
    return `/kcfx/preload.html?preload=1&v=20260616r`;
  }

  function assertApiResponse(label, response) {
    if (!response) return;
    if (!response.ok) {
      throw new Error(`${label} HTTP ${response.status}`);
    }
  }

  async function hydrateInspectionLibraryRecords(records = {}) {
    const nextRecords = { ...records };
    const missingIds = INSPECTION_LIBRARY_RECORD_IDS.filter((id) => {
      const record = nextRecords[id];
      return !Array.isArray(record?.rows) || record.rows.length === 0;
    });
    await Promise.all(missingIds.map(async (id) => {
      try {
        const response = await fetch(`${API}/api/kcfx-library/records/${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const payload = await response.json();
        if (payload?.record) nextRecords[id] = payload.record;
      } catch {
        // Missing maintenance-library records leave the related dropdown empty until the file is uploaded.
      }
    }));
    const stillMissingIds = INSPECTION_LIBRARY_RECORD_IDS.filter((id) => {
      const record = nextRecords[id];
      return !Array.isArray(record?.rows) || record.rows.length === 0;
    });
    await Promise.all(stillMissingIds.map(async (id) => {
      const localRecord = await readInspectionIndexedDbRecord(id);
      if (localRecord) nextRecords[id] = localRecord;
    }));
    return nextRecords;
  }

  async function loadData() {
    const params = user ? `?user=${encodeURIComponent(user.name)}&role=${encodeURIComponent(user.role)}` : '';
    const inspectionLibraryIds = INSPECTION_LIBRARY_RECORD_IDS.join(',');
    const [invoiceRes, draftRes, supplierRes, ownerRes, reminderRes, settingsRes, usersRes, inspectionInitialRes, inspectionNoticeRes, inspectionLibraryRes, systemFilePackagesRes] = await Promise.all([
      fetch(`${API}/api/invoices${params}`),
      fetch(`${API}/api/drafts${params}`),
      fetch(`${API}/api/suppliers`),
      fetch(`${API}/api/owners`),
      fetch(`${API}/api/reminders${params}`),
      fetch(`${API}/api/settings${params}`),
      canManagePermissions ? fetch(`${API}/api/users${params}`) : Promise.resolve(null),
      canAccessTab('inspectionInitialData') ? fetch(`${API}/api/quality-inspection/initial-data${params}`) : Promise.resolve(null),
      canAccessTab('inspectionNotice') ? fetch(`${API}/api/quality-inspection/notices${params}`) : Promise.resolve(null),
      canAccessTab('inspectionNotice') ? fetch(`${API}/api/kcfx-library/preloaded?ids=${encodeURIComponent(inspectionLibraryIds)}`, { cache: 'no-store' }) : Promise.resolve(null),
      canManageSystemFiles ? fetch(`${API}/api/system-file-library${params}`) : Promise.resolve(null)
    ]);
    [
      ['发票台账', invoiceRes],
      ['待确认发票', draftRes],
      ['供应商账期维度表', supplierRes],
      ['采购负责人维度表', ownerRes],
      ['操作日志', reminderRes],
      ['系统设置', settingsRes],
      ['权限管理', usersRes],
      ['验货信息初始数据', inspectionInitialRes],
      ['验货通知', inspectionNoticeRes],
      ['验货通知维度数据', inspectionLibraryRes],
      ['系统文件库', systemFilePackagesRes]
    ].forEach(([label, response]) => assertApiResponse(label, response));
    setInvoices(await invoiceRes.json());
    setDrafts(await draftRes.json());
    setSuppliers(await supplierRes.json());
    setOwners(await ownerRes.json());
    setReminders(await reminderRes.json());
    const settings = await settingsRes.json();
    setSenderEmail(settings.senderEmail || '');
    setSenderEmailInput(settings.senderEmail || '');
    setSmtpPasswordConfigured(Boolean(settings.smtpPasswordConfigured));
    setSmtpPasswordInput('');
    if (usersRes?.ok) {
      setManagedUsers(await usersRes.json());
    } else if (!canManagePermissions) {
      setManagedUsers([]);
    }
    if (inspectionInitialRes?.ok) {
      setInspectionInitialData(await inspectionInitialRes.json());
    } else if (!canAccessTab('inspectionInitialData')) {
      setInspectionInitialData({ sheetName: '', columns: [], rows: [], updatedAt: '' });
    }
    if (inspectionNoticeRes?.ok) {
      const noticeSubmission = await inspectionNoticeRes.json();
      const noticeRows = noticeSubmission.rows?.length
        ? noticeSubmission.rows.map((row) => createInspectionNoticeRow({
            ...row,
            inspectionApplicant: row.inspectionApplicant || user.name,
            supplierAddress: row.supplierAddress || findSupplierAddressByShortName(row.supplierShortName)
          }))
        : [createInspectionNoticeRow({ inspectionApplicant: user.name })];
      setInspectionNoticeSubmission(noticeSubmission);
      setInspectionNoticeRows(noticeRows);
    } else if (!canAccessTab('inspectionNotice')) {
      setInspectionNoticeSubmission({ rows: [], submittedAt: '', submittedBy: '' });
      setInspectionNoticeRows([createInspectionNoticeRow({ inspectionApplicant: user.name })]);
    }
    if (inspectionLibraryRes?.ok) {
      const inspectionLibrary = await inspectionLibraryRes.json();
      setInspectionLibraryRecords(await hydrateInspectionLibraryRecords(inspectionLibrary.records || {}));
    } else if (!canAccessTab('inspectionNotice')) {
      setInspectionLibraryRecords({});
    }
    if (systemFilePackagesRes?.ok) {
      setSystemFilePackages(await systemFilePackagesRes.json());
    } else if (!canManageSystemFiles) {
      setSystemFilePackages([]);
    }
  }

  useEffect(() => {
    if (user) loadData().catch((error) => {
      setMessage(`后端服务连接失败：${error?.message || '请确认服务已启动。'}`);
    });
  }, [user]);

  useEffect(() => {
    if (!user || activeTab !== 'inspectionNotice' || !canAccessTab('inspectionNotice')) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const inspectionLibraryIds = INSPECTION_LIBRARY_RECORD_IDS.join(',');
        let records = {};
        try {
          const response = await fetch(`${API}/api/kcfx-library/preloaded?ids=${encodeURIComponent(inspectionLibraryIds)}`, { cache: 'no-store' });
          if (response.ok) {
            const payload = await response.json();
            records = payload.records || {};
          }
        } catch {
          records = {};
        }
        const hydratedRecords = await hydrateInspectionLibraryRecords(records);
        if (!cancelled) setInspectionLibraryRecords(hydratedRecords);
      } catch {
        // Keep the existing dropdown data if a background refresh fails.
      }
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', refresh);
    };
  }, [activeTab, user]);

  useEffect(() => {
    if (!user || accessibleEmbeddedKcfxPages.length === 0) return;
    const ids = [
      'sales-data',
      'fact-2',
      'dim-product',
      'dim-warehouse',
      'dim-warehouse-material',
      'dim-store-name',
      'dim-customer-material'
    ].join(',');
    fetch(`${API}/api/kcfx-library/preloaded?ids=${encodeURIComponent(ids)}`, { cache: 'no-store' }).catch(() => {});
  }, [user, accessibleEmbeddedKcfxPages.length]);

  useEffect(() => {
    if (!user || accessibleEmbeddedKcfxPages.length === 0) return undefined;
    setMountedKcfxTabs((current) => {
      const next = new Set(current);
      accessibleEmbeddedKcfxPages.forEach((page) => {
        if (PRIORITY_KCFX_PRELOAD_TABS.has(page.tab)) next.add(page.tab);
      });
      if (activeEmbeddedKcfxPage) next.add(activeEmbeddedKcfxPage.tab);
      return next;
    });
    const timer = window.setTimeout(() => {
      setMountedKcfxTabs((current) => new Set([
        ...current,
        ...accessibleEmbeddedKcfxPages.map((page) => page.tab)
      ]));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [user, accessibleEmbeddedKcfxPages.length, activeEmbeddedKcfxPage?.tab]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/app-version`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`app version HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setAppVersionTime(data.versionTime || '未获取');
      })
      .catch(() => {
        if (!cancelled) setAppVersionTime('未获取');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function openFirstAllowedTab() {
      const firstAllowed = permissionGroups
        .flatMap((group) => group.children.map((child) => ({ ...child, group: group.value })))
        .find((item) => canAccessTab(item.tab));
      if (firstAllowed) {
        setExpandedMenuGroups((current) => {
          if (current.has(firstAllowed.group)) return current;
          return new Set([...current, firstAllowed.group]);
        });
        setActiveTab(firstAllowed.tab);
      }
    }
    if (user && tabPermissionMap[activeTab] && !canAccessTab(activeTab)) {
      openFirstAllowedTab();
      return;
    }
    if (user && !canManagePermissions && activeTab === 'permissionManagement') {
      openFirstAllowedTab();
    }
  }, [activeTab, canAccessMaintenanceLibrary, canAccessQualityInspection, canAccessSalesInventory, canAccessSupplierPayment, canAccessSystemFileLibrary, canManagePermissions, user]);

  useEffect(() => {
    if (!activeEmbeddedKcfxPage) {
      if (embeddedSwitchingTab) setEmbeddedSwitchingTab('');
      return undefined;
    }
    if (!activeEmbeddedKcfxFrameReady || embeddedSwitchingTab !== activeTab) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setEmbeddedSwitchingTab((current) => (current === activeTab ? '' : current));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [activeTab, activeEmbeddedKcfxFrameReady, activeEmbeddedKcfxPage, embeddedSwitchingTab]);

  useEffect(() => {
    if (!activeEmbeddedKcfxPage || !activeEmbeddedKcfxLoading) {
      return undefined;
    }
    const tab = activeEmbeddedKcfxPage.tab;
    const timer = window.setInterval(() => {
      setEmbeddedLoadProgress((current) => {
        const currentValue = current[tab] || 8;
        if (currentValue >= 92) return current;
        const nextValue = Math.min(92, currentValue + (currentValue < 55 ? 11 : 5));
        return { ...current, [tab]: nextValue };
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [activeEmbeddedKcfxLoading, activeEmbeddedKcfxPage]);

  useEffect(() => {
    function closeFilters() {
      setOpenFilter('');
    }
    window.addEventListener('click', closeFilters);
    return () => window.removeEventListener('click', closeFilters);
  }, []);

  const supplierMetaByName = useMemo(() => {
    return new Map(suppliers.map((supplier) => [supplier.name, supplier]));
  }, [suppliers]);

  const ownerBySupplier = useMemo(() => {
    return new Map(owners.map((item) => [item.supplier, item.owner]));
  }, [owners]);

  const ownerByNormalizedSupplier = useMemo(() => {
    return new Map(owners.map((item) => [normalizeSupplierName(item.supplier), item.owner]));
  }, [owners]);

  function normalizeSupplierName(value) {
    return String(value || '').replace(/\s+/g, '').trim();
  }

  function findSupplierMeta(name) {
    const normalizedName = normalizeSupplierName(name);
    return supplierMetaByName.get(name) ||
      suppliers.find((supplier) => normalizeSupplierName(supplier.name) === normalizedName);
  }

  function supplierShortName(name) {
    return findSupplierMeta(name)?.shortName || '未匹配简称';
  }

  function extractProvinceCity(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const provinceMatch = text.match(/([\u4e00-\u9fa5]{2,}(?:省|自治区|市))/);
    const cityMatch = text.match(/([\u4e00-\u9fa5]{2,}(?:市|自治州|地区|盟))/);
    const parts = [];
    if (provinceMatch?.[1]) parts.push(provinceMatch[1]);
    if (cityMatch?.[1] && cityMatch[1] !== provinceMatch?.[1]) parts.push(cityMatch[1]);
    return parts.join('') || '';
  }

  function findSupplierAddressByShortName(shortName) {
    const textShortName = normalizeOptionText(shortName);
    const addressFromPurchaseDivision = inspectionSupplierAddressByShortName.get(textShortName);
    if (addressFromPurchaseDivision) return addressFromPurchaseDivision;
    const normalizedShortName = normalizeSupplierName(textShortName);
    if (!normalizedShortName) return '';
    const supplier = suppliers.find((item) =>
      normalizeSupplierName(item.shortName) === normalizedShortName ||
      normalizeSupplierName(item.name) === normalizedShortName ||
      normalizeSupplierName(item.name).includes(normalizedShortName)
    );
    if (!supplier) return '';
    return extractProvinceCity(supplier.address || supplier.provinceCity || supplier.city || supplier.name);
  }

  function calculatePaymentDate(supplierName, issueDate) {
    const termDays = Number(findSupplierMeta(supplierName)?.termDays);
    if (!issueDate || !Number.isFinite(termDays) || termDays <= 0) return '供应商维度表供应商信息不一致';
    const parts = issueDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '供应商维度表供应商信息不一致';
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + termDays);
    return date.toISOString().slice(0, 10);
  }

  function calculateOaSubmitDate(paymentDate, amount) {
    const date = parseLocalDate(paymentDate);
    if (!date) return paymentDate || '供应商维度表供应商信息不一致';
    const amountValue = Number(amount || 0);
    const advanceDays = amountValue > 100000 ? 14 : 7;
    date.setDate(date.getDate() - advanceDays);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(value) {
    const parts = String(value || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function currentNaturalWeek() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start, end };
  }

  function isThisWeekPayment(paymentDate) {
    const date = parseLocalDate(paymentDate);
    if (!date) return false;
    const { start, end } = currentNaturalWeek();
    return date >= start && date <= end;
  }

  function currentNaturalMonth() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { start, end };
  }

  function isThisMonthPayment(paymentDate) {
    const date = parseLocalDate(paymentDate);
    if (!date) return false;
    const { start, end } = currentNaturalMonth();
    return date >= start && date <= end;
  }

  function findBuyerForSupplier(supplierName) {
    const normalizedName = normalizeSupplierName(supplierName);
    const exactOwner = ownerBySupplier.get(supplierName) ||
      ownerByNormalizedSupplier.get(normalizedName);
    if (exactOwner) return exactOwner;

    const matchedSupplier = suppliers.find((supplier) => {
      const shortName = normalizeSupplierName(supplier.shortName);
      return shortName && normalizedName.includes(shortName);
    });
    const shortName = normalizeSupplierName(matchedSupplier?.shortName);
    if (!shortName) return '';
    return owners.find((item) => normalizeSupplierName(item.supplier).includes(shortName))?.owner || '';
  }

  function uniqueOptions(rows, field, mapper = (value) => value || '未分配') {
    const seen = new Set();
    return rows
      .map((row) => row[field])
      .filter(Boolean)
      .filter((value) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      })
      .map((value) => ({ value, label: mapper(value) }));
  }

  function uniqueValueOptions(values) {
    const seen = new Set();
    return values
      .filter(Boolean)
      .filter((value) => {
        if (seen.has(value)) return false;
        seen.add(value);
        return true;
      })
      .map((value) => ({ value, label: value }));
  }

  function classifyLogPage(row) {
    const type = String(row.type || '');
    const content = String(row.content || '');
    const text = `${type} ${content}`;
    if (text.includes('验货通知')) {
      return { secondPage: '品质验货', thirdPage: '验货通知' };
    }
    if (text.includes('发票库存删除')) {
      return { secondPage: '系统文件库', thirdPage: '发票信息库存查看' };
    }
    if (text.includes('供应商') && (text.includes('维度') || text.includes('账期') || text.includes('采购'))) {
      return { secondPage: '维护文件库', thirdPage: '供应商管理维度表' };
    }
    if (text.includes('OCR') || text.includes('已上传') || text.includes('上传')) {
      return { secondPage: '供应商付款提醒', thirdPage: '发票上传' };
    }
    if (text.includes('付款') || text.includes('OA') || text.includes('状态更新') || text.includes('定时邮件')) {
      return { secondPage: '供应商付款提醒', thirdPage: '供应商付款看板' };
    }
    return { secondPage: '未分类', thirdPage: '未分类' };
  }

  const supplierOptions = useMemo(() => {
    const seen = new Set();
    return invoices
      .map((invoice) => {
        const supplier = findSupplierMeta(invoice.supplier);
        return supplier?.shortName
          ? { value: invoice.supplier, label: supplier.shortName }
          : null;
      })
      .filter(Boolean)
      .filter((option) => {
        if (seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      });
  }, [invoices, suppliers, supplierMetaByName]);
  const ownerOptions = useMemo(() => {
    return uniqueValueOptions(invoices.map((invoice) => findBuyerForSupplier(invoice.supplier)));
  }, [invoices, ownerByNormalizedSupplier, ownerBySupplier, owners, suppliers]);
  const statusOptions = useMemo(() => {
    return uniqueValueOptions([
      ...invoices.map((invoice) => invoice.status),
      '待提交付款申请',
      '待打印OA单据',
      '待财务付款',
      '完成'
    ]);
  }, [invoices]);
  const ledgerInvoices = useMemo(() => {
    return invoices.map((invoice) => {
      const supplier = findSupplierMeta(invoice.supplier);
      const termDays = Number(supplier?.termDays);
      const paymentDate = calculatePaymentDate(invoice.supplier, invoice.issueDate);
      return {
        ...invoice,
        buyer: findBuyerForSupplier(invoice.supplier) || '未匹配',
        termText: Number.isFinite(termDays) && termDays > 0 ? `${termDays}天` : '未匹配账期',
        paymentDate,
        oaSubmitDate: calculateOaSubmitDate(paymentDate, invoice.amount)
      };
    });
  }, [invoices, ownerByNormalizedSupplier, ownerBySupplier, owners, supplierMetaByName, suppliers]);
  const appliedDimensionRows = useMemo(() => {
    const supplierByName = new Map(suppliers.map((supplier) => [supplier.name, supplier]));
    const allSuppliers = new Set([...supplierByName.keys(), ...ownerBySupplier.keys()]);
    return [...allSuppliers].map((supplierName) => {
      const supplier = supplierByName.get(supplierName) || {};
      return {
        supplier: supplierName,
        shortName: supplier.shortName || supplierName,
        owner: ownerBySupplier.get(supplierName) || '未匹配',
        hasAnnualFrame: supplier.hasAnnualFrame || '',
        termDays: supplier.termDays || '',
        remark: supplier.remark || ''
      };
    });
  }, [ownerBySupplier, suppliers]);
  const inspectionPurchaseDivisionRows = useMemo(() => {
    return inspectionLibraryRecords['dim-purchase-division']?.rows || [];
  }, [inspectionLibraryRecords]);
  const inspectionProductRows = useMemo(() => {
    return inspectionLibraryRecords['dim-product']?.rows || [];
  }, [inspectionLibraryRecords]);
  const inspectionSupplierAddressByShortName = useMemo(() => {
    const result = new Map();
    inspectionPurchaseDivisionRows.forEach((row) => {
      const shortName = readPhysicalColumn(row, PURCHASE_DIVISION_SUPPLIER_COLUMN);
      if (!shortName || result.has(shortName)) return;
      result.set(shortName, extractProvinceCity(readPhysicalColumn(row, PURCHASE_DIVISION_ADDRESS_COLUMN)));
    });
    return result;
  }, [inspectionPurchaseDivisionRows]);
  const inspectionSupplierShortNameOptions = useMemo(() => {
    const purchaseDivisionOptions = inspectionPurchaseDivisionRows.map((row) => readPhysicalColumn(row, PURCHASE_DIVISION_SUPPLIER_COLUMN));
    const supplierFallbackOptions = suppliers.map((supplier) => supplier.shortName || supplier.name);
    return uniqueValueOptions([...purchaseDivisionOptions, ...supplierFallbackOptions]);
  }, [inspectionPurchaseDivisionRows, suppliers]);
  const inspectionProductLineOptions = useMemo(() => {
    return uniqueValueOptions(inspectionProductRows.map((row) => readPhysicalColumn(row, PRODUCT_LINE_COLUMN)));
  }, [inspectionProductRows]);
  const inspectionSeriesByProductLine = useMemo(() => {
    const result = new Map();
    inspectionProductRows.forEach((row) => {
      const productLine = readPhysicalColumn(row, PRODUCT_LINE_COLUMN);
      const series = readPhysicalColumn(row, PRODUCT_SERIES_COLUMN);
      if (!productLine || !series) return;
      if (!result.has(productLine)) result.set(productLine, []);
      result.get(productLine).push(series);
    });
    return new Map([...result.entries()].map(([productLine, values]) => [productLine, uniqueOptionValues(values)]));
  }, [inspectionProductRows]);
  useEffect(() => {
    if (!user || inspectionSupplierAddressByShortName.size === 0) return;
    setInspectionNoticeRows((rows) => rows.map((row) => {
      const address = inspectionSupplierAddressByShortName.get(normalizeOptionText(row.supplierShortName));
      if (!address || row.supplierAddress === address) return row;
      return { ...row, supplierAddress: address };
    }));
  }, [inspectionSupplierAddressByShortName, user]);
  const dimensionShortNameOptions = useMemo(() => {
    return uniqueValueOptions(suppliers.map((supplier) => supplier.shortName));
  }, [suppliers]);
  const dimensionOwnerOptions = useMemo(() => {
    return uniqueValueOptions(owners.map((item) => item.owner));
  }, [owners]);
  const dimensionAnnualOptions = useMemo(() => {
    return uniqueValueOptions(suppliers.map((supplier) => supplier.hasAnnualFrame));
  }, [suppliers]);
  const inspectionInitialColumns = useMemo(() => {
    return inspectionInitialData.columns?.length ? inspectionInitialData.columns : ['暂无字段'];
  }, [inspectionInitialData.columns]);
  const filteredAppliedDimensionRows = useMemo(() => {
    return appliedDimensionRows.filter((row) =>
      (dimensionShortNameFilter.length === 0 || dimensionShortNameFilter.includes(row.shortName)) &&
      (dimensionOwnerFilter.length === 0 || dimensionOwnerFilter.includes(row.owner)) &&
      (dimensionAnnualFilter.length === 0 || dimensionAnnualFilter.includes(row.hasAnnualFrame))
    );
  }, [appliedDimensionRows, dimensionAnnualFilter, dimensionOwnerFilter, dimensionShortNameFilter]);
  const logRows = useMemo(() => {
    return reminders.map((row) => ({
      ...row,
      ...classifyLogPage(row)
    }));
  }, [reminders]);
  const logSecondPageOptions = useMemo(() => {
    return uniqueValueOptions(logRows.map((row) => row.secondPage));
  }, [logRows]);
  const logThirdPageOptions = useMemo(() => {
    const availableRows = logSecondPageFilter.length
      ? logRows.filter((row) => logSecondPageFilter.includes(row.secondPage))
      : logRows;
    return uniqueValueOptions(availableRows.map((row) => row.thirdPage));
  }, [logRows, logSecondPageFilter]);
  const filteredLogRows = useMemo(() => {
    const start = logStartDate ? parseLocalDate(logStartDate) : null;
    const end = logEndDate ? parseLocalDate(logEndDate) : null;
    return logRows.filter((row) => {
      const rowDate = parseLocalDate(String(row.createdAt || '').slice(0, 10));
      return (logSecondPageFilter.length === 0 || logSecondPageFilter.includes(row.secondPage)) &&
        (logThirdPageFilter.length === 0 || logThirdPageFilter.includes(row.thirdPage)) &&
        (!start || (rowDate && rowDate >= start)) &&
        (!end || (rowDate && rowDate <= end));
    });
  }, [logEndDate, logRows, logSecondPageFilter, logStartDate, logThirdPageFilter]);
  const supplierStats = useMemo(() => {
    const failed = supplierImportResult?.failedCount || 0;
    const success = supplierImportResult?.importedCount ?? suppliers.length;
    const total = supplierImportResult ? success + failed : suppliers.length;
    return { total, success, failed };
  }, [supplierImportResult, suppliers.length]);

  const filteredInvoices = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ledgerInvoices.filter((item) =>
      (supplierFilter.length === 0 || supplierFilter.includes(item.supplier)) &&
      (ownerFilter.length === 0 || ownerFilter.includes(item.buyer)) &&
      (statusFilter.length === 0 || statusFilter.includes(item.status)) &&
      (paymentWeekFilter.length === 0 || (paymentWeekFilter.includes('thisWeek') && isThisWeekPayment(item.paymentDate))) &&
      (paymentMonthFilter.length === 0 || (paymentMonthFilter.includes('thisMonth') && isThisMonthPayment(item.paymentDate))) &&
      (oaSubmitWeekFilter.length === 0 || (oaSubmitWeekFilter.includes('thisWeek') && isThisWeekPayment(item.oaSubmitDate))) &&
      (!text || [item.invoiceNo, item.supplier, supplierShortName(item.supplier), item.buyer, item.status, item.issueDate, item.paymentDate, item.oaSubmitDate]
        .join(' ')
        .toLowerCase()
        .includes(text))
    );
  }, [ledgerInvoices, oaSubmitWeekFilter, ownerFilter, paymentMonthFilter, paymentWeekFilter, query, statusFilter, supplierFilter, supplierMetaByName]);
  const ledgerStats = useMemo(() => {
    const uniqueSupplierCount = (rows) => new Set(rows.map((row) => row.supplier).filter(Boolean)).size;
    const amountTotal = (rows) => rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const pendingRows = filteredInvoices.filter((row) => row.status === '待提交付款申请');
    const notDueRows = pendingRows.filter((row) => {
      const paymentDate = parseLocalDate(row.paymentDate);
      return paymentDate && paymentDate > todayStart;
    });
    const submittedRows = filteredInvoices.filter((row) => String(row.oaProcessNo || '').trim());
    const awaitingFinanceRows = filteredInvoices.filter((row) => row.status === '待财务付款');
    const completedRows = filteredInvoices.filter((row) => row.status === '完成');
    const thisWeekRows = pendingRows.filter((row) => isThisWeekPayment(row.oaSubmitDate));
    const thisMonthRows = pendingRows.filter((row) => isThisMonthPayment(row.oaSubmitDate));

    return {
      uploadedSupplierCount: uniqueSupplierCount(filteredInvoices),
      notDueSupplierCount: uniqueSupplierCount(notDueRows),
      submittedOaSupplierCount: uniqueSupplierCount(submittedRows),
      awaitingFinanceCount: awaitingFinanceRows.length,
      completedSupplierCount: uniqueSupplierCount(completedRows),
      thisWeekSupplierCount: uniqueSupplierCount(thisWeekRows),
      thisWeekAmount: amountTotal(thisWeekRows),
      thisMonthSupplierCount: uniqueSupplierCount(thisMonthRows),
      thisMonthAmount: amountTotal(thisMonthRows)
    };
  }, [filteredInvoices]);

  function resetFilters() {
    setSupplierFilter([]);
    setOwnerFilter([]);
    setStatusFilter([]);
    setPaymentWeekFilter([]);
    setPaymentMonthFilter([]);
    setOaSubmitWeekFilter([]);
  }

  function togglePaymentPeriod(period) {
    setOpenFilter('');
    if (period === 'week') {
      setPaymentWeekFilter((current) => current.length ? [] : ['thisWeek']);
      setPaymentMonthFilter([]);
      setOaSubmitWeekFilter([]);
      return;
    }
    setPaymentMonthFilter((current) => current.length ? [] : ['thisMonth']);
    setPaymentWeekFilter([]);
    setOaSubmitWeekFilter([]);
  }

  function toggleOaSubmitWeek() {
    setOpenFilter('');
    setOaSubmitWeekFilter((current) => current.length ? [] : ['thisWeek']);
    setPaymentWeekFilter([]);
    setPaymentMonthFilter([]);
  }

  function resetDimensionFilters() {
    setDimensionShortNameFilter([]);
    setDimensionOwnerFilter([]);
    setDimensionAnnualFilter([]);
  }

  function resetLogFilters() {
    setLogSecondPageFilter([]);
    setLogThirdPageFilter([]);
    setLogStartDate('');
    setLogEndDate('');
    setOpenFilter('');
  }

  async function login(event) {
    event.preventDefault();
    const name = loginName.trim();
    if (!name || !password) {
      setMessage('请填写姓名和密码。');
      return;
    }
    const res = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password })
    });
    if (!res.ok) {
      setMessage(res.status === 403 ? '注册申请待孙立柱审核，审核通过后再登录。' : '账号或密码不正确。');
      return;
    }
    const nextUser = await res.json();
    localStorage.setItem('invoiceUser', JSON.stringify(nextUser));
    setUser(nextUser);
    setPassword('');
    setMessage('');
  }

  async function register(event) {
    event.preventDefault();
    const name = registerName.trim();
    const nextPassword = registerPassword.trim();
    if (!name || !nextPassword) {
      setMessage('请填写注册姓名和密码。');
      return;
    }
    if (nextPassword !== registerPasswordConfirm.trim()) {
      setMessage('两次密码不一致。');
      return;
    }
    const res = await fetch(`${API}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: nextPassword })
    });
    if (!res.ok) {
      setMessage(res.status === 409 ? '这个姓名已经存在，请直接登录或联系孙立柱。' : '注册申请提交失败。');
      return;
    }
    setRegisterName('');
    setRegisterPassword('');
    setRegisterPasswordConfirm('');
    setAuthMode('login');
    setMessage('注册申请已提交，请等待孙立柱审核后登录。');
  }

  async function uploadFiles(files) {
    const form = new FormData();
    [...files].forEach((file) => form.append('files', file));
    form.append('user', user.name);
    const res = await fetch(`${API}/api/upload`, { method: 'POST', body: form });
    const result = await res.json();
    const created = result.created || result;
    const duplicates = result.duplicates || [];
    const duplicateNos = [...new Set(duplicates.map((item) => item.invoiceNo).filter(Boolean))];
    const duplicateMessage = duplicateNos.length ? `有发票重复，已保留一条：${duplicateNos.join('、')}。` : '';
    setMessage(`已上传 ${created.length} 个文件，识别结果已进入待确认。${duplicateMessage}`);
    await loadData();
  }

  async function confirmDraft(id) {
    await fetch(`${API}/api/drafts/${id}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: user.name })
    });
    setMessage('发票已确认，并已生成付款申请提醒。');
    await loadData();
  }

  async function deleteDraft(id) {
    await fetch(`${API}/api/drafts/${id}?user=${encodeURIComponent(user.name)}`, { method: 'DELETE' });
    setMessage('待确认记录已删除。');
    await loadData();
  }

  async function updateInvoice(id, patch) {
    await fetch(`${API}/api/invoices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, user: user.name })
    });
    await loadData();
  }

  async function deleteInvoice(id) {
    if (!window.confirm('确认删除这条发票库存记录吗？删除后无法恢复。')) return;
    const res = await fetch(`${API}/api/invoices/${id}?user=${encodeURIComponent(user.name)}`, { method: 'DELETE' });
    if (!res.ok) {
      setMessage('发票库存删除失败，请确认当前账号有权限。');
      return;
    }
    setMessage('发票库存记录已删除。');
    await loadData();
  }

  async function addSupplier(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await fetch(`${API}/api/suppliers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: data.get('supplier'), termDays: Number(data.get('termDays')), user: user.name })
    });
    event.currentTarget.reset();
    await loadData();
  }

  async function uploadSupplierTerms(files) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('user', user.name);
    const res = await fetch(`${API}/api/suppliers/import-terms`, { method: 'POST', body: form });
    if (!res.ok) {
      setMessage('供应商账期维度表导入失败，请检查文件格式。');
      return;
    }
    const result = await res.json();
    setSuppliers(result.suppliers || []);
    setSupplierImportResult(result);
    setMessage(`供应商账期维度表已读取：成功 ${result.importedCount} 行，失败 ${result.failedCount} 行。`);
  }

  async function uploadOwners(files) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('user', user.name);
    const res = await fetch(`${API}/api/owners/import`, { method: 'POST', body: form });
    if (!res.ok) {
      setMessage('采购负责人维度表导入失败，请检查文件格式。');
      return;
    }
    const result = await res.json();
    setOwners(result.owners || []);
    setOwnerImportResult(result);
    setMessage(`采购负责人维度表已读取：成功 ${result.importedCount} 行，失败 ${result.failedCount} 行。`);
  }

  async function uploadInspectionInitialData(files) {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('user', user.name);
    const res = await fetch(`${API}/api/quality-inspection/initial-data/import`, { method: 'POST', body: form });
    if (!res.ok) {
      setMessage('验货信息初始数据导入失败，请检查文件格式。');
      return;
    }
    const result = await res.json();
    setInspectionInitialData(result);
    setInspectionInitialImportResult(result);
    setMessage(`验货信息初始数据已读取：成功 ${result.importedCount || 0} 行。`);
  }

  function inspectionSeriesOptionsForProductLine(productLine) {
    const values = inspectionSeriesByProductLine.get(productLine) || [];
    return uniqueValueOptions(values);
  }

  function updateInspectionNoticeRow(id, field, value) {
    setInspectionNoticeRows((rows) => rows.map((row) => (
      row.id === id
        ? (() => {
            const nextRow = {
              ...row,
              [field]: value,
              inspectionApplicant: user.name,
              supplierAddress: field === 'supplierShortName' ? findSupplierAddressByShortName(value) : row.supplierAddress
            };
            if (field === 'salesProductLine') {
              const allowedSeries = new Set((inspectionSeriesByProductLine.get(value) || []));
              nextRow.series = allowedSeries.has(row.series) ? row.series : '';
            }
            return nextRow;
          })()
        : row
    )));
  }

  function addInspectionNoticeRow() {
    setInspectionNoticeRows((rows) => [...rows, createInspectionNoticeRow({ inspectionApplicant: user.name })]);
  }

  function deleteInspectionNoticeRow(id) {
    setInspectionNoticeRows((rows) => {
      const nextRows = rows.filter((row) => row.id !== id);
      return nextRows.length ? nextRows : [createInspectionNoticeRow({ inspectionApplicant: user.name })];
    });
  }

  async function confirmInspectionNotice() {
    const rowsToSubmit = inspectionNoticeRows
      .map((row) => createInspectionNoticeRow({
        ...row,
        inspectionApplicant: user.name,
        supplierAddress: row.supplierAddress || findSupplierAddressByShortName(row.supplierShortName)
      }))
      .filter((row) => INSPECTION_NOTICE_FIELDS.some((field) => {
        const value = row[field.key];
        return Array.isArray(value) ? value.length : String(value || '').trim();
      }));
    if (!rowsToSubmit.length) {
      setMessage('请至少填写一条验货通知后再提交。');
      return;
    }
    const res = await fetch(`${API}/api/quality-inspection/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: user.name, rows: rowsToSubmit })
    });
    if (!res.ok) {
      setMessage('验货通知提交失败，请确认当前账号有权限。');
      return;
    }
    const result = await res.json();
    const savedRows = result.rows?.length
      ? result.rows.map((row) => createInspectionNoticeRow({
          ...row,
          inspectionApplicant: row.inspectionApplicant || user.name,
          supplierAddress: row.supplierAddress || findSupplierAddressByShortName(row.supplierShortName)
        }))
      : [createInspectionNoticeRow({ inspectionApplicant: user.name })];
    setInspectionNoticeSubmission(result);
    setInspectionNoticeRows(savedRows);
    setMessage(`验货通知已确认提交：共 ${result.rows?.length || 0} 条。`);
    await loadData();
  }

  function downloadImportResult(type, result) {
    if (!result) return;
    const workbook = XLSX.utils.book_new();
    const isSupplier = type === 'supplier';
    const successRows = isSupplier
      ? result.imported.map((item) => ({
          行号: item.rowNumber,
          供应商: item.supplier,
          供应商简称: item.shortName,
          是否有年框: item.hasAnnualFrame || '',
          账期天数: item.termDays,
          备注信息: item.remark || ''
        }))
      : result.imported.map((item) => ({
          行号: item.rowNumber,
          采购人: item.owner,
          供应商: item.supplier,
          邮箱: item.email || ''
        }));
    const failedRows = result.failed.map((item) => ({
      行号: item.rowNumber,
      采购人: item.owner || '',
      供应商: item.supplier || '',
      邮箱: item.email || '',
      供应商简称: item.shortName || '',
      账期原文: item.termText || '',
      错误原因: item.reason
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(successRows), '识别成功');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(failedRows), '识别失败');
    const fileName = `${isSupplier ? '供应商账期维度表' : '采购负责人维度表'}_读取识别结果.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  function downloadAppliedPreview() {
    const rows = filteredAppliedDimensionRows.map((row) => ({
      供应商: row.supplier,
      供应商简称: row.shortName,
      采购员: row.owner,
      是否有年框: row.hasAnnualFrame,
      账期: row.termDays ? `${row.termDays} 天` : '',
      备注信息: row.remark
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '应用的表预览');
    XLSX.writeFile(workbook, '供应商管理维度表_应用的表预览.xlsx');
  }

  async function addOwner(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await fetch(`${API}/api/owners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner: data.get('owner'), supplier: data.get('supplier'), user: user.name })
    });
    event.currentTarget.reset();
    await loadData();
  }

  async function saveMailSettings(event) {
    event.preventDefault();
    const res = await fetch(`${API}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: user.name,
        senderEmail: senderEmailInput,
        smtpPassword: smtpPasswordInput
      })
    });
    if (!res.ok) {
      setMessage('只有孙立柱可以修改邮件配置。');
      return;
    }
    const settings = await res.json();
    setSenderEmail(settings.senderEmail || '');
    setSenderEmailInput(settings.senderEmail || '');
    setSmtpPasswordConfigured(Boolean(settings.smtpPasswordConfigured));
    setSmtpPasswordInput('');
    setMessage('邮件配置已保存。');
  }

  async function createManagedUser(event) {
    event.preventDefault();
    const name = newUserName.trim();
    if (!name) {
      setMessage('请填写注册人姓名。');
      return;
    }
    const res = await fetch(`${API}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: user.name,
        name,
        password: newUserPassword || '123456',
        role: '普通用户',
        permissions: [],
        status: 'approved'
      })
    });
    if (!res.ok) {
      setMessage(res.status === 409 ? '这个姓名已经存在。' : '新增用户失败。');
      return;
    }
    setNewUserName('');
    setNewUserPassword('123456');
    await loadData();
    setMessage('用户已新增。');
  }

  async function updateManagedUser(target, patch) {
    const res = await fetch(`${API}/api/users/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: user.name, ...patch })
    });
    if (!res.ok) {
      setMessage('权限保存失败。');
      return false;
    }
    const updated = await res.json();
    setManagedUsers((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    setMessage('权限已保存。');
    return true;
  }

  async function resetManagedPassword(target) {
    const nextPassword = String(passwordResets[target.id] || '').trim();
    if (!nextPassword) {
      setMessage('请填写新密码。');
      return;
    }
    const ok = await updateManagedUser(target, { password: nextPassword });
    if (ok) {
      setPasswordResets((current) => ({ ...current, [target.id]: '' }));
      setMessage(`${target.name} 的密码已重置。`);
    }
  }

  function managedPermissionSet(target) {
    return new Set(Array.isArray(target.permissions) ? target.permissions : []);
  }

  function isManagedPermissionChecked(target, permission) {
    if (target.name === systemOwnerName) return true;
    return managedPermissionSet(target).has(permission);
  }

  function toggleManagedGroup(target, group) {
    if (target.name === systemOwnerName || group.fixedOwnerOnly) return;
    const permissions = managedPermissionSet(target);
    const children = group.children.map((item) => item.value);
    const allChecked = children.length
      ? children.every((item) => permissions.has(item))
      : permissions.has(group.value);
    if (allChecked) {
      permissions.delete(group.value);
      children.forEach((item) => permissions.delete(item));
    } else {
      permissions.add(group.value);
      children.forEach((item) => permissions.add(item));
    }
    updateManagedUser(target, { permissions: [...permissions] });
  }

  function toggleManagedPermission(target, group, permission) {
    if (target.name === systemOwnerName || group.fixedOwnerOnly) return;
    const permissions = managedPermissionSet(target);
    if (permissions.has(permission)) {
      permissions.delete(permission);
    } else {
      permissions.add(permission);
    }
    const hasAnyChild = group.children.some((item) => permissions.has(item.value));
    if (hasAnyChild) {
      permissions.add(group.value);
    } else {
      permissions.delete(group.value);
    }
    updateManagedUser(target, { permissions: [...permissions] });
  }

  function openPreview(row) {
    if (!row.fileName) {
      setMessage('这个记录没有可预览的原文件。');
      return;
    }
    const isPdf = row.mimeType === 'application/pdf' || row.originalName?.toLowerCase().endsWith('.pdf');
    const displayName = isPdf ? 'invoice.pdf' : 'invoice-file';
    setPreviewFile({
      url: `${API}/preview/${encodeURIComponent(row.fileName)}/${displayName}`,
      title: row.invoiceNo || '发票原件',
      isPdf,
      row
    });
  }

  function sanitizeDownloadName(value, fallback = '未填写') {
    return String(value || fallback)
      .trim()
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '');
  }

  function fileExtension(row) {
    const originalName = String(row.originalName || '');
    const match = originalName.match(/\.[A-Za-z0-9]+$/);
    if (match) return match[0].toLowerCase();
    if (row.mimeType === 'application/pdf') return '.pdf';
    if (row.mimeType === 'image/png') return '.png';
    if (row.mimeType === 'image/jpeg') return '.jpg';
    if (row.mimeType === 'image/gif') return '.gif';
    if (row.mimeType === 'image/webp') return '.webp';
    return '';
  }

  function invoiceDownloadName(row) {
    const amount = Number(row.amount);
    const amountText = Number.isFinite(amount) ? String(amount) : String(row.amount || '未填金额');
    return [
      sanitizeDownloadName(row.supplier, '供应商'),
      sanitizeDownloadName(row.issueDate, '开票时间'),
      sanitizeDownloadName(amountText, '金额')
    ].join('_') + fileExtension(row);
  }

  async function downloadInvoiceFile(row) {
    if (!row.fileName) {
      setMessage('这个发票没有可下载的原文件。');
      return;
    }
    const link = document.createElement('a');
    const downloadName = invoiceDownloadName(row);
    link.href = `${API}/download?fileName=${encodeURIComponent(row.fileName)}&downloadName=${encodeURIComponent(downloadName)}`;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function formatBytes(value) {
    const size = Number(value) || 0;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
  }

  function downloadSystemPackage(packageId) {
    if (!user) return;
    const link = document.createElement('a');
    link.href = `${API}/api/system-file-library/${encodeURIComponent(packageId)}/download?user=${encodeURIComponent(user.name)}&role=${encodeURIComponent(user.role)}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (!user) {
    return (
      <main className="login-shell">
        {authMode === 'login' ? (
          <form className="login-panel" onSubmit={login}>
            <h1>供应链AI系统</h1>
            <label>
              姓名
              <input
                name="username"
                autoComplete="username"
                value={loginName}
                onChange={(event) => setLoginName(event.target.value)}
              />
            </label>
            <label>
              密码
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button>登录</button>
            <button
              type="button"
              className="ghost auth-switch-button"
              onClick={() => {
                setAuthMode('register');
                setMessage('');
              }}
            >
              注册
            </button>
            {message && <p className="message">{message}</p>}
          </form>
        ) : (
          <form className="login-panel" onSubmit={register}>
            <h1>申请注册</h1>
            <label>
              姓名
              <input
                name="username"
                autoComplete="username"
                value={registerName}
                onChange={(event) => setRegisterName(event.target.value)}
              />
            </label>
            <label>
              密码
              <input
                name="new-password"
                type="password"
                autoComplete="new-password"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
              />
            </label>
            <label>
              确认密码
              <input
                name="confirm-password"
                type="password"
                autoComplete="new-password"
                value={registerPasswordConfirm}
                onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
              />
            </label>
            <button>提交注册申请</button>
            <button
              type="button"
              className="ghost auth-switch-button"
              onClick={() => {
                setAuthMode('login');
                setMessage('');
              }}
            >
              返回登录
            </button>
            {message && <p className="message">{message}</p>}
          </form>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>供应链AI系统</h1>
        <div className="app-version-time">版本时间：{appVersionTime}</div>
        <nav className="sidebar-menu" aria-label="系统菜单">
          {canAccessSupplierPayment && (
          <div className="menu-group">
              <button
                type="button"
                className={`menu-group-toggle ${isMenuGroupExpanded('supplierPayment') ? 'active' : ''}`}
                onClick={() => toggleMenuGroup('supplierPayment')}
                aria-expanded={isMenuGroupExpanded('supplierPayment')}
              >
                供应商付款提醒
                <span>{isMenuGroupExpanded('supplierPayment') ? '▾' : '▸'}</span>
              </button>
              {isMenuGroupExpanded('supplierPayment') && (
              <div className="submenu-list">
                {canAccessTab('ledger') && (
                  <button className={activeTab === 'ledger' ? 'active' : ''} onClick={() => openMenuTab('ledger', 'supplierPayment')}>供应商付款看板</button>
                )}
                {canAccessTab('upload') && (
                  <button className={activeTab === 'upload' ? 'active' : ''} onClick={() => openMenuTab('upload', 'supplierPayment')}>发票上传</button>
                )}
              </div>
            )}
          </div>
          )}
          {canAccessQualityInspection && (
          <div className="menu-group">
              <button
                type="button"
                className={`menu-group-toggle ${isMenuGroupExpanded('qualityInspection') ? 'active' : ''}`}
                onClick={() => toggleMenuGroup('qualityInspection')}
                aria-expanded={isMenuGroupExpanded('qualityInspection')}
              >
                品质验货
                <span>{isMenuGroupExpanded('qualityInspection') ? '▾' : '▸'}</span>
              </button>
              {isMenuGroupExpanded('qualityInspection') && (
              <div className="submenu-list">
                {canAccessTab('inspectionNotice') && (
                  <button className={activeTab === 'inspectionNotice' ? 'active' : ''} onClick={() => openMenuTab('inspectionNotice', 'qualityInspection')}>验货通知</button>
                )}
                {canAccessTab('inspectionSchedule') && (
                  <button className={activeTab === 'inspectionSchedule' ? 'active' : ''} onClick={() => openMenuTab('inspectionSchedule', 'qualityInspection')}>验货安排</button>
                )}
                {canAccessTab('inspectionReportUpload') && (
                  <button className={activeTab === 'inspectionReportUpload' ? 'active' : ''} onClick={() => openMenuTab('inspectionReportUpload', 'qualityInspection')}>检验报告单回传</button>
                )}
                {canAccessTab('inspectionFeedback') && (
                  <button className={activeTab === 'inspectionFeedback' ? 'active' : ''} onClick={() => openMenuTab('inspectionFeedback', 'qualityInspection')}>验货反馈</button>
                )}
                {canAccessTab('inspectionReportQuery') && (
                  <button className={activeTab === 'inspectionReportQuery' ? 'active' : ''} onClick={() => openMenuTab('inspectionReportQuery', 'qualityInspection')}>检验报告单查询</button>
                )}
                {canAccessTab('inspectionSummary') && (
                  <button className={activeTab === 'inspectionSummary' ? 'active' : ''} onClick={() => openMenuTab('inspectionSummary', 'qualityInspection')}>验货信息汇总表</button>
                )}
                {canAccessTab('inspectionInitialData') && (
                  <button className={activeTab === 'inspectionInitialData' ? 'active' : ''} onClick={() => openMenuTab('inspectionInitialData', 'qualityInspection')}>验货信息初始数据</button>
                )}
              </div>
            )}
          </div>
          )}
          {canAccessSalesInventory && (
          <div className="menu-group">
              <button
                type="button"
                className={`menu-group-toggle ${isMenuGroupExpanded('salesInventory') ? 'active' : ''}`}
                onClick={() => toggleMenuGroup('salesInventory')}
                aria-expanded={isMenuGroupExpanded('salesInventory')}
              >
                销售及库存看板
                <span>{isMenuGroupExpanded('salesInventory') ? '▾' : '▸'}</span>
              </button>
              {isMenuGroupExpanded('salesInventory') && (
              <div className="submenu-list">
                {SALES_INVENTORY_PAGES.filter((page) => canAccessTab(page.tab)).map((page) => (
                  <button
                    key={page.tab}
                    className={activeTab === page.tab ? 'active' : ''}
                    onClick={() => openMenuTab(page.tab, 'salesInventory')}
                  >
                    {page.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          {canAccessMaintenanceLibrary && (
          <div className="menu-group">
              <button
                type="button"
                className={`menu-group-toggle ${isMenuGroupExpanded('maintenanceLibrary') ? 'active' : ''}`}
                onClick={() => toggleMenuGroup('maintenanceLibrary')}
                aria-expanded={isMenuGroupExpanded('maintenanceLibrary')}
              >
                维护文件库
                <span>{isMenuGroupExpanded('maintenanceLibrary') ? '▾' : '▸'}</span>
              </button>
              {isMenuGroupExpanded('maintenanceLibrary') && (
              <div className="submenu-list">
                {MAINTENANCE_LIBRARY_MENU_PAGES.filter((page) => canAccessTab(page.tab)).map((page) => (
                  <button
                    key={page.tab}
                    className={activeTab === page.tab ? 'active' : ''}
                    onClick={() => openMenuTab(page.tab, 'maintenanceLibrary')}
                  >
                    {page.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          {canAccessSystemFileLibrary && (
          <div className="menu-group">
              <button
                type="button"
                className={`menu-group-toggle ${isMenuGroupExpanded('systemFileLibrary') ? 'active' : ''}`}
                onClick={() => toggleMenuGroup('systemFileLibrary')}
                aria-expanded={isMenuGroupExpanded('systemFileLibrary')}
              >
                系统文件库
                <span>{isMenuGroupExpanded('systemFileLibrary') ? '▾' : '▸'}</span>
              </button>
              {isMenuGroupExpanded('systemFileLibrary') && (
              <div className="submenu-list">
                {SYSTEM_FILE_LIBRARY_MENU_PAGES.filter((page) => canAccessTab(page.tab)).map((page) => (
                  <button
                    key={page.tab}
                    className={activeTab === page.tab ? 'active' : ''}
                    onClick={() => openMenuTab(page.tab, 'systemFileLibrary')}
                  >
                    {page.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          )}
          {canManagePermissions && (
          <div className="menu-group">
              <button
                type="button"
                className={`menu-group-toggle ${isMenuGroupExpanded('systemManagement') ? 'active' : ''}`}
                onClick={() => toggleMenuGroup('systemManagement')}
                aria-expanded={isMenuGroupExpanded('systemManagement')}
              >
                系统管理
                <span>{isMenuGroupExpanded('systemManagement') ? '▾' : '▸'}</span>
              </button>
              {isMenuGroupExpanded('systemManagement') && (
              <div className="submenu-list">
                <button className={activeTab === 'permissionManagement' ? 'active' : ''} onClick={() => openMenuTab('permissionManagement', 'systemManagement')}>权限管理</button>
                <button className={activeTab === 'reminders' ? 'active' : ''} onClick={() => openMenuTab('reminders', 'systemManagement')}>操作日志</button>
              </div>
            )}
          </div>
          )}
        </nav>
        <div className="user-box">
          <strong>{user.name}</strong>
          <span>{user.role}</span>
          {canManageMailSettings && (
            <div className="sender-email">
              <small>发送邮箱</small>
              <span>{senderEmail || '未设置'}</span>
              <small>SMTP授权码</small>
              <span>{smtpPasswordConfigured ? '已配置' : '未配置'}</span>
            </div>
          )}
          {canManageMailSettings && (
            <form className="sender-email-form" onSubmit={saveMailSettings}>
              <input
                type="email"
                placeholder="填写发送邮箱"
                value={senderEmailInput}
                onChange={(event) => setSenderEmailInput(event.target.value)}
              />
              <input
                type="password"
                placeholder={smtpPasswordConfigured ? '留空则不修改授权码' : '填写SMTP授权码'}
                value={smtpPasswordInput}
                onChange={(event) => setSmtpPasswordInput(event.target.value)}
                autoComplete="new-password"
              />
              <button type="submit">保存邮件配置</button>
            </form>
          )}
          <button onClick={() => {
            localStorage.removeItem('invoiceUser');
            setUser(null);
            setLoginName('');
            setPassword('');
            setAuthMode('login');
          }}>退出</button>
        </div>
      </aside>

      <section className="content">
        {message && <div className="toast">{message}</div>}
        {activeTab === 'ledger' && canAccessTab('ledger') && (
          <>
            <div className="toolbar">
              <div className="board-heading-row">
                <h2>供应商付款看板</h2>
                <div className="filter-row" onClick={(event) => event.stopPropagation()}>
                  <MultiFilter
                    id="supplier"
                    label="供应商简称"
                    allLabel="供应商简称"
                    options={supplierOptions}
                    selected={supplierFilter}
                    onChange={setSupplierFilter}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                  />
                  <MultiFilter
                    id="owner"
                    label="采购员"
                    allLabel="采购员"
                    options={ownerOptions}
                    selected={ownerFilter}
                    onChange={setOwnerFilter}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                  />
                  <MultiFilter
                    id="status"
                    label="状态"
                    allLabel="状态"
                    options={statusOptions}
                    selected={statusFilter}
                    onChange={setStatusFilter}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                  />
                  <button
                    className={`quick-filter-button ${paymentWeekFilter.length ? 'active' : ''}`}
                    type="button"
                    onClick={() => togglePaymentPeriod('week')}
                  >
                    本周付款
                  </button>
                  <button
                    className={`quick-filter-button ${paymentMonthFilter.length ? 'active' : ''}`}
                    type="button"
                    onClick={() => togglePaymentPeriod('month')}
                  >
                    本月付款
                  </button>
                  <button
                    className={`quick-filter-button ${oaSubmitWeekFilter.length ? 'active' : ''}`}
                    type="button"
                    onClick={toggleOaSubmitWeek}
                  >
                    本周提交OA
                  </button>
                  <button className="ghost compact-button" onClick={resetFilters}>清空筛选</button>
                </div>
              </div>
              <input placeholder="搜索供应商、发票号、采购员或状态" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="metric-grid ledger-metric-grid">
              <div className="metric-card">
                <span>上传发票数量</span>
                <strong>{ledgerStats.uploadedSupplierCount}</strong>
              </div>
              <div className="metric-card">
                <span>未到付款时间数量</span>
                <strong>{ledgerStats.notDueSupplierCount}</strong>
              </div>
              <div className="metric-card">
                <span>已经提交OA流程</span>
                <strong>{ledgerStats.submittedOaSupplierCount}</strong>
              </div>
              <div className="metric-card">
                <span>待财务付款</span>
                <strong>{ledgerStats.awaitingFinanceCount}</strong>
              </div>
              <div className="metric-card">
                <span>已经完成</span>
                <strong>{ledgerStats.completedSupplierCount}</strong>
              </div>
              <div className="metric-card">
                <span>本周需要提交OA流程</span>
                <strong>{ledgerStats.thisWeekSupplierCount}</strong>
              </div>
              <div className="metric-card">
                <span>本周需要提交OA付款</span>
                <strong>{`¥${ledgerStats.thisWeekAmount.toLocaleString()}`}</strong>
              </div>
              <div className="metric-card">
                <span>本月需要提交OA流程</span>
                <strong>{ledgerStats.thisMonthSupplierCount}</strong>
              </div>
              <div className="metric-card">
                <span>本月需要提交OA付款</span>
                <strong>{`¥${ledgerStats.thisMonthAmount.toLocaleString()}`}</strong>
              </div>
            </div>
            <DataTable
              className="ledger-table"
              rows={filteredInvoices}
              columns={['采购员', '供应商', '发票号', '金额', '开票日', '账期', '付款时间', '提交OA时间', '下载发票', 'OA流程号', '是否已打印OA单据', '是否付款', '状态']}
              render={(row) => [
                row.buyer,
                row.supplier,
                row.invoiceNo,
                `¥${Number(row.amount).toLocaleString()}`,
                row.issueDate,
                row.termText,
                row.paymentDate,
                row.oaSubmitDate,
                <button className="ghost compact-button" onClick={() => openPreview(row)}>下载发票</button>,
                <input
                  className="table-input"
                  defaultValue={row.oaProcessNo || ''}
                  placeholder="填写OA流程号"
                  onBlur={(event) => updateInvoice(row.id, { oaProcessNo: event.target.value })}
                />,
                <select
                  className="table-select"
                  value={row.isOaPrinted || ''}
                  onChange={(event) => updateInvoice(row.id, { isOaPrinted: event.target.value })}
                >
                  <option value="">未填写</option>
                  <option value="否">否</option>
                  <option value="是">是</option>
                </select>,
                <select
                  className="table-select"
                  value={row.isPaid || ''}
                  onChange={(event) => updateInvoice(row.id, { isPaid: event.target.value })}
                >
                  <option value="">未完成</option>
                  <option value="是">是</option>
                </select>,
                row.status
              ]}
            />
          </>
        )}

        {activeTab === 'upload' && canAccessTab('upload') && (
          <>
            <h2>发票上传</h2>
            <label
              className="drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); uploadFiles(event.dataTransfer.files); }}
            >
              <input type="file" multiple accept="image/*,.pdf" onChange={(event) => uploadFiles(event.target.files)} />
              <span>点击或拖拽上传图片/PDF 发票</span>
            </label>
            <h3>待确认识别结果</h3>
            <DataTable
              rows={drafts}
              columns={['供应商', '开票号码', '开票金额', '开票日期', '状态', '文件预览', '操作']}
              render={(row) => [
                row.supplier,
                row.invoiceNo,
                `¥${Number(row.amount).toLocaleString()}`,
                row.issueDate,
                row.status,
                <button className="ghost" onClick={() => openPreview(row)}>查看文件</button>,
                <div className="actions"><button onClick={() => confirmDraft(row.id)}>确认</button><button className="ghost" onClick={() => deleteDraft(row.id)}>删除</button></div>
              ]}
            />
          </>
        )}

        {activeTab === 'invoiceInventory' && canAccessTab('invoiceInventory') && (
          <>
            <div className="section-heading-row">
              <h2>发票信息库存查看</h2>
              <span className="section-count">共 {invoices.length} 条</span>
            </div>
            <DataTable
              className="invoice-inventory-table"
              rows={invoices}
              columns={['采购员', '供应商', '发票号', '金额', '开票日', '状态', 'OA流程号', '是否付款', '上传人', '文件预览', '操作']}
              render={(row) => [
                findBuyerForSupplier(row.supplier) || '未匹配',
                row.supplier,
                row.invoiceNo,
                `¥${Number(row.amount || 0).toLocaleString()}`,
                row.issueDate,
                row.status,
                row.oaProcessNo || '',
                row.isPaid || '未完成',
                row.uploadedBy || row.owner || '',
                <button className="ghost" onClick={() => openPreview(row)}>查看文件</button>,
                <button className="danger-button" onClick={() => deleteInvoice(row.id)}>删除</button>
              ]}
            />
          </>
        )}

        {activeTab === 'suppliers' && canAccessTab('suppliers') && (
          <>
            <h2>供应商管理维度表</h2>
            <div className="metric-grid">
              <div className="metric-card">
                <span>供应商数量</span>
                <strong>{supplierStats.total}</strong>
              </div>
              <div className="metric-card">
                <span>成功的供应商数量</span>
                <strong>{supplierStats.success}</strong>
              </div>
              <div className="metric-card">
                <span>失败的供应商数量</span>
                <strong>{supplierStats.failed}</strong>
              </div>
            </div>
            <div className="management-grid">
              <section>
                <h3>供应商账期维度表</h3>
                <label
                  className="mini-drop-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); uploadSupplierTerms(event.dataTransfer.files); }}
                >
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) => uploadSupplierTerms(event.target.files)}
                  />
                  <span>点击或拖拽上传账期维度表</span>
                </label>
                {supplierImportResult && (
                  <div className="import-summary">
                    <strong>读取结果</strong>
                    <span>成功 {supplierImportResult.importedCount} 行，失败 {supplierImportResult.failedCount} 行</span>
                    {supplierImportResult.failedCount > 0 && (
                      <span>失败行：{supplierImportResult.failed.slice(0, 3).map((item) => `${item.rowNumber}行`).join('、')}</span>
                    )}
                    <button className="ghost" onClick={() => downloadImportResult('supplier', supplierImportResult)}>下载识别结果</button>
                  </div>
                )}
                <DataTable
                  className="limited-table"
                  rows={suppliers}
                  columns={['供应商', '供应商简称', '账期']}
                  render={(row) => [row.name, row.shortName || row.name, `${row.termDays} 天`]}
                />
              </section>
              <section>
                <h3>采购负责人维度表</h3>
                <label
                  className="mini-drop-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); uploadOwners(event.dataTransfer.files); }}
                >
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(event) => uploadOwners(event.target.files)}
                  />
                  <span>点击或拖拽上传采购负责人维度表</span>
                </label>
                {ownerImportResult && (
                  <div className="import-summary">
                    <strong>读取结果</strong>
                    <span>成功 {ownerImportResult.importedCount} 行，失败 {ownerImportResult.failedCount} 行</span>
                    {ownerImportResult.failedCount > 0 && (
                      <span>失败行：{ownerImportResult.failed.slice(0, 3).map((item) => `${item.rowNumber}行`).join('、')}</span>
                    )}
                    <button className="ghost" onClick={() => downloadImportResult('owner', ownerImportResult)}>下载识别结果</button>
                  </div>
                )}
                <DataTable
                  className="limited-table"
                  rows={owners}
                  columns={['采购人', '邮箱', '供应商']}
                  render={(row) => [row.owner, row.email || '', row.supplier]}
                />
              </section>
            </div>
            <section className="applied-preview">
              <div className="section-heading-row">
                <h3>应用的表预览</h3>
                <div className="filter-row" onClick={(event) => event.stopPropagation()}>
                  <MultiFilter
                    id="dimensionShortName"
                    label="供应商简称"
                    allLabel="供应商简称"
                    options={dimensionShortNameOptions}
                    selected={dimensionShortNameFilter}
                    onChange={setDimensionShortNameFilter}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                  />
                  <MultiFilter
                    id="dimensionOwner"
                    label="采购员"
                    allLabel="采购员"
                    options={dimensionOwnerOptions}
                    selected={dimensionOwnerFilter}
                    onChange={setDimensionOwnerFilter}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                  />
                  <MultiFilter
                    id="dimensionAnnual"
                    label="是否有年框"
                    allLabel="是否有年框"
                    options={dimensionAnnualOptions}
                    selected={dimensionAnnualFilter}
                    onChange={setDimensionAnnualFilter}
                    openFilter={openFilter}
                    setOpenFilter={setOpenFilter}
                  />
                  <button className="ghost compact-button" onClick={resetDimensionFilters}>清空筛选</button>
                  <button className="ghost compact-button" onClick={downloadAppliedPreview}>下载预览</button>
                </div>
              </div>
              <DataTable
                className="applied-preview-table"
                rows={filteredAppliedDimensionRows}
                columns={['供应商', '供应商简称', '采购员', '是否有年框', '账期', '备注信息']}
                render={(row) => [
                  row.supplier,
                  row.shortName,
                  row.owner,
                  row.hasAnnualFrame,
                  row.termDays ? `${row.termDays} 天` : '',
                  row.remark
                ]}
              />
            </section>
          </>
        )}

        {activeTab === 'reminders' && canAccessTab('reminders') && (
          <>
            <div className="section-heading-row">
              <h2>操作日志</h2>
              <span className="section-count">筛选结果 {filteredLogRows.length} / {logRows.length}</span>
            </div>
            <div className="filter-row log-filter-row" onClick={(event) => event.stopPropagation()}>
              <MultiFilter
                id="logSecondPage"
                label="二级页面"
                allLabel="二级页面"
                options={logSecondPageOptions}
                selected={logSecondPageFilter}
                onChange={setLogSecondPageFilter}
                openFilter={openFilter}
                setOpenFilter={setOpenFilter}
              />
              <MultiFilter
                id="logThirdPage"
                label="三级页面"
                allLabel="三级页面"
                options={logThirdPageOptions}
                selected={logThirdPageFilter}
                onChange={setLogThirdPageFilter}
                openFilter={openFilter}
                setOpenFilter={setOpenFilter}
              />
              <div className="date-filter">
                <span>开始时间</span>
                <input
                  type="date"
                  value={logStartDate}
                  onChange={(event) => setLogStartDate(event.target.value)}
                />
              </div>
              <div className="date-filter">
                <span>结束时间</span>
                <input
                  type="date"
                  value={logEndDate}
                  onChange={(event) => setLogEndDate(event.target.value)}
                />
              </div>
              <button className="ghost compact-button" onClick={resetLogFilters}>清空筛选</button>
            </div>
            <DataTable
              rows={filteredLogRows}
              columns={['时间', '二级页面', '三级页面', '类型', '对象', '内容']}
              render={(row) => [row.createdAt, row.secondPage, row.thirdPage, row.type, row.target, row.content]}
            />
          </>
        )}

        {activeTab === 'permissionManagement' && canManagePermissions && (
          <>
            <div className="section-heading-row">
              <h2>权限管理</h2>
              <span className="section-count">管理员：孙立柱</span>
            </div>
            <form className="user-create-form" onSubmit={createManagedUser}>
              <input
                placeholder="注册人姓名"
                value={newUserName}
                onChange={(event) => setNewUserName(event.target.value)}
              />
              <input
                placeholder="初始密码"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
              />
              <button type="submit">新增用户</button>
            </form>
            <DataTable
              className="permission-table"
              rows={managedUsers}
              columns={['姓名', '状态', '角色', '权限', '密码']}
              render={(row) => [
                row.name,
                row.name === systemOwnerName ? (
                  <span className="status-badge approved">已通过</span>
                ) : (
                  <div className="status-actions">
                    <span className={`status-badge ${row.status === 'pending' ? 'pending' : 'approved'}`}>
                      {row.status === 'pending' ? '待审核' : '已通过'}
                    </span>
                    {row.status === 'pending' && (
                      <button
                        type="button"
                        className="ghost compact-button"
                        onClick={() => updateManagedUser(row, { status: 'approved' })}
                      >
                        同意注册
                      </button>
                    )}
                  </div>
                ),
                row.name === systemOwnerName ? (
                  <span>管理员</span>
                ) : (
                  <select
                    className="table-select"
                    value={row.role}
                    onChange={(event) => updateManagedUser(row, { role: event.target.value })}
                  >
                    <option value="普通用户">普通用户</option>
                    <option value="财务">财务</option>
                  </select>
                ),
                <div className="permission-tree">
                  {permissionGroups.map((group) => {
                    const groupDisabled = row.name === systemOwnerName || group.fixedOwnerOnly;
                    const childValues = group.children.map((item) => item.value);
                    const groupChecked = row.name === systemOwnerName || (
                      childValues.length
                        ? childValues.every((item) => isManagedPermissionChecked(row, item))
                        : isManagedPermissionChecked(row, group.value)
                    );
                    return (
                      <div className="permission-group-block" key={group.value}>
                        <label className="permission-group-label">
                          <input
                            type="checkbox"
                            checked={groupChecked}
                            disabled={groupDisabled}
                            onChange={() => toggleManagedGroup(row, group)}
                          />
                          <span>{group.label}</span>
                          {group.fixedOwnerOnly && row.name !== systemOwnerName && <em>仅管理员</em>}
                        </label>
                        <div className="permission-child-list">
                          {group.children.map((option) => (
                            <label key={option.value}>
                              <input
                                type="checkbox"
                                checked={isManagedPermissionChecked(row, option.value)}
                                disabled={groupDisabled}
                                onChange={() => toggleManagedPermission(row, group, option.value)}
                              />
                              {option.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>,
                row.name === systemOwnerName ? (
                  <span>固定管理员</span>
                ) : (
                  <div className="password-reset-cell">
                    <input
                      className="table-input"
                      type="password"
                      autoComplete="new-password"
                      placeholder="填写新密码"
                      value={passwordResets[row.id] || ''}
                      onChange={(event) => setPasswordResets((current) => ({
                        ...current,
                        [row.id]: event.target.value
                      }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          resetManagedPassword(row);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="ghost compact-button"
                      onClick={() => resetManagedPassword(row)}
                    >
                      重置密码
                    </button>
                  </div>
                )
              ]}
            />
          </>
        )}

        {SYSTEM_FILE_LIBRARY_PAGES.some((page) => page.tab === activeTab) && canManageSystemFiles && (
          <>
            <div className="section-heading-row">
              <h2>系统文件库</h2>
              <span className="section-count">仅管理员可见</span>
            </div>
            <section className="system-file-panel">
              <div className="info-banner">
                <strong>迁移下载说明</strong>
                <span>下载包会过滤 SMTP 授权码和用户密码；发票原件、销售库存看板静态文件按现有引用逻辑打包。</span>
              </div>
              <div className="system-file-grid">
                {systemFilePackages
                  .filter((item) => {
                    const activePage = SYSTEM_FILE_LIBRARY_PAGES.find((page) => page.tab === activeTab);
                    return !activePage || item.tabPermission === `systemFileLibrary.${activePage.key}`;
                  })
                  .map((item) => (
                    <article className="system-file-card" key={item.id}>
                      <h3>{item.label}</h3>
                      <p>{item.description}</p>
                      <div className="system-file-meta">
                        <span>文件数：{item.fileCount}</span>
                        <span>大小：{formatBytes(item.size)}</span>
                      </div>
                      <button type="button" onClick={() => downloadSystemPackage(item.id)}>下载</button>
                    </article>
                  ))}
              </div>
            </section>
          </>
        )}

        {activeTab === 'inspectionInitialData' && canAccessTab('inspectionInitialData') && (
          <>
            <div className="section-heading-row">
              <h2>验货信息初始数据</h2>
              <span className="section-count">共 {inspectionInitialData.rows?.length || 0} 行</span>
            </div>
            <section className="single-management-panel">
              <h3>验货信息初始数据</h3>
              <label
                className="mini-drop-zone"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); uploadInspectionInitialData(event.dataTransfer.files); }}
              >
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => uploadInspectionInitialData(event.target.files)}
                />
                <span>点击或拖拽上传验货信息初始数据</span>
              </label>
              {(inspectionInitialImportResult || inspectionInitialData.updatedAt) && (
                <div className="import-summary">
                  <strong>读取结果</strong>
                  <span>工作表：{inspectionInitialData.sheetName || inspectionInitialImportResult?.sheetName || '未识别'}</span>
                  <span>成功 {inspectionInitialImportResult?.importedCount ?? inspectionInitialData.rows?.length ?? 0} 行</span>
                  {inspectionInitialData.updatedAt && <span>更新时间：{inspectionInitialData.updatedAt}</span>}
                </div>
              )}
              <DataTable
                className="inspection-initial-table"
                rows={inspectionInitialData.rows || []}
                columns={inspectionInitialColumns}
                render={(row) => inspectionInitialColumns.map((column) => row[column] || '')}
              />
            </section>
          </>
        )}

        {activeTab === 'inspectionNotice' && canAccessTab('inspectionNotice') && (
          <>
            <div className="section-heading-row">
              <h2>验货通知</h2>
              <span className="section-count">共 {inspectionNoticeRows.length} 条</span>
              {inspectionNoticeSubmission.submittedAt && (
                <span className="section-count">已提交：{inspectionNoticeSubmission.submittedAt}</span>
              )}
              <button type="button" className="ghost" onClick={addInspectionNoticeRow}>新增一行</button>
              <button type="button" onClick={confirmInspectionNotice}>确认提交</button>
            </div>
            <DataTable
              className="inspection-notice-table"
              rows={inspectionNoticeRows}
              columns={[...INSPECTION_NOTICE_FIELDS.map((field) => field.label), '操作']}
              render={(row) => [
                ...INSPECTION_NOTICE_FIELDS.map((field) => {
                  if (field.readonly) {
                    return <span className="readonly-cell">{field.key === 'inspectionApplicant' ? user.name : row[field.key] || ''}</span>;
                  }
                  if (field.multiSelect) {
                    const selected = Array.isArray(row[field.key]) ? row[field.key] : [];
                    const dropdownId = `inspection-department-${row.id}`;
                    const isOpen = openFilter === dropdownId;
                    const buttonText = selected.length === 0
                      ? '选择事业部'
                      : selected.length === 1
                        ? selected[0]
                        : `已选${selected.length}项`;
                    const toggleDepartment = (option) => {
                      const nextSelected = selected.includes(option)
                        ? selected.filter((item) => item !== option)
                        : [...selected, option];
                      updateInspectionNoticeRow(row.id, field.key, nextSelected);
                    };
                    return (
                      <div className="inspection-department-select multi-filter">
                        <button
                          type="button"
                          className="inspection-department-button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenFilter(isOpen ? '' : dropdownId);
                          }}
                        >
                          {buttonText}
                        </button>
                        {isOpen && (
                          <div className="inspection-department-menu" onClick={(event) => event.stopPropagation()}>
                            {INSPECTION_DEPARTMENT_OPTIONS.map((option) => (
                              <label key={option}>
                                <input
                                  type="checkbox"
                                  checked={selected.includes(option)}
                                  onChange={() => toggleDepartment(option)}
                                />
                                {option}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }
                  if (field.select) {
                    const baseOptions = field.key === 'supplierShortName'
                      ? inspectionSupplierShortNameOptions
                      : field.key === 'salesProductLine'
                        ? inspectionProductLineOptions
                        : field.key === 'series'
                          ? inspectionSeriesOptionsForProductLine(row.salesProductLine)
                          : (field.options || []).map((option) => ({ value: option, label: option }));
                    const hasCurrentValue = row[field.key] && !baseOptions.some((option) => option.value === row[field.key]);
                    const options = hasCurrentValue
                      ? [{ value: row[field.key], label: row[field.key] }, ...baseOptions]
                      : baseOptions;
                    const placeholder = field.key === 'series' && !row.salesProductLine
                      ? '先选择产品线'
                      : field.placeholder || (field.key === 'supplierShortName' ? '选择供应商' : '选择');
                    return (
                      <select
                        className="table-input inspection-notice-input"
                        value={row[field.key] || ''}
                        disabled={field.key === 'series' && !row.salesProductLine}
                        onChange={(event) => updateInspectionNoticeRow(row.id, field.key, event.target.value)}
                      >
                        <option value="">{placeholder}</option>
                        {options.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    );
                  }
                  return field.multiline ? (
                    <textarea
                      className="table-textarea inspection-notice-input"
                      value={row[field.key] || ''}
                      onChange={(event) => updateInspectionNoticeRow(row.id, field.key, event.target.value)}
                    />
                  ) : (
                    <input
                      type={field.inputType || 'text'}
                      className="table-input inspection-notice-input"
                      value={row[field.key] || ''}
                      onChange={(event) => updateInspectionNoticeRow(row.id, field.key, event.target.value)}
                    />
                  );
                }),
                <button type="button" className="danger-button" onClick={() => deleteInspectionNoticeRow(row.id)}>删除</button>
              ]}
            />
          </>
        )}

        {qualityInspectionPages[activeTab] && !['inspectionInitialData', 'inspectionNotice'].includes(activeTab) && canAccessTab(activeTab) && (
          <section className="placeholder-panel">
            <h2>{qualityInspectionPages[activeTab]}</h2>
            <p>当前页面已建立入口，具体业务内容待配置。</p>
          </section>
        )}

        {accessibleEmbeddedKcfxPages.length > 0 && (
          <iframe
            className="kcfx-data-preload-frame"
            title="销售及库存数据预加载"
            src={preloadKcfxSrc()}
            aria-hidden="true"
            tabIndex="-1"
          />
        )}

        {accessibleEmbeddedKcfxPages.length > 0 && (
          <section
            className={`embedded-dashboard-panel ${activeEmbeddedKcfxPage ? '' : 'is-background'}`}
            aria-hidden={!activeEmbeddedKcfxPage}
          >
            {activeEmbeddedKcfxPage && (
              <div className="embedded-dashboard-header">
                <h2>{activeEmbeddedKcfxPage.label}</h2>
                {activeEmbeddedKcfxLoading && (
                  <span className="embedded-dashboard-status">正在加载页面内容</span>
                )}
              </div>
            )}
            <div className="embedded-dashboard-frame-stack">
              {mountedEmbeddedKcfxPages.map((page) => {
                const isActiveEmbeddedFrame = activeTab === page.tab;
                const isEmbeddedFrameReady = Boolean(embeddedFrameReady[page.tab]);
                return (
                  <React.Fragment key={page.tab}>
                    <iframe
                      className={`embedded-dashboard-frame ${isActiveEmbeddedFrame ? 'is-active' : ''} ${isEmbeddedFrameReady ? 'is-ready' : ''}`}
                      title={page.label}
                      src={embeddedKcfxSrc(page)}
                      data-tab={page.tab}
                      loading="eager"
                      onLoad={(event) => applyEmbeddedDashboardChrome(event, page.tab)}
                    />
                    {isActiveEmbeddedFrame && activeEmbeddedKcfxLoading && (
                      <div className="embedded-dashboard-loading" role="status" aria-live="polite">
                        <div className="embedded-dashboard-loading-card">
                          <strong>{page.label}</strong>
                          <div className="embedded-dashboard-progress-row">
                            <span>读取进度</span>
                            <strong>{activeEmbeddedKcfxProgress}%</strong>
                          </div>
                          <div
                            className="embedded-dashboard-loading-bar"
                            role="progressbar"
                            aria-valuemin="0"
                            aria-valuemax="100"
                            aria-valuenow={activeEmbeddedKcfxProgress}
                            aria-label={`${page.label}读取进度`}
                          >
                            <span style={{ width: `${activeEmbeddedKcfxProgress}%` }} />
                          </div>
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        )}
      </section>

      {previewFile && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="preview-modal">
            <div className="preview-header">
              <h3>{previewFile.title}</h3>
              <div className="preview-actions">
                <button onClick={() => downloadInvoiceFile(previewFile.row)}>下载</button>
                <button className="ghost" onClick={() => setPreviewFile(null)}>关闭</button>
              </div>
            </div>
            <div className="preview-body">
              {previewFile.isPdf ? (
                <iframe title="发票原件预览" src={previewFile.url} />
              ) : (
                <img src={previewFile.url} alt="发票原件预览" />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function MultiFilter({ id, label, allLabel, options, selected, onChange, openFilter, setOpenFilter }) {
  const isOpen = openFilter === id;
  const selectedLabels = selected
    .map((value) => options.find((option) => option.value === value)?.label || value)
    .filter(Boolean);
  const buttonText = selectedLabels.length === 0
    ? allLabel
    : selectedLabels.length <= 2
      ? selectedLabels.join('、')
      : `已选${selectedLabels.length}项`;

  function toggle(value) {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  return (
    <div className="multi-filter">
      <button
        type="button"
        className="multi-filter-button"
        aria-label={label}
        onClick={() => setOpenFilter(isOpen ? '' : id)}
      >
        {buttonText}
      </button>
      {isOpen && (
        <div className="multi-filter-menu">
          <label>
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} />
            全部
          </label>
          {options.map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function DataTable({ rows, columns, render, className = '' }) {
  return (
    <div className={`table-wrap ${className}`}>
      <table>
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length} className="empty">暂无数据</td></tr>}
          {rows.map((row) => <tr key={row.id || `${row.name}-${row.supplier}`}>{render(row).map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
