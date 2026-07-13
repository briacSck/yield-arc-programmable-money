/**
 * @yield/shared — the pinned interface contracts for the YIELD Agentic CFO.
 *
 * These schemas ARE the seams between tracks: the chain track (Vadim) codes against `Decision`
 * fixtures and implements `ChainExecutor`; the product track (Briac) codes against
 * `MockChainExecutor` and `ForecastResult` fixtures. They meet only here. Change nothing in this
 * package without team agreement (invariant #5).
 */
export * from './primitives.js';
export * from './forecast.js';
export * from './decision.js';
export * from './chain.js';
export * from './event-log.js';
