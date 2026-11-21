import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { inspect } from 'util'

/**
 * 极简主进程日志：写 userData/logs/main.log，超过 1MB 轮转为 main.old.log。
 * 桌宠没有控制台窗口，用户反馈问题时可从这里拿到启动与异常线索。
 */
const MAX_SIZE = 1024 * 1024

let filePath: string | null = null
let installed = false

function resolveFile(): string | null {
  if (filePath) return filePath
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const target = join(dir, 'main.log')
    try {
      if (statSync(target).size > MAX_SIZE) renameSync(target, join(dir, 'main.old.log'))
    } catch {
      // 文件不存在或轮转失败都不影响继续写入
    }
    filePath = target
    return filePath
  } catch {
    return null
  }
}

function format(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 4, breakLength: 120 })))
    .join(' ')
}

function write(level: string, args: unknown[]): void {
  const file = resolveFile()
  if (!file) return
  try {
    appendFileSync(file, `[${new Date().toISOString()}] [${level}] ${format(args)}\n`, 'utf-8')
  } catch {
    // 磁盘满 / 无权限时不递归报错
  }
}

export function logInfo(...args: unknown[]): void {
  write('INFO', args)
}

export function logError(...args: unknown[]): void {
  write('ERROR', args)
}

/** 接管 console 与进程级异常，尽量把崩溃原因留在日志里。 */
export function setupLogger(): void {
  if (installed) return
  installed = true

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  }

  console.log = (...args: unknown[]): void => {
    write('INFO', args)
    original.log(...args)
  }
  console.warn = (...args: unknown[]): void => {
    write('WARN', args)
    original.warn(...args)
  }
  console.error = (...args: unknown[]): void => {
    write('ERROR', args)
    original.error(...args)
  }

  process.on('uncaughtException', (error) => {
    write('ERROR', ['uncaughtException', error])
    original.error(error)
    app.exit(1)
  })

  process.on('unhandledRejection', (reason) => {
    write('ERROR', ['unhandledRejection', reason])
    original.error(reason)
  })

  logInfo(`logger ready, version=${app.getVersion()}, packaged=${app.isPackaged}`)
}
