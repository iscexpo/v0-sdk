import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createV0Client } from 'v0'

const PORT = parseInt(process.env.PORT ?? '3100', 10)
const SANDBOX_ROOT = process.env.SANDBOX_ROOT ?? path.join(process.cwd(), '.sandbox')
const V0_API_KEY = process.env.V0_API_KEY

const v0 = V0_API_KEY ? createV0Client({ auth: () => V0_API_KEY }) : undefined

interface Sandbox {
  dir: string
  devServer: ChildProcess | null
  devPort: number | null
  shell: ChildProcess | null
  logs: Set<http.ServerResponse>
  terminalConsumers: Set<http.ServerResponse>
}

const sandboxes = new Map<string, Sandbox>()

function getSandbox(chatId: string): Sandbox {
  let s = sandboxes.get(chatId)
  if (!s) {
    const dir = path.join(SANDBOX_ROOT, chatId)
    fs.mkdirSync(dir, { recursive: true })
    s = { dir, devServer: null, devPort: null, shell: null, logs: new Set(), terminalConsumers: new Set() }
    sandboxes.set(chatId, s)
  }
  return s
}

function json(resp: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  resp.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  resp.end(payload)
}

async function syncFiles(chatId: string) {
  if (!v0) throw new Error('V0_API_KEY is required to sync files.')
  const res = await v0.chats.getFiles({ chatId })
  if (res.error) throw new Error(res.error.message)
  const files = res.data.files
  const dir = getSandbox(chatId).dir
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
    const s = getSandbox(chatId)
    const detected = detectDevCommand(s.dir)
    if (!detected) return reject(new Error('No detectable dev server. Add a dev script to package.json.'))

    const port = 3400 + Math.floor(Math.random() * 2000)
    const env = { ...process.env, PORT: String(port) }
    const child = spawn('bun', ['run', 'dev'], {
      cwd: s.dir,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    })
    s.devServer = child
    s.devPort = port

    const output: string[] = []
    const emitLog = (chunk: Buffer) => {
      const text = chunk.toString()
      output.push(text)
      for (const res of s.logs) {
        res.write(`data: ${JSON.stringify({ text, kind: 'log' })}\n\n`)
      }
    }
    child.stdout!.on('data', emitLog)
    child.stderr!.on('data', emitLog)
    child.on('error', (err) => {
      emitLog(Buffer.from(`[sandbox] dev server error: ${err.message}\n`))
    })
    child.on('exit', (code) => {
      emitLog(Buffer.from(`[sandbox] dev server exited with code ${code}\n`))
      if (s.devServer === child) { s.devServer = null; s.devPort = null }
    })

    const timeout = setTimeout(() => {
      if (s.devPort) return resolve(port)
      reject(new Error('Dev server failed to start.'))
    }, 8000)

    const check = setInterval(() => {
      if (s.devPort) {
        clearTimeout(timeout)
        clearInterval(check)
        resolve(port)
      }
    }, 500)
  })
}

