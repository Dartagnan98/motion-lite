# QuickBooks Online Integration Plan

> Mirror of `~/code/hiilite-platform/QBO-INTEGRATION-PLAN.md` — kept in the
> motion-lite workspace per William's request 2026-05-22. Canonical version
> lives alongside the Charter in `hiilite-platform/`.

**Drafted:** 2026-05-22
**Status:** Plan / pending Phase 4 Sprint 1 kickoff
**Targets:** Phase 4 Sprint 1

---

## Why this matters

Of every data source the Hiilite Platform could integrate, **QBO is the single most differentiating add**. No competing SEO reporting tool (AgencyAnalytics, Whatagraph, DashThis, Swydo, Reportz, Databox, Looker Studio) ships invoice/revenue data tied to the client report.

This is the wedge charter §8 calls out: *"project-data + media-data fused in one report"* — invoices are the missing third leg alongside hours + traffic.

---

## Decision: native adapter, not the MCP

Hiilite has an Intuit MCP at `~/code/hiilite-share/8-accounting/intuit-qbo-mcp/` (140 tools, realm `123145730043042`). It stays — for William's daily Claude Code accounting work.

The platform builds its own adapter because:
1. Other agency PMs (Phase 4 customers) don't have Claude Code
2. Multi-tenant — each agency authorizes their own QBO realm
3. Scheduled background fetches (no interactive Claude session)

The MCP's source code is research material — Intuit API patterns + OAuth dance. The platform writes fresh adapter code following the 8-adapter convention.

---

## Architecture summary

**File layout** mirrors existing adapters:
```
src/lib/platform/integrations/qbo/
├── adapter.ts          AdapterContract<QboRawSnapshot, QboNormalized>
├── oauth.ts            Intuit OAuth 2.0 + refresh lock
├── connect-flow.ts     mirrors GA4
├── normalize.ts        QBO API → MetricEnvelope (finance.* slugs)
├── types.ts
├── README.md
└── fixtures/
```

**Tenancy: agency-level, NOT per-client.** One QBO connection per tenant. Per-client filtering via `client_profiles.qbo_customer_id` mapping.

**Auth:** Intuit OAuth 2.0. New env vars: `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `INTUIT_OAUTH_ENVIRONMENT`. Tokens stored encrypted via vault.ts; refresh lock per-integration like GSC/GA4.

---

## Per-client mapping

**Schema (additive ALTER):**
```sql
ALTER TABLE client_profiles ADD COLUMN qbo_customer_id TEXT
ALTER TABLE client_profiles ADD COLUMN qbo_class_id TEXT     -- if Hiilite uses Classes
```

**UX:** On `/clients/[slug]` Profile tab, new "Financial Mapping" subsection. Searchable picker pulls QBO customers, fuzzy-matches by name ("GlenValley Dental Clinic" → suggested for client_profile "Glenvalley Dental"). PM confirms, FK saved. Unmapped clients see "Set up mapping →" CTA in their Financial Summary section.

---

## Data placement: 3 surfaces

| Where | What |
|---|---|
| **New "Financial Summary" section** (between Hours Invested + AI Summary) | 4-tile KPI strip (Invoiced / Paid / Outstanding / DSO) + AR aging table + recent invoices table + daily invoice line chart. Delta wiring per existing pattern. |
| **Augmented Hours Invested section** | Per-project rows gain `revenue` + `hourly_realized` columns. PM sees per-project profitability inline. |
| **AI Executive Summary v3** | Prompt extended to consume `previousPeriod.financial`. New first-sentence delta candidates: "invoiced $3,400 up from $2,800 — 21% lift driven by website refresh add-on." |

---

## Metric slugs (locked, namespace pattern)

```
finance.invoiced_total       MetricValue (USD)
finance.paid_total           MetricValue (USD)
finance.outstanding          MetricValue (USD)
finance.dso_days             MetricValue (count)
finance.ar_aging             MetricSeries (bucket, invoice_count, amount)
finance.recent_invoices      MetricSeries (date, number, amount, status, customer_name)
finance.invoiced_daily       MetricSeries (date, amount)
```

Existing `hours.by_project` extended with `revenue` + `hourly_realized` columns. No adapter-contract changes (USD already in the unit union).

---

## Implementation phasing — Phase 4 Sprint 1

~15-20 hours total agent work:

| Deliverable | Owner | Estimate |
|---|---|---|
| QBO adapter end-to-end | integrations-engineer | ~6-8h |
| Schema migration (qbo_customer_id, qbo_class_id) | integrations-engineer | ~30min |
| Financial Summary section + delta wiring | frontend-eng | ~3-4h |
| Hours Invested augmentation | frontend-eng | ~1-2h |
| Per-client QBO mapping UI | frontend-eng | ~2-3h |
| Connect flow + callback + first snapshot | frontend-eng | ~2h |
| AI summary v3 (financial delta) | ricky | ~1h |
| qa-engineer review | qa-engineer | ~1h |

**Dependencies:**
- Intuit production OAuth client registered (separate from sandbox/MCP)
- The 9 carried-over Phase 3 cleanup items (schema FK strings, mandatory script backups, FK-OFF before DROP, etc.)

---

## Open questions for William before Sprint 1 kickoff

1. **Intuit production OAuth app** — register a separate production OAuth client (MCP uses sandbox)? Likely yes.
2. **QBO Class vs Customer** for client segmentation — Hiilite uses which?
3. **Project-level revenue attribution** — pro-rate by hours / tag invoice line-items / use QBO Class per project?
4. **Historical AR depth** — last 90d default; different preference?
5. **Public renderer visibility** — show Financial Summary on `/r/[token]` (clients see AR)? Default hidden until Phase 5 client portal.

---

## Strategic value (Hormozi lens)

**Time-to-answer "is this client worth what they pay?":**
- Today: PM opens 4 tools, 5-10 min + mental math
- Post-QBO: one report, one screen, computed deltas + per-project margins inline

**Differentiation:** zero of the 7 incumbent reporting tools (per charter §8) show invoice/revenue tied to client reports. Phase 4 landing page demo headline writes itself.

**Compound effects:**
- Phase 5 client portal: clients see their report + invoices → passive AR collection
- Phase 6 anomaly detection: "client paid late + traffic dropped 20%" → churn signal
- Phase 4 pricing justification: agencies pay $99-249/mo for a tool that helps them collect AR

---

## Cross-reference

- `~/code/hiilite-platform/CHARTER.md` — locked strategic spec
- `~/code/hiilite-platform/MENU-CONVERGENCE-PLAN.md` — Phase 3 motion-lite ↔ platform unification (sibling planning doc)
- `~/code/hiilite-platform/QBO-INTEGRATION-PLAN.md` — canonical version of this file
- `~/code/hiilite-platform/PHASE-4-PLAN.md` — Phase 4 master plan; QBO is Pillar 1
