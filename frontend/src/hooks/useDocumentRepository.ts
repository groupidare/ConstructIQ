import { useState } from 'react';
import api from '@/lib/api';
import type { DocumentCategory, ProjectDocument } from '@/types/document';

// Repository-wide document access — unlike useDocuments(projectId), this isn't
// scoped to a single project (used by the Projects page's File Repository modal,
// which lists/uploads across all projects at once).
export function useDocumentRepository() {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function fetchAll(projectId?: number) {
    setLoading(true);
    try {
      const { data } = await api.get<ProjectDocument[]>('/documents', {
        params: projectId ? { projectId } : {},
      });
      setDocuments(data);
    } catch {
      setError('Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }

  async function upload(file: File, projectId: number, category: DocumentCategory, categoryOther?: string, description?: string): Promise<ProjectDocument> {
    const form = new FormData();
    form.append('file', file);
    form.append('projectId', String(projectId));
    form.append('category', category);
    if (categoryOther) form.append('categoryOther', categoryOther);
    if (description) form.append('description', description);
    const { data } = await api.post<ProjectDocument>('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setDocuments(prev => [data, ...prev]);
    return data;
  }

  async function remove(documentId: number): Promise<void> {
    await api.delete(`/documents/${documentId}`);
    setDocuments(prev => prev.filter(d => d.id !== documentId));
  }

  return { documents, loading, error, fetchAll, upload, remove };
}
