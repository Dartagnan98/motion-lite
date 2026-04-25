// Email sending via SendGrid + Gmail API fallback
import { getProviderToken, updateProviderToken } from './provider-tokens'

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY
const FROM_EMAIL = 'info@example.com'
const FROM_NAME = 'Motion Lite'

// ─── SendGrid ───

async function sendViaSendGrid(
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ success: boolean; error?: string }> {
  if (!SENDGRID_API_KEY) return { success: false, error: 'SENDGRID_API_KEY not set' }

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: FROM_EMAIL, name: FROM_NAME },
      subject,
      content: [
        { type: 'text/plain', value: htmlBody.replace(/<[^>]+>/g, '') },
        { type: 'text/html', value: htmlBody },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[sendgrid] Send failed:', res.status, err)
    return { success: false, error: `SendGrid error ${res.status}` }
  }

  return { success: true }
}

// ─── Gmail API fallback ───

async function getValidAccessToken(userId: number): Promise<string | null> {
  const token = await getProviderToken(userId, 'google')
  if (!token) return null

  const now = Math.floor(Date.now() / 1000)
  if (token.token_expiry > now + 60) return token.access_token

  if (!token.refresh_token || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!res.ok) {
    console.error('Failed to refresh Google token:', await res.text())
    return null
  }

  const data = await res.json()
  await updateProviderToken(userId, 'google', data.access_token, null, data.expires_in)
  return data.access_token
}

function buildMimeMessage(to: string, subject: string, htmlBody: string, fromEmail: string): string {
  const boundary = 'boundary_' + Date.now()
  const lines = [
    `From: ${FROM_NAME} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    htmlBody.replace(/<[^>]+>/g, ''),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ]
  return lines.join('\r\n')
}

async function sendViaGmail(
  userId: number,
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ success: boolean; error?: string }> {
  const accessToken = await getValidAccessToken(userId)
  if (!accessToken) {
    return { success: false, error: 'No valid Google token' }
  }

  const token = await getProviderToken(userId, 'google')
  const fromEmail = token?.provider_email || FROM_EMAIL
  const mime = buildMimeMessage(to, subject, htmlBody, fromEmail)
  const raw = Buffer.from(mime).toString('base64url')

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[gmail] Send failed:', err)
    return { success: false, error: 'Gmail send failed' }
  }

  return { success: true }
}

// ─── Public API ───

export async function sendEmail(
  userId: number,
  to: string,
  subject: string,
  htmlBody: string
): Promise<{ success: boolean; error?: string }> {
  // Try SendGrid first, fall back to Gmail
  if (SENDGRID_API_KEY) {
    const result = await sendViaSendGrid(to, subject, htmlBody)
    if (result.success) return result
    console.error('[email] SendGrid failed, trying Gmail fallback:', result.error)
  }

  return sendViaGmail(userId, to, subject, htmlBody)
}

export function buildInviteEmail(params: {
  inviteeName: string
  workspaceName: string
  inviterName: string
  inviteLink: string
  role: string
}): string {
  const { inviteeName, workspaceName, inviterName, inviteLink, role } = params
  const roleLabel = role === 'client' ? 'Client' : role === 'admin' ? 'Admin' : 'Team Member'
  const roleBg = role === 'client' ? '#1a2e1a' : role === 'admin' ? '#2e2a1a' : '#1a2e1a'
  const roleColor = role === 'client' ? '#37ca37' : role === 'admin' ? '#d4a94e' : '#37ca37'

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f3f0ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f0ec;">
    <tr><td align="center" style="padding:48px 16px;">

      <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <!-- Logo -->
        <tr><td style="padding:0 0 32px;text-align:center;">
          <img src="https://app.example.com/motionlite-logo-dark.png" alt="Ctrl flow" height="36" style="height:36px;width:auto;display:inline-block;" />
        </td></tr>

        <!-- Card -->
        <tr><td style="background-color:#ffffff;border-radius:12px;overflow:hidden;">

          <!-- Green top bar -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="height:4px;background-color:#12382e;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>

          <!-- Content -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:40px 44px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

              <p style="color:#1a1a1a;font-size:22px;font-weight:700;margin:0 0 8px;line-height:1.3;">
                ${inviteeName ? `Hey ${inviteeName},` : 'Hey there,'}
              </p>

              <p style="color:#555555;font-size:15px;line-height:1.7;margin:0 0 24px;">
                ${inviterName} has invited you to join <strong style="color:#1a1a1a;">${workspaceName}</strong> as ${roleLabel.toLowerCase()}.
              </p>

              <!-- Role badge -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr><td style="background-color:#f3f0ec;border-radius:6px;padding:6px 14px;">
                  <span style="color:#12382e;font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
                    ${roleLabel}
                  </span>
                </td></tr>
              </table>

              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr><td>
                  <a href="${inviteLink}" target="_blank" style="display:block;background-color:#12382e;color:#ffffff;text-decoration:none;text-align:center;padding:15px 32px;border-radius:8px;font-size:15px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1;">
                    Get Started
                  </a>
                </td></tr>
              </table>

              <!-- Or Google -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:12px;">
                <tr><td>
                  <a href="${inviteLink}" target="_blank" style="display:block;border:1px solid #e5e2dd;color:#888888;text-decoration:none;text-align:center;padding:13px 32px;border-radius:8px;font-size:13px;font-weight:500;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1;">
                    or sign in with Google
                  </a>
                </td></tr>
              </table>

              <!-- Expiry -->
              <p style="color:#aaaaaa;font-size:12px;line-height:1.5;margin:24px 0 0;">
                This invite expires in 7 days.
              </p>

            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0 0;text-align:center;">
          <p style="color:#b5b0a8;font-size:11px;margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            <a href="https://example.com" style="color:#b5b0a8;text-decoration:none;">example.com</a>
          </p>
        </td></tr>

      </table>

    </td></tr>
  </table>
</body>
</html>`
}
