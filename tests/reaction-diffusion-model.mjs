import assert from "node:assert/strict";

/**
 * Gray–Scott 模型的数值验证（与文章内实现逐项一致）。
 * 页面只做瞬时不变量检查；需要数千步的验证放在这里，由部署门禁执行。
 */
const N = 240, SIZE = N * N, DU = 1, DV = 0.5, DT = 1;
const FEED = 0.0367, KILL = 0.0649;

let u = new Float32Array(SIZE), v = new Float32Array(SIZE);
let uN = new Float32Array(SIZE), vN = new Float32Array(SIZE);
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const idx = (x, y) => (((y % N) + N) % N) * N + (((x % N) + N) % N);

const lap = (a, x, y) =>
  -a[idx(x, y)] +
  0.2 * (a[idx(x - 1, y)] + a[idx(x + 1, y)] + a[idx(x, y - 1)] + a[idx(x, y + 1)]) +
  0.05 * (a[idx(x - 1, y - 1)] + a[idx(x + 1, y - 1)] + a[idx(x - 1, y + 1)] + a[idx(x + 1, y + 1)]);

function advance() {
  for (let y = 0; y < N; y += 1) for (let x = 0; x < N; x += 1) {
    const i = y * N + x, a = u[i], b = v[i], rxn = a * b * b;
    uN[i] = clamp(a + (DU * lap(u, x, y) - rxn + FEED * (1 - a)) * DT, 0, 1);
    vN[i] = clamp(b + (DV * lap(v, x, y) + rxn - (FEED + KILL) * b) * DT, 0, 1);
  }
  [u, uN] = [uN, u];
  [v, vN] = [vN, v];
}
const uniform = () => { u.fill(1); v.fill(0); uN.fill(1); vN.fill(0); };
function stamp(side, uu, vv) {
  const c = N >> 1, h = side / 2;
  for (let y = Math.round(c - h); y < Math.round(c - h) + side; y += 1)
    for (let x = Math.round(c - h); x < Math.round(c - h) + side; x += 1) {
      const i = idx(x, y); u[i] = uu; v[i] = vv;
    }
}
function activeAfter(side, amp, steps) {
  uniform(); stamp(side, 0.5, amp);
  for (let i = 0; i < steps; i += 1) advance();
  let a = 0;
  for (let i = 0; i < SIZE; i += 1) if (v[i] > 0.1) a += 1;
  return (100 * a) / SIZE;
}

// 1) 拉普拉斯权重和必须为 0，否则会凭空产生物质
assert.ok(Math.abs(-1 + 4 * 0.2 + 4 * 0.05) < 1e-12, "拉普拉斯权重和不为 0");

// 2) 均匀场 (u=1, v=0) 必须是精确稳态
uniform();
for (let i = 0; i < 400; i += 1) advance();
let drift = 0;
for (let i = 0; i < SIZE; i += 1) drift = Math.max(drift, Math.abs(u[i] - 1), Math.abs(v[i]));
assert.ok(drift < 1e-12, `均匀场不是精确稳态：漂移 ${drift}`);

// 3) 均匀态对所有波长线性稳定（雅可比对角、两特征值均为负）
//    → 这不是图灵不稳定系统，图案必须由有限振幅扰动触发
const lamU = -FEED, lamV = -(FEED + KILL);
assert.ok(lamU < 0 && lamV < 0, "均匀态并非线性稳定");

// 4) 存在陡峭的尺寸阈值：边长 5 湮灭、6 存活
const s5 = activeAfter(5, 0.25, 2600);
const s6 = activeAfter(6, 0.25, 2600);
assert.ok(s5 < 0.05, `边长 5 应当湮灭，实测活跃格 ${s5.toFixed(3)}%`);
assert.ok(s6 > 0.05, `边长 6 应当存活，实测活跃格 ${s6.toFixed(3)}%`);

// 5) 存在强度阈值：v=0.20 湮灭、v=0.25 存活（u 固定 0.5，不耦合）
const a20 = activeAfter(20, 0.2, 2600);
const a25 = activeAfter(20, 0.25, 2600);
assert.ok(a20 < 0.05, `强度 0.20 应当湮灭，实测 ${a20.toFixed(3)}%`);
assert.ok(a25 > 0.05, `强度 0.25 应当存活，实测 ${a25.toFixed(3)}%`);

console.log(JSON.stringify({
  ok: true, grid: N, uniformDrift: drift,
  eigenvalues: { u: lamU, v: lamV },
  sizeThreshold: { side5: +s5.toFixed(3), side6: +s6.toFixed(3) },
  amplitudeThreshold: { v020: +a20.toFixed(3), v025: +a25.toFixed(3) }
}));
