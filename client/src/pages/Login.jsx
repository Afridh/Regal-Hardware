import { useState } from 'react';
import { useAuth } from '../auth.jsx';
import { errMsg } from '../api.js';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await login(username, password); }
    catch (err) { setError(errMsg(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="box" onSubmit={submit}>
        <div className="row" style={{ marginBottom: 20 }}>
          <span style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg,#3b82f6,#14b8a6)', display: 'grid', placeItems: 'center', color: '#fff', fontWeight: 700, fontSize: 18 }}>S</span>
          <div><h1>SePOS</h1><p className="muted">Point of Sale · Inventory · Accounts</p></div>
        </div>
        <div className="stack">
          <div className="field"><label>Username</label><input className="input" value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" /></div>
          <div className="field"><label>Password</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" /></div>
          {error && <div className="badge bad" style={{ padding: '8px 12px', borderRadius: 8 }}>{error}</div>}
          <button className="btn primary lg block" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
