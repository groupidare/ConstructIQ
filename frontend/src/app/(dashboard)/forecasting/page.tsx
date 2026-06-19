'use client';

import Link from 'next/link';
import { BarChart2 } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { useProjects } from '@/hooks/useProjects';

export default function ForecastingPage() {
  const { projects, loading } = useProjects();

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Demand Forecasting</h1>
        <p className="text-sm text-gray-500 mt-1">AI-powered forecasts using Random Forest + XGBoost ensemble models.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {projects.map(p => (
          <Link key={p.id} href={`/forecasting/${p.id}`}>
            <Card className="hover:shadow-md cursor-pointer transition-shadow">
              <CardBody className="flex items-center gap-4 py-5">
                <div className="p-3 bg-blue-50 rounded-lg">
                  <BarChart2 size={24} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{p.name}</p>
                  <p className="text-xs text-gray-500">{p.type} · {p.status}</p>
                </div>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
