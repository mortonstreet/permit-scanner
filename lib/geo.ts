/**
 * Haul radius.
 *
 * The dominant qualifier for a sitework contractor, ahead of project value or
 * timing. Mobilising crews, trucks and heavy equipment two hours each way is
 * not commercially equivalent to a job down the road, and a lead outside the
 * radius is not a lead. The incumbents price their tiers by radius for this
 * reason.
 */

const EARTH_RADIUS_MILES = 3958.8;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles. */
export function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rough drive time from straight-line distance.
 *
 * Deliberately crude: a real routing call per lead would cost more than the
 * lead is worth, and a contractor thinks in "about an hour", not minutes.
 * The 1.3 factor is the usual road-vs-crow detour ratio, and the speed bands
 * reflect that short hauls are urban and long hauls are highway.
 */
export function approxDriveMinutes(miles: number): number {
  const road = miles * 1.3;
  const mph = road < 10 ? 25 : road < 40 ? 40 : 55;
  return Math.round((road / mph) * 60);
}

export interface HaulBase {
  lat: number;
  lng: number;
  /** Miles the contractor will actually mobilise to. */
  radiusMiles: number;
  label?: string;
}

export interface HaulFit {
  miles: number;
  driveMinutes: number;
  withinRadius: boolean;
  /** 0-1, 1 at the yard and falling to 0 at the edge of the radius. */
  proximity: number;
}

export function haulFit(
  base: HaulBase,
  point: { lat: number | null; lng: number | null },
): HaulFit | null {
  if (point.lat == null || point.lng == null) return null;
  const miles = distanceMiles(base, { lat: point.lat, lng: point.lng });
  return {
    miles: Math.round(miles * 10) / 10,
    driveMinutes: approxDriveMinutes(miles),
    withinRadius: miles <= base.radiusMiles,
    proximity: Math.max(0, 1 - miles / Math.max(base.radiusMiles, 1)),
  };
}

/** Parse "27.87,-82.43,60" into a base, or null. */
export function parseHaulBase(raw: string | null | undefined, fallbackRadius = 60): HaulBase | null {
  if (!raw) return null;
  const parts = raw.split(",").map((p) => Number.parseFloat(p.trim()));
  const [lat, lng, radius] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    lat, lng,
    radiusMiles: Number.isFinite(radius) && radius > 0 ? Math.min(radius, 500) : fallbackRadius,
  };
}

/** A few yards we can resolve by name, so a demo needs no coordinates. */
export const KNOWN_BASES: Record<string, HaulBase> = {
  "cape-coral": { lat: 26.5629, lng: -81.9495, radiusMiles: 60, label: "Cape Coral, FL" },
  tampa: { lat: 27.9506, lng: -82.4572, radiusMiles: 60, label: "Tampa, FL" },
  orlando: { lat: 28.5383, lng: -81.3792, radiusMiles: 60, label: "Orlando, FL" },
  miami: { lat: 25.7617, lng: -80.1918, radiusMiles: 60, label: "Miami, FL" },
  jacksonville: { lat: 30.3322, lng: -81.6557, radiusMiles: 60, label: "Jacksonville, FL" },
  phoenix: { lat: 33.4484, lng: -112.074, radiusMiles: 60, label: "Phoenix, AZ" },
  raleigh: { lat: 35.7796, lng: -78.6382, radiusMiles: 60, label: "Raleigh, NC" },
  charlotte: { lat: 35.2271, lng: -80.8431, radiusMiles: 60, label: "Charlotte, NC" },
  "fort-worth": { lat: 32.7555, lng: -97.3308, radiusMiles: 60, label: "Fort Worth, TX" },
  austin: { lat: 30.2672, lng: -97.7431, radiusMiles: 60, label: "Austin, TX" },
};

export function resolveBase(raw: string | null | undefined, radiusOverride?: number | null): HaulBase | null {
  if (!raw) return null;
  const known = KNOWN_BASES[raw.toLowerCase().trim()];
  if (known) return { ...known, radiusMiles: radiusOverride ?? known.radiusMiles };
  const parsed = parseHaulBase(raw);
  if (parsed && radiusOverride) parsed.radiusMiles = radiusOverride;
  return parsed;
}
