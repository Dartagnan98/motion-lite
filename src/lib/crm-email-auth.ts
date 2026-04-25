import crypto from 'node:crypto'
import dns from 'node:dns/promises'

/**
 * Email sender authentication — generate & verify SPF/DKIM/DMARC DNS
 * records for an outbound sending domain.
 *
 * Design notes:
 *
 * - DKIM key generation produces a 2048-bit RSA keypair in SPKI (pub)
 *   and PKCS8 (priv) PEM. The TXT record publishes the Base64 of the
 *   DER-encoded SubjectPublicKeyInfo (no PEM header/footer) per
 *   RFC 6376. We also support DKIM records that split across multiple
 *   quoted strings (DNS 255-char limit) by concatenating on lookup.
 *
 * - The "sending domain" is the domain you send from — e.g.
 *   `mail.example.com`. SPF is published on that subdomain, DKIM is
 *   published on `<selector>._domainkey.<sending-domain>`, and DMARC
 *   is published on `_dmarc.<root-domain>` (the organizational
 *   domain). We derive the root domain naively by taking the last
 *   two labels — good enough for `mail.example.com` → `example.com`.
 *   For country-code SLDs (`co.uk`) operators should set DMARC by
 *   hand; the record value is the same.
 *
 * - Verification uses `node:dns/promises.resolveTxt` which returns
 *   `string[][]`. Each outer element is a TXT record; each inner
 *   array is the chunks of a single record. We join chunks, trim,
 *   and test each candidate for the expected prefix.
 */

export const DEFAULT_SPF_INCLUDE = process.env.CRM_SPF_INCLUDE || 'amazonses.com'
export const DEFAULT_DMARC_RUA = process.env.CRM_DMARC_RUA || 'dmarc@example.com'

export interface DkimKeypair {
  selector: string
  public_key_pem: string
  private_key_pem: string
  /** The `p=` value that goes into the DNS TXT record. */
  public_key_b64: string
}

/**
 * Generate a fresh DKIM selector + 2048-bit RSA keypair. The selector
 * is time-based (`ctrlmYYMMDD` + 4-char random suffix) so re-keying on
 * the same domain doesn't collide with the previous record.
 */
export function generateDkimKeypair(prefix = 'ctrlm'): DkimKeypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  const b64 = pemBodyToBase64(publicKey)
  const date = new Date()
  const yy = String(date.getUTCFullYear()).slice(2)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const rand = crypto.randomBytes(2).toString('hex')
  const selector = `${prefix}${yy}${mm}${dd}${rand}`
  return {
    selector,
    public_key_pem: publicKey,
    private_key_pem: privateKey,
    public_key_b64: b64,
  }
}

/** Strip PEM header/footer + newlines, returning just the base64 body. */
export function pemBodyToBase64(pem: string): string {
  return pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
}

export function rootDomainOf(domain: string): string {
  const labels = domain.trim().toLowerCase().replace(/\.+$/, '').split('.')
  if (labels.length <= 2) return labels.join('.')
  return labels.slice(-2).join('.')
}

export interface DnsRecordSpec {
  kind: 'spf' | 'dkim' | 'dmarc'
  name: string
  type: 'TXT'
  value: string
}

export function buildSpfRecord(sendingDomain: string, spfInclude = DEFAULT_SPF_INCLUDE): DnsRecordSpec {
  return {
    kind: 'spf',
    name: sendingDomain,
    type: 'TXT',
    value: `v=spf1 include:${spfInclude} ~all`,
  }
}

export function buildDkimRecord(sendingDomain: string, selector: string, publicKeyB64: string): DnsRecordSpec {
  return {
    kind: 'dkim',
    name: `${selector}._domainkey.${sendingDomain}`,
    type: 'TXT',
    value: `v=DKIM1; k=rsa; p=${publicKeyB64}`,
  }
}

export function buildDmarcRecord(sendingDomain: string, rua = DEFAULT_DMARC_RUA): DnsRecordSpec {
  const root = rootDomainOf(sendingDomain)
  return {
    kind: 'dmarc',
    name: `_dmarc.${root}`,
    type: 'TXT',
    value: `v=DMARC1; p=none; rua=mailto:${rua}`,
  }
}

export interface EmailAuthRecordSet {
  spf: DnsRecordSpec
  dkim: DnsRecordSpec
  dmarc: DnsRecordSpec
}

