import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';

const EMPTY_TABLES = {
  closed: emptyErrorResult(),
  detail: emptyErrorResult(),
  sales: emptySalesErrorResult()
};

const ERROR_DOWNLOAD_CONFIG = {
  productMissing: {
    sources: ['closed', 'detail', 'sales'],
    name: '商品维度缺失表',
    columns: [
      ['materialCode', '物料编码'],
      ['sku', 'SKU'],
      ['materialName', '物料名称'],
      ['qty', '数量']
    ]
  },
  divisionMissing: {
    sources: ['closed', 'detail'],
    name: '仓库与物料维度表缺失',
    columns: [
      ['materialCode', '物料编码'],
      ['sku', 'SKU'],
      ['materialName', '物料名称'],
      ['qty', '数量']
    ]
  },
  warehouseMissing: {
    sources: ['closed', 'detail'],
    name: '仓库名称缺失表',
    columns: [
      ['warehouse', '仓库'],
      ['qty', '数量']
    ]
  },
  settlementMissing: {
    sources: ['closed', 'detail'],
    name: '结算价缺失表',
    columns: [
      ['materialCode', '物料编码'],
      ['materialName', '物料名称'],
      ['productLine', '销售产品线'],
      ['qty', '数量']
    ]
  },
  customerMaterialMissing: {
    sources: ['sales'],
    name: '客户与物料对照缺失表',
    columns: [
      ['customer', '客户/店铺'],
      ['materialCode', '物料编码'],
      ['sku', 'SKU'],
      ['materialName', '物料名称'],
      ['qty', '数量']
    ]
  },
  storeMissing: {
    sources: ['sales'],
    name: '店铺名称汇总缺失表',
    columns: [
      ['store', '客户名称'],
      ['normalized', '规范化客户名称'],
      ['qty', '数量']
    ]
  }
};

export default function ErrorsPage({
  kcfxRecords = {},
  loading = false,
  error = '',
  lastLoadedAt = '',
  onRefresh
}) {
  const [downloadMessage, setDownloadMessage] = useState('');

  const checks = useMemo(() => {
    if (!kcfxRecords || Object.keys(kcfxRecords).length === 0) return EMPTY_TABLES;
    const maps = buildDimensionMaps(kcfxRecords);
    return {
      closed: buildClosedInventoryChecks(kcfxRecords, maps),
      detail: buildInventoryMonthChecks(kcfxRecords, maps),
      sales: buildSalesDataChecks(kcfxRecords, maps)
    };
  }, [kcfxRecords]);

  const statusText = useMemo(() => {
    if (loading) return '正在读取服务器文件库...';
    if (error) return `读取失败：${error}`;
    if (!kcfxRecords || Object.keys(kcfxRecords).length === 0) return '未读取到服务器文件库记录';
    const messages = [
      checks.closed.message || `关账库存事实表：有库存物料 ${formatNumber(checks.closed.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(checks.closed))} 项`,
      checks.detail.message || `库存分析月份表：有库存物料 ${formatNumber(checks.detail.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(checks.detail))} 项`,
      checks.sales.message || `销售数据文件：销售物料 ${formatNumber(checks.sales.stockMaterials.length)} 个，缺失 ${formatNumber(totalMissingCount(checks.sales))} 项`
    ];
    const loadedText = lastLoadedAt ? `；读取时间：${lastLoadedAt}` : '';
    return `检查完成：${messages.join('；')}${loadedText}`;
  }, [checks, error, kcfxRecords, lastLoadedAt, loading]);

  function downloadSingle(source, tableName) {
    const result = checks[source];
    const config = ERROR_DOWNLOAD_CONFIG[tableName];
    if (!result || !config || !config.sources.includes(source)) {
      setDownloadMessage('未找到对应的报错明细。');
      return;
    }
    downloadRowsAsWorkbook(`${errorSourceLabel(source)}-${config.name}`, downloadTimestamp(), result[tableName] || [], config.columns);
    setDownloadMessage('下载已生成。');
  }

  function downloadAll() {
    const stamp = downloadTimestamp();
    for (const source of ['closed', 'detail', 'sales']) {
      for (const [tableName, config] of Object.entries(ERROR_DOWNLOAD_CONFIG)) {
        if (!config.sources.includes(source)) continue;
        downloadRowsAsWorkbook(`${errorSourceLabel(source)}-${config.name}`, stamp, checks[source][tableName] || [], config.columns);
      }
    }
    setDownloadMessage('全部报错明细已生成。');
  }

  return (
    <section className="errors-page">
      <header className="board-heading-row errors-heading">
        <div>
          <h2>报错信息提示</h2>
          <p className="section-count">{statusText}</p>
        </div>
        <div className="errors-actions">
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? '读取中' : '应用刷新'}
          </button>
          <button type="button" className="ghost" onClick={downloadAll} disabled={loading}>
            一键下载
          </button>
        </div>
      </header>
      {downloadMessage && <div className="import-summary">{downloadMessage}</div>}

      <CheckGroup
        source="closed"
        title="根据关账库存事实表"
        description="数量取关账库存事实表有库存的物料和仓库。"
        result={checks.closed}
        onDownload={downloadSingle}
      />
      <CheckGroup
        source="detail"
        title="根据库存分析月份表"
        description="数量取库存分析月份表的合计库存数量；结算价、销售产品线、销售系列通过物料编码匹配商品分类维表；事业部按使用组织 + 结库 + 物料编码匹配仓库物料事业部对照表。"
        result={checks.detail}
        onDownload={downloadSingle}
      />
      <SalesCheckGroup result={checks.sales} onDownload={downloadSingle} />
    </section>
  );
}

