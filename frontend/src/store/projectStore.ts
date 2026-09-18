import { create } from "zustand";
import type { Project } from "@/types/project";

interface ProjectStore {
  projects: Project[];
  selectedProject: Project | null;
  setProjects: (projects: Project[]) => void;
  setSelectedProject: (project: Project | null) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (id: number) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  selectedProject: null,
  setProjects: (projects) => set({ projects }),
  setSelectedProject: (project) => set({ selectedProject: project }),
  addProject: (project) =>
    set((state) => ({ projects: [project, ...state.projects] })),
  updateProject: (project) =>
    set((state) => ({
      projects: state.projects.map((p) => (p.id === project.id ? project : p)),
    })),
  removeProject: (id) =>
    set((state) => ({ projects: state.projects.filter((p) => p.id !== id) })),
}));
