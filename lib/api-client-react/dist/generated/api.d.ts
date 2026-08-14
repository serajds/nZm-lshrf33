import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { ActiveAttendanceResponse, Activity, AddProjectMemberBody, AttendanceCheckBody, AttendanceRecord, AttendanceRecordWithUser, CreateActivityBody, CreateBackup200, CreateProjectBody, CreateReportBody, CreateUserBody, DashboardSummary, DeleteAttendanceRecordBody, DeleteBackup200, DeviationAnalysis, DeviationTimeline, EmployeeAttendanceReport, ErrorResponse, GenerateOwnerLinkBody, GetEmployeeAttendanceReportParams, GetIncompleteUsersCount200, GetMyAttendanceHistoryParams, GetOwnerProjectByToken200, GetProjectDeviationParams, GetProjectDeviationTimelineParams, HealthStatus, ImportActivities400, ImportActivitiesBody, ImportActivitiesResponse, ListAttendanceRecordsParams, ListBackups200, ListFilesParams, ListProjectsParams, ListReportsParams, LoginBody, LoginResponse, MemberTabPermissions, MessageResponse, MyAttendanceHistoryItem, MyAttendanceProjectStatus, OwnerLinkResponse, OwnerProjectView, OwnerVerifyBody, Project, ProjectFile, ProjectMember, ProjectPermissions, ProjectSummary, RegisterBody, RegisterResponse, Report, ReportAuditLogEntry, UpdateActivityBody, UpdateAttendanceRecordBody, UpdateMemberGroups200, UpdateMemberGroupsBody, UpdateMemberTabPermissionsBody, UpdateProjectBody, UpdateProjectMemberBody, UpdateReportBody, UpdateReportStatusBody, UpdateUserBody, UploadFileBody, User } from "./api.schemas";
import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
/**
 * @summary Health check
 */
export declare const getHealthCheckUrl: () => string;
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Login with phone and password
 */
export declare const getLoginUrl: () => string;
export declare const login: (loginBody: LoginBody, options?: RequestInit) => Promise<LoginResponse>;
export declare const getLoginMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginBody>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<LoginBody>;
export type LoginMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Login with phone and password
 */
export declare const useLogin: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<LoginBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<LoginBody>;
}, TContext>;
/**
 * @summary Logout
 */
export declare const getLogoutUrl: () => string;
export declare const logout: (options?: RequestInit) => Promise<MessageResponse>;
export declare const getLogoutMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
export type LogoutMutationResult = NonNullable<Awaited<ReturnType<typeof logout>>>;
export type LogoutMutationError = ErrorType<unknown>;
/**
 * @summary Logout
 */
export declare const useLogout: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logout>>, TError, void, TContext>;
/**
 * @summary Self-register a new user (name, phone, password). The new account starts inactive — no token is issued; the admin must link the user to a company and project before they can log in.
 */