function CheckGroup({ source, title, description, result, onDownload }) {
  return (
    <section className="error-source-panel">
      <section className="error-source-title">
        <h2>{title}</h2>
        <p>{result.message || description}</p>
      </section>

      <section className="metric-grid error-metrics">
        <MetricCard label="有库存物料数" value={result.stockMaterials.length} />
        <MetricCard label="商品分类缺失" value={result.productMissing.length} />
        <MetricCard label="事业部对照缺失" value={result.divisionMissing.length} />
        <MetricCard label="仓库对照缺失" value={result.warehouseMissing.length} />
        <MetricCard label="结算价缺失" value={result.settlementMissing.length} />
      </section>

      <ErrorTable
        title="有库存商品维度表没有信息"
        columns={[
          ['materialCode', '物料编码'],
          ['sku', 'SKU'],
          ['materialName', '物料名称'],
          ['qty', '数量', 'num']
        ]}
        rows={result.productMissing}
        diagnostic={[
          '来源：事实表按物料编码汇总有库存数量。',
          '比对：商品分类维表 A 列物料编码。',
          '缺失提示：事实表有库存物料编码在商品分类维表没有信息。',
          '需要维护：维度表文件库的商品分类维表。'
        ]}
        onDownload={() => onDownload(source, 'productMissing')}
      />
      <ErrorTable
        title="有库存仓库物料事业部对照表没有信息"
        columns={[
          ['materialCode', '物料编码'],
          ['sku', 'SKU'],
          ['materialName', '物料名称'],
          ['qty', '数量', 'num']
        ]}
        rows={result.divisionMissing}
        diagnostic={[
          '来源：事实表按有库存物料编码汇总数量。',
          '比对：仓库物料事业部对照表的物料编码或三元组合匹配键。',
          '缺失提示：有库存记录在仓库物料事业部对照表没有信息。',
          '需要维护：维度表文件库的仓库物料事业部对照表。'
        ]}
        onDownload={() => onDownload(source, 'divisionMissing')}
      />
      <ErrorTable
        title="有库存仓库没有信息"
        columns={[
          ['warehouse', '仓库'],
          ['qty', '数量', 'num']
        ]}
        rows={result.warehouseMissing}
        diagnostic={[
          '来源：事实表按有库存仓库汇总数量。',
          '比对：仓库维表中的仓库名称。',
          '缺失提示：事实表有库存仓库在仓库维表没有信息。',
          '需要维护：维度表文件库的仓库维表。'
        ]}
        onDownload={() => onDownload(source, 'warehouseMissing')}
      />
      <ErrorTable
        title="有库存没有结算价（含税）的物料"
        columns={[
          ['materialCode', '物料编码'],
          ['materialName', '物料名称'],
          ['productLine', '销售产品线'],
          ['qty', '数量', 'num']
        ]}
        rows={result.settlementMissing}
        diagnostic={[
          '来源：事实表取有库存物料编码和数量。',
          '比对：商品分类维表物料编码对应的结算价（含税）。',
          '缺失提示：销售成品有库存，但商品分类维表结算价（含税）为空或为 0。',
          '需要维护：维度表文件库的商品分类维表结算价（含税）。'
        ]}
        onDownload={() => onDownload(source, 'settlementMissing')}
      />
    </section>
  );
}

