import { useEffect, useRef, useState } from 'react'
import { spriteSource, CANVAS_SIZE } from '../animation/SpriteSource'
import { AnimationPlayer } from '../animation/AnimationPlayer'
import { PetFSM, STATE_CLIP, isHomeworkState, pickDailyAction } from '../fsm/machine'
import { Locomotion, type Facing } from '../fsm/locomotion'
import { drawFocusScene, mapToPad, padCenter, smoothHand } from './focusScene'
import { Sway } from './sway'
import { PET_GRAB_ANCHOR } from '../../../shared/types'
import type { CursorPayload, PetState } from '../../../shared/types'

/** 掩码降采样分辨率：64×64 足够判断光标是否压在身上 */
const MASK_RES = 64
/** 掩码上报间隔，过密会白占 IPC 带宽，过疏会让穿透切换迟钝 */
const MASK_INTERVAL_MS = 120
/** Idle 静置多久后进入日常动作 */
const IDLE_DWELL_MS = 12000
/** 多久没有任何操作就去睡觉 */
const SLEEP_AFTER_MS = 180000
/** 按键气泡显示时长（与 .stage-key 的动画时长一致） */
const KEY_BUBBLE_MS = 900
/** 敲键盘动作持续时长 */
const TYPING_MS = 260
/** 悬挂弯曲的横切片高度：越小越柔和，越大绘制调用越少 */
const SWAY_SLICE_H = 4

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
  const [scale, setScale] = useState(1)
  const [keyLabel, setKeyLabel] = useState<{ label: string; seq: number } | null>(null)
  const pomodoroRunning = useRef(false)

  // 渲染循环里高频读取的状态放 ref，避免闭包捕获旧值
  const focusModeRef = useRef(false)
  const keyBubbleRef = useRef(true)
  const cursorRef = useRef<CursorPayload | null>(null)
  const scaleRef = useRef(1)
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
    let loco: Locomotion | null = null
    /** 从 Idle 切进 Roam 时，交给编排器启动的朝向 */
    let pendingWalk: Facing | null = null
    /** 当前 loop 已判定到的循环序号，用于数满一圈 */
    let walkCycleSeen = 0
    /** 悬挂摆动：按窗口横向速度/加速度给画面加旋转，仅拎起与落地回正期间生效 */
    const sway = new Sway()
    let swayHeld = false

    const player = new AnimationPlayer(spriteSource, (clipId) => {
      // 行走四段由编排器串接，绝不能把它们的结束当成状态机的 ANIM_END
      if (clipId.startsWith('walk_')) {
        loco?.onClipEnd()
        return
      }
      fsmInstance?.send({ t: 'ANIM_END', clipId })
    })

    let stateEnteredAt = performance.now()
    let lastInputAt = performance.now()
    let lastActionClip: string | null = null
    /** 下一次插入打瞌睡的时刻（4~6 个作业循环后） */
    let dozeAt = Number.POSITIVE_INFINITY
    /** 手动提前停止番茄钟：等当前这轮动画播完再收尾 */
    let pomoEndPending = false
    /** 停止时正处于入场/打瞌睡，片段播完直接收尾，不再多播一轮循环 */
    let pomoEndSkipLoop = false
    const fsm = new PetFSM((_from, to) => {
      stateEnteredAt = performance.now()
      setState(to)
      // 待机超时与点击共用日常动作池，随机挑一个且不与上次重复
      let clipId = STATE_CLIP[to]
      if (to === 'Action' || to === 'Interact') {
        clipId = pickDailyAction(lastActionClip)
        lastActionClip = clipId
      }
      // Roam 的动画由编排器逐段播放
      if (to !== 'Roam') void player.play(clipId)
      // 入睡片段只有 4 秒，进 Sleepy 时先把循环和起床片段预加载好
      if (to === 'Sleepy') {
        void spriteSource.load('sleep_loop')
        void spriteSource.load('sleep_wake')
      }
      // 作业入场 4 秒，够把循环加载完；循环期间再加载瞌睡和完成片段
      if (to === 'HomeworkEnter') {
        void spriteSource.load('homework_loop')
      }
      if (to === 'Homework') {
        void spriteSource.load('homework_doze')
        void spriteSource.load('homework_done')
        // 4~6 个 6 秒循环后打一次瞌睡
        dozeAt = performance.now() + 24000 + Math.random() * 12000
      }
      // 进入 Roam 时把本轮目标方向交给编排器，由它播起步段
      if (to === 'Roam' && pendingWalk) {
        const dir = pendingWalk
        pendingWalk = null
        loco?.request(dir)
      }
    })
    fsmInstance = fsm

    loco = new Locomotion({
      play: (clipId) => player.play(clipId),
      move: (dir) => window.api.setMoving(dir),
      finish: () => fsm.send({ t: 'WALK_END' })
    })

    /** 托盘指令：请求往某方向走（已在走则改目标，边界处自行掉头） */
    const requestWalk = (dir: Facing): void => {
      // 专注模式下不让狗乱跑
      if (focusModeRef.current) return
      if (fsm.current === 'Roam') {
        loco?.request(dir)
        return
      }
      if (fsm.current !== 'Idle') return
      pendingWalk = dir
      fsm.send({ t: 'WALK_START' })
      // 起步 1.9 秒足够把后两段解码好
      void spriteSource.load('walk_turn')
      void spriteSource.load('walk_stop')
    }

    void player.play(STATE_CLIP[fsm.current])

    // 拎起/悬空/落地素材帧数多，启动稳定后按顺序空闲预加载，避免交互瞬间等待解码
    const preloadTimer = setTimeout(() => {
      void (async () => {
        for (const clipId of [
          'grab_startle',
          'grab_hold',
          'drop_land',
          'sleep_enter',
          'action_taunt',
          'walk_start',
          'walk_loop'
        ]) {
          try {
            await spriteSource.load(clipId)
          } catch {
            // 预加载失败不阻塞，交互时按需加载兜底
          }
        }
      })()
    }, 1500)

    // ---- 片段切换交叉淡化 ----
    const FADE_MS = 160
    const fadeCanvas = document.createElement('canvas')
    const fadeCtx = fadeCanvas.getContext('2d')
    let fadeActive = false
    let fadeStart = 0
    let drawnClipId: string | null = null

    // ---- 命中掩码上报 ----
    let lastMaskAt = 0
    const reportMask = (now: number): void => {
      if (now - lastMaskAt < MASK_INTERVAL_MS) return
      lastMaskAt = now

      // 画布会随缩放变大，掩码与包围盒都按窗口实际像素计算
      const W = canvas.width
      const H = canvas.height
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

      // clip 切换时先快照上一帧，新片段首帧绘制后再淡出快照
      const clipId = player.clipId
      if (clipId && clipId !== drawnClipId) {
        // 行走四段是同一套连续动作，走→走的切换不做淡化；
        // 只有进出非行走片段（待机→起步、刹车→待机）才需要淡化遮住姿势差
        const seamless =
          drawnClipId !== null && clipId.startsWith('walk_') && drawnClipId.startsWith('walk_')
        if (drawnClipId && fadeCtx && !seamless) {
          if (fadeCanvas.width !== canvas.width || fadeCanvas.height !== canvas.height) {
            fadeCanvas.width = canvas.width
            fadeCanvas.height = canvas.height
          }
          fadeCtx.setTransform(1, 0, 0, 1, 0, 0)
          fadeCtx.clearRect(0, 0, fadeCanvas.width, fadeCanvas.height)
          fadeCtx.drawImage(canvas, 0, 0)
          fadeStart = now
          fadeActive = true
        }
        drawnClipId = clipId
        if (clipId === 'walk_loop') walkCycleSeen = 0
      }

      // 走满一个完整循环后，才允许编排器掉头或刹车
      if (loco?.isLooping && player.clipId === 'walk_loop') {
        const duration = player.durationMs
        if (duration > 0) {
          const cycle = Math.floor(player.elapsedMs / duration)
          if (cycle > walkCycleSeen) {
            walkCycleSeen = cycle
            loco.onLoopCycle()
          }
        }
      }

      // 拎起/落地期间按窗口横向运动更新摆动角，其他状态保持竖直
      const held =
        fsm.current === 'Grabbed' || fsm.current === 'Dragging' || fsm.current === 'Dropped'
      if (held) sway.update(now, dt, window.screenX)
      else if (swayHeld) sway.begin(now)
      swayHeld = held

      const s = scaleRef.current
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // 素材按 300×300 设计，缩放时整体放大绘制，遮罩坐标与窗口保持一致
      ctx.setTransform(s, 0, 0, s, 0, 0)
      if (focusModeRef.current && !isHomeworkState(fsm.current)) {
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
        if (frame) {
          // 镜像以「正在绘制的片段」为准。掉头片段跨越了朝向翻转：段内用开始时的朝向，
          // 翻转后的那一帧才不会把末帧镜像成反方向；片段切换是异步的，
          // 翻转当帧仍在画 walk_turn，因此不能只看编排器的当前朝向。
          const drawingTurn = player.clipId === 'walk_turn'
          const faceRight = drawingTurn
            ? loco?.turnMirrored === true
            : loco?.currentFacing === 'right'

          ctx.save()
          // 悬挂摆动绕后颈抓取点旋转。旋转放在镜像之外（抓取点横向居中，两者互不影响），
          // 这样朝左朝右时倾倒方向都正确，鼠标命中掩码也会跟着倾斜后的画面走
          const tilt = swayHeld ? sway.tilt : 0
          const bend = swayHeld ? sway.bend : 0
          if (tilt !== 0) {
            ctx.translate(PET_GRAB_ANCHOR.x, PET_GRAB_ANCHOR.y)
            ctx.rotate(tilt)
            ctx.translate(-PET_GRAB_ANCHOR.x, -PET_GRAB_ANCHOR.y)
          }
          if (faceRight) {
            ctx.translate(CANVAS_SIZE.width, 0)
            ctx.scale(-1, 1)
          }
          if (bend === 0) {
            ctx.drawImage(frame, 0, 0)
          } else {
            // 柔性弯曲：按横切片绘制，越靠近脚底横移越多（按 d² 增长），
            // 头部只跟随刚体旋转，身体和腿被甩在后面
            const dir = faceRight ? -1 : 1
            const top = PET_GRAB_ANCHOR.y
            const span = Math.max(1, CANVAS_SIZE.height - top)
            for (let y = 0; y < CANVAS_SIZE.height; y += SWAY_SLICE_H) {
              const h = Math.min(SWAY_SLICE_H, CANVAS_SIZE.height - y)
              const d = Math.max(0, (y + h / 2 - top) / span)
              const off = bend * d * d * dir
              ctx.drawImage(frame, 0, y, CANVAS_SIZE.width, h, off, y, CANVAS_SIZE.width, h)
            }
          }
          ctx.restore()
        }
      }

      if (fadeActive && fadeCtx) {
        const t = (now - fadeStart) / FADE_MS
        if (t >= 1) {
          fadeActive = false
        } else {
          ctx.setTransform(1, 0, 0, 1, 0, 0)
          ctx.globalAlpha = 1 - t
          ctx.drawImage(fadeCanvas, 0, 0)
          ctx.globalAlpha = 1
        }
      }

      reportMask(now)

      // 手动提前停止番茄钟：先把当前这轮动画播完，再接作业完成动作
      if (pomoEndPending) {
        if (!isHomeworkState(fsm.current)) {
          pomoEndPending = false
          pomoEndSkipLoop = false
        } else if (fsm.current === 'Homework') {
          const duration = player.durationMs
          // 入场/瞌睡片段播完即收尾；正常循环则等这一轮播满
          if (pomoEndSkipLoop || (duration > 0 && player.elapsedMs >= duration)) {
            pomoEndPending = false
            pomoEndSkipLoop = false
            fsm.send({ t: 'POMO_END' })
          }
        }
      }

      // 走路属于「有活动」：行进期间持续刷新活动时间，
      // 否则静置计时会一路累加，刚停下就直接触发入睡
      if (fsm.current === 'Roam') lastInputAt = now

      // 番茄钟期间：写作业循环，每 4~6 轮插一次打瞌睡；
      // 非专注时段：静置一会儿随机播日常动作，超过 1 分钟无操作就入睡。
      const idleMs = now - lastInputAt
      if (pomodoroRunning.current) {
        if (fsm.current === 'Idle') {
          fsm.send({ t: 'POMO_START' })
        } else if (fsm.current === 'Homework' && now > dozeAt) {
          fsm.send({ t: 'DOZE' })
        }
      } else if (!focusModeRef.current) {
        if (idleMs > SLEEP_AFTER_MS) {
          fsm.send({ t: 'SLEEP' })
        } else if (fsm.current === 'Idle' && now - stateEnteredAt > IDLE_DWELL_MS) {
          fsm.send({ t: 'IDLE_TIMEOUT' })
        }
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---- 主进程输入事件 ----
    const offInput = window.api.onPetInput((e) => {
      lastInputAt = performance.now()
      // 拖拽优先级最高：立刻中断行走并停止窗口位移
      if (e.t === 'DRAG_START') {
        loco?.abort()
        // 拎起后主进程会用 200ms 把光标对齐到后颈，这段缓动会伪造横向速度，先忽略
        sway.begin(performance.now(), 220)
      }
      fsm.send(e)
    })

    // ---- 番茄钟 ----
    const offTick = window.api.onPomodoroTick((t) => {
      // 开番茄钟即唤醒并开始写作业
      if (t.running && !pomodoroRunning.current) {
        lastInputAt = performance.now()
        pomoEndPending = false
        pomoEndSkipLoop = false
        // 番茄钟优先于散步：立刻收脚进写作业
        if (fsm.current === 'Roam') {
          loco?.abort()
          fsm.send({ t: 'WALK_END' })
        }
        fsm.send({ t: 'WAKE' })
        fsm.send({ t: 'POMO_START' })
      } else if (!t.running && pomodoroRunning.current) {
        // 手动提前停止：不立刻掐断动画，等这一轮播完再收尾
        lastInputAt = performance.now()
        pomoEndPending = true
        pomoEndSkipLoop = fsm.current === 'HomeworkEnter' || fsm.current === 'Doze'
      }
      pomodoroRunning.current = t.running
      setRemainMs(t.remainMs)
    })

    const offDone = window.api.onPomodoroDone(() => {
      pomodoroRunning.current = false
      pomoEndPending = false
      pomoEndSkipLoop = false
      setRemainMs(0)
      // 写完作业先放松一会儿，避免紧接着就判超时入睡
      lastInputAt = performance.now()
      fsm.send({ t: 'POMO_END' })
    })

    // ---- Focus 模式 / 按键气泡 / 光标 ----
    const offFocus = window.api.onFocusState((s) => {
      focusModeRef.current = s.focusMode
      keyBubbleRef.current = s.keyBubble
      setFocusMode(s.focusMode)
      // 进入专注也当作一次操作，顺便把睡着的叫醒
      if (s.focusMode) {
        lastInputAt = performance.now()
        fsm.send({ t: 'WAKE' })
      }
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

    // ---- 托盘行走指令 ----
    const offLoco = window.api.onLocomotion((cmd) => {
      if (cmd === 'stop') {
        loco?.halt()
        return
      }
      requestWalk(cmd === 'walk-left' ? 'left' : 'right')
    })

    const offScale = window.api.onScale((s) => {
      scaleRef.current = s
      // 画布尺寸变化后旧快照尺寸不再匹配，直接丢弃
      fadeActive = false
      setScale(s)
    })

    return () => {
      offInput()
      offTick()
      offDone()
      offFocus()
      offKey()
      offCursor()
      offScale()
      offLoco()
      loco?.dispose()
      clearTimeout(preloadTimer)
      cancelAnimationFrame(raf)
      spriteSource.dispose()
    }
  }, [])

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        width={Math.round(CANVAS_SIZE.width * scale)}
        height={Math.round(CANVAS_SIZE.height * scale)}
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
