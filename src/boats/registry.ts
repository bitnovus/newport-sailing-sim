import { harbor20 } from "./harbor20";
import type { BoatDefinition } from "./types";

const boats: Record<string, BoatDefinition> = {
  harbor20,
};

export function getBoat(id: string): BoatDefinition {
  const b = boats[id];
  if (!b) throw new Error(`Unknown boat "${id}". Available: ${Object.keys(boats).join(", ")}`);
  return b;
}

export function listBoats(): string[] {
  return Object.keys(boats);
}
