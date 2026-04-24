// Shared SSE client registry for desktop app notifications
const clients: Set<ReadableStreamDefaultController> = new Set()

export function addSSEClient(controller: ReadableStreamDefaultController) {
  clients.add(controller)
}

export function removeSSEClient(controller: ReadableStreamDefaultController) {
  clients.delete(controller)
}

export function pushToSSEClients(payload: { title: string; body: string; url?: string }) {
  const data = `data: ${JSON.stringify(payload)}\n\n`
  for (const controller of clients) {
    try {
      controller.enqueue(new TextEncoder().encode(data))
    } catch {
      clients.delete(controller)
    }
  }
}
