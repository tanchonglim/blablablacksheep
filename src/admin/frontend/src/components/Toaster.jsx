import { useState, useEffect } from 'react';
import { toastEvent } from '../toast-bus';

export default function Toaster() {
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        const handleToast = (e) => {
            const toast = e.detail;
            setToasts(prev => [...prev, toast]);
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== toast.id));
            }, 3000);
        };
        toastEvent.addEventListener('toast', handleToast);
        return () => toastEvent.removeEventListener('toast', handleToast);
    }, []);

    return (
        <div className="fixed bottom-6 right-6 flex flex-col gap-2 z-[9999] pointer-events-none">
            {toasts.map(t => (
                <div key={t.id} className={`px-4 py-3 rounded-md shadow-lg flex items-center gap-3 text-sm font-medium transform transition-all pointer-events-auto border ${t.type === 'success' ? 'bg-[#0f62fe] text-white border-[#0f62fe]' :
                        t.type === 'error' ? 'bg-[#da1e28] text-white border-[#da1e28]' :
                            'bg-surface border-outline text-on-surface'
                    }`}>
                    <span className="material-symbols-outlined text-[18px]">
                        {t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'error' : 'info'}
                    </span>
                    {t.message}
                </div>
            ))}
        </div>
    );
}
