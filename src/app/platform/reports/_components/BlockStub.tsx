// Block stubs for bar_chart, text, ai_summary, image.
//
// Sprint 2: these block types are not yet rendered. They show a placeholder
// so the report structure is correct without a 500.
// Phase 2: fill in bar_chart + text. Phase 2 also adds the AI summary block
// (ricky owns the Anthropic prompt; this just mounts it).

import type { ReportBlockType } from '@/lib/platform/types'

interface BlockStubProps {
  blockType: ReportBlockType
  title: string | null
}

const labels: Partial<Record<ReportBlockType, string>> = {
  bar_chart: 'Bar Chart',
  text: 'Text Block',
  ai_summary: 'AI Executive Summary',
  image: 'Image Block',
}

export function BlockStub({ blockType, title }: BlockStubProps) {
  return (
    <div className="bg-gray-50 border border-dashed border-gray-200 rounded-lg p-5 flex items-center gap-3">
      <span className="text-gray-300 text-lg">
        {blockType === 'bar_chart' ? '📊' : blockType === 'ai_summary' ? '✍️' : '⬜'}
      </span>
      <div>
        <p className="text-sm font-medium text-gray-400">{title ?? labels[blockType] ?? blockType}</p>
        <p className="text-xs text-gray-300 mt-0.5">
          {blockType === 'ai_summary'
            ? 'AI summary — Phase 2 (ricky owns the prompt)'
            : 'Coming in Phase 2'}
        </p>
      </div>
    </div>
  )
}
