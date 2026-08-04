/* 宇宙网篇的自检：把页面里真正在跑的 PM N-body 抽出来，跟理论对。
   这一篇的每一条数值主张都在这里被钉住 —— 增长因子、功率谱形状、
   以及正文引用的那几个形态学数字。 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "cosmic-web/index.html"), "utf8");

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
/* 页面里的 COS 初值原样取出来，保证测的就是线上的参数 */
const cosBlock = (() => {
  const s = html.indexOf("const COS={");
  let d = 0, i = html.indexOf("{", s), began = false;
  for (; i < html.length; i++) {
    if (html[i] === "{") { d++; began = true; }
    else if (html[i] === "}") { d--; if (began && d === 0) return html.slice(s, i + 1); }
  }
  throw new Error("COS 块不闭合");
})();
/* 只在 COS 字面量里取值。第一版用全页正则，Ω_m 被别处的字符串匹配成
   112，测出来的一切都是假的 —— 参数必须从它真正的定义处取。 */
const num = (key) => {
  const m = cosBlock.match(new RegExp(`(?:^|[,{\\s])${key}\\s*:\\s*([\\d.]+)`));
  if (!m) throw new Error(`取不到 ${key}`);
  return +m[1];
};
const COS = {
  N: 32, om: num("om"), ns: num("ns"), gamma: num("gamma"),
  sigma0: num("sigma0"), aInit: num("aInit"), seed: 20260804,
  a: 0.02, np: 0, running: false, steps: 0, nsteps: 100,
  px: null, py: null, pz: null, vx: null, vy: null, vz: null,
  dre: null, dim: null, phi: null, gx: null, gy: null, gz: null,
  deltaIC: null, dens: null, buf: null, ampView: 1,
  hist: [], morph: { voids: 0, top10: 0.1, max: 0, sig: 0 },
  growthRate: 1, sig0: 1, showBox: 1
};

const src = ["rngc", "gaussc", "twiddles", "fft1", "fft3", "transferBBKS", "powerSpec",
             "growth", "cosInit", "cosDeposit", "cosPoisson", "cosGradient",
             "cosKick", "cosDrift", "cosStep", "sigmaR", "measureP", "measureMorph"]
             .map((n) => grab(n)).join("\n");
const M = new Function("COS", "clamp", `
  const E_of=(a,om)=>Math.sqrt(om/(a*a*a)+(1-om));
  const _tw=new Map(); let _lr=null,_li=null;
  ${src}
  return {fft1,fft3,transferBBKS,powerSpec,growth,cosInit,cosDeposit,cosStep,
          sigmaR,measureP,measureMorph,E_of};
`)(COS, clamp);

const fail = [];
const check = (name, cond, detail) => { if (!cond) fail.push(`${name}: ${detail}`); return cond; };

/* ── 1. 线性增长因子 D(a) ──
   爱因斯坦–德西特（Ω_m=1）宇宙里 D 严格正比于 a。这是最硬的一条。 */
{
  const r = [0.05, 0.2, 0.5, 1].map((a) => M.growth(a, 1.0) / a);
  const spread = Math.max(...r) - Math.min(...r);
  check("Ω_m=1 时 D ∝ a", spread < 2e-3, `D/a = ${r.map((v) => v.toFixed(4)).join(", ")}`);
  check("D(1) 归一到 1", Math.abs(M.growth(1, 0.31) - 1) < 1e-9, `${M.growth(1, 0.31)}`);
  /* ΛCDM 下增长在晚期被暗能量拖慢，D(a) 必须处处低于 a 的线性外推 */
  const dl = M.growth(0.5, 0.31), eds = M.growth(0.5, 1.0);
  check("有 Λ 时晚期增长被拖慢", dl > eds, `Λ CDM D(0.5)=${dl.toFixed(4)} vs EdS ${eds.toFixed(4)}`);
}

