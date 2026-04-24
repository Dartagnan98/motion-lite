'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

// ─── Types ───
interface GraphNode {
  id: string; label: string; entity_type: string; description: string
  val: number; color: string; x?: number; y?: number
  isNew?: boolean; birthTime?: number
}
interface GraphLink {
  source: string | GraphNode; target: string | GraphNode; label: string
  isNew?: boolean; birthTime?: number
}

// ─── Entity type colors (SIGNAL palette) ───
const typeColors: Record<string, string> = {
  person: 'var(--accent)', staff: 'var(--accent)', agent: 'var(--accent)',
  organization: '#5c8fcf', platform: '#5c8fcf', infrastructure: '#5c8fcf',
  project: '#c9a54e', task: '#c9a54e', document: '#c9a54e',
  campaign: '#ef5350', ad_strategy: '#ef5350', bug: '#ef5350',
  framework: '#b388ff', concept: '#b388ff', skill: '#b388ff', sop: '#b388ff', playbook: '#b388ff',
  event: '#00e676', interaction: '#00e676', session: '#00e676', daily_digest: '#00e676', monthly_summary: '#00e676',
  product: '#ff9100', asset: '#ff9100', reference: '#ff9100',
  listing: '#42a5f5', market_data: '#42a5f5',
  report: '#ffd740', group: '#ffd740',
  conversation: 'var(--text-muted)', technology: 'var(--text-muted)',
}

function getColor(entityType: string): string {
  const t = (entityType || '').toLowerCase()
  return typeColors[t] || 'var(--border-strong)'
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : { r: 76, g: 81, b: 85 }
}

// ─── Animation variants ───
const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.32, 0.72, 0, 1] as const } },
}

// How long new entities blink (ms)
const NEW_ENTITY_BLINK_DURATION = 8000
// How long new edges animate their "shoot out" (ms)
const NEW_EDGE_SHOOT_DURATION = 2000
// Polling interval for real-time updates (ms)
const POLL_INTERVAL = 10000

