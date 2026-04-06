import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { parseFrontmatter } from "../../skills/loader.js";
import { guessMimeType, detectMediaType } from "../tool-utils.js";
import type { MessageTransport, ChatAddress } from "../../transport/index.js";

// ---------------------------------------------------------------------------
// Address resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a contact name/number to a ChatAddress using the transport.
 * Falls back to constructing a platform-specific ID for phone numbers.
 */
export function resolveAddress(
  transport: MessageTransport,
  contact: string,
  ownerAddress?: ChatAddress,
): { address: ChatAddress; name: string } {
  // If it already looks like a JID (contains @), pass through to transport
  if (contact.includes("@")) {
    const found = transport.resolveAddress(contact);
    if (found) {
      return { address: found, name: found.displayName || contact };
    }
    // Transport didn't recognize it, but it's JID-shaped — use as-is
    return {
      address: { platform: transport.platform, id: contact },
      name: contact
    };
  }

  // If it looks like a phone number, construct address directly
  const digits = contact.replace(/\D/g, "");
  if (digits.length >= 7) {
    return {
      address: { platform: transport.platform, id: digits },
      name: contact
    };
  }

  // Use transport's resolveAddress for name-based lookup
  const found = transport.resolveAddress(contact);
  if (found) {
    return { address: found, name: found.displayName || contact };
  }

  // Fallback: if contact lookup fails, try resolving as owner.
  // Webhook-triggered turns often don't have a populated contacts map,
  // so "owner", "me", or the owner's display name won't resolve normally.
  if (ownerAddress?.id) {
    return { address: ownerAddress, name: contact };
  }

  throw new Error(`Contact "${contact}" not found`);
}

// ---------------------------------------------------------------------------
// Skill name helpers
// ---------------------------------------------------------------------------

export function normalizeSkillName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function deriveSkillName(url: URL, content: string, preferredName?: string): string {
  const preferred = preferredName ? normalizeSkillName(preferredName) : "";
  if (preferred) return preferred;

  const metadata = parseFrontmatter(content);
  if (metadata?.name) {
    const fromFrontmatter = normalizeSkillName(metadata.name);
    if (fromFrontmatter) return fromFrontmatter;
  }

  const baseName = path.basename(url.pathname).replace(/\.[^.]+$/, "");
  const genericNames = new Set(["skill", "skills", "index"]);
  if (baseName && !genericNames.has(baseName.toLowerCase())) {
    const fromPath = normalizeSkillName(baseName);
    if (fromPath) return fromPath;
  }

  const hostFirstLabel = (url.hostname.split(".")[0] || "").trim();
  const fromHost = normalizeSkillName(hostFirstLabel);
  if (fromHost) return fromHost;

  return "imported-skill";
}

export function ensureSkillFrontmatter(content: string, name: string, sourceUrl: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!frontmatterMatch) {
    return `---\nname: ${name}\ndescription: Imported from ${sourceUrl}\n---\n\n${normalized}\n`;
  }

  let meta: Record<string, unknown> = {};
  try {
    meta = (YAML.parse(frontmatterMatch[1]) as Record<string, unknown>) || {};
  } catch {
    meta = {};
  }

  meta.name = name;
  if (typeof meta.description !== "string" || !meta.description.trim()) {
    meta.description = `Imported from ${sourceUrl}`;
  }

  const body = normalized.slice(frontmatterMatch[0].length).trimStart();
  const serialized = YAML.stringify(meta).trimEnd();
  return `---\n${serialized}\n---\n\n${body}\n`;
}

// send_media
// ---------------------------------------------------------------------------
export const sendMediaTool = createTool({
  id: "send_media",
  description:
    "Send a media file (image, video, audio, document) to a contact. " +
    "Provide either a local file_path or a remote URL — the file will be downloaded if URL is given. " +
    "Media type (image/video/audio/document) is auto-detected from MIME type but can be overridden. " +
    "Use 'owner' to send to the user. Other contacts: name, phone number, or chat ID. " +
    "If contact is not found, falls back to the owner. Errors if owner is not configured.",
  inputSchema: z.object({
    contact: z.string(),
    file_path: z.string().optional(),
    url: z.string().optional(),
    caption: z.string().optional(),
    type: z.enum(["image", "audio", "video", "document"]).optional(),
  }),
  inputExamples: [
    { input: { contact: "owner", file_path: "/tmp/generated-image.png", caption: "Here is your image" } },
    { input: { contact: "owner", url: "https://example.com/video.mp4", type: "video" } },
  ],
  execute: async (input, context) => {
    const transport = context?.requestContext?.get("transport" as never) as unknown as MessageTransport;
    const ownerAddr = context?.requestContext?.get("ownerAddress" as never) as ChatAddress | undefined;
    const { address, name: contactName } = resolveAddress(transport, input.contact, ownerAddr);

    // Get the media source -- file path or URL (download first)
    let filePath: string | undefined;
    let buffer: Buffer | undefined;
    let mimeType: string;

    if (input.file_path) {
      filePath = input.file_path;
      if (!fs.existsSync(filePath)) {
        return `File not found: ${filePath}`;
      }
      mimeType = guessMimeType(filePath);
    } else if (input.url) {
      const url = input.url;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) return `Failed to download: ${res.status}`;
        buffer = Buffer.from(await res.arrayBuffer());
        mimeType = res.headers.get("content-type") || guessMimeType(url);
      } catch (err) {
        return `Download failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      return "Either file_path or url must be provided.";
    }

    // Determine media type
    const mediaType = input.type || detectMediaType(mimeType);
    const caption = input.caption;

    // Use transport's sendMedia method
    await transport.sendMedia(address, {
      type: mediaType,
      mimeType,
      filePath,
      buffer,
      caption,
      filename: filePath ? filePath.split("/").pop() : undefined,
    });

    return `Sent ${mediaType} to ${contactName}${caption ? ` with caption: "${caption}"` : ""}`;
  },
});
