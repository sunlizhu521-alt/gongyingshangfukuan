import React from 'react';
import KcfxLibraryPage from './KcfxLibraryPage.jsx';

const FACT_SLOTS = [
  { id: 'fact-inventory', label: '最近关账库存', description: '关账库存总表' },
  { id: 'fact-2', label: '库存分析月份表', description: '库存数量、金额、库龄等分析数据' },
  { id: 'fact-3', label: '库存事实表 3' },
  { id: 'fact-4', label: '库存事实表 4' },
  { id: 'fact-5', label: '库存事实表 5' },
  { id: 'fact-6', label: '库存事实表 6' },
  { id: 'fact-7', label: '库存事实表 7' },
  { id: 'fact-8', label: '库存事实表 8' }
];

export default function FactLibraryPage({ kcfxData = null, loading = false, ...props }) {
  return <KcfxLibraryPage {...props} kcfxData={kcfxData} loading={loading} title="库存数据文件" slots={FACT_SLOTS} />;
}
