import assert from "node:assert/strict";

/**
 * 损失地形族的数值验证（与文章内实现逐项一致）：
 *   f(x,y) = x⁴/4 − κx²/2 + y²/2 + t·x
 *   ∇f     = (x³ − κx + t, y)
 *   H      = diag(3x² − κ, 1)
 * 页面自检只做瞬时检查；需要抽样的高维统计放在这里。
 */
const f = (x, y, k, t) => (x ** 4) / 4 - (k * x * x) / 2 + (y * y) / 2 + t * x;
const gx = (x, k, t) => x ** 3 - k * x + t;
const h1 = (x, k) => 3 * x * x - k;

function criticals(k, t) {
  const out = [];
  let prev = gx(-3, k, t);
  for (let s = -3; s < 3; s += 0.002) {
    const cur = gx(s + 0.002, k, t);
    if (prev === 0 || prev * cur < 0) {
      let a = s, b = s + 0.002;
      for (let i = 0; i < 80; i += 1) {
        const m = (a + b) / 2;
        if (gx(a, k, t) * gx(m, k, t) <= 0) b = m; else a = m;
      }
      const x = (a + b) / 2;
      if (!out.some((q) => Math.abs(q.x - x) < 1e-3))
        out.push({ x, ev: [h1(x, k), 1], f: f(x, 0, k, t) });
    }
    prev = cur;
  }
  return out;
}

// 1) κ < 0：只有一个极小，两个特征值都为正
{
  const cs = criticals(-1.5, 0);
  assert.equal(cs.length, 1, "κ<0 时应只有一个临界点");
  assert.ok(cs[0].ev[0] > 0 && cs[0].ev[1] > 0, "κ<0 的临界点应为极小");
}

// 2) κ=2, t=0：三个临界点，极小在 ±√2，鞍点在 0 且特征值为 (−2, 1)
{
  const cs = criticals(2, 0);
  assert.equal(cs.length, 3, "κ=2 应有 3 个临界点");
  const saddles = cs.filter((c) => c.ev[0] < 0);
  const minima = cs.filter((c) => c.ev[0] > 0);
  assert.equal(saddles.length, 1, "应恰有一个鞍点");
  assert.equal(minima.length, 2, "应恰有两个极小");
  assert.ok(Math.abs(saddles[0].x) < 1e-6, "鞍点应在 x=0");
  assert.ok(Math.abs(saddles[0].ev[0] + 2) < 1e-6, `鞍点 ∂²f/∂x² 应为 −κ = −2，实得 ${saddles[0].ev[0]}`);
  assert.ok(saddles[0].ev[1] > 0, "鞍点另一个特征值应为正 —— 这正是「鞍」的定义");
  for (const m of minima)
    assert.ok(Math.abs(Math.abs(m.x) - Math.SQRT2) < 1e-5, `极小应在 ±√κ = ±√2，实得 ${m.x}`);
}

// 3) 倾斜后两个极小深浅不同 → 局部最优与全局最优
{
  const cs = criticals(2, 0.35).filter((c) => c.ev[0] > 0).map((c) => c.f);
  assert.equal(cs.length, 2);
  assert.ok(Math.abs(cs[0] - cs[1]) > 0.5, `倾斜后两极小深度差应显著，实得 ${Math.abs(cs[0] - cs[1])}`);
}

// 4) 越靠近鞍点，逃离所需步数越多（梯度全程接近 0，却要等更久）
{
  const escape = (eps) => {
    let x = eps, n = 0;
    while (Math.abs(x) < 1.2 && n < 500000) { x -= 0.05 * gx(x, 2, 0); n += 1; }
    return n;
  };
  const a = escape(1e-2), b = escape(1e-4), c = escape(1e-6);
  assert.ok(a < b && b < c, `逃离步数应随初始偏离减小而增加，实得 ${a} ${b} ${c}`);
}

// 5) 高维：随机对称矩阵「全部特征值为正」的比例随 d 崩塌
function randSym(d, rnd) {
  const A = [];
  for (let i = 0; i < d; i += 1) A.push(new Float64Array(d));
  for (let i = 0; i < d; i += 1) for (let j = i; j < d; j += 1) {
    let u = 0, v = 0;
    while (!u) u = rnd();
    while (!v) v = rnd();
    A[i][j] = A[j][i] = (Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)) / Math.sqrt(d);
  }
  return A;
}
function isPD(A) {
  const d = A.length, L = A.map((r) => Float64Array.from(r));
  for (let i = 0; i < d; i += 1) for (let j = 0; j <= i; j += 1) {
    let s = L[i][j];
    for (let k = 0; k < j; k += 1) s -= L[i][k] * L[j][k];
    if (i === j) { if (s <= 0) return false; L[i][i] = Math.sqrt(s); }
    else L[i][j] = s / L[j][j];
  }
  return true;
}
const rates = {};
{
  let seed = 20260730;
  const rnd = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return (seed + 0.5) / 4294967296; };
  const N = 40000;
  for (const d of [1, 2, 3, 4, 6]) {
    let c = 0;
    for (let i = 0; i < N; i += 1) if (isPD(randSym(d, rnd))) c += 1;
    rates[d] = c / N;
  }
  assert.ok(Math.abs(rates[1] - 0.5) < 0.02, `d=1 应约 50%，实得 ${rates[1]}`);
  assert.ok(rates[2] < rates[1] && rates[3] < rates[2] && rates[4] < rates[3],
    "正定比例应随维数单调下降");
  assert.ok(rates[6] < 1e-4, `d=6 的正定比例应极低，实得 ${rates[6]}`);
}

console.log(JSON.stringify({
  ok: true,
  saddleEigen: [-2, 1],
  minimaAt: "±√κ",
  pdRates: Object.fromEntries(Object.entries(rates).map(([d, p]) => [d, +(100 * p).toFixed(3) + "%"]))
}));
