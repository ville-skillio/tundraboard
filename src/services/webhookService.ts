import { prisma } from "../utils/prisma.js";

interface WebhookPayload {
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// BUG #8 (PLANTED): Webhook endpoint accepts ANY incoming POST without
// verifying the payload signature — no HMAC verification
export async function handleIncomingWebhook(
  webhookId: string,
  body: WebhookPayload,
) {
  // Should verify X-TundraBoard-Signature header against webhook secret
  // using HMAC-SHA256, but this check is completely missing

  const webhook = await prisma.webhook.findUnique({
    where: { id: webhookId },
  });

  if (!webhook || !webhook.active) {
    return null;
  }

  // Process the webhook payload
  return { received: true, event: body.event };
}

export async function deliverWebhook(
  workspaceId: string,
  event: string,
  payload: Record<string, unknown>,
) {
  const webhooks = await prisma.webhook.findMany({
    where: {
      workspaceId,
      active: true,
    },
  });

  for (const webhook of webhooks) {
    if (webhook.events.includes(event)) {
      const body = JSON.stringify({
        event,
        payload,
        timestamp: new Date().toISOString(),
      });

      try {
        await fetch(webhook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } catch {
        // Silently fail — no retry logic
      }
    }
  }
}
