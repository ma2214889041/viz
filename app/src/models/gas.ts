/**
 * 二维硬盘气体 —— H 定理的可操纵模型。
 *
 * 刻意保持成纯函数模块（不碰 DOM、不碰 React），这样 Node 侧的
 * tests/*.mjs 能直接 import 同一份代码做数值交叉验证：
 * 页面上看到的数字和测试里算的必须是同一套，不允许出现「演示用假动画」。
 *
 * 物理约定：所有粒子等质量 m=1，弹性碰撞，刚性壁。
 */

export interface GasOptions {
  n: number;
  radius: number;
  box: number; // 正方形边长
  speed0: number; // 初始速率
  seed: number;
}

export interface GasState {
  n: number;
  radius: number;
  box: number;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  t: number;
}

/** 可复现随机数（mulberry32）—— 双轨实验要能从同一种子重建初态 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 初态：所有粒子速率相同、方向随机。
 * 这在速度空间里是一个「圆环」——离麦克斯韦分布极远，H 很高。
 */
export function createGas(o: GasOptions): GasState {
  const rand = rng(o.seed);
  const { n, radius, box, speed0 } = o;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);

  // 无重叠撒点：网格抖动，保证初始不穿模
  const cols = Math.ceil(Math.sqrt(n));
  const cell = (box - 2 * radius) / cols;
  for (let i = 0; i < n; i++) {
    const cx = i % cols;
    const cy = Math.floor(i / cols);
    const jitter = Math.max(0, cell - 2 * radius);
    x[i] = radius + cx * cell + radius + (rand() - 0.5) * jitter;
    y[i] = radius + cy * cell + radius + (rand() - 0.5) * jitter;
    const th = rand() * Math.PI * 2;
    vx[i] = speed0 * Math.cos(th);
    vy[i] = speed0 * Math.sin(th);
  }
  return { n, radius, box, x, y, vx, vy, t: 0 };
}

/** 均匀网格加速的碰撞检测；步进后 g.t += dt */
export function step(g: GasState, dt: number): void {
  const { n, radius, box, x, y, vx, vy } = g;

  for (let i = 0; i < n; i++) {
    x[i] += vx[i] * dt;
    y[i] += vy[i] * dt;
    // 刚性壁：位置夹回箱内并反射法向分量
    if (x[i] < radius) { x[i] = radius + (radius - x[i]); vx[i] = -vx[i]; }
    else if (x[i] > box - radius) { x[i] = (box - radius) - (x[i] - (box - radius)); vx[i] = -vx[i]; }
    if (y[i] < radius) { y[i] = radius + (radius - y[i]); vy[i] = -vy[i]; }
    else if (y[i] > box - radius) { y[i] = (box - radius) - (y[i] - (box - radius)); vy[i] = -vy[i]; }
  }

  // 均匀网格分桶
  const d = 2 * radius;
  const nc = Math.max(1, Math.floor(box / d));
  const cs = box / nc;
  const heads = new Int32Array(nc * nc).fill(-1);
  const next = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(nc - 1, Math.max(0, Math.floor(x[i] / cs)));
    const cy = Math.min(nc - 1, Math.max(0, Math.floor(y[i] / cs)));
    const c = cy * nc + cx;
    next[i] = heads[c];
    heads[c] = i;
  }

  const d2 = d * d;
  for (let cy = 0; cy < nc; cy++) {
    for (let cx = 0; cx < nc; cx++) {
      for (let i = heads[cy * nc + cx]; i !== -1; i = next[i]) {
        // 只看右/下半邻域，避免同一对检查两次
        for (let oy = 0; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (oy === 0 && ox < 0) continue;
            const gx = cx + ox;
            const gy = cy + oy;
            if (gx < 0 || gy < 0 || gx >= nc || gy >= nc) continue;
            let j = heads[gy * nc + gx];
            for (; j !== -1; j = next[j]) {
              if (oy === 0 && ox === 0 && j <= i) continue;
              const dx = x[j] - x[i];
              const dy = y[j] - y[i];
              const r2 = dx * dx + dy * dy;
              if (r2 >= d2 || r2 === 0) continue;
              const r = Math.sqrt(r2);
              const nx = dx / r;
              const ny = dy / r;
              // 接近速度沿法向的分量
              const vn = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
              if (vn <= 0) continue; // 正在分离，别重复处理
              // 等质量弹性碰撞：交换法向分量
              vx[i] -= vn * nx; vy[i] -= vn * ny;
              vx[j] += vn * nx; vy[j] += vn * ny;
              // 位置修正，推开到刚好相切，避免粘连
              const overlap = (d - r) / 2;
              x[i] -= overlap * nx; y[i] -= overlap * ny;
              x[j] += overlap * nx; y[j] += overlap * ny;
            }
          }
        }
      }
    }
  }
  g.t += dt;
}

export function kineticEnergy(g: GasState): number {
  let e = 0;
  for (let i = 0; i < g.n; i++) e += g.vx[i] * g.vx[i] + g.vy[i] * g.vy[i];
  return 0.5 * e;
}

