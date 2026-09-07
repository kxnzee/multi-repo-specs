/** @fileoverview Executes the viewer with DOM and network adapters to verify user interactions. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import { inspectChangeImpact } from "../lib/query.js";

/** Minimal DOM element retaining rendered content and registered event handlers. */
class Element {
  children = [];
  events = new Map();
  dataset = {};
  classList = { add() {} };
  value = "";
  textContent = "";
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; this.textContent = ""; }
  setAttribute() {}
  addEventListener(name, handler) { this.events.set(name, handler); }
  fire(name) { this.events.get(name)?.({}); }
}

/** Builds shared current specs with active and archived historical Change paths. */
function graphFixture(changeIds = { active: "active", archived: "archived" }) {
  const nodes = [
    { id: "repository:web", type: "repository", repository_id: "web", state: "registered" },
    { id: "master-spec:checkout", type: "master-spec", capability: "checkout", state: "current" },
  ];
  const edges = [];
  for (const state of ["active", "archived"]) {
    const changeId = changeIds[state];
    const change = `change:${changeId}`;
    const delta = `delta-spec:${changeId}/checkout`;
    nodes.push(
      { id: change, type: "change", change_id: changeId, state },
      { id: delta, type: "delta-spec", change_id: changeId, capability: "checkout", state },
    );
    edges.push(
      { source: change, target: delta, relation: "contains" },
      { source: change, target: "master-spec:checkout", relation: "affects" },
      { source: delta, target: "master-spec:checkout", relation: "changes", operation: "MODIFIED" },
      { source: change, target: "repository:web", relation: "changes_in" },
    );
  }
  edges.push({ source: "repository:web", target: "master-spec:checkout", relation: "linked",
    via_changes: Object.values(changeIds) });
  return {
    nodes: nodes.map((node) => ({ ...node, status: "ok" })),
    edges: edges.map((edge, index) => ({ ...edge, id: `edge:${index}`, status: "ok" })),
    diagnostics: [], summary: { errors: 0, warnings: 0 },
  };
}

/** Loads the complete shipped app, replacing only browser boundaries and its absolute import. */
async function viewer(graph = graphFixture()) {
  const html = await readFile(new URL("../viewer/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../viewer/app.js", import.meta.url), "utf8");
  const elements = new Map([...html.matchAll(/id="([^"]+)"/gu)]
    .map(([, id]) => [id, new Element()]));
  const filters = new Map();
  for (const id of ["node-type-filters", "change-state-filters"]) {
    const fieldset = html.match(new RegExp(`<fieldset id="${id}"[^]*?</fieldset>`, "u"))[0];
    filters.set(id, [...fieldset.matchAll(/<input type="checkbox" value="([^"]+)"([^>]*)>/gu)]
      .map(([, value, attributes]) => Object.assign(new Element(), {
        value, checked: attributes.includes("checked"),
      })));
    for (const filter of filters.get(id)) {
      if (filter.value === "delta-spec") elements.set("delta-filter", filter);
    }
  }
  const datasets = [];
  const handlers = new Map();
  const timers = new Map();
  let nextTimer = 0;
  /** Captures the actual data sent to vis-network, including later updates. */
  class DataSet {
    constructor(items) { this.items = new Map(items.map((item) => [item.id, item])); datasets.push(this); }
    get(id) { return this.items.get(id); }
    update(items) {
      for (const item of items) this.items.set(item.id, { ...this.get(item.id), ...item });
    }
  }
  /** Implements network boundaries used by filtering, selection and viewport operations. */
  class Network {
    on(name, callback) { handlers.set(name, callback); }
    once() {}
    unselectAll() {}
    fit() {}
    moveTo() {}
    moveNode() {}
    getScale() { return 1; }
    getPosition() { return { x: 0, y: 0 }; }
    getPositions(ids) { return Object.fromEntries(ids.map((id) => [id, this.getPosition()])); }
  }
  const context = {
    inspectChangeImpact,
    fetch: async (url) => ({ ok: true, json: async () => url === "/graph.json" ? graph : {} }),
    performance: { now: () => 0 },
    document: {
      getElementById: (id) => elements.get(id),
      querySelectorAll: (selector) => filters.get(selector.split(" ")[0].slice(1)) ?? [],
      createElement: () => new Element(),
      addEventListener() {},
    },
    vis: { DataSet, Network },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame: (callback) => callback(),
  };
  await vm.runInNewContext(`(async () => {${app.replace(/^import .*;$/mu, "")}\n})()`, context);
  const [nodes, edges] = datasets;
  return {
    nodes, edges, elements,
    visible: (id) => !nodes.get(id).hidden,
    toggle(value, checked) {
      const filter = [...filters.values()].flat().find((item) => item.value === value);
      filter.checked = checked;
      filter.fire("change");
    },
    search(value) {
      elements.get("search").value = value;
      elements.get("search").fire("input");
      for (const { callback, delay } of timers.values()) if (delay === 70) callback();
    },
    select(id) { handlers.get("selectNode")({ nodes: [id] }); },
    reset() { elements.get("reset-view").fire("click"); },
  };
}

