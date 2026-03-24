import { supabase } from "./supabase";
import { wsRegistry } from "./ws";

export const startExpirationSweep = () => {
  let pauseUntil = 0;
  const sweep = async () => {
    if (Date.now() < pauseUntil) return;
    try {
      const now = new Date().toISOString();
      const { data: expired } = await supabase
        .from("payment_items")
        .select("id")
        .eq("status", "ACTIVE")
        .not("expires_at", "is", null)
        .lte("expires_at", now);
      if (!expired || expired.length === 0) return;
      await supabase
        .from("payment_items")
        .update({ status: "INACTIVE", inactivated_at: now, updated_by: "system" })
        .in("id", expired.map((e: { id: string }) => e.id));
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
