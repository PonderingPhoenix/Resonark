// Accessible modal behaviour for the overlays, layered on WITHOUT rewriting the
// existing `overlay.hidden = …` toggles. A MutationObserver watches each overlay's
// `hidden` attribute: on open we remember the trigger and move focus in; on close
// we restore focus. Tab is trapped within the open overlay, and a click on the
// backdrop (the overlay itself, not its inner panel) closes it.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const focusableIn = (root) =>
  [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)

/**
 * @param {HTMLElement[]} overlays  the dialog elements (each toggled via .hidden)
 */
export function initModals(overlays) {
  const list = overlays.filter(Boolean)
  let returnTo = null

  const openOne = () => list.find((o) => !o.hidden)

  const onOpen = (o) => {
    returnTo = document.activeElement
    const target = focusableIn(o)[0] || o
    // Defer so layout settles (some overlays populate their body on open).
    requestAnimationFrame(() => target.focus?.())
  }
  const onClose = () => {
    if (returnTo && document.contains(returnTo)) returnTo.focus?.()
    returnTo = null
  }

  for (const o of list) {
    o.__open = !o.hidden
    if (o.__open) onOpen(o)
    new MutationObserver(() => {
      const nowOpen = !o.hidden
      if (nowOpen === o.__open) return
      o.__open = nowOpen
      nowOpen ? onOpen(o) : onClose()
    }).observe(o, { attributes: true, attributeFilter: ['hidden'] })

    // Backdrop click closes (only when the click lands on the overlay itself).
    o.addEventListener('mousedown', (e) => {
      if (e.target === o) o.hidden = true
    })
  }

  // Trap Tab inside whichever overlay is open.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return
    const o = openOne()
    if (!o) return
    const items = focusableIn(o)
    if (!items.length) { e.preventDefault(); o.focus?.(); return }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (!o.contains(active)) { e.preventDefault(); first.focus() }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
  })
}
