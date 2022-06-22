import React from "react";
import ButtonStories from "./Button.stories";
import "./../index.css";
export interface ButtonProps {
  /**
   * Is this the principal call to action on the page?
   */
  primary?: boolean;
  /**
   * What background color to use
   */
  backgroundColor?: string;
  /**
   * How large should the button be?
   */
  size?: "small" | "medium" | "large";
  /**
   * Button contents
   */
  label: string;
  /**
   * Optional click handler
   */
  onClick?: () => void;
}

export type ButtonState = {
  isChecked: boolean;
};

/**
 * Primary UI component for user interaction
 */
export default class Button extends React.Component<ButtonProps, ButtonState> {
  constructor(props: ButtonProps) {
    super(props);
  }

  state: ButtonState = {
    isChecked: false,
  };

  render() {
    return (
      <div className="grid grid-cols-4 gap-4 ">
        <div className="">Author</div>
        <div>Last updated</div>
        <div>Last subscribed</div>
        <div>
          <form>
            <label>
              <input
                type="checkbox"
                name="mod"
                checked={this.state.isChecked}
                onChange={(event) => this.shit(event)}
              ></input>
              Moddy mod
            </label>
          </form>
        </div>
        <>
          {window.api.getMods().map((mod, index) => (
            <>
              <div>{mod.name}</div>
              <div></div>
              <div></div>
              <div></div>
            </>
          ))}
        </>
      </div>
    );
  }
  shit(event: React.ChangeEvent<HTMLInputElement>): void {
    const target = event.target as HTMLInputElement;
    const value = target.type === "checkbox" ? target.checked : target.value;
    const name = target.name;
    console.log("%s %s", name, value);
    this.setState({
      isChecked: value,
    } as ButtonState);
  }
}
