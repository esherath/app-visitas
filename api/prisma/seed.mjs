import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  await prisma.ghlOpportunity.deleteMany();
  await prisma.ghlContact.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.client.deleteMany();
  await prisma.syncCursor.deleteMany();
  await prisma.user.deleteMany();

  const trinit = await prisma.organization.upsert({
    where: { slug: "trinit" },
    update: { name: "Trinit" },
    create: {
      id: "org-trinit-default",
      name: "Trinit",
      slug: "trinit"
    }
  });

  const vynor = await prisma.organization.upsert({
    where: { slug: "vynor" },
    update: { name: "Vynor" },
    create: {
      id: "org-vynor-master",
      name: "Vynor",
      slug: "vynor"
    }
  });

  const users = [
    {
      id: "trinit-master-andre",
      name: "Andre Nadolny",
      username: "andretrinit",
      email: "andre.nadolny@trinit.local",
      password: "andretrinit",
      role: "MASTER",
      organizationId: trinit.id
    },
    {
      id: "trinit-seller-wedsley",
      name: "Wedsley Kasprzak",
      username: "wedsleytrinit",
      email: "wedsley.kasprzak@trinit.local",
      password: "wedsleytrinit",
      role: "SELLER",
      organizationId: trinit.id
    },
    {
      id: "vynor-super-admin-jean",
      name: "Jean Carlos",
      username: "jeanvynor",
      email: "jean.carlos@vynor.local",
      password: "189088csxA#",
      role: "SUPER_ADMIN",
      organizationId: vynor.id
    }
  ];

  for (const user of users) {
    const passwordHash = await bcrypt.hash(user.password, 10);
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        passwordHash,
        role: user.role,
        organizationId: user.organizationId
      }
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    console.log("Seed concluido.");
  })
  .catch(async (error) => {
    await prisma.$disconnect();
    console.error(error);
    process.exit(1);
  });
