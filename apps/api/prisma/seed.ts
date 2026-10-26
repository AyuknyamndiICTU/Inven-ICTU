/* Idempotent seed: categories, ~30 Cisco lab items (with ledger entries), 200 SYNTHETIC students, one SUPER_ADMIN.
 * With NODE_ENV=production only the categories and the SUPER_ADMIN are created (LABPASS_SEED_DEMO=1 overrides).
 * Running it twice changes nothing. Never seed real student data here. */
import { hash } from '@node-rs/argon2';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildDbUrl } = require('../scripts/db-url.cjs') as { buildDbUrl: (db?: string) => string };
process.env.DATABASE_URL ??= buildDbUrl();

const prisma = new PrismaClient();

const categories: Array<[name: string, icon: string]> = [
  ['Routers', 'router'],
  ['Switches', 'switch'],
  ['Firewalls & Security', 'firewall'],
  ['Wireless', 'wifi'],
  ['Cables & Transceivers', 'cable'],
  ['Modules & Cards', 'cpu'],
  ['Tools', 'wrench'],
  ['Console & Power', 'plug'],
];

// code, name, category, quantity, low-stock threshold (null = global default)
const equipment: Array<[string, string, string, number, number | null]> = [
  ['RTR-ISR4321', 'Cisco ISR 4321 Router', 'Routers', 8, 2],
  ['RTR-ISR4331', 'Cisco ISR 4331 Router', 'Routers', 4, 1],
  ['RTR-C2911', 'Cisco 2911 Router', 'Routers', 10, 3],
  ['RTR-C1941', 'Cisco 1941 Router', 'Routers', 6, 2],
  ['SW-C2960X-24', 'Catalyst 2960-X 24-port Switch', 'Switches', 12, 3],
  ['SW-C2960-24TT', 'Catalyst 2960 24TT-L Switch', 'Switches', 10, 3],
  ['SW-C3650-24', 'Catalyst 3650 24-port L3 Switch', 'Switches', 4, 1],
  ['SW-C9200L-24', 'Catalyst 9200L 24-port Switch', 'Switches', 6, 2],
  ['FW-ASA5506X', 'ASA 5506-X Firewall', 'Firewalls & Security', 5, 1],
  ['FW-FPR1010', 'Firepower 1010 Firewall', 'Firewalls & Security', 3, 1],
  ['AP-AIR2802I', 'Aironet 2802i Access Point', 'Wireless', 6, 2],
  ['WLC-C3504', 'Catalyst 3504 Wireless Controller', 'Wireless', 2, null],
  ['CBL-CONSOLE-RJ45', 'Console Cable RJ45–DB9', 'Console & Power', 30, 8],
  ['CBL-CONSOLE-USB', 'USB-to-Serial Console Cable', 'Console & Power', 20, 5],
  ['CBL-CAT6-2M', 'Cat6 Patch Cable 2 m', 'Cables & Transceivers', 80, 20],
  ['CBL-CAT6-5M', 'Cat6 Patch Cable 5 m', 'Cables & Transceivers', 40, 10],
  ['CBL-CROSSOVER', 'Cat5e Crossover Cable', 'Cables & Transceivers', 20, 5],
  ['CBL-SERIAL-V35', 'V.35 Serial DTE/DCE Cable', 'Cables & Transceivers', 12, 3],
  ['SFP-1G-SX', 'SFP 1000BASE-SX Transceiver', 'Cables & Transceivers', 16, 4],
  ['SFP-10G-SR', 'SFP+ 10GBASE-SR Transceiver', 'Cables & Transceivers', 8, 2],
  ['MOD-HWIC-2T', 'HWIC-2T Serial Module', 'Modules & Cards', 10, 2],
  ['MOD-NIM-2T', 'NIM-2T Serial Module', 'Modules & Cards', 6, 2],
  ['MOD-EHWIC-4ESG', 'EHWIC 4-port Gigabit Switch Module', 'Modules & Cards', 4, 1],
  ['TL-CRIMPER', 'RJ45 Crimping Tool', 'Tools', 15, 4],
  ['TL-LANTEST', 'LAN Cable Tester', 'Tools', 10, 3],
  ['TL-PUNCH', 'Punch-down Tool', 'Tools', 8, 2],
  ['TL-STRIPPER', 'Cable Stripper', 'Tools', 10, 3],
  ['PWR-STRIP-6', 'Power Strip (6 outlets)', 'Console & Power', 12, 3],
  ['PWR-UPS-1K', 'UPS 1 kVA', 'Console & Power', 3, 1],
  ['TL-LAPTOP-LAB', 'Lab Laptop (Packet Tracer)', 'Tools', 6, 2],
];

