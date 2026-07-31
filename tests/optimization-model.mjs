import assert from "node:assert/strict";

/**
 * 损失地形与临界点分类的数值验证（与文章内实现逐项一致）：
 *
 *   f(x,y) = A·sin(1.6x)·cos(1.4y) + 0.08(x² + y²)
 *
 * 一阶与二阶导数全部解析可写，因此每个临界点的类型都是算出来的。
 * 页面自检只做瞬时检查；需要抽样的高维统计放在这里。
 */
const LA = 1.6, LB = 1.4, LC = 0.16, RX = 4.0, RY = 3.2;

const F = (x, y, A) => A * Math.sin(LA * x) * Math.cos(LB * y) + (LC * (x * x + y * y)) / 2;
const G = (x, y, A) => [
  A * LA * Math.cos(LA * x) * Math.cos(LB * y) + LC * x,
  -A * LB * Math.sin(LA * x) * Math.sin(LB * y) + LC * y
];
const Hs = (x, y, A) => {
  const sc = A * Math.sin(LA * x) * Math.cos(LB * y);
  const cs = A * Math.cos(LA * x) * Math.sin(LB * y);
  return [-LA * LA * sc + LC, -LA * LB * cs, -LB * LB * sc + LC];
};
const eig = (h) => {
  const tr = h[0] + h[2], det = h[0] * h[2] - h[1] * h[1];
  const d = Math.sqrt(Math.max(0, tr * tr - 4 * det));
  return [(tr - d) / 2, (tr + d) / 2];
};
const kind = (e) => (e[0] > 1e-9 && e[1] > 1e-9 ? "min" : e[0] < -1e-9 && e[1] < -1e-9 ? "max" : "saddle");

function criticals(A) {
  const out = [];
  for (let gx = -RX; gx <= RX; gx += 0.3) for (let gy = -RX; gy <= RX; gy += 0.3) {
    let x = gx, y = gy, ok = false;
    for (let it = 0; it < 50; it += 1) {
      const h = Hs(x, y, A), det = h[0] * h[2] - h[1] * h[1];
      if (Math.abs(det) < 1e-9) break;
      const g = G(x, y, A);
      const dx = (h[2] * g[0] - h[1] * g[1]) / det;
      const dy = (-h[1] * g[0] + h[0] * g[1]) / det;
      x -= dx; y -= dy;
      if (Math.abs(x) > RX + 0.6 || Math.abs(y) > RX + 0.6) break;
      if (Math.hypot(dx, dy) < 1e-12) { ok = true; break; }
    }
    if (!ok || Math.abs(x) > RX || Math.abs(y) > RY) continue;
    const g = G(x, y, A);
    if (Math.hypot(g[0], g[1]) > 1e-8) continue;
    if (out.some((q) => Math.hypot(q.x - x, q.y - y) < 1e-3)) continue;
    const e = eig(Hs(x, y, A));
    out.push({ x, y, e, f: F(x, y, A), type: kind(e) });
  }
  out.sort((p, q) => p.f - q.f);
  return out;
}

// 1) A = 0 时地形退化成碗：唯一临界点，且是极小
{
  const cs = criticals(0);
  assert.equal(cs.length, 1, `A=0 应只有一个临界点，实得 ${cs.length}`);
  assert.equal(cs[0].type, "min");
  assert.ok(Math.hypot(cs[0].x, cs[0].y) < 1e-9, "碗底应在原点");
}

// 2) A = 1：全部临界点收敛，且鞍点多于极小
const cs1 = criticals(1);
const n = (t) => cs1.filter((c) => c.type === t).length;
{
  for (const c of cs1) {
    const g = G(c.x, c.y, 1);
    assert.ok(Math.hypot(g[0], g[1]) < 1e-7, `临界点残余梯度过大 ${Math.hypot(g[0], g[1])}`);
  }
  assert.ok(cs1.length > 20, `应有相当多的临界点，实得 ${cs1.length}`);
  assert.ok(n("saddle") > n("min"), `鞍点应多于极小，实得 鞍点${n("saddle")} 极小${n("min")}`);
  assert.ok(n("max") > 0, "应存在极大点");
}

// 3) 分类必须与特征值符号严格一致
for (const c of cs1) {
  const e = eig(Hs(c.x, c.y, 1));
  if (c.type === "min") assert.ok(e[0] > 0 && e[1] > 0);
  if (c.type === "max") assert.ok(e[0] < 0 && e[1] < 0);
  if (c.type === "saddle") assert.ok(e[0] * e[1] < 0, "鞍点两特征值必须异号");
}

// 4) 全局最优唯一且严格低于次优 —— 局部与全局才有意义
{
  const mins = cs1.filter((c) => c.type === "min");
  assert.ok(mins.length >= 2, "应有多个极小");
  assert.ok(mins[1].f - mins[0].f > 1e-3,
    `全局最优应严格低于次优，实得差 ${mins[1].f - mins[0].f}`);
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
  critical: { total: cs1.length, min: n("min"), saddle: n("saddle"), max: n("max") },
  saddlePerMin: +(n("saddle") / n("min")).toFixed(2),
  pdRates: Object.fromEntries(Object.entries(rates).map(([d, p]) => [d, `${(100 * p).toFixed(3)}%`]))
}));
