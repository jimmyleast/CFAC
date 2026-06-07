// CFAC pinwheel — the Children's Advocacy Center symbol, in the brand blues.
// `variant`: 'filled' (default) alternates navy/blue blades; 'outline' draws the
// strokes only (for subtle marks on dark surfaces).

const NAVY = '#1E3A8A'
const BLUE = '#5BA3D9'
const SKY = '#A8CCEC'

const BLADE = 'M50,50 L50,7 C67,9 80,25 50,50 Z'

export default function Pinwheel({
  size = 28,
  variant = 'filled',
  className,
  title = 'CFAC',
}: {
  size?: number
  variant?: 'filled' | 'outline'
  className?: string
  title?: string
}) {
  const outline = variant === 'outline'
  const blade = (rot: number, fill: string) => (
    <path
      d={BLADE}
      transform={`rotate(${rot} 50 50)`}
      fill={outline ? 'none' : fill}
      stroke={outline ? SKY : 'none'}
      strokeWidth={outline ? 3 : 0}
      strokeLinejoin="round"
    />
  )
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} role="img" aria-label={title} style={{ display: 'block' }}>
      <title>{title}</title>
      {blade(0, BLUE)}
      {blade(90, NAVY)}
      {blade(180, BLUE)}
      {blade(270, NAVY)}
      {!outline && <circle cx={50} cy={50} r={6} fill={NAVY} />}
      <path
        d="M50 43 l1.6 4.7 5 .1 -4 3 1.5 4.8 -4.1-2.9 -4.1 2.9 1.5-4.8 -4-3 5-.1 z"
        fill={outline ? SKY : SKY}
      />
    </svg>
  )
}
