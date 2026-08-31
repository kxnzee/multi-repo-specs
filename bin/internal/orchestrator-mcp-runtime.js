/** @fileoverview Distribution composition for the built-in Orchestrator Agent API. */

import {
  createRepositoryCheckout,
  currentRepositories,
  files,
  git,
  openspec,
  pluginContexts,
  repositoryStatuses,
  storeProjects,
} from "@openspec-orch/core";
import { ChangeTrackingApplication } from "@openspec-orch/plugin-change-tracking/application";
import { OpenSpecGraphApplication } from "@openspec-orch/plugin-openspec-graph/application";
import { StoreResourceService } from "@openspec-orch/mcp";

/** Projects current Repository identity without exposing mutable domain objects. */
function invocationJson(invocation) {
  return invocation ? Object.freeze({
    repository_id: invocation.id,
    role: invocation.role,
    path: invocation.path,
  }) : null;
}

/** Produces the stable Project envelope shared by read tools. */
function projectJson(storeProject, invocation) {
  const { project } = storeProject;
  return Object.freeze({
    schema_version: 1,
    store_id: storeProject.store.id,
    current_repository: invocationJson(invocation),
    project: Object.freeze({
      strict: project.strict,
      template_id: project.template.id,
      agent_id: project.agent.id,
      extensions: project.extensions,
      plugins: project.plugins,
      repositories: Object.freeze(project.repositories.map((repository) => Object.freeze({
        repository_id: repository.id,
        role: repository.role,
        plugins: repository.plugins,
      }))),
    }),
  });
}

/** Describes one optional Plugin overlay. */
function capability(provider, available, reason = null) {
  return Object.freeze({ provider, available, ...(reason ? { reason } : {}) });
}

/** Resolves current state for every request so a long-lived Agent never sees stale Project data. */
export class OrchestratorMcpRuntime {
  #contexts;
  #currentRepositories;
  #doctor;
  #files;
  #git;
  #managers;
  #openSpec;
  #repositoryStatuses;
  #setup;
  #start;
  #storeProjects;

