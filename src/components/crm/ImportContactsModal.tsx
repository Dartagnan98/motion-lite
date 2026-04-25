'use client'

import { useEffect, useMemo, useState } from 'react'
import { crmFetch } from '@/lib/crm-browser'

const mono = { fontFamily: 'var(--font-mono)' } as const

const CONTACT_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'skip',    label: '— Skip this column —' },
  { key: 'name',    label: 'Name' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name',  label: 'Last name' },
  { key: 'email',   label: 'Email' },
  { key: 'phone',   label: 'Phone' },
  { key: 'company', label: 'Company' },
  { key: 'tags',    label: 'Tags (comma-separated)' },
]

interface ListOption { id: number; name: string }

interface ImportResult {
  created: number
  skipped: number
  added_to_list: number
  added_tags: number
  errors: Array<{ row: number; reason: string }>
}

/**
 * CSV contact import modal. Single-surface integration that connects:
 *  - Contacts (create via /api/crm/contacts/import)
 *  - Lists   (optionally add every imported contact to a list)
 *  - Tags    (optionally apply a set of tags to every imported contact)
 *  - Workflows (contact_created trigger fires downstream)
 *
 * Flow: paste CSV → parse → map columns → optional list + tags → import.
 */
export function ImportContactsModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean
  onClose: () => void
  onImported?: (result: ImportResult) => void
}) {
  const [csv, setCsv] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [preview, setPreview] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<number, string>>({})
  const [tagsInput, setTagsInput] = useState('')
  const [lists, setLists] = useState<ListOption[]>([])
  const [selectedListId, setSelectedListId] = useState<number | ''>('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  useEffect(() => {
    if (!open) return
    setCsv('')
    setHeaders([])
    setPreview([])
    setMapping({})
    setTagsInput('')
    setSelectedListId('')
    setError(null)
    setResult(null)
    crmFetch<ListOption[]>('/api/crm/lists').then(setLists).catch(() => setLists([]))
  }, [open])

  function parseCsv(raw: string) {
    const rows = parseCSVText(raw)
    if (rows.length === 0) {
      setHeaders([])
      setPreview([])
      setMapping({})
      return
    }
    const hdr = rows[0]
    setHeaders(hdr)
    setPreview(rows.slice(1, 6))
    const autoMap: Record<number, string> = {}
    hdr.forEach((h, idx) => {
      const lower = h.toLowerCase().trim()
      if (['email', 'e-mail', 'email address'].includes(lower)) autoMap[idx] = 'email'
      else if (['name', 'full name', 'contact name'].includes(lower)) autoMap[idx] = 'name'
      else if (['first', 'first name', 'firstname'].includes(lower)) autoMap[idx] = 'first_name'
      else if (['last', 'last name', 'lastname', 'surname'].includes(lower)) autoMap[idx] = 'last_name'
      else if (['phone', 'phone number', 'mobile', 'cell'].includes(lower)) autoMap[idx] = 'phone'
      else if (['company', 'organization', 'org'].includes(lower)) autoMap[idx] = 'company'
      else if (['tags', 'tag'].includes(lower)) autoMap[idx] = 'tags'
      else autoMap[idx] = 'skip'
    })
    setMapping(autoMap)
  }

  function handleCsvPaste(text: string) {
    setCsv(text)
    parseCsv(text)
  }

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    handleCsvPaste(text)
  }

  const mappedRows = useMemo(() => {
    if (!headers.length) return []
    const rows = parseCSVText(csv)
    if (rows.length < 2) return []
    return rows.slice(1).map((cells) => {
      const row: { name?: string; email?: string; phone?: string; company?: string; tags?: string[] } = {}
      let first = ''
      let last = ''
      headers.forEach((_, idx) => {
        const target = mapping[idx]
        const raw = (cells[idx] ?? '').trim()
        if (!raw || !target || target === 'skip') return
        if (target === 'name')      row.name = raw
        else if (target === 'first_name') first = raw
        else if (target === 'last_name')  last = raw
        else if (target === 'email')  row.email = raw
        else if (target === 'phone')  row.phone = raw
        else if (target === 'company') row.company = raw
        else if (target === 'tags') row.tags = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      })
      if (!row.name && (first || last)) row.name = [first, last].filter(Boolean).join(' ')
      return row
    }).filter((r) => r.name || r.email || r.phone || r.company)
  }, [csv, headers, mapping])

  const globalTags = useMemo(
    () => tagsInput.split(/[,;]/).map((s) => s.trim()).filter(Boolean),
    [tagsInput],
  )

  async function doImport() {
    if (!mappedRows.length) { setError('No valid rows to import after mapping.'); return }
    setImporting(true)
    setError(null)
    try {
      const res = await crmFetch<ImportResult>('/api/crm/contacts/import', {
        method: 'POST',
        body: JSON.stringify({
          rows: mappedRows,
          tags: globalTags.length ? globalTags : undefined,
          list_id: typeof selectedListId === 'number' ? selectedListId : undefined,
        }),
      })
      setResult(res)
      onImported?.(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 70,
        background: 'color-mix(in oklab, black 55%, transparent)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '48px 24px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 760,
          borderRadius: 16,
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          boxShadow: '0 30px 60px rgba(0,0,0,0.45)',
          display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ padding: '20px 24px 14px' }}>
          <div style={{ fontSize: 11, ...mono, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Import
          </div>
          <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', marginTop: 2 }}>
            Import contacts from CSV
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.55 }}>
            Paste a CSV or upload a file. Map each column to a contact field, optionally drop everyone into a list, and tag the batch.
          </div>
        </header>

        <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {result ? (
            <ImportSummary result={result} onClose={onClose} />
          ) : (
            <>
              <Section label="1 · Paste your CSV or upload a file">
                <textarea
                  value={csv}
                  onChange={(e) => handleCsvPaste(e.target.value)}
                  placeholder="name,email,phone,company&#10;Jane Smith,jane@example.com,+16045550100,Acme"
                  rows={6}
                  style={fieldStyle}
                />
                <div style={{ marginTop: 8 }}>
                  <input type="file" accept=".csv,text/csv" onChange={handleFileUpload} style={{ fontSize: 12, color: 'var(--text-dim)' }} />
                </div>
              </Section>

              {headers.length > 0 && (
                <Section label={`2 · Map columns (${headers.length} detected, ${mappedRows.length} valid rows)`}>
                  <div style={{
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                  }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--bg-surface)' }}>
                          <th style={thStyle}>CSV column</th>
                          <th style={thStyle}>Sample</th>
                          <th style={{ ...thStyle, width: 180 }}>Maps to</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headers.map((header, idx) => (
                          <tr key={idx} style={{ borderTop: '1px solid var(--border)' }}>
                            <td style={tdStyle}><code style={mono}>{header}</code></td>
                            <td style={{ ...tdStyle, color: 'var(--text-dim)' }}>
                              {preview[0]?.[idx] ?? '—'}
                            </td>
                            <td style={tdStyle}>
                              <select
                                value={mapping[idx] || 'skip'}
                                onChange={(e) => setMapping((prev) => ({ ...prev, [idx]: e.target.value }))}
                                style={selectStyle}
                              >
                                {CONTACT_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>{f.label}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}

              {headers.length > 0 && (
                <Section label="3 · Apply to the whole batch (optional)">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Sublabel label="Add every contact to list">
                      <select
                        value={selectedListId}
                        onChange={(e) => setSelectedListId(e.target.value ? Number(e.target.value) : '')}
                        style={fieldStyle}
                      >
                        <option value="">— None —</option>
                        {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    </Sublabel>
                    <Sublabel label="Apply tags (comma-separated)">
                      <input
                        value={tagsInput}
                        onChange={(e) => setTagsInput(e.target.value)}
                        placeholder="vip, q2_campaign"
                        style={fieldStyle}
                      />
                    </Sublabel>
                  </div>
                </Section>
              )}

              {error && (
                <div style={{
                  padding: '9px 12px', borderRadius: 8, fontSize: 13,
                  background: 'color-mix(in oklab, var(--status-overdue) 12%, transparent)',
                  color: 'var(--status-overdue)',
                  border: '1px solid color-mix(in oklab, var(--status-overdue) 22%, transparent)',
                }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {!result && (
          <footer style={{
            padding: '14px 22px 16px',
            borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {mappedRows.length} rows ready · {globalTags.length} tags to apply
              {selectedListId ? ' · list selected' : ''}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onClose} disabled={importing} style={ghostBtn}>Cancel</button>
              <button
                onClick={() => doImport().catch(() => {})}
                disabled={importing || mappedRows.length === 0}
                style={primaryBtn(importing || mappedRows.length === 0)}
              >
                {importing ? 'Importing…' : `Import ${mappedRows.length} contact${mappedRows.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

function ImportSummary({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
      }}>
        <SummaryTile label="Created" value={result.created} tone="good" />
        <SummaryTile label="Skipped" value={result.skipped} />
        <SummaryTile label="Added to list" value={result.added_to_list} />
        <SummaryTile label="Tags applied" value={result.added_tags} />
      </div>

      {result.errors.length > 0 && (
        <div>
          <div style={{ fontSize: 11, ...mono, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
            First {result.errors.length} issues
          </div>
          <div style={{
            borderRadius: 10, border: '1px solid var(--border)',
            background: 'var(--bg-surface)',
            maxHeight: 200, overflowY: 'auto',
          }}>
            {result.errors.map((err, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 12px', fontSize: 12,
                  borderBottom: i < result.errors.length - 1 ? '1px solid var(--border)' : 'none',
                  color: 'var(--text-secondary)',
                }}
              >
                Row {err.row}: {err.reason}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button onClick={onClose} style={primaryBtn(false)}>Done</button>
      </div>
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone?: 'good' }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 10,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 2,
    }}>
      <span style={{ fontSize: 10, ...mono, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span style={{
        fontSize: 20, fontWeight: 600,
        color: tone === 'good' ? 'var(--status-completed)' : 'var(--text)',
        letterSpacing: '-0.01em',
      }}>
        {value}
      </span>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, ...mono, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Sublabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
      {children}
    </label>
  )
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 8,
  background: 'var(--bg-field)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  fontSize: 13,
  fontFamily: 'inherit',
  resize: 'vertical',
}

const selectStyle: React.CSSProperties = { ...fieldStyle, fontSize: 12, padding: '6px 10px' }

const thStyle: React.CSSProperties = {
  padding: '8px 12px',
  textAlign: 'left',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  fontWeight: 600,
}

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 12.5,
  color: 'var(--text)',
}

const ghostBtn: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8,
  background: 'transparent', color: 'var(--text-secondary)',
  border: '1px solid var(--border)',
  fontSize: 13, cursor: 'pointer',
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 14px', borderRadius: 8,
    background: 'var(--accent)', color: 'var(--accent-fg)',
    border: 'none', fontSize: 13, fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  }
}

// ─── CSV parser ───────────────────────────────────────────────────────
// Minimal RFC-4180 parser. Handles quoted fields with embedded commas and
// newlines; good enough for most CSV exports from Gmail/HubSpot/Mailchimp.

function parseCSVText(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i += 1; continue }
      if (ch === '"') { inQuotes = false; continue }
      cur += ch
    } else {
      if (ch === '"') { inQuotes = true; continue }
      if (ch === ',') { row.push(cur); cur = ''; continue }
      if (ch === '\r') continue
      if (ch === '\n') {
        row.push(cur); cur = ''
        if (row.some((c) => c.length > 0)) out.push(row)
        row = []
        continue
      }
      cur += ch
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur)
    if (row.some((c) => c.length > 0)) out.push(row)
  }
  return out
}
