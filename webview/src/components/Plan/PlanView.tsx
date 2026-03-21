import React from "react";
import { usePlanStore } from "../../stores/planStore";
import { postMessage } from "../../hooks/useVSCode";
import { TaskGroup } from "./TaskGroup";
import {
  RefreshCw,
  Settings,
  Loader2,
  Calendar,
  AlertCircle,
  Inbox,
} from "lucide-react";
import type { TaskCluster, TaskCategory } from "../../../../src/types";

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  review: "Reviews",
  implementation: "Implementation",
  respond: "Respond",
  investigate: "Investigate",
  meeting_prep: "Meeting Prep",
  follow_up: "Follow Up",
  other: "Other",
};

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
  const { plan, syncing } = usePlanStore();

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
            onClick={() => postMessage({ type: "action:openSettings" })}
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
  const doneClusters = plan.clusters.filter((c: TaskCluster) => c.status === "done");
  const snoozedClusters = plan.clusters.filter((c: TaskCluster) => c.status === "snoozed");

  const scheduled = activeClusters.filter((c: TaskCluster) => c.scheduledSlot);
  const backlog = activeClusters.filter((c: TaskCluster) => !c.scheduledSlot);

  const grouped = groupByCategory(scheduled);

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-3">
      {syncing && (
        <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-vscode-descFg">
          <Loader2 size={10} className="animate-spin" />
          Syncing...
        </div>
      )}

      {grouped.map(([category, clusters]) => (
        <TaskGroup
          key={category}
          label={CATEGORY_LABELS[category as TaskCategory] ?? category}
          clusters={clusters}
          totalMinutes={clusters.reduce((s: number, c: TaskCluster) => s + c.estimatedMinutes, 0)}
        />
      ))}

      {backlog.length > 0 && (
        <TaskGroup
          label="Backlog"
          clusters={backlog}
          totalMinutes={backlog.reduce((s: number, c: TaskCluster) => s + c.estimatedMinutes, 0)}
          collapsed
        />
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

function groupByCategory(
  clusters: TaskCluster[]
): [string, TaskCluster[]][] {
  const map = new Map<string, TaskCluster[]>();
  for (const c of clusters) {
    const group = map.get(c.category) ?? [];
    group.push(c);
    map.set(c.category, group);
  }
  return Array.from(map.entries());
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
      <p className="text-xs text-vscode-descFg">Synthesizing your workday...</p>
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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mx-2 mt-2 p-2 rounded bg-vscode-inputBg border border-vscode-error/30 flex items-start gap-2">
      <AlertCircle size={14} className="text-vscode-error shrink-0 mt-0.5" />
      <div>
        <p className="text-xs text-vscode-error">{message}</p>
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
