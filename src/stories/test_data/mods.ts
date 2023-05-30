import randomWords from "random-words";

const capitalizeWord = (word: string) => word.slice(0, 1).toUpperCase().concat(word.slice(1));

const toCamelCase = (word: string, index: number) => {
  return index === 0 ? word.slice(0, 1).toUpperCase().concat(word.slice(1)) : word;
};

const capitalize = (word: string, index: number) => {
  return index === 0 ? capitalizeWord(word) : word;
};

const createRandomMod = () => {
  const a = {
    humanName: randomWords({ min: 2, max: 3 }).join(" "),
    name: randomWords({ min: 2, max: 3, formatter: toCamelCase }).join(""),
    path: "k:\\data\\example.pack",
    imgPath: "",
    workshopId: "",
    isEnabled: false,
    modDirectory: "",
    isInData: false,
    author: randomWords({ min: 1, max: 3 }).join(" "),
    isDeleted: false,
    isMovie: false,
    size: 1,
    isSymbolicLink: false,
  } as Mod;
  return a;
};

export const modsFive = [...Array(5).keys()].map(() => createRandomMod());
modsFive[1].categories = [];
modsFive[1].categories.push("Empire");

modsFive[2].categories = [];
modsFive[2].categories.push("Empire");
modsFive[2].categories.push("Stinky");
modsFive[2].isEnabled = true;
