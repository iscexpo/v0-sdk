'use client'

import { type V0UIMessage } from '@v0-sdk/react'
import { useRef } from 'react'

type BashPart = { type: 'data-v0-bash'; data: { command: string; output?: string; exitCode?: number | null } }

export function TerminalView({
  messages,
}: {
  messages: V0UIMessage[]
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const entries = messages.flatMap((msg) => {
    if (msg.role !== 'assistant') return []
    return msg.parts
      .filter((part): part is BashPart => part.type === 'data-v0-bash')
      .map((part) => ({
        command: part.data.command,
        output: part.data.output ?? '',
        exitCode: part.data.exitCode,
      }))
  })

  return (
    <div className="flex h-full flex-col bg-[#1e1e1e] text-[#d4d4d4] font-mono text-sm">
      <div className="flex items-center gap-2 border-b border-[#3c3c3c] px-3 py-2 text-xs text-[#9cdcfe]">
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        Terminal
        {entries.length > 0 && (
          <span className="ml-auto text-[10px] text-[#858585]">{entries.length} command{entries.length > 1 ? 's' : ''}</span>
        )}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-3">
        {entries.length === 0 && (
          <div className="text-[#858585] text-xs">No terminal commands yet.</div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="mb-3 last:mb-0">
            <div className="flex items-center gap-2 text-[#dcdcaa]">
              <span className="text-[#4ec9b0]">$</span>
              <span className="break-all">{entry.command}</span>
            </div>
            {entry.output && (
              <pre className="mt-1 whitespace-pre-wrap text-[#b5cea8] text-xs leading-relaxed">
                {entry.output}
              </pre>
            )}
            {entry.exitCode !== undefined && (
              <div className="text-[10px] text-[#858585] mt-1">
                exit code {entry.exitCode}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
