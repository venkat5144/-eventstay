import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error("No inline JavaScript block found in index.html");
for (const [index, match] of scripts.entries()) {
  if (match[1].trim()) new vm.Script(match[1], { filename: `index.html:inline-script-${index + 1}` });
}
console.log(`Checked ${scripts.length} inline script block(s).`);
