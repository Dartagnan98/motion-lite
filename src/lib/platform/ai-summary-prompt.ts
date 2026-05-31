/**
 * AI Executive Summary prompt builder for the Hiilite Platform report.
 *
 * Used by frontend-eng's API route at:
 *   src/app/api/platform/reports/[reportId]/ai-summary/route.ts
 *
 * Caller pattern (frontend-eng wires the actual SDK call):
 *
 *   const { system, user } = buildExecutiveSummaryPrompt(context)
 *   const msg = await anthropic.messages.create({
 *     model: 'claude-sonnet-4-6',
 *     max_tokens: 500,
 *     system,
 *     messages: [{ role: 'user', content: user }],
 *   })
 *   const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
 *
 * ──────────────────────────────────────────────────────────────────────
 * EXPECTED OUTPUT EXAMPLES (for QA golden-file reference)
 *
 * Example A — positive material delta, previousPeriod present.
 * Clicks grew 24% MoM (72 vs 58). Derived percent IS allowed because
 * both values are in source data — no [UNVERIFIED] needed:
 *   "Glenvalley Dental's clicks grew from 58 to 72 month-over-month, a
 *   24% lift that reflects the content work across the service pages in
 *   March. Impressions rose from 5,412 to 6,258 over the same window,
 *   and average position tightened from 22.10 to 20.55. Site traffic
 *   followed the same trend: 256 users in April versus 198 in March, with
 *   organic search holding as the top acquisition channel. The clearest
 *   next step is converting this click momentum into booked appointments
 *   by improving the CTAs on the pages driving the most impressions."
 *
 * Example B — negative material delta, honest framing, previousPeriod
 * present. Users dropped 15% MoM (198 vs 233). Derived percent allowed:
 *   "Glenvalley Dental saw site users fall from 233 to 198 month-over-
 *   month, a 15% decline that warrants a closer look at referral and
 *   direct traffic sources. Search performance held steadier: clicks
 *   moved from 61 to 58 and impressions stayed near 5,400, suggesting
 *   organic visibility is not the primary driver of the drop. The
 *   engagement rate among users who did visit was 59%, which indicates
 *   the site content is still relevant once someone arrives. For March,
 *   the focus should be diagnosing the traffic-source drop before it
 *   compounds into a search signal."
 *
 * Example C — mixed signals, previousPeriod present. Clicks up 24%
 * (material), tasks completed down (minor). Model leads with the
 * largest mover, acknowledges the secondary decline without dramatizing:
 *   "Glenvalley Dental's clicks jumped from 58 to 72 in April, a 24%
 *   month-over-month gain that is the strongest signal from this period.
 *   Impressions also climbed from 5,412 to 6,258, while average position
 *   improved from 22.10 to 20.55. Tasks completed came in at 8 versus 11
 *   the prior month, a lighter delivery cadence that is worth tracking
 *   against the search gains to confirm output is keeping pace with
 *   opportunity. The top opportunity for May is pushing the pages now
 *   ranking in the low 20s across the position-10 threshold, where the
 *   CTR curve inflects sharply."
 *
 * Example D — no previousPeriod, single-period data only. Behaves
 * exactly as v1: no derived percentages, cite current numbers only:
 *   "Glenvalley Dental earned 72 clicks and 6,258 impressions in April,
 *   with an average search position of 20.55 and a CTR of 1.15%.
 *   Site traffic reached 256 users across 312 sessions, with organic
 *   search driving the largest share of visits. The 63% engagement rate
 *   reflects solid on-page relevance for visitors arriving from Google.
 *   The priority heading into May is improving position on the service
 *   pages where impressions are high but clicks still trail."
 *
 * Example E — incomplete data, model correctly avoids invented numbers:
 *   "Glenvalley Dental's search data for April shows 72 clicks across
 *   6,258 impressions, with an average position of 20.55 and a CTR of
 *   1.15%. Traffic data was not available for this period, so website
 *   user counts are not included in this summary. Based on the search
 *   trends available, May's focus should be on service pages that are
 *   earning impressions but not converting to clicks."
 *   (No [UNVERIFIED] needed — model correctly omitted the missing data.)
 *
 * ──────────────────────────────────────────────────────────────────────
 */

export interface ReportContext {
  clientName: string
  periodStart: string // ISO YYYY-MM-DD
  periodEnd: string
  /** Qualitative client context (from the client card) used to TAILOR framing,
   *  relevance, and the forward-looking sentence — never to introduce numbers. */
  clientContext?: {
    industry?: string | null
    goals?: string | null
    services?: string | null
    audience?: string | null
    brandVoice?: string | null
    location?: string | null
  }
  sections: Array<{
    title: string // "Search Performance", "Traffic Overview", etc.
    metrics: Array<{
      label: string // human label, e.g. "Clicks"
      value: number | string
      unit?: 'ms' | '%' | 'USD' | 'count' | 'hours'
    }>
  }>
  previousPeriod?: {
    periodStart: string // ISO YYYY-MM-DD — was optional fields; now required when block present
    periodEnd: string
    sections: Array<{
      title: string
      metrics: Array<{ label: string; value: number | string }>
    }>
  }
}

/**
 * Serializes one period's sections into a compact, readable block the
 * model can parse without hallucinating metric values.
 */
function serializeSections(
  sections: ReportContext['sections']
): string {
  return sections
    .map((section) => {
      const rows = section.metrics
        .map((m) => {
          const unitSuffix = m.unit ? ` (${m.unit})` : ''
          return `  - ${m.label}${unitSuffix}: ${m.value}`
        })
        .join('\n')
      return `${section.title}:\n${rows}`
    })
    .join('\n\n')
}

