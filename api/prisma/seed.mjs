import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("123456", 10);

  await prisma.user.upsert({
    where: { id: "seller-demo-1" },
    update: {
      passwordHash
    },
    create: {
      id: "seller-demo-1",
      name: "Vendedor Demo",
      email: "seller-demo-1@placeholder.local",
      passwordHash
    }
  });

  await prisma.user.upsert({
    where: { id: "master-demo-1" },
    update: {
      passwordHash
    },
    create: {
      id: "master-demo-1",
      name: "Gerente Demo",
      email: "master-demo-1@placeholder.local",
      passwordHash,
      role: "MASTER"
    }
  });

  const clients = [
    { externalRef: "demo-001", name: "Mercado Centro" },
    { externalRef: "demo-002", name: "Loja Jardim" },
    { externalRef: "demo-003", name: "Farmacia Bairro" }
  ];
  for (const client of clients) {
    await prisma.client.upsert({
      where: { externalRef: client.externalRef },
      update: {
        name: client.name,
        sellerId: "seller-demo-1"
      },
      create: {
        name: client.name,
        externalRef: client.externalRef,
        sellerId: "seller-demo-1"
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
