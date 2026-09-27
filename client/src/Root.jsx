import { useCallback, useEffect, useState } from 'react';
import App from './App.jsx';
import Login from './Login.jsx';

/**
 * The gate.
 *
 * The server is the actual boundary — every /api route refuses without a
 * session, so nothing here is load-bearing for security. This decides what to
 * *show*: a login form, the app, or a sentence when the server has no
 * Supabase credentials to check against.
 *
 * `/api/auth/me` answers 200 with `{ user: null }` rather than 401, so "not
 * signed in" arrives as an answer instead of an error the client has to
 * distinguish from a network failure.
 */
export default function Root() {
  const [state, setState] = useState({ status: 'loading' });

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setState({
        status: data.user ? 'in' : data.configured ? 'out' : 'unconfigured',
        user: data.user,
      });
    } catch {
      setState({ status: 'offline' });
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setState({ status: 'out' });
  };

  if (state.status === 'loading') {
    return <div className="boot"><span className="spinner" /> Loading…</div>;
  }

  if (state.status === 'offline') {
    return (
      <div className="boot boot-error">
        Cannot reach the server. Is it running?
      </div>
    );
  }

  if (state.status === 'unconfigured') {
    return (
      <div className="boot boot-error">
        The server has no Supabase credentials, so nobody can sign in.
        Set <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> and restart it.
      </div>
    );
  }

  if (state.status === 'out') {
    return <Login onSignedIn={(user) => setState({ status: 'in', user })} />;
  }

  return <App user={state.user} onSignOut={signOut} onSessionLost={check} />;
}
