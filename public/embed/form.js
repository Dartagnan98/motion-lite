/**
 * CTRL form embed loader (plain browser JS, no modules).
 *
 *   <div id="ctrl-form-<publicId>"></div>
 *   <script src="https://app.example.com/embed/form.js"
 *           data-form="<publicId>" async></script>
 *
 * The script finds every <script data-form> + matching <div id="ctrl-form-…">
 * on the page, injects an iframe pointing at /f/<publicId>, and listens for
 * resize / submitted postMessage events from the iframe.
 *
 * Submit hook: if window.CtrlFormOnSubmit is a function, it is called with
 * the formId when the iframe posts ctrl-form:submitted.
 */
(function () {
  if (typeof window === 'undefined') return
  if (window.__CtrlFormEmbedLoaded) return
  window.__CtrlFormEmbedLoaded = true

  var scriptEl = document.currentScript
  var origin = (function () {
    try {
      if (scriptEl && scriptEl.src) return new URL(scriptEl.src).origin
    } catch (_) {}
    return window.location.origin
  })()

  var mounted = {}

  function mount(formId) {
    if (!formId || mounted[formId]) return
    var host = document.getElementById('ctrl-form-' + formId)
    if (!host) {
      // No matching container — fall back to inserting right after the script.
      if (scriptEl && scriptEl.parentNode) {
        host = document.createElement('div')
        host.id = 'ctrl-form-' + formId
        scriptEl.parentNode.insertBefore(host, scriptEl.nextSibling)
      } else {
        return
      }
    }
    host.innerHTML = ''
    var iframe = document.createElement('iframe')
    iframe.src = origin + '/f/' + encodeURIComponent(formId)
    iframe.setAttribute('title', 'Form')
    iframe.setAttribute('loading', 'lazy')
    iframe.style.width = '100%'
    iframe.style.border = '0'
    iframe.style.borderRadius = '12px'
    iframe.style.display = 'block'
    iframe.style.height = '640px'
    iframe.setAttribute('data-ctrl-form', formId)
    host.appendChild(iframe)
    mounted[formId] = iframe
  }

  function mountAll() {
    var scripts = document.querySelectorAll('script[data-form]')
    for (var i = 0; i < scripts.length; i++) {
      var formId = scripts[i].getAttribute('data-form')
      if (formId) mount(formId)
    }
    var containers = document.querySelectorAll('[id^="ctrl-form-"]')
    for (var j = 0; j < containers.length; j++) {
      var id = containers[j].id.replace(/^ctrl-form-/, '')
      if (id && !mounted[id]) mount(id)
    }
  }

  function onMessage(event) {
    var data = event && event.data
    if (!data || typeof data !== 'object') return
    var formId = data.formId
    if (!formId || !mounted[formId]) return
    if (data.type === 'ctrl-form:resize' && typeof data.height === 'number') {
      var h = Math.max(200, Math.min(4000, Math.round(data.height)))
      mounted[formId].style.height = h + 'px'
    } else if (data.type === 'ctrl-form:submitted') {
      if (typeof window.CtrlFormOnSubmit === 'function') {
        try { window.CtrlFormOnSubmit(formId, data.variant || null) } catch (_) {}
      }
    } else if (data.type === 'ctrl-form:viewed') {
      // The iframe tells us which A/B variant rendered so the tracking pixel
      // can attribute views/conversions properly. Optional hook: if the host
      // page defines window.CtrlFormOnView it gets called with formId +
      // variant ('A' | 'B' | null).
      if (typeof window.CtrlFormOnView === 'function') {
        try { window.CtrlFormOnView(formId, data.variant || null) } catch (_) {}
      }
    }
  }

  window.addEventListener('message', onMessage, false)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountAll)
  } else {
    mountAll()
  }
})()