function SalesCheckGroup({ result, onDownload }) {
  return (
    <section className="error-source-panel">
      <section className="error-source-title">
        <h2>根据销售数据文件</h2>
        <p>{result.message || '按销售数据文件中的物料编码、客户名称，检查商品分类维表、客户与物料对照表、店铺名称汇总是否缺失映射。'}</p>
      </section>

      <section className="metric-grid error-metrics sales-error-metrics">
        <MetricCard label="销售记录数" value={result.salesRows.length} />
        <MetricCard label="销售物料数" value={result.stockMaterials.length} />
        <MetricCard label="商品分类缺失" value={result.productMissing.length} />
        <MetricCard label="客户物料缺失" value={result.customerMaterialMissing.length} />
        <MetricCard label="店铺名称缺失" value={result.storeMissing.length} />
      </section>

      <ErrorTable
        title="销售数据商品维度表没有信息"
        columns={[
          ['materialCode', '物料编码'],
          ['sku', 'SKU'],
          ['materialName', '物料名称'],
          ['qty', '数量', 'num']
        ]}
        rows={result.productMissing}
        diagnostic={[
          '来源：销售数据文件的物料编码，按销售数量汇总。',
          '比对：商品分类维表 A 列物料编码。',
          '缺失提示：销售数据文件有销售物料编码在商品分类维表没有信息。',
          '需要维护：维度表文件库的商品分类维表。'
        ]}
        onDownload={() => onDownload('sales', 'productMissing')}
      />
      <ErrorTable
        title="销售数据客户与物料对照表没有信息"
        columns={[
          ['customer', '客户/店铺'],
          ['materialCode', '物料编码'],
          ['sku', 'SKU'],
          ['materialName', '物料名称'],
          ['qty', '数量', 'num']
        ]}
        rows={result.customerMaterialMissing}
        diagnostic={[
          '来源：销售数据文件客户名称 + 物料编码组合。',
          '比对：客户与物料对照表维护的客户物料匹配关系。',
          '缺失提示：销售数据文件存在客户和物料组合，但客户与物料对照表没有信息。',
          '需要维护：维度表文件库的客户与物料对照表。'
        ]}
        onDownload={() => onDownload('sales', 'customerMaterialMissing')}
      />
      <ErrorTable
        title="销售数据店铺名称汇总没有信息"
        columns={[
          ['store', '客户名称'],
          ['qty', '数量', 'num']
        ]}
        rows={result.storeMissing}
        diagnostic={salesStoreDiagnosticLines(result.storeDiagnostic)}
        onDownload={() => onDownload('sales', 'storeMissing')}
      />
    </section>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{formatNumber(value)}</strong>
    </div>
  );
}

