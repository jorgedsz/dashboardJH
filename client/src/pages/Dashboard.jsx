import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { authAPI, callsAPI, messagesAPI } from '../services/api.js';

const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString('es-CO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  });

const fmtRate = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString('es-CO', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  });
};

const fmtInt = (n) => (Number(n) || 0).toLocaleString('es-CO');
const fmtDate = (iso) => new Date(iso).toLocaleString('es-CO');

const fmtDuration = (totalSec) => {
  const n = Math.max(0, Math.floor(Number(totalSec) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const REFRESH_MS = 5000;

export default function Dashboard() {
  const { user, logout, setUser } = useAuth();

  const [activeTab, setActiveTab] = useState('messages');

  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [error, setError] = useState('');
  const [recharges, setRecharges] = useState([]);

  const [editMsg, setEditMsg] = useState(user?.noBalanceMessage || '');
  const [savingMsg, setSavingMsg] = useState(false);
  const [msgSavedAt, setMsgSavedAt] = useState(0);

  // Shared refresh tick. Pauses while the tab is hidden.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    let id;
    const start = () => {
      if (id) return;
      id = setInterval(() => setRefreshTick((t) => t + 1), REFRESH_MS);
    };
    const stop = () => {
      if (!id) return;
      clearInterval(id);
      id = null;
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        setRefreshTick((t) => t + 1);
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Owner + recharges on every tick.
  useEffect(() => {
    authAPI
      .me()
      .then((r) => {
        setUser(r.data.user);
        setEditMsg((prev) => (prev ? prev : r.data.user?.noBalanceMessage || ''));
      })
      .catch(() => {});
    authAPI
      .listRecharges(10)
      .then((r) => setRecharges(r.data.rows || []))
      .catch(() => {});
  }, [refreshTick]);

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

  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">dashboardJH</h1>
          <p className="text-xs text-gray-500">{user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <LiveIndicator refreshing={refreshing} lastUpdatedAt={lastUpdatedAt} />
          <button
            onClick={logout}
            className="text-xs text-gray-400 hover:text-gray-200 border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5"
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      <main className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Saldo (shared across both tabs) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            label="Saldo disponible"
            value={fmtMoney(user?.availableBalance)}
            sub={`Recargado total: ${fmtMoney(user?.totalRecharged)}`}
            accent={user?.availableBalance > 0 ? 'positive' : 'warning'}
          />
          <StatCard
            label="Mensaje de saldo agotado"
            value={(user?.noBalanceMessage || '—').slice(0, 80) + ((user?.noBalanceMessage?.length || 0) > 80 ? '…' : '')}
            sub={`Editable abajo`}
            small
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-800">
          <TabButton active={activeTab === 'messages'} onClick={() => setActiveTab('messages')}>
            Mensajes
          </TabButton>
          <TabButton active={activeTab === 'calls'} onClick={() => setActiveTab('calls')}>
            Llamadas
          </TabButton>
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {activeTab === 'messages' && (
          <MessagesView
            refreshTick={refreshTick}
            onRefreshStart={() => setRefreshing(true)}
            onRefreshEnd={() => {
              setRefreshing(false);
              setLastUpdatedAt(Date.now());
            }}
            onError={(e) => setError(e || '')}
          />
        )}
        {activeTab === 'calls' && (
          <CallsView
            refreshTick={refreshTick}
            onRefreshStart={() => setRefreshing(true)}
            onRefreshEnd={() => {
              setRefreshing(false);
              setLastUpdatedAt(Date.now());
            }}
            onError={(e) => setError(e || '')}
          />
        )}

        {/* Settings: no-balance message */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 space-y-3">
          <div>
            <h3 className="text-sm font-medium">Mensaje cuando no hay saldo</h3>
            <p className="text-xs text-gray-500 mt-1">
              El proxy de mensajes y el pre-call gate de llamadas devuelven este texto en
              <code className="text-gray-300 mx-1">fallback_message</code> / <code className="text-gray-300 mx-1">noBalanceMessage</code> cuando el saldo es insuficiente. Configura tu workflow para reenviarlo al cliente final.
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

// -----------------------------------------------------------------------
// Messages tab
// -----------------------------------------------------------------------
function MessagesView({ refreshTick, onRefreshStart, onRefreshEnd, onError }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);

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

  const hasLoadedOnce = stats !== null;
  useEffect(() => {
    let cancelled = false;
    if (hasLoadedOnce) onRefreshStart();
    else setLoading(true);

    Promise.all([messagesAPI.list(params), messagesAPI.stats(statsParams)])
      .then(([listRes, statsRes]) => {
        if (cancelled) return;
        setRows(listRes.data.rows);
        setTotal(listRes.data.total);
        setStats(statsRes.data);
        onError('');
      })
      .catch((e) => {
        if (cancelled) return;
        onError(e.response?.data?.error || 'Error al cargar mensajes');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onRefreshEnd();
      });
    return () => {
      cancelled = true;
    };
  }, [params, statsParams, refreshTick]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const blockedCount = stats?.byStatus?.blocked || 0;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          label="Mensajes totales"
          value={fmtInt(stats?.totalMessages)}
          sub={blockedCount > 0 ? `${fmtInt(blockedCount)} bloqueados` : null}
        />
        <StatCard
          label="Costo total (mensajes)"
          value={fmtMoney(stats?.totalCost)}
          sub={`${fmtRate(stats?.costPerMessage ?? 0.01)} por mensaje`}
        />
        <StatCard label="Contactos únicos" value={fmtInt(stats?.uniqueContacts)} />
      </div>

      <Filters
        search={search}
        setSearch={setSearch}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
        onChange={() => setPage(1)}
        searchPlaceholder="Nombre, contactId, contenido…"
      />

      <DailyChart byDay={stats?.byDay || []} />

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
                  <Badge value={r.status} />
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

      <Pagination total={total} page={page} pages={pages} onChange={setPage} labelWord="mensajes" />
    </>
  );
}

// -----------------------------------------------------------------------
// Calls tab
// -----------------------------------------------------------------------
function CallsView({ refreshTick, onRefreshStart, onRefreshEnd, onError }) {
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);

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

  const hasLoadedOnce = stats !== null;
  useEffect(() => {
    let cancelled = false;
    if (hasLoadedOnce) onRefreshStart();
    else setLoading(true);

    Promise.all([callsAPI.list(params), callsAPI.stats(statsParams)])
      .then(([listRes, statsRes]) => {
        if (cancelled) return;
        setRows(listRes.data.rows);
        setTotal(listRes.data.total);
        setStats(statsRes.data);
        onError('');
      })
      .catch((e) => {
        if (cancelled) return;
        onError(e.response?.data?.error || 'Error al cargar llamadas');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onRefreshEnd();
      });
    return () => {
      cancelled = true;
    };
  }, [params, statsParams, refreshTick]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const totalMinutes = (stats?.totalDurationSeconds || 0) / 60;

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Llamadas totales" value={fmtInt(stats?.totalCalls)} />
        <StatCard
          label="Minutos hablados"
          value={fmtDuration(stats?.totalDurationSeconds)}
          sub={`${totalMinutes.toFixed(2)} min`}
        />
        <StatCard
          label="Costo total (llamadas)"
          value={fmtMoney(stats?.totalCost)}
          sub={`${fmtRate(stats?.ratePerMinute ?? 0.1)} por minuto`}
        />
        <StatCard label="Contactos únicos" value={fmtInt(stats?.uniqueContacts)} />
      </div>

      {stats?.byOutcome && Object.keys(stats.byOutcome).length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">Outcomes</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.byOutcome).map(([k, v]) => (
              <span
                key={k}
                className="text-xs bg-gray-800 border border-gray-700 rounded-full px-3 py-1"
              >
                <span className="text-gray-200">{k}</span>
                <span className="text-gray-500 ml-2">{fmtInt(v)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <Filters
        search={search}
        setSearch={setSearch}
        from={from}
        setFrom={setFrom}
        to={to}
        setTo={setTo}
        onChange={() => setPage(1)}
        searchPlaceholder="Nombre, número, agente, resumen…"
      />

      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-950 text-gray-400 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2">Fecha</th>
              <th className="text-left px-4 py-2">Contacto</th>
              <th className="text-left px-4 py-2">Agente</th>
              <th className="text-left px-4 py-2">Número</th>
              <th className="text-right px-4 py-2">Duración</th>
              <th className="text-right px-4 py-2">Costo</th>
              <th className="text-left px-4 py-2">Outcome</th>
              <th className="text-left px-4 py-2">Audio</th>
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
                <td className="px-4 py-2">
                  <div className="text-gray-200 text-xs">{r.agentName || '—'}</div>
                  <div className="text-[10px] text-gray-500">{r.agentId || ''}</div>
                </td>
                <td className="px-4 py-2 text-xs text-gray-300">{r.customerNumber || '—'}</td>
                <td className="px-4 py-2 text-right">{fmtDuration(r.durationSeconds)}</td>
                <td className="px-4 py-2 text-right">{fmtMoney(r.costCharged)}</td>
                <td className="px-4 py-2">
                  <Badge value={r.outcome} />
                </td>
                <td className="px-4 py-2">
                  {r.recordingUrl ? (
                    <a
                      href={r.recordingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary-500 hover:text-primary-400 underline"
                    >
                      escuchar
                    </a>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                  Sin llamadas para este filtro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={page} pages={pages} onChange={setPage} labelWord="llamadas" />
    </>
  );
}

// -----------------------------------------------------------------------
// Shared little components
// -----------------------------------------------------------------------
function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 -mb-px ${
        active
          ? 'border-primary-500 text-white'
          : 'border-transparent text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

function Filters({ search, setSearch, from, setFrom, to, setTo, onChange, searchPlaceholder }) {
  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Búsqueda</label>
        <input
          type="text"
          value={search}
          onChange={(e) => {
            onChange?.();
            setSearch(e.target.value);
          }}
          placeholder={searchPlaceholder}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm w-72"
        />
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">Desde</label>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            onChange?.();
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
            onChange?.();
            setTo(e.target.value);
          }}
          className="bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}

function Pagination({ total, page, pages, onChange, labelWord }) {
  return (
    <div className="flex items-center justify-between text-sm text-gray-400">
      <span>
        {fmtInt(total)} {labelWord} · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className="border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          Anterior
        </button>
        <button
          onClick={() => onChange(Math.min(pages, page + 1))}
          disabled={page >= pages}
          className="border border-gray-800 hover:border-gray-700 rounded-lg px-3 py-1.5 disabled:opacity-40"
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

function LiveIndicator({ refreshing, lastUpdatedAt }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsAgo = lastUpdatedAt
    ? Math.max(0, Math.floor((Date.now() - lastUpdatedAt) / 1000))
    : null;

  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      <span
        className={`w-2 h-2 rounded-full ${
          refreshing ? 'bg-amber-400 animate-pulse' : 'bg-green-500'
        }`}
        title={refreshing ? 'Actualizando…' : 'En vivo'}
      />
      {refreshing ? (
        <span>Actualizando…</span>
      ) : secondsAgo != null ? (
        <span>Hace {secondsAgo}s</span>
      ) : (
        <span>En vivo</span>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, accent, small }) {
  const accentColor =
    accent === 'positive' ? 'text-green-400' :
    accent === 'warning' ? 'text-amber-400' :
    'text-white';
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-2xl'} font-semibold mt-1 ${accentColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function Badge({ value }) {
  const map = {
    success: 'bg-green-900/40 text-green-300 border-green-800',
    answered: 'bg-green-900/40 text-green-300 border-green-800',
    error: 'bg-red-900/40 text-red-300 border-red-800',
    failed: 'bg-red-900/40 text-red-300 border-red-800',
    blocked: 'bg-amber-900/40 text-amber-300 border-amber-800',
    no_answer: 'bg-amber-900/40 text-amber-300 border-amber-800',
    voicemail: 'bg-amber-900/40 text-amber-300 border-amber-800',
    unknown: 'bg-gray-800 text-gray-300 border-gray-700'
  };
  const cls = map[value] || 'bg-gray-800 text-gray-300 border-gray-700';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>{value}</span>
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
