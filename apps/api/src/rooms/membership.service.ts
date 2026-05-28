import { ConflictException, Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MembershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Atomically assigns the next joinOrder for a room and creates the membership.
   * Uses a serialisable transaction + the @@unique([roomId, joinOrder]) constraint
   * as a safety net against concurrent joins.
   */
  async createMembership(roomId: string, userId: string, role: Role) {
    return this.prisma.$transaction(async (tx) => {
      // Remove any soft-deleted (zombie) row for this [roomId, userId] pair.
      // Legacy code soft-deleted memberships (set leftAt) rather than hard-deleting;
      // those rows survive the code fix and block re-creation via @@unique([roomId, userId]).
      await tx.membership.deleteMany({
        where: { roomId, userId, leftAt: { not: null } },
      });

      // Count current active members to derive the next joinOrder.
      const count = await tx.membership.count({ where: { roomId, leftAt: null } });
      const joinOrder = count + 1;

      try {
        return await tx.membership.create({
          data: {
            roomId,
            userId,
            role,
            joinOrder,
            unlockState: 'LOCKED',
          },
        });
      } catch (err: unknown) {
        // P2002 = unique constraint violation (concurrent join)
        if (isP2002(err)) throw new ConflictException('ALREADY_MEMBER');
        throw err;
      }
    });
  }
}

function isP2002(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}
