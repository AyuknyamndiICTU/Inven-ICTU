// Browser entry: transport + roles + types, without the zod schema registry (keeps route JS within budget).
export { ApiError, buildPath, createApiClient } from './client';
export type { ApiClient, ApiClientOptions, ManifestEntry, RouteInput, RouteOutput } from './client';
export { routeManifest } from './manifest';
export { ADMIN_ROLES, ROLE_RANK, roleSatisfies } from './roles';
export type { AdminRole } from './roles';
export type { HttpMethod, RouteId } from './routes';
export type { AdminEventName, AdminEventPayload } from './events';
export type { Problem } from './common';
export type { AdminUser, NotificationPrefs } from './schemas/auth';
export type { IdentifiedResult, IdentifyBody, IdentifyResponse, OpenLoanLine, StudentSummary } from './schemas/kiosk';
export type { Equipment } from './schemas/inventory';
export type { Loan, Receipt } from './schemas/lending';
export type { DirectoryImportDto } from './schemas/students';
export type { StudentTokens } from './schemas/enrollment';
export type { OfflineBundle, OfflineTransaction } from './schemas/offline';
export type { Settings } from './schemas/settings';
