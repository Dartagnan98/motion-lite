// Color palette used across the entire app
export const APP_COLORS = [
  { name: 'Lavender', value: '#262659' },
  { name: 'Blue', value: '#3c8cdc' },
  { name: 'Violet', value: '#8c3cdc' },
  { name: 'Rose', value: '#dd3c64' },
  { name: 'Red', value: '#dc3c3c' },
  { name: 'Orange', value: '#dd643c' },
  { name: 'Cyan', value: '#3cddb4' },
  { name: 'Emerald', value: '#3bdd8c' },
  { name: 'Green', value: '#64dc3c' },
  { name: 'Mint', value: '#8bdd3c' },
  { name: 'Yellow', value: '#ddb53c' },
  { name: 'Gray', value: '#8c8c8c' },
] as const

export const APP_COLOR_VALUES = APP_COLORS.map(c => c.value)

// 3-row grid layout for color pickers in context menus / sidebar
export const APP_COLOR_GRID = [
  APP_COLORS.slice(0, 4).map(c => c.value),   // Lavender, Blue, Violet, Rose
  APP_COLORS.slice(4, 8).map(c => c.value),   // Red, Orange, Cyan, Emerald
  APP_COLORS.slice(8, 12).map(c => c.value),  // Green, Mint, Yellow, Gray
]

const COLOR_NAME_MAP: Record<string, string> = {}
for (const c of APP_COLORS) {
  COLOR_NAME_MAP[c.value] = c.name
}

export function getColorName(hex: string): string {
  return COLOR_NAME_MAP[hex?.toLowerCase()] || COLOR_NAME_MAP[hex] || 'Custom'
}

// Dark header backgrounds for each calendar color (used in EventDetailPanel header)
const HEADER_DARK_MAP: Record<string, string> = {
  '#262659': '#0a0a1f', // Lavender
  '#3c8cdc': '#031a31', // Blue
  '#8c3cdc': '#1a0330', // Violet
  '#dd3c64': '#31030e', // Rose
  '#dc3c3c': '#310302', // Red
  '#dd643c': '#300e03', // Orange
  '#3cddb4': '#033125', // Cyan
  '#3bdd8c': '#03311a', // Emerald
  '#64dc3c': '#0f3103', // Green
  '#8bdd3c': '#1a3003', // Mint
  '#ddb53c': '#312402', // Yellow
  '#8c8c8c': '#262626', // Gray
}

// For colors not in the map, generate a dark tinted version by scaling RGB to ~12% brightness
function darkenHex(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  const scale = 0.12
  const dr = Math.round(r * scale)
  const dg = Math.round(g * scale)
  const db = Math.round(b * scale)
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`
}

export function getHeaderDarkBg(hex: string): string {
  if (!hex) return '#0a0a0f'
  const lower = hex.toLowerCase()
  return HEADER_DARK_MAP[lower] || darkenHex(lower)
}

// Motion-style calendar background colors (dark muted versions)
export const CALENDAR_COLORS = [
  { name: 'Blue', value: '#273f59' },
  { name: 'Lavender', value: '#262659' },
  { name: 'Violet', value: '#402659' },
  { name: 'Rose', value: '#592633' },
  { name: 'Red', value: '#592633' },
  { name: 'Orange', value: '#593327' },
  { name: 'Cyan', value: '#27594d' },
  { name: 'Emerald', value: '#275940' },
  { name: 'Green', value: '#325a27' },
  { name: 'Mint', value: '#405926' },
  { name: 'Yellow', value: '#594d27' },
  { name: 'Gray', value: '#404040' },
]

// Map an APP_COLOR accent hex to its CALENDAR_COLORS background by matching name
export function getCalendarBg(accentHex: string): string | undefined {
  if (!accentHex) return undefined
  const appColor = APP_COLORS.find(c => c.value.toLowerCase() === accentHex.toLowerCase())
  if (!appColor) return undefined
  const calColor = CALENDAR_COLORS.find(c => c.name === appColor.name)
  return calColor?.value
}

