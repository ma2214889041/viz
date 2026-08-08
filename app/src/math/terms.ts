/**
 * 语义术语表 —— 3B1B 的第 3 条：颜色即语义。
 *
 * 一个符号在整篇文章里必须保持同一个颜色，读者才能在几何图里
 * 一眼认出「这坨东西就是公式里的那一项」。所以颜色只在这里定义一次，
 * 公式、2D 图表、3D 场景全部从这里取色，不许各写各的。
 */

export type TermId =
  | "H" // H 泛函本身
  | "f" // 分布函数
  | "logf" // log f
  | "v" // 速度
  | "x" // 位置
  | "t" // 时间
  | "Q" // 碰撞算符
  | "dv" // 速度体积元
  | "dx" // 位置体积元
  | "S" // 熵
  | "kB"; // 玻尔兹曼常数

export const TERM_COLOR: Record<TermId, string> = {
  H: "#f3c84b", // 与 boltzmann/work.json 的 accent 一致
  f: "#72d9ee",
  logf: "#9db4ff",
  v: "#ff8a5c",
  x: "#7ee787",
  t: "#c8a2ff",
  Q: "#ff6b9d",
  dv: "#ff8a5c",
  dx: "#7ee787",
  S: "#f3c84b",
  kB: "#8b96a8",
};

export const TERM_LABEL: Record<TermId, string> = {
  H: "H 泛函：整团气体的「有序程度」读数",
  f: "分布函数 f：每种速度各占多少",
  logf: "log f：把「占多少」换成「意外程度」",
  v: "速度",
  x: "位置",
  t: "时间",
  Q: "碰撞算符：碰撞如何搬运概率",
  dv: "速度空间体积元",
  dx: "位置空间体积元",
  S: "熵",
  kB: "玻尔兹曼常数",
};

/** 把 term 包进 LaTeX。KaTeX 会渲染成 <span class="tm tm-H">…</span> */
export const T = (id: TermId, tex: string) => `\\htmlClass{tm tm-${id}}{${tex}}`;

/** 注入 :root 上的 --tm-<id> 变量，canvas / 3D 也从这里读色 */
export function termCssVars(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(TERM_COLOR).map(([k, v]) => [`--tm-${k}`, v]),
  ) as Record<string, string>;
}
