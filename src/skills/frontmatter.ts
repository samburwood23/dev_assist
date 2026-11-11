// No VS Code types here so it can be unit-tested.

export function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(md);
  if (!m) { return { meta: {}, body: md }; }
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) {
      let value = line.slice(i + 1).trim();
      // Allow optionally quoted values: description: "Use when..."
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
        value = value.slice(1, -1);
      }
      meta[line.slice(0, i).trim()] = value;
    }
  }
  return { meta, body: m[2] };
}

/** True if `target` is inside `dir` (blocks ../ escapes and absolute paths). */
export function isInside(dir: string, target: string, sep: string): boolean {
  const base = dir.endsWith(sep) ? dir : dir + sep;
  return target.startsWith(base);
}
