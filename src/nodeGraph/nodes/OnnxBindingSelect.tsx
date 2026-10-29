import React, { useState } from "react";
import Select from "react-select";
import { wrappedValueSelectStyle } from "../../styles/selectStyle";

interface BindingOption {
  value: string;
  label: string;
}

/** Native select popups size themselves to the longest schema path, beyond the modal/viewport. */
export const OnnxBindingSelect = ({
  options,
  value,
  onChange,
  label,
}: {
  options: BindingOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) => {
  const [search, setSearch] = useState("");
  const matches = options.filter((option) => option.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="min-w-0 w-full">
      <Select<BindingOption>
        aria-label={label}
        value={options.find((option) => option.value === value) || null}
        options={matches}
        onChange={(option) => {
          if (option) onChange(option.value);
        }}
        inputValue={search}
        onInputChange={setSearch}
        filterOption={null}
        menuPosition="fixed"
        menuPlacement="auto"
        maxMenuHeight={280}
        menuShouldScrollIntoView={false}
        styles={{
          ...wrappedValueSelectStyle,
          container: (base) => ({ ...base, width: "100%", minWidth: 0, fontSize: 14 }),
          menu: (base) => ({ ...wrappedValueSelectStyle.menu(base), width: "100%", maxWidth: "calc(100vw - 32px)" }),
          menuList: (base) => ({ ...base, overflowX: "hidden" }),
        }}
      />
    </div>
  );
};
