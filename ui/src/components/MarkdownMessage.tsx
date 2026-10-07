import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Check, Copy } from 'lucide-react';
import 'highlight.js/styles/github.css';
import { MARKDOWN_REMARK_PLUGINS, MARKDOWN_REHYPE_PLUGINS, textOf, codeLanguage } from '../utils/markdownConfig';

/**
 * Renders an LLM response as GitHub-flavoured Markdown: headings, lists, tables, links,
 * inline code and fenced code blocks with syntax highlighting and a copy button.
 * Raw HTML in the response is not rendered (react-markdown escapes it by default).
 * `compact` shrinks headings, code and tables for narrow side panels.
 */

const CodeBlock: React.FC<{ children?: React.ReactNode; compact?: boolean }> = ({ children, compact }) => {
  const [copied, setCopied] = useState(false);
  const codeEl = React.Children.toArray(children).find(React.isValidElement) as
    | React.ReactElement<{ className?: string; children?: React.ReactNode }>
    | undefined;
  const lang = codeLanguage(codeEl?.props.className);
  const raw = textOf(codeEl?.props.children ?? children).replace(/\n$/, '');

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation(); // the chat bubble is clickable; copying should not select it
    navigator.clipboard.writeText(raw).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className={`${compact ? 'my-2 rounded-lg' : 'my-3 rounded-xl'} border border-slate-200 bg-slate-50 overflow-hidden`}>
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-100/80 text-[10px] font-mono text-slate-600">
        <span>{lang || 'code'}</span>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white hover:text-slate-900 transition cursor-pointer"
          aria-label="Copy code"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre
        className={`overflow-x-auto ${compact ? 'p-2 text-[10.5px]' : 'p-3 text-[12px]'} leading-relaxed font-mono [&_.hljs]:!bg-transparent [&_.hljs]:!p-0 [&_.hljs]:!overflow-visible`}
      >
        {children}
      </pre>
    </div>
  );
};

export const MarkdownMessage: React.FC<{ text: string; compact?: boolean }> = ({ text, compact = false }) => {
  const h = compact
    ? {
        h1: 'text-[13px] font-bold text-slate-900 mt-2 mb-1 first:mt-0',
        h2: 'text-[12px] font-bold text-slate-900 mt-2 mb-1 first:mt-0',
        h3: 'text-[11.5px] font-semibold text-slate-900 mt-2 mb-1 first:mt-0',
        h4: 'text-[11px] font-semibold text-slate-800 mt-2 mb-0.5 first:mt-0',
      }
    : {
        h1: 'text-base font-bold text-slate-900 mt-4 mb-2 first:mt-0',
        h2: 'text-[15px] font-bold text-slate-900 mt-4 mb-2 first:mt-0',
        h3: 'text-sm font-semibold text-slate-900 mt-3 mb-1.5 first:mt-0',
        h4: 'text-sm font-semibold text-slate-800 mt-3 mb-1 first:mt-0',
      };
  const gap = compact ? 'my-1' : 'my-2';
  const cell = compact ? 'px-2 py-1' : 'px-3 py-2';

  return (
    <div className="md-message break-words">
      <ReactMarkdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
        components={{
          h1: ({ children }) => <h1 className={h.h1}>{children}</h1>,
          h2: ({ children }) => <h2 className={h.h2}>{children}</h2>,
          h3: ({ children }) => <h3 className={h.h3}>{children}</h3>,
          h4: ({ children }) => <h4 className={h.h4}>{children}</h4>,
          p: ({ children }) => <p className={`${gap} first:mt-0 last:mb-0`}>{children}</p>,
          ul: ({ children }) => (
            <ul className={`${gap} ${compact ? 'pl-4 space-y-0.5' : 'pl-5 space-y-1'} list-disc marker:text-slate-400`}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className={`${gap} ${compact ? 'pl-4 space-y-0.5' : 'pl-5 space-y-1'} list-decimal marker:text-slate-500`}>{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-blue-700 underline underline-offset-2 hover:text-blue-900"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className={`${gap} border-l-4 border-slate-300 pl-3 text-slate-600`}>{children}</blockquote>
          ),
          hr: () => <hr className={`${compact ? 'my-2' : 'my-3'} border-slate-200`} />,
          table: ({ children }) => (
            <div className={`${compact ? 'my-2' : 'my-3'} overflow-x-auto rounded-lg border border-slate-200`}>
              <table className={`w-full text-left ${compact ? 'text-[10.5px]' : 'text-xs'} border-collapse`}>{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
          th: ({ children, style }) => (
            <th style={style} className={`${cell} font-semibold text-slate-700 border-b border-slate-200`}>
              {children}
            </th>
          ),
          td: ({ children, style }) => (
            <td style={style} className={`${cell} text-slate-800 border-b border-slate-100 align-top`}>
              {children}
            </td>
          ),
          pre: ({ children }) => <CodeBlock compact={compact}>{children}</CodeBlock>,
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="px-1 py-0.5 rounded bg-slate-100 border border-slate-200 text-[0.85em] font-mono text-rose-700">
                {children}
              </code>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};
