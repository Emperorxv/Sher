import { PrismaClient, RoomStatus, UserStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const host = await prisma.user.upsert({
    where: { phone: '+2348000000001' },
    update: {},
    create: {
      phone: '+2348000000001',
      displayName: 'Dev Host',
      status: UserStatus.ACTIVE,
    },
  });

  const guest = await prisma.user.upsert({
    where: { phone: '+2348000000002' },
    update: {},
    create: {
      phone: '+2348000000002',
      displayName: 'Dev Guest',
      status: UserStatus.ACTIVE,
    },
  });

  const now = new Date();
  const room = await prisma.room.upsert({
    where: { joinCode: 'DEV001' },
    update: {},
    create: {
      name: 'Dev Party Room',
      hostId: host.id,
      joinCode: 'DEV001',
      qrSecret: 'dev-secret-do-not-use-in-production',
      baseCapacity: 3,
      status: RoomStatus.ACTIVE,
      startsAt: now,
      endsAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
      retentionUntil: new Date(now.getTime() + (30 * 24 + 4) * 60 * 60 * 1000),
      pricingCurrency: 'NGN',
    },
  });

  await prisma.membership.upsert({
    where: { roomId_userId: { roomId: room.id, userId: host.id } },
    update: {},
    create: {
      roomId: room.id,
      userId: host.id,
      role: 'HOST',
      joinOrder: 1,
      unlockState: 'LOCKED',
    },
  });

  await prisma.membership.upsert({
    where: { roomId_userId: { roomId: room.id, userId: guest.id } },
    update: {},
    create: {
      roomId: room.id,
      userId: guest.id,
      role: 'GUEST',
      joinOrder: 2,
      unlockState: 'LOCKED',
    },
  });

  console.log('Seed complete', {
    hostId: host.id,
    guestId: guest.id,
    roomId: room.id,
  });
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
