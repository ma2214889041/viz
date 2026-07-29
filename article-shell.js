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
  const predictionState = new Map();
  const challengeByScene = {
    kakeya: {
      eyebrow: "先下注，再看证明",
      prompt: "如果一个集合的体积可以任意接近 0，它的维数会怎样？",
      context: "不要凭文章标题猜。先把你现在的直觉留下来，后面用盒计数和定理检验它。",
      options: [
        ["collapse", "也会趋近 0"],
        ["sheet", "最多只剩 2 维"],
        ["full", "仍然必须是 3"]
      ],
      answer: "full",
      revealStep: 8,
      action: "读取盒计数",
      event: "kakeya-dimension"
    },
    gas: {
      eyebrow: "洛施密特的赌局",
      prompt: "系统演化一小会儿后，把所有粒子的速度精确取反，H 会怎样？",
      context: "微观定律可逆，但 H 定理说 H 只减不增。两句话正面冲突时，你押哪一边？",
      options: [
        ["down", "继续下降"],
        ["rise", "沿原路回升"],
        ["flat", "立刻保持不变"]
      ],
      answer: "rise",
      revealStep: 4,
      action: "运行双轨实验",
      event: "gas-reversal"
    }
  };

  const sceneForCard = (card) => {
    const scene = card?.dataset?.go;
    return challengeByScene[scene] ? scene : null;
  };

  const optionLabel = (challenge, answer) =>
    challenge.options.find(([id]) => id === answer)?.[1] || answer;

  const ensureReceipt = () => {
    let receipt = document.getElementById("predictionReceipt");
    if (receipt) return receipt;
    receipt = document.createElement("aside");
    receipt.id = "predictionReceipt";
    receipt.setAttribute("aria-live", "polite");
    receipt.hidden = true;
    document.body.append(receipt);
    return receipt;
  };

  const renderReceipt = (scene, mode = "waiting", evidence = null) => {
    const state = predictionState.get(scene);
    const challenge = challengeByScene[scene];
    if (!state || !challenge) return;
    const receipt = ensureReceipt();
    const chosen = optionLabel(challenge, state.answer);
    let status = "预测已记录";
    let detail = `你选择了“${chosen}”`;
    let action = "";

    if (mode === "ready") {
      status = "轮到实验作证";
      detail = scene === "gas"
        ? "从同一初态运行早期与平衡后两种反演"
        : "读取盒计数，系统会返回最细尺度上的实测维数";
      action = `<button type="button" data-evidence-action="${scene}">${challenge.action}</button>`;
    } else if (mode === "measured") {
      const correct = state.answer === evidence.observed;
      status = correct ? "预测与观测一致" : "预测被观测反驳";
      detail = evidence.text;
      receipt.classList.toggle("is-correct", correct);
      receipt.classList.toggle("is-wrong", !correct);
    } else {
      receipt.classList.remove("is-correct", "is-wrong");
    }

    receipt.dataset.scene = scene;
    receipt.innerHTML = `
      <div>
        <span>${status}</span>
        <strong>${detail}</strong>
      </div>
      ${action}
      <button type="button" class="receipt-close" aria-label="收起预测记录">×</button>
    `;
    receipt.hidden = false;
    receipt.querySelector(".receipt-close")?.addEventListener("click", () => {
      receipt.hidden = true;
    });
    receipt.querySelector("[data-evidence-action]")?.addEventListener("click", () => {
      if (scene === "kakeya" && typeof window.vizReadKakeyaEvidence === "function") {
        window.vizReadKakeyaEvidence();
        if (!document.getElementById("b_box")?.classList.contains("on")) {
          document.getElementById("b_box")?.click();
        }
      } else {
        const labButton = document.querySelector("[data-counterfactual-lab] [data-cf-run]");
        (labButton || document.getElementById("b_early"))?.click();
      }
      if (scene === "gas") {
        receipt.querySelector("span").textContent = "实验运行中";
        receipt.querySelector("strong").textContent = "正在等待反演后的 H 曲线形成…";
        receipt.querySelector("[data-evidence-action]")?.remove();
      }
    });
  };

  const enterScene = (scene) => {
    if (typeof window.setScene === "function") window.setScene(scene);
    else document.querySelector(`[data-go="${scene}"]`)?.click();
    const state = predictionState.get(scene);
    renderReceipt(scene, state?.measured ? "measured" : "waiting", state?.evidence);
  };

  const openPrediction = (scene) => {
    const challenge = challengeByScene[scene];
    if (!challenge) return enterScene(scene);
    let overlay = document.getElementById("predictionGate");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "predictionGate";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      document.body.append(overlay);
    }
    overlay.innerHTML = `
      <div class="prediction-card">
        <div class="prediction-eyebrow">${challenge.eyebrow}</div>
        <h2>${challenge.prompt}</h2>
        <p>${challenge.context}</p>
        <div class="prediction-options">
          ${challenge.options.map(([id, label], index) =>
            `<button type="button" data-answer="${id}"><i>${index + 1}</i>${label}</button>`
          ).join("")}
        </div>
        <small>答案不会立刻揭晓。先进入模型，亲手找证据。</small>
      </div>
    `;
    overlay.classList.add("open");
    body.classList.add("prediction-open");
    overlay.querySelector("button")?.focus();
    overlay.querySelectorAll("[data-answer]").forEach((button) => {
      button.addEventListener("click", () => {
        predictionState.set(scene, { answer: button.dataset.answer, measured: false });
        overlay.classList.remove("open");
        body.classList.remove("prediction-open");
        enterScene(scene);
      });
    });
  };

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
    card.addEventListener("click", (event) => {
      const scene = sceneForCard(card);
      if (!scene || predictionState.has(scene)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openPrediction(scene);
    }, { capture: true });
  });

  nav?.querySelectorAll("[data-go]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const scene = sceneForCard(button);
      if (!scene || predictionState.has(scene)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openPrediction(scene);
    }, { capture: true });
  });

  const stepNumber = document.getElementById("stepno");
  if (stepNumber) {
    new MutationObserver(() => {
      const scene = body.classList.contains("g") ? "gas" : body.classList.contains("k") ? "kakeya" : null;
      if (!scene || !predictionState.has(scene)) return;
      const current = Math.max(0, parseInt(stepNumber.textContent, 10) - 1);
      if (current >= challengeByScene[scene].revealStep && !predictionState.get(scene).measured) {
        renderReceipt(scene, "ready");
      }
    }).observe(stepNumber, { childList: true, characterData: true, subtree: true });
  }

  document.addEventListener("viz:evidence", (event) => {
    const { scene, kind } = event.detail || {};
    const challenge = challengeByScene[scene];
    const state = predictionState.get(scene);
    if (!challenge || !state || challenge.event !== kind) return;
    state.measured = true;
    let evidence;
    if (scene === "gas") {
      const delta = Number(event.detail.delta);
      const lateDelta = Number(event.detail.lateDelta);
      evidence = {
        observed: delta > .05 ? "rise" : delta < -.05 ? "down" : "flat",
        text: Number.isFinite(lateDelta)
          ? `实测峰值：早期 +${delta.toFixed(2)}；平衡后 +${lateDelta.toFixed(2)}`
          : `实测：反演后 H 的峰值${delta >= 0 ? "回升" : "下降"} ${Math.abs(delta).toFixed(2)}`
      };
    } else {
      const dimension = Number(event.detail.dimension);
      evidence = {
        observed: dimension > 2.7 ? "full" : dimension > 1.5 ? "sheet" : "collapse",
        text: `盒计数实测 D ≈ ${dimension.toFixed(2)}，并继续趋向 3`
      };
    }
    state.evidence = evidence;
    renderReceipt(scene, "measured", evidence);
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

  if (top) {
    const panelSwitch = document.createElement("div");
    panelSwitch.id = "mobilePanels";
    panelSwitch.setAttribute("aria-label", "移动端互动面板");
    panelSwitch.innerHTML = `
      <button type="button" data-mobile-panel="story" class="on" aria-pressed="true">讲解</button>
      <button type="button" data-mobile-panel="controls" aria-pressed="false">参数</button>
    `;
    top.insertAdjacentElement("afterend", panelSwitch);

    const panelButtons = [...panelSwitch.querySelectorAll("button")];
    const setPanel = (name) => {
      body.classList.toggle("mobile-controls", name === "controls");
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
      button.addEventListener("click", () => {
        setPanel("story");
        if (!challengeByScene[button.dataset.go]) {
          const receipt = document.getElementById("predictionReceipt");
          if (receipt) receipt.hidden = true;
        }
      });
    });
    addEventListener("keydown", (event) => {
      if (event.key === "Escape" && body.classList.contains("mobile-controls")) {
        setPanel("story");
      }
    });
  }
})();
