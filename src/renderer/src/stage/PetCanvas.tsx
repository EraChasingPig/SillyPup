import { useEffect, useRef, useState } from 'react'
import { placeholderSource, CANVAS_SIZE } from '../animation/PlaceholderSource'
import { AnimationPlayer } from '../animation/AnimationPlayer'
import { PetFSM, STATE_CLIP } from '../fsm/machine'
import type { PetState } from '../../../shared/types'

/**
 * 舞台组件：负责渲染循环、动画播放与状态机串联。
 * M1 阶段用定时器模拟点击/拖拽事件，验证 7 个状态能否正确迁移；
 * M2 接入主进程的 alpha 命中与真实鼠标事件后移除这段演示序列。
 */
export default function PetCanvas(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<PetState>('Idle')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let fsmInstance: PetFSM | null = null

    const player = new AnimationPlayer(placeholderSource, (clipId) => {
      fsmInstance?.send({ t: 'ANIM_END', clipId })
    })

    const fsm = new PetFSM((_from, to) => {
      setState(to)
      void player.play(STATE_CLIP[to])
    })
    fsmInstance = fsm

    void player.play(STATE_CLIP[fsm.current])

    // 渲染循环：dt 上限 50ms，避免窗口被系统挂起后单帧跳跃
    let raf = 0
    let last = performance.now()
    const loop = (now: number): void => {
      const dt = Math.min(now - last, 50)
      last = now

      player.update(dt)

      ctx.clearRect(0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height)
      const frame = player.currentFrame
      if (frame) ctx.drawImage(frame, 0, 0)

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---- M1 演示序列（临时）----
    const timers: number[] = []
    let cancelled = false
    const later = (ms: number, fn: () => void): void => {
      timers.push(
        window.setTimeout(() => {
          if (!cancelled) fn()
        }, ms)
      )
    }
    const runDemo = (): void => {
      later(1500, () => fsm.send({ t: 'IDLE_TIMEOUT' }))
      later(3500, () => fsm.send({ t: 'IDLE_TIMEOUT' }))
      later(5500, () => fsm.send({ t: 'CLICK' }))
      later(9000, () => fsm.send({ t: 'DRAG_START', pt: { x: 0, y: 0 } }))
      later(12000, () => fsm.send({ t: 'DRAG_END', pt: { x: 0, y: 0 } }))
      later(15000, runDemo)
    }
    runDemo()

    return () => {
      cancelled = true
      timers.forEach((t) => clearTimeout(t))
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
      <div className="stage-debug">{state}</div>
    </div>
  )
}
