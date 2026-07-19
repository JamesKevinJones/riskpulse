import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  generateAttackBurst,
  generateTransaction,
  makeDecision,
} from './demoEngine'
import './App.css'

const FORCE_DEMO = import.meta.env.VITE_DEMO_MODE === 'true'
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

async function api(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(typeof err.detail === 'string' ? err.detail : res.statusText)
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

function emptyStats() {
  return {
    total_transactions: 0,
    pending_queue: 0,
    high_risk_seen: 0,
    decisions_made: 0,
    threshold: 60,
    streaming: false,
  }
}

function applyTxn(txn, setFeed, setQueue, setSelectedId, setStats) {
  setFeed((prev) => [txn, ...prev.filter((t) => t.id !== txn.id)].slice(0, 60))
  if (txn.status === 'pending') {
    setQueue((prev) =>
      [txn, ...prev.filter((t) => t.id !== txn.id)].sort((a, b) => b.risk_score - a.risk_score),
    )
    setSelectedId((cur) => cur || txn.id)
  }
  setStats((s) => {
    const base = s || emptyStats()
    return {
      ...base,
      total_transactions: base.total_transactions + 1,
      pending_queue: txn.status === 'pending' ? base.pending_queue + 1 : base.pending_queue,
      high_risk_seen:
        txn.risk_score >= (base.threshold || 60) ? base.high_risk_seen + 1 : base.high_risk_seen,
    }
  })
}

export default function App() {
  const [demoMode, setDemoMode] = useState(FORCE_DEMO)
  const [feed, setFeed] = useState([])
  const [queue, setQueue] = useState([])
  const [decisions, setDecisions] = useState([])
  const [stats, setStats] = useState(emptyStats)
  const [selectedId, setSelectedId] = useState(null)
  const [streaming, setStreaming] = useState(false)
  const [connected, setConnected] = useState(FORCE_DEMO)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const [operator] = useState('ops_demo')
  const wsRef = useRef(null)
  const streamRef = useRef(null)

  const selected = useMemo(
    () => queue.find((t) => t.id === selectedId) || feed.find((t) => t.id === selectedId) || null,
    [queue, feed, selectedId],
  )

  const refresh = useCallback(async () => {
    if (demoMode) return
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
  }, [demoMode, selectedId])

  useEffect(() => {
    if (FORCE_DEMO) {
      setToast('Browser demo mode — full API runs on LinuxONE / Docker locally')
      return undefined
    }
    let cancelled = false
    ;(async () => {
      try {
        await api('/health')
        if (cancelled) return
        setDemoMode(false)
        setConnected(true)
        const [q, tx, d, s] = await Promise.all([
          api('/queue'),
          api('/transactions?limit=40'),
          api('/decisions?limit=20'),
          api('/stats'),
        ])
        if (cancelled) return
        setQueue(q)
        setFeed(tx)
        setDecisions(d)
        setStats(s)
        setStreaming(Boolean(s.streaming))
        if (q[0]) setSelectedId(q[0].id)
      } catch {
        if (cancelled) return
        setDemoMode(true)
        setConnected(true)
        setStats(emptyStats())
        setToast('No API host — running free browser demo on Vercel')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (demoMode) return undefined
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
            applyTxn(msg.transaction, setFeed, setQueue, setSelectedId, setStats)
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
  }, [demoMode])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 3200)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(
    () => () => {
      if (streamRef.current) clearInterval(streamRef.current)
    },
    [],
  )

  async function startStream() {
    setBusy(true)
    try {
      if (demoMode) {
        if (streamRef.current) clearInterval(streamRef.current)
        streamRef.current = setInterval(() => {
          applyTxn(generateTransaction(), setFeed, setQueue, setSelectedId, setStats)
        }, 1400)
        setStreaming(true)
        setStats((s) => ({ ...(s || emptyStats()), streaming: true }))
        setToast('Live stream started (browser demo)')
      } else {
        await api('/stream/start', { method: 'POST' })
        setStreaming(true)
        setToast('Live stream started')
      }
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function stopStream() {
    setBusy(true)
    try {
      if (demoMode) {
        if (streamRef.current) clearInterval(streamRef.current)
        streamRef.current = null
        setStreaming(false)
        setStats((s) => ({ ...(s || emptyStats()), streaming: false }))
        setToast('Stream stopped')
      } else {
        await api('/stream/stop', { method: 'POST' })
        setStreaming(false)
        setToast('Stream stopped')
      }
    } catch (e) {
      setToast(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function simulateAttack() {
    setBusy(true)
    try {
      if (demoMode) {
        const burst = generateAttackBurst('high')
        for (const txn of burst) {
          applyTxn(txn, setFeed, setQueue, setSelectedId, setStats)
        }
        setToast(`Attack simulation: ${burst.length} high-risk alerts`)
      } else {
        const res = await api('/demo/attack', {
          method: 'POST',
          body: JSON.stringify({ intensity: 'high' }),
        })
        setToast(`Attack simulation: ${res.injected} high-risk alerts`)
        await refresh()
      }
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
      if (demoMode) {
        const { transaction, decision } = makeDecision(selected, action, operator)
        setQueue((prev) => prev.filter((t) => t.id !== transaction.id))
        setFeed((prev) => [transaction, ...prev.filter((t) => t.id !== transaction.id)])
        setDecisions((prev) => [decision, ...prev].slice(0, 30))
        setSelectedId((cur) => (cur === transaction.id ? null : cur))
        setStats((s) => ({
          ...(s || emptyStats()),
          pending_queue: Math.max(0, (s?.pending_queue || 1) - 1),
          decisions_made: (s?.decisions_made || 0) + 1,
        }))
        setToast(`${decision.action.toUpperCase()} · ${transaction.merchant}`)
      } else {
        await api(`/transactions/${selected.id}/decide`, {
          method: 'POST',
          body: JSON.stringify({ action, operator, notes: `Demo ${action}` }),
        })
      }
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
          <p className="tagline">
            Detect. Decide. Respond. — on IBM Z / LinuxONE
            {demoMode ? ' · browser demo' : ''}
          </p>
        </div>
        <div className="top-actions">
          <span className={`pill ${connected ? 'on' : 'off'}`}>
            {connected ? (demoMode ? 'DEMO' : 'LIVE') : 'OFFLINE'}
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
