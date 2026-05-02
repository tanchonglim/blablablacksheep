import { useState, useEffect, useCallback, useRef } from 'react';
import { showToast } from '../toast-bus';

const STATUS_FILTER_OPTIONS = [
    { value: '', label: 'All statuses' },
    { value: '200', label: '200' },
    { value: '400', label: '400' },
    { value: '401', label: '401' },
    { value: '500', label: '500' },
];

function getStatusBlock(code) {
    const c = Number(code);
    if (c >= 200 && c < 300) return <span className="px-1.5 py-0.5 bg-[#42be65]/20 text-[#42be65] text-[10px] font-bold rounded-sm border border-[#42be65]/30">{c} OK</span>;
    if (c >= 400 && c < 500) return <span className="px-1.5 py-0.5 bg-[#f1c21b]/20 text-[#f1c21b] text-[10px] font-bold rounded-sm border border-[#f1c21b]/30">{c} ERR</span>;
    if (c >= 500) return <span className="px-1.5 py-0.5 bg-[#da1e28]/20 text-[#da1e28] text-[10px] font-bold rounded-sm border border-[#da1e28]/30">{c} FAIL</span>;
    return <span className="px-1.5 py-0.5 bg-secondary/20 text-secondary text-[10px] font-bold rounded-sm border border-secondary/30">{c}</span>;
}

function formatJson(str) {
    try { return JSON.stringify(JSON.parse(str), null, 2); }
    catch { return str; }
}