function ErrorTable({ title, rows, columns, diagnostic, onDownload }) {
  return (
    <section className="error-section">
      <div className="table-title-row">
        <div className="table-title">{title}</div>
        <button className="ghost compact-button" type="button" onClick={onDownload}>下载</button>
      </div>
      <div className="diagnostic-panel show">
        {diagnostic.map((line) => <span key={line}>{line}</span>)}
      </div>
      <div className="table-panel error-table-panel">
        <table>
          <thead>
            <tr>
              {columns.map(([, label]) => <th key={label}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={`${title}-${index}`}>
                {columns.map(([key, , className]) => (
                  <td key={key} className={className || ''}>{className === 'num' ? formatNumber(row[key]) : row[key]}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="empty">暂无缺失数据</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function emptyErrorResult(message = '') {
  return {
    message,
    stockMaterials: [],
    productMissing: [],
    divisionMissing: [],
    warehouseMissing: [],
    settlementMissing: []
  };
}

function emptySalesErrorResult(message = '') {
  return {
    ...emptyErrorResult(message),
    salesRows: [],
    customerMaterialMissing: [],
    storeMissing: []
  };
}

function buildDimensionMaps(records) {
  const productMap = mapProduct(records['dim-product']?.rows || []);
  const divisionRows = records['dim-warehouse-material']?.rows || [];
  const warehouseRows = records['dim-warehouse']?.rows || [];
  const customerMaterialRows = records['dim-store-name']?.rows || [];
  const storeRecord = records['dim-customer-material'];
  const storeRows = storeRecord?.rows || [];
  const storeNameMap = mapStoreNames(storeRows);
  return {
    productMap,
    divisionMaterialCodes: mapDivisionMaterialCodes(divisionRows),
    divisionDepartmentKeys: mapDivisionDepartmentKeys(divisionRows),
    divisionWarehouses: mapDivisionWarehouses(divisionRows),
    warehouseNames: mapWarehouseNames(warehouseRows),
    customerMaterialKeys: mapCustomerMaterialKeys(customerMaterialRows),
    storeNames: new Set(storeNameMap.keys()),
    storeNameSamples: [...storeNameMap.values()].slice(0, 8),
    storeSummaryValid: isStoreSummaryRecordValid(storeRecord),
    storeSummaryRecord: storeRecord
  };
}

function isStoreSummaryRecordValid(record) {
  if (!record) return false;
  const sheetName = normalizeHeaderName(record.sheetName || record.parseDiagnostics?.sheetName || '');
  const headerB = normalizeHeaderName(record.headers?.[1] || record.parseDiagnostics?.headerFirst12?.[1] || '');
  return sheetName.includes(normalizeHeaderName('店铺名称汇总'))
    && headerB === normalizeHeaderName('金蝶名称');
}

function buildClosedInventoryChecks(records, maps) {
  const fact = records['fact-inventory'];
  if (!fact) return emptyErrorResult('关账库存事实表：未引用');
  if (!records['dim-product']) return emptyErrorResult('关账库存事实表：缺少商品分类维表');
  if (!records['dim-warehouse-material']) return emptyErrorResult('关账库存事实表：缺少仓库物料事业部对照表');

  const stockMaterials = summarizeClosedStockMaterials(fact.rows || []);
  const stockWarehouses = summarizeClosedStockWarehouses(fact.rows || []);
  const productMissing = stockMaterials.filter((item) => !maps.productMap.has(item.materialCode));
  const divisionMissing = stockMaterials.filter((item) => !maps.divisionMaterialCodes.has(item.materialCode));
  const warehouseSet = maps.warehouseNames.size ? maps.warehouseNames : maps.divisionWarehouses;
  const warehouseMissing = stockWarehouses.filter((item) => !warehouseSet.has(item.warehouse));
  const settlementMissing = stockMaterials.filter((item) => {
    const product = maps.productMap.get(item.materialCode);
    return product && isSalesFinishedProduct(product) && product.settlementPrice <= 0;
  });

  return {
    stockMaterials,
    productMissing: productMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    divisionMissing: divisionMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    warehouseMissing,
    settlementMissing: settlementMissing.map((item) => enrichMissingRow(item, maps.productMap))
  };
}

function buildInventoryMonthChecks(records, maps) {
  const detail = records['fact-2'];
  if (!detail) return emptyErrorResult('库存分析月份表：未引用');
  if (!records['dim-product']) return emptyErrorResult('库存分析月份表：缺少商品分类维表');
  if (!records['dim-warehouse-material']) return emptyErrorResult('库存分析月份表：缺少仓库物料事业部对照表');

  const rows = detail.rows || [];
  const stockMaterials = summarizeDetailStockMaterials(rows);
  const stockWarehouses = summarizeDetailStockWarehouses(rows);
  const productMissing = stockMaterials.filter((item) => !maps.productMap.has(item.materialCode));
  const divisionMissing = summarizeDetailDivisionMissing(rows, maps.divisionDepartmentKeys, maps.productMap);
  const warehouseMissing = maps.warehouseNames.size
    ? stockWarehouses.filter((item) => !maps.warehouseNames.has(item.warehouse))
    : [];
  const settlementMissing = stockMaterials.filter((item) => {
    const product = maps.productMap.get(item.materialCode);
    return product && isSalesFinishedProduct(product) && product.settlementPrice <= 0;
  });

  return {
    stockMaterials,
    productMissing: productMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    divisionMissing,
    warehouseMissing,
    settlementMissing: settlementMissing.map((item) => enrichMissingRow(item, maps.productMap))
  };
}

function buildSalesDataChecks(records, maps) {
  const sales = records['sales-data'];
  if (!sales) return emptySalesErrorResult('销售数据文件：未引用');

  const rows = (sales.rows || []).filter((row) => getSalesMaterialCode(row) || getSalesStoreName(row) || getSalesStoreNameForStoreSummary(row) || getSalesCustomerName(row));
  const salesStoreValues = collectSalesStoreValues(rows);
  const stockMaterials = summarizeSalesMaterials(rows);
  const productMissing = stockMaterials.filter((item) => !maps.productMap.has(item.materialCode));
  const customerMaterialMissing = summarizeSalesCustomerMaterialMissing(rows, maps.customerMaterialKeys, maps.productMap);
  const storeMissing = maps.storeSummaryValid ? summarizeSalesStoreMissing(rows, maps.storeNames) : [];

  return {
    ...emptySalesErrorResult(),
    salesRows: rows,
    stockMaterials,
    productMissing: productMissing.map((item) => enrichMissingRow(item, maps.productMap)),
    customerMaterialMissing,
    storeMissing,
    storeDiagnostic: buildSalesStoreDiagnostic(salesStoreValues, maps.storeNames, maps.storeNameSamples, maps.storeSummaryValid, maps.storeSummaryRecord)
  };
}

function collectSalesStoreValues(rows) {
  const map = new Map();
  for (const row of rows) {
    const store = getSalesStoreNameForStoreSummary(row);
    const normalized = normalizeStoreName(store);
    if (!store || !normalized) continue;
    if (!map.has(normalized)) map.set(normalized, { raw: store, normalized, qty: 0 });
    map.get(normalized).qty += getSalesReceivableQty(row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.raw.localeCompare(b.raw, 'zh-CN'));
}

function buildSalesStoreDiagnostic(salesStoreValues, storeNames, storeNameSamples = [], storeSummaryValid = true, storeSummaryRecord = null) {
  const hitCount = salesStoreValues.filter((item) => storeNames.has(item.normalized)).length;
  const missingCount = salesStoreValues.length - hitCount;
  return {
    salesCount: salesStoreValues.length,
    dimCount: storeNames.size,
    hitCount,
    missingCount,
    salesSamples: salesStoreValues.slice(0, 8).map((item) => item.raw),
    dimSamples: storeNameSamples,
    storeSummaryValid,
    storeSheetName: storeRecordSheetName(storeSummaryRecord),
    storeHeaderB: storeSummaryRecord?.headers?.[1] || storeSummaryRecord?.parseDiagnostics?.headerFirst12?.[1] || ''
  };
}

function storeRecordSheetName(record) {
  return record?.sheetName || record?.parseDiagnostics?.sheetName || '';
}

function salesStoreDiagnosticLines(diagnostic = {}) {
  const lines = [
    '客户名称来源：销售数据文件 B 列（客户名称）',
    '数量来源：销售数据文件 I 列（应收数量）',
    '比对维表：月度维度表文件库 - 店铺名称汇总（金蝶&领星&简称）',
    '比对列：店铺名称汇总表 B 列（金蝶名称）',
    '缺失提示：销售数据文件 B 列客户名称有、维表 B 列金蝶名称没有的信息会列在下方',
    `销售客户数：${formatNumber(diagnostic.salesCount || 0)}；维表名称数：${formatNumber(diagnostic.dimCount || 0)}；命中：${formatNumber(diagnostic.hitCount || 0)}；缺失：${formatNumber(diagnostic.missingCount || 0)}`
  ];
  if (diagnostic.storeSummaryValid === false) {
    lines.push(`当前店铺名称汇总文件引用的 sheet 是「${diagnostic.storeSheetName || '-'}」，B列表头是「${diagnostic.storeHeaderB || '-'}」。请在维度表文件库重新上传或重新应用店铺名称汇总文件后再检查。`);
  }
  return lines;
}

function summarizeClosedStockMaterials(rows) {
  return summarizeByMaterial(rows, getClosedMaterialCode, getClosedMaterialName, getClosedStockQty);
}

function summarizeDetailStockMaterials(rows) {
  return summarizeByMaterial(rows, getDetailMaterialCode, getDetailMaterialName, getDetailStockQty);
}

function summarizeSalesMaterials(rows) {
  return summarizeByMaterial(rows, getSalesMaterialCode, getSalesMaterialName, getSalesQty);
}

function summarizeByMaterial(rows, materialGetter, nameGetter, qtyGetter) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = materialGetter(row);
    if (!materialCode) continue;
    const qty = qtyGetter(row);
    if (qty <= 0) continue;
    if (!map.has(materialCode)) {
      map.set(materialCode, {
        materialCode,
        sku: normalizeText(firstValue(row, ['SKU'])),
        materialName: nameGetter(row),
        qty: 0
      });
    }
    const item = map.get(materialCode);
    item.qty += qty;
    if (!item.sku) item.sku = normalizeText(firstValue(row, ['SKU']));
    if (!item.materialName) item.materialName = nameGetter(row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.materialCode.localeCompare(b.materialCode, 'zh-CN'));
}

function summarizeClosedStockWarehouses(rows) {
  return summarizeByWarehouse(rows, getClosedWarehouse, getClosedStockQty);
}

function summarizeDetailStockWarehouses(rows) {
  return summarizeByWarehouse(rows, getDetailWarehouse, getDetailStockQty);
}

function summarizeByWarehouse(rows, warehouseGetter, qtyGetter) {
  const map = new Map();
  for (const row of rows) {
    const warehouse = warehouseGetter(row);
    if (!warehouse) continue;
    const qty = qtyGetter(row);
    if (qty <= 0) continue;
    map.set(warehouse, (map.get(warehouse) || 0) + qty);
  }
  return [...map.entries()]
    .map(([warehouse, qty]) => ({ warehouse, qty }))
    .sort((a, b) => b.qty - a.qty || a.warehouse.localeCompare(b.warehouse, 'zh-CN'));
}

function summarizeDetailDivisionMissing(rows, departmentKeys, productMap) {
  const map = new Map();
  for (const row of rows) {
    const qty = getDetailStockQty(row);
    if (qty <= 0) continue;
    const materialCode = getDetailMaterialCode(row);
    if (!materialCode) continue;
    const departmentKey = makeDetailDepartmentKey(row);
    if (departmentKeys.has(departmentKey)) continue;
    if (!map.has(materialCode)) {
      map.set(materialCode, {
        materialCode,
        sku: normalizeText(firstValue(row, ['SKU'])),
        materialName: getDetailMaterialName(row),
        qty: 0
      });
    }
    const item = map.get(materialCode);
    item.qty += qty;
    if (!item.materialName) item.materialName = getDetailMaterialName(row);
  }
  return [...map.values()]
    .map((item) => enrichMissingRow(item, productMap))
    .sort((a, b) => b.qty - a.qty || a.materialCode.localeCompare(b.materialCode, 'zh-CN'));
}

function summarizeSalesCustomerMaterialMissing(rows, customerMaterialKeys, productMap) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = getSalesMaterialCode(row);
    const customer = getSalesCustomerName(row) || getSalesStoreName(row);
    if (!materialCode || !customer) continue;
    const key = makeCustomerMaterialKey(customer, materialCode);
    if (customerMaterialKeys.has(key)) continue;
    const mapKey = `${normalizeStoreName(customer)}|${materialCode}`;
    if (!map.has(mapKey)) {
      map.set(mapKey, {
        customer,
        materialCode,
        sku: normalizeText(firstValue(row, ['SKU'])),
        materialName: getSalesMaterialName(row),
        qty: 0
      });
    }
    const item = map.get(mapKey);
    item.qty += getSalesQty(row);
    if (!item.materialName) item.materialName = getSalesMaterialName(row);
  }
  return [...map.values()]
    .map((item) => enrichSalesCustomerRow(item, productMap))
    .sort((a, b) => b.qty - a.qty || a.customer.localeCompare(b.customer, 'zh-CN') || a.materialCode.localeCompare(b.materialCode, 'zh-CN'));
}

function summarizeSalesStoreMissing(rows, storeNames) {
  const map = new Map();
  for (const row of rows) {
    const store = getSalesStoreNameForStoreSummary(row);
    if (!store) continue;
    const normalized = normalizeStoreName(store);
    if (storeNames.has(normalized)) continue;
    if (!map.has(normalized)) map.set(normalized, { store, normalized, qty: 0 });
    map.get(normalized).qty += getSalesReceivableQty(row);
  }
  return [...map.values()].sort((a, b) => b.qty - a.qty || a.store.localeCompare(b.store, 'zh-CN'));
}

function mapProduct(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ['物料编码']),
      nthValue(row, 1)
    ]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      sku: normalizeText(firstText([firstValue(row, ['SKU']), nthValue(row, 3)])),
      materialName: normalizeText(firstText([firstValue(row, ['金蝶名称', '物料名称', '货品名称']), nthValue(row, 4)])),
      productLine: normalizeText(firstText([firstValue(row, ['销售产品线', '产品线']), nthValue(row, 7)])),
      materialGroup: normalizeText(firstValue(row, ['物料分组'])),
      category1: normalizeText(firstValue(row, ['一级品类'])),
      productStatus: normalizeText(firstValue(row, ['产品状态（Dim）', '产品状态'])),
      settlementPrice: firstNumber([
        firstValue(row, ['结算价（含税）', '结算价(含税)', '结算价含税', '结算价', '内部结算价', '26年内部结算价', '2026年内部结算价']),
        firstValueByHeaderIncludes(row, ['结算价']),
        nthValue(row, 9)
      ])
    });
  }
  return map;
}

