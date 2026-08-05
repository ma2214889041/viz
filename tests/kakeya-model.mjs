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
  /* 正文以前写的是 0.008 —— 那是 12 层的值，而层数滑块最多只到 10。
     读者把滑块拉满看到的是 0.012，跟正文对不上。现在正文改成 0.012。 */
  check("非黏性 10 层 ≈ 0.012（正文引用值）", Math.abs(free[10] - 0.012) < 0.003, `实测 ${free[10].toFixed(4)}`);
  check("层数滑块拉满就是 10 层", /id="s_depth"[^>]*max="10"/.test(html), "s_depth 的 max 不是 10");
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
  const last = dims[dims.length - 1], top = Math.max(...dims);
  /* 正文第 15 章：从 1.90 抬到 2.84，中途最高到过 2.89。
     以前写的是「升到 2.89」—— 而图上最后一档标的是 2.84，2.89 是中途的峰值。
     读者照着图核对就会发现对不上，所以两个数现在都写出来。 */
  check("维数从 ~1.9 起步", Math.abs(dims[0] - 1.90) < 0.25, `${dims[0].toFixed(2)}`);
  check("最细一档维数 ≈ 2.84（正文引用值）", Math.abs(last - 2.84) < 0.06, `实测 ${last.toFixed(2)}`);
  check("中途峰值 ≈ 2.89（正文引用值）", Math.abs(top - 2.89) < 0.06, `实测 ${top.toFixed(2)}`);
  check("正文写的是最后一档而不是峰值", /抬到 <b class="k-dim">2\.84<\/b>（中途最高到过 2\.89）/.test(html),
    "正文没有同时写出末档值与峰值");
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