/**
 * Builds the system + user prompt pair for the AI Executive Summary.
 *
 * Design rationale:
 *
 * SYSTEM — encodes the hard constraints, the hallucination guard, the
 * voice, and the [UNVERIFIED] mechanic. Kept model-agnostic so it works
 * on claude-sonnet-4-6 today and a cheaper model tomorrow without
 * rewriting business logic.
 *
 * USER — supplies the structured data only. Keeps the data injection
 * cleanly separated from the behavioral instructions so frontend-eng
 * can swap context shapes without touching prompt logic.
 *
 * Hallucination guard:
 * The system prompt instructs the model to prefix with [UNVERIFIED] any
 * sentence that contains a number not present verbatim in the SOURCE DATA
 * block. The UI (AIExecutiveSummarySection.tsx) highlights [UNVERIFIED]
 * in amber so the PM removes those sentences before sending. This is a
 * belt-and-suspenders approach: we don't rely on the model to be perfect,
 * we make the failure mode visible so a human catches it.
 */
export function buildExecutiveSummaryPrompt(input: ReportContext): {
  system: string
  user: string
} {
  const system = `You write executive summary paragraphs for a digital marketing agency. The reader is a small-business owner receiving their monthly SEO and marketing report. The agency PM will review and edit before this is sent, so write as if the PM is speaking directly to the client.

TONE AND STYLE
- Direct and specific. One idea per sentence.
- Agency-PM to small-business client. Professional but conversational.
- No adjective pile-ups. No marketing speak: never use "crushing it", "knocking it out of the park", "rockstar performance", "unlock your potential", "transform your business", or similar phrases.
- No emoji. No bullet points. No headers. No markdown formatting of any kind.
- Plain prose only. The output must be a single paragraph of 3 to 5 sentences with no line breaks.

STRUCTURAL RULES
1. Write exactly 3 to 5 sentences. Not fewer, not more.
2. Always refer to the client by name (provided in the data) in the first sentence.
3. The final sentence must be a forward-looking observation tied to one of the deltas or trends visible in the data: name the specific metric and what action it implies for next month.
4. Cite at least one specific number from the SOURCE DATA in your summary.

WHEN PREVIOUS PERIOD DATA IS PROVIDED — these rules apply and override rule 4 above:
- The very first sentence MUST state a specific delta. Choose the metric with the largest absolute percent change (prefer absolute lifts above 30% or absolute drops above 20% over small moves). State both the before value and the after value.
- You MAY include a derived percentage change (e.g., "a 24% lift") if both the current value and the previous value for that metric are present in the SOURCE DATA. Compute it as: (current - previous) / previous * 100, rounded to the nearest whole number. A correctly computed percent is NOT considered unverified.
- Do NOT lead with a trivial delta (less than 5% absolute change). If all deltas are below 5%, lead with the largest mover and omit the percentage.
- The final sentence must name the metric that moved most and state the top opportunity it creates.

HALLUCINATION GUARD — THIS IS THE MOST IMPORTANT RULE
You must only use numbers that are either (a) present verbatim in the SOURCE DATA block, or (b) a percentage directly derivable from two values in the SOURCE DATA by the formula (current - previous) / previous * 100.
Any other number — including external benchmarks, industry averages, historical trends not in the data, or numbers you cannot trace to a specific row in SOURCE DATA — must be prefixed with [UNVERIFIED] at the very start of that sentence.
Do not omit the [UNVERIFIED] prefix when it applies. It is not optional. The PM uses it to find and remove fabricated claims before sending.
If you cannot support a claim with numbers from the SOURCE DATA, remove the number from the sentence or remove the sentence entirely.

CLIENT CONTEXT (when provided)
If a CLIENT CONTEXT block is present, use it to tailor the summary: match the client's brand voice, frame results against their stated goals, and make the forward-looking final sentence reference their actual services/audience/goals (e.g., tie an opportunity to a specific service they offer). Client context guides FRAMING and RELEVANCE only — it must NEVER introduce numbers; the hallucination guard above still governs every number you write.`

  const hasPreviousPeriod =
    input.previousPeriod && input.previousPeriod.sections.length > 0

  const currentBlock = serializeSections(input.sections)

  const previousBlock = hasPreviousPeriod
    ? `\n\nPREVIOUS PERIOD DATA (${input.previousPeriod!.periodStart} to ${input.previousPeriod!.periodEnd}) — match sections and metric labels to CURRENT PERIOD DATA to compute deltas. Lead the summary with the most material delta. Derived percentages from these two datasets do NOT require [UNVERIFIED]:\n${serializeSections(input.previousPeriod!.sections)}`
    : ''

  const cc = input.clientContext
  const contextLines = cc
    ? [
        cc.industry && `Industry: ${cc.industry}`,
        cc.location && `Location: ${cc.location}`,
        cc.services && `Services: ${cc.services}`,
        cc.audience && `Target audience: ${cc.audience}`,
        cc.goals && `Business goals: ${cc.goals}`,
        cc.brandVoice && `Brand voice: ${cc.brandVoice}`,
      ].filter(Boolean).join('\n')
    : ''
  const contextBlock = contextLines
    ? `\n\nCLIENT CONTEXT (for framing + relevance ONLY — never a source of numbers):\n${contextLines}`
    : ''

  const user = `Write a 3-to-5-sentence executive summary for the following monthly report.

CLIENT: ${input.clientName}
REPORT PERIOD: ${input.periodStart} to ${input.periodEnd}${contextBlock}

SOURCE DATA (the ONLY numbers you are permitted to use — any number you write that does not appear here must be prefixed with [UNVERIFIED]):

${currentBlock}${previousBlock}

Write the summary now. Plain prose only. No markdown. No line breaks within the paragraph.`

  return { system, user }
}
