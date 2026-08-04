import { Link } from 'react-router-dom';
import { Compass, LayoutDashboard } from 'lucide-react';

import { EmptyState } from '@/components/common/EmptyState.jsx';
import { Button } from '@/components/ui/button.jsx';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <EmptyState
        className="border-0"
        icon={Compass}
        title="Page not found"
        description="That route doesn't exist in Tokyo Scraper."
        action={
          <Button asChild>
            <Link to="/">
              <LayoutDashboard />
              Back to dashboard
            </Link>
          </Button>
        }
      />
    </div>
  );
}

export default NotFoundPage;
