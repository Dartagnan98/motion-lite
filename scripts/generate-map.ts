#!/usr/bin/env npx tsx
/**
 * generate-map.ts
 *
 * Scans the codebase and regenerates src/.map/*.md files.
 * Run: npx tsx scripts/generate-map.ts
 *
 * This generates the data-driven files (schema.md, api-routes.md, pages.md).
 * The conceptual files (workspaces.md, messages.md, agents.md, INDEX.md) are maintained manually.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, relative, resolve } from 'path'

const ROOT = resolve(__dirname, '../src')
const MAP_DIR = join(ROOT, '.map')

// ─── Helpers ───

function walkDir(dir: string, ext: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...walkDir(full, ext))
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      results.push(full)
    }
  }
  return results
}

// ─── API Routes Scanner ───

function scanApiRoutes(): string {
  const apiDir = join(ROOT, 'app/api')
  const routeFiles = walkDir(apiDir, 'route.ts')

  interface RouteInfo {
    path: string
    methods: string[]
    hasAuth: boolean
    hasWorkspaceScope: boolean
  }

  const routes: RouteInfo[] = []

  for (const file of routeFiles) {
    const content = readFileSync(file, 'utf-8')
    const relPath = relative(join(ROOT, 'app'), file).replace(/\/route\.ts$/, '')
    const apiPath = '/' + relPath

    const methods: string[] = []
    if (content.includes('export async function GET') || content.includes('export function GET')) methods.push('GET')
    if (content.includes('export async function POST') || content.includes('export function POST')) methods.push('POST')
    if (content.includes('export async function PUT') || content.includes('export function PUT')) methods.push('PUT')
    if (content.includes('export async function PATCH') || content.includes('export function PATCH')) methods.push('PATCH')
    if (content.includes('export async function DELETE') || content.includes('export function DELETE')) methods.push('DELETE')

    const hasAuth = content.includes('requireAuth')
    const hasWorkspaceScope = content.includes('x-workspace-id') || content.includes('X-Workspace-Id')

    routes.push({ path: apiPath, methods, hasAuth, hasWorkspaceScope })
  }

  routes.sort((a, b) => a.path.localeCompare(b.path))

  // Group by first two path segments
  const groups = new Map<string, RouteInfo[]>()
  for (const route of routes) {
    const parts = route.path.split('/')
    const group = parts.slice(0, 3).join('/')
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group)!.push(route)
  }

  let md = '# API Routes\n\n'
  md += '**Auto-generated** by `scripts/generate-map.ts`\n\n'
  md += `**Auth legend:** \`auth\` = requireAuth(), \`none\` = no auth, \`ws\` = workspace-scoped\n\n`

  let totalRoutes = 0
  let authRoutes = 0

  for (const [group, groupRoutes] of groups) {
    md += `## ${group}/\n`
    md += '| Route | Methods | Auth |\n'
    md += '|-------|---------|------|\n'
    for (const r of groupRoutes) {
      const authStr = r.hasAuth ? (r.hasWorkspaceScope ? 'auth, ws' : 'auth') : 'none'
      md += `| ${r.path} | ${r.methods.join(',')} | ${authStr} |\n`
      totalRoutes++
      if (r.hasAuth) authRoutes++
    }
    md += '\n'
  }

  md += `## Summary\n\n`
  md += `- **Total routes:** ${totalRoutes}\n`
  md += `- **With requireAuth:** ${authRoutes}\n`
  md += `- **No auth:** ${totalRoutes - authRoutes}\n`

  return md
}

// ─── Pages Scanner ───

function scanPages(): string {
  const appDir = join(ROOT, 'app')
  const pageFiles = walkDir(appDir, 'page.tsx')

  interface PageInfo {
    path: string
    isClient: boolean
  }

  const pages: PageInfo[] = []

  for (const file of pageFiles) {
    // Skip api directory
    if (file.includes('/api/')) continue

    const content = readFileSync(file, 'utf-8')
    const relPath = relative(appDir, file).replace(/\/page\.tsx$/, '') || '/'
    const routePath = '/' + relPath.replace(/\\/g, '/')

    const isClient = content.includes("'use client'") || content.includes('"use client"')

    pages.push({ path: routePath === '//' ? '/' : routePath, isClient })
  }

  pages.sort((a, b) => a.path.localeCompare(b.path))

  let md = '# Pages\n\n'
  md += '**Auto-generated** by `scripts/generate-map.ts`\n\n'
  md += '| Path | Type |\n'
  md += '|------|------|\n'
  for (const p of pages) {
    md += `| ${p.path} | ${p.isClient ? 'Client' : 'Server'} |\n`
  }

  // Scan layouts
  const layoutFiles = walkDir(appDir, 'layout.tsx')
  md += '\n## Layouts\n\n'
  md += '| Path | File |\n'
  md += '|------|------|\n'
  for (const file of layoutFiles) {
    const relPath = relative(appDir, file)
    md += `| ${relPath} | layout.tsx |\n`
  }

  // Count components
  const componentsDir = join(ROOT, 'components')
  const msgComponentsDir = join(ROOT, 'app/messages/components')
  const componentFiles = [
    ...walkDir(componentsDir, '.tsx'),
    ...walkDir(msgComponentsDir, '.tsx'),
  ]

  md += `\n## Component Count\n\n`
  md += `- **src/components/**: ${walkDir(componentsDir, '.tsx').length} files\n`
  md += `- **src/app/messages/components/**: ${walkDir(msgComponentsDir, '.tsx').length} files\n`
  md += `- **Total:** ${componentFiles.length} component files\n`

  return md
}

// ─── Schema Scanner ───

function scanSchema(): string {
  const dbFile = join(ROOT, 'lib/db.ts')
  if (!existsSync(dbFile)) return '# Schema\n\ndb.ts not found'

  const content = readFileSync(dbFile, 'utf-8')

  // Extract CREATE TABLE statements
  const createTableRegex = /CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\n\s*\)/g
  const tables: { name: string; columns: string }[] = []
  let match
  while ((match = createTableRegex.exec(content)) !== null) {
    tables.push({ name: match[1], columns: match[2].trim() })
  }

  // Extract ALTER TABLE migrations
  const alterRegex = /ALTER TABLE (\w+) ADD COLUMN (\w+)/g
  const alterations: { table: string; column: string }[] = []
  while ((match = alterRegex.exec(content)) !== null) {
    alterations.push({ table: match[1], column: match[2] })
  }

  // Extract CREATE INDEX
  const indexRegex = /CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)\(([^)]+)\)/g
  const indexes: { name: string; table: string; columns: string }[] = []
  while ((match = indexRegex.exec(content)) !== null) {
    indexes.push({ name: match[1], table: match[2], columns: match[3] })
  }

  // Extract exported functions
  const exportRegex = /export (?:async )?function (\w+)/g
  const exports: string[] = []
  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1])
  }

  let md = '# Schema\n\n'
  md += '**Auto-generated** by `scripts/generate-map.ts`\n\n'

  md += `## Tables (${tables.length})\n\n`
  for (const t of tables) {
    md += `### ${t.name}\n\`\`\`sql\n${t.columns}\n\`\`\`\n\n`
  }

  md += `## ALTER TABLE Migrations (${alterations.length})\n\n`
  const alterByTable = new Map<string, string[]>()
  for (const a of alterations) {
    if (!alterByTable.has(a.table)) alterByTable.set(a.table, [])
    alterByTable.get(a.table)!.push(a.column)
  }
  for (const [table, cols] of alterByTable) {
    md += `**${table}:** ${cols.join(', ')}\n\n`
  }

  md += `## Indexes (${indexes.length})\n\n`
  for (const idx of indexes) {
    md += `- \`${idx.name}\` ON ${idx.table}(${idx.columns})\n`
  }

  md += `\n## Exported Functions (${exports.length})\n\n`
  md += exports.map(e => `- ${e}`).join('\n')

  return md
}

// ─── Main ───

function main() {
  console.log('Generating .map files...')

  const apiRoutesMd = scanApiRoutes()
  writeFileSync(join(MAP_DIR, 'api-routes.md'), apiRoutesMd)
  console.log('  api-routes.md written')

  const pagesMd = scanPages()
  writeFileSync(join(MAP_DIR, 'pages.md'), pagesMd)
  console.log('  pages.md written')

  const schemaMd = scanSchema()
  writeFileSync(join(MAP_DIR, 'schema.md'), schemaMd)
  console.log('  schema.md written')

  console.log('Done. Manual files (INDEX.md, workspaces.md, messages.md, agents.md) are unchanged.')
}

main()
