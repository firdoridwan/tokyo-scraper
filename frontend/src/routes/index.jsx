import { createBrowserRouter } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell.jsx';
import { RouteErrorBoundary } from '@/components/common/RouteErrorBoundary.jsx';

import { DashboardPage } from '@/pages/DashboardPage.jsx';
import { ScrapePage } from '@/pages/ScrapePage.jsx';
import { JobsPage } from '@/pages/JobsPage.jsx';
import { JobDetailPage } from '@/pages/JobDetailPage.jsx';
import { ResultsPage } from '@/pages/ResultsPage.jsx';
import { SourcesPage } from '@/pages/SourcesPage.jsx';
import { SettingsPage } from '@/pages/SettingsPage.jsx';
import { NotFoundPage } from '@/pages/NotFoundPage.jsx';

/**
 * Route table.
 *
 * A single layout route wraps every page, so the shell mounts once and
 * navigation only swaps the outlet. Adding a page = one entry here + one entry
 * in `navigation.js`.
 *
 * Pages are imported eagerly: this is a desktop-style internal tool where a
 * single fast bundle beats per-route loading spinners. Swap to `lazy()` here
 * if the bundle outgrows that trade-off.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'scrape', element: <ScrapePage /> },
      { path: 'jobs', element: <JobsPage /> },
      { path: 'jobs/:jobId', element: <JobDetailPage /> },
      { path: 'results', element: <ResultsPage /> },
      { path: 'sources', element: <SourcesPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default router;
