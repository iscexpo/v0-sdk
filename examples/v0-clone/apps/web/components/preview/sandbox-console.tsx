'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { V0UIMessage } from '@v0-sdk/react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { LogsIcon, TerminalIcon } from '@/lib/icons'

type LogLevel = string

interface ConsoleEvent {
  id: string
  level: LogLevel
  message: string
  timestamp: number
}

interface BashEntry {
  id: string
  command: string
  output: string
  exitCode?: number | null
}

type Tab = 'logs' | 'terminal'

export function SandboxConsole({
  messages,
  isPreviewReady,
  consoleEvents,
  className,
}: {
  messages: V0UIMessage[]
  isPreviewReady: boolean
  consoleEvents: ConsoleEvent[]
  className?: string
}) {
  const [tab, setTab] = useState<Tab>('terminal')
  const endRef = useRef<HTMLDivElement>(null)

  const bashEntries: BashEntry[] = useMemo(() => {
    const entries: BashEntry[] = []
    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === 'data-v0-bash') {
          const d = part.data as {
            command: string
            output?: string
            exitCode?: number | null
          }
          entries.push({
            id: part.id ?? `${msg.id}-${part.type}-${Math.random()}`,
            command: d.command,
            output: d.output ?? '',
            exitCode: d.exitCode,
          })
        }
      }
    }
    return entries
  }, [messages])

  const logs: ConsoleEvent[] = useMemo(() => {
    const events: ConsoleEvent[] = []
    if (!isPreviewReady) {
      events.push({
        id: 'lifecycle-starting',
        level: 'info',
        message: 'Preview starting…',
        timestamp: Date.now(),
      })
    } else {
      events.push({
        id: 'lifecycle-ready',
        level: 'info',
        message: 'Preview ready',
        timestamp: Date.now(),
      })
    }
    for (const e of consoleEvents) {
      events.push(e)
    }
    return events
  }, [consoleEvents, isPreviewReady])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [tab, bashEntries.length, logs.length])

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-t border-border bg-muted/30',
        className,
      )}
    >
      <div className="flex shrink-0 items-center gap-1 px-2">
        <button
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium',
            tab === 'terminal'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('terminal')}
          type="button"
        >
          <TerminalIcon className="size-3" />
          Terminal
        </button>
        <button
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium',
            tab === 'logs'
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => setTab('logs')}
          type="button"
        >
          <LogsIcon className="size-3" />
          Logs
        </button>
      </div>
      <ScrollArea className="flex-1">
        {tab === 'terminal' ? (
          bashEntries.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              No commands run yet.
            </div>
          ) : (
            <div className="font-mono text-xs">
              {bashEntries.map((entry) => (
                <div key={entry.id} className="border-b border-border/50">
                  <div className="flex items-start gap-2 px-3 py-1 text-foreground">
                    <span className="shrink-0 text-primary">$</span>
                    <span className="whitespace-pre-wrap break-all">
                      {entry.command}
                    </span>
                  </div>
                  {entry.output ? (
                    <pre className="whitespace-pre-wrap break-all px-3 pb-1.5 pt-0 text-muted-foreground">
                      {entry.output}
                    </pre>
                  ) : null}
                  {entry.exitCode !== undefined ? (
                    <div className="px-3 pb-1.5 text-[11px] text-muted-foreground">
                      exit {entry.exitCode}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="font-mono text-xs">
            {logs.length === 0 ? (
              <div className="px-3 py-4 text-xs text-muted-foreground">
                No console output.
              </div>
            ) : (
              logs.map((event) => (
                <div
                  key={event.id}
                  className={cn(
                    'px-3 py-0.5 text-[11px]',
                    event.level === 'error'
                      ? 'text-destructive'
                      : event.level === 'warn'
                        ? 'text-yellow-600'
                        : 'text-foreground',
                  )}
                >
                  <span className="text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>{' '}
                  {event.message}
                </div>
              ))
            )}
          </div>
        )}
        <div ref={endRef} />
      </ScrollArea>
    </div>
  )
}
