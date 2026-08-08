import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HTheorem } from "./demo/HTheorem";
import { termCssVars } from "./math/terms";
import "./styles.css";

// 语义色注入到 :root，canvas / 3D / CSS 共用同一份定义
const root = document.documentElement;
for (const [k, v] of Object.entries(termCssVars())) root.style.setProperty(k, v);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HTheorem />
  </StrictMode>,
);
