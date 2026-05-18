import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

const MOCK_USER = {
  id: 'user-id',
  phone: '+2348012345678',
  email: 'alice@example.com',
  emailVerified: true,
  marketingConsent: false,
  displayName: 'Alice',
  avatarUrl: null,
  status: 'ACTIVE' as const,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
};

describe('UsersService', () => {
  let service: UsersService;
  let mockPrisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let mockEmailVerify: { sendVerification: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(MOCK_USER),
        update: jest
          .fn()
          .mockImplementation(({ data }: { data: Partial<typeof MOCK_USER> }) =>
            Promise.resolve({ ...MOCK_USER, ...data }),
          ),
      },
    };
    mockEmailVerify = { sendVerification: jest.fn().mockResolvedValue(undefined) };
    service = new UsersService(mockPrisma as never, mockEmailVerify as never);
  });

  describe('getMe()', () => {
    it('returns public user fields', async () => {
      const result = await service.getMe('user-id');
      expect(result.id).toBe('user-id');
      expect(result.email).toBe('alice@example.com');
      // phone is in PublicUser
      expect(result.phone).toBe('+2348012345678');
    });

    it('throws NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getMe('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, deletedAt: new Date() });
      await expect(service.getMe('user-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('patchMe()', () => {
    it('updates displayName without touching other fields', async () => {
      const result = await service.patchMe('user-id', { displayName: 'Bob' });
      expect(result.displayName).toBe('Bob');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { displayName: 'Bob' } }),
      );
    });

    it('resets emailVerified and triggers verification when email changes', async () => {
      await service.patchMe('user-id', { email: 'new@example.com' });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'new@example.com', emailVerified: false }),
        }),
      );
      expect(mockEmailVerify.sendVerification).toHaveBeenCalledWith('user-id', 'new@example.com');
    });

    it('does not trigger verification when email is unchanged', async () => {
      await service.patchMe('user-id', { email: 'alice@example.com' });
      expect(mockEmailVerify.sendVerification).not.toHaveBeenCalled();
    });

    it('updates marketingConsent', async () => {
      await service.patchMe('user-id', { marketingConsent: true });
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { marketingConsent: true } }),
      );
    });

    it('throws NotFoundException for soft-deleted user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, deletedAt: new Date() });
      await expect(service.patchMe('user-id', { displayName: 'Bob' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
