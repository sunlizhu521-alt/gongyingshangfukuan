import React from 'react';
import {
  MAINTENANCE_LIBRARY_MENU_PAGES,
  SALES_INVENTORY_PAGES,
  SYSTEM_FILE_LIBRARY_MENU_PAGES,
  permissionGroups,
  systemOwnerName
} from '../constants.js';

export default function Sidebar({
  user,
  activeTab,
  canAccessGroup,
  canAccessTab,
  openMenuTab,
  toggleMenuGroup,
  isMenuGroupExpanded,
  expandedMenuGroups,
  appVersionTime,
  logout
}) {
  const groupExists = (groupValue) => permissionGroups.some((group) => group.value === groupValue);
  const isExpanded = (groupValue) => (
    expandedMenuGroups instanceof Set ? expandedMenuGroups.has(groupValue) : isMenuGroupExpanded(groupValue)
  );
  const canAccessSalesInventory = groupExists('salesInventory') && canAccessGroup('salesInventory');
  const canAccessMaintenanceLibrary = groupExists('maintenanceLibrary') && canAccessGroup('maintenanceLibrary');
  const canAccessSystemFileLibrary = groupExists('systemFileLibrary') && canAccessGroup('systemFileLibrary');
  const canManagePermissions = user?.name === systemOwnerName;

  return (
    <aside className="sidebar">
      <h1>库存和销售数据看板</h1>
      <div className="app-version-time">版本时间：{appVersionTime}</div>
      <nav className="sidebar-menu" aria-label="系统菜单">
        {canAccessSalesInventory && (
          <div className="menu-group">
            <button
              type="button"
              className={`menu-group-toggle ${isExpanded('salesInventory') ? 'active' : ''}`}
              onClick={() => toggleMenuGroup('salesInventory')}
              aria-expanded={isExpanded('salesInventory')}
            >
              库存和销售数据看板
              <span>{isExpanded('salesInventory') ? '▾' : '▸'}</span>
            </button>
            {isExpanded('salesInventory') && (
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
              className={`menu-group-toggle ${isExpanded('maintenanceLibrary') ? 'active' : ''}`}
              onClick={() => toggleMenuGroup('maintenanceLibrary')}
              aria-expanded={isExpanded('maintenanceLibrary')}
            >
              维护文件库
              <span>{isExpanded('maintenanceLibrary') ? '▾' : '▸'}</span>
            </button>
            {isExpanded('maintenanceLibrary') && (
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
              className={`menu-group-toggle ${isExpanded('systemFileLibrary') ? 'active' : ''}`}
              onClick={() => toggleMenuGroup('systemFileLibrary')}
              aria-expanded={isExpanded('systemFileLibrary')}
            >
              系统文件库
              <span>{isExpanded('systemFileLibrary') ? '▾' : '▸'}</span>
            </button>
            {isExpanded('systemFileLibrary') && (
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
              className={`menu-group-toggle ${isExpanded('systemManagement') ? 'active' : ''}`}
              onClick={() => toggleMenuGroup('systemManagement')}
              aria-expanded={isExpanded('systemManagement')}
            >
              系统管理
              <span>{isExpanded('systemManagement') ? '▾' : '▸'}</span>
            </button>
            {isExpanded('systemManagement') && (
              <div className="submenu-list">
                <button
                  className={activeTab === 'permissionManagement' ? 'active' : ''}
                  onClick={() => openMenuTab('permissionManagement', 'systemManagement')}
                >
                  权限管理
                </button>
                <button
                  className={activeTab === 'reminders' ? 'active' : ''}
                  onClick={() => openMenuTab('reminders', 'systemManagement')}
                >
                  操作日志
                </button>
              </div>
            )}
          </div>
        )}
      </nav>
      <div className="user-box">
        <strong>{user.name}</strong>
        <span>{user.role}</span>
        <button onClick={logout}>退出</button>
      </div>
    </aside>
  );
}
