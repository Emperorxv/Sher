/**
 * Socket.IO client for real-time room events.
 * Connects to the /rooms namespace only when a room screen is active.
 */
import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type RoomSocketEvents = {
  'member:joined': (data: { roomId: string; userId: string; joinOrder: number }) => void;
  'member:left': (data: { roomId: string; userId: string }) => void;
  'room:ended': (data: { roomId: string }) => void;
  'room:base_unlocked': (data: { roomId: string }) => void;
  'member:unlocked': (data: { roomId: string; userId: string }) => void;
  'room:retention_extended': (data: { roomId: string; retentionUntil: string }) => void;
  'payment:failed': (data: { roomId: string; purpose: string }) => void;
  'photo:new': (data: { photoId: string; thumbUrl: string; uploaderId: string }) => void;
  'photo:deleted': (data: { photoId: string }) => void;
};

let socket: Socket | null = null;
/**
 * The access token used to authenticate the current socket connection.
 * Tracked so that connectRoomSocket can detect a user change (sign-out → sign-in
 * on the same device) and force a reconnect with the new identity.
 */
let currentToken: string | null = null;

/**
 * Connect to the /rooms namespace with the given access token.
 *
 * If a socket already exists that was authenticated with the SAME token, it is
 * returned as-is (idempotent).  If the token has changed (different user signed
 * in), the old socket is disconnected first to prevent the new user from
 * receiving events over a connection still authenticated as the previous user.
 */
export function connectRoomSocket(accessToken: string): Socket {
  if (socket?.connected && currentToken === accessToken) return socket;

  // Token changed or socket is not connected — tear down any existing connection.
  if (socket) {
    socket.disconnect();
    socket = null;
    currentToken = null;
  }

  currentToken = accessToken;
  socket = io(`${BASE_URL}/rooms`, {
    auth: { token: accessToken },
    transports: ['websocket'],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  return socket;
}

/** Disconnect and clean up the socket. Call this when leaving the room section. */
export function disconnectRoomSocket(): void {
  socket?.disconnect();
  socket = null;
  currentToken = null;
}

/** Subscribe to a room channel and return an unsubscribe function. */
export function subscribeToRoom(roomId: string, handlers: Partial<RoomSocketEvents>): () => void {
  if (!socket) return () => undefined;

  socket.emit('room:join', { roomId });

  const {
    'member:joined': onJoined,
    'member:left': onLeft,
    'room:ended': onEnded,
    'room:base_unlocked': onBaseUnlocked,
    'member:unlocked': onMemberUnlocked,
    'room:retention_extended': onRetentionExtended,
    'payment:failed': onPaymentFailed,
    'photo:new': onPhotoNew,
    'photo:deleted': onPhotoDeleted,
  } = handlers;

  if (onJoined) socket.on('member:joined', onJoined);
  if (onLeft) socket.on('member:left', onLeft);
  if (onEnded) socket.on('room:ended', onEnded);
  if (onBaseUnlocked) socket.on('room:base_unlocked', onBaseUnlocked);
  if (onMemberUnlocked) socket.on('member:unlocked', onMemberUnlocked);
  if (onRetentionExtended) socket.on('room:retention_extended', onRetentionExtended);
  if (onPaymentFailed) socket.on('payment:failed', onPaymentFailed);
  if (onPhotoNew) socket.on('photo:new', onPhotoNew);
  if (onPhotoDeleted) socket.on('photo:deleted', onPhotoDeleted);

  return () => {
    socket?.emit('room:leave', { roomId });
    if (onJoined) socket?.off('member:joined', onJoined);
    if (onLeft) socket?.off('member:left', onLeft);
    if (onEnded) socket?.off('room:ended', onEnded);
    if (onBaseUnlocked) socket?.off('room:base_unlocked', onBaseUnlocked);
    if (onMemberUnlocked) socket?.off('member:unlocked', onMemberUnlocked);
    if (onRetentionExtended) socket?.off('room:retention_extended', onRetentionExtended);
    if (onPaymentFailed) socket?.off('payment:failed', onPaymentFailed);
    if (onPhotoNew) socket?.off('photo:new', onPhotoNew);
    if (onPhotoDeleted) socket?.off('photo:deleted', onPhotoDeleted);
  };
}