export function buildEmailAuthRecordSet(opts: {
  sendingDomain: string
  dkimSelector: string
  dkimPublicKeyB64: string
  spfInclude?: string
  dmarcRua?: string
}): EmailAuthRecordSet {
  return {
    spf: buildSpfRecord(opts.sendingDomain, opts.spfInclude),
    dkim: buildDkimRecord(opts.sendingDomain, opts.dkimSelector, opts.dkimPublicKeyB64),
    dmarc: buildDmarcRecord(opts.sendingDomain, opts.dmarcRua),
  }
}

export type RecordStatus = 'verified' | 'missing' | 'mismatch' | 'error'

export interface RecordCheckResult {
  kind: 'spf' | 'dkim' | 'dmarc'
  name: string
  expected: string
  status: RecordStatus
  found: string[]
  error?: string
}

export interface EmailAuthCheckResult {
  spf: RecordCheckResult
  dkim: RecordCheckResult
  dmarc: RecordCheckResult
  all_verified: boolean
  checked_at: number
}

async function resolveTxtSafe(name: string): Promise<{ chunks: string[][]; error?: string }> {
  try {
    const chunks = await dns.resolveTxt(name)
    return { chunks }
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') {
      return { chunks: [] }
    }
    return { chunks: [], error: err?.message || 'DNS lookup failed' }
  }
}

function joinTxtChunks(chunks: string[][]): string[] {
  return chunks.map((parts) => parts.join('').trim()).filter(Boolean)
}

function recordMatches(record: string, expected: string, kind: 'spf' | 'dkim' | 'dmarc'): boolean {
  const normalized = record.replace(/\s+/g, '').toLowerCase()
  const wanted = expected.replace(/\s+/g, '').toLowerCase()
  if (kind === 'dkim') {
    // DKIM is order-independent (`v=`, `k=`, `p=` can appear in any order).
    // Simplest pragmatic check: the `p=` tag in the live record equals the
    // `p=` in the expected value. If `p=` matches and `v=DKIM1` is there,
    // it's verified.
    const livePub = extractTag(record, 'p')
    const wantedPub = extractTag(expected, 'p')
    const hasV1 = /v=dkim1/i.test(record)
    return hasV1 && livePub.length > 0 && livePub === wantedPub
  }
  if (kind === 'spf') {
    // SPF: must contain the `include:` mechanism we published.
    const include = extractSpfInclude(expected)
    const hasInclude = include ? new RegExp(`include:${escapeRegex(include)}`, 'i').test(record) : false
    return /v=spf1/i.test(record) && hasInclude
  }
  // DMARC: compare canonicalized strings.
  return normalized.startsWith('v=dmarc1') && normalized.includes(wanted.replace(/^v=dmarc1;?/, ''))
}

function extractTag(record: string, tag: string): string {
  const match = record.match(new RegExp(`(?:^|;|\\s)${tag}=([^;\\s]+)`, 'i'))
  return match ? match[1].trim() : ''
}