function isSalesFinishedProduct(product) {
  const productLine = normalizeText(product.productLine);
  if (!productLine) return false;
  if (['其他/配件', '配件', '售后配件', '健康办公'].includes(productLine)) return false;
  if (productLine.includes('配件') && !productLine.includes('成品')) return false;
  return true;
}

function mapDivisionMaterialCodes(rows) {
  const set = new Set();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ['物料编码']),
      nthValue(row, 3)
    ]));
    if (materialCode) set.add(materialCode);
  }
  return set;
}

function mapDivisionDepartmentKeys(rows) {
  const set = new Set();
  for (const row of rows) {
    const key = normalizeDepartmentKey(firstText([
      firstValue(row, ['F列', '匹配键', '三元组合', '三元联合键']),
      nthValue(row, 6),
      [
        firstValue(row, ['使用组织', '库存组织', '组织']),
        firstValue(row, ['仓库名称', '仓库', '金蝶仓库', '库存仓库']),
        firstValue(row, ['物料编码'])
      ].join('')
    ]));
    if (key) set.add(key);
  }
  return set;
}

function mapDivisionWarehouses(rows) {
  const set = new Set();
  for (const row of rows) {
    const warehouse = normalizeText(firstText([
      firstValue(row, ['仓库', '仓库名称', '金蝶名称']),
      nthValue(row, 2)
    ]));
    if (warehouse) set.add(warehouse);
  }
  return set;
}