test("Archive is hidden by default and enabling it reveals distinct labels and styling", async () => {
  const ui = await viewer();
  assert.equal(ui.visible("change:active"), true);
  assert.equal(ui.visible("change:archived"), false);
  assert.equal(ui.visible("delta-spec:archived/checkout"), false);
  ui.toggle("archived", true);
  const active = ui.nodes.get("change:active");
  const archived = ui.nodes.get("change:archived");
  assert.equal(ui.visible(active.id), true);
  assert.equal(ui.visible(archived.id), true);
  assert.doesNotMatch(active.label, /Архив/u);
  assert.match(archived.label, /Архив/u);
  assert.match(archived.title, /Архивная/u);
  assert.notEqual(active.color.background, archived.color.background);
  assert.equal(archived.shapeProperties.borderDashes, true);
  assert.equal(active.shapeProperties.borderDashes, false);
  ui.toggle("delta-spec", true);
  assert.match(ui.nodes.get("delta-spec:archived/checkout").label, /Архив/u);
  assert.equal(ui.edges.get("edge:6").dashes, true);
  assert.equal(ui.edges.get("edge:2").dashes, false);
});

test("Lifecycle filters hide Changes and their deltas through search and neighbor selection", async () => {
  const ui = await viewer();
  ui.toggle("archived", true);
  ui.toggle("delta-spec", true);
  ui.toggle("archived", false);
  for (const action of [() => {}, () => ui.search("checkout"),
    () => ui.select("master-spec:checkout"), () => ui.select("repository:web"),
    () => ui.select("change:active"), () => ui.select("delta-spec:active/checkout")]) {
    action();
    assert.equal(ui.visible("change:archived"), false);
    assert.equal(ui.visible("delta-spec:archived/checkout"), false);
    assert.equal(ui.visible("master-spec:checkout"), true);
    assert.equal(ui.visible("repository:web"), true);
  }
  for (const edge of ui.edges.items.values()) {
    if (edge.from?.includes("archived") || edge.to?.includes("archived")) assert.equal(edge.hidden, true);
  }
  ui.search("archived");
  assert.equal([...ui.nodes.items.values()].filter((node) => !node.hidden).length, 0);
});

test("Archive-only and no-Change views compose with type filters and reset restores defaults", async () => {
  const ui = await viewer();
  ui.toggle("archived", true);
  ui.toggle("delta-spec", true);
  ui.toggle("active", false);
  assert.equal(ui.visible("change:active"), false);
  assert.equal(ui.visible("delta-spec:active/checkout"), false);
  assert.equal(ui.visible("change:archived"), true);
  assert.equal(ui.visible("delta-spec:archived/checkout"), true);
  ui.select("delta-spec:archived/checkout");
  assert.equal(ui.visible("change:archived"), true);
  ui.toggle("archived", false);
  assert.equal(ui.elements.get("delta-filter").disabled, true);
  assert.equal(ui.elements.get("layer-count").textContent, "2/5");
  assert.equal(ui.visible("change:archived"), false);
  assert.equal(ui.visible("delta-spec:archived/checkout"), false);
  assert.equal(ui.visible("master-spec:checkout"), true);
  assert.equal(ui.visible("repository:web"), true);
  ui.toggle("archived", true);
  assert.equal(ui.elements.get("delta-filter").disabled, false);
  assert.equal(ui.visible("delta-spec:archived/checkout"), true);
  assert.equal(ui.visible("delta-spec:active/checkout"), false);
  ui.search("missing");
  ui.reset();
  assert.equal(ui.elements.get("search").value, "");
  assert.equal(ui.elements.get("layer-count").textContent, "3/5");
  for (const state of ["active", "archived"]) {
    assert.equal(ui.visible(`change:${state}`), state === "active");
    assert.equal(ui.visible(`delta-spec:${state}/checkout`), false);
  }
});

test("Archive styling retains warning and error borders after selection", async () => {
  for (const [status, border] of [["warning", "#d97706"], ["error", "#dc2626"]]) {
    const graph = graphFixture();
    graph.nodes.find(({ id }) => id === "change:archived").status = status;
    graph.edges[5].status = status;
    const ui = await viewer(graph);
    ui.toggle("archived", true);
    ui.select("change:archived");
    const node = ui.nodes.get("change:archived");
    assert.equal(node.color.border, border);
    assert.equal(node.borderWidth, 4);
    assert.equal(node.shapeProperties.borderDashes, true);
    assert.match(node.label, /Архив/u);
    assert.match(ui.edges.get("edge:5").color.color,
      status === "error" ? /220,38,38/u : /217,119,6/u);
  }
});

test("Change names preserve exact IDs on canvas, in tooltips, details and connection rows", async () => {
  const changeIds = { active: "jit-100-Promote_checkout", archived: "jit-200-Archive_checkout" };
  const ui = await viewer(graphFixture(changeIds));
  ui.toggle("archived", true);
  for (const [state, changeId] of Object.entries(changeIds)) {
    const nodeId = `change:${changeId}`;
    const node = ui.nodes.get(nodeId);
    assert.equal(node.label, state === "archived" ? `${changeId}\nАрхив` : changeId);
    assert.equal(node.title, `Изменение: ${changeId} · ok · ${state === "archived" ? "Архивная" : "Активная"}`);
    ui.select(nodeId);
    const title = ui.elements.get("details").children[0];
    assert.equal(title.children[0].textContent, changeId);
    if (state === "archived") {
      assert.equal(title.children[1].className, "archive-badge");
      assert.equal(title.children[1].textContent, "Архив");
    } else {
      assert.equal(title.children.length, 1);
    }
  }
  ui.select("master-spec:checkout");
  /** Traverses the rendered inspector without relying on its nesting depth. */
  function descendants(element) {
    return [element, ...element.children.flatMap(descendants)];
  }
  const names = descendants(ui.elements.get("details"))
    .filter((element) => element.className === "entity-name entity-name-change")
    .map((element) => element.textContent);
  assert.deepEqual(new Set(names), new Set(Object.values(changeIds)));
});
