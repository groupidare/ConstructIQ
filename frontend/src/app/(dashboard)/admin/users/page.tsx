'use client';

import { useEffect, useState } from 'react';
import { Plus, UserCheck, UserX } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { Table, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate } from '@/lib/utils';

interface User {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const roleVariant: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  Admin:               'danger',
  ProjectManager:      'info',
  SiteEngineer:        'success',
  WarehousePersonnel:  'warning',
  ProcurementOfficer:  'default',
};

export default function UsersPage() {
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    username: '', email: '', password: '', firstName: '', lastName: '', role: 'SiteEngineer',
  });

  useEffect(() => {
    api.get<User[]>('/users').then(r => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  async function handleCreate() {
    setSubmitting(true);
    try {
      const { data } = await api.post<User>('/users', form);
      setUsers(prev => [data, ...prev]);
      toast.success('User created!');
      setShowModal(false);
    } catch {
      toast.error('Failed to create user.');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(user: User) {
    try {
      await api.patch(`/users/${user.id}/status`, { isActive: !user.isActive });
      setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: !u.isActive } : u));
    } catch {
      toast.error('Failed to update user status.');
    }
  }

  if (loading) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500">{users.length} users registered</p>
        </div>
        <Button onClick={() => setShowModal(true)}><Plus size={14} /> Add User</Button>
      </div>

      <Card>
        <CardBody className="p-0">
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Username</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <Tr key={u.id}>
                  <Td className="font-medium">{u.firstName} {u.lastName}</Td>
                  <Td className="text-gray-500">@{u.username}</Td>
                  <Td>{u.email}</Td>
                  <Td><Badge variant={roleVariant[u.role] ?? 'default'}>{u.role}</Badge></Td>
                  <Td><Badge variant={u.isActive ? 'success' : 'danger'}>{u.isActive ? 'Active' : 'Inactive'}</Badge></Td>
                  <Td className="text-xs text-gray-400">{formatDate(u.createdAt)}</Td>
                  <Td>
                    <button onClick={() => toggleActive(u)} className="text-gray-400 hover:text-gray-600">
                      {u.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                    </button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add New User">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            <Input label="Last Name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
          </div>
          <Input label="Username" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} />
          <Input label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <Input label="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              {['Admin','ProjectManager','SiteEngineer','WarehousePersonnel','ProcurementOfficer'].map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button loading={submitting} onClick={handleCreate}>Create User</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