/* ── 7a. 12 个方向锥：正交、恰好覆盖一次，以及那张平面罗盘的投影是等面积的 ──
   README 一直声称「6 万个随机方向实测覆盖率 100%，12 个变换矩阵严格正交」，
   但这一条从来没进过测试套件。而第 8 章正文就指着它说「一个方向都不漏」。
   平面罗盘更需要这一条：它整张图的读法是「填掉多少比例＝覆盖多少方向」，
   而这句话只有在投影确实等面积时才成立。 */
{
  const CONES = new Function(
    `${html.slice(html.indexOf("const CONES=(()"), html.indexOf("let TRIS="))}; return CONES;`)();
  check("锥数是 12", CONES.length === 12, `${CONES.length} 个`);
  let orth = 0;
  for (const m of CONES) {
    const col = (c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      const [ax, ay, az] = col(a), [bx, by, bz] = col(b);
      orth = Math.max(orth, Math.abs(ax * bx + ay * by + az * bz - (a === b ? 1 : 0)));
    }
  }
  check("12 个变换严格正交（正文引用值）", orth < 1e-6, `最大偏差 ${orth.toExponential(2)}`);
  /* 成员测试与页面里 dirCoverage() 用的是同一条：Mᵀd 归一化后落在 {(a,1,b)} 里 */
  const inCone = (m, dx, dy, dz) => {
    const wx = m[0] * dx + m[1] * dy + m[2] * dz;
    const wy = m[4] * dx + m[5] * dy + m[6] * dz;
    const wz = m[8] * dx + m[9] * dy + m[10] * dz;
    const s = wy < 0 ? -1 : 1, y = wy * s;
    if (y <= 1e-12) return false;
    const a = wx * s / y, b = wz * s / y;
    return a >= 0 && a <= 1 && b >= 0 && b <= 1;
  };
  const R = rng(20260805);
  const dirs = [];
  for (let i = 0; i < 60000; i++) {
    const u = 2 * R() - 1, ph = 2 * Math.PI * R(), s = Math.sqrt(Math.max(0, 1 - u * u));
    dirs.push([s * Math.cos(ph), u, s * Math.sin(ph)]);
  }
  let hit = 0, multi = 0, none = 0;
  for (const d of dirs) {
    let c = 0;
    for (const m of CONES) if (inCone(m, d[0], d[1], d[2])) c++;
    if (c > 0) hit++; if (c > 1) multi++; if (c === 0) none++;
  }
  check("6 万个随机方向覆盖率 100%（正文引用值）", none === 0, `漏了 ${none} 个`);
  /* 比正文原来那句「一个方向都不漏」更强：实测是恰好一次，也就是一个划分 */
  check("每个方向恰好被一个锥覆盖一次", multi === 0, `有 ${multi} 个被多个锥同时覆盖`);
  check("正文写出了「恰好一次」而不只是「不漏」", /恰好被一个锥覆盖一次/.test(html),
    "正文没有用上这个更强的实测结论");
  /* 平面罗盘：兰伯特方位等面积把半球摊成单位圆盘，且面积成比例 */
  const disc = (d) => {
    const s = d[1] < 0 ? -1 : 1, y = d[1] * s, k = Math.sqrt(1 / (1 + y));
    return [d[0] * s * k, d[2] * s * k];
  };
  let inUnit = 0, innerHalf = 0;
  for (const d of dirs) {
    const [a, b] = disc(d), rr = a * a + b * b;
    if (rr <= 1 + 1e-6) inUnit++;
    if (rr <= 0.5) innerHalf++;
  }
  check("每个方向都落在单位圆盘内", inUnit === dirs.length, `只有 ${inUnit}/${dirs.length}`);
  check("投影确实等面积（半面积里应有约一半方向）",
    Math.abs(innerHalf / dirs.length - 0.5) < 0.01, `实测 ${(innerHalf / dirs.length * 100).toFixed(2)}%`);
  /* 页面里的投影与这里必须是同一条公式，否则「填多少＝覆盖多少」就不成立 */
  check("页面用的是同一条等面积公式", /Math\.sqrt\(1\/\(1\+d\[1\]\)\)/.test(html),
    "drawDirs 的投影不是 √(1/(1+y))");
  /* 第 7 章的全部论证是「层数一路拉满，这张图一个点都不动」。
     只要 getDirPts / drawDirs 碰过 tDepth，这句话就不成立了。 */
  check("方向清单与递归层数无关（第 7 章的全部论证）",
    !/tDepth/.test(grab("getDirPts")) && !/tDepth/.test(grab("drawDirs")),
    "getDirPts / drawDirs 引用了 tDepth —— 「一个点都不动」就成了空话");
  /* 页面自己那个 dirCoverage 必须和上面这套独立算法给出同一个答案 */
  const pageCov = new Function("CONES", "rng", `
    ${grab("dirCoverage")}
    let dirCov=-1,dirCovKey='';
    return dirCoverage;`)(CONES, rng);
  const c1 = pageCov(1), c12 = pageCov(12);
  check("页面测出 12 个锥覆盖 100%", c12 > 0.999, `实测 ${(c12 * 100).toFixed(2)}%`);
  check("单个锥约占十二分之一", Math.abs(c1 - 1 / 12) < 0.01, `实测 ${(c1 * 100).toFixed(2)}%`);
  console.log("方向锥:", JSON.stringify({ 锥数: CONES.length, 正交偏差: +orth.toFixed(12),
    覆盖率: +(hit / dirs.length * 100).toFixed(3), 重复覆盖: multi,
    圆盘内半面积占比: +(innerHalf / dirs.length * 100).toFixed(2) }));
}

