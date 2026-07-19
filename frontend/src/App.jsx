import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || res.statusText)
  }
  return res.json()
}

function wsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  if (API_BASE.startsWith('http')) {
    const u = new URL(API_BASE)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.pathname = '/ws'
    u.search = ''
    return u.toString()
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
}

function scoreClass(score) {
  if (score >= 80) return 'score-high'
  if (score >= 60) return 'score-mid'
  return 'score-low'
}

function statusLabel(status) {
  return status.replaceAll('_', ' ')
}

function formatMoney(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)
}

function timeLabel(iso) {
  try {
    return new Date(iso).toLocaleTimeString()
  } catch {
    return iso
  }
}

export default function App() {
  const [feed, setFeed] = useState([])
  const [queue, setQueue] = useState([])
  const [decisions, setDecisions] = useState([])
  const [stats, setStats] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [operator] = useState('ops_demo')
  const wsRef = useRef(null)

  const selected = useMemo(
    () => queue.find((t) => t.id === selectedId) || feed.find((t) => t.id === selectedId) || null,
    [queue, feed, selectedId],
  )

  const refresh = useCallback(async () => {
    const [q, tx, d, s] = await Promise.all([
      api('/queue'),
      api('/transactions?limit=40'),
      api('/decisions?limit=20'),
      api('/stats'),
    ])
    setQueue(q)
    setFeed(tx)
    setDecisions(d)
    setStats(s)
    setStreaming(Boolean(s.streaming))
    if (!selectedId && q[0]) setSelectedId(q[0].id)
  }, [selectedId])

  useEffect(() => {
    refresh().catch((e) => setToast(e.message))
  }, [refresh])

  useEffect(() => {
    let alive = true
    let retry

    function connect() {
      const ws = new WebSocket(wsUrl())
      wsRef.current = ws
      ws.onopen = () => {
        if (!alive) return
        setConnected(true)
        ws.send('ping')
      }
      ws.onclose = () => {
        if (!alive) return
        setConnected(false)
        retry = setTimeout(connect, 2000)
      }
      ws.onerror = () => ws.close()
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'transaction' || msg.type === 'alert') {
            const txn = msg.transaction
            setFeed((prev) => [txn, ...prev.filter((t) => t.id !== txn.id)].slice(0, 60))
            if (txn.status === 'pending') {
              setQueue((prev) =>
                [txn, ...prev.filter((t) => t.id !== txn.id)].sort(
                  (a, b) => b.risk_score - a.risk_score,
                ),
              )
              setSelectedId((cur) => cur || txn.id)
            }
            setStats((s) =>
              s
                ? {
                    ...s,
                    total_transactions: s.total_transactions + 1,
                    pending_queue:
                      txn.status === 'pending' ? s.pending_queue + 1 : s.pending_queue,
                    high_risk_seen:
                      txn.risk_score >= (s.threshold || 60)
                        ? s.high_risk_seen + 1
                        : s.high_risk_seen,
                  }
                : s,
            )
          }
          if (msg.type === 'decision') {
            const txn = msg.transaction
            setQueue((prev) => prev.filter((t) => t.id !== txn.id))
            setFeed((prev) => [txn, ...prev.filter((t) => t.id !== txn.id)])
            setDecisions((prev) => [msg.decision, ...prev].slice(0, 30))
            setSelectedId((cur) => (cur === txn.id ? null : cur))
            setStats((s) =>
              s
                ? {
                    ...s,
                    pending_queue: Math.max(0, s.pending_queue - 1),
                    decisions_made: s.decisions_made + 1,
                  }
                : s,
            )
            setToast(`${msg.decision.action.toUpperCase()} · ${txn.merchant}`)
          }
        } catch {
          /* ignore */
        }
      }
    }

    connect()
    return () => {
      alive = false
      clearTimeout(retry)
      wsRef.current?.close()
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 2800)
    return () => clearTimeout(t)
  }, [toast])

  async function startStream() {
    setBusy(true)
    try {
      await api('/stream/start', { method: 'POST' })
      setStreaming(true)
      setToast('Live stream started')
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function stopStream() {
    setBusy(true)
    try {
      await api('/stream/stop', { method: 'POST' })
      setStreaming(false)
      setToast('Stream stopped')
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function simulateAttack() {
    setBusy(true)
    try {
      const res = await api('/demo/attack', {
        method: 'POST',
        body: JSON.stringify({ intensity: 'high' }),
      })
      setToast(`Attack simulation: ${res.injected} high-risk alerts`)
      await refresh()
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function decide(action) {
    if (!selected) return
    setBusy(true)
    try {
      await api(`/transactions/${selected.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ action, operator, notes: `Demo ${action}` }),
      })
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="desk">
      <header className="topbar">
        <div className="brand-block">
          <p className="brand">RiskPulse</p>
          <p className="tagline">Detect. Decide. Respond. — on IBM Z / LinuxONE</p>
        </div>
        <div className="top-actions">
          <span className={`pill ${connected ? 'on' : 'off'}`}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
          {streaming ? (
            <button type="button" className="btn ghost" disabled={busy} onClick={stopStream}>
              Stop stream
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={busy} onClick={startStream}>
              Start stream
            </button>
          )}
          <button type="button" className="btn danger" disabled={busy} onClick={simulateAttack}>
            Simulate attack
          </button>
        </div>
      </header>

      <section className="stats-row" aria-label="Live stats">
        <Stat label="Transactions" value={stats?.total_transactions ?? '—'} />
        <Stat label="Queue" value={stats?.pending_queue ?? '—'} accent="warn" />
        <Stat label="High risk" value={stats?.high_risk_seen ?? '—'} accent="danger" />
        <Stat label="Decisions" value={stats?.decisions_made ?? '—'} accent="ok" />
      </section>

      <main className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Detect</h2>
            <span>Live payment stream</span>
          </div>
          <ul className="feed">
            {feed.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`feed-item ${selectedId === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <div className="feed-top">
                    <strong>{t.merchant}</strong>
                    <span className={`score ${scoreClass(t.risk_score)}`}>{t.risk_score}</span>
                  </div>
                  <div className="feed-meta">
                    <span>{formatMoney(t.amount)}</span>
                    <span>{t.country}</span>
                    <span>{timeLabel(t.timestamp)}</span>
                    <span className="status">{statusLabel(t.status)}</span>
                  </div>
                </button>
              </li>
            ))}
            {!feed.length && <li className="empty">Start the stream to detect risk in motion.</li>}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Decide</h2>
            <span>{queue.length} pending</span>
          </div>
          <ul className="queue">
            {queue.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`queue-item ${selectedId === t.id ? 'active' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className={`score ${scoreClass(t.risk_score)}`}>{t.risk_score}</span>
                  <div>
                    <strong>{t.merchant}</strong>
                    <p>
                      {formatMoney(t.amount)} · {t.customer_id} · ****{t.card_last4}
                    </p>
                  </div>
                </button>
              </li>
            ))}
            {!queue.length && <li className="empty">No pending alerts — simulate an attack.</li>}
          </ul>
        </section>

        <section className="panel respond">
          <div className="panel-head">
            <h2>Respond</h2>
            <span>Human-in-the-loop</span>
          </div>
          {selected ? (
            <div className="detail">
              <div className="detail-hero">
                <div>
                  <p className="eyebrow">Selected alert</p>
                  <h3>{selected.merchant}</h3>
                  <p className="sub">
                    {formatMoney(selected.amount)} · {selected.channel} · {selected.country}
                  </p>
                </div>
                <div className={`score big ${scoreClass(selected.risk_score)}`}>
                  {selected.risk_score}
                </div>
              </div>
              <dl className="facts">
                <div>
                  <dt>Customer</dt>
                  <dd>{selected.customer_id}</dd>
                </div>
                <div>
                  <dt>Card</dt>
                  <dd>****{selected.card_last4}</dd>
                </div>
                <div>
                  <dt>Velocity 1h</dt>
                  <dd>{selected.velocity_1h}</dd>
                </div>
                <div>
                  <dt>Recommend</dt>
                  <dd>{selected.recommended_action}</dd>
                </div>
              </dl>
              <div className="reasons">
                <p className="eyebrow">Why this score</p>
                <ul>
                  {selected.risk_reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
              {selected.status === 'pending' ? (
                <div className="actions">
                  <button type="button" className="btn ok" disabled={busy} onClick={() => decide('approve')}>
                    Approve
                  </button>
                  <button type="button" className="btn warn" disabled={busy} onClick={() => decide('hold')}>
                    Hold
                  </button>
                  <button
                    type="button"
                    className="btn danger"
                    disabled={busy}
                    onClick={() => decide('escalate')}
                  >
                    Escalate
                  </button>
                </div>
              ) : (
                <p className="resolved">Already {statusLabel(selected.status)}</p>
              )}
            </div>
          ) : (
            <p className="empty pad">Select a high-risk item to respond.</p>
          )}

          <div className="audit">
            <p className="eyebrow">Audit trail</p>
            <ul>
              {decisions.map((d) => (
                <li key={d.id}>
                  <span className="mono">{timeLabel(d.decided_at)}</span>
                  <strong>{d.action}</strong>
                  <span>
                    score {d.risk_score} · {d.operator}
                  </span>
                </li>
              ))}
              {!decisions.length && <li className="empty">Decisions appear here.</li>}
            </ul>
          </div>
        </section>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function Stat({ label, value, accent }) {
  return (
    <div className={`stat ${accent || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
