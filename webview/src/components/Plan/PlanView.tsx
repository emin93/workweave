import React from "react";
import { usePlanStore } from "../../stores/planStore";
import { postMessage } from "../../hooks/useVSCode";
import { TaskGroup } from "./TaskGroup";
import { TaskCard } from "../TaskCard/TaskCard";
import {
  RefreshCw,
  Settings,
  Loader2,
  Calendar,
  AlertCircle,
  Inbox,
} from "lucide-react";
import type { TaskCluster } from "../../../../src/types";

export function PlanView() {
  const { plan, syncing, error } = usePlanStore();

  return (
    <div className="flex flex-col h-full">
      <PlanHeader />

      {error && <ErrorBanner message={error} />}

      {syncing && !plan && <LoadingState />}

      {!syncing && !plan && !error && <EmptyState />}

      {plan && <PlanContent plan={plan} syncing={syncing} />}
    </div>
  );
}

function PlanHeader() {
  const { plan, syncing, setView } = usePlanStore();

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const plannedHours = plan
    ? `${(plan.usedMinutes / 60).toFixed(1)}h planned`
    : "";

  return (
    <div className="p-3 border-b border-vscode-border">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-vscode-link" />
          <span className="text-xs font-semibold">Workday</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost"
            onClick={() => postMessage({ type: "action:synthesize" })}
            disabled={syncing}
            title="Sync now"
          >
            {syncing ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
          <button
            className="btn-ghost"
            onClick={() => {
              postMessage({ type: "action:openSettings" });
              setView("settings");
            }}
            title="Settings"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
      <div className="text-[10px] text-vscode-descFg">
        {today}
        {plannedHours && ` \u2014 ${plannedHours}`}
      </div>
      {plan && <ProgressBar plan={plan} />}
    </div>
  );
}

function PlanContent({
  plan,
  syncing,
}: {
  plan: import("../../../../src/types").WorkdayPlan;
  syncing: boolean;
}) {
  const activeClusters = plan.clusters.filter(
    (c: TaskCluster) => c.status !== "snoozed" && c.status !== "done"
  );
  const doneClusters = plan.clusters.filter(
    (c: TaskCluster) => c.status === "done"
  );
  const snoozedClusters = plan.clusters.filter(
    (c: TaskCluster) => c.status === "snoozed"
  );

  const scheduled = activeClusters.filter(
    (c: TaskCluster) => c.scheduledSlot
  );
  const backlog = activeClusters.filter(
    (c: TaskCluster) => !c.scheduledSlot
  );

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1">
      {syncing && (
        <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-vscode-descFg">
          <Loader2 size={10} className="animate-spin" />
          Syncing...
        </div>
      )}

      {scheduled.map((cluster, i) => (
        <TaskCard key={cluster.id} cluster={cluster} index={i + 1} />
      ))}

      {backlog.length > 0 && (
        <div className="pt-2">
          <TaskGroup
            label="Backlog"
            clusters={backlog}
            totalMinutes={backlog.reduce(
              (s: number, c: TaskCluster) => s + c.estimatedMinutes,
              0
            )}
            collapsed
          />
        </div>
      )}

      {doneClusters.length > 0 && (
        <TaskGroup
          label="Done"
          clusters={doneClusters}
          totalMinutes={0}
          collapsed
        />
      )}

      {snoozedClusters.length > 0 && (
        <TaskGroup
          label="Snoozed"
          clusters={snoozedClusters}
          totalMinutes={0}
          collapsed
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <Inbox size={32} className="text-vscode-descFg mb-3" />
      <h3 className="text-sm font-medium mb-1">No plan yet</h3>
      <p className="text-xs text-vscode-descFg mb-4">
        Synthesize your workday to see prioritized tasks with one-click actions.
      </p>
      <button
        className="btn-primary"
        onClick={() => postMessage({ type: "action:synthesize" })}
      >
        Synthesize My Day
      </button>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <Loader2 size={24} className="animate-spin text-vscode-link mb-3" />
      <p className="text-xs text-vscode-descFg">
        Synthesizing your workday...
      </p>
      <div className="mt-4 space-y-2 w-full">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card animate-pulse">
            <div className="h-3 bg-vscode-listHover rounded w-3/4 mb-2" />
            <div className="h-2 bg-vscode-listHover rounded w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProgressBar({
  plan,
}: {
  plan: import("../../../../src/types").WorkdayPlan;
}) {
  const total = plan.clusters.length;
  if (total === 0) return null;

  const done = plan.clusters.filter((c) => c.status === "done").length;
  const inProgress = plan.clusters.filter(
    (c) => c.status === "in_progress"
  ).length;
  const pctDone = (done / total) * 100;
  const pctActive = (inProgress / total) * 100;

  return (
    <div className="mt-2">
      <div className="h-1 rounded-full bg-vscode-inputBg overflow-hidden flex">
        <div
          className="h-full bg-vscode-success transition-all duration-300"
          style={{ width: `${pctDone}%` }}
        />
        <div
          className="h-full bg-vscode-link transition-all duration-300"
          style={{ width: `${pctActive}%` }}
        />
      </div>
      <div className="text-[9px] text-vscode-descFg mt-0.5">
        {done}/{total} done
        {inProgress > 0 && ` \u2022 ${inProgress} in progress`}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-2 mt-2 p-2 rounded bg-vscode-inputBg border border-vscode-error/30 flex items-start gap-2">
      <AlertCircle size={14} className="text-vscode-error shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-vscode-error whitespace-pre-wrap">
          {message}
        </p>
        <button
          className="text-[10px] text-vscode-link mt-1 bg-transparent border-none cursor-pointer p-0"
          onClick={() => postMessage({ type: "action:synthesize" })}
        >
          Retry
        </button>
      </div>
    </div>
  );
}
