import React from "react";
import { Meta, StoryObj } from "@storybook/react";

import Categories from "../components/Categories";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { modsFive, categories } from "./test_data/mods";
import initialState from "../initialAppState";

export const MockedState: AppState = {
  ...initialState,
  currentPreset: {
    mods: modsFive,
    name: "",
  },
  allMods: modsFive,
  categories: [...categories, ...["Empire", "Stinky"]],
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

const taskList: Meta<typeof Categories> = {
  component: Categories,
  title: "Categoriess",
};
export default taskList;
type Story = StoryObj<typeof Categories>;

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
