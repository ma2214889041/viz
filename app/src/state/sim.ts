import { create } from "zustand";
import type { TermId } from "../math/terms";

/**
 * 公式 ↔ 图表 ↔ 3D 的共享参数总线。
 *
 * 关键点：高亮态放在这里，而不是各组件自己维护。
 * 于是「鼠标划过公式里的 f」和「鼠标划过速度分布图」触发的是同一个状态，
 * 两边一起亮 —— 读者才会把符号和几何绑成一个东西。
 */
export interface SimState {
  running: boolean;
  n: number;
  speed0: number;
  /** 粒子半径 —— 直接决定碰撞率，也就决定了弛豫要花多久。
   *  做成可调是有意的：这一章要讲的正是「时间之箭的快慢由碰撞频率定」。 */
  radius: number;
  /** 每帧推进的物理时间。粒子观感和 H 的下落速度是同一个旋钮——
   *  它们由碰撞率耦合，没法各调各的，所以干脆交给读者。 */
  dt: number;
  seed: number;
  /** 当前被聚焦的语义项，null 表示无 */
  focus: TermId | null;
  /** 实时读数，由渲染循环回写 */
  readout: { t: number; H: number; Heq: number; energy: number };

  setRunning: (v: boolean) => void;
  setFocus: (v: TermId | null) => void;
  setN: (v: number) => void;
  setSpeed0: (v: number) => void;
  setRadius: (v: number) => void;
  setDt: (v: number) => void;
  reseed: () => void;
  setReadout: (v: SimState["readout"]) => void;
}

export const useSim = create<SimState>((set) => ({
  running: true,
  // 稀疏一点：堆积率 ~0.045。稠密气体 60 步就弛豫完了，
  // 在 60fps 下不到半秒，整个 H 下落过程读者根本来不及看。
  n: 380,
  speed0: 1,
  radius: 2.2,
  // dt=0.12 → 弛豫(t≈35)约 4.9 秒，看得清 H 的下落全过程。
  // dt=0.4 只要 1.5 秒，一晃就过去了。
  dt: 0.12,
  seed: 20260807,
  focus: null,
  readout: { t: 0, H: 0, Heq: 0, energy: 0 },

  setRunning: (running) => set({ running }),
  setFocus: (focus) => set({ focus }),
  setN: (n) => set({ n }),
  setSpeed0: (speed0) => set({ speed0 }),
  setRadius: (radius) => set({ radius }),
  setDt: (dt) => set({ dt }),
  reseed: () => set((s) => ({ seed: (s.seed * 1664525 + 1013904223) >>> 0 })),
  setReadout: (readout) => set({ readout }),
}));
