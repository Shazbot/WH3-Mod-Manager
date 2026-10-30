import { setStore } from "flowbite-react/store";

/** Match Flowbite's class merging to the Tailwind version used by the renderer build. */
export const configureFlowbite = () => setStore({ version: 3 });
