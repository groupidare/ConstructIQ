import { useState } from 'react';
import api from '@/lib/api';
import type { DocumentCategory, DocumentParseResult, MeasurementParseResult, ProjectDocument } from '@/types/document';

export function useDocuments(projectId: number) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function fetchDocuments() {
    setLoading(true);
    try {
      const { data } = await api.get<ProjectDocument[]>(`/documents/project/${projectId}`);
      setDocuments(data);
    } catch {
      setError('Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }

  async function uploadDocument(file: File, category: DocumentCategory): Promise<ProjectDocument> {
    const form = new FormData();
    form.append('file', file);
    form.append('projectId', String(projectId));
    form.append('category', category);
    const { data } = await api.post<ProjectDocument>('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setDocuments(prev => [data, ...prev]);
    return data;
  }

  async function parseDocument(documentId: number): Promise<DocumentParseResult> {
    const { data } = await api.post<DocumentParseResult>(`/documents/${documentId}/parse`);
    return data;
  }

  async function parseMeasurements(documentId: number): Promise<MeasurementParseResult> {
    const { data } = await api.post<MeasurementParseResult>(`/documents/${documentId}/parse-measurements`);
    return data;
  }

  async function deleteDocument(documentId: number): Promise<void> {
    await api.delete(`/documents/${documentId}`);
    setDocuments(prev => prev.filter(d => d.id !== documentId));
  }

  return { documents, loading, error, fetchDocuments, uploadDocument, parseDocument, parseMeasurements, deleteDocument };
}
