import koffi from 'koffi'

/** 通过 user32.GetAsyncKeyState 轮询全局按键（不装键盘钩子，避免杀软误报） */
const user32 = koffi.load('user32.dll')
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)')

/**
 * 只轮询白名单键位，约 100 个。
 * 鼠标键不在此列，避免点击桌宠时误弹按键气泡。
 */
const VK_LABELS: Record<number, string> = {
  0x08: 'Backspace',
  0x09: 'Tab',
  0x0d: 'Enter',
  0x1b: 'Esc',
  0x20: 'Space',
  0x21: 'PgUp',
  0x22: 'PgDn',
  0x23: 'End',
  0x24: 'Home',
  0x25: '←',
  0x26: '↑',
  0x27: '→',
  0x28: '↓',
  0x2e: 'Delete',
  0x10: 'Shift',
  0x11: 'Ctrl',
  0x12: 'Alt',
  0x14: 'Caps'
}

for (let c = 0x41; c <= 0x5a; c++) VK_LABELS[c] = String.fromCharCode(c)
for (let c = 0x30; c <= 0x39; c++) VK_LABELS[c] = String.fromCharCode(c)
for (let i = 0; i < 12; i++) VK_LABELS[0x70 + i] = `F${i + 1}`

const PUNCTUATION: [number, string][] = [
  [0xba, ';'],
  [0xbb, '='],
  [0xbc, ','],
  [0xbd, '-'],
  [0xbe, '.'],
  [0xbf, '/'],
  [0xc0, '`'],
  [0xdb, '['],
  [0xdc, '\\'],
  [0xdd, ']'],
  [0xde, "'"]
]
for (const [vk, label] of PUNCTUATION) VK_LABELS[vk] = label

const VK_CODES = Object.keys(VK_LABELS)
  .map(Number)
  .sort((a, b) => a - b)

/** 两次按键气泡的最小间隔，防止连打刷屏 */
const MIN_GAP_MS = 40

export interface KeyPollerHandle {
  stop: () => void
  /** 暂停轮询（例如自定义时长窗口输入时，避免把自己敲的字弹出来） */
  setEnabled: (on: boolean) => void
}

/**
 * 启动全局按键轮询。
 * 用上一帧按下集合做差集得到「本帧新按下」，天然去重，不会因长按而重复上报。
 */
export function startKeyPoller(onKey: (label: string) => void): KeyPollerHandle {
  const prevDown = new Set<number>()
  let enabled = true
  let lastEmitAt = 0

  const tick = (): void => {
    if (!enabled) return

    const fresh: string[] = []
    for (const vk of VK_CODES) {
      const down = (GetAsyncKeyState(vk) & 0x8000) !== 0
      if (down) {
        if (!prevDown.has(vk)) {
          prevDown.add(vk)
          fresh.push(VK_LABELS[vk])
        }
      } else if (prevDown.has(vk)) {
        prevDown.delete(vk)
      }
    }

    if (fresh.length === 0) return
    const now = Date.now()
    if (now - lastEmitAt < MIN_GAP_MS) return
    lastEmitAt = now
    // 一个 tick 内最多展示最后按下的键
    onKey(fresh[fresh.length - 1])
  }

  const timer = setInterval(tick, 20) // ~50Hz

  return {
    stop: () => clearInterval(timer),
    setEnabled: (on: boolean) => {
      enabled = on
      // 重新启用时清空基线，避免把暂停期间按住的键当成新按下
      if (on) prevDown.clear()
    }
  }
}
