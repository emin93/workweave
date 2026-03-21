import type { StorageLayer } from "../storage/store";
import type { ConnectorRegistry } from "../connectors/registry";
import type { ConnectorInfo, UserConfig, ConnectorConfig } from "../types";

export class OnboardingManager {
  constructor(
    private readonly storage: StorageLayer,
    private readonly registry: ConnectorRegistry
  ) {}

  async detectEnvironment(): Promise<ConnectorInfo[]> {
    const connectors = await this.registry.detectAll();
    await this.storage.updateConfig({ onboardingState: "detecting" });
    return connectors;
  }

  async selectConnectors(connectorIds: string[]): Promise<void> {
    const allConnectors = await this.registry.detectAll();

    const configs: ConnectorConfig[] = allConnectors.map((c) => ({
      id: c.id,
      enabled: connectorIds.includes(c.id),
      authMethod: c.status.available
        ? c.status.authMethod
        : ("cli" as const),
      settings: {},
    }));

    await this.storage.updateConfig({
      enabledConnectors: configs,
      onboardingState: "selecting",
    });
  }

  async configure(partial: Partial<UserConfig>): Promise<void> {
    await this.storage.updateConfig({
      ...partial,
      onboardingState: "configuring",
    });
  }

  async validate(): Promise<
    Array<{ id: string; name: string; ok: boolean; error?: string }>
  > {
    const config = this.storage.getConfig();
    const results: Array<{
      id: string;
      name: string;
      ok: boolean;
      error?: string;
    }> = [];

    for (const cc of config.enabledConnectors.filter((c) => c.enabled)) {
      const connector = this.registry.get(cc.id);
      if (!connector) {
        results.push({
          id: cc.id,
          name: cc.id,
          ok: false,
          error: "Connector not found",
        });
        continue;
      }

      try {
        const authed = await connector.authenticate();
        results.push({ id: cc.id, name: connector.name, ok: authed });
      } catch (err) {
        results.push({
          id: cc.id,
          name: connector.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  async complete(): Promise<void> {
    await this.storage.updateConfig({ onboardingState: "complete" });
  }

  async reset(): Promise<void> {
    await this.storage.updateConfig({
      onboardingState: "not_started",
      enabledConnectors: [],
    });
  }
}
