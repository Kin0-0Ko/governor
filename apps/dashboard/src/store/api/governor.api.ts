'use client';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000';

export interface Budget {
  id: string;
  orgId: string;
  jobId: string;
  targetId: string;
  capMicros: string;
  halfOpenTtlSeconds: number;
  circuitState?: string;
  spendMicros?: string;
  remainingMicros?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateBudgetRequest {
  orgId: string;
  jobId: string;
  targetId: string;
  capMicros: string;
  halfOpenTtlSeconds?: number;
}

export interface SpendResponse {
  total: number;
  page: number;
  limit: number;
  items: SpendItem[];
}

export interface SpendItem {
  id: string;
  jobId: string;
  targetId: string;
  provider: string;
  features: string[];
  baseRateMicros: string;
  totalCostMicros: string;
  multiplierSum: number;
  decision: string;
  requestTimestamp: string;
}

export const governorApi = createApi({
  reducerPath: 'governorApi',
  baseQuery: fetchBaseQuery({
    baseUrl: `${API_BASE}/v1`,
    prepareHeaders: (headers) => {
      const apiKey = process.env['NEXT_PUBLIC_GOVERNOR_API_KEY'];
      if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
      return headers;
    },
  }),
  tagTypes: ['Budget', 'Spend'],
  endpoints: (builder) => ({
    getBudget: builder.query<Budget, string>({
      query: (id) => `budgets/${id}`,
      providesTags: (_, __, id) => [{ type: 'Budget', id }],
    }),

    getBudgets: builder.query<Budget[], void>({
      query: () => 'budgets',
      providesTags: ['Budget'],
    }),

    createBudget: builder.mutation<Budget, CreateBudgetRequest>({
      query: (body) => ({ url: 'budgets', method: 'POST', body }),
      invalidatesTags: ['Budget'],
    }),

    updateBudget: builder.mutation<Budget, { id: string; capMicros?: string; halfOpenTtlSeconds?: number }>({
      query: ({ id, ...body }) => ({ url: `budgets/${id}`, method: 'PATCH', body }),
      invalidatesTags: (_, __, { id }) => [{ type: 'Budget', id }],
    }),

    deleteBudget: builder.mutation<void, string>({
      query: (id) => ({ url: `budgets/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Budget'],
    }),

    resetCircuit: builder.mutation<{ budgetId: string; previousState: string; newState: string; resetAt: string }, string>({
      query: (id) => ({ url: `budgets/${id}/reset`, method: 'POST' }),
      invalidatesTags: (_, __, id) => [{ type: 'Budget', id }],
    }),

    getSpend: builder.query<SpendResponse, { orgId: string; jobId?: string; targetId?: string; page?: number; limit?: number }>({
      query: (params) => ({
        url: 'spend',
        params,
      }),
      providesTags: ['Spend'],
    }),

    streamBudget: builder.query<Budget, string>({
      query: (id) => `budgets/${id}`,
      providesTags: (_, __, id) => [{ type: 'Budget', id }],
      async onCacheEntryAdded(budgetId, { updateCachedData, cacheDataLoaded, cacheEntryRemoved }) {
        await cacheDataLoaded;
        const apiKey = process.env['NEXT_PUBLIC_GOVERNOR_API_KEY'];
        const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : '';
        const es = new EventSource(`${API_BASE}/v1/stream/budgets/${budgetId}${tokenParam}`);

        const onSpend = (e: MessageEvent) => {
          const data = JSON.parse(e.data);
          updateCachedData((draft) => {
            draft.spendMicros = data.spendMicros;
            draft.remainingMicros = data.remainingMicros;
            draft.circuitState = data.state;
          });
        };

        const onStateChange = (e: MessageEvent) => {
          const data = JSON.parse(e.data);
          updateCachedData((draft) => {
            draft.circuitState = data.newState;
          });
        };

        const onReset = (e: MessageEvent) => {
          const data = JSON.parse(e.data);
          updateCachedData((draft) => {
            draft.circuitState = data.newState;
          });
        };

        es.addEventListener('spend', onSpend);
        es.addEventListener('state_change', onStateChange);
        es.addEventListener('reset', onReset);

        await cacheEntryRemoved;
        es.close();
      },
    }),
  }),
});

export const {
  useGetBudgetQuery,
  useGetBudgetsQuery,
  useCreateBudgetMutation,
  useUpdateBudgetMutation,
  useDeleteBudgetMutation,
  useResetCircuitMutation,
  useGetSpendQuery,
  useStreamBudgetQuery,
} = governorApi;
