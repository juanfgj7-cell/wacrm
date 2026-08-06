/**
 * Small colored platform indicator. lucide-react dropped brand/logo
 * icons (Facebook, Instagram, ...) a while back — this repo is on a
 * version without them (checked: they don't exist in
 * node_modules/lucide-react's exports) — so instead of pulling in a
 * brand-icon package for two glyphs, this renders a simple initial-
 * letter badge in each platform's recognizable color. Cheap, no new
 * dependency, and legible at the small sizes used here.
 */
export function PlatformBadge({
  platform,
  className = 'size-5',
}: {
  platform: 'facebook' | 'instagram';
  className?: string;
}) {
  const isFacebook = platform === 'facebook';
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full text-white ${className}`}
      style={{
        background: isFacebook
          ? '#1877F2'
          : 'linear-gradient(45deg, #f09433, #e6683c, #dc2743, #cc2366, #bc1888)',
      }}
      aria-hidden="true"
    >
      <span className="text-[0.6em] font-bold leading-none">{isFacebook ? 'f' : 'IG'}</span>
    </span>
  );
}
