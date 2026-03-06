import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

const organizations = [
  {
    id: "org-trinit-default",
    slug: "trinit",
    name: "Trinit"
  },
  {
    id: "org-vynor-master",
    slug: "vynor",
    name: "Vynor"
  }
];

const users = [
  {
    id: "trinit-master-andre",
    name: "Andre Nadolny",
    username: "andretrinit",
    email: "andre.nadolny@trinit.local",
    password: "andretrinit",
    role: "MASTER",
    organizationSlug: "trinit"
  },
  {
    id: "trinit-seller-wedsley",
    name: "Wedsley Kasprzak",
    username: "wedsleytrinit",
    email: "wedsley.kasprzak@trinit.local",
    password: "wedsleytrinit",
    role: "SELLER",
    organizationSlug: "trinit"
  },
  {
    id: "vynor-super-admin-jean",
    name: "Jean Carlos",
    username: "jeanvynor",
    email: "jean.carlos@vynor.local",
    password: "189088csxA#",
    role: "SUPER_ADMIN",
    organizationSlug: "vynor"
  }
];

async function ensureOrganization(organization) {
  const current = await prisma.organization.findUnique({
    where: { slug: organization.slug },
    select: { id: true, slug: true, name: true }
  });

  if (dryRun) {
    if (current) {
      console.log(`[dry-run] organization update ${organization.slug} -> ${organization.name}`);
      return current;
    }

    console.log(`[dry-run] organization create ${organization.slug} -> ${organization.name}`);
    return {
      id: organization.id,
      slug: organization.slug,
      name: organization.name
    };
  }

  const saved = await prisma.organization.upsert({
    where: { slug: organization.slug },
    update: { name: organization.name },
    create: {
      id: organization.id,
      slug: organization.slug,
      name: organization.name
    },
    select: { id: true, slug: true, name: true }
  });

  console.log(`organization ready ${saved.slug} (${saved.id})`);
  return saved;
}

function describeUser(user) {
  return `${user.username} <${user.email}> [${user.role}]`;
}

async function upsertUser(user, organizationId) {
  const matches = await prisma.user.findMany({
    where: {
      OR: [
        { id: user.id },
        { email: user.email },
        { username: user.username }
      ]
    },
    select: {
      id: true,
      email: true,
      username: true,
      name: true,
      role: true,
      organizationId: true
    }
  });

  if (matches.length > 1) {
    throw new Error(
      `Conflicting users found for ${user.username}: ${matches
        .map((match) => `${match.id} (${match.username} / ${match.email})`)
        .join(", ")}`
    );
  }

  const passwordHash = await bcrypt.hash(user.password, 10);
  const current = matches[0];

  if (dryRun) {
    if (current) {
      console.log(
        `[dry-run] user update ${describeUser(user)} using existing id ${current.id}`
      );
    } else {
      console.log(`[dry-run] user create ${describeUser(user)} with id ${user.id}`);
    }
    return;
  }

  if (current) {
    await prisma.user.update({
      where: { id: current.id },
      data: {
        name: user.name,
        username: user.username,
        email: user.email,
        passwordHash,
        role: user.role,
        organizationId
      }
    });
    console.log(`user updated ${describeUser(user)} (${current.id})`);
    return;
  }

  await prisma.user.create({
    data: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      passwordHash,
      role: user.role,
      organizationId
    }
  });
  console.log(`user created ${describeUser(user)} (${user.id})`);
}

async function main() {
  console.log(dryRun ? "Running in dry-run mode." : "Applying production user upserts.");

  const organizationsBySlug = new Map();
  for (const organization of organizations) {
    const saved = await ensureOrganization(organization);
    organizationsBySlug.set(saved.slug, saved);
  }

  for (const user of users) {
    const organization = organizationsBySlug.get(user.organizationSlug);
    if (!organization) {
      throw new Error(`Organization not found for slug ${user.organizationSlug}`);
    }
    await upsertUser(user, organization.id);
  }

  console.log(dryRun ? "Dry-run completed." : "Production users upserted successfully.");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
