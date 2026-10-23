export const GEO: Record<string, { lat: number; lng: number; span: number }> = {
  'puerto-escondido': { lat: 15.862, lng: -97.07, span: 0.06 },
  'mexico-city': { lat: 19.418, lng: -99.163, span: 0.05 },
  lombok: { lat: -8.895, lng: 116.295, span: 0.12 },
  bali: { lat: -8.45, lng: 115.35, span: 0.25 },
  lisbon: { lat: 38.7115, lng: -9.13, span: 0.04 },
  ericeira: { lat: 38.963, lng: -9.417, span: 0.04 },
  chamonix: { lat: 45.94, lng: 6.89, span: 0.1 },
  'cape-town': { lat: -33.9249, lng: 18.4241, span: 0.08 },
}

export function osmEmbed(slug: string, zoomFactor = 1) {
  const g = GEO[slug]
  if (!g) return ''
  const s = g.span * zoomFactor
  const bbox = [g.lng - s, g.lat - s * 0.6, g.lng + s, g.lat + s * 0.6].join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${g.lat},${g.lng}`
}
