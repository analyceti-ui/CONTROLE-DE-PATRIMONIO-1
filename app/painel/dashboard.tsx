"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fuelTypes } from "@/lib/fuel";
import type { UserRole } from "@/lib/api";

type Asset = {
  id: string;
  name: string;
  category: string;
  tag: string;
  location: string;
  status: string;
  nextMaintenance: string;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  sharedWithUids: string[];
  sharedWithNames: string[];
  manufacturer: string;
  model: string;
  serialNumber: string;
  purchaseDate: string;
  purchaseCost: number;
  warrantyUntil: string;
  vehicleKm: number | null;
  lastMaintenanceKm: number | null;
  usageHours: number | null;
  unitId: string | null;
  coverPhotoId: string | null;
};
type AssetEditForm = {
  name: string;
  category: string;
  tag: string;
  location: string;
  status: string;
  nextMaintenance: string;
  unitId: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  purchaseDate: string;
  purchaseCost: string;
  warrantyUntil: string;
  vehicleKm: string;
  usageHours: string;
  sharedWithUids: string[];
};

type Profile = { uid: string; email: string; displayName: string; role: UserRole; organizationId: string; mustChangePassword: boolean };
type User = { uid: string; email: string; displayName: string; role: UserRole; active: number; mustChangePassword: number };
type ServiceOrder = {
  id: string;
  asset_id: string;
  assetName: string;
  description: string;
  kind: string;
  priority: string;
  status: string;
  due_date: string;
  labor_cost: number;
  parts_cost: number;
  invoice_number: string | null;
  odometer_km: number | null;
  hours_used: number | null;
};
type OrderFields = { laborCost: string; partsCost: string; invoiceNumber: string; odometerKm: string; hoursUsed: string };
type InventoryItem = { id: string; name: string; sku: string; unit: string; quantity: number; minimum_quantity: number; unit_cost: number };
type PurchaseRequest = { id: string; description: string; quantity: number; estimated_cost: number; status: string; requesterName: string };
type Inspection = { id: string; assetId: string; assetName: string; result: string; notes: string; photoType: string | null; createdAt: string };
type MaintenancePlan = { asset_id: string; interval_days: number | null; interval_km: number | null; interval_hours: number | null; advance_days: number; next_due_km: number | null; next_due_hours: number | null };
type Unit = { id: string; name: string };
type EquipmentTab = "active" | "inactive" | "discarded";
type EquipmentView = "cards" | "list";
type RecordSection = "maintenance" | "orders" | "inspections" | "inventory" | "purchases" | "users" | "audit";
type RecordView = "cards" | "list";
type AuditEntry = {
  id: string;
  created_at: string;
  actor_uid: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details_json: string;
};
type NotificationAlert = {
  assetId: string;
  assetName: string;
  dueDate?: string;
  ownerName: string;
  kind: "maintenance" | "maintenance_km" | "maintenance_hours" | "warranty";
  message: string;
  daysUntil?: number;
  currentValue?: number;
  dueValue?: number;
};
type AssetPhoto = { id: string; photoType: string; caption: string; createdAt: string };
type TransferPhoto = { id: string; photoType: string };
type AssetTransfer = {
  id: string;
  fromUid: string | null;
  toUid: string;
  notes: string;
  createdAt: string;
  fromName: string | null;
  fromEmail: string | null;
  toName: string;
  toEmail: string;
  actorName: string | null;
  photos: TransferPhoto[];
};
type VehicleFuelRecord = {
  id: string;
  odometerKm: number;
  previousOdometerKm: number;
  distanceKm: number;
  amount: number;
  fuelType: string;
  odometerPhotoType: string;
  receiptPhotoType: string;
  createdAt: string;
  userName: string;
};
type VehicleMaintenanceRecord = {
  id: string;
  kind: string;
  description: string;
  odometerKm: number | null;
  maintenanceDistanceKm: number | null;
  completedAt: string | null;
};

async function responseData<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir a operação.");
  return data;
}

function getNotificationKey(alert: NotificationAlert) {
  const phase = alert.daysUntil !== undefined
    ? alert.daysUntil < 0 ? "overdue" : "upcoming"
    : alert.currentValue !== undefined && alert.dueValue !== undefined
      ? alert.currentValue >= alert.dueValue ? "overdue" : "upcoming"
      : "";
  return `${alert.kind}:${alert.assetId}:${alert.dueDate ?? alert.dueValue ?? ""}:${phase}`;
}

function playNotificationTone(context: AudioContext | null) {
  if (!context || context.state !== "running") return;
  const startAt = context.currentTime;
  [880, 660].forEach((frequency, index) => {
    const start = startAt + index * 0.18;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.linearRampToValueAtTime(0.12, start + 0.025);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  });
}

function RecordViewToggle({ value, onChange, label }: { value: RecordView; onChange: (view: RecordView) => void; label: string }) {
  return <div className="equipment-view-toggle" role="group" aria-label={`Visualização de ${label}`}>
    <button className={`button button-secondary compact-button ${value === "cards" ? "active" : ""}`} type="button" aria-pressed={value === "cards"} onClick={() => onChange("cards")}><span aria-hidden="true">▦</span> Cards</button>
    <button className={`button button-secondary compact-button ${value === "list" ? "active" : ""}`} type="button" aria-pressed={value === "list"} onClick={() => onChange("list")}><span aria-hidden="true">☷</span> Lista</button>
  </div>;
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "asset.created": "Equipamento cadastrado",
    "asset.updated": "Equipamento atualizado",
    "asset.deleted": "Equipamento excluído",
    "asset.photo_added": "Fotos adicionadas",
    "asset.photo_cover_updated": "Foto de capa atualizada",
    "asset.photo_deleted": "Foto do equipamento excluída",
    "asset.delivery_recorded": "Entrega registrada",
    "asset.transferred": "Equipamento transferido",
    "vehicle.fueled": "Abastecimento registrado",
    "maintenance_plan.updated": "Preventiva atualizada",
    "service_order.created": "Ordem de serviço aberta",
    "service_order.updated": "Ordem de serviço atualizada",
    "inspection.created": "Inspeção registrada",
    "inventory.created": "Item de estoque cadastrado",
    "inventory.adjusted": "Estoque movimentado",
    "purchase_request.created": "Compra solicitada",
    "purchase_request.updated": "Solicitação de compra atualizada",
    "user.created": "Usuário cadastrado",
    "user.updated": "Usuário atualizado",
    "user.password_changed": "Senha de usuário alterada",
    "notifications.updated": "Preferências de notificação atualizadas",
    "organization.created": "Organização criada",
    "unit.created": "Unidade criada",
    "backup.created": "Backup criado",
  };
  return labels[action] ?? action.replace(/[._]/g, " ");
}

function auditEntityLabel(entityType: string) {
  const labels: Record<string, string> = {
    asset: "Equipamento",
    user: "Usuário",
    service_order: "Ordem de serviço",
    inventory_item: "Item de estoque",
    purchase_request: "Solicitação de compra",
    inspection: "Inspeção",
    backup: "Backup",
    unit: "Unidade",
    organization: "Organização",
  };
  return labels[entityType] ?? entityType.replace(/[._]/g, " ");
}

function auditDetailsLabel(rawDetails: string) {
  try {
    const details = JSON.parse(rawDetails) as Record<string, unknown>;
    const entries = Object.entries(details).filter(([, value]) => value !== null && value !== "");
    if (!entries.length) return "Sem detalhes adicionais";
    return entries.map(([key, value]) => `${key.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}: ${String(value)}`).join(" · ");
  } catch {
    return "Não foi possível interpretar os detalhes desta atividade.";
  }
}