function mapWarehouseNames(rows) {
  const set = new Set();
  for (const row of rows) {
    const warehouse = normalizeText(firstText([
      firstValue(row, ['仓库金蝶名称', '仓库名称', '金蝶名称', '仓库']),
      nthValue(row, 2)
    ]));
    if (warehouse) set.add(warehouse);
  }
  return set;
}

function mapCustomerMaterialKeys(rows) {
  const set = new Set();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([
      firstValue(row, ['物料编码', '货品编码', '商品编码', 'SKU']),
      nthValue(row, 2),
      nthValue(row, 3)
    ]));
    const customer = normalizeText(firstText([
      firstValue(row, ['客户', '客户名称', '渠道', '店铺', '店铺名称', '店铺简称', '简称', '金蝶客户', '领星客户']),
      nthValue(row, 1)
    ]));
    const explicitKey = normalizeCustomerMaterialKey(firstText([
      firstValue(row, ['匹配键', '客户物料键', '客户物料匹配键', '客户+物料', '店铺物料键'])
    ]));
    if (explicitKey) set.add(explicitKey);
    if (materialCode && customer) set.add(makeCustomerMaterialKey(customer, materialCode));
  }
  return set;
}

function mapStoreNames(rows) {
  const map = new Map();
  for (const row of rows) {
    const candidates = [
      nthValue(row, 2),
      firstValue(row, ['金蝶', '金蝶名称', '店铺名称', '店铺', '客户名称', '客户', '公司名称', '全称'])
    ];
    for (const candidate of candidates) {
      const raw = normalizeText(candidate);
      const value = normalizeStoreName(raw);
      if (value && !map.has(value)) map.set(value, raw);
    }
  }
  return map;
}

