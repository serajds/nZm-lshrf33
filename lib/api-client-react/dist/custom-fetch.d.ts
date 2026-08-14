export type CustomFetchOptions = RequestInit & {
    responseType?: "json" | "text" | "blob" | "auto";
};
export type ErrorType<T = unknown> = ApiError<T>;
export type BodyType<T> = T;
export type AuthTokenGetter = () => Promise<string | null> | string | null;
export type AuthTokenSaver = (token: string) => Promise<void> | void;
export type UnauthorizedHandler = (response: Response) => void;
/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export declare function setBaseUrl(url: string | null): void;
/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export declare function setAuthTokenGetter(getter: AuthTokenGetter | null): void;
/**
 * Register a saver that is invoked whenever the server returns a renewed
 * bearer token (via the `X-Renewed-Token` response header). Use this on the
 * web to mirror the new token into localStorage so it survives reloads.
 *
 * Pass `null` to clear the saver.
 */
export declare function setAuthTokenSaver(saver: AuthTokenSaver | null): void;
/**
 * Register a handler invoked when any response comes back with HTTP 401.
 * This is the central place to wire "session expired" behaviour (clear
 * stored credentials, redirect to the login screen, show a toast, …) so
 * individual screens no longer have to render fake-empty states when the
 * token is no longer valid.
 *
 * Pass `null` to clear the handler.
 */
export declare function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void;
/**
 * Run the same renewed-token + unauthorized-handler pipeline that
 * `customFetch` runs internally, but against a `Response` produced by a
 * manual `fetch` call.  Use this from one-off query functions that cannot
 * (yet) be migrated to `customFetch` so they still participate in rolling
 * session renewal and the centralized 401 redirect instead of swallowing
 * auth failures as empty data.
 */
export declare function processFetchResponse(response: Response): Promise<void>;
export declare class ApiError<T = unknown> extends Error {
    readonly name = "ApiError";
    readonly status: number;
    readonly statusText: string;
    readonly data: T | null;
    readonly headers: Headers;
    readonly response: Response;
    readonly method: string;
    readonly url: string;
    constructor(response: Response, data: T | null, requestInfo: {
        method: string;
        url: string;
    });
}
export declare class ResponseParseError extends Error {
    readonly name = "ResponseParseError";
    readonly status: number;
    readonly statusText: string;
    readonly headers: Headers;
    readonly response: Response;
    readonly method: string;
    readonly url: string;
    readonly rawBody: string;
    readonly cause: unknown;
    constructor(response: Response, rawBody: string, cause: unknown, requestInfo: {
        method: string;
        url: string;
    });
}
export declare function customFetch<T = unknown>(input: RequestInfo | URL, options?: CustomFetchOptions): Promise<T>;
//# sourceMappingURL=custom-fetch.d.ts.map