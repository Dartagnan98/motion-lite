import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import {
  searchInterests, searchLocations, searchBehaviors, searchDemographics, searchLocales,
} from '@/lib/meta-campaign-api'

export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const type = req.nextUrl.searchParams.get('type') // interests | locations | behaviors | demographics | locales
  const query = req.nextUrl.searchParams.get('q') || ''
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '30')

  try {
    switch (type) {
      case 'interests': {
        if (!query) return NextResponse.json({ error: 'q required for interest search' }, { status: 400 })
        const data = await searchInterests(query, limit)
        return NextResponse.json(data)
      }
      case 'locations': {
        if (!query) return NextResponse.json({ error: 'q required for location search' }, { status: 400 })
        const locationTypes = req.nextUrl.searchParams.get('location_types')
        const types = locationTypes ? JSON.parse(locationTypes) : undefined
        const data = await searchLocations(query, 'adgeolocation', types, limit)
        return NextResponse.json(data)
      }
      case 'behaviors': {
        const data = await searchBehaviors(query || undefined, limit)
        return NextResponse.json(data)
      }
      case 'demographics': {
        const subtype = req.nextUrl.searchParams.get('subtype') as Parameters<typeof searchDemographics>[0]
        if (!subtype) return NextResponse.json({ error: 'subtype required (education_schools, education_majors, work_employers, work_positions, life_events, family_statuses, industries, income)' }, { status: 400 })
        const data = await searchDemographics(subtype, query || undefined)
        return NextResponse.json(data)
      }
      case 'locales': {
        const data = await searchLocales(limit)
        return NextResponse.json(data)
      }
      default:
        return NextResponse.json({ error: 'type required: interests | locations | behaviors | demographics | locales' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
