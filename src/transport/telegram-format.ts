/**
 * Converts Markdown (as typically produced by Claude) to Telegram-compatible HTML.
 *
 * Strategy:
 * 1. Extract code blocks and inline code first (protect from other transforms).
 * 2. Escape HTML entities in remaining text.
 * 3. Apply markdown→HTML conversions (bold, italic, strikethrough, links, blockquotes).
 * 4. Restore code blocks/inline code with their contents HTML-escaped inside tags.
 */

/** Escape the three HTML-sensitive characters. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert Markdown text to Telegram HTML.
 * Returns the converted string. Safe for plain text input (just escapes HTML entities).
 */
export function markdownToTelegramHtml(md: string): string {
  // Placeholders for protected regions
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];

  let text = md;

  // 1. Extract fenced code blocks: ```lang\n...\n```
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang: string, code: string) => {
    const escaped = escapeHtml(code.replace(/\n$/, "")); // trim trailing newline inside block
    const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : "";
    const placeholder = `\x00CB${codeBlocks.length}\x00`;
    codeBlocks.push(`<pre><code${langAttr}>${escaped}</code></pre>`);
    return placeholder;
  });

  // 2. Extract inline code: `code`
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const placeholder = `\x00IC${inlineCodes.length}\x00`;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // 3. Escape HTML entities in the remaining text
  text = escapeHtml(text);

  // 4. Bold: **text** (must come before italic)
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // 5. Italic: *text* (single asterisk, not inside bold)
  text = text.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // 6. Italic: _text_ (underscore variant, word-boundary aware)
  text = text.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<i>$1</i>");

  // 7. Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 8. Links: [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // 9. Headers: # heading → bold (Telegram has no header tags)
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_match, _hashes: string, title: string) => {
    return `<b>${title}</b>`;
  });

  // 10. Blockquotes: lines starting with "> "
  // Collapse consecutive blockquote lines into a single <blockquote>
  text = text.replace(/(?:^|\n)(?:&gt; (.+?)(?:\n|$))+/g, (match) => {
    const lines = match
      .trim()
      .split("\n")
      .map((line) => line.replace(/^&gt; ?/, ""));
    return `\n<blockquote>${lines.join("\n")}</blockquote>\n`;
  });

  // 11. Restore inline codes
  for (let i = 0; i < inlineCodes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, inlineCodes[i]);
  }

  // 12. Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    text = text.replace(`\x00CB${i}\x00`, codeBlocks[i]);
  }

  return text;
}
