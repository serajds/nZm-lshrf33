import '@workspace/api-client-react';
import { UseQueryOptions, QueryKey } from '@tanstack/react-query';

declare module '@workspace/api-client-react' {
  export interface User {
    isContractorCompanyUser?: boolean;
  }
  export interface OwnerProjectView {
    extensions?: any[];
    suspensions?: any[];
    companyLogos?: any;
  }
}

declare module '@tanstack/react-query' {
  export interface UseQueryOptions<TQueryFnData = unknown, TError = unknown, TData = TQueryFnData, TQueryKey extends QueryKey = QueryKey> {
    queryKey?: TQueryKey;
  }
}