/* ── 7b. 分层阅读的结构契约（与玻尔兹曼篇同一套约定） ── */
{
  /* 正文和 en() 之间可以夹注释，也可以夹 st:（这一章的画面主角）。
     以前这里只放过注释，加了 st: 之后正则会跨过一整章去匹配下一章的 en()，
     于是两章被并成一章、总数少三个 —— 而每一条检查看上去都还「通过」。
     所以这里把两种夹层都显式写出来。 */
  const bodies = [...html.matchAll(/\{id:'(\w+)',t:'[^']*',\s*\n?\s*b:`([\s\S]*?)`,\s*(?:(?:\/\*[\s\S]*?\*\/|st:[^\n]*)\s*)*en\(\)/g)];
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
  /* 正文长度的爬坡：前八章是入门段，不该出现 800 字以上的大块。
     量的必须是**屏幕上的可见文字**。`<[^>]+>` 这种粗暴的去标签在遇到
     data-why="…<b>3.5%</b>…" 时会在属性值里的第一个 > 处停下，把「先猜一下」
     的揭晓文案整段算成正文 —— perron 因此被记成 1025 字，实际只有 5 百多。
     揭晓文案是读者押注之后才出现的，不该算进「一进这章就要读多少」。 */
  const visibleText = (h) => h
    .replace(/<[a-zA-Z][^\s/>]*(?:\s+[a-zA-Z-]+(?:="[^"]*")?)*\s*\/?>/g, "")   // 开标签（含带尖括号的属性值）
    .replace(/<\/[a-zA-Z][^>]*>/g, "")                                          // 闭标签
    .replace(/\s+/g, "");
  const revealText = (h) => [...h.matchAll(/data-why="([^"]*)"/g)]
    .map(m => m[1]).join("").replace(/<[^>]+>/g, "").replace(/\s+/g, "").length;
  const early = bodies.slice(0, 8).map(m => ({ id: m[1], n: visibleText(m[2]).length, why: revealText(m[2]) }));
  const fat = early.filter(e => e.n > 800).map(e => `${e.id}(${e.n})`);
  check("入门八章保持轻量", fat.length === 0, `过重：${fat.join(", ")}`);
  /* 去标签必须真的把标签去干净：留下 data-why= 之类的碎片说明正则又漏了 */
  const leak = bodies.filter(m => /data-why|class=|<button|<span/.test(visibleText(m[2]))).map(m => m[1]);
  check("字数统计里没有混进标签碎片", leak.length === 0, `漏了标签的章节：${leak.join(", ")}`);
  console.log("分层阅读:", JSON.stringify({ chapters: bodies.length, withDeep: deep,
    early: early.map(e => e.n), 揭晓文案: early.map(e => e.why) }));
}

/* ── 章节互指：编号必须落在真正那一章上 ──
   「前面九章搭好了舞台」写在第 11 章上（前面其实有十章）—— 这类差一格的错
   靠肉眼校不出来，而重排章节时它一定会发生。所以把每一条互指钉成
   「第 N 章里必须出现某个关键词」，编号一错、关键词就对不上。 */
{
  const heads2 = [...html.matchAll(/\{id:'(\w+)',t:'/g)].map((m) => ({ id: m[1], at: m.index }));
  const bodyOf = (i) => {
    const slice = html.slice(heads2[i].at, i + 1 < heads2.length ? heads2[i + 1].at : html.length);
    const b = slice.match(/b:`([\s\S]*?)`,\s*(?:(?:\/\*[\s\S]*?\*\/|st:[^\n]*)\s*)*en\(\)/);
    return b ? b[1].replace(/<[^>]*>/g, "") : "";
  };
  const bodies2 = heads2.map((_, i) => bodyOf(i));
  const N = bodies2.length;
  /* 所有「第 N 章」都得存在 */
  const oob = [];
  bodies2.forEach((t, i) => {
    for (const m of t.matchAll(/第\s*(\d+)\s*章/g)) {
      const n = +m[1];
      if (n < 1 || n > N) oob.push(`第 ${i + 1} 章指向不存在的第 ${n} 章`);
    }
    for (const m of t.matchAll(/前面\s*([一二三四五六七八九十\d]+)\s*章/g)) {
      const map = { 一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10,十一:11,十二:12,十三:13,十四:14,十五:15 };
      const n = map[m[1]] !== undefined ? map[m[1]] : +m[1];
      if (n !== i) oob.push(`第 ${i + 1} 章写「前面${m[1]}章」，实际前面有 ${i} 章`);
    }
  });
  check("章节互指的编号都对得上", oob.length === 0, oob.join("；"));
  /* 逐条核对：引用的那一章里必须真的有那个东西 */
  const wants = [[6, "还剩下什么"], [9, "严格更强"]];
  const wrong = wants.filter(([n, kw]) => !(bodies2[n - 1] || "").includes(kw))
    .map(([n, kw]) => `第 ${n} 章里找不到「${kw}」`);
  check("互指指到的内容真的在那一章里", wrong.length === 0, wrong.join("；"));
}

/* ── 7b2. 图表面板的可读性（与玻尔兹曼篇同一套约定） ──
   用户看着右栏问「这几个图像分别是什么」，说明图注失职。约定是：
   每张图自带一个大白话问句标题 + 一行「怎么读」，标题里不出现公式，
   图上方不许再挂活公式，且一章最多两张。 */
{
  const cards = [...html.matchAll(/<section class="ckd" data-chart="(\w+)"[^>]*>\s*<h4>([^<]+)<\/h4>\s*<p class="ckd-how">([^<]+)</g)];
  check("每张图都是一张带标题的卡片", cards.length === 4, `解析到 ${cards.length} 张`);
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
    /* 前八章是「看针怎么转」的入门段。这条规则原本写成「一张图都不许出」，
       理由是「摆维数图只会分散注意力」—— 保护的其实是这个：δ→0 的标度图和
       维数柱状图属于后面的「换一把尺子」那一幕，提前摆出来就是在讲还没讲的东西。

       但第 6 章的原话是「曲线还在往下走，但你会注意到它越走越平」。它让读者去
       注意一条页面上并不存在的曲线 —— 那句话读者只能选择相信。所以规则收窄成：
       入门段不许出现标度图和维数图，但允许出现「这一章正在做的事」本身的曲线。 */
    const LATE = new Set(["vol", "dim"]);
    const early = ids.slice(0, 8).filter(id => (map[id] || []).some(k => LATE.has(k)));
    check("入门八章不摆标度图与维数图", early.length === 0, `过早出图：${early.join(", ")}`);
    console.log("每章图表:", JSON.stringify(map));
  }
  console.log("图表卡片:", JSON.stringify(cards.map(c => `${c[1]}｜${c[2]}`)));
}

/* ── 7b3. 舞台：画面主角必须真的存在 ──
   正文里写「画面中央那条曲线」是一句可以被证伪的话。如果这一章声明的主角
   不在它的 CHARTS 列表里，setStage 会静默退回三维 —— 于是正文指着一个
   空位说「看这里」。这条检查就是不许出现那种情况。 */
{
  const cards = new Set([...html.matchAll(/data-chart="(\w+)"/g)].map(m => m[1]));
  const m = html.match(/const CHARTS=\{([\s\S]*?)\n\};/);
  const map = {};
  if (m) for (const line of m[1].split("\n")) {
    const g = line.match(/(\w+):\[([^\]]*)\]/);
    if (g) map[g[1]] = g[2] ? g[2].split(",").map(s => s.trim().replace(/'/g, "")) : [];
  }
  /* st:'vol' 或 st:['3d','depth',4200]。
     必须按章切片再找 st: —— 用一条跨越整个 steps 数组的正则去 lazy 匹配，
     会把后面某一章的 st 记在前面一章头上（第一版就这么错过一次）。 */
  const heads = [...html.matchAll(/\{id:'(\w+)',t:'/g)].map(m => ({ id: m[1], at: m.index }));
  const stages = [];
  heads.forEach((h, i) => {
    const slice = html.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : html.length);
    const g = slice.match(/\n\s+st:(\[[^\]]*\]|'[^']*')/);
    if (g) stages.push({ id: h.id, raw: g[1] });
  });
  check("有章节声明了画面主角", stages.length >= 3, `只有 ${stages.length} 章`);
  const bad = [], rushed = [];
  for (const s of stages) {
    const keys = [...s.raw.matchAll(/'(\w+)'/g)].map(k => k[1]).filter(k => k !== "3d");
    for (const k of keys) {
      if (!cards.has(k)) bad.push(`${s.id}→${k}（没有这张图）`);
      else if (!(map[s.id] || []).includes(k)) bad.push(`${s.id}→${k}（不在本章 CHARTS 里）`);
    }
    /* ['3d', key, ms]：延迟太短会在读者还在读第一段时就把画面换掉 */
    const delay = +(s.raw.match(/,\s*(\d+)\s*\]/) || [, 0])[1];
    if (s.raw.startsWith("[") && delay < 3000) rushed.push(`${s.id}(${delay}ms)`);
  }
  check("声明的主角都真实存在且属于本章", bad.length === 0, bad.join("；"));
  check("自动换主角不早于 3 秒", rushed.length === 0, `太急：${rushed.join(", ")}`);
  check("舞台会在换章时重新指派", /applyStage\(s\)/.test(html), "gotoStep 没有调用 applyStage");
  check("离开演示会撤掉舞台", /setStage\('3d'\)[\s\S]{0,220}has-stagepick/.test(html),
    "setScene 的非演示分支没有收拾 staged / has-stagepick");
  check("图表尺寸问的是当前容器而不是写死的侧栏",
    !/function chartW\(\)/.test(html) && /function chartBox\(/.test(html),
    "chartW() 还在 —— 图上了舞台也不会变大");
  /* 正文里的看图按钮也必须指向本章真的有的图。指错了 setStage 会静默退回三维，
     于是「把这条曲线放到画面中央」按下去什么也不发生 —— 而按钮看起来完全正常。
     '3d' 是允许的目标（把主角切回三维场景）。 */
  {
    const bad = [];
    heads.forEach((h, i) => {
      const slice = html.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : html.length);
      for (const m of slice.matchAll(/data-open-charts="(\w+)"/g)) {
        const k = m[1];
        if (k === "3d") continue;
        if (!cards.has(k)) bad.push(`${h.id}→${k}（没有这张图）`);
        else if (!(map[h.id] || []).includes(k)) bad.push(`${h.id}→${k}（不在本章 CHARTS 里）`);
      }
    });
    check("正文的看图按钮都指向本章真的有的图", bad.length === 0, bad.join("；"));
  }
  /* 切换器上的名字：漏一个就会把 data-chart 的原始键（比如 "dirs"）直接印在
     按钮上给读者看。第一版就漏了一个。 */
  {
    const named = new Set([...(html.match(/const CHART_NAME=\{([^}]*)\}/) || [, ""])[1]
      .matchAll(/(\w+):/g)].map((m) => m[1]));
    const miss = [...cards].filter((k) => !named.has(k));
    check("每张图在主角切换器上都有中文名", miss.length === 0, `缺名字：${miss.join(", ")}`);
  }
  console.log("画面主角:", JSON.stringify(stages.map(s => `${s.id}｜${s.raw}`)));
}

/* ── 7b4. 舞台和镜头的落点：都必须躲开面板 ──
   freeRect 里那句可见性判断原本写的是 `el.offsetParent!==null`。三块面板全是
   position:fixed，而 offsetParent 对 fixed 元素一律返回 null —— 判断恒为 false，
   函数一直在走「什么都没挡住」的兜底分支。也就是说镜头从来都对着整个视口的
   中心，有一部分内容一直压在讲解面板底下，而注释写的是「从根本上杜绝遮挡」。
   截图查不出来（这个环境里画布永远是黑的），所以直接把函数抽出来打桩验算。 */
{
  const stub = (rects, W, H) => {
    const mkEl = (id) => rects[id] ? {
      getBoundingClientRect: () => rects[id],
      style: {},
      offsetParent: null,          // 真实页面里这几块都是 fixed，这一位恒为 null
      offsetWidth: rects[id].width
    } : null;
    const nodes = { "#story": mkEl("story"), "#right": mkEl("right"), "#hud": mkEl("hud"),
                    "#stage": mkEl("stage"), "#stagepick": mkEl("stagepick") };
    const make = new Function("$", "innerWidth", "innerHeight", "getComputedStyle", "STAGE", `
      ${grab("freeRect")}
      ${grab("safeCenter")}
      ${grab("stageFits")}
      ${grab("layoutStage")}
      return { freeRect, safeCenter, stageFits, layoutStage, STAGE };
    `);
    const STAGE = { key: "3d", sec: null, avail: 0 };
    const api = make((s) => nodes[s], W, H,
      () => ({ display: "flex", visibility: "visible" }), STAGE);
    api.nodes = nodes;
    return api;
  };
  const box = (l, t, w, h) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });

  /* 电脑：讲解在左、控制在右、读数在左下 */
  {
    const rects = { story: box(22, 74, 352, 534), right: box(984, 74, 274, 626),
                    hud: box(22, 668, 38, 30), stage: box(0, 0, 10, 10), stagepick: box(0, 0, 10, 10) };
    const a = stub(rects, 1280, 720);
    const R = a.freeRect();
    check("电脑：空地从讲解面板右缘算起", R.l >= rects.story.right, `l=${R.l}，讲解右缘 ${rects.story.right}`);
    check("电脑：空地在控制面板左缘之前结束", R.r <= rects.right.left, `r=${R.r}，控制左缘 ${rects.right.left}`);
    check("电脑：空地不压到读数", R.b <= rects.hud.top, `b=${R.b}，读数上缘 ${rects.hud.top}`);
    check("电脑：镜头偏到空地那一侧而不是视口中心", Math.abs(a.safeCenter()[0]) > 1e-3,
      `ox=${a.safeCenter()[0].toFixed(4)}（为 0 就说明可见性判断又失效了）`);
    a.layoutStage(true);
    const s = a.nodes["#stage"].style;
    const l = parseFloat(s.left), t = parseFloat(s.top), w = parseFloat(s.width), h = parseFloat(s.height);
    check("电脑：舞台不盖住讲解面板", l >= rects.story.right, `舞台左 ${l}`);
    check("电脑：舞台不盖住控制面板", l + w <= rects.right.left, `舞台右 ${l + w}`);
    check("电脑：舞台在顶栏之下、读数之上", t >= 56 && t + h <= rects.hud.top, `${t} → ${t + h}`);
    check("电脑：舞台比原来的侧栏卡片宽得多", w > rects.right.width * 1.8, `${w}px vs 侧栏 ${rects.right.width}px`);
    check("电脑：画布高度留够", a.STAGE.avail > 300, `avail=${a.STAGE.avail}`);
  }
  /* 视口太窄：空地只剩两百来像素，宁可不上台也不能压到面板上 */
  {
    const rects = { story: box(22, 74, 300, 534), right: box(680, 74, 238, 626),
                    hud: box(22, 668, 38, 30), stage: box(0, 0, 10, 10), stagepick: box(0, 0, 10, 10) };
    const a = stub(rects, 940, 700);
    check("窄视口下舞台判定为放不下", a.stageFits() === false,
      `空地宽 ${a.freeRect().r - a.freeRect().l}px，却仍然判定放得下`);
  }
  /* 宽视口：放得下 */
  {
    const rects = { story: box(22, 74, 352, 534), right: box(1226, 74, 274, 626),
                    hud: box(22, 668, 38, 30), stage: box(0, 0, 10, 10), stagepick: box(0, 0, 10, 10) };
    const a = stub(rects, 1522, 800);
    check("宽视口下舞台判定为放得下", a.stageFits() === true, "宽屏也判定放不下");
  }
  /* ── 逐章取景：内容必须整个落在那块空地里 ──
     ox/oy 只是把画面平移到空地中心，内容的大小一点没变。所以「镜头躲开面板」
     只解决了一半：东西还是可能大到伸进面板底下（第 7 章的方向球实测落到
     NDC 0.74，正好是参数面板）或者伸出手机屏幕（同一个球落到 2.40）。
     fitDist() 就是补上后一半，这里逐章验它真的补上了。 */
  {
    const T = 1 / Math.tan(0.86 / 2);
    /* 每章的 camTo(az,el,dist,tx,...) 与打开了哪些卫星元素 */
    const heads = [...html.matchAll(/\{id:'(\w+)',t:'/g)].map((m) => ({ id: m[1], at: m.index }));
    const chapters = [];
    heads.forEach((h, i) => {
      const slice = html.slice(h.at, i + 1 < heads.length ? heads[i + 1].at : html.length);
      const cam = slice.match(/camTo\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/);
      if (!cam) return;
      const en = slice.slice(slice.indexOf("en()"));
      const flag = (k) => {
        const a = [...en.matchAll(new RegExp(`KAK\\.${k}=([\\d.]+)`, "g"))].map((m) => +m[1]);
        const b = [...en.matchAll(new RegExp(`to\\(KAK,'${k}',([\\d.]+)`, "g"))].map((m) => +m[1]);
        const all = [...a, ...b];
        return all.length ? all[all.length - 1] > 0.5 : false;
      };
      chapters.push({ id: h.id, dist: +cam[3], tx: +cam[4], shadow: flag("shadow"), globe: flag("dirGlobe") });
    });
    check("能取到每章的镜头设置", chapters.length === 15, `${chapters.length} 章`);
    const SHADOW_X = +html.match(/SHADOW_X=(-?[\d.]+)/)[1];
    const SHADOW_S = +html.match(/SHADOW_S=([\d.]+)/)[1];
    const GLOBE_X = +html.match(/GLOBE_X=([\d.]+)/)[1];
    const GLOBE_S = +html.match(/GLOBE_S=([\d.]+)/)[1];
    const sweep = (label, W, H, freeL, freeR, freeT, freeB, globeDrawn) => {
      const asp = W / H, halfW = (freeR - freeL) / W, halfH = (freeB - freeT) / H;
      const ox = (2 * freeL / W - 1 + (2 * freeR / W - 1)) / 2;
      const ndcL = 2 * freeL / W - 1, ndcR = 2 * freeR / W - 1;
      const bad = [];
      for (const c of chapters) {
        let lo = -0.62, hi = 0.62;
        if (c.shadow) lo = Math.min(lo, SHADOW_X - SHADOW_S * 0.5 - 0.05);
        if (c.globe && globeDrawn) hi = Math.max(hi, GLOBE_X + GLOBE_S * 0.5);
        const rad = Math.max(Math.abs(lo - c.tx), Math.abs(hi - c.tx));
        const fit = Math.max((T / asp) * rad / Math.max(0.08, halfW), T * 0.58 / Math.max(0.08, halfH));
        const d = Math.max(c.dist, Math.min(fit, c.dist * 2.4));
        const a = (T / asp) * ((lo - c.tx) / d) + ox, b = (T / asp) * ((hi - c.tx) / d) + ox;
        if (a < ndcL - 0.02 || b > ndcR + 0.02) bad.push(`${c.id}[${a.toFixed(2)},${b.toFixed(2)}]`);
      }
      check(`${label}：每一章的内容都落在空地里`, bad.length === 0, `溢出：${bad.join(" ")}`);
    };
    sweep("电脑 1280×720", 1280, 720, 392, 966, 56, 656, true);
    sweep("电脑 1600×900", 1600, 900, 392, 1286, 56, 836, true);
    /* 手机：右栏隐藏（空地整宽），读数在上、讲解在下，三维罗盘不画 */
    sweep("手机 390×780", 390, 780, 0, 390, 198, 410, false);
    sweep("手机 360×640", 360, 640, 0, 360, 190, 330, false);
  }

  /* 手机：讲解在下、控制整列隐藏、读数在上 */
  {
    const rects = { story: box(10, 420, 370, 350), hud: box(10, 104, 250, 84),
                    stage: box(0, 0, 10, 10), stagepick: box(0, 0, 10, 10) };
    const a = stub(rects, 390, 780);
    const R = a.freeRect();
    check("手机：空地在读数之下", R.t >= rects.hud.bottom, `t=${R.t}，读数下缘 ${rects.hud.bottom}`);
    check("手机：空地在讲解面板之上", R.b <= rects.story.top, `b=${R.b}，讲解上缘 ${rects.story.top}`);
    a.layoutStage(true);
    const s = a.nodes["#stage"].style;
    const t = parseFloat(s.top), h = parseFloat(s.height), w = parseFloat(s.width);
    check("手机：舞台夹在读数和讲解之间", t >= rects.hud.bottom && t + h <= rects.story.top, `${t} → ${t + h}`);
    check("手机：舞台横向铺满", w > 340, `${w}px`);
  }
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

  /* 三幕必须无缝盖住全部 15 章。边界差一格不会报错，只会让某一章从进度条上
     消失（或者被算进错的一幕），而读者只会觉得「这条进度条有点怪」。 */
  const acts = [...html.matchAll(/\{k:'第[一二三四]幕',t:'[^']+',start:(\d+),end:(\d+)\}/g)]
    .map(m => [+m[1], +m[2]]);
  check("三幕无缝覆盖全部 15 章",
    acts.length > 0 && acts[0][0] === 0 && acts[acts.length - 1][1] === want.length
      && acts.every((a, i) => i === 0 || a[0] === acts[i - 1][1]),
    JSON.stringify(acts));
  /* 第一幕的边界必须和「入门段不摆标度图」那条检查用的 8 一致，
     否则两条规则会各说各话 */
  check("第一幕就是入门八章", acts[0] && acts[0][1] === 8, JSON.stringify(acts[0]));
  const dotSrc = grab("buildDots");
  check("进度点是可键盘操作的原生按钮",
    /<button type="button"/.test(dotSrc) && /aria-label=/.test(dotSrc) && !/\$\$\('#dots i'\)/.test(html),
    "仍在用不可聚焦的 i 元素充当章节按钮");
  check("章节号那一行写出了幕名", /class="act"/.test(html), "#stepno 只有计数，没有幕名");
}

if (fail.length) {
  console.error(JSON.stringify({ ok: false, failed: fail }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: "Perron volume, flattening, sticky freeze, discretised scaling, sticky dim, triangle counts, bush vs hairbrush, chapter ids" }));
