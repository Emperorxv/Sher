import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket, Namespace } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { JwtService } from '@nestjs/jwt';

export interface MemberJoinedPayload {
  userId: string;
  displayName: string | null;
  joinOrder: number;
}

export interface MemberLeftPayload {
  userId: string;
}

/**
 * Socket.IO gateway for the /rooms namespace.
 *
 * Auth: clients send JWT in socket.handshake.auth.token.
 * Rooms: each DB room maps to a Socket.IO room named `room:{roomId}`.
 *
 * Events emitted to the room:
 *   member:joined  — when a new member joins
 *   member:left    — when a member is removed
 *   room:ended     — when the host ends the room
 */
@WebSocketGateway({ namespace: '/rooms', cors: { origin: '*' } })
export class RoomsGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit<Namespace>, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RoomsGateway.name);
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(private readonly jwt: JwtService) {}

  /**
   * Called by NestJS after the Socket.IO server is created and ready.
   * Wire up the Redis pub/sub adapter here so multiple API pods can broadcast.
   * Skipped in test environment to avoid open handles in Jest workers.
   *
   * IMPORTANT: when @WebSocketGateway is configured with a namespace, NestJS
   * passes the Namespace object here — NOT the root Server.  Namespace has no
   * adapter() method; we must reach the root Server via `nsp.server`.
   */
  async afterInit(nsp: Namespace) {
    if (process.env['NODE_ENV'] === 'test') return;

    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    this.pubClient = new Redis(redisUrl);
    this.subClient = this.pubClient.duplicate();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis satisfies the redis adapter interface at runtime
    nsp.server.adapter(createAdapter(this.pubClient as any, this.subClient as any));
    this.logger.log('Socket.IO Redis adapter attached');
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.pubClient?.quit(), this.subClient?.quit()]);
  }

  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwt.verify<{ sub: string }>(token);
      // Attach userId to the socket for later use
      (client as Socket & { userId: string }).userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // ── Emit helpers (called by RoomsService) ────────────────────────────────

  emitMemberJoined(roomId: string, payload: MemberJoinedPayload) {
    this.server.to(`room:${roomId}`).emit('member:joined', payload);
  }

  emitMemberLeft(roomId: string, payload: MemberLeftPayload) {
    this.server.to(`room:${roomId}`).emit('member:left', payload);
  }

  emitRoomEnded(roomId: string) {
    this.server.to(`room:${roomId}`).emit('room:ended', { roomId });
  }
}
