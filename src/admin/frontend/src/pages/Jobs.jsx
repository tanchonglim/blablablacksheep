import { useState, useEffect, useCallback } from 'react';
import { showToast } from '../toast-bus';

function formatBytes(bytes) {
    if (bytes == null || Number.isNaN(bytes)) return '—';
    const n = Number(bytes);
    if (n === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(n) / Math.log(k)));
    return `${parseFloat((n / k ** i).toFixed(i === 0 ? 0 : 1))} ${sizes[i]}`;
}

function formatRunLogs(logs) {
    if (logs == null || logs === '') return null;
    if (typeof logs === 'string') {
        try {
            const p = JSON.parse(logs);
            if (Array.isArray(p)) return p.join('\n');
        } catch {
            return logs;
        }
        return logs;
    }
    return String(logs);
}

export default function Jobs() {
    const [data, setData] = useState({ scripts: [], runs: [] });
    const [files, setFiles] = useState([]);
    const [runningJob, setRunningJob] = useState(null);
    const [activeScript, setActiveScript] = useState(null);

    const loadData = useCallback(() => {
        return fetch('/api/admin/jobs')
            .then((r) => r.json())
            .then((res) => {
                setData(res);
                setActiveScript((prev) => {
                    if (prev) {
                        const still = res.scripts.find((s) => s.file === prev.file);
                        if (still) return still;
                    }
                    return res.scripts.length > 0 ? res.scripts[0] : null;
                });
            });
    }, []);

    const loadFiles = useCallback(() => {
        return fetch('/api/admin/files')
            .then((r) => r.json())
            .then((res) => setFiles(res.files || []));
    }, []);

    useEffect(() => {
        loadData();
        loadFiles();
    }, [loadData, loadFiles]);

    const triggerJob = async (file) => {
        try {
            setRunningJob(file);
            await fetch('/api/admin/jobs/trigger', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file }),
            });
            await loadData();
            await loadFiles();
            showToast(`Job ${file} manually triggered.`, 'success');
        } catch {
            showToast(`Failed to trigger job ${file}.`, 'error');
        } finally {
            setRunningJob(null);
        }
    };

    const clearLogs = async () => {
        try {
            await fetch('/api/admin/jobs/clear', { method: 'POST' });
            await loadData();
            showToast('Cleared all job logs.', 'success');
        } catch {
            showToast('Failed to clear job logs.', 'error');
        }
    };

    const scriptBase = activeScript?.file?.replace(/\.js$/i, '') ?? '';
    const scriptRuns = data.runs.filter((r) => r.script_name === scriptBase);

    return (
        <div className="flex-1 flex overflow-hidden w-full min-h-0">
            <section className="w-[350px] lg:w-[450px] border-r border-outline-variant bg-surface flex flex-col shrink-0 relative z-10 shadow-sm min-h-0">
                <div className="p-4 border-b border-outline-variant flex items-center justify-between shrink-0">
                    <h2 className="text-sm font-semibold text-on-surface">Available Cron Jobs</h2>
                    <div className="flex items-center gap-4">
                        <span className="text-[10px] text-secondary font-medium tracking-lighter">{data.scripts.length} registered</span>
                        <button type="button" onClick={clearLogs} className="text-[10px] text-error hover:bg-error/10 border border-error px-2 py-0.5 rounded uppercase tracking-wider font-bold transition-colors">Clear Logs</button>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-container-low p-4 space-y-3 min-h-0">
                    {data.scripts.map((s) => {
                        const isActive = activeScript?.file === s.file;
                        return (
                            <div key={s.file} role="button" tabIndex={0} onClick={() => setActiveScript(s)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveScript(s); } }} className={`p-4 rounded border group cursor-pointer transition-colors ${isActive ? 'bg-primary/5 border-primary shadow-sm' : 'bg-surface border-outline-variant hover:border-outline'}`}>
                                <div className="flex justify-between items-start mb-3">
                                    <div className="flex items-center space-x-2">
                                        <span className={`material-symbols-outlined text-[18px] ${isActive ? 'text-primary' : 'text-secondary'}`}>task</span>
                                        <h3 className={`text-xs font-bold leading-none ${isActive ? 'text-primary' : 'text-on-surface'}`}>{s.name || s.file}</h3>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); triggerJob(s.file); }}
                                        disabled={runningJob === s.file}
                                        className={`p-1 flex items-center justify-center rounded transition-colors disabled:opacity-50 ${isActive ? 'text-primary hover:bg-primary/10' : 'text-secondary hover:text-primary hover:bg-surface-container-high'}`}
                                    >
                                        {runningJob === s.file ? <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span> : <span className="material-symbols-outlined text-[18px]">play_arrow</span>}
                                    </button>
                                </div>
                                <div className="flex items-center text-[11px] text-secondary space-x-4">
                                    <span className="flex items-center"><span className="material-symbols-outlined text-[14px] mr-1">schedule</span> {s.cron || 'Manual'}</span>
                                    <span className="flex items-center"><span className="material-symbols-outlined text-[14px] mr-1">code</span> {s.type || 'js'}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className="flex-1 flex flex-col bg-surface-container-lowest min-h-0 min-w-0">
                <div className="flex-1 flex flex-col min-h-0 border-b border-outline-variant overflow-hidden">
                    <div className="p-4 flex items-center justify-between bg-surface border-b border-outline-variant shrink-0">
                        <h3 className="text-sm font-semibold flex items-center text-on-surface">
                            <span className="material-symbols-outlined text-[18px] mr-2 text-primary">folder_open</span>
                            Generated Files
                        </h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar bg-surface-container-low p-4 space-y-2 min-h-0">
                        {files.length === 0 && (
                            <div className="text-secondary text-xs italic">No files in output directory yet. Run a job to generate files.</div>
                        )}
                        {files.map((f) => (
                            <div key={f.name} className="bg-surface p-4 border border-outline-variant flex justify-between items-center hover:shadow-sm transition-shadow gap-3">
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-xs font-bold text-on-surface truncate" title={f.name}>{f.name}</h4>
                                    <p className="text-[10px] text-outline mt-0.5 font-mono">
                                        {formatBytes(f.size)}
                                        {f.mtime ? ` • ${new Date(f.mtime).toLocaleString()}` : ''}
                                    </p>
                                </div>
                                <a
                                    href={`/api/admin/files/download/${encodeURIComponent(f.name)}`}
                                    download={f.name}
                                    className="p-1.5 hover:bg-surface-container-high transition-colors shrink-0 text-primary"
                                    title="Download"
                                >
                                    <span className="material-symbols-outlined text-[18px]">download</span>
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <div className="p-4 flex items-center justify-between bg-surface border-b border-outline-variant shrink-0">
                        <h3 className="text-sm font-semibold flex items-center text-on-surface">
                            <span className="material-symbols-outlined text-[18px] mr-2 text-secondary">terminal</span>
                            Job Execution History ({activeScript?.name || 'Selected Job'})
                        </h3>
                    </div>
                    <div className="flex-1 bg-[#1e1e1e] p-4 font-mono text-[11px] text-[#e0e0e0] overflow-y-auto custom-scrollbar leading-relaxed min-h-0">
                        {scriptRuns.length === 0 && <div className="text-white/40 italic">No execution logs found for this job. Trigger it to see responses.</div>}
                        {scriptRuns.map((r) => {
                            const text = formatRunLogs(r.logs) || (r.error ? r.error : 'No output returned');
                            return (
                                <div key={r.id} className="mb-6 border-b border-white/10 pb-4 last:mb-0">
                                    <div className="flex mb-2 flex-wrap gap-2">
                                        <span className="text-white/40 w-40 flex-shrink-0">{r.started_at ? new Date(r.started_at).toLocaleString() : '—'}</span>
                                        <span className={`w-24 flex-shrink-0 font-bold ${r.status === 'success' ? 'text-[#42be65]' : 'text-[#da1e28]'}`}>[{String(r.status || '').toUpperCase()}]</span>
                                    </div>
                                    <div className="whitespace-pre-wrap sm:ml-0 md:ml-8 lg:ml-16 text-white/90 bg-black/20 p-2 rounded border border-white/5">
                                        {text}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>
        </div>
    );
}
