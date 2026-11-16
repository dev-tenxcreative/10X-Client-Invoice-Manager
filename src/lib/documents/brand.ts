/** Brand colours taken from the 10X Creative logo and sample documents. */
export const BRAND = {
  red: "#D71920",
  ink: "#1F2128",
  muted: "#6B7280",
  line: "#E5E7EB",
  soft: "#F7F7F8",
};

/** Vector logo mark: "10" in brand red and the red/dark crossed X. */
export function logoSvg(height = 44): string {
  const w = Math.round((height * 128) / 60);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${height}" viewBox="0 0 128 60" role="img" aria-label="10X Creative">
  <text x="0" y="50" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-weight="900" font-size="56" letter-spacing="-4" fill="${BRAND.red}">10</text>
  <path d="M68 10 H82 L114 58 H100 Z" fill="${BRAND.ink}"/>
  <path d="M112 0 H126 L88 60 H74 Z" fill="${BRAND.red}"/>
</svg>`;
}

export function brandLockup(height = 44): string {
  return `<div style="display:flex;align-items:center;gap:10px">${logoSvg(height)}<div style="line-height:1.1">
    <div style="font-weight:800;font-size:${Math.round(height * 0.42)}px;color:${BRAND.ink};letter-spacing:-0.2px">10X Creative</div>
    <div style="font-size:${Math.max(8, Math.round(height * 0.2))}px;color:${BRAND.muted}">Digital Marketing &amp; Web Development</div>
  </div></div>`;
}

export const DOC_FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">';
