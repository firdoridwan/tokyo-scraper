# SQLite driver (not implemented)

Reserved for the persistence milestone. Nothing here is loaded today.

## What goes here

```
sqlite/
  connection.js                 # better-sqlite3 handle, WAL pragma, singleton
  migrations/
    001_initial_schema.sql      # jobs, results tables + indexes
  migrator.js                   # applies pending migrations on boot
  job.sqlite.repository.js      # implements JobRepository
  result.sqlite.repository.js   # implements ResultRepository
```

## Contract

Both repositories must implement the interfaces in `../types.js` exactly —
same method names, same argument shapes, same return shapes. Every method is
synchronous, matching `better-sqlite3` and the in-memory driver.

## Switching over

1. Build the files above.
2. Add the `sqlite` branch to `../index.js` (the `throw` marks the spot).
3. Set `PERSISTENCE_DRIVER=sqlite` in `.env`.

No service, controller, or route changes — that is the point of the seam.

The database file path is already configured: `config.paths.database`
(defaults to `data/database.sqlite`).
