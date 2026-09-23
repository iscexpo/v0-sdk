'use client'

import { createContext, useContext } from 'react'

const SandboxContext = createContext<string | null>(null)

export function SandboxProvider({
  children,
  url,
}: {
  children: React.ReactNode
  url: string | null
}) {
  return <SandboxContext.Provider value={url}>{children}</SandboxContext.Provider>
}

export function useSandbox(): string | null {
  return useContext(SandboxContext)
}
