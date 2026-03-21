import * as vscode from "vscode";
import { SidebarProvider } from "./webview/SidebarProvider";
import { ConnectorRegistry } from "./connectors/registry";
import { GitHubConnector } from "./connectors/github";
import { LinearConnector } from "./connectors/linear";
import { StorageLayer } from "./storage/store";
import { IngestionOrchestrator, log } from "./pipeline/ingest";
import { normalize } from "./pipeline/normalize";
import { correlate } from "./pipeline/correlate";
import { prioritize } from "./pipeline/prioritize";
import { schedule } from "./pipeline/schedule";
import { ExecutionEngine } from "./execution/actions";
import { OnboardingManager } from "./onboarding/wizard";
import type { UserConfig, WorkdayPlan, WebviewMessage } from "./types";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageLayer(context);
  const registry = new ConnectorRegistry();
  registry.register(new GitHubConnector());
  registry.register(new LinearConnector());

  const ingestion = new IngestionOrchestrator(registry);
  const execution = new ExecutionEngine(storage);
  const onboarding = new OnboardingManager(storage, registry);

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context,
    handleWebviewMessage
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "workday.sidebarView",
      sidebarProvider
    )
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBarItem.command = "workday.synthesize";
  statusBarItem.text = "$(calendar) Workday";
  statusBarItem.tooltip = "Synthesize your workday";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.synthesize", () =>
      synthesize(sidebarProvider, storage, ingestion, onboarding)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.openSettings", () => {
      sidebarProvider.postMessage({
        type: "state:config",
        config: storage.getConfig(),
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.resetOnboarding", async () => {
      await onboarding.reset();
      sidebarProvider.postMessage({
        type: "state:onboarding",
        step: "not_started",
      });
    })
  );

  async function handleWebviewMessage(message: WebviewMessage) {
    switch (message.type) {
      case "ready": {
        const config = storage.getConfig();
        log.info(`Webview ready. Onboarding state: ${config.onboardingState}`);
        log.info(`Enabled connectors: ${JSON.stringify(config.enabledConnectors.map(c => ({ id: c.id, enabled: c.enabled })))}`);

        if (config.onboardingState !== "complete") {
          const detected = await onboarding.detectEnvironment();
          log.info(`Detected connectors: ${JSON.stringify(detected.map(c => ({ id: c.id, available: c.status.available })))}`);
          sidebarProvider.postMessage({
            type: "state:onboarding",
            step: config.onboardingState === "not_started" ? "detecting" : config.onboardingState,
            detectedConnectors: detected,
          });
        } else {
          // Send config first so webview knows onboarding is complete
          sidebarProvider.postMessage({ type: "state:config", config });
          // Then send cached plan (may be null for a new day)
          const cachedPlan = storage.getCachedPlan();
          log.info(`Cached plan: ${cachedPlan ? `${cachedPlan.clusters.length} clusters` : "none"}`);
          sidebarProvider.postMessage({
            type: "state:plan",
            plan: cachedPlan,
          });
          // Auto-sync if no cached plan
          if (!cachedPlan && config.autoSync) {
            log.info("No cached plan for today, auto-syncing...");
            await synthesize(sidebarProvider, storage, ingestion, onboarding);
          }
        }
        break;
      }
      case "action:synthesize":
        await synthesize(sidebarProvider, storage, ingestion, onboarding);
        break;
      case "action:execute":
        await execution.execute(
          message.clusterId,
          message.actionId,
          storage.getCachedPlan()
        );
        break;
      case "action:snooze":
        await execution.snooze(
          message.clusterId,
          message.hours,
          storage
        );
        sidebarProvider.postMessage({
          type: "state:plan",
          plan: storage.getCachedPlan(),
        });
        break;
      case "action:markDone":
        await execution.markDone(message.clusterId, storage);
        sidebarProvider.postMessage({
          type: "state:plan",
          plan: storage.getCachedPlan(),
        });
        updateStatusBar(storage.getCachedPlan());
        break;
      case "onboarding:selectConnectors":
        log.info(`Selecting connectors: ${JSON.stringify(message.connectorIds)}`);
        await onboarding.selectConnectors(message.connectorIds);
        log.info(`Config after select: ${JSON.stringify(storage.getConfig().enabledConnectors)}`);
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "configuring",
        });
        break;
      case "onboarding:configure":
        await onboarding.configure(message.config);
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "validating",
        });
        break;
      case "onboarding:complete":
        await onboarding.complete();
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "complete",
        });
        await synthesize(sidebarProvider, storage, ingestion, onboarding);
        break;
      case "action:openSettings":
        sidebarProvider.postMessage({
          type: "state:config",
          config: storage.getConfig(),
        });
        break;
      case "action:resetOnboarding":
        await onboarding.reset();
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "not_started",
        });
        break;
    }
  }

  const config = storage.getConfig();
  if (config.onboardingState === "complete" && config.autoSync) {
    setTimeout(() => {
      synthesize(sidebarProvider, storage, ingestion, onboarding);
    }, 3000);
  }
}

async function synthesize(
  sidebar: SidebarProvider,
  storage: StorageLayer,
  ingestion: IngestionOrchestrator,
  onboarding: OnboardingManager
) {
  const config = storage.getConfig();
  if (config.onboardingState !== "complete") {
    return;
  }

  sidebar.postMessage({ type: "state:syncing", syncing: true });
  statusBarItem.text = "$(sync~spin) Syncing...";

  try {
    const enabledIds = config.enabledConnectors
      .filter((c) => c.enabled)
      .map((c) => c.id);

    log.info(`Synthesizing with connectors: ${enabledIds.join(", ") || "(none)"}`);
    log.info(`All connector configs: ${JSON.stringify(config.enabledConnectors)}`);

    if (enabledIds.length === 0) {
      log.warn("No connectors enabled. Resetting onboarding.");
      sidebar.postMessage({
        type: "state:error",
        error: "No connectors enabled. Please set up your connectors.",
      });
      await onboarding.reset();
      const detected = await onboarding.detectEnvironment();
      sidebar.postMessage({
        type: "state:onboarding",
        step: "detecting",
        detectedConnectors: detected,
      });
      sidebar.postMessage({ type: "state:syncing", syncing: false });
      return;
    }

    const rawEvents = await ingestion.fetchAll(enabledIds);
    storage.cacheRawEvents(rawEvents);

    log.info(`Raw events: ${rawEvents.length}`);

    const artifacts = normalize(rawEvents);
    log.info(`Artifacts: ${artifacts.length}`);

    const correlated = correlate(artifacts);
    const prioritized = prioritize(correlated);
    log.info(`Task clusters: ${prioritized.length}`);

    const plan = schedule(prioritized, config.workdayMinutes);
    log.info(`Plan: ${plan.clusters.length} clusters, ${plan.usedMinutes}m used`);

    storage.cachePlan(plan);
    sidebar.postMessage({ type: "state:plan", plan });
    updateStatusBar(plan);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Synthesis failed: ${msg}`);
    sidebar.postMessage({ type: "state:error", error: msg });
    vscode.window.showErrorMessage(`Workday Synthesizer: ${msg}`);
  } finally {
    sidebar.postMessage({ type: "state:syncing", syncing: false });
  }
}

function updateStatusBar(plan: WorkdayPlan | null) {
  if (!plan) {
    statusBarItem.text = "$(calendar) Workday";
    return;
  }
  const done = plan.clusters.filter((c) => c.status === "done").length;
  const total = plan.clusters.length;
  statusBarItem.text = `$(calendar) Workday: ${done}/${total} done`;
}

export function deactivate() {}
