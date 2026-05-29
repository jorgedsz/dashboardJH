import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { messagesAPI } from '../services/api.js';

const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  });

const fmtInt = (n) => (Number(n) || 0).toLocaleString('es-CO');

export default function Dashboard() {
  const { user, logout } = useAuth();

  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(() => {
    const p = { page, pageSize };
    if (search.trim()) p.search = search.trim();
    if (from) p.from = new Date(from).toISOString();
    if (to) p.to = new Date(to).toISOString();
    return p;
  }, [page, search, from, to]);

  const statsParams = useMemo(() => {
    const p = {};
    if (from) p.from = new Date(from).toISOString();
    if (to) p.to = new Date(to).toISOString();
    return p;
  }, [from, to]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([messagesAPI.list(params), messagesAPI.stats(statsParams)])
      .then(([listRes, statsRes]) => {
        if (cancelled) return;
        setRows(listRes.data.rows);
        setTotal(listRes.data.total);
        setStats(statsRes.data);
        setError('');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.response?.data?.error || 'Error al cargar datos');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params, statsParams]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">dashboardJH</h1>
          <p className="text-xs text-gray-500">{user?.email}</p>
        </div>
        <button
          onClick={logout}
          className="text-xs text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5"
        >
          Cerrar sesión
        </button>
      </header>

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Top stat cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Mensajes totales"
            value={fmtInt(stats?.totalMessages)}
            sub={loading ? 'Cargando…' : null}
          />
          <StatCard
            label="Costo total"
            value={fmtMoney(stats?.totalCost)}
            sub={`$${(0.01).toFixed(2)} por mensaje`}
          />
          <StatCard label="Contactos únicos" value={fmtInt(stats?.uniqueContacts)} />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Búsqueda</label>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setPage(1);
                setSearch(e.target.value);
              }}
              placeholder="Nombre, contactId, contenido…"
              className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm w-72"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Desde</label>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setPage(1);
                setFrom(e.target.value);
              }}
              className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Hasta</label>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setPage(1);
                setTo(e.target.value);
              }}
              className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        {/* Volume chart */}
        <DailyChart byDay={stats?.byDay || []} />

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {/* Messages table */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-950 text-gray-400 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Fecha</th>
                <th className="text-left px-4 py-2">Contacto</th>
                <th className="text-left px-4 py-2">Sesión</th>
                <th className="text-left px-4 py-2">Mensaje</th>
                <th className="text-left px-4 py-2">Respuesta</th>
                <th className="text-right px-4 py-2">Costo</th>
                <th className="text-left px-4 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-950/40">
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">
                    {new Date(r.createdAt).toLocaleString('es-CO')}
                  </td>
                  <td className="px-4 py-2">
                    <div className="text-gray-200">{r.contactName || '—'}</div>
                    <div className="text-xs text-gray-500">{r.contactId || ''}</div>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500">{r.sessionId}</td>
                  <td className="px-4 py-2 max-w-xs truncate" title={r.inputMessage}>
                    {r.inputMessage}
                  </td>
                  <td className="px-4 py-2 max-w-xs truncate" title={r.outputMessage || ''}>
                    {r.outputMessage || '—'}
                  </td>
                  <td className="px-4 py-2 text-right">{fmtMoney(r.costCharged)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                    Sin mensajes para este filtro.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-sm text-gray-400">
          <span>
            {fmtInt(total)} mensajes · página {page} de {pages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5 disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages}
              className="border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    success: 'bg-green-900/40 text-green-300 border-green-800',
    error: 'bg-red-900/40 text-red-300 border-red-800'
  };
  const cls = map[status] || 'bg-gray-800 text-gray-300 border-gray-700';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{status}</span>
  );
}

function DailyChart({ byDay }) {
  if (!byDay.length) return null;
  const max = Math.max(...byDay.map((d) => d.count), 1);
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">
        Mensajes por día
      </div>
      <div className="flex items-end gap-1 h-32">
        {byDay.map((d) => (
          <div
            key={d.date}
            className="flex-1 flex flex-col items-center justify-end gap-1"
            title={`${d.date}: ${d.count} mensajes · ${fmtMoney(d.cost)}`}
          >
            <div
              className="w-full bg-primary-600/70 hover:bg-primary-500 rounded-sm"
              style={{ height: `${(d.count / max) * 100}%`, minHeight: '2px' }}
            />
            <div className="text-[10px] text-gray-500 truncate w-full text-center">
              {d.date.slice(5)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