function enrichMissingRow(item, productMap) {
  const product = productMap.get(item.materialCode) || {};
  return {
    materialCode: item.materialCode,
    sku: item.sku || product.sku || '',
    materialName: item.materialName || product.materialName || '',
    productLine: product.productLine || '',
    qty: item.qty
  };
}

function enrichSalesCustomerRow(item, productMap) {
  const product = productMap.get(item.materialCode) || {};
  return {
    customer: item.customer,
    materialCode: item.materialCode,
    sku: item.sku || product.sku || '',
    materialName: item.materialName || product.materialName || '',
    qty: item.qty
  };
}

function getClosedMaterialCode(row) {
  return normalizeMaterialCode(firstValue(row, ['物料编码']));
}

function getClosedMaterialName(row) {
  return normalizeText(firstValue(row, ['物料名称', '金蝶名称', '货品名称']));
}

function getClosedWarehouse(row) {
  return normalizeText(firstValue(row, ['仓库', '仓库名称', '金蝶名称']));
}

function getClosedStockQty(row) {
  return firstNumber([
    firstValue(row, ['数量', '库存数量', '结存数量', '(结存)数量（库存）', 'K-现货+在途库存']),
    nthValue(row, 7)
  ]);
}

function getDetailMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ['物料编码', '货品编码', '商品编码', 'SKU']),
    nthValue(row, 1)
  ]));
}

function getDetailWarehouse(row) {
  return normalizeText(firstText([
    firstValue(row, ['仓库', '仓库名称', '金蝶仓库', '库存仓库']),
    nthValue(row, 3)
  ]));
}

function getDetailOrganization(row) {
  return normalizeText(firstText([
    firstValue(row, ['使用组织', '库存组织', '组织']),
    nthValue(row, 4)
  ]));
}

function getDetailMaterialName(row) {
  return normalizeText(firstValue(row, ['物料名称', '货品名称', '商品名称', '金蝶名称']));
}

function getDetailStockQty(row) {
  return firstNumber([
    firstValue(row, ['合计库存数量', '合计数量', '合计', '关账结存库存']),
    firstValueByHeaderIncludes(row, ['合计', '库存', '数量']),
    firstValueByHeaderIncludes(row, ['合计', '数量']),
    firstValue(row, ['0430结存库存数量', '4月30日结余库存数量', '结余库存数量'])
  ]);
}

function getSalesMaterialCode(row) {
  return normalizeMaterialCode(firstText([
    firstValue(row, ['物料编码', '货品编码', '商品编码', '产品编码', 'SKU', 'MSKU', 'SellerSKU', '平台SKU']),
    firstValueByHeaderIncludes(row, ['物料', '编码']),
    firstValueByHeaderIncludes(row, ['商品', '编码']),
    nthValue(row, 1)
  ]));
}

function getSalesMaterialName(row) {
  return normalizeText(firstText([
    firstValue(row, ['物料名称', '货品名称', '商品名称', '产品名称', '金蝶名称', '品名']),
    firstValueByHeaderIncludes(row, ['物料', '名称']),
    firstValueByHeaderIncludes(row, ['商品', '名称'])
  ]));
}

function getSalesCustomerName(row) {
  return normalizeText(firstText([
    firstValue(row, ['客户', '客户名称', '渠道', '渠道名称', '销售渠道', '买家', '买家名称']),
    firstValueByHeaderIncludes(row, ['客户']),
    firstValueByHeaderIncludes(row, ['渠道'])
  ]));
}

