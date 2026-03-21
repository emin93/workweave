import type { Connector, ConnectorInfo } from "../types";

export class ConnectorRegistry {
  private _connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    this._connectors.set(connector.id, connector);
  }

  get(id: string): Connector | undefined {
    return this._connectors.get(id);
  }

  getAll(): Connector[] {
    return Array.from(this._connectors.values());
  }

  getEnabled(enabledIds: string[]): Connector[] {
    return enabledIds
      .map((id) => this._connectors.get(id))
      .filter((c): c is Connector => c !== undefined);
  }

  async detectAll(): Promise<ConnectorInfo[]> {
    const results: ConnectorInfo[] = [];
    for (const connector of this._connectors.values()) {
      const status = await connector.detect();
      results.push({
        id: connector.id,
        name: connector.name,
        icon: connector.icon,
        status,
        capabilities: connector.getCapabilities(),
      });
    }
    return results;
  }
}
