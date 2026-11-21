import { operation } from "./operation.ts";

export const reportedFeatures = ["auto_arrange", "keyboard_shortcut", "theme_changed"] as const;
export type ReportedFeature = (typeof reportedFeatures)[number];

export const featureUsageOperations = {
  reportFeatureUsed: operation<ReportedFeature, null>()({
    method: "POST",
    path: "/api/feature-usage",
    body: "json",
  }),
};

export function isReportedFeature(value: unknown): value is ReportedFeature {
  return reportedFeatures.some((feature) => value === feature);
}
