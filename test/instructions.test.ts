import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInstructions, skillIndex } from "../src/copilot/instructionsText.ts";
import { parseFrontmatter } from "../src/skills/frontmatter.ts";

const skills = [{ name: "standup", description: "Write a standup." }];

test("instructions apply to every request and list skills", () => {
  const { meta, body } = parseFrontmatter(buildInstructions(skills));
  assert.equal(meta.applyTo, "**");
  assert.match(body, /devassist_loadSkill/);
  assert.match(body, /- standup: Write a standup\./);
});

test("empty skill index says so", () => {
  assert.equal(skillIndex([]), "No DevAssist skills are installed.");
});
