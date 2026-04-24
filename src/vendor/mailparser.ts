export interface AddressObject {
  value: Array<{ address?: string }>
}

export interface ParsedMail {
  from?: AddressObject
  to?: AddressObject
  subject?: string
  html?: string
  textAsHtml?: string
  text?: string
  references?: string[]
  messageId?: string
  inReplyTo?: string
  date?: Date
}

export async function simpleParser(raw: string): Promise<ParsedMail> {
  return {
    from: { value: [] },
    to: { value: [] },
    subject: '',
    html: raw,
    textAsHtml: raw,
    text: raw,
    references: [],
    messageId: '',
    inReplyTo: '',
    date: new Date(),
  }
}
