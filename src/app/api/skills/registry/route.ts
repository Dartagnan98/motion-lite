import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

// Browse OpenClaw skills registry (awesome-openclaw-skills curated list)
const REGISTRY_URL = 'https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main/README.md'

interface RegistrySkill {
  name: string
  slug: string
  description: string
  category: string
  repo_url: string
}

let cachedSkills: RegistrySkill[] = []
let cacheTime = 0
const CACHE_TTL = 3600000 // 1 hour

async function fetchRegistry(): Promise<RegistrySkill[]> {
  if (cachedSkills.length > 0 && Date.now() - cacheTime < CACHE_TTL) {
    return cachedSkills
  }

  try {
    const res = await fetch(REGISTRY_URL, { next: { revalidate: 3600 } })
    if (!res.ok) return cachedSkills

    const md = await res.text()
    const skills: RegistrySkill[] = []
    let currentCategory = 'Other'

    for (const line of md.split('\n')) {
      // Category headers
      const catMatch = line.match(/^###?\s+(.+?)(?:\s+\(\d+\s+skills?\))?$/)
      if (catMatch) {
        currentCategory = catMatch[1].replace(/[*_`]/g, '').trim()
        continue
      }

      // Skill entries: - [name](url) - description
      const skillMatch = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)\s*[-–:]\s*(.+)$/)
      if (skillMatch) {
        const name = skillMatch[1].trim()
        const url = skillMatch[2].trim()
        const desc = skillMatch[3].replace(/[*_`"]/g, '').trim()
        const slugMatch = url.match(/github\.com\/[\w-]+\/([\w-]+)/)
        const slug = slugMatch ? slugMatch[1] : name.toLowerCase().replace(/\s+/g, '-')

        skills.push({
          name,
          slug,
          description: desc,
          category: currentCategory,
          repo_url: url,
        })
      }
    }

    cachedSkills = skills
    cacheTime = Date.now()
    return skills
  } catch {
    return cachedSkills
  }
}

export async function GET(req: NextRequest) {
  try { await requireAuth() } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const query = req.nextUrl.searchParams.get('q')?.toLowerCase()
  const category = req.nextUrl.searchParams.get('category')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50')
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0')

  const all = await fetchRegistry()

  let filtered = all
  if (query) {
    filtered = filtered.filter(s =>
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.slug.toLowerCase().includes(query)
    )
  }
  if (category && category !== 'All') {
    filtered = filtered.filter(s => s.category === category)
  }

  // Get unique categories
  const categories = [...new Set(all.map(s => s.category))].sort()

  return NextResponse.json({
    skills: filtered.slice(offset, offset + limit),
    total: filtered.length,
    categories,
  })
}
