/**
 * MessageTransport interface - the abstraction layer for messaging platforms.
 * Implementations: TelegramTransport
 */
import type {
  Platform,
  ChatAddress,
  IncomingMessage,
  MediaAttachment,
  ConnectionStatus,
} from "./types.js";

/**
 * Handler for incoming messages.
 */
export type MessageHandler = (message: IncomingMessage) => void | Promise<void>;

/**
 * Handler for connection status changes.
 */
export type ConnectionStatusHandler = (status: ConnectionStatus) => void;

/**
 * The core transport interface that all messaging platforms implement.
 */
export interface MessageTransport {
  /** Platform identifier */
  readonly platform: Platform;

  /**
   * Connect to the messaging platform.
   * For Telegram: starts grammY bot with long-polling.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the platform gracefully.
   */
  disconnect(): Promise<void>;

  /**
   * Send a text message.
   */
  sendText(to: ChatAddress, text: string): Promise<void>;

  /**
   * Send a text message with platform-native buttons if supported.
   * Optional — used for approval flows and other interactive prompts.
   */
  sendTextWithButtons?(
    to: ChatAddress,
    text: string,
    buttons: Array<{ label: string; callbackData: string }>,
  ): Promise<void>;

  /**
   * Send media (image, audio, video, document).
   */
  sendMedia(to: ChatAddress, media: MediaAttachment): Promise<void>;

  /**
   * Register a handler for incoming messages.
   * Multiple handlers can be registered.
   */
  onMessage(handler: MessageHandler): void;

  /**
   * Register a handler for connection status changes.
   */
  onConnectionStatus(handler: ConnectionStatusHandler): void;

  /**
   * Resolve a contact query to an address.
   * @param query - Name or ID to search for
   * @returns ChatAddress if found, null otherwise
   */
  resolveAddress(query: string): ChatAddress | null;

  /**
   * Get known contacts.
   * @returns Map of id -> display name
   */
  getContacts(): Map<string, string>;

  /**
   * Send a typing/composing indicator to the chat.
   * Optional — platforms that don't support it can omit.
   * Non-critical: failures should be swallowed silently.
   */
  sendTypingIndicator?(to: ChatAddress): Promise<void>;

  /**
   * Send a text message and return the platform message ID.
   * Optional — used for message editing workflows (e.g., live progress).
   */
  sendTextReturningId?(to: ChatAddress, text: string): Promise<number>;

  /**
   * Edit an existing message by its platform message ID.
   */
  editMessage?(to: ChatAddress, messageId: number, text: string): Promise<void>;

  /**
   * Pin a message in the chat.
   * @param silent - If true, don't send a notification about the pin.
   */
  pinMessage?(to: ChatAddress, messageId: number, silent?: boolean): Promise<void>;

  /**
   * Unpin a message in the chat.
   */
  unpinMessage?(to: ChatAddress, messageId: number): Promise<void>;
}
