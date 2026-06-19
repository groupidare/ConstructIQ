'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';
import { Card, CardBody } from '@/components/ui/Card';
import Spinner from '@/components/ui/Spinner';
import { Table, Th, Td, Tr } from '@/components/ui/Table';

interface ActivityLog {
  id: number;
  userId: number;
  userDisplay: string;
  action: string;
  entityType: string;
  entityId: number;
  ipAddress: string;
  details: string;
  createdAt: string;
}

export default function ActivityLogsPage() {
  const [logs, setLogs]         = useState<ActivityLog[]>([]);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    api.get<ActivityLog[]>(`/activity-logs?page=${page}&pageSize=${PAGE_SIZE}`)
      .then(r => setLogs(r.data))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Activity Logs</h1>
        <p className="text-sm text-gray-500">System audit trail — all create/update/delete actions.</p>
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Entity ID</Th>
                <Th>IP</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map(l => (
                <Tr key={l.id}>
                  <Td className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(l.createdAt).toLocaleString('en-PH')}
                  </Td>
                  <Td>{l.userDisplay}</Td>
                  <Td>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      l.action.startsWith('POST')   ? 'bg-green-100 text-green-800' :
                      l.action.startsWith('PUT')    ? 'bg-blue-100 text-blue-800'   :
                      l.action.startsWith('DELETE') ? 'bg-red-100 text-red-800'     :
                      'bg-gray-100 text-gray-700'
                    }`}>{l.action}</span>
                  </Td>
                  <Td>{l.entityType || '—'}</Td>
                  <Td>{l.entityId || '—'}</Td>
                  <Td className="text-xs text-gray-400">{l.ipAddress || '—'}</Td>
                  <Td className="text-xs text-gray-500 max-w-xs truncate">{l.details || '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {logs.length === 0 && (
            <p className="text-center text-gray-400 py-10 text-sm">No activity logs yet.</p>
          )}
        </CardBody>
      </Card>

      <div className="flex justify-center gap-2">
        <button className="btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span className="text-sm text-gray-500 self-center">Page {page}</span>
        <button className="btn-secondary" disabled={logs.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  );
}
