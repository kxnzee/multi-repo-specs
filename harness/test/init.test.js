import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initProject, parseRepository } from "../init/index.js";

async function temporaryProject(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "multi-repo-sdd-test-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function fakeOpenSpecInit(target) {
  await fs.mkdir(path.join(target, "openspec/specs"), { recursive: true });
  await fs.mkdir(path.join(target, "openspec/changes/archive"), { recursive: true });
  await fs.writeFile(
    path.join(target, "openspec/config.yaml"),
    "schema: spec-driven\n",
    "utf8",
  );
}

test("parseRepository accepts the documented id=url#branch format", () => {
  assert.deepEqual(parseRepository("ui=https://example.test/ui.git#main"), {
    id: "ui",
    url: "https://example.test/ui.git",
    defaultBranch: "main",
  });
});

test("parseRepository rejects ambiguous repository input", () => {
  assert.throws(() => parseRepository("UI=https://example.test/ui.git#main"), /Ожидается <id=url#branch>/);
  assert.throws(() => parseRepository("ui=https://example.test/ui.git"), /Ожидается <id=url#branch>/);
});

test("initProject creates the complete versioned skeleton", async (t) => {
  const target = await temporaryProject(t);
  let openSpecCalls = 0;

  const result = await initProject({
    target,
    repositories: [parseRepository("ui=https://example.test/ui.git#main")],
    openSpecRunner: async (projectPath) => {
      openSpecCalls += 1;
      await fakeOpenSpecInit(projectPath);
    },
  });

  assert.equal(openSpecCalls, 1);
  assert.equal(result.openSpecInitialized, true);
  assert.deepEqual(result.overwritten, []);

  const expectedFiles = [
    "openspec/config.yaml",
    "openspec/context/00-start-here.md",
    "openspec/context/01-product-context.md",
    "openspec/context/08-release-process.md",
    "openspec/context/system-map.yaml",
    "openspec/context/ADR/README.md",
    "openspec/context/_raw/README.md",
    "openspec/schemas/multi-repo-sdd/schema.yaml",
    "openspec/schemas/multi-repo-sdd/templates/research.md",
    ".qwen/commands/sdd-context.md",
    ".qwen/commands/sdd-apply.md",
    ".qwen/commands/sdd-verify.md",
    "QWEN.md",
    "sdd.yaml",
    "CODEOWNERS",
    ".gitignore",
  ];

  for (const relativePath of expectedFiles) {
    const stat = await fs.stat(path.join(target, relativePath));
    assert.equal(stat.isFile(), true, relativePath);
  }

  for (const relativePath of ["openspec/specs", "openspec/changes", ".qwen/commands"]) {
    const stat = await fs.stat(path.join(target, relativePath));
    assert.equal(stat.isDirectory(), true, relativePath);
  }

  const config = await fs.readFile(path.join(target, "openspec/config.yaml"), "utf8");
  assert.match(config, /^schema: multi-repo-sdd/m);
  assert.match(config, /Общайся с пользователем.*на русском языке/);

  const sddConfig = await fs.readFile(path.join(target, "sdd.yaml"), "utf8");
  assert.match(sddConfig, /id: "ui"/);
  assert.match(sddConfig, /url: "https:\/\/example\.test\/ui\.git"/);

  const rawReadme = await fs.readFile(
    path.join(target, "openspec/context/_raw/README.md"),
    "utf8",
  );
  assert.match(rawReadme, /При каждом вызове `\/sdd-context` агент заново сканирует/);

  const contextCommand = await fs.readFile(
    path.join(target, ".qwen/commands/sdd-context.md"),
    "utf8",
  );
  assert.match(contextCommand, /Проведи инвентаризацию структуры до чтения содержимого/);
  assert.match(contextCommand, /description: Собрать или актуализировать общий контекст проекта/);
  assert.match(contextCommand, /Следующий вызов должен снова полностью просканировать `_raw\/`/);
  assert.match(contextCommand, /Всегда общайся с пользователем на русском языке/);
  assert.match(contextCommand, /\/sdd-context` без аргументов/);
  assert.match(contextCommand, /Не создавай и не изменяй `openspec\/specs\/`, `openspec\/changes\/`/);
  assert.match(contextCommand, /действительно проверенный `repository-id` и точную Git-ревизию/);
  assert.match(contextCommand, /Задавай ровно один вопрос за раз/);
  assert.match(contextCommand, /context_status: needs_confirmation/);
  assert.match(contextCommand, /Никогда не записывай в контекст секреты/);

  const productContext = await fs.readFile(
    path.join(target, "openspec/context/01-product-context.md"),
    "utf8",
  );
  assert.match(productContext, /## Ключевые бизнес-сценарии/);
  assert.match(productContext, /## Известные ограничения/);

  const architectureContext = await fs.readFile(
    path.join(target, "openspec/context/03-architecture.md"),
    "utf8",
  );
  assert.match(architectureContext, /## Архитектурные инварианты/);
  assert.match(architectureContext, /## Запрещённые паттерны/);

  const securityContext = await fs.readFile(
    path.join(target, "openspec/context/05-security-and-compliance.md"),
    "utf8",
  );
  assert.match(securityContext, /## Зоны без автономии агента/);

  const qualityContext = await fs.readFile(
    path.join(target, "openspec/context/07-quality-gates.md"),
    "utf8",
  );
  assert.match(qualityContext, /## Критичные сценарии/);
  assert.match(qualityContext, /## Стратегия проверок/);

  const adrReadme = await fs.readFile(
    path.join(target, "openspec/context/ADR/README.md"),
    "utf8",
  );
  assert.match(adrReadme, /Alternatives considered/);
  assert.match(adrReadme, /После `sdd init` в каталоге `ADR\/` существует только этот `README\.md`/);
  assert.match(adrReadme, /Пример 1\. Асинхронная передача статуса заказа/);
  assert.match(adrReadme, /Пример 2\. Идемпотентность платёжной команды/);
  assert.match(adrReadme, /Пример 3\. Единый источник статуса клиента/);

  const qwenInstructions = await fs.readFile(path.join(target, "QWEN.md"), "utf8");
  assert.match(qwenInstructions, /Первое сообщение.*всегда начинай на русском языке/);

  for (const relativePath of [
    "openspec/context/00-start-here.md",
    "openspec/context/01-product-context.md",
    "openspec/context/02-domain-glossary.md",
    "openspec/context/03-architecture.md",
    "openspec/context/04-domain-model.md",
    "openspec/context/05-security-and-compliance.md",
    "openspec/context/06-cross-system-invariants.md",
    "openspec/context/07-quality-gates.md",
    "openspec/context/08-release-process.md",
  ]) {
    const contents = await fs.readFile(path.join(target, relativePath), "utf8");
    for (const todo of contents.matchAll(/<!-- TODO([\s\S]*?)-->/g)) {
      assert.match(todo[1], /\nquestion:/, `${relativePath}: TODO question`);
      assert.match(todo[1], /\nowner:/, `${relativePath}: TODO owner`);
      assert.match(todo[1], /\nexpected_source:/, `${relativePath}: TODO expected_source`);
    }
  }
});

test("initProject preserves existing files and restores only missing skeleton files", async (t) => {
  const target = await temporaryProject(t);
  let openSpecCalls = 0;
  const runner = async (projectPath) => {
    openSpecCalls += 1;
    await fakeOpenSpecInit(projectPath);
  };

  await initProject({ target, openSpecRunner: runner });

  const productContextPath = path.join(target, "openspec/context/01-product-context.md");
  const configPath = path.join(target, "openspec/config.yaml");
  const adrReadmePath = path.join(target, "openspec/context/ADR/README.md");
  const sddPath = path.join(target, "sdd.yaml");

  await fs.writeFile(productContextPath, "user-owned product context\n", "utf8");
  await fs.writeFile(configPath, "schema: user-schema\n", "utf8");
  await fs.writeFile(sddPath, "user-owned sdd config\n", "utf8");
  await fs.rm(adrReadmePath);

  const result = await initProject({ target, openSpecRunner: runner });

  assert.equal(openSpecCalls, 1, "OpenSpec init must not run again when config already exists");
  assert.equal(result.openSpecInitialized, false);
  assert.equal(await fs.readFile(productContextPath, "utf8"), "user-owned product context\n");
  assert.equal(await fs.readFile(configPath, "utf8"), "schema: user-schema\n");
  assert.equal(await fs.readFile(sddPath, "utf8"), "user-owned sdd config\n");
  assert.match(await fs.readFile(adrReadmePath, "utf8"), /Architecture Decision Records/);
  assert.ok(result.created.includes("openspec/context/ADR/README.md"));
  assert.ok(result.skipped.includes("openspec/context/01-product-context.md"));
  assert.deepEqual(result.overwritten, []);
});

test("initProject force overwrites every managed file and preserves extra files", async (t) => {
  const target = await temporaryProject(t);
  let openSpecCalls = 0;
  const runner = async (projectPath) => {
    openSpecCalls += 1;
    await fakeOpenSpecInit(projectPath);
  };

  await initProject({ target, openSpecRunner: runner });

  const productContextPath = path.join(target, "openspec/context/01-product-context.md");
  const configPath = path.join(target, "openspec/config.yaml");
  const sddPath = path.join(target, "sdd.yaml");
  const extraPath = path.join(target, "openspec/context/team-notes.md");

  await fs.writeFile(productContextPath, "custom product context\n", "utf8");
  await fs.writeFile(configPath, "schema: custom\n", "utf8");
  await fs.writeFile(sddPath, "custom sdd config\n", "utf8");
  await fs.writeFile(extraPath, "must survive force\n", "utf8");

  const result = await initProject({
    target,
    force: true,
    repositories: [parseRepository("ui=https://example.test/ui.git#main")],
    openSpecRunner: runner,
  });

  assert.equal(openSpecCalls, 1, "force must not re-run OpenSpec when its root exists");
  assert.equal(result.openSpecInitialized, false);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.skipped, []);
  assert.ok(result.overwritten.includes("openspec/context/01-product-context.md"));
  assert.ok(result.overwritten.includes("openspec/config.yaml"));
  assert.ok(result.overwritten.includes("sdd.yaml"));
  assert.match(await fs.readFile(productContextPath, "utf8"), /^# Product context/m);
  assert.match(await fs.readFile(configPath, "utf8"), /^schema: multi-repo-sdd/m);
  assert.match(await fs.readFile(sddPath, "utf8"), /id: "ui"/);
  assert.equal(await fs.readFile(extraPath, "utf8"), "must survive force\n");
});
