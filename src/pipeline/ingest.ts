import type { ConnectorRegistry } from "../connectors/registry";
import type { RawEvent } from "../types";

export class IngestionOrchestrator {
  constructor(private readonly registry: ConnectorRegistry) {}

  async fetchAll(enabledIds: string[]): Promise<RawEvent[]> {
    const connectors = this.registry.getEnabled(enabledIds);

    const results = await Promise.allSettled(
      connectors.map(async (connector) => {
        const authed = await connector.authenticate();
        if (!authed) return [];
        return connector.fetch();
      })
    );

    const events: RawEvent[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        events.push(...result.value);
      }
    }

    return events;
  }
}
