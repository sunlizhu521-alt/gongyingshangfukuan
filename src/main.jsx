import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import {
  API,
  EMBEDDED_KCFX_PAGES,
  INSPECTION_LIBRARY_RECORD_IDS,
  INSPECTION_NOTICE_FIELDS,
  KCFX_DASHBOARD_PRELOAD_RECORD_IDS,
  KCFX_LIBRARY_TABS,
  KCFX_PRIORITY_PRELOAD_RECORD_IDS,
  KCFX_REACT_DATA_TABS,
  MAINTENANCE_LIBRARY_PAGES,
  MAINTENANCE_LIBRARY_TABS,
  PRIORITY_KCFX_PRELOAD_TABS,
  PRODUCT_LINE_COLUMN,
  PRODUCT_SERIES_COLUMN,
  PURCHASE_DIVISION_ADDRESS_COLUMN,
  PURCHASE_DIVISION_SUPPLIER_COLUMN,
  SALES_INVENTORY_PAGES,
  embeddedKcfxPageMap,
  legacyPermissionMap,
  permissionGroups,
  systemOwnerName,
  tabPermissionMap
} from './constants.js';
import {
  assertApiResponse,
  clearAuthenticatedUser,
  createInspectionNoticeRow,
  getClientDeviceId,
  normalizeOptionText,
  readInspectionIndexedDbRecord,
  readPhysicalColumn,
  readStoredUser,
  securityWatermarkText,
  storeAuthenticatedUser,
  uniqueOptionValues
} from './utils.js';
import DataTable from './components/DataTable.jsx';
import MultiFilter from './components/MultiFilter.jsx';
import Sidebar from './components/Sidebar.jsx';
import InspectionNoticePage from './components/InspectionNoticePage.jsx';
import PermissionManagementPage from './components/PermissionManagementPage.jsx';
import InspectionInitialDataPage from './components/InspectionInitialDataPage.jsx';
import SupplierManagementPage from './components/SupplierManagementPage.jsx';
import RemindersPage from './components/RemindersPage.jsx';
import SystemFileLibraryPage from './components/SystemFileLibraryPage.jsx';
import PreviewModal from './components/PreviewModal.jsx';
import EmbeddedDashboard from './components/EmbeddedDashboard.jsx';
import InvoiceManagementPage from './components/InvoiceManagementPage.jsx';
import AuthPage from './components/AuthPage.jsx';
import ErrorsPage from './components/ErrorsPage.jsx';
import SalesTrendPage from './components/SalesTrendPage.jsx';
import ReceiptSummaryPage from './components/ReceiptSummaryPage.jsx';
import InventoryTrendPage from './components/InventoryTrendPage.jsx';
import SalesAnalysisPage from './components/SalesAnalysisPage.jsx';
import ComparisonPage from './components/ComparisonPage.jsx';
import FactLibraryPage from './components/FactLibraryPage.jsx';
import SalesLibraryPage from './components/SalesLibraryPage.jsx';
import FileLibraryPage from './components/FileLibraryPage.jsx';
import { prefetchKcfxRecords } from './components/kcfxRecordLoader.js';
import { getCache, setCache } from './indexedDbCache.js';
import './styles.css';

