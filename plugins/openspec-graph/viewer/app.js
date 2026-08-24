/* global cancelAnimationFrame, clearTimeout, document, fetch, navigator, performance, requestAnimationFrame, setTimeout, vis */

import { inspectChangeImpact } from "/graph-query.js";

const renderStartedAt = performance.now();
const linkedSpringRatio = 0.1;
const labelZoomThreshold = 0.72;

const colors = {
  store: { background: "#4f46e5", border: "#3730a3", highlight: "#818cf8" },
  repository: { background: "#2563eb", border: "#1d4ed8", highlight: "#60a5fa" },
  "master-spec": { background: "#059669", border: "#047857", highlight: "#34d399" },
  change: { background: "#7c3aed", border: "#6d28d9", highlight: "#a78bfa" },
  "delta-spec": { background: "#d97706", border: "#b45309", highlight: "#fbbf24" },
};

const typeNames = {
  store: "Store",
  repository: "Репозиторий",
  "master-spec": "Мастер-спека",
  change: "Изменение",
  "delta-spec": "Дельта-спека",
};

const relationNames = {
  contains: "Содержит",
  affects: "Затрагивает",
  changes: "Изменяет",
  implemented_by: "Реализуется в",
  targets: "Затрагивает",
  depends_on: "Зависит от",
  calls: "Вызывает",
  publishes_to: "Публикует в",
  verifies: "Проверяет",
};

const operationNames = {
  ADDED: "Добавляет",
  MODIFIED: "Изменяет",
  REMOVED: "Удаляет",
  RENAMED: "Переименовывает",
};

const stateNames = {
  current: "Действующая",
  planned: "Планируется",
  active: "Активная",
  archived: "Архивная",
};

const [graph, viewerConfig] = await Promise.all([
  fetch("/graph.json").then((response) => {
    if (!response.ok) throw new Error(`Graph request failed: ${response.status}`);
    return response.json();
  }),
  fetch("/viewer-config.json").then((response) => {
    if (!response.ok) throw new Error(`Viewer config request failed: ${response.status}`);
    return response.json();
  }),
]);
const sourceActions = viewerConfig.sources ?? {};
const evidenceActions = viewerConfig.evidence ?? {};
const overviewScale = graph.nodes.length > 800 ? 0.3 : graph.nodes.length > 300 ? 0.38 : 0.48;

const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
const graphEdges = new Map(graph.edges.map((edge) => [edge.id, edge]));
const filterableNodeTypes = ["repository", "master-spec", "change", "delta-spec"];
const defaultNodeIds = new Set(graph.nodes
  .filter(({ type }) => filterableNodeTypes.includes(type))
  .map(({ id }) => id));
const deltaIdsByChange = new Map(graph.nodes
  .filter(({ type }) => type === "change")
  .map(({ id }) => [id, []]));
for (const edge of graph.edges) {
  if (edge.relation !== "contains" || !deltaIdsByChange.has(edge.source)) continue;
  if (graphNodes.get(edge.target)?.type === "delta-spec") {
    deltaIdsByChange.get(edge.source).push(edge.target);
  }
}
for (const deltaIds of deltaIdsByChange.values()) deltaIds.sort();

/** Converts one technical identifier segment to a display name. */
function humanizeSegment(value) {
  const words = String(value ?? "").replaceAll(/[-_]+/gu, " ");
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Без названия";
}

/** Preserves capability namespaces while making their segments readable. */
function humanizePath(value) {
  return String(value ?? "").split("/").map(humanizeSegment).join(" / ");
}

/** Builds a compact node label while retaining raw graph data for search. */
function friendlyNodeLabel(node) {
  if (!node) return "Неизвестный узел";
  if (node.type === "store") return node.store_id ?? node.label;
  if (node.type === "repository") return node.repository_id ?? node.label;
  if (node.type === "change") return humanizeSegment(node.change_id ?? node.label);
  return humanizePath(node.capability ?? node.label);
}

/** Wraps one complete graph-entity name so slashes remain visually grouped. */
function createEntityName(node, { compact = false, title = false } = {}) {
  const name = document.createElement("span");
  const type = filterableNodeTypes.includes(node?.type) ? node.type : "store";
  name.className = `entity-name entity-name-${type}`;
  if (compact) name.classList.add("entity-name-compact");
  if (title) name.classList.add("entity-name-title");
  name.textContent = friendlyNodeLabel(node);
  return name;
}

/** Creates the separator between two separately bounded entities. */
function createEntityArrow(label = "→") {
  const arrow = document.createElement("span");
  arrow.className = "entity-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = label;
  return arrow;
}

/** Translates a stored relationship to a Russian UI phrase. */
function friendlyEdgeLabel(edge) {
  if (Array.isArray(edge.operations) && edge.operations.length > 0) {
    return edge.operations.map((operation) => operationNames[operation] ?? operation).join(" · ");
  }
  return operationNames[edge.operation]
    ?? relationNames[edge.relation]
    ?? humanizeSegment(edge.relation);
}

/** Identifies a dependency between two Master Specs. */
function isMasterDependency(edge) {
  return edge.relation === "depends_on"
    && graphNodes.get(edge.source)?.type === "master-spec"
    && graphNodes.get(edge.target)?.type === "master-spec";
}

const masterDependencyEdges = graph.edges.filter(isMasterDependency);
const dependencyCounts = new Map(graph.nodes
  .filter(({ type }) => type === "master-spec")
  .map(({ id }) => [id, { incoming: 0, outgoing: 0 }]));