const firstNames = [
  'Awa',
  'Brice',
  'Clarisse',
  'Daniel',
  'Estelle',
  'Franck',
  'Grâce',
  'Hervé',
  'Inès',
  'Jean-Paul',
  'Kevine',
  'Landry',
  'Marie-Thérèse',
  'Nadège',
  'Olivier',
  'Pauline',
  'Rodrigue',
  'Sandrine',
  'Thierry',
  'Ulrich',
  'Vanessa',
  'William',
  'Yvan',
  'Zita',
];
const lastNames = [
  'Ngo Bassa',
  'Tchoupo',
  'Mbarga',
  'Nkemdirim',
  'Fotso',
  'Ekane',
  'Abena',
  'Djoumessi',
  'Nguema',
  'Ateba',
  'Kamga',
  'Mvondo',
  'Tabi',
  'Eyenga',
  'Nana',
  'Ondoua',
  'Mbappe',
  'Essomba',
  'Takam',
  'Bella',
];
const programs = [
  'Software Engineering',
  'Networks & Telecoms',
  'Cybersecurity',
  'Data Science',
  'Computer Engineering',
];
const levels = ['L1', 'L2', 'L3', 'M1', 'M2'];

function syntheticStudent(i: number) {
  const firstName = firstNames[i % firstNames.length]!;
  const lastName = lastNames[(i * 7) % lastNames.length]!;
  const matricule = `ICTU2024${String(i + 1).padStart(4, '0')}`;
  const contactMode = i % 5; // 0: none · 1: phone only · 2-4: email (+ phone for even)
  const slug = `${firstName}.${lastName}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z.]/g, '');
  return {
    matricule,
    firstName,
    lastName,
    email: contactMode >= 2 ? `${slug}${i}@students.ictuniversity.example` : null,
    phone:
      contactMode === 1 || contactMode === 2 || contactMode === 4
        ? `+2376${String(70000000 + i * 1013).slice(0, 8)}`
        : null,
    dateOfBirth: new Date(Date.UTC(1998 + (i % 8), i % 12, 1 + (i % 28))),
    program: programs[i % programs.length]!,
    level: levels[i % levels.length]!,
    status: i % 50 === 49 ? ('SUSPENDED' as const) : i % 40 === 39 ? ('INACTIVE' as const) : ('ACTIVE' as const),
  };
}

async function main() {
  // Production (first install): categories + the first SUPER_ADMIN only. Demo items and synthetic students would sit
  // next to the registrar's real import and invent stock, so they need an explicit opt-in there.
  const demo = process.env.NODE_ENV !== 'production' || process.env.LABPASS_SEED_DEMO === '1';
  const catIds = new Map<string, string>();
  for (const [i, [name, icon]] of categories.entries()) {
    const c = await prisma.equipmentCategory.upsert({
      where: { name },
      update: {},
      create: { name, icon, sortOrder: i },
    });
    catIds.set(name, c.id);
  }

  let createdItems = 0;
  for (const [code, name, category, qty, threshold] of demo ? equipment : []) {
    const exists = await prisma.equipment.findUnique({ where: { code } });
    if (exists) continue;
    await prisma.$transaction(async (tx) => {
      const eq = await tx.equipment.create({
        data: {
          code,
          name,
          categoryId: catIds.get(category)!,
          totalQuantity: qty,
          availableQuantity: qty,
          lowStockThreshold: threshold,
        },
      });
      await tx.stockMovement.create({
        data: {
          equipmentId: eq.id,
          type: 'RESTOCK',
          delta: qty,
          totalDelta: qty,
          actorType: 'SYSTEM',
          reason: 'Initial stock (seed)',
        },
      });
    });
    createdItems++;
  }

  const studentsBefore = await prisma.student.count();
  for (let i = 0; i < (demo ? 200 : 0); i++) {
    const s = syntheticStudent(i);
    await prisma.student.upsert({ where: { matricule: s.matricule }, update: {}, create: s });
  }
  const createdStudents = (await prisma.student.count()) - studentsBefore;

  const email = (process.env.LABPASS_SEED_ADMIN_EMAIL ?? 'admin@labpass.local').toLowerCase();
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  let adminNote = 'unchanged';
  if (!existing) {
    const provided = process.env.LABPASS_SEED_ADMIN_PASSWORD;
    const password = provided ?? randomBytes(12).toString('base64url');
    await prisma.adminUser.create({
      data: { email, name: 'LabPass Administrator', role: 'SUPER_ADMIN', passwordHash: await hash(password) },
    });
    adminNote = provided
      ? 'created (password from LABPASS_SEED_ADMIN_PASSWORD)'
      : `created with generated password: ${password}  ← change it after first login`;
  }

  console.warn(`seed: ${createdItems} new items, ${createdStudents} new students, admin ${email} ${adminNote}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
