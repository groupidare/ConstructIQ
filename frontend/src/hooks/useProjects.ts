import { useEffect, useState } from 'react';
import api from '@/lib/api';
import type { Project, ProjectCreateRequest } from '@/types/project';
import { useProjectStore } from '@/store/projectStore';

export function useProjects() {
  const { projects, setProjects, addProject, updateProject, removeProject } = useProjectStore();
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function fetchProjects() {
    setLoading(true);
    try {
      const { data } = await api.get<Project[]>('/projects');
      setProjects(data);
    } catch {
      setError('Failed to load projects.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchProject(id: number): Promise<Project | null> {
    const { data } = await api.get<Project>(`/projects/${id}`);
    return data;
  }

  async function createProject(payload: ProjectCreateRequest): Promise<Project> {
    const { data } = await api.post<Project>('/projects', payload);
    addProject(data);
    return data;
  }

  async function editProject(id: number, payload: ProjectCreateRequest): Promise<Project> {
    const { data } = await api.put<Project>(`/projects/${id}`, payload);
    updateProject(data);
    return data;
  }

  async function deleteProject(id: number): Promise<void> {
    await api.delete(`/projects/${id}`);
    removeProject(id);
  }

  useEffect(() => { fetchProjects(); }, []);

  return { projects, loading, error, fetchProject, createProject, editProject, deleteProject, refresh: fetchProjects };
}
