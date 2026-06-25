import React, { useMemo } from 'react';

const COLORS = ['#007aff', '#34c759', '#ff9f0a', '#af52de', '#ff375f', '#5ac8fa', '#5856d6', '#30d158'];
const REPORT_DEPARTMENTS = ['海外事业部一部', '海外事业二部', '国内事业部', '全球招商部'];

export default function InventoryStaticReportPage({
  kcfxRecords = {},
  loading = false,
  error = '',
  lastLoadedAt = '',
  onRefresh
}) {
  const report = useMemo(() => buildInventoryStaticReport(kcfxRecords), [kcfxRecords]);
  const departmentReports = useMemo(() => {
    const preferred = REPORT_DEPARTMENTS.map((name) => report.departmentReports.find((item) => item.department === name)).filter(Boolean);
    const rest = report.departmentReports.filter((item) => !REPORT_DEPARTMENTS.includes(item.department)).slice(0, 4);
    return [...preferred, ...rest];
  }, [report.departmentReports]);

  const statusText = buildStatusText({ loading, error, report, lastLoadedAt });

  return (
    <section className="inventory-static-report-page">
      <header className="static-report-header">
        <div>
          <h2>库存静态报告</h2>
          <p className="section-count">{statusText}</p>
        </div>
        <div className="errors-actions">
          <button type="button" onClick={onRefresh} disabled={loading}>
            {loading ? '读取中' : '应用刷新'}
          </button>
        </div>
      </header>

      <nav className="static-report-toc" aria-label="库存静态报告目录">
        <a href="#inventory-static-overview">供应链总览</a>
        {departmentReports.map((item) => (
          <a href={`#inventory-static-${slugify(item.department)}`} key={item.department}>{item.department}</a>
        ))}
      </nav>

      <ReportSection id="inventory-static-overview" title="供应链库存分析总览" subtitle="金额单位：万元；数量保留业务原值">
        <MetricGrid metrics={[
          ['库存数量', formatNumber(report.totalQty, 2)],
          ['库存资产估值', moneyWan(report.totalAmount)],
          ['物料数量', formatNumber(report.materialCount, 0)],
          ['仓库数量', formatNumber(report.warehouseCount, 0)],
          ['事业部数量', formatNumber(report.departmentReports.length, 0)]
        ]} />
        <ChartGrid>
          <BarCard title="仓库类型库存占用" rows={report.bars.warehouseType} total={report.totalAmount} />
          <BarCard title="库龄段库存占用" rows={report.bars.age} total={report.totalAmount} />
          <BarCard title="产品线库存占用" rows={report.bars.productLine} total={report.totalAmount} />
          <BarCard title="仓库位置库存占用" rows={report.bars.warehouseLocation} total={report.totalAmount} />
          <BarCard title="产品系列 Top 10" rows={report.bars.series} total={report.totalAmount} />
        </ChartGrid>
        <TrendGrid report={report} />
        <Narrative report={report} />
      </ReportSection>

      {departmentReports.map((departmentReport) => (
        <DepartmentReport key={departmentReport.department} report={departmentReport} />
      ))}

      <section className="sales-trend-source-panel">
        <div><strong>库存分析月份表</strong>：{recordSourceText(kcfxRecords['fact-2'])}</div>
        <div><strong>商品分类维表</strong>：{recordSourceText(kcfxRecords['dim-product'])}</div>
        <div><strong>仓库维表</strong>：{recordSourceText(kcfxRecords['dim-warehouse'])}</div>
        <div><strong>仓库物料事业部对照表</strong>：{recordSourceText(kcfxRecords['dim-warehouse-material'])}</div>
      </section>
    </section>
  );
}

function DepartmentReport({ report }) {
  return (
    <ReportSection
      id={`inventory-static-${slugify(report.department)}`}
      title={`${report.department}库存分析报告`}
      subtitle="关账库存 + 当前文件库动态汇总"
      pill="动态汇总"
    >
      <MetricGrid metrics={[
        ['库存金额', moneyWan(report.totalAmount)],
        ['库存数量', formatNumber(report.totalQty, 2)],
        ['库存占比', percent(report.totalAmount, report.parentTotalAmount)],
        ['最高产品线占比', `${report.bars.productLine[0]?.name || '-'} ${percent(report.bars.productLine[0]?.value || 0, report.totalAmount)}`],
        ['管理重点', '集中度 / 周转 / 在途']
      ]} />
      <ChartGrid>
        <BarCard title="仓库类型" rows={report.bars.warehouseType} total={report.totalAmount} />
        <BarCard title="库龄段" rows={report.bars.age} total={report.totalAmount} />
        <BarCard title="产品线" rows={report.bars.productLine} total={report.totalAmount} />
        <BarCard title="仓库位置" rows={report.bars.warehouseLocation} total={report.totalAmount} />
        <BarCard title="产品系列 Top 10" rows={report.bars.series} total={report.totalAmount} />
      </ChartGrid>
      <TrendGrid report={report} />
      <Narrative report={report} />
    </ReportSection>
  );
}

