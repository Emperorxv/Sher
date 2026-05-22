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
};

let socket: Socket | null = null;

/** Connect to the /rooms namespace with the given access token. */
export function connectRoomSocket(accessToken: string): Socket {
  if (socket?.connected) return socket;

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
}

/** Subscribe to a room channel and return an unsubscribe function. */
export function subscribeToRoom(roomId: string, handlers: Partial<RoomSocketEvents>): () => void {
  if (!socket) return () => undefined;

  socket.emit('room:join', { roomId });

  const { 'member:joined': onJoined, 'member:left': onLeft, 'room:ended': onEnded } = handlers;

  if (onJoined) socket.on('member:joined', onJoined);
  if (onLeft) socket.on('member:left', onLeft);
  if (onEnded) socket.on('room:ended', onEnded);

  return () => {
    socket?.emit('room:leave', { roomId });
    if (onJoined) socket?.off('member:joined', onJoined);
    if (onLeft) socket?.off('member:left', onLeft);
    if (onEnded) socket?.off('room:ended', onEnded);
  };
}
