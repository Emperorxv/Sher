import { Test } from '@nestjs/testing';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  let service: PrismaService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PrismaService],
    }).compile();
    service = module.get(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('calls $connect on onModuleInit', async () => {
    const spy = jest.spyOn(service, '$connect').mockResolvedValueOnce(undefined);
    await service.onModuleInit();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('calls $disconnect on onModuleDestroy', async () => {
    const spy = jest.spyOn(service, '$disconnect').mockResolvedValueOnce(undefined);
    await service.onModuleDestroy();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
