import { startCrmWorkflowWorker } from '@/lib/crm-workflow-runner'
import { startEmailQueueWorker } from '@/lib/email-queue'
import { startImapPoller } from '@/lib/imap-poller'
import { ensurePlatformReady } from '@/lib/platform/tenant'

declare global {
  // eslint-disable-next-line no-var
  var __crmStartupComplete: boolean | undefined
}

export function ensureAppStartup() {
  if (globalThis.__crmStartupComplete) return
  globalThis.__crmStartupComplete = true
  // Hiilite Platform schema boots alongside motion-lite. Idempotent + non-fatal:
  // if it throws we log and continue so the rest of the app still serves.
  try { ensurePlatformReady() } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[platform] schema init failed (non-fatal):', e)
  }
  startEmailQueueWorker()
  startImapPoller()
  startCrmWorkflowWorker()
}
