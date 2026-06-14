import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as XLSX from 'xlsx';
import './styles.css';

const API = import.meta.env.DEV ? 'http://localhost:4001' : '';

function App() {
  const [activeTab, setActiveTab] = useState('ledger');
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('invoiceUser') || 'null'));
  const [loginName, setLoginName] = useState('孙立柱');
  const [password, setPassword] = useState('521sunlizhu');
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
  const [openFilter, setOpenFilter] = useState('');
  const [activeMenuGroup, setActiveMenuGroup] = useState('supplierPayment');
  const [supplierImportResult, setSupplierImportResult] = useState(null);
  const [ownerImportResult, setOwnerImportResult] = useState(null);
  const [dimensionShortNameFilter, setDimensionShortNameFilter] = useState([]);
  const [dimensionOwnerFilter, setDimensionOwnerFilter] = useState([]);
  const [dimensionAnnualFilter, setDimensionAnnualFilter] = useState([]);
  const [managedUsers, setManagedUsers] = useState([]);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('123456');
  const systemOwnerName = '孙立柱';
  const permissionGroups = [
    {
      value: 'supplierPayment',
      label: '供应商付款提醒',
      children: [
        { value: 'supplierPayment.ledger', tab: 'ledger', label: '供应商付款看板' },
        { value: 'supplierPayment.upload', tab: 'upload', label: '发票上传' },
        { value: 'supplierPayment.invoiceInventory', tab: 'invoiceInventory', label: '发票信息库存查看' },
        { value: 'supplierPayment.supplierManagement', tab: 'suppliers', label: '供应商管理维度表' },
        { value: 'supplierPayment.reminders', tab: 'reminders', label: '操作日志' }
      ]
    },
    {
      value: 'qualityInspection',
      label: '品质验货',
      children: [
        { value: 'qualityInspection.inspectionNotice', tab: 'inspectionNotice', label: '验货通知' },
        { value: 'qualityInspection.inspectionSchedule', tab: 'inspectionSchedule', label: '验货安排' },
        { value: 'qualityInspection.inspectionFeedback', tab: 'inspectionFeedback', label: '验货反馈' },
        { value: 'qualityInspection.inspectionReportQuery', tab: 'inspectionReportQuery', label: '检验报告单查询' }
      ]
    },
    {
      value: 'systemManagement',
      label: '系统管理',
      fixedOwnerOnly: true,
      children: [
        { value: 'systemManagement.permissionManagement', tab: 'permissionManagement', label: '权限管理' }
      ]
    }
  ];
  const tabPermissionMap = Object.fromEntries(
    permissionGroups.flatMap((group) => group.children.map((item) => [item.tab, item.value]))
  );
  const legacyPermissionMap = {
    'supplierPayment.ledger': ['supplierPayment'],
    'supplierPayment.upload': ['supplierPayment'],
    'supplierPayment.reminders': ['supplierPayment'],
    'supplierPayment.invoiceInventory': ['invoiceInventory'],
    'supplierPayment.supplierManagement': ['supplierManagement'],
    'qualityInspection.inspectionNotice': ['qualityInspection'],
    'qualityInspection.inspectionSchedule': ['qualityInspection'],
    'qualityInspection.inspectionFeedback': ['qualityInspection'],
    'qualityInspection.inspectionReportQuery': ['qualityInspection'],
    'systemManagement.permissionManagement': ['permissionManagement']
  };
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
  const canManageMailSettings = user?.name === systemOwnerName;
  const canManagePermissions = user?.name === systemOwnerName;
  const canAccessSupplierPayment = canAccessGroup('supplierPayment');
  const canManageInvoiceInventory = canAccessTab('invoiceInventory');
  const canManageSuppliers = canAccessTab('suppliers');
  const canAccessQualityInspection = canAccessGroup('qualityInspection');
  const qualityInspectionPages = {
    inspectionNotice: '验货通知',
    inspectionSchedule: '验货安排',
    inspectionFeedback: '验货反馈',
    inspectionReportQuery: '检验报告单查询'
  };

  function openMenuTab(tab, group) {
    setActiveMenuGroup(group);
    setActiveTab(tab);
  }

  async function loadData() {
    const params = user ? `?user=${encodeURIComponent(user.name)}&role=${encodeURIComponent(user.role)}` : '';
    const [invoiceRes, draftRes, supplierRes, ownerRes, reminderRes, settingsRes, usersRes] = await Promise.all([
      fetch(`${API}/api/invoices${params}`),
      fetch(`${API}/api/drafts${params}`),
      fetch(`${API}/api/suppliers`),
      fetch(`${API}/api/owners`),
      fetch(`${API}/api/reminders${params}`),
      fetch(`${API}/api/settings${params}`),
      canManagePermissions ? fetch(`${API}/api/users${params}`) : Promise.resolve(null)
    ]);
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
  }

  useEffect(() => {
    if (user) loadData().catch(() => setMessage('后端服务连接失败，请确认服务已启动。'));
  }, [user]);

  useEffect(() => {
    function openFirstAllowedTab() {
      const firstAllowed = permissionGroups
        .flatMap((group) => group.children.map((child) => ({ ...child, group: group.value })))
        .find((item) => canAccessTab(item.tab));
      if (firstAllowed) {
        setActiveMenuGroup(firstAllowed.group);
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
  }, [activeTab, canAccessQualityInspection, canAccessSupplierPayment, canManageInvoiceInventory, canManagePermissions, canManageSuppliers, user]);

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

  function calculatePaymentDate(supplierName, issueDate) {
    const termDays = Number(findSupplierMeta(supplierName)?.termDays);
    if (!issueDate || !Number.isFinite(termDays) || termDays <= 0) return '供应商维度表供应商信息不一致';
    const parts = issueDate.split('-').map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return '供应商维度表供应商信息不一致';
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    date.setUTCDate(date.getUTCDate() + termDays);
    return date.toISOString().slice(0, 10);
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
  const statusOptions = useMemo(() => uniqueOptions(invoices, 'status'), [invoices]);
  const ledgerInvoices = useMemo(() => {
    return invoices.map((invoice) => {
      const supplier = findSupplierMeta(invoice.supplier);
      const termDays = Number(supplier?.termDays);
      return {
        ...invoice,
        buyer: findBuyerForSupplier(invoice.supplier) || '未匹配',
        termText: Number.isFinite(termDays) && termDays > 0 ? `${termDays}天` : '未匹配账期',
        paymentDate: calculatePaymentDate(invoice.supplier, invoice.issueDate)
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
  const dimensionShortNameOptions = useMemo(() => {
    return uniqueValueOptions(suppliers.map((supplier) => supplier.shortName));
  }, [suppliers]);
  const dimensionOwnerOptions = useMemo(() => {
    return uniqueValueOptions(owners.map((item) => item.owner));
  }, [owners]);
  const dimensionAnnualOptions = useMemo(() => {
    return uniqueValueOptions(suppliers.map((supplier) => supplier.hasAnnualFrame));
  }, [suppliers]);
  const filteredAppliedDimensionRows = useMemo(() => {
    return appliedDimensionRows.filter((row) =>
      (dimensionShortNameFilter.length === 0 || dimensionShortNameFilter.includes(row.shortName)) &&
      (dimensionOwnerFilter.length === 0 || dimensionOwnerFilter.includes(row.owner)) &&
      (dimensionAnnualFilter.length === 0 || dimensionAnnualFilter.includes(row.hasAnnualFrame))
    );
  }, [appliedDimensionRows, dimensionAnnualFilter, dimensionOwnerFilter, dimensionShortNameFilter]);
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
      (!text || [item.invoiceNo, item.supplier, supplierShortName(item.supplier), item.buyer, item.status, item.issueDate, item.paymentDate]
        .join(' ')
        .toLowerCase()
        .includes(text))
    );
  }, [ledgerInvoices, ownerFilter, paymentMonthFilter, paymentWeekFilter, query, statusFilter, supplierFilter, supplierMetaByName]);
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
    const awaitingFinanceRows = filteredInvoices.filter((row) => row.status === '待财务打款');
    const completedRows = filteredInvoices.filter((row) => row.status === '完成');
    const thisWeekRows = pendingRows.filter((row) => isThisWeekPayment(row.paymentDate));
    const thisMonthRows = pendingRows.filter((row) => isThisMonthPayment(row.paymentDate));

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
  }

  function togglePaymentPeriod(period) {
    setOpenFilter('');
    if (period === 'week') {
      setPaymentWeekFilter((current) => current.length ? [] : ['thisWeek']);
      setPaymentMonthFilter([]);
      return;
    }
    setPaymentMonthFilter((current) => current.length ? [] : ['thisMonth']);
    setPaymentWeekFilter([]);
  }

  function resetDimensionFilters() {
    setDimensionShortNameFilter([]);
    setDimensionOwnerFilter([]);
    setDimensionAnnualFilter([]);
  }

  async function login(event) {
    event.preventDefault();
    const res = await fetch(`${API}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: loginName, password })
    });
    if (!res.ok) {
      setMessage('账号或密码不正确。');
      return;
    }
    const nextUser = await res.json();
    localStorage.setItem('invoiceUser', JSON.stringify(nextUser));
    setUser(nextUser);
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
        permissions: ['supplierPayment', 'supplierPayment.ledger', 'supplierPayment.upload', 'supplierPayment.reminders']
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
      return;
    }
    const updated = await res.json();
    setManagedUsers((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    setMessage('权限已保存。');
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
    const allChecked = children.every((item) => permissions.has(item));
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
      isPdf
    });
  }

  if (!user) {
    return (
      <main className="login-shell">
        <form className="login-panel" onSubmit={login}>
          <h1>供应链AI系统</h1>
          <label>
            账号
            <input value={loginName} onChange={(event) => setLoginName(event.target.value)} />
          </label>
          <label>
            密码
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button>登录</button>
          {message && <p className="message">{message}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>供应链AI系统</h1>
        <nav className="sidebar-menu" aria-label="系统菜单">
          {canAccessSupplierPayment && (
          <div className="menu-group">
            <button
              type="button"
              className={`menu-group-toggle ${activeMenuGroup === 'supplierPayment' ? 'active' : ''}`}
              onClick={() => setActiveMenuGroup('supplierPayment')}
              aria-expanded={activeMenuGroup === 'supplierPayment'}
            >
              供应商付款提醒
              <span>{activeMenuGroup === 'supplierPayment' ? '▾' : '▸'}</span>
            </button>
            {activeMenuGroup === 'supplierPayment' && (
              <div className="submenu-list">
                {canAccessTab('ledger') && (
                  <button className={activeTab === 'ledger' ? 'active' : ''} onClick={() => openMenuTab('ledger', 'supplierPayment')}>供应商付款看板</button>
                )}
                {canAccessTab('upload') && (
                  <button className={activeTab === 'upload' ? 'active' : ''} onClick={() => openMenuTab('upload', 'supplierPayment')}>发票上传</button>
                )}
                {canManageInvoiceInventory && (
                  <button className={activeTab === 'invoiceInventory' ? 'active' : ''} onClick={() => openMenuTab('invoiceInventory', 'supplierPayment')}>发票信息库存查看</button>
                )}
                {canManageSuppliers && (
                  <button className={activeTab === 'suppliers' ? 'active' : ''} onClick={() => openMenuTab('suppliers', 'supplierPayment')}>供应商管理维度表</button>
                )}
                {canAccessTab('reminders') && (
                  <button className={activeTab === 'reminders' ? 'active' : ''} onClick={() => openMenuTab('reminders', 'supplierPayment')}>操作日志</button>
                )}
              </div>
            )}
          </div>
          )}
          {canAccessQualityInspection && (
          <div className="menu-group">
            <button
              type="button"
              className={`menu-group-toggle ${activeMenuGroup === 'qualityInspection' ? 'active' : ''}`}
              onClick={() => setActiveMenuGroup('qualityInspection')}
              aria-expanded={activeMenuGroup === 'qualityInspection'}
            >
              品质验货
              <span>{activeMenuGroup === 'qualityInspection' ? '▾' : '▸'}</span>
            </button>
            {activeMenuGroup === 'qualityInspection' && (
              <div className="submenu-list">
                {canAccessTab('inspectionNotice') && (
                  <button className={activeTab === 'inspectionNotice' ? 'active' : ''} onClick={() => openMenuTab('inspectionNotice', 'qualityInspection')}>验货通知</button>
                )}
                {canAccessTab('inspectionSchedule') && (
                  <button className={activeTab === 'inspectionSchedule' ? 'active' : ''} onClick={() => openMenuTab('inspectionSchedule', 'qualityInspection')}>验货安排</button>
                )}
                {canAccessTab('inspectionFeedback') && (
                  <button className={activeTab === 'inspectionFeedback' ? 'active' : ''} onClick={() => openMenuTab('inspectionFeedback', 'qualityInspection')}>验货反馈</button>
                )}
                {canAccessTab('inspectionReportQuery') && (
                  <button className={activeTab === 'inspectionReportQuery' ? 'active' : ''} onClick={() => openMenuTab('inspectionReportQuery', 'qualityInspection')}>检验报告单查询</button>
                )}
              </div>
            )}
          </div>
          )}
          {canManagePermissions && (
          <div className="menu-group">
            <button
              type="button"
              className={`menu-group-toggle ${activeMenuGroup === 'systemManagement' ? 'active' : ''}`}
              onClick={() => setActiveMenuGroup('systemManagement')}
              aria-expanded={activeMenuGroup === 'systemManagement'}
            >
              系统管理
              <span>{activeMenuGroup === 'systemManagement' ? '▾' : '▸'}</span>
            </button>
            {activeMenuGroup === 'systemManagement' && (
              <div className="submenu-list">
                <button className={activeTab === 'permissionManagement' ? 'active' : ''} onClick={() => openMenuTab('permissionManagement', 'systemManagement')}>权限管理</button>
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
          <button onClick={() => { localStorage.removeItem('invoiceUser'); setUser(null); }}>退出</button>
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
                <span>待财务打款</span>
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
              columns={['采购员', '供应商', '发票号', '金额', '开票日', '账期', '付款时间', 'OA流程号', '是否付款', '状态']}
              render={(row) => [
                row.buyer,
                row.supplier,
                row.invoiceNo,
                `¥${Number(row.amount).toLocaleString()}`,
                row.issueDate,
                row.termText,
                row.paymentDate,
                <input
                  className="table-input"
                  defaultValue={row.oaProcessNo || ''}
                  placeholder="填写OA流程号"
                  onBlur={(event) => updateInvoice(row.id, { oaProcessNo: event.target.value })}
                />,
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
            <h2>操作日志</h2>
            <DataTable
              rows={reminders}
              columns={['时间', '类型', '对象', '内容']}
              render={(row) => [row.createdAt, row.type, row.target, row.content]}
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
              columns={['姓名', '角色', '权限', '密码']}
              render={(row) => [
                row.name,
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
                    const groupChecked = row.name === systemOwnerName || childValues.every((item) => isManagedPermissionChecked(row, item));
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
                  <input
                    className="table-input"
                    type="password"
                    placeholder="填写新密码后回车"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        updateManagedUser(row, { password: event.currentTarget.value });
                        event.currentTarget.value = '';
                      }
                    }}
                  />
                )
              ]}
            />
          </>
        )}

        {qualityInspectionPages[activeTab] && canAccessTab(activeTab) && (
          <section className="placeholder-panel">
            <h2>{qualityInspectionPages[activeTab]}</h2>
            <p>当前页面已建立入口，具体业务内容待配置。</p>
          </section>
        )}
      </section>

      {previewFile && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="preview-modal">
            <div className="preview-header">
              <h3>{previewFile.title}</h3>
              <button className="ghost" onClick={() => setPreviewFile(null)}>关闭</button>
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
