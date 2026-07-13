import { z } from 'zod';
import { Bytes32Hex, IsoDate, IsoDateTime, UsdcBaseUnits } from './primitives.js';

/**
 * One point on the forecast curve: the P10/P50/P90 projected cash balance on a given day.
 * P10 is the pessimistic tail the agent protects against; P50 the median; P90 the optimistic tail.
 */
export const ForecastPoint = z.object({
  date: IsoDate,
  p10: UsdcBaseUnits,
  p50: UsdcBaseUnits,
  p90: UsdcBaseUnits,
});
export type ForecastPoint = z.infer<typeof ForecastPoint>;

/**
 * `ForecastResult` — plan §16.2. The interface between the forecast producer (deterministic
 * baseline now, the t0 model service later) and the decision engine. Swapping `modelId` upgrades
 * the forecast without touching any consumer — that is the whole point of pinning this contract.
 *
 * `inputsHash` commits the exact input set the forecast was computed from; the decision that acts
 * on this forecast carries the same hash into its on-chain receipt (see `Decision.forecastInputsHash`).
 */
export const ForecastResult = z.object({
  asOf: IsoDateTime,
  horizonDays: z.number().int().positive(),
  series: z.array(ForecastPoint).min(1),
  modelId: z.string().min(1),
  inputsHash: Bytes32Hex,
});
export type ForecastResult = z.infer<typeof ForecastResult>;
