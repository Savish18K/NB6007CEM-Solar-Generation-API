// The provinces and districts are Sri Lanka's real ones (ISO 3166-2:LK codes, lower case), with rough
// coordinates for each district capital. Everything else in the seed (substations, installations, meters,
// users, readings) is made-up test data, not real SLSEA or CEB records.
export interface ProvinceSeed {
  province_id: string;
  name: string;
}

export interface DistrictSeed {
  district_id: string;
  province_id: string;
  name: string;
  lat: number;
  lon: number;
}

export const PROVINCES: ProvinceSeed[] = [
  { province_id: 'lk-1', name: 'Western' },
  { province_id: 'lk-2', name: 'Central' },
  { province_id: 'lk-3', name: 'Southern' },
  { province_id: 'lk-4', name: 'Northern' },
  { province_id: 'lk-5', name: 'Eastern' },
  { province_id: 'lk-6', name: 'North Western' },
  { province_id: 'lk-7', name: 'North Central' },
  { province_id: 'lk-8', name: 'Uva' },
  { province_id: 'lk-9', name: 'Sabaragamuwa' },
];

export const DISTRICTS: DistrictSeed[] = [
  { district_id: 'lk-11', province_id: 'lk-1', name: 'Colombo', lat: 6.93, lon: 79.86 },
  { district_id: 'lk-12', province_id: 'lk-1', name: 'Gampaha', lat: 7.09, lon: 79.99 },
  { district_id: 'lk-13', province_id: 'lk-1', name: 'Kalutara', lat: 6.58, lon: 79.96 },
  { district_id: 'lk-21', province_id: 'lk-2', name: 'Kandy', lat: 7.29, lon: 80.63 },
  { district_id: 'lk-22', province_id: 'lk-2', name: 'Matale', lat: 7.47, lon: 80.62 },
  { district_id: 'lk-23', province_id: 'lk-2', name: 'Nuwara Eliya', lat: 6.97, lon: 80.78 },
  { district_id: 'lk-31', province_id: 'lk-3', name: 'Galle', lat: 6.05, lon: 80.22 },
  { district_id: 'lk-32', province_id: 'lk-3', name: 'Matara', lat: 5.95, lon: 80.55 },
  { district_id: 'lk-33', province_id: 'lk-3', name: 'Hambantota', lat: 6.12, lon: 81.12 },
  { district_id: 'lk-41', province_id: 'lk-4', name: 'Jaffna', lat: 9.66, lon: 80.02 },
  { district_id: 'lk-42', province_id: 'lk-4', name: 'Kilinochchi', lat: 9.39, lon: 80.4 },
  { district_id: 'lk-43', province_id: 'lk-4', name: 'Mannar', lat: 8.98, lon: 79.9 },
  { district_id: 'lk-44', province_id: 'lk-4', name: 'Vavuniya', lat: 8.75, lon: 80.5 },
  { district_id: 'lk-45', province_id: 'lk-4', name: 'Mullaitivu', lat: 9.27, lon: 80.81 },
  { district_id: 'lk-51', province_id: 'lk-5', name: 'Batticaloa', lat: 7.71, lon: 81.69 },
  { district_id: 'lk-52', province_id: 'lk-5', name: 'Ampara', lat: 7.3, lon: 81.67 },
  { district_id: 'lk-53', province_id: 'lk-5', name: 'Trincomalee', lat: 8.59, lon: 81.21 },
  { district_id: 'lk-61', province_id: 'lk-6', name: 'Kurunegala', lat: 7.49, lon: 80.36 },
  { district_id: 'lk-62', province_id: 'lk-6', name: 'Puttalam', lat: 8.04, lon: 79.83 },
  { district_id: 'lk-71', province_id: 'lk-7', name: 'Anuradhapura', lat: 8.31, lon: 80.4 },
  { district_id: 'lk-72', province_id: 'lk-7', name: 'Polonnaruwa', lat: 7.94, lon: 81.0 },
  { district_id: 'lk-81', province_id: 'lk-8', name: 'Badulla', lat: 6.99, lon: 81.06 },
  { district_id: 'lk-82', province_id: 'lk-8', name: 'Monaragala', lat: 6.87, lon: 81.35 },
  { district_id: 'lk-91', province_id: 'lk-9', name: 'Ratnapura', lat: 6.68, lon: 80.4 },
  { district_id: 'lk-92', province_id: 'lk-9', name: 'Kegalle', lat: 7.25, lon: 80.35 },
];

// the larger districts get a second substation
export const TWO_SUBSTATION_DISTRICTS = new Set(['lk-11', 'lk-12', 'lk-13', 'lk-21', 'lk-61']);
