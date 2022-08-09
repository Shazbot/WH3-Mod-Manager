const selectStyle = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  control: (base: any, state: any) => ({
    ...base,
    background: "#394250",
    borderRadius: state.isFocused ? "3px 3px 0 0" : 3,
    borderColor: state.isFocused ? "#5189f4" : "#4d5562",
  }),
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  menu: (base: any) => ({
    ...base,
    background: "#394250",
    border: "2px solid rgb(59 130 246)",
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  option: (base: any, state: any) => ({
    ...base,
    background: state.isFocused ? "#4b5563" : "#394250",
    color: "#f1f5f9",
  }),
  singleValue: (base: any) => ({
    ...base,
    color: "#f1f5f9",
  }),
  input: (base: any) => ({
    ...base,
    color: "#f1f5f9",
  }),
};

export default selectStyle;