/* ── 2. 增长率 f = dlnD/dlna，应趋近 Ω_m(a)^0.55 ──
   这是文献里到处在用的近似式，正文也引了它。 */
{
  const om = 0.31, eps = 1e-4;
  const fOf = (a) => (Math.log(M.growth(a * (1 + eps), om)) - Math.log(M.growth(a * (1 - eps), om))) / (2 * eps);
  const f0 = fOf(0.02), f1 = fOf(1);
  check("深度物质主导期 f ≈ 1", Math.abs(f0 - 1) < 0.01, `f(a=0.02) = ${f0.toFixed(4)}`);
  check("今天 f ≈ Ω_m^0.55", Math.abs(f1 - Math.pow(om, 0.55)) < 0.01,
    `实测 ${f1.toFixed(4)}，Ω_m^0.55 = ${Math.pow(om, 0.55).toFixed(4)}`);
  check("f 单调下降（暗能量在踩刹车）", fOf(0.3) > fOf(0.6) && fOf(0.6) > f1,
    `${fOf(0.3).toFixed(3)} > ${fOf(0.6).toFixed(3)} > ${f1.toFixed(3)}`);
  console.log("增长率:", JSON.stringify({ f_early: +f0.toFixed(4), f_today: +f1.toFixed(4),
    om055: +Math.pow(om, 0.55).toFixed(4) }));
}

/* ── 3. BBKS 转移函数的极限行为 ── */
{
  check("k→0 时 T→1（大尺度不被压制）", Math.abs(M.transferBBKS(1e-6, 0.21) - 1) < 1e-3,
    `${M.transferBBKS(1e-6, 0.21)}`);
  let mono = true, prev = 1;
  for (let k = 0.01; k < 500; k *= 1.5) { const t = M.transferBBKS(k, 0.21); if (t > prev + 1e-12) mono = false; prev = t; }
  check("T(k) 单调下降", mono, "转移函数不单调");
  /* 谱必然先升后降：低 k 由 k^ns 主导，高 k 被 T² 压垮 */
  let peakK = 0, peakP = -1;
  /* 用页面真正在用的 Γ。转折的波长约 307 Mpc/h，比 180 的盒子还大，
     所以峰落在基频（2π）以下 —— 正文和图表都必须如实说这件事。 */
  const kf = 2 * Math.PI;
  for (let k = kf / 32; k < kf * 32; k *= 1.01) {
    const p = M.powerSpec(k, COS.ns, COS.gamma); if (p > peakP) { peakP = p; peakK = k; }
  }
  check("功率谱确实先升后降（有转折）", peakK > kf / 30 && peakK < kf * 30, `峰在 k=${peakK.toFixed(2)}`);
  const lamMpc = num("boxMpc") / (peakK / kf);
  check("转折波长≈307 Mpc/h（物质–辐射相等的尺度）", Math.abs(lamMpc - 307) < 25,
    `实测 ${lamMpc.toFixed(0)} Mpc/h`);
  check("转折在盒子之外，正文必须说明", lamMpc > num("boxMpc"),
    `转折 ${lamMpc.toFixed(0)} vs 盒子 ${num("boxMpc")}`);
  check("图表把理论曲线画得比盒子宽", /k0\s*=\s*kf\s*\/\s*16/.test(html),
    "drawPk 只画了盒子范围，读者会以为谱单调下降");
}

/* ── 4. FFT 正确性：往返必须还原 ── */
{
  const N = 16, N3 = N * N * N;
  const re = new Float64Array(N3), im = new Float64Array(N3);
  let s = 1234567;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 - 0.5; };
  for (let i = 0; i < N3; i++) re[i] = rnd();
  const orig = Float64Array.from(re);
  M.fft3(re, im, N, false);
  M.fft3(re, im, N, true);
  let worst = 0;
  for (let i = 0; i < N3; i++) worst = Math.max(worst, Math.abs(re[i] - orig[i]), Math.abs(im[i]));
  check("FFT 正反变换还原", worst < 1e-12, `最大偏差 ${worst.toExponential(2)}`);
}

