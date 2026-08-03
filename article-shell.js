(() => {
  const body = document.body;
  const top = document.getElementById("top");
  const nav = document.getElementById("nav");
  const canvas = document.getElementById("gl");
  const story = document.getElementById("story");
  const controls = document.getElementById("ctrl");
  const hud = document.getElementById("hud");
  const previous = document.getElementById("prev");
  const next = document.getElementById("next");
  const storyBody = document.getElementById("stbody");
  let gasLabRun = 0;
  nav?.setAttribute("aria-label", "文章视图");
  canvas?.setAttribute("aria-hidden", "true");
  story?.setAttribute("aria-label", "逐章讲解");
  story?.setAttribute("aria-live", "polite");
  controls?.setAttribute("aria-label", "互动参数");
  hud?.setAttribute("aria-label", "实时数据");

  if (previous) previous.setAttribute("aria-label", "上一章");
  if (next) next.setAttribute("aria-label", "下一章");

  document.querySelectorAll("button").forEach((button) => {
    button.type = "button";
  });

  document.querySelectorAll(".card[data-go]").forEach((card) => {
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", card.querySelector("h3")?.textContent?.trim() || "开始互动");
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      card.click();
    });
  });

  const bindProofDetective = (root) => {
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "true";
    root.setAttribute("aria-live", "off");
    const feedback = root.querySelector(".proof-feedback");
    const buttons = [...root.querySelectorAll("[data-proof-step]")];
    let attempts = 0;
    const replies = {
      1: "第 1 步可以成立：零测度集合的 δ-邻域体积确实趋近 0。裂缝还在后面。",
      2: "第 2 步可以用 N(2δ)·δ³ ≲ V(Kδ) ≲ N(δ)·δ³ 夹住。它保留了决定维数的指数。继续往下找。",
      4: "如果第 3 步真是固定幂律，第 4 步的推导没有问题。所以最早的裂缝在它之前。"
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        if (root.classList.contains("solved")) return;
        attempts += 1;
        const step = Number(button.dataset.proofStep);
        if (button.hasAttribute("data-crack")) {
          root.classList.add("solved");
          button.classList.add("correct");
          buttons.forEach((candidate) => {
            candidate.disabled = true;
          });
          feedback.innerHTML = `
            <strong>裂缝在第 3 步。</strong>
            <p>盒维数只记录对数斜率，不保证存在固定常数 C，使 N(δ) ≍ Cδ<sup>−D</sup>。</p>
            <div class="proof-counterexample">
              <span>允许的慢因子</span>
              <b>N(δ) = δ<sup>−3</sup> / log(1/δ)</b>
              <i>维数仍是 3，但 N(δ)·δ³ = 1/log(1/δ) → 0</i>
            </div>
            <p>体积可以以“比任何正幂都慢”的速度消失，维数却仍保持 3。你找的是第一个非法替换，不只是错误结论。</p>
          `;
          document.dispatchEvent(new CustomEvent("viz:proof-crack", {
            detail: { scene: "kakeya", step: 3, attempts }
          }));
        } else {
          button.classList.add("wrong");
          button.disabled = true;
          feedback.textContent = replies[step];
        }
      });
    });
  };

  const drawCounterfactual = (canvas, result, minH, maxH, color) => {
    const context = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const left = 22;
    const right = width - 10;
    const topY = 12;
    const bottom = height - 22;
    const span = Math.max(.001, maxH - minH);
    const x = (index) => left + index / Math.max(1, result.values.length - 1) * (right - left);
    const y = (value) => bottom - (value - minH) / span * (bottom - topY);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "rgba(255,255,255,.10)";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(left, bottom);
    context.lineTo(right, bottom);
    context.stroke();
    const reversalX = x(result.reverseSample);
    context.setLineDash([4, 4]);
    context.strokeStyle = "rgba(255,255,255,.35)";
    context.beginPath();
    context.moveTo(reversalX, topY);
    context.lineTo(reversalX, bottom);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(255,255,255,.62)";
    context.font = "10px ui-monospace, monospace";
    context.fillText("反演", Math.min(reversalX + 4, right - 26), topY + 8);
    context.strokeStyle = color;
    context.lineWidth = 2.2;
    context.beginPath();
    result.values.forEach((value, index) => {
      if (index === 0) context.moveTo(x(index), y(value));
      else context.lineTo(x(index), y(value));
    });
    context.stroke();
    context.fillStyle = "rgba(255,255,255,.48)";
    context.fillText("H(t)", 3, topY + 8);
    context.fillText("同一时间尺度 →", right - 84, height - 6);
  };

  const runGasCounterfactual = async (root) => {
    const api = window.vizGasApi;
    if (!api || root.dataset.running === "true") return;
    const runId = ++gasLabRun;
    root.dataset.running = "true";
    root.classList.remove("done", "inconclusive");
    const runButton = root.querySelector("[data-cf-run]");
    const verdict = root.querySelector("[data-cf-verdict]");
    const earlyValue = root.querySelector('[data-cf-branch="early"] [data-cf-value]');
    const lateValue = root.querySelector('[data-cf-branch="late"] [data-cf-value]');
    runButton.disabled = true;
    runButton.textContent = "正在建立共享初态…";
    verdict.textContent = "两条轨道将使用完全相同的粒子位置和速度。";

    const totalSteps = 880;
    const sampleEvery = 4;
    const initialSignature = () => {
      let hash = 2166136261;
      const state = api.state;
      [state.px, state.py, state.pz, state.vx, state.vy, state.vz].forEach((array) => {
        const words = new Uint32Array(array.buffer, array.byteOffset, array.byteLength / 4);
        for (const word of words) hash = Math.imul(hash ^ word, 16777619) >>> 0;
      });
      return hash.toString(16).padStart(8, "0");
    };
    const reverse = () => {
      const state = api.state;
      for (let index = 0; index < state.N; index += 1) {
        state.vx[index] *= -1;
        state.vy[index] *= -1;
        state.vz[index] *= -1;
      }
    };
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    const runBranch = async (name, reverseStep, valueNode) => {
      const state = api.state;
      state.N = 520;
      state.r = .045;
      state.single = false;
      state.mode = "micro";
      state.speed = 1;
      api.init("same");
      state.running = false;
      api.stats();
      const signature = initialSignature();
      const values = [state.Hcur];
      let reverseH = 0;
      let peakH = -Infinity;
      let reverseSample = 0;

      for (let start = 0; start < totalSteps; start += 16) {
        if (runId !== gasLabRun || !root.isConnected) throw new Error("cancelled");
        const end = Math.min(totalSteps, start + 16);
        for (let step = start; step < end; step += 1) {
          api.step(.01);
          api.stats();
          if (step + 1 === reverseStep) {
            reverseH = state.Hcur;
            peakH = reverseH;
            reverse();
            state.reversed = performance.now();
            state.revH = reverseH;
            state.revPeak = reverseH;
            state.revIdx = values.length;
            reverseSample = values.length;
          } else if (step + 1 > reverseStep) {
            peakH = Math.max(peakH, state.Hcur);
            state.revPeak = peakH;
          }
          if ((step + 1) % sampleEvery === 0) values.push(state.Hcur);
        }
        const percent = Math.round(end / totalSteps * 100);
        valueNode.textContent = `${name}：${percent}%`;
        runButton.textContent = `${name} ${percent}%`;
        await nextFrame();
      }
      state.H = values.slice(-420);
      return {
        values,
        reverseSample,
        reverseH,
        peakH,
        delta: peakH - reverseH,
        reverseTime: reverseStep * .01,
        signature
      };
    };

    try {
      const early = await runBranch("轨道 A", 52, earlyValue);
      earlyValue.textContent = `t=${early.reverseTime.toFixed(2)} 反演 · 峰值回升 ${early.delta.toFixed(2)}`;
      const late = await runBranch("轨道 B", 720, lateValue);
      lateValue.textContent = `t=${late.reverseTime.toFixed(2)} 反演 · 峰值回升 ${late.delta.toFixed(2)}`;
      const allValues = [...early.values, ...late.values];
      let minH = Math.min(...allValues);
      let maxH = Math.max(...allValues);
      const padding = Math.max(.08, (maxH - minH) * .1);
      minH -= padding;
      maxH += padding;
      drawCounterfactual(root.querySelector('[data-cf-branch="early"] canvas'), early, minH, maxH, "#5ee7ff");
      drawCounterfactual(root.querySelector('[data-cf-branch="late"] canvas'), late, minH, maxH, "#ffc457");
      const separation = early.delta - late.delta;
      const sameInitialState = early.signature === late.signature;
      root.querySelector(".cf-rule").textContent =
        `同一 seed 20260723 · 520 个粒子 · dt=0.01 · 初态校验码 ${early.signature} ${sameInitialState ? "一致" : "不一致"}`;
      if (!sameInitialState) {
        root.classList.add("inconclusive");
        verdict.innerHTML = "<strong>实验无效。</strong>两条轨道没有通过初态一致性校验，因此不能归因于反演时刻。";
      } else if (separation > .12) {
        root.classList.add("done");
        verdict.innerHTML = `<strong>因果差异成立。</strong>相同初态、相同规则，只把反演推迟到平衡后，H 的回升幅度减少了 ${separation.toFixed(2)}。丢失的不是可逆定律，而是能让系统沿原路返回的精细关联。`;
      } else {
        root.classList.add("inconclusive");
        verdict.innerHTML = `<strong>本次区分度不足。</strong>两条轨道的回升差只有 ${separation.toFixed(2)}；离散碰撞误差盖过了反事实差异，请用同一初态重跑。`;
      }
      if (sameInitialState) {
        document.dispatchEvent(new CustomEvent("viz:evidence", {
          detail: {
            scene: "gas",
            kind: "gas-reversal",
            delta: early.delta,
            lateDelta: late.delta
          }
        }));
      }
      api.state.running = true;
      runButton.textContent = "用同一初态重跑";
    } catch (error) {
      if (error.message !== "cancelled") {
        root.classList.add("inconclusive");
        verdict.textContent = "实验中断，请重新运行。";
      }
    } finally {
      if (runId === gasLabRun && root.isConnected) {
        root.dataset.running = "false";
        runButton.disabled = false;
      }
    }
  };

  const bindCounterfactualLab = (root) => {
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "true";
    root.setAttribute("aria-live", "off");
    root.querySelector("[data-cf-run]")?.addEventListener("click", () => {
      runGasCounterfactual(root);
    });
  };

  const bindStoryInteractives = () => {
    const proof = storyBody?.querySelector("[data-proof-detective]");
    const counterfactual = storyBody?.querySelector("[data-counterfactual-lab]");
    body.classList.toggle("proof-active", Boolean(proof));
    body.classList.toggle("counterfactual-active", Boolean(counterfactual));
    if (proof) bindProofDetective(proof);
    if (counterfactual) bindCounterfactualLab(counterfactual);
  };

  if (storyBody) {
    new MutationObserver(bindStoryInteractives).observe(storyBody, {
      childList: true,
      subtree: true
    });
    bindStoryInteractives();
  }

  /* 手机上讲解面板只有 ~46vh，长章节要在一个小窗口里滚一千多像素。
     给它一个展开键，读的时候可以把面板拉到接近满屏。 */
  if (story) {
    const expand = document.createElement("button");
    expand.type = "button";
    expand.id = "storyExpand";
    expand.setAttribute("aria-expanded", "false");
    expand.setAttribute("aria-label", "展开讲解面板");
    expand.textContent = "展开";
    story.appendChild(expand);
    expand.addEventListener("click", () => {
      const on = body.classList.toggle("story-expanded");
      expand.textContent = on ? "收起" : "展开";
      expand.setAttribute("aria-expanded", String(on));
      expand.setAttribute("aria-label", on ? "收起讲解面板" : "展开讲解面板");
    });
    /* 换章时收回去，免得下一章明明很短却顶满屏幕 */
    if (storyBody) {
      new MutationObserver(() => {
        if (!body.classList.contains("story-expanded")) return;
        body.classList.remove("story-expanded");
        expand.textContent = "展开";
        expand.setAttribute("aria-expanded", "false");
      }).observe(storyBody, { childList: true });
    }
  }

  if (top) {
    /* 手机上右栏整列被藏起来，图表也跟着消失了 —— 而第 3 章讲的就是那张直方图。
       所以移动端面板从两档改成三档，图表有自己的一档。 */
    const charts = document.getElementById("charts");
    const rightColumn = document.getElementById("right");

    if (charts && rightColumn) {
      const empty = document.createElement("p");
      empty.className = "charts-empty";
      empty.textContent = "速率分布、Q(f,f) 与 H 曲线要等分布开始变形才有内容。先往下读一章，再回来看这里。";
      rightColumn.appendChild(empty);
    }

    const panelSwitch = document.createElement("div");
    panelSwitch.id = "mobilePanels";
    panelSwitch.setAttribute("aria-label", "移动端互动面板");
    panelSwitch.innerHTML = `
      <button type="button" data-mobile-panel="story" class="on" aria-pressed="true">讲解</button>
      ${charts ? '<button type="button" data-mobile-panel="charts" aria-pressed="false">图表</button>' : ""}
      <button type="button" data-mobile-panel="controls" aria-pressed="false">参数</button>
    `;
    top.insertAdjacentElement("afterend", panelSwitch);

    const panelButtons = [...panelSwitch.querySelectorAll("button")];
    const setPanel = (name) => {
      body.classList.toggle("mobile-controls", name === "controls");
      body.classList.toggle("mobile-charts", name === "charts");
      panelButtons.forEach((button) => {
        const active = button.dataset.mobilePanel === name;
        button.classList.toggle("on", active);
        button.setAttribute("aria-pressed", String(active));
      });
    };

    panelButtons.forEach((button) => {
      button.addEventListener("click", () => setPanel(button.dataset.mobilePanel));
    });
    nav?.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => setPanel("story"));
    });
    addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (body.classList.contains("mobile-controls") || body.classList.contains("mobile-charts")) {
        setPanel("story");
      }
    });

    /* 正文里的「打开图表」按钮：手机上直接跳到图表那一档，
       电脑上本来就看得见，所以按钮只闪一下右栏。 */
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-charts]");
      if (!trigger) return;
      event.preventDefault();
      if (matchMedia("(max-width:900px)").matches) {
        setPanel("charts");
        return;
      }
      if (!charts) return;
      charts.classList.remove("flash");
      void charts.offsetWidth;
      charts.classList.add("flash");
    });

    /* 同理的「打开参数」按钮。正文里说「在参数面板里按某个键」的地方，
       手机上得先切到那一档才找得到，电脑上闪一下控制栏就够了。 */
    const ctrl = document.getElementById("ctrl");
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-controls]");
      if (!trigger) return;
      event.preventDefault();
      if (matchMedia("(max-width:900px)").matches) {
        setPanel("controls");
        return;
      }
      if (!ctrl) return;
      ctrl.classList.remove("flash");
      void ctrl.offsetWidth;
      ctrl.classList.add("flash");
    });
  }
})();