/** 速度空间二维直方图。返回归一化的 f，满足 ∑ f·Δ² = 1 */
export interface VelocityHistogram {
  bins: number;
  vmax: number;
  cell: number;
  f: Float64Array; // bins × bins
}

export function velocityHistogram(g: GasState, bins = 40, vmax?: number): VelocityHistogram {
  let vm = vmax ?? 0;
  if (!vmax) {
    for (let i = 0; i < g.n; i++) {
      const s = Math.hypot(g.vx[i], g.vy[i]);
      if (s > vm) vm = s;
    }
    vm *= 1.05;
  }
  const cell = (2 * vm) / bins;
  const f = new Float64Array(bins * bins);
  for (let i = 0; i < g.n; i++) {
    const bx = Math.floor((g.vx[i] + vm) / cell);
    const by = Math.floor((g.vy[i] + vm) / cell);
    if (bx < 0 || by < 0 || bx >= bins || by >= bins) continue;
    f[by * bins + bx] += 1;
  }
  // 归一化成概率密度：∑ f·Δ² = 1
  const norm = g.n * cell * cell;
  for (let k = 0; k < f.length; k++) f[k] /= norm;
  return { bins, vmax: vm, cell, f };
}

/**
 * H = ∫ f log f d²v  —— 直接在速度空间二维网格上求和。
 * 空格子按 f log f → 0 处理（lim_{f→0} f log f = 0）。
 */
export function hFunctional(h: VelocityHistogram): number {
  let s = 0;
  const a = h.cell * h.cell;
  for (let k = 0; k < h.f.length; k++) {
    const v = h.f[k];
    if (v > 0) s += v * Math.log(v) * a;
  }
  return s;
}

/**
 * 由一维速率分布算 H —— 这是页面和测试都该用的那个估计量。
 *
 * 为什么不用二维直方图：N=600 撒进 44×44=1936 个格子，绝大多数格子空着或只有 1 个粒子，
 * 经验分布退化成一堆尖峰，H 被系统性高估（实测偏差 +0.70，比整个下降幅度还大）。
 * 二维图好看，但不能拿来出数。
 *
 * 各向同性是这里能用一维的依据：初态是「等速率 + 随机方向」，本身各向同性；
 * 弹性碰撞和刚性壁都不引入择优方向，所以 f 全程只依赖速率 s=|v|。
 * 于是 f(s) = P(s)/(2πs)，而
 *   H = ∫ f log f d²v = ∫ P(s)·log( P(s)/(2πs) ) ds
 * 一维分箱下每箱有几十个粒子，估计量才站得住。
 */
export function hFromSpeed(g: GasState, bins = 30): number {
  const sh = speedHistogram(g, bins);
  let s = 0;
  for (let k = 0; k < sh.bins; k++) {
    const p = sh.p[k];
    if (p <= 0) continue;
    const sc = (k + 0.5) * sh.width; // 箱心速率
    const f = p / (2 * Math.PI * sc); // 由各向同性还原 f(s)
    s += p * Math.log(f) * sh.width;
  }
  return s;
}

/**
 * 二维麦克斯韦分布的 H 解析值（同样归一到 ∫f d²v = 1）：
 *   f(v) = 1/(2πσ²) · exp(−v²/2σ²)，  H = −log(2πσ²) − 1
 * 用来判断「已经弛豫到平衡了没有」。
 */
export function hEquilibrium(g: GasState): number {
  const e = kineticEnergy(g); // = ½∑v²
  const sigma2 = e / g.n; // 二维：⟨v²⟩ = 2σ²，而 e/n = ½⟨v²⟩ = σ²
  return -Math.log(2 * Math.PI * sigma2) - 1;
}

/** 速率分布（一维），用于和麦克斯韦曲线对照 */
export function speedHistogram(g: GasState, bins = 48, smax?: number) {
  let sm = smax ?? 0;
  if (!smax) {
    for (let i = 0; i < g.n; i++) sm = Math.max(sm, Math.hypot(g.vx[i], g.vy[i]));
    sm *= 1.1;
  }
  const w = sm / bins;
  const p = new Float64Array(bins);
  for (let i = 0; i < g.n; i++) {
    const b = Math.floor(Math.hypot(g.vx[i], g.vy[i]) / w);
    if (b >= 0 && b < bins) p[b] += 1;
  }
  for (let k = 0; k < bins; k++) p[k] /= g.n * w; // ∑p·w = 1
  return { bins, smax: sm, width: w, p };
}

/** 二维麦克斯韦速率分布 P(s) = (s/σ²)·exp(−s²/2σ²) */
export function maxwellSpeed(s: number, sigma2: number): number {
  return (s / sigma2) * Math.exp(-(s * s) / (2 * sigma2));
}

/** 时间反演：所有速度取反。微观可逆的直接体现。 */
export function reverse(g: GasState): void {
  for (let i = 0; i < g.n; i++) {
    g.vx[i] = -g.vx[i];
    g.vy[i] = -g.vy[i];
  }
}
