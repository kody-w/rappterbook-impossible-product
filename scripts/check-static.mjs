import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const frame = JSON.parse(await readFile(resolve(root, "evolution/frames/frame-01.json"), "utf8"));
const timeline = JSON.parse(await readFile(resolve(root, "evolution/timeline.json"), "utf8"));
const failures = [];

function check(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}

check(frame.strategyLenses.length === 8, "Frame evidence must preserve all eight strategy lenses.");
check(frame.selectedMutations.length === 3, "Frame evidence must select exactly three mutations.");
check(timeline.frames.length === 12, "Evolution timeline must contain exactly 12 frames.");
check(timeline.frames[0].status === "shipped", "Frame 1 must be marked shipped.");
check(timeline.frames.slice(1).every((item) => item.status === "pending"), "Frames 2–12 must be pending.");
check(html.includes('href="#main-content"'), "Page must include a skip link.");
check(html.includes("prefers-reduced-motion") || (await readFile(resolve(root, "styles.css"), "utf8")).includes("prefers-reduced-motion"), "Styles must honor reduced motion.");
check(html.includes("Content-Security-Policy"), "Page must declare a restrictive content security policy.");
check(!/(?:src|href)=["']https?:\/\//i.test(html), "Page must not load third-party runtime resources.");

const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]);
for (const reference of references) {
  if (reference.startsWith("#") || reference.startsWith("data:")) {
    continue;
  }
  const localPath = reference.replace(/^\.\//, "").split(/[?#]/)[0];
  try {
    await access(resolve(root, localPath || "."));
  } catch {
    failures.push(`Missing local resource referenced by index.html: ${reference}`);
  }
}

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`FAIL: ${failure}`));
  process.exitCode = 1;
} else {
  console.log(`Static checks passed (${references.length} local references, 8 lenses, 3 mutations, 12 frames).`);
}
