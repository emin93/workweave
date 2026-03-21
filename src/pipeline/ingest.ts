import * as vscode from "vscode";
import type { ConnectorRegistry } from "../connectors/registry";
import type { RawEvent } from "../types";

const log = vscode.window.createOutputChannel("Workday Synthesizer", {
  log: true,
});

export { log };

export class IngestionOrchestrator {
  constructor(private readonly registry: ConnectorRegistry) {}

  async fetchAll(enabledIds: string[]): Promise<RawEvent[]> {
    const connectors = this.registry.getEnabled(enabledIds);
    log.info(`Fetching from ${connectors.length} connector(s): ${enabledIds.join(", ")}`);

    if (connectors.length === 0) {
      log.warn("No enabled connectors found. Check onboarding config.");
      return [];
    }

    const events: RawEvent[] = [];
    const errors: string[] = [];

    const results = await Promise.allSettled(
      connectors.map(async (connector) => {
        log.info(`[${connector.id}] Authenticating...`);
        const authed = await connector.authenticate();
        if (!authed) {
          log.warn(`[${connector.id}] Authentication failed, skipping.`);
          return [];
        }
        log.info(`[${connector.id}] Fetching data...`);
        const fetched = await connector.fetch();
        log.info(`[${connector.id}] Got ${fetched.length} event(s).`);
        return fetched;
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const connectorId = connectors[i].id;
      if (result.status === "fulfilled") {
        events.push(...result.value);
      } else {
        const msg = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        log.error(`[${connectorId}] Failed: ${msg}`);
        errors.push(`${connectorId}: ${msg}`);
      }
    }

    log.info(`Total: ${events.length} event(s), ${errors.length} error(s).`);

    if (events.length === 0 && errors.length > 0) {
      throw new Error(`All connectors failed:\n${errors.join("\n")}`);
    }

    return events;
  }
}
