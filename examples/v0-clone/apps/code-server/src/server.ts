import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createV0Client } from 'v0'

const PORT = parseInt(process.env.PORT ?? '3200', 10)
const CODE_ROOT = process.env.CODE_ROOT ?? path.join(process.cwd(), '.code')
const V0_API_KEY = process.env.V0_API_KEY

const v0 = V0_API_KEY ? createV0Client({ auth: () => V0_API_KEY }) : undefined

interface CodeProject {
  dir: string
  devServer: ChildProcess | null
  devPort: number | null
  watchers: fs.FSWatcher[]
  changeConsumers: Set<http.ServerResponse>
}

const projects = new Map<string, CodeProject>()

function getProject(chatId: string): CodeProject {
  let p = projects.get(chatId)
  if (!p) {
    const dir = path.join(CODE_ROOT, chatId)
    fs.mkdirSync(dir, { recursive: true })
    p = { dir, devServer: null, devPort: null, watchers: [], changeConsumers: new Set() }
    projects.set(chatId, p)
  }
  return p
}

function json(resp: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  resp.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  resp.end(payload)
}

function sse(resp: http.ServerResponse, event: string, data: unknown) {
  resp.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function syncFiles(chatId: string) {
  if (!v0) throw new Error('V0_API_KEY is required.')
  const res = await v0.chats.getFiles({ chatId })
  if (res.error) throw new Error(res.error.message)
  const files = res.data.files
  const dir = getProject(chatId).dir
  for (const file of files) {
    const filePath = path.join(dir, file.path)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const content = file.encoding === 'base64'
      ? Buffer.from(file.content, 'base64')
      : Buffer.from(file.content, 'utf8')
    fs.writeFileSync(filePath, content)
  }
  return files
}

function detectDevCommand(dir: string): { cmd: string[]; framework: string } | null {
  const pkgPath = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgPath)) return null
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  const scripts = pkg.scripts ?? {}
  const dev = scripts.dev ?? ''
  if (/\bnext\b/.test(dev)) return { cmd: ['bun', 'run', 'dev'], framework: 'next' }
  if (/\bvite\b/.test(dev)) return { cmd: ['bun', 'run', 'dev', '--', '--port'], framework: 'vite' }
  if (/\bnode\b/.test(dev) || scripts.start) return { cmd: ['bun', 'run', 'dev'], framework: 'node' }
  return null
}

function startDevServer(chatId: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = getProject(chatId)
    const detected = detectDevCommand(p.dir)
    if (!detected) return reject(new Error('No detectable dev server. Add a dev script to package.json.'))

    const port = 3500 + Math.floor(Math.random() * 2000)
    const env = { ...process.env, PORT: String(port) }
    const child = spawn('bun', ['run', 'dev'], { cwd: p.dir, env, stdio: ['pipe', 'pipe', 'pipe'], shell: false })
    p.devServer = child
    p.devPort = port

    const output: string[] = []
    const emitLog = (chunk: Buffer) => {
      const text = chunk.toString()
      output.push(text)
      for (const res of p.changeConsumers) {
        sse(res, 'log', { text, kind: 'log' })
      }
    }
    child.stdout!.on('data', emitLog)
    child.stderr!.on('data', emitLog)
    child.on('error', (err) => {
      emitLog(Buffer.from(`[code-server] dev server error: ${err.message}\n`))
    })
    child.on('exit', (code) => {
      emitLog(Buffer.from(`[code-server] dev server exited with code ${code}\n`))
      if (p.devServer === child) { p.devServer = null; p.devPort = null }
    })

    const timeout = setTimeout(() => {
      if (p.devPort) return resolve(port)
      reject(new Error('Dev server failed to start.'))
    }, 8000)

    const check = setInterval(() => {
      if (p.devPort) { clearTimeout(timeout); clearInterval(check); resolve(port) }
    }, 500)
  })
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function executeCode(chatId: string, command: string): Promise<{ output: string; exitCode: number | null }> {
  const p = getProject(chatId)
  const result = await new Promise<{ output: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawn(command, { cwd: p.dir, shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    child.stdout!.on('data', (d) => { output += d.toString() })
    child.stderr!.on('data', (d) => { output += d.toString() })
    child.on('close', (code) => resolve({ output, exitCode: code }))
    child.on('error', reject)
  })
  for (const res of p.changeConsumers) {
    sse(res, 'execution', result)
  }
  return result
}

function watchFiles(chatId: string) {
  const p = getProject(chatId)
  const dir = p.dir
  const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (!filename) return
    const filePath = path.join(dir, filename as string)
    try {
      const stat = fs.statSync(filePath)
      if (stat.isFile()) {
        const content = fs.readFileSync(filePath, 'utf8')
        for (const res of p.changeConsumers) {
          sse(res, 'file-change', { path: filename as string, event: eventType, content })
        }
      }
    } catch { /* file deleted */ }
  })
  p.watchers.push(watcher)
}

