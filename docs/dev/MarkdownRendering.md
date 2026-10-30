# Markdown rendering for replies

This change makes model replies appear as formatted Markdown instead of plain
text.

## Before and after

Before, the reply was inserted as literal text:

```ts
replyEl.setText(reply);
```

A reply containing `**bold**`, `- lists`, or a code fence showed the Markdown
markers themselves.

Now the reply is rendered with Obsidian's own renderer, so headings, bold,
lists, tables, links, images, and code blocks appear formatted.

## What changed

### 1. `src/ui/ChatView.ts`

Import the renderer:

```ts
import { ItemView, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';
```

Add a helper that renders Markdown into the assistant bubble:

```ts
private async renderAssistantMessage(
	el: HTMLElement,
	markdown: string,
): Promise<void> {
	el.empty();
	el.addClass('markdown-rendered');

	const sourcePath = this.app.workspace.getActiveFile()?.path ?? '';
	await MarkdownRenderer.render(this.app, markdown, el, sourcePath, this);

	const messages = this.messagesEl;
	if (messages) messages.scrollTop = messages.scrollHeight;
}
```

Call it after a successful reply:

```ts
const reply = await service.chat(this.history, {
	think: this.plugin.settings.ollamaThink,
	system: activeFileContext,
});

await this.renderAssistantMessage(replyEl, reply);
this.history.push({ role: 'assistant', content: reply });
```

Why each argument matters:

| Argument     | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `el`         | The assistant bubble, emptied first because `render` appends.            |
| `markdown`   | The raw reply text from Ollama.                                         |
| `sourcePath` | The active note path, so `[[links]]` and attachments resolve.           |
| `this`       | The view's component; Obsidian cleans up embeds/code blocks with it.    |

`MarkdownRenderer.render` is the current API. The older
`MarkdownRenderer.renderMarkdown` is deprecated.

### 2. `styles.css`

The shared bubble rule uses `white-space: pre-wrap` so user input keeps its
line breaks. That would break rendered block elements, so the assistant bubble
overrides it:

```css
.local-study-ai-message.assistant {
  white-space: normal;
}
```

Spacing and overflow rules were added for rendered Markdown:

- `> :first-child` / `> :last-child` margins are zeroed so content fits the
  bubble padding.
- Paragraph and list margins are tightened for chat bubbles.
- `pre` and `table` scroll horizontally instead of overflowing the sidebar.
- Images are capped at `100%` width.
- Links use the accent colour.

The `markdown-rendered` class is added so Obsidian's built-in heading, code,
list, blockquote, and table styles apply inside the bubble.

## What was not changed

- **History still stores raw Markdown.** Only the display is formatted, so
  follow-up turns send the original text to Ollama and context stays intact.
- **User messages stay plain text.** Only assistant replies are rendered.
- **Errors stay plain text.** `OllamaError` messages use `setText` so an error
  message containing Markdown characters is not interpreted.
- **Your active-file context feature is untouched.** The `system` prompt built
  by `buildActiveFileContext()` still works the same way.

## Privacy note

Rendering happens in the local Obsidian app, but a reply can contain remote
images such as `![](https://example.com/pic.png)`. Obsidian will fetch those
URLs when it renders them. This was accepted as-is; stripping external images
would need a preprocessing step before rendering.

## How to verify

1. Run `npm run build` and reload the plugin.
2. Ask the model: “Reply with a heading, a bullet list, a table, and a
   TypeScript code block.”
3. Confirm:
   - the heading and list are formatted,
   - the table renders and scrolls horizontally on a narrow sidebar,
   - the code block is styled and scrolls,
   - user messages and errors are still plain text,
   - a follow-up question still remembers the previous answer.