function App() {
  const [activeTab, setActiveTab] = useState('salesInventoryReceiptSummary');
  const [user, setUser] = useState(() => readStoredUser());
  const [authChecked, setAuthChecked] = useState(false);
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
  const [supplierFilter, setSupplierFilter] = useState([]);
  const [ownerFilter, setOwnerFilter] = useState([]);
  const [statusFilter, setStatusFilter] = useState([]);
  const [paymentWeekFilter, setPaymentWeekFilter] = useState([]);
  const [paymentMonthFilter, setPaymentMonthFilter] = useState([]);
  const [oaSubmitWeekFilter, setOaSubmitWeekFilter] = useState([]);
  const [openFilter, setOpenFilter] = useState('');
  const [expandedMenuGroups, setExpandedMenuGroups] = useState(() => new Set(['salesInventory']));
  const [embeddedFrameReady, setEmbeddedFrameReady] = useState({});
  const [embeddedSwitchingTab, setEmbeddedSwitchingTab] = useState('');
  const [embeddedLoadProgress, setEmbeddedLoadProgress] = useState({});
  const [kcfxErrorRecords, setKcfxErrorRecords] = useState({});
  const [kcfxErrorLoading, setKcfxErrorLoading] = useState(false);
  const [kcfxErrorMessage, setKcfxErrorMessage] = useState('');
  const [kcfxErrorLoadedAt, setKcfxErrorLoadedAt] = useState('');
  const [kcfxSalesTrendRecords, setKcfxSalesTrendRecords] = useState({});
  const [kcfxSalesTrendLoading, setKcfxSalesTrendLoading] = useState(false);
  const [kcfxSalesTrendMessage, setKcfxSalesTrendMessage] = useState('');
  const [kcfxSalesTrendLoadedAt, setKcfxSalesTrendLoadedAt] = useState('');
  const [kcfxCoreRecords, setKcfxCoreRecords] = useState({});
  const [kcfxCoreLoading, setKcfxCoreLoading] = useState(false);
  const [kcfxCoreMessage, setKcfxCoreMessage] = useState('');
  const [kcfxCoreLoadedAt, setKcfxCoreLoadedAt] = useState('');
  const [kcfxLibrary, setKcfxLibrary] = useState({ records: {} });
  const [kcfxLibraryLoading, setKcfxLibraryLoading] = useState(false);
  const [kcfxLibraryMessage, setKcfxLibraryMessage] = useState('');
  const [kcfxLibraryLoadedAt, setKcfxLibraryLoadedAt] = useState('');
  const [mountedKcfxTabs, setMountedKcfxTabs] = useState(() => new Set());
  const [mountedReactKcfxTabs, setMountedReactKcfxTabs] = useState(() => new Set(['salesInventoryReceiptSummary']));
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
  const [kcfxData, setKcfxData] = useState(null);
  const [kcfxLoading, setKcfxLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function verifyStoredSession() {
      const storedUser = readStoredUser();
      if (!storedUser?.sessionToken || !storedUser?.deviceId) {
        clearAuthenticatedUser();
        if (!cancelled) {
          setUser(null);
          setAuthChecked(true);
        }
        return;
      }
      try {
        const res = await fetch(`${API}/api/session/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: storedUser.id,
            sessionToken: storedUser.sessionToken,
            deviceId: storedUser.deviceId
          })
        });
        if (!res.ok) throw new Error(`session verify HTTP ${res.status}`);
        const verifiedUser = await res.json();
        storeAuthenticatedUser(verifiedUser);
        if (!cancelled) setUser(verifiedUser);
      } catch {
        clearAuthenticatedUser();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }
    verifyStoredSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authChecked && !user) {
      setLoginName('');
      setPassword('');
    }
  }, [authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user) return;
    loadKcfxMetadata();
  }, [authChecked, user]);

  function authFetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (user?.id) headers.set('x-user-id', user.id);
    if (user?.sessionToken) headers.set('x-session-token', user.sessionToken);
    if (user?.deviceId) headers.set('x-device-id', user.deviceId);
    return fetch(url, { ...options, headers });
  }

  function hasPermission(permission) {
    if (user?.name === systemOwnerName) return true;
    const permissions = Array.isArray(user?.permissions) ? user.permissions : [];
    if (permissions.includes(permission)) return true;
    return (legacyPermissionMap[permission] || []).some((item) => permissions.includes(item));
  }
  function canAccessTab(tab) {
    if (tab === 'permissionManagement') return canManagePermissions;
    const permission = tabPermissionMap[tab];
    return permission ? hasPermission(permission) : false;
  }
  function canAccessGroup(groupValue) {
    const group = permissionGroups.find((item) => item.value === groupValue);
    if (!group) return false;
    return hasPermission(group.value) || group.children.some((item) => canAccessTab(item.tab));
  }
  const canManagePermissions = user?.name === systemOwnerName;
  const canManageSystemFiles = user?.name === systemOwnerName;
  const canManageMaintenanceLibrary = user?.name === systemOwnerName;
  const canAccessSalesInventory = canAccessGroup('salesInventory');
  const canAccessMaintenanceLibrary = canAccessGroup('maintenanceLibrary');
  const canAccessSystemFileLibrary = canAccessGroup('systemFileLibrary');

  useEffect(() => {
    if (!authChecked || !user) return;
    if (!KCFX_REACT_DATA_TABS.has(activeTab) || !canAccessTab(activeTab)) return;
    setMountedReactKcfxTabs((current) => (
      current.has(activeTab) ? current : new Set([...current, activeTab])
    ));
  }, [activeTab, authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user || !canAccessSalesInventory) return undefined;
    const tabs = SALES_INVENTORY_PAGES
      .map((page) => page.tab)
      .filter((tab) => KCFX_REACT_DATA_TABS.has(tab) && canAccessTab(tab));
    const timers = tabs.map((tab, index) => window.setTimeout(() => {
      setMountedReactKcfxTabs((current) => (
        current.has(tab) ? current : new Set([...current, tab])
      ));
    }, 120 * (index + 1)));
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [authChecked, user, canAccessSalesInventory]);

  useEffect(() => {
    if (!authChecked || !user || !kcfxData || !canAccessSalesInventory) return undefined;
    const controller = new AbortController();
    const priorityIds = KCFX_PRIORITY_PRELOAD_RECORD_IDS;
    const prioritySet = new Set(priorityIds);
    const deferredIds = KCFX_DASHBOARD_PRELOAD_RECORD_IDS.filter((id) => !prioritySet.has(id));
    async function preloadDashboardRecords() {
      try {
        await prefetchKcfxRecords(priorityIds, { batchSize: 3, delayMs: 30, signal: controller.signal });
        if (controller.signal.aborted) return;
        window.setTimeout(() => {
          prefetchKcfxRecords(deferredIds, { batchSize: 2, delayMs: 80, signal: controller.signal }).catch((error) => {
            console.warn('kcfx deferred preload failed', error);
          });
        }, 120);
      } catch (error) {
        console.warn('kcfx preload failed', error);
      }
    }
    preloadDashboardRecords();
    return () => {
      controller.abort();
    };
  }, [authChecked, user, kcfxData?.savedAt, canAccessSalesInventory]);

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
    return `/kcfx/${page.sourceFile}?embed=1&v=20260622d`;
  }

  async function loadKcfxMetadata() {
    setKcfxLoading(true);
    try {
      const response = await authFetch(`${API}/api/kcfx-library`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setKcfxData(await response.json());
    } catch (error) {
      console.error('kcfx数据加载失败', error);
    } finally {
      setKcfxLoading(false);
    }
  }

  async function loadKcfxLibrary() {
    setKcfxLibraryLoading(true);
    setKcfxLibraryMessage('');
    try {
      const response = await fetch(`${API}/api/kcfx-library`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      setKcfxLibrary(payload || { records: {} });
      setKcfxData(payload || { records: [] });
      setKcfxLibraryLoadedAt(new Date().toLocaleString('zh-CN'));
    } catch (error) {
      setKcfxLibraryMessage(error?.message || String(error));
    } finally {
      setKcfxLibraryLoading(false);
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
    const cacheKey = user ? `loadData:${user.name}:${user.role}` : 'loadData';
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        if (cached.invoices) setInvoices(cached.invoices);
        if (cached.drafts) setDrafts(cached.drafts);
        if (cached.suppliers) setSuppliers(cached.suppliers);
        if (cached.owners) setOwners(cached.owners);
        if (cached.reminders) setReminders(cached.reminders);
      }
    } catch {
      // 缓存读取失败不影响网络刷新
    }
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
      canAccessTab('inspectionNotice') ? fetch(`${API}/api/kcfx-library`, { cache: 'no-store' }) : Promise.resolve(null),
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
    const invoicesData = await invoiceRes.json();
    const draftsData = await draftRes.json();
    const suppliersData = await supplierRes.json();
    const ownersData = await ownerRes.json();
    const remindersData = await reminderRes.json();
    setInvoices(invoicesData);
    setDrafts(draftsData);
    setSuppliers(suppliersData);
    setOwners(ownersData);
    setReminders(remindersData);
    void setCache(cacheKey, {
      invoices: invoicesData,
      drafts: draftsData,
      suppliers: suppliersData,
      owners: ownersData,
      reminders: remindersData
    }, 5 * 60 * 1000);
    await settingsRes.json();
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
      const inspectionRecords = Array.isArray(inspectionLibrary.records)
        ? Object.fromEntries(inspectionLibrary.records.map((record) => [record.id, record]).filter(([id]) => id))
        : inspectionLibrary.records || {};
      setInspectionLibraryRecords(await hydrateInspectionLibraryRecords(inspectionRecords));
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
    if (authChecked && user) loadData().catch((error) => {
      setMessage(`后端服务连接失败：${error?.message || '请确认服务已启动。'}`);
    });
  }, [authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user || activeTab !== 'inspectionNotice' || !canAccessTab('inspectionNotice')) return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        let records = {};
        try {
          const response = await fetch(`${API}/api/kcfx-library`, { cache: 'no-store' });
          if (response.ok) {
            const payload = await response.json();
            const allRecords = Array.isArray(payload.records)
              ? Object.fromEntries(payload.records.map((record) => [record.id, record]).filter(([id]) => id))
              : payload.records || {};
            records = Object.fromEntries(INSPECTION_LIBRARY_RECORD_IDS.map((id) => [id, allRecords[id] || { id }]));
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
  }, [activeTab, authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user || accessibleEmbeddedKcfxPages.length === 0) return;
    fetch(`${API}/api/kcfx-library`, { cache: 'no-store' }).catch(() => {});
    fetch(`${API}/api/kcfx-library/receipt-summary`, { cache: 'no-store' }).catch(() => {});
  }, [authChecked, user, accessibleEmbeddedKcfxPages.length]);

  useEffect(() => {
    if (!authChecked || !user || !KCFX_LIBRARY_TABS.has(activeTab) || !canAccessTab(activeTab)) return undefined;
    loadKcfxLibrary();
    return undefined;
  }, [activeTab, authChecked, user]);

  useEffect(() => {
    if (!authChecked || !user || accessibleEmbeddedKcfxPages.length === 0) return undefined;
    setMountedKcfxTabs((current) => {
      const next = new Set(current);
      accessibleEmbeddedKcfxPages.forEach((page) => {
        if (PRIORITY_KCFX_PRELOAD_TABS.has(page.tab)) next.add(page.tab);
      });
      if (activeEmbeddedKcfxPage) next.add(activeEmbeddedKcfxPage.tab);
      return next;
    });
    return undefined;
  }, [authChecked, user, accessibleEmbeddedKcfxPages.length, activeEmbeddedKcfxPage?.tab]);

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
    if (authChecked && user && tabPermissionMap[activeTab] && !canAccessTab(activeTab)) {
      openFirstAllowedTab();
      return;
    }
    if (authChecked && user && !canManagePermissions && activeTab === 'permissionManagement') {
      openFirstAllowedTab();
    }
  }, [activeTab, authChecked, canAccessMaintenanceLibrary, canAccessSalesInventory, canAccessSystemFileLibrary, canManagePermissions, user]);

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
    const normalized = text.replace(/\s+/g, '');
    const directAdminMatch = normalized.match(/^(北京市|天津市|上海市|重庆市)/);
    if (directAdminMatch?.[1]) return directAdminMatch[1];

    const provinceMatch = normalized.match(/([\u4e00-\u9fa5]{2,}(?:省|自治区|特别行政区))/);
    const afterProvince = provinceMatch?.[1]
      ? normalized.slice(normalized.indexOf(provinceMatch[1]) + provinceMatch[1].length)
      : normalized;
    const cityMatch = afterProvince.match(/([\u4e00-\u9fa5]{2,}(?:市|自治州|地区|盟))/);
    const parts = [];
    if (provinceMatch?.[1]) parts.push(provinceMatch[1]);
    if (cityMatch?.[1] && cityMatch[1] !== provinceMatch?.[1]) parts.push(cityMatch[1]);
    return parts.join('') || '';
  }

  function findSupplierAddressByShortName(shortName) {
    const textShortName = normalizeOptionText(shortName);
    return inspectionSupplierAddressByShortName.get(textShortName) || '';
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
      return { secondPage: '历史业务', thirdPage: '验货通知' };
    }
    if (text.includes('发票库存删除')) {
      return { secondPage: '系统文件库', thirdPage: '发票信息库存查看' };
    }
    if (text.includes('供应商') && (text.includes('维度') || text.includes('账期') || text.includes('采购'))) {
      return { secondPage: '维护文件库', thirdPage: '供应商管理维度表' };
    }
    if (text.includes('OCR') || text.includes('已上传') || text.includes('上传')) {
      return { secondPage: '历史业务', thirdPage: '发票上传' };
    }
    if (text.includes('付款') || text.includes('OA') || text.includes('状态更新') || text.includes('定时邮件')) {
      return { secondPage: '历史业务', thirdPage: '供应商付款看板' };
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
    return uniqueValueOptions(inspectionPurchaseDivisionRows.map((row) => readPhysicalColumn(row, PURCHASE_DIVISION_SUPPLIER_COLUMN)));
  }, [inspectionPurchaseDivisionRows]);
  const inspectionSupplierShortNameSet = useMemo(() => {
    return new Set(inspectionSupplierShortNameOptions.map((option) => normalizeOptionText(option.value)));
  }, [inspectionSupplierShortNameOptions]);
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
  useEffect(() => {
    if (!user || inspectionSupplierShortNameSet.size === 0) return;
    setInspectionNoticeRows((rows) => {
      let changed = false;
      const nextRows = rows.map((row) => {
        const shortName = normalizeOptionText(row.supplierShortName);
        if (!shortName || inspectionSupplierShortNameSet.has(shortName)) return row;
        changed = true;
        return { ...row, supplierShortName: '', supplierAddress: '' };
      });
      return changed ? nextRows : rows;
    });
  }, [inspectionSupplierShortNameSet, user]);
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
      body: JSON.stringify({ name, password, deviceId: getClientDeviceId() })
    });
    if (!res.ok) {
      setMessage(res.status === 403 ? '注册申请待孙立柱审核，审核通过后再登录。' : '账号或密码不正确。');
      return;
    }
    const nextUser = await res.json();
    storeAuthenticatedUser(nextUser);
    setUser(nextUser);
    setPassword('');
    setMessage('');
  }

  async function logout() {
    const storedUser = readStoredUser();
    if (storedUser?.sessionToken) {
      fetch(`${API}/api/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: storedUser.id,
          sessionToken: storedUser.sessionToken,
          deviceId: storedUser.deviceId
        })
      }).catch(() => {});
    }
    clearAuthenticatedUser();
    setUser(null);
    setLoginName('');
    setPassword('');
    setAuthMode('login');
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
              nextRow.series = normalizeOptionText(row.series) === '其他' || allowedSeries.has(row.series) ? row.series : '';
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
    const invalidSupplierRows = rowsToSubmit.filter((row) => {
      const shortName = normalizeOptionText(row.supplierShortName);
      return shortName && !inspectionSupplierShortNameSet.has(shortName);
    });
    if (invalidSupplierRows.length) {
      setMessage('供应商简称必须从采购分工明细的候选项中选择。');
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

  async function deleteManagedUser(target) {
    if (target.name === systemOwnerName) return;
    const confirmed = window.confirm(`确定删除 ${target.name} 的账号吗？删除后该账号不能再登录。`);
    if (!confirmed) return;
    const res = await fetch(`${API}/api/users/${target.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: user.name })
    });
    if (!res.ok) {
      setMessage('账号删除失败。');
      return;
    }
    setManagedUsers((rows) => rows.filter((row) => row.id !== target.id));
    setPasswordResets((current) => {
      const next = { ...current };
      delete next[target.id];
      return next;
    });
    setMessage(`${target.name} 的账号已删除。`);
  }

  function managedPermissionSet(target) {
    return new Set(Array.isArray(target.permissions) ? target.permissions : []);
  }

  function isManagedPermissionChecked(target, permission) {
    if (target.name === systemOwnerName) return true;
    return managedPermissionSet(target).has(permission);
  }

  function assignablePermissionChildren(group) {
    if (group.fixedOwnerOnly) return [];
    return group.children.map((item) => item.value);
  }

  function toggleManagedGroup(target, group) {
    if (target.name === systemOwnerName || group.fixedOwnerOnly) return;
    const permissions = managedPermissionSet(target);
    const children = assignablePermissionChildren(group);
    const allChecked = children.length && children.every((item) => permissions.has(item));
    permissions.delete(group.value);
    if (allChecked) {
      children.forEach((item) => permissions.delete(item));
    } else {
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
    permissions.delete(group.value);
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

  if (!authChecked) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <h1>正在验证登录</h1>
          <p>请稍候...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <AuthPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        loginName={loginName}
        setLoginName={setLoginName}
        password={password}
        setPassword={setPassword}
        registerName={registerName}
        setRegisterName={setRegisterName}
        registerPassword={registerPassword}
        setRegisterPassword={setRegisterPassword}
        registerPasswordConfirm={registerPasswordConfirm}
        setRegisterPasswordConfirm={setRegisterPasswordConfirm}
        message={message}
        setMessage={setMessage}
        handleLogin={login}
        handleRegister={register}
      />
    );
  }

  return (
    <main className="app-shell">
      <div className="security-watermark" aria-hidden="true">
        {Array.from({ length: 80 }, (_, index) => (
          <span key={index}>{securityWatermarkText(user)}</span>
        ))}
      </div>
      <Sidebar
        user={user}
        activeTab={activeTab}
        canAccessGroup={canAccessGroup}
        canAccessTab={canAccessTab}
        openMenuTab={openMenuTab}
        toggleMenuGroup={toggleMenuGroup}
        isMenuGroupExpanded={isMenuGroupExpanded}
        expandedMenuGroups={expandedMenuGroups}
        appVersionTime={appVersionTime}
        logout={logout}
      />

      <section className="content">
        {message && <div className="toast">{message}</div>}
        {activeTab === 'ledger' && canAccessTab('ledger') && (
          <InvoiceManagementPage
            invoices={filteredInvoices}
            query={query}
            setQuery={setQuery}
            supplierFilter={supplierFilter}
            setSupplierFilter={setSupplierFilter}
            ownerFilter={ownerFilter}
            setOwnerFilter={setOwnerFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            paymentWeekFilter={paymentWeekFilter}
            setPaymentWeekFilter={setPaymentWeekFilter}
            paymentMonthFilter={paymentMonthFilter}
            setPaymentMonthFilter={setPaymentMonthFilter}
            oaSubmitWeekFilter={oaSubmitWeekFilter}
            setOaSubmitWeekFilter={setOaSubmitWeekFilter}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
            supplierOptions={supplierOptions}
            ownerOptions={ownerOptions}
            statusOptions={statusOptions}
            ledgerStats={ledgerStats}
            resetFilters={resetFilters}
            togglePaymentPeriod={togglePaymentPeriod}
            toggleOaSubmitWeek={toggleOaSubmitWeek}
            updateInvoice={updateInvoice}
            openPreview={openPreview}
            deleteInvoice={deleteInvoice}
            setPreviewFile={setPreviewFile}
            downloadInvoiceFile={downloadInvoiceFile}
          />
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
          <SupplierManagementPage
            suppliers={suppliers}
            owners={owners}
            supplierStats={supplierStats}
            supplierImportResult={supplierImportResult}
            ownerImportResult={ownerImportResult}
            ownerOptions={ownerOptions}
            ownerFilter={ownerFilter}
            setOwnerFilter={setOwnerFilter}
            uploadSupplierTerms={uploadSupplierTerms}
            uploadOwners={uploadOwners}
            downloadImportResult={downloadImportResult}
            dimensionShortNameOptions={dimensionShortNameOptions}
            dimensionShortNameFilter={dimensionShortNameFilter}
            setDimensionShortNameFilter={setDimensionShortNameFilter}
            dimensionOwnerOptions={dimensionOwnerOptions}
            dimensionOwnerFilter={dimensionOwnerFilter}
            setDimensionOwnerFilter={setDimensionOwnerFilter}
            dimensionAnnualOptions={dimensionAnnualOptions}
            dimensionAnnualFilter={dimensionAnnualFilter}
            setDimensionAnnualFilter={setDimensionAnnualFilter}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
            resetDimensionFilters={resetDimensionFilters}
            downloadAppliedPreview={downloadAppliedPreview}
            filteredAppliedDimensionRows={filteredAppliedDimensionRows}
            supplierFilter={supplierFilter}
            setSupplierFilter={setSupplierFilter}
            supplierOptions={supplierOptions}
            addSupplier={addSupplier}
            addOwner={addOwner}
          />
        )}

        {activeTab === 'reminders' && canAccessTab('reminders') && (
          <RemindersPage
            logRows={logRows}
            filteredLogRows={filteredLogRows}
            logSecondPageOptions={logSecondPageOptions}
            logSecondPageFilter={logSecondPageFilter}
            setLogSecondPageFilter={setLogSecondPageFilter}
            logThirdPageOptions={logThirdPageOptions}
            logThirdPageFilter={logThirdPageFilter}
            setLogThirdPageFilter={setLogThirdPageFilter}
            logStartDate={logStartDate}
            setLogStartDate={setLogStartDate}
            logEndDate={logEndDate}
            setLogEndDate={setLogEndDate}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
            resetLogFilters={resetLogFilters}
          />
        )}

        {activeTab === 'permissionManagement' && canManagePermissions && (
          <PermissionManagementPage
            managedUsers={managedUsers}
            newUserName={newUserName}
            setNewUserName={setNewUserName}
            newUserPassword={newUserPassword}
            setNewUserPassword={setNewUserPassword}
            passwordResets={passwordResets}
            setPasswordResets={setPasswordResets}
            createManagedUser={createManagedUser}
            updateManagedUser={updateManagedUser}
            deleteManagedUser={deleteManagedUser}
            resetManagedPassword={resetManagedPassword}
            isManagedPermissionChecked={isManagedPermissionChecked}
            toggleManagedGroup={toggleManagedGroup}
            toggleManagedPermission={toggleManagedPermission}
          />
        )}

        {canManageSystemFiles && (
          <SystemFileLibraryPage
            activeTab={activeTab}
            systemFilePackages={systemFilePackages}
            formatBytes={formatBytes}
            downloadSystemPackage={downloadSystemPackage}
          />
        )}

        {activeTab === 'inspectionInitialData' && canAccessTab('inspectionInitialData') && (
          <InspectionInitialDataPage
            inspectionInitialData={inspectionInitialData}
            inspectionInitialImportResult={inspectionInitialImportResult}
            inspectionInitialColumns={inspectionInitialColumns}
            uploadInspectionInitialData={uploadInspectionInitialData}
          />
        )}

        {activeTab === 'inspectionNotice' && canAccessTab('inspectionNotice') && (
          <InspectionNoticePage
            user={user}
            inspectionNoticeRows={inspectionNoticeRows}
            inspectionNoticeSubmission={inspectionNoticeSubmission}
            inspectionSupplierShortNameOptions={inspectionSupplierShortNameOptions}
            inspectionProductLineOptions={inspectionProductLineOptions}
            inspectionSeriesOptionsForProductLine={inspectionSeriesOptionsForProductLine}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
            updateInspectionNoticeRow={updateInspectionNoticeRow}
            deleteInspectionNoticeRow={deleteInspectionNoticeRow}
            addInspectionNoticeRow={addInspectionNoticeRow}
            confirmInspectionNotice={confirmInspectionNotice}
          />
        )}

        {mountedReactKcfxTabs.has('salesInventoryReceiptSummary') && canAccessTab('salesInventoryReceiptSummary') && (
          <div className={activeTab === 'salesInventoryReceiptSummary' ? '' : 'kept-page-hidden'}>
            <ReceiptSummaryPage
              kcfxData={kcfxData}
              kcfxRecords={kcfxCoreRecords}
              loading={false}
              error={kcfxCoreMessage}
              lastLoadedAt={kcfxCoreLoadedAt}
              onRefresh={loadKcfxMetadata}
            />
          </div>
        )}

        {mountedReactKcfxTabs.has('salesInventoryInventoryTrend') && canAccessTab('salesInventoryInventoryTrend') && (
          <div className={activeTab === 'salesInventoryInventoryTrend' ? '' : 'kept-page-hidden'}>
            <InventoryTrendPage
              kcfxData={kcfxData}
              kcfxRecords={kcfxCoreRecords}
              loading={false}
              error={kcfxCoreMessage}
              lastLoadedAt={kcfxCoreLoadedAt}
              onRefresh={loadKcfxMetadata}
            />
          </div>
        )}

        {mountedReactKcfxTabs.has('salesInventorySalesAnalysis') && canAccessTab('salesInventorySalesAnalysis') && (
          <div className={activeTab === 'salesInventorySalesAnalysis' ? '' : 'kept-page-hidden'}>
            <SalesAnalysisPage
              kcfxData={kcfxData}
              kcfxRecords={kcfxCoreRecords}
              loading={false}
              error={kcfxCoreMessage}
              lastLoadedAt={kcfxCoreLoadedAt}
              onRefresh={loadKcfxMetadata}
            />
          </div>
        )}

        {mountedReactKcfxTabs.has('salesInventoryComparison') && canAccessTab('salesInventoryComparison') && (
          <div className={activeTab === 'salesInventoryComparison' ? '' : 'kept-page-hidden'}>
            <ComparisonPage
              kcfxData={kcfxData}
              kcfxRecords={kcfxCoreRecords}
              loading={false}
              error={kcfxCoreMessage}
              lastLoadedAt={kcfxCoreLoadedAt}
              onRefresh={loadKcfxMetadata}
            />
          </div>
        )}

        {activeTab === 'maintenanceFactLibrary' && canAccessTab('maintenanceFactLibrary') && (
          <FactLibraryPage
            kcfxData={kcfxData}
            library={kcfxLibrary}
            user={user}
            loading={kcfxLoading}
            error={kcfxLibraryMessage}
            lastLoadedAt={kcfxLibraryLoadedAt}
            onRefresh={loadKcfxLibrary}
          />
        )}

        {activeTab === 'maintenanceSalesLibrary' && canAccessTab('maintenanceSalesLibrary') && (
          <SalesLibraryPage
            kcfxData={kcfxData}
            library={kcfxLibrary}
            user={user}
            loading={kcfxLoading}
            error={kcfxLibraryMessage}
            lastLoadedAt={kcfxLibraryLoadedAt}
            onRefresh={loadKcfxLibrary}
          />
        )}

        {activeTab === 'maintenanceFileLibrary' && canAccessTab('maintenanceFileLibrary') && (
          <FileLibraryPage
            kcfxData={kcfxData}
            library={kcfxLibrary}
            user={user}
            loading={kcfxLoading}
            error={kcfxLibraryMessage}
            lastLoadedAt={kcfxLibraryLoadedAt}
            onRefresh={loadKcfxLibrary}
          />
        )}

        {mountedReactKcfxTabs.has('salesInventoryErrors') && canAccessTab('salesInventoryErrors') && (
          <div className={activeTab === 'salesInventoryErrors' ? '' : 'kept-page-hidden'}>
            <ErrorsPage
              kcfxData={kcfxData}
              kcfxRecords={kcfxErrorRecords}
              loading={false}
              error={kcfxErrorMessage}
              lastLoadedAt={kcfxErrorLoadedAt}
              onRefresh={loadKcfxMetadata}
            />
          </div>
        )}

        {mountedReactKcfxTabs.has('salesInventorySalesTrend') && canAccessTab('salesInventorySalesTrend') && (
          <div className={activeTab === 'salesInventorySalesTrend' ? '' : 'kept-page-hidden'}>
            <SalesTrendPage
              kcfxData={kcfxData}
              kcfxRecords={kcfxSalesTrendRecords}
              loading={false}
              error={kcfxSalesTrendMessage}
              lastLoadedAt={kcfxSalesTrendLoadedAt}
              onRefresh={loadKcfxMetadata}
            />
          </div>
        )}

        <EmbeddedDashboard
          activeTab={activeTab}
          accessibleEmbeddedKcfxPages={accessibleEmbeddedKcfxPages}
          activeEmbeddedKcfxPage={activeEmbeddedKcfxPage}
          activeEmbeddedKcfxLoading={activeEmbeddedKcfxLoading}
          activeEmbeddedKcfxProgress={activeEmbeddedKcfxProgress}
          mountedEmbeddedKcfxPages={mountedEmbeddedKcfxPages}
          embeddedFrameReady={embeddedFrameReady}
          embeddedKcfxSrc={embeddedKcfxSrc}
          applyEmbeddedDashboardChrome={applyEmbeddedDashboardChrome}
        />
      </section>

      <PreviewModal
        previewFile={previewFile}
        setPreviewFile={setPreviewFile}
        downloadInvoiceFile={downloadInvoiceFile}
      />
    </main>
  );
}


createRoot(document.getElementById('root')).render(<App />);