const server = http.createServer(async (req, resp) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const method = req.method ?? 'GET'

  resp.setHeader('access-control-allow-origin', '*')
  resp.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  resp.setHeader('access-control-allow-headers', 'content-type')
  if (method === 'OPTIONS') { resp.writeHead(204); return resp.end() }

  try {
    // Health
    if (url.pathname === '/api/health') {
      return json(resp, 200, { status: 'ok' })
    }

    // Sync files
    if (method === 'POST' && /^\/api\/code\/[^/]+\/sync$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/code\/([^/]+)\/sync$/)![1]
      const files = await syncFiles(chatId)
      watchFiles(chatId)
      return json(resp, 200, { files: files.length })
    }

    // Start dev server
    if (method === 'POST' && /^\/api\/code\/[^/]+\/start$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/code\/([^/]+)\/start$/)![1]
      const port = await startDevServer(chatId)
      return json(resp, 200, { port })
    }

    // Stop dev server
    if (method === 'POST' && /^\/api\/code\/[^/]+\/stop$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/code\/([^/]+)\/stop$/)![1]
      const p = getProject(chatId)
      if (p.devServer) { p.devServer.kill() }
      for (const w of p.watchers) { w.close() }
      p.watchers = []
      p.changeConsumers.clear()
      return json(resp, 200, { stopped: true })
    }

    // Status
    if (method === 'GET' && /^\/api\/code\/[^/]+\/status$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/code\/([^/]+)\/status$/)![1]
      const p = getProject(chatId)
      return json(resp, 200, {
        dir: p.dir,
        devRunning: p.devServer !== null,
        devPort: p.devPort,
      })
    }

    // Read file
    if (method === 'GET' && /^\/api\/code\/[^/]+\/files\//.test(url.pathname)) {
      const match = url.pathname.match(/\/api\/code\/([^/]+)\/files\/(.+)$/)!
      const chatId = match[1]
      const requestedPath = decodeURIComponent(match[2])
      const filePath = path.join(getProject(chatId).dir, requestedPath)
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return json(resp, 404, { error: 'File not found' })
      }
      const content = fs.readFileSync(filePath, 'utf8')
      return json(resp, 200, { content })
    }

    // Write file
    if (method === 'PUT' && /^\/api\/code\/[^/]+\/files\//.test(url.pathname)) {
      const match = url.pathname.match(/\/api\/code\/([^/]+)\/files\/(.+)$/)!
      const chatId = match[1]
      const requestedPath = decodeURIComponent(match[2])
      const filePath = path.join(getProject(chatId).dir, requestedPath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      const body = await readBody(req)
      const data = JSON.parse(body.toString())
      fs.writeFileSync(filePath, data.content, 'utf8')
      for (const res of getProject(chatId).changeConsumers) {
        sse(res, 'file-change', { path: decodeURIComponent(chatId[2]), event: 'change', content: data.content })
      }
      return json(resp, 200, { written: true })
    }

    // Execute code
    if (method === 'POST' && /^\/api\/code\/[^/]+\/execute$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/code\/([^/]+)\/execute$/)![1]
      const body = JSON.parse((await readBody(req)).toString())
      const result = await executeCode(chatId, body.command)
      return json(resp, 200, result)
    }

    // SSE stream for file changes and execution results
    const streamMatch = url.pathname.match(/^\/api\/code\/([^/]+)\/stream$/)
    if (method === 'GET' && streamMatch) {
      const chatId = streamMatch[1]
      const p = getProject(chatId)
      p.changeConsumers.add(resp)
      resp.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': '*',
      })
      resp.write(':ok\n\n')
      req.on('close', () => { p.changeConsumers.delete(resp) })
      return
    }

    json(resp, 404, { error: 'not found' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    json(resp, 500, { error: message })
  }
})

server.listen(PORT, () => {
  console.log(`[code-server] listening on port ${PORT}`)
})
