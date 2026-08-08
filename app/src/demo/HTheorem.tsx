import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Formula } from "../math/Formula";
import { T, TERM_COLOR, TERM_LABEL, type TermId } from "../math/terms";
import { useSim } from "../state/sim";
import {
  createGas,
  hEquilibrium,
  hFromSpeed,
  kineticEnergy,
  maxwellSpeed,
  reverse,
  speedHistogram,
  step,
  velocityHistogram,
  type GasState,
} from "../models/gas";
import "./htheorem.css";

/** 推导的每一步。同名项在步与步之间会被 FLIP 接住，所以读者看到的是「符号在移动」。 */
const STEPS: Array<{ id: string; tex: string; say: string; focus: TermId | null }> = [
  {
    id: "f",
    focus: "f",
    say: "先给这团气体一个描述：每种速度各占多少。这就是分布函数。",
    tex: `${T("f", "f")}(${T("v", "\\mathbf{v}")}, ${T("t", "t")})`,
  },
  {
    id: "H",
    focus: "H",
    say: "给这个分布配一个数——把 f 和 log f 乘起来，在整个速度空间上积掉。",
    tex: `${T("H", "H")}(${T("t", "t")}) = \\int\\!\\!\\int ${T("f", "f")}\\,${T("logf", "\\log f")}\\;${T("dx", "d\\mathbf{x}")}\\,${T("dv", "d\\mathbf{v}")}`,
  },
  {
    id: "S",
    focus: "S",
    say: "它就是负的熵。熵增，等价于这个数在减。",
    tex: `${T("S", "S")} = -${T("kB", "k_B")}\\,${T("H", "H")}`,
  },
  {
    id: "dH",
    focus: "H",
    say: "玻尔兹曼证明：沿着方程的解，这个数只会往一个方向走。",
    tex: `\\frac{d${T("H", "H")}}{d${T("t", "t")}} \\le 0`,
  },
  {
    id: "eq",
    focus: "Q",
    say: "而它之所以只往一个方向走，来自碰撞算符 Q —— 非线性就藏在这里。",
    tex: `\\partial_{${T("t", "t")}}${T("f", "f")} + ${T("v", "\\mathbf{v}")}\\cdot\\nabla_{${T("x", "\\mathbf{x}")}}${T("f", "f")} = ${T("Q", "Q")}(${T("f", "f")},${T("f", "f")})`,
  },
];

/** 完整保留 H 的历史（带时间戳）。滚动窗口会把最精彩的那段下落丢掉。 */
const HISTORY_CAP = 6000;
const BOX = 360;

