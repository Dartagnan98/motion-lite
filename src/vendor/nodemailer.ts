import crypto from 'crypto'

export interface SendMailOptions {
  from?: string
  to?: string
  subject?: string
  html?: string
  inReplyTo?: string
  references?: string[]
  headers?: Record<string, string>
}

export interface SentMessageInfo {
  messageId: string
}

export interface Transporter {
  sendMail(mail: SendMailOptions): Promise<SentMessageInfo>
  verify(): Promise<true>
}

export default {
  createTransport(_options?: unknown): Transporter {
    return {
      async verify() {
        return true
      },
      async sendMail() {
        return { messageId: `<stub-${crypto.randomUUID()}@ctrl.local>` }
      },
    }
  },
}
