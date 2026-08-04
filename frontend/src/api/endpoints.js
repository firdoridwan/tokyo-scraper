/**
 * Endpoint catalogue.
 *
 * Every path the frontend can call, in one place. No component or service
 * builds a URL from a string literal — renaming a route is a one-line change.
 */
export const endpoints = {
  health: () => '/health',
  stats: () => '/stats',

  sources: {
    list: () => '/sources',
    detail: (id) => `/sources/${encodeURIComponent(id)}`,
  },

  jobs: {
    list: () => '/jobs',
    create: () => '/jobs',
    detail: (id) => `/jobs/${encodeURIComponent(id)}`,
    cancel: (id) => `/jobs/${encodeURIComponent(id)}/cancel`,
    remove: (id) => `/jobs/${encodeURIComponent(id)}`,
    results: (id) => `/jobs/${encodeURIComponent(id)}/results`,
  },

  results: {
    list: () => '/results',
    export: () => '/results/export',
  },
};

export default endpoints;
