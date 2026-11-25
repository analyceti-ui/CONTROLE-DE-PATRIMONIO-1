import { NextResponse } from "next/server";
import { getSessionUser, handleApiError, listRecords, listRecordsMatchingAny, requireAdmin } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    requireAdmin(user);

    const [assets, users, units] = await Promise.all([
      listRecords("assets", { organization_id: user.organizationId }),
      listRecords("users", { organization_id: user.organizationId }),
      listRecords("units", { organization_id: user.organizationId }),
    ]);
    const assetIds = assets.map((asset) => asset.id);
    const [fuelRecords, serviceOrders] = await Promise.all([
      listRecordsMatchingAny("vehicle_fuel_records", "asset_id", assetIds),
      listRecordsMatchingAny("service_orders", "asset_id", assetIds),
    ]);
    const people = new Map(users.map((person) => [person.id, person]));
    const unitNames = new Map(units.map((unit) => [unit.id, String(unit.name ?? "")]));
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));

    return NextResponse.json({
      assets: assets.map((asset) => ({
        id: asset.id,
        name: String(asset.name ?? ""),
        category: String(asset.category ?? ""),
        tag: String(asset.tag ?? ""),
        location: String(asset.location ?? ""),
        status: String(asset.status ?? ""),
        ownerUid: String(asset.owner_uid ?? ""),
        ownerName: String(people.get(String(asset.owner_uid))?.display_name ?? ""),
        ownerEmail: String(people.get(String(asset.owner_uid))?.email ?? ""),
        sharedWith: (Array.isArray(asset.shared_with_uids) ? asset.shared_with_uids : []).map((uid) => {
          const person = people.get(String(uid));
          return {
            uid: String(uid),
            name: String(person?.display_name ?? person?.email ?? ""),
          };
        }),
        unitName: unitNames.get(String(asset.unit_id ?? "")) ?? "",
        vehicleKm: Number.isFinite(Number(asset.vehicle_km)) ? Number(asset.vehicle_km) : null,
      })),
      fuelRecords: fuelRecords.map((record) => {
        const asset = assetMap.get(String(record.asset_id));
        const operator = people.get(String(record.user_uid));
        return {
          id: record.id,
          assetId: String(record.asset_id ?? ""),
          assetName: String(asset?.name ?? ""),
          assetTag: String(asset?.tag ?? ""),
          location: String(asset?.location ?? ""),
          ownerUid: String(asset?.owner_uid ?? ""),
          ownerName: String(people.get(String(asset?.owner_uid))?.display_name ?? ""),
          sharedWithUids: Array.isArray(asset?.shared_with_uids) ? asset.shared_with_uids.map(String) : [],
          recordedByUid: String(record.user_uid ?? ""),
          recordedByName: String(operator?.display_name ?? operator?.email ?? ""),
          odometerKm: Number(record.odometer_km ?? 0),
          previousOdometerKm: Number(record.previous_odometer_km ?? 0),
          distanceKm: Number(record.distance_km ?? 0),
          amount: Number(record.amount ?? 0),
          fuelType: String(record.fuel_type ?? "Não informado"),
          createdAt: String(record.created_at ?? ""),
        };
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      serviceOrders: serviceOrders.map((order) => {
        const asset = assetMap.get(String(order.asset_id));
        return {
          id: order.id,
          assetId: String(order.asset_id ?? ""),
          assetName: String(asset?.name ?? ""),
          assetTag: String(asset?.tag ?? ""),
          location: String(asset?.location ?? ""),
          ownerUid: String(asset?.owner_uid ?? ""),
          ownerName: String(people.get(String(asset?.owner_uid))?.display_name ?? ""),
          sharedWithUids: Array.isArray(asset?.shared_with_uids) ? asset.shared_with_uids.map(String) : [],
          description: String(order.description ?? ""),
          kind: String(order.kind ?? ""),
          status: String(order.status ?? ""),
          laborCost: Number(order.labor_cost ?? 0),
          partsCost: Number(order.parts_cost ?? 0),
          createdAt: String(order.created_at ?? ""),
          completedAt: order.completed_at ? String(order.completed_at) : "",
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
