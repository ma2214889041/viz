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
  recolWin: 1.5, gradLock: false
};
let cellIdx = null, cellStart = null, cellItems = null, cellFill = null, lastGN = -1;

const QB = { on: true, NB: 40, bw: 0.1, gain: new Float64Array(40), loss: new Float64Array(40),
             gAcc: new Float64Array(40), lAcc: new Float64Array(40),
             q: new Float64Array(40), top: 4, net: 0 };
const PROF = { NX: 16, T: new Float64Array(16), n: new Float64Array(16),
               hist: [], HMAX: 90, contrast: 1, tick: 0 };

const src = [grab("gasInit"), grab("gasStep"), grab("gasStats"), grab("kinetics"),
             grab("wfPush"), grab("qbReset"), grab("qbStep"), grab("profStep")].join("\n");
const make = new Function("GAS", "clamp", "rng", "QB", "PROF", `
  let cellIdx=null,cellStart=null,cellItems=null,cellFill=null,lastGN=-1;
  ${src}
  return {gasInit,gasStep,gasStats,kinetics,wfPush,qbReset,qbStep,profStep};
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

/* ── 11. 章节结构与正文引用的 id 一致 ── */
{
  const ids = [...html.matchAll(/\{id:'([a-z]+)',t:'/g)].map(m => m[1]);
  const want = ["one","many","relax","htheorem","loschmidt","assumptions","recollision","fluid","deng"];
  check("章节 id 齐全且顺序正确", JSON.stringify(ids) === JSON.stringify(want), JSON.stringify(ids));
  for (const id of ["deng","recollision","fluid","loschmidt","many","relax"]) {
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
