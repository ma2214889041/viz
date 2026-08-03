/* 挂谷篇的几何自检：把页面里跑的构造抽出来验，不依赖浏览器。
   验的是正文声称的每一条可测量结论。 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(join(root, "kakeya/index.html"), "utf8");

const grab = (name) => {
  const start = html.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`找不到 ${name}`);
  let depth = 0, i = html.indexOf("{", start), began = false;
  for (; i < html.length; i++) {
    if (html[i] === "{") { depth++; began = true; }
    else if (html[i] === "}") { depth--; if (began && depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`${name} 括号不闭合`);
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/* 页面里的常量 */
const GREEDY = JSON.parse(html.match(/const GREEDY=(\[[^\]]+\])/)[1]);
const MAXD = +html.match(/const MAXD=(\d+)/)[1];
const CAP = +html.match(/const CAP=(\d+)/)[1];
const BUSH_M = +html.match(/const BUSH_M=(\d+)/)[1];
const BRUSH_M = +html.match(/BRUSH_M=(\d+)/)[1];
const KAKdelta = +html.match(/delta:([\d.]+)/)[1];

const KAK = { delta: KAKdelta };
let STICKY = false; const STICKY_A = 2 / 3;

const src = [grab("buildTris"), grab("sliceLen"), grab("volume"), grab("areaOf"),
             grab("bushTubes"), grab("bushMeasure"), grab("bushVolume")].join("\n");
const make = new Function("clamp", "lerp", "rng", "GREEDY", "MAXD", "CAP", "KAK", "getSticky", `
  const shiftAt=k=>getSticky()?${STICKY_A}:GREEDY[k];
  const _lo=new Float64Array(CAP),_hi=new Float64Array(CAP),_ix=new Int32Array(CAP);
  const _cmp=(p,q)=>_lo[p]-_lo[q];
  const autoS=n=>n>1400?50:n>600?80:150;
  ${src}
  return {buildTris,volume,areaOf,bushVolume,bushMeasure,bushTubes,sliceLen};
`);
const M = make(clamp, lerp, rng, GREEDY, MAXD, CAP, KAK, () => STICKY);

const fail = [];
const check = (name, cond, detail) => { if (!cond) fail.push(`${name}: ${detail}`); return cond; };

/* ── 1. Perron 树：体积随层数单调下降，且趋于 0 ── */
{
  const vols = [];
  for (let d = 0; d <= 10; d++) vols.push(M.volume(M.buildTris(d), 0, 300));
  let mono = true;
  for (let i = 1; i < vols.length; i++) if (vols[i] > vols[i - 1] + 1e-6) mono = false;
  check("体积随层数单调下降", mono, JSON.stringify(vols.map(v => +v.toFixed(4))));
  check("起点是扇束的 1/3", Math.abs(vols[0] - 1 / 3) < 0.01, `${vols[0].toFixed(4)}`);
  // 正文第 6 章声称 10 层之后只剩最初的 3.5%
  const pct = vols[10] / vols[0] * 100;
  check("10 层剩约 3.5%（正文引用值）", Math.abs(pct - 3.5) < 1.5, `实测 ${pct.toFixed(2)}%`);
}

/* ── 2. 正文第 6 章：下降「越走越平」，即 log V 对层数的斜率在变缓 ── */
{
  const v = [];
  for (let d = 0; d <= 10; d++) v.push(M.volume(M.buildTris(d), 0, 300));
  const drops = [];
  for (let i = 1; i < v.length; i++) drops.push(Math.log(v[i - 1] / v[i]));
  const early = (drops[0] + drops[1] + drops[2]) / 3;
  const late = (drops[7] + drops[8] + drops[9]) / 3;
  check("下降越走越平", late < early, `前三层 ${early.toFixed(3)} → 后三层 ${late.toFixed(3)}`);
}

/* ── 3. 自相似（黏性）：体积停在正数上不动，维数被顶满 ── */
{
  STICKY = false;
  const free = []; for (let d = 0; d <= 10; d++) free.push(M.volume(M.buildTris(d), 0, 300));
  STICKY = true;
  const st = []; for (let d = 0; d <= 10; d++) st.push(M.volume(M.buildTris(d), 0, 300));
  STICKY = false;
  // 正文第 13 章：8 层之后冻在 0.037 附近，而非黏性会掉到 0.008
  const tail = st.slice(8);
  const flat = Math.max(...tail) - Math.min(...tail);
  check("黏性下体积冻结", flat < 0.004, `8–10 层区间跨度 ${flat.toFixed(5)}`);
  check("黏性冻结值 ≈ 0.037（正文引用值）", Math.abs(st[10] - 0.037) < 0.008, `实测 ${st[10].toFixed(4)}`);
  check("非黏性 10 层 ≈ 0.008（正文引用值）", Math.abs(free[10] - 0.008) < 0.004, `实测 ${free[10].toFixed(4)}`);
  check("黏性体积明显大于非黏性", st[10] > free[10] * 2, `${st[10].toFixed(4)} vs ${free[10].toFixed(4)}`);
}

