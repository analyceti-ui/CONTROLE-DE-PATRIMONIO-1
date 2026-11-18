import { NextResponse } from "next/server";
import { getSessionUser, handleApiError, listRecords } from "@/lib/api";

export const runtime = "nodejs";
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    const [assets, users, units] = await Promise.all([
      listRecords("assets", { organization_id: user.organizationId }),
      listRecords("users", { organization_id: user.organizationId }),
      listRecords("units", { organization_id: user.organizationId }),
    ]);
    const people = new Map(users.map((person) => [person.id, person]));
    const unitMap = new Map(units.map((unit) => [unit.id, unit]));
    const rows = assets.filter((asset) => user.role === "admin" || asset.owner_uid === user.uid)
      .map((asset) => ({
        name: asset.name, category: asset.category, tag: asset.tag, location: asset.location, status: asset.status,
        nextMaintenance: asset.next_maintenance, manufacturer: asset.manufacturer, model: asset.model,
        serialNumber: asset.serial_number, purchaseDate: asset.purchase_date, purchaseCost: asset.purchase_cost,
        warrantyUntil: asset.warranty_until, vehicleKm: asset.vehicle_km, usageHours: asset.usage_hours,
        ownerName: people.get(String(asset.owner_uid))?.display_name ?? "",
        ownerEmail: people.get(String(asset.owner_uid))?.email ?? "",
        unitName: unitMap.get(String(asset.unit_id))?.name ?? "",
      })).sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
    if (new URL(request.url).searchParams.get("format") === "csv") {
      const headers = [
        "Ativo", "Categoria", "Patrimônio", "Localização", "Situação", "Responsável", "Unidade",
        "Próxima preventiva", "Fabricante", "Modelo", "Número de série", "Data de compra", "Custo", "Garantia até", "Quilometragem", "Horas de uso",
      ];
      const keys = [
        "name", "category", "tag", "location", "status", "ownerName", "unitName", "nextMaintenance",
        "manufacturer", "model", "serialNumber", "purchaseDate", "purchaseCost", "warrantyUntil", "vehicleKm", "usageHours",
      ] as const;
      const csv = [headers.map(csvCell).join(";"), ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(";"))].join("\r\n");
      return new NextResponse(`\uFEFF${csv}`, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="relatorio-patrimonio.csv"', "Cache-Control": "private, no-store" },
      });
    }
    return NextResponse.json({
      assets: rows,
      totals: {
        count: rows.length, purchaseCost: rows.reduce((sum, row) => sum + Number(row.purchaseCost || 0), 0),
        inUse: rows.filter((row) => row.status === "Em uso").length,
        inMaintenance: rows.filter((row) => row.status === "Em manutenção").length,
        withoutOwner: rows.filter((row) => !row.ownerEmail).length,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
