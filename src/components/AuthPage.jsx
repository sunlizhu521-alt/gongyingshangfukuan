import React from 'react';

export default function AuthPage({
  authMode,
  setAuthMode,
  loginName,
  setLoginName,
  password,
  setPassword,
  registerName,
  setRegisterName,
  registerPassword,
  setRegisterPassword,
  registerPasswordConfirm,
  setRegisterPasswordConfirm,
  message,
  setMessage = () => {},
  handleLogin,
  handleRegister
}) {
  return (
    <main className="login-shell">
      {authMode === 'login' ? (
        <form className="login-panel" onSubmit={handleLogin} autoComplete="off">
          <h1>库存和销售数据看板</h1>
          <label>
            姓名
            <input
              name="login-display-name"
              autoComplete="off"
              value={loginName}
              onChange={(event) => setLoginName(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              name="login-display-passcode"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button>登录</button>
          <button
            type="button"
            className="ghost auth-switch-button"
            onClick={() => {
              setAuthMode('register');
              setMessage('');
            }}
          >
            注册
          </button>
          {message && <p className="message">{message}</p>}
        </form>
      ) : (
        <form className="login-panel" onSubmit={handleRegister} autoComplete="off">
          <h1>申请注册</h1>
          <label>
            姓名
            <input
              name="register-display-name"
              autoComplete="off"
              value={registerName}
              onChange={(event) => setRegisterName(event.target.value)}
            />
          </label>
          <label>
            密码
            <input
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={registerPassword}
              onChange={(event) => setRegisterPassword(event.target.value)}
            />
          </label>
          <label>
            确认密码
            <input
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              value={registerPasswordConfirm}
              onChange={(event) => setRegisterPasswordConfirm(event.target.value)}
            />
          </label>
          <button>提交注册申请</button>
          <button
            type="button"
            className="ghost auth-switch-button"
            onClick={() => {
              setAuthMode('login');
              setMessage('');
            }}
          >
            返回登录
          </button>
          {message && <p className="message">{message}</p>}
        </form>
      )}
    </main>
  );
}