/* ── 5. 生成的高斯场，功率谱形状要对 ──
   量网格上的 deltaIC（不经过 CIC），残余离散来自模式计数（宇宙方差）。 */
{
  COS.N = 32; COS.om = num("om"); COS.ns = num("ns"); COS.gamma = num("gamma"); COS.sigma0 = 0.02;
  M.cosInit();
  const N = COS.N, N3 = N * N * N;
  const re = Float64Array.from(COS.deltaIC), im = new Float64Array(N3);
  M.fft3(re, im, N, false);
  const kf = 2 * Math.PI, kv = new Float64Array(N);
  for (let j = 0; j < N; j++) kv[j] = kf * (j <= N / 2 ? j : j - N);
  const nb = 9, kmax = kf * N / 2;
  const sum = new Float64Array(nb), cnt = new Float64Array(nb), kc = new Float64Array(nb);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (z * N + y) * N + x, k = Math.hypot(kv[x], kv[y], kv[z]);
    if (k <= 0 || k > kmax) continue;
    const b = Math.min(nb - 1, Math.floor(nb * Math.log(k / kf) / Math.log(kmax / kf)));
    if (b < 0) continue;
    sum[b] += (re[i] * re[i] + im[i] * im[i]) / (N3 * N3); cnt[b]++; kc[b] += k;
  }
  const ratios = [];
  for (let b = 0; b < nb; b++) if (cnt[b] > 8) {
    const k = kc[b] / cnt[b], p = sum[b] / cnt[b], t = M.powerSpec(k, COS.ns, COS.gamma);
    if (t > 0) ratios.push(p / t);
  }
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const dev = Math.sqrt(ratios.reduce((a, r) => a + (r / mean - 1) ** 2, 0) / ratios.length);
  check("初条件的功率谱形状与理论一致", dev < 0.15,
    `逐档比值的相对离散 ${(dev * 100).toFixed(1)}%（应为模式计数噪声量级）`);
  console.log("初条件谱:", JSON.stringify({ 档数: ratios.length, 离散: (dev * 100).toFixed(1) + "%" }));
}

/* ── 6. 线性区的增长必须跟住 D(a) ──
   这是整篇文章第 4 章那张图在声称的事。 */
{
  /* 幅度故意取小，保证全程留在线性区 —— 这一节验的是线性理论对不对 */
  COS.N = 32; COS.om = num("om"); COS.ns = num("ns"); COS.gamma = num("gamma");
  COS.sigma0 = 0.002; COS.aInit = num("aInit");
  M.cosInit();
  const R = 4 / COS.N;
  M.cosDeposit();
  const s0 = M.sigmaR(R), D0 = M.growth(COS.aInit, COS.om);
  const nstep = 100, dlna = Math.log(1 / COS.aInit) / nstep;
  for (let i = 0; i < nstep; i++) M.cosStep(dlna);
  M.cosDeposit();
  const meas = M.sigmaR(R) / s0, th = M.growth(1, COS.om) / D0;
  const err = (meas / th - 1) * 100;
  check("线性增长跟住 D(a)（5% 以内）", Math.abs(err) < 5,
    `实测 ×${meas.toFixed(2)}，理论 ×${th.toFixed(2)}，差 ${err.toFixed(2)}%`);
  check("确实放大了几十倍", meas > 25, `只放大了 ${meas.toFixed(1)} 倍`);
  console.log("线性增长:", JSON.stringify({ 实测: +meas.toFixed(2), 理论: +th.toFixed(2),
    偏差: err.toFixed(2) + "%" }));
}

/* ── 7. 形态学：正文引用的那几个数 ──
   第 6 章声称「空洞约占 51% 的体积，最密 10% 的格子装了约 54% 的质量」。 */
{
  /* 这一节必须用页面自己的 σ₀ —— 写死成别的值就等于测了一个线上不存在的配置 */
  COS.N = 32; COS.om = num("om"); COS.ns = num("ns");
  COS.gamma = num("gamma"); COS.sigma0 = num("sigma0"); COS.aInit = num("aInit");
  M.cosInit();
  M.cosDeposit(); const m0 = M.measureMorph();
  check("初态几乎均匀：最密 10% 只装约 10% 的质量", Math.abs(m0.top10 - 0.1) < 0.02,
    `初态 ${(m0.top10 * 100).toFixed(1)}%`);
  check("初态没有空洞", m0.voids < 0.01, `${(m0.voids * 100).toFixed(1)}%`);
  const nstep = 100, dlna = Math.log(1 / COS.aInit) / nstep;
  for (let i = 0; i < nstep; i++) M.cosStep(dlna);
  M.cosDeposit(); const m1 = M.measureMorph();
  check("正文引用值：空洞约占 51% 体积", Math.abs(m1.voids - 0.51) < 0.06,
    `实测 ${(m1.voids * 100).toFixed(1)}%`);
  check("正文引用值：最密 10% 格子装约 53% 质量", Math.abs(m1.top10 - 0.53) < 0.06,
    `实测 ${(m1.top10 * 100).toFixed(1)}%`);
  check("确实进入了非线性（δ 远大于 1）", m1.max > 50, `最大 δ = ${m1.max.toFixed(1)}`);
  /* σ(3格) 在 a=1 时应当落在真实宇宙那个量级上 —— 这是 σ₀ 定标的依据 */
  M.cosDeposit();
  const s3 = M.sigmaR(3 / COS.N);
  check("a=1 时 σ(3格) 在真实量级（0.3–0.6）", s3 > 0.3 && s3 < 0.6, `实测 ${s3.toFixed(3)}`);
  console.log("形态:", JSON.stringify({ 空洞: (m1.voids * 100).toFixed(1) + "%",
    最密10占质量: (m1.top10 * 100).toFixed(1) + "%", 最大δ: +m1.max.toFixed(0) }));
}

