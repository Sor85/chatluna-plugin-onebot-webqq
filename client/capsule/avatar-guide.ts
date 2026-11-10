import { animate, utils, type JSAnimation } from 'animejs'

// 波纹节点数，模板按这个数量渲染占位节点。
export const AVATAR_GUIDE_PULSE_COUNT = 3

// 单圈波纹从贴合常驻圈扩散到 1.45 倍的时长。
// 透明度走 out(2)，波纹在 t≈0.6 处就淡到看不见，所以可见时长 ≈ PULSE_DURATION × 0.6 ≈ 624ms。
// 这个值要守住的底线不是「屏幕上一直有波纹」，而是「不能出现看得见却几乎不动的东西」——
// 后者才是旧实现被看成掉帧的形态。out(3) 位移配 out(2) 透明度保证了这一点：位移掉到 9px/s 时
// 透明度已经在 0.08 以下。所以间隔大于可见时长、两圈之间只剩常驻圈是可以接受的节奏，
// 但不要为了拉长间隔去加大这个时长——那会把波纹本身拖慢到看不出在动。
const PULSE_DURATION = 1040
// 相邻两圈波纹的出发间隔；节点数 × 这个间隔就是单个节点的循环周期。
// 引导整体活 3600ms（Capsule.vue 的计时器），920ms 一圈对应一次触发出 4 圈波纹
// （0 / 920 / 1840 / 2760，下一圈 3680 已经越过卸载点）。
// 别用 900：第 5 圈正好落在 3600 的卸载边界上，会随抖动时多时少。
const PULSE_INTERVAL = 920
// loopDelay 用「循环周期 − 扩散时长」反推，保证无论节点数怎么调，
// 屏幕上始终是每 PULSE_INTERVAL 毫秒冒出一圈新波纹，不会撞车。
const PULSE_LOOP_DELAY = AVATAR_GUIDE_PULSE_COUNT * PULSE_INTERVAL - PULSE_DURATION
const PULSE_SCALE_TO = 1.45
const PULSE_OPACITY_FROM = 0.5

const ENTER_DURATION = 200
const LEAVE_DURATION = 160

const PULSE_SELECTOR = '.onebot-webqq__avatar-guide-pulse'

export interface AvatarGuideMotion {
  enter(root: HTMLElement, done: () => void): void
  leave(root: HTMLElement, done: () => void): void
  restart(): void
  destroy(): void
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// 头像强调动效：常驻圈几何全程静止，所有运动都交给往外扩散的波纹。
//
// 旧实现是让 44px 的常驻圈自己在 0.98~1.05 之间来回缩放（2.4s 一个周期）。那是 3px 的行程摊到
// 1.2s 上，约 4px/s，每帧只走 0.07px——落在「看不出在动」的区间里，眼睛读到的是光栅化与计时噪声
// 而不是运动。所以它在 Chromium、Firefox 153、Zen(Gecko 154) 三处都是满 60fps、零丢帧，却依然
// 像在卡。换缓动只是把噪声挪个位置，治不了根。
//
// 这里改成「声呐」式：常驻圈不动，波纹每 380ms 出一圈，760ms 内扩散 20px（约 26px/s，是旧实现的
// 七倍上下），运动幅度和速度都远高于可辨阈值，噪声不再是画面里最显眼的信号。
export function createAvatarGuideMotion(): AvatarGuideMotion {
  let container: HTMLElement | undefined
  let fade: JSAnimation | undefined
  let pulses: JSAnimation[] = []
  let pulseTimers: ReturnType<typeof setTimeout>[] = []

  function stopFade() {
    fade?.pause()
    fade = undefined
  }

  // revert() 会抹掉 Anime.js 写在节点上的内联样式，波纹回到样式表里声明的 opacity: 0，
  // 不会在下一次进场前留下半透明残影。还没轮到出场的节点只有待命定时器，一并清掉。
  function stopPulse() {
    for (const timer of pulseTimers) clearTimeout(timer)
    pulseTimers = []
    for (const pulse of pulses) pulse.revert()
    pulses = []
  }

  // 一个节点一条动画，不带 delay：错拍靠「延后创建」实现，见 startPulse 的注释。
  //
  // 波纹用 left/top 定位、不带 CSS transform，所以这里写 scale 是安全的。
  // 容器那边相反：它靠 transform: translate(-50%, -50%) 居中，一旦让 Anime.js 动它的 scale，
  // 合成出来的 transform 会把居中的 translate 顶掉，因此容器只动 opacity。
  function spawnPulse(target: HTMLElement) {
    pulses.push(animate(target, {
      scale: [1, PULSE_SCALE_TO],
      // 透明度用比位移更慢收敛的曲线（out(2) 对 out(3)），让波纹「慢下来的那一段正好也是看不见的那一段」。
      // 位移速率是 57·(1−t)²px/s，透明度是 0.5·(1−t)²；opacity 掉到 0.08 以下时位移仍有 9px/s，
      // 全程不会出现「还看得见但几乎不动」的画面——那正是旧实现被看成掉帧的形态。
      opacity: { from: PULSE_OPACITY_FROM, to: 0, ease: 'out(2)' },
      duration: PULSE_DURATION,
      loopDelay: PULSE_LOOP_DELAY,
      loop: true,
      ease: 'out(3)',
    }))
  }

  function startPulse(root: HTMLElement) {
    stopPulse()
    if (prefersReducedMotion()) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>(PULSE_SELECTOR))
    if (!targets.length) return
    // 错拍必须靠延后创建，Anime.js 的 delay 这里两条路都走不通，两条都是实测踩出来的：
    // 1. 把三个节点塞进同一次 animate() 用 delay 错开：delay 只在单轮内生效，循环边界上三个节点
    //    会同时重置，节奏退化成「爆一组三连、然后空掉将近一拍」。
    // 2. 每个节点一条动画、各带自己的 delay：Anime.js 在创建时就把 from 值写进节点，于是还没轮到
    //    的节点会以 scale 1 / opacity 0.5 静静停在常驻圈上（实测节点 1 停 560ms、节点 2 停 1120ms）——
    //    进场头一秒变成「几个不动的同心圈叠在一起」，正是要消掉的静止几何。
    // 延后创建则在轮到之前完全不碰节点，它保持样式表里的 opacity: 0。
    targets.forEach((target, index) => {
      if (!index) {
        spawnPulse(target)
        return
      }
      pulseTimers.push(setTimeout(() => spawnPulse(target), index * PULSE_INTERVAL))
    })
  }

  return {
    enter(root, done) {
      container = root
      stopFade()
      startPulse(root)
      if (prefersReducedMotion()) {
        utils.set(root, { opacity: 1 })
        done()
        return
      }
      fade = animate(root, {
        opacity: [0, 1],
        duration: ENTER_DURATION,
        ease: 'out(3)',
        onComplete: () => done(),
      })
    },

    leave(root, done) {
      stopPulse()
      stopFade()
      if (prefersReducedMotion()) {
        container = undefined
        done()
        return
      }
      // 只给终值，让 Anime.js 从当前 opacity 起算：进场淡入没跑完就被打断时不会先跳回 1。
      fade = animate(root, {
        opacity: 0,
        duration: LEAVE_DURATION,
        ease: 'out(2)',
        onComplete: () => {
          container = undefined
          done()
        },
      })
    },

    restart() {
      if (container) startPulse(container)
    },

    destroy() {
      stopPulse()
      stopFade()
      container = undefined
    },
  }
}
