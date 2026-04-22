import crypto from "crypto";
import { prisma } from "../utils/prisma.js";

interface WebhookPayload {
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export async function handleIncomingWebhook(
  webhookId: string,
  body: WebhookPayload,
  signature: string,
  rawBody: string,
) {
  const webhook = await prisma.webhook.findUnique({
    where: { id: webhookId },
  });

  if (!webhook || !webhook.active) {
    return null;
  }

  const expected =
    "sha256=" + crypto.createHmac("sha256", webhook.secret).update(rawBody).digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
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
