/**
 * Host half of the Ink writing panel (bundle `@local/dsh-ink`).
 *
 * The browser half owns the editor; this side owns the project directory:
 * list `.ink` files, read/write them, scan the tag vocabulary out of their
 * content, compile them with the official `inkjs` compiler (the same
 * compiler Inky is built on) so the panel can show real errors, and launch
 * Inky on the current file. Inky watches the file on disk, so a save here is
 * picked up there without any window automation.
 *
 * Every route is JSON under `/dsh-ink/api/`; writes are restricted to the
 * configured project directory and to `.ink` files.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import z from '@deepseek-ai/schemastery'
// Vendored copy of the official ink compiler (inkjs, MIT). A linked local
// bundle does not get its npm dependencies installed, so the compiler ships
// with the panel instead of being resolved from node_modules.
import { Compiler } from './vendor/inkjs/ink-full.mjs'

export const inject = ['webServer', 'connection']

export const Config = z.object({
  projectDir: z.string().default('D:\\inky\\project'),
  inkyPath: z.string().default('D:\\inky\\Inky_windows_64\\Inky.exe'),
  maxFileBytes: z.number().min(1024).max(16 * 1024 * 1024).default(4 * 1024 * 1024),
})

const API_PREFIX = '/dsh-ink/api'
const MAX_BODY_BYTES = 16 * 1024 * 1024
const MAX_SCAN_BYTES = 8 * 1024 * 1024
const MAX_OUTLINE_BYTES = 8 * 1024 * 1024
const MAX_OUTLINE_FILE_BYTES = 2 * 1024 * 1024
const PREVIEW_TTL_MS = 10 * 60 * 1000
const PREVIEW_MAX_SESSIONS = 20
const PREVIEW_MAX_STEPS = 500

/**
 * Open a native Electron window on the DSH Desktop host. The window shares
 * the main DSH window's session so the panel is already authenticated.
 * Returns `{ ok: false, mode: 'web' }` when this host is not Electron.
 */
async function openDesktopInkWindow(url) {
  if (process.versions.electron === undefined) return { ok: false, mode: 'web' }
  const target = new URL(url)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('invalid window url')
  }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(target.hostname)) {
    throw new Error('only local DSH windows are allowed')
  }
  let electron
  try {
    electron = await import('electron')
  } catch {
    return { ok: false, mode: 'web' }
  }
  const BrowserWindow = electron.BrowserWindow ?? electron.default?.BrowserWindow
  if (typeof BrowserWindow !== 'function') return { ok: false, mode: 'web' }

  let source
  try {
    source = BrowserWindow.getAllWindows().find((candidate) => {
      try {
        return new URL(candidate.webContents.getURL()).origin === target.origin
      } catch {
        return false
      }
    })
  } catch {
    // No window enumeration: fall back to the default session.
  }

  const options = {
    width: 1280,
    height: 900,
    minWidth: 720,
    minHeight: 520,
    autoHideMenuBar: true,
    title: 'Ink 写作',
  }
  if (source !== undefined) {
    options.webPreferences = { session: source.webContents.session }
  }
  let win
  try {
    win = new BrowserWindow(options)
  } catch {
    // Some Electron builds reject the session option; default session still
    // reaches the loopback DSH page in most setups.
    options.webPreferences = undefined
    win = new BrowserWindow(options)
  }
  win.setMenuBarVisibility(false)
  try {
    await win.loadURL(url)
  } catch (error) {
    win.close()
    throw error
  }
  return { ok: true, mode: 'electron', window: win }
}

/** Display text for one ink runtime value (int/float/string/bool/list). */
function previewVariableText(value) {
  if (value === null || value === undefined) return ''
  const plain =
    typeof value === 'object' && value !== null && 'valueObject' in value
      ? value.valueObject
      : value
  return plain === null || plain === undefined ? '' : String(plain)
}

