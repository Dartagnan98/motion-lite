// Hiilite Platform — Public surface.
//
// Import from `@/lib/platform` (or relative path inside motion-lite) rather than
// reaching into individual files. Keeps the import surface visible to reviewers.

export { initPlatformSchema } from './schema'
export {
  ensurePlatformReady,
  ensureTenantForWorkspace,
  resolveActiveTenant,
  tenantId,
  assertTenantOwnsRow,
  type Tenant,
} from './tenant'
export {
  saveToken,
  loadToken,
  updateAccessToken,
  deleteToken,
  type StoredToken,
  type SaveTokenInput,
} from './vault'
export {
  persistSnapshot,
  getLatestSnapshot,
  type PersistSnapshotInput,
  type PersistedSnapshot,
} from './snapshots'
export type {
  Agency,
  Account,
  Domain,
  Integration,
  IntegrationProvider,
  IntegrationLevel,
  IntegrationAuthModel,
  OAuthToken,
  Snapshot,
  ReportTemplate,
  Report,
  ReportSection,
  ReportBlock,
  ReportBlockType,
  AgencyUser,
  AccountUser,
} from './types'
export type {
  AdapterContract,
  ConnectContext,
  ConnectResult,
  FetchSnapshotArgs,
  HealthStatus,
  MetricEnvelope,
  MetricValue,
  MetricSeries,
  AdapterRegistration,
} from './adapter-contract'
export { getAdapter, listProviders } from './integrations'
export {
  getReportWithSections,
  seedSearchPerformanceReport,
  findGscIntegration,
  findAnyGscIntegration,
  listIntegrations,
  listReportsForAccount,
  type BlockWithData,
  type SectionWithBlocks,
  type ReportWithSections,
} from './reports'
