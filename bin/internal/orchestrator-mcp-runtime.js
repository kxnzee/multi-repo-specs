/** @fileoverview Distribution composition for the built-in Orchestrator Agent API. */

import { createHash } from "node:crypto";

import {
  createRepositoryCheckout,
  currentRepositories,
  files,
  openspec,
  pluginContexts,
  repositoryStatuses,
  storeProjects,
} from "@openspec-orch/core";
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
      template_id: project.template.id,
      agent_id: project.agent.id,
      extensions: project.extensions,
      plugins: project.plugins,
      repositories: Object.freeze(project.repositories.map((repository) => Object.freeze({
        repository_id: repository.id,
        role: repository.role,
        ...(repository.storeId ? { store_id: repository.storeId } : {}),
        ...(repository.description !== undefined ? { description: repository.description } : {}),
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
  #agentContributions;
  #contexts;
  #currentRepositories;
  #doctor;
  #files;
  #managers;
  #openSpec;
  #repositoryStatuses;
  #setup;
  #start;
  #storeProjects;

  constructor({
    agentContributions = [],
    contextFactory = pluginContexts,
    currentRepositoryService = currentRepositories,
    doctorService,
    fileService = files,
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
    if (
      !Array.isArray(agentContributions) ||
      agentContributions.some(({ contribution, pluginId } = {}) => (
        typeof pluginId !== "string" ||
        !contribution ||
        typeof contribution.create !== "function" ||
        typeof contribution.enhance !== "function" ||
        !Array.isArray(contribution.tools)
      ))
    ) {
      throw new Error("MCP_RUNTIME_INVALID: agentContributions несовместимы");
    }
    const toolNames = agentContributions.flatMap(({ contribution }) => (
      contribution.tools.map(({ name }) => name)
    ));
    if (new Set(toolNames).size !== toolNames.length) {
      throw new Error("MCP_RUNTIME_INVALID: agentContributions содержат повторяющийся tool");
    }
    this.#agentContributions = Object.freeze([...agentContributions]);
    this.#contexts = contextFactory;
    this.#currentRepositories = currentRepositoryService;
    this.#doctor = doctorService;
    this.#files = fileService;
    this.#managers = managerService;
    this.#openSpec = openSpecService;
    this.#repositoryStatuses = repositoryStatusService;
    this.#setup = setupService;
    this.#start = start;
    this.#storeProjects = storeProjectService;
    Object.freeze(this);
  }

  get agentTools() {
    return Object.freeze(this.#agentContributions.flatMap(({ contribution }) => (
      contribution.tools.map(({ definition }) => definition)
    )));
  }

  async getStatus({ change_id: changeId } = {}) {
    const state = await this.#state();
    const tracking = await this.#optionalAgentApplication(state, "change-tracking");
    const openSpec = this.#openSpec.forRepository(state.storeProject.checkout);
    const result = Object.freeze({
      ...projectJson(state.storeProject, state.invocation),
      capabilities: Object.freeze({
        tracking: capability(
          "change-tracking",
          tracking !== null,
          tracking ? null : "Plugin is not initialized or unavailable; inspect Doctor",
        ),
      }),
      openspec: await openSpec.listChanges(),
      tracking: tracking && changeId ? await tracking.getStatus(changeId) : null,
    });
    return this.#enhance(state, "getStatus", { change_id: changeId }, result);
  }

  async getSetupContext() {
    return Object.freeze({
      cwd: this.#start,
      choices: this.#setup.inspect(),
      doctor: (await this.#doctor.inspect({ start: this.#start })).toJSON(),
      constraints: Object.freeze({
        fixed_cwd: true,
        arbitrary_workspace: false,
        disconnect_exposed: false,
        target_role: "store",
        forbidden_targets: Object.freeze([
          "orchestrator_checkout",
          "template_source",
          "code_repository",
        ]),
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

  async getChangeContext({ change_id: changeId, artifact, include_assignment: includeAssignment } = {}) {
    const state = await this.#state();
    const repositoryOpenSpec = this.#openSpec.forRepository(state.storeProject.checkout);
    const resources = await this.#resourceService(state).list({ changeId });
    const changePrefix = `openspec/changes/${changeId}/`;
    const tracking = await this.#optionalAgentApplication(state, "change-tracking");
    const result = Object.freeze({
      ...projectJson(state.storeProject, state.invocation),
      change_id: changeId,
      artifact: artifact ?? null,
      openspec_status: await repositoryOpenSpec.changeStatus(changeId),
      artifact_instructions: artifact
        ? await repositoryOpenSpec.artifactInstructions(changeId, artifact)
        : null,
      resources: Object.freeze(resources.filter(({ name }) => name.startsWith(changePrefix))),
      shared_resources: Object.freeze(resources.filter(({ name }) => !name.startsWith("openspec/changes/"))),
      tracking: tracking ? await tracking.getStatus(changeId) : null,
      ...(includeAssignment ? {
        assignment_scope: await this.#assignmentScope(state),
      } : {}),
    });
    return this.#enhance(
      state,
      "getChangeContext",
      { change_id: changeId, artifact, include_assignment: includeAssignment ?? false },
      result,
    );
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
    const result = Object.freeze({
      ...projectJson(state.storeProject, state.invocation),
      ...await this.#assignmentScope(state),
    });
    return this.#enhance(state, "getAssignmentScope", { change_id: changeId }, result);
  }

  /** Builds reusable assignment data without repeating the Project envelope. */
  async #assignmentScope(state) {
    const assignments = await this.#assignmentScopes(state);
    return Object.freeze({
      assigned: null,
      assignments,
      current_assignment: state.invocation ? Object.freeze({
        repository_id: state.invocation.id,
        role: state.invocation.role,
        path: state.invocation.path,
        revision: null,
      }) : null,
    });
  }

  async getDoctorReport() {
    return (await this.#doctor.inspect({ start: this.#start })).toJSON();
  }

  async invokeAgentTool(name, args = {}) {
    const state = await this.#state();
    const entry = this.#agentContributions.find(({ contribution }) => (
      contribution.tools.some((tool) => tool.name === name)
    ));
    if (!entry) throw new Error(`MCP_TOOL_NOT_FOUND: ${name}`);
    const tool = entry.contribution.tools.find(({ name: candidate }) => candidate === name);
    tool.validate(args);
    const repositoryParameter = tool.repositoryParameter ?? (tool.repositoryScoped ? "repository_id" : null);
    const application = await this.#agentApplication(
      state, entry, repositoryParameter ? args[repositoryParameter] : undefined,
    );
    return tool.execute(application, args);
  }

  async listResources() {
    const state = await this.#state();
    const result = [...await this.#resourceService(state).list()];
    for (const repository of state.storeProject.project.specsRepositories ?? []) {
      const listing = await this.#specsResourceListing(state, repository.id);
      result.push(...listing.resources);
    }
    return Object.freeze(result);
  }

  async readResource(uri) {
    const state = await this.#state();
    const prefix = `openspec-orch://project/${encodeURIComponent(state.storeProject.store.id)}/repository/`;
    if (typeof uri === "string" && uri.startsWith(prefix)) {
      const alias = uri.slice(prefix.length).split("/")[0];
      const repository = (state.storeProject.project.specsRepositories ?? [])
        .find(({ id }) => encodeURIComponent(id) === alias);
      if (!repository) throw new Error(`MCP_RESOURCE_NOT_FOUND: ${uri}`);
      if (uri === `${prefix}${alias}/$diagnostic`) {
        const listing = await this.#specsResourceListing(state, repository.id);
        return listing.read(uri);
      }
      const service = await this.#specsResourceService(state, repository.id);
      return service.read(uri);
    }
    return this.#resourceService(state).read(uri);
  }

  /** Isolates a broken external source and exposes its failure as a readable diagnostic. */
  async #specsResourceListing(state, repositoryId) {
    try {
      const service = await this.#specsResourceService(state, repositoryId);
      return { resources: await service.list(), read: (uri) => service.read(uri) };
    } catch (error) {
      const repository = state.storeProject.project.requireRepository(repositoryId);
      const projectId = state.storeProject.store.id;
      const diagnostic = Object.freeze({
        project_id: projectId, repository_id: repositoryId,
        expected_store_id: repository.storeId, state: "unavailable", message: error.message,
      });
      const text = `${JSON.stringify(diagnostic, null, 2)}\n`;
      const resource = Object.freeze({
        uri: `openspec-orch://project/${encodeURIComponent(projectId)}/repository/` +
          `${encodeURIComponent(repositoryId)}/$diagnostic`,
        name: `${repositoryId}: unavailable`,
        title: `Linked Store ${repositoryId} is unavailable`,
        description: error.message,
        mimeType: "application/json",
        _meta: Object.freeze({ diagnostic,
          content_revision: createHash("sha256").update(text).digest("hex"),
        }),
      });
      return { resources: [resource], read: async (uri) => {
        if (uri !== resource.uri) throw new Error(`MCP_RESOURCE_NOT_FOUND: ${uri}`);
        return Object.freeze({ ...resource, text });
      } };
    }
  }

  /** Resolves only an explicitly registered linked checkout, without child runtime setup. */
  async #specsResourceService(state, repositoryId) {
    const repository = state.storeProject.project.requireRepository(repositoryId);
    const [status] = await this.#repositoryStatuses.inspect({
      start: state.storeProject.root, repositoryIds: [repositoryId],
    });
    if (!status?.connected || status.state !== "connected") {
      throw new Error(`SPECS_RESOURCE_UNAVAILABLE: ${repositoryId}: ${status?.error ?? status?.state ?? "missing"}`);
    }
    const checkout = createRepositoryCheckout(repository, status.path);
    const target = await this.#storeProjects.loadSpecs(checkout);
    return new StoreResourceService({
      files: this.#files.forRepository(checkout),
      storeId: target.store.id,
      source: {
        project_id: state.storeProject.store.id, repository_id: repository.id,
        revision: null, clean: null,
      },
    });
  }

  async #assignmentScopes(state) {
    const repositoryIds = state.storeProject.project.repositories
      .filter(({ role }) => role === "code")
      .map(({ id }) => id);
    if (repositoryIds.length === 0) return Object.freeze([]);
    const statuses = await this.#repositoryStatuses.inspect({
      start: state.storeProject.root,
      repositoryIds,
    });
    return Object.freeze(await Promise.all(statuses.map(async (status) => {
      return Object.freeze({
        repository_id: status.id,
        assigned: null,
        checkout: status.path,
        revision: null,
        connected: status.connected,
        clean: status.clean ?? null,
        state: status.state,
      });
    })));
  }

  /** Applies every Plugin-owned overlay without knowing its fields or provider semantics. */
  async #enhance(state, operation, input, result) {
    let current = result;
    for (const entry of this.#agentContributions) {
      const application = await this.#agentApplication(state, entry);
      const enhanced = await entry.contribution.enhance(Object.freeze({
        application,
        input: Object.freeze({ ...input }),
        operation,
        result: current,
      }));
      if (!enhanced || typeof enhanced !== "object" || Array.isArray(enhanced)) {
        throw new Error(`MCP_RUNTIME_INVALID: ${entry.pluginId} вернул некорректный overlay`);
      }
      current = Object.freeze(enhanced);
    }
    return current;
  }

  /** Resolves one optional Plugin-owned Agent application through the generic lifecycle. */
  async #agentApplication(state, { contribution, pluginId }, repositoryId) {
    return this.#optionalApplication(
      state,
      pluginId,
      contribution.requireBinding,
      (context) => contribution.create(context),
      repositoryId,
    );
  }

  async #optionalAgentApplication(state, pluginId) {
    const entry = this.#agentContributions.find((candidate) => candidate.pluginId === pluginId);
    return entry ? this.#agentApplication(state, entry) : null;
  }

  #resourceService(state) {
    return new StoreResourceService({
      files: this.#files.forRepository(state.storeProject.checkout),
      storeId: state.storeProject.store.id,
    });
  }

  async #optionalApplication(state, pluginId, requireBinding, create, repositoryId) {
    const selected = repositoryId === undefined ? state.storeProject.project.storeRepository
      : state.storeProject.project.requireRepository(repositoryId);
    const declaration = state.storeProject.project.pluginDeclaration(pluginId);
    if (!declaration) return null;
    if ((requireBinding || repositoryId !== undefined) && !selected.hasPlugin(pluginId)) {
      if (repositoryId !== undefined) throw new Error(`PLUGIN_NOT_CONNECTED: ${pluginId}: ${repositoryId}`);
      return null;
    }
    try {
      const installation = await state.manager.resolve(declaration);
      const setupContext = installation.loadedPlugin.plugin.hasRepositoryContribution()
        ? this.#contexts.forRepositorySetup.bind(this.#contexts)
        : this.#contexts.forStoreSetup.bind(this.#contexts);
      const context = await (requireBinding || repositoryId !== undefined
        ? this.#contexts.forRepository.bind(this.#contexts)
        : setupContext)({
        loadedPlugin: installation.loadedPlugin,
        storeProject: state.storeProject,
        repositoryId: selected.id,
        invocation: state.invocation,
      });
      return create(context);
    } catch (error) {
      if (error?.code === "PLUGIN_RUNTIME_UNAVAILABLE") return null;
      throw error;
    }
  }

  async #trackingApplication(state) {
    const tracking = await this.#optionalAgentApplication(state, "change-tracking");
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
