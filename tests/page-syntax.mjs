/* 把每篇文章内联的 <script> 抽出来做语法检查。
   页面是纯静态的，没有构建步骤，语法错误只有打开浏览器才会暴露 —— 这里提前拦住。 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pages = ["boltzmann", "kakeya", "optimization", "reaction-diffusion"];
const shared = ["article-shell.js"];
const fail = [];
const report = [];

for (const page of pages) {
  const html = await readFile(join(root, page, "index.html"), "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  blocks.forEach((code, i) => {
    if (!code.trim()) return;
    try { new vm.Script(code, { filename: `${page}/index.html#script${i}` }); }
    catch (e) { fail.push(`${page} script#${i}: ${e.message}`); }
  });
  // 常见的手滑：标签没闭合
  const opens = (html.match(/<script\b/g) || []).length;
  const closes = (html.match(/<\/script>/g) || []).length;
  if (opens !== closes) fail.push(`${page}: <script> ${opens} 个 / </script> ${closes} 个`);
  // 每个正文里引用的 canvas / 元素 id 必须真的存在
  const ids = [...html.matchAll(/getElementById\('([A-Za-z0-9_]+)'\)|\$\('#([A-Za-z0-9_]+)'\)/g)]
    .map(m => m[1] || m[2]);
  const missing = [...new Set(ids)].filter(id => !new RegExp(`id="${id}"`).test(html));
  if (missing.length) fail.push(`${page}: 引用了不存在的 id ${missing.join(", ")}`);
  report.push({ page, scripts: blocks.length, refs: new Set(ids).size });
}

for (const file of shared) {
  const code = await readFile(join(root, file), "utf8");
  try { new vm.Script(code, { filename: file }); }
  catch (e) { fail.push(`${file}: ${e.message}`); }
}

if (fail.length) {
  console.error(JSON.stringify({ ok: false, failed: fail }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, report }));