/** Read the current user-defined global and temporary variables of a story. */
function readPreviewVariables(story) {
  const values = {}
  const state = story?.variablesState
  const globals = state?._globalVariables
  if (globals !== null && globals !== undefined && typeof globals.keys === 'function') {
    for (const name of globals.keys()) {
      try {
        values[`global:${name}`] = {
          scope: 'global',
          name,
          value: previewVariableText(globals.get(name)),
        }
      } catch {
        // A variable that cannot be read is skipped rather than breaking preview.
      }
    }
  }
  const elements = story?.state?.callStack?.elements
  if (Array.isArray(elements)) {
    for (const element of elements) {
      const temps = element?.temporaryVariables
      if (temps === null || temps === undefined || typeof temps.keys !== 'function') continue
      for (const name of temps.keys()) {
        try {
          values[`current:${name}`] = {
            scope: 'current',
            name,
            value: previewVariableText(temps.get(name)),
          }
        } catch {
          // Same: skip unreadable temporary values.
        }
      }
    }
  }
  return values
}

/** Advance a story to the next choice/end, returning the lines produced. */
function advancePreviewStory(story) {
  const lines = []
  const variableChanges = []
  let steps = 0
  let previousVariables = readPreviewVariables(story)
  try {
    while (story.canContinue && steps < PREVIEW_MAX_STEPS) {
      lines.push(story.Continue())
      const currentVariables = readPreviewVariables(story)
      const changes = []
      for (const [key, variable] of Object.entries(currentVariables)) {
        const previous = previousVariables[key]
        if (previous === undefined || previous.value !== variable.value) {
          changes.push({
            scope: variable.scope,
            name: variable.name,
            value: variable.value,
          })
        }
      }
      if (changes.length > 0) {
        variableChanges.push({ line: lines.length - 1, changes })
      }
      previousVariables = currentVariables
      steps += 1
    }
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) }
  }
  if (story.canContinue) {
    return { ok: false, message: 'preview step limit reached' }
  }
  const text = lines.join('')
  const choices = story.currentChoices.map((choice, index) => ({ index, text: choice.text }))
  const variables = Object.values(previousVariables).map(({ scope, name, value }) => ({
    scope,
    name,
    value,
  }))
  return {
    ok: true,
    lines,
    text,
    choices,
    ended: choices.length === 0,
    variableChanges,
    variables,
  }
}
const MAX_LIST_DEPTH = 5
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.dsh-ink-backup', '.dsh-ink-backups'])
const BACKUP_DIR = '.dsh-ink-backups'

/** Answer one JSON document. */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** Read a bounded JSON body; undefined means unreadable or too large. */
async function readJsonBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) return undefined
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** Recursively list `.ink` files under `dir`, relative to `root`. */
async function listInkFiles(dir, root, depth, out) {
  if (depth > MAX_LIST_DEPTH) return out
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const absolute = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      await listInkFiles(absolute, root, depth + 1, out)
      continue
    }
    if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.ink') continue
    try {
      const info = await stat(absolute)
      out.push({
        path: relative(root, absolute).split(sep).join('/'),
        name: entry.name,
        size: info.size,
        mtimeMs: info.mtimeMs,
      })
    } catch {
      // a file removed between readdir and stat is simply skipped
    }
  }
  return out
}

/** Collect `#key:value` vocabulary out of one source text. */
function scanTags(text, vocabulary) {
  // Tags end at the end of their line, so split by line first: splitting the
  // whole file on '#' would let a value swallow the following lines.
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split('#')
    for (let index = 1; index < parts.length; index += 1) {
      const piece = parts[index].trim()
      if (piece === '') continue
      const colon = piece.indexOf(':')
      if (colon <= 0) continue
      const key = piece.slice(0, colon).trim()
      const value = piece.slice(colon + 1).trim()
      if (key === '') continue
      let values = vocabulary.get(key)
      if (values === undefined) {
        values = new Set()
        vocabulary.set(key, values)
      }
      if (value !== '') values.add(value)
    }
  }
}

