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
      action: "运行早期反演",
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
        ? "运行早期反演，系统会记录反演前后的 H"
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
        document.getElementById("b_early")?.click();
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
      evidence = {
        observed: delta > .05 ? "rise" : delta < -.05 ? "down" : "flat",
        text: `实测：反演后 H 的峰值${delta >= 0 ? "回升" : "下降"} ${Math.abs(delta).toFixed(2)}`
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
