import React, { useState } from 'react';
import { ApigeeLogo } from './ApigeeLogo';
import { useCustomerTheme } from './CustomerThemeProvider';
import { brandHeader, monogramLogo } from '../utils/customerTheme';

/**
 * Top-left brand mark. With the Apigee default theme this is the Apigee logo;
 * with a customer theme it is only the customer's logo. Apigee stays visible
 * as the icon above the AI Gateway welcome heading.
 *
 * A theme with a wordmark (the full logo with the company name, as on the
 * customer's own site header) shows it on wide screens and falls back to the
 * square logo where the bar is crowded. On a dark header bar the square logo
 * sits on a small white plate so dark marks stay visible.
 */
export const BrandLogo: React.FC = () => {
  const { theme, isDefault, logoSrc } = useCustomerTheme();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [failedWordmark, setFailedWordmark] = useState<string | null>(null);

  if (isDefault || !logoSrc) return <ApigeeLogo />;

  // A broken logo URL falls back to the monogram rather than an empty box.
  const src = failedSrc === logoSrc ? monogramLogo(theme.name, theme.primary) : logoSrc;
  const wordmark = theme.wordmarkUrl && failedWordmark !== theme.wordmarkUrl ? theme.wordmarkUrl : '';
  const { dark } = brandHeader(theme);

  return (
    <div className={`flex items-center select-none ${wordmark ? 'h-7 min-[1280px]:h-9' : 'h-7'}`}>
      {wordmark && (
        <img
          src={wordmark}
          alt={`${theme.name} logo`}
          title={theme.name}
          data-testid="brand-wordmark"
          data-white={theme.wordmarkWhite ? 'true' : undefined}
          className={`hidden min-[1280px]:block h-9 w-auto max-w-[230px] object-contain object-left shrink-0${theme.wordmarkWhite ? ' brightness-0 invert' : ''}`}
          onError={() => setFailedWordmark(theme.wordmarkUrl)}
        />
      )}
      <img
        src={src}
        alt={`${theme.name} logo`}
        title={theme.name}
        className={`${wordmark ? 'min-[1280px]:hidden ' : ''}h-7 w-auto max-w-[150px] object-contain shrink-0${dark ? ' bg-white rounded-md p-0.5' : ''}`}
        onError={() => setFailedSrc(logoSrc)}
      />
    </div>
  );
};
