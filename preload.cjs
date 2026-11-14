const { contextBridge } = require('electron')

const argv = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv : []
function argValue(prefix) {
  const found = argv.find((arg) => typeof arg === 'string' && arg.startsWith(prefix))
  return found === undefined ? '' : found.slice(prefix.length)
}

contextBridge.exposeInMainWorld('__DSH_INK_STANDALONE__', {
  root: argValue('--dsh-ink-project='),
  file: argValue('--dsh-ink-file='),
})

const fs = require('node:fs')
const sharedPath = argValue('--dsh-ink-state=')
if (sharedPath !== '') {
  try {
    const shared = JSON.parse(fs.readFileSync(sharedPath, 'utf8'))
    const storage = shared !== null && typeof shared === 'object' ? shared.storage : null
    if (storage !== null && typeof storage === 'object') {
      for (const [key, value] of Object.entries(storage)) {
        if (typeof value === 'string' && key.startsWith('dsh-ink')) {
          localStorage.setItem(key, value)
        }
      }
    }
    localStorage.setItem(
      'dsh-ink:shared-tabs',
      JSON.stringify(shared !== null && Array.isArray(shared.tabs) ? shared.tabs : []),
    )
    localStorage.setItem(
      'dsh-ink:shared-buffers',
      JSON.stringify(
        shared !== null && shared.buffers !== null && typeof shared.buffers === 'object'
          ? shared.buffers
          : {},
      ),
    )
  } catch {
    // Missing shared state only means the window starts with defaults.
  }
}

// This preload only runs in the dedicated Ink BrowserWindow. It hides the DSH
// shell independently of the plugin client (and survives React re-renders).
let frame = 0

function isolate() {
  const root = document.querySelector('[data-dsh-ink-root]')
  if (root === null) return

  let node = root
  while (node !== null && node !== document.body) {
    const parent = node.parentElement
    if (parent === null) break
    for (const child of Array.from(parent.children)) {
      if (child === node) continue
      if (
        child.style.getPropertyValue('display') !== 'none' ||
        child.style.getPropertyPriority('display') !== 'important'
      ) {
        child.style.setProperty('display', 'none', 'important')
      }
    }
    node = parent
  }

  let path = root
  while (path !== null) {
    const set = (name, value) => {
      if (
        path.style.getPropertyValue(name) !== value ||
        path.style.getPropertyPriority(name) !== 'important'
      ) {
        path.style.setProperty(name, value, 'important')
      }
    }
    set('width', '100%')
    set('height', '100%')
    set('min-width', '0')
    set('min-height', '0')
    set('overflow', 'hidden')
    path = path.parentElement
  }

  if (
    document.body.style.getPropertyValue('overflow') !== 'hidden' ||
    document.body.style.getPropertyPriority('overflow') !== 'important'
  ) {
    document.body.style.setProperty('overflow', 'hidden', 'important')
  }
  if (document.title !== 'Ink 写作') {
    document.title = 'Ink 写作'
  }
}

function schedule() {
  if (frame !== 0) return
  frame = window.requestAnimationFrame(() => {
    frame = 0
    isolate()
  })
}

const observer = new MutationObserver(schedule)
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['style', 'class'],
})
window.addEventListener('DOMContentLoaded', schedule)
schedule()
