import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { TaskCard } from "../TaskCard/TaskCard";
import type { TaskCluster } from "../../../../src/types";

interface TaskGroupProps {
  label: string;
  clusters: TaskCluster[];
  totalMinutes: number;
  collapsed?: boolean;
}

export function TaskGroup({
  label,
  clusters,
  totalMinutes,
  collapsed: initialCollapsed = false,
}: TaskGroupProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const timeLabel =
    totalMinutes > 0
      ? totalMinutes >= 60
        ? `${(totalMinutes / 60).toFixed(1)}h`
        : `${totalMinutes}m`
      : "";

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full text-left px-1 py-1 bg-transparent border-none cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? (
          <ChevronRight size={12} className="text-vscode-descFg" />
        ) : (
          <ChevronDown size={12} className="text-vscode-descFg" />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wide text-vscode-descFg">
          {label}
        </span>
        {timeLabel && (
          <span className="text-[10px] text-vscode-descFg ml-auto">
            {timeLabel}
          </span>
        )}
        <span className="text-[10px] bg-vscode-badge text-vscode-badgeFg rounded-full px-1.5 ml-1">
          {clusters.length}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-1 mt-1">
          {clusters.map((cluster) => (
            <TaskCard key={cluster.id} cluster={cluster} />
          ))}
        </div>
      )}
    </div>
  );
}
