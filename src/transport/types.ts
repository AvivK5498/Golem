/**
 * Platform-neutral types for the messaging transport layer.
 */

/**
 * Supported messaging platforms.
 *
 * To add a new platform:
 * 1. Add the platform string to this union type
 * 2. Create a new transport class implementing MessageTransport in src/transport/
 * 3. Register it in src/transport/factory.ts createTransports()
 * 4. Add platform-specific owner matching in src/agent/filter.ts classifyChat()
 * 5. Add platform config section in src/config.ts ConfigSchema
 */
export type Platform = "telegram";

/**
 * Universal address for a chat/conversation.
 * Abstracts platform-specific chat identifiers.
 */
export interface ChatAddress {
  platform: Platform;
  id: string; // Telegram chat_id (as string)
  displayName?: string;
  threadId?: string;
}

/**
 * Media attachment for incoming/outgoing messages.
 */
export interface MediaAttachment {
  type: "image" | "audio" | "video" | "document";
  mimeType: string;
  /** For incoming: downloaded file path. For outgoing: source path or URL. */
  filePath?: string;
  /** For incoming: raw buffer if not saved to file */
  buffer?: Buffer;
  /** Original filename if available */
  filename?: string;
  /** Caption/text accompanying the media */
  caption?: string;
}

/**
 * Incoming message from any platform.
 */
export interface IncomingMessage {
  /** Unique message ID (platform-specific format) */
  id: string;
  /** Where the message came from */
  from: ChatAddress;
  /**
   * Optional sender identity within the chat (e.g. group participant).
   * For direct chats this may equal `from`.
   */
  sender?: ChatAddress;
  /** Text content (may be empty for media-only) */
  text: string;
  /** Optional media attachment */
  media?: MediaAttachment;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Whether this is from the bot itself */
  fromMe: boolean;
  /** Raw platform-specific message object for advanced use */
  raw?: unknown;
  /** Whether the sender is a bot */
  senderIsBot?: boolean;
  /** Bot usernames @mentioned in this message */
  mentions?: string[];
}

/**
 * Connection status events.
 */
export type ConnectionStatus =
  | { status: "connecting" }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "qr"; qrCode: string }
  | { status: "error"; error: Error };
