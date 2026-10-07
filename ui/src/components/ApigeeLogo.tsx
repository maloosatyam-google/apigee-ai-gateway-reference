import React from 'react';

interface ApigeeLogoProps {
  className?: string;
  showStudio?: boolean;
}

export const APIGEE_LOGO_URL =
  'https://www.gstatic.com/devrel-devsite/prod/veec7311b6c5f99ef32994eb65aab7022195f72bfa4f3d934bdc7556da7fa7c3b/clouddocs/images/icons/products/apigee-color.svg';

/**
 * Official Google Cloud Apigee product logo (4-color interlocking geometric loop)
 * Direct inline SVG from https://www.gstatic.com/devrel-devsite/prod/veec7311b6c5f99ef32994eb65aab7022195f72bfa4f3d934bdc7556da7fa7c3b/clouddocs/images/icons/products/apigee-color.svg
 */
export const ApigeeColorSymbol: React.FC<{ className?: string }> = ({ className = 'w-7 h-7' }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 512 512"
    className={className}
    fill="none"
    role="img"
    aria-label="Google Cloud Apigee Logo"
  >
    {/* Yellow Loop */}
    <path
      fill="#FBBC04"
      d="M349,458c-29.1,0-56.5-11.3-77.1-31.9L85.9,240.1c-20.6-20.6-31.9-48-31.9-77.1s11.3-56.5,31.9-77.1c20.6-20.6,48-31.9,77.1-31.9s56.5,11.3,77.1,31.9l186,186c20.6,20.6,31.9,48,31.9,77.1s-11.3,56.5-31.9,77.1c-20.6,20.6-48,31.9-77.1,31.9h0ZM163,86c-19.7,0-39.4,7.5-54.4,22.5-30,30-30,78.9,0,108.9l186,186c30,30,78.9,30,108.9,0,30-30,30-78.9,0-108.9L217.4,108.6c-15-15-34.7-22.5-54.4-22.5h0Z"
    />
    {/* Blue Loop */}
    <path
      fill="#4285F4"
      d="M163,458c-29.1,0-56.5-11.3-77.1-31.9-20.6-20.6-31.9-48-31.9-77.1s11.3-56.5,31.9-77.1l186-186c20.6-20.6,48-31.9,77.1-31.9s56.5,11.3,77.1,31.9c20.6,20.6,31.9,48,31.9,77.1s-11.3,56.5-31.9,77.1l-186,186c-20.6,20.6-48,31.9-77.1,31.9h0ZM349,86c-19.7,0-39.4,7.5-54.5,22.5l-186,186c-30,30-30,78.9,0,108.9,30,30,78.9,30,108.9,0l186-186c30-30,30-78.9,0-108.9-15-15-34.7-22.5-54.5-22.5h0Z"
    />
    {/* Red Arcs */}
    <path
      fill="#EA4335"
      d="M310.5,201.6l-93-93c-30-30-78.9-30-108.9,0l-22.6-22.6c42.5-42.5,111.6-42.5,154.1,0l93,93-22.6,22.6h0Z"
    />
    <path
      fill="#EA4335"
      d="M201.6,201.6l-22.6-22.6,93-93c42.5-42.5,111.6-42.5,154.1,0l-22.6,22.6c-30-30-78.9-30-108.9,0l-93,93h0Z"
    />
    {/* Green Arcs */}
    <path
      fill="#34A853"
      d="M163,458c-27.9,0-55.8-10.6-77.1-31.9l22.6-22.6c30,30,78.9,30,108.9,0l93-93,22.6,22.6-93,93c-21.2,21.2-49.2,31.9-77.1,31.9h0Z"
    />
    <path
      fill="#34A853"
      d="M349,458c-27.9,0-55.8-10.6-77.1-31.9l-93-93,22.6-22.6,93,93c30,30,78.9,30,108.9,0l22.6,22.6c-21.2,21.2-49.2,31.9-77.1,31.9h0Z"
    />
    {/* Blue Exterior and Center Ring */}
    <path
      fill="#4285F4"
      d="M426.1,426.1l-22.6-22.6c30-30,30-78.9,0-108.9l-93-93,22.6-22.6,93,93c42.5,42.5,42.5,111.6,0,154.1h0Z"
    />
    <path
      fill="#4285F4"
      d="M256,365c-29.1,0-56.5-11.3-77.1-31.9h0c-42.5-42.5-42.5-111.6,0-154.1s48-31.9,77.1-31.9,56.5,11.3,77.1,31.9c20.6,20.6,31.9,48,31.9,77.1s-11.3,56.5-31.9,77.1c-20.6,20.6-48,31.9-77.1,31.9h0ZM256,179c-20.6,0-39.9,8-54.4,22.6-30,30-30,78.9,0,108.9h0c14.5,14.5,33.9,22.5,54.4,22.5s39.9-8,54.5-22.5,22.5-33.9,22.5-54.4-8-39.9-22.5-54.4-33.9-22.6-54.5-22.6h0Z"
    />
    {/* Intersections */}
    <path
      fill="#EA4335"
      d="M310.5,201.6c-14.5-14.5-33.9-22.6-54.5-22.6s-39.9,8-54.4,22.6l-22.6-22.6c20.6-20.6,48-31.9,77.1-31.9s56.5,11.3,77.1,31.9l-22.6,22.6h0Z"
    />
    <path
      fill="#34A853"
      d="M256,365c-29.1,0-56.5-11.3-77.1-31.9l22.6-22.6c14.5,14.5,33.9,22.5,54.5,22.5s39.9-8,54.5-22.5l22.6,22.6c-20.6,20.6-48,31.9-77.1,31.9h0Z"
    />
    <path
      fill="#FBBC04"
      d="M85.9,426.1c-42.5-42.5-42.5-111.6,0-154.1l93-93,22.6,22.6-93,93c-30,30-30,78.9,0,108.9l-22.6,22.6h0Z"
    />
    <path
      fill="#FBBC04"
      d="M178.9,333.1c-42.5-42.5-42.5-111.6,0-154.1l22.6,22.6c-30,30-30,78.9,0,108.9l-22.6,22.6Z"
    />
    <path
      fill="#FBBC04"
      d="M178.9,333.1l-93-93c-42.5-42.5-42.5-111.6,0-154.1l22.6,22.6c-30,30-30,78.9,0,108.9l93,93-22.6,22.6h0Z"
    />
  </svg>
);

export const ApigeeLogo: React.FC<ApigeeLogoProps> = ({ className = 'h-7', showStudio = false }) => {
  return (
    <div className={`flex items-center gap-2 select-none ${className}`}>
      {/* Official Google Cloud Apigee Product Icon (logo only, no wordmark) */}
      <ApigeeColorSymbol className="w-7 h-7 shrink-0 drop-shadow-xs" />

      {showStudio && (
        <span className="text-[10px] font-semibold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded border border-blue-200/80 tracking-wider uppercase font-mono">
          Studio
        </span>
      )}
    </div>
  );
};