/** Tab state resets when `row.id` changes via parent `key`. */
function LogInspectorPanel({ row, onClose }) {
    const [tab, setTab] = useState('request');
    return (
        <section className="w-[450px] lg:w-[600px] flex flex-col bg-surface border-l border-outline-variant relative shrink-0 min-h-0">
            <div className="p-4 border-b border-outline-variant bg-surface-container-high/50 shrink-0">
                <div className="flex justify-between items-start mb-2">
                    <h2 className="text-sm font-semibold text-on-surface">Log Inspector</h2>
                    <button type="button" onClick={onClose} className="text-secondary hover:text-on-surface p-1 rounded-full hover:bg-outline-variant transition-colors">
                        <span className="material-symbols-outlined text-base">close</span>
                    </button>
                </div>
                <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 bg-primary/10 border border-primary/20 rounded-sm text-primary text-[10px] font-bold tracking-wider shrink-0">{row.method}</span>
                    <span className="font-mono text-xs font-medium truncate" title={row.path}>{row.path}</span>
                </div>
            </div>
            <div className="flex border-b border-outline-variant bg-surface-container shrink-0">
                <button
                    type="button"
                    onClick={() => setTab('request')}
                    className={`px-4 h-10 text-xs font-medium border-b-2 transition-colors ${tab === 'request' ? 'border-primary bg-surface text-primary' : 'border-transparent text-secondary hover:bg-surface-container-high'}`}
                >
                    Request
                </button>
                <button
                    type="button"
                    onClick={() => setTab('response')}
                    className={`px-4 h-10 text-xs font-medium border-b-2 transition-colors ${tab === 'response' ? 'border-primary bg-surface text-primary' : 'border-transparent text-secondary hover:bg-surface-container-high'}`}
                >
                    Response
                </button>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar flex flex-col min-h-0">
                {tab === 'request' && (
                    <div className="p-4 border-b border-outline-variant bg-surface-container-lowest flex-1">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="material-symbols-outlined text-secondary text-sm">login</span>
                            <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface">Request Headers</h3>
                        </div>
                        <div className="bg-surface border border-outline-variant p-3 rounded-sm space-y-1.5 font-mono text-[11px] mb-4 overflow-hidden">
                            {Object.entries(JSON.parse(row.request_headers || '{}')).map(([k, v]) => (
                                <div key={k} className="flex gap-4">
                                    <span className="text-secondary w-32 shrink-0">{k}:</span>
                                    <span className="text-on-surface truncate" title={v}>{v}</span>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-secondary text-sm">data_object</span>
                                <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface">Request Body</h3>
                            </div>
                        </div>
                        <div className="bg-surface-container border border-outline-variant rounded-sm p-4 font-mono text-[11px] leading-relaxed">
                            <pre className="text-on-surface overflow-x-auto whitespace-pre-wrap">{formatJson(row.request_body || 'null')}</pre>
                        </div>
                    </div>
                )}
                {tab === 'response' && (
                    <div className="p-4 bg-surface-container-lowest flex-1">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="material-symbols-outlined text-secondary text-sm">logout</span>
                            <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface">Response Details</h3>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                            <div className="p-3 border border-outline-variant rounded-sm bg-surface">
                                <p className="text-[10px] text-secondary uppercase font-bold tracking-wider mb-1">Status</p>
                                <p className="text-xs font-semibold">{getStatusBlock(row.response_status)}</p>
                            </div>
                            <div className="p-3 border border-outline-variant rounded-sm bg-surface">
                                <p className="text-[10px] text-secondary uppercase font-bold tracking-wider mb-1">Latency</p>
                                <p className="text-xs font-semibold flex items-center gap-1">
                                    <span className="material-symbols-outlined text-[14px] text-secondary">speed</span>
                                    {row.latency_ms != null ? `${row.latency_ms} ms` : '—'}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                            <h3 className="text-[11px] font-bold uppercase tracking-wider text-on-surface">Response Body</h3>
                        </div>
                        <div className="bg-surface-container border border-outline-variant rounded-sm p-4 font-mono text-[11px] leading-relaxed">
                            <pre className="text-on-surface overflow-x-auto whitespace-pre-wrap">{formatJson(row.response_body || 'null')}</pre>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}

export default function Requests() {
    const [data, setData] = useState({ rows: [], total: 0, page: 1, limit: 50, endpoints: [] });
    const [loading, setLoading] = useState(false);
    const [activeReq, setActiveReq] = useState(null);
    const [filterEndpoint, setFilterEndpoint] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const activeIdRef = useRef(null);

    useEffect(() => {
        activeIdRef.current = activeReq?.id ?? null;
    }, [activeReq]);

    const loadData = useCallback(() => {
        const params = new URLSearchParams();
        if (filterEndpoint) params.set('endpoint', filterEndpoint);
        if (filterStatus) params.set('status', filterStatus);
        const qs = params.toString();
        return fetch(`/api/admin/requests${qs ? `?${qs}` : ''}`)
            .then(r => r.json())
            .then((res) => {
                setData(res);
                setActiveReq((prev) => {
                    const id = activeIdRef.current;
                    if (id != null) {
                        const found = res.rows.find((x) => x.id === id);
                        if (found) return found;
                        return res.rows.length > 0 ? res.rows[0] : null;
                    }
                    if (prev != null) {
                        const found = res.rows.find((x) => x.id === prev.id);
                        if (found) return found;
                    }
                    return prev;
                });
            });
    }, [filterEndpoint, filterStatus]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    useEffect(() => {
        const t = setInterval(() => { loadData(); }, 3000);
        return () => clearInterval(t);
    }, [loadData]);

    const clearLogs = async () => {
        try {
            setLoading(true);
            await fetch('/api/admin/requests/clear', { method: 'POST' });
            await loadData();
            setActiveReq(null);
            showToast('API logs history has been cleared.', 'success');
        } catch { showToast('Failed to clear logs.', 'error'); }
        finally { setLoading(false); }
    };

    const endpointOptions = data.endpoints || [];

    return (
        <div className="flex-1 flex overflow-hidden w-full min-h-0">
            <section className="flex-1 flex flex-col bg-surface-container-lowest overflow-hidden min-w-0">
                <div className="h-14 shrink-0 border-b border-outline-variant px-6 flex items-center justify-between">
                    <h1 className="text-lg font-semibold text-on-surface">API Request Logs</h1>
                    <button
                        onClick={clearLogs}
                        disabled={loading}
                        className="px-4 h-8 border border-outline text-error hover:bg-error/10 text-sm font-medium transition-colors rounded flex justify-center items-center gap-2 disabled:opacity-50"
                    >
                        {loading && <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>}
                        Clear Logs
                    </button>
                </div>
                <div className="h-10 shrink-0 border-b border-outline-variant bg-surface-container flex items-center px-4 justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-4 min-w-0">
                        <span className="text-xs font-semibold text-on-surface uppercase tracking-wider shrink-0">Live Traffic</span>
                        <div className="flex items-center gap-2 shrink-0">
                            <span className="w-2 h-2 rounded-full bg-tertiary" />
                            <span className="text-[10px] text-secondary">Connected</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                        <span className="material-symbols-outlined text-sm text-secondary">filter_list</span>
                        <select
                            value={filterEndpoint}
                            onChange={(e) => setFilterEndpoint(e.target.value)}
                            className="h-8 text-xs border-b border-outline bg-surface-container px-2 min-w-[140px] max-w-[220px] outline-none focus:border-primary"
                        >
                            <option value="">All endpoints</option>
                            {endpointOptions.map((ep) => (
                                <option key={ep} value={ep}>{ep}</option>
                            ))}
                        </select>
                        <select
                            value={filterStatus}
                            onChange={(e) => setFilterStatus(e.target.value)}
                            className="h-8 text-xs border-b border-outline bg-surface-container px-2 outline-none focus:border-primary"
                        >
                            {STATUS_FILTER_OPTIONS.map((o) => (
                                <option key={o.value || 'all'} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className="flex-1 overflow-auto custom-scrollbar relative min-h-0">
                    <table className="w-full text-left border-collapse text-sm">
                        <thead className="sticky top-0 bg-surface-container-low border-b border-outline-variant shadow-sm z-10">
                            <tr>
                                <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-secondary z-20">Status</th>
                                <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-secondary z-20">Method</th>
                                <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-secondary z-20">Path</th>
                                <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-secondary z-20">Latency</th>
                                <th className="px-4 py-3 font-semibold text-xs uppercase tracking-wider text-secondary text-right z-20">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-outline-variant/30">
                            {data.rows.map((row) => (
                                <tr
                                    key={row.id}
                                    onClick={() => setActiveReq(row)}
                                    className={`cursor-pointer transition-colors ${activeReq?.id === row.id ? 'bg-primary/5' : 'hover:bg-surface-container-low bg-surface'}`}
                                >
                                    <td className="px-4 py-3">{getStatusBlock(row.response_status)}</td>
                                    <td className="px-4 py-3 font-mono font-semibold text-secondary">{row.method}</td>
                                    <td className="px-4 py-3 truncate max-w-[200px] font-mono" title={row.path}>{row.path}</td>
                                    <td className="px-4 py-3 text-secondary">{row.latency_ms != null ? `${row.latency_ms}ms` : '—'}</td>
                                    <td className="px-4 py-3 text-right text-secondary">{new Date(row.created_at).toLocaleTimeString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {activeReq && (
                <LogInspectorPanel key={activeReq.id} row={activeReq} onClose={() => setActiveReq(null)} />
            )}
        </div>
    );
}
