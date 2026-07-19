# RiskPulse — 3-minute pitch script

**Team title format:** `[ONLXXX] RiskPulse — Real-Time Payment Risk on IBM Z`

Target runtime: **2:30–2:50**

---

## 0:00–0:25 — Problem

Fraud and payment risk do not wait for batch jobs.
In seconds, a stolen card can drain an account across borders.
Ops teams drown in alerts — too slow to Detect, Decide, and Respond.

## 0:25–0:50 — Data & approach

We stream synthetic payment events: amount, merchant, country, velocity, channel.
RiskPulse blends **transparent rules** with an **IsolationForest** anomaly model.
Every score comes with human-readable reasons — not a black box.

## 0:50–1:50 — Live demo (screen share)

1. Show the **RiskPulse** ops desk.
2. Click **Start stream** — Detect: live transactions scoring in real time.
3. Click **Simulate attack** — Decide: high-risk queue fills (gambling, remit corridors, velocity spikes).
4. Select an alert — show reasons + recommended action.
5. Click **Hold** or **Escalate** — Respond: decision written to an immutable audit trail.

Narrate: *Detect. Decide. Respond.* as each panel lights up.

## 1:50–2:25 — Why IBM Z / LinuxONE

Banks already trust IBM Z for payments, crypto, and always-on reliability.
We run the scoring and decision API on **LinuxONE** — the brain sits where the money lives.
Show: SSH session or container on the instance + `GET /health` returning platform-ready status.

## 2:25–2:50 — Responsible AI close

Human-in-the-loop. Explainable reasons. Full audit log.
Powerful AI — without silent auto-blocking.
RiskPulse: real-time critical decisions on enterprise-grade IBM Z.

---

## Recording checklist

- [ ] Team number in video title / slide
- [ ] Problem → data → solution → IBM Z (required)
- [ ] Show LinuxONE instance / tech stack on screen
- [ ] GitHub link in description / submission form
- [ ] Under 3 minutes
- [ ] Demo path rehearsed twice (stream → attack → decide)
