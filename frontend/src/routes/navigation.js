import { Database, LayoutDashboard, ListChecks, PlayCircle, Settings, Globe } from 'lucide-react';

/**
 * Navigation model.
 *
 * The sidebar renders from this array — it never hardcodes links. Adding a
 * page means adding one entry here plus one route in `index.jsx`.
 */
export const NAV_SECTIONS = [
  {
    label: 'Workspace',
    items: [
      {
        to: '/',
        label: 'Dashboard',
        icon: LayoutDashboard,
        end: true,
        description: 'Overview and recent activity',
      },
      {
        to: '/scrape',
        label: 'New Scrape',
        icon: PlayCircle,
        description: 'Configure and start an extraction',
      },
      {
        to: '/jobs',
        label: 'Jobs',
        icon: ListChecks,
        description: 'Queue history and job status',
      },
      {
        to: '/results',
        label: 'Results',
        icon: Database,
        description: 'Extracted business records',
      },
    ],
  },
  {
    label: 'Configuration',
    items: [
      {
        to: '/sources',
        label: 'Sources',
        icon: Globe,
        description: 'Supported directory websites',
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings,
        description: 'Runtime and engine configuration',
      },
    ],
  },
];

export default NAV_SECTIONS;
