/**
 * 二维硬盘气体 + H 泛函的数值验证。
 * 页面上跑的和这里算的是同一份 src/models/gas.ts —— 不允许演示用假数据。
 *
 *   node --experimental-strip-types tests/gas-model.mjs
 */
import {
  createGas,
  step,
  kineticEnergy,
  velocityHistogram,
  hFromSpeed,
  hEquilibrium,
  speedHistogram,
  maxwellSpeed,
  reverse,
} from "../src/models/gas.ts";

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${detail ? `  —  ${detail}` : ""}`);
  if (!ok) failures++;
};

const OPT = { n: 600, radius: 3.2, box: 320, speed0: 1, seed: 20260807 };
const relax = (g, k) => { for (let i = 0; i < k; i++) step(g, 0.55); };

// ---------- 1. 能量守恒 ----------
{
  const g = createGas(OPT);
  const e0 = kineticEnergy(g);
  relax(g, 4000);
  const rel = Math.abs(kineticEnergy(g) - e0) / e0;
  check("弹性碰撞能量守恒", rel < 1e-12, `相对误差 ${rel.toExponential(2)}`);
}

// ---------- 2. H 单调不增（H 定理） ----------
{
  const g = createGas(OPT);
  const series = [];
  for (let k = 0; k < 60; k++) { relax(g, 40); series.push(hFromSpeed(g)); }
  const H0 = series[0];
  const Hend = series.at(-1);
  check("H 从初态显著下降", Hend < H0 - 0.05, `H: ${H0.toFixed(4)} → ${Hend.toFixed(4)}`);
  const half = series.length >> 1;
  const avg = (a) => a.reduce((x, y) => x + y) / a.length;
  check("H 后半段均值低于前半段", avg(series.slice(half)) < avg(series.slice(0, half)),
    `${avg(series.slice(0, half)).toFixed(4)} → ${avg(series.slice(half)).toFixed(4)}`);
}

// ---------- 3. 收敛到麦克斯韦平衡的解析 H 值 ----------
{
  const g = createGas(OPT);
  relax(g, 12000);
  const H = hFromSpeed(g);
  const Heq = hEquilibrium(g);
  check("弛豫后 H 接近解析平衡值", Math.abs(H - Heq) < 0.05,
    `H=${H.toFixed(4)}  H_eq=${Heq.toFixed(4)}  差 ${(H - Heq).toFixed(4)}`);
}

// ---------- 4. 速率分布收敛到麦克斯韦曲线 ----------
{
  const g = createGas(OPT);
  relax(g, 12000);
  const sh = speedHistogram(g, 36);
  const sigma2 = kineticEnergy(g) / g.n;

  let l1 = 0;
  for (let k = 0; k < sh.bins; k++) {
    l1 += Math.abs(sh.p[k] - maxwellSpeed((k + 0.5) * sh.width, sigma2)) * sh.width;
  }
  // 阈值不用魔数：泊松散粒噪声下每箱 E|ΔP| = √(2/π)·√(P/(N·Δs))，
  // 累加得 L1 的期望量级。允许 1.8 倍余量（分箱离散化 + 有限时间残余）。
  let expected = 0;
  for (let k = 0; k < sh.bins; k++) {
    const P = maxwellSpeed((k + 0.5) * sh.width, sigma2);
    expected += Math.sqrt((2 / Math.PI) * (P / (OPT.n * sh.width))) * sh.width;
  }
  check("速率分布与麦克斯韦的 L1 偏差在散粒噪声量级", l1 < expected * 1.8,
    `L1=${l1.toFixed(4)}  散粒期望=${expected.toFixed(4)}  比值=${(l1 / expected).toFixed(2)}`);
}

// ---------- 5. 时间反演：微观可逆（洛施密特） ----------
{
  // 必须在「还在弛豫的途中」反演。已经躺到平衡上再反演，H 本来就没地方可回。
  const g = createGas(OPT);
  relax(g, 200);
  const Hmid = hFromSpeed(g);
  reverse(g);
  relax(g, 160);
  const Hback = hFromSpeed(g);
  check("弛豫途中反演后 H 回升", Hback > Hmid,
    `H: ${Hmid.toFixed(4)} → ${Hback.toFixed(4)}  回升 ${(Hback - Hmid).toFixed(4)}`);
}

// ---------- 6. 同种子可复现 ----------
{
  const a = createGas(OPT);
  const b = createGas(OPT);
  for (let i = 0; i < 500; i++) { step(a, 0.55); step(b, 0.55); }
  let maxd = 0;
  for (let i = 0; i < a.n; i++) maxd = Math.max(maxd, Math.abs(a.x[i] - b.x[i]), Math.abs(a.vx[i] - b.vx[i]));
  check("同种子逐位可复现", maxd === 0, `最大偏差 ${maxd}`);
}

// ---------- 7. 归一化 ----------
{
  const g = createGas(OPT);
  relax(g, 2000);
  const vh = velocityHistogram(g, 44);
  let mass = 0;
  for (const v of vh.f) mass += v * vh.cell * vh.cell;
  check("速度分布归一 ∫f d²v = 1", Math.abs(mass - 1) < 1e-9, `∫f = ${mass.toFixed(12)}`);

  const sh = speedHistogram(g, 36);
  let m2 = 0;
  for (const p of sh.p) m2 += p * sh.width;
  check("速率分布归一 ∫P ds = 1", Math.abs(m2 - 1) < 1e-9, `∫P = ${m2.toFixed(12)}`);
}

// ---------- 8. 节奏：弛豫必须看得清 ----------
{
  // 这一条守的是「效果」而不是「正确性」，但它同样会坏：
  // 早先默认参数（稠密 + dt=0.55×4步/帧）下整个 H 下落只要 0.27 秒，
  // 读者根本看不到这篇文章最核心的那个动作。
  const DEMO = { n: 380, radius: 2.2, box: 360, speed0: 1, seed: 20260807 };
  const DT = 0.12; // 与 src/state/sim.ts 的默认值保持一致
  const g = createGas(DEMO);
  const H0 = hFromSpeed(g);
  const Heq = hEquilibrium(g);
  // 走完 90% 的下落所需帧数
  const target = H0 - 0.9 * (H0 - Heq);
  let frames = 0;
  while (hFromSpeed(g) > target && frames < 20000) { step(g, DT); frames++; }
  const seconds = frames / 60;
  check("默认参数下弛豫过程有 2–20 秒可看", seconds >= 2 && seconds <= 20,
    `${frames} 帧 ≈ ${seconds.toFixed(1)} 秒 @60fps（H: ${H0.toFixed(3)} → ${target.toFixed(3)}）`);
}

console.log(failures === 0 ? "\n全部通过\n" : `\n${failures} 项失败\n`);
process.exit(failures === 0 ? 0 : 1);
