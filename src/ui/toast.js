// Lightweight, dependency-free toast notifications — a polite live region so
// background successes and failures (vault saves, sync errors, update-ready)
// surface without a blocking alert(). Created lazily; no markup needed in HTML.

let host = null

function ensureHost() {
  if (host && document.body.contains(host)) return host
  host = document.createElement('div')
  host.className = 'toast-host'
  host.setAttribute('role', 'status')
  host.setAttribute('aria-live', 'polite')
  document.body.appendChild(host)
  return host
}

/**
 * Show a toast.
 * @param {string} message
 * @param {{type?:'info'|'success'|'error', timeout?:number, action?:{label:string, onClick:Function}}} [opts]
 *   timeout in ms (0 = sticky until dismissed). An action renders a button.
 * @returns {() => void} a function that dismisses the toast
 */
export function toast(message, { type = 'info', timeout = 4000, action = null } = {}) {
  const h = ensureHost()
  const el = document.createElement('div')
  el.className = `toast toast-${type}`

  const text = document.createElement('span')
  text.className = 'toast-msg'
  text.textContent = message
  el.append(text)

  const dismiss = () => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 200)
  }

  if (action) {
    const btn = document.createElement('button')
    btn.className = 'toast-action'
    btn.textContent = action.label
    btn.addEventListener('click', () => { try { action.onClick() } finally { dismiss() } })
    el.append(btn)
  }

  const close = document.createElement('button')
  close.className = 'toast-close'
  close.setAttribute('aria-label', 'Dismiss')
  close.textContent = '✕'
  close.addEventListener('click', dismiss)
  el.append(close)

  h.append(el)
  requestAnimationFrame(() => el.classList.add('show'))
  if (timeout) setTimeout(dismiss, timeout)
  return dismiss
}
