import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, get, post } from './api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, company: null, locations: [] });
  const [locationId, setLocationIdState] = useState(() => localStorage.getItem('sepos_location') || '');

  const load = useCallback(async () => {
    const token = localStorage.getItem('sepos_token');
    if (!token) return setState({ loading: false, user: null, company: null, locations: [] });
    try {
      const me = await get('/auth/me');
      setState({ loading: false, ...me });
      if (!localStorage.getItem('sepos_location') && me.user.location_id) setLocationId(me.user.location_id);
    } catch {
      localStorage.removeItem('sepos_token');
      setState({ loading: false, user: null, company: null, locations: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const onLogout = () => setState({ loading: false, user: null, company: null, locations: [] });
    window.addEventListener('sepos:logout', onLogout);
    return () => window.removeEventListener('sepos:logout', onLogout);
  }, []);

  const login = async (username, password) => {
    const data = await post('/auth/login', { username, password });
    localStorage.setItem('sepos_token', data.token);
    if (data.user.location_id) setLocationId(data.user.location_id);
    setState({ loading: false, user: data.user, company: data.company, locations: data.locations });
    return data;
  };

  const logout = () => {
    localStorage.removeItem('sepos_token');
    setState({ loading: false, user: null, company: null, locations: [] });
  };

  const setLocationId = id => { localStorage.setItem('sepos_location', String(id)); setLocationIdState(String(id)); };

  const can = useCallback(perm => {
    const u = state.user; if (!u) return false;
    if (u.role === 'ADMIN') return true;
    return Array.isArray(perm) ? perm.some(p => u.permissions?.[p]) : !!u.permissions?.[perm];
  }, [state.user]);

  const value = useMemo(() => ({ ...state, login, logout, can, locationId, setLocationId, reload: load,
    location: state.locations.find(l => String(l.id) === String(locationId)) || state.locations[0] || null }), [state, can, locationId, load]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
