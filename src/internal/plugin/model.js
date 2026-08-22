/** @fileoverview Доменная модель одного проверенного Plugin descriptor. */

export class PluginModel {
  #descriptor;

  constructor(descriptor) {
    this.#descriptor = descriptor;
  }

  /** Проверяет, что Plugin поддерживает роль выбранного Repository. */
  assertSupports(repository) {
    if (!this.#descriptor.supports.includes(repository.role)) {
      throw new Error(
        `PLUGIN_SCOPE_UNSUPPORTED: ${this.#descriptor.id} не поддерживает ` +
          `role ${repository.role} (${repository.id})`,
      );
    }
  }

  /** Возвращает invocation обязательного connect lifecycle. */
  connectInvocation() {
    return this.#invocation(this.#descriptor.lifecycle.connect);
  }

  /** Возвращает invocation обязательного status lifecycle. */
  statusInvocation() {
    return this.#invocation(this.#descriptor.lifecycle.status);
  }

  /** Возвращает invocation sync либо стабильную ошибку неподдерживаемой операции. */
  syncInvocation() {
    const args = this.#descriptor.lifecycle.sync;
    if (!args) {
      throw new Error(`PLUGIN_SYNC_UNSUPPORTED: ${this.#descriptor.id} не поддерживает sync`);
    }
    return this.#invocation(args);
  }

  /** Возвращает invocation нативной Plugin-команды. */
  commandInvocation(args) {
    return this.#invocation(args);
  }

  /** Сообщает, предоставляет ли Plugin интеграцию с зарегистрированными Agents. */
  hasAgentIntegration() {
    return this.#descriptor.agent !== undefined;
  }

  /** Возвращает invocation установки Plugin для одного зарегистрированного Agent. */
  agentInstallInvocation(agentId) {
    if (!this.#descriptor.agent) {
      throw new Error(`PLUGIN_AGENT_UNSUPPORTED: ${this.#descriptor.id} не предоставляет Agent integration`);
    }
    return this.#invocation([...this.#descriptor.agent.install, "--agent", agentId]);
  }

  /** Возвращает invocation удаления Plugin у одного зарегистрированного Agent. */
  agentRemoveInvocation(agentId) {
    if (!this.#descriptor.agent) {
      throw new Error(`PLUGIN_AGENT_UNSUPPORTED: ${this.#descriptor.id} не предоставляет Agent integration`);
    }
    return this.#invocation([...this.#descriptor.agent.remove, "--agent", agentId]);
  }

  #invocation(args) {
    return {
      command: this.#descriptor.command,
      args: [...this.#descriptor.args, ...args],
    };
  }
}

/** Создаёт доменную модель проверенного Plugin descriptor. */
export function createPluginModel(descriptor) {
  return new PluginModel(descriptor);
}
