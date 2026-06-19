'use client';

import Link from 'next/link';
import { Plus, FolderOpen } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useAuthStore } from '@/store/authStore';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';
import type { Project } from '@/types/project';

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  Planning:  'info',
  Active:    'success',
  OnHold:    'warning',
  Completed: 'default',
  Cancelled: 'danger',
};

export default function ProjectsPage() {
  const { projects, loading } = useProjects();
  const { user } = useAuthStore();
  const canCreate = user?.role === 'Admin' || user?.role === 'ProjectManager';

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">{projects.length} project{projects.length !== 1 ? 's' : ''} found</p>
        </div>
        {canCreate && (
          <Link href="/projects/create">
            <Button><Plus size={16} /> New Project</Button>
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16">
          <FolderOpen size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">No projects yet.</p>
          {canCreate && <Link href="/projects/create"><Button className="mt-4">Create your first project</Button></Link>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projects.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project: p }: { project: Project }) {
  return (
    <Link href={`/projects/${p.id}`}>
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 leading-tight">{p.name}</h3>
            <Badge variant={statusVariant[p.status] ?? 'default'}>{p.status}</Badge>
          </div>
          <p className="text-xs text-gray-500">{p.type} · {p.location}</p>
          {p.description && <p className="text-sm text-gray-600 line-clamp-2">{p.description}</p>}
          <div className="pt-2 border-t border-gray-100 flex justify-between text-xs text-gray-500">
            <span>{formatDate(p.startDate)}</span>
            <span>→ {formatDate(p.targetEndDate)}</span>
          </div>
          <p className="text-xs text-gray-500">PM: {p.projectManagerName}</p>
        </div>
      </Card>
    </Link>
  );
}
