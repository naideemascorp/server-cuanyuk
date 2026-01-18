import { prisma } from "./prisma";
import { wsRegistry } from "./ws";

export const startExpirationSweep = () => {
  let pauseUntil = 0;
  const sweep = async () => {
    if (Date.now() < pauseUntil) return;
    try {
      const now = new Date();
      const expired = await prisma.paymentItem.findMany({
        where: {
          status: "ACTIVE",
          expires_at: { not: null, lte: now }
        },
        select: { id: true }
      });
      if (expired.length === 0) return;
      await prisma.paymentItem.updateMany({
        where: { id: { in: expired.map((e: { id: string }) => e.id) } },
        data: { status: "INACTIVE", inactivated_at: now, updated_by: "system" }
      });
      wsRegistry.broadcast({ type: "items:changed" });
    } catch {
      pauseUntil = Date.now() + 60_000;
    }
  };

  setInterval(() => {
    void sweep();
  }, 5_000);

  void sweep();
};
