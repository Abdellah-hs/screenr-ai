import { google } from "googleapis";

const SUPPORTED_RESUME_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function isSupportedResumeMimeType(mimeType: string): boolean {
  return SUPPORTED_RESUME_MIME_TYPES.has(mimeType);
}

/**
 * Validates or initializes a simple Google OAuth2 client.
 * Note: For local testing, you need GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in .env.local
 */
export function getGmailClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing Google API credentials in .env.local: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN"
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "https://developers.google.com/oauthplayground"
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export async function fetchUnreadGmailResumes(maxResults: number = 5) {
  const gmail = getGmailClient();
  const res = await gmail.users.messages.list({
    userId: "me",
    q: "is:unread has:attachment (filename:pdf OR filename:docx)",
    maxResults,
  });

  return res.data.messages || [];
}

export async function getGmailMessage(messageId: string) {
  const gmail = getGmailClient();
  const msgData = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
  });
  return msgData.data;
}

export async function getGmailAttachmentBuffer(messageId: string, attachmentId: string) {
  const gmail = getGmailClient();
  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  if (!attachment.data.data) return null;
  return Buffer.from(attachment.data.data, "base64");
}

export async function markGmailMessageAsRead(messageId: string) {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}
