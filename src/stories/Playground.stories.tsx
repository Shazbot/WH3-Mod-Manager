import React from "react";
import { Meta, StoryObj } from "@storybook/react";

import ModRow from "../components/ModRows";
import { configureStore, createSlice } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { modsFive } from "./test_data/mods";
import initialState from "../initialAppState";
import { Dropdown } from "../flowbite";

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
const Mockstore = ({
  appState,
  children,
}: {
  appState: AppState;
  children: React.ReactNode;
}) => (
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

const playgoundComponent = () => {
  return (
    <div>
      <div className="text-cyan-500 text-xl opacity-80">WORK IN PROGRESS</div>
      <Dropdown label="Options">
        <Dropdown.Item>
          <div className="flex items-center">
            <input
              className=""
              type="checkbox"
              checked={true}
              onChange={() => {}}
            ></input>
            <label className="ml-2" htmlFor="enable-closed-on-play">
              "Show Hidden Skills"
            </label>
          </div>
        </Dropdown.Item>
        <Dropdown.Item>
          <div className="flex items-center">
            <input
              className=""
              type="checkbox"
              checked={true}
              onChange={() => {}}
            ></input>
            <label className="ml-2" htmlFor="enable-closed-on-play">
              "Show Hidden Modifiers Inside Skills"
            </label>
          </div>
        </Dropdown.Item>
      </Dropdown>
    </div>
  );
};

const taskList: Meta<typeof playgoundComponent> = {
  component: playgoundComponent,
  title: "Playground",
};
export default taskList;
type Story = StoryObj<typeof ModRow>;

export const Default: Story = {
  decorators: [
    (story) => <Mockstore appState={MockedState}>{story()}</Mockstore>,
  ],
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
