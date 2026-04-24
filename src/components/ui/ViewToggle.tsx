'use client'

interface ViewToggleProps<T extends string> {
  options: { value: T; label: string }[]
  active: T
  onChange: (id: T) => void
}

export function ViewToggle<T extends string>({ options, active, onChange }: ViewToggleProps<T>) {
  return (
    <div className="inline-flex items-center bg-[var(--border)] rounded-md overflow-hidden">
      {options.map(opt => {
        const isActive = active === opt.value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 text-[13px] font-medium transition-colors ${isActive ? 'bg-[#4a4f52] text-white' : 'text-text-dim hover:text-white'}`}
            style={{ paddingTop: '4px', paddingBottom: '4px' }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
