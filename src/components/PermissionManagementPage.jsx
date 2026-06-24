import React from 'react';
import { permissionGroups, systemOwnerName } from '../constants.js';
import DataTable from './DataTable.jsx';

export default function PermissionManagementPage({
  managedUsers,
  newUserName,
  setNewUserName,
  newUserPassword,
  setNewUserPassword,
  passwordResets,
  setPasswordResets,
  createManagedUser,
  updateManagedUser,
  deleteManagedUser,
  resetManagedPassword,
  isManagedPermissionChecked,
  toggleManagedGroup,
  toggleManagedPermission
}) {
  return (
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
        columns={['姓名', '状态', '角色', '权限', '密码', '操作']}
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
          ),
          row.name === systemOwnerName ? (
            <span>不可删除</span>
          ) : (
            <button
              type="button"
              className="ghost compact-button danger-button"
              onClick={() => deleteManagedUser(row)}
            >
              删除账号
            </button>
          )
        ]}
      />
    </>
  );
}
