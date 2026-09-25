// Calculate straight-line distance over the Earth's surface.
export function distanceInMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;

  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) *
      Math.cos(radians(lat2)) *
      Math.sin(deltaLng / 2) ** 2;

  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}