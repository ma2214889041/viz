import { useEffect, useLayoutEffect, useRef } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./formula.css";
import type { TermId } from "./terms";

/**
 * 活的公式 —— 对标 Manim 的 TransformMatchingTex。
 *
 * 做法：KaTeX 渲成带语义 class 的 DOM，换公式时用 FLIP 把同名项从旧位置
 * 补间到新位置；新增的项淡入，消失的项在一个 ghost 层里淡出。
 * 于是「两个公式之间」不是切换，是同一批符号在移动 —— 这正是 3B1B
 * 让人「看懂推导」而不是「看到结果」的地方。
 */

export interface FormulaProps {
  tex: string;
  /** 当前高亮的项；由外部（图表 / 3D 场景 / 鼠标）驱动 */
  activeTerm?: TermId | null;
  onTermClick?: (id: TermId) => void;
  onTermHover?: (id: TermId | null) => void;
  /** morph 时长（毫秒） */
  duration?: number;
  display?: boolean;
  className?: string;
}

type RectMap = Map<string, DOMRect>;

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** 收集每个 term 的位置。同名项按出现顺序编号，避免重复项互相抢。 */
function captureRects(root: HTMLElement): RectMap {
  const map: RectMap = new Map();
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>(".tm").forEach((el) => {
    const id = termIdOf(el);
    if (!id) return;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    map.set(`${id}#${n}`, el.getBoundingClientRect());
  });
  return map;
}

function termIdOf(el: Element): string | null {
  for (const c of el.classList) if (c.startsWith("tm-")) return c.slice(3);
  return null;
}

function keyedTerms(root: HTMLElement): Array<[string, HTMLElement]> {
  const out: Array<[string, HTMLElement]> = [];
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>(".tm").forEach((el) => {
    const id = termIdOf(el);
    if (!id) return;
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    out.push([`${id}#${n}`, el]);
  });
  return out;
}

function render(tex: string, display: boolean): string {
  return katex.renderToString(tex, {
    displayMode: display,
    throwOnError: false,
    // \htmlClass 需要 trust，这里只放行这一个命令
    trust: (ctx) => ctx.command === "\\htmlClass",
    strict: false,
  });
}

export function Formula({
  tex,
  activeTerm = null,
  onTermClick,
  onTermHover,
  duration = 620,
  display = true,
  className = "",
}: FormulaProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef(true);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // 首帧直接渲染，不做动画
    if (firstRef.current || reduce) {
      firstRef.current = false;
      host.innerHTML = render(tex, display);
      return;
    }

    // ---- FLIP ----
    // 1. 记录旧位置，并留一份 ghost 用来给「消失的项」淡出
    const oldRects = captureRects(host);
    const ghost = host.cloneNode(true) as HTMLElement;
    const hostRect = host.getBoundingClientRect();

    // 2. 换成新公式
    host.innerHTML = render(tex, display);

    // 3. 记录新位置
    const entries = keyedTerms(host);
    const newKeys = new Set(entries.map(([k]) => k));

    // 4. 消失的项：放进 ghost 层原地淡出
    const vanished = [...oldRects.keys()].filter((k) => !newKeys.has(k));
    if (vanished.length) {
      ghost.classList.add("fml-ghost");
      Object.assign(ghost.style, {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${hostRect.width}px`,
        pointerEvents: "none",
        margin: "0",
      });
      // ghost 里只留下消失的那些项，其余隐形（它们由 FLIP 接管）
      keyedTerms(ghost).forEach(([k, el]) => {
        if (newKeys.has(k)) el.style.visibility = "hidden";
      });
      host.parentElement?.appendChild(ghost);
      ghost
        .animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: duration * 0.45,
          easing: "ease-out",
          fill: "forwards",
        })
        .addEventListener("finish", () => ghost.remove());
    }

    // 5. 保留的项做位移补间，新项淡入
    for (const [key, el] of entries) {
      const before = oldRects.get(key);
      const now = el.getBoundingClientRect();
      if (before && now.width > 0 && before.width > 0) {
        const dx = before.left - now.left;
        const dy = before.top - now.top;
        const sx = before.width / now.width;
        const sy = before.height / now.height;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01) {
          continue; // 没动就别动，省得抖
        }
        el.style.transformOrigin = "0 0";
        el.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
            { transform: "none" },
          ],
          { duration, easing: EASE },
        );
      } else {
        el.animate(
          [
            { opacity: 0, transform: "translateY(6px) scale(0.92)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: duration * 0.7, delay: duration * 0.25, easing: EASE, fill: "backwards" },
        );
      }
    }
  }, [tex, display, duration]);

  // 高亮态：由外部 activeTerm 驱动，加 class 交给 CSS
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.querySelectorAll<HTMLElement>(".tm").forEach((el) => {
      el.classList.toggle("is-active", !!activeTerm && termIdOf(el) === activeTerm);
      el.classList.toggle("is-dimmed", !!activeTerm && termIdOf(el) !== activeTerm);
    });
  }, [activeTerm, tex]);

  // 交互：点/悬停某一项 → 通知外部（去高亮对应的几何）
  useEffect(() => {
    const host = hostRef.current;
    if (!host || (!onTermClick && !onTermHover)) return;
    const pick = (e: Event): TermId | null => {
      const el = (e.target as Element).closest<HTMLElement>(".tm");
      return el ? (termIdOf(el) as TermId | null) : null;
    };
    const onClick = (e: Event) => {
      const id = pick(e);
      if (id) onTermClick?.(id);
    };
    const onOver = (e: Event) => onTermHover?.(pick(e));
    const onLeave = () => onTermHover?.(null);
    host.addEventListener("click", onClick);
    host.addEventListener("pointermove", onOver);
    host.addEventListener("pointerleave", onLeave);
    return () => {
      host.removeEventListener("click", onClick);
      host.removeEventListener("pointermove", onOver);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [onTermClick, onTermHover]);

  return (
    <div className={`fml-wrap ${className}`}>
      <div ref={hostRef} className="fml" />
    </div>
  );
}
