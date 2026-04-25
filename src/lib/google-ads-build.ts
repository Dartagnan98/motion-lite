// High-level "build a campaign from a spec" orchestrator.
// Runs the sequence: budget → campaign → ad group → RSA → keywords → proximity → schedule → negatives.
// Returns resource names at each step so they can be undone if something later fails.

import { createCampaignBudget, createSearchCampaign, createAdGroup, createResponsiveSearchAd, addKeywords, addProximity, addAdSchedule, addNegativeKeywords, pauseCampaign } from './google-ads-mutate'
import type { MutateCtx, DayOfWeek } from './google-ads-mutate'

export interface CampaignSpec {
  customerId: string            // "9021727039" (no dashes)
  name: string                  // "MR - Open Early"
  budgetDollars: number         // 5 → 5_000_000 micros
  finalUrl: string
  keywords: string[]
  matchType?: 'EXACT' | 'PHRASE' | 'BROAD'
  negativeKeywords: string[]
  headlines: string[]
  descriptions: string[]
  proximity: { lat: number; lng: number; radiusKm: number }
  schedule: Array<{ dayOfWeek: DayOfWeek; startHour: number; endHour: number; bidModifier?: number }>
  startPaused?: boolean         // default true
}

export interface BuildResult {
  ok: boolean
  spec: string                  // name
  budget?: string
  campaign?: string
  adGroup?: string
  ad?: string
  keywords?: string[]
  proximity?: string
  schedule?: string[]
  negatives?: string[]
  error?: string
  failedAt?: string
}

export async function buildCampaign(ctx: MutateCtx, spec: CampaignSpec): Promise<BuildResult> {
  const result: BuildResult = { ok: false, spec: spec.name }

  try {
    result.budget = await createCampaignBudget(ctx, {
      name: `${spec.name} Budget`,
      amountMicros: Math.round(spec.budgetDollars * 1_000_000),
    })

    result.campaign = await createSearchCampaign(ctx, {
      name: spec.name,
      budgetResourceName: result.budget,
      status: 'PAUSED',           // always create paused, we review before going live
    })

    result.adGroup = await createAdGroup(ctx, {
      name: `${spec.name} Ad Group`,
      campaignResourceName: result.campaign,
    })

    result.ad = await createResponsiveSearchAd(ctx, {
      adGroupResourceName: result.adGroup,
      finalUrls: [spec.finalUrl],
      headlines: spec.headlines,
      descriptions: spec.descriptions,
    })

    result.keywords = await addKeywords(ctx, {
      adGroupResourceName: result.adGroup,
      keywords: spec.keywords,
      matchType: spec.matchType || 'PHRASE',
    })

    result.proximity = await addProximity(ctx, {
      campaignResourceName: result.campaign,
      ...spec.proximity,
    })

    result.schedule = await addAdSchedule(ctx, {
      campaignResourceName: result.campaign,
      schedules: spec.schedule,
    })

    if (spec.negativeKeywords.length > 0) {
      result.negatives = await addNegativeKeywords(ctx, {
        campaignResourceName: result.campaign,
        keywords: spec.negativeKeywords,
      })
    }

    if (spec.startPaused === false) {
      // leave enable to a separate explicit step
    }

    result.ok = true
    return result
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    result.error = msg
    result.failedAt = failedStep(result)
    // best-effort: pause the campaign if it was created
    if (result.campaign && !ctx.validateOnly) {
      try { await pauseCampaign(ctx, result.campaign) } catch {}
    }
    return result
  }
}

function failedStep(r: BuildResult): string {
  if (!r.budget) return 'budget'
  if (!r.campaign) return 'campaign'
  if (!r.adGroup) return 'adGroup'
  if (!r.ad) return 'ad'
  if (!r.keywords) return 'keywords'
  if (!r.proximity) return 'proximity'
  if (!r.schedule) return 'schedule'
  return 'negatives'
}
