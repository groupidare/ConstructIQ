'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { useProjects } from '@/hooks/useProjects';

export default function ExcessAnalyticsPage() {
  const { projects, loading } = useProjects();

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Excess / Waste Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Record and analyze excess and wasted materials per project.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.map(p => (
          <Link key={p.id} href={`/excess-analytics/${p.id}`}>
            <Card className="hover:shadow-md cursor-pointer transition-shadow">
              <CardBody className="flex items-center gap-4 py-5">
                <div className="p-3 bg-yellow-50 rounded-lg">
                  <AlertTriangle size={24} className="text-yellow-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.location}</p>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
