import * as vscode from "vscode";
import type { UserConfig, WorkdayPlan, RawEvent } from "../types";
import { DEFAULT_USER_CONFIG as defaults } from "../types";

const KEYS = {
  config: "workday.config",
  plan: "workday.plan",
  rawEvents: "workday.rawEvents",
} as const;

export class StorageLayer {
  private _globalState: vscode.Memento;
  private _secrets: vscode.SecretStorage;
  private _storageUri: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._globalState = context.globalState;
    this._secrets = context.secrets;
    this._storageUri =
      context.globalStorageUri ?? context.extensionUri;
  }

  // ── Config ──

  getConfig(): UserConfig {
    return this._globalState.get<UserConfig>(KEYS.config) ?? { ...defaults };
  }

  async saveConfig(config: UserConfig): Promise<void> {
    await this._globalState.update(KEYS.config, config);
  }

  async updateConfig(partial: Partial<UserConfig>): Promise<UserConfig> {
    const current = this.getConfig();
    const updated = { ...current, ...partial };
    await this.saveConfig(updated);
    return updated;
  }

  // ── Plan Cache ──

  getCachedPlan(): WorkdayPlan | null {
    const plan = this._globalState.get<WorkdayPlan>(KEYS.plan);
    if (!plan) return null;
    const today = new Date().toISOString().split("T")[0];
    if (plan.date !== today) return null;
    return plan;
  }

  async cachePlan(plan: WorkdayPlan): Promise<void> {
    await this._globalState.update(KEYS.plan, plan);
  }

  async clearCachedPlan(): Promise<void> {
    await this._globalState.update(KEYS.plan, undefined);
  }

  async updatePlan(
    updater: (plan: WorkdayPlan) => WorkdayPlan
  ): Promise<WorkdayPlan | null> {
    const plan = this.getCachedPlan();
    if (!plan) return null;
    const updated = updater(plan);
    await this.cachePlan(updated);
    return updated;
  }

  // ── Raw Events Cache ──

  cacheRawEvents(events: RawEvent[]): void {
    this._globalState.update(KEYS.rawEvents, events);
  }

  getCachedRawEvents(): RawEvent[] {
    return this._globalState.get<RawEvent[]>(KEYS.rawEvents) ?? [];
  }

  // ── Secrets ──

  async getSecret(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this._secrets.store(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    await this._secrets.delete(key);
  }

  // ── Reset ──

  async reset(): Promise<void> {
    await this._globalState.update(KEYS.config, undefined);
    await this._globalState.update(KEYS.plan, undefined);
    await this._globalState.update(KEYS.rawEvents, undefined);
  }
}
