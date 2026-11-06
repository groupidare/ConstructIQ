import type { ExcessRelease, RedistributionRecommendation, RedistributionStatus } from "@/types/procurement";

// What's moved between projects: a project's logged Excess released by the
// warehouse for another project's request, plus transfers approved back when
// that was a separate step — they moved too, and the Excess log still names
// them. The Redistribution page and the Redistribution report both read this,
// so their numbers match.

export const UNDECIDED_STATUSES: RedistributionStatus[] = ["AiSuggested", "PendingApproval"];
export const REDISTRIBUTED_STATUSES: RedistributionStatus[] = ["Approved", "InTransit", "Completed"];

export interface Movement {
  key: string;
  materialName: string;
  quantity: number;
  unit: string;
  sourceProjectId: number;
  sourceProjectName: string;
  targetProjectId: number;
  targetProjectName: string;
  at: string;
}

const newestFirst = (a: Movement, b: Movement) => new Date(b.at).getTime() - new Date(a.at).getTime();

export function movementsOf(transfers: RedistributionRecommendation[], releases: ExcessRelease[]): Movement[] {
  return [
    ...transfers.filter(t => REDISTRIBUTED_STATUSES.includes(t.status)).map(t => ({
      key: `transfer-${t.id}`,
      materialName: t.materialName, quantity: t.transferQuantity, unit: t.unit,
      sourceProjectId: t.sourceProjectId, sourceProjectName: t.sourceProjectName,
      targetProjectId: t.targetProjectId, targetProjectName: t.targetProjectName,
      at: t.approvedAt ?? t.generatedAt,
    })),
    ...releases.map(r => ({
      key: `release-${r.id}`,
      materialName: r.materialName, quantity: r.quantity, unit: r.unit,
      sourceProjectId: r.sourceProjectId, sourceProjectName: r.sourceProjectName,
      targetProjectId: r.targetProjectId, targetProjectName: r.targetProjectName,
      at: r.releasedAt,
    })),
  ].sort(newestFirst);
}

export interface ProjectMovement {
  movement: Movement;
  sent: boolean;
  otherProject: string;
}

export interface ProjectOverview {
  projectId: number;
  projectName: string;
  sentCount: number;
  receivedCount: number;
  // Newest first.
  movements: ProjectMovement[];
}

// Each movement shows under both projects: sent by one, received by the other.
// Expects movementsOf's order, which also puts the most recent project first.
export function buildProjectOverviews(movements: Movement[]): ProjectOverview[] {
  const byProject = new Map<number, ProjectOverview>();
  const add = (projectId: number, projectName: string, entry: ProjectMovement) => {
    const overview = byProject.get(projectId) ?? { projectId, projectName, sentCount: 0, receivedCount: 0, movements: [] };
    overview.movements.push(entry);
    if (entry.sent) overview.sentCount++; else overview.receivedCount++;
    byProject.set(projectId, overview);
  };

  for (const m of movements) {
    add(m.sourceProjectId, m.sourceProjectName, { movement: m, sent: true, otherProject: m.targetProjectName });
    add(m.targetProjectId, m.targetProjectName, { movement: m, sent: false, otherProject: m.sourceProjectName });
  }
  return [...byProject.values()];
}
