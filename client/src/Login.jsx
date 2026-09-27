import { useState } from 'react';

/**
 * The sign-in screen.
 *
 * Deliberately the same shape and wording as the calendar's: one Trueward,
 * one way in. The credentials are Trueward Guru's — this app has no accounts
 * of its own and no way to make one, which is why there is no "sign up" here
 * and no link offering one.
 *
 * The password never touches this component's state beyond the keystroke: it
 * is POSTed to our own server, which exchanges it with Supabase and returns
 * an httpOnly cookie. Nothing token-shaped is readable from JavaScript.
 */
export default function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
      onSignedIn(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="brand">
          <span className="brand-mark" aria-hidden>T</span>
          <h1 className="brand-name">
            Trueward <span>Search</span>
          </h1>
        </div>

        <p className="muted signin-lede">
          Sign in with your Trueward Guru admin account — it is the same
          database and the same password.
        </p>

        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && <div className="error">{error}</div>}

        <button className="btn primary btn-block" type="submit" disabled={busy}>
          {busy ? <><span className="spinner" /> Signing in…</> : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
