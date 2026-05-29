import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { authAPI, messagesAPI } from '../services/api.js';

const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  });

const fmtInt = (n) => (Number(n) || 0).toLocaleString('es-CO');
const fmtDate = (iso) => new Date(iso).toLocaleString('es-CO');

export default function Dashboard() {
  const { user, logout, setUser } = useAuth();

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
  const [recharges, setRecharges] = useState([]);

  const [editMsg, setEditMsg] = useState(user?.noBalanceMessage || '');
  const [savingMsg, setSavingMsg] = useState(false);
  const [msgSavedAt, setMsgSavedAt] = useState(0);

  // Reload user (balance!) and recharges history every time we poll.
  useEffect(() => {
    authAPI.me().then((r) => {
      setUser(r.data.user);
      setEditMsg(r.data.user?.noBalanceMessage || '');
    });
    authAPI.listRecharges(10).then((r) => setRecharges(r.data.rows || [])).catch(() => {});
  }, []);

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

  const saveMessage = async () => {
    setSavingMsg(true);
    try {
      const { data } = await authAPI.updateSettings({ noBalanceMessage: editMsg });
      setUser(data.user);
      setMsgSavedAt(Date.now());
      setTimeout(() => setMsgSavedAt(0), 2500);
    } catch (e) {
      setError(e.response?.data?.error || 'No se pudo guardar el mensaje');
    } finally {
      setSavingMsg(false);
    }
  };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const blockedCount = stats?.byStatus?.blocked || 0;

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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Saldo disponible"
            value={fmtMoney(user?.availableBalance)}
            sub={`Recargado: ${fmtMoney(user?.totalRecharged)}`}
            accent={user?.availableBalance > 0 ? 'positive' : 'warning'}
          />
          <StatCard
            label="Mensajes totales"
            value={fmtInt(stats?.totalMessages)}
            sub={blockedCount > 0 ? `${fmtInt(blockedCount)} bloqueados` : null}
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
                  <td className="px-4 py-2 text-gray-400 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
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

        {/* Settings: no-balance message */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
          <div>
            <h3 className="text-sm font-medium">Mensaje cuando no hay saldo</h3>
            <p className="text-xs text-gray-500 mt-1">
              Cuando el proxy bloquea un mensaje por falta de saldo, devuelve este texto en el campo
              <code className="text-gray-300 mx-1">fallback_message</code>. Configura tu workflow de GHL para
              que ese texto se envíe al cliente vía un step "Send Message".
            </p>
          </div>
          <textarea
            value={editMsg}
            onChange={(e) => setEditMsg(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full bg-gray-950 border border-gray-800 rounded-lg p-3 text-sm"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={saveMessage}
              disabled={savingMsg || editMsg === user?.noBalanceMessage}
              className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm rounded-lg px-4 py-2"
            >
              {savingMsg ? 'Guardando…' : 'Guardar'}
            </button>
            {msgSavedAt > 0 && (
              <span className="text-xs text-green-400">Guardado</span>
            )}
          </div>
        </div>

        {/* Recharge history */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-medium">Recargas recientes</h3>
            <span className="text-xs text-gray-500">{recharges.length} entradas</span>
          </div>
          {recharges.length === 0 ? (
            <p className="text-xs text-gray-500">
              Aún no hay recargas registradas. Cuando llegue una al webhook <code className="text-gray-300">/api/proxy/recharge</code> aparecerá acá.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left py-1.5">Fecha</th>
                  <th className="text-left py-1.5">Origen</th>
                  <th className="text-left py-1.5">Referencia</th>
                  <th className="text-right py-1.5">Monto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {recharges.map((r) => (
                  <tr key={r.id}>
                    <td className="py-1.5 text-gray-400">{fmtDate(r.createdAt)}</td>
                    <td className="py-1.5">{r.source || '—'}</td>
                    <td className="py-1.5 text-xs text-gray-500">{r.reference || '—'}</td>
                    <td className="py-1.5 text-right">{fmtMoney(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  const accentColor =
    accent === 'positive' ? 'text-green-400' :
    accent === 'warning' ? 'text-amber-400' :
    'text-white';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accentColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    success: 'bg-green-900/40 text-green-300 border-green-800',
    error: 'bg-red-900/40 text-red-300 border-red-800',
    blocked: 'bg-amber-900/40 text-amber-300 border-amber-800'
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
