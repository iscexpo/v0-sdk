'use client'

import { useEffect, useRef } from 'react'
import { usePreviewProxyOrigin } from '@/components/preview/preview-proxy-provider'

export function PreviewPane({
  chatId,
  path = '',
  refreshKey,
  onReadyChange,
  onConsoleLog,
  sandboxUrl,
}: {
  chatId: string
  path?: string
  refreshKey?: number
  onReadyChange?: (ready: boolean) => void
  onConsoleLog?: (event: { level: string; message: string; timestamp: number }) => void
  sandboxUrl?: string | null
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const previewProxyOrigin = usePreviewProxyOrigin()
  const origin = sandboxUrl ?? previewProxyOrigin
  const previewUrl = sandboxUrl
    ? new URL(
        `/api/sandboxes/${encodeURIComponent(chatId)}/preview${path ? '/' + path.replace(/^\//, '') : ''}`,
        origin,
      ).toString()
    : new URL(`/api/v0-preview/${encodeURIComponent(chatId)}${path}`, previewProxyOrigin).toString()

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      if (event.source !== iframeRef.current?.contentWindow) return
      const d = event.data
      if (d?.type === 'v0-preview-loading') {
        onReadyChange?.(false)
      } else if (d?.type === 'console') {
        onConsoleLog?.({
          level: (d.level as string) ?? 'log',
          message: d.message ?? '',
          timestamp: typeof d.timestamp === 'number' ? d.timestamp : Date.now(),
        })
      } else if (d?.type === 'error') {
        onConsoleLog?.({
          level: 'error',
          message: d.message ?? '',
          timestamp: typeof d.timestamp === 'number' ? d.timestamp : Date.now(),
        })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [onReadyChange, onConsoleLog, origin])

  return (
    <iframe
      className="h-full w-full bg-background"
      onLoad={() => onReadyChange?.(true)}
      ref={iframeRef}
      key={refreshKey}
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
      src={previewUrl}
      title="Chat preview"
    />
  )
}
