export const fuelTypes = ["Gasolina", "Etanol", "Diesel", "GNV", "Outro"] as const;

export type FuelType = (typeof fuelTypes)[number];

export function isFuelType(value: string): value is FuelType {
  return fuelTypes.some((fuelType) => fuelType === value);
}
