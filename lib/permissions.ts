export const permissionSections = [
  { id: "overview", label: "Visão geral" },
  { id: "assets", label: "Equipamentos" },
  { id: "maintenance", label: "Preventivas" },
  { id: "orders", label: "Ordens de serviço" },
  { id: "inspections", label: "Inspeções" },
  { id: "fuel", label: "Abastecimento" },
  { id: "inventory", label: "Estoque" },
  { id: "purchases", label: "Compras" },
  { id: "reports", label: "Relatórios" },
  { id: "settings", label: "Configurações" },
  { id: "users", label: "Usuários" },
  { id: "audit", label: "Auditoria" },
] as const;

export type PermissionSection = (typeof permissionSections)[number]["id"];
export type PermissionLevel = "none" | "view" | "edit";
export type UserPermissions = Record<PermissionSection, PermissionLevel>;

export const defaultUserPermissions: UserPermissions = {
  overview: "view",
  assets: "edit",
  maintenance: "view",
  orders: "none",
  inspections: "edit",
  fuel: "edit",
  inventory: "none",
  purchases: "edit",
  reports: "view",
  settings: "view",
  users: "none",
  audit: "none",
};

const permissionLevels = new Set<PermissionLevel>(["none", "view", "edit"]);
const sectionIds = new Set<string>(permissionSections.map(({ id }) => id));

export function isUserPermissions(value: unknown): value is UserPermissions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const permissions = value as Record<string, unknown>;
  return Object.keys(permissions).length === permissionSections.length &&
    permissionSections.every(({ id }) => sectionIds.has(id) && permissionLevels.has(permissions[id] as PermissionLevel));
}

export function canAccessSection(
  permissions: UserPermissions | undefined,
  section: PermissionSection,
  action: "view" | "edit",
) {
  if (!permissions) return true;
  const level = permissions[section];
  return action === "view" ? level === "view" || level === "edit" : level === "edit";
}

export function hasValidPermissionDependencies(permissions: UserPermissions) {
  const assetDependentSections: PermissionSection[] = ["maintenance", "orders", "inspections", "fuel"];
  return permissions.assets !== "none" ||
    assetDependentSections.every((section) => permissions[section] === "none");
}
