import React from 'react';

interface LogoProps {
  size?: 'sm' | 'lg';
  className?: string;
  withWordmark?: boolean;
}

export default function Logo({
  size = 'sm',
  className,
  withWordmark = true,
}: LogoProps): React.ReactElement {
  const gradientId = React.useId();

  const markClass = size === 'lg' ? 'h-12 w-12' : 'h-6 w-6';
  const wordmarkClass =
    size === 'lg'
      ? 'text-3xl font-bold tracking-[-0.02em] text-ink'
      : 'text-lg font-bold tracking-[-0.02em] text-ink';
  const gapClass = size === 'lg' ? 'gap-2' : 'gap-1.5';

  return (
    <span
      className={`inline-flex items-center ${gapClass}${className ? ` ${className}` : ''}`}
      aria-label="Aidit"
    >
      <svg
        className={markClass}
        viewBox="0 0 48 48"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-hidden={withWordmark ? true : undefined}
        focusable="false"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="10"
            y1="6"
            x2="40"
            y2="44"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#5B6CF5" />
            <stop offset="0.55" stopColor="#6848F8" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <path
          d="M22.9 7.4 Q24 5 25.1 7.4 L42 41 Q42.8 42.5 41 42.5 L33 42.5 Q31.8 42.5 31.2 41.4 L24.9 29.6 Q24 28 23.1 29.6 L16.8 41.4 Q16.2 42.5 15 42.5 L7 42.5 Q5.2 42.5 6 41 Z"
          fill={`url(#${gradientId})`}
        />
      </svg>
      {withWordmark && <span className={wordmarkClass}>Aidit</span>}
    </span>
  );
}
