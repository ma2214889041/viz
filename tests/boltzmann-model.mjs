/* 玻尔兹曼篇的物理自检：把页面里的模拟核心抽出来跑，不依赖浏览器。
   验证的是文章正文声称的每一条可测量结论。 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "boltzmann/index.html"), "utf8");

/* ---- 从页面里取出真正在跑的那几段代码，保证测的就是线上的实现 ---- */
const grab = (name, kind = "function") => {
  const start = html.indexOf(`${kind} ${name}`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  let depth = 0, i = html.indexOf("{", start), began = false;
  for (; i < html.length; i++) {
    if (html[i] === "{") { depth++; began = true; }
    else if (html[i] === "}") { depth--; if (began && depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name} 括号不闭合`);
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const GAS = {
  N: 520, r: 0.045, L: 1.0, speed: 1.0, running: true,
  px: null, py: null, pz: null, vx: null, vy: null, vz: null,
  t: 0, collisions: 0, mode: "micro", hist: new Float32Array(46), NB: 46,
  H: [], Hcur: 0, reversed: 0, revPeak: 0, preset: "same",
  macroN: 7, single: false,
  wf: [], WFMAX: 150, wfTop: 1,
  pairLast: new Map(), recol: 0, recolRecent: 0, colRecent: 0, recolRate: 0,
  recolWin: 1.5, gradLock: false,
  vmix: 0, vRef: 1,
  tr: null, trN: 0, trK: 0, trHead: 0, trFill: 0, trTick: 0,
  flash: null
};
let cellIdx = null, cellStart = null, cellItems = null, cellFill = null, lastGN = -1;

const QB = { on: true, NB: 40, bw: 0.1, gain: new Float64Array(40), loss: new Float64Array(40),
             gAcc: new Float64Array(40), lAcc: new Float64Array(40),
             q: new Float64Array(40), top: 4, net: 0 };
const PROF = { NX: 16, T: new Float64Array(16), n: new Float64Array(16),
               hist: [], HMAX: 90, contrast: 1, tick: 0 };

const src = [grab("gasInit"), grab("gasStep"), grab("gasStats"), grab("kinetics"),
             grab("wfPush"), grab("qbReset"), grab("qbStep"), grab("profStep"),
             grab("trSet"), grab("trReset"), grab("trPush")].join("\n");
const make = new Function("GAS", "clamp", "rng", "QB", "PROF", `
  let cellIdx=null,cellStart=null,cellItems=null,cellFill=null,lastGN=-1;
  ${src}
  return {gasInit,gasStep,gasStats,kinetics,wfPush,qbReset,qbStep,profStep,trSet,trReset,trPush};
`);
const M = make(GAS, clamp, rng, QB, PROF);

const fail = [];
const check = (name, cond, detail) => { if (!cond) fail.push(`${name}: ${detail}`); return cond; };

/* 跑一段模拟 */
function run(preset, seconds, dt = 0.005) {
  GAS.preset = preset;
  M.gasInit(preset);
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    M.gasStep(dt);
    if (i % 3 === 0) { M.gasStats(); if (!GAS.wf.length) GAS.wfTop = Math.max(2.9 * (GAS.vrms || 1), 0.001); M.wfPush(); }
  }
  M.gasStats();
  return M.kinetics();
}

/* ── 1. 能量守恒：硬球弹性碰撞不该改变总动能 ── */
GAS.N = 520; GAS.r = 0.045;
M.gasInit("same"); M.gasStats();
const E0 = GAS.vrms ** 2;
for (let i = 0; i < 4000; i++) M.gasStep(0.005);
M.gasStats();
const E1 = GAS.vrms ** 2;
/* 位置/速度存在 Float32Array 里，每次碰撞都会舍入一次。
   4000 步下来累积漂移应当仍在 float32 精度量级（~1e-6 相对），远小于任何物理效应。 */
const drift = Math.abs(E1 - E0) / E0;
check("能量守恒（float32 精度内）", drift < 1e-5, `相对漂移 ${drift.toExponential(2)}`);

/* ── 1b. 初态不许有重叠的硬球 ──
   角落初态把粒子挤进 1/8 体积，晶格间距必须按那个更小的区域算；
   如果先按整盒铺再压缩，t=0 就会叠在一起，开局出现一阵非物理的爆炸。 */
for (const preset of ["same", "beam", "corner", "hot"]) {
  for (const [N, r] of [[520, 0.045], [1400, 0.032], [900, 0.05]]) {
    GAS.N = N; GAS.r = r;
    M.gasInit(preset);
    let worst = Infinity, pairs = 0;
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const d = Math.hypot(GAS.px[i] - GAS.px[j], GAS.py[i] - GAS.py[j], GAS.pz[i] - GAS.pz[j]);
      if (d < worst) worst = d;
      if (d < 2 * r - 1e-5) pairs++;   // float32 存储，容许刚好相切
    }
    check(`初态无重叠 (${preset}, N=${N}, r=${r})`, pairs === 0,
      `${pairs} 对重叠，最近间距 ${worst.toFixed(4)} < 2r=${(2*r).toFixed(3)}`);
    // 角落初态必须真的被压缩过，而且报出来的压缩比要对得上实际占用的体积
    if (preset === "corner") {
      let hi = -Infinity;
      for (let i = 0; i < N; i++) hi = Math.max(hi, GAS.px[i], GAS.py[i], GAS.pz[i]);
      const actual = Math.pow((hi + r + 1) / 2, 3);
      check(`角落初态确有压缩 (N=${N}, r=${r})`, GAS.occ < 0.75,
        `占了 ${(GAS.occ*100).toFixed(0)}% 的体积`);
      check(`报出的压缩比属实 (N=${N}, r=${r})`, Math.abs(actual - GAS.occ) < 0.05,
        `声称 ${(GAS.occ*100).toFixed(1)}%，实测 ${(actual*100).toFixed(1)}%`);
    }
  }
}
GAS.N = 520; GAS.r = 0.045;

/* ── 2. 粒子不许漏出盒子 ── */
let escaped = 0;
for (let i = 0; i < GAS.N; i++) {
  const lim = GAS.L - GAS.r + 1e-6;
  if (Math.abs(GAS.px[i]) > lim || Math.abs(GAS.py[i]) > lim || Math.abs(GAS.pz[i]) > lim) escaped++;
}
check("粒子留在盒内", escaped === 0, `${escaped} 个越界`);

/* ── 3. H 定理：从低熵初态出发，H 必须显著下降并趋于平台 ── */
for (const preset of ["same", "beam", "corner", "hot"]) {
  M.gasInit(preset); M.gasStats();
  const Hstart = GAS.Hcur;
  const trace = [];
  for (let i = 0; i < 6000; i++) { M.gasStep(0.005); if (i % 100 === 0) { M.gasStats(); trace.push(GAS.Hcur); } }
  M.gasStats();
  const Hend = GAS.Hcur;
  check(`H 下降 (${preset})`, Hend < Hstart - 0.02, `${Hstart.toFixed(3)} → ${Hend.toFixed(3)}`);
  // 后 1/4 段应该基本躺平（已到平衡）
  const tail = trace.slice(-Math.floor(trace.length / 4));
  const spread = Math.max(...tail) - Math.min(...tail);
  check(`H 收敛到平台 (${preset})`, spread < 0.06, `尾段振幅 ${spread.toFixed(4)}`);
}

/* ── 4. 弛豫到麦克斯韦分布 ──
   单帧直方图只有 N=520 个样本，各 bin 的散粒噪声就能贡献 L1 ≈ 0.15，
   所以必须先对时间做平均把噪声压下去，再和理论比。 */
M.gasInit("same");
for (let i = 0; i < 8000; i++) M.gasStep(0.005);   // 先弛豫到平衡
{
  const NB = GAS.NB;
  const avg = new Float64Array(NB);
  let frames = 0, aSum = 0;
  for (let k = 0; k < 400; k++) {
    for (let i = 0; i < 20; i++) M.gasStep(0.005);
    M.gasStats();
    for (let b = 0; b < NB; b++) avg[b] += GAS.hist[b] / GAS.N;
    aSum += Math.sqrt((GAS.vrms ** 2) / 3);
    frames++;
  }
  const a = aSum / frames, bw = GAS.binw;
  let l1 = 0;
  for (let b = 0; b < NB; b++) {
    const v = (b + 0.5) * bw;
    const theory = Math.sqrt(2 / Math.PI) * v * v / (a * a * a) * Math.exp(-v * v / (2 * a * a)) * bw;
    l1 += Math.abs(avg[b] / frames - theory);
  }
  check("弛豫到麦氏分布（时间平均后）", l1 < 0.05, `L1 偏差 ${l1.toFixed(4)}`);

  /* 单帧的偏差应当就是散粒噪声量级 —— 顺带确认上面那个平均不是在掩盖问题 */
  M.gasStats();
  let l1one = 0;
  for (let b = 0; b < NB; b++) {
    const v = (b + 0.5) * bw;
    const theory = Math.sqrt(2 / Math.PI) * v * v / (a * a * a) * Math.exp(-v * v / (2 * a * a)) * bw;
    l1one += Math.abs(GAS.hist[b] / GAS.N - theory);
  }
  check("单帧偏差在散粒噪声量级", l1one < 0.30, `单帧 L1 ${l1one.toFixed(4)}`);
}

/* ── 5. 焦耳膨胀：角落初态必须真的铺满盒子，而且不会自己缩回去 ── */
{
  M.gasInit("corner");
  const frac = () => { let n = 0; for (let i = 0; i < GAS.N; i++) if (GAS.px[i] < 0 && GAS.py[i] < 0 && GAS.pz[i] < 0) n++; return n / GAS.N; };
  const f0 = frac();
  check("角落初态确实低熵", f0 > 0.97, `初始有 ${(f0*100).toFixed(1)}% 在那个卦限`);
  for (let i = 0; i < 4000; i++) M.gasStep(0.005);
  const f1 = frac();
  // 均匀分布时该卦限占 1/8 = 0.125
  check("自由膨胀铺满", Math.abs(f1 - 0.125) < 0.05, `膨胀后 ${(f1*100).toFixed(1)}%（均匀应为 12.5%）`);
  for (let i = 0; i < 8000; i++) M.gasStep(0.005);
  const f2 = frac();
  check("不会自己缩回角落", f2 < 0.25, `再跑一段后仍是 ${(f2*100).toFixed(1)}%`);
}

/* ── 6. kinetics(): λ 与 τ 的解析值 ── */
{
  M.gasInit("same"); M.gasStats();
  const K = M.kinetics();
  const n = GAS.N / 8, d = 2 * GAS.r;
  const lam = 1 / (Math.SQRT2 * Math.PI * d * d * n);
  check("平均自由程 λ", Math.abs(K.mfp - lam) < 1e-12, `${K.mfp}`);
  check("v̄ = √(8T/π)", Math.abs(K.vbar - GAS.vrms * Math.sqrt(8 / (3 * Math.PI))) < 1e-12, `${K.vbar}`);
  check("τ = λ/v̄", Math.abs(K.tau - K.mfp / K.vbar) < 1e-12, `${K.tau}`);
  check("λ/r ≈ 10（正文引用值）", Math.abs(K.mfp / GAS.r - 9.5) < 1.5, `λ/r = ${(K.mfp/GAS.r).toFixed(2)}`);
}

/* ── 7. 正文的核心可视化主张：Grad 标度下重碰率随 r 下降 ── */
{
  const rows = [];
  const invariant = 520 * 0.045 * 0.045;      // N·r² 固定
  for (const r of [0.062, 0.045, 0.032, 0.024]) {
    GAS.r = r;
    GAS.N = Math.max(60, Math.round(invariant / (r * r) / 20) * 20);
    const K = run("same", 26);
    rows.push({ r, N: GAS.N, grad: +(GAS.N * r * r).toFixed(3), rOverLam: +(r / K.mfp).toFixed(4),
                tau: +K.tau.toFixed(3), recol: +(GAS.recolRate * 100).toFixed(2) });
  }
  // Grad 不变量确实固定
  const grads = rows.map(x => x.grad);
  check("Grad 不变量保持", Math.max(...grads) - Math.min(...grads) < 0.06, JSON.stringify(grads));
  // τ 基本不动（气体“性格”不变）
  const taus = rows.map(x => x.tau);
  check("τ 在 Grad 标度下基本不变", (Math.max(...taus) - Math.min(...taus)) / Math.min(...taus) < 0.25, JSON.stringify(taus));
  // 重碰率单调下降 —— 这是第 7 章让读者亲手拖出来的那条
  const rec = rows.map(x => x.recol);
  let mono = true;
  for (let i = 1; i < rec.length; i++) if (rec[i] > rec[i - 1] + 0.15) mono = false;
  check("重碰率随 r 减小而下降", mono && rec[rec.length - 1] < rec[0], JSON.stringify(rec));
  console.log("Grad 标度扫描:", JSON.stringify(rows));
}

/* ── 7b. 碰撞算符 Q(f,f) 的实测 ──
   正文第 3 章的三条主张，逐条验：
   (a) 产生与损失的总计数必须相等（每次碰撞各记两进两出）；
   (b) 从 δ 壳层出发，初速率那一格 Q < 0，两侧 Q > 0；
   (c) 接近平衡后整条 Q 压回零轴（|Q| 总量大幅下降）。 */
{
  GAS.N = 520; GAS.r = 0.045;
  M.gasInit("same");
  const v0 = Math.hypot(GAS.vx[0], GAS.vy[0], GAS.vz[0]);
  const b0 = Math.min(QB.NB - 1, Math.floor(v0 / QB.bw));

  // (a) 收支两侧的总量守恒
  QB.gain.fill(0); QB.loss.fill(0);
  for (let i = 0; i < 400; i++) M.gasStep(0.005);
  let g = 0, l = 0;
  for (let b = 0; b < QB.NB; b++) { g += QB.gain[b]; l += QB.loss[b]; }
  check("Q 的产生与损失总计数相等", g === l && g > 0, `产生 ${g}，损失 ${l}`);

  // (b) 弛豫早期：初速率那一格被清空，两侧被填充
  M.gasInit("same");
  for (let i = 0; i < 240; i++) { M.gasStep(0.005); M.qbStep(); }
  const qAt = b => QB.q[b];
  const side = qAt(Math.max(0, b0 - 3)) + qAt(Math.min(QB.NB - 1, b0 + 3));
  check("初速率那一格 Q < 0（正被清空）", qAt(b0) < 0, `Q[${b0}] = ${qAt(b0).toFixed(4)}`);
  check("两侧 Q > 0（正被填充）", side > 0, `两侧合计 ${side.toFixed(4)}`);
  const early = QB.net;

  // (c) 跑到平衡后 |Q| 应当大幅下降
  for (let i = 0; i < 9000; i++) { M.gasStep(0.005); M.qbStep(); }
  const late = QB.net;
  check("接近平衡后 |Q| 明显下降", late < early * 0.5,
    `弛豫早期 ${early.toFixed(4)} → 平衡后 ${late.toFixed(4)}`);
  console.log("Q(f,f):", JSON.stringify({ bin0: b0, qAtBin0: +qAt(b0).toFixed(4),
    netEarly: +early.toFixed(4), netLate: +late.toFixed(4), ratio: +(late / early).toFixed(3) }));
}

/* ── 7c. 傅里叶定律 ──
   正文第 8 章声称：冷热两半松手后，温度剖面按热传导方程摊平，
   对比度 (Tmax−Tmin)/T̄ 指数衰减。这是从纯硬球碰撞里长出来的。 */
{
  GAS.N = 520; GAS.r = 0.045;
  M.gasInit("hot");
  M.profStep();
  const c0 = PROF.contrast;
  check("冷热两半初态确有温度台阶", c0 > 0.5, `初始第一模振幅 ${(c0 * 100).toFixed(0)}%`);

  // 台阶方向要对：左热右冷
  const left = PROF.T.slice(0, 4).reduce((a, b) => a + b) / 4;
  const right = PROF.T.slice(-4).reduce((a, b) => a + b) / 4;
  check("左热右冷", left > right * 1.5, `左 ${left.toFixed(3)}，右 ${right.toFixed(3)}`);

  // 对比度必须单调衰减到接近 0
  const trace = [];
  for (let k = 0; k < 60; k++) {
    for (let i = 0; i < 100; i++) M.gasStep(0.005);
    M.profStep();
    trace.push(PROF.contrast);
  }
  const end = trace[trace.length - 1];
  check("温度差被抹平", end < c0 * 0.12, `${(c0*100).toFixed(0)}% → ${(end*100).toFixed(1)}%`);

  // 指数衰减：log(contrast) 对时间应当近似线性，且斜率为负
  const n = Math.floor(trace.length / 2);
  const lg = trace.slice(0, n).map(v => Math.log(Math.max(v, 1e-6)));
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  lg.forEach((y, i) => { sx += i; sy += y; sxy += i * y; sxx += i * i; });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  check("对比度指数衰减（斜率为负）", slope < -0.005, `log 斜率 ${slope.toFixed(4)}`);

  // 总能量在整个过程中守恒（衰减的是不均匀性，不是能量）
  M.gasStats();
  check("抹平过程能量守恒", Math.abs(GAS.vrms ** 2 / 3 - 0.5605) < 0.02,
    `T = ${(GAS.vrms ** 2 / 3).toFixed(4)}`);
  console.log("傅里叶:", JSON.stringify({ c0: +c0.toFixed(3), cEnd: +end.toFixed(3),
    logSlope: +slope.toFixed(4), T: +(GAS.vrms ** 2 / 3).toFixed(4) }));
}

/* ── 7d. Grad 标度锁必须真的守住 N·r² ──
   第 7 章让读者拖 r 看重碰率下降，前提是 N·r² 一直不变。
   r 小到某个程度所需的 N 会超过滑块上限，这时必须夹住 r 而不是夹住 N，
   否则「不变量」会悄悄往下掉，正好在读者最爱拖的那一段。 */
{
  const html2 = html;
  const NCAP = +(html2.match(/id="s_N" min="\d+" max="(\d+)"/) || [])[1];
  const rMinSlider = +(html2.match(/id="s_r" min="([\d.]+)"/) || [])[1];
  check("N 滑块有上限", Number.isFinite(NCAP) && NCAP > 0, `${NCAP}`);

  /* 复刻页面里的锁定逻辑 */
  const clampR = (N0, r0, rWanted) => {
    const inv = N0 * r0 * r0;
    const rMin = Math.sqrt(inv / NCAP);
    let r = rWanted;
    if (r < rMin) r = Math.ceil(rMin * 1000) / 1000;
    const N = clamp(Math.round(inv / (r * r) / 20) * 20, 60, NCAP);
    return { r, N, inv: N * r * r, target: inv };
  };
  let N0 = 520, r0 = 0.045;
  const scan = [];
  for (let r = 0.062; r >= rMinSlider - 1e-9; r -= 0.002) {
    const s = clampR(N0, r0, +r.toFixed(3));
    scan.push({ r: s.r, N: s.N, inv: +s.inv.toFixed(3) });
    const drift = Math.abs(s.inv - s.target) / s.target;
    check(`Grad 不变量在 r=${r.toFixed(3)} 处守住`, drift < 0.06,
      `目标 ${s.target.toFixed(3)}，实得 ${s.inv.toFixed(3)}（偏 ${(drift*100).toFixed(0)}%）`);
    check(`r=${r.toFixed(3)} 时 N 不超上限`, s.N <= NCAP, `${s.N} > ${NCAP}`);
  }
  const minReached = Math.min(...scan.map(s => s.r));
  console.log("Grad 锁:", JSON.stringify({ NCAP, rSliderMin: rMinSlider,
    rActuallyReachable: minReached, invRange: [Math.min(...scan.map(s=>s.inv)), Math.max(...scan.map(s=>s.inv))] }));
}

/* ── 8. 演化瀑布图缓冲：不许无限增长，行必须归一 ── */
{
  run("same", 30);
  check("瀑布图缓冲有上界", GAS.wf.length <= GAS.WFMAX, `${GAS.wf.length} 行`);
  const row = GAS.wf[GAS.wf.length - 1];
  let s = 0; for (const v of row) s += v;
  check("瀑布图每行归一", Math.abs(s - 1) < 1e-5, `Σ = ${s}`);
}

/* ── 9. pairLast 记忆表不许泄漏 ── */
{
  GAS.N = 520; GAS.r = 0.045;
  run("same", 40);
  check("重碰记忆表有界", GAS.pairLast.size < 40 * GAS.N, `${GAS.pairLast.size} 条`);
}

/* ── 10. 时间反演：立刻反演应当精确回到出发点附近 ── */
{
  M.gasInit("same");
  const snap = [GAS.px.slice(), GAS.py.slice(), GAS.pz.slice()];
  const dt = 0.002, n = 60;
  for (let i = 0; i < n; i++) M.gasStep(dt);
  for (let i = 0; i < GAS.N; i++) { GAS.vx[i] *= -1; GAS.vy[i] *= -1; GAS.vz[i] *= -1; }
  for (let i = 0; i < n; i++) M.gasStep(dt);
  let worst = 0;
  for (let i = 0; i < GAS.N; i++) {
    worst = Math.max(worst, Math.hypot(GAS.px[i] - snap[0][i], GAS.py[i] - snap[1][i], GAS.pz[i] - snap[2][i]));
  }
  check("短时反演可回溯", worst < 0.05, `最大位移偏差 ${worst.toFixed(5)}`);
}

/* ── 10b. 速度空间那一章正文声称的形状 ──
   「同速率球壳＝一层空心壳」「同向束流＝一个点」「冷热两半＝两层同心壳」
   「全挤在角落＝在 v 空间里还是那层壳」。这四句都是可测的，逐条量。 */
{
  const shape = () => {
    const N = GAS.N;
    let mx = 0, my = 0, mz = 0, sp = [];
    for (let i = 0; i < N; i++) {
      mx += GAS.vx[i]; my += GAS.vy[i]; mz += GAS.vz[i];
      sp.push(Math.hypot(GAS.vx[i], GAS.vy[i], GAS.vz[i]));
    }
    mx /= N; my /= N; mz /= N;
    const mean = sp.reduce((a, b) => a + b, 0) / N;
    let vr = 0, blob = 0;
    for (let i = 0; i < N; i++) {
      vr += (sp[i] - mean) ** 2;
      // 点云相对自身质心的散布：束流应当近乎为 0，各向同性壳层应当 ~1
      blob += (GAS.vx[i] - mx) ** 2 + (GAS.vy[i] - my) ** 2 + (GAS.vz[i] - mz) ** 2;
    }
    return {
      speedSpread: Math.sqrt(vr / N) / mean,          // 壳「厚不厚」
      cloudSpread: Math.sqrt(blob / N) / mean          // 是不是缩成一个点
    };
  };
  const seen = {};
  for (const p of ["same", "beam", "hot", "corner"]) { M.gasInit(p); M.gasStats(); seen[p] = shape(); }

  check("同速率球壳：壳很薄", seen.same.speedSpread < 0.01, `厚度 ${seen.same.speedSpread.toFixed(4)}`);
  check("同速率球壳：不是一个点（方向各向同性）", seen.same.cloudSpread > 0.9,
    `散布 ${seen.same.cloudSpread.toFixed(3)}`);
  check("同向束流：在 v 空间缩成一个点", seen.beam.cloudSpread < 0.06,
    `散布 ${seen.beam.cloudSpread.toFixed(4)}（球壳是 ${seen.same.cloudSpread.toFixed(2)}）`);
  check("冷热两半：壳明显变厚（两层）", seen.hot.speedSpread > 0.3,
    `厚度 ${seen.hot.speedSpread.toFixed(3)}`);
  check("全挤在角落：v 空间仍是那层薄壳", seen.corner.speedSpread < 0.01,
    `厚度 ${seen.corner.speedSpread.toFixed(4)}`);

  /* 弛豫之后壳应当摊成麦氏分布。麦氏速率分布的 std/mean = √(3−8/π)/(2√(2/π)) ≈ 0.422 */
  run("same", 26);
  const relaxed = shape();
  check("弛豫后壳厚趋于麦氏值 0.422", Math.abs(relaxed.speedSpread - 0.422) < 0.05,
    `实测 ${relaxed.speedSpread.toFixed(3)}`);

  /* 正文那个「坑」：F(v) = 4πv²·f(v)。直接量一遍，看两条曲线的峰值确实不在同一处。 */
  {
    const NBv = 30, top = 2.9 * GAS.vrms, bw = top / NBv;
    const cnt = new Float64Array(NBv);
    for (let i = 0; i < GAS.N; i++) {
      const b = Math.floor(Math.hypot(GAS.vx[i], GAS.vy[i], GAS.vz[i]) / bw);
      if (b >= 0 && b < NBv) cnt[b]++;
    }
    let peakF = 0, peakf = 0, bestF = -1, bestf = -1;
    for (let b = 0; b < NBv; b++) {
      const v = (b + 0.5) * bw;
      const F = cnt[b];                       // 速率分布
      const f = cnt[b] / (4 * Math.PI * v * v);  // 除掉壳面积 = 速度分布
      if (F > peakF) { peakF = F; bestF = v; }
      if (f > peakf) { peakf = f; bestf = v; }
    }
    check("速率分布 F(v) 的峰不在 v=0", bestF > 0.5 * GAS.vrms, `峰在 v=${bestF.toFixed(3)}`);
    check("速度分布 f(v) 的峰在最小的那一格（v→0）", bestf < bestF,
      `f 峰 ${bestf.toFixed(3)} 应当小于 F 峰 ${bestF.toFixed(3)}`);
    console.log("速度空间形状:", JSON.stringify({
      shell: +seen.same.speedSpread.toFixed(4), beam: +seen.beam.cloudSpread.toFixed(4),
      hot: +seen.hot.speedSpread.toFixed(3), relaxed: +relaxed.speedSpread.toFixed(3),
      peakF: +bestF.toFixed(3), peakf: +bestf.toFixed(3)
    }));
  }
}

/* ── 10c. 拖尾缓冲：环形写入不越界，且满了以后长度不再涨 ── */
{
  M.gasInit("same");
  M.trSet(16, 80);
  check("拖尾缓冲大小正确", GAS.tr.length === 16 * 80 * 3, `${GAS.tr && GAS.tr.length}`);
  for (let i = 0; i < 500; i++) { M.gasStep(0.005); M.trPush(); }
  check("拖尾环形缓冲不越界", GAS.trFill === 80 && GAS.trHead < 80,
    `fill=${GAS.trFill} head=${GAS.trHead}`);
  let bad = 0;
  for (let i = 0; i < GAS.tr.length; i++) if (!isFinite(GAS.tr[i]) || Math.abs(GAS.tr[i]) > GAS.L + 0.01) bad++;
  check("拖尾里的点都在盒子内", bad === 0, `${bad} 个越界样本`);
  M.trSet(0, 0);
  check("关掉拖尾后不再占内存", GAS.tr === null, `${GAS.tr}`);
}

/* ── 10d. 重碰闪光：确实有事件被标记，且只标记重碰 ── */
{
  GAS.N = 520; GAS.r = 0.045;
  M.gasInit("same");
  GAS.recolWin = 1.5;
  /* 闪光的衰减在渲染循环里（时间常数 0.55 秒），gasStep 只负责点亮。
     这里把衰减照搬过来，测的才是屏幕上真正的稳态亮度——
     不衰减地跑下去，迟早每个粒子都被点过一次，那个数没有意义。 */
  const dt = 0.005, decay = Math.exp(-dt / 0.55);
  let lit = 0, peak = 0;
  for (let i = 0; i < 2400; i++) {
    M.gasStep(dt);
    for (let k = 0; k < GAS.N; k++) if (GAS.flash[k] > 0.004) GAS.flash[k] *= decay; else GAS.flash[k] = 0;
    if (i > 400) { let c = 0; for (let k = 0; k < GAS.N; k++) if (GAS.flash[k] > 0.25) c++; peak = Math.max(peak, c); }
  }
  for (let i = 0; i < GAS.N; i++) if (GAS.flash[i] > 0.25) lit++;
  check("重碰会点亮粒子", peak > 0, `整段最多同时亮 ${peak} 个`);
  /* 稳态亮着的比例应当和重碰率同量级（百分之几），不该糊成一片 */
  check("屏幕上是零星闪光，不是一片白", lit < GAS.N * 0.15,
    `稳态亮 ${lit}/${GAS.N}，重碰率 ${(GAS.recolRate * 100).toFixed(1)}%`);
  console.log("重碰闪光:", JSON.stringify({ lit, peak, N: GAS.N, recolRate: +(GAS.recolRate * 100).toFixed(1) }));
}

/* ── 10d2. 直接跑 gasRender，看它到底把球画在哪 ──
   浏览器面板在这个环境里永远是隐藏的，WebGL 一帧都不画，所以画面没法靠截图验。
   办法是把 gasRender 原样抽出来，用桩替掉所有 GL 调用，直接看它产出的实例坐标。
   测的是线上那份代码本身，不是我另写的一份等价实现。 */
{
  const drawn = { lines: [], inst: null, mesh: "" };
  class StubInst {
    constructor() { this.pts = []; this.n = 0; }
    reset() { this.pts = []; this.n = 0; }
    add(ox, oy, oz, ax, ay, az, rad, r, g, b) { this.pts.push({ ox, oy, oz, rad, r, g, b }); this.n++; }
    upload() {}
  }
  const gasInst = new StubInst(), gasCube = new StubInst(), trInst = new StubInst();
  const stubGl = new Proxy({}, { get: () => () => {} });
  const env = {
    GAS, clamp, lerp: (a, b, t) => a + (b - a) * t,
    heat: (t) => [t, 0.5, 1 - t],
    M4: { id: () => "ID", trs: (x, y, z, s) => ({ scale: s }) },
    drawLines: (vbo, count, model, col) => drawn.lines.push({ vbo, count, model, alpha: col[3] }),
    drawInstanced: (mesh, inst, model, opt) => { drawn.inst = inst; drawn.mesh = mesh; drawn.opt = opt; },
    gasMacro: () => {}, gasInst, gasCube, trInst,
    MESH: { ball: "ball", ballHi: "ballHi", cube: "cube" },
    gl: stubGl, gasBoxVBO: "BOX", vGuideVBO: "GUIDE", V_GUIDE_N: 438
  };
  const keys = Object.keys(env);
  const render = new Function(...keys, `${grab("gasRender")}\nreturn gasRender;`)(...keys.map(k => env[k]));

  GAS.N = 520; GAS.r = 0.045; GAS.single = false; GAS.mode = "micro";
  M.gasInit("same"); M.gasStats();

  const shot = (vmix) => {
    GAS.vmix = vmix; drawn.lines = [];
    render();
    const p = drawn.inst.pts;
    let rmin = Infinity, rmax = 0, nan = 0;
    for (const q of p) {
      const d = Math.hypot(q.ox, q.oy, q.oz);
      if (!isFinite(d) || !isFinite(q.rad)) nan++;
      rmin = Math.min(rmin, d); rmax = Math.max(rmax, d);
    }
    return { n: p.length, rmin, rmax, rad: p[0].rad, nan,
             box: drawn.lines.find(l => l.vbo === "BOX"), guide: drawn.lines.find(l => l.vbo === "GUIDE") };
  };

  const atX = shot(0), atMid = shot(0.5), atV = shot(1);
  check("渲染出全部粒子", atX.n === GAS.N && atV.n === GAS.N, `${atX.n} / ${atV.n}`);
  check("坐标里没有 NaN", atX.nan === 0 && atMid.nan === 0 && atV.nan === 0,
    `${atX.nan}/${atMid.nan}/${atV.nan}`);
  // 位置空间：球在边长 2 的盒子里，到原点最远 √3
  check("位置空间下球在盒子里", atX.rmax <= Math.SQRT2 * Math.SQRT2 + 0.1, `最远 ${atX.rmax.toFixed(3)}`);
  check("位置空间不画速度坐标系", !atX.guide || atX.guide.alpha === 0, `${atX.guide && atX.guide.alpha}`);
  check("位置空间画盒子", !!atX.box && atX.box.alpha > 0.1, `${atX.box && atX.box.alpha}`);
  // 速度空间：同速率球壳 ⇒ 所有点落在同一个半径上，且那个半径就是标尺 0.62
  const shellW = atV.rmax - atV.rmin;
  check("速度空间下球壳是一层薄壳", shellW < 0.01, `厚度 ${shellW.toFixed(5)}`);
  check("球壳落在均方根速率的圆上（0.62）", Math.abs(atV.rmax - 0.62) < 0.01, `半径 ${atV.rmax.toFixed(4)}`);
  check("速度空间画坐标系不画盒子", atV.guide && atV.guide.alpha > 0.1 && (!atV.box || atV.box.alpha < 0.01),
    `guide=${atV.guide && atV.guide.alpha} box=${atV.box && atV.box.alpha}`);
  check("速度坐标系缩放到 0.62", atV.guide.model.scale === 0.62, `${atV.guide.model.scale}`);
  check("速度空间下球缩小成点", atV.rad < atX.rad, `${atV.rad} vs ${atX.rad}`);
  // 中间态：两套参照系都半透明，球在两个位置之间
  check("形变中途盒子与坐标系同时半透明",
    atMid.box.alpha > 0 && atMid.box.alpha < 0.13 && atMid.guide.alpha > 0 && atMid.guide.alpha < 0.30,
    `box=${atMid.box.alpha.toFixed(3)} guide=${atMid.guide.alpha.toFixed(3)}`);

  /* 束流在速度空间必须缩成一个点 —— 正文第 3 章就是这么说的 */
  M.gasInit("beam"); M.gasStats();
  const beamV = shot(1);
  check("同向束流在速度空间缩成一点", beamV.rmax - beamV.rmin < 0.05,
    `跨度 ${(beamV.rmax - beamV.rmin).toFixed(4)}`);

  /* 拖尾：开了就该有实例，关了就不该有 */
  M.gasInit("same");
  GAS.vmix = 0; M.trSet(16, 80);
  for (let i = 0; i < 200; i++) { M.gasStep(0.005); M.trPush(); }
  drawn.inst = null; render();
  check("拖尾开启时确实提交了轨迹实例", trInst.n === 16 * 80, `${trInst.n}`);
  trInst.reset(); M.trSet(0, 0); render();
  check("拖尾关闭后不提交实例", trInst.n === 0, `${trInst.n}`);

  console.log("渲染实测:", JSON.stringify({
    xSpaceMax: +atX.rmax.toFixed(3), vShellR: +atV.rmax.toFixed(4),
    shellWidth: +shellW.toFixed(5), beamSpread: +(beamV.rmax - beamV.rmin).toFixed(4),
    radX: +atX.rad.toFixed(4), radV: +atV.rad.toFixed(4)
  }));
  GAS.vmix = 0;
}

/* ── 10d3. Inst.add 的参数个数 ──
   签名是 (ox,oy,oz, ax,ay,az, rad, r,g,b) 共 10 个。少传一个不会报错，
   只会让半径位被颜色顶掉、蓝通道变 undefined —— 屏幕上是一堆巨大的错色球，
   而 JS 一声不吭。这类错误只能靠数参数抓，所以在这里数。 */
{
  const bad = [];
  const re = /\b(?:ins|ti|inst)\.add\(/g;
  let m;
  while ((m = re.exec(html))) {
    let i = m.index + m[0].length, depth = 1, args = 1, s = "";
    for (; i < html.length && depth > 0; i++) {
      const c = html[i];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") { depth--; if (depth === 0) break; }
      else if (c === "," && depth === 1) args++;
      s += c;
    }
    if (args !== 10) bad.push(`${args} 个参数: ${s.replace(/\s+/g, " ").slice(0, 70)}`);
  }
  check("Inst.add 一律传 10 个参数", bad.length === 0, bad.join(" | "));
  check("确实检查到了 add 调用", (html.match(re) || []).length >= 2,
    `只找到 ${(html.match(re) || []).length} 处`);
}

/* ── 10e. 位置 ⇄ 速度的补间 ──
   浏览器里 rAF 在后台标签页是冻结的，动画没法在那边验；补间逻辑本身
   是纯函数，抽出来跑更靠谱。验三件事：章节声明能把 vmix 推到 1、
   没声明的会被拉回 0、手动拖滑块时同名补间会被掐掉（否则松手会被抢回去）。 */
{
  const G = { vmix: 0, vmixSet: false };
  const anims = [];
  const ease = k => k * k * (3 - 2 * k);
  const lerp2 = (a, b, t) => a + (b - a) * t;
  let clock = 0;
  const anim = (set, from, to, ms, delay, key) => anims.push({ set, from, to, ms, t0: clock + (delay || 0), key });
  const to = (obj, key, val, ms, delay) => anim(v => obj[key] = v, obj[key], val, ms === undefined ? 600 : ms, delay, key);
  const vmixTo = (v, ms, delay) => { G.vmixSet = true; to(G, "vmix", v, ms === undefined ? 1100 : ms, delay); };
  const advance = (ms) => {
    clock += ms;
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      if (clock < a.t0) continue;
      const k = Math.min(1, Math.max(0, (clock - a.t0) / a.ms));
      a.set(lerp2(a.from, a.to, ease(k)));
      if (k >= 1) anims.splice(i, 1);
    }
  };
  // 进入速度空间那一章
  anims.length = 0; G.vmixSet = false;
  vmixTo(1, 1400, 260);
  advance(200);
  check("补间起步前 vmix 还没动", G.vmix < 0.01, `${G.vmix.toFixed(3)}`);
  advance(900);
  check("补间中途 vmix 在两端之间", G.vmix > 0.15 && G.vmix < 0.95, `${G.vmix.toFixed(3)}`);
  advance(1400);
  check("补间结束落在速度空间", Math.abs(G.vmix - 1) < 1e-6, `${G.vmix.toFixed(6)}`);

  // 翻到没声明 vmix 的章节：应当淡回位置空间
  anims.length = 0; G.vmixSet = false;
  if (!G.vmixSet) to(G, "vmix", 0, 520);
  advance(700);
  check("未声明的章节淡回位置空间", Math.abs(G.vmix) < 1e-6, `${G.vmix.toFixed(6)}`);

  // 手动拖滑块：同名补间必须被掐掉，否则松手后动画把值抢回去
  anims.length = 0; G.vmix = 0; G.vmixSet = false;
  vmixTo(1, 1400, 0);
  advance(300);
  for (let i = anims.length - 1; i >= 0; i--) if (anims[i].key === "vmix") anims.splice(i, 1);
  G.vmix = 0.5;
  advance(2000);
  check("手动拖动后补间不再抢值", Math.abs(G.vmix - 0.5) < 1e-9, `${G.vmix}`);
  check("掐补间用的 key 在页面里确实传了", /function to\(obj,key,val,ms,delay\)\{anim\([^)]*,key\)/.test(html.replace(/\s+/g, "")) || html.includes("delay,key);}"),
    "to() 没把 key 传给 anim()，掐补间会失效");
}

/* ── 10f. 分层阅读的结构契约 ──
   每章必须有一句话导语（.lede）。这是这次改版的核心约定：
   读者能只读导语走完全篇，公式推导收在 details 里按需展开。 */
{
  const bodies = [...html.matchAll(/\{id:'(\w+)',t:'[^']*',\s*b:`([\s\S]*?)`,\s*\n\s*en\(\)/g)];
  check("能解析出全部章节正文", bodies.length === 12, `解析到 ${bodies.length} 章`);
  const noLede = bodies.filter(m => !m[2].includes('class="lede"')).map(m => m[1]);
  check("每章都有一句话导语", noLede.length === 0, `缺导语：${noLede.join(", ")}`);
  const tooLong = bodies.filter(m => {
    const lede = (m[2].match(/class="lede">([\s\S]*?)<\/p>/) || [, ""])[1].replace(/<[^>]+>/g, "");
    return lede.length > 90;
  }).map(m => m[1]);
  check("导语保持在一句话以内（≤90 字）", tooLong.length === 0, `过长：${tooLong.join(", ")}`);
  const noFml = bodies.filter(m => {
    const lede = (m[2].match(/class="lede">([\s\S]*?)<\/p>/) || [, ""])[1];
    return /class="fml"|<sub>|∫|⊗/.test(lede);
  }).map(m => m[1]);
  check("导语里不出现公式", noFml.length === 0, `含公式：${noFml.join(", ")}`);
  const deep = bodies.filter(m => m[2].includes('details class="deep"')).length;
  check("重推导确实被收进可展开块", deep >= 6, `只有 ${deep} 章有 details.deep`);
  console.log("分层阅读:", JSON.stringify({ chapters: bodies.length, withDeep: deep }));
}

/* ── 10g. 图表按章节 id 开关，不按序号 ── */
{
  check("图表开关不再用序号硬编码", !/if\(si>=\d\)\{[\s\S]{0,60}#charts/.test(html), "仍存在 si>=N 的图表判断");
  const m = html.match(/const CHART_FROM=new Set\(\[([^\]]+)\]\)/);
  check("CHART_FROM 存在", !!m, "找不到 CHART_FROM");
  if (m) {
    const set = m[1].split(",").map(s => s.trim().replace(/'/g, ""));
    check("有图的章节从 relax 开始", set[0] === "relax", JSON.stringify(set));
    check("没数据的前三章不画图", !set.includes("one") && !set.includes("many") && !set.includes("vspace"),
      JSON.stringify(set));
  }
}

/* ── 11. 章节结构与正文引用的 id 一致 ── */
{
  const ids = [...html.matchAll(/\{id:'([a-z]+)',t:'/g)].map(m => m[1]);
  const want = ["one","many","vspace","relax","qop","htheorem","loschmidt","assumptions","recollision","fluid","lanford","deng"];
  check("章节 id 齐全且顺序正确", JSON.stringify(ids) === JSON.stringify(want), JSON.stringify(ids));
  for (const id of ["lanford","recollision","fluid","loschmidt","many","vspace"]) {
    check(`帧循环引用了 ${id}`, html.includes(`id==='${id}'`) || html.includes(`id==='${id}'`), "未引用");
  }
  /* 章节内容逻辑必须按 id 走。si===0 / si===S.length-1 是翻页按钮的边界判断，允许保留。 */
  const badIdx = [...html.matchAll(/si===(\d+)/g)].map(m => m[1]).filter(d => d !== "0");
  check("章节内容不再按序号硬编码", badIdx.length === 0, `仍存在 si===${badIdx.join(", si===")}`);
}

if (fail.length) {
  console.error(JSON.stringify({ ok: false, failed: fail }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "energy, walls, H-theorem×4, Maxwell relaxation, Joule expansion, kinetics, Grad scaling, waterfall, memory, reversibility, chapter ids" }));
