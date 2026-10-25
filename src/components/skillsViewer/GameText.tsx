import React from "react";

// The text tag colours in ui_colours_tables, from db.pack.
export const textTagColours: Record<string, string> = {
  black: "#000000",
  blue: "#2D2DFF",
  common: "#66FF00",
  dark_g: "#1E490C",
  dark_r: "#AA0000",
  dark_y: "#8C8C00",
  epic: "#A600FF",
  fabulous_pink: "#F33BFF",
  fe_white: "#FFF8D7",
  green: "#A0FF37",
  link: "#B95C00",
  magic: "#41E1E1",
  orange: "#FFAD5B",
  red: "#FF2D2D",
  white: "#FFFFFF",
  yellow: "#FFB900",
};

/** A piece of game text drawn in one style: a run of text, an inline image or a line break. */
export type GameTextRun = {
  /** The text, unset for an image or a line break. */
  text?: string;
  /** The `[[img:tag]]` tag of an inline image. */
  image?: string;
  /** Whether the run is a line break. */
  isBreak?: boolean;
  /** Whether the run sits in a `[[b]]` tag. */
  bold?: boolean;
  /** Whether the run sits in an `[[i]]` tag. */
  italic?: boolean;
  /** The CSS colour of the `[[col:name]]` tag the run sits in. */
  colour?: string;
};

type TextStyle = { tag: string; bold?: boolean; italic?: boolean; colour?: string };

/**
 * Splits game text into styled runs. It reads `[[b]]`, `[[i]]`, `[[col:name]]`, `[[img:tag]][[/img]]` and `\n`, and
 * drops any other tag while keeping its text.
 * @param text The localised text.
 * @returns The runs in order.
 */
export const parseGameText = (text: string): GameTextRun[] => {
  const runs: GameTextRun[] = [];
  const styles: TextStyle[] = [{ tag: "" }];
  let isInImage = false;
  let textStart = 0;
  const pushText = (value: string) => {
    if (!value || isInImage) return;
    const { bold, italic, colour } = styles[styles.length - 1];
    runs.push({ text: value, bold, italic, colour });
  };

  for (const match of text.matchAll(/\[\[(\/?)(\w+)(?::([^\]]*))?\]\]|\\n|\n/g)) {
    pushText(text.slice(textStart, match.index));
    textStart = match.index + match[0].length;
    const [, closing, tagName, value] = match;
    if (!tagName) {
      runs.push({ isBreak: true });
      continue;
    }

    const tag = tagName.toLowerCase();
    if (tag == "img") {
      isInImage = !closing;
      if (!closing && value) runs.push({ image: value });
    } else if (closing) {
      // Close back to the matching tag, so a stray closing tag does nothing.
      for (let i = styles.length - 1; i > 0; i--) {
        if (styles[i].tag != tag) continue;
        styles.length = i;
        break;
      }
    } else if (tag == "b" || tag == "i" || tag == "col") {
      const current = styles[styles.length - 1];
      styles.push({
        ...current,
        tag,
        bold: current.bold || tag == "b",
        italic: current.italic || tag == "i",
        colour: tag == "col" ? (textTagColours[value?.toLowerCase()] ?? current.colour) : current.colour,
      });
    }
  }
  pushText(text.slice(textStart));
  return runs;
};

/** Props for GameText. */
type GameTextProps = {
  text: string | undefined;
  taggedImages?: Record<string, string>;
  icons?: Record<string, string>;
};

/**
 * Draws game text with its markup applied.
 * @param props.text The localised text.
 * @param props.taggedImages Icon paths keyed by `[[img:tag]]` tag. Images without one are left out.
 * @param props.icons Icon URLs keyed by path.
 * @returns The styled text.
 */
const GameText = ({ text, taggedImages = {}, icons = {} }: GameTextProps) => (
  <>
    {parseGameText(text || "").map((run, i) => {
      if (run.isBreak) return <br key={i} />;
      if (run.image) {
        const src = icons[taggedImages[run.image]];
        return (
          src && (
            <img
              key={i}
              className="inline-block"
              style={{ height: "1.5em", verticalAlign: "-0.4em" }}
              src={src}
              alt={run.image}
            />
          )
        );
      }
      if (!run.bold && !run.italic && !run.colour) return <React.Fragment key={i}>{run.text}</React.Fragment>;
      return (
        <span
          key={i}
          style={{
            fontWeight: run.bold ? "bold" : undefined,
            fontStyle: run.italic ? "italic" : undefined,
            color: run.colour,
          }}
        >
          {run.text}
        </span>
      );
    })}
  </>
);

export default GameText;
