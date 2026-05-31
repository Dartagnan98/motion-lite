// CommentThread — client component for threaded comments on report sections.
//
// Props:
//   reportId       — the report this thread belongs to
//   sectionId      — null = report-level thread, number = section thread
//   initialComments — server-provided initial data (no loading flash)
//   currentUserId  — used to show Edit/Delete affordances on own comments
//   currentUserName — displayed as "you" label for optimistic add
//   readOnly       — public renderer mode: no add/edit/resolve/push affordances
//
// Features:
//   - Optimistic comment add (POST /comments, immediate UI)
//   - Resolve toggle (PATCH is_resolved)
//   - Edit (author only, PATCH body)
//   - Soft-delete (author only, DELETE)
//   - Push to Asana (POST push-to-asana); becomes "View in Asana" link after push
//   - Resolved comments hidden behind "Show resolved (N)" expander
//   // PHASE2-TIPTAP: textarea → TiptapEditor upgrade

'use client'

import { useState, useRef, useTransition } from 'react'
import type { ReportComment } from '@/lib/platform/reports'

interface CommentThreadProps {
  reportId: number
  sectionId: number | null
  initialComments: ReportComment[]
  currentUserId: number
  currentUserName: string
  readOnly?: boolean
  /** Base URL of the app for Asana not-connected link. */
  appUrl?: string
}

