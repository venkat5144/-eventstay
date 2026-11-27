import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Keep EventStay's existing Express/JWT authentication for now.
  // Managed Better Auth requires a deliberate migration of the current auth routes.
  aiGateway: true,
  buckets: {
    "eventstay-guest-photos": {
      access: "private",
    },
  },
});
