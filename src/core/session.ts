/**
 * Session replay.
 *
 * The whole day's state is a fold: (seed, ordered list of disruptions) rebuilt
 * from scratch. Nothing is mutated in place across user actions.
 *
 * Why this matters for the product rather than the code: the coordinator needs
 * to see the cost of a replan BEFORE it happens. Preview and undo are usually
 * painful because they need an inverse for every operation. Here there is no
 * inverse to write. A preview is a replay with one extra disruption appended,
 * and an undo is a replay with the last one popped. Rebuilding costs about
 * 100ms on 800 students, which is far cheaper than the bugs an undo stack
 * would cost.
 */

import { generateDataset } from './generator';
import { buildSchedule } from './scheduler';
import { computeMetrics, explainUnscheduled } from './metrics';
import { replan, Disruption, ReplanDiff, ReplanOptions } from './replan';
import { ScheduleEngine } from './engine';
import { Dataset, Metrics, Schedule } from './types';

export interface SessionStep {
  disruptions: Disruption[];
  at: number; // global slot the coordinator was at
}

export interface SessionView {
  dataset: Dataset;
  engine: ScheduleEngine;
  schedule: Schedule;
  metrics: Metrics;
  unscheduledBreakdown: ReturnType<typeof explainUnscheduled>;
  /** Diff for the final step only, which is what a preview wants to show. */
  lastDiff: ReplanDiff | null;
  rebuildMs: number;
}

export interface SessionConfig extends Omit<ReplanOptions, 'now'> {
  seed: number;
}

export function runSession(
  config: SessionConfig,
  history: SessionStep[],
  pending?: SessionStep,
): SessionView {
  const t0 = Date.now();
  const dataset = generateDataset(config.seed);
  const built = buildSchedule(dataset);
  const engine = built.engine;
  let schedule = built.schedule;
  let lastDiff: ReplanDiff | null = null;

  const steps = pending ? [...history, pending] : history;
  for (const step of steps) {
    const result = replan(engine, schedule, step.disruptions, {
      ...config,
      now: step.at,
    });
    schedule = result.schedule;
    lastDiff = result.diff;
  }

  return {
    dataset,
    engine,
    schedule,
    metrics: computeMetrics(dataset, schedule),
    unscheduledBreakdown: explainUnscheduled(dataset, schedule),
    lastDiff: pending ? lastDiff : null,
    rebuildMs: Date.now() - t0,
  };
}
