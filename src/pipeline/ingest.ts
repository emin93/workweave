import type { ConnectorRegistry } from "../connectors/registry";
import type { RawEvent } from "../types";

export const log = {
  info: (msg: string) => console.error(`[info] ${msg}`),
  warn: (msg: string) => console.error(`[warn] ${msg}`),
  error: (msg: string) => console.error(`[error] ${msg}`),
};

export interface IngestionResult {
  events: RawEvent[];
  errors: string[];
}

export class IngestionOrchestrator {
  constructor(private readonly registry: ConnectorRegistry) {}

  async fetchAll(enabledIds: string[]): Promise<IngestionResult> {
    const connectors = this.registry.getEnabled(enabledIds);
    log.info(
      `Fetching from ${connectors.length} connector(s): ${enabledIds.join(", ")}`
    );

    if (connectors.length === 0) {
      log.warn("No enabled connectors found.");
      return { events: [], errors: [] };
    }

    const events: RawEvent[] = [];
    const errors: string[] = [];

    const results = await Promise.allSettled(
      connectors.map(async (connector) => {
        log.info(`[${connector.id}] Authenticating...`);
        const authed = await connector.authenticate();
        if (!authed) {
          throw new Error("Authentication failed");
        }
        log.info(`[${connector.id}] Authenticated. Fetching data...`);
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
        const msg =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);
        log.error(`[${connectorId}] Failed: ${msg}`);
        errors.push(`${connectors[i].name}: ${msg}`);
      }
    }

    log.info(`Total: ${events.length} event(s), ${errors.length} error(s).`);

    if (events.length === 0 && errors.length > 0) {
      throw new Error(`All connectors failed:\n${errors.join("\n")}`);
    }

    return { events, errors };
  }
}
