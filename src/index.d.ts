export {};

declare global {
  interface Window {
    api?: api;
  }

  interface api {
    getMods: () => Mod[];
    doThing: () => void;
  }

  interface Mod {
    name: string;
    path: string;
    imgPath: string;
    workshopId: string;
  }
}

// declare const api: {
//   getMods: () => Mod[];
//   doThing: () => void;
// };
