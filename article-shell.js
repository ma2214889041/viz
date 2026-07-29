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
      button.addEventListener("click", () => setPanel("story"));
    });
    addEventListener("keydown", (event) => {
      if (event.key === "Escape" && body.classList.contains("mobile-controls")) {
        setPanel("story");
      }
    });
  }
})();