function startShell(chatId: string) {
  const s = getSandbox(chatId)
  const shell = spawn('sh', ['-i'], {
    cwd: s.dir,
    env: { ...process.env, HOME: s.dir },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  })
  s.shell = shell

  const emitTerminal = (chunk: Buffer) => {
    const text = chunk.toString()
    for (const res of s.terminalConsumers) {
      res.write(`data: ${JSON.stringify({ text })}\n\n`)
    }
  }
  shell.stdout!.on('data', emitTerminal)
  shell.stderr!.on('data', emitTerminal)
  shell.on('exit', () => {
    if (s.shell === shell) s.shell = null
    for (const res of s.terminalConsumers) {
      res.write(`data: ${JSON.stringify({ text: '\n[shell exited]\n' })}\n\n`)
      res.end()
    }
    s.terminalConsumers.clear()
  })
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
    if (method === 'POST' && /^\/api\/sandboxes\/[^/]+\/sync$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/sandboxes\/([^/]+)\/sync$/)![1]
      const files = await syncFiles(chatId)
      return json(resp, 200, { files: files.length })
    }

    // Start dev server
    if (method === 'POST' && /^\/api\/sandboxes\/[^/]+\/start$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/sandboxes\/([^/]+)\/start$/)![1]
      const port = await startDevServer(chatId)
      return json(resp, 200, { port })
    }

    // Stop
    if (method === 'POST' && /^\/api\/sandboxes\/[^/]+\/stop$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/sandboxes\/([^/]+)\/stop$/)![1]
      const s = getSandbox(chatId)
      if (s.devServer) { s.devServer.kill() }
      if (s.shell) { s.shell.kill() }
      return json(resp, 200, { stopped: true })
    }

    // Status
    if (method === 'GET' && /^\/api\/sandboxes\/[^/]+\/status$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/sandboxes\/([^/]+)\/status$/)![1]
      const s = getSandbox(chatId)
      return json(resp, 200, {
        dir: s.dir,
        devRunning: s.devServer !== null,
        devPort: s.devPort,
        shellRunning: s.shell !== null,
      })
    }

    // Logs SSE
    if (method === 'GET' && /^\/api\/sandboxes\/[^/]+\/logs$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/sandboxes\/([^/]+)\/logs$/)![1]
      const s = getSandbox(chatId)
      s.logs.add(resp)
      resp.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': '*',
      })
      resp.write(':ok\n\n')
      req.on('close', () => { s.logs.delete(resp) })
      return
    }

    // Preview reverse proxy
    const previewMatch = url.pathname.match(/^\/api\/sandboxes\/([^/]+)\/preview\/(.*)$/)
    if (previewMatch) {
      const chatId = previewMatch[1]
      const rest = previewMatch[2]
      const s = getSandbox(chatId)
      if (!s.devPort) {
        resp.writeHead(503, { 'content-type': 'text/plain' })
        return resp.end('Dev server not started. POST /api/sandboxes/<chatId>/start first.')
      }
      const body = (req.method === 'POST' || req.method === 'PUT')
        ? await readBody(req)
        : null
      const proxyReq = await new Promise<http.ClientRequest>((resolve, reject) => {
        const r = http.request(
          { hostname: '127.0.0.1', port: s.devPort, path: '/' + rest, method: req.method, headers: { ...req.headers, host: 'localhost' } },
          (_res) => resolve(r),
        )
        r.on('error', reject)
        if (body) r.write(body)
        r.end()
      })
      proxyReq.on('response', (proxyRes) => {
        const status = proxyRes.statusCode ?? 502
        const ct = proxyRes.headers['content-type'] ?? 'text/html'
        resp.writeHead(status, { 'content-type': ct })
        proxyRes.pipe(resp)
      })
      return
    }

    // Terminal start
    if (method === 'POST' && /^\/api\/terminal\/[^/]+\/start$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/terminal\/([^/]+)\/start$/)![1]
      startShell(chatId)
      return json(resp, 200, { started: true })
    }

    // Terminal stream SSE
    const termStreamMatch = url.pathname.match(/^\/api\/terminal\/([^/]+)\/stream$/)
    if (method === 'GET' && termStreamMatch) {
      const chatId = termStreamMatch[1]
      const s = getSandbox(chatId)
      s.terminalConsumers.add(resp)
      resp.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive', 'access-control-allow-origin': '*' })
      resp.write(':ok\n\n')
      req.on('close', () => { s.terminalConsumers.delete(resp) })
      return
    }

    // Terminal input
    if (method === 'POST' && /^\/api\/terminal\/[^/]+\/input$/.test(url.pathname)) {
      const chatId = url.pathname.match(/\/api\/terminal\/([^/]+)\/input$/)![1]
      const s = getSandbox(chatId)
      const body = await readBody(req)
      const msg = JSON.parse(body.toString())
      if (s.shell && s.shell.stdin) {
        s.shell.stdin.write(typeof msg.text === 'string' ? msg.text + '\n' : msg.text + '\n')
      }
      return json(resp, 200, { ok: true })
    }

    json(resp, 404, { error: 'not found' })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    json(resp, 500, { error: message })
  }
})

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

server.listen(PORT, () => {
  console.log(`[sandbox] server listening on port ${PORT}`)
})