/** Normalize one compiler message into `{ line, severity, text }`. */
function normalizeIssue(text, severity) {
  const match = /line (\d+)/i.exec(text)
  return {
    line: match === null ? 0 : Number(match[1]),
    severity,
    text: String(text).replace(/^ERROR:\s*/, '').replace(/^WARNING:\s*/, '').slice(0, 500),
  }
}

/** Compile `content` as `absolutePath`, resolving INCLUDE from its folder. */
function lintContent(absolutePath, content) {
  const base = dirname(absolutePath)
  const fileHandler = {
    ResolveInkFilename: (name) => resolve(base, name),
    LoadInkFileContents: (name) => readFileSync(resolve(base, name), 'utf8'),
  }
  const compiler = new Compiler(content, { sourceFilename: absolutePath, fileHandler })
  try {
    compiler.Compile()
  } catch {
    // compiler.errors already carries the reason for a failed compile
  }
  const issues = [
    ...compiler.errors.map((message) => normalizeIssue(message, 'error')),
    ...compiler.warnings.map((message) => normalizeIssue(message, 'warning')),
  ]
  issues.sort((a, b) => {
    if (a.line !== b.line) return (a.line || Number.MAX_SAFE_INTEGER) - (b.line || Number.MAX_SAFE_INTEGER)
    return a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1
  })
  return issues
}

