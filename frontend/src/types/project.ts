export type ProjectStatus = "Planning" | "Active" | "OnHold" | "Completed" | "Cancelled";

export const PROJECT_STATUSES: ProjectStatus[] = ["Planning", "Active", "OnHold", "Completed", "Cancelled"];
export type ProjectType =
  | "Residential"
  | "Commercial"
  | "Industrial"
  | "Infrastructure"
  | "Renovation"
  | "Others";

export const PROJECT_TYPES: ProjectType[] = [
  "Renovation",
  "Commercial",
  "Industrial",
  "Infrastructure",
  "Residential",
  "Others",
];

export interface Project {
  id: number;
  name: string;
  type: ProjectType;
  otherTypeSpecify?: string;
  location: string;
  description?: string;
  budget: number;
  startDate: string;
  targetEndDate: string;
  status: ProjectStatus;
  // True only for projects backfilled via "Add Completed Project" — pure
  // historical training data, not a real project tracked through the app.
  isHistorical: boolean;
  assignedContractor?: string;
  projectManagerId: number;
  projectManagerName: string;
  siteEngineerId?: number;
  siteEngineerName?: string;
  phases: Phase[];
  createdAt: string;
  updatedAt: string;
}

export interface Phase {
  id: number;
  projectId: number;
  name: string;
  order: number;
  startDate: string;
  endDate: string;
  status: "Pending" | "Active" | "Completed";
  progressPercent: number;
}

export interface ProjectCreateRequest {
  name: string;
  type: ProjectType;
  otherTypeSpecify?: string;
  location: string;
  description?: string;
  budget: number;
  startDate: string;
  targetEndDate: string;
  status?: ProjectStatus;
  isHistorical?: boolean;
  assignedContractor?: string;
  siteEngineerId?: number;
  phases: Omit<Phase, "id" | "projectId" | "status" | "progressPercent">[];
}
