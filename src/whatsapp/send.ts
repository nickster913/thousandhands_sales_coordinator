import { GraphError, graphRequest } from "../meta/graph";
import { digits } from "../lib/phone";
import { getAccount, getBusinessToken } from "./account";

const MAX_BODY = 4096;

export type SendTextResult = {
  wamid: string;
  to: string;
  body: string;
};

/**
 * POST /{phone_number_id}/messages — session text (customer messaged us within 24h).
 * `replyToWamid` threads the bubble under the inbound message when Meta still has it.
 */
export async function sendTextMessage(input: {
  to: string;
  body: string;
  replyToWamid?: string;
}): Promise<SendTextResult> {
  const to = digits(input.to);
  const body = input.body.trim().slice(0, MAX_BODY);
  if (!to) throw new GraphError("sendTextMessage: missing recipient", 0);
  if (!body) throw new GraphError("sendTextMessage: empty body", 0);

  const account = await getAccount();
  if (account.status !== "connected" || !account.phoneNumberId) {
    throw new GraphError("sendTextMessage: WhatsApp is not connected", 0);
  }
  const token = getBusinessToken(account);

  const data = await graphRequest<{ messages?: { id?: string }[] }>({
    op: "send_text",
    method: "POST",
    path: `/${encodeURIComponent(account.phoneNumberId)}/messages`,
    token,
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body },
      ...(input.replyToWamid ? { context: { message_id: input.replyToWamid } } : {}),
    },
  });

  const wamid = data.messages?.[0]?.id;
  if (!wamid) throw new GraphError("Graph send_text: no message id in response", 200);
  return { wamid, to, body };
}
