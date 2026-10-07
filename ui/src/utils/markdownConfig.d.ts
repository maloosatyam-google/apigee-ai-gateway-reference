import type { PluggableList } from 'unified';
import type { ReactNode } from 'react';
export declare const MARKDOWN_REMARK_PLUGINS: PluggableList;
export declare const MARKDOWN_REHYPE_PLUGINS: PluggableList;
export declare function textOf(node: ReactNode): string;
export declare function codeLanguage(className?: string): string | undefined;
