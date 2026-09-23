import { fetchPreview, type ChatsGetPreviewResponse } from 'v0'
import { ensureTrustedPreviewHost } from '@/lib/trusted-host'
import { getCloneOrigin } from '@/lib/origins'
import { getV0ApiKeyFingerprint, v0 } from '@/lib/v0-client'

type Preview = NonNullable<ChatsGetPreviewResponse>

// This process-local cache is enough for the demo. Use a shared cache in production.
// OIDC requests bypass it because there is no API key with which to scope the entry.
// You will need to add your own auth mechanism to scope the cache.
const previewCache = new Map<string, Preview>()

async function getPreview(chatId: string, cacheKey?: string) {
  const cached = cacheKey ? previewCache.get(cacheKey) : undefined
  const now = Date.now()

  if (cached && cached.expiresAt.getTime() - now > 60_000) {
    return cached
  }

  const response = await v0.chats.getPreview({ chatId })
  if (response.error) throw new Error(response.error.message)

  const preview = response.data
  if (cacheKey) {
    if (preview) previewCache.set(cacheKey, preview)
    else previewCache.delete(cacheKey)
  }

  return preview
}

const CONSOLE_BRIDGE = (cloneOrigin: string) => `<script>((function(){var o=${JSON.stringify(cloneOrigin)};function p(t,d){try{parent.postMessage({type:t,level:d.level,message:String(d.message),timestamp:d.timestamp},o)}catch(e){}}var m=['log','info','warn','error','debug'];m.forEach(function(l){var a=console[l];console[l]=function(){var x=Array.prototype.slice.call(arguments);try{a.apply(console,x)}catch(e){}p('console',{level:l,message:x.map(function(v){return typeof v==='object'?JSON.stringify(v):String(v)}).join(' ')})};});window.addEventListener('error',function(e){p('error',{message:e.message||String(e.type)})});window.addEventListener('unhandledrejection',function(e){p('error',{message:String(e.reason)})})})()});</script>`

function isHtmlResponse(response: Response): boolean {
  const ct = response.headers.get('content-type') ?? ''
  return response.status === 200 && (ct.includes('text/html') || ct.includes('application/xhtml'))
}

async function injectConsoleCapture(response: Response, cloneOrigin: string): Promise<Response> {
  if (!isHtmlResponse(response)) return response
  const text = await new Response(response.body).text()
  const script = CONSOLE_BRIDGE(cloneOrigin)
  const html = text.replace(/<\/head>/i, script + '</head>')
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function proxyPreviewRequest(request: Request, chatId: string, path: string[]) {
  const proxyUrl = new URL(request.url)
  if (path.length === 0) await ensureTrustedPreviewHost(v0, proxyUrl.hostname)

  const apiKeyFingerprint = await getV0ApiKeyFingerprint()
  const cacheKey = apiKeyFingerprint ? `${apiKeyFingerprint}:${chatId}` : undefined
  const preview = await getPreview(chatId, cacheKey)
  const fallbackUrl = new URL(
    `/api/v0-preview/${encodeURIComponent(chatId)}/loading`,
    proxyUrl.origin,
  )
  fallbackUrl.searchParams.set('returnTo', proxyUrl.pathname + proxyUrl.search)

  const result = await fetchPreview({
    request,
    preview,
    path,
    fallbackUrl,
    onPreviewRefresh: () => {
      if (cacheKey) previewCache.delete(cacheKey)
    },
  })

  return injectConsoleCapture(result, getCloneOrigin())
}
