import { EventEmitter } from 'events'

export namespace Imap {
  export interface ImapMessage extends EventEmitter {}
}

export default class Imap extends EventEmitter {
  constructor(_options?: Record<string, unknown>) {
    super()
  }

  openBox(_mailbox: string, _readOnly: boolean, callback: (error: Error | null) => void) {
    callback(null)
  }

  search(_criteria: unknown[], callback: (error: Error | null, results: number[]) => void) {
    callback(null, [])
  }

  fetch(_results?: number[], _options?: Record<string, unknown>) {
    const emitter = new EventEmitter()
    queueMicrotask(() => emitter.emit('end'))
    return emitter
  }

  end() {
    this.emit('end')
  }

  connect() {
    queueMicrotask(() => this.emit('ready'))
  }
}
