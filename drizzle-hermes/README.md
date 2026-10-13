# Hermes's migration, held

`0151_hermes_pages.sql` creates `hermes_pages` (Hermes's settings per webinar). It is held here, outside `drizzle/`, so that
Vercel Preview builds of `hermes/mf-pages` (which run `db:migrate`) never apply it: until Architectus says whether Preview
shares the production database, Danno asked that it reach no database before he merges.

Until then the pages read the missing table as "switch off" (`src/lib/hermes/settings.ts`). Local walks create the table
from this file (`scripts/smoke-hermes.ts`).

When Danno says he is about to merge, Hermes adds the last commit: `npm run db:generate` (it writes this same SQL, from
`src/db/schema-hermes.ts`), renamed to the next free number with its snapshot and journal entry, and this folder removed.
