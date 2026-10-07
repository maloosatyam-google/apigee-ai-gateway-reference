import React, { useState } from 'react';

/**
 * Clean vector SVG for Google 4-color 'G' mark
 */
export const GoogleLogoSvg: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-label="Google">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.98 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
  </svg>
);

/**
 * Authentic Anthropic official geometric brand mark
 */
export const AnthropicLogoSvg: React.FC<{ className?: string; color?: string }> = ({
  className = 'w-4 h-4',
  color = '#141413',
}) => (
  <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill={color} aria-label="Anthropic">
    <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
  </svg>
);

/**
 * Google brand logo component - renders official gradient 'G' asset with vector fallback
 */
export const GoogleLogo: React.FC<{ className?: string; alt?: string }> = ({
  className = 'w-4 h-4',
  alt = 'Google',
}) => {
  const [error, setError] = useState(false);
  if (error) {
    return <GoogleLogoSvg className={className} />;
  }
  return (
    <img
      src="/google-logo.png"
      alt={alt}
      className={`${className} object-contain shrink-0`}
      onError={() => setError(true)}
      loading="eager"
    />
  );
};

/**
 * Anthropic brand logo component - renders official Anthropic asset with vector fallback
 */
export const AnthropicLogo: React.FC<{ className?: string; alt?: string }> = ({
  className = 'w-4 h-4',
  alt = 'Anthropic',
}) => {
  const [error, setError] = useState(false);
  if (error) {
    return <AnthropicLogoSvg className={className} />;
  }
  return (
    <img
      src="/anthropic-logo.png"
      alt={alt}
      className={`${className} object-contain shrink-0`}
      onError={() => setError(true)}
      loading="eager"
    />
  );
};
