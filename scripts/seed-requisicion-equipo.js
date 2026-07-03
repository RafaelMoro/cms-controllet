'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createStrapi, compileStrapi } = require('@strapi/strapi');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(__dirname, '../../seeds-data/data');
const CONTENT_API_UID = 'api::requisicion-equipo.requisicion-equipo';

const VALID_STATUSES = [
  'Buen estado',
  'Requiere cambio',
  'Requiere reparación',
  'Bloqueada',
  'Extraviada',
  'En resguardo',
  'Desenergizada',
];

const VALID_ACTIVIDADES = [
  'Sin Actividad',
  'Roedor',
  'Insecto Rastrero',
  'Reptil',
  'Actividad moderada',
  'Actividad baja',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isForce() {
  return process.argv.includes('--force');
}

function loadRecordsFromDataDir() {
  const records = [];

  if (!fs.existsSync(DATA_DIR)) {
    console.warn(`  ⚠  Data directory not found: ${DATA_DIR}`);
    return records;
  }

  const files = fs.readdirSync(DATA_DIR, { withFileTypes: true });

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;

    const filePath = path.join(DATA_DIR, file.name);

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.warn(`  ⚠  ${file.name}: failed to parse JSON, skipping (${err.message})`);
      continue;
    }

    if (!Array.isArray(raw)) {
      console.warn(`  ⚠  ${file.name}: root is not an array, skipping`);
      continue;
    }

    records.push({ file: file.name, items: raw });
    console.log(`  ✓ ${file.name}: ${raw.length} records loaded`);
  }

  return records;
}

function normalizeRecord(record) {
  const {
    internal_id,
    ubicacion,
    descripcion_status,
    descripcion_danio,
    fecha_ultima_revision,
    actividad,
    category,
  } = record;

  if (!ubicacion || !internal_id) {
    console.warn(`  ⚠  record ${internal_id}: missing ubicacion or internal_id, skipping`);
    return null;
  }

  if (!VALID_STATUSES.includes(descripcion_status)) {
    console.warn(`  ⚠  record ${internal_id}: invalid descripcion_status "${descripcion_status}", skipping`);
    return null;
  }

  if (actividad && actividad !== 'N/A' && !VALID_ACTIVIDADES.includes(actividad)) {
    console.warn(`  ⚠  record ${internal_id}: invalid actividad "${actividad}", skipping`);
    return null;
  }

  return {
    internal_id,
    ubicacion,
    descripcion_status,
    descripcion_danio: descripcion_danio && descripcion_danio !== 'N/A' ? descripcion_danio : null,
    fecha_ultima_revision:
      fecha_ultima_revision && fecha_ultima_revision !== 'N/A' ? fecha_ultima_revision : null,
    actividad: actividad && actividad !== 'N/A' ? actividad : null,
    category,
  };
}

// ---------------------------------------------------------------------------
// Seed steps
// ---------------------------------------------------------------------------

async function wipeExisting(strapi) {
  const existing = await strapi.documents(CONTENT_API_UID).findMany({ limit: 10000 });

  if (existing.length === 0) return 0;

  if (!isForce()) {
    throw new Error(
      `Found ${existing.length} existing requisicion-equipo records. Use --force to wipe & reseed.`
    );
  }

  console.log(`  Deleting ${existing.length} existing records...`);
  for (const entry of existing) {
    await strapi.documents(CONTENT_API_UID).delete({ documentId: entry.documentId });
  }
  return existing.length;
}

async function seedRecords(strapi, allRecords) {
  let inserted = 0;
  let skipped = 0;

  for (const { file, items } of allRecords) {
    for (const raw of items) {
      const data = normalizeRecord(raw);
      if (!data) {
        skipped++;
        continue;
      }

      try {
        await strapi.documents(CONTENT_API_UID).create({
          data,
          status: 'published',
        });
        inserted++;
      } catch (err) {
        console.error(`  ✗ Error inserting record ${raw.internal_id}: ${err.message}`);
        skipped++;
      }
    }
  }

  return { inserted, skipped };
}

async function setPublicPermissions(strapi) {
  const actions = [
    'api::requisicion-equipo.requisicion-equipo.find',
    'api::requisicion-equipo.requisicion-equipo.findOne',
  ];

  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({
    where: { type: 'public' },
  });

  if (!publicRole) {
    console.warn('  ⚠  Public role not found, skipping permissions setup');
    return;
  }

  for (const action of actions) {
    const existing = await strapi.db.query('plugin::users-permissions.permission').findOne({
      where: { action, role: publicRole.id },
    });

    if (existing) {
      console.log(`  · Permission "${action}" already exists`);
      continue;
    }

    await strapi.db.query('plugin::users-permissions.permission').create({
      data: { action, role: publicRole.id },
    });
    console.log(`  ✓ Permission "${action}" granted to public`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';

  console.log('── Requisicion Equipo Seed ──────────────────────────────────\n');

  // Load
  console.log('Loading seed data...');
  const allRecords = loadRecordsFromDataDir();
  const totalRecords = allRecords.reduce((acc, r) => acc + r.items.length, 0);

  if (allRecords.length === 0) {
    console.warn('\n  ⚠  No seed data found. Exiting.');
    await app.destroy();
    process.exit(0);
  }

  console.log(`  Total: ${allRecords.length} file(s), ${totalRecords} record(s)\n`);

  // Wipe
  console.log('Checking for existing data...');
  const wiped = await wipeExisting(app);
  if (wiped > 0) {
    console.log(`  ✓ Removed ${wiped} existing records\n`);
  } else {
    console.log('  (no existing records found)\n');
  }

  // Seed
  console.log('Seeding records...');
  const { inserted, skipped } = await seedRecords(app, allRecords);
  console.log(`\n  ✓ Inserted: ${inserted}`);
  console.log(`  ⚠ Skipped:  ${skipped}`);

  // Permissions
  console.log('');
  console.log('Setting up public permissions...');
  await setPublicPermissions(app);

  console.log('');
  console.log('──────────────────────────────────────────────────────────────');
  console.log('Seed complete.');

  await app.destroy();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
