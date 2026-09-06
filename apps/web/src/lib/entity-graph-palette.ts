export const ENTITY_GRAPH_TYPE_COLORS = {
  location: [0.78, 0.58, 0.05, 1],
  organization: [0.55, 0.35, 0.92, 1],
  other: [0.45, 0.5, 0.58, 1],
  person: [0.05, 0.68, 0.7, 1],
  product: [0.94, 0.47, 0.09, 1],
  regulation: [0.88, 0.22, 0.38, 1],
  standard: [0.08, 0.64, 0.36, 1],
  system: [0.12, 0.5, 0.94, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

const STRUCTURAL_NODE_COLORS: Record<string, readonly [number, number, number, number]> = {
  alias: [0.54, 0.57, 0.63, 1],
  concept: [0.38, 0.42, 0.49, 1],
  document: [0.7, 0.72, 0.76, 1],
  unresolved: [0.58, 0.6, 0.65, 1],
};

export function getEntityGraphTypeColor(type: string): readonly [number, number, number, number] {
  return ENTITY_GRAPH_TYPE_COLORS[type as keyof typeof ENTITY_GRAPH_TYPE_COLORS]
    ?? STRUCTURAL_NODE_COLORS[type]
    ?? ENTITY_GRAPH_TYPE_COLORS.other;
}

export function entityGraphColorCss(type: string) {
  const [red, green, blue] = getEntityGraphTypeColor(type);
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;
}
