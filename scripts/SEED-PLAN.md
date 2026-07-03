# Seed Script Plan — `requisicion-equipo`

## Goal
Seed Strapi's `requisicion-equipo` collection from JSON files in `../seeds-data/data/`.

## Inputs
- `../seeds-data/data/*.json` — arrays of records with fields:
  `internal_id`, `ubicacion`, `descripcion_status`, `descripcion_danio`,
  `fecha_ultima_revision`, `actividad`, `category`.
- Schema must already include `internal_id` (user adds it; script does not edit schema).

## Approach
Standalone Node script that boots its own Strapi instance with `compileStrapi` /
`createStrapi` (no HTTP server), seeds, tears down — matches the proven pattern
from the reference project.

## File to create
`cms-controllet/scripts/seed-requisicion-equipo.js` (CommonJS)

## Script structure

```
require('@strapi/strapi'), fs, path
loadRecordsFromDataDir()     → reads ../seeds-data/data/*.json, logs file + count
normalizeRecord(record)      → N/A/"" → null for date/string fields;
                                enum-validate descripcion_status & actividad;
                                skip+warn on invalid
isForce()                    → checks process.argv for --force
wipeExisting(strapi)         → findMany all; if count>0 and !force → throw;
                                else iterate delete; log wiped count
seedRecords(strapi, records) → create each with status:'published'
setPublicPermissions(strapi) → grant find/findOne on requisicion-equipo to public role
main()                       → compileStrapi → createStrapi().load()
                                → log.level=error → load → wipe → seed
                                → setPublicPermissions → summary → destroy → exit(0)
```

## Behavior decisions
- **Wipe**: refuses if existing rows found without `--force`; with `--force`
  deletes all then inserts.
- **Publish**: `status: 'published'` so entries are live immediately
  (Strapi 5 document service).
- **Validation**: skip records with invalid enum values, log a warning with the
  `internal_id`.
- **Normalization**: `"N/A"` / empty string → `null` for
  `fecha_ultima_revision`, `descripcion_danio`, `actividad`.
- **Permissions**: after seeding, grant `find` and `findOne` on
  `api::requisicion-equipo.requisicion-equipo` to the `public` role.
- **`evidencia_fotografica_src`**: omitted (optional, not in JSON).
- **`category`**: passed through from JSON (already set to filename stem).

## npm scripts to add

```json
"seed": "node scripts/seed-requisicion-equipo.js",
"seed:force": "node scripts/seed-requisicion-equipo.js --force"
```

## Run

```sh
npm run seed          # refuses if data exists
npm run seed:force    # wipe & reseed
```

## Verification
- `npm run seed:force` exits 0, prints per-file counts + summary.
- Admin panel shows N published `requisicion-equipo` entries.
- `GET /api/requisicion-equipos` returns the seeded records (public
  permissions granted).
