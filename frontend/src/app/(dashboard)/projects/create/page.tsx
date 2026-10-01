'use client';

import { useRouter } from 'next/navigation';
import NewProjectWizard from '@/components/projects/NewProjectWizard';

export default function CreateProjectPage() {
  const router = useRouter();

  return (
    <div className="max-w-4xl mx-auto">
      <NewProjectWizard
        onCancel={() => router.back()}
        onSkip={() => router.push('/projects')}
        onFinish={(project) => router.push(`/projects/${project.id}`)}
      />
    </div>
  );
}
