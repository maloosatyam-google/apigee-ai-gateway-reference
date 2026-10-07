// Markdown rendering config shared by MarkdownMessage.tsx and its unit tests.
import React from 'react';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/** GitHub-flavoured Markdown: tables, strikethrough, task lists, autolinks. */
export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
/** Syntax highlighting for fenced code; `detect` guesses the language when the fence has none. */
export const MARKDOWN_REHYPE_PLUGINS = [[rehypeHighlight, { detect: true }]];

/** Plain text of rendered React children (used by the code block's Copy button). */
export function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (React.isValidElement(node)) return textOf(node.props?.children);
  return '';
}

/** 'language-python hljs' -> 'python'; undefined when there is no language class. */
export function codeLanguage(className) {
  return className?.match(/language-([\w+-]+)/)?.[1];
}
