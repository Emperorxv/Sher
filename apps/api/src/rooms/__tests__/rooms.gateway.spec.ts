/**
 * RoomsGateway unit tests.
 *
 * KEY REGRESSION: when @WebSocketGateway is configured with a namespace,
 * afterInit() receives a Namespace object — NOT the root Server.
 * Only Server has adapter(); calling it on a Namespace throws at runtime.
 * The test "attaches adapter to nsp.server NOT nsp" directly guards this.
 *
 * Why app.boot.spec.ts does NOT catch gateway init failures:
 *   RoomsGateway.afterInit has a `NODE_ENV === 'test'` early return to avoid
 *   open Redis handles in Jest workers.  The boot spec runs with NODE_ENV=test,
 *   so afterInit exits before any adapter call — the crash is never exercised.
 *   This file fills that gap by temporarily unsetting NODE_ENV in the tests
 *   that exercise the production path.
 */

// ── Hoisted module mocks ────────────────────────────────────────────────────
// jest.mock calls are hoisted before imports by Babel/ts-jest; they MUST come
// first so the modules are replaced before any import resolves them.

jest.mock('ioredis', () => {
  const subClient = { quit: jest.fn().mockResolvedValue('OK') };
  const pubClient = {
    duplicate: jest.fn().mockReturnValue(subClient),
    quit: jest.fn().mockResolvedValue('OK'),
  };
  return { default: jest.fn().mockReturnValue(pubClient), __esModule: true };
});

jest.mock('@socket.io/redis-adapter', () => ({
  createAdapter: jest.fn().mockReturnValue(jest.fn()),
  __esModule: true,
}));

// ── Imports ─────────────────────────────────────────────────────────────────

import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket, Namespace } from 'socket.io';
import Redis from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { RoomsGateway } from '../rooms.gateway';

const MockRedis = Redis as jest.MockedClass<typeof Redis>;
const mockCreateAdapter = createAdapter as jest.MockedFunction<typeof createAdapter>;

// ── Local types ──────────────────────────────────────────────────────────────

type MockNsp = {
  adapter?: jest.Mock;
  server: { adapter: jest.Mock };
};

type MockPubClient = {
  duplicate: jest.Mock;
  quit: jest.Mock;
};