  constructor({
    contextFactory = pluginContexts,
    currentRepositoryService = currentRepositories,
    doctorService,
    fileService = files,
    gitService = git,
    managerService,
    openSpecService = openspec,
    repositoryStatusService = repositoryStatuses,
    setupService,
    start,
    storeProjectService = storeProjects,
  } = {}) {
    if (typeof start !== "string") throw new Error("MCP_RUNTIME_INVALID: start обязателен");
    if (!doctorService || typeof doctorService.inspect !== "function") {
      throw new Error("MCP_RUNTIME_INVALID: doctorService обязателен");
    }
    if (!managerService || typeof managerService.forStore !== "function") {
      throw new Error("MCP_RUNTIME_INVALID: managerService обязателен");
    }
    if (!repositoryStatusService || typeof repositoryStatusService.inspect !== "function") {
      throw new Error("MCP_RUNTIME_INVALID: repositoryStatusService обязателен");
    }
    if (!setupService || ["connect", "initialize", "inspect"].some((method) => (
      typeof setupService[method] !== "function"
    ))) {
      throw new Error("MCP_RUNTIME_INVALID: setupService обязателен");
    }
    this.#contexts = contextFactory;
    this.#currentRepositories = currentRepositoryService;
    this.#doctor = doctorService;
    this.#files = fileService;
    this.#git = gitService;
    this.#managers = managerService;
    this.#openSpec = openSpecService;
    this.#repositoryStatuses = repositoryStatusService;
    this.#setup = setupService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  async getStatus({ change_id: changeId } = {}) {
    const state = await this.#state();
    const [tracking, graph] = await Promise.all([
      this.#optionalApplication(
        state,
        "change-tracking",
        false,
        (context) => new ChangeTrackingApplication(context),
      ),
      this.#optionalApplication(
        state,
        "openspec-graph",
        true,
        (context) => new OpenSpecGraphApplication(context),
      ),
    ]);
    const openSpec = this.#openSpec.forRepository(state.storeProject.checkout);
    return Object.freeze({
      ...projectJson(state.storeProject, state.invocation),
      capabilities: Object.freeze({
        tracking: capability(
          "change-tracking",
          tracking !== null,
          tracking ? null : "Plugin is not initialized or unavailable; inspect Doctor",
        ),
        graph: capability(
          "openspec-graph",
          graph !== null,
          graph ? null : "Plugin is not connected or unavailable; inspect Doctor",
        ),
      }),
      openspec: await openSpec.listChanges(),
      tracking: tracking && changeId ? await tracking.getStatus(changeId) : null,
    });
  }

  async getSetupContext() {
    return Object.freeze({
      cwd: this.#start,
      choices: this.#setup.inspect(),
      doctor: (await this.#doctor.inspect({ start: this.#start })).toJSON(),
      constraints: Object.freeze({
        fixed_cwd: true,
        strict_only: true,
        arbitrary_workspace: false,
        disconnect_exposed: false,
      }),
    });
  }

  initializeProject({
    agent_id: agentId,
    repositories = [],
    store_id: storeId,
    template_id: templateId,
  } = {}) {
    return this.#setup.initialize({
      agentId,
      repositories: repositories.map((repository) => Object.freeze({
        id: repository.repository_id,
        role: "code",
        remote: repository.remote,
        defaultBranch: repository.default_branch,
      })),
      storeId,
      templateId,
    });
  }

  connectProject() {
    return this.#setup.connect();
  }

  async startAttempt({ change_id: changeId, task_id: taskId } = {}) {
    const tracking = await this.#trackingApplication(await this.#state());
    return tracking.startAttempt({ changeId, taskId });
  }

  async completeAttempt({ change_id: changeId, task_id: taskId } = {}) {
    const tracking = await this.#trackingApplication(await this.#state());
    return tracking.completeAttempt({ changeId, taskId });
  }

  async getChangeContext({ change_id: changeId, artifact } = {}) {
    const state = await this.#state();
    const repositoryOpenSpec = this.#openSpec.forRepository(state.storeProject.checkout);
    const resources = await this.#resourceService(state).list();
    const changePrefix = `openspec/changes/${changeId}/`;
    const [tracking, graph] = await Promise.all([
      this.#optionalApplication(
        state,
        "change-tracking",
        false,
        (context) => new ChangeTrackingApplication(context),
      ),
      this.#optionalApplication(
        state,
        "openspec-graph",
        true,
        (context) => new OpenSpecGraphApplication(context),
      ),
    ]);
    return Object.freeze({
      ...projectJson(state.storeProject, state.invocation),
      change_id: changeId,
      artifact: artifact ?? null,
      openspec_status: await repositoryOpenSpec.changeStatus(changeId),
      artifact_instructions: artifact
        ? await repositoryOpenSpec.artifactInstructions(changeId, artifact)
        : null,
      resources: Object.freeze(resources.filter(({ name }) => name.startsWith(changePrefix))),
      tracking: tracking ? await tracking.getStatus(changeId) : null,
      graph_impact: graph ? await graph.query("change_impact", changeId) : null,
    });
  }

  async getNextAction({ change_id: changeId } = {}) {
    const state = await this.#state();
    const repositoryOpenSpec = this.#openSpec.forRepository(state.storeProject.checkout);
    if (!changeId) {
      return Object.freeze({
        action: "choose_change",
        actor: "human",
        reason: "Укажите change_id; MCP не выбирает Change по догадке",
        openspec: await repositoryOpenSpec.listChanges(),
      });
    }
    return repositoryOpenSpec.nextAction(changeId);
  }

  async getAssignmentScope({ change_id: changeId } = {}) {
    const state = await this.#state();
    const graph = await this.#optionalApplication(
      state,
      "openspec-graph",
      true,
      (context) => new OpenSpecGraphApplication(context),
    );
    const graphImpact = graph && changeId ? await graph.query("change_impact", changeId) : null;
    const graphRepositoryIds = graphImpact?.repositories.map(({ id }) => (
      id.replace(/^repository:/u, "")
    ));
    const assignedRepositoryIds = new Set(graphRepositoryIds ?? []);
    const assignments = await this.#assignmentScopes(state, assignedRepositoryIds);
    const currentCheckout = state.invocation?.role === "store"
      ? state.storeProject.checkout
      : state.invocation
        ? createRepositoryCheckout(
          state.storeProject.project.requireRepository(state.invocation.id),
          state.invocation.path,
        )
        : null;
    const revision = currentCheckout
      ? await this.#git.forRepository(currentCheckout).revision()
      : null;
    return Object.freeze({
      ...projectJson(state.storeProject, state.invocation),
      assigned: (
        state.invocation?.role === "code" && graphRepositoryIds?.includes(state.invocation.id)
      ) ?? false,
      graph_impact: graphImpact,
      assignments,
      current_assignment: state.invocation ? Object.freeze({
        repository_id: state.invocation.id,
        role: state.invocation.role,
        path: state.invocation.path,
        revision,
      }) : null,
    });
  }

  async getDoctorReport() {
    return (await this.#doctor.inspect({ start: this.#start })).toJSON();
  }

  async queryGraph({ query, id } = {}) {
    const state = await this.#state();
    const graph = await this.#optionalApplication(
      state,
      "openspec-graph",
      true,
      (context) => new OpenSpecGraphApplication(context),
    );
    if (!graph) {
      throw new Error(
        "CAPABILITY_UNAVAILABLE: openspec-graph is not connected or unavailable; inspect Doctor",
      );
    }
    return graph.query(query, id);
  }

  async listResources() {
    return this.#resourceService(await this.#state()).list();
  }

  async readResource(uri) {
    return this.#resourceService(await this.#state()).read(uri);
  }

  async #assignmentScopes(state, assignedRepositoryIds) {
    const repositoryIds = state.storeProject.project.repositories
      .filter(({ role }) => role === "code")
      .map(({ id }) => id);
    if (repositoryIds.length === 0) return Object.freeze([]);
    const statuses = await this.#repositoryStatuses.inspect({
      start: state.storeProject.root,
      repositoryIds,
    });
    return Object.freeze(await Promise.all(statuses.map(async (status) => {
      const revision = status.connected
        ? await this.#git.forRepository(createRepositoryCheckout(
          state.storeProject.project.requireRepository(status.id),
          status.path,
        )).revision()
        : null;
      return Object.freeze({
        repository_id: status.id,
        assigned: assignedRepositoryIds.has(status.id),
        checkout: status.path,
        revision,
        connected: status.connected,
        clean: status.clean ?? null,
        state: status.state,
      });
    })));
  }

  #resourceService(state) {
    return new StoreResourceService({
      files: this.#files.forRepository(state.storeProject.checkout),
      storeId: state.storeProject.store.id,
    });
  }

  #isConnected(state, pluginId) {
    return state.storeProject.project.storeRepository.hasPlugin(pluginId);
  }

  async #optionalApplication(state, pluginId, requireBinding, create) {
    const declaration = state.storeProject.project.pluginDeclaration(pluginId);
    if (!declaration) return null;
    if (requireBinding && !this.#isConnected(state, pluginId)) return null;
    try {
      const installation = await state.manager.resolve(declaration);
      const context = await (requireBinding
        ? this.#contexts.forRepository.bind(this.#contexts)
        : this.#contexts.forRepositorySetup.bind(this.#contexts))({
        loadedPlugin: installation.loadedPlugin,
        storeProject: state.storeProject,
        repositoryId: state.storeProject.store.id,
        invocation: state.invocation,
      });
      return create(context);
    } catch {
      return null;
    }
  }

  async #trackingApplication(state) {
    const tracking = await this.#optionalApplication(
      state,
      "change-tracking",
      false,
      (context) => new ChangeTrackingApplication(context),
    );
    if (!tracking) {
      throw new Error(
        "CAPABILITY_UNAVAILABLE: change-tracking is not initialized; inspect Doctor",
      );
    }
    return tracking;
  }

  async #state() {
    const storeProject = await this.#storeProjects.resolve(this.#start);
    const invocation = await this.#currentRepositories.resolve({
      start: this.#start,
      storeProject,
    });
    return Object.freeze({
      storeProject,
      invocation,
      manager: this.#managers.forStore(storeProject.checkout),
    });
  }
}