function ReportSection({ id, title, subtitle, pill, children }) {
  return (
    <section id={id} className="static-report-section">
      <div className="static-report-section-title">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {pill && <span className="static-report-pill">{pill}</span>}
      </div>
      {children}
    </section>
  );
}

function MetricGrid({ metrics }) {
  return (
    <div className="static-report-metrics">
      {metrics.map(([label, value]) => (
        <div className="static-report-metric" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function ChartGrid({ children }) {
  return <div className="static-report-grid five">{children}</div>;
}

function BarCard({ title, rows, total }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="static-report-card">
      <h3>{title}</h3>
      <div className="static-report-bars">
        {rows.length ? rows.map((row, index) => (
          <div className="static-report-bar-row" title={row.name} key={row.name}>
            <div className="static-report-bar-name">{row.name}</div>
            <div className="static-report-bar-track">
              <i style={{ width: `${Math.max(3, (row.value / max) * 100)}%`, background: COLORS[index % COLORS.length] }} />
            </div>
            <div className="static-report-bar-num">{moneyWan(row.value)} · {percent(row.value, total)}</div>
          </div>
        )) : <div className="empty">暂无数据</div>}
      </div>
    </div>
  );
}

function TrendGrid({ report }) {
  return (
    <div className="static-report-grid two">
      <TrendTable title="库存金额趋势" rows={report.trend.summary} />
      <TrendTable title="产品线库存占用趋势" rows={report.trend.productLine} />
    </div>
  );
}

function TrendTable({ title, rows }) {
  return (
    <div className="static-report-card">
      <h3>{title}</h3>
      <div className="static-report-table-wrap">
        <table>
          <thead>
            <tr>
              <th>分类</th>
              <th>1月</th>
              <th>2月</th>
              <th>3月</th>
              <th>4月</th>
              <th>4月较3月</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                {row.values.map((value, index) => <td key={index}>{moneyWan(value)}</td>)}
                <td>{growthText(row.values[3], row.values[2])}</td>
              </tr>
            )) : (
              <tr><td colSpan={6} className="empty">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Narrative({ report }) {
  const topWarehouse = report.bars.warehouseType[0] || { name: '未分类仓库类型', value: 0 };
  const topProduct = report.bars.productLine[0] || { name: '未分类产品线', value: 0 };
  const topSeries = report.bars.series[0] || { name: '未分类系列', value: 0 };
  const longAge = report.bars.age.find((row) => row.name === '120天以上') || { value: 0 };
  return (
    <div className="static-report-text-cols">
      <div className="static-report-card text-card">
        <h3>结论摘要</h3>
        <ul>
          <li>当前库存金额 {moneyWan(report.totalAmount)}，库存数量 {formatNumber(report.totalQty, 2)}。</li>
          <li>库存主要集中在 {topWarehouse.name}、{topProduct.name} 和 {topSeries.name}。</li>
          <li>120天以上库存金额 {moneyWan(longAge.value)}，建议按产品线、系列和仓库位置拆解责任清单。</li>
        </ul>
      </div>
      <div className="static-report-card text-card">
        <h3>库存建议</h3>
        <ul>
          <li>对高占比产品线设置库存上限、周转天数目标和补货冻结线。</li>
          <li>对 FBA/FBM 等重点仓库识别低动销 SKU，通过促销、调仓、移仓或减少下一批入仓释放库存。</li>
          <li>对在途库存建立到港周预警，把在途和0-30天库存合并监控。</li>
        </ul>
      </div>
    </div>
  );
}

function buildInventoryStaticReport(records) {
  const productMap = mapProducts(records['dim-product']?.rows || []);
  const warehouseMap = mapWarehouses(records['dim-warehouse']?.rows || []);
  const departmentMap = mapDepartments(records['dim-warehouse-material']?.rows || []);
  const rows = (records['fact-2']?.rows || []).map((row) => enrichInventoryRow(row, { productMap, warehouseMap, departmentMap }))
    .filter((row) => row.qty > 0 || row.amount > 0);
  const overview = summarizeInventoryRows('供应链总览', rows, rows);
  return {
    ...overview,
    sourceRows: rows,
    materialCount: uniqueCount(rows, 'materialCode'),
    warehouseCount: uniqueCount(rows, 'warehouse'),
    departmentReports: groupBy(rows, 'department')
      .map(([department, items]) => ({
        ...summarizeInventoryRows(department, items, rows),
        parentTotalAmount: overview.totalAmount
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount || a.department.localeCompare(b.department, 'zh-CN'))
  };
}

function summarizeInventoryRows(department, rows) {
  const totalAmount = sum(rows, 'amount');
  return {
    department,
    totalAmount,
    totalQty: sum(rows, 'qty'),
    bars: {
      warehouseType: groupAmount(rows, 'warehouseType', 8),
      age: orderAgeGroups(groupAmount(rows, 'ageGroup', 8)),
      productLine: groupAmount(rows, 'productLine', 8),
      warehouseLocation: groupAmount(rows, 'warehouseLocation', 8),
      series: groupAmount(rows, 'productSeries', 10)
    },
    trend: buildTrend(rows)
  };
}

function enrichInventoryRow(row, maps) {
  const materialCode = normalizeMaterialCode(firstText([
    firstValue(row, ['物料编码', '货品编码', '商品编码', 'SKU']),
    nthValue(row, 1)
  ]));
  const warehouse = normalizeText(firstText([
    firstValue(row, ['仓库', '仓库名称', '金蝶仓库', '库存仓库']),
    nthValue(row, 3)
  ]));
  const organization = normalizeText(firstText([
    firstValue(row, ['使用组织', '库存组织', '组织']),
    nthValue(row, 4)
  ]));
  const qty = firstNumber([
    firstValue(row, ['合计库存数量', '合计数量', '合计', '关账结存库存']),
    firstValueByHeaderIncludes(row, ['合计', '库存', '数量']),
    firstValueByHeaderIncludes(row, ['合计', '数量']),
    firstValue(row, ['0430结存库存数量', '4月30日结余库存数量', '结余库存数量'])
  ]);
  const product = maps.productMap.get(materialCode) || {};
  const warehouseInfo = maps.warehouseMap.get(warehouse) || {};
  const departmentKey = normalizeDepartmentKey(`${organization}${warehouse}${materialCode}`);
  const price = firstNumber([
    firstValue(row, ['结算价（含税）', '结算价(含税)', '结算价含税', '结算价']),
    firstValueByHeaderIncludes(row, ['结算价']),
    product.settlementPrice
  ]);
  const amount = qty * price;
  return {
    materialCode,
    warehouse,
    organization,
    qty,
    price,
    amount,
    materialName: product.materialName || normalizeText(firstValue(row, ['物料名称', '货品名称', '商品名称', '金蝶名称'])),
    productLine: product.productLine || '未分类产品线',
    productSeries: product.productSeries || '未分类系列',
    warehouseType: warehouseInfo.type || '未分类仓库类型',
    warehouseLocation: warehouseInfo.location || '未分类仓库位置',
    department: maps.departmentMap.get(departmentKey) || product.department || organization || '未匹配事业部',
    ageGroup: getAgeGroup(row),
    month: getInventoryMonth(row)
  };
}

function buildTrend(rows) {
  const monthRows = rows.filter((row) => row.month);
  const source = monthRows.length ? monthRows : rows.map((row) => ({ ...row, month: '04' }));
  return {
    summary: [{
      name: '总库存占用',
      values: monthValues(source)
    }],
    productLine: groupBy(source, 'productLine')
      .map(([name, items]) => ({ name, values: monthValues(items) }))
      .sort((a, b) => b.values[3] - a.values[3] || a.name.localeCompare(b.name, 'zh-CN'))
      .slice(0, 8)
  };
}

function monthValues(rows) {
  return ['01', '02', '03', '04'].map((month) => (
    sum(rows.filter((row) => normalizeText(row.month) === month), 'amount')
  ));
}

function mapProducts(rows) {
  const map = new Map();
  for (const row of rows) {
    const materialCode = normalizeMaterialCode(firstText([firstValue(row, ['物料编码']), nthValue(row, 1)]));
    if (!materialCode || map.has(materialCode)) continue;
    map.set(materialCode, {
      materialName: normalizeText(firstText([firstValue(row, ['金蝶名称', '物料名称', '货品名称']), nthValue(row, 4)])),
      productLine: normalizeText(firstText([firstValue(row, ['销售产品线', '产品线']), nthValue(row, 7)])),
      productSeries: normalizeText(firstText([firstValue(row, ['销售系列', '产品系列', '系列']), nthValue(row, 8)])),
      department: normalizeText(firstText([firstValue(row, ['采购分组', '事业部']), nthValue(row, 22)])),
      settlementPrice: firstNumber([
        firstValue(row, ['结算价（含税）', '结算价(含税)', '结算价含税', '结算价', '内部结算价', '26年内部结算价', '2026年内部结算价']),
        firstValueByHeaderIncludes(row, ['结算价']),
        nthValue(row, 10)
      ])
    });
  }
  return map;
}

function mapWarehouses(rows) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(firstText([
      firstValue(row, ['仓库金蝶名称', '仓库名称', '金蝶名称', '仓库']),
      nthValue(row, 2)
    ]));
    if (!name || map.has(name)) continue;
    map.set(name, {
      type: normalizeText(firstText([firstValue(row, ['仓库类型', '结库类型', '类型']), nthValue(row, 7)])) || '',
      location: normalizeText(firstText([firstValue(row, ['仓库位置', '结库位置', '位置']), nthValue(row, 8)])) || ''
    });
  }
  return map;
}

function mapDepartments(rows) {
  const map = new Map();
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
    const department = normalizeText(firstText([
      firstValue(row, ['事业部', '部门', '仓库事业部', '所属事业部']),
      nthValue(row, 7)
    ]));
    if (key && department && !map.has(key)) map.set(key, department);
  }
  return map;
}

function getAgeGroup(row) {
  const explicit = normalizeText(firstText([
    firstValue(row, ['库龄段', '库龄区间']),
    firstValueByHeaderIncludes(row, ['库龄段'])
  ]));
  if (explicit) return explicit;
  const age = firstNumber([
    firstValue(row, ['库龄', '库龄天数', '账龄']),
    firstValueByHeaderIncludes(row, ['库龄'])
  ]);
  if (age > 120) return '120天以上';
  if (age > 90) return '91-120天';
  if (age > 60) return '61-90天';
  if (age > 30) return '31-60天';
  return '0-30天';
}

function getInventoryMonth(row) {
  const raw = firstText([
    firstValue(row, ['月份', '库存月份', '关账月份']),
    firstValueByHeaderIncludes(row, ['月份'])
  ]);
  const matched = normalizeText(raw).match(/(?:20\d{2})?\D?(1[0-2]|0?[1-9])\D?月?/);
  if (matched) return String(Number(matched[1])).padStart(2, '0');
  return '';
}

function groupAmount(rows, key, limit) {
  return groupBy(rows, key)
    .map(([name, items]) => ({ name: name || '未分类', value: sum(items, 'amount') }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit);
}

function orderAgeGroups(rows) {
  const order = ['0-30天', '31-60天', '61-90天', '91-120天', '120天以上'];
  return [...rows].sort((a, b) => {
    const ai = order.indexOf(a.name);
    const bi = order.indexOf(b.name);
    if (ai >= 0 && bi >= 0) return ai - bi;
    if (ai >= 0) return -1;
    if (bi >= 0) return 1;
    return b.value - a.value;
  });
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const name = normalizeText(row[key]) || '未分类';
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(row);
  }
  return [...map.entries()];
}

function buildStatusText({ loading, error, report, lastLoadedAt }) {
  if (loading) return '正在读取库存文件库...';
  if (error) return `读取失败：${error}`;
  if (!report.sourceRows.length) return '未读取到库存分析月份表数据，请先维护文件库并应用。';
  const loadedText = lastLoadedAt ? `；读取时间：${lastLoadedAt}` : '';
  return `已读取 ${formatNumber(report.sourceRows.length, 0)} 行库存记录，库存金额 ${moneyWan(report.totalAmount)}${loadedText}`;
}

function recordSourceText(record) {
  if (!record) return '未引用';
  const time = record.appliedAt || record.savedAt ? formatRecordTime(record.appliedAt || record.savedAt) : '-';
  return `${record.fileName || record.title || '-'}；当前引用：${time}`;
}

function formatRecordTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

function slugify(value) {
  return encodeURIComponent(value).replace(/%/g, '');
}

function uniqueCount(rows, key) {
  return new Set(rows.map((row) => normalizeText(row[key])).filter(Boolean)).size;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function moneyWan(value) {
  return `${formatNumber((Number(value) || 0) / 10000, 1)}万`;
}

function percent(value, total) {
  const denominator = Number(total) || 0;
  if (!denominator) return '0.0%';
  return `${((Number(value) || 0) / denominator * 100).toFixed(1)}%`;
}

function growthText(current, previous) {
  const base = Number(previous) || 0;
  if (!base) return '-';
  return `${(((Number(current) || 0) / base - 1) * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: digits });
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

function normalizeDepartmentKey(value) {
  return normalizeMaterialCode(value).replace(/&/g, '').toLowerCase();
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
