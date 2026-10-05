// Three kinds of caller:
//   device - a meter, authenticated as its installation; can only post readings
//   user   - an SLSEA analyst with a role and jurisdiction; read only
//   admin  - the back-office account that manages installations
export const SCOPES = {
  installationWrite: 'installation-write',
  readNational: 'analyst-read-national',
  readByProvince: 'analyst-read-by-province',
  readByDistrict: 'analyst-read-by-district',
  installationAdmin: 'installation-admin',
} as const;

export const READ_SCOPES = [SCOPES.readNational, SCOPES.readByProvince, SCOPES.readByDistrict];

export type Role = 'national' | 'provincial' | 'district';

export const SCOPE_FOR_ROLE: Record<Role, string> = {
  national: SCOPES.readNational,
  provincial: SCOPES.readByProvince,
  district: SCOPES.readByDistrict,
};

export interface UserPrincipal {
  kind: 'user';
  userId: string;
  role: Role;
  provinceId: string | null; // for district users: the province their district is in
  districtId: string | null;
  scopes: Set<string>;
}

export interface DevicePrincipal {
  kind: 'device';
  installationId: string;
  scopes: Set<string>;
}

export interface AdminPrincipal {
  kind: 'admin';
  clientId: string;
  scopes: Set<string>;
}

export type Principal = UserPrincipal | DevicePrincipal | AdminPrincipal;