export declare const getRegisterUrl: () => string;
export declare const register: (registerBody: RegisterBody, options?: RequestInit) => Promise<RegisterResponse>;
export declare const getRegisterMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof register>>, TError, {
        data: BodyType<RegisterBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof register>>, TError, {
    data: BodyType<RegisterBody>;
}, TContext>;
export type RegisterMutationResult = NonNullable<Awaited<ReturnType<typeof register>>>;
export type RegisterMutationBody = BodyType<RegisterBody>;
export type RegisterMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Self-register a new user (name, phone, password). The new account starts inactive — no token is issued; the admin must link the user to a company and project before they can log in.
 */
export declare const useRegister: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof register>>, TError, {
        data: BodyType<RegisterBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof register>>, TError, {
    data: BodyType<RegisterBody>;
}, TContext>;
/**
 * @summary Get current logged-in user
 */
export declare const getGetMeUrl: () => string;
export declare const getMe: (options?: RequestInit) => Promise<User>;
export declare const getGetMeQueryKey: () => readonly ["/api/auth/me"];
export declare const getGetMeQueryOptions: <TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current logged-in user
 */
export declare function useGetMe<TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List all projects
 */
export declare const getListProjectsUrl: (params?: ListProjectsParams) => string;
export declare const listProjects: (params?: ListProjectsParams, options?: RequestInit) => Promise<Project[]>;
export declare const getListProjectsQueryKey: (params?: ListProjectsParams) => readonly ["/api/projects", ...ListProjectsParams[]];
export declare const getListProjectsQueryOptions: <TData = Awaited<ReturnType<typeof listProjects>>, TError = ErrorType<unknown>>(params?: ListProjectsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjects>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectsQueryResult = NonNullable<Awaited<ReturnType<typeof listProjects>>>;
export type ListProjectsQueryError = ErrorType<unknown>;
/**
 * @summary List all projects
 */
export declare function useListProjects<TData = Awaited<ReturnType<typeof listProjects>>, TError = ErrorType<unknown>>(params?: ListProjectsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a new project
 */
export declare const getCreateProjectUrl: () => string;
export declare const createProject: (createProjectBody: CreateProjectBody, options?: RequestInit) => Promise<Project>;
export declare const getCreateProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createProject>>, TError, {
        data: BodyType<CreateProjectBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createProject>>, TError, {
    data: BodyType<CreateProjectBody>;
}, TContext>;
export type CreateProjectMutationResult = NonNullable<Awaited<ReturnType<typeof createProject>>>;
export type CreateProjectMutationBody = BodyType<CreateProjectBody>;
export type CreateProjectMutationError = ErrorType<unknown>;
/**
 * @summary Create a new project
 */
export declare const useCreateProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createProject>>, TError, {
        data: BodyType<CreateProjectBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createProject>>, TError, {
    data: BodyType<CreateProjectBody>;
}, TContext>;
/**
 * @summary Get a project by ID
 */
export declare const getGetProjectUrl: (id: number) => string;
export declare const getProject: (id: number, options?: RequestInit) => Promise<Project>;
export declare const getGetProjectQueryKey: (id: number) => readonly [`/api/projects/${number}`];
export declare const getGetProjectQueryOptions: <TData = Awaited<ReturnType<typeof getProject>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProject>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectQueryResult = NonNullable<Awaited<ReturnType<typeof getProject>>>;
export type GetProjectQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get a project by ID
 */
export declare function useGetProject<TData = Awaited<ReturnType<typeof getProject>>, TError = ErrorType<ErrorResponse>>(id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update a project
 */
export declare const getUpdateProjectUrl: (id: number) => string;
export declare const updateProject: (id: number, updateProjectBody: UpdateProjectBody, options?: RequestInit) => Promise<Project>;
export declare const getUpdateProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProject>>, TError, {
        id: number;
        data: BodyType<UpdateProjectBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateProject>>, TError, {
    id: number;
    data: BodyType<UpdateProjectBody>;
}, TContext>;
export type UpdateProjectMutationResult = NonNullable<Awaited<ReturnType<typeof updateProject>>>;
export type UpdateProjectMutationBody = BodyType<UpdateProjectBody>;
export type UpdateProjectMutationError = ErrorType<unknown>;
/**
 * @summary Update a project
 */
export declare const useUpdateProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProject>>, TError, {
        id: number;
        data: BodyType<UpdateProjectBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateProject>>, TError, {
    id: number;
    data: BodyType<UpdateProjectBody>;
}, TContext>;
/**
 * @summary Delete a project
 */
export declare const getDeleteProjectUrl: (id: number) => string;
export declare const deleteProject: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteProject>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteProject>>, TError, {
    id: number;
}, TContext>;
export type DeleteProjectMutationResult = NonNullable<Awaited<ReturnType<typeof deleteProject>>>;
export type DeleteProjectMutationError = ErrorType<unknown>;
/**
 * @summary Delete a project
 */
export declare const useDeleteProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteProject>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteProject>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary List activities for a project
 */
export declare const getListActivitiesUrl: (projectId: number) => string;
export declare const listActivities: (projectId: number, options?: RequestInit) => Promise<Activity[]>;
export declare const getListActivitiesQueryKey: (projectId: number) => readonly [`/api/projects/${number}/activities`];
export declare const getListActivitiesQueryOptions: <TData = Awaited<ReturnType<typeof listActivities>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listActivities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listActivities>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListActivitiesQueryResult = NonNullable<Awaited<ReturnType<typeof listActivities>>>;
export type ListActivitiesQueryError = ErrorType<unknown>;
/**
 * @summary List activities for a project
 */
export declare function useListActivities<TData = Awaited<ReturnType<typeof listActivities>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listActivities>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create an activity
 */
export declare const getCreateActivityUrl: (projectId: number) => string;
export declare const createActivity: (projectId: number, createActivityBody: CreateActivityBody, options?: RequestInit) => Promise<Activity>;
export declare const getCreateActivityMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createActivity>>, TError, {
        projectId: number;
        data: BodyType<CreateActivityBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createActivity>>, TError, {
    projectId: number;
    data: BodyType<CreateActivityBody>;
}, TContext>;
export type CreateActivityMutationResult = NonNullable<Awaited<ReturnType<typeof createActivity>>>;
export type CreateActivityMutationBody = BodyType<CreateActivityBody>;
export type CreateActivityMutationError = ErrorType<unknown>;
/**
 * @summary Create an activity
 */
export declare const useCreateActivity: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createActivity>>, TError, {
        projectId: number;
        data: BodyType<CreateActivityBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createActivity>>, TError, {
    projectId: number;
    data: BodyType<CreateActivityBody>;
}, TContext>;
/**
 * @summary Import activities from Excel file
 */
export declare const getImportActivitiesUrl: (projectId: number) => string;
export declare const importActivities: (projectId: number, importActivitiesBody: ImportActivitiesBody, options?: RequestInit) => Promise<ImportActivitiesResponse>;
export declare const getImportActivitiesMutationOptions: <TError = ErrorType<ImportActivities400>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof importActivities>>, TError, {
        projectId: number;
        data: BodyType<ImportActivitiesBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof importActivities>>, TError, {
    projectId: number;
    data: BodyType<ImportActivitiesBody>;
}, TContext>;
export type ImportActivitiesMutationResult = NonNullable<Awaited<ReturnType<typeof importActivities>>>;
export type ImportActivitiesMutationBody = BodyType<ImportActivitiesBody>;
export type ImportActivitiesMutationError = ErrorType<ImportActivities400>;
/**
 * @summary Import activities from Excel file
 */
export declare const useImportActivities: <TError = ErrorType<ImportActivities400>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof importActivities>>, TError, {
        projectId: number;
        data: BodyType<ImportActivitiesBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof importActivities>>, TError, {
    projectId: number;
    data: BodyType<ImportActivitiesBody>;
}, TContext>;
/**
 * @summary Update an activity
 */
export declare const getUpdateActivityUrl: (projectId: number, id: number) => string;
export declare const updateActivity: (projectId: number, id: number, updateActivityBody: UpdateActivityBody, options?: RequestInit) => Promise<Activity>;
export declare const getUpdateActivityMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateActivity>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateActivityBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateActivity>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateActivityBody>;
}, TContext>;
export type UpdateActivityMutationResult = NonNullable<Awaited<ReturnType<typeof updateActivity>>>;
export type UpdateActivityMutationBody = BodyType<UpdateActivityBody>;
export type UpdateActivityMutationError = ErrorType<unknown>;
/**
 * @summary Update an activity
 */
export declare const useUpdateActivity: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateActivity>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateActivityBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateActivity>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateActivityBody>;
}, TContext>;
/**
 * @summary Delete an activity
 */
export declare const getDeleteActivityUrl: (projectId: number, id: number) => string;
export declare const deleteActivity: (projectId: number, id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteActivityMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteActivity>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteActivity>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
export type DeleteActivityMutationResult = NonNullable<Awaited<ReturnType<typeof deleteActivity>>>;
export type DeleteActivityMutationError = ErrorType<unknown>;
/**
 * @summary Delete an activity
 */
export declare const useDeleteActivity: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteActivity>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteActivity>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
/**
 * @summary List reports for a project
 */
export declare const getListReportsUrl: (projectId: number, params?: ListReportsParams) => string;
export declare const listReports: (projectId: number, params?: ListReportsParams, options?: RequestInit) => Promise<Report[]>;
export declare const getListReportsQueryKey: (projectId: number, params?: ListReportsParams) => readonly [`/api/projects/${number}/reports`, ...ListReportsParams[]];
export declare const getListReportsQueryOptions: <TData = Awaited<ReturnType<typeof listReports>>, TError = ErrorType<unknown>>(projectId: number, params?: ListReportsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReportsQueryResult = NonNullable<Awaited<ReturnType<typeof listReports>>>;
export type ListReportsQueryError = ErrorType<unknown>;
/**
 * @summary List reports for a project
 */
export declare function useListReports<TData = Awaited<ReturnType<typeof listReports>>, TError = ErrorType<unknown>>(projectId: number, params?: ListReportsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a report
 */
export declare const getCreateReportUrl: (projectId: number) => string;
export declare const createReport: (projectId: number, createReportBody: CreateReportBody, options?: RequestInit) => Promise<Report>;
export declare const getCreateReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReport>>, TError, {
        projectId: number;
        data: BodyType<CreateReportBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createReport>>, TError, {
    projectId: number;
    data: BodyType<CreateReportBody>;
}, TContext>;
export type CreateReportMutationResult = NonNullable<Awaited<ReturnType<typeof createReport>>>;
export type CreateReportMutationBody = BodyType<CreateReportBody>;
export type CreateReportMutationError = ErrorType<unknown>;
/**
 * @summary Create a report
 */
export declare const useCreateReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createReport>>, TError, {
        projectId: number;
        data: BodyType<CreateReportBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createReport>>, TError, {
    projectId: number;
    data: BodyType<CreateReportBody>;
}, TContext>;
/**
 * @summary Get a report by ID
 */
export declare const getGetReportUrl: (projectId: number, id: number) => string;
export declare const getReport: (projectId: number, id: number, options?: RequestInit) => Promise<Report>;
export declare const getGetReportQueryKey: (projectId: number, id: number) => readonly [`/api/projects/${number}/reports/${number}`];
export declare const getGetReportQueryOptions: <TData = Awaited<ReturnType<typeof getReport>>, TError = ErrorType<ErrorResponse>>(projectId: number, id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportQueryResult = NonNullable<Awaited<ReturnType<typeof getReport>>>;
export type GetReportQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get a report by ID
 */
export declare function useGetReport<TData = Awaited<ReturnType<typeof getReport>>, TError = ErrorType<ErrorResponse>>(projectId: number, id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update a report
 */
export declare const getUpdateReportUrl: (projectId: number, id: number) => string;
export declare const updateReport: (projectId: number, id: number, updateReportBody: UpdateReportBody, options?: RequestInit) => Promise<Report>;
export declare const getUpdateReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateReport>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateReportBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateReport>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateReportBody>;
}, TContext>;
export type UpdateReportMutationResult = NonNullable<Awaited<ReturnType<typeof updateReport>>>;
export type UpdateReportMutationBody = BodyType<UpdateReportBody>;
export type UpdateReportMutationError = ErrorType<unknown>;
/**
 * @summary Update a report
 */
export declare const useUpdateReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateReport>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateReportBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateReport>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateReportBody>;
}, TContext>;
/**
 * @summary Delete a report
 */
export declare const getDeleteReportUrl: (projectId: number, id: number) => string;
export declare const deleteReport: (projectId: number, id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteReportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteReport>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteReport>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
export type DeleteReportMutationResult = NonNullable<Awaited<ReturnType<typeof deleteReport>>>;
export type DeleteReportMutationError = ErrorType<unknown>;
/**
 * @summary Delete a report
 */
export declare const useDeleteReport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteReport>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteReport>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
/**
 * @summary Approve or revert a report (project_manager / admin)
 */
export declare const getUpdateReportStatusUrl: (projectId: number, id: number) => string;
export declare const updateReportStatus: (projectId: number, id: number, updateReportStatusBody: UpdateReportStatusBody, options?: RequestInit) => Promise<Report>;
export declare const getUpdateReportStatusMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateReportStatus>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateReportStatusBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateReportStatus>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateReportStatusBody>;
}, TContext>;
export type UpdateReportStatusMutationResult = NonNullable<Awaited<ReturnType<typeof updateReportStatus>>>;
export type UpdateReportStatusMutationBody = BodyType<UpdateReportStatusBody>;
export type UpdateReportStatusMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Approve or revert a report (project_manager / admin)
 */
export declare const useUpdateReportStatus: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateReportStatus>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateReportStatusBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateReportStatus>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateReportStatusBody>;
}, TContext>;
/**
 * @summary Get the activity log for a single report
 */
export declare const getGetReportAuditLogUrl: (projectId: number, id: number) => string;
export declare const getReportAuditLog: (projectId: number, id: number, options?: RequestInit) => Promise<ReportAuditLogEntry[]>;
export declare const getGetReportAuditLogQueryKey: (projectId: number, id: number) => readonly [`/api/projects/${number}/reports/${number}/audit-log`];
export declare const getGetReportAuditLogQueryOptions: <TData = Awaited<ReturnType<typeof getReportAuditLog>>, TError = ErrorType<unknown>>(projectId: number, id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportAuditLog>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReportAuditLog>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReportAuditLogQueryResult = NonNullable<Awaited<ReturnType<typeof getReportAuditLog>>>;
export type GetReportAuditLogQueryError = ErrorType<unknown>;
/**
 * @summary Get the activity log for a single report
 */
export declare function useGetReportAuditLog<TData = Awaited<ReturnType<typeof getReportAuditLog>>, TError = ErrorType<unknown>>(projectId: number, id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReportAuditLog>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Export project reports as PDF
 */
export declare const getExportReportsPdfUrl: (projectId: number) => string;
export declare const exportReportsPdf: (projectId: number, options?: RequestInit) => Promise<Blob>;
export declare const getExportReportsPdfQueryKey: (projectId: number) => readonly [`/api/projects/${number}/reports/export-pdf`];
export declare const getExportReportsPdfQueryOptions: <TData = Awaited<ReturnType<typeof exportReportsPdf>>, TError = ErrorType<ErrorResponse>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof exportReportsPdf>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof exportReportsPdf>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ExportReportsPdfQueryResult = NonNullable<Awaited<ReturnType<typeof exportReportsPdf>>>;
export type ExportReportsPdfQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Export project reports as PDF
 */
export declare function useExportReportsPdf<TData = Awaited<ReturnType<typeof exportReportsPdf>>, TError = ErrorType<ErrorResponse>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof exportReportsPdf>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List files for a project
 */
export declare const getListFilesUrl: (projectId: number, params?: ListFilesParams) => string;
export declare const listFiles: (projectId: number, params?: ListFilesParams, options?: RequestInit) => Promise<ProjectFile[]>;
export declare const getListFilesQueryKey: (projectId: number, params?: ListFilesParams) => readonly [`/api/projects/${number}/files`, ...ListFilesParams[]];
export declare const getListFilesQueryOptions: <TData = Awaited<ReturnType<typeof listFiles>>, TError = ErrorType<unknown>>(projectId: number, params?: ListFilesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listFiles>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListFilesQueryResult = NonNullable<Awaited<ReturnType<typeof listFiles>>>;
export type ListFilesQueryError = ErrorType<unknown>;
/**
 * @summary List files for a project
 */
export declare function useListFiles<TData = Awaited<ReturnType<typeof listFiles>>, TError = ErrorType<unknown>>(projectId: number, params?: ListFilesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listFiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Upload a file for a project
 */
export declare const getUploadFileUrl: (projectId: number) => string;
export declare const uploadFile: (projectId: number, uploadFileBody: UploadFileBody, options?: RequestInit) => Promise<ProjectFile>;
export declare const getUploadFileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadFile>>, TError, {
        projectId: number;
        data: BodyType<UploadFileBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof uploadFile>>, TError, {
    projectId: number;
    data: BodyType<UploadFileBody>;
}, TContext>;
export type UploadFileMutationResult = NonNullable<Awaited<ReturnType<typeof uploadFile>>>;
export type UploadFileMutationBody = BodyType<UploadFileBody>;
export type UploadFileMutationError = ErrorType<unknown>;
/**
 * @summary Upload a file for a project
 */
export declare const useUploadFile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadFile>>, TError, {
        projectId: number;
        data: BodyType<UploadFileBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof uploadFile>>, TError, {
    projectId: number;
    data: BodyType<UploadFileBody>;
}, TContext>;
/**
 * @summary Delete a file
 */
export declare const getDeleteFileUrl: (projectId: number, id: number) => string;
export declare const deleteFile: (projectId: number, id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteFileMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFile>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteFile>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
export type DeleteFileMutationResult = NonNullable<Awaited<ReturnType<typeof deleteFile>>>;
export type DeleteFileMutationError = ErrorType<unknown>;
/**
 * @summary Delete a file
 */
export declare const useDeleteFile: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteFile>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteFile>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
/**
 * @summary List members of a project
 */
export declare const getListProjectMembersUrl: (projectId: number) => string;
export declare const listProjectMembers: (projectId: number, options?: RequestInit) => Promise<ProjectMember[]>;
export declare const getListProjectMembersQueryKey: (projectId: number) => readonly [`/api/projects/${number}/members`];
export declare const getListProjectMembersQueryOptions: <TData = Awaited<ReturnType<typeof listProjectMembers>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectMembers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjectMembers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectMembersQueryResult = NonNullable<Awaited<ReturnType<typeof listProjectMembers>>>;
export type ListProjectMembersQueryError = ErrorType<unknown>;
/**
 * @summary List members of a project
 */
export declare function useListProjectMembers<TData = Awaited<ReturnType<typeof listProjectMembers>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectMembers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Add a member to a project
 */
export declare const getAddProjectMemberUrl: (projectId: number) => string;
export declare const addProjectMember: (projectId: number, addProjectMemberBody: AddProjectMemberBody, options?: RequestInit) => Promise<ProjectMember>;
export declare const getAddProjectMemberMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addProjectMember>>, TError, {
        projectId: number;
        data: BodyType<AddProjectMemberBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof addProjectMember>>, TError, {
    projectId: number;
    data: BodyType<AddProjectMemberBody>;
}, TContext>;
export type AddProjectMemberMutationResult = NonNullable<Awaited<ReturnType<typeof addProjectMember>>>;
export type AddProjectMemberMutationBody = BodyType<AddProjectMemberBody>;
export type AddProjectMemberMutationError = ErrorType<unknown>;
/**
 * @summary Add a member to a project
 */
export declare const useAddProjectMember: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof addProjectMember>>, TError, {
        projectId: number;
        data: BodyType<AddProjectMemberBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof addProjectMember>>, TError, {
    projectId: number;
    data: BodyType<AddProjectMemberBody>;
}, TContext>;
/**
 * @summary Get users eligible to be added to this project (from linked companies)
 */
export declare const getGetEligibleUsersUrl: (projectId: number) => string;
export declare const getEligibleUsers: (projectId: number, options?: RequestInit) => Promise<User[]>;
export declare const getGetEligibleUsersQueryKey: (projectId: number) => readonly [`/api/projects/${number}/eligible-users`];
export declare const getGetEligibleUsersQueryOptions: <TData = Awaited<ReturnType<typeof getEligibleUsers>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEligibleUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getEligibleUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetEligibleUsersQueryResult = NonNullable<Awaited<ReturnType<typeof getEligibleUsers>>>;
export type GetEligibleUsersQueryError = ErrorType<unknown>;
/**
 * @summary Get users eligible to be added to this project (from linked companies)
 */
export declare function useGetEligibleUsers<TData = Awaited<ReturnType<typeof getEligibleUsers>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEligibleUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update a project member role
 */
export declare const getUpdateProjectMemberUrl: (projectId: number, id: number) => string;
export declare const updateProjectMember: (projectId: number, id: number, updateProjectMemberBody: UpdateProjectMemberBody, options?: RequestInit) => Promise<ProjectMember>;
export declare const getUpdateProjectMemberMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProjectMember>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateProjectMemberBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateProjectMember>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateProjectMemberBody>;
}, TContext>;
export type UpdateProjectMemberMutationResult = NonNullable<Awaited<ReturnType<typeof updateProjectMember>>>;
export type UpdateProjectMemberMutationBody = BodyType<UpdateProjectMemberBody>;
export type UpdateProjectMemberMutationError = ErrorType<unknown>;
/**
 * @summary Update a project member role
 */
export declare const useUpdateProjectMember: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateProjectMember>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateProjectMemberBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateProjectMember>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateProjectMemberBody>;
}, TContext>;
/**
 * @summary Remove a member from a project
 */
export declare const getRemoveProjectMemberUrl: (projectId: number, id: number) => string;
export declare const removeProjectMember: (projectId: number, id: number, options?: RequestInit) => Promise<void>;
export declare const getRemoveProjectMemberMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeProjectMember>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof removeProjectMember>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
export type RemoveProjectMemberMutationResult = NonNullable<Awaited<ReturnType<typeof removeProjectMember>>>;
export type RemoveProjectMemberMutationError = ErrorType<unknown>;
/**
 * @summary Remove a member from a project
 */
export declare const useRemoveProjectMember: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeProjectMember>>, TError, {
        projectId: number;
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof removeProjectMember>>, TError, {
    projectId: number;
    id: number;
}, TContext>;
/**
 * @summary Update assigned groups for a project member
 */
export declare const getUpdateMemberGroupsUrl: (projectId: number, id: number) => string;
export declare const updateMemberGroups: (projectId: number, id: number, updateMemberGroupsBody: UpdateMemberGroupsBody, options?: RequestInit) => Promise<UpdateMemberGroups200>;
export declare const getUpdateMemberGroupsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMemberGroups>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateMemberGroupsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateMemberGroups>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateMemberGroupsBody>;
}, TContext>;
export type UpdateMemberGroupsMutationResult = NonNullable<Awaited<ReturnType<typeof updateMemberGroups>>>;
export type UpdateMemberGroupsMutationBody = BodyType<UpdateMemberGroupsBody>;
export type UpdateMemberGroupsMutationError = ErrorType<unknown>;
/**
 * @summary Update assigned groups for a project member
 */
export declare const useUpdateMemberGroups: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMemberGroups>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateMemberGroupsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateMemberGroups>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateMemberGroupsBody>;
}, TContext>;
/**
 * @summary Get current user group permissions for a project
 */
export declare const getGetMyProjectPermissionsUrl: (projectId: number) => string;
export declare const getMyProjectPermissions: (projectId: number, options?: RequestInit) => Promise<ProjectPermissions>;
export declare const getGetMyProjectPermissionsQueryKey: (projectId: number) => readonly [`/api/projects/${number}/my-permissions`];
export declare const getGetMyProjectPermissionsQueryOptions: <TData = Awaited<ReturnType<typeof getMyProjectPermissions>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyProjectPermissions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyProjectPermissions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyProjectPermissionsQueryResult = NonNullable<Awaited<ReturnType<typeof getMyProjectPermissions>>>;
export type GetMyProjectPermissionsQueryError = ErrorType<unknown>;
/**
 * @summary Get current user group permissions for a project
 */
export declare function useGetMyProjectPermissions<TData = Awaited<ReturnType<typeof getMyProjectPermissions>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyProjectPermissions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get effective per-tab permissions for a project member
 */
export declare const getGetMemberTabPermissionsUrl: (projectId: number, id: number) => string;
export declare const getMemberTabPermissions: (projectId: number, id: number, options?: RequestInit) => Promise<MemberTabPermissions>;
export declare const getGetMemberTabPermissionsQueryKey: (projectId: number, id: number) => readonly [`/api/projects/${number}/members/${number}/permissions`];
export declare const getGetMemberTabPermissionsQueryOptions: <TData = Awaited<ReturnType<typeof getMemberTabPermissions>>, TError = ErrorType<unknown>>(projectId: number, id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMemberTabPermissions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMemberTabPermissions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMemberTabPermissionsQueryResult = NonNullable<Awaited<ReturnType<typeof getMemberTabPermissions>>>;
export type GetMemberTabPermissionsQueryError = ErrorType<unknown>;
/**
 * @summary Get effective per-tab permissions for a project member
 */
export declare function useGetMemberTabPermissions<TData = Awaited<ReturnType<typeof getMemberTabPermissions>>, TError = ErrorType<unknown>>(projectId: number, id: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMemberTabPermissions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update per-tab permission overrides for a project member
 */
export declare const getUpdateMemberTabPermissionsUrl: (projectId: number, id: number) => string;
export declare const updateMemberTabPermissions: (projectId: number, id: number, updateMemberTabPermissionsBody: UpdateMemberTabPermissionsBody, options?: RequestInit) => Promise<MemberTabPermissions>;
export declare const getUpdateMemberTabPermissionsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMemberTabPermissions>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateMemberTabPermissionsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateMemberTabPermissions>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateMemberTabPermissionsBody>;
}, TContext>;
export type UpdateMemberTabPermissionsMutationResult = NonNullable<Awaited<ReturnType<typeof updateMemberTabPermissions>>>;
export type UpdateMemberTabPermissionsMutationBody = BodyType<UpdateMemberTabPermissionsBody>;
export type UpdateMemberTabPermissionsMutationError = ErrorType<unknown>;
/**
 * @summary Update per-tab permission overrides for a project member
 */
export declare const useUpdateMemberTabPermissions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMemberTabPermissions>>, TError, {
        projectId: number;
        id: number;
        data: BodyType<UpdateMemberTabPermissionsBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateMemberTabPermissions>>, TError, {
    projectId: number;
    id: number;
    data: BodyType<UpdateMemberTabPermissionsBody>;
}, TContext>;
/**
 * @summary List all users
 */
export declare const getListUsersUrl: () => string;
export declare const listUsers: (options?: RequestInit) => Promise<User[]>;
export declare const getListUsersQueryKey: () => readonly ["/api/users"];
export declare const getListUsersQueryOptions: <TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listUsers>>>;
export type ListUsersQueryError = ErrorType<unknown>;
/**
 * @summary List all users
 */
export declare function useListUsers<TData = Awaited<ReturnType<typeof listUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a new user
 */
export declare const getCreateUserUrl: () => string;
export declare const createUser: (createUserBody: CreateUserBody, options?: RequestInit) => Promise<User>;
export declare const getCreateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, {
        data: BodyType<CreateUserBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, {
    data: BodyType<CreateUserBody>;
}, TContext>;
export type CreateUserMutationResult = NonNullable<Awaited<ReturnType<typeof createUser>>>;
export type CreateUserMutationBody = BodyType<CreateUserBody>;
export type CreateUserMutationError = ErrorType<unknown>;
/**
 * @summary Create a new user
 */
export declare const useCreateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createUser>>, TError, {
        data: BodyType<CreateUserBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createUser>>, TError, {
    data: BodyType<CreateUserBody>;
}, TContext>;
/**
 * @summary Count of users with incomplete profile (no company or no project)
 */
export declare const getGetIncompleteUsersCountUrl: () => string;
export declare const getIncompleteUsersCount: (options?: RequestInit) => Promise<GetIncompleteUsersCount200>;
export declare const getGetIncompleteUsersCountQueryKey: () => readonly ["/api/users/incomplete-count"];
export declare const getGetIncompleteUsersCountQueryOptions: <TData = Awaited<ReturnType<typeof getIncompleteUsersCount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIncompleteUsersCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIncompleteUsersCount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIncompleteUsersCountQueryResult = NonNullable<Awaited<ReturnType<typeof getIncompleteUsersCount>>>;
export type GetIncompleteUsersCountQueryError = ErrorType<unknown>;
/**
 * @summary Count of users with incomplete profile (no company or no project)
 */
export declare function useGetIncompleteUsersCount<TData = Awaited<ReturnType<typeof getIncompleteUsersCount>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIncompleteUsersCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update a user
 */
export declare const getUpdateUserUrl: (id: number) => string;
export declare const updateUser: (id: number, updateUserBody: UpdateUserBody, options?: RequestInit) => Promise<User>;
export declare const getUpdateUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
        id: number;
        data: BodyType<UpdateUserBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
    id: number;
    data: BodyType<UpdateUserBody>;
}, TContext>;
export type UpdateUserMutationResult = NonNullable<Awaited<ReturnType<typeof updateUser>>>;
export type UpdateUserMutationBody = BodyType<UpdateUserBody>;
export type UpdateUserMutationError = ErrorType<unknown>;
/**
 * @summary Update a user
 */
export declare const useUpdateUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateUser>>, TError, {
        id: number;
        data: BodyType<UpdateUserBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateUser>>, TError, {
    id: number;
    data: BodyType<UpdateUserBody>;
}, TContext>;
/**
 * @summary Delete a user
 */
export declare const getDeleteUserUrl: (id: number) => string;
export declare const deleteUser: (id: number, options?: RequestInit) => Promise<void>;
export declare const getDeleteUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
    id: number;
}, TContext>;
export type DeleteUserMutationResult = NonNullable<Awaited<ReturnType<typeof deleteUser>>>;
export type DeleteUserMutationError = ErrorType<unknown>;
/**
 * @summary Delete a user
 */
export declare const useDeleteUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteUser>>, TError, {
        id: number;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteUser>>, TError, {
    id: number;
}, TContext>;
/**
 * @summary Check if owner access token is valid
 */
export declare const getGetOwnerProjectByTokenUrl: (token: string) => string;
export declare const getOwnerProjectByToken: (token: string, options?: RequestInit) => Promise<GetOwnerProjectByToken200>;
export declare const getGetOwnerProjectByTokenQueryKey: (token: string) => readonly [`/api/owner/access/${string}`];
export declare const getGetOwnerProjectByTokenQueryOptions: <TData = Awaited<ReturnType<typeof getOwnerProjectByToken>>, TError = ErrorType<ErrorResponse>>(token: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOwnerProjectByToken>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOwnerProjectByToken>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOwnerProjectByTokenQueryResult = NonNullable<Awaited<ReturnType<typeof getOwnerProjectByToken>>>;
export type GetOwnerProjectByTokenQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Check if owner access token is valid
 */
export declare function useGetOwnerProjectByToken<TData = Awaited<ReturnType<typeof getOwnerProjectByToken>>, TError = ErrorType<ErrorResponse>>(token: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOwnerProjectByToken>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Verify owner password for a project
 */
export declare const getVerifyOwnerAccessUrl: () => string;
export declare const verifyOwnerAccess: (ownerVerifyBody: OwnerVerifyBody, options?: RequestInit) => Promise<OwnerProjectView>;
export declare const getVerifyOwnerAccessMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyOwnerAccess>>, TError, {
        data: BodyType<OwnerVerifyBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof verifyOwnerAccess>>, TError, {
    data: BodyType<OwnerVerifyBody>;
}, TContext>;
export type VerifyOwnerAccessMutationResult = NonNullable<Awaited<ReturnType<typeof verifyOwnerAccess>>>;
export type VerifyOwnerAccessMutationBody = BodyType<OwnerVerifyBody>;
export type VerifyOwnerAccessMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Verify owner password for a project
 */
export declare const useVerifyOwnerAccess: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof verifyOwnerAccess>>, TError, {
        data: BodyType<OwnerVerifyBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof verifyOwnerAccess>>, TError, {
    data: BodyType<OwnerVerifyBody>;
}, TContext>;
/**
 * @summary Create a full database backup
 */
export declare const getCreateBackupUrl: () => string;
export declare const createBackup: (options?: RequestInit) => Promise<CreateBackup200>;
export declare const getCreateBackupMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBackup>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBackup>>, TError, void, TContext>;
export type CreateBackupMutationResult = NonNullable<Awaited<ReturnType<typeof createBackup>>>;
export type CreateBackupMutationError = ErrorType<unknown>;
/**
 * @summary Create a full database backup
 */
export declare const useCreateBackup: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBackup>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBackup>>, TError, void, TContext>;
/**
 * @summary List all available backups
 */
export declare const getListBackupsUrl: () => string;
export declare const listBackups: (options?: RequestInit) => Promise<ListBackups200>;
export declare const getListBackupsQueryKey: () => readonly ["/api/backup/list"];
export declare const getListBackupsQueryOptions: <TData = Awaited<ReturnType<typeof listBackups>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBackups>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listBackups>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListBackupsQueryResult = NonNullable<Awaited<ReturnType<typeof listBackups>>>;
export type ListBackupsQueryError = ErrorType<unknown>;
/**
 * @summary List all available backups
 */
export declare function useListBackups<TData = Awaited<ReturnType<typeof listBackups>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listBackups>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Download a backup file
 */
export declare const getDownloadBackupUrl: (filename: string) => string;
export declare const downloadBackup: (filename: string, options?: RequestInit) => Promise<Blob>;
export declare const getDownloadBackupQueryKey: (filename: string) => readonly [`/api/backup/download/${string}`];
export declare const getDownloadBackupQueryOptions: <TData = Awaited<ReturnType<typeof downloadBackup>>, TError = ErrorType<unknown>>(filename: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadBackup>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadBackup>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadBackupQueryResult = NonNullable<Awaited<ReturnType<typeof downloadBackup>>>;
export type DownloadBackupQueryError = ErrorType<unknown>;
/**
 * @summary Download a backup file
 */
export declare function useDownloadBackup<TData = Awaited<ReturnType<typeof downloadBackup>>, TError = ErrorType<unknown>>(filename: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadBackup>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Delete a backup file
 */
export declare const getDeleteBackupUrl: (filename: string) => string;
export declare const deleteBackup: (filename: string, options?: RequestInit) => Promise<DeleteBackup200>;
export declare const getDeleteBackupMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBackup>>, TError, {
        filename: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteBackup>>, TError, {
    filename: string;
}, TContext>;
export type DeleteBackupMutationResult = NonNullable<Awaited<ReturnType<typeof deleteBackup>>>;
export type DeleteBackupMutationError = ErrorType<unknown>;
/**
 * @summary Delete a backup file
 */
export declare const useDeleteBackup: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteBackup>>, TError, {
        filename: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteBackup>>, TError, {
    filename: string;
}, TContext>;
/**
 * @summary Get dashboard summary stats
 */
export declare const getGetDashboardSummaryUrl: () => string;
export declare const getDashboardSummary: (options?: RequestInit) => Promise<DashboardSummary>;
export declare const getGetDashboardSummaryQueryKey: () => readonly ["/api/dashboard/summary"];
export declare const getGetDashboardSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getDashboardSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDashboardSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDashboardSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getDashboardSummary>>>;
export type GetDashboardSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Get dashboard summary stats
 */
export declare function useGetDashboardSummary<TData = Awaited<ReturnType<typeof getDashboardSummary>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDashboardSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get project progress summary
 */
export declare const getGetProjectSummaryUrl: (projectId: number) => string;
export declare const getProjectSummary: (projectId: number, options?: RequestInit) => Promise<ProjectSummary>;
export declare const getGetProjectSummaryQueryKey: (projectId: number) => readonly [`/api/projects/${number}/summary`];
export declare const getGetProjectSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getProjectSummary>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProjectSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getProjectSummary>>>;
export type GetProjectSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Get project progress summary
 */
export declare function useGetProjectSummary<TData = Awaited<ReturnType<typeof getProjectSummary>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get project deviation analysis
 */
export declare const getGetProjectDeviationUrl: (projectId: number, params?: GetProjectDeviationParams) => string;
export declare const getProjectDeviation: (projectId: number, params?: GetProjectDeviationParams, options?: RequestInit) => Promise<DeviationAnalysis>;
export declare const getGetProjectDeviationQueryKey: (projectId: number, params?: GetProjectDeviationParams) => readonly [`/api/projects/${number}/deviation`, ...GetProjectDeviationParams[]];
export declare const getGetProjectDeviationQueryOptions: <TData = Awaited<ReturnType<typeof getProjectDeviation>>, TError = ErrorType<unknown>>(projectId: number, params?: GetProjectDeviationParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectDeviation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProjectDeviation>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectDeviationQueryResult = NonNullable<Awaited<ReturnType<typeof getProjectDeviation>>>;
export type GetProjectDeviationQueryError = ErrorType<unknown>;
/**
 * @summary Get project deviation analysis
 */
export declare function useGetProjectDeviation<TData = Awaited<ReturnType<typeof getProjectDeviation>>, TError = ErrorType<unknown>>(projectId: number, params?: GetProjectDeviationParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectDeviation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get historical deviation time-series for a project
 */
export declare const getGetProjectDeviationTimelineUrl: (projectId: number, params?: GetProjectDeviationTimelineParams) => string;
export declare const getProjectDeviationTimeline: (projectId: number, params?: GetProjectDeviationTimelineParams, options?: RequestInit) => Promise<DeviationTimeline>;
export declare const getGetProjectDeviationTimelineQueryKey: (projectId: number, params?: GetProjectDeviationTimelineParams) => readonly [`/api/projects/${number}/deviation/timeline`, ...GetProjectDeviationTimelineParams[]];
export declare const getGetProjectDeviationTimelineQueryOptions: <TData = Awaited<ReturnType<typeof getProjectDeviationTimeline>>, TError = ErrorType<unknown>>(projectId: number, params?: GetProjectDeviationTimelineParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectDeviationTimeline>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProjectDeviationTimeline>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectDeviationTimelineQueryResult = NonNullable<Awaited<ReturnType<typeof getProjectDeviationTimeline>>>;
export type GetProjectDeviationTimelineQueryError = ErrorType<unknown>;
/**
 * @summary Get historical deviation time-series for a project
 */
export declare function useGetProjectDeviationTimeline<TData = Awaited<ReturnType<typeof getProjectDeviationTimeline>>, TError = ErrorType<unknown>>(projectId: number, params?: GetProjectDeviationTimelineParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectDeviationTimeline>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Generate owner access link
 */
export declare const getGenerateOwnerLinkUrl: (projectId: number) => string;
export declare const generateOwnerLink: (projectId: number, generateOwnerLinkBody: GenerateOwnerLinkBody, options?: RequestInit) => Promise<OwnerLinkResponse>;
export declare const getGenerateOwnerLinkMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateOwnerLink>>, TError, {
        projectId: number;
        data: BodyType<GenerateOwnerLinkBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof generateOwnerLink>>, TError, {
    projectId: number;
    data: BodyType<GenerateOwnerLinkBody>;
}, TContext>;
export type GenerateOwnerLinkMutationResult = NonNullable<Awaited<ReturnType<typeof generateOwnerLink>>>;
export type GenerateOwnerLinkMutationBody = BodyType<GenerateOwnerLinkBody>;
export type GenerateOwnerLinkMutationError = ErrorType<unknown>;
/**
 * @summary Generate owner access link
 */
export declare const useGenerateOwnerLink: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof generateOwnerLink>>, TError, {
        projectId: number;
        data: BodyType<GenerateOwnerLinkBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof generateOwnerLink>>, TError, {
    projectId: number;
    data: BodyType<GenerateOwnerLinkBody>;
}, TContext>;
/**
 * @summary Get my current check-in status across my projects
 */
export declare const getGetMyAttendanceStatusUrl: () => string;
export declare const getMyAttendanceStatus: (options?: RequestInit) => Promise<MyAttendanceProjectStatus[]>;
export declare const getGetMyAttendanceStatusQueryKey: () => readonly ["/api/attendance/my-status"];
export declare const getGetMyAttendanceStatusQueryOptions: <TData = Awaited<ReturnType<typeof getMyAttendanceStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyAttendanceStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyAttendanceStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyAttendanceStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getMyAttendanceStatus>>>;
export type GetMyAttendanceStatusQueryError = ErrorType<unknown>;
/**
 * @summary Get my current check-in status across my projects
 */
export declare function useGetMyAttendanceStatus<TData = Awaited<ReturnType<typeof getMyAttendanceStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyAttendanceStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get my attendance history
 */
export declare const getGetMyAttendanceHistoryUrl: (params?: GetMyAttendanceHistoryParams) => string;
export declare const getMyAttendanceHistory: (params?: GetMyAttendanceHistoryParams, options?: RequestInit) => Promise<MyAttendanceHistoryItem[]>;
export declare const getGetMyAttendanceHistoryQueryKey: (params?: GetMyAttendanceHistoryParams) => readonly ["/api/attendance/my-history", ...GetMyAttendanceHistoryParams[]];
export declare const getGetMyAttendanceHistoryQueryOptions: <TData = Awaited<ReturnType<typeof getMyAttendanceHistory>>, TError = ErrorType<unknown>>(params?: GetMyAttendanceHistoryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyAttendanceHistory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyAttendanceHistory>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyAttendanceHistoryQueryResult = NonNullable<Awaited<ReturnType<typeof getMyAttendanceHistory>>>;
export type GetMyAttendanceHistoryQueryError = ErrorType<unknown>;
/**
 * @summary Get my attendance history
 */
export declare function useGetMyAttendanceHistory<TData = Awaited<ReturnType<typeof getMyAttendanceHistory>>, TError = ErrorType<unknown>>(params?: GetMyAttendanceHistoryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyAttendanceHistory>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Edit an attendance record (admin or PM)
 */
export declare const getUpdateAttendanceRecordUrl: (recordId: number) => string;
export declare const updateAttendanceRecord: (recordId: number, updateAttendanceRecordBody: UpdateAttendanceRecordBody, options?: RequestInit) => Promise<AttendanceRecord>;
export declare const getUpdateAttendanceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAttendanceRecord>>, TError, {
        recordId: number;
        data: BodyType<UpdateAttendanceRecordBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAttendanceRecord>>, TError, {
    recordId: number;
    data: BodyType<UpdateAttendanceRecordBody>;
}, TContext>;
export type UpdateAttendanceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof updateAttendanceRecord>>>;
export type UpdateAttendanceRecordMutationBody = BodyType<UpdateAttendanceRecordBody>;
export type UpdateAttendanceRecordMutationError = ErrorType<unknown>;
/**
 * @summary Edit an attendance record (admin or PM)
 */
export declare const useUpdateAttendanceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAttendanceRecord>>, TError, {
        recordId: number;
        data: BodyType<UpdateAttendanceRecordBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAttendanceRecord>>, TError, {
    recordId: number;
    data: BodyType<UpdateAttendanceRecordBody>;
}, TContext>;
/**
 * @summary Delete an attendance record (admin or PM)
 */
export declare const getDeleteAttendanceRecordUrl: (recordId: number) => string;
export declare const deleteAttendanceRecord: (recordId: number, deleteAttendanceRecordBody: DeleteAttendanceRecordBody, options?: RequestInit) => Promise<void>;
export declare const getDeleteAttendanceRecordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAttendanceRecord>>, TError, {
        recordId: number;
        data: BodyType<DeleteAttendanceRecordBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteAttendanceRecord>>, TError, {
    recordId: number;
    data: BodyType<DeleteAttendanceRecordBody>;
}, TContext>;
export type DeleteAttendanceRecordMutationResult = NonNullable<Awaited<ReturnType<typeof deleteAttendanceRecord>>>;
export type DeleteAttendanceRecordMutationBody = BodyType<DeleteAttendanceRecordBody>;
export type DeleteAttendanceRecordMutationError = ErrorType<unknown>;
/**
 * @summary Delete an attendance record (admin or PM)
 */
export declare const useDeleteAttendanceRecord: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAttendanceRecord>>, TError, {
        recordId: number;
        data: BodyType<DeleteAttendanceRecordBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteAttendanceRecord>>, TError, {
    recordId: number;
    data: BodyType<DeleteAttendanceRecordBody>;
}, TContext>;
/**
 * @summary Check in to a project (site photo + GPS required)
 */
export declare const getAttendanceCheckInUrl: (projectId: number) => string;
export declare const attendanceCheckIn: (projectId: number, attendanceCheckBody: AttendanceCheckBody, options?: RequestInit) => Promise<AttendanceRecord>;
export declare const getAttendanceCheckInMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof attendanceCheckIn>>, TError, {
        projectId: number;
        data: BodyType<AttendanceCheckBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof attendanceCheckIn>>, TError, {
    projectId: number;
    data: BodyType<AttendanceCheckBody>;
}, TContext>;
export type AttendanceCheckInMutationResult = NonNullable<Awaited<ReturnType<typeof attendanceCheckIn>>>;
export type AttendanceCheckInMutationBody = BodyType<AttendanceCheckBody>;
export type AttendanceCheckInMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Check in to a project (site photo + GPS required)
 */
export declare const useAttendanceCheckIn: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof attendanceCheckIn>>, TError, {
        projectId: number;
        data: BodyType<AttendanceCheckBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof attendanceCheckIn>>, TError, {
    projectId: number;
    data: BodyType<AttendanceCheckBody>;
}, TContext>;
/**
 * @summary Check out of a project (site photo + GPS required)
 */
export declare const getAttendanceCheckOutUrl: (projectId: number) => string;
export declare const attendanceCheckOut: (projectId: number, attendanceCheckBody: AttendanceCheckBody, options?: RequestInit) => Promise<AttendanceRecord>;
export declare const getAttendanceCheckOutMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof attendanceCheckOut>>, TError, {
        projectId: number;
        data: BodyType<AttendanceCheckBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof attendanceCheckOut>>, TError, {
    projectId: number;
    data: BodyType<AttendanceCheckBody>;
}, TContext>;
export type AttendanceCheckOutMutationResult = NonNullable<Awaited<ReturnType<typeof attendanceCheckOut>>>;
export type AttendanceCheckOutMutationBody = BodyType<AttendanceCheckBody>;
export type AttendanceCheckOutMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Check out of a project (site photo + GPS required)
 */
export declare const useAttendanceCheckOut: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof attendanceCheckOut>>, TError, {
        projectId: number;
        data: BodyType<AttendanceCheckBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof attendanceCheckOut>>, TError, {
    projectId: number;
    data: BodyType<AttendanceCheckBody>;
}, TContext>;
/**
 * @summary List members currently checked in
 */
export declare const getGetActiveAttendanceUrl: (projectId: number) => string;
export declare const getActiveAttendance: (projectId: number, options?: RequestInit) => Promise<ActiveAttendanceResponse>;
export declare const getGetActiveAttendanceQueryKey: (projectId: number) => readonly [`/api/attendance/projects/${number}/active`];
export declare const getGetActiveAttendanceQueryOptions: <TData = Awaited<ReturnType<typeof getActiveAttendance>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getActiveAttendance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getActiveAttendance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetActiveAttendanceQueryResult = NonNullable<Awaited<ReturnType<typeof getActiveAttendance>>>;
export type GetActiveAttendanceQueryError = ErrorType<unknown>;
/**
 * @summary List members currently checked in
 */
export declare function useGetActiveAttendance<TData = Awaited<ReturnType<typeof getActiveAttendance>>, TError = ErrorType<unknown>>(projectId: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getActiveAttendance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List attendance records (with filters)
 */
export declare const getListAttendanceRecordsUrl: (projectId: number, params?: ListAttendanceRecordsParams) => string;
export declare const listAttendanceRecords: (projectId: number, params?: ListAttendanceRecordsParams, options?: RequestInit) => Promise<AttendanceRecordWithUser[]>;
export declare const getListAttendanceRecordsQueryKey: (projectId: number, params?: ListAttendanceRecordsParams) => readonly [`/api/attendance/projects/${number}/records`, ...ListAttendanceRecordsParams[]];
export declare const getListAttendanceRecordsQueryOptions: <TData = Awaited<ReturnType<typeof listAttendanceRecords>>, TError = ErrorType<unknown>>(projectId: number, params?: ListAttendanceRecordsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAttendanceRecords>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAttendanceRecords>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAttendanceRecordsQueryResult = NonNullable<Awaited<ReturnType<typeof listAttendanceRecords>>>;
export type ListAttendanceRecordsQueryError = ErrorType<unknown>;
/**
 * @summary List attendance records (with filters)
 */
export declare function useListAttendanceRecords<TData = Awaited<ReturnType<typeof listAttendanceRecords>>, TError = ErrorType<unknown>>(projectId: number, params?: ListAttendanceRecordsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAttendanceRecords>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Per-employee daily attendance report
 */
export declare const getGetEmployeeAttendanceReportUrl: (projectId: number, userId: number, params?: GetEmployeeAttendanceReportParams) => string;
export declare const getEmployeeAttendanceReport: (projectId: number, userId: number, params?: GetEmployeeAttendanceReportParams, options?: RequestInit) => Promise<EmployeeAttendanceReport>;
export declare const getGetEmployeeAttendanceReportQueryKey: (projectId: number, userId: number, params?: GetEmployeeAttendanceReportParams) => readonly [`/api/attendance/projects/${number}/users/${number}/report`, ...GetEmployeeAttendanceReportParams[]];
export declare const getGetEmployeeAttendanceReportQueryOptions: <TData = Awaited<ReturnType<typeof getEmployeeAttendanceReport>>, TError = ErrorType<unknown>>(projectId: number, userId: number, params?: GetEmployeeAttendanceReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEmployeeAttendanceReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getEmployeeAttendanceReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetEmployeeAttendanceReportQueryResult = NonNullable<Awaited<ReturnType<typeof getEmployeeAttendanceReport>>>;
export type GetEmployeeAttendanceReportQueryError = ErrorType<unknown>;
/**
 * @summary Per-employee daily attendance report
 */
export declare function useGetEmployeeAttendanceReport<TData = Awaited<ReturnType<typeof getEmployeeAttendanceReport>>, TError = ErrorType<unknown>>(projectId: number, userId: number, params?: GetEmployeeAttendanceReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getEmployeeAttendanceReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map