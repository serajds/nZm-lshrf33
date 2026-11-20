import {
  QueryClient,
  type QueryFunctionContext,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";

export { apiRequest } from "@/lib/api";

async function defaultQueryFn({ queryKey, signal }: QueryFunctionContext): Promise<unknown> {
  const path = queryKey[0];
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("مفتاح طلب API غير صالح.");
  }
  return apiRequest(path, { signal });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: defaultQueryFn,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
