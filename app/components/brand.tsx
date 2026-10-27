/* MotionWren brand marks, drawn as inline SVG so they stay crisp at every size
   and match the create-video overlay exactly. */

export function WrenMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg className={`wren-mark ${className}`.trim()} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#14161A" />
      <g fill="#F4F5F2">
        <circle cx="24" cy="27" r="7.5" />
        <path d="M14 25 L6 27 L14 30 Z" />
        <path d="M17 31 C17 45 30 49 43 44 C36 40 33 34 29 30 Z" />
      </g>
      <circle cx="22" cy="26" r="1.6" fill="#14161A" />
      <path d="M29 31 C39 27 48 20 56 12" stroke="#E9A23B" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <span className="wordmark" aria-label="MotionWren">
      <WrenMark size={size} />
      <span className="wordmark-text" aria-hidden="true">Motion<em>Wren</em></span>
      {label && <span className="wordmark-label">{label}</span>}
    </span>
  );
}
