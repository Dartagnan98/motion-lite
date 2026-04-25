'use client'

import { useEffect } from 'react'
import Link from '@tiptap/extension-link'
import StarterKit from '@tiptap/starter-kit'
import { EditorContent, useEditor } from '@tiptap/react'

const mono = { fontFamily: 'var(--font-mono)' } as const

export function RichTextEditor({
  value,
  onChange,
  onBlur,
}: {
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      }),
    ],
    content: value,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'min-h-[260px] rounded-[12px] border border-border bg-field px-4 py-4 text-[13px] leading-6 text-text outline-none transition-colors',
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getHTML()),
    onBlur: () => onBlur?.(),
  })

  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || '<p></p>', { emitUpdate: false })
    }
  }, [editor, value])

  return (
    <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
      <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2" style={{ background: 'var(--bg-panel)' }}>
        <ToolbarButton label="Bold" onClick={() => editor?.chain().focus().toggleBold().run()} active={Boolean(editor?.isActive('bold'))} />
        <ToolbarButton label="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()} active={Boolean(editor?.isActive('italic'))} />
        <ToolbarButton label="Bullets" onClick={() => editor?.chain().focus().toggleBulletList().run()} active={Boolean(editor?.isActive('bulletList'))} />
        <ToolbarButton
          label="Link"
          onClick={() => {
            if (!editor) return
            const previous = editor.getAttributes('link').href as string | undefined
            const href = window.prompt('Enter URL', previous || 'https://')
            if (href === null) return
            if (!href.trim()) {
              editor.chain().focus().unsetLink().run()
              return
            }
            editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run()
          }}
          active={Boolean(editor?.isActive('link'))}
        />
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolbarButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] transition-colors"
      style={{
        ...mono,
        borderColor: active ? 'color-mix(in oklab, var(--accent) 28%, var(--border))' : 'var(--border)',
        background: active ? 'color-mix(in oklab, var(--accent) 12%, var(--bg-panel))' : 'transparent',
        color: active ? 'var(--accent-text)' : 'var(--text-dim)',
      }}
    >
      {label}
    </button>
  )
}
