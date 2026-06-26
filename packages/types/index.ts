// Tipos compartilhados entre Edge Functions e web app

export type TenantPlan = "personal" | "business" | "enterprise";
export type OperatorRole = "admin" | "operator" | "viewer";
export type SessionStatus = "connected" | "disconnected" | "connecting" | "banned";
export type MessageType = "text" | "image" | "audio" | "video" | "document" | "sticker" | "reaction" | "unknown";
export type DeliveryStatus = "pending" | "sent" | "delivered" | "read" | "played" | "error";
export type MediaDownloadStatus = "pending" | "done" | "failed";
export type IntegrationType = "monday" | "hubspot" | "activecamp" | "webhook" | "hermes";
export type EventType =
  | "webhook_received"
  | "media_downloaded"
  | "session_status_changed"
  | "qrcode_updated"
  | "webhook_delivery"
  | "health_check_ran"
  | "names_synced"
  | "chats_merged"
  | "error";

// Payload enviado da whatsapp-webhook para a media-downloader
export interface MediaDownloadRequest {
  messageId: string;
  tenantId: string;
  sessionId: string;
  downloadUrl: string;
  mimeType: string;
}
