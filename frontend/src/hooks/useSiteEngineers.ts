import { useEffect, useState } from 'react';
import api from '@/lib/api';

export interface SiteEngineerOption {
  id: number;
  firstName: string;
  lastName: string;
}

// Backs the "Assign Engineer/PIC" dropdown on project creation/editing — a
// minimal, scoped-down listing (id + name only) so Admin/ProjectManager can
// pick an assignee without needing the full Admin-only user roster.
export function useSiteEngineers() {
  const [siteEngineers, setSiteEngineers] = useState<SiteEngineerOption[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchSiteEngineers() {
    setLoading(true);
    try {
      const { data } = await api.get<SiteEngineerOption[]>('/users/site-engineers');
      setSiteEngineers(data);
    } catch {
      setSiteEngineers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchSiteEngineers(); }, []);

  return { siteEngineers, loading, fetchSiteEngineers };
}
