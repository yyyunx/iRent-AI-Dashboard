export interface ReturnLocation {
  latitude?: number;
  longitude?: number;
  gpsAccuracy?: number;
  gpsCapturedAt?: string;
  address: string;
  station?: string;
  parkingFacility?: string;
  floor?: string;
  zone?: string;
  pillar?: string;
  parkingSlot: string;
  locationNote?: string;
}

export class LocationValidationError extends Error {
  constructor(public readonly code: 'INVALID_LOCATION' | 'LOCATION_REQUIRED', message: string) {
    super(message);
    this.name = 'LocationValidationError';
  }
}

const limits: Record<keyof Omit<ReturnLocation, 'latitude' | 'longitude' | 'gpsAccuracy' | 'gpsCapturedAt'>, number> = {
  address: 180, station: 120, parkingFacility: 120, floor: 24, zone: 48, pillar: 48, parkingSlot: 48, locationNote: 500
};

function text(value: unknown, key: keyof typeof limits, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new LocationValidationError('LOCATION_REQUIRED', `${key} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new LocationValidationError('INVALID_LOCATION', `${key} must be text.`);
  const normalized = value.trim();
  if (!normalized) {
    if (required) throw new LocationValidationError('LOCATION_REQUIRED', `${key} is required.`);
    return undefined;
  }
  if (normalized.length > limits[key]) throw new LocationValidationError('INVALID_LOCATION', `${key} is too long.`);
  return normalized;
}

function numberInRange(value: unknown, name: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new LocationValidationError('INVALID_LOCATION', `${name} is invalid.`);
  }
  return value;
}

export function validateReturnLocation(input: unknown, required: boolean): ReturnLocation | undefined {
  if (input === undefined || input === null) {
    if (required) throw new LocationValidationError('LOCATION_REQUIRED', 'Return location is required.');
    return undefined;
  }
  if (typeof input !== 'object' || Array.isArray(input)) throw new LocationValidationError('INVALID_LOCATION', 'Return location is invalid.');
  const raw = input as Record<string, unknown>;
  const latitude = numberInRange(raw.latitude, 'latitude', -90, 90);
  const longitude = numberInRange(raw.longitude, 'longitude', -180, 180);
  const gpsAccuracy = numberInRange(raw.gpsAccuracy, 'gpsAccuracy', 0, 100_000);
  const gpsCapturedAt = raw.gpsCapturedAt === undefined || raw.gpsCapturedAt === null || raw.gpsCapturedAt === '' ? undefined : String(raw.gpsCapturedAt);
  if (gpsCapturedAt && Number.isNaN(Date.parse(gpsCapturedAt))) throw new LocationValidationError('INVALID_LOCATION', 'gpsCapturedAt is invalid.');
  if ((latitude === undefined) !== (longitude === undefined)) throw new LocationValidationError('INVALID_LOCATION', 'latitude and longitude must be provided together.');

  const location: ReturnLocation = {
    address: text(raw.address, 'address', required) || '',
    parkingSlot: text(raw.parkingSlot, 'parkingSlot', required) || '',
    latitude, longitude, gpsAccuracy, gpsCapturedAt,
    station: text(raw.station, 'station'),
    parkingFacility: text(raw.parkingFacility, 'parkingFacility'),
    floor: text(raw.floor, 'floor'),
    zone: text(raw.zone, 'zone'),
    pillar: text(raw.pillar, 'pillar'),
    locationNote: text(raw.locationNote, 'locationNote')
  };
  if ((location.parkingFacility || location.floor) && (!location.floor || !location.parkingSlot)) {
    throw new LocationValidationError('LOCATION_REQUIRED', 'floor and parkingSlot are required for a parking facility.');
  }
  return location;
}
