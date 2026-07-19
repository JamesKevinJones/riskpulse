/** Browser-side RiskPulse engine for Vercel (no backend / no credit card). */

const HIGH_RISK_COUNTRIES = new Set(['NG', 'RU', 'MT', 'EG', 'UA'])
const HIGH_RISK_CATEGORIES = new Set(['gambling', 'money_transfer', 'marketplace'])

const MERCHANTS = [
  ['Amazon', 'retail', 'US'],
  ['Starbucks', 'food', 'US'],
  ['Uber', 'travel', 'US'],
  ['Shell', 'fuel', 'US'],
  ['Netflix', 'subscription', 'US'],
  ['Walmart', 'retail', 'US'],
  ['Apple', 'electronics', 'US'],
  ['Local Market', 'retail', 'IN'],
  ['Cairo Electronics', 'electronics', 'EG'],
  ['NightWire Casino', 'gambling', 'MT'],
  ['QuickWire Remit', 'money_transfer', 'NG'],
  ['DarkCart Marketplace', 'marketplace', 'RU'],
]

const CUSTOMERS = Array.from({ length: 20 }, (_, i) => `cust_${String(i + 1).padStart(3, '0')}`)
const CHANNELS = ['online', 'pos', 'atm', 'mobile']

function uid() {
  return crypto.randomUUID()
}

function nowIso() {
  return new Date().toISOString()
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function scoreTransaction(txn) {
  let score = 0
  const reasons = []
  const amount = Number(txn.amount)
  const avg = Math.max(Number(txn.avg_amount_7d) || 1, 1)
  const velocity = Number(txn.velocity_1h) || 1

  if (amount > avg * 6) {
    score += 28
    reasons.push(`Amount ${amount.toFixed(0)} is ${(amount / avg).toFixed(1)}x 7-day average`)
  } else if (amount > avg * 3) {
    score += 16
    reasons.push(`Amount elevated vs 7-day average (${(amount / avg).toFixed(1)}x)`)
  }

  if (velocity >= 8) {
    score += 24
    reasons.push(`High velocity: ${velocity} txns in last hour`)
  } else if (velocity >= 5) {
    score += 14
    reasons.push(`Elevated velocity: ${velocity} txns in last hour`)
  }

  if (HIGH_RISK_COUNTRIES.has(txn.country)) {
    score += 18
    reasons.push(`High-risk corridor: ${txn.country}`)
  }

  if (HIGH_RISK_CATEGORIES.has(txn.merchant_category)) {
    score += 16
    reasons.push(`Risky merchant category: ${txn.merchant_category}`)
  }

  if (txn.is_new_merchant && amount > 200) {
    score += 12
    reasons.push('First-time merchant with large ticket')
  }

  if (txn.channel === 'online' && amount > 1500) {
    score += 10
    reasons.push('Large online payment')
  }

  // Light anomaly bump for odd combos (stands in for IsolationForest on Vercel)
  if (velocity >= 6 && amount > avg * 5) score += 12
  if (HIGH_RISK_COUNTRIES.has(txn.country) && txn.channel === 'online') score += 8

  score = Math.min(100, score)
  if (!reasons.length) reasons.push('Within normal customer behavior')

  let recommended_action = 'approve'
  if (score >= 80) recommended_action = 'escalate'
  else if (score >= 60) recommended_action = 'hold'

  return {
    risk_score: score,
    risk_reasons: reasons.slice(0, 4),
    recommended_action,
  }
}

function finalize(payload) {
  const scored = scoreTransaction(payload)
  const created = nowIso()
  const status = scored.risk_score >= 60 ? 'pending' : 'auto_cleared'
  return {
    id: uid(),
    timestamp: payload.timestamp || created,
    amount: payload.amount,
    merchant: payload.merchant,
    merchant_category: payload.merchant_category,
    country: payload.country,
    channel: payload.channel,
    card_last4: payload.card_last4,
    customer_id: payload.customer_id,
    velocity_1h: payload.velocity_1h,
    avg_amount_7d: payload.avg_amount_7d,
    is_new_merchant: Boolean(payload.is_new_merchant),
    ...scored,
    status,
    created_at: created,
  }
}

export function generateNormal() {
  const [merchant, merchant_category, country] = pick(MERCHANTS.slice(0, 8))
  const avg = +(20 + Math.random() * 100).toFixed(2)
  return finalize({
    timestamp: nowIso(),
    amount: +Math.max(5, avg + (Math.random() - 0.5) * avg * 0.7).toFixed(2),
    merchant,
    merchant_category,
    country,
    channel: pick(CHANNELS.slice(0, 3)),
    card_last4: String(1000 + Math.floor(Math.random() * 9000)),
    customer_id: pick(CUSTOMERS),
    velocity_1h: 1 + Math.floor(Math.random() * 3),
    avg_amount_7d: avg,
    is_new_merchant: Math.random() < 0.08,
  })
}

export function generateRisky() {
  const [merchant, merchant_category, country] = pick(MERCHANTS.slice(8))
  const avg = +(30 + Math.random() * 70).toFixed(2)
  return finalize({
    timestamp: nowIso(),
    amount: +(avg * (8 + Math.random() * 32)).toFixed(2),
    merchant,
    merchant_category,
    country,
    channel: 'online',
    card_last4: String(1000 + Math.floor(Math.random() * 9000)),
    customer_id: pick(CUSTOMERS),
    velocity_1h: 6 + Math.floor(Math.random() * 9),
    avg_amount_7d: avg,
    is_new_merchant: true,
  })
}

export function generateTransaction() {
  return Math.random() < 0.18 ? generateRisky() : generateNormal()
}

export function generateAttackBurst(intensity = 'high') {
  const n = intensity === 'high' ? 6 : 4
  const customer = pick(CUSTOMERS)
  const card = String(1000 + Math.floor(Math.random() * 9000))
  const riskyMerchants = MERCHANTS.slice(8)
  return Array.from({ length: n }, (_, i) => {
    const [merchant, merchant_category, country] = pick(riskyMerchants)
    const avg = +(35 + Math.random() * 55).toFixed(2)
    return finalize({
      timestamp: nowIso(),
      amount: +(
        intensity === 'high' ? 1800 + Math.random() * 7700 : 900 + Math.random() * 2600
      ).toFixed(2),
      merchant,
      merchant_category,
      country,
      channel: 'online',
      card_last4: card,
      customer_id: customer,
      velocity_1h: 8 + i,
      avg_amount_7d: avg,
      is_new_merchant: true,
    })
  })
}

export function makeDecision(txn, action, operator = 'ops_demo') {
  const statusMap = { approve: 'approved', hold: 'held', escalate: 'escalated' }
  return {
    transaction: { ...txn, status: statusMap[action] },
    decision: {
      id: uid(),
      transaction_id: txn.id,
      action,
      operator,
      risk_score: txn.risk_score,
      notes: `Demo ${action}`,
      decided_at: nowIso(),
    },
  }
}