/* ── 4. 离散化标度：δ 与方向密度同步细化，测得的维数应趋近 3 ── */
{
  const pts = [];
  for (let n = 1; n <= 11; n++) {
    const d = 0.4 * Math.pow(2, -n);
    pts.push([d, M.volume(M.buildTris(n), d, 400)]);
  }
  const dims = [];
  for (let i = 1; i < pts.length; i++) dims.push(3 - Math.log2(pts[i - 1][1] / pts[i][1]));
  const last = dims[dims.length - 1];
  // 正文第 14 章：从 1.90 升到 2.89
  check("维数从 ~1.9 起步", Math.abs(dims[0] - 1.90) < 0.25, `${dims[0].toFixed(2)}`);
  check("最细一档维数 ≈ 2.89（正文引用值）", Math.abs(last - 2.89) < 0.12, `实测 ${last.toFixed(2)}`);
  check("维数整体趋向 3", last > dims[0] + 0.6 && last < 3.02, JSON.stringify(dims.map(d => +d.toFixed(2))));
}

/* ── 5. 黏性构型的维数被顶到 3.00 ── */
{
  STICKY = true;
  const pts = [];
  for (let n = 1; n <= 11; n++) {
    const d = 0.4 * Math.pow(2, -n);
    pts.push([d, M.volume(M.buildTris(n), d, 400)]);
  }
  STICKY = false;
  const last = 3 - Math.log2(pts[pts.length - 2][1] / pts[pts.length - 1][1]);
  check("黏性下维数顶到 3.00（正文引用值）", Math.abs(last - 3.0) < 0.06, `实测 ${last.toFixed(2)}`);
}

/* ── 6. 三角形数：每层翻倍，且不超过缓冲上限 ── */
{
  for (let d = 0; d <= MAXD; d++) {
    const n = M.buildTris(d).length;
    check(`第 ${d} 层三角形数 = 2^${d}`, n === Math.pow(2, Math.min(d, MAXD)), `${n}`);
    check(`第 ${d} 层不超过 CAP`, n <= CAP, `${n} > ${CAP}`);
  }
}

/* ── 7. 灌木 vs 毛刷 ──
   正文第 11 章的核心主张不是体积，而是**峰值重叠重数**：
   灌木恰好等于 M（全堆在公共交点），毛刷约为 M·δ（沿柄摊开）。
   这个 1/δ 的差距就是下界 2 → 2.5 的来源。 */
{
  const b = M.bushMeasure("bush", BUSH_M, 150000);
  const h = M.bushMeasure("brush", BRUSH_M, 150000);
  check("灌木峰值重数恰为 M", b.maxMult === BUSH_M, `实测 ${b.maxMult}，M=${BUSH_M}`);
  check("毛刷峰值重数远低于 M", h.maxMult < BUSH_M * 0.25,
    `毛刷 ${h.maxMult} vs 灌木 ${b.maxMult}`);
  // 毛刷的峰值应当是 M·δ 的量级（这一族构型里实测约 1.4 倍）
  const pred = BRUSH_M * KAK.delta;
  check("毛刷峰值 ~ M·δ 量级", h.maxMult > pred * 0.7 && h.maxMult < pred * 2.4,
    `实测 ${h.maxMult}，M·δ = ${pred.toFixed(1)}`);
  check("两者并集体积量级相当（差别不在体积）", Math.abs(h.vol / b.vol - 1) < 0.6,
    `灌木 ${b.vol.toFixed(4)}，毛刷 ${h.vol.toFixed(4)}`);
  // 单根管体积 ≈ π(δ/2)²·1
  const one = Math.PI * Math.pow(KAK.delta / 2, 2);
  check("并集不超过 M 根管之和", h.vol <= one * (BRUSH_M + 1) * 1.05,
    `${h.vol.toFixed(5)} vs 上界 ${(one * (BRUSH_M + 1)).toFixed(5)}`);

  /* 正文列了四组 (δ, M) 的实测重数，逐个核对 */
  const table = [[0.09, 60, 60, 9], [0.055, 160, 160, 13], [0.035, 400, 400, 19], [0.022, 900, 900, 26]];
  const measured = [];
  for (const [d, m, wantB, wantH] of table) {
    KAK.delta = d;
    const mb = M.bushMeasure("bush", m, 60000), mh = M.bushMeasure("brush", m, 60000);
    measured.push({ delta: d, M: m, bush: mb.maxMult, brush: mh.maxMult });
    check(`正文表格 δ=${d} 灌木重数`, mb.maxMult === wantB, `声称 ${wantB}，实测 ${mb.maxMult}`);
    check(`正文表格 δ=${d} 毛刷重数`, Math.abs(mh.maxMult - wantH) <= 2, `声称 ${wantH}，实测 ${mh.maxMult}`);
  }
  KAK.delta = KAKdelta;
  console.log("bush/brush 峰值重数:", JSON.stringify(measured));
}

