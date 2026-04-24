import { NextRequest, NextResponse } from 'next/server'

const RAG_URL = process.env.LIGHTRAG_URL || 'http://${SERVER_IP_2}:4002'

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { action, query, mode, top_k, entity_name, search_term } = body

  try {
    if (action === 'query') {
      const res = await fetch(`${RAG_URL}/query/data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, mode: mode || 'local', top_k: top_k || 10 }),
      })
      return NextResponse.json(await res.json())
    }

    if (action === 'search') {
      const res = await fetch(`${RAG_URL}/graph/label/search?q=${encodeURIComponent(search_term || query)}`)
      return NextResponse.json(await res.json())
    }

    if (action === 'entity') {
      const res = await fetch(`${RAG_URL}/graph/entity/exists?name=${encodeURIComponent(entity_name)}`)
      return NextResponse.json(await res.json())
    }

    if (action === 'labels') {
      const res = await fetch(`${RAG_URL}/graph/label/list`)
      return NextResponse.json(await res.json())
    }

    if (action === 'popular') {
      const res = await fetch(`${RAG_URL}/graph/label/popular`)
      return NextResponse.json(await res.json())
    }

    if (action === 'graph') {
      const label = entity_name || ''
      const res = await fetch(`${RAG_URL}/graphs?label=${encodeURIComponent(label)}&max_depth=3`)
      return NextResponse.json(await res.json())
    }

    if (action === 'health') {
      const res = await fetch(`${RAG_URL}/health`)
      return NextResponse.json(await res.json())
    }

    if (action === 'create_entity') {
      const res = await fetch(`${RAG_URL}/graph/entity/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload),
      })
      return NextResponse.json(await res.json())
    }

    if (action === 'edit_entity') {
      const res = await fetch(`${RAG_URL}/graph/entity/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload),
      })
      return NextResponse.json(await res.json())
    }

    if (action === 'create_relation') {
      const res = await fetch(`${RAG_URL}/graph/relation/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.payload),
      })
      return NextResponse.json(await res.json())
    }

    if (action === 'raw') {
      const res = await fetch(`${RAG_URL}${body.path}`, {
        method: body.method || 'GET',
        headers: body.method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: body.method === 'POST' ? JSON.stringify(body.payload) : undefined,
      })
      return NextResponse.json(await res.json())
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: 'LightRAG unreachable', detail: String(err) }, { status: 502 })
  }
}
