export type WsEvent =
  | { type: "hello"; serverTime: string }
  | { type: "items:sync"; items: unknown }
  | { type: "items:changed" };

type AuthedSocket = { send: (data: string) => void };

const sockets = new Set<AuthedSocket>();

export const wsRegistry = {
  add(ws: AuthedSocket) {
    sockets.add(ws);
  },
  remove(ws: AuthedSocket) {
    sockets.delete(ws);
  },
  broadcast(event: WsEvent) {
    const payload = JSON.stringify(event);
    for (const ws of sockets) {
      try {
        ws.send(payload);
      } catch {
        sockets.delete(ws);
      }
    }
  }
};
