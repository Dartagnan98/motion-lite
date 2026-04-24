export const POPUP_SURFACE_SELECTOR = '[data-popup-root]'

export const popupSurfaceDataProps = {
  'data-popup-root': '',
} as const

export function withPopupSurfaceClassName(className = ''): string {
  const normalized = className.trim()
  if (!normalized) return 'ui-popup-surface'
  return normalized.includes('ui-popup-surface') ? normalized : `${normalized} ui-popup-surface`
}

export function stopPopupMouseDown(event: { stopPropagation: () => void }) {
  event.stopPropagation()
}

export function isEventInsidePopupSurface(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(POPUP_SURFACE_SELECTOR))
}
