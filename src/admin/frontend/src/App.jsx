import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import Endpoints from './pages/Endpoints';
import Requests from './pages/Requests';
import Jobs from './pages/Jobs';
import Toaster from './components/Toaster';

function Layout() {
  const location = useLocation();
  const currentPath = location.pathname;

  return (
    <div className="bg-background text-on-background flex min-h-0 flex-1 flex-col overflow-hidden">
      <Toaster />
      <header className="bg-white dark:bg-stone-950 border-b border-stone-200 dark:border-stone-800 flex items-center h-12 w-full px-4 justify-between shrink-0">
        <div className="flex items-center gap-8 h-full">
          <span className="text-lg font-semibold tracking-tighter text-stone-900 dark:text-white">Console</span>
          <nav className="flex h-full items-center font-['IBM_Plex_Sans'] text-sm tracking-tight">
            <Link to="/admin/endpoints" className={`h-full flex items-center px-4 transition-colors duration-75 ${currentPath.includes('/endpoints') ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-900'}`}>Endpoints</Link>
            <Link to="/admin/jobs" className={`h-full flex items-center px-4 transition-colors duration-75 ${currentPath.includes('/jobs') ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-900'}`}>Cron Jobs</Link>
            <Link to="/admin/requests" className={`h-full flex items-center px-4 transition-colors duration-75 ${currentPath.includes('/requests') ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-900'}`}>Logs</Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="p-2 text-stone-600 hover:bg-stone-100 dark:hover:bg-stone-900 transition-colors duration-75 flex items-center">
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Routes>
          <Route path="/admin/endpoints" element={<Endpoints />} />
          <Route path="/admin/jobs" element={<Jobs />} />
          <Route path="/admin/requests" element={<Requests />} />
          <Route path="*" element={<Navigate to="/admin/endpoints" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}

export default App;
