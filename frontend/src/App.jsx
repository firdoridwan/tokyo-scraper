import { RouterProvider } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip.jsx';
import { router } from '@/routes/index.jsx';

/**
 * Application root.
 *
 * Global providers wrap the router here — one place to add future context
 * (query client, auth, theme) without touching `main.jsx` or any page.
 */
export function App() {
  return (
    <TooltipProvider delayDuration={200}>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}

export default App;
