import React from 'react';
import KcfxLibraryPage from './KcfxLibraryPage.jsx';

const DIMENSION_SLOTS = [
  { id: 'dim-product', label: '商品分类维表', description: 'Dim-YL医疗器械商品分类' },
  { id: 'dim-warehouse', label: '仓库维表' },
  { id: 'dim-warehouse-material', label: '仓库物料事业部对照表' },
  { id: 'dim-store-name', label: '销售部门维表' },
  { id: 'dim-customer-material', label: '店铺简称维表' },
  { id: 'dim-purchase-division', label: '采购分工明细', description: '产品线明细 sheet' }
];

export default function FileLibraryPage({ kcfxData = null, loading = false, ...props }) {
  return <KcfxLibraryPage {...props} kcfxData={kcfxData} loading={loading} title="维度表文件库" slots={DIMENSION_SLOTS} />;
}
