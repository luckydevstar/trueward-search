"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/browser";

/**
 * Sign-in, in this project's own CSS rather than a component library.
 *
 * The other two Trueward apps use antd; this one has never had it, and
 * pulling in a UI library for one form would be a dependency and a bundle for
 * six inputs. The shape and wording still match the calendar's — one
 * Trueward, one way in.
 */
export function LoginCard() {
  const router = useRouter();
  const params = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }

    setBusy(true);
    setError("");
    const db = createClient();
    const { error: failure } = await db.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);

    if (failure) {
      // Supabase's own wording for a bad password is "Invalid login
      // credentials", which is the right amount to say: naming which half was
      // wrong confirms whether an address has an account.
      setError(failure.message);
      return;
    }

    // refresh() so the server re-reads the cookie the sign-in just set; push()
    // alone can render the destination from a cache that predates it.
    router.replace(params.get("next") || "/");
    router.refresh();
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
          {busy ? <><span className="spinner" /> Signing in…</> : "Sign in"}
        </button>
      </form>
    </main>
  );
}