/** Socket with the userId property that handleConnection attaches after JWT verify. */
type ConnectedSocket = Socket & { userId?: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockNsp(withDirectAdapter = false): MockNsp {
  return {
    // Namespace does NOT have adapter() in real Socket.IO; we add it only in
    // the regression test to prove our code avoids calling it.
    ...(withDirectAdapter ? { adapter: jest.fn() } : {}),
    server: { adapter: jest.fn() },
  };
}

function makeClient(token?: string): ConnectedSocket {
  return {
    handshake: { auth: token !== undefined ? { token } : {} },
    disconnect: jest.fn(),
  } as unknown as ConnectedSocket;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe('RoomsGateway', () => {
  let gateway: RoomsGateway;
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsGateway,
        {
          provide: JwtService,
          useValue: { verify: jest.fn() },
        },
      ],
    }).compile();

    gateway = module.get(RoomsGateway);
    jwtService = module.get(JwtService) as unknown as typeof jwtService;
  });

  // ── afterInit ──────────────────────────────────────────────────────────────

  describe('afterInit', () => {
    it('returns early in test environment — no Redis clients created', async () => {
      // NODE_ENV is 'test' in Jest by default
      const nsp = makeMockNsp();
      await gateway.afterInit(nsp as unknown as Namespace);

      expect(MockRedis).not.toHaveBeenCalled();
      expect(nsp.server.adapter).not.toHaveBeenCalled();
    });

    /**
     * REGRESSION TEST — this is the exact failure that caused the boot crash.
     *
     * In Socket.IO v4, @WebSocketGateway({ namespace: '/rooms' }) causes
     * afterInit to receive a Namespace, not the root Server.
     * Namespace has no adapter() method.  The fix: call nsp.server.adapter().
     *
     * If this guard is regressed (calling nsp.adapter instead of
     * nsp.server.adapter), nspAdapterSpy will be called and rootAdapterSpy
     * will not — the expect() assertions below will fail.
     */
    it('attaches Redis adapter to nsp.server (root Server) — NOT to nsp directly', async () => {
      const savedEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      try {
        const nsp = makeMockNsp(/* withDirectAdapter */ true);
        await gateway.afterInit(nsp as unknown as Namespace);

        // Must NOT call nsp.adapter() — Namespace has no such method at runtime
        expect(nsp.adapter).not.toHaveBeenCalled();
        // MUST call nsp.server.adapter() — root Server owns the method
        expect(nsp.server.adapter).toHaveBeenCalledTimes(1);
        // The argument must be the adapter factory produced by createAdapter()
        expect(mockCreateAdapter).toHaveBeenCalledTimes(1);
      } finally {
        process.env['NODE_ENV'] = savedEnv;
      }
    });

    it('creates one pub Redis client and one sub client via duplicate()', async () => {
      const savedEnv = process.env['NODE_ENV'];
      process.env['NODE_ENV'] = 'production';
      try {
        const nsp = makeMockNsp();
        await gateway.afterInit(nsp as unknown as Namespace);

        expect(MockRedis).toHaveBeenCalledTimes(1);
        const pubInstance = MockRedis.mock.results[0]?.value as MockPubClient;
        expect(pubInstance.duplicate).toHaveBeenCalledTimes(1);
      } finally {
        process.env['NODE_ENV'] = savedEnv;
      }
    });
  });

  // ── room:join / room:leave ─────────────────────────────────────────────────

  describe('handleRoomJoin', () => {
    it('adds the socket to room:{roomId}', () => {
      const client = { join: jest.fn() } as unknown as Socket;
      gateway.handleRoomJoin(client, { roomId: 'r1' });
      expect(client.join).toHaveBeenCalledWith('room:r1');
    });
  });

  describe('handleRoomLeave', () => {
    it('removes the socket from room:{roomId}', () => {
      const client = { leave: jest.fn() } as unknown as Socket;
      gateway.handleRoomLeave(client, { roomId: 'r2' });
      expect(client.leave).toHaveBeenCalledWith('room:r2');
    });
  });

  // ── handleConnection ───────────────────────────────────────────────────────

  describe('handleConnection', () => {
    it('disconnects a client that sends no auth token', () => {
      const client = makeClient();
      gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });

    it('assigns userId and does not disconnect on valid JWT', () => {
      (jwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-abc' });
      const client = makeClient('valid-jwt');
      gateway.handleConnection(client);
      expect(client.userId).toBe('user-abc');
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects a client whose JWT verification throws', () => {
      (jwtService.verify as jest.Mock).mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const client = makeClient('bad-jwt');
      gateway.handleConnection(client);
      expect(client.disconnect).toHaveBeenCalled();
    });
  });

  // ── emit helpers ───────────────────────────────────────────────────────────

  describe('emit helpers', () => {
    function makeServer(): { mockServer: Server; emit: jest.Mock; to: jest.Mock } {
      const emit = jest.fn();
      const to = jest.fn().mockReturnValue({ emit });
      return { mockServer: { to } as unknown as Server, emit, to };
    }

    it('emitMemberJoined targets room:{roomId} with correct payload', () => {
      const { mockServer, emit, to } = makeServer();
      gateway.server = mockServer;

      gateway.emitMemberJoined('r1', { userId: 'u1', displayName: 'Alice', joinOrder: 2 });

      expect(to).toHaveBeenCalledWith('room:r1');
      expect(emit).toHaveBeenCalledWith('member:joined', {
        userId: 'u1',
        displayName: 'Alice',
        joinOrder: 2,
      });
    });

    it('emitMemberLeft targets room:{roomId}', () => {
      const { mockServer, emit, to } = makeServer();
      gateway.server = mockServer;

      gateway.emitMemberLeft('r2', { userId: 'u2' });

      expect(to).toHaveBeenCalledWith('room:r2');
      expect(emit).toHaveBeenCalledWith('member:left', { userId: 'u2' });
    });

    it('emitRoomEnded emits roomId in payload', () => {
      const { mockServer, emit, to } = makeServer();
      gateway.server = mockServer;

      gateway.emitRoomEnded('r3');

      expect(to).toHaveBeenCalledWith('room:r3');
      expect(emit).toHaveBeenCalledWith('room:ended', { roomId: 'r3' });
    });
  });
});
