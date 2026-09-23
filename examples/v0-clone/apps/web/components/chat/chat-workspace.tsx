'use client'

import { Suspense, useState } from 'react'
import type { Chat, Message } from '@v0-sdk/react'
import { useMessages } from '@v0-sdk/react/swr'
import {
  CodeEditorLoading,
  CodeEditorPane,
  type ChatFilesResult,
} from '@/components/chat/code-editor'
import { ChatHeader, type ChatView } from '@/components/chat/chat-header'
import { ChatConversation } from '@/components/chat/chat-conversation'
import { useSandbox } from '@/components/preview/sandbox-context'
import { PreviewPane } from '@/components/preview/preview-pane'
import { SandboxConsole } from '@/components/preview/sandbox-console'
import { TerminalView } from '@/components/chat/terminal-view'
import { toV0UIMessages } from '@v0-sdk/react'
import { usePreviewProxyOrigin } from '@/components/preview/preview-proxy-provider'

export function ChatWorkspace({
  chat,
  messages,
  filesPromise,
}: {
  chat: Chat
  messages: Message[]
  filesPromise: Promise<ChatFilesResult>
}) {
  const sandboxUrl = useSandbox()
  const [view, setView] = useState<ChatView>('preview')
  const [contentRevision, setContentRevision] = useState(0)
  const [isPreviewReady, setIsPreviewReady] = useState(false)
  const [consoleEvents, setConsoleEvents] = useState<
    Array<{ id: string; level: string; message: string; timestamp: number }>
  >([])
  const [navStack, setNavStack] = useState<string[]>(['/'])
  const [navIndex, setNavIndex] = useState(0)
  const [urlInput, setUrlInput] = useState<string>('/')
  const messagesUrl = `/api/chats/${encodeURIComponent(chat.id)}/messages`
  const messagesQuery = useMessages(
    messagesUrl,
    { limit: 100 },
    {
      fallbackData: {
        cursor: null,
        messages,
      },
      revalidateOnMount: false,
    },
  )
  const uiMessages = messagesQuery.data?.messages ?? messages
  const currentPath = urlInput

  const handleContentChange = () => {
    setIsPreviewReady(false)
    setContentRevision((revision) => revision + 1)
  }

  const handleConsoleLog = (event: { level: string; message: string; timestamp: number }) => {
    setConsoleEvents((prev) => [...prev.slice(-200), { id: `ev-${event.timestamp}-${Math.random()}`, ...event }])
  }

  const navigateTo = (path: string) => {
    const normalized = path.startsWith('/') ? path : '/' + path
    if (normalized === currentPath) return
    const next = [...navStack.slice(0, navIndex + 1), normalized]
    setNavStack(next)
    setNavIndex(next.length - 1)
    setUrlInput(normalized)
  }

  const goBack = () => {
    if (navIndex > 0) {
      const next = navIndex - 1
      setNavIndex(next)
      setUrlInput(navStack[next])
    }
  }

  const goForward = () => {
    if (navIndex < navStack.length - 1) {
      const next = navIndex + 1
      setNavIndex(next)
      setUrlInput(navStack[next])
    }
  }

  const handlePreviewNavigate = (value: string) => {
    if (value === 'back') goBack()
    else if (value === 'forward') goForward()
    else navigateTo(value)
  }

  const previewRefresh = () => {
    setContentRevision((revision) => revision + 1)
  }

  const origin = usePreviewProxyOrigin()
  const previewOpenNewTab = () => {
    const url = new URL(`/api/v0-preview/${encodeURIComponent(chat.id)}${currentPath === '/' ? '' : currentPath}`, origin)
    window.open(url.toString(), '_blank', 'noopener')
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader
        chatId={chat.id}
        onViewChange={setView}
        title={chat.title ?? 'Untitled chat'}
        view={view}
        previewPath={urlInput}
        onPreviewInput={setUrlInput}
        onPreviewNavigate={handlePreviewNavigate}
        onPreviewRefresh={previewRefresh}
        onPreviewOpenNewTab={previewOpenNewTab}
        canGoBack={navIndex > 0}
        canGoForward={navIndex < navStack.length - 1}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-full shrink-0 flex-col border-r border-border md:w-80 md:max-w-[42%]">
          <ChatConversation
            chatId={chat.id}
            messages={messages}
            onContentChange={handleContentChange}
            vercelProjectId={chat.vercelProjectId}
          />
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <div className={view === 'preview' ? 'h-full' : 'hidden'}>
            <PreviewPane
              chatId={chat.id}
              path={currentPath === '/' ? '' : currentPath}
              key={contentRevision}
              onReadyChange={setIsPreviewReady}
              onConsoleLog={handleConsoleLog}
              sandboxUrl={sandboxUrl}
            />
          </div>
          <div className={view === 'terminal' ? 'h-full' : 'hidden'}>
            <TerminalView messages={toV0UIMessages(uiMessages)} />
          </div>
          <div className={view === 'code' ? 'h-full' : 'hidden'}>
            <Suspense fallback={<CodeEditorLoading />}>
              <CodeEditorPane
                chatId={chat.id}
                filesPromise={filesPromise}
                isPreviewReady={isPreviewReady}
                key={contentRevision}
              />
            </Suspense>
          </div>
          {view === 'preview' ? (
            <SandboxConsole
              messages={toV0UIMessages(uiMessages)}
              isPreviewReady={isPreviewReady}
              consoleEvents={consoleEvents}
              sandboxUrl={sandboxUrl}
              chatId={chat.id}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}
