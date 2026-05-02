import { useState, useEffect, useMemo } from 'react';
import { showToast } from '../toast-bus';

export default function Endpoints() {
    const [data, setData] = useState({ groups: [], overrides: {} });
    const [activeEndpoint, setActiveEndpoint] = useState(null);

    const [activeStatusStr, setActiveStatusStr] = useState(null);
    const [editedBodyStr, setEditedBodyStr] = useState('');
    const [isError, setIsError] = useState(false);

    const [collapsedTags, setCollapsedTags] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [isSettingActive, setIsSettingActive] = useState(null);
    const [isSelectingExample, setIsSelectingExample] = useState(null);
    const [isResetting, setIsResetting] = useState(false);
    const [delayEnabled, setDelayEnabled] = useState(true);
    const [delayMs, setDelayMs] = useState(0);
    const [isSavingDelay, setIsSavingDelay] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');

    const toggleTag = (file, tag) => {
        const key = `${file}|${tag}`;
        setCollapsedTags((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const selectEndpointData = (ep, resetStatus, overridesArg) => {
        setActiveEndpoint(ep);
        const scenarios = ep.cfg?.scenarios || [];
        if (scenarios.length > 0) {
            if (resetStatus || !activeStatusStr) {
                const initial = scenarios[0];
                setActiveStatusStr(initial.statusStr);
                setEditedBodyStr(JSON.stringify(initial.body, null, 2));
            } else {
                const currentScen = scenarios.find((s) => s.statusStr === activeStatusStr) || scenarios[0];
                setActiveStatusStr(currentScen.statusStr);
                setEditedBodyStr(JSON.stringify(currentScen.body, null, 2));
            }
        } else {
            setActiveStatusStr(null);
            setEditedBodyStr('{}');
        }
        setIsError(false);
        const ovMap = overridesArg ?? data.overrides;
        const ov = ovMap[ep.cfg.key];
        setDelayEnabled(ov?.delay_enabled !== false);
        const d = ep.cfg.delay || { min_ms: 0, max_ms: 0 };
        const lo = Number(d.min_ms) || 0;
        const hi = Number(d.max_ms) || 0;
        setDelayMs(lo === hi ? lo : Math.round((lo + hi) / 2));
    };

    const selectEndpoint = (ep) => {
        selectEndpointData(ep, true);
    };

    const loadData = () => {
        fetch('/api/admin/endpoints')
            .then((r) => r.json())
            .then((res) => {
                setData(res);
                if (!activeEndpoint && res.groups.length > 0 && res.groups[0].tagGroups.length > 0) {
                    selectEndpointData(res.groups[0].tagGroups[0].endpoints[0], true, res.overrides);
                } else if (activeEndpoint) {
                    let found = null;
                    for (const g of res.groups) {
                        for (const t of g.tagGroups) {
                            for (const ep of t.endpoints) {
                                if (ep.globalIdx === activeEndpoint.globalIdx) {
                                    found = ep;
                                    break;
                                }
                            }
                        }
                    }
                    if (found) selectEndpointData(found, false, res.overrides);
                }
            });
    };

    useEffect(() => {
        loadData();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only fetch; loadData intentionally stale

    const sortedScenarios = useMemo(() => {
        const scenarios = activeEndpoint?.cfg?.scenarios || [];
        return [...scenarios].sort((a, b) => Number(a.statusStr) - Number(b.statusStr));
    }, [activeEndpoint]);

    const activeScenario = activeEndpoint?.cfg?.scenarios?.find((s) => s.statusStr === activeStatusStr);
    const currentActiveMockStr =
        activeEndpoint?.cfg?.mode === 'pinned'
            ? activeEndpoint.cfg.pinnedStatus
            : activeEndpoint?.cfg?.scenarios?.[0]?.statusStr;

    const originalJsonStr = activeScenario ? JSON.stringify(activeScenario.body, null, 2) : '';
    const isDirty = activeScenario && editedBodyStr !== originalJsonStr;

    const handleStatusChange = (statusStr) => {
        const scen = activeEndpoint?.cfg?.scenarios?.find((s) => s.statusStr === statusStr);
        setActiveStatusStr(statusStr);
        setEditedBodyStr(JSON.stringify(scen.body, null, 2));
        setIsError(false);
    };

    const setAsActive = async (statusStr) => {
        try {
            setIsSettingActive(statusStr);
            await fetch('/api/admin/endpoints/mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: activeEndpoint.cfg.key,
                    mode: 'pinned',
                    pinned_status: statusStr,
                }),
            });
            showToast(`Set response ${statusStr} as the active mock pattern.`, 'success');
            loadData();
        } catch {
            showToast('Failed to set active response', 'error');
        } finally {
            setIsSettingActive(null);
        }
    };

    const selectExample = async (exampleName) => {
        if (!activeEndpoint || !activeStatusStr || !activeScenario) return;
        if (exampleName === activeScenario.selectedExample) return;
        try {
            setIsSelectingExample(exampleName);
            await fetch('/api/admin/endpoints/example', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: activeEndpoint.cfg.key,
                    status: activeStatusStr,
                    example_name: exampleName,
                }),
            });
            showToast(`Response example set to "${exampleName}".`, 'success');
            loadData();
        } catch {
            showToast('Failed to select example.', 'error');
        } finally {
            setIsSelectingExample(null);
        }
    };

    const handleBodyChange = (e) => {
        setEditedBodyStr(e.target.value);
        try {
            JSON.parse(e.target.value);
            setIsError(false);
        } catch {
            setIsError(true);
        }
    };

    const handleDiscard = () => {
        if (activeScenario) {
            setEditedBodyStr(JSON.stringify(activeScenario.body, null, 2));
            setIsError(false);
        }
    };

    const handleFormat = () => {
        try {
            const parsed = JSON.parse(editedBodyStr);
            setEditedBodyStr(JSON.stringify(parsed, null, 2));
            setIsError(false);
        } catch {
            showToast('Cannot format invalid JSON.', 'error');
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(editedBodyStr);
        showToast('Copied payload to clipboard!', 'success');
    };

    const copyUrl = () => {
        const fullUrl = `http://localhost:${window.location.port}${activeEndpoint.urlPath}`;
        navigator.clipboard.writeText(fullUrl);
        showToast('Copied full URL to clipboard!', 'success');
    };

    const saveChanges = async () => {
        if (isError) return showToast('Invalid JSON payload! Please fix before saving.', 'error');
        if (!activeEndpoint || !activeStatusStr) return;
        try {
            setIsSaving(true);
            await fetch('/api/admin/endpoints/body', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: activeEndpoint.cfg.key,
                    status: activeStatusStr,
                    body: editedBodyStr,
                }),
            });
            loadData();
            showToast('Changes saved successfully!', 'success');
        } catch {
            showToast('An error occurred during save.', 'error');
        } finally {
            setIsSaving(false);
        }
    };

    const resetToDefault = async () => {
        if (!activeEndpoint || !activeStatusStr) return;
        try {
            setIsResetting(true);
            await fetch('/api/admin/endpoints/body/reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: activeEndpoint.cfg.key,
                    status: activeStatusStr,
                }),
            });
            loadData();
            showToast('Payload reverted to default spec successfully.', 'success');
        } catch {
            showToast('Failed to reset payload.', 'error');
        } finally {
            setIsResetting(false);
        }
    };

    const saveDelay = async () => {
        if (!activeEndpoint?.cfg?.key) return;
        const ms = Math.max(0, Number(delayMs) || 0);
        try {
            setIsSavingDelay(true);
            await fetch('/api/admin/endpoints/delay', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: activeEndpoint.cfg.key,
                    delay_enabled: delayEnabled,
                    delay_ms: ms,
                }),
            });
            showToast('Delay settings saved.', 'success');
            loadData();
        } catch {
            showToast('Failed to save delay settings.', 'error');
        } finally {
            setIsSavingDelay(false);
        }
    };

    const filteredGroups = useMemo(() => {
        if (!searchQuery) return data.groups;
        const q = searchQuery.toLowerCase();
        return data.groups
            .map((g) => {
                const newTags = g.tagGroups
                    .map((t) => {
                        const newEps = t.endpoints.filter(
                            (ep) =>
                                ep.urlPath.toLowerCase().includes(q) ||
                                (ep.operation.summary && ep.operation.summary.toLowerCase().includes(q)),
                        );
                        return { ...t, endpoints: newEps };
                    })
                    .filter((t) => t.endpoints.length > 0);
                return { ...g, tagGroups: newTags };
            })
            .filter((g) => g.tagGroups.length > 0);
    }, [data.groups, searchQuery]);

    const tabToneClass = (statusStr, selected) => {
        const c = Number(statusStr);
        if (!selected) return 'border-transparent text-secondary hover:bg-surface-container-high hover:text-on-surface';
        if (c >= 500) return 'border-error text-error bg-surface font-semibold';
        if (c >= 400 && c < 500) return 'border-[#f1c21b] text-on-surface bg-surface font-semibold';
        if (c >= 200 && c < 300) return 'border-tertiary text-tertiary bg-surface font-semibold';
        return 'border-primary text-primary bg-surface font-semibold';
    };

    return (
        <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
            <aside className="flex min-h-0 w-80 shrink-0 flex-col overflow-hidden border-r border-outline-variant bg-surface">
                <div className="border-b border-outline-variant p-4">
                    <div className="relative">
                        <input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-10 w-full border-b border-outline bg-surface-container pl-10 pr-4 text-sm outline-none transition-all focus:border-primary focus:ring-0"
                            placeholder="Search endpoints..."
                            type="text"
                        />
                        <span className="material-symbols-outlined absolute left-3 top-2.5 text-[20px] text-secondary">search</span>
                    </div>
                </div>
                <div className="custom-scrollbar min-h-0 flex-1 basis-0 overflow-y-auto overscroll-y-contain">
                    {filteredGroups.length === 0 && (
                        <div className="p-6 text-center text-sm text-secondary">No endpoints matched your search.</div>
                    )}
                    {filteredGroups.map((fileGroup) => (
                        <div key={fileGroup.file}>
                            <div className="border-y border-outline-variant bg-surface-container px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-secondary">
                                {fileGroup.file}
                            </div>
                            {fileGroup.tagGroups.map((tag) => {
                                const cKey = `${fileGroup.file}|${tag.tag}`;
                                const isCollapsed = collapsedTags[cKey];
                                return (
                                    <section key={tag.tag}>
                                        <button
                                            type="button"
                                            onClick={() => toggleTag(fileGroup.file, tag.tag)}
                                            className="group flex w-full cursor-pointer select-none items-center justify-between bg-surface-container-low px-4 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[16px] text-secondary transition-transform">
                                                    {isCollapsed ? 'keyboard_arrow_right' : 'keyboard_arrow_down'}
                                                </span>
                                                <span className="text-xs font-semibold uppercase tracking-wider text-secondary">{tag.tag}</span>
                                            </div>
                                            <span className="rounded bg-secondary/10 px-1.5 py-0.5 text-[10px] text-secondary-fixed-dim">
                                                {tag.endpoints.length}
                                            </span>
                                        </button>
                                        {!isCollapsed && (
                                            <div className="divide-y divide-outline-variant/50">
                                                {tag.endpoints.map((ep) => {
                                                    const isActive = activeEndpoint?.globalIdx === ep.globalIdx;
                                                    return (
                                                        <button
                                                            key={ep.globalIdx}
                                                            type="button"
                                                            onClick={() => selectEndpoint(ep)}
                                                            className={`w-full border-l-4 px-8 py-3 text-left transition-colors ${
                                                                isActive
                                                                    ? 'border-primary bg-primary/5'
                                                                    : 'border-transparent hover:bg-surface-container-low'
                                                            }`}
                                                        >
                                                            <div
                                                                className={`truncate text-sm font-medium ${isActive ? 'text-primary' : 'text-on-surface'}`}
                                                            >
                                                                {ep.operation.summary || ep.urlPath}
                                                            </div>
                                                            <div className="mt-1 line-clamp-1 truncate font-mono text-[11px] text-secondary">
                                                                {ep.method} {ep.urlPath}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </section>
                                );
                            })}
                        </div>
                    ))}
                </div>
            </aside>

            <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-container-lowest">
                {activeEndpoint ? (
                    <>
                        <div className="flex h-14 shrink-0 items-center justify-between border-b border-outline-variant px-6">
                            <div className="flex items-center gap-4">
                                <span className="rounded-sm bg-tertiary-container px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-on-tertiary-container">
                                    Active
                                </span>
                                <h1 className="max-w-[400px] truncate text-lg font-semibold text-on-surface">
                                    {activeEndpoint.operation.summary || 'Endpoint'}
                                </h1>
                                <div className="group flex items-center gap-1">
                                    <span className="rounded bg-surface-container px-2 py-0.5 font-mono text-sm text-secondary">
                                        {activeEndpoint.method} {activeEndpoint.urlPath}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={copyUrl}
                                        className="rounded p-1 text-secondary outline-none transition-colors hover:bg-surface-container-high hover:text-primary"
                                        title="Copy full URL"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    type="button"
                                    onClick={handleDiscard}
                                    disabled={!isDirty}
                                    className="flex h-9 items-center gap-2 rounded border border-outline px-4 text-sm font-medium text-error transition-colors hover:bg-surface-container disabled:opacity-50"
                                >
                                    Discard
                                </button>
                                <button
                                    type="button"
                                    onClick={saveChanges}
                                    disabled={!isDirty || isSaving || isError}
                                    className="flex h-9 items-center gap-2 rounded bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-fixed-dim disabled:opacity-50"
                                >
                                    {isSaving ? (
                                        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                                    ) : (
                                        <span className="material-symbols-outlined text-[16px]">save</span>
                                    )}
                                    Save
                                </button>
                            </div>
                        </div>

                        <div className="custom-scrollbar min-h-0 flex-1 basis-0 overflow-y-auto overflow-x-hidden overscroll-y-contain bg-surface-container-lowest p-6">
                            <div className="flex w-full flex-col gap-8">
                                <div>
                                    <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                                        <label className="text-xs font-semibold uppercase tracking-widest text-secondary">Mock response</label>
                                        {activeStatusStr && currentActiveMockStr !== activeStatusStr ? (
                                            <button
                                                type="button"
                                                onClick={() => setAsActive(activeStatusStr)}
                                                disabled={isSettingActive === activeStatusStr}
                                                className="flex h-8 shrink-0 items-center gap-1.5 rounded border border-outline-variant bg-surface px-3 text-[11px] font-bold uppercase tracking-wider text-secondary transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                                            >
                                                {isSettingActive === activeStatusStr ? (
                                                    <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                                                ) : (
                                                    <span className="material-symbols-outlined text-[16px]">bolt</span>
                                                )}
                                                Set as active response
                                            </button>
                                        ) : activeStatusStr && currentActiveMockStr === activeStatusStr ? (
                                            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[#198038]/25 bg-[#198038]/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#198038]">
                                                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                                                Active mock
                                            </span>
                                        ) : null}
                                    </div>
                                    <p className="mb-2 max-w-3xl text-[11px] text-secondary">
                                        Choose a status tab to edit its payload. When the OpenAPI spec defines multiple named examples for that status,
                                        pick one below.
                                    </p>
                                    <div
                                        className={`overflow-x-auto border border-outline-variant bg-surface-container ${activeScenario?.examples?.length >= 2 || activeScenario?.examples?.length === 1 ? 'rounded-t border-b-0' : 'rounded'}`}
                                    >
                                        <div className="flex min-h-[40px]">
                                            {sortedScenarios.map((sc) => {
                                                const selected = sc.statusStr === activeStatusStr;
                                                const isPinnedLive = currentActiveMockStr === sc.statusStr;
                                                return (
                                                    <button
                                                        key={sc.statusStr}
                                                        type="button"
                                                        role="tab"
                                                        aria-selected={selected}
                                                        onClick={() => handleStatusChange(sc.statusStr)}
                                                        className={`flex min-h-[40px] shrink-0 items-center gap-2 border-b-2 px-4 text-xs font-medium transition-colors ${tabToneClass(sc.statusStr, selected)}`}
                                                        title={sc.description || sc.statusStr}
                                                    >
                                                        <span className="font-mono">{sc.statusStr}</span>
                                                        {sc.description ? (
                                                            <span className="hidden max-w-[140px] truncate text-left font-normal opacity-90 sm:inline">
                                                                {sc.description}
                                                            </span>
                                                        ) : null}
                                                        {isPinnedLive ? (
                                                            <span className="whitespace-nowrap rounded-sm bg-[#42be65]/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#42be65]">
                                                                Live
                                                            </span>
                                                        ) : null}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    {activeScenario?.examples?.length >= 2 ? (
                                        <div className="overflow-x-auto rounded-b border border-t-0 border-outline-variant bg-surface-container-low">
                                            <div className="flex min-h-[38px] items-end gap-0.5 px-1 py-1">
                                                <span className="shrink-0 self-center px-2 py-2 text-[10px] uppercase tracking-wider text-secondary">
                                                    Examples
                                                </span>
                                                {activeScenario.examples.map((ex) => {
                                                    const picked = activeScenario.selectedExample === ex.name;
                                                    const busy = isSelectingExample === ex.name;
                                                    return (
                                                        <button
                                                            key={ex.name}
                                                            type="button"
                                                            role="tab"
                                                            aria-selected={picked}
                                                            disabled={busy}
                                                            onClick={() => selectExample(ex.name)}
                                                            className={`max-w-[200px] shrink-0 truncate border-b-2 px-3 py-2 text-xs font-medium transition-colors ${picked ? 'border-primary bg-surface text-primary' : 'border-transparent text-secondary hover:bg-surface hover:text-on-surface disabled:opacity-50'}`}
                                                            title={ex.summary || ex.name}
                                                        >
                                                            {busy ? (
                                                                <span className="material-symbols-outlined animate-spin align-middle text-[14px]">
                                                                    progress_activity
                                                                </span>
                                                            ) : null}
                                                            <span className="align-middle">{ex.summary || ex.name}</span>
                                                            {activeScenario.hasExampleOverride && picked ? (
                                                                <span className="ml-1 text-[9px] uppercase text-primary">pinned</span>
                                                            ) : null}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : null}
                                    {activeScenario?.examples?.length === 1 ? (
                                        <div className="rounded-b border border-t-0 border-outline-variant bg-surface-container-low px-3 py-2 text-[11px] text-secondary">
                                            Named example:{' '}
                                            <span className="font-medium text-on-surface">
                                                {activeScenario.examples[0].summary || activeScenario.examples[0].name}
                                            </span>
                                        </div>
                                    ) : null}
                                    {!sortedScenarios.length ? (
                                        <div className="rounded border border-outline-variant bg-surface-container p-4 text-sm text-secondary">
                                            No response scenarios defined for this operation.
                                        </div>
                                    ) : null}
                                </div>

                                {activeScenario && (
                                    <div className="flex flex-col gap-0">
                                        <div className="mb-3 flex items-center justify-between border-t border-outline-variant pt-6">
                                            <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-secondary">
                                                Mock Payload (JSON)
                                                {isDirty && (
                                                    <span className="mt-px h-1.5 w-1.5 rounded-full bg-primary outline-none" title="Unsaved changes" />
                                                )}
                                            </label>
                                            <div className="flex gap-4">
                                                <button
                                                    type="button"
                                                    onClick={resetToDefault}
                                                    disabled={isResetting}
                                                    className="flex items-center gap-1 rounded border border-transparent px-3 py-1.5 text-xs font-medium text-error transition-colors hover:border-error/20 hover:bg-surface-container disabled:opacity-50"
                                                >
                                                    {isResetting ? (
                                                        <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
                                                    ) : (
                                                        <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                                                    )}{' '}
                                                    Reset Default
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleFormat}
                                                    className="flex items-center gap-1 rounded border border-transparent px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/20 hover:bg-primary/5"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">auto_fix_high</span> Format
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleCopy}
                                                    className="flex items-center gap-1 rounded border border-transparent px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:border-primary/20 hover:bg-primary/5"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">content_copy</span> Copy
                                                </button>
                                            </div>
                                        </div>

                                        <aside className="mb-3 rounded border border-outline-variant bg-surface-container-low px-3 py-2.5 text-[11px] leading-snug text-secondary">
                                            <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-on-surface">
                                                <span className="material-symbols-outlined text-[14px] text-primary">info</span>
                                                What can change on each request
                                            </div>
                                            <ul className="list-disc space-y-1.5 pl-4 marker:text-secondary">
                                                <li>
                                                    <span className="font-medium text-on-surface">Built-in and request values</span> — Use{' '}
                                                    <span className="font-mono text-[10px] text-on-surface">{'{{uuid}}'}</span>,{' '}
                                                    <span className="font-mono text-[10px] text-on-surface">{'{{timestamp}}'}</span>,{' '}
                                                    <span className="font-mono text-[10px] text-on-surface">{'{{date}}'}</span>, or{' '}
                                                    <span className="font-mono text-[10px] text-on-surface">{'{{random_int}}'}</span> when you want those
                                                    specific kinds of values; mirror the incoming call using body, path, query, or headers (see project
                                                    README for spelling).
                                                </li>
                                                <li>
                                                    <span className="font-medium text-on-surface">Custom random text in a string</span> — Use{' '}
                                                    <span className="font-mono text-[10px] text-on-surface">{'{{regex(\'pattern\')}}'}</span> with{' '}
                                                    <span className="font-medium text-on-surface">single quotes</span> around the regex so this JSON stays
                                                    valid (double quotes around the pattern break JSON and disable Save). That runs before the built-ins
                                                    above.
                                                </li>
                                                <li>
                                                    <span className="font-medium text-on-surface">Named fields / nested paths</span> — Patterns attached to
                                                    specific property names (often in the API spec) run last and replace those fields again even if you set
                                                    them here.
                                                </li>
                                            </ul>
                                        </aside>

                                        <textarea
                                            className={`custom-scrollbar min-h-[280px] max-h-[520px] w-full shrink-0 resize-y rounded border bg-[#161616] p-4 font-mono text-[13px] leading-relaxed text-[#e0e0e0] shadow-inner outline-none transition-all focus:border-primary ${isError ? 'border-error ring-1 ring-error' : 'border-transparent'}`}
                                            value={editedBodyStr}
                                            onChange={handleBodyChange}
                                            spellCheck="false"
                                        />
                                        {isError ? (
                                            <p className="mt-2 text-[11px] leading-snug text-error">
                                                Invalid JSON — Save stays disabled until this parses. For regex placeholders use{' '}
                                                <span className="font-mono text-[10px] text-on-surface">{'{{regex(\'…\')}}'}</span> (single quotes around
                                                the pattern), not{' '}
                                                <span className="font-mono text-[10px] text-on-surface">{'{{regex("…")}}'}</span>, inside JSON string
                                                values.
                                            </p>
                                        ) : null}

                                        <div className="mt-8 space-y-4 border-t border-outline-variant pt-6">
                                            <label className="mb-4 block text-xs font-semibold uppercase tracking-widest text-secondary">
                                                Response Details
                                            </label>
                                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="mb-1.5 block text-[11px] font-medium text-secondary">Status Code</label>
                                                        <div className="flex h-10 items-center border-b border-outline bg-surface-container px-3 text-sm">
                                                            <span className="font-medium text-tertiary">
                                                                {activeStatusStr}
                                                                {Number(activeStatusStr) >= 200 && Number(activeStatusStr) < 300 ? ' OK' : ''}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="mb-1.5 block text-[11px] font-medium text-secondary">Content-Type</label>
                                                        <div className="flex h-10 items-center border-b border-outline bg-surface-container px-3 font-mono text-sm">
                                                            application/json
                                                        </div>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="mb-1.5 block text-[11px] font-medium text-secondary">Response Headers</label>
                                                    <div className="min-h-[92px] space-y-2 border-b border-outline bg-surface-container p-3">
                                                        <div className="flex justify-between font-mono text-xs">
                                                            <span className="text-secondary">Cache-Control:</span>
                                                            <span className="text-on-surface">no-cache, no-store</span>
                                                        </div>
                                                        <div className="flex justify-between font-mono text-xs">
                                                            <span className="text-secondary">X-Content-Type-Options:</span>
                                                            <span className="text-on-surface">nosniff</span>
                                                        </div>
                                                        <div className="flex justify-between font-mono text-xs">
                                                            <span className="text-secondary">Access-Control-Allow-Origin:</span>
                                                            <span className="text-on-surface">*</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="shrink-0 space-y-4 border-t border-outline-variant pt-8">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                        <div>
                                            <label className="mb-1 block text-xs font-semibold uppercase tracking-widest text-secondary">
                                                Request delay
                                            </label>
                                            <p className="max-w-xl text-[11px] text-secondary">
                                                Fixed pause before the mock responds (milliseconds). Disable to turn off delay overrides for this endpoint.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={saveDelay}
                                            disabled={isSavingDelay}
                                            className="flex h-9 shrink-0 items-center gap-2 rounded bg-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-primary-fixed-dim disabled:opacity-50"
                                        >
                                            {isSavingDelay ? (
                                                <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
                                            ) : (
                                                <span className="material-symbols-outlined text-[16px]">schedule</span>
                                            )}
                                            Save delay
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                                        <div className="flex items-center gap-2">
                                            <input
                                                id="delay-enabled"
                                                type="checkbox"
                                                checked={delayEnabled}
                                                onChange={(e) => setDelayEnabled(e.target.checked)}
                                                className="h-4 w-4 shrink-0 cursor-pointer rounded border-outline text-primary accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50"
                                            />
                                            <label htmlFor="delay-enabled" className="cursor-pointer select-none text-sm text-on-surface">
                                                Enable delay
                                            </label>
                                        </div>
                                        <div>
                                            <label htmlFor="delay-ms" className="mb-1.5 block text-[11px] font-medium text-secondary">
                                                Delay (ms)
                                            </label>
                                            <input
                                                id="delay-ms"
                                                type="number"
                                                min={0}
                                                disabled={!delayEnabled}
                                                value={delayMs}
                                                onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
                                                className="h-10 w-32 border-b border-outline bg-surface-container px-3 font-mono text-sm outline-none focus:border-primary disabled:opacity-50"
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex flex-1 items-center justify-center text-stone-500">
                        <div className="flex flex-col items-center">
                            <span className="material-symbols-outlined mb-4 text-4xl text-outline">api</span>
                            <p>Select an endpoint from the left menu to view mock configuration.</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
