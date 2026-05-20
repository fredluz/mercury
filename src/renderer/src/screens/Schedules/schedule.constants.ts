import type { ScheduleKind } from "../../../../shared/schedules";

export const DELIVERY_TARGETS = [
  "local",
  "telegram",
  "discord",
  "slack",
  "whatsapp",
  "signal",
  "matrix",
  "email",
  "sms",
  "webhook",
] as const;

export const DELIVER_TARGETS = DELIVERY_TARGETS.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}));

export const SCHEDULE_KIND_OPTIONS: ScheduleKind[] = [
  "once",
  "interval",
  "daily",
  "weekly",
  "monthly",
  "custom",
];

export const WEEK_DAYS = [
  { key: "mon", value: 1 },
  { key: "tue", value: 2 },
  { key: "wed", value: 3 },
  { key: "thu", value: 4 },
  { key: "fri", value: 5 },
  { key: "sat", value: 6 },
  { key: "sun", value: 0 },
] as const;
