import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownMessage({ content, fromSelf }: { content: string; fromSelf: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none break-words
        ${fromSelf
          ? 'prose-invert'
          : 'prose-neutral'
        }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