/* ── 8. 参数确实会改变结果 ──
   第 7 章的整个互动前提是「改 Ω_m，网会变」。要是不变，那一章就是假的。 */
{
  const run = (om) => {
    COS.N = 32; COS.om = om; COS.ns = num("ns");
    COS.gamma = num("gamma"); COS.sigma0 = num("sigma0"); COS.aInit = num("aInit");
    M.cosInit();
    const dlna = Math.log(1 / COS.aInit) / 60;
    for (let i = 0; i < 60; i++) M.cosStep(dlna);
    M.cosDeposit();
    return M.measureMorph();
  };
  const lo = run(0.15), hi = run(0.8);
  check("Ω_m 越大结构长得越结实", hi.top10 > lo.top10 + 0.05,
    `Ω_m=0.15 → ${(lo.top10 * 100).toFixed(1)}%，Ω_m=0.8 → ${(hi.top10 * 100).toFixed(1)}%`);
  console.log("Ω_m 的影响:", JSON.stringify({
    "Ωm=0.15": (lo.top10 * 100).toFixed(1) + "%", "Ωm=0.8": (hi.top10 * 100).toFixed(1) + "%" }));
  COS.om = 0.31;
}

/* ── 10. 渲染的两条视觉契约 ──
   这两条都在浏览器里实测踩过：
   ① 位置不回卷 → 粒子飘出盒子边框，周期结构看起来是断的；
   ② 色标按密度线性走 → 粒子是按质量采样的，一半质量在最密的 10% 格子里，
      于是三分之一的点顶到最亮档，网糊成一片亮云。 */
{
  check("渲染时把位置回卷进盒子", /X-=Math\.floor\(X\);Y-=Math\.floor\(Y\);Z-=Math\.floor\(Z\);/.test(html),
    "cosRender 没有回卷，粒子会飘出盒子");

  const densT = new Function("clamp", grab("densT") + "; return densT;")(clamp);
  /* 空洞要真的暗，节点才亮到顶 */
  check("空洞映射到暗端", densT(-0.5) < 0.15, `δ=−0.5 → ${densT(-0.5).toFixed(3)}`);
  check("平均密度处不到一半亮度", densT(0) < 0.30, `δ=0 → ${densT(0).toFixed(3)}`);
  check("只有很密的地方才顶到最亮", densT(20) < 0.85 && densT(150) > 0.9,
    `δ=20 → ${densT(20).toFixed(2)}，δ=150 → ${densT(150).toFixed(2)}`);
  check("色标单调", densT(-0.5) < densT(0) && densT(0) < densT(5) && densT(5) < densT(50), "densT 不单调");

  /* 拿真实的 a=1 状态过一遍色标，检查亮度分布没有饱和 */
  COS.N = 32; COS.om = num("om"); COS.ns = num("ns");
  COS.gamma = num("gamma"); COS.sigma0 = num("sigma0"); COS.aInit = num("aInit");
  M.cosInit();
  const dlna = Math.log(1 / COS.aInit) / 100;
  for (let i = 0; i < 100; i++) M.cosStep(dlna);
  M.cosDeposit();
  const N = COS.N, N3 = N * N * N, hist = new Array(10).fill(0);
  /* 用格子密度按质量加权，近似粒子的亮度分布 */
  let tot = 0;
  for (let i = 0; i < N3; i++) {
    const d = COS.dre[i], w = Math.max(0, 1 + d);
    hist[Math.min(9, Math.floor(densT(d) * 10))] += w; tot += w;
  }
  const pct = hist.map((v) => v / tot * 100);
  check("最亮档不超过 12%（否则网糊成一片亮云）", pct[9] < 12, `最亮档 ${pct[9].toFixed(1)}%`);
  check("暗档要占相当比例（空洞得看得见）", pct[0] + pct[1] + pct[2] > 15,
    `前三档合计 ${(pct[0] + pct[1] + pct[2]).toFixed(1)}%`);
  console.log("亮度分布:", JSON.stringify(pct.map((v) => +v.toFixed(1))));
}

