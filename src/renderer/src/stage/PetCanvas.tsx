import { useEffect, useRef, useState } from 'react'
import { placeholderSource, CANVAS_SIZE } from '../animation/PlaceholderSource'
import { AnimationPlayer } from '../animation/AnimationPlayer'
import { PetFSM, STATE_CLIP } from '../fsm/machine'
import { drawFocusScene, mapToPad, padCenter, smoothHand } from './focusScene'
import type { CursorPayload, PetState } from '../../../shared/types'

/** 掩码降采样分辨率：64×64 足够判断光标是否压在身上 */
const MASK_RES = 64
/** 掩码上报间隔，过密会白占 IPC 带宽，过疏会让穿透切换迟钝 */
const MASK_INTERVAL_MS = 120
/** Idle 静置多久后进入日常动作 */
const IDLE_DWELL_MS = 12000
/** 日常动作持续多久后回到 Idle */
const ACTION_DWELL_MS = 8000
/** 按键气泡显示时长（与 .stage-key 的动画时长一致） */
const KEY_BUBBLE_MS = 900
/** 敲键盘动作持续时长 */
const TYPING_MS = 260

function formatRemain(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 舞台组件：渲染循环 + 动画播放 + 状态机串联 + 命中掩码上报。
 * Focus 模式下改为绘制「书桌 + 键盘 + 鼠标垫」场景，手部跟随全局光标。
 */
export default function PetCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<PetState>('Idle')
  const [remainMs, setRemainMs] = useState(0)
  const [focusMode, setFocusMode] = useState(false)
  const [keyLabel, setKeyLabel] = useState<{ label: string; seq: number } | null>(null)
  const pomodoroRunning = useRef(false)

  // 渲染循环里高频读取的状态放 ref，避免闭包捕获旧值
  const focusModeRef = useRef(false)
  const keyBubbleRef = useRef(true)
  const cursorRef = useRef<CursorPayload | null>(null)
  const handRef = useRef(padCenter())
  const typingUntilRef = useRef(0)
  const keySeqRef = useRef(0)

  // 气泡到点自动消失
  useEffect(() => {
    if (!keyLabel) return
    const timer = setTimeout(() => setKeyLabel(null), KEY_BUBBLE_MS)
    return () => clearTimeout(timer)
  }, [keyLabel])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // willReadFrequently：掩码需要周期性读回像素，走 CPU 后端避免 GPU 回读开销
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    let fsmInstance: PetFSM | null = null

    const player = new AnimationPlayer(placeholderSource, (clipId) => {
      fsmInstance?.send({ t: 'ANIM_END', clipId })
    })

    let stateEnteredAt = performance.now()
    const fsm = new PetFSM((_from, to) => {
      stateEnteredAt = performance.now()
      setState(to)
      void player.play(STATE_CLIP[to])
    })
    fsmInstance = fsm

    void player.play(STATE_CLIP[fsm.current])

    const { width: W, height: H } = CANVAS_SIZE

    // ---- 命中掩码上报 ----
    let lastMaskAt = 0
    const reportMask = (now: number): void => {
      if (now - lastMaskAt < MASK_INTERVAL_MS) return
      lastMaskAt = now

      const data = ctx.getImageData(0, 0, W, H).data
      const cells = new Uint8Array(MASK_RES * MASK_RES)
      const cellW = W / MASK_RES
      const cellH = H / MASK_RES

      let minX = W
      let minY = H
      let maxX = -1
      let maxY = -1

      for (let y = 0; y < H; y++) {
        const gy = Math.min(MASK_RES - 1, (y / cellH) | 0)
        const rowBase = gy * MASK_RES
        for (let x = 0; x < W; x++) {
          if (data[(y * W + x) * 4 + 3] > 25) {
            const gx = Math.min(MASK_RES - 1, (x / cellW) | 0)
            cells[rowBase + gx] = 1
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }

      if (maxX < 0) return // 理论上不会发生，防御空帧
      window.api.reportMask({
        res: MASK_RES,
        cells,
        bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
      })
    }

    // ---- 渲染循环 ----
    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(now - last, 50) // 窗口被挂起后避免单帧跳跃
      last = now

      player.update(dt)

      ctx.clearRect(0, 0, W, H)
      if (focusModeRef.current) {
        // Focus 模式：手部向鼠标垫目标点做帧率无关平滑，边缘由 mapToPad 内缩限位
        const cursor = cursorRef.current
        const target = cursor ? mapToPad(cursor) : padCenter()
        handRef.current = smoothHand(handRef.current, target, dt)
        drawFocusScene(ctx, {
          time: now,
          hand: handRef.current,
          typingUntil: typingUntilRef.current
        })
      } else {
        const frame = player.currentFrame
        if (frame) ctx.drawImage(frame, 0, 0)
      }

      reportMask(now)

      // 日常行为：专注期间锁在 Action 不回落；否则静置太久换动作、动作做久了回 Idle
      const dwell = now - stateEnteredAt
      if (pomodoroRunning.current) {
        if (fsm.current === 'Idle') fsm.send({ t: 'IDLE_TIMEOUT' })
      } else if (fsm.current === 'Idle' && dwell > IDLE_DWELL_MS) {
        fsm.send({ t: 'IDLE_TIMEOUT' })
      } else if (fsm.current === 'Action' && dwell > ACTION_DWELL_MS) {
        fsm.send({ t: 'IDLE_TIMEOUT' })
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---- 主进程输入事件 ----
    const offInput = window.api.onPetInput((e) => {
      fsm.send(e)
    })

    // ---- 番茄钟 ----
    const offTick = window.api.onPomodoroTick((t) => {
      pomodoroRunning.current = t.running
      setRemainMs(t.remainMs)
    })

    const offDone = window.api.onPomodoroDone(() => {
      pomodoroRunning.current = false
      setRemainMs(0)
    })

    // ---- Focus 模式 / 按键气泡 / 光标 ----
    const offFocus = window.api.onFocusState((s) => {
      focusModeRef.current = s.focusMode
      keyBubbleRef.current = s.keyBubble
      setFocusMode(s.focusMode)
    })

    const offKey = window.api.onKeyEvent((e) => {
      if (!keyBubbleRef.current) return
      typingUntilRef.current = performance.now() + TYPING_MS
      keySeqRef.current += 1
      setKeyLabel({ label: e.label, seq: keySeqRef.current })
    })

    const offCursor = window.api.onCursor((p) => {
      cursorRef.current = p
    })

    return () => {
      offInput()
      offTick()
      offDone()
      offFocus()
      offKey()
      offCursor()
      cancelAnimationFrame(raf)
      placeholderSource.dispose()
    }
  }, [])

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE.width}
        height={CANVAS_SIZE.height}
        className="stage-canvas"
      />
      <div className="stage-debug">{focusMode ? `Focus · ${state}` : state}</div>
      {remainMs > 0 && <div className="stage-timer">{formatRemain(remainMs)}</div>}
      {keyLabel && (
        <div key={keyLabel.seq} className="stage-key">
          {keyLabel.label}
        </div>
      )}
    </div>
  )
}
