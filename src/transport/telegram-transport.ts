/**
 * Telegram implementation of MessageTransport using grammY.
 */
import { Bot, InputFile, InlineKeyboard } from "grammy";
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import * as fs from "node:fs";
import * as path from "node:path";
import type {
  MessageTransport,
  MessageHandler,
  ConnectionStatusHandler,
} from "./interface.js";
import type {
  ChatAddress,
  IncomingMessage,
  MediaAttachment,
  ConnectionStatus,
} from "./types.js";
import { markdownToTelegramHtml } from "./telegram-format.js";
import { logger } from "../utils/external-logger.js";

export class TelegramTransport implements MessageTransport {
  readonly platform = "telegram" as const;

  private bot: Bot | null = null;
  private botToken: string;
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: ConnectionStatusHandler[] = [];
  private groupDiscoveryHandlers: Array<(groupId: string, groupName: string) => void> = [];
  private contacts: Map<string, string> = new Map(); // chat_id -> display name
  private botInfo: { id: number; username: string } | null = null;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async connect(): Promise<void> {
    this.notifyStatus({ status: "connecting" });

    try {
      this.bot = new Bot(this.botToken);

      // Get bot info
      const me = await this.bot.api.getMe();
      this.botInfo = { id: me.id, username: me.username || "" };

      // Set up message handler
      this.bot.on("message", async (ctx) => {
        const incoming = await this.convertMessage(ctx);
        if (incoming) {
          // Store contact
          const chatId = String(ctx.chat.id);
          const name = this.getDisplayName(ctx);
          this.contacts.set(chatId, name);

          for (const handler of this.messageHandlers) {
            try {
              await handler(incoming);
            } catch (err) {
              console.error("[telegram-transport] message handler error:", err);
              logger.error(`message handler error: ${err instanceof Error ? err.message : String(err)}`, { transport: "telegram" });
            }
          }
        }
      });

      // Handle inline button callbacks
      this.bot.on("callback_query:data", async (ctx) => {
        // Acknowledge immediately — Telegram expires callbacks after ~30s
        await ctx.answerCallbackQuery();

        const callbackData = ctx.callbackQuery.data;
        const chatId = String(ctx.chat?.id || ctx.from.id);
        const displayName = ctx.from.first_name || String(ctx.from.id);

        const incoming: IncomingMessage = {
          id: String(ctx.callbackQuery.id),
          from: { platform: "telegram", id: chatId, displayName },
          sender: { platform: "telegram", id: String(ctx.from.id), displayName },
          text: `[Button: ${callbackData}]`,
          timestamp: Date.now(),
          fromMe: false,
          raw: ctx.callbackQuery,
        };

        for (const handler of this.messageHandlers) {
          try {
            await handler(incoming);
          } catch (err) {
            console.error("[telegram-transport] callback handler error:", err);
            logger.error(`callback handler error: ${err instanceof Error ? err.message : String(err)}`, { transport: "telegram" });
          }
        }
      });

      // Detect groups this bot was added to
      this.bot.on("my_chat_member", (ctx) => {
        const chat = ctx.myChatMember.chat;
        const newStatus = ctx.myChatMember.new_chat_member.status;
        if ((chat.type === "group" || chat.type === "supergroup") && (newStatus === "member" || newStatus === "administrator")) {
          const groupId = String(chat.id);
          const groupName = chat.title || groupId;
          console.log(`[telegram] bot added to group: ${groupName} (${groupId})`);
          logger.info(`Bot added to group: ${groupName}`, { transport: "telegram", groupId, groupName });
          for (const handler of this.groupDiscoveryHandlers) {
            handler(groupId, groupName);
          }
        }
      });

      // Catch polling/middleware errors to prevent process crash
      this.bot.catch((err) => {
        console.error("[telegram] bot error:", err);
        logger.error(`bot polling/middleware error: ${err instanceof Error ? err.message : String(err)}`, { transport: "telegram" });
      });

      // Start long-polling
      this.bot.start({
        onStart: () => {
          console.log(`[telegram] bot @${this.botInfo?.username} started`);
          logger.info(`bot @${this.botInfo?.username} connected`, { transport: "telegram" });
          this.notifyStatus({ status: "connected" });
        },
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`telegram connect failed: ${error.message}`, { transport: "telegram" });
      this.notifyStatus({ status: "error", error });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
      logger.info("telegram bot disconnected", { transport: "telegram" });
      this.notifyStatus({ status: "disconnected" });
    }
  }

  async sendText(to: ChatAddress, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    const chunks = this.splitText(text);
    for (const chunk of chunks) {
      await this.sendHtml(to.id, chunk);
    }
  }

  async sendMedia(to: ChatAddress, media: MediaAttachment): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");

    const chatId = to.id;
    const source = media.filePath
      ? new InputFile(media.filePath)
      : media.buffer
        ? new InputFile(media.buffer, media.filename)
        : null;

    if (!source) throw new Error("No media source provided");

    switch (media.type) {
      case "image":
        await this.bot.api.sendPhoto(chatId, source, { caption: media.caption });
        break;
      case "audio":
        await this.bot.api.sendAudio(chatId, source, { caption: media.caption });
        break;
      case "video":
        await this.bot.api.sendVideo(chatId, source, { caption: media.caption });
        break;
      case "document":
      default:
        await this.bot.api.sendDocument(chatId, source, {
          caption: media.caption,
        });
        break;
    }
  }