export function HTheorem() {
  const gasRef = useRef<HTMLCanvasElement>(null);
  const fRef = useRef<HTMLCanvasElement>(null);
  const hRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GasState | null>(null);
  const histRef = useRef<Array<[number, number]>>([]);
  const revRef = useRef<number[]>([]); // 反演发生的时刻，用来在图上画竖线
  const rafRef = useRef(0);

  const [stepIx, setStepIx] = useState(0);
  const {
    running, n, speed0, radius, dt, seed, focus, readout,
    setFocus, setRunning, setReadout, reseed, setN, setSpeed0, setRadius, setDt,
  } = useSim();

  const stepDef = STEPS[stepIx];

  // 换步骤时把焦点也带过去
  useEffect(() => setFocus(stepDef.focus), [stepIx, stepDef.focus, setFocus]);

  // 参数变了就重建气体
  useEffect(() => {
    stateRef.current = createGas({ n, radius, box: BOX, speed0, seed });
    histRef.current = [];
    revRef.current = [];
  }, [n, radius, speed0, seed]);

  const fitCanvas = (cv: HTMLCanvasElement) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = cv.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
    }
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  };

  const draw = useCallback(() => {
    const g = stateRef.current;
    if (!g) return;

    // ---- 粒子 ----
    if (gasRef.current) {
      const { ctx, w, h } = fitCanvas(gasRef.current);
      ctx.clearRect(0, 0, w, h);
      const s = Math.min(w, h) / g.box;
      const ox = (w - g.box * s) / 2;
      const oy = (h - g.box * s) / 2;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(s, s);
      ctx.strokeStyle = "rgba(255,255,255,.14)";
      ctx.lineWidth = 1 / s;
      ctx.strokeRect(0, 0, g.box, g.box);
      // 按速率上色：慢=冷，快=暖。速率就是公式里的 v
      let vmax = 1e-9;
      for (let i = 0; i < g.n; i++) vmax = Math.max(vmax, Math.hypot(g.vx[i], g.vy[i]));
      for (let i = 0; i < g.n; i++) {
        const sp = Math.hypot(g.vx[i], g.vy[i]) / vmax;
        ctx.beginPath();
        ctx.arc(g.x[i], g.y[i], g.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${210 - 190 * sp} 85% ${45 + 22 * sp}%)`;
        ctx.fill();
      }
      ctx.restore();
    }

    // ---- 速度空间分布 f ----
    const vh = velocityHistogram(g, 44);
    if (fRef.current) {
      const { ctx, w, h } = fitCanvas(fRef.current);
      ctx.clearRect(0, 0, w, h);
      const side = Math.min(w, h);
      const ox = (w - side) / 2;
      const oy = (h - side) / 2;
      const px = side / vh.bins;
      let fmax = 1e-12;
      for (const v of vh.f) fmax = Math.max(fmax, v);
      for (let by = 0; by < vh.bins; by++) {
        for (let bx = 0; bx < vh.bins; bx++) {
          const v = vh.f[by * vh.bins + bx] / fmax;
          if (v <= 0) continue;
          ctx.fillStyle = `rgba(114,217,238,${Math.min(1, 0.1 + v * 1.15)})`;
          ctx.fillRect(ox + bx * px, oy + (vh.bins - 1 - by) * px, px + 0.5, px + 0.5);
        }
      }
      // 速率分布 vs 麦克斯韦解析曲线
      const sh = speedHistogram(g, 40);
      const sigma2 = kineticEnergy(g) / g.n;
      ctx.save();
      ctx.translate(ox, oy + side);
      const bw = side / sh.bins;
      let pmax = 1e-12;
      for (const p of sh.p) pmax = Math.max(pmax, p);
      for (let k = 0; k < sh.bins; k++) pmax = Math.max(pmax, maxwellSpeed((k + 0.5) * sh.width, sigma2));
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = TERM_COLOR.f;
      for (let k = 0; k < sh.bins; k++) {
        const hh = (sh.p[k] / pmax) * side * 0.32;
        ctx.fillRect(k * bw, -hh, bw - 0.6, hh);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 0; k <= 120; k++) {
        const sv = (k / 120) * sh.smax;
        const yy = -(maxwellSpeed(sv, sigma2) / pmax) * side * 0.32;
        const xx = (sv / sh.smax) * side;
        k === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- H(t) ----
    // 用一维速率分布算 H：二维直方图在 N 有限时会把 H 系统性高估（见 gas.ts 注释）
    const H = hFromSpeed(g);
    const Heq = hEquilibrium(g);
    const hist = histRef.current;
    hist.push([g.t, H]);
    if (hist.length > HISTORY_CAP) hist.shift();

    if (hRef.current) {
      const { ctx, w, h } = fitCanvas(hRef.current);
      ctx.clearRect(0, 0, w, h);
      const pad = 28;
      const tMax = Math.max(1e-6, hist.at(-1)![0]);
      let lo = Heq;
      let hi = Heq;
      for (const [, v] of hist) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
      const padY = (hi - lo) * 0.08;
      lo -= padY; hi += padY;
      const xOf = (t: number) => pad + (t / tMax) * (w - pad * 2);
      const yOf = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (h - pad * 2);

      // 平衡线
      ctx.strokeStyle = "rgba(255,255,255,.3)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad, yOf(Heq));
      ctx.lineTo(w - pad, yOf(Heq));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,.5)";
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillText("麦克斯韦平衡 H_eq", pad + 4, yOf(Heq) - 6);

      // 反演时刻
      for (const rt of revRef.current) {
        ctx.strokeStyle = "rgba(255,107,157,.55)";
        ctx.beginPath();
        ctx.moveTo(xOf(rt), pad);
        ctx.lineTo(xOf(rt), h - pad);
        ctx.stroke();
      }

      // H 曲线
      ctx.strokeStyle = TERM_COLOR.H;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      hist.forEach(([t, v], i) => {
        const xx = xOf(t);
        const yy = yOf(v);
        i === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
      });
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,.4)";
      ctx.fillText(`t = ${g.t.toFixed(0)}`, w - pad - 52, h - pad + 16);
    }

    setReadout({ t: g.t, H, Heq, energy: kineticEnergy(g) });
  }, [setReadout]);

  // 渲染循环。1 步/帧，步长由读者控制：
  // 稠密气体 + 大步长时整个弛豫不到半秒就结束，最该看的那段直接闪过去。
  useEffect(() => {
    const loop = () => {
      const g = stateRef.current;
      if (g && running) step(g, dt);
      draw();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, dt, draw]);

  const panelClass = (own: TermId[]) =>
    `panel ${focus && own.includes(focus) ? "is-lit" : focus ? "is-dim" : ""}`;

  const dH = useMemo(() => {
    const h = histRef.current;
    return h.length > 30 ? h.at(-1)![1] - h.at(-31)![1] : 0;
  }, [readout.H]);

  return (
    <div className="ht">
      <header className="ht-head">
        <h1>一盒气体为什么知道时间方向？</h1>
        <p className="sub">
          公式里的每一项都是活的：<b>点它，或者划过它</b> —— 对应的那块画面会亮起来。
        </p>
      </header>

      <div className="ht-grid">
        <section className={panelClass(["v", "x"])}>
          <h2>粒子</h2>
          <canvas ref={gasRef} className="cv cv-gas" />
          <small>颜色 = 速率。碰撞是弹性的，能量严格守恒。</small>
        </section>

        <section className={panelClass(["f", "logf", "dv"])}>
          <h2>
            分布 <i style={{ color: TERM_COLOR.f }}>f</i>
          </h2>
          <canvas ref={fRef} className="cv cv-f" />
          <small>上：速度空间 (vx, vy)。下：速率分布 vs 麦克斯韦曲线（白线）。</small>
        </section>

        <section className={panelClass(["H", "S", "t"])}>
          <h2>
            <i style={{ color: TERM_COLOR.H }}>H</i>(t)
          </h2>
          <canvas ref={hRef} className="cv cv-h" />
          <small>
            H = {readout.H.toFixed(4)} ・ 平衡值 {readout.Heq.toFixed(4)} ・ 近 30 帧变化{" "}
            <b style={{ color: dH <= 0 ? "#7ee787" : "#ff6b6b" }}>{dH >= 0 ? "+" : ""}{dH.toFixed(4)}</b>
          </small>
        </section>
      </div>

      <div className="ht-formula">
        <Formula
          tex={stepDef.tex}
          activeTerm={focus}
          onTermClick={(id) => setFocus(id === focus ? null : id)}
          onTermHover={(id) => id && setFocus(id)}
        />
        <p className="say">{stepDef.say}</p>
        {focus && (
          <p className="tip" style={{ borderColor: TERM_COLOR[focus] }}>
            <b style={{ color: TERM_COLOR[focus] }}>{focus}</b> — {TERM_LABEL[focus]}
          </p>
        )}
      </div>

      <nav className="ht-steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            className={i === stepIx ? "on" : ""}
            onClick={() => setStepIx(i)}
            aria-current={i === stepIx}
          >
            {i + 1}
          </button>
        ))}
        <span className="spacer" />
        <button onClick={() => setStepIx((i) => Math.max(0, i - 1))}>← 上一步</button>
        <button onClick={() => setStepIx((i) => Math.min(STEPS.length - 1, i + 1))}>下一步 →</button>
      </nav>

      <div className="ht-ctrl">
        <button onClick={() => setRunning(!running)}>{running ? "暂停" : "继续"}</button>
        <button
          onClick={() => {
            const g = stateRef.current;
            if (!g) return;
            reverse(g);
            revRef.current.push(g.t);
          }}
          title="所有速度取反：微观可逆。趁 H 还在下落时按，才看得到它往回爬。"
        >
          时间反演
        </button>
        <button onClick={reseed}>重新开始</button>
        <label>
          粒子数 {n}
          <input type="range" min={120} max={900} step={20} value={n} onChange={(e) => setN(+e.target.value)} />
        </label>
        <label title="半径越大碰撞越频繁，弛豫越快——时间之箭的快慢就是碰撞率定的">
          半径 {radius.toFixed(1)}
          <input
            type="range"
            min={1.2}
            max={4.5}
            step={0.1}
            value={radius}
            onChange={(e) => setRadius(+e.target.value)}
          />
        </label>
        <label title="每帧推进的物理时间。调小 = 慢放，H 的下落看得更清楚">
          播放 {dt.toFixed(2)}
          <input type="range" min={0.02} max={0.6} step={0.02} value={dt} onChange={(e) => setDt(+e.target.value)} />
        </label>
        <label>
          初速 {speed0.toFixed(2)}
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.05}
            value={speed0}
            onChange={(e) => setSpeed0(+e.target.value)}
          />
        </label>
        <span className="energy">动能 {readout.energy.toFixed(3)}（应恒定）</span>
      </div>
    </div>
  );
}
