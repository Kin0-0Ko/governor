import { configureStore } from '@reduxjs/toolkit';
import { governorApi } from './api/governor.api';

export const store = configureStore({
  reducer: {
    [governorApi.reducerPath]: governorApi.reducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(governorApi.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
