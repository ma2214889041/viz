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

/* ── 8. 章节结构 ── */
{
  const ids = [...html.matchAll(/\{id:'([a-zA-Z0-9]+)',t:'/g)].map(m => m[1]);
  const want = ["spin","kakeya1917","translate","oneslide","perron","pushdown","dirskept",
                "assemble","dimension","tubes","lowerbounds","crimescene","sticky","wangzahl"];
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