for (const edge of masterDependencyEdges) {
  dependencyCounts.get(edge.source).outgoing += 1;
  dependencyCounts.get(edge.target).incoming += 1;
}

/** Adapts the shared Change impact query to browser visibility sets. */
function impactForChange(changeNodeId) {
  const change = graphNodes.get(changeNodeId);
  const impact = inspectChangeImpact(graph, change?.change_id);
  const deltaIds = new Set(impact.delta_specs.map(({ id }) => id));
  const directMasterIds = new Set(impact.direct_master_specs.map(({ id }) => id));
  const dependentMasterIds = new Set(impact.dependent_master_specs.map(({ id }) => id));
  const totalMasterIds = new Set(impact.total_master_specs.map(({ id }) => id));
  return Object.freeze({
    deltaIds,
    directMasterIds,
    dependentMasterIds,
    totalMasterIds,
    directMasters: impact.direct_master_specs,
    dependentMasters: impact.dependent_master_specs,
    directRepositories: impact.direct_repositories,
    dependentRepositories: impact.dependent_repositories,
    focusEdgeIds: new Set(impact.edges.map(({ id }) => id)),
    focusNodeIds: new Set([
      changeNodeId,
      ...impact.edges.flatMap(({ source, target }) => [source, target]),
    ]),
  });
}

/** Returns whether one edge belongs to the exact default graph. */
function isDefaultEdge(edge) {
  if (!defaultNodeIds.has(edge.source) || !defaultNodeIds.has(edge.target)) return false;
  return edge.relation !== "affects" && edge.relation !== "targets";
}

