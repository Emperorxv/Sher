import { Test } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    controller = module.get(AppController);
  });

  it('GET /health returns { status: "ok" }', () => {
    expect(controller.health()).toEqual({ status: 'ok' });
  });
});