function extractSpfInclude(value: string): string | null {
  const match = value.match(/include:([^\s]+)/i)
  return match ? match[1] : null
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function checkOne(spec: DnsRecordSpec): Promise<RecordCheckResult> {
  const { chunks, error } = await resolveTxtSafe(spec.name)
  if (error) {
    return { kind: spec.kind, name: spec.name, expected: spec.value, status: 'error', found: [], error }
  }
  const records = joinTxtChunks(chunks)
  // Narrow to records relevant to this kind so we don't report unrelated TXT
  // (e.g., Google site verification) as a "mismatch".
  const relevant = records.filter((r) => {
    if (spec.kind === 'spf') return /v=spf1/i.test(r)
    if (spec.kind === 'dkim') return /v=dkim1/i.test(r)
    return /v=dmarc1/i.test(r)
  })
  if (relevant.length === 0) {
    return { kind: spec.kind, name: spec.name, expected: spec.value, status: 'missing', found: records }
  }
  const ok = relevant.some((r) => recordMatches(r, spec.value, spec.kind))
  return {
    kind: spec.kind,
    name: spec.name,
    expected: spec.value,
    status: ok ? 'verified' : 'mismatch',
    found: relevant,
  }
}

export async function runEmailAuthChecks(set: EmailAuthRecordSet): Promise<EmailAuthCheckResult> {
  const [spf, dkim, dmarc] = await Promise.all([
    checkOne(set.spf),
    checkOne(set.dkim),
    checkOne(set.dmarc),
  ])
  return {
    spf,
    dkim,
    dmarc,
    all_verified: spf.status === 'verified' && dkim.status === 'verified' && dmarc.status === 'verified',
    checked_at: Math.floor(Date.now() / 1000),
  }
}

/**
 * Sign an RFC 5322 message with DKIM using the relaxed/relaxed
 * canonicalization and rsa-sha256 — the minimum interop set. Returns
 * the full signed message (DKIM-Signature header prepended). We only
 * sign `from`, `to`, `subject`, `date`, `mime-version`, `content-type`
 * when present — keep the header list narrow to avoid accidental
 * breakage from downstream relays that rewrite less-common headers.
 *
 * This is a minimal implementation intended for SMTP paths where the
 * caller controls the full raw message. Managed senders (SendGrid,
 * Resend, SES) already handle DKIM signing at the provider level; for
 * those, publishing the provider-issued DNS records via this module
 * is sufficient and this function is not called.
 */
export function signMessageDkim(opts: {
  rawMessage: string
  domain: string
  selector: string
  privateKeyPem: string
  headersToSign?: string[]
}): string {
  const headers = opts.headersToSign ?? ['from', 'to', 'subject', 'date', 'mime-version', 'content-type']
  const { headerLines, body } = splitHeadersBody(opts.rawMessage)
  const bodyHash = relaxedBodyHash(body)
  const signedHeaderNames: string[] = []
  const canonicalHeaderBlock: string[] = []
  for (const name of headers) {
    const line = headerLines.find((l) => l.toLowerCase().startsWith(`${name}:`))
    if (!line) continue
    signedHeaderNames.push(name)
    canonicalHeaderBlock.push(relaxedHeaderLine(line))
  }
  const dkimHeaderUnsigned = [
    'v=1',
    'a=rsa-sha256',
    'c=relaxed/relaxed',
    `d=${opts.domain}`,
    `s=${opts.selector}`,
    `h=${signedHeaderNames.join(':')}`,
    `bh=${bodyHash}`,
    'b=',
  ].join('; ')
  const toSign = canonicalHeaderBlock.join('\r\n') + '\r\n' + relaxedHeaderLine(`DKIM-Signature: ${dkimHeaderUnsigned}`)
  const signer = crypto.createSign('sha256')
  signer.update(toSign)
  signer.end()
  const signature = signer.sign(opts.privateKeyPem).toString('base64')
  const finalDkim = `DKIM-Signature: ${dkimHeaderUnsigned}${signature}`
  // Prepend DKIM-Signature to the existing headers and rebuild the message.
  return [finalDkim, ...headerLines].join('\r\n') + '\r\n\r\n' + body
}

function splitHeadersBody(raw: string): { headerLines: string[]; body: string } {
  const sep = raw.indexOf('\r\n\r\n')
  if (sep === -1) {
    return { headerLines: raw.split(/\r?\n/).filter(Boolean), body: '' }
  }
  const headerBlock = raw.slice(0, sep)
  const body = raw.slice(sep + 4)
  // Unfold folded header lines (continuation lines start with WSP).
  const lines: string[] = []
  for (const rawLine of headerBlock.split(/\r?\n/)) {
    if (/^[\t ]/.test(rawLine) && lines.length > 0) {
      lines[lines.length - 1] += ' ' + rawLine.trim()
    } else if (rawLine.length > 0) {
      lines.push(rawLine)
    }
  }
  return { headerLines: lines, body }
}

function relaxedHeaderLine(line: string): string {
  const idx = line.indexOf(':')
  if (idx === -1) return line.trim().toLowerCase()
  const name = line.slice(0, idx).trim().toLowerCase()
  const value = line.slice(idx + 1).replace(/\s+/g, ' ').trim()
  return `${name}:${value}`
}

function relaxedBodyHash(body: string): string {
  // Collapse whitespace, trim trailing empty lines, add final CRLF.
  let normalized = body.replace(/[\t ]+/g, ' ').replace(/[\t ]+\r\n/g, '\r\n')
  normalized = normalized.replace(/(\r\n)+$/, '') + '\r\n'
  if (body.trim().length === 0) normalized = ''
  return crypto.createHash('sha256').update(normalized).digest('base64')
}