/** Returns the deterministic local offset of one Delta Spec from its Change. */
function deltaOffset(index) {
  const angle = index * 2.399963229728653;
  const radius = 58 + Math.sqrt(index + 1) * 26;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/** Seeds stable repository clusters before the bounded force pass. */
function graphSeedPositions() {
  const positions = new Map();
  const repositories = graph.nodes
    .filter(({ type }) => type === "repository")
    .sort((left, right) => left.id.localeCompare(right.id));
  repositories.forEach((repository, index) => {
    const angle = Math.PI * 2 * index / Math.max(1, repositories.length) - Math.PI / 2;
    positions.set(repository.id, {
      x: Math.cos(angle) * 560,
      y: Math.sin(angle) * 390,
    });
  });
  const repositoryByMaster = new Map();
  for (const edge of graph.edges) {
    if (edge.relation !== "implemented_by") continue;
    if (graphNodes.get(edge.source)?.type !== "master-spec") continue;
    const current = repositoryByMaster.get(edge.source);
    if (!current || edge.target.localeCompare(current) < 0) {
      repositoryByMaster.set(edge.source, edge.target);
    }
  }
  const groupedMasters = new Map(repositories.map(({ id }) => [id, []]));
  const unassignedMasters = [];
  for (const master of graph.nodes
    .filter(({ type }) => type === "master-spec")
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const repositoryId = repositoryByMaster.get(master.id);
    if (groupedMasters.has(repositoryId)) groupedMasters.get(repositoryId).push(master.id);
    else unassignedMasters.push(master.id);
  }
  for (const [repositoryId, masterIds] of groupedMasters) {
    const center = positions.get(repositoryId);
    masterIds.forEach((masterId, index) => {
      const angle = index * 2.399963229728653;
      const radius = 88 + Math.sqrt(index + 1) * 36;
      positions.set(masterId, {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      });
    });
  }
  unassignedMasters.forEach((masterId, index) => {
    const angle = index * 2.399963229728653;
    const radius = 120 + Math.sqrt(index + 1) * 42;
    positions.set(masterId, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  });
  const changes = graph.nodes
    .filter(({ type }) => type === "change")
    .sort((left, right) => left.id.localeCompare(right.id));
  changes.forEach((change, index) => {
    const angle = Math.PI * 2 * index / Math.max(1, changes.length) - Math.PI / 2;
    positions.set(change.id, { x: Math.cos(angle) * 280, y: Math.sin(angle) * 205 });
  });
  for (const [changeId, deltaIds] of deltaIdsByChange) {
    const center = positions.get(changeId);
    deltaIds.forEach((deltaId, index) => {
      const offset = deltaOffset(index);
      positions.set(deltaId, { x: center.x + offset.x, y: center.y + offset.y });
    });
  }
  return positions;
}

const seedPositions = graphSeedPositions();

/** Projects one graph node into Obsidian-like vis-network data. */
function viewerNode(node) {
  const visible = defaultNodeIds.has(node.id);
  const seed = seedPositions.get(node.id);
  return {
    id: node.id,
    label: ["repository", "change"].includes(node.type) ? friendlyNodeLabel(node) : "",
    group: node.type,
    title: `${typeNames[node.type]}: ${friendlyNodeLabel(node)}`,
    hidden: !visible,
    physics: visible,
    ...(seed ? { x: seed.x, y: seed.y } : {}),
    fixed: ["repository", "master-spec"].includes(node.type)
      ? { x: true, y: true }
      : false,
    mass: node.type === "repository" ? 6 : node.type === "change" ? 3 : 1,
  };
}

/** Projects one graph edge into compact force-directed data. */
function viewerEdge(edge) {
  const dependency = isMasterDependency(edge);
  const operation = edge.relation === "affects" || edge.relation === "changes";
  return {
    id: edge.id,
    from: edge.source,
    to: edge.target,
    fullLabel: friendlyEdgeLabel(edge),
    label: "",
    arrows: dependency || operation || ["calls", "publishes_to"].includes(edge.relation)
      ? "to"
      : "",
    dashes: dependency,
    hidden: !isDefaultEdge(edge),
    physics: isDefaultEdge(edge),
    length: edge.relation === "implemented_by"
      ? 150
      : edge.relation === "affects"
        ? 180
        : dependency
          ? 125
          : 240,
    width: dependency ? 1.2 : 0.9,
    smooth: false,
  };
}

const nodes = new vis.DataSet(graph.nodes.map(viewerNode));
const edges = new vis.DataSet(graph.edges.map(viewerEdge));
const graphContainer = document.getElementById("graph");
const layoutStatus = document.getElementById("layout-status");
const details = document.getElementById("details");
const selectionKind = document.getElementById("selection-kind");
const search = document.getElementById("search");
const typeFilters = [...document.querySelectorAll("#node-type-filters input[type='checkbox']")];
const layersMenu = document.getElementById("layers-menu");
const layerCount = document.getElementById("layer-count");

const visibleBaseCount = defaultNodeIds.size;
const stabilizationIterations = visibleBaseCount > 800 ? 100 : visibleBaseCount > 300 ? 140 : 190;
const network = new vis.Network(graphContainer, { nodes, edges }, {
  autoResize: true,
  layout: { hierarchical: { enabled: false }, improvedLayout: false, randomSeed: 42 },
  physics: {
    enabled: true,
    solver: "forceAtlas2Based",
    forceAtlas2Based: {
      gravitationalConstant: -8,
      centralGravity: 0.002,
      springLength: 88,
      springConstant: 0.075,
      damping: 0.8,
      avoidOverlap: 0.2,
    },
    maxVelocity: 28,
    minVelocity: 0.7,
    timestep: 0.35,
    adaptiveTimestep: true,
    stabilization: {
      enabled: true,
      iterations: stabilizationIterations,
      updateInterval: 20,
      fit: true,
    },
  },
  interaction: {
    dragNodes: true,
    dragView: true,
    hideEdgesOnDrag: graph.nodes.length > 400,
    hideEdgesOnZoom: graph.nodes.length > 400,
    hover: true,
    multiselect: false,
    navigationButtons: false,
    tooltipDelay: 220,
    zoomView: true,
  },
  nodes: {
    borderWidth: 1,
    borderWidthSelected: 3,
    font: { color: "#334155", size: 13, face: "Inter, system-ui, sans-serif" },
    shadow: false,
  },
  groups: {
    store: { shape: "dot", size: 0, color: colors.store },
    repository: {
      shape: "dot",
      size: 28,
      color: colors.repository,
      font: { color: "#1e3a8a", size: 22, face: "Inter, system-ui, sans-serif" },
    },
    "master-spec": { shape: "dot", size: 10, color: colors["master-spec"] },
    change: {
      shape: "dot",
      size: 19,
      color: colors.change,
      font: { color: "#581c87", size: 20, face: "Inter, system-ui, sans-serif" },
    },
    "delta-spec": { shape: "dot", size: 8, color: colors["delta-spec"] },
  },
  edges: {
    smooth: false,
    arrows: { to: { enabled: true, scaleFactor: 0.42 } },
    color: { color: "rgba(100,116,139,0.34)", highlight: "#2563eb", hover: "#64748b" },
    font: {
      color: "#475569",
      size: 10,
      face: "Inter, system-ui, sans-serif",
      background: "rgba(255,255,255,0.9)",
      strokeWidth: 0,
      align: "middle",
    },
    selectionWidth: 2,
  },
});

const store = graph.nodes.find(({ type }) => type === "store");
const typeCounts = new Map();
for (const node of graph.nodes) typeCounts.set(node.type, (typeCounts.get(node.type) ?? 0) + 1);
document.getElementById("summary").textContent = [
  store ? `Store ${friendlyNodeLabel(store)}` : undefined,
  `${typeCounts.get("repository") ?? 0} репозиториев`,
  `${typeCounts.get("master-spec") ?? 0} мастер-спек`,
  `${typeCounts.get("change") ?? 0} изменений`,
].filter(Boolean).join(" · ");

/** Adds one labeled value to the inspector definition list. */
function addDetail(list, key, value) {
  if (value === undefined || value === null || value === "") return;
  const term = document.createElement("dt");
  term.textContent = key;
  const description = document.createElement("dd");
  description.textContent = String(value);
  list.append(term, description);
}

/** Adds one graph entity as a single visually bounded inspector value. */
function addEntityDetail(list, key, node) {
  if (!node) return;
  const term = document.createElement("dt");
  term.textContent = key;
  const description = document.createElement("dd");
  description.append(createEntityName(node, { compact: true }));
  list.append(term, description);
}

/** Creates the shared clickable file control and its action menu. */
function createFileControl({ path, label = path, copyValue = path }, source) {
  const control = document.createElement("span");
  control.className = "file-detail";
  const pathLink = document.createElement("a");
  pathLink.className = "file-link";
  pathLink.href = source.preview_url;
  pathLink.target = "_blank";
  pathLink.rel = "noopener";
  pathLink.textContent = label;
  const actions = document.createElement("span");
  actions.className = "file-actions";
  const toggle = document.createElement("button");
  toggle.className = "file-menu-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", `Действия с файлом ${label}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.textContent = "⋯";
  const menu = document.createElement("span");
  menu.className = "file-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const preview = document.createElement("a");
  preview.href = source.preview_url;
  preview.target = "_blank";
  preview.rel = "noopener";
  preview.setAttribute("role", "menuitem");
  preview.textContent = "Просмотреть";
  menu.append(preview);
  if (source.ide_url) {
    const openInIde = document.createElement("a");
    openInIde.href = source.ide_url;
    openInIde.setAttribute("role", "menuitem");
    openInIde.textContent = "Открыть в VS Code";
    menu.append(openInIde);
  }
  const copyPath = document.createElement("button");
  copyPath.type = "button";
  copyPath.setAttribute("role", "menuitem");
  copyPath.textContent = "Скопировать путь";
  copyPath.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      copyPath.textContent = "Скопировано";
    } catch {
      copyPath.textContent = "Не удалось скопировать";
    }
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    setTimeout(() => { copyPath.textContent = "Скопировать путь"; }, 1200);
  });
  menu.append(copyPath);
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const shouldOpen = menu.hidden;
    for (const openMenu of document.querySelectorAll(".file-menu")) openMenu.hidden = true;
    for (const openToggle of document.querySelectorAll(".file-menu-toggle")) {
      openToggle.setAttribute("aria-expanded", "false");
    }
    menu.hidden = !shouldOpen;
    toggle.setAttribute("aria-expanded", String(shouldOpen));
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
  actions.append(toggle, menu);
  control.append(pathLink, actions);
  return control;
}

/** Adds a clickable source path with a compact action menu. */
function appendFileDetail(list, data) {
  if (!data.path) return;
  const source = sourceActions[data.id];
  if (!source) {
    addDetail(list, "Файл", data.path);
    return;
  }
  const term = document.createElement("dt");
  term.textContent = "Файл";
  const description = document.createElement("dd");
  description.append(createFileControl({ path: data.path }, source));
  list.append(term, description);
}

/** Adds source evidence to the inspector. */
function appendSources(data) {
  if (!Array.isArray(data.provenance) || data.provenance.length === 0) return;
  const sources = document.createElement("section");
  sources.className = "details-sources";
  const heading = document.createElement("h3");
  heading.textContent = "Источники";
  const items = document.createElement("ul");
  for (const reference of data.provenance) {
    const item = document.createElement("li");
    const source = evidenceActions[reference];
    if (source) {
      item.append(createFileControl({
        path: source.path,
        label: reference,
        copyValue: reference,
      }, source));
    } else {
      item.textContent = reference;
    }
    items.append(item);
  }
  sources.append(heading, items);
  details.append(sources);
}

/** Appends one batch and exposes the remaining items through a real button. */
function appendExpandableItems(items, values, batchSize, createItem) {
  let rendered = Math.min(batchSize, values.length);
  for (const value of values.slice(0, rendered)) items.append(createItem(value));
  if (rendered === values.length) return;
  const moreItem = document.createElement("li");
  moreItem.className = "details-more";
  const moreButton = document.createElement("button");
  moreButton.className = "details-more-button";
  moreButton.type = "button";
  /** Synchronizes the visible and accessible remaining-item count. */
  function updateMoreButton() {
    const remaining = values.length - rendered;
    moreButton.textContent = `Ещё ${remaining}`;
    moreButton.setAttribute("aria-label", `Показать ещё ${remaining} элементов`);
  }
  moreButton.addEventListener("click", () => {
    const next = Math.min(rendered + batchSize, values.length);
    for (const value of values.slice(rendered, next)) {
      items.insertBefore(createItem(value), moreItem);
    }
    rendered = next;
    if (rendered === values.length) moreItem.remove();
    else updateMoreButton();
  });
  updateMoreButton();
  moreItem.append(moreButton);
  items.append(moreItem);
}

/** Appends a progressively expandable human-readable node list. */
function appendNodeList(title, values, className, dataName, dataValue) {
  if (values.length === 0) return;
  const section = document.createElement("section");
  section.className = `details-connections ${className}`;
  const heading = document.createElement("h3");
  heading.textContent = `${title} (${values.length})`;
  const items = document.createElement("ul");
  appendExpandableItems(items, values, 40, (value) => {
    const item = document.createElement("li");
    if (dataName) item.dataset[dataName] = dataValue;
    item.textContent = friendlyNodeLabel(value);
    return item;
  });
  section.append(heading, items);
  details.append(section);
}

/** Renders one relationship row with separately bounded entities. */
function createConnectionItem(edge) {
  const item = document.createElement("li");
  item.className = "connection-route";
  const source = graphNodes.get(edge.source);
  const target = graphNodes.get(edge.target);
  const relation = document.createElement("span");
  relation.className = "connection-relation";
  relation.textContent = friendlyEdgeLabel(edge);
  item.append(
    createEntityName(source, { compact: true }),
    relation,
    createEntityArrow(),
    createEntityName(target, { compact: true }),
  );
  return item;
}

/** Adds every direct relationship of a selected node without flooding the inspector. */
function appendConnections(nodeId) {
  const selected = graphNodes.get(nodeId);
  const related = graph.edges.filter((edge) => (
    (edge.source === nodeId || edge.target === nodeId)
    && !(selected?.type === "master-spec" && isMasterDependency(edge))
  ));
  if (related.length === 0) return;
  const section = document.createElement("section");
  section.className = "details-connections";
  const heading = document.createElement("h3");
  heading.textContent = `Связи (${related.length})`;
  const items = document.createElement("ul");
  appendExpandableItems(items, related, 30, createConnectionItem);
  section.append(heading, items);
  details.append(section);
}

/** Adds separate outgoing and incoming Master Spec dependency lists. */
function appendMasterDependencies(nodeId) {
  const outgoing = masterDependencyEdges
    .filter(({ source }) => source === nodeId)
    .map(({ target }) => graphNodes.get(target));
  const incoming = masterDependencyEdges
    .filter(({ target }) => target === nodeId)
    .map(({ source }) => graphNodes.get(source));
  appendNodeList("Зависит от", outgoing, "dependency-list", "direction", "outgoing");
  appendNodeList("От неё зависят", incoming, "dependency-list", "direction", "incoming");
}

/** Adds direct and dependent impact lists for one Change. */
function appendChangeImpact(impact) {
  appendNodeList("Напрямую изменяет", impact.directMasters, "change-impact-list", "impact", "direct");
  appendNodeList(
    "Зависимое влияние",
    impact.dependentMasters,
    "change-impact-list",
    "impact",
    "dependent",
  );
  appendNodeList(
    "Прямо затронутые репозитории",
    impact.directRepositories,
    "change-impact-list",
    "impact",
    "direct",
  );
  appendNodeList(
    "Репозитории с зависимым влиянием",
    impact.dependentRepositories,
    "change-impact-list",
    "impact",
    "dependent",
  );
}

/** Renders curated information for one graph node. */
function renderNode(nodeId) {
  const data = graphNodes.get(nodeId);
  if (!data) return;
  const changeImpact = data.type === "change" ? impactForChange(data.id) : undefined;
  details.className = "";
  details.replaceChildren();
  selectionKind.textContent = typeNames[data.type];
  const title = document.createElement("h3");
  title.className = "details-title";
  title.append(createEntityName(data, { title: true }));
  const list = document.createElement("dl");
  list.className = "details-grid";
  if (data.type === "store") addDetail(list, "ID Store", data.store_id);
  if (data.type === "repository") addDetail(list, "ID репозитория", data.repository_id);
  if (data.type === "change") addDetail(list, "ID изменения", data.change_id);
  if (changeImpact) {
    addDetail(list, "Дельта-спеки", changeImpact.deltaIds.size);
    addDetail(list, "Прямые Master Specs", changeImpact.directMasterIds.size);
    addDetail(list, "Зависимые Master Specs", changeImpact.dependentMasterIds.size);
    addDetail(list, "Общий impact", changeImpact.totalMasterIds.size);
  }
  if (["master-spec", "delta-spec"].includes(data.type)) {
    addEntityDetail(list, "Возможность", data);
  }
  if (data.type === "master-spec") {
    const counts = dependencyCounts.get(data.id);
    addDetail(list, "Зависит от", counts.outgoing);
    addDetail(list, "Зависят от неё", counts.incoming);
  }
  if (data.type === "delta-spec") addDetail(list, "Изменение", data.change_id);
  addDetail(list, "Состояние", stateNames[data.state] ?? data.state);
  appendFileDetail(list, data);
  details.append(title, list);
  if (changeImpact) appendChangeImpact(changeImpact);
  if (data.type === "master-spec") appendMasterDependencies(nodeId);
  appendConnections(nodeId);
}

/** Renders curated information for one graph edge. */
function renderEdge(edgeId) {
  const data = graphEdges.get(edgeId);
  if (!data) return;
  details.className = "";
  details.replaceChildren();
  selectionKind.textContent = friendlyEdgeLabel(data);
  const title = document.createElement("h3");
  title.className = "details-title entity-route";
  const source = graphNodes.get(data.source);
  const target = graphNodes.get(data.target);
  title.append(
    createEntityName(source, { title: true }),
    createEntityArrow(),
    createEntityName(target, { title: true }),
  );
  const list = document.createElement("dl");
  list.className = "details-grid";
  addDetail(list, "Связь", friendlyEdgeLabel(data));
  addDetail(list, "Контракт", data.contract);
  addDetail(list, "Источник", data.derived
    ? "Получена из OpenSpec и конфигурации Store"
    : "Объявлена в graph.yaml");
  details.append(title, list);
  appendSources(data);
}

/** Clears the inspector when canvas selection is empty. */
function clearDetails() {
  selectionKind.textContent = "Ничего не выбрано";
  details.className = "details-empty";
  details.textContent = "Выберите узел или связь.";
}

let visibleNodeIds = new Set(defaultNodeIds);
let selectedNodeId;
let selectedNodeIds = new Set();
let focusedEdgeIds = new Set();
let focusNodeIds = new Set();
let directImpactIds = new Set();
let dependentImpactIds = new Set();
let expandedChangeId;
let labelsExpanded = false;
let filterTimer;
let dragState;
let initialLayoutSettled = false;

/** Returns the node types currently enabled by the user. */
function enabledNodeTypes() {
  return new Set(typeFilters.filter(({ checked }) => checked).map(({ value }) => value));
}

/** Keeps the layer-menu summary in sync with its checkboxes. */
function syncLayerCount() {
  layerCount.textContent = `${typeFilters.filter(({ checked }) => checked).length}/${typeFilters.length}`;
}

/** Determines if an edge belongs to the current filtered visual state. */
function edgeIsVisible(edge) {
  if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return false;
  const sourceType = graphNodes.get(edge.source)?.type;
  const targetType = graphNodes.get(edge.target)?.type;
  if (sourceType === "store" || targetType === "store") return false;
  if (edge.relation === "affects") return false;
  return edge.relation !== "targets" || focusedEdgeIds.has(edge.id);
}

/** Updates edge visibility and focus without changing graph positions. */
function refreshEdges() {
  const focusing = selectedNodeId !== undefined;
  edges.update(graph.edges.map((edge) => {
    const visible = edgeIsVisible(edge);
    const touchesSelection = selectedNodeIds.has(edge.source) || selectedNodeIds.has(edge.target);
    const focused = focusedEdgeIds.has(edge.id) || touchesSelection;
    const dependency = isMasterDependency(edge);
    const impactDependency = dependency && focusedEdgeIds.has(edge.id)
      && graphNodes.get(selectedNodeId)?.type === "change";
    const muted = focusing && !focused;
    const baseColor = dependency
      ? impactDependency ? "rgba(15,118,110,0.85)" : "rgba(124,58,237,0.62)"
      : edge.relation === "affects"
        ? "rgba(124,58,237,0.62)"
        : edge.relation === "changes"
          ? focused ? "rgba(217,119,6,0.82)" : "rgba(217,119,6,0.22)"
          : "rgba(100,116,139,0.34)";
    return {
      id: edge.id,
      hidden: !visible,
      physics: false,
      label: visible && focused ? edges.get(edge.id).fullLabel : "",
      color: {
        color: muted ? "rgba(148,163,184,0.10)" : baseColor,
        highlight: baseColor,
        hover: baseColor,
      },
      dashes: dependency,
      width: focused ? 2.2 : dependency ? 1.2 : 0.9,
    };
  }));
}

/** Returns the label shown at the current zoom and focus. */
function visibleNodeLabel(node) {
  if (["repository", "change", "delta-spec"].includes(node.type)) return friendlyNodeLabel(node);
  if (node.type === "master-spec" && (
    labelsExpanded || focusNodeIds.has(node.id) || search.value.trim() !== ""
  )) {
    return friendlyNodeLabel(node);
  }
  return "";
}

/** Updates labels, opacity and impact highlighting for the current selection. */
function refreshNodeAppearance() {
  const focusing = selectedNodeId !== undefined;
  nodes.update(graph.nodes.map((node) => {
    let color = colors[node.type];
    let borderWidth = node.type === "master-spec" ? 1 : 2;
    if (directImpactIds.has(node.id)) {
      color = { background: "#059669", border: "#7c3aed", highlight: "#34d399" };
      borderWidth = 4;
    } else if (dependentImpactIds.has(node.id)) {
      color = { background: "#14b8a6", border: "#0f766e", highlight: "#2dd4bf" };
      borderWidth = 4;
    }
    return {
      id: node.id,
      label: visibleNodeLabel(node),
      color,
      borderWidth,
      opacity: focusing && !focusNodeIds.has(node.id) ? 0.16 : 1,
    };
  }));
}

/** Applies node visibility and optionally fits the active graph. */
function refreshVisibility({ fit = false } = {}) {
  nodes.update(graph.nodes.map(({ id }) => ({ id, hidden: !visibleNodeIds.has(id) })));
  refreshNodeAppearance();
  refreshEdges();
  if (!fit || visibleNodeIds.size === 0) return;
  if (search.value.trim() === "" && selectedNodeId === undefined) showOverview({ animate: true });
  else fitNodes([...visibleNodeIds], { maxZoomLevel: 0.92 });
}

/** Opens a spacious overview instead of compressing every node into the viewport. */
function showOverview({ animate = false } = {}) {
  const positions = network.getPositions([...visibleNodeIds]);
  const visiblePositions = Object.values(positions);
  if (visiblePositions.length === 0) return;
  const xValues = visiblePositions.map(({ x }) => x);
  const yValues = visiblePositions.map(({ y }) => y);
  network.moveTo({
    position: {
      x: (Math.min(...xValues) + Math.max(...xValues)) / 2,
      y: (Math.min(...yValues) + Math.max(...yValues)) / 2,
    },
    scale: overviewScale,
    animation: animate ? { duration: 280, easingFunction: "easeOutQuad" } : false,
  });
}

/** Fits nodes with a stable viewport margin for labels and the legend. */
function fitNodes(nodeIds, { maxZoomLevel = 0.92 } = {}) {
  if (nodeIds.length === 0) return;
  requestAnimationFrame(() => {
    network.fit({ nodes: nodeIds, animation: false, maxZoomLevel });
    network.moveTo({
      scale: network.getScale() * 0.86,
      animation: { duration: 260, easingFunction: "easeOutQuad" },
    });
  });
}

/** Returns direct graph neighbors of one node. */
function neighborhoodForNode(nodeId) {
  const nodeIds = new Set([nodeId]);
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) continue;
    const neighborId = edge.source === nodeId ? edge.target : edge.source;
    if (graphNodes.get(neighborId)?.type === "store") continue;
    nodeIds.add(edge.source);
    nodeIds.add(edge.target);
    edgeIds.add(edge.id);
  }
  return { nodeIds, edgeIds };
}

/** Places one Change's Delta Specs in their permanent compact cluster. */
function positionDeltaCluster(changeNodeId, deltaIds) {
  const changePosition = network.getPosition(changeNodeId);
  [...deltaIds].sort().forEach((deltaId, index) => {
    const offset = deltaOffset(index);
    network.moveNode(deltaId, changePosition.x + offset.x, changePosition.y + offset.y);
  });
}

/** Restores every permanent Delta cluster after the bounded force pass. */
function positionAllDeltaClusters() {
  for (const [changeNodeId, deltaIds] of deltaIdsByChange) {
    positionDeltaCluster(changeNodeId, deltaIds);
  }
}

/** Keeps the selected Change's Delta cluster exact before fitting its impact. */
function positionExpandedDeltas(impact) {
  if (!expandedChangeId) return;
  positionDeltaCluster(expandedChangeId, impact.deltaIds);
}

/** Expands one Change and focuses its complete direct and downstream impact. */
function expandChange(changeNodeId) {
  const impact = impactForChange(changeNodeId);
  expandedChangeId = changeNodeId;
  focusedEdgeIds = impact.focusEdgeIds;
  focusNodeIds = impact.focusNodeIds;
  directImpactIds = impact.directMasterIds;
  dependentImpactIds = impact.dependentMasterIds;
  const enabledTypes = enabledNodeTypes();
  for (const id of impact.focusNodeIds) {
    if (enabledTypes.has(graphNodes.get(id)?.type)) visibleNodeIds.add(id);
  }
  refreshVisibility();
  positionExpandedDeltas(impact);
  fitNodes(
    [...impact.focusNodeIds].filter((id) => visibleNodeIds.has(id)),
    { maxZoomLevel: 0.9 },
  );
  layoutStatus.textContent = `Impact: ${impact.totalMasterIds.size} мастер-спек · `
    + `${impact.deltaIds.size} дельта-спеки`;
}

/** Returns the complete graph or an isolated search neighborhood. */
function matchingNodeIds() {
  const query = search.value.trim().toLowerCase();
  const enabledTypes = enabledNodeTypes();
  if (!query) {
    return new Set(graph.nodes
      .filter(({ type }) => enabledTypes.has(type))
      .map(({ id }) => id));
  }
  const matches = graph.nodes.filter((node) => (
    enabledTypes.has(node.type)
    && JSON.stringify(node).toLowerCase().includes(query)
  ));
  const matchIds = new Set(matches.map(({ id }) => id));
  const visible = new Set(matchIds);
  for (const edge of graph.edges) {
    const sourceMatch = matchIds.has(edge.source);
    const targetMatch = matchIds.has(edge.target);
    if (!sourceMatch && !targetMatch) continue;
    const neighborId = sourceMatch ? edge.target : edge.source;
    const neighbor = graphNodes.get(neighborId);
    if (!enabledTypes.has(neighbor?.type)) continue;
    visible.add(neighborId);
  }
  return visible;
}

/** Clears selection-only expansion and returns to search or the complete graph. */
function clearFocus({ fit = false } = {}) {
  selectedNodeId = undefined;
  selectedNodeIds = new Set();
  focusedEdgeIds = new Set();
  focusNodeIds = new Set();
  directImpactIds = new Set();
  dependentImpactIds = new Set();
  expandedChangeId = undefined;
  visibleNodeIds = matchingNodeIds();
  refreshVisibility({ fit });
  layoutStatus.textContent = search.value.trim()
    ? `Найдено узлов: ${visibleNodeIds.size}`
    : "Весь граф";
  clearDetails();
}

/** Debounces text filtering without rebuilding the physical layout. */
function scheduleSearch() {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    network.unselectAll();
    clearFocus({ fit: true });
    layoutStatus.textContent = visibleNodeIds.size > 0
      ? `Найдено узлов: ${visibleNodeIds.size}`
      : "Ничего не найдено";
  }, 70);
}

search.addEventListener("input", scheduleSearch);
document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll(".file-menu")) menu.hidden = true;
  for (const toggle of document.querySelectorAll(".file-menu-toggle")) {
    toggle.setAttribute("aria-expanded", "false");
  }
  if (!layersMenu.contains(event.target)) layersMenu.open = false;
});
for (const filter of typeFilters) {
  filter.addEventListener("change", () => {
    syncLayerCount();
    network.unselectAll();
    clearFocus({ fit: true });
    layoutStatus.textContent = visibleNodeIds.size > 0
      ? `Отображается узлов: ${visibleNodeIds.size}`
      : "Все группы скрыты";
  });
}
document.getElementById("reset-view").addEventListener("click", () => {
  search.value = "";
  for (const filter of typeFilters) filter.checked = true;
  syncLayerCount();
  layersMenu.open = false;
  network.unselectAll();
  clearFocus({ fit: true });
  layoutStatus.textContent = "Весь граф";
});

network.on("stabilizationProgress", ({ iterations, total }) => {
  const progress = Math.min(100, Math.round(iterations / total * 100));
  layoutStatus.textContent = `Расположение графа: ${progress}%`;
});

/** Stops global physics after one deterministic stabilization pass. */
function settleInitialLayout() {
  if (initialLayoutSettled) return;
  initialLayoutSettled = true;
  network.setOptions({ physics: { enabled: false } });
  nodes.update(graph.nodes
    .filter(({ type }) => ["repository", "master-spec"].includes(type))
    .map(({ id }) => ({ id, fixed: false, physics: false })));
  positionAllDeltaClusters();
  showOverview();
  const elapsed = Math.round(performance.now() - renderStartedAt);
  layoutStatus.dataset.renderMs = String(elapsed);
  layoutStatus.textContent = `Готово за ${elapsed} мс`;
  layoutStatus.classList.add("settled");
}

network.once("stabilizationIterationsDone", settleInitialLayout);
network.once("stabilized", settleInitialLayout);
setTimeout(settleInitialLayout, 3500);

network.on("zoom", ({ scale }) => {
  const next = scale >= labelZoomThreshold;
  if (next === labelsExpanded) return;
  labelsExpanded = next;
  refreshNodeAppearance();
});

/** Returns semantic children that should keep their offset from a dragged parent. */
function structuralChildren(nodeId) {
  const nodeType = graphNodes.get(nodeId)?.type;
  const children = new Set();
  for (const edge of graph.edges) {
    if (
      nodeType === "repository"
      && edge.relation === "implemented_by"
      && edge.target === nodeId
    ) children.add(edge.source);
    if (
      nodeType === "change"
      && edge.relation === "contains"
      && edge.source === nodeId
    ) children.add(edge.target);
  }
  return children;
}

/** Applies one coalesced local drag update without restarting global physics. */
function applyDragFollowers() {
  if (!dragState?.pendingDelta) return;
  dragState.frameId = undefined;
  const { x: deltaX, y: deltaY } = dragState.pendingDelta;
  dragState.pendingDelta = undefined;
  for (const id of dragState.children) {
    const origin = dragState.origins[id];
    network.moveNode(id, origin.x + deltaX, origin.y + deltaY);
  }
  for (const id of dragState.linkedNeighbors) {
    const origin = dragState.origins[id];
    network.moveNode(
      id,
      origin.x + deltaX * linkedSpringRatio,
      origin.y + deltaY * linkedSpringRatio,
    );
  }
}

network.on("dragStart", ({ nodes: dragged }) => {
  if (dragged.length === 0) return;
  const draggedId = dragged[0];
  const children = structuralChildren(draggedId);
  const linkedNeighbors = new Set();
  for (const edge of graph.edges) {
    if (!edgeIsVisible(edge)) continue;
    if (edge.source === draggedId && !children.has(edge.target)) linkedNeighbors.add(edge.target);
    if (edge.target === draggedId && !children.has(edge.source)) linkedNeighbors.add(edge.source);
  }
  const active = [draggedId, ...children, ...linkedNeighbors];
  dragState = {
    draggedId,
    children: [...children],
    linkedNeighbors: [...linkedNeighbors],
    origins: network.getPositions(active),
  };
  layoutStatus.textContent = children.size > 0
    ? `Движется кластер: ${children.size + 1} узлов`
    : `Локальная пружина: ${linkedNeighbors.size + 1} узлов`;
  layoutStatus.classList.remove("settled");
});

network.on("dragging", ({ nodes: dragged }) => {
  if (dragged.length === 0 || !dragState) return;
  const origin = dragState.origins[dragState.draggedId];
  const position = network.getPositions([dragState.draggedId])[dragState.draggedId];
  dragState.pendingDelta = { x: position.x - origin.x, y: position.y - origin.y };
  if (dragState.frameId === undefined) {
    dragState.frameId = requestAnimationFrame(applyDragFollowers);
  }
});

network.on("dragEnd", ({ nodes: dragged }) => {
  if (dragged.length === 0) return;
  const movedChildren = dragState?.children.length ?? 0;
  if (dragState?.frameId !== undefined) cancelAnimationFrame(dragState.frameId);
  applyDragFollowers();
  dragState = undefined;
  layoutStatus.textContent = movedChildren > 0
    ? "Готово · расстояния внутри кластера сохранены"
    : "Готово · локальная физика";
  layoutStatus.classList.add("settled");
});

network.on("selectNode", ({ nodes: selected }) => {
  selectedNodeId = selected[0];
  selectedNodeIds = new Set(selected);
  const data = graphNodes.get(selectedNodeId);
  if (data?.type === "change") {
    expandChange(selectedNodeId);
  } else if (data?.type === "delta-spec") {
    expandChange(`change:${data.change_id}`);
  } else {
    expandedChangeId = undefined;
    directImpactIds = new Set();
    dependentImpactIds = new Set();
    visibleNodeIds = matchingNodeIds();
    const neighborhood = neighborhoodForNode(selectedNodeId);
    const enabledTypes = enabledNodeTypes();
    for (const id of neighborhood.nodeIds) {
      if (enabledTypes.has(graphNodes.get(id)?.type)) visibleNodeIds.add(id);
    }
    focusNodeIds = neighborhood.nodeIds;
    focusedEdgeIds = neighborhood.edgeIds;
    refreshVisibility();
  }
  renderNode(selectedNodeId);
});

network.on("selectEdge", ({ edges: selected, nodes: selectedNodes }) => {
  if (selectedNodes.length === 0) renderEdge(selected[0]);
});

network.on("click", ({ nodes: selectedNodes, edges: selectedEdges }) => {
  if (selectedNodes.length === 0 && selectedEdges.length === 0) clearFocus();
});

refreshNodeAppearance();
refreshEdges();
