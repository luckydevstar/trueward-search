'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api.js';

const SOURCE_LABELS = {
  jobright: 'Jobright', jobgether: 'Jobgether', remoteyeah: 'RemoteYeah', ziprecruiter: 'ZipRecruiter',
  lensa: 'Lensa', adzuna: 'Adzuna', linkedin: 'LinkedIn', manual: 'Manual',
};

const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'new', label: 'New' },
  { key: 'applied', label: 'Applied' },
  { key: 'dismissed', label: 'Deleted' },
];

function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export function JobsApp({ email }) {
  const [tab, setTab] = useState('active');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  // Paging resets when the filters change. Keyed to them rather than reset in
  // an effect: an effect renders page 5 of the *new* filter once before
  // correcting itself, and "reset state when something changes" is the shape
  // React asks you not to write.
  const [paging, setPaging] = useState({ key: '', value: 200 });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [data, setData] = useState({ jobs: [], total: 0 });
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null); // job object, or {} for a new job
  const [expanded, setExpanded] = useState(() => new Set());
  const [toast, setToast] = useState(null);
  /** Bumped by anything that wants the list re-fetched. See the effect below. */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  // Compared during render, so a filter change shows page one immediately
  // rather than one frame later.
  const filterKey = `${tab}|${source}|${debouncedQ}`;
  const limit = paging.key === filterKey ? paging.value : 200;
  const setLimit = (value) => setPaging({ key: filterKey, value });

  useEffect(() => {
    let cancelled = false;
    api.list({ status: tab, source, q: debouncedQ, limit })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError('');
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        // A session expires while the tab sits open. Reloading lets the proxy
        // do what it does for any anonymous request — send you to /login —
        // rather than leaving "Not signed in" in a red bar above a list that
        // will never load again.
        if (/not signed in/i.test(e.message)) { window.location.reload(); return; }
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, source, debouncedQ, limit, reloadToken]);

  // ---- status polling ----------------------------------------------------
  // Every setState sits inside a promise callback rather than the effect
  // body, which is what React's set-state-in-effect rule is asking for — and
  // `cancelled` is not ceremony: switching tabs quickly starts several
  // requests, and without it the slowest wins whenever it lands last.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      api.status()
        .then((s) => { if (!cancelled) setStatus(s); })
        .catch(() => { /* the server may be restarting */ });
    };
    tick();
    // Faster while a scrape runs, so jobs appear as each source finishes.
    const every = status?.running ? 4000 : 60_000;
    const timer = setInterval(() => { tick(); reload(); }, every);
    return () => { cancelled = true; clearInterval(timer); };
  }, [status?.running, reload]);

  /**
   * Each toast carries its own id, so replacing one restarts the timer below
   * rather than leaving the previous one to dismiss the new message early.
   *
   * The timer lives in an effect rather than a ref: its cleanup cancels the
   * old timeout automatically, which is what the ref was doing by hand — and
   * a ref read from an event handler is something React 19's linter cannot
   * tell apart from one read during render.
   */
  // The id counts up from the previous toast rather than from a clock:
  // Date.now() is impure, and calling it while rendering is exactly what
  // React's purity rule is there to catch.
  const showToast = (message, undo) =>
    setToast((previous) => ({ message, undo, id: (previous?.id ?? 0) + 1 }));

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);

  const patchLocal = (job) => setData((d) => ({ ...d, jobs: d.jobs.map((j) => (j.id === job.id ? { ...j, ...job } : j)) }));
  const removeLocal = (id) => setData((d) => ({ ...d, total: d.total - 1, jobs: d.jobs.filter((j) => j.id !== id) }));

  const onDelete = async (job) => {
    removeLocal(job.id);
    try {
      await api.remove(job.id);
      showToast(`Deleted “${job.title}”`, async () => {
        await api.update(job.id, { status: job.status === 'dismissed' ? 'new' : job.status });
        setToast(null);
        reload();
      });
    } catch (e) { setError(e.message); reload(); }
  };

  const onPurge = async (job) => {
    removeLocal(job.id);
    try { await api.remove(job.id, true); } catch (e) { setError(e.message); reload(); }
  };

  const setJobStatus = async (job, next) => {
    try {
      const updated = await api.update(job.id, { status: next });
      // Does the job still belong in the tab you are looking at? Marking one
      // applied while on "New" removes it from view; the same change on
      // "Active" only updates it in place.
      const stillVisible = tab === 'active' ? next !== 'dismissed' : tab === next;
      if (stillVisible) patchLocal(updated);
      else removeLocal(job.id);
      if (next === 'new' && job.status === 'dismissed') showToast(`Restored “${job.title}”`);
    } catch (e) { setError(e.message); }
  };

  const onApply = (job) => {
    window.open(job.url, '_blank', 'noopener,noreferrer');
  };

  const [confirmBulk, setConfirmBulk] = useState(false);
  useEffect(() => {
    if (!confirmBulk) return;
    const t = setTimeout(() => setConfirmBulk(false), 4000);
    return () => clearTimeout(t);
  }, [confirmBulk]);
  const bulkIds = data.jobs.filter((j) => j.status === 'new').map((j) => j.id);

  const onDeleteAllShown = async () => {
    if (!confirmBulk) { setConfirmBulk(true); return; }
    setConfirmBulk(false);
    try {
      const { dismissed } = await api.dismissMany(bulkIds);
      showToast(`Deleted ${dismissed.length} jobs`, async () => {
        await api.restoreMany(dismissed);
        setToast(null);
        reload();
      });
      reload();
    } catch (e) { setError(e.message); }
  };

  const onRefresh = async () => {
    try {
      await api.refresh();
      setStatus((s) => ({ ...s, running: true }));
      setTimeout(loadStatus, 1000);
    } catch (e) { setError(e.message); }
  };

  const onSave = async (form) => {
    const payload = { ...form };
    if (payload.posted_at) payload.posted_at = new Date(payload.posted_at).toISOString();
    if (editing.id) {
      patchLocal(await api.update(editing.id, payload));
    } else {
      await api.create({ ...payload, postedAt: payload.posted_at });
      reload();
    }
    setEditing(null);
  };

  const groups = useMemo(() => {
    const out = [];
    for (const job of data.jobs) {
      const label = dayLabel(job.posted_at);
      if (out.at(-1)?.label !== label) out.push({ label, jobs: [] });
      out.at(-1).jobs.push(job);
    }
    return out;
  }, [data.jobs]);

  const lastFinished = status?.runs?.map((r) => r.finished_at).filter(Boolean).sort().at(-1);

  return (
    <div className="page">
      <header className="top">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden>T</span>
            <h1 className="brand-name">
              Trueward <span>Search</span>
            </h1>
          </div>
          <p className="sub">
            Remote only · US · Software development · No hybrid or on-site
          </p>
        </div>
        <div className="top-actions">
          {email && (
            <span className="who" title={`Signed in as ${email}`}>
              {email}
            </span>
          )}
          <button className="btn" onClick={() => setEditing({})}>+ Add job</button>
          <button className="btn primary" onClick={onRefresh} disabled={status?.running}>
            {status?.running ? <><span className="spinner" /> Refreshing…</> : 'Refresh now'}
          </button>
          {/* A form, so signing out is a POST: a link a browser can prefetch
              must never end a session. */}
          <form action="/auth/signout" method="post" style={{ display: 'inline' }}>
            <button className="btn" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {status && <SourceBar status={status} lastFinished={lastFinished} />}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'tab active' : 'tab'} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search title, company, description…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="summary">
        <span>{data.total} job{data.total === 1 ? '' : 's'} · newest first</span>
        {tab !== 'dismissed' && bulkIds.length > 0 && (
          <button className="link danger" onClick={onDeleteAllShown} title="Applied jobs are kept">
            {confirmBulk ? `Click again to delete ${bulkIds.length} jobs` : `Delete all ${bulkIds.length} shown`}
          </button>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : data.jobs.length === 0 ? (
        <div className="empty">
          {tab === 'active' && !q && !source
            ? status?.running ? 'Fetching jobs… the first run can take a few minutes.' : 'No jobs yet. Press “Refresh now”.'
            : 'No jobs match.'}
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label}>
            <h2 className="day">{g.label}</h2>
            <ul className="list">
              {g.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  open={expanded.has(job.id)}
                  onToggle={() =>
                    setExpanded((open) => {
                      const next = new Set(open);
                      if (next.has(job.id)) next.delete(job.id);
                      else next.add(job.id);
                      return next;
                    })
                  }
                  onApply={() => onApply(job)}
                  onDelete={() => onDelete(job)}
                  onPurge={() => onPurge(job)}
                  onStatus={(st) => setJobStatus(job, st)}
                  onEdit={() => setEditing(job)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {data.jobs.length < data.total && (
        <div className="more">
          <button className="btn" onClick={() => setLimit(limit + 200)}>
            Load more ({data.total - data.jobs.length} remaining)
          </button>
        </div>
      )}

      {editing && <JobForm job={editing} onCancel={() => setEditing(null)} onSave={onSave} />}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && <button className="link" onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </div>
  );
}

function SourceBar({ status, lastFinished }) {
  const runs = Object.fromEntries((status.runs || []).map((r) => [r.source, r]));
  return (
    <div className="sources">
      {status.sources.map((s) => {
        const r = runs[s.name];
        const state = !s.enabled ? 'off' : r?.error ? 'err' : r ? 'ok' : 'idle';
        const title = !s.enabled
          ? s.disabledReason
          : r?.error
            ? r.error
            : r ? `Last run: fetched ${r.fetched}, passed ${r.accepted}, new ${r.inserted}` : 'Not run yet';
        return (
          <span key={s.name} className={`chip ${state}`} title={title}>
            <span className="dot" /> {s.label}
            {r && s.enabled && !r.error && <em>+{r.inserted}</em>}
          </span>
        );
      })}
      <span className="muted small">
        {lastFinished ? `Updated ${timeAgo(lastFinished)}` : ''} · auto-refresh every {status.refreshMinutes} min
      </span>
    </div>
  );
}

function JobRow({ job, open, onToggle, onApply, onDelete, onPurge, onStatus, onEdit }) {
  const dismissed = job.status === 'dismissed';
  return (
    <li className={`job ${job.status}`}>
      <div className="job-main">
        <div className="job-head">
          <button className="title link" onClick={onToggle} title="Show details">{job.title}</button>
          {job.status === 'applied' && <span className="badge applied">Applied</span>}
        </div>
        <div className="meta">
          {job.company && <strong>{job.company}</strong>}
          {job.location && <span>{job.location}</span>}
          {job.salary && <span className="salary">{job.salary}</span>}
          <span className={`src src-${job.source}`}>{SOURCE_LABELS[job.source] || job.source}</span>
          <span className="time" title={new Date(job.posted_at).toLocaleString()}>{timeAgo(job.posted_at)}</span>
        </div>
        {open && (
          <div className="details">
            {job.snippet && <p className="snippet">{job.snippet}{job.snippet.length >= 400 ? '…' : ''}</p>}
            {job.notes && <p className="notes"><b>Notes:</b> {job.notes}</p>}
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="small">{job.url}</a>
          </div>
        )}
      </div>
      <div className="actions">
        <button className="btn primary" onClick={onApply}>Apply ↗</button>
        {!dismissed && job.status !== 'applied' && <button className="btn" onClick={() => onStatus('applied')} title="Mark as applied">✓ Applied</button>}
        {job.status === 'applied' && <button className="btn" onClick={() => onStatus('new')} title="Unmark applied">Unmark</button>}
        <button className="btn" onClick={onEdit}>Edit</button>
        {dismissed ? (
          <>
            <button className="btn" onClick={() => onStatus('new')}>Restore</button>
            {job.manual ? <button className="btn danger" onClick={onPurge}>Delete forever</button> : null}
          </>
        ) : (
          <button className="btn danger" onClick={onDelete} title="Hide this job permanently">Delete</button>
        )}
      </div>
    </li>
  );
}

function JobForm({ job, onCancel, onSave }) {
  const isNew = !job.id;
  const toLocal = (iso) => {
    const d = iso ? new Date(iso) : new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  };
  const [form, setForm] = useState({
    title: job.title || '', company: job.company || '', location: job.location || 'Remote (US)',
    salary: job.salary || '', url: job.url || '', notes: job.notes || '', posted_at: toLocal(job.posted_at),
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    try { await onSave(form); } catch (e2) { setErr(e2.message); }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit}>
        <h3>{isNew ? 'Add job' : 'Edit job'}</h3>
        <label>Title*<input required value={form.title} onChange={set('title')} autoFocus /></label>
        <label>Apply URL*<input required type="url" value={form.url} onChange={set('url')} placeholder="https://…" /></label>
        <div className="row">
          <label>Company<input value={form.company} onChange={set('company')} /></label>
          <label>Location<input value={form.location} onChange={set('location')} /></label>
        </div>
        <div className="row">
          <label>Salary<input value={form.salary} onChange={set('salary')} /></label>
          <label>Posted<input type="datetime-local" value={form.posted_at} onChange={set('posted_at')} /></label>
        </div>
        <label>Notes<textarea rows={3} value={form.notes} onChange={set('notes')} /></label>
        {err && <div className="error">{err}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary">{isNew ? 'Add' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}