export function apply(ctx, config) {
  const defaultProjectDir = resolve(String(config?.projectDir ?? 'D:\\inky\\project'))
  const inkyPath = String(config?.inkyPath ?? 'D:\\inky\\Inky_windows_64\\Inky.exe')
  const maxFileBytes = Number(config?.maxFileBytes ?? 4 * 1024 * 1024)
  const previews = new Map()

  function cleanupPreviews() {
    const now = Date.now()
    for (const [id, entry] of previews) {
      if (now - entry.updatedAt > PREVIEW_TTL_MS) previews.delete(id)
    }
    if (previews.size > PREVIEW_MAX_SESSIONS) {
      const sorted = [...previews.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt)
      for (const [id] of sorted.slice(0, previews.size - PREVIEW_MAX_SESSIONS)) {
        previews.delete(id)
      }
    }
  }

  ctx.effect(() => () => {
    if (standaloneWindow !== null && !standaloneWindow.isDestroyed()) {
      standaloneWindow.close()
    }
    standaloneWindow = null
  })

  /**
   * Resolve the project root for one request. The panel may switch folders at
   * runtime, so each request can carry an explicit `dir`; without one the
   * configured projectDir stays in force.
   */
  function resolveRoot(requestedDir) {
    if (typeof requestedDir !== 'string' || requestedDir.trim() === '') {
      return defaultProjectDir
    }
    const absolute = resolve(requestedDir)
    let info
    try {
      info = statSync(absolute)
    } catch {
      throw new Error('folder not found')
    }
    if (!info.isDirectory()) throw new Error('not a folder')
    return absolute
  }

  /** Resolve a path that must stay inside the project root. */
  function resolveInside(root, relativePath) {
    const clean = typeof relativePath === 'string' ? relativePath : ''
    const absolute = resolve(root, clean)
    const inside =
      absolute === root ||
      absolute.toLowerCase().startsWith((root + sep).toLowerCase())
    if (!inside) throw new Error('path outside the project directory')
    return absolute
  }

  /** Resolve a project-relative path, refusing anything outside the project. */
  function resolveProjectPath(relativePath, root) {
    if (typeof relativePath !== 'string' || relativePath.trim() === '') {
      throw new Error('empty path')
    }
    const absolute = resolveInside(root, relativePath)
    if (extname(absolute).toLowerCase() !== '.ink') throw new Error('only .ink files are supported')
    return absolute
  }

  const reject = (req, res) => {
    const status = ctx.connection.requestRejection(req)
    if (status === undefined) return false
    res.statusCode = status
    res.end()
    return true
  }

  async function collectState(root, includeVocabulary) {
    const files = await listInkFiles(root, root, 0, [])
    files.sort((a, b) => a.path.localeCompare(b.path, 'zh'))
    const vocabulary = new Map()
    let scanned = 0
    if (includeVocabulary) {
      for (const file of files) {
        if (scanned >= MAX_SCAN_BYTES) break
        if (file.size > 512 * 1024) continue
        try {
          const text = await readFile(join(root, file.path), 'utf8')
          scanned += text.length
          scanTags(text, vocabulary)
        } catch {
          // an unreadable file just contributes no vocabulary
        }
      }
    }
    const state = {
      projectDir: root,
      defaultProjectDir,
      inkyPath,
      inkyExists: existsSync(inkyPath),
      files,
      scannedBytes: scanned,
    }
    if (includeVocabulary) {
      const vocab = {}
      for (const [key, values] of vocabulary) {
        vocab[key] = [...values].sort((a, b) => a.localeCompare(b, 'zh'))
      }
      state.vocab = vocab
    }
    return state
  }

  function route(path, handler) {
    return ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        if (reject(req, res)) return
        try {
          await handler(req, res)
        } catch (error) {
          sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
        }
      },
    })
  }

  let standaloneWindow = null

  ctx.effect(() => {
    const disposers = []
    disposers.push(
      route(`${API_PREFIX}/window`, async (req, res) => {
        if (req.method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            mode: process.versions.electron === undefined ? 'web' : 'electron',
            open: standaloneWindow !== null && !standaloneWindow.isDestroyed(),
          })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, 64 * 1024)
        if (body === undefined) {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        if (standaloneWindow !== null && !standaloneWindow.isDestroyed()) {
          standaloneWindow.close()
          standaloneWindow = null
          sendJson(res, 200, { ok: true, mode: 'electron', open: false })
          return
        }
        try {
          const result = await openDesktopInkWindow(String(body.url ?? ''))
          if (result.ok !== true) {
            sendJson(res, 200, { ok: false, mode: result.mode ?? 'web' })
            return
          }
          standaloneWindow = result.window
          standaloneWindow.once('closed', () => {
            standaloneWindow = null
          })
          sendJson(res, 200, { ok: true, mode: 'electron', open: true })
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            mode: 'web',
            message: String(error?.message ?? error),
          })
        }
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/state`, async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        // The panel polls metadata every few seconds; only the full read (page
        // load and after a save) pays for scanning every file for #tags.
        const url = new URL(req.url ?? '/', 'http://localhost')
        const metaOnly = url.searchParams.get('meta') === '1'
        let root
        try {
          root = resolveRoot(url.searchParams.get('dir'))
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        sendJson(res, 200, { ok: true, ...(await collectState(root, !metaOnly)) })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/browse`, async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        let root
        let absolute
        try {
          root = resolveRoot(url.searchParams.get('dir'))
          absolute = resolveInside(root, url.searchParams.get('path') ?? '')
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        let info
        try {
          info = await stat(absolute)
        } catch {
          sendJson(res, 404, { ok: false, message: 'folder not found' })
          return
        }
        if (!info.isDirectory()) {
          sendJson(res, 404, { ok: false, message: 'not a folder' })
          return
        }
        let entries
        try {
          entries = await readdir(absolute, { withFileTypes: true })
        } catch (error) {
          sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
          return
        }
        const folders = []
        const files = []
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue
          const child = join(absolute, entry.name)
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue
            folders.push({ name: entry.name, path: relative(root, child).split(sep).join('/') })
            continue
          }
          if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.ink') continue
          let details = null
          try {
            details = await stat(child)
          } catch {
            continue
          }
          files.push({
            name: entry.name,
            path: relative(root, child).split(sep).join('/'),
            size: details.size,
            mtimeMs: details.mtimeMs,
          })
        }
        folders.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        files.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
        const relPath = relative(root, absolute).split(sep).join('/')
        const segments = relPath === '' ? [] : relPath.split('/')
        const parent = segments.length <= 1 ? '' : segments.slice(0, -1).join('/')
        sendJson(res, 200, { ok: true, root, path: relPath, parent, folders, files })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/contents`, async (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        let root
        try {
          root = resolveRoot(url.searchParams.get('dir'))
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        const files = await listInkFiles(root, root, 0, [])
        files.sort((a, b) => a.path.localeCompare(b.path, 'zh'))
        const contents = []
        let total = 0
        let truncated = false
        let skipped = 0
        for (const file of files) {
          if (total >= MAX_OUTLINE_BYTES) {
            truncated = true
            break
          }
          if (file.size > MAX_OUTLINE_FILE_BYTES) {
            skipped += 1
            continue
          }
          try {
            const text = await readFile(join(root, file.path), 'utf8')
            total += Buffer.byteLength(text, 'utf8')
            contents.push({
              path: file.path,
              content: text,
              size: file.size,
              mtimeMs: file.mtimeMs,
            })
          } catch {
            skipped += 1
          }
        }
        sendJson(res, 200, { ok: true, root, files: contents, truncated, skipped })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/backup`, async (req, res) => {
        const method = req.method
        const url = new URL(req.url ?? '/', 'http://localhost')
        let root
        let sourcePath
        let content
        if (method === 'POST') {
          const body = await readJsonBody(req, MAX_BODY_BYTES)
          if (body === undefined || typeof body.path !== 'string' || typeof body.content !== 'string') {
            sendJson(res, 400, { ok: false, message: 'invalid body' })
            return
          }
          content = body.content
          if (Buffer.byteLength(content, 'utf8') > maxFileBytes) {
            sendJson(res, 413, { ok: false, message: 'content is too large' })
            return
          }
          try {
            root = resolveRoot(body.dir)
            sourcePath = resolveProjectPath(body.path, root)
          } catch (error) {
            sendJson(res, 400, { ok: false, message: String(error.message) })
            return
          }
        } else if (method === 'GET' || method === 'DELETE') {
          try {
            root = resolveRoot(url.searchParams.get('dir'))
            sourcePath = resolveProjectPath(url.searchParams.get('path') ?? '', root)
          } catch (error) {
            sendJson(res, 400, { ok: false, message: String(error.message) })
            return
          }
        } else {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const relativePath = relative(root, sourcePath).split(sep).join('/')
        const backupFile = join(
          root,
          BACKUP_DIR,
          `${Buffer.from(relativePath, 'utf8').toString('base64url')}.json`,
        )
        if (method === 'POST') {
          const savedAt = Date.now()
          try {
            await mkdir(dirname(backupFile), { recursive: true })
            await writeFile(
              backupFile,
              JSON.stringify({ path: relativePath, content, savedAt }),
              'utf8',
            )
          } catch (error) {
            sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
            return
          }
          sendJson(res, 200, { ok: true, savedAt })
          return
        }
        if (method === 'GET') {
          try {
            const text = await readFile(backupFile, 'utf8')
            const parsed = JSON.parse(text)
            sendJson(res, 200, {
              ok: true,
              path: relativePath,
              content: parsed.content,
              savedAt: parsed.savedAt,
            })
          } catch {
            sendJson(res, 404, { ok: false, message: 'no backup' })
          }
          return
        }
        await rm(backupFile, { force: true })
        sendJson(res, 200, { ok: true })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/preview`, async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (body === undefined || typeof body.action !== 'string') {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        if (body.action === 'start') {
          if (typeof body.path !== 'string' || typeof body.content !== 'string') {
            sendJson(res, 400, { ok: false, message: 'invalid body' })
            return
          }
          let absolute
          try {
            absolute = resolveProjectPath(body.path, resolveRoot(body.dir))
          } catch (error) {
            sendJson(res, 400, { ok: false, message: String(error.message) })
            return
          }
          if (Buffer.byteLength(body.content, 'utf8') > maxFileBytes) {
            sendJson(res, 413, { ok: false, message: 'content is too large' })
            return
          }
          const base = dirname(absolute)
          const fileHandler = {
            ResolveInkFilename: (name) => resolve(base, name),
            LoadInkFileContents: (name) => readFileSync(resolve(base, name), 'utf8'),
          }
          let story = null
          let errors = []
          try {
            const compiler = new Compiler(body.content, {
              sourceFilename: absolute,
              fileHandler,
            })
            try {
              story = compiler.Compile()
            } catch {
              story = null
            }
            errors = compiler.errors
          } catch (error) {
            sendJson(res, 200, { ok: false, errors: [String(error?.message ?? error)] })
            return
          }
          if (story === null || errors.length > 0) {
            sendJson(res, 200, { ok: false, errors: errors.slice(0, 5) })
            return
          }
          const result = advancePreviewStory(story)
          if (result.ok !== true) {
            sendJson(res, 200, result)
            return
          }
          const id = randomUUID()
          previews.set(id, { story, text: result.text, updatedAt: Date.now() })
          cleanupPreviews()
          sendJson(res, 200, {
            ok: true,
            id,
            text: result.text,
            lines: result.lines,
            choices: result.choices,
            ended: result.ended,
            variableChanges: result.variableChanges,
            variables: result.variables,
          })
          return
        }
        if (body.action === 'choose') {
          const entry = previews.get(body.id)
          if (entry === undefined) {
            sendJson(res, 404, { ok: false, message: 'preview expired' })
            return
          }
          const index = Number(body.index)
          if (!Number.isInteger(index) || index < 0 || index >= entry.story.currentChoices.length) {
            sendJson(res, 400, { ok: false, message: 'invalid choice' })
            return
          }
          try {
            entry.story.ChooseChoiceIndex(index)
          } catch (error) {
            sendJson(res, 200, { ok: false, message: String(error?.message ?? error) })
            return
          }
          const result = advancePreviewStory(entry.story)
          if (result.ok !== true) {
            sendJson(res, 200, result)
            return
          }
          entry.text += result.text
          entry.updatedAt = Date.now()
          sendJson(res, 200, {
            ok: true,
            id: body.id,
            text: entry.text,
            lines: result.lines,
            choices: result.choices,
            ended: result.ended,
            variableChanges: result.variableChanges,
            variables: result.variables,
          })
          return
        }
        if (body.action === 'stop') {
          previews.delete(body.id)
          sendJson(res, 200, { ok: true })
          return
        }
        sendJson(res, 400, { ok: false, message: 'unknown action' })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/file`, async (req, res) => {
        if (req.method === 'GET') {
          const url = new URL(req.url ?? '/', 'http://localhost')
          let absolute
          try {
            absolute = resolveProjectPath(
              url.searchParams.get('path') ?? '',
              resolveRoot(url.searchParams.get('dir')),
            )
          } catch (error) {
            sendJson(res, 400, { ok: false, message: String(error.message) })
            return
          }
          let info
          try {
            info = await stat(absolute)
          } catch {
            sendJson(res, 404, { ok: false, message: 'file not found' })
            return
          }
          if (info.size > maxFileBytes) {
            sendJson(res, 413, { ok: false, message: 'file is too large for the editor' })
            return
          }
          try {
            const content = await readFile(absolute, 'utf8')
            sendJson(res, 200, { ok: true, content, mtimeMs: info.mtimeMs, size: info.size })
          } catch (error) {
            sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
          }
          return
        }

        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (body === undefined || typeof body.content !== 'string') {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        let absolute
        try {
          absolute = resolveProjectPath(body.path, resolveRoot(body.dir))
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        const bytes = Buffer.byteLength(body.content, 'utf8')
        if (bytes > maxFileBytes) {
          sendJson(res, 413, { ok: false, message: 'content is too large' })
          return
        }
        // A save is refused when the file changed on disk after the client read
        // it (Inky may have auto-saved in the meantime).
        if (typeof body.baseMtimeMs === 'number' && body.baseMtimeMs > 0) {
          try {
            const current = await stat(absolute)
            if (Math.abs(current.mtimeMs - body.baseMtimeMs) > 1) {
              sendJson(res, 409, {
                ok: false,
                reason: 'stale',
                message: 'file changed on disk since it was read',
                mtimeMs: current.mtimeMs,
              })
              return
            }
          } catch {
            // a missing file is created by the write below
          }
        }
        const temp = `${absolute}.dsh-ink-${process.pid}.tmp`
        try {
          await writeFile(temp, body.content, 'utf8')
          await rename(temp, absolute)
        } catch (error) {
          await rm(temp, { force: true }).catch(() => {})
          sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
          return
        }
        const info = await stat(absolute)
        sendJson(res, 200, { ok: true, mtimeMs: info.mtimeMs, size: info.size })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/new`, async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (body === undefined || typeof body.name !== 'string') {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        const name = body.name.trim().replace(/\\/g, '/')
        if (name === '') {
          sendJson(res, 400, { ok: false, message: 'name must not be empty' })
          return
        }
        const kind = body.kind === 'folder' ? 'folder' : 'file'
        let root
        try {
          root = resolveRoot(body.dir)
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        if (kind === 'folder') {
          let folderPath
          try {
            folderPath = resolveInside(root, name)
          } catch (error) {
            sendJson(res, 400, { ok: false, message: String(error.message) })
            return
          }
          if (existsSync(folderPath)) {
            sendJson(res, 409, { ok: false, message: 'folder already exists' })
            return
          }
          await mkdir(folderPath, { recursive: true })
          sendJson(res, 200, {
            ok: true,
            kind,
            path: relative(root, folderPath).split(sep).join('/'),
          })
          return
        }
        const fileName = name.toLowerCase().endsWith('.ink') ? name : `${name}.ink`
        let absolute
        try {
          absolute = resolveProjectPath(fileName, root)
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        if (existsSync(absolute)) {
          sendJson(res, 409, { ok: false, message: 'file already exists' })
          return
        }
        await writeFile(absolute, '', 'utf8')
        sendJson(res, 200, {
          ok: true,
          kind,
          path: relative(root, absolute).split(sep).join('/'),
        })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/lint`, async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (body === undefined || typeof body.content !== 'string') {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        let absolute
        try {
          absolute = resolveProjectPath(body.path, resolveRoot(body.dir))
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        if (Buffer.byteLength(body.content, 'utf8') > 2 * 1024 * 1024) {
          sendJson(res, 200, { ok: true, issues: [], skipped: 'content too large to lint' })
          return
        }
        try {
          const issues = lintContent(absolute, body.content)
          sendJson(res, 200, { ok: true, issues })
        } catch (error) {
          sendJson(res, 200, {
            ok: false,
            issues: [],
            message: String(error?.message ?? error),
          })
        }
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/open`, async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (body === undefined) {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        if (!existsSync(inkyPath)) {
          sendJson(res, 404, { ok: false, message: `Inky not found: ${inkyPath}` })
          return
        }
        let root
        try {
          root = resolveRoot(body.dir)
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        if (typeof body.path === 'string' && body.path !== '') {
          let absolute
          try {
            absolute = resolveProjectPath(body.path, root)
          } catch (error) {
            sendJson(res, 400, { ok: false, message: String(error.message) })
            return
          }
          const child = spawn(inkyPath, [absolute], {
            cwd: dirname(absolute),
            detached: true,
            stdio: 'ignore',
          })
          child.on('error', () => {})
          child.unref()
          sendJson(res, 200, { ok: true })
          return
        }
        const child = spawn(inkyPath, [], { cwd: root, detached: true, stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
        sendJson(res, 200, { ok: true })
      }),
    )
    disposers.push(
      route(`${API_PREFIX}/folder`, async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req, MAX_BODY_BYTES)
        if (body === undefined) {
          sendJson(res, 400, { ok: false, message: 'invalid body' })
          return
        }
        let root
        try {
          root = resolveRoot(body.dir)
        } catch (error) {
          sendJson(res, 400, { ok: false, message: String(error.message) })
          return
        }
        const child = spawn('explorer.exe', [root], { detached: true, stdio: 'ignore' })
        child.on('error', () => {})
        child.unref()
        sendJson(res, 200, { ok: true })
      }),
    )
    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') dispose()
      }
    }
  })
}
