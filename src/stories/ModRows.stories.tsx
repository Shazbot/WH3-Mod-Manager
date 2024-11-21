import React from "react";
import { Meta, StoryObj } from "@storybook/react";

import ModRow from "../components/ModRows";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { modsFive } from "./test_data/mods";
import initialState from "../initialAppState";

console.log(modsFive);
const MockedState: AppState = {
  ...initialState,
  currentPreset: {
    mods: modsFive,
    name: "",
  },
  allMods: modsFive,
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