export default function DashboardPage({ section }: { section: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedAssetId = searchParams.get("asset");
  const notificationPanelRef = useRef<HTMLDivElement>(null);
  const notificationKeysRef = useRef<Set<string> | null>(null);
  const loadDataRunningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [orderFields, setOrderFields] = useState<Record<string, OrderFields>>({});
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [maintenancePlans, setMaintenancePlans] = useState<MaintenancePlan[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [assetCategories, setAssetCategories] = useState(["Veículo", "Computador", "Equipamento", "Outro"]);
  const [assetStatuses, setAssetStatuses] = useState(["Em uso", "Disponível", "Em manutenção", "Baixado"]);
  const [equipmentTab, setEquipmentTab] = useState<EquipmentTab>("active");
  const [equipmentView, setEquipmentView] = useState<EquipmentView>("cards");
  const [equipmentCategory, setEquipmentCategory] = useState("all");
  const [assetOptionForm, setAssetOptionForm] = useState({ kind: "category" as "category" | "status", name: "" });
  const [notificationAlerts, setNotificationAlerts] = useState<NotificationAlert[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [externalDeliveryConfigured, setExternalDeliveryConfigured] = useState(false);
  const [organization, setOrganization] = useState<{ id: string; name: string } | null>(null);
  const [reportTotals, setReportTotals] = useState({ count: 0, purchaseCost: 0, inUse: 0, inMaintenance: 0, withoutOwner: 0 });
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [inAppNotifications, setInAppNotifications] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(false);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [creatingUser, setCreatingUser] = useState(false);
  const [recordFormOpen, setRecordFormOpen] = useState<Record<RecordSection, boolean>>({
    maintenance: false,
    orders: false,
    inspections: false,
    inventory: false,
    purchases: false,
    users: false,
    audit: false,
  });
  const [recordQueries, setRecordQueries] = useState<Record<RecordSection, string>>({
    maintenance: "",
    orders: "",
    inspections: "",
    inventory: "",
    purchases: "",
    users: "",
    audit: "",
  });
  const [recordViews, setRecordViews] = useState<Record<RecordSection, RecordView>>({
    maintenance: "cards",
    orders: "cards",
    inspections: "cards",
    inventory: "cards",
    purchases: "cards",
    users: "cards",
    audit: "list",
  });
  const [auditActionFilter, setAuditActionFilter] = useState("all");
  const [selectedQrAsset, setSelectedQrAsset] = useState<Asset | null>(null);
  const [photoZoomUrl, setPhotoZoomUrl] = useState<string | null>(null);
  const [assetPhotos, setAssetPhotos] = useState<AssetPhoto[]>([]);
  const [assetTransfers, setAssetTransfers] = useState<AssetTransfer[]>([]);
  const [fuelRecords, setFuelRecords] = useState<VehicleFuelRecord[]>([]);
  const [vehicleMaintenanceHistory, setVehicleMaintenanceHistory] = useState<VehicleMaintenanceRecord[]>([]);
  const [fuelForm, setFuelForm] = useState({ odometerKm: "", amount: "", fuelType: "", odometerPhoto: null as File | null, receiptPhoto: null as File | null });
  const [fuelAssetId, setFuelAssetId] = useState("");
  const [dedicatedFuelForm, setDedicatedFuelForm] = useState({ odometerKm: "", amount: "", fuelType: "", odometerPhoto: null as File | null, receiptPhoto: null as File | null });
  const [dedicatedFuelRecords, setDedicatedFuelRecords] = useState<VehicleFuelRecord[]>([]);
  const [fuelTypeFilter, setFuelTypeFilter] = useState("all");
  const [savingFuel, setSavingFuel] = useState(false);
  const [loadingAssetDetails, setLoadingAssetDetails] = useState(false);
  const [equipmentPhotoFiles, setEquipmentPhotoFiles] = useState<File[]>([]);
  const [equipmentPhotoCaption, setEquipmentPhotoCaption] = useState("");
  const [photoAction, setPhotoAction] = useState<string | null>(null);
  const selectedQrAssetId = selectedQrAsset?.id;
  const selectedQrAssetCategory = selectedQrAsset?.category;
  const selectedQrAssetVehicleKm = selectedQrAsset?.vehicleKm;
  const [newAssetPhotoFiles, setNewAssetPhotoFiles] = useState<File[]>([]);
  const [newAssetPhotoCaption, setNewAssetPhotoCaption] = useState("");
  const [newAssetOpen, setNewAssetOpen] = useState(false);
  const [assetSettingsOpen, setAssetSettingsOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState(false);
  const [assetEditForm, setAssetEditForm] = useState<AssetEditForm | null>(null);
  const [transferAsset, setTransferAsset] = useState<Asset | null>(null);
  const [transferForm, setTransferForm] = useState({ toUid: "", notes: "", photos: [] as File[] });
  const [transferExtraPhotos, setTransferExtraPhotos] = useState<Record<string, File[]>>({});
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });
  const [orderForm, setOrderForm] = useState({ assetId: "", kind: "Corretiva", priority: "Normal", description: "", dueDate: "", laborCost: "", partsCost: "", invoiceNumber: "" });
  const [planForm, setPlanForm] = useState({ assetId: "", intervalDays: "", intervalKm: "", intervalHours: "", advanceDays: "7", nextDueKm: "", nextDueHours: "", nextMaintenance: "" });
  const [inspectionForm, setInspectionForm] = useState({ assetId: "", result: "Aprovada", notes: "", photo: null as File | null, checklist: { pneus: true, freios: true, limpeza: true, seguranca: true } });
  const [inventoryForm, setInventoryForm] = useState({ name: "", sku: "", unit: "un", quantity: "0", minimumQuantity: "0", unitCost: "0" });
  const [requestForm, setRequestForm] = useState({ description: "", quantity: "1", estimatedCost: "0" });
  const [unitName, setUnitName] = useState("");
  const [newOrganization, setNewOrganization] = useState({ name: "", adminName: "", email: "", password: "" });
  const [newUser, setNewUser] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [form, setForm] = useState({
    name: "",
    category: "Veículo",
    tag: "",
    location: "",
    status: "Em uso",
    nextMaintenance: "",
    ownerUid: "",
    sharedWithUids: [] as string[],
    unitId: "",
    manufacturer: "",
    model: "",
    serialNumber: "",
    purchaseDate: "",
    purchaseCost: "",
    warrantyUntil: "",
    vehicleKm: "",
    usageHours: "",
  });

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
    return fetch(path, {
      ...init,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  }, []);

  const loadData = useCallback(async () => {
    if (loadDataRunningRef.current) return;
    loadDataRunningRef.current = true;
    setError("");
    try {
      const profileData = await responseData<Profile>(await api("/api/auth/profile"));
      setProfile(profileData);
      if (profileData.mustChangePassword) {
        setAssets([]); setUsers([]); setOrders([]); setInventory([]); setPurchaseRequests([]);
        setInspections([]); setMaintenancePlans([]); setUnits([]); setNotificationAlerts([]);
        setAssetCategories(["Veículo", "Computador", "Equipamento", "Outro"]);
        setAssetStatuses(["Em uso", "Disponível", "Em manutenção", "Baixado"]);
        setLoading(false);
        return;
      }

      if (section === "assets" || section === "overview" || section === "reports" || section === "fuel") {
        const assetResponse = await api("/api/assets");
        const assetData = await responseData<{ items: Asset[] }>(assetResponse);
        setAssets(assetData.items);
      }

      if (section === "assets") {
        const [optionsResponse, unitsResponse] = await Promise.all([api("/api/asset-options"), api("/api/units")]);
        const options = await responseData<{ categories: string[]; statuses: string[] }>(optionsResponse);
        setAssetCategories(options.categories);
        setAssetStatuses(options.statuses);
        setUnits((await responseData<{ units: Unit[] }>(unitsResponse)).units);
      }

      if (section === "overview" || section === "maintenance") {
        const [notificationResponse, maintenanceResponse] = await Promise.all([api("/api/notifications"), api("/api/maintenance")]);
        const notificationData = await responseData<{ preferences: { inApp: number; emailEnabled: number }; alerts: NotificationAlert[]; externalDeliveryConfigured: boolean }>(notificationResponse);
        setInAppNotifications(Boolean(notificationData.preferences.inApp));
        setEmailNotifications(Boolean(notificationData.preferences.emailEnabled));
        setNotificationAlerts(notificationData.alerts);
        notificationKeysRef.current = new Set(notificationData.alerts.map(getNotificationKey));
        setExternalDeliveryConfigured(notificationData.externalDeliveryConfigured);
        setMaintenancePlans((await responseData<{ plans: MaintenancePlan[] }>(maintenanceResponse)).plans);
      }

      if (section === "orders") {
        const [assetsResponse, ordersResponse] = await Promise.all([api("/api/assets"), api("/api/service-orders")]);
        setAssets((await responseData<{ items: Asset[] }>(assetsResponse)).items);
        setOrders((await responseData<{ orders: ServiceOrder[] }>(ordersResponse)).orders);
      }
      if (section === "inventory") {
        setInventory((await responseData<{ items: InventoryItem[] }>(await api("/api/inventory"))).items);
      }
      if (section === "purchases") {
        setPurchaseRequests((await responseData<{ requests: PurchaseRequest[] }>(await api("/api/purchase-requests"))).requests);
      }
      if (section === "inspections") {
        const [assetsResponse, inspectionsResponse] = await Promise.all([api("/api/assets"), api("/api/inspections")]);
        setAssets((await responseData<{ items: Asset[] }>(assetsResponse)).items);
        setInspections((await responseData<{ inspections: Inspection[] }>(inspectionsResponse)).inspections);
      }
      if (section === "reports") {
        setReportTotals((await responseData<{ totals: typeof reportTotals }>(await api("/api/reports"))).totals);
      }
      if (section === "fuel") {
        setMaintenancePlans((await responseData<{ plans: MaintenancePlan[] }>(await api("/api/maintenance"))).plans);
      }
      if (profileData.role === "admin" && (section === "users" || section === "settings" || section === "overview" || section === "audit")) {
        if (section === "users" || section === "settings" || section === "overview") {
          setUsers((await responseData<{ users: User[] }>(await api("/api/users"))).users);
        }
        if (section === "audit") {
          setAuditEntries((await responseData<{ entries: AuditEntry[] }>(await api("/api/audit"))).entries);
        }
        if (section === "settings") {
          const [optionsResponse, unitsResponse, organizationResponse] = await Promise.all([api("/api/asset-options"), api("/api/units"), api("/api/organizations")]);
          const options = await responseData<{ categories: string[]; statuses: string[] }>(optionsResponse);
          setAssetCategories(options.categories);
          setAssetStatuses(options.statuses);
          setUnits((await responseData<{ units: Unit[] }>(unitsResponse)).units);
          setOrganization((await responseData<{ organization: { id: string; name: string } }>(organizationResponse)).organization);
        }
      }

    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Falha ao carregar o painel.";
      setError(message);
      if (message.includes("login") || message.includes("sessão expirou")) router.replace("/");
    } finally {
      loadDataRunningRef.current = false;
      setLoading(false);
    }
  }, [api, router, section]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (section !== "assets" || !requestedAssetId || loading) return;
    const requestedAsset = assets.find((asset) => asset.id === requestedAssetId);
    if (!requestedAsset) return;
    setSelectedQrAsset(requestedAsset);
    setNotificationOpen(false);
    router.replace("/painel/assets", { scroll: false });
  }, [assets, loading, requestedAssetId, router, section]);

  const profileUid = profile?.uid;
  useEffect(() => {
    if (!profileUid) return;
    setDarkMode(window.localStorage.getItem(`patrimonio-theme-${profileUid}`) === "dark");
    setEquipmentView(window.localStorage.getItem(`patrimonio-equipment-view-${profileUid}`) === "list" ? "list" : "cards");
    setRecordViews({
      maintenance: window.localStorage.getItem(`patrimonio-view-${profileUid}-maintenance`) === "list" ? "list" : "cards",
      orders: window.localStorage.getItem(`patrimonio-view-${profileUid}-orders`) === "list" ? "list" : "cards",
      inspections: window.localStorage.getItem(`patrimonio-view-${profileUid}-inspections`) === "list" ? "list" : "cards",
      inventory: window.localStorage.getItem(`patrimonio-view-${profileUid}-inventory`) === "list" ? "list" : "cards",
      purchases: window.localStorage.getItem(`patrimonio-view-${profileUid}-purchases`) === "list" ? "list" : "cards",
      users: window.localStorage.getItem(`patrimonio-view-${profileUid}-users`) === "list" ? "list" : "cards",
      audit: window.localStorage.getItem(`patrimonio-view-${profileUid}-audit`) === "cards" ? "cards" : "list",
    });
  }, [profileUid]);

  useEffect(() => {
    const unlockAudio = () => {
      if (!audioContextRef.current && typeof window.AudioContext !== "undefined") {
        audioContextRef.current = new window.AudioContext();
      }
      if (audioContextRef.current?.state === "suspended") {
        void audioContextRef.current.resume();
      }
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    if (!profile || profile.mustChangePassword) return;
    let active = true;
    const refreshNotifications = async () => {
      try {
        const data = await responseData<{
          preferences: { inApp: number; emailEnabled: number };
          alerts: NotificationAlert[];
        }>(await api("/api/notifications"));
        if (!active) return;
        const nextKeys = new Set(data.alerts.map(getNotificationKey));
        const previousKeys = notificationKeysRef.current;
        const hasNewAlerts = previousKeys !== null && data.alerts.some((alert) => !previousKeys.has(getNotificationKey(alert)));
        notificationKeysRef.current = nextKeys;
        setNotificationAlerts(data.alerts);
        setInAppNotifications(Boolean(data.preferences.inApp));
        setEmailNotifications(Boolean(data.preferences.emailEnabled));
        if (hasNewAlerts && data.preferences.inApp) playNotificationTone(audioContextRef.current);
      } catch (notificationError) {
        if (active) {
          setError(notificationError instanceof Error
            ? `Não foi possível atualizar as notificações: ${notificationError.message}`
            : "Não foi possível atualizar as notificações.");
        }
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications();
    }, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, profile]);

  useEffect(() => {
    if (!notificationOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !notificationPanelRef.current?.contains(event.target)) {
        setNotificationOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationOpen]);

  useEffect(() => {
    if (section !== "fuel" || !fuelAssetId) {
      setDedicatedFuelRecords([]);
      return;
    }
    let active = true;
    api(`/api/assets/${fuelAssetId}/fuel`)
      .then((response) => responseData<{ records: VehicleFuelRecord[] }>(response))
      .then((data) => { if (active) setDedicatedFuelRecords(data.records); })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar os abastecimentos."); });
    return () => { active = false; };
  }, [api, fuelAssetId, section]);

  useEffect(() => {
    if (section !== "maintenance") return;
    const assetId = new URLSearchParams(window.location.search).get("asset");
    if (assetId && profile?.role === "admin") {
      setPlanForm((current) => ({ ...current, assetId }));
    }
  }, [profile, section]);

  useEffect(() => {
    if (section !== "orders" || searchParams.get("kind") !== "Preventiva" || profile?.role !== "admin") return;
    setOrderForm((current) => ({ ...current, kind: "Preventiva" }));
    setRecordFormOpen((current) => ({ ...current, orders: true }));
  }, [profile?.role, searchParams, section]);

  async function submitFuelRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedQrAsset || !fuelForm.odometerPhoto || !fuelForm.receiptPhoto) return;
    const assetId = selectedQrAsset.id;
    setSavingFuel(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.set("odometerKm", fuelForm.odometerKm);
    body.set("amount", fuelForm.amount);
    body.set("fuelType", fuelForm.fuelType);
    body.set("odometerPhoto", fuelForm.odometerPhoto);
    body.set("receiptPhoto", fuelForm.receiptPhoto);
    try {
      const result = await responseData<{ odometerKm: number; previousOdometerKm: number; distanceKm: number }>(
        await api(`/api/assets/${assetId}/fuel`, { method: "POST", body }),
      );
      setFuelForm({
        odometerKm: String(result.odometerKm),
        amount: "",
        fuelType: "",
        odometerPhoto: null,
        receiptPhoto: null,
      });
      setSelectedQrAsset((current) => current?.id === assetId ? {
        ...current,
        vehicleKm: result.odometerKm,
        lastMaintenanceKm: current.lastMaintenanceKm ?? result.previousOdometerKm,
      } : current);
      const history = await responseData<{
        records: VehicleFuelRecord[];
        maintenanceHistory: VehicleMaintenanceRecord[];
      }>(await api(`/api/assets/${assetId}/fuel`));
      setFuelRecords(history.records);
      setVehicleMaintenanceHistory(history.maintenanceHistory);
      setNotice(`Abastecimento salvo. Rodou ${result.distanceKm.toLocaleString("pt-BR")} km desde o registro anterior.`);
      await loadData();
    } catch (fuelError) {
      setError(fuelError instanceof Error ? fuelError.message : "Não foi possível registrar o abastecimento.");
    } finally {
      setSavingFuel(false);
    }
  }

  async function submitDedicatedFuelRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const asset = assets.find((item) => item.id === fuelAssetId);
    if (!asset || !dedicatedFuelForm.odometerPhoto || !dedicatedFuelForm.receiptPhoto) return;
    setSavingFuel(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.set("odometerKm", dedicatedFuelForm.odometerKm);
    body.set("amount", dedicatedFuelForm.amount);
    body.set("fuelType", dedicatedFuelForm.fuelType);
    body.set("odometerPhoto", dedicatedFuelForm.odometerPhoto);
    body.set("receiptPhoto", dedicatedFuelForm.receiptPhoto);
    try {
      const result = await responseData<{ odometerKm: number; previousOdometerKm: number; distanceKm: number }>(
        await api(`/api/assets/${asset.id}/fuel`, { method: "POST", body }),
      );
      setDedicatedFuelForm({ odometerKm: String(result.odometerKm), amount: "", fuelType: "", odometerPhoto: null, receiptPhoto: null });
      const history = await responseData<{ records: VehicleFuelRecord[] }>(await api(`/api/assets/${asset.id}/fuel`));
      setDedicatedFuelRecords(history.records);
      await loadData();
      setNotice(`Abastecimento salvo para ${asset.name}. Rodou ${result.distanceKm.toLocaleString("pt-BR")} km desde o registro anterior.`);
    } catch (fuelError) {
      setError(fuelError instanceof Error ? fuelError.message : "Não foi possível registrar o abastecimento.");
    } finally {
      setSavingFuel(false);
    }
  }

  useEffect(() => {
    const adminSettings = ["settings-equipment", "settings-organization", "settings-backup"];
    if (profile && profile.role !== "admin" && (["users", "audit", "orders", "inventory"].includes(section) || adminSettings.includes(section))) {
      router.replace("/painel");
    }
  }, [profile, router, section]);

  useEffect(() => {
    if (!scanning) return;
    let active = true;
    let stream: MediaStream | undefined;
    const scan = async () => {
      try {
        const BarcodeDetectorConstructor = (window as Window & {
          BarcodeDetector?: new (options: { formats: string[] }) => {
            detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
          };
        }).BarcodeDetector;
        if (!BarcodeDetectorConstructor) {
          setScannerError("A leitura pela câmera não é suportada neste navegador. Você ainda pode pesquisar pelo patrimônio ou usar o QR impresso.");
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = document.querySelector<HTMLVideoElement>("#qr-camera");
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const detector = new BarcodeDetectorConstructor({ formats: ["qr_code"] });
        while (active) {
          const codes = await detector.detect(video);
          const value = codes[0]?.rawValue;
          if (value) {
            let assetId = value;
            try {
              assetId = new URL(value).searchParams.get("asset") || value;
            } catch {
              // Plain text codes are matched against the asset tag below.
            }
            const found = assets.find((asset) => asset.id === assetId || asset.tag === assetId);
            if (found) {
              setSelectedQrAsset(found);
              setScannerError("");
              setScanning(false);
              return;
            }
            setScannerError("QR Code lido, mas esse ativo não está vinculado à sua conta.");
          }
          await new Promise((resolve) => window.setTimeout(resolve, 300));
        }
      } catch (scanError) {
        setScannerError(scanError instanceof Error ? scanError.message : "Não foi possível acessar a câmera.");
      }
    };
    void scan();
    return () => {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [assets, scanning]);

  useEffect(() => {
    if (!selectedQrAssetId) {
      setAssetPhotos([]);
      setAssetTransfers([]);
      setFuelRecords([]);
      setVehicleMaintenanceHistory([]);
      setFuelForm({ odometerKm: "", amount: "", fuelType: "", odometerPhoto: null, receiptPhoto: null });
      setEquipmentPhotoFiles([]);
      setEquipmentPhotoCaption("");
      return;
    }
    let active = true;
    setLoadingAssetDetails(true);
    setEquipmentPhotoFiles([]);
    setEquipmentPhotoCaption("");
    if (selectedQrAssetCategory === "Veículo") {
      setFuelForm({
        odometerKm: String(selectedQrAssetVehicleKm ?? ""),
        amount: "",
        fuelType: "",
        odometerPhoto: null,
        receiptPhoto: null,
      });
    }
    const detailRequest = api(`/api/assets/${selectedQrAssetId}`)
      .then((response) => responseData<{
        asset: {
          shared_with_uids?: string[];
          shared_with_names?: string[];
        };
        photos: AssetPhoto[];
        transfers: AssetTransfer[];
      }>(response))
      .then((data) => {
        if (!active) return;
        const sharedWithUids = Array.isArray(data.asset.shared_with_uids) ? data.asset.shared_with_uids.map(String) : [];
        const sharedWithNames = Array.isArray(data.asset.shared_with_names) ? data.asset.shared_with_names.map(String) : [];
        setSelectedQrAsset((current) => current?.id === selectedQrAssetId ? {
          ...current,
          sharedWithUids,
          sharedWithNames,
        } : current);
        setAssetPhotos(data.photos);
        setAssetTransfers(data.transfers);
      });
    const fuelRequest = selectedQrAssetCategory === "Veículo"
      ? api(`/api/assets/${selectedQrAssetId}/fuel`)
        .then((response) => responseData<{
          records: VehicleFuelRecord[];
          maintenanceHistory: VehicleMaintenanceRecord[];
        }>(response))
        .then((data) => {
          if (!active) return;
          setFuelRecords(data.records);
          setVehicleMaintenanceHistory(data.maintenanceHistory);
        })
      : Promise.resolve().then(() => {
        if (active) {
          setFuelRecords([]);
          setVehicleMaintenanceHistory([]);
        }
      });
    void Promise.all([detailRequest, fuelRequest])
      .catch((detailsError: unknown) => {
        if (active) setError(detailsError instanceof Error ? detailsError.message : "Não foi possível carregar o histórico do equipamento.");
      })
      .finally(() => {
        if (active) setLoadingAssetDetails(false);
      });
    return () => {
      active = false;
    };
  }, [api, selectedQrAssetCategory, selectedQrAssetId, selectedQrAssetVehicleKm]);

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return assets;
    return assets.filter((asset) =>
      [asset.name, asset.category, asset.tag, asset.location, asset.status, asset.ownerEmail, asset.manufacturer, asset.model, asset.serialNumber]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [assets, query]);
  const categoryFilteredAssets = useMemo(
    () => equipmentCategory === "all" ? filteredAssets : filteredAssets.filter((asset) => asset.category === equipmentCategory),
    [equipmentCategory, filteredAssets],
  );
  const equipmentAssets = useMemo(() => categoryFilteredAssets.filter((asset) => {
    const status = asset.status.trim().toLocaleLowerCase("pt-BR");
    const isDiscarded = ["baixado", "descartado", "descartados"].includes(status);
    if (equipmentTab === "discarded") return isDiscarded;
    if (equipmentTab === "active") return status === "em uso" || status === "ativo" || status === "ativa";
    return !isDiscarded && status !== "em uso" && status !== "ativo" && status !== "ativa";
  }), [equipmentTab, categoryFilteredAssets]);
  const fuelAssets = useMemo(() => assets.filter((asset) => {
    const category = asset.category.toLocaleLowerCase("pt-BR");
    const name = asset.name.toLocaleLowerCase("pt-BR");
    const eligibleCategory = ["veículo", "veiculo", "carro", "ônibus", "onibus", "caminhão", "caminhao", "trator", "gerador"].includes(category);
    const eligibleName = ["carro", "ônibus", "onibus", "caminhão", "caminhao", "trator", "gerador", "veículo", "veiculo"].some((term) => name.includes(term));
    const status = asset.status.toLocaleLowerCase("pt-BR");
    const usable = !["baixado", "descartado"].includes(status);
    return usable && (eligibleCategory || eligibleName);
  }), [assets]);
  const fuelSpendingByType = useMemo(() => {
    const spending = new Map<string, { amount: number; count: number }>();
    for (const record of dedicatedFuelRecords) {
      const current = spending.get(record.fuelType) ?? { amount: 0, count: 0 };
      spending.set(record.fuelType, { amount: current.amount + record.amount, count: current.count + 1 });
    }
    return [...spending.entries()]
      .map(([fuelType, totals]) => ({ fuelType, ...totals }))
      .sort((a, b) => b.amount - a.amount);
  }, [dedicatedFuelRecords]);
  const filteredDedicatedFuelRecords = useMemo(
    () => fuelTypeFilter === "all" ? dedicatedFuelRecords : dedicatedFuelRecords.filter((record) => record.fuelType === fuelTypeFilter),
    [dedicatedFuelRecords, fuelTypeFilter],
  );

  const preventiveNotifications = notificationAlerts.filter((alert) => alert.kind !== "warranty");
  const preventiveAlertCount = preventiveNotifications.length;
  function changeRecordView(key: RecordSection, view: RecordView) {
    setRecordViews((previous) => ({ ...previous, [key]: view }));
    if (profileUid) window.localStorage.setItem(`patrimonio-view-${profileUid}-${key}`, view);
  }
  const filteredAuditEntries = auditEntries.filter((entry) => {
    const text = [entry.actorName, entry.actorEmail, auditActionLabel(entry.action), entry.action, auditEntityLabel(entry.entity_type), entry.entity_type, entry.entity_id, entry.details_json]
      .join(" ")
      .toLocaleLowerCase("pt-BR");
    const matchesQuery = text.includes(recordQueries.audit.trim().toLocaleLowerCase("pt-BR"));
    return matchesQuery && (auditActionFilter === "all" || entry.action === auditActionFilter);
  });
  const auditActorCount = new Set(auditEntries.map((entry) => entry.actor_uid || entry.actorEmail || "system")).size;
  const auditTodayCount = auditEntries.filter((entry) => {
    const date = new Date(entry.created_at);
    const now = new Date();
    return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  }).length;
  const auditActionTypes = [...new Set(auditEntries.map((entry) => entry.action))];
  const sectionTitles: Record<string, string> = {
    overview: "Visão geral",
    assets: "Equipamentos",
    maintenance: "Manutenção preventiva",
    orders: "Ordens de serviço",
    inspections: "Inspeções",
    fuel: "Abastecimento",
    inventory: "Estoque",
    purchases: "Solicitações de compra",
    reports: "Relatórios",
    settings: "Configurações",
    "settings-account": "Minha conta",
    "settings-notifications": "Notificações",
    "settings-equipment": "Equipamentos",
    "settings-organization": "Organização",
    "settings-backup": "Cópia de segurança",
    users: "Usuários",
    audit: "Auditoria",
  };
  const pageTitle = sectionTitles[section] ?? "Visão geral";
  async function addAsset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    let createdAssetId = "";
    try {
      const ownerName = users.find((user) => user.uid === (form.ownerUid || profile?.uid))?.displayName;
      const createdAsset = await responseData<{ id: string }>(await api("/api/assets", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          ownerUid: form.ownerUid || profile?.uid,
          sharedWithUids: form.sharedWithUids,
          purchaseCost: Number(form.purchaseCost || 0),
          vehicleKm: form.vehicleKm === "" ? null : Number(form.vehicleKm),
          usageHours: form.usageHours === "" ? null : Number(form.usageHours),
        }),
      }));
      createdAssetId = createdAsset.id;
      if (newAssetPhotoFiles.length) {
        const photoForm = new FormData();
        newAssetPhotoFiles.forEach((photo) => photoForm.append("photos", photo));
        if (newAssetPhotoCaption.trim()) photoForm.set("caption", newAssetPhotoCaption.trim());
        await responseData(await api(`/api/assets/${createdAsset.id}/photos`, { method: "POST", body: photoForm }));
      }
      setForm({ name: "", category: "Veículo", tag: "", location: "", status: "Em uso", nextMaintenance: "", ownerUid: "", sharedWithUids: [], unitId: "", manufacturer: "", model: "", serialNumber: "", purchaseDate: "", purchaseCost: "", warrantyUntil: "", vehicleKm: "", usageHours: "" });
      setNewAssetPhotoFiles([]);
      setNewAssetPhotoCaption("");
      setNewAssetOpen(false);
      setNotice(profile?.role === "admin" && ownerName
        ? `Ativo cadastrado e vinculado a ${ownerName}.`
        : "Ativo cadastrado com sucesso.");
      await loadData();
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Não foi possível cadastrar o ativo.";
      if (createdAssetId) {
        setForm({ name: "", category: "Veículo", tag: "", location: "", status: "Em uso", nextMaintenance: "", ownerUid: "", sharedWithUids: [], unitId: "", manufacturer: "", model: "", serialNumber: "", purchaseDate: "", purchaseCost: "", warrantyUntil: "", vehicleKm: "", usageHours: "" });
        setNewAssetPhotoFiles([]);
        setNewAssetPhotoCaption("");
        setNewAssetOpen(false);
        await loadData();
        setError(`O ativo foi cadastrado, mas as fotos não foram salvas: ${message}`);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function deleteAsset(asset: Asset) {
    if (!window.confirm(`Remover o ativo "${asset.name}"?`)) return;
    setError("");
    setNotice("");
    try {
      await responseData(await api(`/api/assets/${asset.id}`, { method: "DELETE" }));
      if (selectedQrAsset?.id === asset.id) setSelectedQrAsset(null);
      setNotice("Ativo removido.");
      await loadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível remover o ativo.");
    }
  }

  function startTransfer(asset: Asset) {
    setError("");
    setNotice("");
    setTransferAsset(asset);
    setTransferForm({ toUid: asset.ownerUid, notes: "", photos: [] });
  }

  async function addTransferPhotos(event: FormEvent<HTMLFormElement>, transferId: string) {
    event.preventDefault();
    if (!selectedQrAsset) return;
    const photos = transferExtraPhotos[transferId] ?? [];
    if (!photos.length) return;
    const body = new FormData();
    photos.forEach((photo) => body.append("photos", photo));
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await responseData(await api(`/api/assets/${selectedQrAsset.id}/transfers/${transferId}/photos`, { method: "POST", body }));
      setTransferExtraPhotos((current) => ({ ...current, [transferId]: [] }));
      const details = await responseData<{ transfers: AssetTransfer[] }>(await api(`/api/assets/${selectedQrAsset.id}`));
      setAssetTransfers(details.transfers);
      setNotice("Fotos adicionadas ao registro da entrega ou transferência.");
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Não foi possível adicionar as fotos.");
    } finally {
      setBusy(false);
    }
  }

  async function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transferAsset) return;
    const body = new FormData();
    body.set("toUid", transferForm.toUid);
    body.set("notes", transferForm.notes);
    transferForm.photos.forEach((photo) => body.append("photos", photo));
    try {
      const result = await responseData<{ initialDelivery: boolean }>(
        await api(`/api/assets/${transferAsset.id}/transfers`, { method: "POST", body }),
      );
      setNotice(result.initialDelivery ? "Entrega inicial registrada com fotos e observações." : "Transferência concluída e registrada com fotos e observações.");
      setTransferAsset(null);
      setTransferForm({ toUid: "", notes: "", photos: [] });
      if (selectedQrAsset?.id === transferAsset.id) {
        if (!result.initialDelivery) {
          const owner = users.find((user) => user.uid === transferForm.toUid);
          setSelectedQrAsset((current) => current?.id === transferAsset.id ? {
            ...current,
            ownerUid: transferForm.toUid,
            ownerName: owner?.displayName ?? current.ownerName,
            ownerEmail: owner?.email ?? current.ownerEmail,
          } : current);
        } else {
          setSelectedQrAsset((current) => current?.id === transferAsset.id ? { ...current } : current);
        }
      }
      await loadData();
    } catch (transferError) {
      setError(transferError instanceof Error ? transferError.message : "Não foi possível registrar a entrega.");
    }
  }

  async function addEquipmentPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedQrAsset || !equipmentPhotoFiles.length) return;
    const body = new FormData();
    equipmentPhotoFiles.forEach((photo) => body.append("photos", photo));
    body.set("caption", equipmentPhotoCaption.trim());
    try {
      await responseData(await api(`/api/assets/${selectedQrAsset.id}/photos`, { method: "POST", body }));
      setEquipmentPhotoFiles([]);
      setEquipmentPhotoCaption("");
      setNotice("Fotos do equipamento salvas.");
      setSelectedQrAsset((current) => current?.id === selectedQrAsset.id ? { ...current } : current);
      await loadData();
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Não foi possível salvar as fotos.");
    }
  }

  async function setEquipmentCover(photo: AssetPhoto) {
    if (!selectedQrAsset || photo.id === selectedQrAsset.coverPhotoId) return;
    setPhotoAction(`cover:${photo.id}`);
    setError("");
    try {
      await responseData(await api(`/api/assets/${selectedQrAsset.id}/photos/${photo.id}`, { method: "PATCH" }));
      setSelectedQrAsset((current) => current?.id === selectedQrAsset.id ? { ...current, coverPhotoId: photo.id } : current);
      setNotice("Foto de capa atualizada.");
      await loadData();
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Não foi possível atualizar a foto de capa.");
    } finally {
      setPhotoAction(null);
    }
  }

  async function deleteEquipmentPhoto(photo: AssetPhoto) {
    if (!selectedQrAsset || !window.confirm("Excluir esta foto permanentemente do equipamento e do Cloudinary?")) return;
    const remainingPhotos = assetPhotos
      .filter((item) => item.id !== photo.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const nextCoverId = selectedQrAsset.coverPhotoId === photo.id
      ? remainingPhotos[0]?.id ?? null
      : selectedQrAsset.coverPhotoId;
    setPhotoAction(`delete:${photo.id}`);
    setError("");
    try {
      await responseData(await api(`/api/assets/${selectedQrAsset.id}/photos/${photo.id}`, { method: "DELETE" }));
      setAssetPhotos(remainingPhotos);
      setSelectedQrAsset((current) => current?.id === selectedQrAsset.id ? { ...current, coverPhotoId: nextCoverId } : current);
      setNotice("Foto do equipamento excluída.");
      await loadData();
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Não foi possível excluir a foto.");
    } finally {
      setPhotoAction(null);
    }
  }

  function beginEditAsset(asset: Asset) {
    setAssetEditForm({
      name: asset.name,
      category: asset.category,
      tag: asset.tag,
      location: asset.location,
      status: asset.status,
      nextMaintenance: asset.nextMaintenance,
      unitId: asset.unitId ?? "",
      manufacturer: asset.manufacturer,
      model: asset.model,
      serialNumber: asset.serialNumber,
      purchaseDate: asset.purchaseDate,
      purchaseCost: String(asset.purchaseCost ?? 0),
      warrantyUntil: asset.warrantyUntil,
      vehicleKm: asset.vehicleKm === null ? "" : String(asset.vehicleKm),
      usageHours: asset.usageHours === null ? "" : String(asset.usageHours),
      sharedWithUids: asset.sharedWithUids ?? [],
    });
    setError("");
    setEditingAsset(true);
  }

  async function saveAssetChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedQrAsset || !assetEditForm) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { unitId, purchaseDate, purchaseCost, warrantyUntil, sharedWithUids, ...editableFields } = assetEditForm;
    const changes = {
      ...editableFields,
      ...(profile?.role === "admin" ? {
        unitId,
        purchaseDate,
        purchaseCost: Number(purchaseCost || 0),
        warrantyUntil,
        sharedWithUids,
      } : {}),
      vehicleKm: assetEditForm.vehicleKm === "" ? null : Number(assetEditForm.vehicleKm),
      usageHours: assetEditForm.usageHours === "" ? null : Number(assetEditForm.usageHours),
    };
    try {
      await responseData(await api(`/api/assets/${selectedQrAsset.id}`, {
        method: "PATCH",
        body: JSON.stringify(changes),
      }));
      const sharedWithNames = profile?.role === "admin" && Array.isArray(sharedWithUids)
        ? sharedWithUids.map((uid) => users.find((person) => person.uid === uid)?.displayName || users.find((person) => person.uid === uid)?.email || uid)
        : [];
      setSelectedQrAsset((current) => current?.id === selectedQrAsset.id ? {
        ...current,
        ...changes,
        sharedWithUids: profile?.role === "admin" ? sharedWithUids : current.sharedWithUids,
        sharedWithNames,
        purchaseCost: typeof changes.purchaseCost === "number" ? changes.purchaseCost : current.purchaseCost,
      } : current);
      setEditingAsset(false);
      setAssetEditForm(null);
      setNotice("Dados do equipamento atualizados.");
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar as alterações.");
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(user: User, role: UserRole) {
    setError("");
    setNotice("");
    try {
      await responseData(await api(`/api/users/${user.uid}`, { method: "PATCH", body: JSON.stringify({ role }) }));
      setNotice(`Perfil de ${user.email} atualizado.`);
      await loadData();
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : "Não foi possível atualizar o perfil.");
    }
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatingUser(true);
    setError("");
    setNotice("");
    try {
      await responseData(await api("/api/users", {
        method: "POST",
        body: JSON.stringify(newUser),
      }));
      setNewUser({ name: "", email: "", password: "" });
      setRecordFormOpen((previous) => ({ ...previous, users: false }));
      setNotice("Acesso criado. Compartilhe o e-mail e a senha inicial com o usuário.");
      await loadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Não foi possível criar o acesso.");
    } finally {
      setCreatingUser(false);
    }
  }

  async function addServiceOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/service-orders", {
        method: "POST",
        body: JSON.stringify({
          ...orderForm,
          laborCost: Number(orderForm.laborCost || 0),
          partsCost: Number(orderForm.partsCost || 0),
          invoiceNumber: orderForm.invoiceNumber.trim(),
        }),
      }));
      setOrderForm({ assetId: "", kind: "Corretiva", priority: "Normal", description: "", dueDate: "", laborCost: "", partsCost: "", invoiceNumber: "" });
      setRecordFormOpen((previous) => ({ ...previous, orders: false }));
      setNotice("Ordem de serviço aberta.");
      await loadData();
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "Não foi possível abrir a ordem.");
    }
  }

  async function updateServiceOrder(order: ServiceOrder, status: string, fields: OrderFields) {
    try {
      await responseData(await api(`/api/service-orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          laborCost: Number(fields.laborCost || 0),
          partsCost: Number(fields.partsCost || 0),
          invoiceNumber: fields.invoiceNumber.trim(),
          ...(fields.odometerKm === "" ? {} : { odometerKm: Number(fields.odometerKm) }),
          ...(fields.hoursUsed === "" ? {} : { hoursUsed: Number(fields.hoursUsed) }),
        }),
      }));
      setNotice(`Ordem de serviço atualizada: ${status}.`);
      await loadData();
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : "Não foi possível atualizar a ordem.");
    }
  }

  async function saveMaintenancePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/maintenance", {
        method: "POST",
        body: JSON.stringify({
          ...planForm,
          intervalDays: planForm.intervalDays || null,
          intervalKm: planForm.intervalKm || null,
          intervalHours: planForm.intervalHours || null,
          nextDueKm: planForm.nextDueKm || null,
          nextDueHours: planForm.nextDueHours || null,
        }),
      }));
      setPlanForm({ assetId: "", intervalDays: "", intervalKm: "", intervalHours: "", advanceDays: "7", nextDueKm: "", nextDueHours: "", nextMaintenance: "" });
      setRecordFormOpen((previous) => ({ ...previous, maintenance: false }));
      setNotice("Plano preventivo salvo.");
      await loadData();
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Não foi possível salvar o plano.");
    }
  }

  async function addInspection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("assetId", inspectionForm.assetId);
    formData.set("result", inspectionForm.result);
    formData.set("notes", inspectionForm.notes);
    formData.set("checklist", JSON.stringify(inspectionForm.checklist));
    if (inspectionForm.photo) formData.set("photo", inspectionForm.photo);
    try {
      await responseData(await api("/api/inspections", { method: "POST", body: formData }));
      setInspectionForm({ assetId: "", result: "Aprovada", notes: "", photo: null, checklist: { pneus: true, freios: true, limpeza: true, seguranca: true } });
      setRecordFormOpen((previous) => ({ ...previous, inspections: false }));
      setNotice("Inspeção registrada.");
      await loadData();
    } catch (inspectionError) {
      setError(inspectionError instanceof Error ? inspectionError.message : "Não foi possível salvar a inspeção.");
    }
  }

  async function addInventoryItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/inventory", {
        method: "POST",
        body: JSON.stringify({
          ...inventoryForm,
          quantity: Number(inventoryForm.quantity),
          minimumQuantity: Number(inventoryForm.minimumQuantity),
          unitCost: Number(inventoryForm.unitCost),
        }),
      }));
      setInventoryForm({ name: "", sku: "", unit: "un", quantity: "0", minimumQuantity: "0", unitCost: "0" });
      setRecordFormOpen((previous) => ({ ...previous, inventory: false }));
      setNotice("Item adicionado ao estoque.");
      await loadData();
    } catch (inventoryError) {
      setError(inventoryError instanceof Error ? inventoryError.message : "Não foi possível cadastrar o item.");
    }
  }

  async function adjustInventory(item: InventoryItem) {
    const raw = window.prompt(`Saldo atual: ${item.quantity} ${item.unit}. Informe a entrada (+) ou saída (-):`);
    if (!raw) return;
    const quantityDelta = Number(raw.replace(",", "."));
    if (!Number.isFinite(quantityDelta) || quantityDelta === 0) {
      setError("Informe uma quantidade diferente de zero.");
      return;
    }
    const reason = window.prompt("Motivo da movimentação (ex.: compra, uso em manutenção):");
    if (!reason?.trim()) return;
    try {
      await responseData(await api(`/api/inventory/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ quantityDelta, reason }),
      }));
      setNotice("Estoque atualizado.");
      await loadData();
    } catch (inventoryError) {
      setError(inventoryError instanceof Error ? inventoryError.message : "Não foi possível movimentar o estoque.");
    }
  }

  async function addPurchaseRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/purchase-requests", {
        method: "POST",
        body: JSON.stringify({
          description: requestForm.description,
          quantity: Number(requestForm.quantity),
          estimatedCost: Number(requestForm.estimatedCost),
        }),
      }));
      setRequestForm({ description: "", quantity: "1", estimatedCost: "0" });
      setRecordFormOpen((previous) => ({ ...previous, purchases: false }));
      setNotice("Solicitação enviada para aprovação.");
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível enviar a solicitação.");
    }
  }

  async function updatePurchaseRequest(requestId: string, status: string) {
    try {
      await responseData(await api(`/api/purchase-requests/${requestId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }));
      setNotice(`Solicitação ${status.toLowerCase()}.`);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Não foi possível atualizar a solicitação.");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      await responseData(await api("/api/users", {
        method: "PATCH",
        body: JSON.stringify(passwordForm),
      }));
      setPasswordForm({ currentPassword: "", newPassword: "" });
      setProfile((current) => current ? { ...current, mustChangePassword: false } : current);
      setNotice("Senha alterada com sucesso.");
      await loadData();
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Não foi possível alterar a senha.");
    }
  }

  async function updateNotifications(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ inApp: inAppNotifications, emailEnabled: emailNotifications }),
      }));
      setNotice("Preferências de aviso atualizadas.");
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "Não foi possível atualizar os avisos.");
    }
  }

  async function createUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/units", {
        method: "POST",
        body: JSON.stringify({ name: unitName }),
      }));
      setUnitName("");
      setNotice("Unidade adicionada.");
      await loadData();
    } catch (unitError) {
      setError(unitError instanceof Error ? unitError.message : "Não foi possível criar a unidade.");
    }
  }

  async function createAssetOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    try {
      const created = await responseData<{ name: string }>(await api("/api/asset-options", {
        method: "POST",
        body: JSON.stringify(assetOptionForm),
      }));
      if (assetOptionForm.kind === "category") {
        setAssetCategories((previous) => [...previous, created.name].sort((a, b) => a.localeCompare(b, "pt-BR")));
      } else {
        setAssetStatuses((previous) => [...previous, created.name].sort((a, b) => a.localeCompare(b, "pt-BR")));
      }
      setAssetOptionForm({ ...assetOptionForm, name: "" });
      setNotice(assetOptionForm.kind === "category" ? "Categoria adicionada." : "Situação adicionada.");
    } catch (optionError) {
      setError(optionError instanceof Error ? optionError.message : "Não foi possível adicionar a opção.");
    }
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await responseData(await api("/api/organizations", {
        method: "POST",
        body: JSON.stringify(newOrganization),
      }));
      setNewOrganization({ name: "", adminName: "", email: "", password: "" });
      setNotice("Organização criada com acesso administrativo próprio.");
    } catch (organizationError) {
      setError(organizationError instanceof Error ? organizationError.message : "Não foi possível criar a organização.");
    }
  }

  async function setUserActive(user: User, active: boolean) {
    try {
      await responseData(await api(`/api/users/${user.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      }));
      setNotice(`Conta ${active ? "ativada" : "desativada"}.`);
      await loadData();
    } catch (userError) {
      setError(userError instanceof Error ? userError.message : "Não foi possível alterar a conta.");
    }
  }

  async function resetUserPassword(user: User) {
    const password = window.prompt(`Defina uma nova senha inicial para ${user.email} (8 caracteres ou mais):`);
    if (!password) return;
    try {
      await responseData(await api(`/api/users/${user.uid}`, {
        method: "PATCH",
        body: JSON.stringify({ password }),
      }));
      setNotice("Senha redefinida. A conta será solicitada a entrar novamente.");
      await loadData();
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Não foi possível redefinir a senha.");
    }
  }

  async function logout() {
    window.sessionStorage.removeItem("patrimonio-dashboard-cache-v1");
    await api("/api/auth", { method: "DELETE" });
    router.replace("/");
  }

  if (loading) {
    return <main className="loading-screen"><span className="spinner" /> Carregando seus ativos...</main>;
  }

  if (profile?.mustChangePassword) {
    return (
      <main className="auth-page">
        <section className="auth-panel password-required">
          <div className="auth-card">
            <span className="eyebrow">PROTEÇÃO DA CONTA</span>
            <h2>Crie sua senha pessoal</h2>
            <p className="muted">Antes de continuar, troque a senha inicial fornecida pelo administrador.</p>
            {error && <div className="notice error-notice" role="alert">{error}</div>}
            <form className="auth-form" onSubmit={changePassword}>
              <label>Senha inicial<input required type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
              <label>Nova senha<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
              <button className="button button-primary full-width" type="submit">Salvar nova senha <span aria-hidden="true">→</span></button>
              <button className="button button-secondary" type="button" onClick={() => void logout()}>Sair</button>
            </form>
          </div>
        </section>
      </main>
    );
  }

  if (profile && profile.role !== "admin" && ["orders", "inventory", "users", "audit", "settings-equipment", "settings-organization", "settings-backup"].includes(section)) {
    return <main className="loading-screen"><span className="spinner" /> Redirecionando para o painel...</main>;
  }

  return (
    <main className="dashboard-page" data-theme={darkMode ? "dark" : "light"}>
      <aside className="sidebar">
        <Link className="brand" href="/painel"><span className="brand-mark">P</span> patrimônio</Link>
        <div className="side-label">MENU PRINCIPAL</div>
        <Link className={`side-link ${section === "overview" ? "active" : ""}`} href="/painel"><span>▦</span> Visão geral</Link>
        <Link className={`side-link ${section === "assets" ? "active" : ""}`} href="/painel/assets"><span>◫</span> Equipamentos</Link>
        <Link className={`side-link alert-nav ${section === "maintenance" ? "active" : ""}`} href="/painel/maintenance"><span>♢</span> Preventivas{preventiveNotifications.length > 0 && <b className="nav-count">{preventiveNotifications.length}</b>}</Link>
        {profile?.role === "admin" && <Link className={`side-link ${section === "orders" ? "active" : ""}`} href="/painel/orders"><span>⚒</span> Ordens</Link>}
        <Link className={`side-link ${section === "inspections" ? "active" : ""}`} href="/painel/inspections"><span>✓</span> Inspeções</Link>
        <Link className={`side-link ${section === "fuel" ? "active" : ""}`} href="/painel/fuel"><span>⛽</span> Abastecimento</Link>
        {profile?.role === "admin" && <Link className={`side-link ${section === "inventory" ? "active" : ""}`} href="/painel/inventory"><span>▤</span> Estoque</Link>}
        <Link className={`side-link ${section === "purchases" ? "active" : ""}`} href="/painel/purchases"><span>▣</span> Compras</Link>
        <Link className={`side-link ${section === "reports" ? "active" : ""}`} href="/painel/reports"><span>▧</span> Relatórios</Link>
        <Link className={`side-link ${section === "settings" || section.startsWith("settings-") ? "active" : ""}`} href="/painel/settings"><span>⚙</span> Configurações</Link>
        {profile?.role === "admin" && <>
          <Link className={`side-link ${section === "users" ? "active" : ""}`} href="/painel/users"><span>♙</span> Usuários</Link>
          <Link className={`side-link ${section === "audit" ? "active" : ""}`} href="/painel/audit"><span>◷</span> Auditoria</Link>
        </>}
        <div className="sidebar-bottom">
          <div className="sidebar-profile">
            <div className="avatar">{(profile?.displayName || profile?.email || "U").slice(0, 1).toUpperCase()}</div>
            <div className="profile-copy"><strong>{profile?.displayName || profile?.email}</strong><span>{profile?.role === "admin" ? "Administrador" : "Usuário"}</span></div>
          </div>
          <button type="button" className="side-link logout-button" onClick={logout}><span>↪</span> Sair da conta</button>
        </div>
      </aside>

      <section className="main-content">
        <header className="topbar">
          <div><span className="breadcrumb">Patrimônio /</span> <strong>{pageTitle}</strong></div>
          <div className="topbar-actions">
            <div className="notification-control" ref={notificationPanelRef}>
              <button
                type="button"
                className="notification-trigger"
                aria-label={`Notificações${notificationAlerts.length ? `, ${notificationAlerts.length} aviso(s)` : ""}`}
                aria-expanded={notificationOpen}
                aria-haspopup="true"
                onClick={() => setNotificationOpen((open) => !open)}
              >
                <span aria-hidden="true">🔔</span>
                {notificationAlerts.length > 0 && <b>{notificationAlerts.length > 99 ? "99+" : notificationAlerts.length}</b>}
              </button>
              {notificationOpen && <section className="notification-popover" aria-label="Notificações recentes">
                <div className="notification-popover-heading">
                  <strong>Notificações</strong>
                  <span>{notificationAlerts.length} aviso(s)</span>
                </div>
                {notificationAlerts.length ? <div className="notification-popover-list">
                  {notificationAlerts.map((alert) => {
                    const isWarranty = alert.kind === "warranty";
                    const destination = `/painel/assets?asset=${encodeURIComponent(alert.assetId)}`;
                    return <Link
                      className="notification-popover-item"
                      href={destination}
                      key={getNotificationKey(alert)}
                      onClick={() => setNotificationOpen(false)}
                    >
                      <span className={`notification-popover-icon ${alert.message.includes("vencida") ? "is-overdue" : ""}`} aria-hidden="true">{isWarranty ? "◇" : "♢"}</span>
                      <span className="notification-popover-copy">
                        <strong>{alert.assetName}</strong>
                        <span>{alert.message}</span>
                        {profile?.role === "admin" && <small>{alert.ownerName}</small>}
                      </span>
                      <span className="notification-popover-arrow" aria-hidden="true">→</span>
                    </Link>;
                  })}
                </div> : <p className="notification-popover-empty">Nenhum aviso no momento.</p>}
              </section>}
            </div>
            <button
              type="button"
              className="theme-toggle"
              aria-label={darkMode ? "Ativar modo claro" : "Ativar modo escuro"}
              onClick={() => {
                const nextMode = !darkMode;
                setDarkMode(nextMode);
                if (profile) window.localStorage.setItem(`patrimonio-theme-${profile.uid}`, nextMode ? "dark" : "light");
              }}
            >
              <span aria-hidden="true">{darkMode ? "☀" : "☾"}</span>
              <span>{darkMode ? "Modo claro" : "Modo escuro"}</span>
            </button>
            <div className="topbar-user"><span className="status-dot" /> <span className="system-status">Sistema operacional</span><div className="avatar small">{(profile?.displayName || profile?.email || "U").slice(0, 1).toUpperCase()}</div><button type="button" className="topbar-logout" onClick={logout}>Sair</button></div>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div><span className="eyebrow">SEU ESPAÇO DE GESTÃO</span><h1>{pageTitle}</h1><p>{section === "overview" ? "Acompanhe seus ativos e mantenha tudo em ordem." : "Acesse e gerencie as informações desta área."}</p></div>
            <span className="today-date">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date())}</span>
          </div>

          {error && <div className="notice error-notice" role="alert">{error}</div>}
          {notice && <div className="notice success-notice" role="status">{notice}</div>}

          {section === "overview" && <div className="stats-grid">
            <article className="stat-card"><span className="stat-icon blue">▦</span><span className="stat-label">ATIVOS CADASTRADOS</span><strong>{assets.length}</strong><small>Itens sob acompanhamento</small></article>
            <article className="stat-card"><span className="stat-icon amber">◷</span><span className="stat-label">AVISOS DE PREVENTIVA</span><strong>{preventiveAlertCount}</strong><small>Por data, km ou horas de uso</small></article>
            <article className="stat-card"><span className="stat-icon green">✓</span><span className="stat-label">EM USO</span><strong>{assets.filter((asset) => asset.status === "Em uso").length}</strong><small>Ativos em operação</small></article>
            {profile?.role === "admin" && <article className="stat-card"><span className="stat-icon violet">♙</span><span className="stat-label">USUÁRIOS</span><strong>{users.length}</strong><small>Contas cadastradas</small></article>}
          </div>}

          {section === "overview" && <section className="panel alerts-panel" id="avisos">
            <div className="panel-heading">
              <div><span className="eyebrow">ACOMPANHAMENTO</span><h2>Avisos de manutenção</h2><p>Preventivas vencidas ou próximas, por data, quilometragem e horas de uso.</p></div>
              <span className={`badge ${notificationAlerts.length ? "badge-amber" : "badge-green"}`}>{notificationAlerts.length ? `${notificationAlerts.length} aviso${notificationAlerts.length === 1 ? "" : "s"}` : "Tudo em dia"}</span>
            </div>
            {notificationAlerts.length > 0 ? (
              <div className="alert-list">
                {notificationAlerts.map((alert) => {
                  const isWarranty = alert.kind === "warranty";
                  const destination = isWarranty
                    ? `/painel/assets?asset=${encodeURIComponent(alert.assetId)}`
                    : `/painel/maintenance?asset=${encodeURIComponent(alert.assetId)}#preventivas`;
                  return <article className={`alert-item ${alert.message.includes("vencida") ? "alert-overdue" : ""}`} key={getNotificationKey(alert)}>
                    <span className={`alert-icon ${alert.message.includes("vencida") ? "alert-icon-red" : "alert-icon-amber"}`}>{isWarranty ? "◇" : "◷"}</span>
                    <div className="alert-copy"><strong>{alert.assetName}</strong><span>{alert.message}</span></div>
                    <Link className="alert-action" href={destination}>{isWarranty ? "Ver ativo" : "Ver preventiva"}</Link>
                  </article>;
                })}
              </div>
            ) : (
              <div className="alert-empty"><span>✓</span><div><strong>Nenhuma notificação pendente</strong><small>Você será avisado sobre preventivas próximas, atrasadas e garantias a vencer.</small></div></div>
            )}
          </section>}

          {section === "fuel" && <section className="panel" id="abastecimento">
            <div className="panel-heading"><div><span className="eyebrow">COMBUSTÍVEL E QUILOMETRAGEM</span><h2>Abastecimento</h2><p>Registre o hodômetro, o valor pago e os comprovantes dos veículos autorizados.</p></div></div>
            {fuelAssets.length ? <div className="fuel-page-grid">
              <aside className="fuel-asset-list"><strong>Selecionar equipamento</strong>{fuelAssets.map((asset) => <button type="button" key={asset.id} className={`fuel-asset-option ${fuelAssetId === asset.id ? "active" : ""}`} onClick={() => { setFuelAssetId(asset.id); setFuelTypeFilter("all"); const odometer = asset.vehicleKm ?? 0; setDedicatedFuelForm((current) => ({ ...current, odometerKm: String(odometer), fuelType: "" })); }}><span>{asset.category}</span><strong>{asset.name}</strong><small>{asset.vehicleKm === null ? "Sem hodômetro" : `${asset.vehicleKm.toLocaleString("pt-BR")} km`}</small></button>)}</aside>
              {fuelAssetId ? <div className="fuel-workspace">
                {(() => { const asset = fuelAssets.find((item) => item.id === fuelAssetId); if (!asset) return null; return <><div className="fuel-selected-heading"><span>{asset.category}</span><h3>{asset.name}</h3><small>{asset.location || "Localização não informada"}</small></div><form className="fuel-record-form" onSubmit={submitDedicatedFuelRecord}>
                  <strong>Novo abastecimento</strong><div className="fuel-record-fields">
                    <label>Quilometragem atual (km)<input required type="number" min={asset.vehicleKm ?? 0} step="1" value={dedicatedFuelForm.odometerKm} onChange={(event) => setDedicatedFuelForm({ ...dedicatedFuelForm, odometerKm: event.target.value })} /></label>
                    <label>Valor pago (R$)<input required type="number" min="0.01" max="1000000" step="0.01" value={dedicatedFuelForm.amount} onChange={(event) => setDedicatedFuelForm({ ...dedicatedFuelForm, amount: event.target.value })} /></label>
                    <label>Tipo de combustível<select required value={dedicatedFuelForm.fuelType} onChange={(event) => setDedicatedFuelForm({ ...dedicatedFuelForm, fuelType: event.target.value })}><option value="">Selecione</option>{fuelTypes.map((fuelType) => <option key={fuelType} value={fuelType}>{fuelType}</option>)}</select></label>
                    <label>Foto do hodômetro<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setDedicatedFuelForm({ ...dedicatedFuelForm, odometerPhoto: event.target.files?.[0] ?? null })} /><small>{dedicatedFuelForm.odometerPhoto?.name ?? "Obrigatória · JPG, PNG ou WebP"}</small></label>
                    <label>Foto do cupom<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setDedicatedFuelForm({ ...dedicatedFuelForm, receiptPhoto: event.target.files?.[0] ?? null })} /><small>{dedicatedFuelForm.receiptPhoto?.name ?? "Obrigatória · JPG, PNG ou WebP"}</small></label>
                  </div><button className="button button-primary compact-button" type="submit" disabled={savingFuel || !dedicatedFuelForm.odometerKm || !dedicatedFuelForm.amount || !dedicatedFuelForm.fuelType || !dedicatedFuelForm.odometerPhoto || !dedicatedFuelForm.receiptPhoto}>{savingFuel ? "Salvando..." : "Salvar abastecimento"}</button>
                </form><div className="vehicle-history-block fuel-spending-block">
                  <div className="fuel-spending-heading"><div><h4>Gastos por combustível</h4><small>Totais pagos neste equipamento, do maior para o menor.</small></div><label>Filtrar histórico<select aria-label="Filtrar histórico por combustível" value={fuelTypeFilter} onChange={(event) => setFuelTypeFilter(event.target.value)}><option value="all">Todos os combustíveis</option>{fuelSpendingByType.map((item) => <option key={item.fuelType} value={item.fuelType}>{item.fuelType}</option>)}</select></label></div>
                  {fuelSpendingByType.length ? <div className="fuel-spending-grid">{fuelSpendingByType.map((item) => <article key={item.fuelType}><span>{item.fuelType}</span><strong>R$ {item.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong><small>{item.count} abastecimento(s)</small></article>)}</div> : <p className="form-help">Os gastos por combustível aparecerão após os primeiros registros.</p>}
                </div><div className="vehicle-history-block"><h4>Histórico de abastecimentos</h4>{filteredDedicatedFuelRecords.length ? <div className="table-scroll"><table><thead><tr><th>DATA</th><th>COMBUSTÍVEL</th><th>HODÔMETRO</th><th>RODADO</th><th>VALOR</th><th>COMPROVANTES</th></tr></thead><tbody>{filteredDedicatedFuelRecords.map((record) => <tr key={record.id}><td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(record.createdAt))}<small className="table-subtext">{record.userName}</small></td><td>{record.fuelType}</td><td>{record.odometerKm.toLocaleString("pt-BR")} km</td><td>{record.distanceKm.toLocaleString("pt-BR")} km</td><td>R$ {record.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td><td><div className="inline-actions"><a className="text-link" href={`/api/assets/${asset.id}/fuel/${record.id}/odometer`} target="_blank" rel="noreferrer">Hodômetro</a><a className="text-link" href={`/api/assets/${asset.id}/fuel/${record.id}/receipt`} target="_blank" rel="noreferrer">Cupom</a></div></td></tr>)}</tbody></table></div> : <p className="form-help">{dedicatedFuelRecords.length ? "Nenhum abastecimento corresponde ao filtro selecionado." : "Ainda não há abastecimentos registrados."}</p>}</div></>; })()}
              </div> : <div className="empty-panel">Selecione um veículo, carro, ônibus, caminhão, trator ou gerador para registrar o abastecimento.</div>}
            </div> : <p className="empty-panel">Nenhum veículo, carro, ônibus, caminhão, trator ou gerador está vinculado à sua conta.</p>}
          </section>}

          {section === "assets" && <>
          <section className="panel" id="ativos">
            <div className="panel-heading assets-heading">
              <div><span className="eyebrow">INVENTÁRIO</span><h2>{profile?.role === "admin" ? "Equipamentos" : "Meu patrimônio"}</h2><p>{profile?.role === "admin" ? `${equipmentAssets.length} equipamento(s) nesta lista · abra uma linha ou cartão para ver detalhes e editar.` : "Abra uma linha ou cartão para consultar os detalhes do patrimônio vinculado a você."}</p></div>
              <div className="assets-heading-actions">
                <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ativo..." aria-label="Buscar ativo" /></label>
                <label className="equipment-category-filter"><span>Categoria</span><select aria-label="Filtrar por categoria" value={equipmentCategory} onChange={(event) => setEquipmentCategory(event.target.value)}><option value="all">Todas as categorias</option>{assetCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                <div className="equipment-view-toggle" role="group" aria-label="Visualização dos equipamentos">
                  <button className={`button button-secondary compact-button ${equipmentView === "cards" ? "active" : ""}`} type="button" aria-pressed={equipmentView === "cards"} onClick={() => { setEquipmentView("cards"); if (profileUid) window.localStorage.setItem(`patrimonio-equipment-view-${profileUid}`, "cards"); }}><span aria-hidden="true">▦</span> Cards</button>
                  <button className={`button button-secondary compact-button ${equipmentView === "list" ? "active" : ""}`} type="button" aria-pressed={equipmentView === "list"} onClick={() => { setEquipmentView("list"); if (profileUid) window.localStorage.setItem(`patrimonio-equipment-view-${profileUid}`, "list"); }}><span aria-hidden="true">☷</span> Lista</button>
                </div>
                <button className="button button-secondary compact-button" type="button" onClick={() => { setScannerError(""); setScanning(true); }}>Ler QR</button>
                {profile?.role === "admin" && <button className="button button-secondary compact-button" type="button" onClick={() => setAssetSettingsOpen(true)}>Categorias, situações e unidades</button>}
                <button className="button button-primary compact-button" type="button" onClick={() => { setError(""); setNewAssetOpen(true); }}>+ Novo equipamento</button>
              </div>
            </div>
            <div className="equipment-tabs" role="tablist" aria-label="Filtrar equipamentos por situação">
              {([
                ["active", "Ativos", categoryFilteredAssets.filter((asset) => ["em uso", "ativo", "ativa"].includes(asset.status.trim().toLocaleLowerCase("pt-BR"))).length],
                ["inactive", "Não ativos", categoryFilteredAssets.filter((asset) => {
                  const status = asset.status.trim().toLocaleLowerCase("pt-BR");
                  return !["em uso", "ativo", "ativa", "baixado", "descartado", "descartados"].includes(status);
                }).length],
                ["discarded", "Descartados", categoryFilteredAssets.filter((asset) => ["baixado", "descartado", "descartados"].includes(asset.status.trim().toLocaleLowerCase("pt-BR"))).length],
              ] as const).map(([tab, label, count]) => <button key={tab} type="button" role="tab" aria-selected={equipmentTab === tab} className={`equipment-tab ${equipmentTab === tab ? "active" : ""}`} onClick={() => setEquipmentTab(tab)}>{label}<span>{count}</span></button>)}
            </div>
            {equipmentView === "cards" ? <div className="asset-card-grid">
              {equipmentAssets.map((asset) => (
                <article
                  className="asset-card"
                  key={asset.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir detalhes do equipamento ${asset.name}`}
                  onClick={() => setSelectedQrAsset(asset)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedQrAsset(asset);
                    }
                  }}
                >
                  <div className="asset-card-cover">
                    {asset.coverPhotoId
                      ? <button type="button" className="asset-card-image-button" aria-label={`Ampliar foto de ${asset.name}`} onClick={(event) => { event.stopPropagation(); setPhotoZoomUrl(`/api/assets/${asset.id}/photos/${asset.coverPhotoId}`); }}><Image src={`/api/assets/${asset.id}/photos/${asset.coverPhotoId}`} alt={`Foto de ${asset.name}`} fill sizes="(max-width: 720px) 100vw, (max-width: 1050px) 50vw, 33vw" unoptimized /></button>
                      : <span aria-hidden="true">{asset.category === "Veículo" ? "▰" : asset.category === "Computador" ? "▣" : "◈"}</span>}
                    <span className={`badge ${asset.status === "Em uso" ? "badge-green" : asset.status === "Em manutenção" ? "badge-amber" : "badge-neutral"}`}>{asset.status}</span>
                  </div>
                  <div className="asset-card-body">
                    <div className="asset-card-title"><div><span className="eyebrow">{asset.category}</span><h3>{asset.name}</h3></div></div>
                    <dl className="asset-card-details">
                      <div><dt>Patrimônio / placa</dt><dd>{asset.tag || "—"}</dd></div>
                      <div><dt>Localização</dt><dd>{asset.location || "—"}</dd></div>
                      <div><dt>{asset.sharedWithNames?.length ? "Responsáveis" : "Responsável"}</dt><dd>{[asset.ownerName || asset.ownerEmail || "—", ...(asset.sharedWithNames ?? [])].filter((name, index, names) => name && names.indexOf(name) === index).join("; ")}</dd></div>
                      <div><dt>Próxima preventiva</dt><dd>{asset.nextMaintenance ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${asset.nextMaintenance}T00:00:00`)) : "—"}</dd></div>
                    </dl>
                    <span className="asset-card-hint">Clique para abrir detalhes, fotos e histórico <span aria-hidden="true">→</span></span>
                  </div>
                </article>
              ))}
              {!equipmentAssets.length && <p className="empty-panel">{assets.length ? "Nenhum equipamento nesta categoria corresponde à busca." : profile?.role === "admin" ? "Ainda não há equipamentos. Use “Novo equipamento” para cadastrar o primeiro." : "Nenhum patrimônio está vinculado a você. Peça ao administrador para associar os ativos à sua conta."}</p>}
            </div> : <div className="table-scroll equipment-list-scroll">
              <table className="equipment-list-table">
                <thead><tr><th>EQUIPAMENTO</th><th>CATEGORIA</th><th>PATRIMÔNIO / PLACA</th><th>LOCALIZAÇÃO</th><th>RESPONSÁVEL(IS)</th><th>SITUAÇÃO</th><th>PRÓXIMA PREVENTIVA</th></tr></thead>
                <tbody>{equipmentAssets.map((asset) => (
                  <tr key={asset.id} onClick={() => setSelectedQrAsset(asset)}>
                    <td><button className="equipment-list-open" type="button" aria-label={`Abrir detalhes do equipamento ${asset.name}`} onClick={() => setSelectedQrAsset(asset)}>
                      <span className="equipment-list-thumbnail">{asset.coverPhotoId
                        ? <Image src={`/api/assets/${asset.id}/photos/${asset.coverPhotoId}`} alt="" fill sizes="48px" unoptimized />
                        : <span aria-hidden="true">{asset.category === "Veículo" ? "▰" : asset.category === "Computador" ? "▣" : "◈"}</span>}</span>
                      <strong>{asset.name}</strong>
                    </button></td>
                    <td>{asset.category}</td><td>{asset.tag || "—"}</td><td>{asset.location || "—"}</td>
                    <td>{[asset.ownerName || asset.ownerEmail || "—", ...(asset.sharedWithNames ?? [])].filter((name, index, names) => name && names.indexOf(name) === index).join("; ")}</td>
                    <td><span className={`badge ${asset.status === "Em uso" ? "badge-green" : asset.status === "Em manutenção" ? "badge-amber" : "badge-neutral"}`}>{asset.status}</span></td>
                    <td>{asset.nextMaintenance ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${asset.nextMaintenance}T00:00:00`)) : "—"}</td>
                  </tr>
                ))}
                {!equipmentAssets.length && <tr><td colSpan={7} className="empty-cell">{assets.length ? "Nenhum equipamento nesta categoria corresponde à busca." : profile?.role === "admin" ? "Ainda não há equipamentos. Use “Novo equipamento” para cadastrar o primeiro." : "Nenhum patrimônio está vinculado a você. Peça ao administrador para associar os ativos à sua conta."}</td></tr>}
                </tbody>
              </table>
            </div>}
          </section>
          {newAssetOpen && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !busy) setNewAssetOpen(false); }}>
            <section className="asset-modal asset-create-modal" role="dialog" aria-modal="true" aria-labelledby="new-asset-title">
              <div className="modal-heading"><div><span className="eyebrow">CADASTRO DE PATRIMÔNIO</span><h2 id="new-asset-title">Novo equipamento</h2><p>Preencha os dados principais e complemente as informações do ativo.</p></div><button className="icon-button" type="button" aria-label="Fechar" disabled={busy} onClick={() => setNewAssetOpen(false)}>×</button></div>
              {error && <p className="notice error-notice" role="alert">{error}</p>}
              <form className="asset-form asset-create-form" onSubmit={addAsset}>
                <div className="form-group-heading"><strong>Identificação</strong><span>Informações básicas para localizar o equipamento.</span></div>
                <label>Nome do ativo<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Notebook Dell Latitude" /></label>
                <label>Categoria<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{assetCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label>Patrimônio / placa<input maxLength={80} value={form.tag} onChange={(event) => setForm({ ...form, tag: event.target.value })} placeholder="Ex.: PAT-001" /></label>
                <label>Fabricante<input maxLength={120} value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} /></label>
                <label>Modelo<input maxLength={120} value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} /></label>
                <label>Número de série<input maxLength={120} value={form.serialNumber} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} /></label>
                <div className="form-group-heading"><strong>Conservação e local</strong><span>Registre a situação e onde o ativo está.</span></div>
                <label>Localização<input maxLength={120} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="Ex.: Unidade Centro" /></label>
                <label>Situação<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{assetStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                <label>Próxima preventiva<input type="date" value={form.nextMaintenance} onChange={(event) => setForm({ ...form, nextMaintenance: event.target.value })} /></label>
                {profile?.role === "admin" && <label>Unidade<select value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })}><option value="">Sem unidade</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
                {profile?.role === "admin" && <label>Responsável inicial<select value={form.ownerUid || profile.uid} onChange={(event) => setForm({ ...form, ownerUid: event.target.value })}><option value={profile.uid}>Eu — {profile.displayName || profile.email}</option>{users.filter((user) => user.uid !== profile.uid).map((user) => <option key={user.uid} value={user.uid}>{user.displayName} — {user.email}</option>)}</select><span className="form-help">Selecione o responsável principal do equipamento.</span></label>}
                {profile?.role === "admin" && <div className="wide-field"><strong>Pessoas autorizadas a usar</strong><span className="form-help">Opcional; os usuários selecionados poderão visualizar e usar o equipamento.</span><div className="checkbox-grid">{users.filter((user) => user.uid !== (form.ownerUid || profile.uid)).map((user) => <label key={user.uid} className="checkbox-option"><input type="checkbox" checked={form.sharedWithUids.includes(user.uid)} onChange={(event) => setForm({ ...form, sharedWithUids: event.target.checked ? [...form.sharedWithUids, user.uid] : form.sharedWithUids.filter((uid) => uid !== user.uid) })} />{user.displayName} — {user.email}</label>)}</div></div>}
                <div className="form-group-heading"><strong>Aquisição e uso</strong><span>Dados para garantia, controle de custos e preventivas.</span></div>
                <label>Data da compra<input type="date" value={form.purchaseDate} onChange={(event) => setForm({ ...form, purchaseDate: event.target.value })} /></label>
                <label>Custo de aquisição (R$)<input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(event) => setForm({ ...form, purchaseCost: event.target.value })} /></label>
                <label>Garantia até<input type="date" value={form.warrantyUntil} onChange={(event) => setForm({ ...form, warrantyUntil: event.target.value })} /></label>
                {form.category === "Veículo" && <label>Quilometragem atual<input type="number" min="0" step="1" value={form.vehicleKm} onChange={(event) => setForm({ ...form, vehicleKm: event.target.value })} /></label>}
                <label>Horas de uso<input type="number" min="0" step="1" value={form.usageHours} onChange={(event) => setForm({ ...form, usageHours: event.target.value })} /></label>
                <label>Fotos do equipamento<input key={`new-asset-photos-${newAssetPhotoFiles.length}`} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setNewAssetPhotoFiles(Array.from(event.target.files ?? []))} /><small>{newAssetPhotoFiles.length ? `${newAssetPhotoFiles.length} foto(s) selecionada(s)` : "Opcional · JPG, PNG ou WebP"}</small></label>
                {newAssetPhotoFiles.length > 0 && <label className="wide-field">Descrição das fotos<input maxLength={200} value={newAssetPhotoCaption} onChange={(event) => setNewAssetPhotoCaption(event.target.value)} placeholder="Ex.: Vista frontal do equipamento" /></label>}
                <div className="asset-form-actions"><button className="button button-secondary" type="button" disabled={busy} onClick={() => setNewAssetOpen(false)}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Cadastrar equipamento"}</button></div>
              </form>
            </section>
          </div>}
          {assetSettingsOpen && profile?.role === "admin" && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setAssetSettingsOpen(false); }}>
            <section className="asset-modal asset-options-modal" role="dialog" aria-modal="true" aria-labelledby="asset-options-title">
              <div className="modal-heading"><div><span className="eyebrow">PERSONALIZAR EQUIPAMENTOS</span><h2 id="asset-options-title">Categorias, situações e unidades</h2><p>As opções cadastradas ficam disponíveis para toda a organização.</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={() => setAssetSettingsOpen(false)}>×</button></div>
              {error && <p className="notice error-notice" role="alert">{error}</p>}
              {notice && <p className="notice success-notice" role="status">{notice}</p>}
              <div className="asset-options-grid">
                <form className="asset-options-form" onSubmit={createAssetOption}>
                  <div className="form-group-heading"><strong>Criar categoria ou situação</strong><span>Categoria identifica o tipo de equipamento, como veículo, computador ou ferramenta. Situação indica o estado atual, como em uso, disponível ou em manutenção.</span></div>
                  <label>Tipo<select value={assetOptionForm.kind} onChange={(event) => setAssetOptionForm({ ...assetOptionForm, kind: event.target.value as "category" | "status" })}><option value="category">Categoria</option><option value="status">Situação</option></select></label>
                  <p className="option-type-help">{assetOptionForm.kind === "category" ? "Categoria organiza equipamentos por tipo e também pode ser usada no filtro da tela de equipamentos. Ex.: Ferramentas, Móveis ou Impressoras." : "Situação mostra em que condição ou etapa o equipamento está. Ex.: Em uso, Disponível, Em manutenção ou Aguardando descarte."}</p>
                  <label>Nome<input required maxLength={60} value={assetOptionForm.name} onChange={(event) => setAssetOptionForm({ ...assetOptionForm, name: event.target.value })} placeholder={assetOptionForm.kind === "category" ? "Ex.: Ferramentas" : "Ex.: Em avaliação"} /></label>
                  <button className="button button-primary" type="submit">Adicionar</button>
                  <div className="option-list"><strong>Categorias</strong><div>{assetCategories.map((category) => <span className="option-chip" key={category}>{category}</span>)}</div></div>
                  <div className="option-list"><strong>Situações</strong><div>{assetStatuses.map((status) => <span className="option-chip" key={status}>{status}</span>)}</div></div>
                </form>
                <form className="asset-options-form" onSubmit={createUnit}>
                  <div className="form-group-heading"><strong>Adicionar unidade</strong><span>Organize os equipamentos por local de atendimento.</span></div>
                  <label>Unidade<input required maxLength={100} value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder="Ex.: Filial Centro" /></label>
                  <button className="button button-primary" type="submit">Adicionar unidade</button>
                  <div className="option-list"><strong>Unidades cadastradas</strong><div>{units.map((unit) => <span className="option-chip" key={unit.id}>{unit.name}</span>)}</div></div>
                </form>
              </div>
            </section>
          </div>}
          </>}

          {section === "maintenance" && <section className="panel" id="preventivas">
            <div className="panel-heading">
              <div><span className="eyebrow">PLANEJAMENTO</span><h2>Manutenção preventiva</h2><p>Configure ciclos por data, quilometragem ou horas de uso.</p></div>
              <div className="record-tools">
                <label className="search-box"><span>⌕</span><input value={recordQueries.maintenance} onChange={(event) => setRecordQueries((previous) => ({ ...previous, maintenance: event.target.value }))} placeholder="Buscar preventiva..." aria-label="Buscar preventiva" /></label>
                <RecordViewToggle value={recordViews.maintenance} onChange={(view) => changeRecordView("maintenance", view)} label="preventivas" />
                {profile?.role === "admin" && <button className="button button-primary compact-button" type="button" aria-expanded={recordFormOpen.maintenance} aria-controls="maintenance-create-form" onClick={() => { setError(""); setRecordFormOpen((previous) => ({ ...previous, maintenance: !previous.maintenance })); }}>{recordFormOpen.maintenance ? "Fechar formulário" : "+ Nova preventiva"}</button>}
              </div>
            </div>
            {profile?.role === "admin" && <div className="preventive-alerts">
              <div className="preventive-alerts-heading">
                <div><h3>Preventiva executada? Registre os custos e a nota fiscal</h3><p>O plano desta tela agenda a próxima manutenção. Use o botão abaixo para abrir uma ordem preventiva e informar o valor e o número da NF.</p></div>
                <Link className="button button-primary compact-button" href="/painel/orders?kind=Preventiva">Registrar manutenção</Link>
              </div>
            </div>}
            <section className="preventive-alerts" aria-labelledby="preventive-alerts-title">
              <div className="preventive-alerts-heading">
                <div><h3 id="preventive-alerts-title">Preventivas que precisam de atenção</h3><p>Os avisos abaixo são os mesmos exibidos no sino e levam ao equipamento relacionado.</p></div>
                <span className={`badge ${preventiveNotifications.length ? "badge-amber" : "badge-green"}`}>{preventiveNotifications.length}</span>
              </div>
              {preventiveNotifications.filter((alert) => [alert.assetName, alert.message, alert.ownerName].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.maintenance.trim().toLocaleLowerCase("pt-BR"))).length ? <div className="preventive-alert-list">
                {preventiveNotifications.filter((alert) => [alert.assetName, alert.message, alert.ownerName].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.maintenance.trim().toLocaleLowerCase("pt-BR"))).map((alert) => <Link
                  className={`preventive-alert-row ${alert.message.includes("vencida") ? "is-overdue" : ""}`}
                  href={`/painel/assets?asset=${encodeURIComponent(alert.assetId)}`}
                  key={getNotificationKey(alert)}
                >
                  <span className="notification-popover-icon" aria-hidden="true">♢</span>
                  <span className="preventive-alert-copy"><strong>{alert.assetName}</strong><span>{alert.message}</span></span>
                  {profile?.role === "admin" && <small>{alert.ownerName}</small>}
                  <span className="notification-popover-arrow" aria-hidden="true">→</span>
                </Link>)}
              </div> : <p className="preventive-alert-empty">{preventiveNotifications.length && recordQueries.maintenance.trim() ? "Nenhum aviso corresponde à busca." : "Nenhuma preventiva precisa de atenção agora."}</p>}
            </section>
            {profile?.role === "admin" && recordFormOpen.maintenance && (
              <form id="maintenance-create-form" className="asset-form entry-form" onSubmit={saveMaintenancePlan}>
                <div className="form-group-heading"><strong>Dados da preventiva</strong><span>Escolha o equipamento e configure os intervalos de aviso e recorrência.</span></div>
                <label>Ativo<select required value={planForm.assetId} onChange={(event) => setPlanForm({ ...planForm, assetId: event.target.value })}><option value="">Selecione</option>{assets.filter((asset) => ["Veículo", "Veiculo", "Carro", "Ônibus", "Onibus", "Caminhão", "Caminhao", "Trator", "Gerador"].some((type) => asset.category === type)).map((asset) => <option key={asset.id} value={asset.id}>{asset.name} — {asset.category}</option>)}</select></label>
                <label>Repetir a cada (dias)<input type="number" min="1" value={planForm.intervalDays} onChange={(event) => setPlanForm({ ...planForm, intervalDays: event.target.value })} /></label>
                <label>Repetir a cada (km)<input type="number" min="1" value={planForm.intervalKm} onChange={(event) => setPlanForm({ ...planForm, intervalKm: event.target.value })} /></label>
                <label>Repetir a cada (horas)<input type="number" min="1" value={planForm.intervalHours} onChange={(event) => setPlanForm({ ...planForm, intervalHours: event.target.value })} /></label>
                <label>Avisar com antecedência (dias)<input type="number" min="0" max="365" value={planForm.advanceDays} onChange={(event) => setPlanForm({ ...planForm, advanceDays: event.target.value })} /></label>
                <label>Próxima preventiva<input type="date" value={planForm.nextMaintenance} onChange={(event) => setPlanForm({ ...planForm, nextMaintenance: event.target.value })} /></label>
                <label>Próxima preventiva (km)<input type="number" min="0" value={planForm.nextDueKm} onChange={(event) => setPlanForm({ ...planForm, nextDueKm: event.target.value })} /></label>
                <label>Próxima preventiva (horas)<input type="number" min="0" value={planForm.nextDueHours} onChange={(event) => setPlanForm({ ...planForm, nextDueHours: event.target.value })} /></label>
                <button className="button button-primary add-button" type="submit">Salvar plano</button>
              </form>
            )}
            {maintenancePlans.filter((plan) => [assets.find((asset) => asset.id === plan.asset_id)?.name ?? plan.asset_id, plan.interval_days, plan.interval_km, plan.interval_hours, plan.next_due_km, plan.next_due_hours].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.maintenance.trim().toLocaleLowerCase("pt-BR"))).length ? recordViews.maintenance === "list" ? (
              <div className="table-scroll">
                <table><thead><tr><th>ATIVO</th><th>CICLO (DIAS)</th><th>CICLO (KM)</th><th>CICLO (HORAS)</th><th>PRÓXIMA (KM / HORAS)</th></tr></thead>
                  <tbody>{maintenancePlans.filter((plan) => [assets.find((asset) => asset.id === plan.asset_id)?.name ?? plan.asset_id, plan.interval_days, plan.interval_km, plan.interval_hours, plan.next_due_km, plan.next_due_hours].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.maintenance.trim().toLocaleLowerCase("pt-BR"))).map((plan) => (
                    <tr key={plan.asset_id}>
                      <td>{assets.find((asset) => asset.id === plan.asset_id)?.name ?? plan.asset_id}</td>
                      <td>{plan.interval_days ?? "—"}</td><td>{plan.interval_km ?? "—"}</td><td>{plan.interval_hours ?? "—"}</td>
                      <td>{plan.next_due_km ?? "—"} km / {plan.next_due_hours ?? "—"} h</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <div className="record-card-grid">{maintenancePlans.filter((plan) => [assets.find((asset) => asset.id === plan.asset_id)?.name ?? plan.asset_id, plan.interval_days, plan.interval_km, plan.interval_hours, plan.next_due_km, plan.next_due_hours].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.maintenance.trim().toLocaleLowerCase("pt-BR"))).map((plan) => <article className="record-card" key={plan.asset_id}>
              <div className="record-card-heading"><div><span className="eyebrow">PLANO PREVENTIVO</span><h3>{assets.find((asset) => asset.id === plan.asset_id)?.name ?? plan.asset_id}</h3></div><span className="badge badge-green">Ativo</span></div>
              <dl className="record-card-details"><div><dt>Ciclo</dt><dd>{[plan.interval_days && `${plan.interval_days} dias`, plan.interval_km && `${plan.interval_km} km`, plan.interval_hours && `${plan.interval_hours} horas`].filter(Boolean).join(" · ") || "Sem recorrência definida"}</dd></div><div><dt>Próxima meta</dt><dd>{plan.next_due_km ?? "—"} km · {plan.next_due_hours ?? "—"} h</dd></div><div><dt>Aviso antecipado</dt><dd>{plan.advance_days} dia(s)</dd></div></dl>
            </article>)}</div> : <p className="empty-panel">{maintenancePlans.length && recordQueries.maintenance.trim() ? "Nenhum plano corresponde à busca." : "Ainda não há planos recorrentes configurados. Os avisos de preventivas por data aparecem acima."}</p>}
          </section>}

          {profile?.role === "admin" && section === "orders" && <section className="panel" id="ordens">
            <div className="panel-heading">
              <div><span className="eyebrow">MANUTENÇÃO</span><h2>Ordens de serviço</h2><p>Registre serviços, acompanhe prazos e atualize o andamento.</p></div>
              <div className="record-tools">
                <label className="search-box"><span>⌕</span><input value={recordQueries.orders} onChange={(event) => setRecordQueries((previous) => ({ ...previous, orders: event.target.value }))} placeholder="Buscar ordem..." aria-label="Buscar ordem de serviço" /></label>
                <RecordViewToggle value={recordViews.orders} onChange={(view) => changeRecordView("orders", view)} label="ordens de serviço" />
                <button className="button button-primary compact-button" type="button" aria-expanded={recordFormOpen.orders} aria-controls="orders-create-form" onClick={() => { setError(""); setRecordFormOpen((previous) => ({ ...previous, orders: !previous.orders })); }}>{recordFormOpen.orders ? "Fechar formulário" : "+ Nova ordem"}</button>
              </div>
            </div>
            {recordFormOpen.orders && <form id="orders-create-form" className="asset-form entry-form" onSubmit={addServiceOrder}>
              <div className="form-group-heading"><strong>Dados da ordem</strong><span>Informe o ativo e o serviço. Se já tiver os dados, registre também os custos e o número da nota fiscal.</span></div>
              <label>Ativo<select required value={orderForm.assetId} onChange={(event) => setOrderForm({ ...orderForm, assetId: event.target.value })}><option value="">Selecione</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
              <label>Tipo<select value={orderForm.kind} onChange={(event) => setOrderForm({ ...orderForm, kind: event.target.value })}><option>Corretiva</option><option>Preventiva</option><option>Inspeção</option></select></label>
              <label>Prioridade<select value={orderForm.priority} onChange={(event) => setOrderForm({ ...orderForm, priority: event.target.value })}><option>Baixa</option><option>Normal</option><option>Alta</option><option>Urgente</option></select></label>
              <label>Prazo<input type="date" value={orderForm.dueDate} onChange={(event) => setOrderForm({ ...orderForm, dueDate: event.target.value })} /></label>
              <label className="wide-field">Descrição<input required maxLength={2000} value={orderForm.description} onChange={(event) => setOrderForm({ ...orderForm, description: event.target.value })} placeholder="Descreva o serviço necessário" /></label>
              <label>Mão de obra (R$)<input type="number" min="0" step="0.01" value={orderForm.laborCost} onChange={(event) => setOrderForm({ ...orderForm, laborCost: event.target.value })} placeholder="0,00" /></label>
              <label>Peças e materiais (R$)<input type="number" min="0" step="0.01" value={orderForm.partsCost} onChange={(event) => setOrderForm({ ...orderForm, partsCost: event.target.value })} placeholder="0,00" /></label>
              <label>Nº da nota fiscal<input maxLength={100} value={orderForm.invoiceNumber} onChange={(event) => setOrderForm({ ...orderForm, invoiceNumber: event.target.value })} placeholder="Ex.: 12345" /></label>
              <p className="table-subtext wide-field">Valor total: {(Number(orderForm.laborCost || 0) + Number(orderForm.partsCost || 0)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}. Você pode preencher ou atualizar esses dados depois.</p>
              <button className="button button-primary add-button" type="submit">Abrir ordem</button>
            </form>}
            {orders.filter((order) => [order.assetName, order.kind, order.description, order.priority, order.status, order.due_date, order.invoice_number].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.orders.trim().toLocaleLowerCase("pt-BR"))).length ? recordViews.orders === "list" ? <div className="table-scroll">
              <table><thead><tr><th>ATIVO</th><th>TIPO / DESCRIÇÃO</th><th>PRIORIDADE</th><th>PRAZO</th><th>SITUAÇÃO</th><th>CUSTOS E MEDIÇÕES</th></tr></thead>
                <tbody>{orders.filter((order) => [order.assetName, order.kind, order.description, order.priority, order.status, order.due_date, order.invoice_number].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.orders.trim().toLocaleLowerCase("pt-BR"))).map((order) => {
                  const fields = orderFields[order.id] ?? {
                    laborCost: String(order.labor_cost ?? 0),
                    partsCost: String(order.parts_cost ?? 0),
                    invoiceNumber: order.invoice_number ?? "",
                    odometerKm: order.odometer_km === null ? "" : String(order.odometer_km),
                    hoursUsed: order.hours_used === null ? "" : String(order.hours_used),
                  };
                  const setField = (field: keyof OrderFields, value: string) => {
                    setOrderFields((previous) => ({
                      ...previous,
                      [order.id]: { ...fields, [field]: value },
                    }));
                  };
                  return (
                  <tr key={order.id}>
                    <td>{order.assetName}</td>
                    <td><strong>{order.kind}</strong><small className="table-subtext">{order.description}</small></td>
                    <td>{order.priority}</td><td>{order.due_date || "—"}</td>
                    <td><select className="status-select" aria-label={`Situação da ordem de ${order.assetName}`} value={order.status} onChange={(event) => void updateServiceOrder(order, event.target.value, fields)}><option>Aberta</option><option>Em andamento</option><option>Aguardando peça</option><option>Concluída</option><option>Cancelada</option></select></td>
                    <td><div className="order-fields">
                      <label>Mão de obra (R$)<input type="number" min="0" step="0.01" value={fields.laborCost} onChange={(event) => setField("laborCost", event.target.value)} /></label>
                      <label>Peças e materiais (R$)<input type="number" min="0" step="0.01" value={fields.partsCost} onChange={(event) => setField("partsCost", event.target.value)} /></label>
                      <label>Nº da nota fiscal<input maxLength={100} value={fields.invoiceNumber} onChange={(event) => setField("invoiceNumber", event.target.value)} placeholder="Ex.: 12345" /></label>
                      <label>Km<input type="number" min="0" step="1" value={fields.odometerKm} onChange={(event) => setField("odometerKm", event.target.value)} /></label>
                      <label>Horas<input type="number" min="0" step="1" value={fields.hoursUsed} onChange={(event) => setField("hoursUsed", event.target.value)} /></label>
                      <small className="table-subtext">Total: {(Number(fields.laborCost || 0) + Number(fields.partsCost || 0)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</small>
                      <button className="button button-secondary compact-button" type="button" onClick={() => void updateServiceOrder(order, order.status, fields)}>Salvar</button>
                    </div></td>
                  </tr>
                );})}</tbody>
              </table>
            </div> : <div className="record-card-grid">{orders.filter((order) => [order.assetName, order.kind, order.description, order.priority, order.status, order.due_date, order.invoice_number].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.orders.trim().toLocaleLowerCase("pt-BR"))).map((order) => {
              const fields = orderFields[order.id] ?? {
                laborCost: String(order.labor_cost ?? 0),
                partsCost: String(order.parts_cost ?? 0),
                invoiceNumber: order.invoice_number ?? "",
                odometerKm: order.odometer_km === null ? "" : String(order.odometer_km),
                hoursUsed: order.hours_used === null ? "" : String(order.hours_used),
              };
              return <article className="record-card" key={order.id}>
                <div className="record-card-heading"><div><span className="eyebrow">{order.kind} · {order.priority}</span><h3>{order.assetName}</h3></div><span className={`badge ${order.status === "Concluída" ? "badge-green" : order.status === "Cancelada" ? "badge-neutral" : "badge-amber"}`}>{order.status}</span></div>
                <p className="record-card-description">{order.description}</p>
                <dl className="record-card-details"><div><dt>Prazo</dt><dd>{order.due_date || "—"}</dd></div></dl>
                <div className="record-card-edit-grid">
                  <label>Situação<select className="status-select" value={order.status} onChange={(event) => void updateServiceOrder(order, event.target.value, fields)}><option>Aberta</option><option>Em andamento</option><option>Aguardando peça</option><option>Concluída</option><option>Cancelada</option></select></label>
                  {(["laborCost", "partsCost", "odometerKm", "hoursUsed"] as const).map((field) => <label key={field}>{field === "laborCost" ? "Mão de obra (R$)" : field === "partsCost" ? "Peças e materiais (R$)" : field === "odometerKm" ? "Km" : "Horas"}<input type="number" min="0" step={field === "laborCost" || field === "partsCost" ? "0.01" : "1"} value={fields[field]} onChange={(event) => setOrderFields((previous) => ({ ...previous, [order.id]: { ...fields, [field]: event.target.value } }))} /></label>)}
                  <label>Nº da nota fiscal<input maxLength={100} value={fields.invoiceNumber} onChange={(event) => setOrderFields((previous) => ({ ...previous, [order.id]: { ...fields, invoiceNumber: event.target.value } }))} placeholder="Ex.: 12345" /></label>
                </div>
                <p className="record-card-description">Valor total: {(Number(fields.laborCost || 0) + Number(fields.partsCost || 0)).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                <button className="button button-secondary compact-button record-card-save" type="button" onClick={() => void updateServiceOrder(order, order.status, fields)}>Salvar alterações</button>
              </article>;
            })}</div> : <p className="empty-panel">{orders.length && recordQueries.orders.trim() ? "Nenhuma ordem corresponde à busca." : "Nenhuma ordem de serviço cadastrada."}</p>}
          </section>}

          {section === "inspections" && <section className="panel" id="inspecoes">
            <div className="panel-heading">
              <div><span className="eyebrow">CONDIÇÃO DO ATIVO</span><h2>Inspeções</h2><p>Registre checklists e anexe fotos de inspeção.</p></div>
              <div className="record-tools">
                <label className="search-box"><span>⌕</span><input value={recordQueries.inspections} onChange={(event) => setRecordQueries((previous) => ({ ...previous, inspections: event.target.value }))} placeholder="Buscar inspeção..." aria-label="Buscar inspeção" /></label>
                <RecordViewToggle value={recordViews.inspections} onChange={(view) => changeRecordView("inspections", view)} label="inspeções" />
                <button className="button button-primary compact-button" type="button" aria-expanded={recordFormOpen.inspections} aria-controls="inspections-create-form" onClick={() => { setError(""); setRecordFormOpen((previous) => ({ ...previous, inspections: !previous.inspections })); }}>{recordFormOpen.inspections ? "Fechar formulário" : "+ Nova inspeção"}</button>
              </div>
            </div>
            {recordFormOpen.inspections && <form id="inspections-create-form" className="asset-form entry-form" onSubmit={addInspection}>
              <div className="form-group-heading"><strong>Dados da inspeção</strong><span>Selecione o equipamento, registre o resultado e marque os itens verificados.</span></div>
              <label>Ativo<select required value={inspectionForm.assetId} onChange={(event) => setInspectionForm({ ...inspectionForm, assetId: event.target.value })}><option value="">Selecione</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
              <label>Resultado<select value={inspectionForm.result} onChange={(event) => setInspectionForm({ ...inspectionForm, result: event.target.value })}><option>Aprovada</option><option>Com ressalvas</option><option>Reprovada</option></select></label>
              <label>Foto (JPG, PNG ou WebP)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setInspectionForm({ ...inspectionForm, photo: event.target.files?.[0] ?? null })} /></label>
              <label className="wide-field">Observações<input maxLength={2000} value={inspectionForm.notes} onChange={(event) => setInspectionForm({ ...inspectionForm, notes: event.target.value })} /></label>
              <div className="checklist-field">
                {Object.entries({ pneus: "Pneus", freios: "Freios", limpeza: "Limpeza", seguranca: "Segurança" }).map(([key, label]) => (
                  <label key={key}><input type="checkbox" checked={inspectionForm.checklist[key as keyof typeof inspectionForm.checklist]} onChange={(event) => setInspectionForm({ ...inspectionForm, checklist: { ...inspectionForm.checklist, [key]: event.target.checked } })} />{label}</label>
                ))}
              </div>
              <button className="button button-primary add-button" type="submit">Registrar inspeção</button>
            </form>}
            {inspections.filter((inspection) => [inspection.assetName, inspection.result, inspection.notes, inspection.createdAt].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.inspections.trim().toLocaleLowerCase("pt-BR"))).length ? recordViews.inspections === "list" ? <div className="table-scroll">
              <table><thead><tr><th>DATA</th><th>ATIVO</th><th>RESULTADO</th><th>OBSERVAÇÕES</th><th>FOTO</th></tr></thead>
                <tbody>{inspections.filter((inspection) => [inspection.assetName, inspection.result, inspection.notes, inspection.createdAt].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.inspections.trim().toLocaleLowerCase("pt-BR"))).map((inspection) => (
                  <tr key={inspection.id}>
                    <td>{new Intl.DateTimeFormat("pt-BR").format(new Date(inspection.createdAt))}</td><td>{inspection.assetName}</td><td>{inspection.result}</td><td>{inspection.notes || "—"}</td>
                    <td>{inspection.photoType ? <a className="text-link" href={`/api/inspections/${inspection.id}/photo`} target="_blank" rel="noreferrer">Ver foto</a> : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div> : <div className="record-card-grid">{inspections.filter((inspection) => [inspection.assetName, inspection.result, inspection.notes, inspection.createdAt].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.inspections.trim().toLocaleLowerCase("pt-BR"))).map((inspection) => <article className="record-card" key={inspection.id}>
              <div className="record-card-heading"><div><span className="eyebrow">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(inspection.createdAt))}</span><h3>{inspection.assetName}</h3></div><span className={`badge ${inspection.result === "Aprovada" ? "badge-green" : inspection.result === "Reprovada" ? "badge-amber" : "badge-neutral"}`}>{inspection.result}</span></div>
              <p className="record-card-description">{inspection.notes || "Sem observações registradas."}</p>
              {inspection.photoType && <a className="text-link" href={`/api/inspections/${inspection.id}/photo`} target="_blank" rel="noreferrer">Ver foto da inspeção →</a>}
            </article>)}</div> : <p className="empty-panel">{inspections.length && recordQueries.inspections.trim() ? "Nenhuma inspeção corresponde à busca." : "Nenhuma inspeção registrada."}</p>}
          </section>}

          {profile?.role === "admin" && section === "inventory" && <section className="panel" id="estoque">
            <div className="panel-heading">
              <div><span className="eyebrow">PEÇAS E MATERIAIS</span><h2>Estoque</h2><p>Veja saldos e identifique itens abaixo do mínimo.</p></div>
              <div className="record-tools">
                <label className="search-box"><span>⌕</span><input value={recordQueries.inventory} onChange={(event) => setRecordQueries((previous) => ({ ...previous, inventory: event.target.value }))} placeholder="Buscar item..." aria-label="Buscar item no estoque" /></label>
                <RecordViewToggle value={recordViews.inventory} onChange={(view) => changeRecordView("inventory", view)} label="itens de estoque" />
                <button className="button button-primary compact-button" type="button" aria-expanded={recordFormOpen.inventory} aria-controls="inventory-create-form" onClick={() => { setError(""); setRecordFormOpen((previous) => ({ ...previous, inventory: !previous.inventory })); }}>{recordFormOpen.inventory ? "Fechar formulário" : "+ Novo item"}</button>
              </div>
            </div>
            {recordFormOpen.inventory && <form id="inventory-create-form" className="asset-form entry-form" onSubmit={addInventoryItem}>
              <div className="form-group-heading"><strong>Cadastro do item</strong><span>Identifique o material e informe o saldo, limite e custo inicial.</span></div>
              <label>Descrição<input required maxLength={120} value={inventoryForm.name} onChange={(event) => setInventoryForm({ ...inventoryForm, name: event.target.value })} /></label>
              <label>Código / SKU<input maxLength={80} value={inventoryForm.sku} onChange={(event) => setInventoryForm({ ...inventoryForm, sku: event.target.value })} /></label>
              <label>Unidade<input required maxLength={20} value={inventoryForm.unit} onChange={(event) => setInventoryForm({ ...inventoryForm, unit: event.target.value })} /></label>
              <label>Saldo inicial<input required type="number" min="0" step="0.01" value={inventoryForm.quantity} onChange={(event) => setInventoryForm({ ...inventoryForm, quantity: event.target.value })} /></label>
              <label>Estoque mínimo<input required type="number" min="0" step="0.01" value={inventoryForm.minimumQuantity} onChange={(event) => setInventoryForm({ ...inventoryForm, minimumQuantity: event.target.value })} /></label>
              <label>Custo unitário (R$)<input required type="number" min="0" step="0.01" value={inventoryForm.unitCost} onChange={(event) => setInventoryForm({ ...inventoryForm, unitCost: event.target.value })} /></label>
              <button className="button button-primary add-button" type="submit">Adicionar item</button>
            </form>}
            {inventory.filter((item) => [item.name, item.sku, item.unit, item.quantity, item.minimum_quantity].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.inventory.trim().toLocaleLowerCase("pt-BR"))).length ? recordViews.inventory === "list" ? <div className="table-scroll">
              <table><thead><tr><th>ITEM</th><th>CÓDIGO</th><th>SALDO</th><th>MÍNIMO</th><th>CUSTO UNITÁRIO</th>{profile?.role === "admin" && <th>MOVIMENTAR</th>}</tr></thead>
                <tbody>{inventory.filter((item) => [item.name, item.sku, item.unit, item.quantity, item.minimum_quantity].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.inventory.trim().toLocaleLowerCase("pt-BR"))).map((item) => (
                  <tr key={item.id} className={item.quantity <= item.minimum_quantity ? "low-stock-row" : ""}>
                    <td>{item.name}{item.quantity <= item.minimum_quantity && <span className="badge badge-amber stock-warning">Estoque baixo</span>}</td><td>{item.sku || "—"}</td><td>{item.quantity} {item.unit}</td><td>{item.minimum_quantity} {item.unit}</td><td>R$ {Number(item.unit_cost).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                    {profile?.role === "admin" && <td><button className="button button-secondary compact-button" type="button" onClick={() => void adjustInventory(item)}>Entrada / saída</button></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div> : <div className="record-card-grid">{inventory.filter((item) => [item.name, item.sku, item.unit, item.quantity, item.minimum_quantity].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.inventory.trim().toLocaleLowerCase("pt-BR"))).map((item) => <article className={`record-card ${item.quantity <= item.minimum_quantity ? "record-card-warning" : ""}`} key={item.id}>
              <div className="record-card-heading"><div><span className="eyebrow">ESTOQUE {item.sku ? `· ${item.sku}` : ""}</span><h3>{item.name}</h3></div><span className={`badge ${item.quantity <= item.minimum_quantity ? "badge-amber" : "badge-green"}`}>{item.quantity <= item.minimum_quantity ? "Estoque baixo" : "Disponível"}</span></div>
              <dl className="record-card-details"><div><dt>Saldo</dt><dd>{item.quantity} {item.unit}</dd></div><div><dt>Mínimo</dt><dd>{item.minimum_quantity} {item.unit}</dd></div><div><dt>Custo unitário</dt><dd>R$ {Number(item.unit_cost).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</dd></div></dl>
              <button className="button button-secondary compact-button" type="button" onClick={() => void adjustInventory(item)}>Entrada / saída</button>
            </article>)}</div> : <p className="empty-panel">{inventory.length && recordQueries.inventory.trim() ? "Nenhum item corresponde à busca." : "Nenhum item de estoque cadastrado."}</p>}
          </section>}

          {section === "purchases" && <section className="panel" id="compras">
            <div className="panel-heading">
              <div><span className="eyebrow">AQUISIÇÕES</span><h2>Solicitações de compra</h2><p>Envie pedidos e acompanhe a aprovação do administrador.</p></div>
              <div className="record-tools">
                <label className="search-box"><span>⌕</span><input value={recordQueries.purchases} onChange={(event) => setRecordQueries((previous) => ({ ...previous, purchases: event.target.value }))} placeholder="Buscar solicitação..." aria-label="Buscar solicitação de compra" /></label>
                <RecordViewToggle value={recordViews.purchases} onChange={(view) => changeRecordView("purchases", view)} label="solicitações de compra" />
                <button className="button button-primary compact-button" type="button" aria-expanded={recordFormOpen.purchases} aria-controls="purchases-create-form" onClick={() => { setError(""); setRecordFormOpen((previous) => ({ ...previous, purchases: !previous.purchases })); }}>{recordFormOpen.purchases ? "Fechar formulário" : "+ Nova solicitação"}</button>
              </div>
            </div>
            {recordFormOpen.purchases && <form id="purchases-create-form" className="asset-form entry-form" onSubmit={addPurchaseRequest}>
              <div className="form-group-heading"><strong>Nova solicitação</strong><span>Descreva o material ou serviço e informe quantidade e custo estimado.</span></div>
              <label className="wide-field">Material ou serviço<input required maxLength={500} value={requestForm.description} onChange={(event) => setRequestForm({ ...requestForm, description: event.target.value })} /></label>
              <label>Quantidade<input required type="number" min="0.01" step="0.01" value={requestForm.quantity} onChange={(event) => setRequestForm({ ...requestForm, quantity: event.target.value })} /></label>
              <label>Custo estimado (R$)<input required type="number" min="0" step="0.01" value={requestForm.estimatedCost} onChange={(event) => setRequestForm({ ...requestForm, estimatedCost: event.target.value })} /></label>
              <button className="button button-primary add-button" type="submit">Enviar solicitação</button>
            </form>}
            {purchaseRequests.filter((request) => [request.description, request.requesterName, request.status, request.quantity, request.estimated_cost].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.purchases.trim().toLocaleLowerCase("pt-BR"))).length ? recordViews.purchases === "list" ? <div className="table-scroll">
              <table><thead><tr><th>DESCRIÇÃO</th><th>QUANTIDADE</th><th>ESTIMATIVA</th><th>SOLICITANTE</th><th>SITUAÇÃO</th>{profile?.role === "admin" && <th>AÇÃO</th>}</tr></thead>
                <tbody>{purchaseRequests.filter((request) => [request.description, request.requesterName, request.status, request.quantity, request.estimated_cost].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.purchases.trim().toLocaleLowerCase("pt-BR"))).map((request) => (
                  <tr key={request.id}><td>{request.description}</td><td>{request.quantity}</td><td>R$ {Number(request.estimated_cost).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td><td>{request.requesterName}</td>
                    <td><span className={`badge ${request.status === "Aprovada" ? "badge-green" : request.status === "Recusada" ? "badge-neutral" : "badge-amber"}`}>{request.status}</span></td>
                    {profile?.role === "admin" && <td>{request.status === "Pendente" && <div className="inline-actions"><button className="button button-primary compact-button" type="button" onClick={() => void updatePurchaseRequest(request.id, "Aprovada")}>Aprovar</button><button className="button button-secondary compact-button" type="button" onClick={() => void updatePurchaseRequest(request.id, "Recusada")}>Recusar</button></div>}</td>}
                  </tr>
                ))}</tbody>
              </table>
            </div> : <div className="record-card-grid">{purchaseRequests.filter((request) => [request.description, request.requesterName, request.status, request.quantity, request.estimated_cost].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.purchases.trim().toLocaleLowerCase("pt-BR"))).map((request) => <article className="record-card" key={request.id}>
              <div className="record-card-heading"><div><span className="eyebrow">SOLICITAÇÃO DE COMPRA</span><h3>{request.description}</h3></div><span className={`badge ${request.status === "Aprovada" ? "badge-green" : request.status === "Recusada" ? "badge-neutral" : "badge-amber"}`}>{request.status}</span></div>
              <dl className="record-card-details"><div><dt>Quantidade</dt><dd>{request.quantity}</dd></div><div><dt>Custo estimado</dt><dd>R$ {Number(request.estimated_cost).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</dd></div><div><dt>Solicitante</dt><dd>{request.requesterName}</dd></div></dl>
              {profile?.role === "admin" && request.status === "Pendente" && <div className="inline-actions"><button className="button button-primary compact-button" type="button" onClick={() => void updatePurchaseRequest(request.id, "Aprovada")}>Aprovar</button><button className="button button-secondary compact-button" type="button" onClick={() => void updatePurchaseRequest(request.id, "Recusada")}>Recusar</button></div>}
            </article>)}</div> : <p className="empty-panel">{purchaseRequests.length && recordQueries.purchases.trim() ? "Nenhuma solicitação corresponde à busca." : "Nenhuma solicitação de compra."}</p>}
          </section>}

          {profile?.role === "admin" && section === "users" && (
            <section className="panel user-panel" id="usuarios">
              <div className="panel-heading">
                <div><span className="eyebrow">ACESSOS</span><h2>Usuários</h2><p>Gerencie quem pode administrar o sistema.</p></div>
                <div className="record-tools">
                  <label className="search-box"><span>⌕</span><input value={recordQueries.users} onChange={(event) => setRecordQueries((previous) => ({ ...previous, users: event.target.value }))} placeholder="Buscar usuário..." aria-label="Buscar usuário" /></label>
                  <RecordViewToggle value={recordViews.users} onChange={(view) => changeRecordView("users", view)} label="usuários" />
                  <button className="button button-primary compact-button" type="button" aria-expanded={recordFormOpen.users} aria-controls="users-create-form" onClick={() => { setError(""); setRecordFormOpen((previous) => ({ ...previous, users: !previous.users })); }}>{recordFormOpen.users ? "Fechar formulário" : "+ Novo usuário"}</button>
                </div>
              </div>
              {recordFormOpen.users && <form id="users-create-form" className="asset-form entry-form user-create-form" onSubmit={addUser}>
                <div className="form-group-heading"><strong>Dados de acesso</strong><span>Crie uma conta de usuário para acessar o sistema.</span></div>
                <label>Nome<input required maxLength={100} value={newUser.name} onChange={(event) => setNewUser({ ...newUser, name: event.target.value })} placeholder="Nome da pessoa" /></label>
                <label>E-mail<input required type="email" maxLength={254} value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })} placeholder="pessoa@empresa.com.br" /></label>
                <label>Senha inicial<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })} placeholder="Mínimo de 8 caracteres" /></label>
                <p className="form-help wide-field">A nova conta começa como Usuário. Se necessário, altere o perfil na lista após o cadastro.</p>
                <button className="button button-primary add-button" type="submit" disabled={creatingUser}>{creatingUser ? "Criando..." : "+ Criar acesso"}</button>
              </form>}
              {recordViews.users === "list" ? <div className="table-scroll">
                <table>
                  <thead><tr><th>USUÁRIO</th><th>E-MAIL</th><th>PERFIL</th><th>CONTA</th><th>AÇÕES</th></tr></thead>
                  <tbody>{users.filter((user) => [user.displayName, user.email, user.role, user.active ? "ativa" : "desativada"].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.users.trim().toLocaleLowerCase("pt-BR"))).map((user) => (
                    <tr key={user.uid}>
                      <td><div className="asset-name"><span className="avatar small">{(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}</span><strong>{user.displayName || "Sem nome"}</strong></div></td>
                      <td>{user.email}</td>
                      <td>
                        <select aria-label={`Perfil de ${user.email}`} value={user.role} disabled={user.uid === profile.uid && user.role === "admin"} onChange={(event) => void changeRole(user, event.target.value as UserRole)}>
                          <option value="user">Usuário</option><option value="admin">Administrador</option>
                        </select>
                      </td>
                      <td><span className={`badge ${user.active ? "badge-green" : "badge-neutral"}`}>{user.active ? "Ativa" : "Desativada"}</span>{user.mustChangePassword === 1 && <small className="table-subtext">Senha inicial pendente</small>}</td>
                      <td><div className="inline-actions">
                        {user.uid !== profile.uid && <button className="button button-secondary compact-button" type="button" onClick={() => void setUserActive(user, !user.active)}>{user.active ? "Desativar" : "Ativar"}</button>}
                        <button className="button button-secondary compact-button" type="button" onClick={() => void resetUserPassword(user)}>Redefinir senha</button>
                      </div></td>
                    </tr>
                  ))}{!users.filter((user) => [user.displayName, user.email, user.role, user.active ? "ativa" : "desativada"].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.users.trim().toLocaleLowerCase("pt-BR"))).length && <tr><td colSpan={5} className="empty-cell">{users.length ? "Nenhum usuário corresponde à busca." : "Nenhum usuário cadastrado."}</td></tr>}</tbody>
                </table>
              </div> : <div className="record-card-grid">{users.filter((user) => [user.displayName, user.email, user.role, user.active ? "ativa" : "desativada"].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.users.trim().toLocaleLowerCase("pt-BR"))).map((user) => <article className="record-card" key={user.uid}>
                <div className="record-card-heading"><div className="user-record-identity"><span className="avatar">{(user.displayName || user.email || "U").slice(0, 1).toUpperCase()}</span><div><span className="eyebrow">{user.email}</span><h3>{user.displayName || "Sem nome"}</h3></div></div><span className={`badge ${user.active ? "badge-green" : "badge-neutral"}`}>{user.active ? "Ativa" : "Desativada"}</span></div>
                <div className="record-card-user-role"><label>Perfil<select aria-label={`Perfil de ${user.email}`} value={user.role} disabled={user.uid === profile.uid && user.role === "admin"} onChange={(event) => void changeRole(user, event.target.value as UserRole)}><option value="user">Usuário</option><option value="admin">Administrador</option></select></label>{user.mustChangePassword === 1 && <small className="form-help">Senha inicial pendente</small>}</div>
                <div className="inline-actions">{user.uid !== profile.uid && <button className="button button-secondary compact-button" type="button" onClick={() => void setUserActive(user, !user.active)}>{user.active ? "Desativar" : "Ativar"}</button>}<button className="button button-secondary compact-button" type="button" onClick={() => void resetUserPassword(user)}>Redefinir senha</button></div>
              </article>)}{!users.filter((user) => [user.displayName, user.email, user.role, user.active ? "ativa" : "desativada"].join(" ").toLocaleLowerCase("pt-BR").includes(recordQueries.users.trim().toLocaleLowerCase("pt-BR"))).length && <p className="empty-panel">{users.length ? "Nenhum usuário corresponde à busca." : "Nenhum usuário cadastrado."}</p>}</div>}
            </section>
          )}

          {section === "reports" && <section className="panel" id="relatorios">
            <div className="panel-heading">
              <div><span className="eyebrow">INDICADORES</span><h2>Relatórios</h2><p>Resumo do patrimônio visível para sua conta e exportação em CSV.</p></div>
              <a className="button button-secondary compact-button download-link" href="/api/reports?format=csv">Baixar CSV</a>
            </div>
            <div className="stats-grid report-stats">
              <article className="stat-card"><span className="stat-label">ATIVOS NO RELATÓRIO</span><strong>{reportTotals.count}</strong></article>
              <article className="stat-card"><span className="stat-label">VALOR DE AQUISIÇÃO</span><strong>R$ {reportTotals.purchaseCost.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</strong></article>
              <article className="stat-card"><span className="stat-label">EM MANUTENÇÃO</span><strong>{reportTotals.inMaintenance}</strong></article>
              <article className="stat-card"><span className="stat-label">SEM RESPONSÁVEL</span><strong>{reportTotals.withoutOwner}</strong></article>
            </div>
          </section>}

          {section === "settings" && <section className="panel settings-hub">
            <div className="panel-heading"><div><span className="eyebrow">PREFERÊNCIAS E ADMINISTRAÇÃO</span><h2>Configurações</h2><p>Escolha um tópico para abrir e gerenciar somente aquelas opções.</p></div></div>
            <div className="settings-topic-grid">
              <Link className="settings-topic-card" href="/painel/configuracoes/account"><span className="settings-topic-icon">♙</span><span><strong>Minha conta</strong><small>Alterar sua senha de acesso.</small></span><b>→</b></Link>
              <Link className="settings-topic-card" href="/painel/configuracoes/notifications"><span className="settings-topic-icon">◉</span><span><strong>Notificações</strong><small>Escolher como receber avisos.</small></span><b>→</b></Link>
              {profile?.role === "admin" && <>
                <Link className="settings-topic-card" href="/painel/configuracoes/equipment"><span className="settings-topic-icon">◫</span><span><strong>Equipamentos</strong><small>Gerenciar categorias e situações.</small></span><b>→</b></Link>
                <Link className="settings-topic-card" href="/painel/configuracoes/organization"><span className="settings-topic-icon">⌂</span><span><strong>Organização</strong><small>Unidades e organizações isoladas.</small></span><b>→</b></Link>
                <Link className="settings-topic-card" href="/painel/configuracoes/backup"><span className="settings-topic-icon">▣</span><span><strong>Dados na nuvem</strong><small>Informações de armazenamento e cópias.</small></span><b>→</b></Link>
              </>}
            </div>
          </section>}

          {(section === "settings-account" || section === "settings-notifications" || section === "settings-equipment" || section === "settings-organization" || section === "settings-backup") && <div className="settings-topic-back"><Link className="text-link" href="/painel/settings">← Voltar aos tópicos de configurações</Link></div>}

          {section === "settings-account" && <section className="panel settings-topic-page">
            <div className="panel-heading"><div><span className="eyebrow">CONFIGURAÇÕES / CONTA</span><h2>Minha conta</h2><p>Atualize sua senha de acesso ao sistema.</p></div></div>
            <form className="asset-form entry-form settings-form settings-single-form" onSubmit={changePassword}>
              <strong className="form-section-title">Alterar senha</strong>
              <label>Senha atual<input required type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
              <label>Nova senha<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
              <button className="button button-primary add-button" type="submit">Atualizar senha</button>
            </form>
          </section>}

          {section === "settings-notifications" && <section className="panel settings-topic-page">
            <div className="panel-heading"><div><span className="eyebrow">CONFIGURAÇÕES / AVISOS</span><h2>Notificações</h2><p>Escolha os canais disponíveis para receber avisos do sistema.</p></div></div>
            <form className="asset-form entry-form settings-form settings-single-form" onSubmit={updateNotifications}>
              <strong className="form-section-title">Canais de notificação</strong>
              <label className="toggle-option"><input type="checkbox" checked={inAppNotifications} onChange={(event) => setInAppNotifications(event.target.checked)} />Avisos dentro do painel</label>
              <label className="toggle-option"><input type="checkbox" checked={emailNotifications} disabled={!externalDeliveryConfigured} onChange={(event) => setEmailNotifications(event.target.checked)} />Avisos por e-mail {!externalDeliveryConfigured && <small>(serviço não configurado)</small>}</label>
              <button className="button button-primary add-button" type="submit">Salvar preferências</button>
              {!externalDeliveryConfigured && <p className="form-help">Os avisos por e-mail serão habilitados quando um serviço de envio for configurado.</p>}
            </form>
          </section>}

          {profile?.role === "admin" && section === "settings-equipment" && <section className="panel settings-topic-page">
            <div className="panel-heading"><div><span className="eyebrow">CONFIGURAÇÕES / EQUIPAMENTOS</span><h2>Categorias e situações</h2><p>Crie opções para classificar os equipamentos da organização.</p></div></div>
            <form className="asset-form entry-form settings-form settings-single-form" onSubmit={createAssetOption}>
              <strong className="form-section-title">Adicionar uma opção</strong>
              <label>Tipo<select value={assetOptionForm.kind} onChange={(event) => setAssetOptionForm({ ...assetOptionForm, kind: event.target.value as "category" | "status" })}><option value="category">Categoria</option><option value="status">Situação</option></select></label>
              <p className="option-type-help">{assetOptionForm.kind === "category" ? "Categoria identifica o tipo do item e ajuda a organizar e filtrar equipamentos. Exemplos: Veículo, Computador, Ferramentas." : "Situação informa o estado atual do item. Exemplos: Em uso, Disponível, Em manutenção, Baixado."}</p>
              <label>Nome<input required maxLength={60} value={assetOptionForm.name} onChange={(event) => setAssetOptionForm({ ...assetOptionForm, name: event.target.value })} placeholder={assetOptionForm.kind === "category" ? "Ex.: Ferramentas" : "Ex.: Em avaliação"} /></label>
              <button className="button button-primary add-button" type="submit">Adicionar {assetOptionForm.kind === "category" ? "categoria" : "situação"}</button>
              <div className="option-list"><strong>Categorias</strong><div>{assetCategories.map((category) => <span className="option-chip" key={category}>{category}</span>)}</div></div>
              <div className="option-list"><strong>Situações</strong><div>{assetStatuses.map((status) => <span className="option-chip" key={status}>{status}</span>)}</div></div>
            </form>
          </section>}

          {profile?.role === "admin" && section === "settings-organization" && <section className="panel settings-topic-page">
            <div className="panel-heading"><div><span className="eyebrow">CONFIGURAÇÕES / ORGANIZAÇÃO</span><h2>Unidades e organizações</h2><p>Organize locais e crie espaços isolados para outras organizações.</p></div></div>
            <div className="settings-grid">
              <form className="asset-form entry-form settings-form" onSubmit={createUnit}>
                <strong className="form-section-title">Unidades de {organization?.name || "sua organização"}</strong>
                <label>Nome da unidade<input required maxLength={100} value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder="Ex.: Filial Centro" /></label>
                <button className="button button-primary add-button" type="submit">Adicionar unidade</button>
                <ul className="simple-list">{units.map((unit) => <li key={unit.id}>{unit.name}</li>)}</ul>
              </form>
              <form className="asset-form entry-form settings-form" onSubmit={createOrganization}>
                <strong className="form-section-title">Criar outra organização isolada</strong>
                <label>Organização<input required maxLength={120} value={newOrganization.name} onChange={(event) => setNewOrganization({ ...newOrganization, name: event.target.value })} /></label>
                <label>Nome do administrador<input required maxLength={100} value={newOrganization.adminName} onChange={(event) => setNewOrganization({ ...newOrganization, adminName: event.target.value })} /></label>
                <label>E-mail do administrador<input required type="email" maxLength={254} value={newOrganization.email} onChange={(event) => setNewOrganization({ ...newOrganization, email: event.target.value })} /></label>
                <label>Senha inicial<input required type="password" minLength={8} maxLength={128} value={newOrganization.password} onChange={(event) => setNewOrganization({ ...newOrganization, password: event.target.value })} /></label>
                <button className="button button-primary add-button" type="submit">Criar organização</button>
                <p className="form-help">Cada organização terá seu próprio administrador. A troca entre organizações não está disponível nesta conta.</p>
              </form>
            </div>
          </section>}

          {profile?.role === "admin" && section === "settings-backup" && <section className="panel settings-topic-page">
            <div className="panel-heading"><div><span className="eyebrow">CONFIGURAÇÕES / DADOS</span><h2>Dados na nuvem</h2><p>Os dados do sistema são armazenados no PostgreSQL do Supabase e as imagens no Cloudinary.</p></div></div>
            <div className="settings-form backup-card settings-single-form">
              <strong className="form-section-title">Backups e restauração</strong>
              <p>Backups SQLite locais foram desativados para evitar que os dados da Vercel sejam gravados no disco temporário. Para exportar ou restaurar dados, use as ferramentas de backup do Supabase. As imagens ficam gerenciadas na sua conta Cloudinary.</p>
              <p className="form-help">A restauração por arquivo SQLite não é compatível com o armazenamento em nuvem.</p>
            </div>
          </section>}

          {selectedQrAsset && (
            <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) { setSelectedQrAsset(null); setEditingAsset(false); } }}>
              <section className="asset-modal" role="dialog" aria-modal="true" aria-labelledby="asset-modal-title">
                <div className="modal-heading"><div><span className="eyebrow">FICHA DO EQUIPAMENTO</span><h2 id="asset-modal-title">{selectedQrAsset.name}</h2></div><div className="asset-modal-heading-actions">{profile?.role === "admin" && <button className="button button-secondary compact-button danger-text" type="button" onClick={() => void deleteAsset(selectedQrAsset)}>Excluir</button>}{editingAsset
                  ? <button className="button button-secondary compact-button" type="button" onClick={() => { setEditingAsset(false); setAssetEditForm(null); }}>Cancelar edição</button>
                  : <button className="button button-secondary compact-button" type="button" onClick={() => beginEditAsset(selectedQrAsset)}>Editar equipamento</button>}
                  <button className="icon-button" type="button" aria-label="Fechar" onClick={() => { setSelectedQrAsset(null); setEditingAsset(false); }}>×</button></div></div>
                {error && <p className="notice error-notice" role="status">{error}</p>}
                {notice && <p className="notice success-notice" role="status">{notice}</p>}
                {editingAsset && assetEditForm ? <form className="asset-form asset-edit-form" onSubmit={saveAssetChanges}>
                  <div className="form-group-heading"><strong>Identificação</strong><span>Dados básicos do equipamento.</span></div>
                  <label>Nome do ativo<input required maxLength={120} value={assetEditForm.name} onChange={(event) => setAssetEditForm({ ...assetEditForm, name: event.target.value })} /></label>
                  <label>Categoria<select value={assetEditForm.category} onChange={(event) => setAssetEditForm({ ...assetEditForm, category: event.target.value })}>{assetCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
                  <label>Patrimônio / placa<input maxLength={80} value={assetEditForm.tag} onChange={(event) => setAssetEditForm({ ...assetEditForm, tag: event.target.value })} /></label>
                  <label>Fabricante<input maxLength={120} value={assetEditForm.manufacturer} onChange={(event) => setAssetEditForm({ ...assetEditForm, manufacturer: event.target.value })} /></label>
                  <label>Modelo<input maxLength={120} value={assetEditForm.model} onChange={(event) => setAssetEditForm({ ...assetEditForm, model: event.target.value })} /></label>
                  <label>Número de série<input maxLength={120} value={assetEditForm.serialNumber} onChange={(event) => setAssetEditForm({ ...assetEditForm, serialNumber: event.target.value })} /></label>
                  <div className="form-group-heading"><strong>Conservação e local</strong><span>Atualize a situação e a localização.</span></div>
                  <label>Localização<input maxLength={120} value={assetEditForm.location} onChange={(event) => setAssetEditForm({ ...assetEditForm, location: event.target.value })} /></label>
                  <label>Situação<select value={assetEditForm.status} onChange={(event) => setAssetEditForm({ ...assetEditForm, status: event.target.value })}>{assetStatuses.map((status) => <option key={status}>{status}</option>)}</select></label>
                  <label>Próxima preventiva<input type="date" value={assetEditForm.nextMaintenance} onChange={(event) => setAssetEditForm({ ...assetEditForm, nextMaintenance: event.target.value })} /></label>
                  {profile?.role === "admin" && <label>Unidade<select value={assetEditForm.unitId} onChange={(event) => setAssetEditForm({ ...assetEditForm, unitId: event.target.value })}><option value="">Sem unidade</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></label>}
                  {profile?.role === "admin" && <div className="wide-field"><strong>Pessoas autorizadas a usar</strong><span className="form-help">Opcional; permite que outros usuários visualizem este ativo.</span><div className="checkbox-grid">{users.filter((user) => user.uid !== selectedQrAsset.ownerUid).map((user) => <label key={user.uid} className="checkbox-option"><input type="checkbox" checked={assetEditForm.sharedWithUids.includes(user.uid)} onChange={(event) => setAssetEditForm({ ...assetEditForm, sharedWithUids: event.target.checked ? [...assetEditForm.sharedWithUids, user.uid] : assetEditForm.sharedWithUids.filter((uid) => uid !== user.uid) })} />{user.displayName} — {user.email}</label>)}</div></div>}
                  <div className="form-group-heading"><strong>Aquisição e uso</strong>
<span>Dados de compra, garantia e medidores.</span></div>                  {profile?.role === "admin" && <><label>Data da compra<input type="date" value={assetEditForm.purchaseDate} onChange={(event) => setAssetEditForm({ ...assetEditForm, purchaseDate: event.target.value })} /></label>
                  <label>Custo de aquisição (R$)<input type="number" min="0" step="0.01" value={assetEditForm.purchaseCost} onChange={(event) => setAssetEditForm({ ...assetEditForm, purchaseCost: event.target.value })} /></label>
                  <label>Garantia até<input type="date" value={assetEditForm.warrantyUntil} onChange={(event) => setAssetEditForm({ ...assetEditForm, warrantyUntil: event.target.value })} /></label></>}
                  {assetEditForm.category === "Veículo" && <label>Quilometragem atual<input type="number" min="0" step="1" value={assetEditForm.vehicleKm} onChange={(event) => setAssetEditForm({ ...assetEditForm, vehicleKm: event.target.value })} /></label>}
                  <label>Horas de uso<input type="number" min="0" step="1" value={assetEditForm.usageHours} onChange={(event) => setAssetEditForm({ ...assetEditForm, usageHours: event.target.value })} /></label>
                  <p className="form-help wide-field">O responsável não pode ser alterado nesta edição. Use “Entrega / transferir” para manter fotos, observações e histórico de cada troca.</p>
                  <div className="asset-form-actions"><button className="button button-secondary" type="button" onClick={() => { setEditingAsset(false); setAssetEditForm(null); }}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Salvando..." : "Salvar alterações"}</button></div>
                </form> : <>
                <div className="asset-detail-grid">
                  <p><strong>Categoria</strong><span>{selectedQrAsset.category}</span></p><p><strong>Patrimônio / placa</strong><span>{selectedQrAsset.tag || "—"}</span></p>
                  <p><strong>Fabricante / modelo</strong><span>{[selectedQrAsset.manufacturer, selectedQrAsset.model].filter(Boolean).join(" / ") || "—"}</span></p>
                  <p><strong>Número de série</strong><span>{selectedQrAsset.serialNumber || "—"}</span></p>
                  <p><strong>Localização</strong><span>{selectedQrAsset.location || "—"}</span></p><p><strong>Responsável principal</strong><span>{selectedQrAsset.ownerName || selectedQrAsset.ownerEmail || "—"}</span></p>
                  <p><strong>Responsáveis adicionais</strong><span>{selectedQrAsset.sharedWithNames?.length ? selectedQrAsset.sharedWithNames.join("; ") : "Nenhum"}</span></p>
                  <p><strong>Situação</strong><span>{selectedQrAsset.status}</span></p><p><strong>Próxima preventiva</strong><span>{selectedQrAsset.nextMaintenance || "—"}</span></p>
                  {profile?.role === "admin" && <p><strong>Aquisição</strong><span>{selectedQrAsset.purchaseDate || "—"} · R$ {Number(selectedQrAsset.purchaseCost || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span></p>}
                  {profile?.role === "admin" && <p><strong>Garantia até</strong><span>{selectedQrAsset.warrantyUntil || "—"}</span></p>}
                  {selectedQrAsset.vehicleKm !== null && <p><strong>Quilometragem</strong><span>{selectedQrAsset.vehicleKm.toLocaleString("pt-BR")} km</span></p>}
                  {selectedQrAsset.usageHours !== null && <p><strong>Horas de uso</strong><span>{selectedQrAsset.usageHours.toLocaleString("pt-BR")} h</span></p>}
                </div>
                {selectedQrAsset.category === "Veículo" && <section className="asset-modal-section vehicle-usage-section">
                  <div className="asset-section-heading"><div><h3>Quilometragem e abastecimentos</h3><p>O hodômetro total continua acumulando; a distância do ciclo reinicia quando uma manutenção é concluída.</p></div></div>
                  <div className="vehicle-mileage-summary">
                    <div><span>Hodômetro total</span><strong>{(selectedQrAsset.vehicleKm ?? 0).toLocaleString("pt-BR")} km</strong></div>
                    <div><span>Desde a última manutenção</span><strong>{selectedQrAsset.lastMaintenanceKm === null
                      ? "Aguardando registro de manutenção"
                      : `${Math.max(0, (selectedQrAsset.vehicleKm ?? 0) - selectedQrAsset.lastMaintenanceKm).toLocaleString("pt-BR")} km`}</strong></div>
                    {selectedQrAsset.lastMaintenanceKm !== null && <div><span>Hodômetro na última manutenção</span><strong>{selectedQrAsset.lastMaintenanceKm.toLocaleString("pt-BR")} km</strong></div>}
                  </div>
                  <form className="fuel-record-form" onSubmit={submitFuelRecord}>
                    <strong>Registrar abastecimento</strong>
                    <div className="fuel-record-fields">
                      <label>Quilometragem atual (km)<input required type="number" min={selectedQrAsset.vehicleKm ?? 0} step="1" value={fuelForm.odometerKm} onChange={(event) => setFuelForm({ ...fuelForm, odometerKm: event.target.value })} /></label>
                      <label>Valor pago (R$)<input required type="number" min="0.01" max="1000000" step="0.01" value={fuelForm.amount} onChange={(event) => setFuelForm({ ...fuelForm, amount: event.target.value })} /></label>
                      <label>Tipo de combustível<select required value={fuelForm.fuelType} onChange={(event) => setFuelForm({ ...fuelForm, fuelType: event.target.value })}><option value="">Selecione</option>{fuelTypes.map((fuelType) => <option key={fuelType} value={fuelType}>{fuelType}</option>)}</select></label>
                      <label>Foto do hodômetro<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFuelForm({ ...fuelForm, odometerPhoto: event.target.files?.[0] ?? null })} /><small>{fuelForm.odometerPhoto?.name ?? "Obrigatória · JPG, PNG ou WebP"}</small></label>
                      <label>Foto do cupom<input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFuelForm({ ...fuelForm, receiptPhoto: event.target.files?.[0] ?? null })} /><small>{fuelForm.receiptPhoto?.name ?? "Obrigatória · JPG, PNG ou WebP"}</small></label>
                    </div>
                    <button className="button button-primary compact-button" type="submit" disabled={savingFuel || !fuelForm.odometerKm || !fuelForm.amount || !fuelForm.fuelType || !fuelForm.odometerPhoto || !fuelForm.receiptPhoto}>{savingFuel ? "Salvando..." : "Salvar abastecimento"}</button>
                    <small className="form-help">Anexe exatamente uma foto do hodômetro e uma do cupom. As duas devem somar até 3,5 MB.</small>
                  </form>
                  <div className="vehicle-history-block">
                    <h4>Histórico de abastecimentos</h4>
                    {fuelRecords.length ? <div className="table-scroll"><table>
                      <thead><tr><th>DATA</th><th>COMBUSTÍVEL</th><th>HODÔMETRO</th><th>RODADO DESDE O REGISTRO ANTERIOR</th><th>VALOR</th><th>COMPROVANTES</th></tr></thead>
                      <tbody>{fuelRecords.map((record) => <tr key={record.id}>
                        <td>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(record.createdAt))}<small className="table-subtext">{record.userName}</small></td>
                        <td>{record.fuelType}</td>
                        <td>{record.odometerKm.toLocaleString("pt-BR")} km</td>
                        <td>{record.distanceKm.toLocaleString("pt-BR")} km</td>
                        <td>R$ {record.amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
                        <td><div className="inline-actions">
                          <a className="text-link" href={`/api/assets/${selectedQrAsset.id}/fuel/${record.id}/odometer`} target="_blank" rel="noreferrer">Hodômetro</a>
                          <a className="text-link" href={`/api/assets/${selectedQrAsset.id}/fuel/${record.id}/receipt`} target="_blank" rel="noreferrer">Cupom</a>
                        </div></td>
                      </tr>)}</tbody>
                    </table></div> : <p className="form-help">Ainda não há abastecimentos registrados.</p>}
                  </div>
                  <div className="vehicle-history-block">
                    <h4>Quilometragem por manutenção</h4>
                    {vehicleMaintenanceHistory.length ? <div className="table-scroll"><table>
                      <thead><tr><th>MANUTENÇÃO CONCLUÍDA</th><th>HODÔMETRO AO CONCLUIR</th><th>KM DESDE A MANUTENÇÃO ANTERIOR</th></tr></thead>
                      <tbody>{vehicleMaintenanceHistory.map((maintenance) => <tr key={maintenance.id}>
                        <td><strong>{maintenance.kind}</strong><small className="table-subtext">{maintenance.description} · {maintenance.completedAt ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium" }).format(new Date(maintenance.completedAt)) : "Data não informada"}</small></td>
                        <td>{maintenance.odometerKm === null ? "—" : `${maintenance.odometerKm.toLocaleString("pt-BR")} km`}</td>
                        <td>{maintenance.maintenanceDistanceKm === null ? "Sem registro anterior" : `${maintenance.maintenanceDistanceKm.toLocaleString("pt-BR")} km`}</td>
                      </tr>)}</tbody>
                    </table></div> : <p className="form-help">As manutenções concluídas aparecerão aqui com a quilometragem percorrida entre cada ciclo.</p>}
                  </div>
                </section>}
                <section className="asset-modal-section">
                  <div className="asset-section-heading"><div><h3>Fotos do equipamento</h3><p>Imagens gerais do patrimônio, preservadas na ficha.</p></div></div>
                  {loadingAssetDetails ? <p className="form-help">Carregando fotos e histórico...</p> : assetPhotos.length ? <div className="asset-photo-grid">
                    {assetPhotos.map((photo) => <figure className="asset-photo" key={photo.id}>
                      <Image src={`/api/assets/${selectedQrAsset.id}/photos/${photo.id}`} alt={photo.caption || `Foto de ${selectedQrAsset.name}`} fill sizes="(max-width: 720px) 50vw, 180px" unoptimized />
                      {photo.caption && <figcaption>{photo.caption}</figcaption>}
                      <div className="asset-photo-actions">
                        {selectedQrAsset.coverPhotoId === photo.id
                          ? <span className="badge badge-green">Foto de capa</span>
                          : <button className="button button-secondary compact-button" type="button" disabled={photoAction !== null} onClick={() => void setEquipmentCover(photo)}>{photoAction === `cover:${photo.id}` ? "Atualizando..." : "Definir como capa"}</button>}
                        <button className="button button-danger compact-button" type="button" disabled={photoAction !== null} onClick={() => void deleteEquipmentPhoto(photo)}>{photoAction === `delete:${photo.id}` ? "Excluindo..." : "Excluir foto"}</button>
                      </div>
                    </figure>)}
                  </div> : <p className="form-help">Ainda não há fotos gerais cadastradas.</p>}
                  <form className="asset-upload-form" onSubmit={addEquipmentPhotos}>
                    <label>Adicionar fotos<input key={`asset-photos-${equipmentPhotoFiles.length}`} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setEquipmentPhotoFiles(Array.from(event.target.files ?? []))} /></label>
                    <label>Descrição<input maxLength={200} value={equipmentPhotoCaption} onChange={(event) => setEquipmentPhotoCaption(event.target.value)} placeholder="Ex.: Vista frontal" /></label>
                    <button className="button button-primary compact-button" type="submit" disabled={!equipmentPhotoFiles.length}>Salvar fotos</button>
                  </form>
                </section>
                {profile?.role === "admin" && <section className="asset-modal-section">
                  <div className="asset-section-heading"><div><h3>Entregas e transferências</h3><p>Registro cronológico com responsáveis, observações e fotos de cada movimentação.</p></div>                    {profile?.role === "admin" && <button className="button button-secondary compact-button" type="button" onClick={() => startTransfer(selectedQrAsset)}>Registrar entrega / transferência</button>}
                  </div>
                  {assetTransfers.length ? <div className="transfer-history">
                    {assetTransfers.map((transfer) => <article className="transfer-entry" key={transfer.id}>
                      <div className="transfer-entry-heading"><strong>{transfer.fromUid ? "Transferência" : "Entrega inicial"}</strong><time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(transfer.createdAt))}</time></div>
                      <p><strong>{transfer.fromName || "Estoque"}</strong> → <strong>{transfer.toName}</strong></p>
                      <p>{transfer.notes}</p>
                      <small>Registrado por {transfer.actorName || "administrador"}</small>
                      {transfer.photos.length > 0 && <div className="transfer-photo-grid">{transfer.photos.map((photo) => <div className="transfer-photo" key={photo.id}>
                        <Image src={`/api/assets/${selectedQrAsset.id}/transfers/${transfer.id}/photos/${photo.id}`} alt={`Foto da ${transfer.fromUid ? "transferência" : "entrega inicial"} para ${transfer.toName}`} fill sizes="(max-width: 720px) 50vw, 150px" unoptimized />
                      </div>)}</div>}
                      {profile?.role === "admin" && <form className="transfer-extra-photo-form" onSubmit={(event) => addTransferPhotos(event, transfer.id)}>
                        <label>Adicionar mais fotos<input key={`transfer-extra-${transfer.id}-${transferExtraPhotos[transfer.id]?.length ?? 0}`} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => setTransferExtraPhotos((current) => ({ ...current, [transfer.id]: Array.from(event.target.files ?? []) }))} /><small>{transferExtraPhotos[transfer.id]?.length ? `${transferExtraPhotos[transfer.id].length} foto(s) selecionada(s)` : "JPG, PNG ou WebP · até 6 fotos por vez"}</small></label>
                        <button className="button button-primary compact-button" type="submit" disabled={busy || !(transferExtraPhotos[transfer.id]?.length)}>Adicionar fotos</button>
                      </form>}
                    </article>)}
                  </div> : !loadingAssetDetails && <p className="form-help">Nenhuma entrega formal foi registrada. Registre a primeira entrega para iniciar o histórico.</p>}
                </section>}
                <div className="qr-print-card"><Image src={`/api/assets/${selectedQrAsset.id}/qr`} alt={`QR Code de ${selectedQrAsset.name}`} width={180} height={180} unoptimized /><span>Escaneie para abrir este patrimônio no sistema.</span></div>                <div className="inline-actions modal-actions"><button className="button button-secondary" type="button" onClick={() => window.print()}>Imprimir ficha e QR</button><button className="button button-primary" type="button" onClick={() => { setSelectedQrAsset(null); setEditingAsset(false); }}>Fechar</button></div>
                </>}
              </section>
            </div>
          )}

          {photoZoomUrl && <div className="photo-lightbox-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setPhotoZoomUrl(null); }}>
            <section className="photo-lightbox" role="dialog" aria-modal="true" aria-label="Foto ampliada">
              <button type="button" className="photo-lightbox-close" aria-label="Fechar foto ampliada" onClick={() => setPhotoZoomUrl(null)}>×</button>
              <Image src={photoZoomUrl} alt="Foto ampliada do equipamento" fill sizes="95vw" unoptimized />
            </section>
          </div>}

          {transferAsset && profile?.role === "admin" && (
            <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setTransferAsset(null); }}>
              <section className="asset-modal transfer-modal" role="dialog" aria-modal="true" aria-labelledby="transfer-modal-title">
                <div className="modal-heading"><div><span className="eyebrow">TERMO DIGITAL</span><h2 id="transfer-modal-title">Entrega ou transferência</h2><p>{transferAsset.name} · responsável atual: {transferAsset.ownerName || transferAsset.ownerEmail}</p></div><button className="icon-button" type="button" aria-label="Fechar" onClick={() => setTransferAsset(null)}>×</button></div>
                {error && <p className="notice error-notice" role="status">{error}</p>}
                <form className="transfer-form" onSubmit={submitTransfer}>
                  <label>Usuário que receberá o equipamento<select required value={transferForm.toUid} onChange={(event) => setTransferForm({ ...transferForm, toUid: event.target.value })}>
                    <option value="">Selecione</option>{users.filter((user) => user.active).map((user) => <option key={user.uid} value={user.uid}>{user.displayName || user.email} — {user.email}</option>)}
                  </select></label>
                  <label>Observação sobre o estado e a entrega<textarea required maxLength={2000} rows={4} value={transferForm.notes} onChange={(event) => setTransferForm({ ...transferForm, notes: event.target.value })} placeholder="Descreva as condições do equipamento, acessórios entregues e outras observações." /></label>
                  <label>Fotos obrigatórias da entrega<input type="file" accept="image/jpeg,image/png,image/webp" multiple required onChange={(event) => setTransferForm({ ...transferForm, photos: Array.from(event.target.files ?? []) })} /><small>{transferForm.photos.length ? `${transferForm.photos.length} foto(s) selecionada(s)` : "Até 6 imagens JPG, PNG ou WebP; conjunto de até 3,5 MB."}</small></label>
                  <p className="form-help">A entrega só é concluída depois que as fotos e as observações forem salvas. Os registros anteriores não serão substituídos.</p>
                  <div className="inline-actions modal-actions"><button className="button button-secondary" type="button" onClick={() => setTransferAsset(null)}>Cancelar</button><button className="button button-primary" type="submit" disabled={!transferForm.photos.length || !transferForm.notes.trim()}>Confirmar entrega</button></div>
                </form>
              </section>
            </div>
          )}

          {scanning && (
            <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setScanning(false); }}>
              <section className="asset-modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
                <div className="modal-heading"><div><span className="eyebrow">LOCALIZAR PATRIMÔNIO</span><h2 id="scanner-title">Leitor de QR Code</h2></div><button className="icon-button" type="button" aria-label="Fechar" onClick={() => setScanning(false)}>×</button></div>
                {scannerError && <p className="notice error-notice" role="status">{scannerError}</p>}
                <video id="qr-camera" className="qr-camera" muted playsInline />
                <p className="form-help">Permita o acesso à câmera. Em alguns navegadores a leitura requer HTTPS ou localhost. Você também pode pesquisar pelo número do patrimônio na lista.</p>
                <button className="button button-secondary" type="button" onClick={() => setScanning(false)}>Fechar leitor</button>
              </section>
            </div>
          )}

          {profile?.role === "admin" && section === "audit" && (
            <section className="panel" id="auditoria">
              <div className="panel-heading audit-heading">
                <div><span className="eyebrow">SEGURANÇA E RASTREABILIDADE</span><h2>Auditoria do sistema</h2><p>Acompanhe alterações administrativas, responsáveis e registros afetados.</p></div>
                <div className="record-tools audit-tools">
                  <label className="search-box"><span>⌕</span><input value={recordQueries.audit} onChange={(event) => setRecordQueries((previous) => ({ ...previous, audit: event.target.value }))} placeholder="Buscar atividade, usuário ou registro..." aria-label="Buscar auditoria" /></label>
                  <select className="audit-filter" aria-label="Filtrar por tipo de atividade" value={auditActionFilter} onChange={(event) => setAuditActionFilter(event.target.value)}><option value="all">Todas as atividades</option>{auditActionTypes.map((action) => <option key={action} value={action}>{auditActionLabel(action)}</option>)}</select>
                  <RecordViewToggle value={recordViews.audit} onChange={(view) => changeRecordView("audit", view)} label="auditoria" />
                </div>
              </div>
              <div className="audit-summary-grid">
                <article className="audit-summary-card"><span className="audit-summary-icon">◷</span><div><span>REGISTROS CARREGADOS</span><strong>{auditEntries.length}</strong><small>Atividades recentes da organização</small></div></article>
                <article className="audit-summary-card"><span className="audit-summary-icon">♙</span><div><span>USUÁRIOS ENVOLVIDOS</span><strong>{auditActorCount}</strong><small>Responsáveis nas atividades recentes</small></div></article>
                <article className="audit-summary-card"><span className="audit-summary-icon">◉</span><div><span>ATIVIDADES HOJE</span><strong>{auditTodayCount}</strong><small>Registradas desde meia-noite</small></div></article>
                <article className="audit-summary-card"><span className="audit-summary-icon">⌕</span><div><span>RESULTADOS NA BUSCA</span><strong>{filteredAuditEntries.length}</strong><small>Correspondências dos filtros atuais</small></div></article>
              </div>
              {filteredAuditEntries.length ? recordViews.audit === "list" ? <div className="table-scroll audit-table-scroll">
                <table className="audit-table"><thead><tr><th>DATA E HORA</th><th>RESPONSÁVEL</th><th>ATIVIDADE</th><th>REGISTRO AFETADO</th><th>DETALHES</th></tr></thead>
                  <tbody>{filteredAuditEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td><time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(entry.created_at))}</time></td>
                      <td><div className="audit-actor"><span className="avatar small">{(entry.actorName || entry.actorEmail || "S").slice(0, 1).toUpperCase()}</span><span><strong>{entry.actorName || "Sistema"}</strong><small>{entry.actorEmail || "Ação automática"}</small></span></div></td>
                      <td><span className="audit-action-label">{auditActionLabel(entry.action)}</span><small className="audit-technical-name">{entry.action}</small></td>
                      <td><strong>{auditEntityLabel(entry.entity_type)}</strong><small className="audit-technical-name">{entry.entity_id}</small></td>
                      <td className="audit-details-cell">{auditDetailsLabel(entry.details_json)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div> : <div className="audit-card-list">{filteredAuditEntries.map((entry) => <article className="audit-entry-card" key={entry.id}>
                <div className="audit-entry-rail"><span aria-hidden="true">•</span></div>
                <div className="audit-entry-content">
                  <div className="audit-entry-topline"><span className="audit-entry-action">{auditActionLabel(entry.action)}</span><time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.created_at))}</time></div>
                  <p><strong>{entry.actorName || "Sistema"}</strong> {entry.actorEmail && <span>({entry.actorEmail})</span>} <span>· {auditEntityLabel(entry.entity_type)} · {entry.entity_id}</span></p>
                  <small>{auditDetailsLabel(entry.details_json)}</small>
                </div>
              </article>)}</div> : <div className="audit-empty-state"><span>⌕</span><strong>{auditEntries.length ? "Nenhuma atividade encontrada" : "Ainda não há atividades registradas"}</strong><p>{auditEntries.length ? "Tente mudar os filtros ou usar outros termos na busca." : "As alterações de equipamentos, usuários, estoque e solicitações aparecerão aqui."}</p></div>}
              <div className="audit-footer"><span>Exibindo até 500 atividades mais recentes da organização.</span><span>Os registros são gerados automaticamente pelo sistema.</span></div>
            </section>
          )}

          <footer className="footer-note">Patrimônio <span>•</span> Gestão organizada, todos os dias.</footer>
        </div>
      </section>
    </main>
  );
}