export default function BrainPage() {
  const [tab, setTab] = useState<'graph' | 'browse' | 'api'>('graph')
  const [labels, setLabels] = useState<string[]>([])
  const [filtered, setFiltered] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null)
  const [entityDetail, setEntityDetail] = useState<string | null>(null)
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphRoot, setGraphRoot] = useState('OPERATOR')
  const [health, setHealth] = useState<{ status: string; core_version: string } | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null)
  const [pinnedNode, setPinnedNode] = useState<string | null>(null)
  const highlightNodes = useRef<Set<string>>(new Set())
  const highlightLinks = useRef<Set<string>>(new Set())

  // API explorer state
  const [apiEndpoint, setApiEndpoint] = useState('')
  const [apiBody, setApiBody] = useState('')
  const [apiResponse, setApiResponse] = useState('')
  const [apiLoading, setApiLoading] = useState(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null)
  const cursorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const knownNodeIds = useRef<Set<string>>(new Set())
  const knownLinkKeys = useRef<Set<string>>(new Set())
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const graphRootRef = useRef(graphRoot)
  const forcesConfigured = useRef(false)

  // Keep ref in sync
  useEffect(() => { graphRootRef.current = graphRoot }, [graphRoot])

  // Fetch labels + health on mount
  useEffect(() => {
    fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'labels' }) })
      .then(r => r.json()).then(d => { if (Array.isArray(d)) { setLabels(d); setFiltered(d) } }).catch(() => {})
    fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'health' }) })
      .then(r => r.json()).then(d => setHealth(d)).catch(() => {})
  }, [])

  // Filter labels on search
  useEffect(() => {
    if (!search.trim()) { setFiltered(labels); return }
    const term = search.toLowerCase()
    setFiltered(labels.filter(l => l.toLowerCase().includes(term)))
  }, [search, labels])

  // ─── Build graph from API response, marking new nodes/edges ───
  const buildGraph = useCallback((data: Record<string, unknown>, markNew: boolean): { nodes: GraphNode[]; links: GraphLink[] } | null => {
    const rawNodes = data.nodes as Record<string, string>[] | undefined
    const rawEdges = data.edges as Record<string, string>[] | undefined
    if (!rawNodes) return null
    const now = Date.now()

    // First pass: build raw node list
    const nodeList = rawNodes.map((n) => {
      const id = n.id || n.label || String(Math.random())
      const isNew = markNew && !knownNodeIds.current.has(id)
      return {
        id,
        label: n.label || n.id || '?',
        entity_type: n.entity_type || '',
        description: n.description || '',
        val: 1, // placeholder, will be set by connection count
        color: getColor(n.entity_type || ''),
        isNew,
        birthTime: isNew ? now : undefined,
      }
    })

    const nodeIds = new Set(nodeList.map(n => n.id))

    // Build valid links
    const links: GraphLink[] = (rawEdges || [])
      .filter((e) => nodeIds.has(String(e.source)) && nodeIds.has(String(e.target)))
      .map((e) => {
        const key = `${e.source}->${e.target}`
        const isNew = markNew && !knownLinkKeys.current.has(key)
        return {
          source: String(e.source),
          target: String(e.target),
          label: e.label || e.description || '',
          isNew,
          birthTime: isNew ? now : undefined,
        }
      })

    // Count connections per node
    const connectionCount = new Map<string, number>()
    links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : l.source.id
      const tgt = typeof l.target === 'string' ? l.target : l.target.id
      connectionCount.set(src, (connectionCount.get(src) || 0) + 1)
      connectionCount.set(tgt, (connectionCount.get(tgt) || 0) + 1)
    })

    // Find max connections for scaling
    const maxConns = Math.max(1, ...connectionCount.values())

    // Scale node sizes: leaf = tiny, mega-hub = huge
    const nodes: GraphNode[] = nodeList.map(n => {
      const conns = connectionCount.get(n.id) || 0
      // Power curve for dramatic size difference
      const ratio = Math.pow(conns / maxConns, 0.45)
      // 0 connections = small dot, max connections = medium circle
      const val = conns === 0 ? 0.4 : 0.5 + ratio * 5.5
      return { ...n, val }
    })

    // Update known sets
    nodes.forEach(n => knownNodeIds.current.add(n.id))
    links.forEach(l => {
      const src = typeof l.source === 'string' ? l.source : l.source.id
      const tgt = typeof l.target === 'string' ? l.target : l.target.id
      knownLinkKeys.current.add(`${src}->${tgt}`)
    })

    return { nodes, links }
  }, [])

  // ─── Fetch graph (initial or refresh) ───
  const loadGraph = useCallback(async (root: string, isRefresh = false) => {
    if (!isRefresh) setGraphLoading(true)
    try {
      const res = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'graph', entity_name: root }) })
      const data = await res.json()
      const result = buildGraph(data, isRefresh)
      if (result) {
        if (isRefresh) {
          // Merge: keep positions of existing nodes
          setGraphData(prev => {
            if (!prev) return result
            const posMap = new Map<string, { x: number; y: number }>()
            prev.nodes.forEach(n => { if (n.x !== undefined && n.y !== undefined) posMap.set(n.id, { x: n.x, y: n.y }) })
            result.nodes.forEach(n => {
              const pos = posMap.get(n.id)
              if (pos) { n.x = pos.x; n.y = pos.y }
            })
            return result
          })
        } else {
          knownNodeIds.current.clear()
          knownLinkKeys.current.clear()
          result.nodes.forEach(n => { n.isNew = false; knownNodeIds.current.add(n.id) })
          result.links.forEach(l => {
            l.isNew = false
            const src = typeof l.source === 'string' ? l.source : l.source.id
            const tgt = typeof l.target === 'string' ? l.target : l.target.id
            knownLinkKeys.current.add(`${src}->${tgt}`)
          })
          setGraphData(result)
        }
      }
    } catch { if (!isRefresh) setGraphData({ nodes: [], links: [] }) }
    if (!isRefresh) setGraphLoading(false)
  }, [buildGraph])

  // Load graph on tab switch or root change
  useEffect(() => {
    if (tab === 'graph') {
      forcesConfigured.current = false
      loadGraph(graphRoot)
    }
  }, [tab, graphRoot, loadGraph])

  // Configure d3 forces once after initial graph load
  useEffect(() => {
    if (!fgRef.current || tab !== 'graph' || !graphData || forcesConfigured.current) return
    const fg = fgRef.current
    fg.d3Force('charge')?.strength(-1200).distanceMax(1500)
    fg.d3Force('link')?.distance(200)
    fg.d3Force('center')?.strength(0.008)
    fg.d3ReheatSimulation()
    forcesConfigured.current = true
  }, [tab, graphData])

  // ─── Polling for real-time updates ───
  useEffect(() => {
    if (tab !== 'graph') {
      if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null }
      return
    }
    pollTimer.current = setInterval(() => {
      loadGraph(graphRootRef.current, true)
      // Also refresh label count
      fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'labels' }) })
        .then(r => r.json()).then(d => { if (Array.isArray(d)) setLabels(d) }).catch(() => {})
    }, POLL_INTERVAL)
    return () => { if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null } }
  }, [tab, loadGraph])

  // Entity detail
  const loadEntityDetail = useCallback(async (name: string) => {
    setSelectedEntity(name)
    setEntityDetail(null)
    try {
      const res = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'query', query: name, mode: 'local', top_k: 5 }) })
      const data = await res.json()
      setEntityDetail(data.response || JSON.stringify(data, null, 2))
    } catch { setEntityDetail('Failed to load') }
  }, [])

  // API execute
  const executeApi = useCallback(async () => {
    setApiLoading(true)
    try {
      const isPost = apiBody.trim().length > 0
      const res = await fetch('/api/brain', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'raw', path: apiEndpoint, method: isPost ? 'POST' : 'GET', payload: isPost ? JSON.parse(apiBody) : undefined }),
      })
      const data = await res.json()
      setApiResponse(JSON.stringify(data, null, 2))
    } catch (err) { setApiResponse(String(err)) }
    setApiLoading(false)
  }, [apiEndpoint, apiBody])

  const entityCount = labels.length
  const isHealthy = health?.status === 'healthy'
  const version = health?.core_version || '?'
  const typeStats = graphData ? [...new Set(graphData.nodes.map(n => n.entity_type.toLowerCase()))].filter(Boolean).sort() : []

  // ─── Custom node renderer with hover highlight + new-entity blink ───
  const renderNode = useCallback((node: Record<string, unknown>, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const x = (node.x as number) || 0
    const y = (node.y as number) || 0
    const baseSize = ((node.val as number) || 2) * 1.5
    const color = (node.color as string) || 'var(--border-strong)'
    const nodeId = node.id as string
    const isNew = node.isNew as boolean
    const birthTime = node.birthTime as number | undefined
    const now = Date.now()
    const rgb = hexToRgb(color)

    // ── Highlight state: is something hovered? ──
    const isHovering = highlightNodes.current.size > 0
    const isHighlighted = highlightNodes.current.has(nodeId)
    const isTheHoveredNode = hoveredNode?.id === nodeId
    // Dim factor: 1 = full, 0.08 = nearly invisible
    const dimFactor = isHovering ? (isHighlighted ? 1 : 0.08) : 1

    // ── New entity blink effect ──
    let blinkAlpha = 1
    let blinkScale = 1
    if (isNew && birthTime) {
      const age = now - birthTime
      if (age < NEW_ENTITY_BLINK_DURATION) {
        const progress = age / NEW_ENTITY_BLINK_DURATION
        const freq = 12 - progress * 10
        blinkAlpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(age * freq * 0.01))
        blinkScale = 1 + 0.3 * (1 - progress) * (0.5 + 0.5 * Math.sin(age * 0.008))

        if (age < 2000) {
          const ringProgress = age / 2000
          const ringRadius = baseSize + 20 * ringProgress
          ctx.beginPath()
          ctx.arc(x, y, ringRadius, 0, 2 * Math.PI)
          ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.6 * (1 - ringProgress) * dimFactor})`
          ctx.lineWidth = 2 * (1 - ringProgress)
          ctx.stroke()
        }
        if (age > 400 && age < 2400) {
          const ringProgress = (age - 400) / 2000
          const ringRadius = baseSize + 20 * ringProgress
          ctx.beginPath()
          ctx.arc(x, y, ringRadius, 0, 2 * Math.PI)
          ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.3 * (1 - ringProgress) * dimFactor})`
          ctx.lineWidth = 1.5 * (1 - ringProgress)
          ctx.stroke()
        }
      }
    }

    const size = baseSize * blinkScale

    // ── Cursor proximity glow ──
    const cx = cursorRef.current.x
    const cy = cursorRef.current.y
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    const hoverRadius = 80
    const proximity = Math.max(0, 1 - dist / hoverRadius)

    if (proximity > 0 && dimFactor > 0.5) {
      const glowSize = size + 12 * proximity
      const gradient = ctx.createRadialGradient(x, y, size * 0.5, x, y, glowSize)
      gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.25 * proximity})`)
      gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
      ctx.beginPath()
      ctx.arc(x, y, glowSize, 0, 2 * Math.PI)
      ctx.fillStyle = gradient
      ctx.fill()
    }

    // ── Highlight glow for connected nodes ──
    if (isHighlighted && isHovering && !isTheHoveredNode) {
      const glowSize = size + 8
      const gradient = ctx.createRadialGradient(x, y, size * 0.3, x, y, glowSize)
      gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`)
      gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
      ctx.beginPath()
      ctx.arc(x, y, glowSize, 0, 2 * Math.PI)
      ctx.fillStyle = gradient
      ctx.fill()
    }

    // ── Hovered node: big outer glow ──
    if (isTheHoveredNode) {
      const glowSize = size + 16
      const gradient = ctx.createRadialGradient(x, y, size * 0.3, x, y, glowSize)
      gradient.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`)
      gradient.addColorStop(1, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0)`)
      ctx.beginPath()
      ctx.arc(x, y, glowSize, 0, 2 * Math.PI)
      ctx.fillStyle = gradient
      ctx.fill()
    }

    // ── Outer glow ──
    ctx.beginPath()
    ctx.arc(x, y, size + 2, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.08 * blinkAlpha * dimFactor
    ctx.fill()
    ctx.globalAlpha = 1

    // ── Node body ──
    ctx.beginPath()
    ctx.arc(x, y, size, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.globalAlpha = blinkAlpha * dimFactor
    ctx.fill()
    ctx.globalAlpha = 1

    // ── Ring ──
    ctx.beginPath()
    ctx.arc(x, y, size + 0.5, 0, 2 * Math.PI)
    ctx.strokeStyle = color
    ctx.globalAlpha = (isTheHoveredNode ? 1 : isHighlighted ? 0.7 : 0.4) * blinkAlpha * dimFactor
    ctx.lineWidth = isTheHoveredNode ? 2 : isHighlighted ? 1.2 : 0.5
    ctx.stroke()
    ctx.globalAlpha = 1

    // ── Label: always show for highlighted/hovered, otherwise zoom-dependent ──
    const showLabel = isTheHoveredNode || (isHighlighted && isHovering) || globalScale > 1.2 || (proximity > 0.3 && dimFactor > 0.5)
    if (showLabel) {
      const label = (node.label as string) || ''
      const fontSize = isTheHoveredNode ? Math.max(14 / globalScale, 4) : Math.max(11 / globalScale, 2.5)
      ctx.font = `${isTheHoveredNode ? '700' : '500'} ${fontSize}px 'Geist Sans', system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = isTheHoveredNode ? '#ffffff' : '#ecedee'
      ctx.globalAlpha = (isTheHoveredNode ? 1 : isHighlighted ? 0.9 : Math.min(Math.max(globalScale / 2, proximity), 0.85)) * blinkAlpha * dimFactor
      ctx.fillText(label, x, y + size + 3)
      ctx.globalAlpha = 1
    }
  }, [hoveredNode])

  // ─── Custom link renderer with highlight + new-edge shoot animation ───
  const renderLink = useCallback((link: Record<string, unknown>, ctx: CanvasRenderingContext2D) => {
    const source = link.source as Record<string, unknown> | undefined
    const target = link.target as Record<string, unknown> | undefined
    if (!source || !target) return

    const sx = (source.x as number) || 0
    const sy = (source.y as number) || 0
    const tx = (target.x as number) || 0
    const ty = (target.y as number) || 0
    const srcId = (source.id as string) || ''
    const tgtId = (target.id as string) || ''
    const isNew = link.isNew as boolean
    const birthTime = link.birthTime as number | undefined
    const now = Date.now()

    // Highlight state
    const isHovering = highlightNodes.current.size > 0
    const linkKey = `${srcId}->${tgtId}`
    const linkKeyReverse = `${tgtId}->${srcId}`
    const isLinkHighlighted = highlightLinks.current.has(linkKey) || highlightLinks.current.has(linkKeyReverse)
    const dimFactor = isHovering ? (isLinkHighlighted ? 1 : 0.04) : 1

    if (isNew && birthTime) {
      const age = now - birthTime
      if (age < NEW_EDGE_SHOOT_DURATION) {
        const progress = Math.min(age / NEW_EDGE_SHOOT_DURATION, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        const ex = sx + (tx - sx) * eased
        const ey = sy + (ty - sy) * eased
        const sourceColor = (source.color as string) || 'var(--accent)'
        const rgb = hexToRgb(sourceColor)

        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(ex, ey)
        ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.8 * (1 - progress * 0.5)})`
        ctx.lineWidth = 2.5 * (1 - progress * 0.6)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(ex, ey, 3 * (1 - progress * 0.7), 0, 2 * Math.PI)
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.9 * (1 - progress * 0.5)})`
        ctx.fill()

        ctx.beginPath()
        ctx.arc(ex, ey, 6 * (1 - progress * 0.5), 0, 2 * Math.PI)
        ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${0.2 * (1 - progress)})`
        ctx.fill()
        return
      }
    }

    // Highlighted link: bright + thick
    if (isLinkHighlighted && isHovering) {
      const sourceColor = (source.color as string) || 'var(--accent)'
      const rgb = hexToRgb(sourceColor)
      // Outer glow
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(tx, ty)
      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)`
      ctx.lineWidth = 4
      ctx.stroke()
      // Main line
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(tx, ty)
      ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.7)`
      ctx.lineWidth = 1.2
      ctx.stroke()
      return
    }

    // Normal edge
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(tx, ty)
    ctx.strokeStyle = `rgba(58, 63, 66, ${0.5 * dimFactor})`
    ctx.lineWidth = 0.4
    ctx.stroke()
  }, [hoveredNode]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Build highlight sets for a given node ───
  const buildHighlights = useCallback((nodeId: string) => {
    highlightNodes.current.clear()
    highlightLinks.current.clear()
    if (!graphData) return
    highlightNodes.current.add(nodeId)
    graphData.links.forEach(link => {
      const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id
      const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id
      if (src === nodeId || tgt === nodeId) {
        highlightNodes.current.add(src)
        highlightNodes.current.add(tgt)
        highlightLinks.current.add(`${src}->${tgt}`)
      }
    })
  }, [graphData])

  // ─── Hover: highlight connected nodes + links (skip if pinned) ───
  const handleGraphHover = useCallback((node: Record<string, unknown> | null) => {
    if (pinnedNode) return // pinned -- don't change highlights on hover
    if (node) {
      buildHighlights(node.id as string)
    } else {
      highlightNodes.current.clear()
      highlightLinks.current.clear()
    }
    setHoveredNode(node as unknown as GraphNode | null)
  }, [graphData, pinnedNode, buildHighlights])

  // ─── Click: pin/unpin node (toggle) ───
  const handleNodeClick = useCallback((node: Record<string, unknown>) => {
    const nodeId = node.id as string
    if (pinnedNode === nodeId) {
      // Unpin
      setPinnedNode(null)
      highlightNodes.current.clear()
      highlightLinks.current.clear()
      setHoveredNode(null)
    } else {
      // Pin this node
      setPinnedNode(nodeId)
      buildHighlights(nodeId)
      setHoveredNode(node as unknown as GraphNode)
    }
  }, [pinnedNode, buildHighlights])

  // ─── Click background: unpin ───
  const handleBackgroundClick = useCallback(() => {
    if (pinnedNode) {
      setPinnedNode(null)
      highlightNodes.current.clear()
      highlightLinks.current.clear()
      setHoveredNode(null)
    }
  }, [pinnedNode])

  // Track raw mouse position and convert to graph coords
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!fgRef.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    // Convert screen coords to graph coords
    const graphCoords = fgRef.current.screen2GraphCoords(screenX, screenY)
    if (graphCoords) {
      cursorRef.current = { x: graphCoords.x, y: graphCoords.y }
    }
  }, [])

  // Force continuous re-render for animations
  useEffect(() => {
    if (tab !== 'graph' || !graphData) return
    const hasAnimating = graphData.nodes.some(n => n.isNew && n.birthTime && Date.now() - n.birthTime < NEW_ENTITY_BLINK_DURATION) ||
      graphData.links.some(l => l.isNew && l.birthTime && Date.now() - (l.birthTime as number) < NEW_EDGE_SHOOT_DURATION)
    if (!hasAnimating) return

    let frame: number
    const tick = () => {
      if (fgRef.current) {
        // Trigger re-render by requesting the engine to repaint
        fgRef.current.refresh?.()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [tab, graphData])

  // Clean up isNew flags after animation completes
  useEffect(() => {
    if (!graphData) return
    const timer = setTimeout(() => {
      setGraphData(prev => {
        if (!prev) return prev
        const now = Date.now()
        let changed = false
        const nodes = prev.nodes.map(n => {
          if (n.isNew && n.birthTime && now - n.birthTime > NEW_ENTITY_BLINK_DURATION) {
            changed = true
            return { ...n, isNew: false }
          }
          return n
        })
        const links = prev.links.map(l => {
          if (l.isNew && l.birthTime && now - (l.birthTime as number) > NEW_EDGE_SHOOT_DURATION) {
            changed = true
            return { ...l, isNew: false }
          }
          return l
        })
        return changed ? { nodes, links } : prev
      })
    }, Math.max(NEW_ENTITY_BLINK_DURATION, NEW_EDGE_SHOOT_DURATION) + 500)
    return () => clearTimeout(timer)
  }, [graphData])

  return (
    <div className="h-full overflow-y-auto pb-28">
      {/* Header */}
      <motion.div initial="hidden" animate="show" variants={fadeUp} className="sticky top-0 z-20 glass px-5 py-3 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-[22px] font-bold text-text">Brain</h1>
            <p className="text-[13px] text-text-dim">LightRAG knowledge graph &middot; live</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="glass-card !rounded-lg px-2.5 py-1.5 text-center">
              <span className="font-bold text-accent-text font-mono">{entityCount}</span>
              <span className="text-text-dim text-[11px] ml-1.5">entities</span>
            </div>
            <div className="flex items-center gap-1.5 glass-card !rounded-lg px-2.5 py-1.5">
              <div className={`w-1.5 h-1.5 rounded-full ${isHealthy ? 'bg-green-400 shadow-[0_0_6px_rgba(0,230,118,0.5)]' : 'bg-red-400'}`} style={isHealthy ? { animation: 'pulse 3s ease-in-out infinite' } : {}} />
              <span className="text-[11px] font-mono text-text-dim">v{version}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1.5">
          {[
            { key: 'graph' as const, label: 'Graph View' },
            { key: 'browse' as const, label: 'Browse Entities' },
            { key: 'api' as const, label: 'API' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all duration-300 ${
                tab === t.key ? 'bg-accent/20 text-accent-text' : 'glass-btn text-text-dim hover:text-text'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── Graph View ── */}
      {tab === 'graph' && (
        <motion.div initial="hidden" animate="show" variants={fadeUp} className="px-4 pt-3">
          {/* Controls */}
          <div className="flex items-center gap-2 mb-3">
            <input
              type="text"
              value={graphRoot}
              onChange={e => setGraphRoot(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadGraph(graphRoot)}
              placeholder="Root entity..."
              className="flex-1 glass-input px-3 py-2 rounded-md text-[12px] font-mono text-text"
            />
            <button onClick={() => loadGraph(graphRoot)} className="glass-btn px-4 py-2 rounded-md text-[11px] font-medium text-accent-text">
              Load
            </button>
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="glass-btn px-3 py-2 rounded-md text-[11px] text-text-dim"
            >
              {isFullscreen ? 'Exit' : 'Expand'}
            </button>
          </div>

          {/* Type legend */}
          {typeStats.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {typeStats.slice(0, 12).map(t => (
                <div key={t} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getColor(t) }} />
                  <span className="text-[9px] font-mono text-text-dim uppercase tracking-wider">{t}</span>
                </div>
              ))}
            </div>
          )}

          {/* Graph */}
          <div
            className={`glass-card !rounded-lg overflow-hidden relative transition-all duration-500 ${isFullscreen ? 'fixed inset-0 z-50 !rounded-none' : ''}`}
            style={isFullscreen ? {} : { height: 'calc(100vh - 260px)' }}
            onMouseMove={handleCanvasMouseMove}
          >
            {graphLoading ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              </div>
            ) : graphData && graphData.nodes.length > 0 ? (
              <>
                {/* Stats overlay */}
                <div className="absolute top-3 right-3 z-10 glass-card !rounded-md px-2.5 py-1.5">
                  <span className="text-[10px] font-mono text-text-dim">{graphData.nodes.length} nodes | {graphData.links.length} edges</span>
                  <span className="text-[9px] font-mono text-green-400/60 ml-2">live</span>
                </div>

                {/* Hovered/pinned node tooltip */}
                {hoveredNode && (
                  <div className="absolute bottom-3 left-3 z-10 glass-card !rounded-md px-3 py-2 max-w-[340px]">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: hoveredNode.color }} />
                      <span className="text-[11px] font-bold text-accent-text">{hoveredNode.label}</span>
                      <span className="text-[9px] font-mono text-text-dim uppercase">{hoveredNode.entity_type}</span>
                      {pinnedNode === hoveredNode.id && (
                        <span className="text-[8px] font-mono text-accent-text bg-accent/20 px-1.5 py-0.5 rounded">pinned</span>
                      )}
                    </div>
                    {hoveredNode.description && (
                      <p className="text-[10px] text-text-dim leading-relaxed line-clamp-2">{hoveredNode.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-border/30">
                      <span className="text-[9px] font-mono text-text-dim">
                        {highlightNodes.current.size > 1 ? `${highlightNodes.current.size - 1} connections` : 'no connections'}
                      </span>
                      {pinnedNode === hoveredNode.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setGraphRoot(hoveredNode.label); setPinnedNode(null); highlightNodes.current.clear(); highlightLinks.current.clear(); setHoveredNode(null) }}
                          className="text-[9px] font-mono text-accent-text hover:underline"
                        >
                          focus graph here
                        </button>
                      )}
                      {pinnedNode === hoveredNode.id && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setTab('browse'); loadEntityDetail(hoveredNode.label) }}
                          className="text-[9px] font-mono text-accent-text hover:underline"
                        >
                          browse detail
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {isFullscreen && (
                  <button onClick={() => setIsFullscreen(false)} className="absolute top-3 left-3 z-10 glass-btn px-3 py-1.5 rounded-md text-[11px] text-text-dim">
                    Close
                  </button>
                )}

                <ForceGraph2D
                  ref={fgRef}
                  graphData={graphData}
                  width={isFullscreen ? (typeof window !== 'undefined' ? window.innerWidth : 1440) : (typeof window !== 'undefined' ? window.innerWidth - 300 : 1140)}
                  height={isFullscreen ? (typeof window !== 'undefined' ? window.innerHeight : 900) : (typeof window !== 'undefined' ? window.innerHeight - 260 : 640)}
                  backgroundColor="var(--bg-chrome)"
                  nodeRelSize={1}
                  nodeColor={(node: Record<string, unknown>) => (node.color as string) || 'var(--border-strong)'}
                  nodeCanvasObject={renderNode}
                  nodePointerAreaPaint={(node: Record<string, unknown>, color: string, ctx: CanvasRenderingContext2D) => {
                    const x = (node.x as number) || 0
                    const y = (node.y as number) || 0
                    const size = ((node.val as number) || 2) * 1.5 + 2
                    ctx.beginPath()
                    ctx.arc(x, y, size, 0, 2 * Math.PI)
                    ctx.fillStyle = color
                    ctx.fill()
                  }}
                  linkCanvasObject={renderLink}
                  linkDirectionalParticles={2}
                  linkDirectionalParticleWidth={1.2}
                  linkDirectionalParticleColor={() => 'var(--accent)'}
                  linkDirectionalParticleSpeed={0.004}
                  d3AlphaDecay={0.02}
                  d3VelocityDecay={0.3}
                  onEngineStop={() => {}}
                  onNodeHover={handleGraphHover}
                  onNodeClick={handleNodeClick}
                  onBackgroundClick={handleBackgroundClick}
                  cooldownTicks={200}
                  warmupTicks={100}
                />
              </>
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-[13px] text-text-dim">Enter an entity name and click Load</p>
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Browse Entities ── */}
      {tab === 'browse' && (
        <motion.div initial="hidden" animate="show" variants={fadeUp} className="px-4 pt-3">
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter entities..."
              className="flex-1 glass-input px-3 py-2 rounded-md text-[12px] font-mono text-text"
            />
            <button
              onClick={() => {
                fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'labels' }) })
                  .then(r => r.json()).then(d => { if (Array.isArray(d)) { setLabels(d); setFiltered(d) } })
              }}
              className="glass-btn px-3 py-2 rounded-md text-[11px] text-accent-text"
            >
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-[1fr_1.5fr] gap-4">
            {/* Entity list */}
            <div className="glass-card !rounded-lg p-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <span className="text-[10px] font-mono text-text-dim">{filtered.length} entities</span>
              </div>
              <div className="max-h-[calc(100vh-300px)] overflow-auto">
                {filtered.map((label, i) => (
                  <motion.button
                    key={label}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.008, 0.4), duration: 0.2 }}
                    onClick={() => loadEntityDetail(label)}
                    className={`flex items-center justify-between w-full px-3 py-2 text-left border-b border-border/50 transition-all duration-200 ${
                      selectedEntity === label ? 'bg-accent/15' : 'hover:bg-bg-hover/30'
                    }`}
                  >
                    <span className={`text-[12px] font-medium ${selectedEntity === label ? 'text-accent-text' : 'text-text-secondary'}`}>
                      {label}
                    </span>
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Detail panel */}
            <div className="glass-card !rounded-lg p-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <span className="text-[10px] font-mono text-text-dim">detail</span>
              </div>
              <AnimatePresence mode="wait">
                {selectedEntity ? (
                  <motion.div
                    key={selectedEntity}
                    initial={{ opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.25 }}
                    className="p-4"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[15px] font-bold text-accent-text">{selectedEntity}</h3>
                      <button onClick={() => { setGraphRoot(selectedEntity); setTab('graph') }} className="text-[10px] text-accent-text glass-btn px-2 py-1 rounded-md">
                        View in graph
                      </button>
                    </div>
                    {entityDetail ? (
                      <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">{entityDetail}</p>
                    ) : (
                      <div className="py-8 flex justify-center">
                        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-16 text-center">
                    <p className="text-[12px] text-text-dim">Select an entity</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}

      {/* ── API Explorer ── */}
      {tab === 'api' && (
        <motion.div initial="hidden" animate="show" variants={fadeUp} className="px-4 pt-3">
          <div className="grid grid-cols-[260px_1fr] gap-4">
            {/* Endpoint list */}
            <div className="glass-card !rounded-lg p-0 overflow-hidden">
              <div className="px-3 py-2 border-b border-border">
                <span className="text-[10px] font-mono text-text-dim">endpoints</span>
              </div>
              <div className="max-h-[calc(100vh-300px)] overflow-auto">
                {[
                  { cat: 'Entities', items: [
                    { m: 'POST', p: '/graph/entity/create', d: 'Create entity' },
                    { m: 'POST', p: '/graph/entity/edit', d: 'Edit entity' },
                    { m: 'GET', p: '/graph/entity/exists?name=', d: 'Check exists' },
                    { m: 'GET', p: '/graph/label/list', d: 'List all' },
                    { m: 'GET', p: '/graph/label/search?q=', d: 'Search' },
                    { m: 'GET', p: '/graph/label/popular', d: 'Most connected' },
                  ]},
                  { cat: 'Relations', items: [
                    { m: 'POST', p: '/graph/relation/create', d: 'Create relation' },
                    { m: 'POST', p: '/graph/relation/edit', d: 'Edit relation' },
                  ]},
                  { cat: 'Graph', items: [
                    { m: 'GET', p: '/graphs?label=&max_depth=3', d: 'Get subgraph' },
                  ]},
                  { cat: 'Query', items: [
                    { m: 'POST', p: '/query/data', d: 'Query graph' },
                  ]},
                  { cat: 'System', items: [
                    { m: 'GET', p: '/health', d: 'Health check' },
                  ]},
                ].map(cat => (
                  <div key={cat.cat}>
                    <div className="px-3 py-1.5 bg-bg-surface/50">
                      <span className="text-[9px] font-mono text-text-dim uppercase tracking-wider">{cat.cat}</span>
                    </div>
                    {cat.items.map(ep => (
                      <button
                        key={ep.p}
                        onClick={() => { setApiEndpoint(ep.p); setApiBody(ep.m === 'POST' ? '{\n  \n}' : ''); setApiResponse('') }}
                        className={`flex items-center gap-2 w-full px-3 py-2 text-left border-b border-border/30 transition-all hover:bg-bg-hover/30 ${apiEndpoint === ep.p ? 'bg-accent/10' : ''}`}
                      >
                        <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded ${ep.m === 'GET' ? 'bg-accent/20 text-accent-text' : 'bg-blue/20 text-blue'}`}>
                          {ep.m}
                        </span>
                        <span className="text-[10px] font-mono text-text-secondary truncate">{ep.p}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* Request + Response */}
            <div className="space-y-3">
              {apiEndpoint ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className="glass-card !rounded-md px-2 py-1 text-[10px] font-mono text-accent-text">{apiEndpoint.includes('?') || !apiBody.trim() ? 'GET' : 'POST'}</span>
                    <input
                      value={apiEndpoint}
                      onChange={e => setApiEndpoint(e.target.value)}
                      className="flex-1 glass-input px-3 py-2 rounded-md text-[12px] font-mono text-text"
                    />
                    <button onClick={executeApi} disabled={apiLoading} className="glass-btn px-4 py-2 rounded-md text-[11px] font-medium text-accent-text disabled:opacity-30">
                      {apiLoading ? 'Running...' : 'Execute'}
                    </button>
                  </div>

                  {apiBody !== '' && (
                    <textarea
                      value={apiBody}
                      onChange={e => setApiBody(e.target.value)}
                      rows={6}
                      placeholder='{"query": "...", "mode": "local"}'
                      className="w-full glass-input px-3 py-2 rounded-md text-[11px] font-mono text-text resize-none"
                    />
                  )}

                  {apiResponse && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-mono text-text-dim">response</span>
                        <button onClick={() => navigator.clipboard.writeText(apiResponse)} className="text-[10px] text-accent-text">copy</button>
                      </div>
                      <pre className="glass-card !rounded-lg p-4 text-[11px] font-mono text-text-secondary leading-relaxed max-h-[400px] overflow-auto whitespace-pre-wrap">
                        {apiResponse}
                      </pre>
                    </motion.div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center" style={{ height: 300 }}>
                  <p className="text-[12px] text-text-dim">Select an endpoint</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
