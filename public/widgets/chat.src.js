/**
 * Motion Lite Live-Chat SDK — v1
 *
 * Embed:
 *   <script>
 *     window.ctrlmChat = { widgetId: 'PUBLIC_ID', identify: { ... } }
 *   </script>
 *   <script async src="https://app.example.com/widgets/chat.js"></script>
 *
 * Or, without a config object:
 *   <script async data-widget="PUBLIC_ID" src=".../widgets/chat.js"></script>
 *
 * Everything lives inside a Shadow DOM so host-page styles can't leak in.
 */
(function () {
  'use strict'
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  // ── Resolve config + origin ──────────────────────────────────────────────
  var scriptEl = document.currentScript
  var scriptOrigin = (function () {
    try { if (scriptEl && scriptEl.src) return new URL(scriptEl.src).origin } catch (e) {}
    return window.location.origin
  })()

  var config = (function () {
    var cfg = window.ctrlmChat || {}
    if (!cfg.widgetId && scriptEl) {
      cfg.widgetId = scriptEl.getAttribute('data-widget') || cfg.widgetId
    }
    return cfg
  })()

  if (!config.widgetId) return // nothing to mount

  // Idempotent — never double-mount.
  if (window.__ctrlmChatMounted) return
  window.__ctrlmChatMounted = true

  var API = scriptOrigin
  var WIDGET_ID = String(config.widgetId)

  // ── Small event bus so the host page can subscribe ───────────────────────
  var listeners = {}
  var bus = {
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn) },
    off: function (ev, fn) {
      var ls = listeners[ev]; if (!ls) return
      var i = ls.indexOf(fn); if (i >= 0) ls.splice(i, 1)
    },
    emit: function (ev, payload) {
      var ls = listeners[ev]; if (!ls) return
      for (var i = 0; i < ls.length; i++) {
        try { ls[i](payload) } catch (e) { /* host handler errors are not our problem */ }
      }
    }
  }

  // Preserve any .emit listeners the host set up before load by mirroring API.
  window.ctrlmChat = window.ctrlmChat || {}
  window.ctrlmChat.widgetId = WIDGET_ID
  window.ctrlmChat.emit = bus.emit
  window.ctrlmChat.on = bus.on
  window.ctrlmChat.off = bus.off

  // ── Persistent session storage ──────────────────────────────────────────
  var SESSION_KEY = 'ctrlmotion:webchat:' + WIDGET_ID
  var IDENTITY_KEY = 'ctrlmotion:webchat:identity:' + WIDGET_ID
  var OPEN_KEY = 'ctrlmotion:webchat:open:' + WIDGET_ID

  function readJson(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null } catch (e) { return null }
  }
  function writeJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch (e) { /* private mode */ }
  }
  function readStr(key) { try { return localStorage.getItem(key) || '' } catch (e) { return '' } }
  function writeStr(key, val) { try { localStorage.setItem(key, val) } catch (e) {} }

  var session = readStr(SESSION_KEY)
  var identity = readJson(IDENTITY_KEY) || null
  // Prime identity from config.identify if the page provides it
  if (!identity && config.identify && (config.identify.email || config.identify.phone)) {
    identity = {
      name: config.identify.name || '',
      email: config.identify.email || '',
      phone: config.identify.phone || '',
    }
  }

  // ── Host + shadow DOM setup ─────────────────────────────────────────────
  var host = document.createElement('div')
  host.setAttribute('data-ctrlm-chat', WIDGET_ID)
  host.style.cssText = 'all:initial;position:fixed;z-index:2147483000;'
  document.body.appendChild(host)
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host

  // Inject styles. System font stack only — we never pull web fonts from the
  // widget so we can't regress the host page's FOUT behaviour.
  var style = document.createElement('style')
  style.textContent = STYLES()
  root.appendChild(style)

  // ── Build UI skeleton ───────────────────────────────────────────────────
  var container = document.createElement('div')
  container.className = 'ctrlm-container'
  root.appendChild(container)

  var bubble = document.createElement('button')
  bubble.type = 'button'
  bubble.className = 'ctrlm-bubble'
  bubble.setAttribute('aria-label', 'Open chat')
  bubble.innerHTML = BUBBLE_SVG()
  container.appendChild(bubble)

  var panel = document.createElement('div')
  panel.className = 'ctrlm-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-live', 'polite')
  panel.innerHTML = PANEL_HTML()
  container.appendChild(panel)

  // Cache UI nodes
  var ui = {
    header: panel.querySelector('.ctrlm-header'),
    title: panel.querySelector('.ctrlm-title'),
    subtitle: panel.querySelector('.ctrlm-subtitle'),
    dot: panel.querySelector('.ctrlm-dot'),
    avatar: panel.querySelector('.ctrlm-avatar'),
    close: panel.querySelector('.ctrlm-close'),
    thread: panel.querySelector('.ctrlm-thread'),
    typing: panel.querySelector('.ctrlm-typing'),
    form: panel.querySelector('.ctrlm-composer'),
    textarea: panel.querySelector('.ctrlm-input'),
    sendBtn: panel.querySelector('.ctrlm-send'),
    attach: panel.querySelector('.ctrlm-attach'),
    attachInput: panel.querySelector('.ctrlm-attach-input'),
    emojiBtn: panel.querySelector('.ctrlm-emoji-btn'),
    emojiPop: panel.querySelector('.ctrlm-emoji-pop'),
    intro: panel.querySelector('.ctrlm-intro'),
    introForm: panel.querySelector('.ctrlm-intro-form'),
    offline: panel.querySelector('.ctrlm-offline'),
    offlineForm: panel.querySelector('.ctrlm-offline-form'),
    offlineNote: panel.querySelector('.ctrlm-offline-note'),
    error: panel.querySelector('.ctrlm-error'),
    attachments: panel.querySelector('.ctrlm-attachments'),
  }

  // ── State ───────────────────────────────────────────────────────────────
  var widgetConfig = null     // from /config — workspace branding + presence
  var messages = []           // normalized { id, direction, body, ... }
  var reactionsById = {}      // { messageId: [{emoji, by_self, by_agent}] }
  var agentsTyping = []       // list of names currently typing
  var lastPolledId = 0
  var pollTimer = null
  var typingTimer = null
  var pendingAttachments = []
  var introSent = Boolean(session)
  var open = readStr(OPEN_KEY) === '1'
  var unread = 0
  var lastKnownSeenMessageId = 0
  var audioEnabled = true

  // ── Fetch helpers ───────────────────────────────────────────────────────
  function api(path, opts) {
    opts = opts || {}
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'omit',
    }).then(function (r) {
      return r.json().then(function (j) { return { status: r.status, json: j, ok: r.ok } })
    })
  }

  function loadConfig() {
    return api('/api/webchat/' + WIDGET_ID + '/config').then(function (res) {
      if (!res.ok) throw new Error(res.json && res.json.error || 'config load failed')
      widgetConfig = res.json
      applyBranding()
      return widgetConfig
    })
  }

  function loadPresence() {
    return api('/api/webchat/' + WIDGET_ID + '/presence').then(function (res) {
      if (res.ok && res.json) {
        widgetConfig = Object.assign({}, widgetConfig, {
          agent_online: res.json.agent_online,
          agent_status: res.json.agent_status,
          agent_name: res.json.agent_name,
          agent_avatar: res.json.agent_avatar,
        })
        applyBranding()
      }
    }).catch(function () {})
  }

  function applyBranding() {
    if (!widgetConfig) return
    container.style.setProperty('--ctrlm-accent', widgetConfig.primary_color || '#D97757')
    var side = widgetConfig.position === 'bottom-left' ? 'left' : 'right'
    host.style.bottom = '16px'
    host.style[side] = '16px'
    host.style[side === 'left' ? 'right' : 'left'] = 'auto'
    ui.title.textContent = widgetConfig.name || 'Chat'
    var status = widgetConfig.agent_status || 'offline'
    ui.dot.className = 'ctrlm-dot ' + status
    ui.subtitle.textContent = status === 'online'
      ? (widgetConfig.agent_name ? widgetConfig.agent_name + ' is online' : 'We are online')
      : status === 'away'
        ? 'Replies may be slower'
        : 'We are away — leave us a message'
    if (widgetConfig.agent_avatar) {
      ui.avatar.innerHTML = '<img alt="" src="' + escapeAttr(widgetConfig.agent_avatar) + '" />'
    } else {
      ui.avatar.innerHTML = ''
    }
  }

  // ── Rendering ───────────────────────────────────────────────────────────
  function normalize(m) {
    return {
      id: m.id,
      direction: m.direction,
      body: m.body,
      sent_at: m.sent_at,
      read_at: m.read_at || null,
      attachments: m.attachments || null,
    }
  }

  function renderThread() {
    ui.thread.innerHTML = ''
    // Greeting bubble — "outbound" from the visitor's perspective (from the
    // company). If the workspace agent has an avatar we show it next to the
    // first agent bubble, but for every visitor bubble we show nothing.
    if (widgetConfig && widgetConfig.greeting) {
      ui.thread.appendChild(bubbleNode({ direction: 'outbound', body: widgetConfig.greeting, id: 'greeting' }))
    }
    for (var i = 0; i < messages.length; i++) {
      ui.thread.appendChild(bubbleNode(messages[i]))
    }
    // Auto-scroll to bottom
    requestAnimationFrame(function () { ui.thread.scrollTop = ui.thread.scrollHeight })
  }

  function bubbleNode(m) {
    var wrap = document.createElement('div')
    // Visitor side: our POST creates 'inbound' messages from the server's POV.
    // To the visitor those are their OWN sent messages (right side).
    var fromVisitor = m.direction === 'inbound'
    wrap.className = 'ctrlm-row ' + (fromVisitor ? 'from-visitor' : 'from-agent')

    var bubble = document.createElement('div')
    bubble.className = 'ctrlm-msg'
    bubble.textContent = m.body || ''
    wrap.appendChild(bubble)

    if (m.attachments && m.attachments.length) {
      for (var i = 0; i < m.attachments.length; i++) {
        var a = m.attachments[i]
        var link = document.createElement('a')
        link.className = 'ctrlm-attachment-link'
        link.href = apiOrigin(a.url)
        link.target = '_blank'
        link.rel = 'noopener'
        link.textContent = '📎 ' + (a.filename || 'file')
        wrap.appendChild(link)
      }
    }

    var meta = document.createElement('div')
    meta.className = 'ctrlm-meta'
    meta.textContent = fmtTime(m.sent_at)
    if (fromVisitor && m.read_at) {
      meta.textContent += ' · Seen'
    }
    wrap.appendChild(meta)

    // Reactions
    var rs = reactionsById[m.id] || []
    if (rs.length) {
      var rowR = document.createElement('div')
      rowR.className = 'ctrlm-reactions'
      var counts = {}
      for (var j = 0; j < rs.length; j++) {
        counts[rs[j].emoji] = (counts[rs[j].emoji] || 0) + 1
      }
      Object.keys(counts).forEach(function (emoji) {
        var span = document.createElement('span')
        span.className = 'ctrlm-reaction'
        span.textContent = emoji + ' ' + counts[emoji]
        rowR.appendChild(span)
      })
      wrap.appendChild(rowR)
    }

    // Quick-react affordance on agent bubbles only (visitors react to agents)
    if (!fromVisitor && typeof m.id === 'number') {
      var quick = document.createElement('button')
      quick.type = 'button'
      quick.className = 'ctrlm-quick-react'
      quick.textContent = '🙂'
      quick.setAttribute('aria-label', 'Add reaction')
      quick.onclick = function (ev) {
        ev.stopPropagation()
        openReactionPicker(m.id, quick)
      }
      wrap.appendChild(quick)
    }

    return wrap
  }

  function openReactionPicker(messageId, anchor) {
    // Simple overlay menu — positioned absolutely within the panel.
    var menu = document.createElement('div')
    menu.className = 'ctrlm-react-menu'
    var opts = ['👍', '❤️', '😂', '🎉', '🙏', '🔥']
    opts.forEach(function (em) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = em
      btn.onclick = function () {
        sendReaction(messageId, em)
        menu.remove()
      }
      menu.appendChild(btn)
    })
    var rect = anchor.getBoundingClientRect()
    var pRect = panel.getBoundingClientRect()
    menu.style.top = (rect.top - pRect.top - 42) + 'px'
    menu.style.left = Math.max(8, rect.left - pRect.left - 10) + 'px'
    panel.appendChild(menu)
    setTimeout(function () {
      function away(ev) {
        if (!menu.contains(ev.target)) { menu.remove(); panel.removeEventListener('click', away) }
      }
      panel.addEventListener('click', away)
    }, 0)
  }

  function sendReaction(messageId, emoji) {
    if (!session) return
    api('/api/webchat/' + WIDGET_ID + '/react', {
      method: 'POST',
      body: { session: session, messageId: messageId, emoji: emoji },
    }).then(function () { pollOnce() }).catch(function () {})
  }

  // ── Polling ─────────────────────────────────────────────────────────────
  function startPolling() {
    stopPolling()
    var interval = open ? 3000 : 30000
    pollTimer = setInterval(pollOnce, interval)
    pollOnce()
    // Presence refresh alongside thread polls
    loadPresence()
  }

  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null } }

  function pollOnce() {
    if (!session) return
    var qs = '?session=' + encodeURIComponent(session)
    if (lastPolledId) qs += '&since=' + lastPolledId
    api('/api/webchat/' + WIDGET_ID + '/messages' + qs).then(function (res) {
      if (!res.ok) return
      var incoming = (res.json.messages || []).map(normalize)
      if (incoming.length) {
        var hadAgent = false
        for (var i = 0; i < incoming.length; i++) {
          if (incoming[i].id > lastPolledId) lastPolledId = incoming[i].id
          // Only append messages we don't already have (since=lastId keeps
          // this cheap, but guard anyway).
          if (!messages.some(function (m) { return m.id === incoming[i].id })) {
            messages.push(incoming[i])
            if (incoming[i].direction === 'outbound') hadAgent = true
            bus.emit('messageReceived', incoming[i])
          }
        }
        // Rebuild reactions index from the full payload (server echoes all).
        if (res.json.reactions) {
          reactionsById = {}
          for (var r = 0; r < res.json.reactions.length; r++) {
            var rr = res.json.reactions[r]
            ;(reactionsById[rr.message_id] = reactionsById[rr.message_id] || []).push(rr)
          }
        }
        renderThread()
        if (hadAgent && (!open || document.hidden)) {
          unread++
          paintUnreadBadge()
          pingSound()
        }
        // Mark seen up to latest outbound id when visible
        if (open && !document.hidden) {
          var latestOut = 0
          for (var k = 0; k < messages.length; k++) {
            if (messages[k].direction === 'outbound' && typeof messages[k].id === 'number') {
              if (messages[k].id > latestOut) latestOut = messages[k].id
            }
          }
          if (latestOut && latestOut > lastKnownSeenMessageId) {
            lastKnownSeenMessageId = latestOut
            api('/api/webchat/' + WIDGET_ID + '/read', {
              method: 'POST', body: { session: session, upToMessageId: latestOut }
            }).catch(function () {})
          }
        }
      }
    }).catch(function () {})

    // Poll typing independently — it's cheap and only matters when visible
    if (open) {
      api('/api/webchat/' + WIDGET_ID + '/typing?session=' + encodeURIComponent(session))
        .then(function (res) {
          if (!res.ok) return
          agentsTyping = res.json.agents_typing || []
          renderTyping()
        }).catch(function () {})
    }
  }

  function renderTyping() {
    if (agentsTyping.length === 0) {
      ui.typing.style.display = 'none'
      ui.typing.textContent = ''
      return
    }
    ui.typing.style.display = 'flex'
    ui.typing.innerHTML = ''
    var text = document.createElement('span')
    text.textContent = agentsTyping[0] + ' is typing'
    var dots = document.createElement('span')
    dots.className = 'ctrlm-dots'
    dots.innerHTML = '<i></i><i></i><i></i>'
    ui.typing.appendChild(text)
    ui.typing.appendChild(dots)
  }

  function paintUnreadBadge() {
    var b = bubble.querySelector('.ctrlm-badge')
    if (unread > 0) {
      if (!b) {
        b = document.createElement('span')
        b.className = 'ctrlm-badge'
        bubble.appendChild(b)
      }
      b.textContent = unread > 9 ? '9+' : String(unread)
    } else if (b) {
      b.remove()
    }
  }

  // ── Ping sound (base64 short blip, no external fetch) ──────────────────
  var audioCtx
  function pingSound() {
    if (!audioEnabled) return
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      var o = audioCtx.createOscillator()
      var g = audioCtx.createGain()
      o.connect(g); g.connect(audioCtx.destination)
      o.type = 'sine'
      o.frequency.setValueAtTime(880, audioCtx.currentTime)
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.12, audioCtx.currentTime + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.25)
      o.start(); o.stop(audioCtx.currentTime + 0.26)
    } catch (e) {}
  }

  // ── Open/close bubble ──────────────────────────────────────────────────
  function openPanel() {
    open = true; writeStr(OPEN_KEY, '1')
    panel.classList.add('open')
    unread = 0; paintUnreadBadge()
    if (!session && !introSent) {
      ui.intro.classList.add('show')
    } else if (widgetConfig && !widgetConfig.agent_online && messages.length === 0 && widgetConfig.offline_capture_enabled) {
      // First-time offline visitor — surface the leave-us-a-message form
      // instead of the live composer.
      ui.offline.classList.add('show')
    }
    startPolling()
    bus.emit('opened', { widgetId: WIDGET_ID })
  }
  function closePanel() {
    open = false; writeStr(OPEN_KEY, '0')
    panel.classList.remove('open')
    startPolling() // slower cadence
    bus.emit('closed', { widgetId: WIDGET_ID })
  }

  bubble.addEventListener('click', function () { open ? closePanel() : openPanel() })
  ui.close.addEventListener('click', closePanel)

  // ── Typing heartbeat ────────────────────────────────────────────────────
  var typingLastSent = 0
  function sendTyping(isTyping) {
    if (!session) return
    var now = Date.now()
    if (isTyping && now - typingLastSent < 2000) return
    typingLastSent = now
    api('/api/webchat/' + WIDGET_ID + '/typing', {
      method: 'POST', body: { session: session, isTyping: Boolean(isTyping) }
    }).catch(function () {})
  }

  ui.textarea.addEventListener('input', function () {
    sendTyping(true)
    clearTimeout(typingTimer)
    typingTimer = setTimeout(function () { sendTyping(false) }, 2500)
    autoSize(ui.textarea)
  })

  ui.textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitMessage()
    }
  })

  // ── Submit message ──────────────────────────────────────────────────────
  ui.form.addEventListener('submit', function (e) {
    e.preventDefault()
    submitMessage()
  })

  function submitMessage() {
    var text = ui.textarea.value.trim()
    if (!text && pendingAttachments.length === 0) return
    if (!session && !introSent) {
      // Show intro gate
      ui.intro.classList.add('show')
      return
    }
    var payload = {
      session: session || undefined,
      message: text,
      attachments: pendingAttachments,
    }
    if (!session && identity) {
      payload.name = identity.name
      payload.email = identity.email
      payload.phone = identity.phone
    }
    setError(null)
    ui.sendBtn.disabled = true
    api('/api/webchat/' + WIDGET_ID + '/messages', { method: 'POST', body: payload })
      .then(function (res) {
        if (!res.ok) {
          setError(res.json && res.json.error || 'Could not send')
          return
        }
        session = res.json.session
        writeStr(SESSION_KEY, session)
        introSent = true
        ui.textarea.value = ''
        autoSize(ui.textarea)
        pendingAttachments = []
        renderAttachments()
        if (res.json.message) {
          messages.push(normalize(res.json.message))
          if (res.json.message.id > lastPolledId) lastPolledId = res.json.message.id
          renderThread()
          bus.emit('messageSent', res.json.message)
        }
        sendTyping(false)
      })
      .catch(function (e) { setError(String(e && e.message || e)) })
      .then(function () { ui.sendBtn.disabled = false })
  }

  // ── Intro form ──────────────────────────────────────────────────────────
  ui.introForm.addEventListener('submit', function (e) {
    e.preventDefault()
    var fd = new FormData(ui.introForm)
    var name = String(fd.get('name') || '').trim()
    var email = String(fd.get('email') || '').trim()
    var phone = String(fd.get('phone') || '').trim()
    if (!name || (!email && !phone)) {
      setError('Please enter your name and email or phone.')
      return
    }
    identity = { name: name, email: email, phone: phone }
    writeJson(IDENTITY_KEY, identity)
    ui.intro.classList.remove('show')
    setError(null)
    // Submit the composer's text alongside intro data in the same POST
    submitMessage()
  })

  // ── Offline form ───────────────────────────────────────────────────────
  ui.offlineForm.addEventListener('submit', function (e) {
    e.preventDefault()
    var fd = new FormData(ui.offlineForm)
    var name = String(fd.get('name') || '').trim()
    var email = String(fd.get('email') || '').trim()
    var phone = String(fd.get('phone') || '').trim()
    var message = String(fd.get('message') || '').trim()
    if (!name || !email || !message) { setError('Name, email and message are required.'); return }
    api('/api/webchat/' + WIDGET_ID + '/offline', {
      method: 'POST', body: { name: name, email: email, phone: phone, message: message }
    }).then(function (res) {
      if (!res.ok) { setError(res.json && res.json.error || 'Could not send'); return }
      ui.offlineNote.textContent = 'Thanks! We will reply by email as soon as we can.'
      ui.offlineNote.style.display = 'block'
      ui.offlineForm.style.display = 'none'
      bus.emit('offlineSubmitted', { name: name, email: email })
    }).catch(function (e) { setError(String(e && e.message || e)) })
  })

  // ── Attachments ─────────────────────────────────────────────────────────
  ui.attach.addEventListener('click', function () { ui.attachInput.click() })
  ui.attachInput.addEventListener('change', function () {
    var file = ui.attachInput.files && ui.attachInput.files[0]
    if (!file) return
    if (!session) { setError('Please send your first message before attaching a file.'); return }
    setError(null)
    var form = new FormData()
    form.append('file', file)
    form.append('session', session)
    fetch(API + '/api/webchat/' + WIDGET_ID + '/upload', { method: 'POST', body: form, credentials: 'omit' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j } }) })
      .then(function (res) {
        if (!res.ok) { setError(res.json && res.json.error || 'Upload failed'); return }
        pendingAttachments.push(res.json)
        renderAttachments()
      })
      .catch(function (e) { setError(String(e && e.message || e)) })
      .then(function () { ui.attachInput.value = '' })
  })

  function renderAttachments() {
    ui.attachments.innerHTML = ''
    if (pendingAttachments.length === 0) { ui.attachments.style.display = 'none'; return }
    ui.attachments.style.display = 'flex'
    pendingAttachments.forEach(function (a, idx) {
      var chip = document.createElement('span')
      chip.className = 'ctrlm-chip'
      chip.textContent = '📎 ' + a.filename
      var x = document.createElement('button')
      x.type = 'button'; x.textContent = '×'
      x.onclick = function () { pendingAttachments.splice(idx, 1); renderAttachments() }
      chip.appendChild(x)
      ui.attachments.appendChild(chip)
    })
  }

  // ── Emoji picker ────────────────────────────────────────────────────────
  var EMOJIS = ['😀','😁','😂','🤣','😅','😊','🙏','👍','👎','🔥','🎉','❤️','💯','👀','✨','🙌','💪','🤔','😢','😎','🚀','⚡','💡','📌','✅']
  ui.emojiPop.innerHTML = EMOJIS.map(function (e) { return '<button type="button">' + e + '</button>' }).join('')
  ui.emojiPop.addEventListener('click', function (ev) {
    var t = ev.target
    if (t && t.tagName === 'BUTTON') {
      var sel = ui.textarea.selectionStart || ui.textarea.value.length
      ui.textarea.value = ui.textarea.value.slice(0, sel) + t.textContent + ui.textarea.value.slice(sel)
      ui.textarea.focus()
      ui.emojiPop.classList.remove('show')
      autoSize(ui.textarea)
    }
  })
  ui.emojiBtn.addEventListener('click', function () { ui.emojiPop.classList.toggle('show') })

  // ── Browser push consent (best-effort only if pre-authorized) ──────────
  if (config.pushPreauthorized && 'Notification' in window && Notification.permission === 'default') {
    try { Notification.requestPermission().catch(function () {}) } catch (e) {}
  }
  bus.on('messageReceived', function (m) {
    if (m.direction !== 'outbound') return
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(widgetConfig && widgetConfig.name || 'New message', { body: m.body.slice(0, 120) }) } catch (e) {}
    }
  })

  // ── Initial load sequence ───────────────────────────────────────────────
  loadConfig().then(function () {
    if (open) panel.classList.add('open')
    startPolling()
    if (open) {
      // If the chat was open on a prior page, re-open with polling immediately.
      openPanel()
    }
  }).catch(function (e) {
    // If config fails, hide the bubble silently — the widgetId is bad or
    // network is blocked.
    host.remove()
  })

  // ── Utility ─────────────────────────────────────────────────────────────
  function setError(msg) {
    if (!msg) { ui.error.textContent = ''; ui.error.style.display = 'none'; return }
    ui.error.textContent = msg; ui.error.style.display = 'block'
  }

  function fmtTime(ts) {
    if (!ts) return ''
    try {
      return new Date(ts * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    } catch (e) { return '' }
  }

  function autoSize(t) {
    t.style.height = 'auto'
    t.style.height = Math.min(140, t.scrollHeight) + 'px'
  }

  function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;') }

  function apiOrigin(url) {
    if (!url) return ''
    if (/^https?:/i.test(url)) return url
    if (url.charAt(0) === '/') return API + url
    return url
  }

  // ── Inline SVG + templates ──────────────────────────────────────────────
  function BUBBLE_SVG() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>' +
      '</svg>'
  }

  function PANEL_HTML() {
    return '' +
      '<div class="ctrlm-header">' +
        '<div class="ctrlm-header-left">' +
          '<div class="ctrlm-avatar"></div>' +
          '<div>' +
            '<div class="ctrlm-title-row">' +
              '<span class="ctrlm-dot offline"></span>' +
              '<span class="ctrlm-title">Chat</span>' +
            '</div>' +
            '<div class="ctrlm-subtitle">Loading…</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="ctrlm-close" aria-label="Close chat">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="ctrlm-thread" role="log" aria-live="polite"></div>' +
      '<div class="ctrlm-typing" style="display:none"></div>' +
      '<div class="ctrlm-error" role="alert" style="display:none"></div>' +
      // Intro gate
      '<div class="ctrlm-intro">' +
        '<form class="ctrlm-intro-form">' +
          '<div class="ctrlm-intro-title">Before we chat…</div>' +
          '<label>Your name<input name="name" required autocomplete="name"></label>' +
          '<label>Email<input name="email" type="email" required autocomplete="email"></label>' +
          '<label>Phone (optional)<input name="phone" type="tel" autocomplete="tel"></label>' +
          '<button type="submit">Start chat</button>' +
        '</form>' +
      '</div>' +
      // Offline form
      '<div class="ctrlm-offline">' +
        '<form class="ctrlm-offline-form">' +
          '<div class="ctrlm-intro-title">Leave us a message</div>' +
          '<div class="ctrlm-offline-sub">We will reply by email.</div>' +
          '<label>Your name<input name="name" required autocomplete="name"></label>' +
          '<label>Email<input name="email" type="email" required autocomplete="email"></label>' +
          '<label>Phone (optional)<input name="phone" type="tel" autocomplete="tel"></label>' +
          '<label>Message<textarea name="message" rows="3" required></textarea></label>' +
          '<button type="submit">Send</button>' +
        '</form>' +
        '<div class="ctrlm-offline-note" style="display:none"></div>' +
      '</div>' +
      // Attachments chips
      '<div class="ctrlm-attachments" style="display:none"></div>' +
      // Composer
      '<form class="ctrlm-composer">' +
        '<button type="button" class="ctrlm-attach" aria-label="Attach file">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83L15.07 6.1"/></svg>' +
        '</button>' +
        '<input type="file" class="ctrlm-attach-input" hidden>' +
        '<textarea class="ctrlm-input" rows="1" placeholder="Type a message…"></textarea>' +
        '<div class="ctrlm-emoji-wrap">' +
          '<button type="button" class="ctrlm-emoji-btn" aria-label="Insert emoji">😊</button>' +
          '<div class="ctrlm-emoji-pop"></div>' +
        '</div>' +
        '<button type="submit" class="ctrlm-send" aria-label="Send">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
        '</button>' +
      '</form>'
  }

  function STYLES() {
    return [
      ':host, .ctrlm-container{',
        '--ctrlm-accent:#D97757;',
        '--ctrlm-bg:#ffffff;',
        '--ctrlm-fg:#1a1b1a;',
        '--ctrlm-muted:#6b6b6b;',
        '--ctrlm-border:rgba(0,0,0,0.08);',
        '--ctrlm-surface:#f7f6f2;',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,sans-serif;',
        'font-size:14px;color:var(--ctrlm-fg);',
      '}',
      '.ctrlm-container{color-scheme:light;}',
      '@media (prefers-color-scheme: dark){',
        '.ctrlm-container{--ctrlm-bg:#1a1b1a;--ctrlm-fg:#f1ede5;--ctrlm-muted:#9a9a9a;--ctrlm-border:rgba(255,255,255,0.1);--ctrlm-surface:#24262a;}',
      '}',
      // Bubble
      '.ctrlm-bubble{position:relative;width:56px;height:56px;border-radius:50%;background:var(--ctrlm-accent);color:#fff;border:none;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .2s ease;}',
      '.ctrlm-bubble:hover{transform:translateY(-2px);}',
      '.ctrlm-bubble svg{width:24px;height:24px;color:#fff;}',
      '.ctrlm-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#e45050;color:#fff;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2);}',
      // Panel
      '.ctrlm-panel{position:absolute;bottom:72px;right:0;width:380px;height:600px;max-height:calc(100vh - 100px);background:var(--ctrlm-bg);border-radius:16px;box-shadow:0 30px 60px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden;border:1px solid var(--ctrlm-border);}',
      '.ctrlm-panel.open{display:flex;}',
      '@media (max-width: 520px){',
        '.ctrlm-panel{position:fixed !important;inset:0 !important;width:100% !important;height:100% !important;max-height:100% !important;border-radius:0;bottom:0;right:0;}',
        '.ctrlm-bubble{width:52px;height:52px;}',
      '}',
      // Header
      '.ctrlm-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px;border-bottom:1px solid var(--ctrlm-border);background:var(--ctrlm-surface);}',
      '.ctrlm-header-left{display:flex;align-items:center;gap:10px;min-width:0;}',
      '.ctrlm-avatar{width:36px;height:36px;border-radius:50%;background:var(--ctrlm-accent);color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;font-weight:600;}',
      '.ctrlm-avatar img{width:100%;height:100%;object-fit:cover;}',
      '.ctrlm-title-row{display:flex;align-items:center;gap:6px;}',
      '.ctrlm-title{font-weight:600;font-size:14px;letter-spacing:-.005em;}',
      '.ctrlm-subtitle{font-size:12px;color:var(--ctrlm-muted);margin-top:2px;}',
      '.ctrlm-dot{width:8px;height:8px;border-radius:50%;background:#9a9a9a;}',
      '.ctrlm-dot.online{background:#4ca57a;box-shadow:0 0 0 2px rgba(76,165,122,.25);}',
      '.ctrlm-dot.away{background:#d9a040;}',
      '.ctrlm-close{background:none;border:none;cursor:pointer;color:var(--ctrlm-muted);width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;}',
      '.ctrlm-close:hover{background:var(--ctrlm-border);}',
      '.ctrlm-close svg{width:16px;height:16px;}',
      // Thread
      '.ctrlm-thread{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:8px;}',
      '.ctrlm-row{display:flex;flex-direction:column;gap:2px;max-width:82%;position:relative;}',
      '.ctrlm-row.from-visitor{align-self:flex-end;align-items:flex-end;}',
      '.ctrlm-row.from-agent{align-self:flex-start;align-items:flex-start;}',
      '.ctrlm-msg{padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;}',
      '.ctrlm-row.from-visitor .ctrlm-msg{background:var(--ctrlm-accent);color:#fff;border-bottom-right-radius:4px;}',
      '.ctrlm-row.from-agent .ctrlm-msg{background:var(--ctrlm-surface);color:var(--ctrlm-fg);border:1px solid var(--ctrlm-border);border-bottom-left-radius:4px;}',
      '.ctrlm-meta{font-size:10px;color:var(--ctrlm-muted);padding:0 2px;}',
      '.ctrlm-attachment-link{font-size:12px;color:var(--ctrlm-muted);text-decoration:none;border-bottom:1px dotted var(--ctrlm-border);padding:2px 0;}',
      '.ctrlm-reactions{display:flex;gap:4px;flex-wrap:wrap;}',
      '.ctrlm-reaction{font-size:11px;padding:2px 6px;border-radius:10px;background:var(--ctrlm-surface);border:1px solid var(--ctrlm-border);}',
      '.ctrlm-quick-react{position:absolute;top:-10px;right:-2px;background:var(--ctrlm-bg);border:1px solid var(--ctrlm-border);width:24px;height:24px;border-radius:50%;display:none;cursor:pointer;font-size:12px;}',
      '.ctrlm-row.from-agent:hover .ctrlm-quick-react{display:flex;align-items:center;justify-content:center;}',
      '.ctrlm-react-menu{position:absolute;background:var(--ctrlm-bg);border:1px solid var(--ctrlm-border);border-radius:10px;padding:4px;display:flex;gap:2px;box-shadow:0 8px 18px rgba(0,0,0,.18);z-index:4;}',
      '.ctrlm-react-menu button{background:none;border:none;cursor:pointer;font-size:18px;padding:4px 6px;border-radius:6px;}',
      '.ctrlm-react-menu button:hover{background:var(--ctrlm-surface);}',
      // Typing
      '.ctrlm-typing{padding:4px 16px 8px;font-size:11.5px;color:var(--ctrlm-muted);display:flex;align-items:center;gap:6px;}',
      '.ctrlm-dots{display:inline-flex;gap:2px;}',
      '.ctrlm-dots i{width:4px;height:4px;border-radius:50%;background:var(--ctrlm-muted);display:inline-block;animation:ctrlmBlink 1s infinite ease-in-out;}',
      '.ctrlm-dots i:nth-child(2){animation-delay:.15s;}',
      '.ctrlm-dots i:nth-child(3){animation-delay:.30s;}',
      '@keyframes ctrlmBlink{0%,80%,100%{opacity:.25;}40%{opacity:1;}}',
      // Intro + offline
      '.ctrlm-intro,.ctrlm-offline{display:none;padding:16px;border-top:1px solid var(--ctrlm-border);background:var(--ctrlm-surface);}',
      '.ctrlm-intro.show,.ctrlm-offline.show{display:block;}',
      '.ctrlm-intro form,.ctrlm-offline form{display:flex;flex-direction:column;gap:8px;}',
      '.ctrlm-intro label,.ctrlm-offline label{display:flex;flex-direction:column;font-size:11px;color:var(--ctrlm-muted);gap:4px;}',
      '.ctrlm-intro input,.ctrlm-offline input,.ctrlm-offline textarea{padding:8px 10px;border-radius:8px;border:1px solid var(--ctrlm-border);background:var(--ctrlm-bg);color:var(--ctrlm-fg);font-family:inherit;font-size:13px;}',
      '.ctrlm-intro button,.ctrlm-offline button{padding:9px 14px;border-radius:8px;border:none;background:var(--ctrlm-accent);color:#fff;font-weight:500;cursor:pointer;}',
      '.ctrlm-intro-title{font-size:13px;font-weight:600;color:var(--ctrlm-fg);}',
      '.ctrlm-offline-sub{font-size:11px;color:var(--ctrlm-muted);margin:-4px 0 4px;}',
      '.ctrlm-offline-note{padding:10px 12px;border-radius:8px;background:var(--ctrlm-bg);font-size:12.5px;color:var(--ctrlm-fg);border:1px solid var(--ctrlm-border);}',
      // Composer
      '.ctrlm-composer{display:flex;align-items:flex-end;gap:6px;padding:10px 10px 12px;border-top:1px solid var(--ctrlm-border);background:var(--ctrlm-bg);position:relative;}',
      '.ctrlm-composer button{background:none;border:none;cursor:pointer;color:var(--ctrlm-muted);width:34px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
      '.ctrlm-composer button:hover{background:var(--ctrlm-surface);color:var(--ctrlm-fg);}',
      '.ctrlm-composer svg{width:18px;height:18px;}',
      '.ctrlm-send{color:var(--ctrlm-accent) !important;}',
      '.ctrlm-input{flex:1;border:1px solid var(--ctrlm-border);background:var(--ctrlm-surface);color:var(--ctrlm-fg);border-radius:10px;padding:8px 10px;resize:none;font-family:inherit;font-size:13.5px;line-height:1.4;max-height:140px;min-height:34px;outline:none;}',
      '.ctrlm-input:focus{border-color:var(--ctrlm-accent);}',
      '.ctrlm-emoji-wrap{position:relative;}',
      '.ctrlm-emoji-pop{display:none;position:absolute;bottom:40px;right:-4px;width:220px;max-height:180px;overflow-y:auto;background:var(--ctrlm-bg);border:1px solid var(--ctrlm-border);border-radius:10px;padding:6px;box-shadow:0 10px 24px rgba(0,0,0,.2);grid-template-columns:repeat(8, 1fr);gap:2px;}',
      '.ctrlm-emoji-pop.show{display:grid;}',
      '.ctrlm-emoji-pop button{background:none;border:none;cursor:pointer;padding:4px;font-size:18px;border-radius:6px;width:auto;height:auto;}',
      '.ctrlm-emoji-pop button:hover{background:var(--ctrlm-surface);}',
      '.ctrlm-attachments{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px;border-top:1px solid var(--ctrlm-border);background:var(--ctrlm-surface);}',
      '.ctrlm-chip{display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:10px;background:var(--ctrlm-bg);border:1px solid var(--ctrlm-border);font-size:12px;color:var(--ctrlm-fg);}',
      '.ctrlm-chip button{background:none;border:none;cursor:pointer;color:var(--ctrlm-muted);font-size:14px;line-height:1;padding:0 0 0 2px;}',
      // Error
      '.ctrlm-error{padding:8px 16px;background:rgba(228,80,80,.1);color:#b03b3b;font-size:12px;border-top:1px solid rgba(228,80,80,.3);}',
    ].join('')
  }
})()
