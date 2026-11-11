import { test } from "node:test";
import assert from "node:assert/strict";
import { isInside, parseFrontmatter } from "../src/skills/frontmatter.ts";

test("parses frontmatter and body", () => {
  const { meta, body } = parseFrontmatter("---\r\nname: x\ndescription: \"Use when: y\"\n---\n# Body\n");
  assert.equal(meta.name, "x");
  assert.equal(meta.description, "Use when: y");
  assert.equal(body, "# Body\n");
});

test("no frontmatter returns whole text", () => {
  assert.deepEqual(parseFrontmatter("# hi"), { meta: {}, body: "# hi" });
});

test("isInside blocks escapes", () => {
  assert.equal(isInside("/s/a", "/s/a/b.md", "/"), true);
  assert.equal(isInside("/s/a", "/s/ab/b.md", "/"), false);
  assert.equal(isInside("/s/a", "/s/b.md", "/"), false);
});
