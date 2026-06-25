import React from 'react';
import { SYSTEM_FILE_LIBRARY_PAGES } from '../constants.js';

export default function SystemFileLibraryPage({
  activeTab,
  systemFilePackages,
  formatBytes,
  downloadSystemPackage
}) {
  if (!SYSTEM_FILE_LIBRARY_PAGES.some((page) => page.tab === activeTab)) return null;

  return (
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
  );
}
