import { useEffect, useRef, useState } from 'react'
import { spriteSource, CANVAS_SIZE } from '../animation/SpriteSource'
import { AnimationPlayer } from '../animation/AnimationPlayer'
import {
  PetFSM,
  STATE_CLIP,
  isHomeworkState,
  pickDailyItem
} from '../fsm/machine'
import { Locomotion, type Facing } from '../fsm/locomotion'
import { drawFocusScene, mapToPad, padCenter, smoothHand } from './focusScene'
import { Sway } from './sway'
import {
  APPLE_ARRIVE_DX,
  APPLE_ARRIVE_DY,
  APPLE_PIN_BOTTOM_Y,
  APPLE_PIN_CX_LEFT,
  APPLE_PIN_CX_RIGHT,
  PET_GRAB_ANCHOR,
  PET_VISIBLE_TOP
} from '../../../shared/types'
import type {
  ApplePos,
  CursorPayload,
  JumpDirection,
  PetEvent,
  PetState
} from '../../../shared/types'

/** 掩码降采样分辨率：64×64 足够判断光标是否压在身上 */
const MASK_RES = 64
/** 掩码上报间隔，过密会白占 IPC 带宽，过疏会让穿透切换迟钝 */
const MASK_INTERVAL_MS = 120
/** Idle 静置多久后进入日常动作 */
const IDLE_DWELL_MS = 12000
/** 待机转坐姿讨食的概率（超时与点击共用） */
const SIT_CHANCE = 0.15
/** 待机转「看屏幕指东西」的概率（超时与点击共用） */
const POINT_CHANCE = 0.15
/** 坐姿与指屏幕之间的最小间隔，避免特殊行为连续触发 */
const SPECIAL_COOLDOWN_MS = 30000
/** 坐着等苹果的忍耐时长，超时就生气撒泼 */
const SIT_GIVEUP_MS = 60000
/** 多久没有任何用户操作就去睡觉 */
const SLEEP_AFTER_MS = 300000
/** 连续睡多久后自动起床 */
const SLEEP_WAKE_MS = 300000
/** 按键气泡显示时长（与 .stage-key 的动画时长一致） */
const KEY_BUBBLE_MS = 900
/** 敲键盘动作持续时长 */
const TYPING_MS = 260
/** 悬挂弯曲的横切片高度：越小越柔和，越大绘制调用越少 */
const SWAY_SLICE_H = 4
/** 每跳窗口上升距离（DIP，按当前缩放换算） */
const JUMP_STEP_UP = 60
/** 向下跳的单跳下沉距离：小于素材腾空高度（约 44px），保留“先跳起再落到下一级”的观感 */
const JUMP_STEP_DOWN = 40
/** jump_loop 每跳的腾空帧区间（24fps，按素材逐帧实测） */
const JUMP_HOP_AIR_FRAMES: ReadonlyArray<readonly [number, number]> = [
  [13, 32],
  [41, 59],
  [65, 81]
]
const JUMP_LOOP_FPS = 24
/** sit_enter 末尾提前多久淡出苹果 */
const SIT_APPLE_FADE_MS = 500
/** 一轮跳跃后纵向距离改善不足该值，判定竖直方向走不通 */
const SEEK_MIN_GAIN = 10
/** 找苹果时 jump_loop 最多串联的圈数，防止贴边时无限空跳 */
const JUMP_MAX_CHAIN_LOOPS = 8
/** 串联期间允许苹果横向偏移超出到达容差的余量，超出就先落地走过去 */
const JUMP_CHAIN_DX_SLACK = 20
/** 拖拽三段体量大、又被高频触发，预热后常驻，避免每次拖拽重新解码导致动作整体延迟 */
const DRAG_CLIPS = ['grab_startle', 'grab_hold', 'drop_land'] as const
/** 启动后多久预热拖拽片段：避开首屏与开场动画 */
const DRAG_WARMUP_DELAY_MS = 2000
/** 缩放结束后多久按新尺寸重新预热：拖动缩放期间会不断变化，等停下再解码 */
const SCALE_REWARM_DELAY_MS = 800

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
  const [showState, setShowState] = useState(false)
  const [scale, setScale] = useState(1)
  /** 仅用于让画布尺寸跟随 devicePixelRatio 重新渲染 */
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  const [keyLabel, setKeyLabel] = useState<{ label: string; seq: number } | null>(null)
  const pomodoroRunning = useRef(false)

  // 渲染循环里高频读取的状态放 ref，避免闭包捕获旧值
  const focusModeRef = useRef(false)
  const keyBubbleRef = useRef(true)
  const cursorRef = useRef<CursorPayload | null>(null)
  const scaleRef = useRef(1)
  /** 画布分辨率倍数：窗口所在显示器的 devicePixelRatio，跨屏或改缩放时会变 */
  const dprRef = useRef(window.devicePixelRatio || 1)
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
    // 全应用已关闭硬件加速，舞台用默认 2D 上下文即可；
    // 掩码走独立的 64×64 小画布读取，舞台本身不再回读整幅像素
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 帧按「窗口缩放 × devicePixelRatio」解码，先按当前值初始化一次
    spriteSource.setRenderScale(scaleRef.current * dprRef.current)

    // 拖拽三段在后台预热并常驻；缩放变化会解除常驻，停下后按新尺寸重新预热
    let warmTimer: ReturnType<typeof setTimeout> | null = null
    const warmDragClips = (delay: number): void => {
      if (warmTimer) clearTimeout(warmTimer)
      warmTimer = setTimeout(() => {
        warmTimer = null
        void spriteSource.retain(DRAG_CLIPS)
      }, delay)
    }
    warmDragClips(DRAG_WARMUP_DELAY_MS)

    let fsmInstance: PetFSM | null = null
    let loco: Locomotion | null = null
    /** 从 Idle 切进 Roam 时，交给编排器启动的朝向 */
    let pendingWalk: Facing | null = null
    /** 当前 loop 已判定到的循环序号，用于数满一圈 */
    let walkCycleSeen = 0
    /** jump_loop 已判定到的循环序号与本次飞行已完成的圈数 */
    let jumpCycleSeen = 0
    let jumpLoopCount = 0
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

    // 窗口跨屏或系统显示缩放变化时 devicePixelRatio 会变：
    // 画布分辨率、绘制变换与解码尺寸都要跟着重建，否则画面会被系统放大而发糊
    const syncDpr = (): void => {
      const next = window.devicePixelRatio || 1
      if (Math.abs(next - dprRef.current) < 0.001) return
      dprRef.current = next
      setDpr(next)
      spriteSource.setRenderScale(scaleRef.current * next)
      if (player.clipId) void player.play(player.clipId)
      warmDragClips(SCALE_REWARM_DELAY_MS)
    }
    window.addEventListener('resize', syncDpr)
    const offDisplayChanged = window.api.onDisplayChanged(syncDpr)

    let stateEnteredAt = performance.now()
    let lastInputAt = performance.now()
    /** 进入睡眠的时刻，用于睡满 5 分钟后自动起床 */
    let sleepAt = 0
    /** 本轮日常互动抽中的条目，进入 Action / Interact 时用于播放 */
    let pendingActionClip: string | null = null
    /** 上一次抽中的日常条目，包含 'jump'，用于避免连续重复 */
    let lastDailyItem: string | null = null
    /** 本轮跳跃的方向；inPlace 表示原地跳、不移动窗口 */
    let jumpDir: JumpDirection = 'inPlace'
    /** 本轮跳跃每跳的窗口位移（DIP）；找苹果时动态计算，日常跳为 null */
    let jumpStepDip: number | null = null
    /** 本次跳跃是否属于找苹果（只有找苹果才允许 jump_loop 串联） */
    let jumpSeek = false
    /** 找苹果轮次是否进行中（召唤 → sit_eat_happy 播完） */
    let appleRoundActive = false
    /** 是否已收到苹果当前位置，收到后规划器才开始行动 */
    let applePosReady = false
    /** 苹果最新位置（屏幕 DIP：底部中心） */
    let applePos: ApplePos = { cx: 0, bottom: 0 }
    /** 当前行走段是否属于找苹果 */
    let seekWalk = false
    /** 竖直方向判定走不通，本轮不再跳 */
    let seekStuckY = false
    /** 起跳前的纵向距离，落地后用于判断是否卡住 */
    let jumpDyBefore: number | null = null
    /** sit_enter 末尾的苹果淡出是否已发出 */
    let appleFadeSent = false
    /** 上一次坐姿/指屏幕的触发时间，用于 30 秒特殊行为冷却 */
    let lastSpecialAt = Number.NEGATIVE_INFINITY
    /** 下一次插入打瞌睡的时刻（4~6 个作业循环后） */
    let dozeAt = Number.POSITIVE_INFINITY
    /** 手动提前停止番茄钟：等当前这轮动画播完再收尾 */
    let pomoEndPending = false
    /** 停止时正处于入场/打瞌睡，片段播完直接收尾，不再多播一轮循环 */
    let pomoEndSkipLoop = false
    /** 掷一次特殊行为：指屏幕 15%、坐姿 15%，其余交给日常动作；冷却期内不触发 */
    const rollSpecial = (now: number): PetEvent | null => {
      if (now - lastSpecialAt < SPECIAL_COOLDOWN_MS) return null
      const r = Math.random()
      if (r < POINT_CHANCE) return { t: 'POINT_TRIGGER' }
      if (r < POINT_CHANCE + SIT_CHANCE) return { t: 'SIT_TRIGGER' }
      return null
    }

    /**
     * 待机互动掷骰：先试特殊行为，再落到日常池。
     * 抽中整轮跳跃时直接返回 JUMP_START；抽中普通动作则只记下 clip，返回 null，
     * 由调用方继续走 IDLE_TIMEOUT / CLICK。
     */
    const rollIdleExtra = (now: number): PetEvent | null => {
      const special = rollSpecial(now)
      if (special) return special
      const allowJump = now - lastSpecialAt >= SPECIAL_COOLDOWN_MS
      const item = pickDailyItem(lastDailyItem, allowJump)
      lastDailyItem = item
      if (item === 'jump') return { t: 'JUMP_START', dir: 'inPlace' }
      pendingActionClip = item
      return null
    }

    /** 按素材腾空帧区间把一圈窗口位移时间表发给主进程 */
    const sendJumpMove = (dir: 'up' | 'down', stepDip: number): void => {
      const hops = JUMP_HOP_AIR_FRAMES.map(([start, end]) => ({
        startMs: Math.round((start / JUMP_LOOP_FPS) * 1000),
        endMs: Math.round((end / JUMP_LOOP_FPS) * 1000)
      }))
      window.api.jumpMove({ dir, stepDip, hops })
    }

    /** 进入跳跃循环后，按素材腾空帧区间把窗口位移时间表发给主进程 */
    const startJumpMove = (): void => {
      if (jumpDir === 'inPlace') return
      const dir: 'up' | 'down' = jumpDir === 'up' ? 'up' : 'down'
      const base = (dir === 'up' ? JUMP_STEP_UP : JUMP_STEP_DOWN) * scaleRef.current
      // 找苹果时按剩余距离动态均摊；日常跳按固定挡位
      const stepDip = jumpStepDip ?? base
      jumpStepDip = null
      sendJumpMove(dir, stepDip)
    }

    const fsm = new PetFSM((from, to, e) => {
      stateEnteredAt = performance.now()
      setState(to)
      // 离开跳跃循环时立刻停掉窗口位移，拖拽打断时尤其重要
      if (from === 'JumpLoop') {
        window.api.cancelJump()
        jumpSeek = false
      }
      // 吃苹果动画播完，本轮找苹果才算真正结束
      if (from === 'SitEat' && to === 'Idle') endAppleRound()
      // 找苹果的思考间隙不保留行走状态；被召唤打断的散步就地停下
      if (to === 'AppleSeek') {
        seekWalk = false
        if (e.t === 'APPLE_SUMMON') {
          loco?.abort()
          window.api.cancelJump()
        }
      }
      // 坐姿、指屏幕与整轮跳跃共享 30 秒大动作冷却
      if (to === 'SitEnter' || to === 'PointPeek' || to === 'JumpPrepare') {
        lastSpecialAt = performance.now()
      }
      // 待机超时与点击共用日常池，抽中的条目在掷骰时已经定好
      let clipId = STATE_CLIP[to]
      if (to === 'Action' || to === 'Interact') {
        clipId = pendingActionClip ?? pickDailyItem(lastDailyItem, false)
        pendingActionClip = null
        lastDailyItem = clipId
      }
      // Roam 的动画由编排器逐段播放
      if (to === 'Roam') {
        /* 由编排器接管 */
      } else if (to === 'JumpLoop') {
        // 等循环片段真正开始播放，再按腾空区间下发窗口位移
        void player.play(clipId).then(() => {
          if (fsmInstance?.current === 'JumpLoop') startJumpMove()
        })
      } else {
        void player.play(clipId)
      }
      // 入睡片段只有 4 秒，进 Sleepy 时先把循环和起床片段预加载好
      if (to === 'Sleepy') {
        sleepAt = performance.now()
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
      // 坐姿素材帧数多，趁坐下和发呆的时间提前解码下一段
      if (to === 'SitEnter') {
        void spriteSource.load('sit_idle')
        void spriteSource.load('sit_eat_happy')
      }
      if (to === 'SitIdle') {
        void spriteSource.load('sit_eat_happy')
        void spriteSource.load('sit_angry')
      }
      // 看屏幕 4 秒，趁这段时间把回头的 6 秒片段解码好
      if (to === 'PointPeek') {
        void spriteSource.load('point_show')
      }
      // 起跳前有 4 秒，把循环和落地两段都解码好
      if (to === 'JumpPrepare') {
        jumpDir = e.t === 'JUMP_START' ? e.dir : 'inPlace'
        jumpStepDip = e.t === 'JUMP_START' ? (e.stepDip ?? null) : null
        jumpSeek = e.t === 'JUMP_START' && e.returnTo === 'AppleSeek'
        void spriteSource.load('jump_loop')
        void spriteSource.load('jump_land')
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

    /** 托盘指令：向上 / 向下跳一层（一轮三段） */
    const requestJump = (dir: 'up' | 'down'): void => {
      // 专注模式不跳；只在待机时起跳，跳跃期间忽略重复指令
      if (focusModeRef.current || fsm.current !== 'Idle') return
      fsm.send({ t: 'JUMP_START', dir })
    }

    /** 苹果相对小狗的偏差：dx 按窗口中心，dy 按苹果底边与小狗可见上沿 */
    const appleDelta = (): { dx: number; dy: number } => ({
      dx: applePos.cx - (window.screenX + window.innerWidth / 2),
      dy: applePos.bottom - (window.screenY + PET_VISIBLE_TOP * scaleRef.current)
    })

    /**
     * jump_loop 每播完一圈调用一次。
     * 找苹果时若还在远离目标且同方向仍有进展，就无缝接下一圈；
     * 否则发 JUMP_LAND 进入落地段。日常跳与托盘跳只播一圈。
     */
    const onJumpCycleEnd = (): void => {
      jumpLoopCount += 1
      if (
        jumpSeek &&
        appleRoundActive &&
        jumpDir !== 'inPlace' &&
        jumpLoopCount < JUMP_MAX_CHAIN_LOOPS
      ) {
        const { dx, dy } = appleDelta()
        const sameDir = jumpDir === 'up' ? dy < 0 : dy > 0
        const far = Math.abs(dy) > APPLE_ARRIVE_DY
        const gain =
          jumpDyBefore === null
            ? Number.POSITIVE_INFINITY
            : Math.abs(jumpDyBefore) - Math.abs(dy)
        if (
          far &&
          sameDir &&
          gain >= SEEK_MIN_GAIN &&
          Math.abs(dx) <= APPLE_ARRIVE_DX + JUMP_CHAIN_DX_SLACK
        ) {
          // 继续下一圈：以当前窗口位置为新锚点，按剩余距离重算每跳步长
          jumpDyBefore = dy
          const dir: 'up' | 'down' = jumpDir === 'up' ? 'up' : 'down'
          const base = (dir === 'up' ? JUMP_STEP_UP : JUMP_STEP_DOWN) * scaleRef.current
          sendJumpMove(dir, Math.max(1, Math.min(Math.abs(dy) / 3, base)))
          return
        }
        // 同方向连跳却没有进展，说明已经贴到工作区边缘
        if (far && sameDir && gain < SEEK_MIN_GAIN) seekStuckY = true
        // 苹果在跳跃期间越过了小狗：落地后重新判断方向，别误判为卡住
        if (far && !sameDir) jumpDyBefore = null
      }
      jumpSeek = false
      fsmInstance?.send({ t: 'JUMP_LAND' })
    }

    /** 结束本轮找苹果：主进程收起苹果，菜单项恢复可用 */
    const endAppleRound = (): void => {
      if (!appleRoundActive) return
      appleRoundActive = false
      applePosReady = false
      seekWalk = false
      seekStuckY = false
      jumpDyBefore = null
      appleFadeSent = false
      window.api.appleEnd()
    }

    /** 中断找苹果：收苹果 + 停位移 + 回待机（番茄钟、拖拽、超时共用） */
    const abortSeek = (): void => {
      if (!appleRoundActive) return
      endAppleRound()
      loco?.abort()
      window.api.cancelJump()
      fsm.send({ t: 'APPLE_CANCEL' })
    }

    /**
     * 找苹果规划器：每帧在「思考」状态里决定下一步。
     * 策略是先横后竖：水平没对齐就走到容差内，再按剩余高度分三段跳。
     * 跳跃期间窗口纵向移动由主进程执行，这里只等待落地回到 AppleSeek。
     */
    const seekTick = (): void => {
      if (!appleRoundActive || !applePosReady) return

      // sit_enter 末尾把跟随苹果淡出，接上 sit_eat_happy 自带的苹果
      if (fsm.current === 'SitEnter') {
        if (
          !appleFadeSent &&
          player.clipId === 'sit_enter' &&
          player.durationMs > 0 &&
          player.elapsedMs >= player.durationMs - SIT_APPLE_FADE_MS
        ) {
          appleFadeSent = true
          window.api.appleFadeOut()
        }
        return
      }

      // 行走段中：苹果还在动就持续修正方向，进入水平容差就刹车
      if (fsm.current === 'Roam' && seekWalk) {
        const { dx } = appleDelta()
        if (Math.abs(dx) <= APPLE_ARRIVE_DX) loco?.halt()
        else loco?.request(dx > 0 ? 'right' : 'left')
        return
      }

      if (fsm.current !== 'AppleSeek') return

      const { dx, dy } = appleDelta()

      // 上一轮跳跃落地：纵向没有实质改善，说明已经贴到工作区边缘
      if (jumpDyBefore !== null) {
        if (
          Math.abs(dy) > APPLE_ARRIVE_DY &&
          Math.abs(dy) > Math.abs(jumpDyBefore) - SEEK_MIN_GAIN
        ) {
          seekStuckY = true
        }
        jumpDyBefore = null
      }

      if (Math.abs(dx) <= APPLE_ARRIVE_DX && Math.abs(dy) <= APPLE_ARRIVE_DY) {
        // 到点：按坐姿反推的位置钉住苹果，同时开始坐下
        const facingRight = loco?.currentFacing === 'right'
        window.api.applePin({
          cx:
            window.screenX +
            (facingRight ? APPLE_PIN_CX_RIGHT : APPLE_PIN_CX_LEFT) * scaleRef.current,
          bottom: window.screenY + APPLE_PIN_BOTTOM_Y * scaleRef.current
        })
        appleFadeSent = false
        fsm.send({ t: 'APPLE_ARRIVED' })
        return
      }

      // 先横后竖：水平没对齐就发起一段行走
      if (Math.abs(dx) > APPLE_ARRIVE_DX) {
        seekWalk = true
        pendingWalk = dx > 0 ? 'right' : 'left'
        fsm.send({ t: 'WALK_START', returnTo: 'AppleSeek' })
        void spriteSource.load('walk_turn')
        void spriteSource.load('walk_stop')
        return
      }

      // 竖直方向已判定走不通，原地等超时放弃
      if (seekStuckY) return

      // 按剩余距离均摊到每一跳，避免贴脸还整段跳 60 DIP
      const up = dy < 0
      const base = (up ? JUMP_STEP_UP : JUMP_STEP_DOWN) * scaleRef.current
      const stepDip = Math.max(1, Math.min(Math.abs(dy) / 3, base))
      jumpDyBefore = dy
      fsm.send({ t: 'JUMP_START', dir: up ? 'up' : 'down', stepDip, returnTo: 'AppleSeek' })
    }

    void player.play(STATE_CLIP[fsm.current])

    // ---- 片段切换交叉淡化 ----
    const FADE_MS = 160
    const fadeCanvas = document.createElement('canvas')
    const fadeCtx = fadeCanvas.getContext('2d')
    let fadeActive = false
    let fadeStart = 0
    let drawnClipId: string | null = null

    // ---- 命中掩码上报 ----
    // 先把整张舞台缩到 64×64 再读像素，避免每 120ms 回读整幅 RGBA
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = MASK_RES
    maskCanvas.height = MASK_RES
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })

    let lastMaskAt = 0
    const reportMask = (now: number): void => {
      if (!maskCtx || now - lastMaskAt < MASK_INTERVAL_MS) return
      lastMaskAt = now

      maskCtx.clearRect(0, 0, MASK_RES, MASK_RES)
      maskCtx.drawImage(canvas, 0, 0, MASK_RES, MASK_RES)
      const data = maskCtx.getImageData(0, 0, MASK_RES, MASK_RES).data
      const cells = new Uint8Array(MASK_RES * MASK_RES)

      let minGx = MASK_RES
      let minGy = MASK_RES
      let maxGx = -1
      let maxGy = -1

      for (let i = 0; i < cells.length; i++) {
        if (data[i * 4 + 3] <= 25) continue
        cells[i] = 1
        const gx = i % MASK_RES
        const gy = (i / MASK_RES) | 0
        if (gx < minGx) minGx = gx
        if (gx > maxGx) maxGx = gx
        if (gy < minGy) minGy = gy
        if (gy > maxGy) maxGy = gy
      }

      if (maxGx < 0) return // 理论上不会发生，防御空帧

      // 包围盒换算回窗口 DIP（画布分辨率是 DIP × devicePixelRatio）
      const dprNow = dprRef.current || 1
      const x = Math.floor((minGx * canvas.width) / MASK_RES / dprNow)
      const y = Math.floor((minGy * canvas.height) / MASK_RES / dprNow)
      const right = Math.ceil(((maxGx + 1) * canvas.width) / MASK_RES / dprNow)
      const bottom = Math.ceil(((maxGy + 1) * canvas.height) / MASK_RES / dprNow)

      window.api.reportMask({
        res: MASK_RES,
        cells,
        bbox: { x, y, w: right - x, h: bottom - y }
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
        // 行走四段、看屏幕两段、跳跃三段都是同一套连续动作，段间不做淡化；
        // 只有进出这些连续片段（待机→起步、跳完→待机）才需要淡化遮住姿势差
        const isChainClip = (id: string | null): boolean =>
          id !== null &&
          (id.startsWith('walk_') || id.startsWith('point_') || id.startsWith('jump_'))
        const seamless = isChainClip(drawnClipId) && isChainClip(clipId)
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
        // drop_land 首帧真正开始绘制，才通知主进程开始悬停与下落，避免窗口位移跑在动画前面
        if (clipId === 'drop_land') window.api.dropStart()
        if (clipId === 'walk_loop') walkCycleSeen = 0
        if (clipId === 'jump_loop') {
          jumpCycleSeen = 0
          jumpLoopCount = 0
        }
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

      // jump_loop 循环播放：每跨过一圈决定继续串联还是落地
      if (fsm.current === 'JumpLoop' && player.clipId === 'jump_loop') {
        const duration = player.durationMs
        if (duration > 0) {
          const cycle = Math.floor(player.elapsedMs / duration)
          if (cycle > jumpCycleSeen) {
            jumpCycleSeen = cycle
            onJumpCycleEnd()
          }
        }
      }

      // 找苹果：逐帧规划下一步走 / 跳 / 到点坐下
      seekTick()

      // 拎起/落地期间按窗口横向运动更新摆动角，其他状态保持竖直
      const held =
        fsm.current === 'Grabbed' || fsm.current === 'Dragging' || fsm.current === 'Dropped'
      if (held) sway.update(now, dt, window.screenX)
      else if (swayHeld) sway.begin(now)
      swayHeld = held

      const s = scaleRef.current
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      // 素材按 300×300 设计；画布分辨率是 DIP × devicePixelRatio，
      // 因此变换要再乘 DPR，缩放与 DPI 都不会让画面被系统二次放大
      const k = s * dprRef.current
      ctx.setTransform(k, 0, 0, k, 0, 0)
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
          // 帧按当前缩放解码，尺寸可能小于 300×300，绘制时统一还原到 300 坐标系
          const src = frame as ImageBitmap
          const fsY = src.height / CANVAS_SIZE.height
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
            ctx.drawImage(frame, 0, 0, CANVAS_SIZE.width, CANVAS_SIZE.height)
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
              ctx.drawImage(
                frame,
                0,
                y * fsY,
                src.width,
                h * fsY,
                off,
                y,
                CANVAS_SIZE.width,
                h
              )
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

      // 番茄钟期间：写作业循环，每 4~6 轮插一次打瞌睡；
      // 非专注时段：超过 5 分钟没有用户操作就入睡，自主动作只在播完后延迟入睡。
      const idleMs = now - lastInputAt
      if (pomodoroRunning.current) {
        if (fsm.current === 'Idle') {
          fsm.send({ t: 'POMO_START' })
        } else if (fsm.current === 'Homework' && now > dozeAt) {
          fsm.send({ t: 'DOZE' })
        }
      } else if (!focusModeRef.current) {
        if (fsm.current === 'SitIdle' && now - stateEnteredAt > SIT_GIVEUP_MS) {
          // 等了 60 秒没等到苹果，生气撒泼
          fsm.send({ t: 'SIT_TIMEOUT' })
        } else if (idleMs > SLEEP_AFTER_MS) {
          fsm.send({ t: 'SLEEP' })
        } else if (fsm.current === 'Idle' && now - stateEnteredAt > IDLE_DWELL_MS) {
          fsm.send(rollIdleExtra(now) ?? { t: 'IDLE_TIMEOUT' })
        }
      }

      // 连续睡满 5 分钟自动起床；同时重置静置计时，避免刚起床又立刻入睡
      if (
        (fsm.current === 'Sleepy' || fsm.current === 'Sleeping') &&
        now - sleepAt >= SLEEP_WAKE_MS
      ) {
        lastInputAt = now
        fsm.send({ t: 'WAKE' })
      }

      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // ---- 主进程输入事件 ----
    const offInput = window.api.onPetInput((e) => {
      lastInputAt = performance.now()
      // 拖拽优先级最高：立刻中断行走并停止窗口位移
      if (e.t === 'DRAG_START') {
        // 找苹果途中被拎起：本轮直接中断，苹果收起
        if (appleRoundActive) abortSeek()
        loco?.abort()
        window.api.cancelJump()
        // 拎起后主进程会用 200ms 把光标对齐到后颈，这段缓动会伪造横向速度，先忽略
        sway.begin(performance.now(), 220)
      }
      // 待机时点一下：先掷特殊行为（指屏幕 15% / 坐姿 15%），没抽中再掷日常池（含整轮跳跃）
      if (e.t === 'CLICK' && !focusModeRef.current && fsm.current === 'Idle') {
        const extra = rollIdleExtra(performance.now())
        if (extra) {
          fsm.send(extra)
          return
        }
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
        // 番茄钟优先：找苹果立刻中断、收起苹果，马上进作业
        if (appleRoundActive) abortSeek()
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
      setShowState(s.showState)
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

    // ---- 托盘行走 / 跳跃指令 ----
    const offLoco = window.api.onLocomotion((cmd) => {
      // 托盘指令算一次用户操作，重置睡觉计时
      lastInputAt = performance.now()
      if (cmd === 'stop') {
        loco?.halt()
        return
      }
      if (cmd === 'jump-up' || cmd === 'jump-down') {
        requestJump(cmd === 'jump-up' ? 'up' : 'down')
        return
      }
      requestWalk(cmd === 'walk-left' ? 'left' : 'right')
    })

    // ---- 找苹果 ----
    const offAppleSummon = window.api.onAppleSummon(() => {
      lastInputAt = performance.now()
      appleRoundActive = true
      applePosReady = false
      seekWalk = false
      seekStuckY = false
      jumpDyBefore = null
      appleFadeSent = false
      fsm.send({ t: 'APPLE_SUMMON' })
      // 当前状态不接受召唤（作业、拎起、跳跃中）：直接收起苹果，别让它悬着
      if (fsm.current !== 'AppleSeek') {
        appleRoundActive = false
        window.api.appleEnd()
        return
      }
      // 到点要连续播坐姿与吃苹果，提前解码
      void spriteSource.load('sit_enter')
      void spriteSource.load('sit_eat_happy')
    })

    const offApplePos = window.api.onApplePos((p) => {
      if (!appleRoundActive) return
      applePos = p
      applePosReady = true
    })

    const offAppleExpired = window.api.onAppleExpired(() => {
      // 主进程已经收起苹果，这里把状态机拉回待机
      abortSeek()
    })

    const offScale = window.api.onScale((s) => {
      scaleRef.current = s
      spriteSource.setRenderScale(s * dprRef.current)
      // 按新尺寸重新解码当前片段；旧尺寸的缓存仍能正常绘制，会在 LRU 里自然换掉
      if (player.clipId) void player.play(player.clipId)
      // 缩放会解除常驻，等缩放手势停下再按新尺寸预热拖拽片段
      warmDragClips(SCALE_REWARM_DELAY_MS)
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
      offDisplayChanged()
      window.removeEventListener('resize', syncDpr)
      offLoco()
      offAppleSummon()
      offApplePos()
      offAppleExpired()
      loco?.dispose()
      if (warmTimer) clearTimeout(warmTimer)
      window.api.cancelJump()
      cancelAnimationFrame(raf)
      spriteSource.dispose()
    }
  }, [])

  return (
    <div className="stage">
      <canvas
        ref={canvasRef}
        width={Math.round(CANVAS_SIZE.width * scale * dpr)}
        height={Math.round(CANVAS_SIZE.height * scale * dpr)}
        className="stage-canvas"
      />
      {showState && (
        <div className="stage-debug">{focusMode ? `Focus · ${state}` : state}</div>
      )}
      {remainMs > 0 && <div className="stage-timer">{formatRemain(remainMs)}</div>}
      {keyLabel && (
        <div key={keyLabel.seq} className="stage-key">
          {keyLabel.label}
        </div>
      )}
    </div>
  )
}
