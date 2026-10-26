// Zod-free so browser bundles can import roles without pulling in the schema registry.
export const ADMIN_ROLES = ['SUPER_ADMIN', 'LAB_ADMIN', 'LAB_ASSISTANT', 'VIEWER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/** Role hierarchy: a route's `minRole` is satisfied by that role or any higher one. */
export const ROLE_RANK: Record<AdminRole, number> = { VIEWER: 1, LAB_ASSISTANT: 2, LAB_ADMIN: 3, SUPER_ADMIN: 4 };
export function roleSatisfies(role: AdminRole, minRole: AdminRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minRole];
}
