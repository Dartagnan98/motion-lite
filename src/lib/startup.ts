import { startCrmWorkflowWorker } from '@/lib/crm-workflow-runner'
import { startEmailQueueWorker } from '@/lib/email-queue'
import { startImapPoller } from '@/lib/imap-poller'

declare global {
  // eslint-disable-next-line no-var
  var __crmStartupComplete: boolean | undefined
}

export function ensureAppStartup() {
  if (globalThis.__crmStartupComplete) return
  globalThis.__crmStartupComplete = true
  startEmailQueueWorker()
  startImapPoller()
  startCrmWorkflowWorker()
}
