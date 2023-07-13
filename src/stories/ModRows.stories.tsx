import React from "react";
import { Meta, StoryObj } from "@storybook/react";

import ModRow from "../components/ModRows";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { modsFive } from "./test_data/mods";
import { SortingType } from "../utility/modRowSorting";

console.log(modsFive);
export const MockedState: AppState = {
  currentPreset: {
    mods: modsFive,
    name: "",
  },
  lastSelectedPreset: null,
  presets: [],
  categories: [],
  filter: "",
  alwaysEnabledMods: [],
  hiddenMods: [],
  saves: [],
  isOnboardingToRun: false,
  wasOnboardingEverRun: false,
  isDev: false,
  isAdmin: false,
  areThumbnailsEnabled: false,
  isClosedOnPlay: false,
  isAuthorEnabled: false,
  isMakeUnitsGeneralsEnabled: false,
  isScriptLoggingEnabled: false,
  isSkipIntroMoviesEnabled: false,
  isAutoStartCustomBattleEnabled: false,
  allMods: modsFive,
  packsData: {},
  packCollisions: { packTableCollisions: [], packFileCollisions: [] },
  newMergedPacks: [],
  pathsOfReadPacks: [],
  appFolderPaths: { gamePath: "", contentFolder: "" },
  isSetAppFolderPathsDone: false,
  overwrittenDataPackedFiles: {},
  outdatedPackFiles: {},
  startArgs: [],
  currentTab: "mods",
  isCreateSteamCollectionOpen: false,
  isWH3Running: false,
  toasts: [],
  removedModsCategories: {},
  dataModsToEnableByName: [],
  removedModsData: [],
  modRowsSortingType: SortingType.Ordered,
  importedMods: [],
};

// A super-simple mock of a redux store
const Mockstore = ({ appState, children }: { appState: AppState; children: React.ReactNode }) => (
  <Provider
    store={configureStore({
      reducer: {
        app: createSlice({
          name: "app",
          initialState: appState,
          reducers: {
            updateTaskState: (state, action) => {
              const { id, newTaskState } = action.payload;
            },
          },
        }).reducer,
      },
    })}
  >
    {children}
  </Provider>
);

const taskList: Meta<typeof ModRow> = {
  component: ModRow,
  title: "ModRows",
};
export default taskList;
type Story = StoryObj<typeof ModRow>;

export const Default: Story = {
  decorators: [(story) => <Mockstore appState={MockedState}>{story()}</Mockstore>],
};

export const WithPinnedTasks: Story = {
  decorators: [
    (story) => {
      return (
        <Mockstore
          appState={{
            ...MockedState,
          }}
        >
          {story()}
        </Mockstore>
      );
    },
  ],
};