  async sendTextWithButtons(
    to: ChatAddress,
    text: string,
    buttons: Array<{ label: string; callbackData: string }>,
  ): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    const keyboard = new InlineKeyboard();
    for (const btn of buttons) {
      keyboard.text(btn.label, btn.callbackData).row();
    }
    const html = markdownToTelegramHtml(text);
    try {
      await this.bot.api.sendMessage(to.id, html, { parse_mode: "HTML", reply_markup: keyboard });
    } catch {
      await this.bot.api.sendMessage(to.id, text, { reply_markup: keyboard });
    }
  }

  async react(to: ChatAddress, messageId: number, emoji: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    await this.bot.api.setMessageReaction(to.id, messageId, [
      { type: "emoji", emoji: emoji as never },
    ]);
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /** Register a handler for group discovery events (bot added to a group). */
  onGroupDiscovery(handler: (groupId: string, groupName: string) => void): void {
    this.groupDiscoveryHandlers.push(handler);
  }

  onConnectionStatus(handler: ConnectionStatusHandler): void {
    this.statusHandlers.push(handler);
  }

  resolveAddress(query: string): ChatAddress | null {
    // If it's a numeric ID, use directly
    if (/^-?\d+$/.test(query)) {
      const name = this.contacts.get(query);
      return { platform: "telegram", id: query, displayName: name };
    }

    // Search contacts by name
    const queryLower = query.toLowerCase();
    for (const [chatId, name] of this.contacts) {
      if (name.toLowerCase().includes(queryLower)) {
        return { platform: "telegram", id: chatId, displayName: name };
      }
    }

    return null;
  }

  getContacts(): Map<string, string> {
    return new Map(this.contacts);
  }

  async sendTextReturningId(to: ChatAddress, text: string): Promise<number> {
    if (!this.bot) throw new Error("Telegram not connected");
    const html = markdownToTelegramHtml(text);
    try {
      const msg = await this.bot.api.sendMessage(to.id, html, { parse_mode: "HTML" });
      return msg.message_id;
    } catch {
      const msg = await this.bot.api.sendMessage(to.id, text);
      return msg.message_id;
    }
  }

  async editMessage(to: ChatAddress, messageId: number, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    const html = markdownToTelegramHtml(text);
    try {
      await this.bot.api.editMessageText(to.id, messageId, html, { parse_mode: "HTML" });
    } catch {
      try {
        await this.bot.api.editMessageText(to.id, messageId, text);
      } catch {
        // Edit can fail if content unchanged — swallow silently
      }
    }
  }

  async pinMessage(to: ChatAddress, messageId: number, silent = true): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    await this.bot.api.pinChatMessage(to.id, messageId, { disable_notification: silent });
  }

  async unpinMessage(to: ChatAddress, messageId?: number): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    if (messageId) {
      await this.bot.api.unpinChatMessage(to.id, messageId);
    } else {
      // Unpin the most recent pinned message
      await this.bot.api.unpinChatMessage(to.id);
    }
  }

  async sendTypingIndicator(to: ChatAddress): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.api.sendChatAction(to.id, "typing");
    } catch {
      // Non-critical — swallow silently
    }
  }

  /**
   * Get the bot's user ID for owner verification.
   */
  get botId(): number | null {
    return this.botInfo?.id ?? null;
  }

  get botUsername(): string | null {
    return this.botInfo?.username ?? null;
  }

  private notifyStatus(status: ConnectionStatus): void {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }

  private getDisplayName(ctx: Context): string {
    const from = ctx.from;
    if (!from) return "Unknown";

    if (from.first_name && from.last_name) {
      return `${from.first_name} ${from.last_name}`;
    }
    if (from.first_name) return from.first_name;
    if (from.username) return `@${from.username}`;
    return String(from.id);
  }

  private async convertMessage(ctx: Context): Promise<IncomingMessage | null> {
    const msg = ctx.message;
    if (!msg) return null;

    const chat = ctx.chat;
    if (!chat) return null;

    const chatId = String(chat.id);
    const displayName = this.getDisplayName(ctx);
    const fromMe = msg.from?.id === this.botInfo?.id;

    const senderId = msg.from?.id != null ? String(msg.from.id) : chatId;
    const senderDisplayName = this.getDisplayName(ctx);

    // Extract text
    const text = msg.text || msg.caption || "";

    // Handle media
    let media: MediaAttachment | undefined;
    const hasMedia = msg.photo || msg.audio || msg.video || msg.document || msg.voice || msg.video_note;

    if (hasMedia && this.bot) {
      try {
        media = await this.downloadMedia(msg);
      } catch (err) {
        console.error("[telegram-transport] media download failed:", err);
        logger.error(`media download failed: ${err instanceof Error ? err.message : String(err)}`, { transport: "telegram" });
      }
    }

    // Extract @mentions from entities + text regex fallback
    const mentions: string[] = [];
    for (const entity of [...(msg.entities || []), ...(msg.caption_entities || [])]) {
      if (entity.type === "mention" && text) {
        const mention = text.slice(entity.offset + 1, entity.offset + entity.length); // strip @
        mentions.push(mention.toLowerCase());
      }
    }
    // Fallback: regex for @username in text (catches bot-sent HTML messages without entities)
    if (mentions.length === 0 && text) {
      const regex = /@([a-zA-Z0-9_]{5,})/g;
      let match;
      while ((match = regex.exec(text)) !== null) {
        const username = match[1].toLowerCase();
        if (!mentions.includes(username)) mentions.push(username);
      }
    }

    return {
      id: String(msg.message_id),
      from: { platform: "telegram", id: chatId, displayName },
      sender: { platform: "telegram", id: senderId, displayName: senderDisplayName },
      text,
      media,
      timestamp: msg.date * 1000,
      fromMe,
      raw: msg,
      senderIsBot: msg.from?.is_bot ?? false,
      mentions,
    };
  }

  private async downloadMedia(msg: Message): Promise<MediaAttachment | undefined> {
    if (!this.bot) return undefined;

    let fileId: string | undefined;
    let mimeType = "application/octet-stream";
    let type: MediaAttachment["type"] = "document";
    let filename: string | undefined;

    if (msg.photo) {
      // Telegram pre-generates several thumbnail sizes (typically 90/320/800/1280 + original).
      // Pick the largest size with long edge ≤ 1280px: vision models downscale to this
      // resolution anyway, so we get equivalent quality at ~50–150KB instead of multi-MB.
      // Falls back to the smallest available if every size exceeds the cap (rare —
      // only for very-wide-aspect images where Telegram skipped intermediate sizes).
      //
      // Why this matters: Mastra's TokenLimiterProcessor counts file parts via
      // JSON.stringify(part), which charges the full base64 length to the token budget.
      // A 197KB image base64-encodes to ~180K tokens, exceeding the 170K limit and
      // causing the user message to be silently dropped before reaching the LLM.
      const MAX_EDGE = 1280;
      const photo =
        msg.photo
          .filter((p) => Math.max(p.width, p.height) <= MAX_EDGE)
          .at(-1) ?? msg.photo[0];
      fileId = photo.file_id;
      mimeType = "image/jpeg";
      type = "image";
    } else if (msg.audio) {
      fileId = msg.audio.file_id;
      mimeType = msg.audio.mime_type || "audio/mpeg";
      type = "audio";
      filename = msg.audio.file_name;
    } else if (msg.voice) {
      fileId = msg.voice.file_id;
      mimeType = msg.voice.mime_type || "audio/ogg";
      type = "audio";
      filename = "voice_message.ogg";
    } else if (msg.video_note) {
      fileId = msg.video_note.file_id;
      mimeType = (msg.video_note as unknown as Record<string, unknown>).mime_type as string || "video/mp4";
      type = "audio"; // Treat video notes as audio for transcription
      filename = "video_note.mp4";
    } else if (msg.video) {
      fileId = msg.video.file_id;
      mimeType = msg.video.mime_type || "video/mp4";
      type = "video";
      filename = msg.video.file_name;
    } else if (msg.document) {
      fileId = msg.document.file_id;
      mimeType = msg.document.mime_type || "application/octet-stream";
      type = "document";
      filename = msg.document.file_name;
    }

    if (!fileId) return undefined;

    // Get file path from Telegram
    const file = await this.bot.api.getFile(fileId);
    if (!file.file_path) return undefined;

    // Download file
    const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Save to data/media directory
    const ext = path.extname(file.file_path) || this.getExtension(mimeType);
    const savedFilename = `telegram_${Date.now()}${ext}`;
    const filePath = path.join("data", "media", savedFilename);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, buffer);

    return {
      type,
      mimeType,
      filePath,
      filename,
      caption: msg.caption,
    };
  }

  /** Convert markdown to HTML and send; fall back to plain text on error. */
  private async sendHtml(chatId: string, text: string): Promise<void> {
    if (!this.bot) throw new Error("Telegram not connected");
    const html = markdownToTelegramHtml(text);
    try {
      await this.bot.api.sendMessage(chatId, html, { parse_mode: "HTML" });
    } catch {
      await this.bot.api.sendMessage(chatId, text);
    }
  }

  /**
   * Split text into chunks at newline boundaries.
   * Uses 3800 instead of 4096 to leave headroom for HTML tag expansion
   * when markdown is converted (e.g. **bold** → <b>bold</b>).
   * If the converted HTML still exceeds 4096, sendHtml falls back to plain text.
   */
  private splitText(text: string): string[] {
    const MAX_LEN = 3800;
    if (text.length <= MAX_LEN) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LEN) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf("\n", MAX_LEN);
      if (splitAt <= 0) splitAt = MAX_LEN;
      chunks.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).replace(/^\n/, "");
    }
    return chunks;
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "audio/mpeg": ".mp3",
      "audio/ogg": ".ogg",
      "video/mp4": ".mp4",
      "application/pdf": ".pdf",
    };
    return map[mimeType] || "";
  }
}