function relativeTime(epochSeconds: number): string {
  const diffMs = Date.now() - epochSeconds * 1000
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(epochSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

interface CommentItemProps {
  comment: ReportComment
  reportId: number
  currentUserId: number
  readOnly: boolean
  onUpdate: (updated: ReportComment) => void
  onDelete: (id: number) => void
}

function CommentItem({ comment, reportId, currentUserId, readOnly, onUpdate, onDelete }: CommentItemProps) {
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(comment.body)
  const [asanaPending, setAsanaPending] = useState(false)
  const [asanaError, setAsanaError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const isAuthor = comment.author_user_id === currentUserId
  const hasAsanaTask = !!comment.asana_task_gid

  async function toggleResolve() {
    const res = await fetch(
      `/api/platform/reports/${reportId}/comments/${comment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_resolved: comment.is_resolved ? 0 : 1 }),
      }
    )
    if (res.ok) {
      onUpdate({ ...comment, is_resolved: comment.is_resolved ? 0 : 1 })
    }
  }

  async function saveEdit() {
    const trimmed = editBody.trim()
    if (!trimmed) return
    const res = await fetch(
      `/api/platform/reports/${reportId}/comments/${comment.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      }
    )
    if (res.ok) {
      onUpdate({ ...comment, body: trimmed })
      setEditing(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this comment? This cannot be undone.')) return
    const res = await fetch(
      `/api/platform/reports/${reportId}/comments/${comment.id}`,
      { method: 'DELETE' }
    )
    if (res.ok) onDelete(comment.id)
  }

  async function pushToAsana() {
    setAsanaPending(true)
    setAsanaError(null)
    try {
      const res = await fetch(
        `/api/platform/reports/${reportId}/comments/${comment.id}/push-to-asana`,
        { method: 'POST' }
      )
      const data = await res.json() as {
        ok?: boolean
        taskGid?: string
        taskUrl?: string
        error?: string
      }
      if (!res.ok || !data.ok) {
        setAsanaError(data.error ?? 'Push to Asana failed')
        return
      }
      if (data.taskGid) {
        onUpdate({ ...comment, asana_task_gid: data.taskGid })
      }
    } catch {
      setAsanaError('Network error — push to Asana failed')
    } finally {
      setAsanaPending(false)
    }
  }

  const asanaTaskUrl = hasAsanaTask
    ? `https://app.asana.com/0/0/${comment.asana_task_gid}`
    : null

  return (
    <div className={`py-3 px-4 border-b border-gray-50 last:border-0 ${comment.is_resolved ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium text-gray-700 truncate">
            {isAuthor ? 'You' : `User ${comment.author_user_id}`}
          </span>
          <span className="text-xs text-gray-300">&middot;</span>
          <span className="text-xs text-gray-400 whitespace-nowrap">{relativeTime(comment.created_at)}</span>
          {!!comment.is_resolved && (
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-100">
              Resolved
            </span>
          )}
          {hasAsanaTask && (
            <span className="text-xs text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full border border-purple-100">
              Asana
            </span>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={toggleResolve}
              className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
            >
              {comment.is_resolved ? 'Unresolve' : 'Resolve'}
            </button>
            {isAuthor && (
              <>
                <button
                  onClick={() => { setEditing(true); setEditBody(comment.body) }}
                  className="text-xs text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-100 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="text-xs text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          {/* PHASE2-TIPTAP: replace textarea with Tiptap editor */}
          <textarea
            value={editBody}
            onChange={(e) => setEditBody(e.target.value)}
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y"
            autoFocus
          />
          <div className="flex gap-2 mt-1.5">
            <button
              onClick={saveEdit}
              disabled={!editBody.trim()}
              className="text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5
                         rounded-md disabled:opacity-50 transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-md
                         hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{comment.body}</p>
      )}

      {/* Push to Asana */}
      {!readOnly && !editing && (
        <div className="mt-2 flex items-center gap-2">
          {hasAsanaTask ? (
            <a
              href={asanaTaskUrl!}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-purple-600 hover:text-purple-700 font-medium underline"
            >
              View in Asana
            </a>
          ) : (
            <button
              onClick={pushToAsana}
              disabled={asanaPending}
              className="text-xs text-gray-400 hover:text-gray-600 font-medium disabled:opacity-50 transition-colors"
            >
              {asanaPending ? 'Pushing...' : 'Push to Asana'}
            </button>
          )}
          {asanaError && (
            <span className="text-xs text-red-500">{asanaError}</span>
          )}
        </div>
      )}
    </div>
  )
}

export function CommentThread({
  reportId,
  sectionId,
  initialComments,
  currentUserId,
  currentUserName,
  readOnly = false,
}: CommentThreadProps) {
  // Filter to this section (or report-level when sectionId is null).
  const sectionComments = initialComments.filter((c) =>
    sectionId === null ? c.section_id === null : c.section_id === sectionId
  )

  const [comments, setComments] = useState<ReportComment[]>(sectionComments)
  const [newBody, setNewBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeComments = comments.filter((c) => !c.is_resolved)
  const resolvedComments = comments.filter((c) => !!c.is_resolved)
  const visibleComments = showResolved ? comments : activeComments

  async function handleSubmit() {
    const trimmed = newBody.trim()
    if (!trimmed) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/platform/reports/${reportId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sectionId, body: trimmed }),
      })
      const data = await res.json() as { ok?: boolean; comment?: ReportComment; error?: string }
      if (!res.ok || !data.ok) {
        setSubmitError(data.error ?? 'Failed to post comment')
        return
      }
      if (data.comment) {
        setComments((prev) => [...prev, data.comment!])
      }
      setNewBody('')
      textareaRef.current?.focus()
    } catch {
      setSubmitError('Network error — comment not saved')
    } finally {
      setSubmitting(false)
    }
  }

  function handleUpdate(updated: ReportComment) {
    setComments((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
  }

  function handleDelete(id: number) {
    setComments((prev) => prev.filter((c) => c.id !== id))
  }

  const resolvedCount = resolvedComments.length

  return (
    <div
      data-comment-thread
      data-comment-empty={comments.length === 0 ? '' : undefined}
      className="mt-6 border border-gray-100 rounded-lg bg-gray-50/40"
    >
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          Comments {activeComments.length > 0 && <span className="text-gray-700">({activeComments.length})</span>}
        </span>
        {resolvedCount > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showResolved ? `Hide resolved (${resolvedCount})` : `Show resolved (${resolvedCount})`}
          </button>
        )}
      </div>

      {/* Comment list */}
      {visibleComments.length === 0 ? (
        <div className="px-4 py-4 text-xs text-gray-300 text-center">
          {readOnly ? 'No comments on this section.' : 'No comments yet — add one below.'}
        </div>
      ) : (
        <div>
          {visibleComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              reportId={reportId}
              currentUserId={currentUserId}
              readOnly={readOnly}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Add comment — hidden in read-only mode */}
      {!readOnly && (
        <div data-comment-composer className="px-4 py-3 border-t border-gray-100">
          {/* PHASE2-TIPTAP: replace textarea with Tiptap inline editor */}
          <textarea
            ref={textareaRef}
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
              }
            }}
            rows={2}
            placeholder="Add a comment... (Cmd+Enter to submit)"
            className="w-full text-sm border border-gray-200 rounded-md px-3 py-2 focus:outline-none
                       focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-y
                       placeholder:text-gray-300 bg-white"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-300">
              {currentUserName} &middot; {sectionId === null ? 'Report-level' : 'Section comment'}
            </span>
            <div className="flex items-center gap-2">
              {submitError && <span className="text-xs text-red-500">{submitError}</span>}
              <button
                onClick={handleSubmit}
                disabled={!newBody.trim() || submitting}
                className="text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5
                           rounded-md disabled:opacity-50 transition-colors"
              >
                {submitting ? 'Posting...' : 'Post comment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
