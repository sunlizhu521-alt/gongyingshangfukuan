const API = import.meta.env.DEV ? 'http://localhost:4001' : '';
const AUTH_USER_STORAGE_KEY = 'invoiceUser';
const AUTH_DEVICE_STORAGE_KEY = 'invoiceDeviceId';

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
const KCFX_ERROR_RECORD_IDS = ['fact-inventory', 'fact-2', 'sales-data', 'dim-product', 'dim-warehouse', 'dim-warehouse-material', 'dim-store-name', 'dim-customer-material'];
const KCFX_SALES_TREND_RECORD_IDS = ['sales-data', 'dim-product', 'dim-store-name', 'dim-customer-material'];
const PURCHASE_DIVISION_SUPPLIER_COLUMN = 9;
const PURCHASE_DIVISION_ADDRESS_COLUMN = 12;
const PRODUCT_LINE_COLUMN = 7;
const PRODUCT_SERIES_COLUMN = 8;
const KCFX_INDEXED_DB_NAME = 'kcfx-inventory-analysis-file-library';
const KCFX_INDEXED_DB_STORE = 'files';

const SALES_INVENTORY_PAGES = [
  { tab: 'salesInventoryReceiptSummary', key: 'receiptSummary', label: '关账库存分析', sourceFile: 'receipt-summary.html' },
  { tab: 'salesInventoryInventoryTrend', key: 'inventoryTrend', label: '库存趋势分析', sourceFile: 'inventory-trend.html' },
  { tab: 'salesInventorySalesAnalysis', key: 'salesAnalysis', label: '月度销售数据', sourceFile: 'sales-analysis.html' },
  { tab: 'salesInventorySalesTrend', key: 'salesTrend', label: '销售趋势变化', sourceFile: 'sales-trend.html' },
  { tab: 'salesInventoryComparison', key: 'comparison', label: '表格对比分析', sourceFile: 'comparison.html' },
  { tab: 'salesInventoryErrors', key: 'errors', label: '报错信息提示', sourceFile: 'errors.html' }
];

const MAINTENANCE_LIBRARY_PAGES = [
  { tab: 'maintenanceFactLibrary', key: 'factLibrary', label: '库存数据文件', sourceFile: 'fact-library.html' },
  { tab: 'maintenanceSalesLibrary', key: 'salesLibrary', label: '销售数据文件', sourceFile: 'sales-library.html' },
  { tab: 'maintenanceFileLibrary', key: 'fileLibrary', label: '维度表文件库', sourceFile: 'file-library.html' }
];

const EMBEDDED_KCFX_PAGES = [
  ...SALES_INVENTORY_PAGES.filter((page) => !['salesInventoryErrors', 'salesInventorySalesTrend'].includes(page.tab)),
  ...MAINTENANCE_LIBRARY_PAGES
];
const PRIORITY_KCFX_PRELOAD_TABS = new Set(['salesInventorySalesAnalysis']);

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

const systemOwnerName = '孙立柱';
const permissionGroups = [
  {
    value: 'salesInventory',
    label: '库存和销售数据看板',
    children: SALES_INVENTORY_PAGES.map((page) => ({
      value: `salesInventory.${page.key}`,
      tab: page.tab,
      label: page.label
    }))
  },
  {
    value: 'maintenanceLibrary',
    label: '维护文件库',
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

const embeddedKcfxPageMap = Object.fromEntries(EMBEDDED_KCFX_PAGES.map((page) => [page.tab, page]));

export {
  API,
  AUTH_DEVICE_STORAGE_KEY,
  AUTH_USER_STORAGE_KEY,
  EMBEDDED_KCFX_PAGES,
  INSPECTION_DEPARTMENT_OPTIONS,
  INSPECTION_LIBRARY_RECORD_IDS,
  INSPECTION_NOTICE_FIELDS,
  KCFX_ERROR_RECORD_IDS,
  KCFX_SALES_TREND_RECORD_IDS,
  KCFX_INDEXED_DB_NAME,
  KCFX_INDEXED_DB_STORE,
  MAINTENANCE_LIBRARY_MENU_PAGES,
  MAINTENANCE_LIBRARY_PAGES,
  MAINTENANCE_LIBRARY_TABS,
  PRIORITY_KCFX_PRELOAD_TABS,
  PRODUCT_LINE_COLUMN,
  PRODUCT_SERIES_COLUMN,
  PURCHASE_DIVISION_ADDRESS_COLUMN,
  PURCHASE_DIVISION_SUPPLIER_COLUMN,
  SALES_INVENTORY_PAGES,
  SYSTEM_FILE_LIBRARY_MENU_PAGES,
  SYSTEM_FILE_LIBRARY_PAGES,
  embeddedKcfxPageMap,
  legacyPermissionMap,
  permissionGroups,
  systemOwnerName,
  tabPermissionMap
};
