import fs from 'node:fs'
import path from 'node:path'

export type Framework = 'nextjs' | 'vite' | 'astro' | 'remix' | 'node'

export interface FrameworkInfo {
  framework: Framework
  packageManager: 'bun' | 'pnpm' | 'yarn' | 'npm'
  installCommand: string[]
  devCommand: string[]
  port: number
}

function packageManagerFor(dir: string): FrameworkInfo['packageManager'] {
  if (fs.existsSync(path.join(dir, 'bun.lockb')) || fs.existsSync(path.join(dir, 'bun.lock'))) return 'bun'
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

export function detectFramework(dir: string): FrameworkInfo | null {
  const packagePath = path.join(dir, 'package.json')
  if (!fs.existsSync(packagePath)) return null

  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const scripts = pkg.scripts ?? {}
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
  const manager = packageManagerFor(dir)
  const runner = manager === 'npm' ? 'npx' : manager
  const script = scripts.dev ? [runner, 'run', 'dev'] : scripts.start ? [runner, 'run', 'start'] : null
  if (!script) return null

  const framework: Framework = dependencies.next || fs.existsSync(path.join(dir, 'next.config.js')) || fs.existsSync(path.join(dir, 'next.config.ts'))
    ? 'nextjs'
    : dependencies.vite || fs.existsSync(path.join(dir, 'vite.config.ts')) || fs.existsSync(path.join(dir, 'vite.config.js'))
      ? 'vite'
      : dependencies.astro || fs.existsSync(path.join(dir, 'astro.config.mjs'))
        ? 'astro'
        : dependencies['@remix-run/dev'] || fs.existsSync(path.join(dir, 'remix.config.js'))
          ? 'remix'
          : 'node'

  return {
    framework,
    packageManager: manager,
    installCommand: manager === 'npm' ? ['npm', 'install'] : [manager, 'install'],
    devCommand: script,
    port: framework === 'node' ? 3000 : 3000,
  }
}

export function resolveWorkspacePath(root: string, requestedPath: string) {
  const resolvedRoot = path.resolve(root)
  const resolvedPath = path.resolve(root, requestedPath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path must remain inside the sandbox workspace.')
  }
  return resolvedPath
}

export function commandWithPort(info: FrameworkInfo, port: number) {
  if (info.framework === 'nextjs') return [...info.devCommand, '--', '-p', String(port)]
  if (info.framework === 'vite') return [...info.devCommand, '--', '--host', '0.0.0.0', '--port', String(port)]
  return info.devCommand
}