function getSalesStoreName(row) {
  return normalizeText(firstText([
    firstValue(row, ['店铺', '店铺名称', '店铺简称', '平台店铺', '领星店铺', '金蝶店铺', '店铺名', '简称']),
    firstValueByHeaderIncludes(row, ['店铺']),
    firstValueByHeaderIncludes(row, ['简称'])
  ]));
}

function getSalesStoreNameForStoreSummary(row) {
  return normalizeText(nthValue(row, 2));
}

function getSalesReceivableQty(row) {
  return toNumber(nthValue(row, 9));
}

function getSalesQty(row) {
  const value = firstNumber([
    firstValue(row, ['销售数量', '销量', '数量', '订单数量', '发货数量', '出库数量', '已售数量', '件数']),
    firstValueByHeaderIncludes(row, ['销售', '数量']),
    firstValueByHeaderIncludes(row, ['订单', '数量']),
    firstValueByHeaderIncludes(row, ['发货', '数量']),
    firstValueByHeaderIncludes(row, ['出库', '数量']),
    firstValueByHeaderIncludes(row, ['销量'])
  ]);
  return value > 0 ? value : 1;
}

function makeDetailDepartmentKey(row) {
  return normalizeDepartmentKey([
    getDetailOrganization(row),
    getDetailWarehouse(row),
    getDetailMaterialCode(row)
  ].join(''));
}

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, '').toLowerCase();
}

function makeCustomerMaterialKey(customer, materialCode) {
  return normalizeCustomerMaterialKey(`${customer}${materialCode}`);
}

function normalizeCustomerMaterialKey(value) {
  return normalizeKey(value).replace(/&/g, '').toLowerCase();
}

function normalizeStoreName(value) {
  return normalizeKey(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[&＆]/g, '')
    .replace(/[()（）【】[\]{}<>《》]/g, '')
    .replace(/[，,、；;：:\-_\s]/g, '')
    .toLowerCase();
}

function firstText(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    if (text) return text;
  }
  return '';
}

function firstNumber(candidates) {
  for (const candidate of candidates) {
    const text = normalizeText(candidate);
    const value = toNumber(candidate);
    if (value !== 0 || text === '0') return value;
  }
  return 0;
}

function totalMissingCount(result) {
  return result.productMissing.length
    + result.divisionMissing.length
    + result.warehouseMissing.length
    + result.settlementMissing.length
    + (result.customerMaterialMissing?.length || 0)
    + (result.storeMissing?.length || 0);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function downloadTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function downloadRowsAsWorkbook(prefix, stamp, rows, columns) {
  const data = rows.map((row) => {
    const item = {};
    for (const [key, label] of columns) {
      item[label] = row[key] ?? '';
    }
    return item;
  });
  const worksheet = XLSX.utils.json_to_sheet(data.length ? data : [Object.fromEntries(columns.map(([, label]) => [label, '']))]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '报错明细');
  XLSX.writeFile(workbook, `${prefix}_${stamp}.xlsx`);
}

function errorSourceLabel(source) {
  return {
    closed: '关账库存事实表',
    detail: '库存分析月份表',
    sales: '销售数据文件'
  }[source] || '报错信息';
}

function normalizeText(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function normalizeHeaderName(value) {
  return normalizeText(value)
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeMaterialCode(value) {
  return normalizeText(value).replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const cleaned = normalizeText(value).replace(/[,\s￥元]/g, '');
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstValue(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && normalizeText(row[name]) !== '') {
      return row[name];
    }
  }
  const wanted = names.map(normalizeHeaderName);
  for (const [key, value] of Object.entries(row || {})) {
    if (wanted.includes(normalizeHeaderName(key)) && normalizeText(value) !== '') {
      return value;
    }
  }
  return '';
}

function firstValueByHeaderIncludes(row, includeWords, excludeWords = []) {
  const includes = includeWords.map(normalizeHeaderName).filter(Boolean);
  const excludes = excludeWords.map(normalizeHeaderName).filter(Boolean);
  for (const [key, value] of Object.entries(row || {})) {
    const header = normalizeHeaderName(key);
    const hasAllWords = includes.every((word) => header.includes(word));
    const hasExcludedWord = excludes.some((word) => header.includes(word));
    if (hasAllWords && !hasExcludedWord && normalizeText(value) !== '') {
      return value;
    }
  }
  return '';
}

function nthValue(row, oneBasedIndex) {
  const index = oneBasedIndex - 1;
  if (Array.isArray(row?.__cells)) {
    return row.__cells[index] ?? '';
  }
  return Object.entries(row || {})
    .filter(([key]) => key !== '__cells')
    .map(([, value]) => value)[index] ?? '';
}