/* ── 7b. 分层阅读的结构契约（与玻尔兹曼篇同一套约定） ── */
{
  const bodies = [...html.matchAll(/\{id:'(\w+)',t:'[^']*',\s*\n?\s*b:`([\s\S]*?)`,\s*(?:\/\*[\s\S]*?\*\/\s*)?en\(\)/g)];
  check("能解析出全部章节正文", bodies.length === 15, `解析到 ${bodies.length} 章`);
  const noLede = bodies.filter(m => !m[2].includes('class="lede"')).map(m => m[1]);
  check("每章都有一句话导语", noLede.length === 0, `缺导语：${noLede.join(", ")}`);
  const tooLong = bodies.filter(m => {
    const lede = (m[2].match(/class="lede">([\s\S]*?)<\/p>/) || [, ""])[1].replace(/<[^>]+>/g, "");
    return lede.length > 90;
  }).map(m => m[1]);
  check("导语保持在一句话以内（≤90 字）", tooLong.length === 0, `过长：${tooLong.join(", ")}`);
  const deep = bodies.filter(m => m[2].includes('details class="deep"')).length;
  check("重推导收进了可展开块", deep >= 4, `只有 ${deep} 章有 details.deep`);
  /* 正文长度的爬坡：前八章是入门段，不该出现 800 字以上的大块 */
  const early = bodies.slice(0, 8).map(m => ({ id: m[1], n: m[2].replace(/<[^>]+>/g, "").length }));
  const fat = early.filter(e => e.n > 800).map(e => `${e.id}(${e.n})`);
  check("入门八章保持轻量", fat.length === 0, `过重：${fat.join(", ")}`);
  console.log("分层阅读:", JSON.stringify({ chapters: bodies.length, withDeep: deep,
    early: early.map(e => e.n) }));
}

/* ── 7b2. 图表面板的可读性（与玻尔兹曼篇同一套约定） ──
   用户看着右栏问「这几个图像分别是什么」，说明图注失职。约定是：
   每张图自带一个大白话问句标题 + 一行「怎么读」，标题里不出现公式，
   图上方不许再挂活公式，且一章最多两张。 */
{
  const cards = [...html.matchAll(/<section class="ckd" data-chart="(\w+)"[^>]*>\s*<h4>([^<]+)<\/h4>\s*<p class="ckd-how">([^<]+)</g)];
  check("每张图都是一张带标题的卡片", cards.length === 2, `解析到 ${cards.length} 张`);
  const noQ = cards.filter(c => !/[？?]/.test(c[2])).map(c => c[1]);
  check("图表标题写成一个问句", noQ.length === 0, `不是问句：${noQ.join(", ")}`);
  const hasFml = cards.filter(c => /δ|N\(|log|<sub>|≈/.test(c[2])).map(c => c[1]);
  check("图表标题里不出现公式", hasFml.length === 0, `含公式：${hasFml.join(", ")}`);
  const noHow = cards.filter(c => !/横轴|纵轴/.test(c[3])).map(c => c[1]);
  check("每张图都说明了怎么读", noHow.length === 0, `没说明：${noHow.join(", ")}`);
  check("图表上方的公式墙已移除", !html.includes("liveeq") && !html.includes("updateLiveK"),
    "liveeq / updateLiveK 仍在");
  check("旧的一行式图注已移除", !html.includes("chartcap"), "chartcap 仍在");

  const m = html.match(/const CHARTS=\{([\s\S]*?)\n\};/);
  check("CHARTS 映射存在", !!m, "找不到 CHARTS");
  if (m) {
    const map = {};
    for (const line of m[1].split("\n")) {
      const g = line.match(/(\w+):\[([^\]]*)\]/);
      if (g) map[g[1]] = g[2] ? g[2].split(",").map(s => s.trim().replace(/'/g, "")) : [];
    }
    const fat = Object.entries(map).filter(([, v]) => v.length > 2).map(([k]) => k);
    check("一章最多两张图", fat.length === 0, `过多：${fat.join(", ")}`);
    const known = new Set(cards.map(c => c[1]));
    const unknown = Object.values(map).flat().filter(k => !known.has(k));
    check("引用的图都真实存在", unknown.length === 0, `未知图表：${unknown.join(", ")}`);
    const ids = [...html.matchAll(/\{id:'(\w+)',t:'/g)].map(x => x[1]);
    const stray = Object.keys(map).filter(k => !ids.includes(k));
    check("CHARTS 的键都是真章节", stray.length === 0, `不存在的章节：${stray.join(", ")}`);
    /* 前八章是「看针怎么转」的入门段，摆维数图只会分散注意力 */
    const early = ids.slice(0, 8).filter(id => (map[id] || []).length);
    check("入门八章不摆图表", early.length === 0, `过早出图：${early.join(", ")}`);
    console.log("每章图表:", JSON.stringify(map));
  }
  console.log("图表卡片:", JSON.stringify(cards.map(c => `${c[1]}｜${c[2]}`)));
}

/* ── 7c. 盒子尺寸换章要复位 ──
   有一章会把 cellSize 动画着缩下去；不复位就会污染后面的章节，
   挂谷篇在灌木/毛刷上已经吃过一次这种亏。 */
{
  check("gotoStep 复位 cellSize", /KAK\.cfg='';KAK\.bush=0;KAK\.brush=0;cellSize=/.test(html),
    "换章时没把 cellSize 复位");
  check("动画改的是 cellSize 而不是 KAK.delta", !/to\(KAK,'delta'/.test(html),
    "动画在改 KAK.delta，会污染灌木/毛刷的实测");
}

/* ── 先猜一下：结构契约 ──
   直觉是「押一次、发现自己对不对」建立起来的，不是读出来的。
   每个 predict 必须恰好有一个正确项，每个选项都要带解释——
   押错的人拿不到解释，这个组件就白做了。 */
{
  const blocks = [...html.matchAll(/<div class="predict">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  check("正文里有「先猜一下」环节", blocks.length >= 1, `只有 ${blocks.length} 处`);
  blocks.forEach((b, i) => {
    const picks = [...b.matchAll(/data-pick/g)].length;
    const right = [...b.matchAll(/data-right/g)].length;
    const why = [...b.matchAll(/data-why="/g)].length;
    check(`第 ${i + 1} 个预测有 2–4 个选项`, picks >= 2 && picks <= 4, `${picks} 个`);
    check(`第 ${i + 1} 个预测恰有一个正确项`, right === 1, `${right} 个 data-right`);
    check(`第 ${i + 1} 个预测每个选项都带解释`, why === picks, `${why} 条解释 / ${picks} 个选项`);
    check(`第 ${i + 1} 个预测有问句`, /class="pq">[\s\S]*?[？?][\s\S]*?<\/p>/.test(b), "问题不是问句");
  });
  console.log("先猜一下:", blocks.length + " 处");
}

/* ── 8. 章节结构 ── */
{
  const ids = [...html.matchAll(/\{id:'([a-zA-Z0-9]+)',t:'/g)].map(m => m[1]);
  const want = ["spin","kakeya1917","translate","oneslide","perron","pushdown","dirskept",
                "assemble","dimension","dimtrap","tubes","lowerbounds","crimescene","sticky","wangzahl"];
  check("章节 id 齐全且顺序正确", JSON.stringify(ids) === JSON.stringify(want), JSON.stringify(ids));
  const badIdx = [...html.matchAll(/si===(\d+)/g)].map(m => m[1]).filter(d => d !== "0");
  check("章节内容不再按序号硬编码", badIdx.length === 0, `仍存在 si===${badIdx.join(", si===")}`);
  check("方位词已清除", !/右侧按|右下角那张|右边那个球/.test(html), "正文仍有方位词");
}

if (fail.length) {
  console.error(JSON.stringify({ ok: false, failed: fail }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "Perron volume, flattening, sticky freeze, discretised scaling, sticky dim, triangle counts, bush vs hairbrush, chapter ids" }));
