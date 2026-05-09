import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { KanbanBoard } from './components/KanbanBoard';
import { OrgChart } from './components/OrgChart';
import { useSSE } from './hooks/useSSE';
import { api, type Booking, type Agent, type DashboardKPI } from './lib/api';

const TENANT_ID = 'demo-tenant';

function KPIBar({ kpis }: { kpis: DashboardKPI | null }) {
  if (!kpis) return null;
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      <KPI label="Bookings" value={kpis.bookings.total.toString()} sub={`${kpis.bookings.confirmed} confirmed`} />
      <KPI label="Revenue" value={kpis.bookings.revenue.formatted} sub={`${kpis.bookings.pipeline} in pipeline`} />
      <KPI label="Businesses" value={kpis.businesses.active.toString()} sub={`${kpis.businesses.total} total`} />
      <KPI label="Agents" value={`${kpis.agents.active}/${kpis.agents.total}`} sub={`${kpis.agents.utilisationPct}% util`} />
      <KPI label="Marketplace" value={kpis.marketplace.listings.toString()} sub={`${kpis.marketplace.deals} deals`} />
    </div>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      <div className="text-xs text-slate-400 mt-0.5">{sub}</div>
    </div>
  );
}

function RealtimeBadge({ connected, latest }: { connected: boolean; latest: { type: string } | null }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${connected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
      {connected ? (latest ? `Live: ${latest.type}` : 'Connected') : 'Disconnected'}
    </div>
  );
}

function Nav() {
  const location = useLocation();
  const linkClass = (path: string) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${location.pathname === path ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`;

  return (
    <nav className="flex gap-2">
      <Link to="/" className={linkClass('/')}>Kanban</Link>
      <Link to="/org" className={linkClass('/org')}>Org Chart</Link>
      <Link to="/kpis" className={linkClass('/kpis')}>KPIs</Link>
    </nav>
  );
}

export default function App() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [kpis, setKpis] = useState<DashboardKPI | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { connected, latest } = useSSE(TENANT_ID);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [b, a, k] = await Promise.all([
        api.bookings.list(TENANT_ID),
        api.agents.list(TENANT_ID),
        api.dashboard.kpis(TENANT_ID),
      ]);
      setBookings(b);
      setAgents(a);
      setKpis(k);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleMoveBooking = useCallback(async (bookingId: string, newStatus: string) => {
    await api.bookings.patchStatus(bookingId, newStatus, TENANT_ID);
    setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: newStatus } : b));
  }, []);

  if (loading) return <div className="flex items-center justify-center min-h-screen"><div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full" /></div>;
  if (error) return <div className="flex items-center justify-center min-h-screen"><div className="bg-red-100 text-red-700 p-6 rounded-lg">{error}</div></div>;

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <header className="bg-white border-b sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-xl font-bold text-slate-900">EntEx</h1>
              <Nav />
            </div>
            <RealtimeBadge connected={connected} latest={latest} />
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 py-6">
          <Routes>
            <Route path="/" element={<KanbanBoard bookings={bookings} onMove={handleMoveBooking} />} />
            <Route path="/org" element={<OrgChart agents={agents} businessName="EntEx Agency" />} />
            <Route path="/kpis" element={<KPIBar kpis={kpis} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
