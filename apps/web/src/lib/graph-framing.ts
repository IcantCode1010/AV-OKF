type Bounds = { x: [number, number]; y: [number, number]; z: [number, number] };

export function frameGraphBounds(bounds: Bounds, width: number, height: number, verticalFov = 50) {
  const center = { x: (bounds.x[0] + bounds.x[1]) / 2,
    y: (bounds.y[0] + bounds.y[1]) / 2, z: (bounds.z[0] + bounds.z[1]) / 2 };
  const tangent = Math.tan(verticalFov * Math.PI / 360);
  const aspect = Math.max(width, 1) / Math.max(height, 1);
  const halfWidth = Math.max(12, (bounds.x[1] - bounds.x[0]) / 2) + 12;
  const halfHeight = Math.max(12, (bounds.y[1] - bounds.y[0]) / 2) + 12;
  const halfDepth = Math.max(0, (bounds.z[1] - bounds.z[0]) / 2);
  const distance = halfDepth + Math.max(halfHeight / tangent, halfWidth / (tangent * aspect)) * 1.18;
  return { center, position: { ...center, z: center.z + distance } };
}
