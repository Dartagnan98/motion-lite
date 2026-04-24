/* Ctrl pixel — site-side event tracking.
 * <script src="https://app.example.com/pixel/ctrl.js" data-workspace="PUBLIC_ID" async></script>
 * window.ctrl.track(event, props?)  — custom event
 * window.ctrl.identify(email)       — bind anonymous cid to a contact by email
 */
(function () {
  if (typeof window === 'undefined') return
  var doc = document
  var scriptEl = doc.currentScript || (function () {
    var all = doc.getElementsByTagName('script')
    for (var i = all.length - 1; i >= 0; i--) {
      var s = all[i]
      if (s.src && s.src.indexOf('/pixel/ctrl.js') !== -1) return s
    }
    return null
  })()
  var workspace = scriptEl ? scriptEl.getAttribute('data-workspace') : null
  if (!workspace) return
  var origin = scriptEl && scriptEl.src ? scriptEl.src.replace(/\/pixel\/ctrl\.js.*$/, '') : ''
  var trackUrl = origin + '/api/pixel/track'
  var identifyUrl = origin + '/api/pixel/identify'

  function cid() {
    try {
      var k = 'ctrl_cid'
      var existing = window.localStorage.getItem(k)
      if (existing) return existing
      var fresh = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : (Date.now().toString(36) + Math.random().toString(36).slice(2, 10))
      window.localStorage.setItem(k, fresh)
      return fresh
    } catch (_e) {
      return ''
    }
  }

  function beacon(url, payload) {
    try {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return
    } catch (_e) { /* fall through */ }
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
    } catch (_e) { /* swallow */ }
  }

  function pageview(extra) {
    beacon(trackUrl, Object.assign({
      workspace: workspace,
      event: 'pageview',
      url: location.href,
      title: doc.title,
      referrer: doc.referrer,
      t: Date.now(),
      cid: cid(),
    }, extra || {}))
  }

  function track(event, props) {
    beacon(trackUrl, {
      workspace: workspace,
      event: String(event || 'custom'),
      url: location.href,
      title: doc.title,
      referrer: doc.referrer,
      props: props || null,
      t: Date.now(),
      cid: cid(),
    })
  }

  function identify(email) {
    if (!email || typeof email !== 'string') return
    beacon(identifyUrl, {
      workspace: workspace,
      cid: cid(),
      email: email,
      t: Date.now(),
    })
  }

  window.ctrl = { track: track, identify: identify, _v: 1 }

  // Fire initial pageview. Re-fire on SPA navigation via history API.
  pageview()
  var push = history.pushState
  history.pushState = function () {
    var ret = push.apply(this, arguments)
    setTimeout(pageview, 0)
    return ret
  }
  window.addEventListener('popstate', function () { setTimeout(pageview, 0) })
})()
