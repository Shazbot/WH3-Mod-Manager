import { configureStore } from "@reduxjs/toolkit";

import appReducer, { setPacksData } from "./appSlice";

const store = configureStore({
  reducer: {
    app: appReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredPaths: ["app.packsData"],
        ignoredActions: [setPacksData.type],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export default store;
