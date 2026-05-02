export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  customFetch,
  ApiError,
  ResponseParseError,
} from "./custom-fetch";
export type {
  AuthTokenGetter,
  CustomFetchOptions,
  ErrorType,
  BodyType,
} from "./custom-fetch";

export interface ProjectExtension {
  id: number;
  projectId: number;
  extensionDate: string;
  daysAdded: number;
  newEndDate: string;
  reason: string | null;
  documentRef: string | null;
  approvedBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ProjectSuspension {
  id: number;
  projectId: number;
  type: "official_holiday" | "force_majeure" | "contractor_delay";
  title: string;
  startDate: string;
  endDate: string;
  calendarDays: number;
  reason: string | null;
  documentRef: string | null;
  approvedBy: string | null;
  notes: string | null;
  datesShifted: boolean;
  createdAt: string;
}