/* ── 9. 结构契约（与其余各篇同一套约定） ── */
{
  const bodies = [...html.matchAll(/\{id:'(\w+)',t:'[^']*',\s*\n?\s*b:`([\s\S]*?)`,\s*(?:\/\*[\s\S]*?\*\/\s*)?en\(\)/g)];
  check("能解析出全部章节", bodies.length === 8, `解析到 ${bodies.length} 章`);
  const want = ["seed", "spectrum", "amplitude", "gravity", "collapse", "web", "cosmology", "evidence"];
  check("章节 id 齐全且顺序正确", JSON.stringify(bodies.map((m) => m[1])) === JSON.stringify(want),
    JSON.stringify(bodies.map((m) => m[1])));
  const noLede = bodies.filter((m) => !m[2].includes('class="lede"')).map((m) => m[1]);
  check("每章都有一句话导语", noLede.length === 0, `缺导语：${noLede.join(", ")}`);
  const tooLong = bodies.filter((m) => {
    const l = (m[2].match(/class="lede">([\s\S]*?)<\/p>/) || [, ""])[1].replace(/<[^>]+>/g, "");
    return l.length > 90;
  }).map((m) => m[1]);
  check("导语保持在一句话以内", tooLong.length === 0, `过长：${tooLong.join(", ")}`);
  const deep = bodies.filter((m) => m[2].includes('details class="deep"')).length;
  check("重推导收进了可展开块", deep >= 4, `只有 ${deep} 章有 details.deep`);

  /* 图表卡片：标题必须是大白话问句，且要说明怎么读 */
  const cards = [...html.matchAll(/<section class="ckd" data-chart="(\w+)"[^>]*>\s*<h4>([^<]+)<\/h4>\s*<p class="ckd-how">([^<]+)</g)];
  check("每张图都是带标题的卡片", cards.length === 3, `解析到 ${cards.length} 张`);
  check("图表标题都是问句", cards.every((c) => /[？?]/.test(c[2])),
    cards.map((c) => c[2]).join(" / "));
  check("图表标题里不出现公式", !cards.some((c) => /P\(k\)|δ|σ|<sub>|∝/.test(c[2])),
    cards.map((c) => c[2]).join(" / "));
  check("每张图都说明了怎么读", cards.every((c) => /横轴|上：/.test(c[3])), "有图没说明怎么读");

  /* 一章最多两张图 */
  const cm = html.match(/const CHARTS=\{([\s\S]*?)\n\};/);
  check("CHARTS 映射存在", !!cm, "找不到 CHARTS");
  if (cm) {
    const fat = [...cm[1].matchAll(/(\w+):\[([^\]]*)\]/g)]
      .filter((g) => g[2] && g[2].split(",").length > 2).map((g) => g[1]);
    check("一章最多两张图", fat.length === 0, `过多：${fat.join(", ")}`);
  }

  /* 边界必须写在文章里，不能只在代码注释里 */
  const text = html.replace(/<[^>]+>/g, "");
  check("交代了没有重子 / 气体 / 恒星形成", /没有重子/.test(text), "没说清模拟省掉了什么");
  check("交代了分辨率的限制", /32³|分辨率/.test(text), "没说清分辨率能看出什么、看不出什么");
  check("交代了起始幅度不是 10⁻⁵ 而是线性外推来的",
    /线性理论/.test(text) && /0\.055|起始/.test(text), "没交代初始幅度是怎么来的");
  console.log("结构:", JSON.stringify({ 章数: bodies.length, 带折叠块: deep, 图表卡片: cards.length }));
}

if (fail.length) {
  console.error(JSON.stringify({ ok: false, failed: fail }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true,
  checks: "growth D(a), f≈Ωm^0.55, BBKS limits, FFT roundtrip, IC spectrum, linear growth, morphology, Ωm sensitivity, structure" }));
