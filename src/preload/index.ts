import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/types'
import type {
  CursorPayload,
  FocusState,
  HitMask,
  JumpMovePlan,
  KeyEventPayload,
  LocomotionCmd,
  MoveDirection,
  PetInputEvent,
  PomodoroTick
} from '../shared/types'

const api = {
  platform: process.platform,

  /** 渲染层 → 主进程：上报命中掩码（决定鼠标穿透与否） */
  reportMask: (mask: HitMask): void => {
    ipcRenderer.send(IPC_CHANNELS.MASK, mask)
  },

  /** 主进程 → 渲染层：订阅点击 / 拖拽输入事件，返回取消订阅函数 */
  onPetInput: (cb: (e: PetInputEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PetInputEvent): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.INPUT, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.INPUT, handler)
    }
  },

  /** 主进程 → 渲染层：番茄钟每秒心跳 */
  onPomodoroTick: (cb: (t: PomodoroTick) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PomodoroTick): void => {
      cb(payload)
    }
    ipcRenderer.on(IPC_CHANNELS.POMODORO_TICK, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.POMODORO_TICK, handler)
    }
  },

  /** 主进程 → 渲染层：番茄钟结束 */
  onPomodoroDone: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on(IPC_CHANNELS.POMODORO_DONE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.POMODORO_DONE, handler)
    }
  },

  /** 自定义时长窗口：提交（分钟） */
  submitPrompt: (minutes: number): void => {
    ipcRenderer.send(IPC_CHANNELS.PROMPT_SUBMIT, minutes)
  },

  /** 自定义时长窗口：取消 */
  cancelPrompt: (): void => {
    ipcRenderer.send(IPC_CHANNELS.PROMPT_CANCEL)
  },

  /** 主进程 → 渲染层：Focus 模式与按键气泡开关 */
  onFocusState: (cb: (s: FocusState) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: FocusState): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.FOCUS_STATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.FOCUS_STATE, handler)
    }
  },

  /** 主进程 → 渲染层：全局按键 */
  onKeyEvent: (cb: (e: KeyEventPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: KeyEventPayload): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.KEY_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.KEY_EVENT, handler)
    }
  },

  /** 主进程 → 渲染层：全局光标位置（Focus 模式鼠标垫映射） */
  onCursor: (cb: (p: CursorPayload) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, payload: CursorPayload): void => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.CURSOR, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.CURSOR, handler)
    }
  },

  /** 主进程 → 渲染层：桌宠缩放比例 */
  onScale: (cb: (scale: number) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, scale: number): void => cb(scale)
    ipcRenderer.on(IPC_CHANNELS.SCALE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SCALE, handler)
    }
  },

  /** 主进程 → 渲染层：托盘发起的行走 / 停下指令 */
  onLocomotion: (cb: (cmd: LocomotionCmd) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, cmd: LocomotionCmd): void => cb(cmd)
    ipcRenderer.on(IPC_CHANNELS.LOCOMOTION, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.LOCOMOTION, handler)
    }
  },

  /** 渲染层 → 主进程：开始 / 停止窗口水平位移 */
  setMoving: (dir: MoveDirection): void => {
    ipcRenderer.send(IPC_CHANNELS.MOVE, dir)
  },

  /** 渲染层 → 主进程：下发一轮跳跃的窗口垂直位移时间表 */
  jumpMove: (plan: JumpMovePlan): void => {
    ipcRenderer.send(IPC_CHANNELS.JUMP_MOVE, plan)
  },

  /** 渲染层 → 主进程：取消跳跃位移（被打断或已落地） */
  cancelJump: (): void => {
    ipcRenderer.send(IPC_CHANNELS.JUMP_CANCEL)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PreloadApi = typeof api
