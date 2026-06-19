'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Package, BarChart2, AlertTriangle, ShoppingCart } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { formatDate, formatCurrency } from '@/lib/utils';
import type { Project } from '@/types/project';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { fetchProject } = useProjects();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchProject(Number(id)).then(p => {
      setProject(p);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <Spinner />;
  if (!project) return <p className="text-center py-16 text-gray-500">Project not found.</p>;

  const quickLinks = [
    { label: 'Inventory',         icon: Package,       href: `/inventory/${id}` },
    { label: 'Forecasting',       icon: BarChart2,      href: `/forecasting/${id}` },
    { label: 'Excess Analytics',  icon: AlertTriangle,  href: `/excess-analytics/${id}` },
    { label: 'Procurement',       icon: ShoppingCart,   href: `/procurement/${id}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
          <p className="text-sm text-gray-500">{project.type} · {project.location}</p>
        </div>
        <Badge
          variant={project.status === 'Active' ? 'success' : project.status === 'Cancelled' ? 'danger' : 'info'}
          className="ml-auto"
        >
          {project.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {quickLinks.map(({ label, icon: Icon, href }) => (
          <Link key={href} href={href}>
            <Card className="hover:shadow-md cursor-pointer">
              <CardBody className="flex flex-col items-center gap-2 py-5 text-center">
                <Icon size={24} className="text-primary-600" />
                <span className="text-sm font-medium text-gray-700">{label}</span>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><h2 className="font-semibold">Overview</h2></CardHeader>
          <CardBody className="space-y-2 text-sm">
            <Row label="Budget"        value={project.budget ? formatCurrency(project.budget) : '—'} />
            <Row label="Start Date"    value={formatDate(project.startDate)} />
            <Row label="Target End"    value={formatDate(project.targetEndDate)} />
            <Row label="Contractor"    value={project.assignedContractor ?? '—'} />
            <Row label="Project Manager" value={project.projectManagerName ?? '—'} />
            <Row label="Site Engineer"   value={project.siteEngineerName ?? '—'} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h2 className="font-semibold">Phases ({project.phases?.length ?? 0})</h2></CardHeader>
          <CardBody className="divide-y">
            {project.phases?.map(ph => (
              <div key={ph.id} className="py-2 flex justify-between items-center text-sm">
                <span className="font-medium">{ph.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 text-xs">{formatDate(ph.startDate)} – {formatDate(ph.endDate)}</span>
                  <Badge variant={ph.status === 'Completed' ? 'success' : ph.status === 'Active' ? 'info' : 'default'} className="text-xs">
                    {ph.status}
                  </Badge>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      {project.description && (
        <Card>
          <CardHeader><h2 className="font-semibold">Description</h2></CardHeader>
          <CardBody><p className="text-sm text-gray-700">{project.description}</p></CardBody>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value}</span>
    </div>
  );
}
